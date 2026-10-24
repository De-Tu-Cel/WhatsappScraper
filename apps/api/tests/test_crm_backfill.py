import importlib.util
from pathlib import Path

import mongomock
import pytest

_spec = importlib.util.spec_from_file_location(
    "crm_backfill", Path(__file__).resolve().parents[1] / "scripts" / "crm_backfill.py")
backfill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backfill)


@pytest.fixture
def db():
    return mongomock.MongoClient().db


def _company(db, **fields):
    cid = db.companies.insert_one({"name": "Acme", **fields}).inserted_id
    return str(cid)


def _contact(db, company_id, kind="whatsapp", value="5215512345678"):
    db.contacts.insert_one({"company_id": company_id, "type": kind, "value": value})


def test_selects_only_eligible_found_prospects(db):
    manual = _company(db, status="manual")
    inbound = _company(db, status="inbound")
    inbound_src = _company(db, source="inbound_whatsapp")
    mismatch = _company(db, status="found", location_mismatch=True)
    no_contact = _company(db, status="found")
    valid = _company(db, status="found")
    for cid in (manual, inbound, inbound_src, mismatch, valid):
        _contact(db, cid)

    assert backfill.select_company_ids(db) == [valid]


def test_loads_contacts_in_chunks(db, monkeypatch):
    monkeypatch.setattr(backfill, "CHUNK", 2)
    ids = [_company(db, status="found") for _ in range(5)]
    for cid in ids:
        _contact(db, cid)

    assert sorted(backfill.select_company_ids(db)) == sorted(ids)


def test_main_without_yes_only_counts(db, monkeypatch, capsys):
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com")
    monkeypatch.setenv("CRM_API_KEY", "k")
    cid = _company(db, status="found")
    _contact(db, cid)

    assert backfill.main([], db=db) == 0
    assert db.crm_outbox.count_documents({}) == 0
    assert "1" in capsys.readouterr().out


def test_main_with_yes_enqueues(db, monkeypatch):
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com")
    monkeypatch.setenv("CRM_API_KEY", "k")
    cid = _company(db, status="found")
    _contact(db, cid)

    assert backfill.main(["--yes"], db=db) == 0
    assert [d["_id"] for d in db.crm_outbox.find()] == [cid]


def test_main_with_yes_fails_when_disabled(db, monkeypatch, capsys):
    monkeypatch.delenv("CRM_INGEST_URL", raising=False)
    monkeypatch.delenv("CRM_API_KEY", raising=False)
    cid = _company(db, status="found")
    _contact(db, cid)

    assert backfill.main(["--yes"], db=db) != 0
    assert db.crm_outbox.count_documents({}) == 0
    assert "CRM_INGEST_URL" in capsys.readouterr().out


def test_objectid_keyed_contacts_are_found(db, monkeypatch):
    from bson import ObjectId
    monkeypatch.setattr(backfill, "CHUNK", 2)
    ids = [_company(db, status="found") for _ in range(3)]
    for cid in ids:
        _contact(db, ObjectId(cid))
    assert sorted(backfill.select_company_ids(db)) == sorted(ids)
