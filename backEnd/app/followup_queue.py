# followup_queue.py
"""
Serialized queue for AI follow-up conversations.
Processes one reply at a time so WhatsApp doesn't see simultaneous multi-chat activity.
"""
import queue
import threading
import logging
import time
import random
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

_q = queue.Queue()
_worker_thread: threading.Thread | None = None
_cleanup_thread: threading.Thread | None = None
_lock = threading.Lock()

# Debounce: accumulate rapid-fire messages from the same number before processing.
# When someone sends 5 messages in 30 seconds we wait until they stop typing,
# then pass the whole burst to the AI as a single combined message.
_DEBOUNCE_SEC = 4.0
_pending: dict = {}   # phone_number → {timer, messages[], log_ids[], company_id, manual}
_pending_lock = threading.Lock()

# Minimum pause between different conversations (after previous one finishes)
_MIN_INTER_CHAT_GAP = 45   # seconds
_MAX_INTER_CHAT_GAP = 90
_last_send_ts: float = 0.0

# Session idle timeout — if contact hasn't replied in this many hours, close and disable toggle
SESSION_IDLE_TIMEOUT_HOURS = 4
_CLEANUP_INTERVAL = 1800  # run cleanup every 30 min


def _worker():
    global _last_send_ts
    while True:
        item = _q.get()
        try:
            # Enforce gap between different chats
            now = time.time()
            elapsed = now - _last_send_ts
            if _last_send_ts > 0 and elapsed < _MIN_INTER_CHAT_GAP:
                wait = random.uniform(_MIN_INTER_CHAT_GAP, _MAX_INTER_CHAT_GAP) - elapsed
                if wait > 0:
                    log.info("[FollowupQ] inter-chat gap: waiting %.0fs", wait)
                    time.sleep(wait)

            from app.ai_followup import process_inbound_reply
            process_inbound_reply(
                phone_number=item["phone_number"],
                company_id=item["company_id"],
                inbound_body=item["inbound_body"],
                inbound_log_id=item["inbound_log_id"],
                manual_activation=item.get("manual_activation", False),
            )
            _last_send_ts = time.time()
        except Exception as e:
            log.error("[FollowupQ] unhandled error: %s", e)
        finally:
            _q.task_done()


def _cleanup_worker():
    """Periodically expire sessions where the contact went silent."""
    while True:
        time.sleep(_CLEANUP_INTERVAL)
        try:
            from app.database import MongoDBManager
            db = MongoDBManager()
            cutoff = datetime.utcnow() - timedelta(hours=SESSION_IDLE_TIMEOUT_HOURS)
            stale = list(db.db.ai_followup_sessions.find({
                "status": {"$in": ["active", "waiting"]},
                "last_activity": {"$lt": cutoff},
            }, {"_id": 1, "company_id": 1, "phone_number": 1}))

            if not stale:
                continue

            ids = [s["_id"] for s in stale]
            db.db.ai_followup_sessions.update_many(
                {"_id": {"$in": ids}},
                {"$set": {"status": "ended", "end_reason": "idle_timeout"}},
            )
            # Disable AI toggle for each affected conversation
            company_ids = list({s["company_id"] for s in stale})
            db.db.conversation_ai_prefs.update_many(
                {"company_id": {"$in": company_ids}},
                {"$set": {"ai_enabled": False}},
            )
            log.info("[FollowupQ] expired %d idle session(s) after %dh silence", len(stale), SESSION_IDLE_TIMEOUT_HOURS)

            # Trigger full-conversation analysis for each expired session
            try:
                from app.llm import active_provider as _ap
                from app.classifier import classify_conversation_and_save
                if _ap() != "none":
                    for cid in company_ids:
                        last_in = db.db.message_logs.find_one(
                            {"company_id": cid, "direction": "inbound"},
                            sort=[("created_at", -1)],
                        )
                        if last_in:
                            import threading
                            threading.Thread(
                                target=classify_conversation_and_save,
                                args=(cid, str(last_in["_id"])),
                                daemon=True,
                            ).start()
            except Exception as _ae:
                log.warning("[FollowupQ] conversation analysis on expire failed: %s", _ae)
            # Clear stale pending analysis records for personal-contact (.local) companies
            # so their analytics spinner doesn't stay on indefinitely.
            try:
                local_companies = list(db.db.companies.find(
                    {"domain": {"$regex": r"\.local$"}}, {"_id": 1}
                ))
                if local_companies:
                    local_ids = [str(c["_id"]) for c in local_companies]
                    cleared = db.db.message_logs.update_many(
                        {"company_id": {"$in": local_ids}, "analysis_status": "pending"},
                        {"$set": {"analysis_status": "skipped"}, "$unset": {"pending_since": ""}},
                    ).modified_count
                    if cleared:
                        log.info("[FollowupQ] cleared %d stale pending records for .local companies", cleared)
            except Exception as _pe:
                log.warning("[FollowupQ] .local pending cleanup failed: %s", _pe)
        except Exception as e:
            log.error("[FollowupQ] cleanup error: %s", e)


def _ensure_worker():
    global _worker_thread, _cleanup_thread
    with _lock:
        if _worker_thread is None or not _worker_thread.is_alive():
            _worker_thread = threading.Thread(
                target=_worker, daemon=True, name="ai-followup-worker"
            )
            _worker_thread.start()
            log.info("[FollowupQ] worker started")
        if _cleanup_thread is None or not _cleanup_thread.is_alive():
            _cleanup_thread = threading.Thread(
                target=_cleanup_worker, daemon=True, name="ai-followup-cleanup"
            )
            _cleanup_thread.start()
            log.info("[FollowupQ] cleanup worker started")


def _flush_debounced(phone_number: str):
    """Timer callback — push accumulated messages to the worker queue as one item."""
    with _pending_lock:
        entry = _pending.pop(phone_number, None)
    if not entry:
        return
    msgs = entry["messages"]
    combined = "\n".join(msgs) if len(msgs) == 1 else "\n".join(f"[{i+1}] {m}" for i, m in enumerate(msgs))
    _q.put({
        "phone_number": phone_number,
        "company_id": entry["company_id"],
        "inbound_body": combined,
        "inbound_log_id": entry["log_ids"][-1],
        "manual_activation": entry["manual"],
    })
    log.info("[FollowupQ] debounce flush: %d msg(s) from %s → queue depth=%d", len(msgs), phone_number, _q.qsize())


def enqueue(phone_number: str, company_id: str, inbound_body: str, inbound_log_id: str,
            manual_activation: bool = False):
    """Add an inbound message to the AI follow-up queue. Returns immediately.
    Debounces rapid-fire messages: if the same number sends several messages within
    _DEBOUNCE_SEC seconds, they are accumulated and delivered to the AI as a single
    combined context instead of triggering N separate responses.
    Pass manual_activation=True when triggered by the user enabling the AI toggle.
    """
    _ensure_worker()
    with _pending_lock:
        existing = _pending.get(phone_number)
        if existing:
            existing["timer"].cancel()
            existing["messages"].append(inbound_body)
            existing["log_ids"].append(inbound_log_id)
            if manual_activation:
                existing["manual"] = True
            log.info("[FollowupQ] debounce: accumulated msg #%d from %s", len(existing["messages"]), phone_number)
            entry = existing
        else:
            entry = {
                "messages": [inbound_body],
                "log_ids": [inbound_log_id],
                "company_id": company_id,
                "manual": manual_activation,
                "timer": None,
            }
            _pending[phone_number] = entry
            log.info("[FollowupQ] debounce: new window for %s (manual=%s)", phone_number, manual_activation)
        t = threading.Timer(_DEBOUNCE_SEC, _flush_debounced, args=[phone_number])
        t.daemon = True
        entry["timer"] = t
        t.start()
