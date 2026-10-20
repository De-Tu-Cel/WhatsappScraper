"""El diagnóstico de migración solo lee: detecta duplicados y tipos mezclados sin escribir nada."""
import copy
import importlib.util
from pathlib import Path

import mongomock
from bson import ObjectId

_spec = importlib.util.spec_from_file_location(
    "mongo_migration_audit", Path(__file__).resolve().parents[1] / "scripts" / "mongo_migration_audit.py")
audit_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_mod)


def _seeded_db():
    db = mongomock.MongoClient().db
    company = ObjectId()
    db.companies.insert_many([
        {"_id": company, "domain": "dup.mx"}, {"domain": "dup.mx"}, {"domain": "unico.mx"}, {"domain": None},
    ])
    db.message_logs.insert_many([
        {"message_id": "A", "company_id": str(company)}, {"message_id": "A", "company_id": company},
        {"message_id": "", "company_id": None}, {"message_id": None},
    ])
    return db


def _snapshot(db):
    return {name: sorted((copy.deepcopy(d) for d in db[name].find()), key=lambda d: str(d["_id"]))
            for name in db.list_collection_names()}


def test_audit_finds_unique_conflicts_and_mixed_keys_without_writing():
    db = _seeded_db()
    before = _snapshot(db)
    indexes_before = {n: list(db[n].list_indexes()) for n in db.list_collection_names()}

    report = audit_mod.audit(db, max_ms=5000)

    assert _snapshot(db) == before
    assert {n: list(db[n].list_indexes()) for n in db.list_collection_names()} == indexes_before
    assert report["unique_conflicts"]["companies.domain"]["keys"] == 1
    assert report["unique_conflicts"]["companies.domain"]["extra_docs"] == 1
    # message_id "" y None quedan fuera del universo único, igual que el índice parcial real.
    assert report["unique_conflicts"]["message_logs.message_id"]["keys"] == 1
    assert report["collections"]["companies"]["count"] == 4
    # company_id guardado como texto y como ObjectId: debe salir como tipos mezclados.
    company_types = report["collections"]["message_logs"]["fk_types"]["company_id"]
    assert company_types["string"] == 1 and company_types["objectId"] == 1
    assert "message_logs.company_id" in audit_mod.summarize(report)


def test_summary_never_prints_the_connection_uri_and_flags_problems():
    report = audit_mod.audit(_seeded_db(), max_ms=5000)
    text = audit_mod.summarize(report)
    assert "mongodb://" not in text
    assert "companies.domain" in text and "valores repetidos" in text
