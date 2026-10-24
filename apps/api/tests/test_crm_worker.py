from datetime import datetime, timezone

import mongomock
import pytest
from bson import ObjectId

from app.integrations.crm import outbox, worker
from app.integrations.crm.client import CrmRejected, CrmUnavailable

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def db():
    return mongomock.MongoClient().db


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com")
    monkeypatch.setenv("CRM_API_KEY", "secret-key")


def _company(db, **extra):
    cid = ObjectId()
    db.companies.insert_one({"_id": cid, "name": "Sol", "status": "new", **extra})
    db.contacts.insert_one({"company_id": str(cid), "type": "email", "value": "a@sol.mx"})
    outbox.enqueue(db, str(cid))
    return cid


class Fake:
    def __init__(self, exc=None):
        self.exc, self.companies, self.leads = exc, [], []

    def company(self, payload):
        if self.exc:
            raise self.exc
        self.companies.append(payload)
        return {}

    def lead(self, payload):
        self.leads.append(payload)
        return {}


def _status(db, cid):
    return db.crm_outbox.find_one({"_id": str(cid)})


def test_sends_company_then_each_person_and_marks_sent(db):
    cid = _company(db)
    db.person_contacts.insert_many([
        {"company_id": str(cid), "name": "Ana Lopez"},
        {"company_id": str(cid), "name": "Beto Ruiz"},
    ])
    fake = Fake()
    assert worker.process_one(db, fake.company, fake.lead) is True
    assert len(fake.companies) == 1 and len(fake.leads) == 2
    assert _status(db, cid)["status"] == "sent"
    assert worker.process_one(db, fake.company, fake.lead) is False


def test_deleted_or_ineligible_company_is_skipped(db):
    gone = ObjectId()
    outbox.enqueue(db, str(gone))
    manual = _company(db, status="manual")
    outbox.enqueue(db, "not-an-objectid")
    fake = Fake()
    while worker.process_one(db, fake.company, fake.lead):
        pass
    assert fake.companies == []
    assert _status(db, gone)["status"] == "skipped"
    assert _status(db, manual)["status"] == "skipped"
    assert _status(db, "not-an-objectid")["status"] == "skipped"


def test_unavailable_crm_schedules_retry(db):
    cid = _company(db)
    fake = Fake(CrmUnavailable("/ingest/companies: HTTP 503"))
    assert worker.process_one(db, fake.company, fake.lead) is True
    doc = _status(db, cid)
    assert doc["status"] == "pending" and doc["attempts"] == 1 and "503" in doc["last_error"]


def test_unexpected_error_retries_without_leaking_key(db):
    cid = _company(db)
    fake = Fake(ValueError("bad json secret-key"))
    worker.process_one(db, fake.company, fake.lead)
    doc = _status(db, cid)
    assert doc["status"] == "pending"
    assert "secret-key" not in doc["last_error"]


def test_rejected_payload_is_failed_not_retried(db):
    cid = _company(db)
    fake = Fake(CrmRejected("/ingest/companies: HTTP 422"))
    worker.process_one(db, fake.company, fake.lead)
    doc = _status(db, cid)
    assert doc["status"] == "failed" and "422" in doc["last_error"]


def test_start_returns_none_when_disabled(monkeypatch):
    monkeypatch.delenv("CRM_INGEST_URL")
    assert worker.start_crm_sync_worker() is None


def test_start_returns_stop_event_and_stops(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, "drain", lambda db: calls.append(1) or 0)
    monkeypatch.setattr("app.database.MongoDBManager", lambda: type("M", (), {"db": None})())
    stop = worker.start_crm_sync_worker()
    assert stop is not None
    stop.set()


def test_unavailable_never_becomes_failed(db):
    cid = _company(db)
    fake = Fake(CrmUnavailable("/ingest/companies: HTTP 503"))
    for _ in range(15):
        db.crm_outbox.update_one({"_id": str(cid)}, {"$set": {"next_attempt_at": T0}})
        worker.process_one(db, fake.company, fake.lead)
    assert _status(db, cid)["status"] == "pending"
    assert _status(db, cid)["attempts"] == 15


def test_unexpected_error_still_fails_at_10(db):
    cid = _company(db)
    fake = Fake(ValueError("boom"))
    for _ in range(10):
        db.crm_outbox.update_one({"_id": str(cid)}, {"$set": {"next_attempt_at": T0}})
        worker.process_one(db, fake.company, fake.lead)
    assert _status(db, cid)["status"] == "failed"


def test_auth_failure_logs_warning(db, caplog):
    _company(db)
    fake = Fake(CrmUnavailable("/ingest/companies: HTTP 401 nope"))
    with caplog.at_level("WARNING", logger="crm_sync"):
        worker.process_one(db, fake.company, fake.lead)
    assert any("401" in r.getMessage() and r.levelname == "WARNING" for r in caplog.records)


def test_objectid_keyed_contacts_and_persons_are_found(db):
    cid = ObjectId()
    db.companies.insert_one({"_id": cid, "name": "Sol", "status": "new"})
    db.contacts.insert_one({"company_id": cid, "type": "email", "value": "a@sol.mx"})
    db.person_contacts.insert_one({"company_id": cid, "name": "Ana Lopez"})
    outbox.enqueue(db, str(cid))
    fake = Fake()
    worker.process_one(db, fake.company, fake.lead)
    assert _status(db, cid)["status"] == "sent"
    assert fake.companies[0]["email"] == "a@sol.mx" and len(fake.leads) == 1
