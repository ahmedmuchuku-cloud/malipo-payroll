"""
=============================================================================
KENYA PAYROLL SYSTEM — Phase 3 (v2): Pinned-Worker Queue Architecture
=============================================================================

THE FIX — Why the previous design had a concurrency problem:
─────────────────────────────────────────────────────────────
  Old design: ONE shared queue → N workers pull tasks from it randomly.
  Problem:    Worker-01 and Worker-02 could both grab tasks for shard_0001.db
              simultaneously. The threading.Lock serialised their DB writes,
              meaning within a shard you got sequential writes anyway —
              no actual write parallelism inside a shard.

  New design: ONE queue PER SHARD → ONE ShardWorker PER SHARD.
  
              shard_queues[1] ──► ShardWorker-0001 (only writes shard_0001.db)
              shard_queues[2] ──► ShardWorker-0002 (only writes shard_0002.db)
              shard_queues[3] ──► ShardWorker-0003 (only writes shard_0003.db)

  Benefit:    SQLite allows exactly one concurrent writer per .db file.
              We now saturate that limit: each shard has its own worker
              that is the ONLY writer — no lock contention, no waiting,
              no threading.Lock needed at all.

              Across N shards you get genuine N-way write parallelism —
              the maximum SQLite can deliver.

Concurrency model:
  • Dispatcher routes each PayrollTask to its shard's queue.
  • ShardWorker opens its .db once per run; reuses the connection.
  • WAL mode lets dashboards/reports read while the worker writes.
  • Retries go back to the SAME shard queue (task stays pinned).
  • EventBus hooks let Phases 6 & 7 observe every lifecycle event.

Scalability ceiling:
  • ~100 shards (100 parallel SQLite writers) before OS file-descriptor
    limits become a concern. Beyond that, swap the backend to PostgreSQL
    — only shard_manager.py needs to change.
=============================================================================
"""

from __future__ import annotations

import queue
import sqlite3
import threading
import time
import logging
import traceback
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from shard_manager import ShardManager, build_seed_employee
from payroll_engine import (
    PayrollEngine, EmployeeInput, result_to_transaction
)
from events import EventBus, PayrollEvent, get_bus
from config import (
    WORKER_MAX_RETRIES, WORKER_RETRY_BASE_DELAY, WORKER_QUEUE_TIMEOUT
)

logger = logging.getLogger(__name__)

SENTINEL = None   # poison pill that tells a ShardWorker to stop cleanly


# ─── TASK ─────────────────────────────────────────────────────────────────────

@dataclass
class PayrollTask:
    employee_id:    int
    shard_id:       int
    payroll_run_id: int
    employee_row:   dict
    month:          int
    year:           int
    allowances:     list[dict] = field(default_factory=list)
    benefits:       list[dict] = field(default_factory=list)
    deductions:     list[dict] = field(default_factory=list)
    reliefs:        list[dict] = field(default_factory=list)
    retry_count:    int = 0


# ─── RESULT COLLECTOR ─────────────────────────────────────────────────────────

class ResultCollector:
    """
    Thread-safe accumulator of payroll run totals across all shards.
    Also tracks per-shard subtotals so Phase 5 Aggregator can cross-validate.
    """

    TOTAL_KEYS = (
        "gross_salary", "nssf_employee", "nssf_employer",
        "shif", "housing_levy_employee", "housing_levy_employer",
        "paye", "total_statutory", "total_deductions", "net_pay",
    )

    def __init__(self):
        self._lock          = threading.Lock()
        self._totals:       dict[str, float] = defaultdict(float)
        self._count:        int = 0
        self._errors:       list[dict] = []
        self._shard_totals: dict[int, dict] = {}

    def record(self, result, shard_id: int) -> None:
        with self._lock:
            for k in self.TOTAL_KEYS:
                v = getattr(result, k, 0.0)
                self._totals[k] += v
                self._shard_totals.setdefault(shard_id, defaultdict(float))[k] += v
            self._count += 1

    def record_error(self, employee_id: int, shard_id: int, error: str) -> None:
        with self._lock:
            self._errors.append({
                "employee_id": employee_id,
                "shard_id":    shard_id,
                "error":       error,
                "timestamp":   datetime.utcnow().isoformat(),
            })

    @property
    def totals(self) -> dict:
        with self._lock:
            return dict(self._totals)

    @property
    def shard_totals(self) -> dict[int, dict]:
        with self._lock:
            return {k: dict(v) for k, v in self._shard_totals.items()}

    @property
    def processed_count(self) -> int:
        with self._lock:
            return self._count

    @property
    def errors(self) -> list[dict]:
        with self._lock:
            return list(self._errors)

    def summary(self) -> str:
        t = self.totals
        lines = [
            f"  Employees processed : {self.processed_count}",
            f"  Errors              : {len(self.errors)}",
            f"  Total Gross Payroll : KES {t.get('gross_salary', 0):>16,.2f}",
            f"  Total PAYE          : KES {t.get('paye', 0):>16,.2f}",
            f"  Total NSSF (emp)    : KES {t.get('nssf_employee', 0):>16,.2f}",
            f"  Total NSSF (emplr)  : KES {t.get('nssf_employer', 0):>16,.2f}",
            f"  Total SHIF          : KES {t.get('shif', 0):>16,.2f}",
            f"  Total AHL (emp)     : KES {t.get('housing_levy_employee', 0):>16,.2f}",
            f"  Total AHL (emplr)   : KES {t.get('housing_levy_employer', 0):>16,.2f}",
            f"  Total Net Pay       : KES {t.get('net_pay', 0):>16,.2f}",
        ]
        return "\n".join(lines)


# ─── SHARD WORKER (PINNED) ────────────────────────────────────────────────────

class ShardWorker(threading.Thread):
    """
    Processes ALL tasks for exactly ONE shard.

    Key properties:
      • Holds a single sqlite3.Connection for the full duration of the run.
      • No other thread ever writes to this shard concurrently.
      • No threading.Lock needed — single writer by design.
      • WAL mode allows concurrent reads from other threads.
      • Retries route back to OUR OWN queue (task never migrates shards).
    """

    def __init__(self,
                 shard_id:      int,
                 shard_queue:   queue.Queue,
                 shard_manager: ShardManager,
                 collector:     ResultCollector,
                 bus:           EventBus,
                 stop_event:    threading.Event):
        super().__init__(name=f"ShardWorker-{shard_id:04d}", daemon=True)
        self.shard_id   = shard_id
        self.queue      = shard_queue
        self.shard_mgr  = shard_manager
        self.collector  = collector
        self.bus        = bus
        self.stop_event = stop_event
        self.engine     = PayrollEngine()
        self.processed  = 0
        self.failed     = 0
        self._conn: Optional[sqlite3.Connection] = None

    def run(self) -> None:
        db_name = self.shard_mgr.shard_path(self.shard_id).name
        logger.info(f"[{self.name}] started — owns {db_name}")
        self.bus.publish(PayrollEvent.SHARD_STARTED,
                         shard_id=self.shard_id, worker=self.name)

        # Open ONE connection for the entire run — avoids repeated open/close overhead
        self._conn = self._open_connection()
        try:
            while not self.stop_event.is_set():
                try:
                    task = self.queue.get(timeout=WORKER_QUEUE_TIMEOUT)
                except queue.Empty:
                    continue

                if task is SENTINEL:
                    self.queue.task_done()
                    break

                self._process(task)
                self.queue.task_done()
        finally:
            if self._conn:
                try:
                    self._conn.close()
                except Exception:
                    pass

        self.bus.publish(PayrollEvent.SHARD_COMPLETED,
                         shard_id=self.shard_id, worker=self.name,
                         processed=self.processed, failed=self.failed)
        logger.info(f"[{self.name}] done — processed={self.processed}, "
                    f"failed={self.failed}")

    def _open_connection(self) -> sqlite3.Connection:
        path = str(self.shard_mgr.shard_path(self.shard_id))
        conn = sqlite3.connect(path, timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-32000")   # 32 MB page cache per worker
        return conn

    def _process(self, task: PayrollTask) -> None:
        try:
            inp    = self._build_input(task)
            result = self.engine.compute(inp)

            self.bus.publish(PayrollEvent.EMPLOYEE_COMPUTED,
                             employee_id=task.employee_id,
                             shard_id=self.shard_id, result=result)

            self._save_transaction(task, result)
            self._write_audit(task, result)

            self.collector.record(result, self.shard_id)
            self.processed += 1

            self.bus.publish(PayrollEvent.TRANSACTION_SAVED,
                             employee_id=task.employee_id,
                             shard_id=self.shard_id,
                             net_pay=result.net_pay)

        except Exception as exc:
            if task.retry_count < WORKER_MAX_RETRIES:
                task.retry_count += 1
                delay = WORKER_RETRY_BASE_DELAY * (2 ** (task.retry_count - 1))
                logger.warning(f"[{self.name}] emp {task.employee_id} "
                               f"retry {task.retry_count}/{WORKER_MAX_RETRIES} "
                               f"in {delay:.2f}s — {exc}")
                time.sleep(delay)
                # Re-queue to OUR queue — task stays pinned to this shard
                # IMPORTANT: increment queue count BEFORE task_done
                # so q.join() doesn't return prematurely (the retry is
                # still an outstanding work item for this shard).
                self.queue.put(task)
                # task_done() is called in the outer finally of the
                # main loop (after _process returns), NOT here.
                # We re-raise to let the outer loop handle task_done.
                return  # sentinel: outer loop calls task_done after _process
            else:
                self.failed += 1
                self.collector.record_error(task.employee_id, self.shard_id, str(exc))
                self._write_error_audit(task, exc)
                self.bus.publish(PayrollEvent.ERROR_OCCURRED,
                                 employee_id=task.employee_id,
                                 shard_id=self.shard_id, error=str(exc))
                logger.error(f"[{self.name}] emp {task.employee_id} "
                             f"permanently failed: {exc}")

    # ── Direct DB writes — no lock needed (this thread is the sole writer) ────

    def _save_transaction(self, task: PayrollTask, result) -> None:
        tx = result_to_transaction(result, task.payroll_run_id)
        cols         = ", ".join(tx.keys())
        placeholders = ", ".join(f":{k}" for k in tx.keys())
        update_cols  = ", ".join(
            f"{k}=excluded.{k}" for k in tx.keys() if k != "trans_id"
        )
        self._conn.execute(f"""
            INSERT INTO payroll_transactions ({cols}) VALUES ({placeholders})
            ON CONFLICT(payroll_run_id, employee_id) DO UPDATE SET {update_cols}
        """, tx)
        self._conn.commit()

    def _write_audit(self, task: PayrollTask, result) -> None:
        self._conn.execute("""
            INSERT INTO audit_log
                (payroll_run_id, employee_id, event_type, rule_applied,
                 field_name, before_value, after_value, notes, operator)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, (
            task.payroll_run_id, task.employee_id, "CALC",
            "NSSF_Y4+SHIF+AHL+PAYE_2026", "net_pay",
            None, str(result.net_pay),
            " | ".join(result.audit_notes[-3:]),
            self.name,
        ))
        self._conn.commit()

    def _write_error_audit(self, task: PayrollTask, exc: Exception) -> None:
        try:
            self._conn.execute("""
                INSERT INTO audit_log
                    (payroll_run_id, employee_id, event_type, notes, operator)
                VALUES (?,?,?,?,?)
            """, (task.payroll_run_id, task.employee_id, "ERROR",
                  traceback.format_exc()[:800], self.name))
            self._conn.commit()
        except Exception:
            pass

    # ── Input builder ─────────────────────────────────────────────────────────

    def _build_input(self, task: PayrollTask) -> EmployeeInput:
        emp = task.employee_row

        taxable_allow     = sum(r["amount"] for r in task.allowances
                                if r.get("taxable_flag", 1))
        non_taxable_allow = sum(r["amount"] for r in task.allowances
                                if not r.get("taxable_flag", 1))

        bik_by_type = {r["benefit_type"]: r["value"]
                       for r in task.benefits if r.get("taxable_flag", 1)}

        pension_pre_tax = sum(r["amount"] for r in task.deductions
                              if r.get("pre_tax_flag", 0))
        helb  = sum(r["amount"] for r in task.deductions
                    if r.get("deduction_type") == "helb")
        other = sum(r["amount"] for r in task.deductions
                    if not r.get("pre_tax_flag", 0)
                    and r.get("deduction_type") != "helb")

        relief_by_type: dict[str, float] = defaultdict(float)
        for r in task.reliefs:
            relief_by_type[r["relief_type"]] += r.get("monthly_amount", 0)

        return EmployeeInput(
            employee_id            = emp["employee_id"],
            full_name              = emp["full_name"],
            residency_status       = emp.get("residency_status", "resident"),
            base_salary            = emp["base_salary"],
            taxable_allowances     = taxable_allow,
            non_taxable_allowances = non_taxable_allow,
            car_benefit            = bik_by_type.get("car", 0),
            club_fees              = bik_by_type.get("club_fees", 0),
            loan_fringe            = bik_by_type.get("loan", 0),
            pension_pre_tax        = pension_pre_tax,
            disability_exemption   = relief_by_type.get("disability", 0),
            insurance_relief       = relief_by_type.get("insurance", 0),
            mortgage_relief        = relief_by_type.get("mortgage", 0),
            post_retirement_relief = relief_by_type.get("post_retirement", 0),
            helb_deduction         = helb,
            other_deductions       = other,
        )


# ─── DISPATCHER ───────────────────────────────────────────────────────────────

class Dispatcher:
    """
    Loads employees from every shard and routes PayrollTasks to the
    correct shard-specific queue. Routing is 100% deterministic:
        shard_queues[task.shard_id].put(task)
    A task NEVER migrates to a different shard's queue.
    """

    def __init__(self, shard_manager: ShardManager):
        self.shard_mgr = shard_manager

    def enqueue_run(self,
                    shard_queues: dict[int, queue.Queue],
                    month:        int,
                    year:         int,
                    company_id:   int = 1,
                    shard_ids:    list[int] | None = None,
                    initiated_by: str = "system") -> dict[int, int]:
        """
        Upsert payroll_run records and fill shard queues.
        Returns {shard_id: payroll_run_id}.
        """
        if shard_ids is None:
            shard_ids = self.shard_mgr.list_shards()

        run_map: dict[int, int] = {}
        total_tasks = 0

        for shard_id in shard_ids:
            run_id    = self.shard_mgr.create_payroll_run(
                shard_id, month, year, company_id, initiated_by
            )
            run_map[shard_id] = run_id
            employees = self.shard_mgr.get_employees_in_shard(shard_id, company_id)
            q         = shard_queues[shard_id]

            # Pre-load reliefs for all employees in shard (one query, not N queries)
            relief_map = self.shard_mgr.get_reliefs_for_shard(shard_id)

            for emp in employees:
                q.put(PayrollTask(
                    employee_id    = emp["employee_id"],
                    shard_id       = shard_id,
                    payroll_run_id = run_id,
                    employee_row   = emp,
                    month          = month,
                    year           = year,
                    reliefs        = relief_map.get(emp["employee_id"], []),
                ))
                total_tasks += 1

            q.put(SENTINEL)   # one poison pill per shard queue

            logger.info(f"Shard {shard_id:04d}: run_id={run_id}, "
                        f"queued {len(employees)} employees")

        logger.info(f"Dispatcher: {total_tasks} tasks across "
                    f"{len(shard_ids)} shards enqueued")
        return run_map


# ─── PAYROLL RUNNER ───────────────────────────────────────────────────────────

class PayrollRunner:
    """
    Orchestrates the full payroll cycle with pinned workers.

    Pinning guarantee:
      shard_id → queue → ShardWorker → sqlite .db file
      One-to-one-to-one. No ambiguity. No contention.
    """

    def __init__(self,
                 shard_manager: ShardManager,
                 bus:           EventBus | None = None):
        self.shard_mgr = shard_manager
        self.bus       = bus or get_bus()

    def run(self,
            month:        int,
            year:         int,
            company_id:   int = 1,
            shard_ids:    list[int] | None = None,
            initiated_by: str = "system") -> ResultCollector:

        if shard_ids is None:
            shard_ids = self.shard_mgr.list_shards()

        num_workers = len(shard_ids)   # always exactly one worker per shard

        self.bus.publish(PayrollEvent.RUN_STARTED,
                         month=month, year=year,
                         num_shards=num_workers,
                         num_workers=num_workers)

        logger.info(f"PayrollRunner: {month}/{year} | "
                    f"{num_workers} pinned workers | shards={shard_ids}")

        # ── Core pinned-worker setup ──────────────────────────────────────────
        shard_queues: dict[int, queue.Queue] = {
            s: queue.Queue() for s in shard_ids
        }
        stop_event = threading.Event()
        collector  = ResultCollector()

        dispatcher = Dispatcher(self.shard_mgr)
        t0 = time.perf_counter()
        run_map = dispatcher.enqueue_run(
            shard_queues, month, year, company_id, shard_ids, initiated_by
        )

        # Start exactly one ShardWorker per shard
        workers: list[ShardWorker] = []
        for shard_id in shard_ids:
            w = ShardWorker(
                shard_id      = shard_id,
                shard_queue   = shard_queues[shard_id],
                shard_manager = self.shard_mgr,
                collector     = collector,
                bus           = self.bus,
                stop_event    = stop_event,
            )
            workers.append(w)
            w.start()

        # Wait for every shard queue to drain completely
        for q in shard_queues.values():
            q.join()

        stalled = []
        for w in workers:
            w.join(timeout=30)
            if w.is_alive():
                stalled.append(w.name)
                logger.error(
                    f"[PayrollRunner] Worker {w.name} did not finish within "
                    f"30s — shard {w.shard_id} may be incomplete. "
                    f"Processed={w.processed}, Failed={w.failed}"
                )
                collector.record_error(-1, w.shard_id,
                                       f"Worker {w.name} timeout — shard incomplete")

        if stalled:
            self.bus.publish(PayrollEvent.ERROR_OCCURRED,
                             employee_id=-1, shard_id=-1,
                             error=f"Stalled workers: {stalled}")

        elapsed = time.perf_counter() - t0

        # Mark all runs processed
        for shard_id, run_id in run_map.items():
            self.shard_mgr.mark_run_processed(shard_id, run_id)

        logger.info(f"PayrollRunner complete in {elapsed:.3f}s\n"
                    f"{collector.summary()}")

        self.bus.publish(PayrollEvent.RUN_COMPLETED,
                         collector=collector, month=month, year=year,
                         elapsed_seconds=elapsed, run_map=run_map)
        return collector


# ─── CONVENIENCE ──────────────────────────────────────────────────────────────

def run_payroll(shard_dir=None, month: int = None, year: int = None,
                company_id: int = 1, shard_ids=None,
                bus: EventBus | None = None) -> ResultCollector:
    """One-call helper for a complete payroll cycle."""
    from datetime import date
    if shard_dir is None:
        from config import SHARD_DIR
        shard_dir = SHARD_DIR
    if month is None or year is None:
        today = date.today()
        month = month or today.month
        year  = year  or today.year
    sm = ShardManager(shard_dir=Path(shard_dir))
    return PayrollRunner(sm, bus=bus).run(
        month=month, year=year, company_id=company_id, shard_ids=shard_ids
    )
