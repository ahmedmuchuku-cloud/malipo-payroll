# Malipo — Kenya Payroll & Compliance Suite

Full-stack Kenya payroll system. Statutory rates: 2025/2026.

---

## Project Structure

```
malipo/
├── frontend/
│   └── KenyaComplianceDashboard.jsx   React single-file app
│
└── backend/
    ├── config.py              Central constants & statutory rates
    ├── events.py              EventBus & PayrollPlugin base class
    ├── shard_manager.py       Phase 1: Sharded SQLite architecture
    ├── payroll_engine.py      Phase 2: Calculation engine (CORRECTED)
    ├── worker_queue.py        Phase 3: Pinned-worker queue
    ├── phase4_excel.py        Phase 4: Excel template automation
    ├── phase5_aggregator.py   Phase 5: Aggregator & exporters
    ├── phase6_audit_backup.py Phase 6: Audit log & backup
    ├── phase7_security.py     Phase 7: RBAC, credentials, encryption
    └── test_all.py            Master test suite
```

---

## Frontend — React Dashboard

**File:** `frontend/KenyaComplianceDashboard.jsx`

Single-file React app (no build step needed — paste into Claude.ai or any React sandbox).

### Features
- **Auth**: Register company (KRA PIN, NSSF no., SHA no.) + sign in/out
- **Persistence**: All data saved via `window.storage` API (survives refresh)
- **6 Tabs**: Dashboard · Employees · Calculator · Filings · Reports · Settings

### Employee Form (4 steps)
| Step | Fields |
|---|---|
| ① Personal | Name, Job Title, Department, Employment Type, Start Date, Tax Residency, KRA PIN, National ID, NSSF No., SHIF No. |
| ② Compensation | Basic Salary, Housing Allowance, Transport Allowance, Other Allowances (live gross + tax preview) |
| ③ Benefits & Reliefs | Car Benefit, Club Fees, Loan Fringe; Insurance/Mortgage/Post-Retirement relief; PWD exemption |
| ④ Deductions & Banking | Pension (pre-tax), HELB, SACCO, Salary Advance, Other; Bank Name, Account No., Branch |

### Statutory Rates (2025/2026)
| Item | Rate / Cap |
|---|---|
| NSSF (Phase 4, Feb 2026) | 6% up to UEL KES 108,000; max KES 6,480 |
| SHIF | 2.75% of gross (uncapped) |
| AHL | 1.5% employee + 1.5% employer |
| PAYE Personal Relief | KES 2,400/month |
| Mortgage Relief | KES 30,000/month |
| Post-Retirement Relief | KES 15,000/month |
| Pension Pre-Tax | KES 30,000/month |
| KRA Paybill | 222222 (Presidential Directive, Gazette No. 16008) |

---

## Backend — Python Engine

**Requirements:** Python 3.10+ · openpyxl · (optional: pysqlcipher3 for encryption)

```bash
pip install openpyxl
```

### Quick Start

```python
from shard_manager import ShardManager
from worker_queue import PayrollRunner
from events import ConsoleLoggerPlugin, get_bus

# 1. Initialise shards
sm = ShardManager()
sm.initialize_shards(count=1)

# 2. Insert employees (see shard_manager.build_seed_employee)
sm.insert_employee({
    "employee_id": 1, "company_id": 1,
    "full_name": "Amina Wanjiru", "kra_pin": "A012345678B",
    "nssf_number": "NS001234", "sha_number": "SH001234",
    "residency_status": "resident", "hire_date": "2022-01-01",
    "base_salary": 85000, "job_title": "Manager", "department": "Sales",
})

# 3. Register plugins
bus = get_bus()
ConsoleLoggerPlugin().register(bus)

# 4. Run payroll
runner = PayrollRunner(sm, bus=bus)
collector = runner.run(month=3, year=2026, company_id=1)
print(collector.summary())
```

### Phase Architecture

| Phase | Module | Purpose |
|---|---|---|
| 1 | `shard_manager.py` | SQLite sharding (5,000 employees/shard), WAL mode, schema |
| 2 | `payroll_engine.py` | Statutory calculations: NSSF/SHIF/AHL/PAYE, all reliefs |
| 3 | `worker_queue.py` | Pinned-worker queue: 1 queue → 1 worker → 1 shard .db |
| 4 | `phase4_excel.py` | Excel template population for KRA/NSSF/SHIF/AHL portals |
| 5 | `phase5_aggregator.py` | Cross-shard aggregation, GL export, remittance, P9A |
| 6 | `phase6_audit_backup.py` | Audit log plugin, SQLite native backup, P9A annual certs |
| 7 | `phase7_security.py` | RBAC, CredentialVault, SessionManager, ApprovalWorkflow |

### Corrections Applied (vs session's original uploads)

| File | Field | Old | New | Reference |
|---|---|---|---|---|
| `payroll_engine.py` | `MORTGAGE_RELIEF_CAP` | 25,000 | **30,000** | Finance Act 2025 |
| `payroll_engine.py` | `POST_RETIREMENT_CAP` | 5,000 | **15,000** | Finance Act 2023 s.31 |
| `payroll_engine.py` | `PENSION_PRE_TAX_CAP` | missing | **30,000** | KRA Employer Guide |
| `payroll_engine.py` | SHIF/AHL deductibility | not applied | **applied pre-PAYE** | KRA 2025/26 Guide |
| `payroll_engine.py` | Non-resident AHL | deducted | **not deducted** | KRA rules |
| `config.py` | `KRA paybill` | 572572 | **222222** | Kenya Gazette 16008 |
| `config.py` | `mortgage_relief_cap` | 25,000 | **30,000** | Finance Act 2025 |
| `config.py` | `post_retirement_cap` | 5,000 | **15,000** | Finance Act 2023 |
| `worker_queue.py` | Stalled worker | silent | **logged + error event** | — |
| `worker_queue.py` | SENTINEL race condition | present | **fixed** | — |
| `phase5_aggregator.py` | P9A scope | monthly | **annual rollup** | Kenya tax law |

---

## Compliance Notes

- **AHL deductibility**: KRA PDF confirms AHL IS pre-PAYE deductible for residents.
  Confirm with compliance officer before applying to non-residents.
- **NSSF Phase 4**: Effective Feb 1 2026. Verify with NSSF circular for your company.
- **PAYE late penalty**: 5% of tax due + 1%/month interest. Minimum KES 10,000.
- **Filing deadline**: 9th of following month (AHL = 9th working day).
- **P9A certificates**: Must be issued to employees by end of February.
