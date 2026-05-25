"""Script para insertar empresas de prueba."""
import sys
sys.path.insert(0, '.')
sys.path.insert(0, 'app')

from app.database import MongoDBManager
from datetime import datetime

db = MongoDBManager()

companies = [
    {
        "company": {
            "name": "Banco Azteca (TEST)",
            "domain": "bancoazteca.com.mx",
            "website": "https://www.bancoazteca.com.mx",
            "industry": "Banca / Servicios Financieros",
            "city": "Ciudad de México",
            "state": "CDMX",
            "has_whatsapp": True,
            "status": "test",
        },
        "whatsapp": "+528000407777",
    },
    {
        "company": {
            "name": "Master (TEST)",
            "domain": "master-test.local",
            "website": "",
            "industry": "Master",
            "city": "Querétaro",
            "state": "QRO",
            "has_whatsapp": True,
            "status": "test",
        },
        "whatsapp": "+524428079840",
    },
]

for entry in companies:
    entry["company"]["created_at"] = datetime.now()
    company_id = db.insert_company(entry["company"])
    contact_id = db.insert_contact({
        "company_id": company_id,
        "type": "whatsapp",
        "value": entry["whatsapp"],
        "is_primary": True,
        "created_at": datetime.now(),
    })
    print(f"✅ {entry['company']['name']}")
    print(f"   company_id : {company_id}")
    print(f"   contact_id : {contact_id}")
    print(f"   whatsapp   : {entry['whatsapp']}")
    print()
