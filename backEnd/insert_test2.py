import sys
sys.path.insert(0, '.')
sys.path.insert(0, 'app')

from app.database import MongoDBManager
from datetime import datetime

db = MongoDBManager()

entries = [
    {
        "company": {
            "name": "Santander (TEST)",
            "domain": "santander.com.mx",
            "website": "https://www.santander.com.mx",
            "industry": "Banca / Servicios Financieros",
            "city": "Ciudad de Mexico",
            "state": "CDMX",
            "has_whatsapp": True,
            "status": "test",
            "created_at": datetime.now(),
        },
        "whatsapp": "+5491122068200",
    },
    {
        "company": {
            "name": "Gilad (TEST - Humano)",
            "domain": "contacto-personal.local",
            "website": "",
            "industry": "Contacto Personal",
            "city": "Monterrey",
            "state": "NL",
            "has_whatsapp": True,
            "status": "test",
            "created_at": datetime.now(),
        },
        "whatsapp": "+5218181205847",
    },
]

for e in entries:
    cid = db.insert_company(e["company"])
    db.insert_contact({
        "company_id": cid,
        "type": "whatsapp",
        "value": e["whatsapp"],
        "is_primary": True,
        "created_at": datetime.now(),
    })
    print("OK:", e["company"]["name"], "->", cid)
