import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

// ─── STATUTORY CALCULATIONS — Kenya 2025/2026 ────────────────────────────────
function calcNSSF(g) {
  const LEL=9000, UEL=108000, MAX_EE=6480;
  return Math.min((Math.min(g,LEL)+Math.max(0,Math.min(g,UEL)-LEL))*0.06, MAX_EE);
}
function calcSHIF(g) { return g*0.0275; }
function calcAHL(g)  { return g*0.015; }

const PAYE_BANDS = [
  { limit:24000,    rate:0.10 },
  { limit:32333,    rate:0.25 },
  { limit:500000,   rate:0.30 },
  { limit:800000,   rate:0.325 },
  { limit:Infinity, rate:0.35 },
];

function calcPAYEBands(ti) {
  const PR=2400; let gross=0, prev=0; const bands=[];
  for (const b of PAYE_BANDS) {
    if (ti<=prev) break;
    const taxable=Math.min(ti,b.limit)-prev, tax=taxable*b.rate;
    gross+=tax; bands.push({taxable,rate:b.rate,tax}); prev=b.limit;
  }
  return { grossPAYE:gross, bands, personalRelief:PR, netPAYE:Math.max(0,gross-PR) };
}

function calcAll(g, adj={}) {
  const nssf=calcNSSF(g), shif=calcSHIF(g), ahl=calcAHL(g);
  const bik=(adj.carBenefit||0)+(adj.clubFees||0)+(adj.loanFringe||0);
  const disabilityExempt=Math.min(adj.disabilityExempt||0,150000);
  const pensionDed=Math.min(adj.pensionPreTax||0,30000);
  const taxableIncome=Math.max(0,g-nssf-shif-ahl-pensionDed+bik-disabilityExempt);
  const {grossPAYE,bands,personalRelief,netPAYE:basePAYE}=calcPAYEBands(taxableIncome);
  const insuranceRelief=Math.min(adj.insuranceRelief||0,5000);
  const mortgageRelief=Math.min(adj.mortgageRelief||0,30000);
  const postRetirementRelief=Math.min(adj.postRetirementRelief||0,15000);
  const totalRelief=personalRelief+insuranceRelief+mortgageRelief+postRetirementRelief;
  const paye=Math.max(0,grossPAYE-totalRelief);
  const helb=adj.helbDeduction||0, other=adj.otherDeductions||0;
  const totalStatutory=nssf+shif+ahl+paye;
  const totalDeductions=totalStatutory+pensionDed+helb+other;
  const net=g-totalDeductions;
  return {
    nssf,shif,ahl,bik,disabilityExempt,pensionDed,taxableIncome,
    grossPAYE,payeBands:bands,personalRelief,insuranceRelief,mortgageRelief,
    postRetirementRelief,totalRelief,paye,helb,other,
    totalStatutory,totalDeductions,net,total:totalStatutory
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtN = n => Number(n).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt  = n => "KES "+fmtN(n);

function getGross(e) {
  const comp=(e.basicSalary||0)+(e.housingAllowance||0)+(e.transportAllowance||0)+(e.otherAllowances||0);
  return comp>0 ? comp : (e.gross||0);
}
function getAdj(e) {
  return {
    carBenefit:e.carBenefit||0, clubFees:e.clubFees||0, loanFringe:e.loanFringe||0,
    insuranceRelief:e.insuranceRelief||0, mortgageRelief:e.mortgageRelief||0,
    postRetirementRelief:e.postRetirementRelief||0, disabilityExempt:e.disabilityExempt||0,
    pensionPreTax:e.pensionPreTax||0, helbDeduction:e.helbDeduction||0,
    otherDeductions:(e.saccoDeduction||0)+(e.salaryAdvance||0)+(e.otherDeductions||0),
  };
}
function getTitle(e) { return e.jobTitle||e.role||""; }

function getDaysLeft() {
  const now=new Date();
  let d=new Date(now.getFullYear(),now.getMonth(),9);
  if(now.getDate()>=9) d=new Date(now.getFullYear(),now.getMonth()+1,9);
  return { days:Math.ceil((d-now)/86400000), dateStr:d.toLocaleDateString("en-KE",{day:"numeric",month:"long",year:"numeric"}) };
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#050e09", surf:"#0b1610", card:"#101f15", border:"#1a2e20", borderB:"#243d2a",
  green:"#22c55e", greenD:"#16a34a", greenG:"rgba(34,197,94,0.12)",
  gold:"#f59e0b", goldG:"rgba(245,158,11,0.12)", red:"#ef4444", redG:"rgba(239,68,68,0.1)",
  blue:"#38bdf8", purple:"#a78bfa", text:"#dff0e6", muted:"#5a7a65", dim:"#2e4a38",
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const SEED_EMPLOYEES = [
  { id:1, name:"Amina Wanjiru",   jobTitle:"Sales Manager",    department:"Sales",      employmentType:"permanent", residency:"resident", startDate:"2021-03-01", kraPin:"A012345678B", idNumber:"12345678", nssfNo:"NS001234", shifNo:"SH001234", basicSalary:75000, housingAllowance:7000, transportAllowance:3000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:0, mortgageRelief:15000, postRetirementRelief:0, disabilityExempt:0, pensionPreTax:5000, helbDeduction:0,    saccoDeduction:3000, salaryAdvance:0, otherDeductions:0, bankName:"KCB Bank",    accountNo:"1234567890", bankBranch:"Westlands" },
  { id:2, name:"Brian Otieno",    jobTitle:"Lead Developer",   department:"Tech",       employmentType:"permanent", residency:"resident", startDate:"2020-07-15", kraPin:"A023456789B", idNumber:"23456789", nssfNo:"NS002345", shifNo:"SH002345", basicSalary:100000,housingAllowance:12000,transportAllowance:5000, otherAllowances:3000,carBenefit:5000,clubFees:0, loanFringe:0, insuranceRelief:2000,mortgageRelief:25000,postRetirementRelief:5000, disabilityExempt:0, pensionPreTax:10000,helbDeduction:2500, saccoDeduction:5000, salaryAdvance:0, otherDeductions:0, bankName:"Equity Bank",accountNo:"0123456789", bankBranch:"Upper Hill" },
  { id:3, name:"Catherine Njoki", jobTitle:"Accountant",       department:"Finance",    employmentType:"permanent", residency:"resident", startDate:"2022-01-10", kraPin:"A034567890B", idNumber:"34567890", nssfNo:"NS003456", shifNo:"SH003456", basicSalary:55000, housingAllowance:7000, transportAllowance:3000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:1500,mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:3000, helbDeduction:2000, saccoDeduction:2000, salaryAdvance:0, otherDeductions:0, bankName:"NCBA Bank",   accountNo:"2345678901", bankBranch:"CBD" },
  { id:4, name:"David Kamau",     jobTitle:"Driver",           department:"Operations", employmentType:"permanent", residency:"resident", startDate:"2019-11-05", kraPin:"A045678901B", idNumber:"45678901", nssfNo:"NS004567", shifNo:"SH004567", basicSalary:28000, housingAllowance:3000, transportAllowance:1000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:0,    mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:0,    helbDeduction:0,    saccoDeduction:1000, salaryAdvance:0, otherDeductions:0, bankName:"Co-op Bank",  accountNo:"3456789012", bankBranch:"Nakuru" },
  { id:5, name:"Esther Auma",     jobTitle:"Receptionist",     department:"Admin",      employmentType:"permanent", residency:"resident", startDate:"2023-03-20", kraPin:"A056789012B", idNumber:"56789012", nssfNo:"NS005678", shifNo:"SH005678", basicSalary:24000, housingAllowance:3000, transportAllowance:1000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:0,    mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:0,    helbDeduction:1500, saccoDeduction:0,    salaryAdvance:0, otherDeductions:0, bankName:"Family Bank", accountNo:"4567890123", bankBranch:"Nairobi" },
  { id:6, name:"Felix Mutua",     jobTitle:"HR Officer",       department:"HR",         employmentType:"permanent", residency:"resident", startDate:"2021-08-01", kraPin:"A067890123B", idNumber:"67890123", nssfNo:"NS006789", shifNo:"SH006789", basicSalary:47000, housingAllowance:6000, transportAllowance:2000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:1000,mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:2000, helbDeduction:0,    saccoDeduction:2000, salaryAdvance:0, otherDeductions:0, bankName:"Stanbic Bank",accountNo:"5678901234", bankBranch:"Westlands" },
  { id:7, name:"Grace Wambui",    jobTitle:"Graphic Designer", department:"Marketing",  employmentType:"contract",  residency:"resident", startDate:"2022-06-15", kraPin:"A078901234B", idNumber:"78901234", nssfNo:"NS007890", shifNo:"SH007890", basicSalary:42000, housingAllowance:4000, transportAllowance:2000, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:0,    mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:0,    helbDeduction:0,    saccoDeduction:2000, salaryAdvance:0, otherDeductions:0, bankName:"KCB Bank",    accountNo:"6789012345", bankBranch:"Karen" },
  { id:8, name:"Hassan Abdi",     jobTitle:"Logistics Coord",  department:"Operations", employmentType:"permanent", residency:"resident", startDate:"2020-02-01", kraPin:"A089012345B", idNumber:"89012345", nssfNo:"NS008901", shifNo:"SH008901", basicSalary:33000, housingAllowance:3500, transportAllowance:1500, otherAllowances:0, carBenefit:0,  clubFees:0, loanFringe:0, insuranceRelief:0,    mortgageRelief:0,    postRetirementRelief:0, disabilityExempt:0, pensionPreTax:0,    helbDeduction:1500, saccoDeduction:1000, salaryAdvance:0, otherDeductions:0, bankName:"Equity Bank", accountNo:"7890123456", bankBranch:"Mombasa" },
];

const MONTHS=["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
function buildMonthly(emps) {
  return MONTHS.map((m,i)=>{
    const f=0.92+Math.sin(i*0.7)*0.06+i*0.003;
    const t=emps.reduce((a,e)=>{
      const g=Math.round(getGross(e)*f), d=calcAll(g,getAdj(e));
      return {paye:a.paye+d.paye,nssf:a.nssf+d.nssf,shif:a.shif+d.shif,ahl:a.ahl+d.ahl};
    },{paye:0,nssf:0,shif:0,ahl:0});
    return {month:m,...t};
  });
}

const INIT_FILINGS = {
  "Jul-24":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Aug-24":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Sep-24":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Oct-24":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Nov-24":{paye:"filed",nssf:"filed",shif:"late", ahl:"filed"},
  "Dec-24":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Jan-25":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Feb-25":{paye:"filed",nssf:"filed",shif:"filed",ahl:"filed"},
  "Mar-25":{paye:"pending",nssf:"pending",shif:"pending",ahl:"pending"},
};

const INIT_SETTINGS = {
  company:"Savanna Tech Ltd", pin:"P051234567A", nssf:"NB/001234",
  sha:"SHA/ET/001234", paybill:"222222", email:"finance@savannatech.co.ke",
  rem7:true, rem3:true, rem0:true, email_rem:false, year:"2024/25",
};

const EMPTY_EMP = {
  name:"", jobTitle:"", department:"", employmentType:"permanent", startDate:"", residency:"resident",
  kraPin:"", idNumber:"", nssfNo:"", shifNo:"",
  basicSalary:"", housingAllowance:"", transportAllowance:"", otherAllowances:"",
  carBenefit:"", clubFees:"", loanFringe:"",
  insuranceRelief:"", mortgageRelief:"", postRetirementRelief:"", disabilityExempt:"",
  pensionPreTax:"", helbDeduction:"", saccoDeduction:"", salaryAdvance:"", otherDeductions:"",
  bankName:"", accountNo:"", bankBranch:"",
};

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
async function storageGet(key, fallback=null) {
  try { const r=await window.storage.get(key); return r ? JSON.parse(r.value) : fallback; }
  catch { return fallback; }
}
async function storageSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value)); } catch {}
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
const SecTitle = ({children,style})=>(
  <div style={{color:C.text,fontSize:15,fontWeight:700,fontFamily:"'Fraunces',serif",letterSpacing:"-0.01em",marginBottom:16,...style}}>{children}</div>
);
const StatusBadge=({s})=>{
  const map={filed:{bg:"#dcfce7",tc:"#166534",label:"✓ Filed"},late:{bg:"#fef9c3",tc:"#854d0e",label:"⚠ Late"},pending:{bg:"#fee2e2",tc:"#991b1b",label:"○ Pending"}};
  const {bg,tc,label}=map[s]||map.pending;
  return <span style={{background:bg+"22",color:tc,border:`1px solid ${tc}44`,padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{label}</span>;
};
function Modal({title,onClose,children,wide}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:C.card,border:`1px solid ${C.borderB}`,borderRadius:18,width:"100%",maxWidth:wide?860:680,maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,0.7)"}}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{color:C.text,fontWeight:700,fontFamily:"'Fraunces',serif",fontSize:16}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",padding:24,flex:1}}>{children}</div>
      </div>
    </div>
  );
}
function Toast({msg,ok}) {
  return (
    <div style={{position:"fixed",bottom:28,right:28,zIndex:2000,background:ok?C.greenD:C.red,color:"#fff",padding:"12px 22px",borderRadius:12,fontWeight:600,fontSize:13,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",display:"flex",alignItems:"center",gap:8}}>
      {ok?"✓":"✕"} {msg}
    </div>
  );
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────
function AuthScreen({onAuth}) {
  const [mode,setMode]=useState("login"); // "login" | "register"
  const [form,setForm]=useState({company:"",kraPin:"",nssfNo:"",shaNo:"",contactName:"",role:"accountant",email:"",password:"",confirmPassword:""});
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const handleRegister=async()=>{
    if(!form.company||!form.email||!form.password) return setErr("Company name, email and password are required.");
    if(form.password!==form.confirmPassword) return setErr("Passwords do not match.");
    if(form.password.length<6) return setErr("Password must be at least 6 characters.");
    setLoading(true);
    const account={companyName:form.company,kraPin:form.kraPin,nssfNo:form.nssfNo,shaNo:form.shaNo,contactName:form.contactName,role:form.role,email:form.email.toLowerCase(),password:form.password};
    await storageSet("malipo:account",account);
    await storageSet("malipo:settings",{company:form.company,pin:form.kraPin,nssf:form.nssfNo,sha:form.shaNo,paybill:"222222",email:form.email,rem7:true,rem3:true,rem0:true,email_rem:false,year:"2024/25"});
    setLoading(false);
    onAuth(account, true);
  };

  const handleLogin=async()=>{
    if(!form.email||!form.password) return setErr("Email and password are required.");
    setLoading(true);
    const account=await storageGet("malipo:account");
    setLoading(false);
    if(!account) return setErr("No account found. Please register first.");
    if(account.email!==form.email.toLowerCase()) return setErr("Email not found.");
    if(account.password!==form.password) return setErr("Incorrect password.");
    onAuth(account, false);
  };

  const inp=(label,key,type="text",placeholder="")=>(
    <div style={{marginBottom:16}}>
      <label style={{color:C.muted,fontSize:11,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:6}}>{label}</label>
      <input type={type} placeholder={placeholder} value={form[key]} onChange={e=>set(key,e.target.value)}
        style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:10,padding:"11px 14px",color:C.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}
        onFocus={e=>e.target.style.borderColor=C.greenD} onBlur={e=>e.target.style.borderColor=C.borderB}/>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora','DM Sans',system-ui,sans-serif",padding:24}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Fraunces:opsz,wght@9..144,300;9..144,700;9..144,800&display=swap');*{box-sizing:border-box}`}</style>
      <div style={{width:"100%",maxWidth:500}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:56,height:56,background:`linear-gradient(135deg,${C.green},${C.greenD})`,borderRadius:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:`0 8px 28px ${C.greenG}`,marginBottom:14}}>🇰🇪</div>
          <div style={{color:C.text,fontSize:28,fontWeight:800,fontFamily:"'Fraunces',serif",lineHeight:1}}>Malipo</div>
          <div style={{color:C.muted,fontSize:12,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:4}}>Kenya Payroll & Compliance Suite</div>
        </div>

        <div style={{background:C.card,border:`1px solid ${C.borderB}`,borderRadius:18,padding:32,boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
          {/* Tabs */}
          <div style={{display:"flex",background:C.surf,borderRadius:10,padding:4,marginBottom:28}}>
            {[["login","Sign In"],["register","Create Account"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,padding:"9px",borderRadius:8,border:"none",background:mode===m?C.greenD:"transparent",color:mode===m?"#000":C.muted,fontWeight:mode===m?700:500,fontSize:13,cursor:"pointer",transition:"all 0.2s"}}>{l}</button>
            ))}
          </div>

          {mode==="login" ? (
            <div>
              {inp("Email Address","email","email","you@company.co.ke")}
              {inp("Password","password","password","Enter your password")}
              {err && <div style={{color:C.red,fontSize:12,marginBottom:14,padding:"9px 12px",background:C.redG,borderRadius:8,border:`1px solid ${C.red}33`}}>{err}</div>}
              <button onClick={handleLogin} disabled={loading} style={{width:"100%",background:`linear-gradient(135deg,${C.green},${C.greenD})`,color:"#000",border:"none",padding:14,borderRadius:12,fontWeight:800,fontSize:15,cursor:"pointer",marginTop:4}}>
                {loading?"Signing in…":"Sign In"}
              </button>
              <div style={{textAlign:"center",marginTop:18,color:C.muted,fontSize:12}}>
                No account? <span onClick={()=>setMode("register")} style={{color:C.green,cursor:"pointer",fontWeight:600}}>Register your company</span>
              </div>
            </div>
          ) : (
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
                <div style={{gridColumn:"1/-1"}}>{inp("Company / Business Name *","company","text","Savanna Tech Ltd")}</div>
                {inp("KRA PIN","kraPin","text","P051234567A")}
                {inp("NSSF Employer No.","nssfNo","text","NB/001234")}
                {inp("SHA Employer No.","shaNo","text","SHA/ET/001234")}
                <div>
                  <label style={{color:C.muted,fontSize:11,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:6}}>Your Role</label>
                  <select value={form.role} onChange={e=>set("role",e.target.value)}
                    style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:10,padding:"11px 14px",color:C.text,fontSize:14,outline:"none",marginBottom:16}}>
                    <option value="accountant">Accountant</option>
                    <option value="hr">HR Manager</option>
                    <option value="owner">Business Owner</option>
                    <option value="finance">Finance Director</option>
                  </select>
                </div>
                {inp("Contact Name","contactName","text","Jane Mwangi")}
                <div style={{gridColumn:"1/-1"}}>{inp("Email Address *","email","email","jane@savannatech.co.ke")}</div>
                {inp("Password *","password","password","Min 6 characters")}
                {inp("Confirm Password *","confirmPassword","password","Re-enter password")}
              </div>
              {err && <div style={{color:C.red,fontSize:12,marginBottom:14,padding:"9px 12px",background:C.redG,borderRadius:8,border:`1px solid ${C.red}33`}}>{err}</div>}
              <button onClick={handleRegister} disabled={loading} style={{width:"100%",background:`linear-gradient(135deg,${C.green},${C.greenD})`,color:"#000",border:"none",padding:14,borderRadius:12,fontWeight:800,fontSize:15,cursor:"pointer",marginTop:4}}>
                {loading?"Creating Account…":"Create Account & Continue"}
              </button>
            </div>
          )}
        </div>

        <div style={{textAlign:"center",marginTop:20,color:C.dim,fontSize:11}}>
          Data is stored locally in your browser · 2025/2026 Kenya statutory rates
        </div>
      </div>
    </div>
  );
}

// ─── EMPLOYEE MODAL (FULL FORM) ───────────────────────────────────────────────
const STEPS=["Personal Details","Compensation","Benefits & Reliefs","Deductions & Banking"];

function EmployeeModal({emp,onSave,onClose}) {
  const [step,setStep]=useState(0);
  const [f,setF]=useState(emp ? {...EMPTY_EMP,...emp} : {...EMPTY_EMP});
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const num=(k,v)=>set(k,v===""?"":Number(v));

  const gross=(Number(f.basicSalary)||0)+(Number(f.housingAllowance)||0)+(Number(f.transportAllowance)||0)+(Number(f.otherAllowances)||0);
  const preview=gross>0 ? calcAll(gross,{carBenefit:Number(f.carBenefit)||0,clubFees:Number(f.clubFees)||0,loanFringe:Number(f.loanFringe)||0,insuranceRelief:Number(f.insuranceRelief)||0,mortgageRelief:Number(f.mortgageRelief)||0,postRetirementRelief:Number(f.postRetirementRelief)||0,disabilityExempt:Number(f.disabilityExempt)||0,pensionPreTax:Number(f.pensionPreTax)||0,helbDeduction:Number(f.helbDeduction)||0,otherDeductions:(Number(f.saccoDeduction)||0)+(Number(f.salaryAdvance)||0)+(Number(f.otherDeductions)||0)}) : null;

  const handleSave=()=>{
    if(!f.name) return;
    const emp2={...f,id:f.id||Date.now()};
    // Convert numeric strings
    ["basicSalary","housingAllowance","transportAllowance","otherAllowances","carBenefit","clubFees","loanFringe","insuranceRelief","mortgageRelief","postRetirementRelief","disabilityExempt","pensionPreTax","helbDeduction","saccoDeduction","salaryAdvance","otherDeductions"].forEach(k=>{ emp2[k]=Number(emp2[k])||0; });
    onSave(emp2);
  };

  const Field=({label,k,type="text",placeholder="",half,hint,required})=>(
    <div style={{marginBottom:14,gridColumn:half?"auto":"auto"}}>
      <label style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:5}}>{label}{required&&<span style={{color:C.red}}> *</span>}</label>
      <input type={type} placeholder={placeholder} value={f[k]||""} onChange={e=>type==="number"?num(k,e.target.value):set(k,e.target.value)}
        style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:8,padding:"9px 12px",color:C.text,fontSize:13,outline:"none",boxSizing:"border-box"}}
        onFocus={e=>e.target.style.borderColor=C.greenD} onBlur={e=>e.target.style.borderColor=C.borderB}/>
      {hint && <div style={{color:C.dim,fontSize:10,marginTop:3}}>{hint}</div>}
    </div>
  );
  const Select=({label,k,opts})=>(
    <div style={{marginBottom:14}}>
      <label style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:5}}>{label}</label>
      <select value={f[k]||""} onChange={e=>set(k,e.target.value)}
        style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:8,padding:"9px 12px",color:C.text,fontSize:13,outline:"none"}}>
        {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  const NumField=({label,k,hint,cap})=>(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5}}>
        <label style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase"}}>{label}</label>
        {cap && <span style={{color:C.dim,fontSize:9}}>max {fmt(cap)}</span>}
      </div>
      <input type="number" value={f[k]||""} onChange={e=>num(k,e.target.value)} placeholder="0"
        style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:8,padding:"9px 12px",color:C.text,fontSize:13,outline:"none",boxSizing:"border-box"}}
        onFocus={e=>e.target.style.borderColor=C.greenD} onBlur={e=>e.target.style.borderColor=C.borderB}/>
      {hint && <div style={{color:C.dim,fontSize:10,marginTop:3}}>{hint}</div>}
    </div>
  );

  const SectionHead=({children,color})=>(
    <div style={{color:color||C.green,fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12,marginTop:4,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>{children}</div>
  );

  const stepContent=[
    // STEP 0 — Personal Details
    <div key="s0">
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <div style={{gridColumn:"1/-1"}}><Field label="Full Name" k="name" required placeholder="e.g. Amina Wanjiru"/></div>
        <Field label="Job Title" k="jobTitle" placeholder="e.g. Sales Manager"/>
        <Field label="Department" k="department" placeholder="e.g. Finance"/>
        <Select label="Employment Type" k="employmentType" opts={[["permanent","Permanent"],["contract","Contract"],["casual","Casual / Part-Time"],["director","Director"]]}/>
        <Select label="Tax Residency" k="residency" opts={[["resident","Resident"],["nonresident","Non-Resident"]]}/>
        <Field label="Start Date" k="startDate" type="date"/>
        <Field label="KRA PIN" k="kraPin" placeholder="A012345678B" hint="Format: A000000000B"/>
        <Field label="National ID / Passport No." k="idNumber" placeholder="12345678"/>
        <Field label="NSSF Member No." k="nssfNo" placeholder="NS001234"/>
        <Field label="SHIF Member No." k="shifNo" placeholder="SH001234"/>
      </div>
    </div>,

    // STEP 1 — Compensation
    <div key="s1">
      <SectionHead>Monthly Earnings</SectionHead>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <NumField label="Basic Salary *" k="basicSalary" hint="Core cash salary before allowances"/>
        <NumField label="House / Accommodation Allowance" k="housingAllowance" hint="Taxable if exceeds 15% of basic"/>
        <NumField label="Transport Allowance" k="transportAllowance" hint="Taxable; not the same as commuter benefit"/>
        <NumField label="Other Allowances" k="otherAllowances" hint="Airtime, risk, leave allowances, etc."/>
      </div>
      {gross>0 && (
        <div style={{marginTop:8,background:C.greenG,border:`1px solid ${C.greenD}44`,borderRadius:10,padding:16}}>
          <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>Computed Gross Salary</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:24}}>
              {[["Basic",f.basicSalary],["Housing",f.housingAllowance],["Transport",f.transportAllowance],["Other",f.otherAllowances]].map(([l,v])=>(Number(v)||0)>0?(
                <div key={l}><div style={{color:C.dim,fontSize:10}}>{l}</div><div style={{color:C.text,fontSize:12,fontWeight:600}}>{fmt(Number(v)||0)}</div></div>
              ):null)}
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{color:C.muted,fontSize:10}}>Total Gross</div>
              <div style={{color:C.green,fontSize:22,fontWeight:800,fontFamily:"'Fraunces',serif"}}>{fmt(gross)}</div>
            </div>
          </div>
          {preview && (
            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,display:"flex",gap:20}}>
              {[["PAYE",preview.paye,C.red],["NSSF",preview.nssf,C.blue],["SHIF",preview.shif,C.gold],["AHL",preview.ahl,C.purple],["Net Pay",preview.net,C.green]].map(([l,v,c])=>(
                <div key={l}><div style={{color:C.muted,fontSize:9,textTransform:"uppercase"}}>{l}</div><div style={{color:c,fontSize:12,fontWeight:700}}>{fmt(v)}</div></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>,

    // STEP 2 — Benefits & Reliefs
    <div key="s2">
      <SectionHead color={C.gold}>Benefits-in-Kind (Taxable — Increase Gross for PAYE)</SectionHead>
      <div style={{background:C.goldG,borderRadius:8,padding:"8px 12px",marginBottom:12,color:C.gold,fontSize:11}}>
        ⚠ These are employer-provided perks valued and added to taxable income per KRA rules.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <NumField label="Company Car Benefit" k="carBenefit" hint="Taxable value per KRA Motor Vehicle table"/>
        <NumField label="Club / Recreation Fees" k="clubFees" hint="Employer-paid club membership"/>
        <NumField label="Low-Interest Loan Fringe" k="loanFringe" hint="Excess of market rate vs loan interest"/>
      </div>

      <SectionHead color={C.green} >Tax Reliefs (Reduce PAYE Payable)</SectionHead>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <NumField label="Insurance Relief" k="insuranceRelief" cap={5000} hint="15% of premiums paid (life/education/health)"/>
        <NumField label="Mortgage Interest Relief" k="mortgageRelief" cap={30000} hint="Interest on primary home loan (Finance Act 2025)"/>
        <NumField label="Post-Retirement Medical Relief" k="postRetirementRelief" cap={15000} hint="15% of medical fund contributions (Finance Act 2023)"/>
        <NumField label="Disability Exemption (PWD)" k="disabilityExempt" cap={150000} hint="First KES 150,000/mo exempt from PAYE"/>
      </div>

      {preview && (
        <div style={{marginTop:4,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
          <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Updated Tax Preview</div>
          <div style={{display:"flex",gap:20}}>
            {[["Gross PAYE",preview.grossPAYE,C.red],["Total Relief",preview.totalRelief,C.green],["Net PAYE",preview.paye,C.gold],["Net Pay",preview.net,C.green]].map(([l,v,c])=>(
              <div key={l}><div style={{color:C.muted,fontSize:9,textTransform:"uppercase"}}>{l}</div><div style={{color:c,fontSize:13,fontWeight:700}}>{fmt(v)}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>,

    // STEP 3 — Deductions & Banking
    <div key="s3">
      <SectionHead color={C.blue}>Pre-Tax Deductions (Reduce Taxable Income)</SectionHead>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <NumField label="Pension / Provident Fund" k="pensionPreTax" cap={30000} hint="Pre-PAYE; employer-registered scheme only"/>
      </div>

      <SectionHead color={C.red}>Post-Tax Deductions (From Net Pay)</SectionHead>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <NumField label="HELB Loan Repayment" k="helbDeduction" hint="Min KES 1,500/mo where applicable"/>
        <NumField label="SACCO / Co-op Deduction" k="saccoDeduction" hint="Voluntary savings deduction"/>
        <NumField label="Salary Advance Recovery" k="salaryAdvance" hint="Monthly repayment of advance taken"/>
        <NumField label="Other Deductions" k="otherDeductions" hint="Uniform loan, canteen, any other"/>
      </div>

      {preview && (
        <div style={{background:C.greenG,border:`1px solid ${C.greenD}44`,borderRadius:10,padding:14,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{color:C.muted,fontSize:10}}>Total Deductions</div><div style={{color:C.red,fontSize:16,fontWeight:700}}>{fmt(preview.totalDeductions)}</div></div>
            <div><div style={{color:C.muted,fontSize:10}}>Final Net Pay</div><div style={{color:C.green,fontSize:22,fontWeight:800,fontFamily:"'Fraunces',serif"}}>{fmt(preview.net)}</div></div>
            <div><div style={{color:C.muted,fontSize:10}}>Cost to Company</div><div style={{color:C.gold,fontSize:16,fontWeight:700}}>{fmt(gross+(preview.nssf||0)+(preview.ahl||0))}</div></div>
          </div>
        </div>
      )}

      <SectionHead color={C.blue}>Bank Account Details</SectionHead>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
        <Field label="Bank Name" k="bankName" placeholder="e.g. KCB Bank Kenya"/>
        <Field label="Account Number" k="accountNo" placeholder="1234567890"/>
        <div style={{gridColumn:"1/-1"}}><Field label="Branch" k="bankBranch" placeholder="e.g. Westlands, Nairobi"/></div>
      </div>
    </div>
  ];

  return (
    <Modal title={emp ? `Edit — ${emp.name}` : "Add New Employee"} onClose={onClose} wide>
      {/* Stepper */}
      <div style={{display:"flex",gap:0,marginBottom:24,background:C.surf,borderRadius:10,padding:4}}>
        {STEPS.map((s,i)=>(
          <button key={i} onClick={()=>setStep(i)} style={{flex:1,padding:"9px 6px",borderRadius:8,border:"none",background:step===i?C.greenD:"transparent",color:step===i?"#000":i<step?C.green:C.muted,fontWeight:step===i?700:500,fontSize:11,cursor:"pointer",transition:"all 0.2s",textAlign:"center"}}>
            <span style={{display:"block",fontSize:16,marginBottom:2}}>{["①","②","③","④"][i]}</span>{s}
          </button>
        ))}
      </div>

      {stepContent[step]}

      {/* Navigation */}
      <div style={{display:"flex",justifyContent:"space-between",marginTop:20,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
        <button onClick={()=>step>0?setStep(step-1):onClose()} style={{background:C.surf,color:C.muted,border:`1px solid ${C.border}`,padding:"10px 22px",borderRadius:9,fontWeight:600,fontSize:13,cursor:"pointer"}}>
          {step===0?"Cancel":"← Back"}
        </button>
        <div style={{display:"flex",gap:10}}>
          {step<STEPS.length-1 ? (
            <button onClick={()=>setStep(step+1)} style={{background:`linear-gradient(135deg,${C.green},${C.greenD})`,color:"#000",border:"none",padding:"10px 26px",borderRadius:9,fontWeight:700,fontSize:13,cursor:"pointer"}}>
              Next →
            </button>
          ) : (
            <button onClick={handleSave} disabled={!f.name} style={{background:f.name?`linear-gradient(135deg,${C.green},${C.greenD})`:"#2a3a2e",color:f.name?"#000":C.dim,border:"none",padding:"10px 26px",borderRadius:9,fontWeight:700,fontSize:13,cursor:f.name?"pointer":"not-allowed"}}>
              ✓ Save Employee
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({employees}) {
  const dl=getDaysLeft(), uc=dl.days<=3?C.red:dl.days<=7?C.gold:C.green;
  const monthly=buildMonthly(employees);
  const thisMonth=employees.reduce((a,e)=>{
    const g=getGross(e),d=calcAll(g,getAdj(e));
    return {paye:a.paye+d.paye,nssf:a.nssf+d.nssf,shif:a.shif+d.shif,ahl:a.ahl+d.ahl,total:a.total+d.total};
  },{paye:0,nssf:0,shif:0,ahl:0,total:0});
  const totalGross=employees.reduce((s,e)=>s+getGross(e),0);
  const pieData=[{name:"PAYE",value:thisMonth.paye,color:C.green},{name:"NSSF",value:thisMonth.nssf,color:C.blue},{name:"SHIF",value:thisMonth.shif,color:C.gold},{name:"AHL",value:thisMonth.ahl,color:C.purple}];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:22}}>
      <div style={{background:`linear-gradient(120deg,${uc}18,${uc}06)`,border:`1px solid ${uc}44`,borderRadius:14,padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{fontSize:30}}>⏱</div>
          <div><div style={{color:uc,fontWeight:800,fontSize:16}}>{dl.days} days until filing deadline</div><div style={{color:C.muted,fontSize:13,marginTop:3}}>PAYE · NSSF · SHIF · AHL returns due by 9th — {dl.dateStr}</div></div>
        </div>
        <div style={{background:uc+"22",border:`1px solid ${uc}55`,borderRadius:10,padding:"10px 20px",textAlign:"center"}}>
          <div style={{color:uc,fontSize:28,fontWeight:800,fontFamily:"'Fraunces',serif",lineHeight:1}}>{dl.days}</div>
          <div style={{color:C.muted,fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase"}}>Days Left</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        {[{label:"Total Payroll",value:fmt(totalGross),sub:`${employees.length} employees`,accent:C.green,icon:"💼"},{label:"PAYE Due (KRA)",value:fmt(thisMonth.paye),sub:"iTax by 9th",accent:C.blue,icon:"📋"},{label:"SHIF Due (SHA)",value:fmt(thisMonth.shif),sub:"2.75% of gross",accent:C.gold,icon:"🏥"},{label:"Total Remittance",value:fmt(thisMonth.total),sub:"All 4 obligations",accent:C.purple,icon:"📤"}].map(sc=>(
          <div key={sc.label} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"20px 20px",position:"relative",overflow:"hidden",transition:"border-color 0.2s"}}
               onMouseEnter={e=>e.currentTarget.style.borderColor=sc.accent+"66"} onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            <div style={{position:"absolute",top:0,right:0,width:70,height:70,background:`radial-gradient(circle at top right,${sc.accent}22,transparent 70%)`}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div><div style={{color:C.muted,fontSize:11,fontWeight:500,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:8}}>{sc.label}</div><div style={{color:C.text,fontSize:21,fontWeight:800,fontFamily:"'Fraunces',serif"}}>{sc.value}</div><div style={{color:C.muted,fontSize:11,marginTop:5}}>{sc.sub}</div></div>
              <div style={{fontSize:20}}>{sc.icon}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.7fr 1fr",gap:16}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
          <SecTitle>9-Month Remittance Trend</SecTitle>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthly} margin={{top:5,right:5,left:-10,bottom:0}}>
              <defs>
                <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.green} stopOpacity={0.3}/><stop offset="95%" stopColor={C.green} stopOpacity={0}/></linearGradient>
                <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.gold} stopOpacity={0.3}/><stop offset="95%" stopColor={C.gold} stopOpacity={0}/></linearGradient>
                <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.blue} stopOpacity={0.3}/><stop offset="95%" stopColor={C.blue} stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{background:C.surf,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:12}} formatter={v=>[fmt(v)]}/>
              <Area type="monotone" dataKey="paye" stroke={C.green} fill="url(#gP)" strokeWidth={2} name="PAYE"/>
              <Area type="monotone" dataKey="shif" stroke={C.gold} fill="url(#gS)" strokeWidth={2} name="SHIF"/>
              <Area type="monotone" dataKey="nssf" stroke={C.blue} fill="url(#gN)" strokeWidth={2} name="NSSF"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22,display:"flex",flexDirection:"column",gap:14}}>
          <SecTitle>Obligation Split</SecTitle>
          <PieChart width={160} height={160} style={{margin:"0 auto"}}>
            <Pie data={pieData} cx={75} cy={75} outerRadius={65} innerRadius={40} dataKey="value" paddingAngle={3}>
              {pieData.map((e,i)=><Cell key={i} fill={e.color} opacity={0.9}/>)}
            </Pie>
            <Tooltip contentStyle={{background:C.surf,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12}} formatter={v=>[fmt(v)]}/>
          </PieChart>
          {pieData.map(p=>(
            <div key={p.name} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}33`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/><span style={{color:C.muted,fontSize:12}}>{p.name}</span></div>
              <span style={{color:p.color,fontSize:13,fontWeight:700}}>{fmt(p.value)}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
        <SecTitle>Payroll Quick View</SecTitle>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>{["Employee","Gross","PAYE","NSSF","SHIF","AHL","Net Pay"].map(h=>(
              <th key={h} style={{color:C.muted,fontSize:11,fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase",textAlign:h==="Employee"?"left":"right",padding:"0 12px 12px",borderBottom:`1px solid ${C.border}`}}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {employees.map(e=>{const g=getGross(e),d=calcAll(g,getAdj(e));return(
              <tr key={e.id} style={{borderBottom:`1px solid ${C.border}22`,transition:"background 0.15s"}} onMouseEnter={ev=>ev.currentTarget.style.background=C.border+"55"} onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                <td style={{padding:"11px 12px",color:C.text,fontSize:13,fontWeight:600}}>{e.name}<div style={{color:C.muted,fontSize:11,fontWeight:400}}>{getTitle(e)}</div></td>
                {[g,d.paye,d.nssf,d.shif,d.ahl,d.net].map((v,i)=>(
                  <td key={i} style={{padding:"11px 12px",color:i===5?C.green:C.text,fontSize:13,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmt(v)}</td>
                ))}
              </tr>
            );})}
          </tbody>
          <tfoot><tr style={{borderTop:`2px solid ${C.borderB}`}}>
            <td style={{padding:"12px",color:C.muted,fontSize:12,fontWeight:700}}>TOTALS</td>
            {(()=>{const tots=employees.reduce((a,e)=>{const g=getGross(e),d=calcAll(g,getAdj(e));return{g:a.g+g,p:a.p+d.paye,n:a.n+d.nssf,s:a.s+d.shif,h:a.h+d.ahl,net:a.net+d.net};},{g:0,p:0,n:0,s:0,h:0,net:0});return[tots.g,tots.p,tots.n,tots.s,tots.h,tots.net].map((v,i)=>(
              <td key={i} style={{padding:"12px",color:i===5?C.green:C.text,fontSize:13,textAlign:"right",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(v)}</td>
            ))})()}
            <td/>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
function Employees({employees,setEmployees}) {
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const [payslip,setPayslip]=useState(null);
  const [search,setSearch]=useState("");
  const [toast,setToast]=useState(null);
  const showToast=(m,ok=true)=>{setToast({m,ok});setTimeout(()=>setToast(null),3000);};

  const filtered=employees.filter(e=>e.name.toLowerCase().includes(search.toLowerCase())||getTitle(e).toLowerCase().includes(search.toLowerCase())||(e.department||"").toLowerCase().includes(search.toLowerCase()));

  const handleSave=emp=>{
    if(emp.id && employees.find(e=>e.id===emp.id)) {
      setEmployees(employees.map(e=>e.id===emp.id?emp:e));
      showToast(`${emp.name} updated`);
    } else {
      setEmployees([...employees,emp]);
      showToast(`${emp.name} added`);
    }
    setAdding(false); setEditing(null);
  };

  const remove=id=>{const e=employees.find(x=>x.id===id);setEmployees(employees.filter(x=>x.id!==id));showToast(`${e?.name||"Employee"} removed`,false);};

  const totals=employees.reduce((a,e)=>{const g=getGross(e),d=calcAll(g,getAdj(e));return{g:a.g+g,p:a.p+d.paye,n:a.n+d.nssf,s:a.s+d.shif,h:a.h+d.ahl,net:a.net+d.net};},{g:0,p:0,n:0,s:0,h:0,net:0});

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {toast && <Toast msg={toast.m} ok={toast.ok}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <SecTitle style={{marginBottom:0}}>{employees.length} Registered Employees</SecTitle>
        <div style={{display:"flex",gap:10}}>
          <input placeholder="Search name, role, dept…" value={search} onChange={e=>setSearch(e.target.value)}
            style={{background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:8,padding:"8px 14px",color:C.text,fontSize:13,outline:"none",width:220}}/>
          <button onClick={()=>setAdding(true)} style={{background:C.green,color:"#000",border:"none",padding:"9px 20px",borderRadius:8,fontWeight:700,fontSize:13,cursor:"pointer"}}>+ Add Employee</button>
        </div>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead style={{background:C.surf}}>
            <tr>{["#","Employee","PIN / ID","Dept","Gross","PAYE","NSSF","Net Pay",""].map(h=>(
              <th key={h} style={{color:C.muted,fontSize:11,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",textAlign:"left",padding:"14px 13px",borderBottom:`1px solid ${C.border}`}}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.map((e,i)=>{
              const g=getGross(e),d=calcAll(g,getAdj(e));
              return (
                <tr key={e.id} style={{borderBottom:`1px solid ${C.border}33`,cursor:"pointer",transition:"background 0.15s"}}
                    onMouseEnter={ev=>ev.currentTarget.style.background=C.border+"55"}
                    onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}
                    onClick={()=>setPayslip(e)}>
                  <td style={{padding:"13px",color:C.dim,fontSize:12}}>{i+1}</td>
                  <td style={{padding:"13px"}}>
                    <div style={{color:C.text,fontSize:13,fontWeight:600}}>{e.name}</div>
                    <div style={{color:C.muted,fontSize:11}}>{getTitle(e)} {e.employmentType==="contract"?<span style={{color:C.gold,fontSize:10,marginLeft:4}}>CONTRACT</span>:e.employmentType==="casual"?<span style={{color:C.purple,fontSize:10,marginLeft:4}}>CASUAL</span>:null}</div>
                  </td>
                  <td style={{padding:"13px"}}><div style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>{e.kraPin||"—"}</div><div style={{color:C.dim,fontSize:10}}>ID: {e.idNumber||"—"}</div></td>
                  <td style={{padding:"13px",color:C.muted,fontSize:12}}>{e.department||"—"}</td>
                  <td style={{padding:"13px",color:C.text,fontSize:13,fontVariantNumeric:"tabular-nums"}}>{fmt(g)}</td>
                  <td style={{padding:"13px",color:C.text,fontSize:13,fontVariantNumeric:"tabular-nums"}}>{fmt(d.paye)}</td>
                  <td style={{padding:"13px",color:C.text,fontSize:13,fontVariantNumeric:"tabular-nums"}}>{fmt(d.nssf)}</td>
                  <td style={{padding:"13px",color:C.green,fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(d.net)}</td>
                  <td style={{padding:"13px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={ev=>{ev.stopPropagation();setEditing(e);}} style={{background:C.borderB,color:C.muted,border:"none",padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}>Edit</button>
                      <button onClick={ev=>{ev.stopPropagation();remove(e.id);}} style={{background:C.redG,color:C.red,border:`1px solid ${C.red}33`,padding:"4px 10px",borderRadius:6,fontSize:11,cursor:"pointer"}}>Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot style={{background:C.surf}}>
            <tr>
              <td colSpan={4} style={{padding:"13px",color:C.muted,fontSize:12,fontWeight:700}}>TOTALS — {employees.length} employees</td>
              {[totals.g,totals.p,totals.n,totals.net].map((v,i)=>(
                <td key={i} style={{padding:"13px",color:i===3?C.green:C.text,fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmt(v)}</td>
              ))}
              <td colSpan={2}/>
            </tr>
          </tfoot>
        </table>
      </div>

      {(adding || editing) && (
        <EmployeeModal emp={editing} onSave={handleSave} onClose={()=>{setAdding(false);setEditing(null);}}/>
      )}

      {payslip && (()=>{
        const g=getGross(payslip), d=calcAll(g,getAdj(payslip));
        return (
          <Modal title={`Pay Slip — ${payslip.name}`} onClose={()=>setPayslip(null)}>
            <div style={{background:C.surf,borderRadius:10,padding:16,marginBottom:18,display:"flex",gap:24,flexWrap:"wrap"}}>
              <div><div style={{color:C.muted,fontSize:10,textTransform:"uppercase"}}>Employee</div><div style={{color:C.text,fontWeight:700,fontSize:15}}>{payslip.name}</div><div style={{color:C.muted,fontSize:12}}>{getTitle(payslip)} · {payslip.department||""}</div></div>
              <div><div style={{color:C.muted,fontSize:10,textTransform:"uppercase"}}>KRA PIN</div><div style={{color:C.text,fontWeight:600,fontSize:13,fontFamily:"monospace"}}>{payslip.kraPin||"N/A"}</div></div>
              <div><div style={{color:C.muted,fontSize:10,textTransform:"uppercase"}}>NSSF No.</div><div style={{color:C.text,fontWeight:600,fontSize:13,fontFamily:"monospace"}}>{payslip.nssfNo||"N/A"}</div></div>
              <div><div style={{color:C.muted,fontSize:10,textTransform:"uppercase"}}>Bank</div><div style={{color:C.text,fontWeight:600,fontSize:13}}>{payslip.bankName||"N/A"}</div><div style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>{payslip.accountNo||""}</div></div>
            </div>
            {/* Earnings breakdown */}
            {(payslip.basicSalary||payslip.housingAllowance||payslip.transportAllowance)>0 && (
              <div style={{marginBottom:12}}>
                <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Earnings</div>
                {[["Basic Salary",payslip.basicSalary||0],["Housing Allowance",payslip.housingAllowance||0],["Transport Allowance",payslip.transportAllowance||0],["Other Allowances",payslip.otherAllowances||0]].filter(([,v])=>v>0).map(([l,v])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}22`}}>
                    <span style={{color:C.muted,fontSize:12,paddingLeft:12}}>{l}</span><span style={{color:C.green,fontSize:12,fontWeight:600}}>{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {[["Gross Salary",g,C.text],["Less: NSSF (Phase 4)",-d.nssf,C.blue],["Less: SHIF (2.75%)",-d.shif,C.gold],["Less: AHL (1.5%)",-d.ahl,C.purple]].map(([l,v,c])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                <span style={{color:C.muted,fontSize:13}}>{l}</span><span style={{color:c,fontSize:13,fontWeight:600}}>{v<0?`(${fmt(Math.abs(v))})`:fmt(v)}</span>
              </div>
            ))}
            {d.pensionDed>0 && <div style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:13}}>Less: Pension (pre-tax)</span><span style={{color:C.blue,fontSize:13,fontWeight:600}}>({fmt(d.pensionDed)})</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",padding:"9px 6px",margin:"2px -6px",background:C.borderB+"55",borderRadius:6}}>
              <span style={{color:C.text,fontSize:12,fontStyle:"italic",fontWeight:600}}>= Taxable Income</span><span style={{color:C.text,fontSize:13,fontWeight:700}}>{fmt(d.taxableIncome)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:13}}>Less: PAYE (net of reliefs)</span><span style={{color:C.red,fontSize:13,fontWeight:600}}>({fmt(d.paye)})</span></div>
            {d.helb>0 && <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:12,paddingLeft:8}}>Less: HELB</span><span style={{color:C.red,fontSize:12}}>({fmt(d.helb)})</span></div>}
            {d.other>0 && <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:12,paddingLeft:8}}>Less: Other Deductions</span><span style={{color:C.red,fontSize:12}}>({fmt(d.other)})</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",padding:"18px 0 4px"}}>
              <span style={{color:C.text,fontWeight:700,fontSize:15}}>Net Pay</span>
              <span style={{color:C.green,fontSize:26,fontWeight:800,fontFamily:"'Fraunces',serif"}}>{fmt(d.net)}</span>
            </div>
            <div style={{marginTop:14,padding:14,background:C.greenG,border:`1px solid ${C.greenD}44`,borderRadius:10}}>
              <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Employer Obligations</div>
              <div style={{display:"flex",gap:24}}>
                <div><div style={{color:C.muted,fontSize:11}}>NSSF Employer</div><div style={{color:C.text,fontWeight:600}}>{fmt(d.nssf)}</div></div>
                <div><div style={{color:C.muted,fontSize:11}}>AHL Employer</div><div style={{color:C.text,fontWeight:600}}>{fmt(d.ahl)}</div></div>
                <div><div style={{color:C.muted,fontSize:11}}>Total Cost to Company</div><div style={{color:C.green,fontWeight:700}}>{fmt(g+d.nssf+d.ahl)}</div></div>
              </div>
            </div>
            <div style={{marginTop:12,display:"flex",gap:10}}>
              <button onClick={()=>setEditing(payslip)} style={{flex:1,background:C.surf,color:C.text,border:`1px solid ${C.border}`,padding:"10px",borderRadius:9,fontWeight:600,fontSize:13,cursor:"pointer"}}>Edit Employee</button>
              <button onClick={()=>setPayslip(null)} style={{flex:1,background:C.greenD,color:"#000",border:"none",padding:"10px",borderRadius:9,fontWeight:700,fontSize:13,cursor:"pointer"}}>Done</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── CALCULATOR ───────────────────────────────────────────────────────────────
function AdjInput({label,sublabel,value,onChange,max,color}) {
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <div><div style={{color:C.text,fontSize:12,fontWeight:600}}>{label}</div>{sublabel&&<div style={{color:C.muted,fontSize:10}}>{sublabel}</div>}</div>
        <span style={{color:color||C.green,fontSize:12,fontWeight:700}}>{value>0?fmt(value):"—"}</span>
      </div>
      <input type="range" min={0} max={max||50000} step={100} value={value} onChange={e=>onChange(Number(e.target.value))} style={{width:"100%",accentColor:color||C.green}}/>
    </div>
  );
}
function Calculator() {
  const [gross,setGross]=useState(70000);
  const [months,setMonths]=useState(1);
  const [tab,setTab]=useState("standard");
  const [adj,setAdj]=useState({insuranceRelief:0,mortgageRelief:0,postRetirementRelief:0,disabilityExempt:0,carBenefit:0,clubFees:0,loanFringe:0,helbDeduction:0,otherDeductions:0,pensionPreTax:0});
  const setA=(k,v)=>setAdj(a=>({...a,[k]:v}));
  const d=calcAll(gross,adj);
  const Row=({label,val,color,bold,indent})=>(
    <div style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${C.border}33`}}>
      <span style={{color:C.muted,fontSize:indent?11:13,paddingLeft:indent?14:0}}>{label}</span>
      <span style={{color:color||C.text,fontSize:indent?11:13,fontWeight:bold?700:600,fontVariantNumeric:"tabular-nums"}}>{val}</span>
    </div>
  );
  const Divider=({label,val})=>(
    <div style={{display:"flex",justifyContent:"space-between",padding:"9px 6px",margin:"2px -6px",background:C.borderB+"55",borderRadius:6}}>
      <span style={{color:C.text,fontSize:12,fontStyle:"italic",fontWeight:600}}>{label}</span>
      <span style={{color:C.text,fontSize:13,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{val}</span>
    </div>
  );
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:22}}>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24}}>
          <SecTitle>Gross Monthly Salary</SecTitle>
          <input type="number" value={gross} onChange={e=>setGross(Number(e.target.value)||0)}
            style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:10,padding:"14px 16px",color:C.green,fontSize:30,fontWeight:800,outline:"none",boxSizing:"border-box",fontFamily:"'Fraunces',serif"}}/>
          <input type="range" min={10000} max={500000} step={1000} value={gross} onChange={e=>setGross(Number(e.target.value))} style={{width:"100%",marginTop:12}}/>
          <div style={{display:"flex",justifyContent:"space-between",color:C.dim,fontSize:11,marginTop:4}}><span>KES 10,000</span><span>KES 500,000</span></div>
          <div style={{marginTop:16}}>
            <label style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:8}}>Projection Period</label>
            <div style={{display:"flex",gap:8}}>
              {[1,3,6,12].map(m=>(
                <button key={m} onClick={()=>setMonths(m)} style={{flex:1,padding:"9px",borderRadius:8,border:`1px solid ${months===m?C.greenD:C.border}`,background:months===m?C.greenG:"transparent",color:months===m?C.green:C.muted,fontWeight:months===m?700:500,fontSize:12,cursor:"pointer"}}>{m===12?"Annual":`${m}mo`}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[["standard","Standard"],["reliefs","Reliefs"],["bik","Benefits & Deductions"]].map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${tab===t?C.greenD:C.border}`,background:tab===t?C.greenG:"transparent",color:tab===t?C.green:C.muted,fontWeight:tab===t?600:400,fontSize:12,cursor:"pointer"}}>{l}</button>
            ))}
          </div>
          {tab==="standard" && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <AdjInput label="Pension / Provident Fund" sublabel="Pre-PAYE deduction · max KES 30,000/mo" value={adj.pensionPreTax} onChange={v=>setA("pensionPreTax",v)} max={30000} color={C.blue}/>
            </div>
          )}
          {tab==="reliefs" && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <AdjInput label="Insurance Relief" sublabel="15% of premiums · max KES 5,000/mo" value={adj.insuranceRelief} onChange={v=>setA("insuranceRelief",v)} max={5000}/>
              <AdjInput label="Mortgage Interest Relief" sublabel="Max KES 30,000/mo (Finance Act 2025)" value={adj.mortgageRelief} onChange={v=>setA("mortgageRelief",v)} max={30000}/>
              <AdjInput label="Post-Retirement Medical Relief" sublabel="Max KES 15,000/mo (Finance Act 2023)" value={adj.postRetirementRelief} onChange={v=>setA("postRetirementRelief",v)} max={15000}/>
              <AdjInput label="Disability Exemption (PWD)" sublabel="First KES 150,000/mo exempt" value={adj.disabilityExempt} onChange={v=>setA("disabilityExempt",v)} max={150000}/>
            </div>
          )}
          {tab==="bik" && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{color:C.gold,fontSize:11,padding:"8px 10px",background:C.goldG,borderRadius:7}}>⚠ Benefits-in-Kind increase taxable income.</div>
              <AdjInput label="Company Car Benefit" sublabel="Taxable value added to gross" value={adj.carBenefit} onChange={v=>setA("carBenefit",v)} max={30000} color={C.gold}/>
              <AdjInput label="Club Fees (Employer-Paid)" sublabel="Taxable benefit-in-kind" value={adj.clubFees} onChange={v=>setA("clubFees",v)} max={10000} color={C.gold}/>
              <AdjInput label="Low-Interest Loan Fringe" sublabel="Difference vs market rate" value={adj.loanFringe} onChange={v=>setA("loanFringe",v)} max={10000} color={C.gold}/>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                <AdjInput label="HELB Deduction" sublabel="Min KES 1,500/mo" value={adj.helbDeduction} onChange={v=>setA("helbDeduction",v)} max={10000} color={C.red}/>
                <AdjInput label="Other Deductions" sublabel="SACCO, advance, etc." value={adj.otherDeductions} onChange={v=>setA("otherDeductions",v)} max={50000} color={C.red}/>
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <div style={{background:`linear-gradient(160deg,${C.card},#091a0f)`,border:`1px solid ${C.greenD}55`,borderRadius:14,padding:24}}>
          <SecTitle>Full Pay Slip {months>1?`— ${months}-Month Projection`:""}</SecTitle>
          <Row label="Gross Salary" val={fmt(gross*months)} color={C.text} bold/>
          <div style={{margin:"4px 0",paddingTop:2}}>
            <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Statutory Deductible</div>
            <Row label="NSSF — Phase 4 (6%, max 6,480)" val={`(${fmt(d.nssf*months)})`} color={C.blue} indent/>
            <Row label="SHIF — SHA (2.75%)" val={`(${fmt(d.shif*months)})`} color={C.gold} indent/>
            <Row label="AHL — Housing Levy (1.5%)" val={`(${fmt(d.ahl*months)})`} color={C.purple} indent/>
            {d.pensionDed>0 && <Row label="Pension Pre-Tax" val={`(${fmt(d.pensionDed*months)})`} color={C.blue} indent/>}
            {d.disabilityExempt>0 && <Row label="Disability Exemption" val={`(${fmt(d.disabilityExempt*months)})`} color={C.green} indent/>}
            {d.bik>0 && <Row label="Benefits-in-Kind (added)" val={`+${fmt(d.bik*months)}`} color={C.gold} indent/>}
          </div>
          <Divider label="= Taxable Income" val={fmt(d.taxableIncome*months)}/>
          <div style={{margin:"4px 0",paddingTop:2}}>
            <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4,marginTop:6}}>PAYE Bands</div>
            {d.payeBands.map((b,i)=><Row key={i} label={`Band ${i+1} @ ${(b.rate*100).toFixed(1)}%`} val={fmt(b.tax*months)} color={C.muted} indent/>)}
            <Row label="Gross PAYE" val={fmt(d.grossPAYE*months)} color={C.red} bold/>
            <Row label="Less: Personal Relief" val={`(${fmt(d.personalRelief*months)})`} color={C.green} indent/>
            {d.insuranceRelief>0 && <Row label="Less: Insurance Relief" val={`(${fmt(d.insuranceRelief*months)})`} color={C.green} indent/>}
            {d.mortgageRelief>0 && <Row label="Less: Mortgage Relief" val={`(${fmt(d.mortgageRelief*months)})`} color={C.green} indent/>}
            {d.postRetirementRelief>0 && <Row label="Less: Post-Retirement" val={`(${fmt(d.postRetirementRelief*months)})`} color={C.green} indent/>}
          </div>
          <Divider label="= PAYE Payable" val={`(${fmt(d.paye*months)})`}/>
          {(d.helb>0||d.other>0) && (
            <div style={{marginTop:4}}>
              {d.helb>0 && <Row label="HELB Deduction" val={`(${fmt(d.helb*months)})`} color={C.red} indent/>}
              {d.other>0 && <Row label="Other Deductions" val={`(${fmt(d.other*months)})`} color={C.red} indent/>}
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",padding:"16px 0 0",marginTop:6,borderTop:`2px solid ${C.borderB}`}}>
            <span style={{color:C.text,fontWeight:800,fontSize:16,fontFamily:"'Fraunces',serif"}}>Take-Home Pay</span>
            <span style={{color:C.green,fontSize:28,fontWeight:800,fontFamily:"'Fraunces',serif"}}>{fmt(d.net*months)}</span>
          </div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
          <SecTitle style={{fontSize:14}}>Effective Rates</SecTitle>
          {[["Gross PAYE Rate",gross>0?((d.grossPAYE/gross)*100).toFixed(2):"0.00",C.red],["Net PAYE Rate",gross>0?((d.paye/gross)*100).toFixed(2):"0.00",C.gold],["Total Statutory Rate",gross>0?((d.totalStatutory/gross)*100).toFixed(2):"0.00",C.purple],["Net Pay Retention",gross>0?((d.net/gross)*100).toFixed(2):"100.00",C.green]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}33`}}>
              <span style={{color:C.muted,fontSize:12}}>{l}</span>
              <span style={{color:c,fontWeight:700,fontSize:15}}>{v}%</span>
            </div>
          ))}
        </div>
        <div style={{background:C.redG,border:`1px solid ${C.red}44`,borderRadius:12,padding:16}}>
          <div style={{color:C.red,fontWeight:700,fontSize:13,marginBottom:6}}>⚠ 2026 Enforcement Notice</div>
          <div style={{color:C.muted,fontSize:11,lineHeight:1.7}}>
            KRA auto-validates returns against eTIMS data from Jan 2026.<br/>
            Late PAYE: 5% of tax + 1%/mo · SHIF: 2%/mo · AHL: 3%/mo.<br/>
            Deadline: 9th of following month.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FILINGS ──────────────────────────────────────────────────────────────────
function Filings({employees,filings,setFilings}) {
  const [toast,setToast]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const showToast=(m,ok=true)=>{setToast({m,ok});setTimeout(()=>setToast(null),3000);};
  const totals=employees.reduce((a,e)=>{const g=getGross(e),d=calcAll(g,getAdj(e));return{paye:a.paye+d.paye,nssf:a.nssf+d.nssf,shif:a.shif+d.shif,ahl:a.ahl+d.ahl};},{paye:0,nssf:0,shif:0,ahl:0});
  const obligations=[
    {code:"paye",name:"PAYE Income Tax",portal:"KRA iTax",color:C.green,amount:totals.paye,paybill:"222222",icon:"📋",account:"Company PIN"},
    {code:"nssf",name:"NSSF (Phase 4)",portal:"NSSF Portal",color:C.blue,amount:totals.nssf*2,paybill:"200777",icon:"🛡",account:"NSSF Employer No."},
    {code:"shif",name:"SHIF (SHA)",portal:"SHA Portal",color:C.gold,amount:totals.shif,paybill:"363636",icon:"🏥",account:"SHA Employer No."},
    {code:"ahl",name:"Affordable Housing Levy",portal:"KRA iTax",color:C.purple,amount:totals.ahl*2,paybill:"222222",icon:"🏠",account:"Company PIN"},
  ];
  const periods=Object.keys(filings).reverse();
  const currentPeriod=periods[0];
  const periodStatus=filings[currentPeriod]||{};
  const allFiled=Object.values(periodStatus).every(v=>v==="filed");
  const markFiled=code=>{setFilings(f=>({...f,[currentPeriod]:{...f[currentPeriod],[code]:"filed"}}));showToast(`${code.toUpperCase()} marked as filed`);};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {toast && <Toast msg={toast.m} ok={toast.ok}/>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14}}>
        {obligations.map(o=>{
          const status=periodStatus[o.code]||"pending";
          return (
            <div key={o.code} style={{background:C.card,border:`1px solid ${status==="filed"?C.greenD+"55":C.border}`,borderRadius:14,padding:20,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,right:0,width:60,height:60,background:`radial-gradient(circle at top right,${o.color}22,transparent 70%)`}}/>
              <div style={{fontSize:24,marginBottom:8}}>{o.icon}</div>
              <div style={{color:C.text,fontWeight:700,fontSize:13,marginBottom:4}}>{o.name}</div>
              <div style={{color:o.color,fontSize:20,fontWeight:800,fontFamily:"'Fraunces',serif",marginBottom:8}}>{fmt(o.amount)}</div>
              <StatusBadge s={status}/>
              <div style={{marginTop:10,color:C.muted,fontSize:11}}>{o.portal}</div>
              <div style={{color:C.muted,fontSize:11,marginTop:3}}>M-Pesa: <span style={{color:C.text,fontFamily:"monospace"}}>{o.paybill}</span></div>
              {status!=="filed" && (
                <button onClick={()=>setConfirm(o)} style={{marginTop:12,width:"100%",background:C.greenG,color:C.green,border:`1px solid ${C.greenD}55`,padding:"8px",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer"}}>Mark as Filed</button>
              )}
            </div>
          );
        })}
      </div>
      {allFiled && <div style={{background:C.greenG,border:`1px solid ${C.greenD}55`,borderRadius:12,padding:16,textAlign:"center",color:C.green,fontWeight:700,fontSize:14}}>✓ All {currentPeriod} obligations filed</div>}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
        <SecTitle>Filing History</SecTitle>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Period","PAYE","NSSF","SHIF","AHL","Overall"].map(h=>(
            <th key={h} style={{color:C.muted,fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",textAlign:"left",padding:"0 12px 12px",borderBottom:`1px solid ${C.border}`}}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {periods.map(p=>{
              const fs=filings[p]||{};
              const vals=["paye","nssf","shif","ahl"].map(k=>fs[k]||"pending");
              const overall=vals.every(v=>v==="filed")?"filed":vals.some(v=>v==="late")?"late":"pending";
              return (
                <tr key={p} style={{borderBottom:`1px solid ${C.border}22`}}>
                  <td style={{padding:"12px",color:C.text,fontWeight:600,fontSize:13}}>{p}</td>
                  {vals.map((v,i)=><td key={i} style={{padding:"12px"}}><StatusBadge s={v}/></td>)}
                  <td style={{padding:"12px"}}><StatusBadge s={overall}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {confirm && (
        <Modal title={`Confirm Filing — ${confirm.name}`} onClose={()=>setConfirm(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {[["Obligation",confirm.name],["Amount Due",fmt(confirm.amount)],["Portal",confirm.portal],["M-Pesa Paybill",confirm.paybill],["Account",confirm.account]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                <span style={{color:C.muted,fontSize:13}}>{k}</span>
                <span style={{color:C.text,fontSize:13,fontWeight:600}}>{v}</span>
              </div>
            ))}
            <button onClick={()=>{markFiled(confirm.code);setConfirm(null);}} style={{background:`linear-gradient(135deg,${C.green},${C.greenD})`,color:"#000",border:"none",padding:14,borderRadius:12,fontWeight:800,fontSize:15,cursor:"pointer",marginTop:8}}>✓ Confirm Filed</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function Reports({employees}) {
  const [report,setReport]=useState(null);
  const totalGross=employees.reduce((s,e)=>s+getGross(e),0);
  const tots=employees.reduce((a,e)=>{const g=getGross(e),d=calcAll(g,getAdj(e));return{paye:a.paye+d.paye,nssf:a.nssf+d.nssf,shif:a.shif+d.shif,ahl:a.ahl+d.ahl,net:a.net+d.net};},{paye:0,nssf:0,shif:0,ahl:0,net:0});
  const reports=[
    {id:"paye",icon:"📋",title:"KRA PAYE Return",desc:"iTax-ready CSV with KRA PIN, gross, PAYE per employee"},
    {id:"nssf",icon:"🛡",title:"NSSF Contribution Schedule",desc:"Employee & employer contributions per member no."},
    {id:"payregister",icon:"📊",title:"Payroll Register",desc:"Full gross-to-net breakdown for all employees"},
    {id:"p9a",icon:"📄",title:"P9A Annual Summary",desc:"KRA P9A form data for annual income tax filing"},
  ];
  const generateCSV=id=>{
    let rows=[], head="";
    if(id==="paye") {
      head="KRA_PIN,Employee_Name,Gross_Pay,Taxable_Income,Gross_PAYE,Personal_Relief,Net_PAYE\n";
      rows=employees.map(e=>{const g=getGross(e),d=calcAll(g,getAdj(e));return`${e.kraPin||"N/A"},${e.name},${g.toFixed(2)},${d.taxableIncome.toFixed(2)},${d.grossPAYE.toFixed(2)},${d.personalRelief.toFixed(2)},${d.paye.toFixed(2)}`;});
    } else if(id==="nssf") {
      head="NSSF_No,Employee_Name,Gross,Employee_Contribution,Employer_Contribution,Total\n";
      rows=employees.map(e=>{const g=getGross(e),n=calcNSSF(g);return`${e.nssfNo||"N/A"},${e.name},${g.toFixed(2)},${n.toFixed(2)},${n.toFixed(2)},${(n*2).toFixed(2)}`;});
    } else if(id==="payregister") {
      head="Employee,KRA_PIN,Department,Gross,NSSF,SHIF,AHL,PAYE,Total_Deductions,Net_Pay\n";
      rows=employees.map(e=>{const g=getGross(e),d=calcAll(g,getAdj(e));return`${e.name},${e.kraPin||"N/A"},${e.department||""},${g.toFixed(2)},${d.nssf.toFixed(2)},${d.shif.toFixed(2)},${d.ahl.toFixed(2)},${d.paye.toFixed(2)},${d.totalDeductions.toFixed(2)},${d.net.toFixed(2)}`;});
    } else {
      head="Employee,KRA_PIN,Annual_Gross,Annual_PAYE,Annual_NSSF,Annual_SHIF,Annual_AHL,Annual_Net\n";
      rows=employees.map(e=>{const g=getGross(e),d=calcAll(g,getAdj(e));return`${e.name},${e.kraPin||"N/A"},${(g*12).toFixed(2)},${(d.paye*12).toFixed(2)},${(d.nssf*12).toFixed(2)},${(d.shif*12).toFixed(2)},${(d.ahl*12).toFixed(2)},${(d.net*12).toFixed(2)}`;});
    }
    return head+rows.join("\n");
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
        {[["Total Payroll",fmt(totalGross),"💼",C.green],["PAYE Payable",fmt(tots.paye),"📋",C.blue],["SHIF + NSSF",fmt(tots.shif+tots.nssf*2),"🏥",C.gold],["Net Pay",fmt(tots.net),"✅",C.green]].map(([l,v,i,c])=>(
          <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
            <div style={{fontSize:20,marginBottom:6}}>{i}</div>
            <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
            <div style={{color:c,fontSize:17,fontWeight:800,fontFamily:"'Fraunces',serif",marginTop:4}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {reports.map(r=>(
          <div key={r.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:22}}>
            <div style={{fontSize:28,marginBottom:10}}>{r.icon}</div>
            <div style={{color:C.text,fontWeight:700,fontSize:14,marginBottom:4}}>{r.title}</div>
            <div style={{color:C.muted,fontSize:12,marginBottom:16}}>{r.desc}</div>
            <button onClick={()=>setReport({id:r.id,title:r.title,csv:generateCSV(r.id)})}
              style={{background:C.greenG,color:C.green,border:`1px solid ${C.greenD}44`,padding:"9px 18px",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>Generate Report</button>
          </div>
        ))}
      </div>
      {report && (
        <Modal title={report.title} onClose={()=>setReport(null)}>
          <div style={{background:C.surf,borderRadius:10,padding:16,fontFamily:"monospace",fontSize:11,color:C.muted,whiteSpace:"pre",overflowX:"auto",maxHeight:300,marginBottom:16}}>{report.csv}</div>
          <div style={{color:C.muted,fontSize:12,marginTop:4}}>Copy and paste into the KRA/NSSF/SHA portal CSV template.</div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function Settings({settings,setSettings,account,onLogout}) {
  const [local,setLocal]=useState({...settings});
  const [toast,setToast]=useState(null);
  const save=async()=>{setSettings(local);await storageSet("malipo:settings",local);setToast({m:"Settings saved",ok:true});setTimeout(()=>setToast(null),3000);};
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20,maxWidth:600}}>
      {toast && <Toast msg={toast.m} ok={toast.ok}/>}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
        <SecTitle>Company / Employer Details</SecTitle>
        {[{l:"Company Name",k:"company"},{l:"KRA PIN",k:"pin"},{l:"NSSF Employer No.",k:"nssf"},{l:"SHA Employer No.",k:"sha"},{l:"M-Pesa Paybill",k:"paybill"},{l:"Finance Email",k:"email",t:"email"}].map(f=>(
          <div key={f.k} style={{marginBottom:14}}>
            <label style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase",display:"block",marginBottom:5}}>{f.l}</label>
            <input type={f.t||"text"} value={local[f.k]||""} onChange={e=>setLocal({...local,[f.k]:e.target.value})}
              style={{width:"100%",background:C.surf,border:`1px solid ${C.borderB}`,borderRadius:8,padding:"9px 12px",color:C.text,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
        ))}
      </div>
      {account && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
          <SecTitle>Account</SecTitle>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{color:C.text,fontWeight:600}}>{account.contactName||"Account holder"}</div><div style={{color:C.muted,fontSize:12}}>{account.email} · {account.role}</div></div>
            <button onClick={onLogout} style={{background:C.redG,color:C.red,border:`1px solid ${C.red}33`,padding:"7px 16px",borderRadius:8,fontWeight:600,fontSize:12,cursor:"pointer"}}>Sign Out</button>
          </div>
        </div>
      )}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
        <SecTitle>Deadline Reminders</SecTitle>
        {[{label:"Remind me 7 days before",k:"rem7"},{label:"Remind me 3 days before",k:"rem3"},{label:"Reminder on deadline day",k:"rem0"},{label:"Email reminders",k:"email_rem"}].map(opt=>(
          <div key={opt.k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:`1px solid ${C.border}33`}}>
            <span style={{color:C.text,fontSize:13}}>{opt.label}</span>
            <div onClick={()=>setLocal({...local,[opt.k]:!local[opt.k]})} style={{width:44,height:24,borderRadius:99,background:local[opt.k]?C.green:C.border,cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
              <div style={{width:18,height:18,background:"#fff",borderRadius:"50%",position:"absolute",top:3,left:local[opt.k]?23:3,transition:"left 0.2s"}}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:28}}>
        <SecTitle>Filing Year</SecTitle>
        <div style={{display:"flex",gap:10}}>
          {["2023/24","2024/25","2025/26"].map(y=>(
            <button key={y} onClick={()=>setLocal({...local,year:y})} style={{flex:1,padding:"10px",borderRadius:9,border:`1px solid ${local.year===y?C.green:C.border}`,background:local.year===y?C.greenG:"transparent",color:local.year===y?C.green:C.muted,fontWeight:600,fontSize:13,cursor:"pointer"}}>{y}</button>
          ))}
        </div>
      </div>
      <button onClick={save} style={{background:`linear-gradient(135deg,${C.green},${C.greenD})`,color:"#000",border:"none",padding:"14px",borderRadius:12,fontWeight:800,fontSize:15,cursor:"pointer"}}>Save Settings</button>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const NAVS=[{id:"dashboard",label:"Dashboard",icon:"◉"},{id:"employees",label:"Employees",icon:"◎"},{id:"calculator",label:"Calculator",icon:"◈"},{id:"filings",label:"Filings",icon:"◷"},{id:"reports",label:"Reports",icon:"◫"},{id:"settings",label:"Settings",icon:"◬"}];

export default function App() {
  const [loaded,setLoaded]=useState(false);
  const [account,setAccount]=useState(null);
  const [tab,setTab]=useState("dashboard");
  const [employees,setEmployees]=useState(SEED_EMPLOYEES);
  const [filings,setFilings]=useState(INIT_FILINGS);
  const [settings,setSettings]=useState(INIT_SETTINGS);
  const [toast,setToast]=useState(null);

  // Load from storage on mount
  useEffect(()=>{
    (async()=>{
      const acct=await storageGet("malipo:account");
      if(acct) setAccount(acct);
      const emps=await storageGet("malipo:employees");
      if(emps && emps.length>0) setEmployees(emps);
      const sett=await storageGet("malipo:settings");
      if(sett) setSettings(sett);
      const fil=await storageGet("malipo:filings");
      if(fil) setFilings(fil);
      setLoaded(true);
    })();
  },[]);

  // Persist employees
  useEffect(()=>{ if(loaded) storageSet("malipo:employees",employees); },[employees,loaded]);
  // Persist filings
  useEffect(()=>{ if(loaded) storageSet("malipo:filings",filings); },[filings,loaded]);

  const handleAuth=useCallback((acct,isNew)=>{
    setAccount(acct);
    if(isNew) { setToast({m:`Welcome, ${acct.contactName||acct.companyName}!`,ok:true}); setTimeout(()=>setToast(null),3500); }
  },[]);

  const handleLogout=()=>{setAccount(null);};

  if(!loaded) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sora',system-ui,sans-serif"}}>
      <div style={{color:C.muted,fontSize:14}}>Loading Malipo…</div>
    </div>
  );

  if(!account) return <AuthScreen onAuth={handleAuth}/>;

  const dl=getDaysLeft(), uc=dl.days<=3?C.red:dl.days<=7?C.gold:C.green;
  const pendingCount=Object.values(filings["Mar-25"]||{}).filter(v=>v==="pending").length;
  const initials=(account.contactName||account.companyName||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();

  return (
    <div style={{display:"flex",height:"100vh",background:C.bg,color:C.text,fontFamily:"'Sora','DM Sans',system-ui,sans-serif",overflow:"hidden"}}>
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
      {toast && <Toast msg={toast.m} ok={toast.ok}/>}

      {/* SIDEBAR */}
      <div style={{width:220,background:C.surf,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"26px 22px 22px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,background:`linear-gradient(135deg,${C.green},${C.greenD})`,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:`0 4px 18px ${C.greenG}`}}>🇰🇪</div>
            <div><div style={{color:C.text,fontWeight:800,fontSize:16,fontFamily:"'Fraunces',serif",lineHeight:1}}>Malipo</div><div style={{color:C.muted,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase"}}>Compliance Suite</div></div>
          </div>
        </div>
        <div style={{padding:"14px 22px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{color:C.muted,fontSize:10,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:3}}>Company</div>
          <div style={{color:C.text,fontSize:13,fontWeight:600}}>{settings.company}</div>
          <div style={{color:C.muted,fontSize:11,fontFamily:"monospace"}}>{settings.pin}</div>
        </div>
        <nav style={{padding:"14px 10px",flex:1}}>
          {NAVS.map(n=>{
            const active=tab===n.id;
            return (
              <button key={n.id} onClick={()=>setTab(n.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"10px 13px",borderRadius:10,border:"none",cursor:"pointer",marginBottom:2,textAlign:"left",background:active?C.greenG:"transparent",color:active?C.green:C.muted,fontWeight:active?600:400,fontSize:13,transition:"all 0.15s",borderLeft:`3px solid ${active?C.green:"transparent"}`}}
                onMouseEnter={e=>{if(!active)e.currentTarget.style.background=C.border+"44"}}
                onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:15}}>{n.icon}</span>{n.label}</div>
                {n.id==="filings"&&pendingCount>0&&<span style={{background:C.red,color:"#fff",borderRadius:99,fontSize:10,fontWeight:700,padding:"1px 7px"}}>{pendingCount}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{margin:"0 10px 16px",background:uc+"18",border:`1px solid ${uc}44`,borderRadius:12,padding:14}}>
          <div style={{color:uc,fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:3}}>Next Deadline</div>
          <div style={{color:C.text,fontSize:28,fontWeight:800,fontFamily:"'Fraunces',serif",lineHeight:1}}>{dl.days} <span style={{fontSize:13,fontWeight:400,color:C.muted}}>days</span></div>
          <div style={{color:C.muted,fontSize:11,marginTop:3}}>9th of month filing</div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{background:C.surf,borderBottom:`1px solid ${C.border}`,padding:"0 30px",height:60,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{color:C.text,fontWeight:700,fontSize:16,fontFamily:"'Fraunces',serif"}}>{NAVS.find(n=>n.id===tab)?.label}</div>
            <div style={{color:C.muted,fontSize:11}}>{new Date().toLocaleDateString("en-KE",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {pendingCount>0&&<button onClick={()=>setTab("filings")} style={{background:C.redG,color:C.red,border:`1px solid ${C.red}44`,padding:"8px 16px",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer"}}>⚠ {pendingCount} Pending</button>}
            <button onClick={()=>setTab("filings")} style={{background:C.greenG,color:C.green,border:`1px solid ${C.greenD}55`,padding:"8px 18px",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer"}}>📤 File Returns</button>
            <div onClick={()=>setTab("settings")} style={{width:34,height:34,background:C.greenD,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#000",cursor:"pointer",title:account.email}}>{initials}</div>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"26px 30px"}}>
          {tab==="dashboard"  && <Dashboard employees={employees}/>}
          {tab==="employees"  && <Employees employees={employees} setEmployees={setEmployees}/>}
          {tab==="calculator" && <Calculator/>}
          {tab==="filings"    && <Filings employees={employees} filings={filings} setFilings={setFilings}/>}
          {tab==="reports"    && <Reports employees={employees}/>}
          {tab==="settings"   && <Settings settings={settings} setSettings={setSettings} account={account} onLogout={handleLogout}/>}
        </div>
      </div>
    </div>
  );
}
