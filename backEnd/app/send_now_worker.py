# send_now_worker.py
"""Backend-persisted queue for immediate WhatsApp sends ("Enviar Todos" and
similar buttons across searchProspects/batchProcessor/csvImporter/sendCampaign/
singleUrlProcessor/databaseViewer). Ports SendQueueContext.jsx's in-browser
while-loop (queueRef + processNext) into a backend worker, so a page refresh
never drops queued/in-flight messages.

Sends are partitioned by user_id and processed with one independent pacing
thread PER PARTITION (mirrors scheduler.py's one-thread-per-scheduled-job
model) — so a large campaign queued by one user never blocks another user's
own instance from sending. The anti-spam delays that matter (protecting a
single WhatsApp number from a ban) stay fully intact WITHIN each partition;
they just no longer apply ACROSS unrelated partitions, since two different
users' numbers are two different WhatsApp sessions and were never at risk of
tripping each other's rate limiting in the first place.

Items with no user_id (legacy/system-attributed sends) share one "legacy"
partition and keep the old any-instance-connected gate — there's no per-user
instance to scope them to.

The backend runs with 2 uvicorn worker PROCESSES (Dockerfile.backend,
--workers 2) — each process starts its own copy of this module's dispatcher
thread. Without coordination, both would spawn partition threads and send in
parallel from the same process pair. A short-TTL Mongo lease
(send_worker_lease) elects exactly one process as the dispatcher at any
moment, with automatic failover if that process dies (the lease simply
expires and the other process picks it up) — the elected process then owns
ALL partition threads, so there is still only ever one sender per partition
system-wide.

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
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

_WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"

_LEASE_SEC              = 45   # how long a lease lasts without renewal before another process may take over
_LEASE_RENEW_TICK_SEC    = 15  # renew at least this often — comfortably inside _LEASE_SEC even during long waits
_LEASE_POLL_SEC          = 3   # how often the dispatcher checks for new/finished partitions
_SENDING_STALE_AFTER_SEC = 300  # 5min stuck in "sending" with no resolution ⇒ assume a crash, mark "interrupted"
_LEGACY_PARTITION        = "legacy"  # bucket for items with no user_id

_wake_event = threading.Event()

# Which partitions currently have a live thread — guards against the dispatcher
# double-spawning a thread for a partition whose previous thread hasn't
# finished exiting yet.
_partition_threads: dict[str, threading.Thread] = {}
_partition_threads_lock = threading.Lock()


# ─── Lease (leader election across the 2 uvicorn worker processes) ───────────
# Still a single lease: exactly one PROCESS is elected to run the dispatcher
# and therefore own every partition thread. The parallelism this module adds
# is BETWEEN partitions within that one process, not across processes.

def _ensure_lease_doc(db):
    db.db.send_worker_lease.update_one(
        {"_id": "singleton"},
        {"$setOnInsert": {"holder": None, "expires_at": datetime.min}},
        upsert=True,
    )


def _try_acquire_lease(db) -> bool:
    now = datetime.now(timezone.utc)
    result = db.db.send_worker_lease.update_one(
        {"_id": "singleton", "expires_at": {"$lte": now}},
        {"$set": {"holder": _WORKER_ID, "expires_at": now + timedelta(seconds=_LEASE_SEC)}},
    )
    return result.modified_count > 0


def _renew_lease(db) -> bool:
    now = datetime.now(timezone.utc)
    result = db.db.send_worker_lease.update_one(
        {"_id": "singleton", "holder": _WORKER_ID},
        {"$set": {"expires_at": now + timedelta(seconds=_LEASE_SEC)}},
    )
    return result.modified_count > 0


# ─── Shared display state (send_queue_state) — one doc per partition, any of
# the 2 processes may serve the GET /api/send-queue/status request, so the
# truth must live in Mongo, not in this process's memory. get_status()
# aggregates across partitions into the single-bubble shape the frontend has
# always expected — SendQueueContext.jsx/SendBubble.jsx need no changes. ─────

def _state_id(partition: str) -> str:
    return f"partition_{partition}"


def _set_state(db, partition: str, **fields):
    try:
        db.db.send_queue_state.update_one({"_id": _state_id(partition)}, {"$set": fields}, upsert=True)
    except Exception:
        log.exception("[SendQueue] _set_state failed for partition %s", partition)


def get_status(db, user_id: str = "") -> dict:
    """When user_id is given, returns ONLY that user's own partition — the
    bubble shows your queue, not whatever another user happens to be sending.
    Without a user_id (defensive default for callers outside the
    authenticated route), falls back to an aggregate view across everyone."""
    idle_default = {"phase": "idle", "active_total": None, "active_sent": None,
                     "active_batch": False, "next_action_at": None,
                     "queue_len": 0, "last_completed": None, "last_error": None}
    if user_id:
        try:
            doc = db.db.send_queue_state.find_one({"_id": _state_id(user_id)}) or {}
            queue_len = len(set(
                i.get("job_key") for i in db.db.send_queue_items.find(
                    {"status": "pending", "user_id": user_id}, {"job_key": 1})
            ))
        except Exception:
            return idle_default
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

    try:
        partitions = list(db.db.send_queue_state.find({"_id": {"$regex": "^partition_"}}))
        queue_len = len(set(
            i.get("job_key") for i in db.db.send_queue_items.find({"status": "pending"}, {"job_key": 1})
        ))
    except Exception:
        return idle_default

    # Prefer showing an actively-sending partition; else whichever waiting
    # partition will act soonest; else idle. Only reached when no user_id is
    # available to scope to.
    sending = [p for p in partitions if p.get("phase") == "sending"]
    waiting = [p for p in partitions if p.get("phase") == "waiting" and p.get("next_action_at")]
    chosen = sending[0] if sending else (min(waiting, key=lambda p: p["next_action_at"]) if waiting else None)

    completed_all = [p["last_completed"] for p in partitions if p.get("last_completed")]
    errors_all    = [p["last_error"] for p in partitions if p.get("last_error")]
    last_completed = max(completed_all, key=lambda x: x["at"], default=None)
    last_error     = max(errors_all, key=lambda x: x["at"], default=None)

    if not chosen:
        return {**idle_default, "queue_len": queue_len, "last_completed": last_completed, "last_error": last_error}
    return {
        "phase": chosen.get("phase"),
        "active_total": chosen.get("active_total"),
        "active_sent": chosen.get("active_sent"),
        "active_batch": chosen.get("active_batch", False),
        "next_action_at": chosen.get("next_action_at"),
        "queue_len": queue_len,
        "last_completed": last_completed,
        "last_error": last_error,
    }


def _config_id(partition: str) -> str:
    return f"config_{partition}"


def _get_send_config(db, partition: str) -> dict:
    """Per-partition timing config — each user's own msgDelay/batchSize/
    batchDelay choice, captured at enqueue time. Was a single shared doc
    before per-user parallelism existed; kept global it would let one user's
    campaign silently change another user's pacing mid-send."""
    doc = db.db.send_queue_state.find_one({"_id": _config_id(partition)}) or {}
    return doc.get("send_config") or {}


# ─── Enqueue / cancel ─────────────────────────────────────────────────────────

def enqueue_send_items(db, jobs: list, batch_id: str, label: str, send_config: dict,
                        sent_by_username: str = "", sent_by_name: str = "",
                        user_id: str = "") -> int:
    """Flattens each {numbers, messages, companyId, website} job into one
    send_queue_items doc per number (the real atomic send unit), matching what
    SendQueueContext.jsx used to push into its in-memory queueRef."""
    now = datetime.now(timezone.utc)
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
                "user_id": user_id,
            })
    if not docs:
        return 0
    db.db.send_queue_items.insert_many(docs)
    if send_config:
        partition = user_id or _LEGACY_PARTITION
        db.db.send_queue_state.update_one({"_id": _config_id(partition)}, {"$set": {"send_config": send_config}}, upsert=True)
    _wake_event.set()  # instant wake if the leader happens to be in this same process
    return len(docs)


def cancel_pending_send_items(db, user_id: str = "") -> int:
    """When user_id is given, cancels only THAT user's own pending sends —
    now that the bubble shows a single user's queue, cancel must not be able
    to wipe out someone else's campaign they can't even see. Without a
    user_id (defensive default), falls back to the old system-wide cancel."""
    item_filter  = {"status": "pending", "user_id": user_id} if user_id else {"status": "pending"}
    state_filter = {"_id": _state_id(user_id)} if user_id else {"_id": {"$regex": "^partition_"}}

    result = db.db.send_queue_items.update_many(
        item_filter, {"$set": {"status": "cancelled", "finished_at": datetime.now(timezone.utc)}},
    )
    for p in db.db.send_queue_state.find(state_filter, {"_id": 1}):
        db.db.send_queue_state.update_one(
            {"_id": p["_id"]},
            {"$set": {"phase": "idle", "active_total": None, "active_sent": None,
                      "next_action_at": None, "active_batch": False}},
        )
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


def _user_has_connected_instance(db, user_id: str) -> bool:
    """Is there a WhatsApp session this partition can actually send through?
    For a real user_id, scope the check to THAT user's own instances — a
    different user's connected number is irrelevant to this partition.
    Legacy (no user_id) items keep the old any-instance-connected gate."""
    from app import scheduler as _sched
    if not user_id:
        return _sched._any_instance_connected(db)
    user_instances = [d["name"] for d in db.db.instances.find({"assigned_to": user_id}, {"name": 1}) if d.get("name")]
    if not user_instances:
        return False
    try:
        from app.whatsapp_wwebjs import get_all_connected_instances as _ww_all
        if set(_ww_all(db)) & set(user_instances):
            return True
    except Exception:
        pass
    # Non-wwebjs providers (wasender/waha/evolution) aren't tracked per-instance
    # the same way — fall back to the global check so those setups keep working
    # exactly as before rather than getting incorrectly paused.
    from app.config import WWEBJS_URL
    if not WWEBJS_URL:
        return _sched._any_instance_connected(db)
    return False


def _antispam_wait(db, partition: str, is_batch_break: bool, seconds: float, active_total, active_sent) -> bool:
    """Incremental sleep so the countdown shown to the user stays live and the
    lease gets renewed periodically even during a multi-minute batch break.
    Returns False if leadership was lost mid-wait (caller should stop)."""
    end = time.time() + seconds
    while True:
        remaining = end - time.time()
        if remaining <= 0:
            return True
        _set_state(db, partition, phase="waiting", active_total=active_total, active_sent=active_sent,
                   active_batch=is_batch_break, next_action_at=datetime.now(timezone.utc) + timedelta(seconds=remaining))
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
    items    = list(db.db.send_queue_items.find({"batch_id": batch_id}, {"status": 1, "label": 1, "user_id": 1}))
    sent     = sum(1 for i in items if i.get("status") == "sent")
    nc_skip  = sum(1 for i in items if i.get("status") == "skipped_nc_cap")
    failed   = len(items) - sent - nc_skip
    label    = items[0].get("label", "") if items else ""
    user_id  = items[0].get("user_id", "") if items else ""
    now = datetime.now(timezone.utc)
    notif = {
        "type": "batch_complete", "sent": sent, "failed": failed,
        "skipped_nc_cap": nc_skip, "label": label, "created_at": now,
    }
    if user_id:
        notif["user_id"] = user_id
    db.db.app_notifications.insert_one(notif)
    return {"sent": sent, "failed": failed, "skipped_nc_cap": nc_skip, "at": now}


def _process_item(db, partition: str, item, msgs_in_batch: int, next_break_at: int):
    """Processes one item for this partition. Returns
    (outcome, msgs_in_batch, next_break_at) where outcome is True (continue),
    False (leadership lost — caller should stop this partition), "cap_paused",
    or "disconnected_pause"."""
    item_id     = item["_id"]
    company_id  = item.get("company_id", "")
    to_number   = item.get("to_number", "")
    message     = item.get("message", "")
    batch_id    = item.get("batch_id", "")
    job_size    = item.get("job_size", 1)
    job_index   = item.get("job_index", 0)
    user_id     = item.get("user_id") or ""

    allowed, skip_status = _check_send_allowed(db, company_id)
    if not allowed:
        db.db.send_queue_items.update_one({"_id": item_id}, {"$set": {"status": skip_status, "finished_at": datetime.now(timezone.utc)}})
        finished = _maybe_finish_batch(db, batch_id)
        if finished:
            _set_state(db, partition, last_completed=finished)
        return True, msgs_in_batch, next_break_at

    if not _user_has_connected_instance(db, user_id):
        db.db.send_queue_items.update_one({"_id": item_id}, {"$set": {"status": "pending", "started_at": None}})
        _set_state(db, partition, phase="idle", active_total=None, active_sent=None, next_action_at=None,
                   last_error={"message": "Sin instancia de WhatsApp conectada", "at": datetime.now(timezone.utc)})
        # Not a crash — just no instance right now. A short pause here (unlike
        # the True/continue this used to return) keeps a permanently-disconnected
        # partition from busy-polling Mongo several times a second forever.
        return "no_instance_pause", msgs_in_batch, next_break_at

    _set_state(db, partition, phase="sending", active_total=job_size, active_sent=job_index, active_batch=False, last_error=None)

    from app import scheduler as _sched
    typing_ms = random.randint(800, 1800)
    ok = _sched._send_message(
        db, company_id, to_number, message, batch_id, delay_ms=typing_ms,
        sent_by_username=item.get("sent_by_username") or "", sent_by_name=item.get("sent_by_name") or "",
        user_id=user_id,
    )
    # Daily cap exhausted: reset item to pending so it retries tomorrow, then
    # signal this partition to pause for 5 min before its next attempt —
    # other partitions are untouched.
    if ok == "skipped_daily_cap":
        db.db.send_queue_items.update_one(
            {"_id": item_id},
            {"$set": {"status": "pending", "started_at": None}},
        )
        _set_state(db, partition, phase="idle", active_total=None, active_sent=None,
                   next_action_at=None, active_batch=False,
                   last_error={"message": "Límite diario alcanzado — envíos pendientes continuarán mañana al reiniciarse el cupo", "at": datetime.now(timezone.utc)})
        log.warning("[SendQueue] partition=%s daily cap hit — pausing 5 min, pending items retry tomorrow", partition)
        return "cap_paused", msgs_in_batch, next_break_at

    # _send_message returns True (sent), False/None (failed), or a string skip-reason.
    # If it failed, distinguish between a disconnected instance vs. a genuine send
    # failure (blocked number, bad payload, etc.) so we don't permanently burn items
    # that just hit a momentarily dead session.
    if ok is False or ok is None:
        if not _user_has_connected_instance(db, user_id):
            # Instance went down mid-campaign — reset item so it retries when the
            # session reconnects, then pause this partition for 2 min.
            db.db.send_queue_items.update_one(
                {"_id": item_id},
                {"$set": {"status": "pending", "started_at": None}},
            )
            _set_state(db, partition, phase="idle", active_total=None, active_sent=None,
                       next_action_at=None, active_batch=False,
                       last_error={"message": "Instancia desconectada durante el envío — cola pausada, reintentará al reconectar", "at": datetime.now(timezone.utc)})
            log.warning("[SendQueue] partition=%s instance disconnected mid-campaign — resetting item %s, pausing 2 min", partition, item_id)
            return "disconnected_pause", msgs_in_batch, next_break_at

    status = ok if isinstance(ok, str) else ("sent" if ok else "failed")
    db.db.send_queue_items.update_one(
        {"_id": item_id},
        {"$set": {"status": status, "finished_at": datetime.now(timezone.utc)}},
    )
    finished = _maybe_finish_batch(db, batch_id)
    if finished:
        _set_state(db, partition, last_completed=finished)

    # Anti-spam delay before the NEXT item in THIS partition — skip if nothing
    # of this partition's own is waiting behind it.
    pending_filter = {"status": "pending", "user_id": user_id if user_id else {"$in": [None, ""]}}
    if db.db.send_queue_items.count_documents(pending_filter) == 0:
        return True, msgs_in_batch, next_break_at
    cfg = _get_send_config(db, partition)
    msg_d, batch_s, batch_d = cfg.get("msgDelay", [25, 55]), cfg.get("batchSize", [3, 8]), cfg.get("batchDelay", [3, 8])
    msgs_in_batch += 1
    if msgs_in_batch >= next_break_at:
        msgs_in_batch = 0
        next_break_at = random.randint(int(batch_s[0]), int(batch_s[1]))
        ok_lease = _antispam_wait(db, partition, True, random.uniform(int(batch_d[0]) * 60, int(batch_d[1]) * 60), job_size, job_index + 1)
        return (ok_lease if ok_lease else False), msgs_in_batch, next_break_at
    ok_lease = _antispam_wait(db, partition, False, random.uniform(int(msg_d[0]), int(msg_d[1])), job_size, job_index + 1)
    return (ok_lease if ok_lease else False), msgs_in_batch, next_break_at


def _sweep_interrupted_items(db):
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_SENDING_STALE_AFTER_SEC)
    result = db.db.send_queue_items.update_many(
        {"status": "sending", "started_at": {"$lt": cutoff}},
        {"$set": {"status": "interrupted", "finished_at": datetime.now(timezone.utc)}},
    )
    if result.modified_count:
        log.warning("[SendQueue] marked %d stuck item(s) as interrupted (never auto-retried)", result.modified_count)


def _partition_worker(partition: str, user_id: str):
    """Owns exactly one partition's queue until it's empty, then exits — the
    dispatcher respawns it the next time an item shows up for this partition.
    Mirrors scheduler.py's one-thread-per-job model: independent anti-spam
    pacing, zero blocking on any other partition's activity."""
    from app.database import MongoDBManager
    db = MongoDBManager()
    msgs_in_batch = 0
    next_break_at = 0
    pending_filter = {"status": "pending", "user_id": user_id if user_id else {"$in": [None, ""]}}

    try:
        while True:
            item = db.db.send_queue_items.find_one_and_update(
                pending_filter,
                {"$set": {"status": "sending", "started_at": datetime.now(timezone.utc)}},
                sort=[("_id", 1)],
            )
            if item is None:
                _set_state(db, partition, phase="idle", active_total=None, active_sent=None,
                           next_action_at=None, active_batch=False)
                return

            if next_break_at == 0:
                cfg = _get_send_config(db, partition)
                batch_s = cfg.get("batchSize", [3, 8])
                next_break_at = random.randint(int(batch_s[0]), int(batch_s[1]))

            if not _renew_lease(db):
                return  # lost leadership — another process's dispatcher will take over

            result, msgs_in_batch, next_break_at = _process_item(db, partition, item, msgs_in_batch, next_break_at)
            if result == "cap_paused":
                time.sleep(5 * 60)
                msgs_in_batch, next_break_at = 0, 0
                continue
            if result == "disconnected_pause":
                time.sleep(2 * 60)
                msgs_in_batch, next_break_at = 0, 0
                continue
            if result == "no_instance_pause":
                time.sleep(15)
                continue
            if not result:
                return  # lost leadership mid-wait
    except Exception:
        log.exception("[SendQueue] partition %s worker crashed", partition)
    finally:
        with _partition_threads_lock:
            _partition_threads.pop(partition, None)


def _dispatcher_loop():
    """Elected-leader loop: watches for partitions with pending work and keeps
    exactly one worker thread alive per partition. Does no sending itself —
    all sending happens inside _partition_worker threads."""
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

            if not _renew_lease(db):
                is_leader = False
                continue

            _sweep_interrupted_items(db)

            raw_user_ids = db.db.send_queue_items.distinct("user_id", {"status": "pending"})
            partitions_needed = {(uid or _LEGACY_PARTITION): (uid or "") for uid in raw_user_ids}
            # Also normalise any bare "" that distinct() may return alongside None
            if "" in raw_user_ids or None in raw_user_ids:
                partitions_needed[_LEGACY_PARTITION] = ""

            with _partition_threads_lock:
                for partition, uid in partitions_needed.items():
                    existing = _partition_threads.get(partition)
                    if existing and existing.is_alive():
                        continue
                    t = threading.Thread(
                        target=_partition_worker, args=(partition, uid),
                        daemon=True, name=f"send-partition-{partition}",
                    )
                    _partition_threads[partition] = t
                    t.start()
                    log.info("[SendQueue] spawned worker for partition=%s", partition)

            _wake_event.wait(timeout=_LEASE_POLL_SEC)
            _wake_event.clear()

        except Exception:
            log.exception("[SendQueue] dispatcher loop error")
            time.sleep(_LEASE_POLL_SEC)


def start_send_now_worker():
    """Launch the send-now dispatcher as a daemon thread. Call once at startup
    — safe to call in every uvicorn worker process, since the lease ensures
    only one of them is ever actually dispatching partition workers at a time."""
    t = threading.Thread(target=_dispatcher_loop, daemon=True, name="send-now-dispatcher")
    t.start()
    log.info("Send-now dispatcher started (id=%s)", _WORKER_ID)
