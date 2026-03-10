import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

// ─── STATUTORY CALCULATIONS — Kenya 2025/2026 ────────────────────────────────
function calcNSSF(g) {
  const LEL = 9000, UEL = 108000, MAX_EE = 6480;
  return Math.min((Math.min(g, LEL) + Math.max(0, Math.min(g, UEL) - LEL)) * 0.06, MAX_EE);
}
function calcSHIF(g) { return g * 0.0275; }
function calcAHL(g) { return g * 0.015; }

// WHT rates per Income Tax Act — Section 35
const WHT_RATES = {
  "professional": { resident: 0.05, nonresident: 0.20, label: "Professional / Consultancy" },
  "management": { resident: 0.05, nonresident: 0.20, label: "Management / Technical Fees" },
  "contractual": { resident: 0.03, nonresident: 0.20, label: "Contractual Fee (≥KES 24K/mo)" },
  "commission": { resident: 0.10, nonresident: 0.20, label: "Commission / Agency" },
  "other": { resident: 0.05, nonresident: 0.20, label: "Other Payment" },
};

function calcWHT(gross, whtType = "professional", residency = "resident") {
  const rates = WHT_RATES[whtType] || WHT_RATES.professional;
  const rate = residency === "nonresident" ? rates.nonresident : rates.resident;
  return { wht: gross * rate, whtRate: rate, whtType };
}

function isContractor(e) { return e.employmentType === "contractor"; }

const PAYE_BANDS = [
  { limit: 24000, rate: 0.10 },
  { limit: 32333, rate: 0.25 },
  { limit: 500000, rate: 0.30 },
  { limit: 800000, rate: 0.325 },
  { limit: Infinity, rate: 0.35 },
];

function calcPAYEBands(ti) {
  const PR = 2400; let gross = 0, prev = 0; const bands = [];
  for (const b of PAYE_BANDS) {
    if (ti <= prev) break;
    const taxable = Math.min(ti, b.limit) - prev, tax = taxable * b.rate;
    gross += tax; bands.push({ taxable, rate: b.rate, tax }); prev = b.limit;
  }
  return { grossPAYE: gross, bands, personalRelief: PR, netPAYE: Math.max(0, gross - PR) };
}

function calcAll(g, adj = {}, emp = null) {
  // --- Contractor / WHT path ---
  if (emp && isContractor(emp)) {
    const whtInfo = calcWHT(g, emp.whtType || "professional", emp.residency || "resident");
    const helb = adj.helbDeduction || 0, other = adj.otherDeductions || 0;
    const totalDeductions = whtInfo.wht + helb + other;
    return {
      nssf: 0, shif: 0, ahl: 0, bik: 0, disabilityExempt: 0, pensionDed: 0,
      taxableIncome: g, grossPAYE: 0, payeBands: [], personalRelief: 0,
      insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0,
      totalRelief: 0, paye: 0, helb, other,
      totalStatutory: whtInfo.wht, totalDeductions, net: g - totalDeductions,
      total: whtInfo.wht, nita: 0,
      wht: whtInfo.wht, whtRate: whtInfo.whtRate, whtType: whtInfo.whtType,
      isContractor: true, customDeductions: adj.customDeductions || []
    };
  }

  // --- Standard employee path ---
  const nssf = calcNSSF(g), shif = calcSHIF(g), ahl = calcAHL(g);
  const bik = (adj.carBenefit || 0) + (adj.clubFees || 0) + (adj.loanFringe || 0);
  const disabilityExempt = Math.min(adj.disabilityExempt || 0, 150000);
  const pensionDed = Math.min(adj.pensionPreTax || 0, 30000);
  const taxableIncome = Math.max(0, g - nssf - shif - ahl - pensionDed + bik - disabilityExempt);
  const { grossPAYE, bands, personalRelief, netPAYE: basePAYE } = calcPAYEBands(taxableIncome);
  const insuranceRelief = Math.min(adj.insuranceRelief || 0, 5000);
  const mortgageRelief = Math.min(adj.mortgageRelief || 0, 30000);
  const postRetirementRelief = Math.min(adj.postRetirementRelief || 0, 15000);
  const totalRelief = personalRelief + insuranceRelief + mortgageRelief + postRetirementRelief;
  const paye = Math.max(0, grossPAYE - totalRelief);
  const helb = adj.helbDeduction || 0, other = adj.otherDeductions || 0;
  const totalStatutory = nssf + shif + ahl + paye;
  const totalDeductions = totalStatutory + pensionDed + helb + other;
  const net = g - totalDeductions;
  const nita = 50;
  return {
    nssf, shif, ahl, bik, disabilityExempt, pensionDed, taxableIncome,
    grossPAYE, payeBands: bands, personalRelief, insuranceRelief, mortgageRelief,
    postRetirementRelief, totalRelief, paye, helb, other,
    totalStatutory, totalDeductions, net, total: totalStatutory, nita,
    wht: 0, whtRate: 0, whtType: null, isContractor: false,
    customDeductions: adj.customDeductions || []
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtN = n => Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = n => "KES " + fmtN(n);

function getGross(e) {
  const comp = (e.basicSalary || 0) + (e.housingAllowance || 0) + (e.transportAllowance || 0) + (e.otherAllowances || 0);
  return comp > 0 ? comp : (e.gross || 0);
}
function getAdj(e) {
  const cd = e.customDeductions || [];
  const cdTotal = cd.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    carBenefit: e.carBenefit || 0, clubFees: e.clubFees || 0, loanFringe: e.loanFringe || 0,
    insuranceRelief: e.insuranceRelief || 0, mortgageRelief: e.mortgageRelief || 0,
    postRetirementRelief: e.postRetirementRelief || 0, disabilityExempt: e.disabilityExempt || 0,
    pensionPreTax: e.pensionPreTax || 0, helbDeduction: e.helbDeduction || 0,
    otherDeductions: (e.saccoDeduction || 0) + (e.salaryAdvance || 0) + (e.otherDeductions || 0) + cdTotal,
    customDeductions: cd,
  };
}
function getTitle(e) { return e.jobTitle || e.role || ""; }

function canWrite(account) {
  if (!account) return false;
  if (account.isEmployee || account.viewMode === "employee") return false;
  if (account.permissions && account.permissions.canWrite !== undefined) return account.permissions.canWrite;
  const role = account.role?.toLowerCase();
  if (role === "owner" || role === "admin") return true;
  if (role === "accountant" || role === "finance" || role === "hr") return true;
  return false;
}

function isHR(account) {
  if (!account) return false;
  return ["owner", "hr"].includes(account.role?.toLowerCase());
}

function getDaysLeft() {
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), 9);
  if (now.getDate() >= 9) d = new Date(now.getFullYear(), now.getMonth() + 1, 9);
  return { days: Math.ceil((d - now) / 86400000), dateStr: d.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" }) };
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#050e09", surf: "#0b1610", card: "#101f15", border: "#1a2e20", borderB: "#243d2a",
  green: "#22c55e", greenD: "#16a34a", greenG: "rgba(34,197,94,0.12)",
  gold: "#f59e0b", goldG: "rgba(245,158,11,0.12)", red: "#ef4444", redG: "rgba(239,68,68,0.1)",
  blue: "#38bdf8", purple: "#a78bfa", text: "#dff0e6", muted: "#5a7a65", dim: "#2e4a38",
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_EMPLOYEES = [
  { id: 1, name: "Amina Wanjiru", jobTitle: "Sales Manager", department: "Sales", employmentType: "permanent", residency: "resident", startDate: "2021-03-01", kraPin: "A012345678B", idNumber: "12345678", nssfNo: "NS001234", shifNo: "SH001234", basicSalary: 75000, housingAllowance: 7000, transportAllowance: 3000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 15000, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 5000, helbDeduction: 0, saccoDeduction: 3000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "KCB Bank", accountNo: "1234567890", bankBranch: "Westlands" },
  { id: 2, name: "Brian Otieno", jobTitle: "Lead Developer", department: "Tech", employmentType: "permanent", residency: "resident", startDate: "2020-07-15", kraPin: "A023456789B", idNumber: "23456789", nssfNo: "NS002345", shifNo: "SH002345", basicSalary: 120000, housingAllowance: 12000, transportAllowance: 5000, otherAllowances: 3000, carBenefit: 5000, clubFees: 0, loanFringe: 0, insuranceRelief: 2000, mortgageRelief: 25000, postRetirementRelief: 5000, disabilityExempt: 0, pensionPreTax: 10000, helbDeduction: 2500, saccoDeduction: 5000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [{ name: "Medical Insurance Topup", amount: 1500, type: "recurring" }], bankName: "Equity Bank", accountNo: "0123456789", bankBranch: "Upper Hill" },
  { id: 3, name: "Catherine Njoki", jobTitle: "Accountant", department: "Finance", employmentType: "permanent", residency: "resident", startDate: "2022-01-10", kraPin: "A034567890B", idNumber: "34567890", nssfNo: "NS003456", shifNo: "SH003456", basicSalary: 55000, housingAllowance: 7000, transportAllowance: 3000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1500, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 3000, helbDeduction: 2000, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "NCBA Bank", accountNo: "2345678901", bankBranch: "CBD" },
  { id: 4, name: "David Kamau", jobTitle: "Driver", department: "Operations", employmentType: "permanent", residency: "resident", startDate: "2019-11-05", kraPin: "A045678901B", idNumber: "45678901", nssfNo: "NS004567", shifNo: "SH004567", basicSalary: 28000, housingAllowance: 3000, transportAllowance: 1000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 1000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Co-op Bank", accountNo: "3456789012", bankBranch: "Nakuru" },
  { id: 5, name: "Esther Auma", jobTitle: "Receptionist", department: "Admin", employmentType: "permanent", residency: "resident", startDate: "2023-03-20", kraPin: "A056789012B", idNumber: "56789012", nssfNo: "NS005678", shifNo: "SH005678", basicSalary: 24000, housingAllowance: 3000, transportAllowance: 1000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 1500, saccoDeduction: 0, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Family Bank", accountNo: "4567890123", bankBranch: "Nairobi" },
  { id: 6, name: "Felix Mutua", jobTitle: "HR Officer", department: "HR", employmentType: "permanent", residency: "resident", startDate: "2021-08-01", kraPin: "A067890123B", idNumber: "67890123", nssfNo: "NS006789", shifNo: "SH006789", basicSalary: 47000, housingAllowance: 6000, transportAllowance: 2000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1000, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 2000, helbDeduction: 0, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Stanbic Bank", accountNo: "5678901234", bankBranch: "Westlands" },
  { id: 7, name: "Grace Wambui", jobTitle: "Graphic Designer", department: "Marketing", employmentType: "contract", residency: "resident", startDate: "2022-06-15", kraPin: "A078901234B", idNumber: "78901234", nssfNo: "NS007890", shifNo: "SH007890", basicSalary: 42000, housingAllowance: 4000, transportAllowance: 2000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "KCB Bank", accountNo: "6789012345", bankBranch: "Karen" },
  { id: 8, name: "Hassan Abdi", jobTitle: "Logistics Coord", department: "Operations", employmentType: "permanent", residency: "resident", startDate: "2020-02-01", kraPin: "A089012345B", idNumber: "89012345", nssfNo: "NS008901", shifNo: "SH008901", basicSalary: 33000, housingAllowance: 3500, transportAllowance: 1500, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 1500, saccoDeduction: 1000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Equity Bank", accountNo: "7890123456", bankBranch: "Mombasa" },
  { id: 9, name: "John Mutunga", jobTitle: "Senior Engineer", department: "Tech", employmentType: "permanent", residency: "resident", startDate: "2018-05-12", kraPin: "A091234567G", idNumber: "91234567", nssfNo: "NS009123", shifNo: "SH009123", basicSalary: 180000, housingAllowance: 20000, transportAllowance: 10000, otherAllowances: 5000, carBenefit: 10000, clubFees: 2000, loanFringe: 0, insuranceRelief: 3000, mortgageRelief: 35000, postRetirementRelief: 10000, disabilityExempt: 0, pensionPreTax: 20000, helbDeduction: 0, saccoDeduction: 15000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [{ name: "Laptop Loan", amount: 5000, type: "recurring" }], bankName: "Standard Chartered", accountNo: "9001234567", bankBranch: "Chiromo" },
  { id: 10, name: "Sarah Wangari", jobTitle: "Marketing Lead", department: "Marketing", employmentType: "permanent", residency: "resident", startDate: "2021-11-20", kraPin: "A102345678H", idNumber: "10234567", nssfNo: "NS010234", shifNo: "SH010234", basicSalary: 85000, housingAllowance: 10000, transportAllowance: 5000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 2500, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 8000, helbDeduction: 0, saccoDeduction: 5000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "I&M Bank", accountNo: "8002345678", bankBranch: "Valley Arcade" },
  { id: 11, name: "Peter Kiprop", jobTitle: "Warehouse Manager", department: "Logistics", employmentType: "permanent", residency: "resident", startDate: "2020-09-05", kraPin: "A112345678P", idNumber: "11234567", nssfNo: "NS011234", shifNo: "SH011234", basicSalary: 62000, housingAllowance: 7000, transportAllowance: 4000, otherAllowances: 2000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 4000, helbDeduction: 1500, saccoDeduction: 4000, salaryAdvance: 10000, otherDeductions: 0, customDeductions: [], bankName: "KCB Bank", accountNo: "7003456789", bankBranch: "Eldoret" },
  { id: 12, name: "Everlyne Syombua", jobTitle: "Customer Success", department: "Sales", employmentType: "permanent", residency: "resident", startDate: "2022-04-18", kraPin: "A122345678S", idNumber: "12234567", nssfNo: "NS012234", shifNo: "SH012234", basicSalary: 35000, housingAllowance: 4000, transportAllowance: 2000, otherAllowances: 1000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 1000, saccoDeduction: 0, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Equity Bank", accountNo: "6004567890", bankBranch: "Kitui" },
  { id: 13, name: "Michael Chege", jobTitle: "Security Supervisor", department: "Security", employmentType: "permanent", residency: "resident", startDate: "2017-02-14", kraPin: "A132345678C", idNumber: "13234567", nssfNo: "NS013234", shifNo: "SH013234", basicSalary: 31000, housingAllowance: 3000, transportAllowance: 1500, otherAllowances: 2000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Co-op Bank", accountNo: "5005678901", bankBranch: "Thika" },
  { id: 14, name: "Lucy Atieno", jobTitle: "Cook", department: "Hospitality", employmentType: "permanent", residency: "resident", startDate: "2023-01-05", kraPin: "A142345678A", idNumber: "14234567", nssfNo: "NS014234", shifNo: "SH014234", basicSalary: 22000, housingAllowance: 2500, transportAllowance: 1000, otherAllowances: 1500, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 500, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Family Bank", accountNo: "4006789012", bankBranch: "Kisumu" },
  { id: 15, name: "George Maina", jobTitle: "Project Manager", department: "Consulting", employmentType: "permanent", residency: "resident", startDate: "2019-06-30", kraPin: "A152345678M", idNumber: "15234567", nssfNo: "NS015234", shifNo: "SH015234", basicSalary: 145000, housingAllowance: 15000, transportAllowance: 8000, otherAllowances: 5000, carBenefit: 0, clubFees: 5000, loanFringe: 2000, insuranceRelief: 5000, mortgageRelief: 30000, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 15000, helbDeduction: 0, saccoDeduction: 10000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [{ name: "Company Car Maintenance", amount: 3000, type: "recurring" }], bankName: "Absa Bank", accountNo: "3007890123", bankBranch: "Nairobi West" },
  { id: 16, name: "Faith Wavinya", jobTitle: "Legal Counsel", department: "Legal", employmentType: "permanent", residency: "resident", startDate: "2021-02-01", kraPin: "A162345678L", idNumber: "16234567", nssfNo: "NS016234", shifNo: "SH016234", basicSalary: 110000, housingAllowance: 12000, transportAllowance: 6000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 2000, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 10000, helbDeduction: 0, saccoDeduction: 8000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "NCBA Bank", accountNo: "2008901234", bankBranch: "Karen" },
  { id: 17, name: "Isaac Mwangi", jobTitle: "Sales Rep", department: "Sales", employmentType: "contract", residency: "resident", startDate: "2023-05-10", kraPin: "A172345678R", idNumber: "17234567", nssfNo: "NS017234", shifNo: "SH017234", basicSalary: 25000, housingAllowance: 3000, transportAllowance: 5000, otherAllowances: 15000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 0, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "KCB Bank", accountNo: "1009012345", bankBranch: "Githurai" },
  { id: 18, name: "Brenda Kendi", jobTitle: "Data Analyst", department: "Tech", employmentType: "permanent", residency: "resident", startDate: "2022-09-01", kraPin: "A182345678D", idNumber: "18234567", nssfNo: "NS018234", shifNo: "SH018234", basicSalary: 68000, housingAllowance: 8000, transportAllowance: 4000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1500, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 5000, helbDeduction: 2500, saccoDeduction: 4000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Equity Bank", accountNo: "0010123456", bankBranch: "Kilimani" },
  { id: 19, name: "Samuel Koech", jobTitle: "Production Assistant", department: "Operations", employmentType: "permanent", residency: "resident", startDate: "2020-01-15", kraPin: "A192345678K", idNumber: "19234567", nssfNo: "NS019234", shifNo: "SH019234", basicSalary: 29000, housingAllowance: 3000, transportAllowance: 1500, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Co-op Bank", accountNo: "9101234567", bankBranch: "Kericho" },
  { id: 20, name: "Mercy Nyambura", jobTitle: "Social Media Mgr", department: "Marketing", employmentType: "permanent", residency: "resident", startDate: "2023-02-10", kraPin: "A202345678N", idNumber: "20234567", nssfNo: "NS020234", shifNo: "SH020234", basicSalary: 45000, housingAllowance: 5000, transportAllowance: 3000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1000, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 2000, helbDeduction: 0, saccoDeduction: 1000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Stanbic Bank", accountNo: "8102345678", bankBranch: "Garden City" },
  { id: 21, name: "Daniel Kipchirchir", jobTitle: "Chief Technology Officer", department: "Tech", employmentType: "permanent", residency: "resident", startDate: "2016-10-01", kraPin: "A212345678K", idNumber: "21234567", nssfNo: "NS021234", shifNo: "SH021234", basicSalary: 280000, housingAllowance: 30000, transportAllowance: 15000, otherAllowances: 10000, carBenefit: 15000, clubFees: 10000, loanFringe: 5000, insuranceRelief: 5000, mortgageRelief: 45000, postRetirementRelief: 15000, disabilityExempt: 0, pensionPreTax: 30000, helbDeduction: 0, saccoDeduction: 20000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [{ name: "Executive Health Cover", amount: 10000, type: "recurring" }], bankName: "NCBA Bank", accountNo: "7103456789", bankBranch: "Westlands" },
  { id: 22, name: "Priscilla Wanja", jobTitle: "Procurement Officer", department: "Finance", employmentType: "permanent", residency: "resident", startDate: "2018-03-01", kraPin: "A222345678W", idNumber: "22234567", nssfNo: "NS022234", shifNo: "SH022234", basicSalary: 72000, housingAllowance: 8000, transportAllowance: 4000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1500, mortgageRelief: 10000, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 5000, helbDeduction: 0, saccoDeduction: 5000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "KCB Bank", accountNo: "6104567890", bankBranch: "Industrial Area" },
  { id: 23, name: "Robert Ochieng", jobTitle: "Maintenance Tech", department: "Facilities", employmentType: "permanent", residency: "resident", startDate: "2019-08-20", kraPin: "A232345678O", idNumber: "23234567", nssfNo: "NS023234", shifNo: "SH023234", basicSalary: 34000, housingAllowance: 4000, transportAllowance: 2000, otherAllowances: 3000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 2000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Equity Bank", accountNo: "5105678901", bankBranch: "Kisumu" },
  { id: 24, name: "Nancy Gakii", jobTitle: "Office Admin", department: "Admin", employmentType: "permanent", residency: "resident", startDate: "2021-05-15", kraPin: "A242345678G", idNumber: "24234567", nssfNo: "NS024234", shifNo: "SH024234", basicSalary: 38000, housingAllowance: 4500, transportAllowance: 2500, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 2000, helbDeduction: 1500, saccoDeduction: 1000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Family Bank", accountNo: "4106789012", bankBranch: "Meru" },
  { id: 25, name: "Victor Simiyu", jobTitle: "Security Guard", department: "Security", employmentType: "casual", residency: "resident", startDate: "2023-11-01", kraPin: "A252345678S", idNumber: "25234567", nssfNo: "NS025234", shifNo: "SH025234", basicSalary: 18500, housingAllowance: 2000, transportAllowance: 1000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 0, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "M-Pesa", accountNo: "0712345678", bankBranch: "Mobile Money" },
  { id: 26, name: "Judith Mumbua", jobTitle: "Sales Executive", department: "Sales", employmentType: "permanent", residency: "resident", startDate: "2020-02-14", kraPin: "A262345678M", idNumber: "26234567", nssfNo: "NS026234", shifNo: "SH026234", basicSalary: 42000, housingAllowance: 5000, transportAllowance: 3000, otherAllowances: 25000, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 1500, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 3000, helbDeduction: 0, saccoDeduction: 3000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Stanbic Bank", accountNo: "3107890123", bankBranch: "Machakos" },
  { id: 27, name: "Andrew Mwita", jobTitle: "Field Technician", department: "Tech", employmentType: "contract", residency: "resident", startDate: "2022-07-01", kraPin: "A272345678A", idNumber: "27234567", nssfNo: "NS027234", shifNo: "SH027234", basicSalary: 30000, housingAllowance: 4000, transportAllowance: 8000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, pensionPreTax: 0, helbDeduction: 0, saccoDeduction: 1000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Equity Bank", accountNo: "2108901234", bankBranch: "Kurio" },
  { id: 28, name: "Rosemary Wanguba", jobTitle: "HR Manager", department: "HR", employmentType: "permanent", residency: "resident", startDate: "2015-09-01", kraPin: "A282345678R", idNumber: "28234567", nssfNo: "NS028234", shifNo: "SH028234", basicSalary: 115000, housingAllowance: 15000, transportAllowance: 8000, otherAllowances: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, insuranceRelief: 3000, mortgageRelief: 20000, postRetirementRelief: 5000, disabilityExempt: 0, pensionPreTax: 12000, helbDeduction: 0, saccoDeduction: 10000, salaryAdvance: 0, otherDeductions: 0, customDeductions: [], bankName: "Absa Bank", accountNo: "1109012345", bankBranch: "Nairobi Central" },
];

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
function buildMonthly(emps) {
  return MONTHS.map((m, i) => {
    const f = 0.92 + Math.sin(i * 0.7) * 0.06 + i * 0.003;
    const t = emps.reduce((a, e) => {
      const g = Math.round(getGross(e) * f), d = calcAll(g, getAdj(e), e);
      return { paye: a.paye + d.paye, nssf: a.nssf + d.nssf, shif: a.shif + d.shif, ahl: a.ahl + d.ahl, wht: a.wht + (d.wht || 0) };
    }, { paye: 0, nssf: 0, shif: 0, ahl: 0, wht: 0 });
    return { month: m, ...t };
  });
}

const INIT_FILINGS = {
  "Jul-24": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Aug-24": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Sep-24": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Oct-24": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Nov-24": { paye: "filed", nssf: "filed", shif: "late", ahl: "filed", wht: "filed" },
  "Dec-24": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Jan-25": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Feb-25": { paye: "filed", nssf: "filed", shif: "filed", ahl: "filed", wht: "filed" },
  "Mar-25": { paye: "pending", nssf: "pending", shif: "pending", ahl: "pending", wht: "pending" },
};

const INIT_SETTINGS = {
  company: "Savanna Tech Ltd", pin: "P051234567A", nssf: "NB/001234",
  sha: "SHA/ET/001234", paybill: "222222", email: "finance@savannatech.co.ke",
  rem7: true, rem3: true, rem0: true, email_rem: false, year: "2024/25",
};

const API_BASE = "http://localhost:8000/api";

const EMPTY_EMP = {
  name: "", jobTitle: "", department: "", employmentType: "permanent", startDate: "", residency: "resident",
  kraPin: "", idNumber: "", nssfNo: "", shifNo: "", whtType: "professional",
  basicSalary: "", housingAllowance: "", transportAllowance: "", otherAllowances: "",
  carBenefit: "", clubFees: "", loanFringe: "",
  insuranceRelief: "", mortgageRelief: "", postRetirementRelief: "", disabilityExempt: "",
  pensionPreTax: "", helbDeduction: "", saccoDeduction: "", salaryAdvance: "", otherDeductions: "", customDeductions: [],
  bankName: "", accountNo: "", bankBranch: "",
};

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
async function storageGet(key, fallback = null) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : fallback; }
  catch { return fallback; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch { }
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
const SecTitle = ({ children, style }) => (
  <div style={{ color: C.text, fontSize: 15, fontWeight: 700, fontFamily: "'Fraunces',serif", letterSpacing: "-0.01em", marginBottom: 16, ...style }}>{children}</div>
);
const StatusBadge = ({ s }) => {
  const map = { filed: { bg: "#dcfce7", tc: "#166534", label: "✓ Filed" }, late: { bg: "#fef9c3", tc: "#854d0e", label: "⚠ Late" }, pending: { bg: "#fee2e2", tc: "#991b1b", label: "○ Pending" } };
  const { bg, tc, label } = map[s] || map.pending;
  return <span style={{ background: bg + "22", color: tc, border: `1px solid ${tc}44`, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{label}</span>;
};
function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.borderB}`, borderRadius: 18, width: "100%", maxWidth: wide ? 860 : 680, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ color: C.text, fontWeight: 700, fontFamily: "'Fraunces',serif", fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 24, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}
function Toast({ msg, ok }) {
  return (
    <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 2000, background: ok ? C.greenD : C.red, color: "#fff", padding: "12px 22px", borderRadius: 12, fontWeight: 600, fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 8 }}>
      {ok ? "✓" : "✕"} {msg}
    </div>
  );
}

function LandingPage({ onEnterAuth, onEnterCalc }) {
  const [hovered, setHovered] = useState(null);

  // Feature Card Component
  const Feature = ({ title, desc, icon, img, delay = 0 }) => (
    <div
      onMouseEnter={() => setHovered(title)}
      onMouseLeave={() => setHovered(null)}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        padding: 40,
        borderRadius: 24,
        textAlign: "left",
        transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        transform: hovered === title ? "translateY(-10px)" : "translateY(0)",
        boxShadow: hovered === title ? `0 20px 40px rgba(0,0,0,0.3)` : "none",
        position: "relative",
        overflow: "hidden"
      }}>
      {img ? (
        <div style={{ width: "100%", height: 180, marginBottom: 24, borderRadius: 16, overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={img} alt={title} style={{ maxWidth: "90%", maxHeight: "90%", objectFit: "contain", opacity: 0.9 }} />
        </div>
      ) : (
        <div style={{ fontSize: 40, marginBottom: 24 }}>{icon}</div>
      )}
      <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14, color: "#fff" }}>{title}</h3>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.7 }}>{desc}</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Sora',sans-serif", overflowX: "hidden" }}>
      <style>{`
        @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-20px); } 100% { transform: translateY(0px); } }
        @keyframes pulse { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }
      `}</style>

      {/* Navbar */}
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "32px 60px", maxWidth: 1400, margin: "0 auto", position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, background: "#fff", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
            <img src="/logo.png" style={{ width: "80%", height: "80%", objectFit: "contain" }} />
          </div>
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>Malipo</span>
        </div>
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          <button onClick={onEnterAuth} style={{ background: "transparent", color: C.text, border: "none", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>Login</button>
          <button onClick={onEnterAuth} style={{ background: C.green, color: "#000", border: "none", padding: "10px 24px", borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: `0 8px 20px ${C.green}44` }}>Get Started</button>
        </div>
      </nav>

      {/* Hero Section */}
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, padding: "60px 60px 120px", alignItems: "center", minHeight: "80vh" }}>
        <div style={{ zIndex: 2 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.greenG, padding: "6px 16px", borderRadius: 100, color: C.green, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 24, border: `1px solid ${C.green}33` }}>
            <span style={{ animation: "pulse 2s infinite" }}>●</span> 2025/26 COMPLIANCE READY
          </div>
          <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: "clamp(3rem, 5vw, 5rem)", fontWeight: 800, lineHeight: 1.05, marginBottom: 28, letterSpacing: "-0.03em" }}>
            The Smartest Way to <br />
            <span style={{ background: `linear-gradient(135deg,${C.green},${C.blue},#fff)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Pay Your Team.</span>
          </h1>
          <p style={{ color: C.muted, fontSize: 19, lineHeight: 1.6, marginBottom: 48, maxWidth: 550 }}>
            Automate PAYE, NSSF, SHIF, and Housing Levy with Kenya's most advanced payroll platform. Built for security, designed for speed.
          </p>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <button onClick={onEnterAuth} style={{ background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: "20px 44px", borderRadius: 16, fontWeight: 800, fontSize: 18, cursor: "pointer", boxShadow: `0 12px 32px ${C.green}44`, transition: "transform 0.2s" }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>Try Company Portal →</button>
            <button onClick={onEnterCalc} style={{ background: C.surf, color: "#fff", border: `1px solid ${C.borderB}`, padding: "20px 44px", borderRadius: 16, fontWeight: 700, fontSize: 18, cursor: "pointer" }}>Free Statutory Calculator</button>
          </div>
          <div style={{ marginTop: 40, display: "flex", gap: 24, alignItems: "center", opacity: 0.6 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>TRUSTED BY COMPANIES ACROSS KENYA</div>
            <div style={{ display: "flex", gap: 12, fontSize: 14, fontWeight: 800 }}>🇰🇪 🏢 🏥 🏫</div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 600, height: 600, background: `radial-gradient(circle, ${C.green}11 0%, transparent 70%)`, filter: "blur(60px)", zIndex: 0 }} />
          <div style={{ animation: "float 6s ease-in-out infinite", position: "relative", zIndex: 1 }}>
            <img src="/hero.png" alt="Malipo Dashboard" style={{ width: "115%", borderRadius: 32, boxShadow: "0 40px 100px rgba(0,0,0,0.6)", border: `1px solid ${C.borderB}` }} />
          </div>
        </div>
      </div>

      {/* Feature Section */}
      <div style={{ background: C.surf, padding: "120px 60px" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 80 }}>
            <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 48, fontWeight: 800, marginBottom: 20 }}>Payroll, reimagined.</h2>
            <p style={{ color: C.muted, fontSize: 18, maxWidth: 600, margin: "0 auto" }}>Everything you need to stay compliant and keep your employees happy, all in one place.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            <Feature title="Kenya Tax Compliance" img="/compliance.png" desc="Automatically updated with the latest 2025 bands, SHIF 2.75% rates, and Housing Levy laws." />
            <Feature title="Deep Analytics" img="/analytics.png" desc="Visualize your payroll spending, department costs, and tax obligations with beautiful charts." />
            <Feature title="iTax-Ready Exports" img="/exports.png" desc="Generate CSV templates for PAYE and NSSF in the exact format required by Kenyan authorities." />
            <Feature title="Withholding Tax" img="/wht_tax.png" desc="Support for 3%, 5%, and 20% WHT rates with automatic certificate data generation." />
            <Feature title="Cloud Sync & Backup" img="/cloud.png" desc="Protect your data with encrypted cloud backups and access your payroll from any device." />
            <Feature title="Privacy First" img="/privacy.png" desc="Your data is yours. Local-first architecture means sensitive employee info stays on your device." />
          </div>
        </div>
      </div>

      {/* Pricing / CTA */}
      <div style={{ padding: "120px 60px", textAlign: "center" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", background: `linear-gradient(135deg, ${C.card}, ${C.bg})`, padding: 80, borderRadius: 48, border: `1px solid ${C.border}`, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -100, right: -100, width: 300, height: 300, background: C.greenG, borderRadius: "50%", filter: "blur(80px)" }} />
          <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 42, fontWeight: 800, marginBottom: 24 }}>Ready to scale your business?</h2>
          <p style={{ color: C.muted, fontSize: 18, marginBottom: 48 }}>Join hundreds of Kenyan companies simplifying their compliance today. Malipo is free for small teams.</p>
          <button onClick={onEnterAuth} style={{ background: C.green, color: "#000", border: "none", padding: "22px 56px", borderRadius: 16, fontWeight: 800, fontSize: 19, cursor: "pointer", boxShadow: `0 12px 32px ${C.green}44` }}>Get Started for Free</button>
          <div style={{ marginTop: 32, color: C.muted, fontSize: 13, fontWeight: 600 }}>NO CREDIT CARD REQUIRED · INSTANT SETUP</div>
        </div>
      </div>

      <footer style={{ padding: "80px 60px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" style={{ width: 32, height: 32 }} />
            <span style={{ fontWeight: 800, fontSize: 18, fontFamily: "'Fraunces',serif" }}>Malipo</span>
          </div>
          <div style={{ color: C.muted, fontSize: 14, fontWeight: 500 }}>© 2026 Malipo Compliance · Made for Kenya with ❤️ 🇰🇪</div>
        </div>
      </footer>
    </div>
  );
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, onBack }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "verify" | "roleChoice"
  const [form, setForm] = useState({ company: "", kraPin: "", nssfNo: "", shaNo: "", contactName: "", role: "owner", email: "", password: "", confirmPassword: "", code: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleImportCompany = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const rows = text.split("\n").filter(r => r.trim());
      if (rows.length < 2) return setErr("Invalid CSV format.");
      const headers = rows[0].split(",").map(h => h.trim());
      const data = rows[1].split(",").map(d => d.trim().replace(/^"|"$/g, ""));
      const mapping = {};
      headers.forEach((h, i) => mapping[h] = data[i]);

      setForm(f => ({
        ...f,
        company: mapping.companyName || mapping.company || f.company,
        kraPin: mapping.kraPin || f.kraPin,
        nssfNo: mapping.nssfNo || f.nssfNo,
        shaNo: mapping.shifNo || mapping.shaNo || f.shaNo,
        contactName: mapping.contactName || f.contactName,
        email: mapping.contactEmail || mapping.email || f.email,
        password: mapping.adminPin || mapping.password || f.password,
        confirmPassword: mapping.adminPin || mapping.password || f.confirmPassword
      }));
      setErr("");
    };
    reader.readAsText(file);
  };

  const handleRegister = async () => {
    if (!form.company || !form.email || !form.password) return setErr("Company name, email and password are required.");
    if (form.password !== form.confirmPassword) return setErr("Passwords do not match.");
    if (form.password.length < 6) return setErr("Password must be at least 6 characters.");

    setLoading(true);
    setErr("");

    // Simulate slight delay for "premium" feel
    setTimeout(async () => {
      try {
        const account = {
          companyName: form.company,
          kraPin: form.kraPin, nssfNo: form.nssfNo,
          shaNo: form.shaNo, contactName: form.contactName,
          role: form.role, email: form.email.toLowerCase(),
          password: form.password, isVerified: true,
          permissions: { canWrite: true, canExport: true, isAdmin: true }
        };
        await storageSet("malipo:account", account);
        await storageSet("malipo:settings", {
          company: form.company,
          pin: form.kraPin,
          nssf: form.nssfNo,
          sha: form.shaNo,
          paybill: "222222",
          email: form.email,
          rem7: true, rem3: true, rem0: true,
          email_rem: false, year: "2024/25"
        });

        setLoading(false);
        onAuth(account, true);
      } catch (e) {
        setLoading(false);
        setErr("Storage error: " + e.message);
      }
    }, 800);
  };

  const handleVerify = async () => {
    if (!form.code) return setErr("Please enter the verification code.");

    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verificationPending.email, code: form.code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Verification failed");

      const account = {
        companyName: verificationPending.company,
        kraPin: verificationPending.kraPin, nssfNo: verificationPending.nssfNo,
        shaNo: verificationPending.shaNo, contactName: verificationPending.contactName,
        role: verificationPending.role, email: verificationPending.email.toLowerCase(),
        password: verificationPending.password, isVerified: true,
        permissions: { canWrite: true, canExport: true, isAdmin: true }
      };
      await storageSet("malipo:account", account);
      await storageSet("malipo:settings", { company: verificationPending.company, pin: verificationPending.kraPin, nssf: verificationPending.nssfNo, sha: verificationPending.shaNo, paybill: "222222", email: verificationPending.email, rem7: true, rem3: true, rem0: true, email_rem: false, year: "2024/25" });
      setLoading(false);
      onAuth(account, true);
    } catch (e) {
      setLoading(false);
      setErr(e.message);
    }
  };

  const handleLogin = async () => {
    if (!form.email || !form.password) return setErr("Email and password are required.");
    setLoading(true);
    const mainAcct = await storageGet("malipo:account");
    const staff = await storageGet("malipo:staffUsers", []);
    setLoading(false);

    let user = null;
    if (mainAcct && mainAcct.email === form.email.toLowerCase() && mainAcct.password === form.password) {
      user = mainAcct;
    } else {
      user = staff.find(u => u.email === form.email.toLowerCase() && u.password === form.password);
    }

    if (!user) return setErr("Invalid email or password.");

    // Check if the user has write capabilities to offer role choice
    if (canWrite(user)) {
      setVerificationPending(user);
      setMode("roleChoice");
    } else {
      onAuth(user, false);
    }
  };

  const selectRole = (v) => {
    const u = { ...verificationPending, viewMode: v };
    onAuth(u, false);
  };

  const handleEmployeeLogin = async () => {
    if (!form.kraPin || !form.nssfNo) return setErr("ID Number and KRA PIN are required.");
    setLoading(true);
    const emps = await storageGet("malipo:employees");
    setLoading(false);
    if (!emps || emps.length === 0) return setErr("No employees found. Contact HR.");
    const emp = emps.find(e => e.idNumber === form.kraPin && e.kraPin === form.nssfNo);
    if (!emp) return setErr("Invalid ID Number or KRA PIN.");
    const settings = await storageGet("malipo:settings") || {};
    onAuth({ isEmployee: true, employeeData: emp, settings }, false);
  };

  const inp = (label, key, type = "text", placeholder = "") => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ color: C.muted, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{label}</label>
      <input type={type} placeholder={placeholder} value={form[key]} onChange={e => set(key, e.target.value)}
        style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 10, padding: "11px 14px", color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
        onFocus={e => e.target.style.borderColor = C.greenD} onBlur={e => e.target.style.borderColor = C.borderB} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sora','DM Sans',system-ui,sans-serif", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,700;9..144,800&display=swap');*{box-sizing:border-box}`}</style>
      <div style={{ width: "100%", maxWidth: 500 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, background: "#fff", borderRadius: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: `0 8px 32px rgba(0,0,0,0.1)`, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 14 }}>
            <img src="/logo.png" alt="Malipo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ color: C.text, fontSize: 32, fontWeight: 800, fontFamily: "'Fraunces',serif", lineHeight: 1 }}>Malipo</div>
          <div style={{ color: C.muted, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>Kenya Payroll & Compliance Suite</div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.borderB}`, borderRadius: 18, padding: 32, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", background: C.surf, borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[["login", "Sign In"], ["register", "Create Account"], ["employee", "Employee Portal"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", background: mode === m ? C.greenD : "transparent", color: mode === m ? "#000" : C.muted, fontWeight: mode === m ? 700 : 500, fontSize: 13, cursor: "pointer", transition: "all 0.2s" }}>{l}</button>
            ))}
          </div>

          {mode === "login" ? (
            <div>
              {inp("Email Address", "email", "email", "you@company.co.ke")}
              {inp("Password", "password", "password", "Enter your password")}
              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 14, padding: "9px 12px", background: C.redG, borderRadius: 8, border: `1px solid ${C.red}33` }}>{err}</div>}
              <button onClick={handleLogin} disabled={loading} style={{ width: "100%", background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: 14, borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginTop: 4 }}>
                {loading ? "Signing in…" : "Sign In"}
              </button>
              <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 12 }}>
                No account? <span onClick={() => setMode("register")} style={{ color: C.green, cursor: "pointer", fontWeight: 600 }}>Register your company</span>
              </div>
            </div>
          ) : mode === "employee" ? (
            <div>
              <div style={{ color: C.muted, fontSize: 12, marginBottom: 16, textAlign: "center" }}>Access your payslips and verify statutory deductions.</div>
              {inp("National ID Number", "kraPin", "text", "e.g. 12345678")}
              {inp("KRA PIN (Password)", "nssfNo", "password", "e.g. A012345678Z")}
              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 14, padding: "9px 12px", background: C.redG, borderRadius: 8, border: `1px solid ${C.red}33` }}>{err}</div>}
              <button onClick={handleEmployeeLogin} disabled={loading} style={{ width: "100%", background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: 14, borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginTop: 4 }}>
                {loading ? "Signing in…" : "Access My Portal"}
              </button>
            </div>
          ) : mode === "roleChoice" ? (
            <div>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎭</div>
                <h3 style={{ fontFamily: "'Fraunces',serif", fontSize: 20, marginBottom: 8 }}>Select Your Persona</h3>
                <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>You have administrative privileges. How would you like to enter the portal today?</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button onClick={() => selectRole("admin")} style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", background: C.surf, border: `1px solid ${C.green}44`, padding: 18, borderRadius: 14, cursor: "pointer", textAlign: "left", transition: "transform 0.2s" }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                  <div style={{ fontSize: 28 }}>🛠️</div>
                  <div>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Enter as Administrator</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>Full access to payroll, settings, and team management.</div>
                  </div>
                </button>
                <button onClick={() => selectRole("employee")} style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", background: C.surf, border: `1px solid ${C.border}`, padding: 18, borderRadius: 14, cursor: "pointer", textAlign: "left", transition: "transform 0.2s" }} onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"} onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                  <div style={{ fontSize: 28 }}>👤</div>
                  <div>
                    <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Enter as Employee</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>Only view my personal payslips and private profile.</div>
                  </div>
                </button>
              </div>
              <button onClick={() => setMode("login")} style={{ width: "100%", background: "none", color: C.muted, border: "none", marginTop: 24, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>← Back to login</button>
            </div>
          ) : mode === "verify" ? (
            <div>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🛡️</div>
                <h3 style={{ fontFamily: "'Fraunces',serif", fontSize: 20, marginBottom: 8 }}>Verify Your Identity</h3>
                <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>We've sent a 4-digit code to <strong>{form.email || "your email"}</strong>. Enter it below to verify your administrator account.</p>
              </div>
              {inp("Verification Code", "code", "text", "0000")}
              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 14, padding: "9px 12px", background: C.redG, borderRadius: 8, border: `1px solid ${C.red}33` }}>{err}</div>}
              <button onClick={handleVerify} disabled={loading} style={{ width: "100%", background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: 14, borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginTop: 4 }}>
                {loading ? "Verifying..." : "Verify & Launch Portal"}
              </button>
              <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 12 }}>
                Didn't receive it? <span onClick={() => { setErr("Code resent to " + form.email); setTimeout(() => setErr(""), 2000); }} style={{ color: C.green, cursor: "pointer", fontWeight: 600 }}>Resend code</span>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ background: `linear-gradient(135deg, ${C.surf}, ${C.bg})`, border: `1px dashed ${C.green}55`, borderRadius: 14, padding: 18, marginBottom: 24, textAlign: "center", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -10, right: -10, fontSize: 40, opacity: 0.05 }}>📁</div>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Fast-Track Setup? ✨</div>
                <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Import your company profile CSV to auto-fill these fields.</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `linear-gradient(135deg, ${C.green}, ${C.greenD})`, color: "#000", padding: "10px 20px", borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: "pointer", boxShadow: `0 4px 12px ${C.green}33` }}>
                  <span>📁 Select Profile CSV</span>
                  <input type="file" accept=".csv" onChange={handleImportCompany} style={{ display: "none" }} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <div style={{ gridColumn: "1/-1" }}>{inp("Company / Business Name *", "company", "text", "Savanna Tech Ltd")}</div>
                {inp("KRA PIN", "kraPin", "text", "P051234567A")}
                {inp("NSSF Employer No.", "nssfNo", "text", "NB/001234")}
                {inp("SHA Employer No.", "shaNo", "text", "SHA/ET/001234")}
                <div>
                  <label style={{ color: C.muted, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Your Role</label>
                  <select value={form.role} onChange={e => set("role", e.target.value)}
                    style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 10, padding: "11px 14px", color: C.text, fontSize: 14, outline: "none", marginBottom: 16 }}>
                    <option value="accountant">Accountant</option>
                    <option value="hr">HR Manager</option>
                    <option value="owner">Business Owner</option>
                    <option value="finance">Finance Director</option>
                  </select>
                </div>
                {inp("Contact Name", "contactName", "text", "Jane Mwangi")}
                <div style={{ gridColumn: "1/-1" }}>{inp("Email Address *", "email", "email", "jane@savannatech.co.ke")}</div>
                {inp("Password *", "password", "password", "Min 6 characters")}
                {inp("Confirm Password *", "confirmPassword", "password", "Re-enter password")}
              </div>
              {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 14, padding: "9px 12px", background: C.redG, borderRadius: 8, border: `1px solid ${C.red}33` }}>{err}</div>}
              <button onClick={handleRegister} disabled={loading} style={{ width: "100%", background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: 14, borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginTop: 4 }}>
                {loading ? "Creating Account…" : "Create Account & Continue"}
              </button>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={() => setMode("verify")} style={{ background: "none", border: "none", color: C.green, cursor: "pointer", fontSize: 13, padding: 8 }}>Got a code? Verify now</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 20, color: C.dim, fontSize: 11 }}>
          Data is stored locally in your browser · 2025/2026 Kenya statutory rates
        </div>
      </div>
    </div>
  );
}

// ─── EMPLOYEE MODAL (FULL FORM) ───────────────────────────────────────────────
const STEPS = ["Personal Details", "Compensation", "Benefits & Reliefs", "Deductions & Banking"];

function EmployeeModal({ emp, onSave, onClose }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState(emp ? { ...EMPTY_EMP, ...emp } : { ...EMPTY_EMP });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const num = (k, v) => set(k, v === "" ? "" : Number(v));

  const gross = (Number(f.basicSalary) || 0) + (Number(f.housingAllowance) || 0) + (Number(f.transportAllowance) || 0) + (Number(f.otherAllowances) || 0);
  const cdTotal = (f.customDeductions || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const preview = gross > 0 ? calcAll(gross, { carBenefit: Number(f.carBenefit) || 0, clubFees: Number(f.clubFees) || 0, loanFringe: Number(f.loanFringe) || 0, insuranceRelief: Number(f.insuranceRelief) || 0, mortgageRelief: Number(f.mortgageRelief) || 0, postRetirementRelief: Number(f.postRetirementRelief) || 0, disabilityExempt: Number(f.disabilityExempt) || 0, pensionPreTax: Number(f.pensionPreTax) || 0, helbDeduction: Number(f.helbDeduction) || 0, otherDeductions: (Number(f.saccoDeduction) || 0) + (Number(f.salaryAdvance) || 0) + (Number(f.otherDeductions) || 0) + cdTotal, customDeductions: f.customDeductions || [] }, f) : null;

  const handleSave = () => {
    if (!f.name) return;
    const emp2 = { ...f, id: f.id || Date.now() };
    // Convert numeric strings
    ["basicSalary", "housingAllowance", "transportAllowance", "otherAllowances", "carBenefit", "clubFees", "loanFringe", "insuranceRelief", "mortgageRelief", "postRetirementRelief", "disabilityExempt", "pensionPreTax", "helbDeduction", "saccoDeduction", "salaryAdvance", "otherDeductions"].forEach(k => { emp2[k] = Number(emp2[k]) || 0; });
    onSave(emp2);
  };

  const Field = ({ label, k, type = "text", placeholder = "", half, hint, required }) => (
    <div style={{ marginBottom: 14, gridColumn: half ? "auto" : "auto" }}>
      <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</label>
      <input type={type} placeholder={placeholder} value={f[k] || ""} onChange={e => type === "number" ? num(k, e.target.value) : set(k, e.target.value)}
        style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        onFocus={e => e.target.style.borderColor = C.greenD} onBlur={e => e.target.style.borderColor = C.borderB} />
      {hint && <div style={{ color: C.dim, fontSize: 10, marginTop: 3 }}>{hint}</div>}
    </div>
  );
  const Select = ({ label, k, opts }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{label}</label>
      <select value={f[k] || ""} onChange={e => set(k, e.target.value)}
        style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none" }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  const NumField = ({ label, k, hint, cap }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</label>
        {cap && <span style={{ color: C.dim, fontSize: 9 }}>max {fmt(cap)}</span>}
      </div>
      <input type="number" value={f[k] || ""} onChange={e => num(k, e.target.value)} placeholder="0"
        style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        onFocus={e => e.target.style.borderColor = C.greenD} onBlur={e => e.target.style.borderColor = C.borderB} />
      {hint && <div style={{ color: C.dim, fontSize: 10, marginTop: 3 }}>{hint}</div>}
    </div>
  );

  const SectionHead = ({ children, color }) => (
    <div style={{ color: color || C.green, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12, marginTop: 4, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>{children}</div>
  );

  const stepContent = [
    // STEP 0 — Personal Details
    <div key="s0">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <div style={{ gridColumn: "1/-1" }}><Field label="Full Name" k="name" required placeholder="e.g. Amina Wanjiru" /></div>
        <Field label="Job Title" k="jobTitle" placeholder="e.g. Sales Manager" />
        <Field label="Department" k="department" placeholder="e.g. Finance" />
        <Select label="Employment Type" k="employmentType" opts={[["permanent", "Permanent"], ["contract", "Contract"], ["casual", "Casual / Part-Time"], ["director", "Director"], ["contractor", "Contractor (WHT)"]]} />
        {f.employmentType === "contractor" && <Select label="WHT Category" k="whtType" opts={Object.entries(WHT_RATES).map(([k, v]) => [k, v.label])} />}
        <Select label="Tax Residency" k="residency" opts={[["resident", "Resident"], ["nonresident", "Non-Resident"]]} />
        <Field label="Start Date" k="startDate" type="date" />
        <Field label="KRA PIN" k="kraPin" placeholder="A012345678B" hint="Format: A000000000B" />
        <Field label="National ID / Passport No." k="idNumber" placeholder="12345678" />
        <Field label="NSSF Member No." k="nssfNo" placeholder="NS001234" />
        <Field label="SHIF Member No." k="shifNo" placeholder="SH001234" />
      </div>
    </div>,

    // STEP 1 — Compensation
    <div key="s1">
      <SectionHead>Monthly Earnings</SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <NumField label="Basic Salary *" k="basicSalary" hint="Core cash salary before allowances" />
        <NumField label="House / Accommodation Allowance" k="housingAllowance" hint="Taxable if exceeds 15% of basic" />
        <NumField label="Transport Allowance" k="transportAllowance" hint="Taxable; not the same as commuter benefit" />
        <NumField label="Other Allowances" k="otherAllowances" hint="Airtime, risk, leave allowances, etc." />
      </div>
      {gross > 0 && (
        <div style={{ marginTop: 8, background: C.greenG, border: `1px solid ${C.greenD}44`, borderRadius: 10, padding: 16 }}>
          <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Computed Gross Salary</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 24 }}>
              {[["Basic", f.basicSalary], ["Housing", f.housingAllowance], ["Transport", f.transportAllowance], ["Other", f.otherAllowances]].map(([l, v]) => (Number(v) || 0) > 0 ? (
                <div key={l}><div style={{ color: C.dim, fontSize: 10 }}>{l}</div><div style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{fmt(Number(v) || 0)}</div></div>
              ) : null)}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: C.muted, fontSize: 10 }}>Total Gross</div>
              <div style={{ color: C.green, fontSize: 22, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>{fmt(gross)}</div>
            </div>
          </div>
          {preview && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: "flex", gap: 20 }}>
              {[["PAYE", preview.paye, C.red], ["NSSF", preview.nssf, C.blue], ["SHIF", preview.shif, C.gold], ["AHL", preview.ahl, C.purple], ["Net Pay", preview.net, C.green]].map(([l, v, c]) => (
                <div key={l}><div style={{ color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{l}</div><div style={{ color: c, fontSize: 12, fontWeight: 700 }}>{fmt(v)}</div></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>,

    // STEP 2 — Benefits & Reliefs
    <div key="s2">
      <SectionHead color={C.gold}>Benefits-in-Kind (Taxable — Increase Gross for PAYE)</SectionHead>
      <div style={{ background: C.goldG, borderRadius: 8, padding: "8px 12px", marginBottom: 12, color: C.gold, fontSize: 11 }}>
        ⚠ These are employer-provided perks valued and added to taxable income per KRA rules.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <NumField label="Company Car Benefit" k="carBenefit" hint="Taxable value per KRA Motor Vehicle table" />
        <NumField label="Club / Recreation Fees" k="clubFees" hint="Employer-paid club membership" />
        <NumField label="Low-Interest Loan Fringe" k="loanFringe" hint="Excess of market rate vs loan interest" />
      </div>

      <SectionHead color={C.green} >Tax Reliefs (Reduce PAYE Payable)</SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <NumField label="Insurance Relief" k="insuranceRelief" cap={5000} hint="15% of premiums paid (life/education/health)" />
        <NumField label="Mortgage Interest Relief" k="mortgageRelief" cap={30000} hint="Interest on primary home loan (Finance Act 2025)" />
        <NumField label="Post-Retirement Medical Relief" k="postRetirementRelief" cap={15000} hint="15% of medical fund contributions (Finance Act 2023)" />
        <NumField label="Disability Exemption (PWD)" k="disabilityExempt" cap={150000} hint="First KES 150,000/mo exempt from PAYE" />
      </div>

      {preview && (
        <div style={{ marginTop: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Updated Tax Preview</div>
          <div style={{ display: "flex", gap: 20 }}>
            {[["Gross PAYE", preview.grossPAYE, C.red], ["Total Relief", preview.totalRelief, C.green], ["Net PAYE", preview.paye, C.gold], ["Net Pay", preview.net, C.green]].map(([l, v, c]) => (
              <div key={l}><div style={{ color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{l}</div><div style={{ color: c, fontSize: 13, fontWeight: 700 }}>{fmt(v)}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>,

    // STEP 3 — Deductions & Banking
    <div key="s3">
      <SectionHead color={C.blue}>Pre-Tax Deductions (Reduce Taxable Income)</SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <NumField label="Pension / Provident Fund" k="pensionPreTax" cap={30000} hint="Pre-PAYE; employer-registered scheme only" />
      </div>

      <SectionHead color={C.red}>Post-Tax Deductions (From Net Pay)</SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <NumField label="HELB Loan Repayment" k="helbDeduction" hint="Min KES 1,500/mo where applicable" />
        <NumField label="SACCO / Co-op Deduction" k="saccoDeduction" hint="Voluntary savings deduction" />
        <NumField label="Salary Advance Recovery" k="salaryAdvance" hint="Monthly repayment of advance taken" />
        <NumField label="Other Standard Deductions" k="otherDeductions" hint="Uniform loan, canteen, etc." />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>Custom Deductions</label>
          <button onClick={() => set("customDeductions", [...(f.customDeductions || []), { name: "", amount: "", type: "recurring" }])} style={{ background: C.surf, color: C.green, border: `1px solid ${C.greenD}55`, padding: "4px 8px", borderRadius: 6, fontSize: 10, cursor: "pointer", fontWeight: 700 }}>+ Add Custom Deduction</button>
        </div>
        {(f.customDeductions || []).map((cd, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input type="text" placeholder="Deduction Name" value={cd.name} onChange={e => { const nd = [...f.customDeductions]; nd[i].name = e.target.value; set("customDeductions", nd); }} style={{ flex: 2, background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 12, outline: "none" }} />
            <input type="number" placeholder="Amount" value={cd.amount} onChange={e => { const nd = [...f.customDeductions]; nd[i].amount = e.target.value; set("customDeductions", nd); }} style={{ flex: 1, background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 12, outline: "none" }} />
            <select value={cd.type} onChange={e => { const nd = [...f.customDeductions]; nd[i].type = e.target.value; set("customDeductions", nd); }} style={{ flex: 1.5, background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontSize: 12, outline: "none" }}>
              <option value="recurring">Recurring</option>
              <option value="one-time">One-time</option>
            </select>
            <button onClick={() => set("customDeductions", f.customDeductions.filter((_, idx) => idx !== i))} style={{ background: "transparent", color: C.red, border: "none", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
        ))}
      </div>

      {preview && (
        <div style={{ background: C.greenG, border: `1px solid ${C.greenD}44`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ color: C.muted, fontSize: 10 }}>Total Deductions</div><div style={{ color: C.red, fontSize: 16, fontWeight: 700 }}>{fmt(preview.totalDeductions)}</div></div>
            <div><div style={{ color: C.muted, fontSize: 10 }}>Final Net Pay</div><div style={{ color: C.green, fontSize: 22, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>{fmt(preview.net)}</div></div>
            <div><div style={{ color: C.muted, fontSize: 10 }}>Cost to Company</div><div style={{ color: C.gold, fontSize: 16, fontWeight: 700 }}>{fmt(gross + (preview.nssf || 0) + (preview.ahl || 0))}</div></div>
          </div>
        </div>
      )}

      <SectionHead color={C.blue}>Bank Account Details</SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <Field label="Bank Name" k="bankName" placeholder="e.g. KCB Bank Kenya" />
        <Field label="Account Number" k="accountNo" placeholder="1234567890" />
        <div style={{ gridColumn: "1/-1" }}><Field label="Branch" k="bankBranch" placeholder="e.g. Westlands, Nairobi" /></div>
      </div>
    </div>
  ];

  return (
    <Modal title={emp ? `Edit — ${emp.name}` : "Add New Employee"} onClose={onClose} wide>
      {/* Stepper */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, background: C.surf, borderRadius: 10, padding: 4 }}>
        {STEPS.map((s, i) => (
          <button key={i} onClick={() => setStep(i)} style={{ flex: 1, padding: "9px 6px", borderRadius: 8, border: "none", background: step === i ? C.greenD : "transparent", color: step === i ? "#000" : i < step ? C.green : C.muted, fontWeight: step === i ? 700 : 500, fontSize: 11, cursor: "pointer", transition: "all 0.2s", textAlign: "center" }}>
            <span style={{ display: "block", fontSize: 16, marginBottom: 2 }}>{["①", "②", "③", "④"][i]}</span>{s}
          </button>
        ))}
      </div>

      {stepContent[step]}

      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <button onClick={() => step > 0 ? setStep(step - 1) : onClose()} style={{ background: C.surf, color: C.muted, border: `1px solid ${C.border}`, padding: "10px 22px", borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          {step === 0 ? "Cancel" : "← Back"}
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} style={{ background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: "10px 26px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Next →
            </button>
          ) : (
            <button onClick={handleSave} disabled={!f.name} style={{ background: f.name ? `linear-gradient(135deg,${C.green},${C.greenD})` : "#2a3a2e", color: f.name ? "#000" : C.dim, border: "none", padding: "10px 26px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: f.name ? "pointer" : "not-allowed" }}>
              ✓ Save Employee
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ employees }) {
  const dl = getDaysLeft(), uc = dl.days <= 3 ? C.red : dl.days <= 7 ? C.gold : C.green;
  const monthly = buildMonthly(employees);
  const thisMonth = employees.reduce((a, e) => {
    const g = getGross(e), d = calcAll(g, getAdj(e));
    return { paye: a.paye + d.paye, nssf: a.nssf + d.nssf, shif: a.shif + d.shif, ahl: a.ahl + d.ahl, total: a.total + d.total };
  }, { paye: 0, nssf: 0, shif: 0, ahl: 0, total: 0 });
  const totalGross = employees.reduce((s, e) => s + getGross(e), 0);
  const pieData = [{ name: "PAYE", value: thisMonth.paye, color: C.green }, { name: "NSSF", value: thisMonth.nssf, color: C.blue }, { name: "SHIF", value: thisMonth.shif, color: C.gold }, { name: "AHL", value: thisMonth.ahl, color: C.purple }];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ background: `linear-gradient(120deg,${uc}18,${uc}06)`, border: `1px solid ${uc}44`, borderRadius: 14, padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 30 }}>⏱</div>
          <div><div style={{ color: uc, fontWeight: 800, fontSize: 16 }}>{dl.days} days until filing deadline</div><div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>PAYE · NSSF · SHIF · AHL returns due by 9th — {dl.dateStr}</div></div>
        </div>
        <div style={{ background: uc + "22", border: `1px solid ${uc}55`, borderRadius: 10, padding: "10px 20px", textAlign: "center" }}>
          <div style={{ color: uc, fontSize: 28, fontWeight: 800, fontFamily: "'Fraunces',serif", lineHeight: 1 }}>{dl.days}</div>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Days Left</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {[{ label: "Total Payroll", value: fmt(totalGross), sub: `${employees.length} employees`, accent: C.green, icon: "💼" }, { label: "PAYE Due (KRA)", value: fmt(thisMonth.paye), sub: "iTax by 9th", accent: C.blue, icon: "📋" }, { label: "SHIF Due (SHA)", value: fmt(thisMonth.shif), sub: "2.75% of gross", accent: C.gold, icon: "🏥" }, { label: "Total Remittance", value: fmt(thisMonth.total), sub: "All 4 obligations", accent: C.purple, icon: "📤" }].map(sc => (
          <div key={sc.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 20px", position: "relative", overflow: "hidden", transition: "border-color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = sc.accent + "66"} onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
            <div style={{ position: "absolute", top: 0, right: 0, width: 70, height: 70, background: `radial-gradient(circle at top right,${sc.accent}22,transparent 70%)` }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><div style={{ color: C.muted, fontSize: 11, fontWeight: 500, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 8 }}>{sc.label}</div><div style={{ color: C.text, fontSize: 21, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>{sc.value}</div><div style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>{sc.sub}</div></div>
              <div style={{ fontSize: 20 }}>{sc.icon}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
          <SecTitle>9-Month Remittance Trend</SecTitle>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthly} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.green} stopOpacity={0.3} /><stop offset="95%" stopColor={C.green} stopOpacity={0} /></linearGradient>
                <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.gold} stopOpacity={0.3} /><stop offset="95%" stopColor={C.gold} stopOpacity={0} /></linearGradient>
                <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.blue} stopOpacity={0.3} /><stop offset="95%" stopColor={C.blue} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 12 }} formatter={v => [fmt(v)]} />
              <Area type="monotone" dataKey="paye" stroke={C.green} fill="url(#gP)" strokeWidth={2} name="PAYE" />
              <Area type="monotone" dataKey="shif" stroke={C.gold} fill="url(#gS)" strokeWidth={2} name="SHIF" />
              <Area type="monotone" dataKey="nssf" stroke={C.blue} fill="url(#gN)" strokeWidth={2} name="NSSF" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <SecTitle>Obligation Split</SecTitle>
          <PieChart width={160} height={160} style={{ margin: "0 auto" }}>
            <Pie data={pieData} cx={75} cy={75} outerRadius={65} innerRadius={40} dataKey="value" paddingAngle={3}>
              {pieData.map((e, i) => <Cell key={i} fill={e.color} opacity={0.9} />)}
            </Pie>
            <Tooltip contentStyle={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12 }} formatter={v => [fmt(v)]} />
          </PieChart>
          {pieData.map(p => (
            <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}33` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} /><span style={{ color: C.muted, fontSize: 12 }}>{p.name}</span></div>
              <span style={{ color: p.color, fontSize: 13, fontWeight: 700 }}>{fmt(p.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
        <SecTitle>Payroll Quick View</SecTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{["Employee", "Gross", "PAYE", "NSSF", "SHIF", "AHL", "Net Pay"].map(h => (
              <th key={h} style={{ color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", textAlign: h === "Employee" ? "left" : "right", padding: "0 12px 12px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {employees.map(e => {
              const g = getGross(e), d = calcAll(g, getAdj(e)); return (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}22`, transition: "background 0.15s" }} onMouseEnter={ev => ev.currentTarget.style.background = C.border + "55"} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "11px 12px", color: C.text, fontSize: 13, fontWeight: 600 }}>{e.name}<div style={{ color: C.muted, fontSize: 11, fontWeight: 400 }}>{getTitle(e)}</div></td>
                  {[g, d.paye, d.nssf, d.shif, d.ahl, d.net].map((v, i) => (
                    <td key={i} style={{ padding: "11px 12px", color: i === 5 ? C.green : C.text, fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr style={{ borderTop: `2px solid ${C.borderB}` }}>
            <td style={{ padding: "12px", color: C.muted, fontSize: 12, fontWeight: 700 }}>TOTALS</td>
            {(() => {
              const tots = employees.reduce((a, e) => { const g = getGross(e), d = calcAll(g, getAdj(e)); return { g: a.g + g, p: a.p + d.paye, n: a.n + d.nssf, s: a.s + d.shif, h: a.h + d.ahl, net: a.net + d.net }; }, { g: 0, p: 0, n: 0, s: 0, h: 0, net: 0 }); return [tots.g, tots.p, tots.n, tots.s, tots.h, tots.net].map((v, i) => (
                <td key={i} style={{ padding: "12px", color: i === 5 ? C.green : C.text, fontSize: 13, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</td>
              ))
            })()}
            <td />
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
function Employees({ employees, setEmployees, account }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payslip, setPayslip] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const adminMode = canWrite(account);
  const showToast = (m, ok = true) => { setToast({ m, ok }); setTimeout(() => setToast(null), 3000); };

  const filtered = employees.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) || getTitle(e).toLowerCase().includes(search.toLowerCase()) || (e.department || "").toLowerCase().includes(search.toLowerCase()));

  const handleSave = emp => {
    if (emp.id && employees.find(e => e.id === emp.id)) {
      setEmployees(employees.map(e => e.id === emp.id ? emp : e));
      showToast(`${emp.name} updated`);
    } else {
      setEmployees([...employees, emp]);
      showToast(`${emp.name} added`);
    }
    setAdding(false); setEditing(null);
  };

  const handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = window.XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = window.XLSX.utils.sheet_to_json(ws);

        const newEmps = data.map((row, idx) => ({
          id: Date.now() + idx,
          ...row,
          customDeductions: row.customDeductions ? JSON.parse(row.customDeductions) : []
        }));

        setEmployees(prev => [...prev, ...newEmps]);
        showToast(`Migrated ${newEmps.length} employees successfully!`);
      } catch (err) {
        showToast("Error parsing Excel: Ensure file matches schema", false);
        console.error(err);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; // reset for same file re-upload
  };

  const remove = id => { const e = employees.find(x => x.id === id); setEmployees(employees.filter(x => x.id !== id)); showToast(`${e?.name || "Employee"} removed`, false); };

  const totals = employees.reduce((a, e) => { const g = getGross(e), d = calcAll(g, getAdj(e)); return { g: a.g + g, p: a.p + d.paye, n: a.n + d.nssf, s: a.s + d.shif, h: a.h + d.ahl, net: a.net + d.net }; }, { g: 0, p: 0, n: 0, s: 0, h: 0, net: 0 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {toast && <Toast msg={toast.m} ok={toast.ok} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <SecTitle style={{ marginBottom: 0 }}>{employees.length} Registered Employees</SecTitle>
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="Search name, role, dept…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: "8px 14px", color: C.text, fontSize: 13, outline: "none", width: 220 }} />
          {adminMode && (
            <>
              <input type="file" id="excel-upload" hidden accept=".xlsx,.xls,.ods" onChange={handleImportExcel} />
              <button
                onClick={() => document.getElementById('excel-upload').click()}
                style={{ background: C.surf, color: C.green, border: `1px solid ${C.green}55`, padding: "9px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                ⇑ Bulk Import
              </button>
              <button onClick={() => setAdding(true)} style={{ background: C.green, color: "#000", border: "none", padding: "9px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add Employee</button>
            </>
          )}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: C.surf }}>
            <tr>{["#", "Employee", "PIN / ID", "Dept", "Gross", "PAYE", "NSSF", "Net Pay", adminMode ? "" : null].filter(x => x !== null).map(h => (
              <th key={h} style={{ color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left", padding: "14px 13px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const g = getGross(e), d = calcAll(g, getAdj(e));
              return (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}33`, cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background = C.border + "55"}
                  onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
                  onClick={() => setPayslip(e)}>
                  <td style={{ padding: "13px", color: C.dim, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ padding: "13px" }}>
                    <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                    <div style={{ color: C.muted, fontSize: 11 }}>{getTitle(e)} {e.employmentType === "contract" ? <span style={{ color: C.gold, fontSize: 10, marginLeft: 4 }}>CONTRACT</span> : e.employmentType === "casual" ? <span style={{ color: C.purple, fontSize: 10, marginLeft: 4 }}>CASUAL</span> : null}</div>
                  </td>
                  <td style={{ padding: "13px" }}><div style={{ color: C.muted, fontSize: 11, fontFamily: "monospace" }}>{e.kraPin || "—"}</div><div style={{ color: C.dim, fontSize: 10 }}>ID: {e.idNumber || "—"}</div></td>
                  <td style={{ padding: "13px", color: C.muted, fontSize: 12 }}>{e.department || "—"}</td>
                  <td style={{ padding: "13px", color: C.text, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmt(g)}</td>
                  <td style={{ padding: "13px", color: C.text, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmt(d.paye)}</td>
                  <td style={{ padding: "13px", color: C.text, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmt(d.nssf)}</td>
                  <td style={{ padding: "13px", color: C.green, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(d.net)}</td>
                  {adminMode && (
                    <td style={{ padding: "13px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={ev => { ev.stopPropagation(); setEditing(e); }} style={{ background: C.borderB, color: C.muted, border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>Edit</button>
                        <button onClick={ev => { ev.stopPropagation(); remove(e.id); }} style={{ background: C.redG, color: C.red, border: `1px solid ${C.red}33`, padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot style={{ background: C.surf }}>
            <tr>
              <td colSpan={4} style={{ padding: "13px", color: C.muted, fontSize: 12, fontWeight: 700 }}>TOTALS — {employees.length} employees</td>
              {[totals.g, totals.p, totals.n, totals.net].map((v, i) => (
                <td key={i} style={{ padding: "13px", color: i === 3 ? C.green : C.text, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</td>
              ))}
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {(adding || editing) && (
        <EmployeeModal emp={editing} onSave={handleSave} onClose={() => { setAdding(false); setEditing(null); }} />
      )}

      {payslip && (() => {
        const g = getGross(payslip), d = calcAll(g, getAdj(payslip));
        return (
          <Modal title={`Pay Slip — ${payslip.name}`} onClose={() => setPayslip(null)}>
            <div style={{ background: C.surf, borderRadius: 10, padding: 16, marginBottom: 18, display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div><div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase" }}>Employee</div><div style={{ color: C.text, fontWeight: 700, fontSize: 15 }}>{payslip.name}</div><div style={{ color: C.muted, fontSize: 12 }}>{getTitle(payslip)} · {payslip.department || ""}</div></div>
              <div><div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase" }}>KRA PIN</div><div style={{ color: C.text, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{payslip.kraPin || "N/A"}</div></div>
              <div><div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase" }}>NSSF No.</div><div style={{ color: C.text, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{payslip.nssfNo || "N/A"}</div></div>
              <div><div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase" }}>Bank</div><div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{payslip.bankName || "N/A"}</div><div style={{ color: C.muted, fontSize: 11, fontFamily: "monospace" }}>{payslip.accountNo || ""}</div></div>
            </div>
            {/* Earnings breakdown */}
            {(payslip.basicSalary || payslip.housingAllowance || payslip.transportAllowance) > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: C.muted, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Earnings</div>
                {[["Basic Salary", payslip.basicSalary || 0], ["Housing Allowance", payslip.housingAllowance || 0], ["Transport Allowance", payslip.transportAllowance || 0], ["Other Allowances", payslip.otherAllowances || 0]].filter(([, v]) => v > 0).map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}22` }}>
                    <span style={{ color: C.muted, fontSize: 14, paddingLeft: 12 }}>{l}</span><span style={{ color: C.green, fontSize: 14, fontWeight: 600 }}>{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {[["Gross Salary", g, C.text], ["Less: NSSF (Phase 4)", -d.nssf, C.blue], ["Less: SHIF (2.75%)", -d.shif, C.gold], ["Less: AHL (1.5%)", -d.ahl, C.purple]].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontSize: 15 }}>{l}</span><span style={{ color: c, fontSize: 15, fontWeight: 600 }}>{v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v)}</span>
              </div>
            ))}
            {d.pensionDed > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.muted, fontSize: 15 }}>Less: Pension (pre-tax)</span><span style={{ color: C.blue, fontSize: 15, fontWeight: 600 }}>({fmt(d.pensionDed)})</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 6px", margin: "2px -6px", background: C.borderB + "55", borderRadius: 6 }}>
              <span style={{ color: C.text, fontSize: 14, fontStyle: "italic", fontWeight: 600 }}>= Taxable Income</span><span style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>{fmt(d.taxableIncome)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.muted, fontSize: 15 }}>Less: PAYE (net of reliefs)</span><span style={{ color: C.red, fontSize: 15, fontWeight: 600 }}>({fmt(d.paye)})</span></div>
            {d.helb > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.muted, fontSize: 14, paddingLeft: 8 }}>Less: HELB</span><span style={{ color: C.red, fontSize: 14 }}>({fmt(d.helb)})</span></div>}
            {(d.customDeductions || []).map((cd, idx) => (Number(cd.amount) > 0) && <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.muted, fontSize: 14, paddingLeft: 8 }}>Less: {cd.name || "Custom Deduction"}</span><span style={{ color: C.red, fontSize: 14 }}>({fmt(Number(cd.amount))})</span></div>)}
            {(d.other - (d.customDeductions || []).reduce((acc, cd) => acc + (Number(cd.amount) || 0), 0)) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.muted, fontSize: 14, paddingLeft: 8 }}>Less: Other Standard Deductions</span><span style={{ color: C.red, fontSize: 14 }}>({fmt(d.other - (d.customDeductions || []).reduce((acc, cd) => acc + (Number(cd.amount) || 0), 0))})</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "18px 0 4px" }}>
              <span style={{ color: C.text, fontWeight: 700, fontSize: 15 }}>Net Pay</span>
              <span style={{ color: C.green, fontSize: 26, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>{fmt(d.net)}</span>
            </div>
            <div style={{ marginTop: 14, padding: 14, background: C.greenG, border: `1px solid ${C.greenD}44`, borderRadius: 10 }}>
              <div style={{ color: C.muted, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Employer Obligations</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div><div style={{ color: C.muted, fontSize: 13 }}>NSSF Employer</div><div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{fmt(d.nssf)}</div></div>
                <div><div style={{ color: C.muted, fontSize: 13 }}>AHL Employer</div><div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{fmt(d.ahl)}</div></div>
                <div><div style={{ color: C.muted, fontSize: 13 }}>NITA Training</div><div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>{fmt(d.nita)}</div></div>
                <div style={{ width: "100%", borderTop: `1px solid ${C.border}44`, paddingTop: 8, marginTop: 4 }}>
                  <div style={{ color: C.muted, fontSize: 13 }}>Total Cost to Company</div><div style={{ color: C.green, fontSize: 18, fontWeight: 700 }}>{fmt(g + d.nssf + d.ahl + d.nita)}</div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button onClick={() => setEditing(payslip)} style={{ flex: 1, background: C.surf, color: C.text, border: `1px solid ${C.border}`, padding: "10px", borderRadius: 9, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>Edit Employee</button>
              <button onClick={() => setPayslip(null)} style={{ flex: 1, background: C.greenD, color: "#000", border: "none", padding: "10px", borderRadius: 9, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Done</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── CALCULATOR ───────────────────────────────────────────────────────────────
function AdjInput({ label, sublabel, value, onChange, max, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <div><div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{label}</div>{sublabel && <div style={{ color: C.muted, fontSize: 12 }}>{sublabel}</div>}</div>
        <span style={{ color: color || C.green, fontSize: 14, fontWeight: 700 }}>{value > 0 ? fmt(value) : "—"}</span>
      </div>
      <input type="range" min={0} max={max || 50000} step={100} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: color || C.green }} />
    </div>
  );
}
function Calculator({ baseGross, fixedAdj }) {
  const [gross, setGross] = useState(baseGross || 70000);
  const [months, setMonths] = useState(1);
  const [tab, setTab] = useState("standard");
  const [adj, setAdj] = useState(fixedAdj || { insuranceRelief: 0, mortgageRelief: 0, postRetirementRelief: 0, disabilityExempt: 0, carBenefit: 0, clubFees: 0, loanFringe: 0, helbDeduction: 0, otherDeductions: 0, pensionPreTax: 0 });
  const [incomeType, setIncomeType] = useState("salary");
  const [whtCat, setWhtCat] = useState("professional");

  // If fixedAdj is provided, we merge current UI state with the fixed values
  const effectiveAdj = fixedAdj ? { ...adj, ...fixedAdj } : adj;
  const setA = (k, v) => setAdj(a => ({ ...a, [k]: v }));
  const empMock = incomeType === "contractor" ? { employmentType: "contractor", whtType: whtCat, residency: "resident" } : null;
  const d = calcAll(gross, effectiveAdj, empMock);
  const Row = ({ label, val, color, bold, indent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}33` }}>
      <span style={{ color: C.muted, fontSize: indent ? 13 : 15, paddingLeft: indent ? 14 : 0 }}>{label}</span>
      <span style={{ color: color || C.text, fontSize: indent ? 13 : 15, fontWeight: bold ? 700 : 600, fontVariantNumeric: "tabular-nums" }}>{val}</span>
    </div>
  );
  const Divider = ({ label, val }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 6px", margin: "2px -6px", background: C.borderB + "55", borderRadius: 6 }}>
      <span style={{ color: C.text, fontSize: 14, fontStyle: "italic", fontWeight: 600 }}>{label}</span>
      <span style={{ color: C.text, fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{val}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
          <div style={{ display: "flex", background: C.surf, borderRadius: 10, padding: 4, marginBottom: 18 }}>
            {[["salary", "Monthly Salary"], ["contractor", "Contractor (WHT)"]].map(([v, l]) => (
              <button key={v} onClick={() => setIncomeType(v)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: incomeType === v ? C.greenD : "transparent", color: incomeType === v ? "#000" : C.muted, fontWeight: incomeType === v ? 700 : 500, fontSize: 12, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          <SecTitle>{incomeType === "salary" ? "Gross Monthly Salary" : "Contract Amount (Gross)"}</SecTitle>
          <input type="number" value={gross} onChange={e => setGross(Number(e.target.value) || 0)}
            style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 10, padding: "14px 16px", color: C.green, fontSize: 30, fontWeight: 800, outline: "none", boxSizing: "border-box", fontFamily: "'Fraunces',serif" }} />
          {incomeType === "contractor" && (
            <div style={{ marginTop: 16 }}>
              <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>WHT Category</label>
              <select value={whtCat} onChange={e => setWhtCat(e.target.value)} style={{ width: "100%", background: C.surf, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px", color: C.text, fontSize: 13, outline: "none" }}>
                {Object.entries(WHT_RATES).map(([k, v]) => <option key={k} value={k}>{v.label} ({(v.resident * 100).toFixed(0)}%)</option>)}
              </select>
            </div>
          )}
          <input type="range" min={10000} max={500000} step={1000} value={gross} onChange={e => setGross(Number(e.target.value))} style={{ width: "100%", marginTop: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: C.dim, fontSize: 11, marginTop: 4 }}><span>KES 10,000</span><span>KES 500,000</span></div>
          <div style={{ marginTop: 16 }}>
            <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Projection Period</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[1, 3, 6, 12].map(m => (
                <button key={m} onClick={() => setMonths(m)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: `1px solid ${months === m ? C.greenD : C.border}`, background: months === m ? C.greenG : "transparent", color: months === m ? C.green : C.muted, fontWeight: months === m ? 700 : 500, fontSize: 12, cursor: "pointer" }}>{m === 12 ? "Annual" : `${m}mo`}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["standard", "Standard"], ["reliefs", "Reliefs"], ["bik", "Benefits & Deductions"]].map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${tab === t ? C.greenD : C.border}`, background: tab === t ? C.greenG : "transparent", color: tab === t ? C.green : C.muted, fontWeight: tab === t ? 600 : 400, fontSize: 12, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {tab === "standard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <AdjInput label="Pension / Provident Fund" sublabel="Pre-PAYE deduction · max KES 30,000/mo" value={adj.pensionPreTax} onChange={v => setA("pensionPreTax", v)} max={30000} color={C.blue} />
            </div>
          )}
          {tab === "reliefs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <AdjInput label="Insurance Relief" sublabel="15% of premiums · max KES 5,000/mo" value={adj.insuranceRelief} onChange={v => setA("insuranceRelief", v)} max={5000} />
              <AdjInput label="Mortgage Interest Relief" sublabel="Max KES 30,000/mo (Finance Act 2025)" value={adj.mortgageRelief} onChange={v => setA("mortgageRelief", v)} max={30000} />
              <AdjInput label="Post-Retirement Medical Relief" sublabel="Max KES 15,000/mo (Finance Act 2023)" value={adj.postRetirementRelief} onChange={v => setA("postRetirementRelief", v)} max={15000} />
              <AdjInput label="Disability Exemption (PWD)" sublabel="First KES 150,000/mo exempt" value={adj.disabilityExempt} onChange={v => setA("disabilityExempt", v)} max={150000} />
            </div>
          )}
          {tab === "bik" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ color: C.gold, fontSize: 11, padding: "8px 10px", background: C.goldG, borderRadius: 7 }}>⚠ Benefits-in-Kind increase taxable income.</div>
              <AdjInput label="Company Car Benefit" sublabel="Taxable value added to gross" value={adj.carBenefit} onChange={v => setA("carBenefit", v)} max={30000} color={C.gold} />
              <AdjInput label="Club Fees (Employer-Paid)" sublabel="Taxable benefit-in-kind" value={adj.clubFees} onChange={v => setA("clubFees", v)} max={10000} color={C.gold} />
              <AdjInput label="Low-Interest Loan Fringe" sublabel="Difference vs market rate" value={adj.loanFringe} onChange={v => setA("loanFringe", v)} max={10000} color={C.gold} />
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                <AdjInput label="HELB Deduction" sublabel="Min KES 1,500/mo" value={adj.helbDeduction} onChange={v => setA("helbDeduction", v)} max={10000} color={C.red} />
                <AdjInput label="Other Deductions" sublabel="SACCO, advance, etc." value={adj.otherDeductions} onChange={v => setA("otherDeductions", v)} max={50000} color={C.red} />
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: `linear-gradient(160deg,${C.card},#091a0f)`, border: `1px solid ${C.greenD}55`, borderRadius: 14, padding: 24 }}>
          <SecTitle>Full Pay Slip {months > 1 ? `— ${months}-Month Projection` : ""}</SecTitle>
          <Row label={d.isContractor ? "Contract Amount" : "Gross Salary"} val={fmt(gross * months)} color={C.text} bold />
          <div style={{ margin: "4px 0", paddingTop: 2 }}>
            <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{d.isContractor ? "Withholding Tax" : "Statutory Deductible"}</div>
            {d.isContractor ? (
              <Row label={`${d.whtType} WHT (${(d.whtRate * 100).toFixed(1)}%)`} val={`(${fmt(d.wht * months)})`} color={C.red} bold />
            ) : (
              <>
                <Row label="NSSF — Phase 4 (6%, max 6,480)" val={`(${fmt(d.nssf * months)})`} color={C.blue} indent />
                <Row label="SHIF — SHA (2.75%)" val={`(${fmt(d.shif * months)})`} color={C.gold} indent />
                <Row label="AHL — Housing Levy (1.5%)" val={`(${fmt(d.ahl * months)})`} color={C.purple} indent />
                {d.pensionDed > 0 && <Row label="Pension Pre-Tax" val={`(${fmt(d.pensionDed * months)})`} color={C.blue} indent />}
                {d.disabilityExempt > 0 && <Row label="Disability Exemption" val={`(${fmt(d.disabilityExempt * months)})`} color={C.green} indent />}
                {d.bik > 0 && <Row label="Benefits-in-Kind (added)" val={`+${fmt(d.bik * months)}`} color={C.gold} indent />}
              </>
            )}
          </div>
          {!d.isContractor && (
            <>
              <Divider label="= Taxable Income" val={fmt(d.taxableIncome * months)} />
              <div style={{ margin: "4px 0", paddingTop: 2 }}>
                <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, marginTop: 6 }}>PAYE Bands</div>
                {d.payeBands.map((b, i) => <Row key={i} label={`Band ${i + 1} @ ${(b.rate * 100).toFixed(1)}%`} val={fmt(b.tax * months)} color={C.muted} indent />)}
                <Row label="Gross PAYE" val={fmt(d.grossPAYE * months)} color={C.red} bold />
                <Row label="Less: Personal Relief" val={`(${fmt(d.personalRelief * months)})`} color={C.green} indent />
                {d.insuranceRelief > 0 && <Row label="Less: Insurance Relief" val={`(${fmt(d.insuranceRelief * months)})`} color={C.green} indent />}
                {d.mortgageRelief > 0 && <Row label="Less: Mortgage Relief" val={`(${fmt(d.mortgageRelief * months)})`} color={C.green} indent />}
                {d.postRetirementRelief > 0 && <Row label="Less: Post-Retirement" val={`(${fmt(d.postRetirementRelief * months)})`} color={C.green} indent />}
              </div>
              <Divider label="= PAYE Payable" val={`(${fmt(d.paye * months)})`} />
            </>
          )}
          {(d.helb > 0 || d.other > 0) && (
            <div style={{ marginTop: 4 }}>
              {d.helb > 0 && <Row label="HELB Deduction" val={`(${fmt(d.helb * months)})`} color={C.red} indent />}
              {d.other > 0 && <Row label="Other Deductions" val={`(${fmt(d.other * months)})`} color={C.red} indent />}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 0", marginTop: 6, borderTop: `2px solid ${C.borderB}` }}>
            <span style={{ color: C.text, fontWeight: 800, fontSize: 18, fontFamily: "'Fraunces',serif" }}>{d.isContractor ? "Net Payment" : "Take-Home Pay"}</span>
            <span style={{ color: C.green, fontSize: 32, fontWeight: 800, fontFamily: "'Fraunces',serif" }}>{fmt(d.net * months)}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 14, textAlign: "right", marginTop: 4 }}>{months > 1 ? `Average ${fmt(d.net)}/month` : "Net after all statutory deductions"}</div>
        </div>
        {!d.isContractor && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
            <div style={{ color: C.muted, fontSize: 13, textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }}>Effective Rates</div>
            {[
              ["Gross PAYE Rate", ((d.grossPAYE / gross) * 100).toFixed(2), C.red],
              ["Net PAYE Rate", ((d.paye / gross) * 100).toFixed(2), C.gold],
              ["Total Statutory Rate", ((d.totalStatutory / gross) * 100).toFixed(2), C.purple],
              ["Net Pay Retention", ((d.net / gross) * 100).toFixed(2), C.green]
            ].map(([l, v, c]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}33` }}>
                <span style={{ color: C.muted, fontSize: 13 }}>{l}</span>
                <span style={{ color: c, fontWeight: 700, fontSize: 15 }}>{v}%</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ background: d.isContractor ? `${C.blue}22` : C.redG, border: `1px solid ${d.isContractor ? C.blue : C.red}44`, borderRadius: 16, padding: 20 }}>
          <div style={{ color: d.isContractor ? C.blue : C.red, fontWeight: 800, fontSize: 14, marginBottom: 10 }}>{d.isContractor ? "ℹ WHT COMPLIANCE" : "⚠ 2026 ENFORCEMENT NOTICE"}</div>
          <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>
            {d.isContractor ? (
              <>WHT must be remitted by the 20th of the following month.<br />Certificates are issued via iTax upon successful payment.<br />Rates: Professional (5%), Contractual (3%).</>
            ) : (
              <>KRA auto-validates returns against eTIMS data from Jan 2026.<br />Late PAYE: 5% of tax + 1%/mo · SHIF: 2%/mo · AHL: 3%/mo.<br />Deadline: 9th of following month.</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FILINGS ──────────────────────────────────────────────────────────────────
function Filings({ employees, filings, setFilings, settings, account }) {
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const adminMode = canWrite(account);
  const showToast = (m, ok = true) => { setToast({ m, ok }); setTimeout(() => setToast(null), 3000); };
  const totals = employees.reduce((a, e) => {
    const g = getGross(e), d = calcAll(g, getAdj(e), e);
    return { paye: a.paye + d.paye, nssf: a.nssf + d.nssf, shif: a.shif + d.shif, ahl: a.ahl + d.ahl, wht: a.wht + (d.wht || 0), helb: a.helb + (d.helb || 0), nita: a.nita + (d.nita || 0) };
  }, { paye: 0, nssf: 0, shif: 0, ahl: 0, wht: 0, helb: 0, nita: 0 });
  const handleDownload = async (portalCode) => {
    showToast("Generating Excel file...");
    try {
      const req = {
        employees: employees,
        transactions: employees.map(e => {
          const gross = getGross(e);
          const adj = getAdj(e);
          const computed = calcAll(gross, adj);
          return {
            employee_id: e.id,
            kra_pin: e.kraPin || "",
            full_name: e.name,
            base_salary: e.basicSalary || 0,
            taxable_allowances: (e.housingAllowance || 0) + (e.transportAllowance || 0) + (e.otherAllowances || 0),
            non_taxable_allowances: 0,
            benefits_in_kind: computed.bik,
            nssf_employee: computed.nssf,
            nssf_employer: computed.nssf,
            nssf_tier1_employee: Math.min(gross, 9000) * 0.06,
            nssf_tier1_employer: Math.min(gross, 9000) * 0.06,
            nssf_tier2_employee: Math.max(0, computed.nssf - Math.min(gross, 9000) * 0.06),
            nssf_tier2_employer: Math.max(0, computed.nssf - Math.min(gross, 9000) * 0.06),
            shif: computed.shif,
            housing_levy_employee: computed.ahl,
            housing_levy_employer: computed.ahl,
            taxable_income: computed.taxableIncome,
            gross_paye: computed.grossPAYE,
            personal_relief: computed.personalRelief,
            insurance_relief: computed.insuranceRelief,
            mortgage_relief: computed.mortgageRelief,
            ahl_relief: 0,
            post_retirement_relief: computed.postRetirementRelief,
            total_relief: computed.totalRelief,
            paye: computed.paye,
            gross_salary: gross,
            nssf_number: e.nssfNo || "",
            sha_number: e.shifNo || ""
          };
        }),
        month: 3,
        year: 2026,
        company_info: {
          name: settings.company || "",
          pin: settings.pin || "",
          nssf_no: settings.nssf || "",
          sha_no: settings.sha || ""
        }
      };
      const res = await fetch(`${API_BASE}/generate/${portalCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req)
      });
      if (!res.ok) throw new Error("API Error");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${portalCode}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast("Excel generated successfully!", true);
    } catch (e) {
      showToast("Download failed. Is Backend server running?", false);
    }
  };
  const obligations = [
    { code: "paye", name: "PAYE Income Tax", portal: "KRA iTax", color: C.green, amount: totals.paye, paybill: "222222", icon: "📋", account: "Company PIN" },
    { code: "nssf", name: "NSSF (Phase 4)", portal: "NSSF Portal", color: C.blue, amount: totals.nssf * 2, paybill: "200777", icon: "🛡", account: "NSSF Employer No." },
    { code: "shif", name: "SHIF (SHA)", portal: "SHA Portal", color: C.gold, amount: totals.shif, paybill: "363636", icon: "🏥", account: "SHA Employer No." },
    { code: "ahl", name: "Affordable Housing Levy", portal: "KRA iTax", color: C.purple, amount: totals.ahl * 2, paybill: "222222", icon: "🏠", account: "Company PIN" },
    { code: "helb", name: "HELB Loan Repayment", portal: "HELB Portal", color: C.red, amount: totals.helb, paybill: "200888", icon: "🎓", account: "Company PIN" },
    { code: "nita", name: "NITA Industrial Training", portal: "NITA Portal", color: C.blue, amount: totals.nita, paybill: "222222", icon: "🏗", account: "NITA Employer No." },
    { code: "wht", name: "Withholding Tax (WHT)", portal: "KRA iTax", color: C.blue, amount: totals.wht, paybill: "222222", icon: "⚖️", account: "Company PIN" },
  ];
  const periods = Object.keys(filings).reverse();
  const currentPeriod = periods[0];
  const periodStatus = filings[currentPeriod] || {};
  const allFiled = Object.values(periodStatus).every(v => v === "filed");
  const markFiled = code => { setFilings(f => ({ ...f, [currentPeriod]: { ...f[currentPeriod], [code]: "filed" } })); showToast(`${code.toUpperCase()} marked as filed`); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {toast && <Toast msg={toast.m} ok={toast.ok} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
        {obligations.map(o => {
          const status = periodStatus[o.code] || "pending";
          return (
            <div key={o.code} style={{ background: C.card, border: `1px solid ${status === "filed" ? C.greenD + "55" : C.border}`, borderRadius: 14, padding: 20, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, right: 0, width: 60, height: 60, background: `radial-gradient(circle at top right,${o.color}22,transparent 70%)` }} />
              <div style={{ fontSize: 24, marginBottom: 8 }}>{o.icon}</div>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{o.name}</div>
              <div style={{ color: o.color, fontSize: 20, fontWeight: 800, fontFamily: "'Fraunces',serif", marginBottom: 8 }}>{fmt(o.amount)}</div>
              <StatusBadge s={status} />
              <div style={{ marginTop: 10, color: C.muted, fontSize: 11 }}>{o.portal}</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>M-Pesa: <span style={{ color: C.text, fontFamily: "monospace" }}>{o.paybill}</span></div>
              <button onClick={() => handleDownload(o.code)} style={{ marginTop: 12, width: "100%", background: `linear-gradient(135deg,${o.color},${o.color}88)`, color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", boxShadow: `0 4px 12px ${o.color}44` }}>⬇ Download Excel</button>
              {status !== "filed" && (
                <button onClick={() => setConfirm(o)} style={{ marginTop: 8, width: "100%", background: C.greenG, color: C.green, border: `1px solid ${C.greenD}55`, padding: "8px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Mark as Filed</button>
              )}
            </div>
          );
        })}
      </div>
      {allFiled && <div style={{ background: C.greenG, border: `1px solid ${C.greenD}55`, borderRadius: 12, padding: 16, textAlign: "center", color: C.green, fontWeight: 700, fontSize: 14 }}>✓ All {currentPeriod} obligations filed</div>}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
        <SecTitle>Filing History</SecTitle>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Period", "PAYE", "NSSF", "SHIF", "AHL", "HELB", "NITA", "WHT", "Overall"].map(h => (
            <th key={h} style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", padding: "0 12px 12px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {periods.map(p => {
              const fs = filings[p] || {};
              const vals = ["paye", "nssf", "shif", "ahl", "helb", "nita", "wht"].map(k => fs[k] || "pending");
              const overall = vals.every(v => v === "filed") ? "filed" : vals.some(v => v === "late") ? "late" : "pending";
              return (
                <tr key={p} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "12px", color: C.text, fontWeight: 600, fontSize: 13 }}>{p}</td>
                  {vals.map((v, i) => <td key={i} style={{ padding: "12px" }}><StatusBadge s={v} /></td>)}
                  <td style={{ padding: "12px" }}><StatusBadge s={overall} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirm && (
        <Modal title={`Confirm Filing — ${confirm.name}`} onClose={() => setConfirm(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[["Obligation", confirm.name], ["Amount Due", fmt(confirm.amount)], ["Portal", confirm.portal], ["M-Pesa Paybill", confirm.paybill], ["Account", confirm.account]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ color: C.muted, fontSize: 13 }}>{k}</span>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <button onClick={() => { markFiled(confirm.code); setConfirm(null); }} style={{ background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: 14, borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer", marginTop: 8 }}>✓ Confirm Filed</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function Reports({ employees }) {
  const [report, setReport] = useState(null);
  const totalGross = employees.reduce((s, e) => s + getGross(e), 0);
  const tots = employees.reduce((a, e) => {
    const g = getGross(e), d = calcAll(g, getAdj(e), e);
    return { paye: a.paye + d.paye, nssf: a.nssf + d.nssf, shif: a.shif + d.shif, ahl: a.ahl + d.ahl, wht: a.wht + (d.wht || 0), helb: a.helb + (d.helb || 0), nita: a.nita + (d.nita || 0), net: a.net + d.net };
  }, { paye: 0, nssf: 0, shif: 0, ahl: 0, wht: 0, helb: 0, nita: 0, net: 0 });
  const reports = [
    { id: "paye", icon: "📋", title: "KRA PAYE Return", desc: "iTax-ready CSV with KRA PIN, gross, PAYE per employee" },
    { id: "wht", icon: "⚖️", title: "KRA WHT Return", desc: "iTax-ready CSV for Withholding Tax on contractor payments" },
    { id: "nssf", icon: "🛡", title: "NSSF Contribution Schedule", desc: "Employee & employer contributions per member no." },
    { id: "payregister", icon: "📊", title: "Payroll Register", desc: "Full gross-to-net breakdown for all employees" },
    { id: "p9a", icon: "📄", title: "P9A Annual Summary", desc: "KRA P9A form data for annual income tax filing" },
  ];
  const generateCSV = id => {
    let rows = [], head = "";
    if (id === "paye") {
      head = "KRA_PIN,Employee_Name,Gross_Pay,Taxable_Income,Gross_PAYE,Personal_Relief,Net_PAYE\n";
      rows = employees.filter(e => !isContractor(e)).map(e => { const g = getGross(e), d = calcAll(g, getAdj(e), e); return `${e.kraPin || "N/A"},${e.name},${g.toFixed(2)},${d.taxableIncome.toFixed(2)},${d.grossPAYE.toFixed(2)},${d.personalRelief.toFixed(2)},${d.paye.toFixed(2)}`; });
    } else if (id === "wht") {
      head = "KRA_PIN,Contractor_Name,Payment_Type,Gross_Amount,WHT_Rate,WHT_Amount,Net_Amount\n";
      rows = employees.filter(e => isContractor(e)).map(e => { const g = getGross(e), d = calcAll(g, getAdj(e), e); return `${e.kraPin || "N/A"},${e.name},${d.whtType},${g.toFixed(2)},${(d.whtRate * 100).toFixed(1)}%,${d.wht.toFixed(2)},${d.net.toFixed(2)}`; });
    } else if (id === "nssf") {
      head = "NSSF_No,Employee_Name,Gross,Employee_Contribution,Employer_Contribution,Total\n";
      rows = employees.map(e => { const g = getGross(e), n = calcNSSF(g); return `${e.nssfNo || "N/A"},${e.name},${g.toFixed(2)},${n.toFixed(2)},${n.toFixed(2)},${(n * 2).toFixed(2)}`; });
    } else if (id === "payregister") {
      head = "Employee,KRA_PIN,Department,Gross,NSSF,SHIF,AHL,PAYE,HELB,NITA,Total_Deductions,Net_Pay\n";
      rows = employees.map(e => { const g = getGross(e), d = calcAll(g, getAdj(e), e); return `${e.name},${e.kraPin || "N/A"},${e.department || ""},${g.toFixed(2)},${d.nssf.toFixed(2)},${d.shif.toFixed(2)},${d.ahl.toFixed(2)},${d.paye.toFixed(2)},${(d.helb || 0).toFixed(2)},${(d.nita || 0).toFixed(2)},${d.totalDeductions.toFixed(2)},${d.net.toFixed(2)}`; });
    } else {
      head = "Employee,KRA_PIN,Annual_Gross,Annual_PAYE,Annual_NSSF,Annual_SHIF,Annual_AHL,Annual_Net\n";
      rows = employees.map(e => { const g = getGross(e), d = calcAll(g, getAdj(e)); return `${e.name},${e.kraPin || "N/A"},${(g * 12).toFixed(2)},${(d.paye * 12).toFixed(2)},${(d.nssf * 12).toFixed(2)},${(d.shif * 12).toFixed(2)},${(d.ahl * 12).toFixed(2)},${(d.net * 12).toFixed(2)}`; });
    }
    return head + rows.join("\n");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        {[["Total Payroll", fmt(totalGross), "💼", C.green], ["PAYE Due", fmt(tots.paye), "📋", C.blue], ["Social/Housing", fmt(tots.shif + tots.nssf * 2 + tots.ahl * 2), "🏥", C.gold], ["HELB/NITA", fmt(tots.helb + tots.nita), "🎓", C.purple], ["Net Pay", fmt(tots.net), "✅", C.green]].map(([l, v, i, c]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{i}</div>
            <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{l}</div>
            <div style={{ color: c, fontSize: 17, fontWeight: 800, fontFamily: "'Fraunces',serif", marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {reports.map(r => (
          <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{r.icon}</div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{r.title}</div>
            <div style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>{r.desc}</div>
            <button onClick={() => setReport({ id: r.id, title: r.title, csv: generateCSV(r.id) })}
              disabled={!canWrite(account)}
              style={{ background: canWrite(account) ? C.greenG : C.border, color: canWrite(account) ? C.green : C.dim, border: `1px solid ${C.greenD}44`, padding: "9px 18px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: canWrite(account) ? "pointer" : "not-allowed" }}>Generate Report</button>
          </div>
        ))}
      </div>
      {report && (
        <Modal title={report.title} onClose={() => setReport(null)}>
          <div style={{ background: C.surf, borderRadius: 10, padding: 16, fontFamily: "monospace", fontSize: 11, color: C.muted, whiteSpace: "pre", overflowX: "auto", maxHeight: 300, marginBottom: 16 }}>{report.csv}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Copy and paste into the KRA/NSSF/SHA portal CSV template.</div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function Settings({ settings, setSettings, account, onLogout, staffUsers, setStaffUsers }) {
  const [local, setLocal] = useState({ ...settings });
  const [toast, setToast] = useState(null);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "accountant", password: "password123" });

  const save = async () => { setSettings(local); await storageSet("malipo:settings", local); setToast({ m: "Settings saved", ok: true }); setTimeout(() => setToast(null), 3000); };

  const addStaff = async () => {
    if (!newStaff.email || !newStaff.name) return;
    const updated = [...staffUsers, { ...newStaff, contactName: newStaff.name }];
    setStaffUsers(updated);
    await storageSet("malipo:staffUsers", updated);
    setShowAddStaff(false);
    setNewStaff({ name: "", email: "", role: "accountant", password: "password123" });
    setToast({ m: "Staff member added", ok: true });
    setTimeout(() => setToast(null), 3000);
  };

  const removeStaff = async (email) => {
    const updated = staffUsers.filter(u => u.email !== email);
    setStaffUsers(updated);
    await storageSet("malipo:staffUsers", updated);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
      {toast && <Toast msg={toast.m} ok={toast.ok} />}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
        <SecTitle>Company / Employer Details</SecTitle>
        {[{ l: "Company Name", k: "company" }, { l: "KRA PIN", k: "pin" }, { l: "NSSF Employer No.", k: "nssf" }, { l: "SHA Employer No.", k: "sha" }, { l: "M-Pesa Paybill", k: "paybill" }, { l: "Finance Email", k: "email", t: "email" }].map(f => (
          <div key={f.k} style={{ marginBottom: 14 }}>
            <label style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 5 }}>{f.l}</label>
            <input type={f.t || "text"} value={local[f.k] || ""} onChange={e => setLocal({ ...local, [f.k]: e.target.value })}
              disabled={!isHR(account)}
              style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", opacity: isHR(account) ? 1 : 0.6 }} />
          </div>
        ))}
      </div>
      {isHR(account) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <SecTitle style={{ margin: 0 }}>Staff & Privileges</SecTitle>
            <button onClick={() => setShowAddStaff(true)} style={{ background: C.greenG, color: C.green, border: `1px solid ${C.greenD}44`, padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Add Staff</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {staffUsers.length === 0 && <div style={{ color: C.dim, fontSize: 13, textAlign: "center", padding: 20 }}>No additional staff members added yet.</div>}
            {staffUsers.map(u => (
              <div key={u.email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.surf, borderRadius: 10, border: `1px solid ${C.borderB}` }}>
                <div>
                  <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>{u.contactName}</div>
                  <div style={{ color: C.muted, fontSize: 11 }}>{u.email} · <span style={{ color: C.green, fontWeight: 700, textTransform: "uppercase" }}>{u.role}</span></div>
                </div>
                <button onClick={() => removeStaff(u.email)} style={{ background: "none", border: "none", color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: 0.6 }}>Revoke Access</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddStaff && (
        <Modal title="Add Staff Member" onClose={() => setShowAddStaff(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Full Name</label>
              <input value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: 10, color: C.text, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Email Address</label>
              <input value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: 10, color: C.text, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Default Password</label>
              <input value={newStaff.password} onChange={e => setNewStaff({ ...newStaff, password: e.target.value })} style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: 10, color: C.text, outline: "none" }} />
            </div>
            <div>
              <label style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Role / Privileges</label>
              <select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })} style={{ width: "100%", background: C.surf, border: `1px solid ${C.borderB}`, borderRadius: 8, padding: 10, color: C.text }}>
                <option value="hr">HR Manager (Full Admin)</option>
                <option value="accountant">Accountant (Read/Write)</option>
                <option value="viewer">Viewer (Read Only)</option>
              </select>
            </div>
            <button onClick={addStaff} style={{ background: C.green, color: "#000", border: "none", padding: 12, borderRadius: 10, fontWeight: 700, cursor: "pointer", marginTop: 10 }}>Assign Privileges</button>
          </div>
        </Modal>
      )}

      {account && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
          <SecTitle>Current Session</SecTitle>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
            <div><div style={{ color: C.text, fontWeight: 600 }}>{account.contactName || "Account holder"}</div><div style={{ color: C.muted, fontSize: 12 }}>{account.email} · <span style={{ color: C.green }}>{account.role}</span></div></div>
            <button onClick={onLogout} style={{ background: C.redG, color: C.red, border: `1px solid ${C.red}33`, padding: "7px 16px", borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Sign Out</button>
          </div>
        </div>
      )}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
        <SecTitle>Deadline Reminders</SecTitle>
        {[{ label: "Remind me 7 days before", k: "rem7" }, { label: "Remind me 3 days before", k: "rem3" }, { label: "Reminder on deadline day", k: "rem0" }, { label: "Email reminders", k: "email_rem" }].map(opt => (
          <div key={opt.k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${C.border}33` }}>
            <span style={{ color: C.text, fontSize: 13 }}>{opt.label}</span>
            <div onClick={() => { if (isHR(account)) setLocal({ ...local, [opt.k]: !local[opt.k] }) }} style={{ width: 44, height: 24, borderRadius: 99, background: local[opt.k] ? C.green : C.border, cursor: isHR(account) ? "pointer" : "not-allowed", position: "relative", transition: "background 0.2s", opacity: isHR(account) ? 1 : 0.6 }}>
              <div style={{ width: 18, height: 18, background: "#fff", borderRadius: "50%", position: "absolute", top: 3, left: local[opt.k] ? 23 : 3, transition: "left 0.2s" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>
        <SecTitle>Filing Year</SecTitle>
        <div style={{ display: "flex", gap: 10 }}>
          {["2023/24", "2024/25", "2025/26"].map(y => (
            <button key={y} onClick={() => setLocal({ ...local, year: y })} style={{ flex: 1, padding: "10px", borderRadius: 9, border: `1px solid ${local.year === y ? C.green : C.border}`, background: local.year === y ? C.greenG : "transparent", color: local.year === y ? C.green : C.muted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{y}</button>
          ))}
        </div>
      </div>
      <button onClick={save} style={{ background: `linear-gradient(135deg,${C.green},${C.greenD})`, color: "#000", border: "none", padding: "14px", borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>Save Settings</button>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
function EmployeePortal({ account, onLogout }) {
  const emp = account.employeeData;
  const settings = account.settings || {};
  const [activeTab, setActiveTab] = useState("payslip");
  const g = getGross(emp), d = calcAll(g, getAdj(emp));

  const overridePrintCSS = () => {
    window.print();
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 40, fontFamily: "'Sora',system-ui,sans-serif" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-area, #payslip-area * { visibility: visible; }
          #payslip-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; background: #fff !important; }
          .no-print { display: none !important; }
          @page { margin: 1cm; }
        }
      `}</style>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
          <div>
            <h2 style={{ margin: 0, color: C.text }}>{settings.company || "Company"}</h2>
            <div style={{ color: C.muted, fontSize: 14 }}>Employee Self-Service Portal</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setActiveTab(activeTab === "payslip" ? "calculator" : "payslip")} style={{ background: C.surf, color: C.green, border: `1px solid ${C.greenD}44`, padding: "10px 20px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>{activeTab === "payslip" ? "◈ Salary Calculator" : "📄 View Payslip"}</button>
            <button onClick={onLogout} style={{ background: C.redG, color: C.red, border: `1px solid ${C.red}33`, padding: "10px 20px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Logout</button>
          </div>
        </div>

        {activeTab === "payslip" ? (
          <div id="payslip-area" style={{ background: "#fff", padding: 40, borderRadius: 12, color: "#000", boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}>
            <div style={{ textAlign: "center", marginBottom: 30, borderBottom: "2px solid #ddd", paddingBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ textAlign: "left" }}>
                  <h1 style={{ margin: 0, fontSize: 24 }}>{settings.company || "Company Payslip"}</h1>
                  <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>KRA PIN: {settings.pin || "N/A"}</div>
                </div>
                <button className="no-print" onClick={overridePrintCSS} style={{ background: C.green, color: "#000", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Print PDF</button>
              </div>
              <h3 style={{ marginTop: 20, color: "#444" }}>Official Pay Slip - {new Date().toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</h3>
            </div>

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 30, fontSize: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4 }}><strong>Employee:</strong> {emp.name}</div>
                <div style={{ marginBottom: 4 }}><strong>ID No:</strong> {emp.idNumber || "N/A"}</div>
                <div style={{ marginBottom: 4 }}><strong>KRA PIN:</strong> {emp.kraPin || "N/A"}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 4 }}><strong>Role:</strong> {getTitle(emp)}</div>
                <div style={{ marginBottom: 4 }}><strong>Department:</strong> {emp.department || "N/A"}</div>
                <div style={{ marginBottom: 4 }}><strong>NSSF No:</strong> {emp.nssfNo || "N/A"}</div>
                <div style={{ marginBottom: 4 }}><strong>SHA No:</strong> {emp.shifNo || "N/A"}</div>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left", padding: 10, border: "1px solid #ccc" }}>Description</th>
                  <th style={{ textAlign: "right", padding: 10, border: "1px solid #ccc" }}>Earnings (KES)</th>
                  <th style={{ textAlign: "right", padding: 10, border: "1px solid #ccc" }}>Deductions (KES)</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>Basic Salary</td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc" }}>{fmtN(emp.basicSalary || 0)}</td><td style={{ border: "1px solid #ccc" }}></td></tr>
                {(emp.housingAllowance || 0) > 0 && <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>Housing Allowance</td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc" }}>{fmtN(emp.housingAllowance || 0)}</td><td style={{ border: "1px solid #ccc" }}></td></tr>}
                {(emp.transportAllowance || 0) > 0 && <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>Transport Allowance</td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc" }}>{fmtN(emp.transportAllowance || 0)}</td><td style={{ border: "1px solid #ccc" }}></td></tr>}

                <tr style={{ background: "#fefefe" }}><td style={{ padding: 8, border: "1px solid #ccc" }}><strong>Gross Pay</strong></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc" }}><strong>{fmtN(g)}</strong></td><td style={{ border: "1px solid #ccc" }}></td></tr>

                <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>PAYE</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.paye)}</td></tr>
                <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>NSSF (Employee)</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.nssf)}</td></tr>
                <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>SHIF</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.shif)}</td></tr>
                <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>Affordable Housing Levy (AHL)</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.ahl)}</td></tr>
                {d.helb > 0 && <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>HELB Loan Deduction</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.helb)}</td></tr>}
                {d.customDeductions.map((cd, idx) => (Number(cd.amount) > 0) && <tr key={idx}><td style={{ padding: 8, border: "1px solid #ccc" }}>{cd.name || "Custom Deduction"} ({cd.type})</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(cd.amount)}</td></tr>)}
                {(d.other - d.customDeductions.reduce((acc, cd) => acc + (Number(cd.amount) || 0), 0)) > 0 && <tr><td style={{ padding: 8, border: "1px solid #ccc" }}>Other Standard Deductions</td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}>{fmtN(d.other - d.customDeductions.reduce((acc, cd) => acc + (Number(cd.amount) || 0), 0))}</td></tr>}

                <tr style={{ background: "#f5f5f5" }}><td style={{ padding: 8, border: "1px solid #ccc" }}><strong>Total Deductions</strong></td><td style={{ border: "1px solid #ccc" }}></td><td style={{ textAlign: "right", padding: 8, border: "1px solid #ccc", color: "#d32f2f" }}><strong>{fmtN(d.totalDeductions)}</strong></td></tr>

                <tr>
                  <td style={{ padding: 12, border: "1px solid #ccc", fontSize: 18 }}><strong>Take-Home Net Pay</strong></td>
                  <td style={{ border: "1px solid #ccc" }}></td>
                  <td style={{ textAlign: "right", padding: 12, border: "1px solid #ccc", fontSize: 18, color: "#388e3c" }}><strong>{fmtN(d.net)}</strong></td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: 30, borderTop: "1px solid #ccc", paddingTop: 20, fontSize: 13, color: "#444", background: "#f9f9f9", padding: 16, borderRadius: 8 }}>
              <strong>Employer Contributions Information (Not Deducted from Pay):</strong>
              <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
                <li>NSSF Employer Match: {fmtN(d.nssf)}</li>
                <li>AHL Employer Match: {fmtN(d.ahl)}</li>
                <li>NITA Levy: {fmtN(d.nita)}</li>
              </ul>
            </div>

            <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between", fontSize: 13, color: "#444" }}>
              <div><strong>Bank:</strong> {emp.bankName || "Unspecified"}</div>
              <div><strong>Account:</strong> {emp.accountNo || "****"}</div>
            </div>
          </div>
        ) : (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 30 }}>
            <h2 style={{ fontFamily: "'Fraunces',serif", marginTop: 0 }}>Personalized Salary Calculator</h2>
            <p style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>Estimate your net pay by adjusting your gross salary. Your specific deductions (HELB, Custom Deductions) are already factored in.</p>
            <Calculator baseGross={g} fixedAdj={getAdj(emp)} />
          </div>
        )}
      </div>
    </div>
  );
}

const NAVS = [{ id: "dashboard", label: "Dashboard", icon: "◉" }, { id: "employees", label: "Employees", icon: "◎" }, { id: "calculator", label: "Calculator", icon: "◈" }, { id: "filings", label: "Filings", icon: "◷" }, { id: "reports", label: "Reports", icon: "◫" }, { id: "settings", label: "Settings", icon: "◬" }];

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("landing"); // "landing" | "auth" | "app" | "public-calc"
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [employees, setEmployees] = useState(SEED_EMPLOYEES);
  const [filings, setFilings] = useState(INIT_FILINGS);
  const [settings, setSettings] = useState(INIT_SETTINGS);
  const [staffUsers, setStaffUsers] = useState([]);
  const [toast, setToast] = useState(null);

  // Load from storage on mount
  useEffect(() => {
    (async () => {
      const acct = await storageGet("malipo:account");
      if (acct) setAccount(acct);

      const emps = await storageGet("malipo:employees");
      setLoaded(true);
    })();
  }, []);

  // Isolated Data Loading
  useEffect(() => {
    if (!account || account.isEmployee) return;
    (async () => {
      const pin = account.kraPin || "default";
      const emps = await storageGet(`malipo:data:${pin}:employees`);
      if (emps) setEmployees(emps);
      const sett = await storageGet(`malipo:data:${pin}:settings`);
      if (sett) setSettings(sett);
      const fil = await storageGet(`malipo:data:${pin}:filings`);
      if (fil) setFilings(fil);
      const staff = await storageGet(`malipo:data:${pin}:staffUsers`);
      if (staff) setStaffUsers(staff);
    })();
  }, [account]);

  // Isolated Data Persistence
  useEffect(() => {
    if (loaded && account && !account.isEmployee) {
      const pin = account.kraPin || "default";
      storageSet(`malipo:data:${pin}:employees`, employees);
      storageSet(`malipo:data:${pin}:filings`, filings);
      storageSet(`malipo:data:${pin}:settings`, settings);
      storageSet(`malipo:data:${pin}:staffUsers`, staffUsers);
    }
  }, [employees, filings, settings, staffUsers, loaded, account]);

  const handleAuth = useCallback((acct, isNew) => {
    setAccount(acct);
    setView("app");
    storageSet("malipo:account", acct);
    if (isNew) { setToast({ m: `Welcome, ${acct.contactName || acct.companyName}!`, ok: true }); setTimeout(() => setToast(null), 3500); }
  }, []);

  const handleLogout = () => {
    setAccount(null);
    setView("landing");
    storageSet("malipo:account", null);
  };

  if (!loaded) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sora',system-ui,sans-serif" }}>
      <div style={{ color: C.muted, fontSize: 14 }}>Loading Malipo…</div>
    </div>
  );

  const GlobalStyle = () => (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,700;9..144,800&display=swap');
      *{box-sizing:border-box}
      ::-webkit-scrollbar{width:5px}
      ::-webkit-scrollbar-track{background:${C.bg}}
      ::-webkit-scrollbar-thumb{background:${C.border};border-radius:99px}
      input[type=range]{-webkit-appearance:none;height:4px;border-radius:99px;background:${C.border};outline:none;width:100%}
      input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${C.green};cursor:pointer;box-shadow:0 0 8px ${C.green}88}
      select{-webkit-appearance:none}
    `}</style>
  );

  if (view === "landing") return (
    <>
      <GlobalStyle />
      <LandingPage
        onEnterAuth={() => account ? setView("app") : setView("auth")}
        onEnterCalc={() => setView("public-calc")}
      />
    </>
  );
  if (view === "public-calc") {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", padding: 40 }}>
        <GlobalStyle />
        <div style={{ maxWidth: 800, width: "100%" }}>
          <button onClick={() => setView("landing")} style={{ background: "transparent", color: C.muted, border: "none", cursor: "pointer", marginBottom: 20 }}>← Back home</button>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 24, padding: 32 }}>
            <h2 style={{ fontFamily: "'Fraunces',serif", fontSize: 24, marginBottom: 8 }}>Statutory Net Pay Calculator (Kenya)</h2>
            <p style={{ color: C.muted, fontSize: 14, marginBottom: 32 }}>Calculate deductions based on latest Finance Act bands (PAYE, NSSF, SHIF, AHL).</p>
            <Calculator baseGross={60000} fixedAdj={{}} />
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <button onClick={() => setView("auth")} style={{ background: C.green, color: "#000", border: "none", padding: "14px 32px", borderRadius: 12, fontWeight: 800, cursor: "pointer" }}>Create Full Company Profile →</button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "auth") return <>{<GlobalStyle />} <AuthScreen onAuth={handleAuth} onBack={() => setView("landing")} /></>;
  if (account && account.isEmployee) return <>{<GlobalStyle />} <EmployeePortal account={account} onLogout={handleLogout} /></>;

  const dl = getDaysLeft(), uc = dl.days <= 3 ? C.red : dl.days <= 7 ? C.gold : C.green;
  const pendingCount = Object.values(filings["Mar-25"] || {}).filter(v => v === "pending").length;
  const initials = (account.contactName || account.companyName || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.text, fontFamily: "'Sora','DM Sans',system-ui,sans-serif", overflow: "hidden" }}>
      <GlobalStyle />
      {toast && <Toast msg={toast.m} ok={toast.ok} />}

      {/* SIDEBAR */}
      <div style={{ width: 220, background: C.surf, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "26px 22px 22px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 12px rgba(0,0,0,0.05)`, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              <img src="/logo.png" alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div><div style={{ color: C.text, fontWeight: 800, fontSize: 18, fontFamily: "'Fraunces',serif", lineHeight: 1 }}>Malipo</div><div style={{ color: C.muted, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Compliance Suite</div></div>
          </div>
        </div>
        <div style={{ padding: "14px 22px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 3 }}>Company</div>
          <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{settings.company}</div>
          <div style={{ color: C.muted, fontSize: 11, fontFamily: "monospace" }}>{settings.pin}</div>
        </div>
        <nav style={{ padding: "14px 10px", flex: 1 }}>
          {NAVS.map(n => {
            const active = tab === n.id;
            return (
              <button key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 13px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 2, textAlign: "left", background: active ? C.greenG : "transparent", color: active ? C.green : C.muted, fontWeight: active ? 600 : 400, fontSize: 13, transition: "all 0.15s", borderLeft: `3px solid ${active ? C.green : "transparent"}` }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.border + "44" }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 15 }}>{n.icon}</span>{n.label}</div>
                {n.id === "filings" && pendingCount > 0 && <span style={{ background: C.red, color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "1px 7px" }}>{pendingCount}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ margin: "0 10px 16px", background: uc + "18", border: `1px solid ${uc}44`, borderRadius: 12, padding: 14 }}>
          <div style={{ color: uc, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 3 }}>Next Deadline</div>
          <div style={{ color: C.text, fontSize: 28, fontWeight: 800, fontFamily: "'Fraunces',serif", lineHeight: 1 }}>{dl.days} <span style={{ fontSize: 13, fontWeight: 400, color: C.muted }}>days</span></div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>9th of month filing</div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: C.surf, borderBottom: `1px solid ${C.border}`, padding: "0 30px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ color: C.text, fontWeight: 700, fontSize: 16, fontFamily: "'Fraunces',serif" }}>{NAVS.find(n => n.id === tab)?.label}</div>
            <div style={{ color: C.muted, fontSize: 11 }}>{new Date().toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {pendingCount > 0 && <button onClick={() => setTab("filings")} style={{ background: C.redG, color: C.red, border: `1px solid ${C.red}44`, padding: "8px 16px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>⚠ {pendingCount} Pending</button>}
            {canWrite(account) && <button onClick={() => setTab("filings")} style={{ background: C.greenG, color: C.green, border: `1px solid ${C.greenD}55`, padding: "8px 18px", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>📤 File Returns</button>}
            <div onClick={() => setTab("settings")} style={{ width: 34, height: 34, background: C.greenD, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#000", cursor: "pointer", title: account.email }}>{initials}</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "26px 30px" }}>
          {tab === "dashboard" && <Dashboard employees={employees} />}
          {tab === "employees" && <Employees employees={employees} setEmployees={setEmployees} account={account} />}
          {tab === "calculator" && <Calculator />}
          {tab === "filings" && <Filings employees={employees} filings={filings} setFilings={setFilings} settings={settings} account={account} />}
          {tab === "reports" && <Reports employees={employees} />}
          {tab === "settings" && <Settings settings={settings} setSettings={setSettings} account={account} onLogout={handleLogout} staffUsers={staffUsers} setStaffUsers={setStaffUsers} />}
        </div>
      </div>
    </div>
  );
}
