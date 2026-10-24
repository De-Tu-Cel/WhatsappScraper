from datetime import datetime, timedelta, timezone

import mongomock
import pytest

from app.integrations.crm import outbox
from app.integrations.crm.outbox import (
    claim_next, counts, enqueue, mark_done, mark_failed, mark_retry,
)

T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def db():
    return mongomock.MongoClient().db


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com")
    monkeypatch.setenv("CRM_API_KEY", "k")
    monkeypatch.setattr(outbox, "_now", lambda: T0)


def _naive(dt):
    return dt.replace(tzinfo=None)


def test_enqueue_is_noop_when_disabled(db, monkeypatch):
    monkeypatch.delenv("CRM_INGEST_URL", raising=False)
    monkeypatch.delenv("CRM_API_KEY", raising=False)
    enqueue(db, "c1")
    assert db.crm_outbox.count_documents({}) == 0


def test_enqueue_ignores_empty_company_id(db, env):
    enqueue(db, "")
    enqueue(db, None)
    assert db.crm_outbox.count_documents({}) == 0


def test_enqueue_creates_pending_doc(db, env):
    enqueue(db, "c1")
    doc = db.crm_outbox.find_one({"_id": "c1"})
    assert doc["status"] == "pending" and doc["attempts"] == 0
    assert _naive(doc["next_attempt_at"]) == _naive(T0)


def test_enqueue_never_raises(env):
    class Boom:
        @property
        def crm_outbox(self):
            raise RuntimeError("db down")

    enqueue(Boom(), "c1")
    enqueue(object(), "c1")


def test_claim_is_exclusive(db, env):
    enqueue(db, "c1")
    a = claim_next(db, now=T0)
    b = claim_next(db, now=T0)
    assert a["_id"] == "c1" and a["status"] == "sending"
    assert b is None


def test_claim_skips_future_next_attempt(db, env):
    enqueue(db, "c1")
    assert claim_next(db, now=T0 - timedelta(seconds=5)) is None


def test_expired_lease_is_reclaimed(db, env):
    enqueue(db, "c1")
    assert claim_next(db, now=T0)["_id"] == "c1"
    assert claim_next(db, now=T0 + timedelta(seconds=299)) is None
    again = claim_next(db, now=T0 + timedelta(seconds=301))
    assert again["_id"] == "c1"


def test_mark_done(db, env):
    enqueue(db, "c1")
    doc = claim_next(db, now=T0)
    mark_done(db, doc, "sent")
    assert db.crm_outbox.find_one({"_id": "c1"})["status"] == "sent"
    assert claim_next(db, now=T0 + timedelta(days=1)) is None
    assert counts(db) == {"sent": 1}


def test_retry_backoff_and_give_up_after_10(db, env):
    enqueue(db, "c1")
    doc = claim_next(db, now=T0)
    mark_retry(db, doc, "boom")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "pending" and row["attempts"] == 1
    assert row["last_error"] == "boom"
    assert _naive(row["next_attempt_at"]) == _naive(T0 + timedelta(seconds=60))
    for _ in range(8):
        mark_retry(db, claim_next(db, now=T0 + timedelta(days=1)), "boom")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "pending" and row["attempts"] == 9
    assert _naive(row["next_attempt_at"]) == _naive(T0 + timedelta(seconds=3600))
    mark_retry(db, claim_next(db, now=T0 + timedelta(days=1)), "boom")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "failed" and row["attempts"] == 10


def test_mark_failed(db, env):
    enqueue(db, "c1")
    mark_failed(db, claim_next(db, now=T0), "422")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "failed" and row["last_error"] == "422"


def test_reenqueue_after_sent_goes_back_to_pending(db, env):
    enqueue(db, "c1")
    mark_done(db, claim_next(db, now=T0), "sent")
    enqueue(db, "c1")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "pending" and row["attempts"] == 0
    assert claim_next(db, now=T0)["_id"] == "c1"


def test_counts_by_status(db, env):
    enqueue(db, "c1")
    enqueue(db, "c2")
    mark_done(db, claim_next(db, now=T0), "skipped")
    assert counts(db) == {"skipped": 1, "pending": 1}


def test_mark_after_reenqueue_is_ignored(db, env):
    enqueue(db, "c1")
    doc = claim_next(db, now=T0)
    enqueue(db, "c1")
    mark_done(db, doc, "sent")
    assert db.crm_outbox.find_one({"_id": "c1"})["status"] == "pending"


def test_late_mark_from_expired_claim_is_ignored(db, env):
    enqueue(db, "c1")
    first = claim_next(db, now=T0)
    second = claim_next(db, now=T0 + timedelta(seconds=301))
    assert second["_id"] == "c1"
    mark_retry(db, first, "late")
    mark_done(db, first, "sent")
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "sending" and row["attempts"] == 0
    assert row.get("last_error") is None
    mark_done(db, second, "sent")
    assert db.crm_outbox.find_one({"_id": "c1"})["status"] == "sent"


def test_unavailable_retries_never_reach_failed(db, env):
    enqueue(db, "c1")
    for _ in range(15):
        mark_retry(db, claim_next(db, now=T0 + timedelta(days=1)), "down", give_up=False)
    row = db.crm_outbox.find_one({"_id": "c1"})
    assert row["status"] == "pending" and row["attempts"] == 15
    assert _naive(row["next_attempt_at"]) == _naive(T0 + timedelta(seconds=3600))


def test_unavailable_retry_keeps_claim_fencing(db, env):
    enqueue(db, "c1")
    first = claim_next(db, now=T0)
    claim_next(db, now=T0 + timedelta(seconds=301))
    mark_retry(db, first, "late", give_up=False)
    assert db.crm_outbox.find_one({"_id": "c1"})["status"] == "sending"
