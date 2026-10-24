#!/usr/bin/env python3
"""Encola en crm_outbox los prospectos ya existentes para enviarlos a dtc-crm (una sola vez).

    python scripts/crm_backfill.py          # solo cuenta cuántos encolaría
    python scripts/crm_backfill.py --yes    # los encola; el worker los envía

Requiere CRM_INGEST_URL y CRM_API_KEY; con --yes y sin ellas termina con error.
"""
import argparse
import sys
from pathlib import Path

_API = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(_API / "app"), str(_API)]

from app.integrations.crm import config, mapping, outbox  # noqa: E402

CHUNK = 500
_COMPANY_FIELDS = {"name": 1, "status": 1, "source": 1, "location_mismatch": 1, "industry_mismatch": 1}
_CONTACT_FIELDS = {"company_id": 1, "type": 1, "value": 1}


def select_company_ids(db) -> list[str]:
    """Ids (str) de empresas elegibles para el CRM; contactos cargados por lotes."""
    query = {"status": {"$nin": ["manual", "inbound"]}, "source": {"$ne": "inbound_whatsapp"}}
    selected: list[str] = []
    companies = list(db.companies.find(query, _COMPANY_FIELDS))
    for i in range(0, len(companies), CHUNK):
        chunk = companies[i:i + CHUNK]
        by_company: dict[str, list[dict]] = {}
        ids = [str(c["_id"]) for c in chunk]
        ids += [c["_id"] for c in chunk]  # company_id is stored as str or ObjectId
        for contact in db.contacts.find({"company_id": {"$in": ids}}, _CONTACT_FIELDS):
            by_company.setdefault(str(contact["company_id"]), []).append(contact)
        selected += [str(c["_id"]) for c in chunk
                     if mapping.is_eligible(c, by_company.get(str(c["_id"]), []))]
    return selected


def main(argv=None, db=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--yes", action="store_true", help="encola de verdad (sin esto solo cuenta)")
    args = parser.parse_args(argv)
    if db is None:
        from app.database import MongoDBManager
        db = MongoDBManager().db
    ids = select_company_ids(db)
    if not args.yes:
        print(f"{len(ids)} prospectos se encolarían. Usa --yes para encolarlos.")
        return 0
    if not config.enabled():
        print("CRM_INGEST_URL y CRM_API_KEY no están definidas; no se encoló nada.")
        return 1
    for company_id in ids:
        outbox.enqueue(db, company_id)
    print(f"{len(ids)} prospectos encolados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
