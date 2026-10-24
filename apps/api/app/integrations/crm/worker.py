"""Background worker: drains the CRM outbox and pushes prospects to dtc-crm."""
import logging
import threading

from bson import ObjectId

from app.integrations.crm import client, config, mapping, outbox
from app.integrations.crm.client import CrmRejected, CrmUnavailable

log = logging.getLogger("crm_sync")

INTERVAL_SEC = 30
DRAIN_LIMIT = 50
_ERROR_MAX = 300


def _error_text(exc: Exception) -> str:
    text = f"{type(exc).__name__}: {exc}"
    key = config.api_key()
    if key:
        text = text.replace(key, "***")
    return text[:_ERROR_MAX]


def _load_company(db, company_id: str):
    try:
        oid = ObjectId(company_id)
    except Exception:
        return None
    return db.companies.find_one({"_id": oid})


def _company_filter(company_id: str) -> dict:
    """contacts/person_contacts hold company_id as str or ObjectId."""
    ids = [company_id]
    if ObjectId.is_valid(company_id):
        ids.append(ObjectId(company_id))
    return {"company_id": {"$in": ids}}


def process_one(db, send_company=client.send_company, send_lead=client.send_lead) -> bool:
    """Claim and push one company. False when nothing was due."""
    doc = outbox.claim_next(db)
    if doc is None:
        return False
    try:
        company = _load_company(db, doc["_id"])
        if company is None:
            outbox.mark_done(db, doc, "skipped")
            return True
        contacts = list(db.contacts.find(_company_filter(doc["_id"])))
        if not mapping.is_eligible(company, contacts):
            outbox.mark_done(db, doc, "skipped")
            return True
        persons = list(db.person_contacts.find(_company_filter(doc["_id"])))
        send_company(mapping.company_payload(company, contacts))
        for payload in mapping.lead_payloads(company, contacts, persons):
            send_lead(payload)
        outbox.mark_done(db, doc, "sent")
    except CrmRejected as exc:
        outbox.mark_failed(db, doc, _error_text(exc))
    except CrmUnavailable as exc:
        text = _error_text(exc)
        if "HTTP 401" in text or "HTTP 403" in text:
            log.warning("crm auth failure (check CRM_API_KEY / CRM_INGEST_URL): %s", text)
        outbox.mark_retry(db, doc, text, give_up=False)
    except Exception as exc:
        outbox.mark_retry(db, doc, _error_text(exc))
    return True


def drain(db) -> int:
    done = 0
    while done < DRAIN_LIMIT and process_one(db):
        done += 1
    return done


def _loop(stop: threading.Event) -> None:
    last = None
    while not stop.is_set():
        try:
            from app.database import MongoDBManager

            db = MongoDBManager().db
            if drain(db):
                current = outbox.counts(db)
                if current != last:
                    log.info("crm outbox: %s", current)
                    last = current
        except Exception:
            log.exception("crm sync iteration failed")
        stop.wait(INTERVAL_SEC)


def start_crm_sync_worker():
    """Start the daemon thread; returns its stop Event, or None when CRM sync is disabled."""
    if not config.enabled():
        return None
    stop = threading.Event()
    threading.Thread(target=_loop, args=(stop,), name="crm-sync", daemon=True).start()
    return stop
