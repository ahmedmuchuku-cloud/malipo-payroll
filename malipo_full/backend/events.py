"""
=============================================================================
KENYA PAYROLL SYSTEM — Event Bus & Plugin Interface
=============================================================================
Provides a lightweight publish/subscribe event system that all phases emit
to, and an abstract PayrollPlugin base class that Phases 6 and 7 implement.

Design goals:
  • Zero coupling — core payroll code emits events; plugins react.
  • Phases 6 (Audit/Backup) and 7 (Security/RBAC) register plugins here.
  • Thread-safe — multiple shard workers fire events concurrently.
  • Fail-safe — a broken plugin never crashes the payroll run.

Event catalogue (add new ones here as phases expand):
  RUN_STARTED          PayrollRunner begins a new run
  RUN_COMPLETED        PayrollRunner finishes; collector available
  SHARD_STARTED        A ShardWorker starts processing its shard
  SHARD_COMPLETED      A ShardWorker finishes its shard
  EMPLOYEE_COMPUTED    Engine produces a PayrollResult
  TRANSACTION_SAVED    DB write succeeds
  ERROR_OCCURRED       A task permanently fails
  TEMPLATE_GENERATED   Phase 4 creates a blank template
  TEMPLATE_POPULATED   Phase 4 fills a template with data
  TEMPLATE_VALIDATED   Phase 4 validates a filled template
  AGGREGATION_DONE     Phase 5 aggregation completed
  EXPORT_CREATED       Phase 5 produces a file
  BACKUP_TRIGGERED     Phase 6 starts a shard backup
  ACCESS_CHECKED       Phase 7 RBAC decision made
=============================================================================
"""

from __future__ import annotations

import logging
import threading
from abc import ABC, abstractmethod
from collections import defaultdict
from enum import Enum, auto
from typing import Any, Callable

logger = logging.getLogger(__name__)


class PayrollEvent(str, Enum):
    # Core payroll lifecycle
    RUN_STARTED         = "run_started"
    RUN_COMPLETED       = "run_completed"
    SHARD_STARTED       = "shard_started"
    SHARD_COMPLETED     = "shard_completed"
    EMPLOYEE_COMPUTED   = "employee_computed"
    TRANSACTION_SAVED   = "transaction_saved"
    ERROR_OCCURRED      = "error_occurred"

    # Phase 4 — Excel automation
    TEMPLATE_GENERATED  = "template_generated"
    TEMPLATE_POPULATED  = "template_populated"
    TEMPLATE_VALIDATED  = "template_validated"
    UPLOAD_PACKAGED     = "upload_packaged"

    # Phase 5 — Aggregation
    AGGREGATION_DONE    = "aggregation_done"
    EXPORT_CREATED      = "export_created"

    # Phase 6 — Audit & Backup (stubs; implemented in Phase 6)
    BACKUP_TRIGGERED    = "backup_triggered"
    BACKUP_COMPLETED    = "backup_completed"

    # Phase 7 — Security (stubs; implemented in Phase 7)
    ACCESS_CHECKED      = "access_checked"
    CREDENTIAL_ACCESSED = "credential_accessed"


class EventBus:
    """
    Thread-safe, singleton-per-payroll-system event broker.

    Usage:
        bus = EventBus()
        bus.subscribe(PayrollEvent.RUN_COMPLETED, my_handler)
        bus.publish(PayrollEvent.RUN_COMPLETED, collector=c, month=3, year=2026)
    """

    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)
        self._lock = threading.RLock()

    def subscribe(self, event: PayrollEvent, handler: Callable) -> None:
        with self._lock:
            self._handlers[event.value].append(handler)

    def unsubscribe(self, event: PayrollEvent, handler: Callable) -> None:
        with self._lock:
            self._handlers[event.value] = [
                h for h in self._handlers[event.value] if h is not handler
            ]

    def publish(self, event: PayrollEvent, **payload) -> None:
        """
        Fire all handlers for `event`. Exceptions in handlers are logged
        but never propagate — a broken plugin never crashes the payroll run.
        """
        with self._lock:
            handlers = list(self._handlers.get(event.value, []))

        for handler in handlers:
            try:
                handler(event=event, **payload)
            except Exception as exc:
                logger.error(
                    f"EventBus: handler {handler.__name__!r} raised on "
                    f"{event.value!r}: {exc}"
                )


# Module-level default bus (all phases import this)
_default_bus = EventBus()


def subscribe(event: PayrollEvent, handler: Callable) -> None:
    _default_bus.subscribe(event, handler)


def publish(event: PayrollEvent, **payload) -> None:
    _default_bus.publish(event, **payload)


def get_bus() -> EventBus:
    return _default_bus


# ─── PLUGIN BASE CLASS ────────────────────────────────────────────────────────

class PayrollPlugin(ABC):
    """
    Abstract base for all system plugins.

    Subclass and implement whichever hooks you need.
    Register with: plugin.register(bus)

    Planned concrete subclasses:
      Phase 6: AuditPlugin, BackupPlugin
      Phase 7: RBACPlugin, EncryptionPlugin, NotificationPlugin
    """
    name: str = "BasePlugin"

    def register(self, bus: EventBus | None = None) -> None:
        """Wire up all implemented handlers to the event bus."""
        b = bus or _default_bus
        hooks = {
            PayrollEvent.RUN_STARTED:        self.on_run_started,
            PayrollEvent.RUN_COMPLETED:      self.on_run_completed,
            PayrollEvent.SHARD_STARTED:      self.on_shard_started,
            PayrollEvent.SHARD_COMPLETED:    self.on_shard_completed,
            PayrollEvent.EMPLOYEE_COMPUTED:  self.on_employee_computed,
            PayrollEvent.TRANSACTION_SAVED:  self.on_transaction_saved,
            PayrollEvent.ERROR_OCCURRED:     self.on_error,
            PayrollEvent.TEMPLATE_POPULATED: self.on_template_populated,
            PayrollEvent.AGGREGATION_DONE:   self.on_aggregation_done,
            PayrollEvent.EXPORT_CREATED:     self.on_export_created,
            PayrollEvent.BACKUP_TRIGGERED:   self.on_backup_triggered,
            PayrollEvent.ACCESS_CHECKED:     self.on_access_checked,
        }
        for event, handler in hooks.items():
            b.subscribe(event, handler)
        logger.info(f"Plugin '{self.name}' registered")

    # ── Lifecycle hooks (override as needed) ─────────────────────────────────
    def on_run_started(self, **kw):        pass
    def on_run_completed(self, **kw):      pass
    def on_shard_started(self, **kw):      pass
    def on_shard_completed(self, **kw):    pass
    def on_employee_computed(self, **kw):  pass
    def on_transaction_saved(self, **kw):  pass
    def on_error(self, **kw):             pass
    def on_template_populated(self, **kw): pass
    def on_aggregation_done(self, **kw):   pass
    def on_export_created(self, **kw):     pass
    def on_backup_triggered(self, **kw):   pass   # Phase 6
    def on_access_checked(self, **kw):     pass   # Phase 7


# ─── BUILT-IN: Console Logger Plugin (used in dev/demo mode) ─────────────────

class ConsoleLoggerPlugin(PayrollPlugin):
    """Lightweight plugin that prints key lifecycle events to stdout."""
    name = "ConsoleLogger"

    def on_run_started(self, **kw):
        print(f"  [event] Run started — {kw.get('month')}/{kw.get('year')} "
              f"| {kw.get('num_shards')} shards | {kw.get('num_workers')} workers")

    def on_shard_completed(self, **kw):
        print(f"  [event] Shard {kw.get('shard_id'):04d} done — "
              f"{kw.get('processed')} processed, {kw.get('failed')} failed")

    def on_run_completed(self, **kw):
        c = kw.get("collector")
        if c:
            print(f"  [event] Run completed — "
                  f"{c.processed_count} employees | "
                  f"KES {c.totals.get('gross_salary', 0):,.2f} gross")

    def on_export_created(self, **kw):
        print(f"  [event] Export created — {kw.get('path')}")

    def on_error(self, **kw):
        print(f"  [event] ERROR emp {kw.get('employee_id')}: {kw.get('error')}")
