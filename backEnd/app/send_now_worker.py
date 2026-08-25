# send_now_worker.py
"""Backend-persisted FIFO queue for immediate WhatsApp sends ("Enviar Todos" and
similar buttons across searchProspects/batchProcessor/csvImporter/sendCampaign/
singleUrlProcessor/databaseViewer). Ports SendQueueContext.jsx's in-browser
while-loop (queueRef + processNext) into a single global backend worker, so a
page refresh no longer drops queued/in-flight messages.

Unlike scrape_jobs.py, this is deliberately NOT a "many jobs run in parallel"
model — reusing scheduled_sends' per-job-parallel-thread pattern here would let
several rapid "Enviar Todos" clicks become independently-paced concurrent
sends, multiplying the effective outbound rate and undermining the whole
point of the anti-spam delays. Instead there is exactly one active sender at
a time, processing send_queue_items strictly FIFO.

The backend runs with 2 uvicorn worker PROCESSES (Dockerfile.backend,
--workers 2) — each process starts its own copy of this module's worker
thread. Without coordination, both would pull items independently and send
in parallel. A short-TTL Mongo lease (send_worker_lease) elects exactly one
process as the active sender at any moment, with automatic failover if that
process dies (the lease simply expires and the other process picks it up).

A message that gets interrupted by a real backend crash (item stuck at
"sending") is never auto-retried — a WhatsApp message can't be un-sent, so an
ambiguous outcome is left for manual review (_sweep_interrupted_items) while
the rest of the queue keeps moving, per product decision.
"""
import logging
import os
import random
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

_WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"

_LEASE_SEC              = 45   # how long a lease lasts without renewal before another process may take over
_LEASE_RENEW_TICK_SEC    = 15  # renew at least this often — comfortably inside _LEASE_SEC even during long waits
_LEASE_POLL_SEC          = 3   # how often a non-leader (or idle leader) checks for work/leadership
_SENDING_STALE_AFTER_SEC = 300  # 5min stuck in "sending" with no resolution ⇒ assume a crash, mark "interrupted"

_wake_event = threading.Event()

# Per-run counters, reset only when this process (re)acquires leadership — see
# module docstring: this is the deliberate global-not-per-tab replacement for
# SendQueueContext.jsx's batch-break counter.
_msgs_in_batch = 0
_next_break_at = 0
_run_sent = 0
_run_failed = 0


# ─── Lease (leader election across the 2 uvicorn worker processes) ───────────

def _ensure_lease_doc(db):
    db.db.send_worker_lease.update_one(
        {"_id": "singleton"},
        {"$setOnInsert": {"holder": None, "expires_at": datetime.min}},
        upsert=True,
    )


def _try_acquire_lease(db) -> bool:
    now = datetime.now()
    result = db.db.send_worker_lease.update_one(
        {"_id": "singleton", "expires_at": {"$lte": now}},
        {"$set": {"holder": _WORKER_ID, "expires_at": now + timedelta(seconds=_LEASE_SEC)}},
    )
    return result.modified_count > 0


def _renew_lease(db) -> bool:
    now = datetime.now()
    result = db.db.send_worker_lease.update_one(
        {"_id": "singleton", "holder": _WORKER_ID},
        {"$set": {"expires_at": now + timedelta(seconds=_LEASE_SEC)}},
    )
    return result.modified_count > 0


# ─── Shared display state (send_queue_state) — any of the 2 processes may
# serve the GET /api/send-queue/status request, so the truth must live in
# Mongo, not in this process's memory. ─────────────────────────────────────

def _set_state(db, **fields):
    try:
        db.db.send_queue_state.update_one({"_id": "singleton"}, {"$set": fields}, upsert=True)
    except Exception:
        log.exception("[SendQueue] _set_state failed")


def get_status(db) -> dict:
    try:
        doc = db.db.send_queue_state.find_one({"_id": "singleton"}) or {}
        queue_len = len(set(
            i.get("job_key") for i in db.db.send_queue_items.find({"status": "pending"}, {"job_key": 1})
        ))
    except Exception:
        return {"phase": "idle", "active_total": None, "active_sent": None,
                "active_batch": False, "next_action_at": None,
                "queue_len": 0, "last_completed": None, "last_error": None}
    return {
        "phase": doc.get("phase", "idle"),
        "active_total": doc.get("active_total"),
        "active_sent": doc.get("active_sent"),
        "active_batch": doc.get("active_batch", False),
        "next_action_at": doc.get("next_action_at"),
        "queue_len": queue_len,
        "last_completed": doc.get("last_completed"),
        "last_error": doc.get("last_error"),
    }


# ─── Enqueue / cancel ─────────────────────────────────────────────────────────

def enqueue_send_items(db, jobs: list, batch_id: str, label: str, send_config: dict,
                        sent_by_username: str = "", sent_by_name: str = "") -> int:
    """Flattens each {numbers, messages, companyId, website} job into one
    send_queue_items doc per number (the real atomic send unit), matching what
    SendQueueContext.jsx used to push into its in-memory queueRef."""
    now = datetime.now()
    docs = []
    for job_idx, job in enumerate(jobs):
        numbers  = job.get("numbers") or []
        messages = job.get("messages") or []
        job_key  = f"{batch_id}#{job_idx}"
        for i, number in enumerate(numbers):
            message = messages[i] if i < len(messages) else (messages[-1] if messages else "")
            docs.append({
                "batch_id": batch_id, "job_key": job_key, "label": label[:80],
                "company_id": job.get("companyId", ""), "to_number": number, "message": message,
                "website": job.get("website", ""),
                "job_size": len(numbers), "job_index": i,
                "status": "pending",
                "created_at": now, "started_at": None, "finished_at": None,
                "error": None, "result": None,
                "sent_by_username": sent_by_username, "sent_by_name": sent_by_name,
            })
    if not docs:
        return 0
    db.db.send_queue_items.insert_many(docs)
    if send_config:
        _set_state(db, send_config=send_config)
    _wake_event.set()  # instant wake if the leader happens to be in this same process
    return len(docs)


def cancel_pending_send_items(db) -> int:
    result = db.db.send_queue_items.update_many(
        {"status": "pending"}, {"$set": {"status": "cancelled", "finished_at": datetime.now()}},
    )
    _set_state(db, phase="idle", active_total=None, active_sent=None, next_action_at=None, active_batch=False)
    return result.modified_count


# ─── Sending ──────────────────────────────────────────────────────────────────

def _check_send_allowed(db, company_id: str):
    """Ported from routes.py POST /api/send-message's blacklist/blocked gate —
    scheduler.py's send primitives don't do this check, so skipping it here
    would silently regress a safety check immediate sends already had."""
    if not company_id or len(company_id) != 24:
        return True, ""
    from bson import ObjectId
    from app.pipeline import _check_blacklist
    company = db.db.companies.find_one({"_id": ObjectId(company_id)}, {"domain": 1, "industry": 1, "blocked": 1})
    if not company:
        return True, ""
    if company.get("blocked"):
        return False, "skipped_blocked"
    domain = company.get("domain") or ""
    if domain and _check_blacklist(domain, company.get("industry") or ""):
        return False, "skipped_blacklisted"
    return True, ""


def _antispam_wait(db, is_batch_break: bool, seconds: float, active_total, active_sent) -> bool:
    """Incremental sleep so the countdown shown to the user stays live and the
    lease gets renewed periodically even during a multi-minute batch break.
    Returns False if leadership was lost mid-wait (caller should stop)."""
    end = time.time() + seconds
    while True:
        remaining = end - time.time()
        if remaining <= 0:
            return True
        _set_state(db, phase="waiting", active_total=active_total, active_sent=active_sent,
                   active_batch=is_batch_break, next_action_at=datetime.now() + timedelta(seconds=remaining))
        time.sleep(min(remaining, _LEASE_RENEW_TICK_SEC))
        if not _renew_lease(db):
            return False


def _maybe_finish_batch(db, batch_id: str):
    if not batch_id:
        return
    remaining = db.db.send_queue_items.count_documents(
        {"batch_id": batch_id, "status": {"$in": ["pending", "sending"]}})
    if remaining > 0:
        return
    from pymongo.errors import DuplicateKeyError
    try:
        result = db.db.send_queue_batches.update_one(
            {"_id": batch_id, "notified": {"$ne": True}},
            {"$set": {"notified": True}},
            upsert=True,
        )
        should_notify = result.modified_count > 0 or result.upserted_id is not None
    except DuplicateKeyError:
        should_notify = False
    if not should_notify:
        return
    items   = list(db.db.send_queue_items.find({"batch_id": batch_id}, {"status": 1, "label": 1}))
    sent    = sum(1 for i in items if i.get("status") == "sent")
    nc_skip = sum(1 for i in items if i.get("status") == "skipped_nc_cap")
    failed  = len(items) - sent - nc_skip
    label   = items[0].get("label", "") if items else ""
    now = datetime.now()
    db.db.app_notifications.insert_one({
        "type": "batch_complete", "sent": sent, "failed": failed,
        "skipped_nc_cap": nc_skip, "label": label, "created_at": now,
    })
    _set_state(db, last_completed={"sent": sent, "failed": failed, "skipped_nc_cap": nc_skip, "at": now})


def _process_item(db, item) -> bool:
    """Returns False if leadership was lost mid-processing (caller should stop
    being the active sender for now)."""
    global _msgs_in_batch, _next_break_at, _run_sent, _run_failed
    from app import scheduler as _sched

    item_id     = item["_id"]
    company_id  = item.get("company_id", "")
    to_number   = item.get("to_number", "")
    message     = item.get("message", "")
    batch_id    = item.get("batch_id", "")
    job_size    = item.get("job_size", 1)
    job_index   = item.get("job_index", 0)

    allowed, skip_status = _check_send_allowed(db, company_id)
    if not allowed:
        db.db.send_queue_items.update_one({"_id": item_id}, {"$set": {"status": skip_status, "finished_at": datetime.now()}})
        _run_failed += 1
        _maybe_finish_batch(db, batch_id)
        return True

    if not _sched._any_instance_connected(db):
        db.db.send_queue_items.update_one({"_id": item_id}, {"$set": {"status": "pending", "started_at": None}})
        _set_state(db, phase="idle", active_total=None, active_sent=None, next_action_at=None,
                   last_error={"message": "Sin instancia de WhatsApp conectada", "at": datetime.now()})
        return True  # not a crash — just no instance right now; retry on the next idle tick

    _set_state(db, phase="sending", active_total=job_size, active_sent=job_index, active_batch=False, last_error=None)

    typing_ms = random.randint(800, 1800)
    ok = _sched._send_message(
        db, company_id, to_number, message, batch_id, delay_ms=typing_ms,
        sent_by_username=item.get("sent_by_username") or "", sent_by_name=item.get("sent_by_name") or "",
    )
    # Daily cap exhausted: reset item to pending so it retries tomorrow, then
    # signal the worker loop to pause for 5 min before the next attempt.
    if ok == "skipped_daily_cap":
        db.db.send_queue_items.update_one(
            {"_id": item_id},
            {"$set": {"status": "pending", "started_at": None}},
        )
        _set_state(db, phase="idle", active_total=None, active_sent=None,
                   next_action_at=None, active_batch=False,
                   last_error={"message": "Límite diario alcanzado — envíos pendientes continuarán mañana al reiniciarse el cupo", "at": datetime.now()})
        log.warning("[SendQueue] Daily cap hit — pausing queue for 5 min, pending items will retry tomorrow")
        return "cap_paused"

    # _send_message returns True (sent), False (failed), or a string skip-reason.
    # If it failed, distinguish between a disconnected instance vs. a genuine send
    # failure (blocked number, bad payload, etc.) so we don't permanently burn items
    # that just hit a momentarily dead session.
    if ok is False:
        from app.scheduler import _any_instance_connected as _inst_ok
        if not _inst_ok(db):
            # Instance went down mid-campaign — reset item so it retries when the
            # session reconnects, then pause the worker loop for 2 min.
            db.db.send_queue_items.update_one(
                {"_id": item_id},
                {"$set": {"status": "pending", "started_at": None}},
            )
            _set_state(db, phase="idle", active_total=None, active_sent=None,
                       next_action_at=None, active_batch=False,
                       last_error={"message": "Instancia desconectada durante el envío — cola pausada, reintentará al reconectar", "at": datetime.now()})
            log.warning("[SendQueue] instance disconnected mid-campaign — resetting item %s to pending, pausing 2 min", item_id)
            return "disconnected_pause"

    status = ok if isinstance(ok, str) else ("sent" if ok else "failed")
    db.db.send_queue_items.update_one(
        {"_id": item_id},
        {"$set": {"status": status, "finished_at": datetime.now()}},
    )
    if ok is True:
        _run_sent += 1
    elif status != "skipped_nc_cap":
        _run_failed += 1
    _maybe_finish_batch(db, batch_id)

    # Anti-spam delay before the NEXT item — skip if nothing is waiting behind this one.
    if db.db.send_queue_items.count_documents({"status": "pending"}) == 0:
        return True
    cfg = (db.db.send_queue_state.find_one({"_id": "singleton"}) or {}).get("send_config") or {}
    msg_d, batch_s, batch_d = cfg.get("msgDelay", [25, 55]), cfg.get("batchSize", [3, 8]), cfg.get("batchDelay", [3, 8])
    _msgs_in_batch += 1
    if _msgs_in_batch >= _next_break_at:
        _msgs_in_batch = 0
        _next_break_at = random.randint(int(batch_s[0]), int(batch_s[1]))
        return _antispam_wait(db, True, random.uniform(int(batch_d[0]) * 60, int(batch_d[1]) * 60), job_size, job_index + 1)
    return _antispam_wait(db, False, random.uniform(int(msg_d[0]), int(msg_d[1])), job_size, job_index + 1)


def _sweep_interrupted_items(db):
    cutoff = datetime.now() - timedelta(seconds=_SENDING_STALE_AFTER_SEC)
    result = db.db.send_queue_items.update_many(
        {"status": "sending", "started_at": {"$lt": cutoff}},
        {"$set": {"status": "interrupted", "finished_at": datetime.now()}},
    )
    if result.modified_count:
        log.warning("[SendQueue] marked %d stuck item(s) as interrupted (never auto-retried)", result.modified_count)


def _worker_loop():
    global _msgs_in_batch, _next_break_at, _run_sent, _run_failed
    from app.database import MongoDBManager
    db = MongoDBManager()
    _ensure_lease_doc(db)
    is_leader = False

    while True:
        try:
            if not is_leader:
                is_leader = _try_acquire_lease(db)
                if not is_leader:
                    time.sleep(_LEASE_POLL_SEC)
                    continue
                log.info("[SendQueue] %s acquired leadership", _WORKER_ID)
                _msgs_in_batch = 0
                _next_break_at = 0  # forces a fresh random pick on the first item below

            _sweep_interrupted_items(db)

            item = db.db.send_queue_items.find_one_and_update(
                {"status": "pending"},
                {"$set": {"status": "sending", "started_at": datetime.now()}},
                sort=[("_id", 1)],
            )
            if item is None:
                _set_state(db, phase="idle", active_total=None, active_sent=None, next_action_at=None, active_batch=False)
                if _run_sent or _run_failed:
                    _run_sent = _run_failed = 0  # already flushed via last_completed inside _maybe_finish_batch
                _wake_event.wait(timeout=_LEASE_POLL_SEC)
                _wake_event.clear()
                if not _renew_lease(db):
                    is_leader = False
                continue

            if _next_break_at == 0:
                cfg = (db.db.send_queue_state.find_one({"_id": "singleton"}) or {}).get("send_config") or {}
                batch_s = cfg.get("batchSize", [3, 8])
                _next_break_at = random.randint(int(batch_s[0]), int(batch_s[1]))

            result = _process_item(db, item)
            if result == "cap_paused":
                time.sleep(5 * 60)
                continue
            if result == "disconnected_pause":
                time.sleep(2 * 60)
                continue
            if not result:
                is_leader = False

        except Exception:
            log.exception("[SendQueue] worker loop error")
            time.sleep(_LEASE_POLL_SEC)


def start_send_now_worker():
    """Launch the send-now worker as a daemon thread. Call once at startup — safe
    to call in every uvicorn worker process, since the lease ensures only one
    of them is ever actually sending at a time."""
    t = threading.Thread(target=_worker_loop, daemon=True, name="send-now-worker")
    t.start()
    log.info("Send-now worker started (id=%s)", _WORKER_ID)
