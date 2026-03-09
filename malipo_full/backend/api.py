from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import logging
import os
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

store = TemplateStore()
populator = TemplatePopulator(store)

def sanitize_tx(tx):
    # Ensure all money values are floats and not NaNs
    for k, v in tx.items():
        if isinstance(v, float) and isnan(v):
            tx[k] = 0.0
    return tx

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
