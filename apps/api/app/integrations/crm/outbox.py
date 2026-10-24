"""Durable outbox for the CRM push (collection `crm_outbox`, `_id` = company id as str).

Two uvicorn workers each run the sync worker, so claiming is one atomic
find_one_and_update; a crashed claimer is recovered when its lease expires.
"""
import logging
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument

from app.integrations.crm import config

log = logging.getLogger("crm_sync")

LEASE_SEC = 120
MAX_ATTEMPTS = 10
BACKOFF_BASE_SEC = 30
BACKOFF_MAX_SEC = 3600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def enqueue(db, company_id) -> None:
    """Queue (or re-queue) a company for push. Never raises."""
    try:
        if not config.enabled() or not company_id:
            return
        now = _now()
        db.crm_outbox.update_one(
            {"_id": str(company_id)},
            {"$set": {"status": "pending", "attempts": 0, "next_attempt_at": now,
                      "lease_until": None, "updated_at": now}},
            upsert=True,
        )
    except Exception:
        log.exception("crm outbox enqueue failed for %r", company_id)


def claim_next(db, now=None):
    """Atomically take one due document (pending, or sending with expired lease)."""
    now = now or _now()
    return db.crm_outbox.find_one_and_update(
        {"$or": [
            {"status": "pending", "next_attempt_at": {"$lte": now}},
            {"status": "sending", "lease_until": {"$lte": now}},
        ]},
        {"$set": {"status": "sending", "lease_until": now + timedelta(seconds=LEASE_SEC),
                  "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )


def _set(db, doc, fields) -> None:
    db.crm_outbox.update_one({"_id": doc["_id"]}, {"$set": {**fields, "updated_at": _now()}})


def mark_done(db, doc, status) -> None:
    if status not in ("sent", "skipped"):
        raise ValueError(f"invalid done status {status!r}")
    _set(db, doc, {"status": status, "lease_until": None, "last_error": None})


def mark_retry(db, doc, error: str) -> None:
    attempts = doc.get("attempts", 0) + 1
    if attempts >= MAX_ATTEMPTS:
        _set(db, doc, {"status": "failed", "attempts": attempts, "lease_until": None,
                       "last_error": error})
        return
    delay = min(BACKOFF_BASE_SEC * 2 ** attempts, BACKOFF_MAX_SEC)
    _set(db, doc, {"status": "pending", "attempts": attempts, "lease_until": None,
                   "last_error": error, "next_attempt_at": _now() + timedelta(seconds=delay)})


def mark_failed(db, doc, error: str) -> None:
    _set(db, doc, {"status": "failed", "lease_until": None, "last_error": error})


STATUSES = ("pending", "sending", "sent", "skipped", "failed")


def counts(db) -> dict:
    """Documents per status (statuses with none are omitted)."""
    found = {s: db.crm_outbox.count_documents({"status": s}) for s in STATUSES}
    return {s: n for s, n in found.items() if n}
