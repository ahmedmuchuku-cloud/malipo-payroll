from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
import logging
import os
import random
import string
from pathlib import Path
from math import isnan

from phase4_excel import TemplateStore, TemplatePopulator

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Malipo Compliance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for verification codes
# In production, use Redis or a database with expiration
VERIFICATION_CODES = {}

class CompanyInfo(BaseModel):
    name: str = ""
    pin: str = ""
    nssf_no: str = ""
    sha_no: str = ""

class GenerateRequest(BaseModel):
    employees: list[dict]
    transactions: list[dict]
    month: int
    year: int
    company_info: CompanyInfo

class RegistrationRequest(BaseModel):
    email: EmailStr
    company: str

class VerificationRequest(BaseModel):
    email: EmailStr
    code: str

store = TemplateStore()
populator = TemplatePopulator(store)

def sanitize_tx(tx):
    # Ensure all money values are floats and not NaNs
    for k, v in tx.items():
        if isinstance(v, float) and isnan(v):
            tx[k] = 0.0
    return tx

import requests

RESEND_API_KEY = "re_JSzXgHso_KdnQcU8cotMGFWQcauQvRfiq"

def send_verification_email(to_email: str, code: str):
    """
    Sends a real verification email using the Resend API.
    If RESEND_API_KEY is not set, it logs the code conspicuously.
    """
    key = RESEND_API_KEY
    if not key:
        logging.warning("=" * 60)
        logging.warning(f" REAL VERIFICATION: RESEND_API_KEY NOT SET.")
        logging.warning(f" Code for {to_email} is: {code}")
        logging.warning("=" * 60)
        return False

    url = "https://api.resend.com/emails"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    
    html_content = f"""
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: #22c55e; color: #fff; width: 48px; height: 48px; line-height: 48px; border-radius: 10px; font-size: 24px;">🇰🇪</div>
            <h2 style="margin-top: 12px; color: #0f172a;">Malipo Verification</h2>
        </div>
        <p style="color: #475569; font-size: 16px; line-height: 1.5;">Enter the following code to verify your administrator account and launch your company portal:</p>
        <div style="background: #f8fafc; padding: 24px; text-align: center; border-radius: 8px; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 0.25em; color: #166534;">{code}</span>
        </div>
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">This code expires in 30 minutes. If you didn't request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0;">
        <p style="text-align: center; color: #64748b; font-size: 13px;">© 2026 Malipo Kenya · malipo.vercel.app</p>
    </div>
    """
    
    payload = {
        "from": "Malipo Auth <auth@updates.malipo.co.ke>",
        "to": [to_email],
        "subject": f"{code} is your Malipo verification code",
        "html": html_content
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload)
        res.raise_for_status()
        logging.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logging.error(f"Failed to send email to {to_email}: {e}")
        return False

@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "1.0.1"}

@app.post("/api/auth/register")
def register_company(req: RegistrationRequest):
    code = "".join(random.choices(string.digits, k=6))
    VERIFICATION_CODES[req.email.lower()] = code
    
    # Real email send attempted if API key exists
    sent = send_verification_email(req.email.lower(), code)
    
    return {
        "success": True, 
        "message": f"Verification code sent to {req.email}",
        "sent_via_email": sent,
        "demo_code": code # Kept for failover/demo visibility
    }

@app.post("/api/auth/verify")
def verify_code(req: VerificationRequest):
    stored_code = VERIFICATION_CODES.get(req.email.lower())
    if not stored_code or stored_code != req.code:
         raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    
    # Success - cleanup
    del VERIFICATION_CODES[req.email.lower()]
    return {"success": True, "message": "Email verified successfully."}

@app.post("/api/generate/{portal}")
def generate_template(portal: str, req: GenerateRequest):
    if portal not in ["kra", "nssf", "shif", "ahl"]:
        raise HTTPException(status_code=400, detail="Invalid portal")
        
    transactions = [sanitize_tx(tx) for tx in req.transactions]
    company_info = req.company_info.dict()

    try:
        if portal == "kra":
            path = populator.populate_kra_paye(transactions, req.month, req.year, company_info)
        elif portal == "nssf":
            path = populator.populate_nssf(transactions, req.month, req.year, company_info)
        elif portal == "shif":
            path = populator.populate_shif(transactions, req.month, req.year, company_info)
        elif portal == "ahl":
            path = populator.populate_ahl(transactions, req.month, req.year, company_info)
            
        return FileResponse(
            path=str(path), 
            filename=path.name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        logging.error(f"Error generating template: {e}")
        raise HTTPException(status_code=500, detail=str(e))
