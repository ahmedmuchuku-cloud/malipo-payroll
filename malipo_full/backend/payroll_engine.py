"""
=============================================================================
KENYA PAYROLL SYSTEM — Phase 2: Payroll Calculation Engine
=============================================================================
Implements 2026 Kenya statutory rules (all corrections applied):

  • NSSF  — Year 4 rates (effective Feb 1 2026)
              Tier I : 6% of first KES 9,000  → max KES 540
              Tier II: 6% of KES 9,001–108,000 → max KES 5,940
              Cap    : KES 6,480 (employee); employer mirrors employee

  • SHIF  — 2.75% of gross monthly salary (uncapped)
              Pre-PAYE deductible per KRA 2025/26 Employer Guide

  • AHL   — 1.5% of gross (employee); 1.5% of gross (employer)
              Pre-PAYE deductible for residents (KRA 2025/26 Employer Guide)
              AHL relief = 15% of employee AHL (additional PAYE relief)

  • PAYE  — Progressive 2026 bands, post-relief:
              0 –  24,000        10%
              24,001 –  32,333   25%
              32,334 – 500,000   30%
              500,001 – 800,000  32.5%
              > 800,000          35%

  • Reliefs (Finance Act 2023/2025 — CORRECTED caps):
              Personal            KES 2,400/mo (all residents)
              Insurance           15% of qualifying premiums, cap KES 5,000/mo
              Mortgage interest   cap KES 30,000/mo  ← CORRECTED (was 25k)
              AHL relief          15% of employee AHL
              Post-retirement     cap KES 15,000/mo  ← CORRECTED (was 5k)
              Pension pre-tax     cap KES 30,000/mo  ← NEW (employer-approved)
              Disability          up to KES 150,000/mo exempt from taxable income

  • Non-residents: personal/insurance/mortgage reliefs NOT applied;
                   AHL pre-tax deduction NOT applied; flat 30% PAYE.

CORRECTIONS vs uploaded version:
  - MORTGAGE_RELIEF_CAP   : 25,000 → 30,000 (Finance Act 2025)
  - POST_RETIREMENT_CAP   : 5,000  → 15,000 (Finance Act 2023 s.31)
  - PENSION_PRE_TAX_CAP   : new    → 30,000/mo
  - SHIF / AHL deductibility: now correctly applied pre-PAYE
  - Non-resident AHL deductibility: removed (non-residents pay AHL but
    it is not deductible from their taxable income)
=============================================================================
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import math
import logging

logger = logging.getLogger(__name__)


# ─── CONSTANTS (2026) — ALL CORRECTIONS APPLIED ───────────────────────────────
NSSF_TIER1_LIMIT  = 9_000
NSSF_TIER2_LIMIT  = 108_000
NSSF_RATE         = 0.06
NSSF_TIER1_MAX    = 540.0
NSSF_TIER2_MAX    = 5_940.0
NSSF_EMPLOYEE_MAX = 6_480.0

SHIF_RATE   = 0.0275

AHL_RATE        = 0.015
AHL_RELIEF_RATE = 0.15

PERSONAL_RELIEF          = 2_400.0
INSURANCE_RELIEF_CAP     = 5_000.0
MORTGAGE_RELIEF_CAP      = 30_000.0   # CORRECTED: Finance Act 2025 (was 25,000)
POST_RETIREMENT_CAP      = 15_000.0   # CORRECTED: Finance Act 2023 s.31 (was 5,000)
DISABILITY_CAP           = 150_000.0
PENSION_PRE_TAX_CAP      = 30_000.0   # NEW: employer-registered pension scheme

# Whether SHIF and AHL reduce taxable income before PAYE
# True per KRA 2025/26 Employer's Guide s.4.2
SHIF_IS_PRE_TAX = True
AHL_IS_PRE_TAX  = True  # only for residents

# PAYE late penalty constants (corrected — paybill was wrong in original)
PAYE_LATE_PENALTY_PCT = 0.05     # 5% of tax due (one-time)
PAYE_LATE_INTEREST    = 0.01     # 1%/month on unpaid balance
KRA_PAYE_PAYBILL      = "222222" # Presidential Directive, Kenya Gazette No. 16008

# PAYE bands: (upper_limit, marginal_rate, label)
PAYE_BANDS = [
    (24_000,   0.10,  "First KES 24,000 @ 10%"),
    (32_333,   0.25,  "KES 24,001–32,333 @ 25%"),
    (500_000,  0.30,  "KES 32,334–500,000 @ 30%"),
    (800_000,  0.325, "KES 500,001–800,000 @ 32.5%"),
    (math.inf, 0.35,  "Above KES 800,000 @ 35%"),
]


# ─── DATA CLASSES ─────────────────────────────────────────────────────────────

@dataclass
class EmployeeInput:
    """All inputs needed to compute one employee's payroll."""
    employee_id:        int
    full_name:          str
    residency_status:   str   = "resident"

    # Earnings
    base_salary:            float = 0.0
    taxable_allowances:     float = 0.0
    non_taxable_allowances: float = 0.0
    bonuses:                float = 0.0
    overtime:               float = 0.0

    # Benefits-in-kind (increase taxable income)
    car_benefit:  float = 0.0
    club_fees:    float = 0.0
    loan_fringe:  float = 0.0

    # Pre-tax pension (reduces taxable income, capped at 30k/mo)
    pension_pre_tax: float = 0.0

    # Disability exemption (reduces taxable income, capped at 150k/mo)
    disability_exemption: float = 0.0

    # PAYE reliefs (raw amounts — caps applied in engine)
    insurance_relief:       float = 0.0
    mortgage_relief:        float = 0.0
    post_retirement_relief: float = 0.0

    # Post-tax deductions
    helb_deduction:   float = 0.0
    other_deductions: float = 0.0


@dataclass
class NSSFResult:
    tier1_employee:  float
    tier2_employee:  float
    employee:        float
    tier1_employer:  float
    tier2_employer:  float
    employer:        float


@dataclass
class PAYEBand:
    label:         str
    taxable_slice: float
    rate:          float
    tax:           float


@dataclass
class PayrollResult:
    """Full payroll computation result for one employee-month."""
    employee_id:   int
    full_name:     str

    gross_salary:           float = 0.0
    base_salary:            float = 0.0
    taxable_allowances:     float = 0.0
    non_taxable_allowances: float = 0.0
    benefits_in_kind:       float = 0.0

    nssf_tier1_employee: float = 0.0
    nssf_tier2_employee: float = 0.0
    nssf_employee:       float = 0.0
    nssf_tier1_employer: float = 0.0
    nssf_tier2_employer: float = 0.0
    nssf_employer:       float = 0.0

    shif: float = 0.0

    housing_levy_employee: float = 0.0
    housing_levy_employer: float = 0.0

    pre_tax_deductions:   float = 0.0
    disability_exemption: float = 0.0
    taxable_income:       float = 0.0

    paye_bands:   list = field(default_factory=list)
    gross_paye:   float = 0.0

    personal_relief:        float = 0.0
    insurance_relief:       float = 0.0
    mortgage_relief:        float = 0.0
    ahl_relief:             float = 0.0
    post_retirement_relief: float = 0.0
    total_relief:           float = 0.0
    paye:                   float = 0.0

    helb_deduction:   float = 0.0
    other_deductions: float = 0.0

    total_statutory:   float = 0.0
    total_deductions:  float = 0.0
    net_pay:           float = 0.0

    effective_paye_rate:  float = 0.0
    effective_total_rate: float = 0.0

    audit_notes: list = field(default_factory=list)


# ─── CALCULATION FUNCTIONS ────────────────────────────────────────────────────

def calc_nssf(gross: float) -> NSSFResult:
    """NSSF Year 4 (Feb 2026). Both employer and employee contribute same."""
    tier1_base = min(gross, NSSF_TIER1_LIMIT)
    tier1      = round(tier1_base * NSSF_RATE, 2)
    tier2_base = max(0.0, min(gross, NSSF_TIER2_LIMIT) - NSSF_TIER1_LIMIT)
    tier2      = round(tier2_base * NSSF_RATE, 2)
    total      = min(tier1 + tier2, NSSF_EMPLOYEE_MAX)
    return NSSFResult(
        tier1_employee=tier1, tier2_employee=tier2, employee=total,
        tier1_employer=tier1, tier2_employer=tier2, employer=total,
    )


def calc_shif(gross: float) -> float:
    """SHIF = 2.75% of gross monthly salary (no cap)."""
    return round(gross * SHIF_RATE, 2)


def calc_ahl(gross: float) -> tuple:
    """Returns (employee_ahl, employer_ahl) — each 1.5% of gross."""
    emp = round(gross * AHL_RATE, 2)
    return emp, emp


def calc_paye_bands(taxable_income: float,
                    nonresident: bool = False) -> tuple:
    """Apply Kenya 2026 progressive PAYE bands."""
    if nonresident:
        tax = round(max(0.0, taxable_income) * 0.30, 2)
        return [PAYEBand("Non-resident flat rate 30%", taxable_income, 0.30, tax)], tax

    bands: list[PAYEBand] = []
    gross_paye = 0.0
    prev_limit = 0.0

    for upper, rate, label in PAYE_BANDS:
        if taxable_income <= prev_limit:
            break
        taxable_slice = min(taxable_income, upper) - prev_limit
        tax           = round(taxable_slice * rate, 2)
        gross_paye   += tax
        bands.append(PAYEBand(label=label, taxable_slice=taxable_slice,
                              rate=rate, tax=tax))
        prev_limit = upper

    return bands, round(gross_paye, 2)


def apply_reliefs(gross_paye: float,
                  nonresident:         bool,
                  insurance_raw:       float,
                  mortgage_raw:        float,
                  ahl_employee:        float,
                  post_retirement_raw: float) -> dict:
    """
    Compute all PAYE reliefs and return reduced PAYE.
    Residents:     personal + insurance + mortgage + AHL relief + post-retirement
    Non-residents: AHL relief only
    """
    personal  = 0.0
    insurance = 0.0
    mortgage  = 0.0
    post_ret  = 0.0

    # AHL relief applies to all employees (both resident and non-resident)
    ahl_relief = round(ahl_employee * AHL_RELIEF_RATE, 2)

    if not nonresident:
        personal  = PERSONAL_RELIEF
        insurance = min(insurance_raw, INSURANCE_RELIEF_CAP)
        mortgage  = min(mortgage_raw,  MORTGAGE_RELIEF_CAP)
        post_ret  = min(post_retirement_raw, POST_RETIREMENT_CAP)

    total_relief = personal + insurance + mortgage + ahl_relief + post_ret
    paye = max(0.0, round(gross_paye - total_relief, 2))

    return dict(
        personal_relief        = personal,
        insurance_relief       = insurance,
        mortgage_relief        = mortgage,
        ahl_relief             = ahl_relief,
        post_retirement_relief = post_ret,
        total_relief           = total_relief,
        paye                   = paye,
    )


# ─── MAIN ENGINE ─────────────────────────────────────────────────────────────

class PayrollEngine:
    """
    Stateless, rules-driven payroll computation engine.

    Usage:
        engine = PayrollEngine()
        result = engine.compute(emp_input)
    """

    def compute(self, inp: EmployeeInput) -> PayrollResult:
        """Full payroll calculation for one employee in one month."""
        res   = PayrollResult(employee_id=inp.employee_id, full_name=inp.full_name)
        notes = res.audit_notes
        nonresident = (inp.residency_status == "nonresident")

        # ── 1. Gross Income ──────────────────────────────────────────────────
        bik   = inp.car_benefit + inp.club_fees + inp.loan_fringe
        gross = (inp.base_salary + inp.taxable_allowances
                 + inp.non_taxable_allowances + inp.bonuses + inp.overtime)

        res.gross_salary           = round(gross, 2)
        res.base_salary            = round(inp.base_salary, 2)
        res.taxable_allowances     = round(inp.taxable_allowances, 2)
        res.non_taxable_allowances = round(inp.non_taxable_allowances, 2)
        res.benefits_in_kind       = round(bik, 2)
        notes.append(f"Gross: KES {gross:,.2f}")

        # ── 2. NSSF ──────────────────────────────────────────────────────────
        nssf = calc_nssf(gross)
        res.nssf_tier1_employee = nssf.tier1_employee
        res.nssf_tier2_employee = nssf.tier2_employee
        res.nssf_employee       = nssf.employee
        res.nssf_tier1_employer = nssf.tier1_employer
        res.nssf_tier2_employer = nssf.tier2_employer
        res.nssf_employer       = nssf.employer
        notes.append(f"NSSF Y4: {nssf.employee:.2f} (T1={nssf.tier1_employee:.2f}, T2={nssf.tier2_employee:.2f})")

        # ── 3. SHIF ──────────────────────────────────────────────────────────
        shif = calc_shif(gross)
        res.shif = shif
        notes.append(f"SHIF 2.75%: {shif:.2f}")

        # ── 4. AHL ───────────────────────────────────────────────────────────
        ahl_emp, ahl_emplr = calc_ahl(gross)
        res.housing_levy_employee = ahl_emp
        res.housing_levy_employer = ahl_emplr
        notes.append(f"AHL 1.5%: emp={ahl_emp:.2f}, emplr={ahl_emplr:.2f}")

        # ── 5. Pension pre-tax deduction (capped at 30k/mo) ──────────────────
        pension_deduct = min(inp.pension_pre_tax, PENSION_PRE_TAX_CAP)

        # ── 6. Taxable Income ────────────────────────────────────────────────
        # For non-residents: AHL NOT deductible pre-PAYE
        disability    = min(inp.disability_exemption, DISABILITY_CAP)
        shif_deduct   = shif if SHIF_IS_PRE_TAX else 0.0
        ahl_deduct    = ahl_emp if (AHL_IS_PRE_TAX and not nonresident) else 0.0

        pre_tax_total = round(nssf.employee + shif_deduct + ahl_deduct + pension_deduct, 2)
        taxable = max(0.0, round(
            gross + bik - nssf.employee - shif_deduct - ahl_deduct - pension_deduct - disability, 2
        ))

        res.pre_tax_deductions   = pre_tax_total
        res.disability_exemption = disability
        res.taxable_income       = taxable
        notes.append(
            f"Taxable: {taxable:,.2f} "
            f"({'NON-RESIDENT, ' if nonresident else ''}AHL_deduct={ahl_deduct:.2f}, "
            f"SHIF_deduct={shif_deduct:.2f}, pension={pension_deduct:.2f})"
        )

        # ── 7. Gross PAYE ────────────────────────────────────────────────────
        bands, gross_paye = calc_paye_bands(taxable, nonresident)
        res.paye_bands = bands
        res.gross_paye = gross_paye
        notes.append(f"Gross PAYE: {gross_paye:.2f}")

        # ── 8. Reliefs ───────────────────────────────────────────────────────
        rr = apply_reliefs(
            gross_paye          = gross_paye,
            nonresident         = nonresident,
            insurance_raw       = inp.insurance_relief,
            mortgage_raw        = inp.mortgage_relief,
            ahl_employee        = ahl_emp,
            post_retirement_raw = inp.post_retirement_relief,
        )
        res.personal_relief        = rr["personal_relief"]
        res.insurance_relief       = rr["insurance_relief"]
        res.mortgage_relief        = rr["mortgage_relief"]       # capped at 30k
        res.ahl_relief             = rr["ahl_relief"]
        res.post_retirement_relief = rr["post_retirement_relief"] # capped at 15k
        res.total_relief           = rr["total_relief"]
        res.paye                   = rr["paye"]
        notes.append(
            f"Relief: {res.total_relief:.2f} "
            f"(personal={res.personal_relief:.2f}, "
            f"mortgage={res.mortgage_relief:.2f}[cap {MORTGAGE_RELIEF_CAP:,.0f}], "
            f"post-ret={res.post_retirement_relief:.2f}[cap {POST_RETIREMENT_CAP:,.0f}]) "
            f"→ Net PAYE={res.paye:.2f}"
        )

        # ── 9. Other deductions ──────────────────────────────────────────────
        res.helb_deduction   = round(inp.helb_deduction, 2)
        res.other_deductions = round(inp.other_deductions, 2)

        # ── 10. Net Pay ──────────────────────────────────────────────────────
        total_statutory  = round(nssf.employee + shif + ahl_emp + res.paye, 2)
        total_deductions = round(
            total_statutory + pension_deduct + inp.helb_deduction + inp.other_deductions, 2
        )
        net_pay = round(gross - total_deductions, 2)

        res.total_statutory  = total_statutory
        res.total_deductions = total_deductions
        res.net_pay          = net_pay

        if gross > 0:
            res.effective_paye_rate  = round(res.paye / gross * 100, 4)
            res.effective_total_rate = round(total_statutory / gross * 100, 4)

        notes.append(f"Net Pay: {net_pay:,.2f} (eff PAYE rate {res.effective_paye_rate:.2f}%)")
        return res


# ─── RESULT → DICT (for DB storage) ──────────────────────────────────────────

def result_to_transaction(result: PayrollResult,
                           payroll_run_id: int) -> dict:
    """Convert a PayrollResult to a payroll_transactions row dict."""
    return dict(
        payroll_run_id         = payroll_run_id,
        employee_id            = result.employee_id,
        gross_salary           = result.gross_salary,
        base_salary            = result.base_salary,
        taxable_allowances     = result.taxable_allowances,
        non_taxable_allowances = result.non_taxable_allowances,
        benefits_in_kind       = result.benefits_in_kind,
        nssf_tier1_employee    = result.nssf_tier1_employee,
        nssf_tier2_employee    = result.nssf_tier2_employee,
        nssf_employee          = result.nssf_employee,
        shif                   = result.shif,
        housing_levy_employee  = result.housing_levy_employee,
        nssf_tier1_employer    = result.nssf_tier1_employer,
        nssf_tier2_employer    = result.nssf_tier2_employer,
        nssf_employer          = result.nssf_employer,
        housing_levy_employer  = result.housing_levy_employer,
        pre_tax_deductions     = result.pre_tax_deductions,
        disability_exemption   = result.disability_exemption,
        taxable_income         = result.taxable_income,
        gross_paye             = result.gross_paye,
        personal_relief        = result.personal_relief,
        insurance_relief       = result.insurance_relief,
        mortgage_relief        = result.mortgage_relief,
        ahl_relief             = result.ahl_relief,
        post_retirement_relief = result.post_retirement_relief,
        total_relief           = result.total_relief,
        paye                   = result.paye,
        helb_deduction         = result.helb_deduction,
        other_deductions       = result.other_deductions,
        total_statutory        = result.total_statutory,
        total_deductions       = result.total_deductions,
        net_pay                = result.net_pay,
    )
