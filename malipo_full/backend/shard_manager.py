"""
=============================================================================
KENYA PAYROLL SYSTEM — Phase 1: Sharded SQLite Architecture
=============================================================================
Manages multiple SQLite database shards.
Each shard holds a range of employees (default: 5,000 per shard).
All operations are shard-aware and thread-safe.
=============================================================================
"""

import sqlite3
import os
import math
import threading
import logging
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime

logger = logging.getLogger(__name__)

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
SHARD_DIR       = Path(__file__).parent / "shards"
EMPLOYEES_PER_SHARD = 5_000
SHARD_PREFIX    = "shard_"

# ─── SCHEMA (applied to every shard) ─────────────────────────────────────────
SCHEMA_SQL = """
PRAGMA journal_mode=WAL;   -- Write-Ahead Logging for concurrent reads + 1 writer
PRAGMA synchronous=NORMAL; -- Faster writes while still crash-safe
PRAGMA foreign_keys=ON;

-- ── employees ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    employee_id         INTEGER  PRIMARY KEY,
    company_id          INTEGER  NOT NULL DEFAULT 1,
    full_name           TEXT     NOT NULL,
    kra_pin             TEXT     UNIQUE,
    nssf_number         TEXT,
    sha_number          TEXT,
    residency_status    TEXT     NOT NULL DEFAULT 'resident'
                                 CHECK(residency_status IN ('resident','nonresident')),
    hire_date           TEXT     NOT NULL,
    termination_date    TEXT,
    salary_type         TEXT     NOT NULL DEFAULT 'monthly'
                                 CHECK(salary_type IN ('monthly','hourly')),
    base_salary         REAL     NOT NULL CHECK(base_salary >= 0),
    job_title           TEXT,
    department          TEXT,
    national_id         TEXT,
    created_at          TEXT     NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT     NOT NULL DEFAULT (datetime('now'))
);

-- ── allowances ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS allowances (
    allowance_id        INTEGER  PRIMARY KEY AUTOINCREMENT,
    employee_id         INTEGER  NOT NULL REFERENCES employees(employee_id),
    allowance_type      TEXT     NOT NULL,  -- housing, transport, hardship, medical, other
    amount              REAL     NOT NULL CHECK(amount >= 0),
    taxable_flag        INTEGER  NOT NULL DEFAULT 1 CHECK(taxable_flag IN (0,1)),
    effective_from      TEXT     NOT NULL DEFAULT (date('now')),
    effective_to        TEXT,
    notes               TEXT
);

-- ── benefits ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benefits (
    benefit_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    employee_id         INTEGER  NOT NULL REFERENCES employees(employee_id),
    benefit_type        TEXT     NOT NULL,  -- car, loan, housing_benefit, club_fees, other
    value               REAL     NOT NULL CHECK(value >= 0),
    taxable_flag        INTEGER  NOT NULL DEFAULT 1 CHECK(taxable_flag IN (0,1)),
    effective_from      TEXT     NOT NULL DEFAULT (date('now')),
    effective_to        TEXT,
    notes               TEXT
);

-- ── deductions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deductions (
    deduction_id        INTEGER  PRIMARY KEY AUTOINCREMENT,
    employee_id         INTEGER  NOT NULL REFERENCES employees(employee_id),
    deduction_type      TEXT     NOT NULL,  -- court_order, loan, union_dues, helb, sacco, other
    amount              REAL     NOT NULL CHECK(amount >= 0),
    pre_tax_flag        INTEGER  NOT NULL DEFAULT 0 CHECK(pre_tax_flag IN (0,1)),
    effective_from      TEXT     NOT NULL DEFAULT (date('now')),
    effective_to        TEXT,
    notes               TEXT
);

-- ── reliefs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reliefs (
    relief_id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    employee_id         INTEGER  NOT NULL REFERENCES employees(employee_id),
    relief_type         TEXT     NOT NULL,  -- insurance, mortgage, post_retirement, disability
    monthly_amount      REAL     NOT NULL CHECK(monthly_amount >= 0),
    effective_from      TEXT     NOT NULL DEFAULT (date('now')),
    effective_to        TEXT,
    notes               TEXT
);

-- ── payroll_runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
    payroll_run_id      INTEGER  PRIMARY KEY AUTOINCREMENT,
    company_id          INTEGER  NOT NULL DEFAULT 1,
    run_month           INTEGER  NOT NULL CHECK(run_month BETWEEN 1 AND 12),
    run_year            INTEGER  NOT NULL,
    status              TEXT     NOT NULL DEFAULT 'draft'
                                 CHECK(status IN ('draft','processing','processed','locked')),
    initiated_by        TEXT,
    processed_at        TEXT,
    created_at          TEXT     NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, run_month, run_year)
);

-- ── payroll_transactions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_transactions (
    trans_id                INTEGER  PRIMARY KEY AUTOINCREMENT,
    payroll_run_id          INTEGER  NOT NULL REFERENCES payroll_runs(payroll_run_id),
    employee_id             INTEGER  NOT NULL REFERENCES employees(employee_id),
    -- earnings
    gross_salary            REAL     NOT NULL,
    base_salary             REAL     NOT NULL,
    taxable_allowances      REAL     NOT NULL DEFAULT 0,
    non_taxable_allowances  REAL     NOT NULL DEFAULT 0,
    benefits_in_kind        REAL     NOT NULL DEFAULT 0,
    -- statutory deductions (employee)
    nssf_tier1_employee     REAL     NOT NULL DEFAULT 0,
    nssf_tier2_employee     REAL     NOT NULL DEFAULT 0,
    nssf_employee           REAL     NOT NULL DEFAULT 0,
    shif                    REAL     NOT NULL DEFAULT 0,
    housing_levy_employee   REAL     NOT NULL DEFAULT 0,
    -- statutory deductions (employer)
    nssf_tier1_employer     REAL     NOT NULL DEFAULT 0,
    nssf_tier2_employer     REAL     NOT NULL DEFAULT 0,
    nssf_employer           REAL     NOT NULL DEFAULT 0,
    housing_levy_employer   REAL     NOT NULL DEFAULT 0,
    -- PAYE computation
    pre_tax_deductions      REAL     NOT NULL DEFAULT 0,
    disability_exemption    REAL     NOT NULL DEFAULT 0,
    taxable_income          REAL     NOT NULL DEFAULT 0,
    gross_paye              REAL     NOT NULL DEFAULT 0,
    -- reliefs
    personal_relief         REAL     NOT NULL DEFAULT 2400,
    insurance_relief        REAL     NOT NULL DEFAULT 0,
    mortgage_relief         REAL     NOT NULL DEFAULT 0,
    ahl_relief              REAL     NOT NULL DEFAULT 0,
    post_retirement_relief  REAL     NOT NULL DEFAULT 0,
    total_relief            REAL     NOT NULL DEFAULT 0,
    paye                    REAL     NOT NULL DEFAULT 0,
    -- other deductions
    helb_deduction          REAL     NOT NULL DEFAULT 0,
    other_deductions        REAL     NOT NULL DEFAULT 0,
    -- net
    total_statutory         REAL     NOT NULL DEFAULT 0,
    total_deductions        REAL     NOT NULL DEFAULT 0,
    net_pay                 REAL     NOT NULL DEFAULT 0,
    -- meta
    computed_at             TEXT     NOT NULL DEFAULT (datetime('now')),
    UNIQUE(payroll_run_id, employee_id)
);

-- ── audit_log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    log_id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    payroll_run_id      INTEGER,
    employee_id         INTEGER,
    event_type          TEXT     NOT NULL,  -- CALC, INSERT, UPDATE, DELETE, ERROR
    rule_applied        TEXT,
    field_name          TEXT,
    before_value        TEXT,
    after_value         TEXT,
    notes               TEXT,
    operator            TEXT     DEFAULT 'system',
    timestamp           TEXT     NOT NULL DEFAULT (datetime('now'))
);

-- ── INDEXES ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emp_company    ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_allow_emp      ON allowances(employee_id);
CREATE INDEX IF NOT EXISTS idx_benefit_emp    ON benefits(employee_id);
CREATE INDEX IF NOT EXISTS idx_ded_emp        ON deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_relief_emp     ON reliefs(employee_id);
CREATE INDEX IF NOT EXISTS idx_ptx_run        ON payroll_transactions(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_ptx_emp        ON payroll_transactions(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_run      ON audit_log(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_emp      ON audit_log(employee_id);
"""


# ─── SHARD MANAGER ────────────────────────────────────────────────────────────
class ShardManager:
    """
    Manages a pool of SQLite shards.

    Sharding strategy:
        shard_id = (employee_id - 1) // EMPLOYEES_PER_SHARD + 1
        db file  = shards/shard_0001.db  (zero-padded to 4 digits)
    """

    def __init__(self, shard_dir: Path = SHARD_DIR,
                 employees_per_shard: int = EMPLOYEES_PER_SHARD):
        self.shard_dir = Path(shard_dir)
        self.shard_dir.mkdir(parents=True, exist_ok=True)
        self.employees_per_shard = employees_per_shard
        self._locks: dict[int, threading.Lock] = {}
        self._global_lock = threading.Lock()

    # ── shard arithmetic ─────────────────────────────────────────────────────
    def shard_id_for(self, employee_id: int) -> int:
        """Map an employee_id to a shard number (1-based)."""
        return math.ceil(employee_id / self.employees_per_shard)

    def shard_path(self, shard_id: int) -> Path:
        return self.shard_dir / f"{SHARD_PREFIX}{shard_id:04d}.db"

    def _get_lock(self, shard_id: int) -> threading.Lock:
        with self._global_lock:
            if shard_id not in self._locks:
                self._locks[shard_id] = threading.Lock()
            return self._locks[shard_id]

    # ── connection context manager ───────────────────────────────────────────
    @contextmanager
    def connection(self, shard_id: int, timeout: float = 30.0):
        """
        Yield a sqlite3.Connection for the given shard.
        Uses WAL mode so multiple readers don't block.
        Writer acquires the per-shard threading.Lock.
        """
        path = self.shard_path(shard_id)
        conn = sqlite3.connect(str(path), timeout=timeout,
                               check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── schema management ────────────────────────────────────────────────────
    def initialize_shard(self, shard_id: int) -> None:
        """Create (or migrate) the schema for a single shard."""
        with self.connection(shard_id) as conn:
            conn.executescript(SCHEMA_SQL)
        logger.info(f"Shard {shard_id:04d} initialized at {self.shard_path(shard_id)}")

    def initialize_shards(self, count: int) -> None:
        """Create `count` shards (1..count) with full schema."""
        for shard_id in range(1, count + 1):
            self.initialize_shard(shard_id)
        logger.info(f"Initialized {count} shards in {self.shard_dir}")

    def list_shards(self) -> list[int]:
        """Return sorted list of existing shard IDs."""
        ids = []
        for f in self.shard_dir.glob(f"{SHARD_PREFIX}*.db"):
            try:
                ids.append(int(f.stem.replace(SHARD_PREFIX, "")))
            except ValueError:
                pass
        return sorted(ids)

    # ── employee helpers ─────────────────────────────────────────────────────
    def insert_employee(self, emp: dict) -> int:
        """Insert an employee into the correct shard. Returns employee_id."""
        emp_id   = emp["employee_id"]
        shard_id = self.shard_id_for(emp_id)
        lock     = self._get_lock(shard_id)

        with lock, self.connection(shard_id) as conn:
            conn.execute("""
                INSERT INTO employees
                    (employee_id, company_id, full_name, kra_pin, nssf_number,
                     sha_number, residency_status, hire_date, base_salary,
                     job_title, department)
                VALUES
                    (:employee_id, :company_id, :full_name, :kra_pin, :nssf_number,
                     :sha_number, :residency_status, :hire_date, :base_salary,
                     :job_title, :department)
            """, emp)
        return emp_id

    def get_employee(self, employee_id: int) -> dict | None:
        """Fetch one employee record."""
        shard_id = self.shard_id_for(employee_id)
        with self.connection(shard_id) as conn:
            row = conn.execute(
                "SELECT * FROM employees WHERE employee_id=?", (employee_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_employees_in_shard(self, shard_id: int,
                               company_id: int | None = None) -> list[dict]:
        """Return all active employees in a shard (optionally filtered by company)."""
        with self.connection(shard_id) as conn:
            if company_id is not None:
                rows = conn.execute(
                    "SELECT * FROM employees WHERE termination_date IS NULL "
                    "AND company_id=?", (company_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM employees WHERE termination_date IS NULL"
                ).fetchall()
        return [dict(r) for r in rows]

    # ── payroll run helpers ──────────────────────────────────────────────────
    def create_payroll_run(self, shard_id: int, month: int, year: int,
                           company_id: int = 1, initiated_by: str = "system") -> int:
        """Upsert a payroll run record and return its ID."""
        lock = self._get_lock(shard_id)
        with lock, self.connection(shard_id) as conn:
            conn.execute("""
                INSERT INTO payroll_runs (company_id, run_month, run_year, status, initiated_by)
                VALUES (?, ?, ?, 'draft', ?)
                ON CONFLICT(company_id, run_month, run_year)
                DO UPDATE SET status='draft', initiated_by=excluded.initiated_by
            """, (company_id, month, year, initiated_by))
            row = conn.execute("""
                SELECT payroll_run_id FROM payroll_runs
                WHERE company_id=? AND run_month=? AND run_year=?
            """, (company_id, month, year)).fetchone()
        return row["payroll_run_id"]

    def save_transaction(self, shard_id: int, tx: dict) -> None:
        """Upsert a payroll transaction."""
        lock = self._get_lock(shard_id)
        cols = ", ".join(tx.keys())
        placeholders = ", ".join(f":{k}" for k in tx.keys())
        update_clause = ", ".join(
            f"{k}=excluded.{k}" for k in tx.keys() if k not in ("trans_id",)
        )
        sql = f"""
            INSERT INTO payroll_transactions ({cols})
            VALUES ({placeholders})
            ON CONFLICT(payroll_run_id, employee_id) DO UPDATE SET {update_clause}
        """
        with lock, self.connection(shard_id) as conn:
            conn.execute(sql, tx)

    def write_audit(self, shard_id: int, log: dict) -> None:
        """Append an audit log entry."""
        lock = self._get_lock(shard_id)
        with lock, self.connection(shard_id) as conn:
            conn.execute("""
                INSERT INTO audit_log
                    (payroll_run_id, employee_id, event_type, rule_applied,
                     field_name, before_value, after_value, notes, operator)
                VALUES
                    (:payroll_run_id, :employee_id, :event_type, :rule_applied,
                     :field_name, :before_value, :after_value, :notes, :operator)
            """, log)

    def mark_run_processed(self, shard_id: int, payroll_run_id: int) -> None:
        """Set a payroll run status to 'processed'."""
        lock = self._get_lock(shard_id)
        with lock, self.connection(shard_id) as conn:
            conn.execute("""
                UPDATE payroll_runs
                SET status='processed', processed_at=datetime('now')
                WHERE payroll_run_id=?
            """, (payroll_run_id,))

    def get_transactions(self, shard_id: int,
                         payroll_run_id: int) -> list[dict]:
        """Fetch all transactions for a run in a given shard."""
        with self.connection(shard_id) as conn:
            rows = conn.execute("""
                SELECT * FROM payroll_transactions WHERE payroll_run_id=?
            """, (payroll_run_id,)).fetchall()
        return [dict(r) for r in rows]


# ─── SEED UTILITY (used by tests) ─────────────────────────────────────────────
def build_seed_employee(employee_id: int, **overrides) -> dict:
    """Generate a plausible seed employee for testing."""
    import random, string
    rng = random.Random(employee_id)

    names = [
        "Amina Wanjiru", "Brian Otieno", "Catherine Njoki", "David Kamau",
        "Esther Auma", "Felix Mutua", "Grace Wambui", "Hassan Abdi",
        "Irene Chebet", "Joseph Kariuki", "Kibe Mwangi", "Lydia Achieng",
        "Michael Njoroge", "Nadia Hassan", "Oscar Odhiambo", "Pauline Waweru",
    ]
    name = names[employee_id % len(names)]
    pin_suffix = "".join(rng.choices(string.digits, k=9))
    salary_choices = [28_000, 35_000, 45_000, 55_000, 65_000,
                      80_000, 100_000, 120_000, 180_000, 250_000]
    salary = salary_choices[employee_id % len(salary_choices)]

    defaults = dict(
        employee_id      = employee_id,
        company_id       = 1,
        full_name        = f"{name} #{employee_id}",
        kra_pin          = f"A{pin_suffix}B",
        nssf_number      = f"NB/{employee_id:08d}",
        sha_number       = f"SHA/{employee_id:08d}",
        residency_status = "resident",
        hire_date        = "2022-01-01",
        base_salary      = salary,
        job_title        = "Staff",
        department       = "General",
    )
    defaults.update(overrides)
    return defaults
