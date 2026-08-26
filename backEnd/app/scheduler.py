# scheduler.py
"""Background scheduler for sending pre-scheduled WhatsApp campaigns."""
import logging
import random
import threading
import time
from datetime import datetime
from app.daily_cap import DAILY_CAP, get_daily_count, increment_daily_count, get_instance_cap, notify_cap_reached_once
from app.phone_utils import clean_digits

log = logging.getLogger(__name__)


def _any_instance_connected(db) -> bool:
    """Return True if at least one WhatsApp session is reachable and connected."""
    from app.config import WASENDER_PAT, WASENDER_BASE_URL, WAHA_API_KEY, WAHA_API_URL, EVOLUTION_API_KEY
    # Check wwebjs instances first (local, fastest check)
    try:
        from app.config import WWEBJS_URL as _ww_url
        import requests as _r2
        ww_sessions = _r2.get(f"{_ww_url}/sessions", timeout=2).json()
        if any(s.get("status") == "connected" for s in ww_sessions.values()):
            return True
    except Exception:
        pass
    if WASENDER_PAT:
        try:
            from app.whatsapp_wasender import pick_connected_instance as _ws_pick
            if _ws_pick(db, WASENDER_PAT, WASENDER_BASE_URL):
                return True
        except Exception:
            pass
    if WAHA_API_KEY:
        try:
            from app.whatsapp_waha import pick_connected_instance as _waha_pick
            if _waha_pick(db, WAHA_API_URL, WAHA_API_KEY):
                return True
        except Exception:
            pass
    if EVOLUTION_API_KEY:
        try:
            from app.config import EVOLUTION_API_URL, EVOLUTION_INSTANCE
            import requests as _r
            r = _r.get(f"{EVOLUTION_API_URL}/instance/connectionState/{EVOLUTION_INSTANCE}",
                       headers={"apikey": EVOLUTION_API_KEY}, timeout=3)
            state = (r.json().get("instance") or {}).get("state") or r.json().get("state", "")
            if state == "open":
                return True
        except Exception:
            pass
    return False

_POLL_INTERVAL_SEC = 60        # check for due jobs every minute
_REMINDER_LEAD_MIN = 60        # notify ~1h before a scheduled campaign fires
_HEARTBEAT_INTERVAL_SEC = 4 * 3600  # ping idle WAHA sessions every 4 hours
_last_heartbeat_at = 0.0


def _render_message(text: str, name: str = "", industry: str = "", city: str = "", website: str = "") -> str:
    """Fill in placeholders with whatever data is available, leaving no raw
    tokens in the text that gets sent. `{empresa}` is the original Scheduled
    Sends placeholder; `{{nombre}}/{{industria}}/{{ciudad}}/{{web}}` are the
    ones used by the shared message_templates library (and every other
    outreach surface in the app), so both must be supported here.
    """
    return (text
            .replace("{empresa}", name)
            .replace("{{nombre}}", name)
            .replace("{{industria}}", industry)
            .replace("{{ciudad}}", city)
            .replace("{{web}}", website))


def _pick_message(messages, last_text=None):
    """Pick a message variant at random, avoiding repeating the immediately
    previous one when there's more than one to choose from. Sending the exact
    same text to many numbers in a row is a common WhatsApp bot-detection
    signal, so campaigns with 2+ templates rotate between them per recipient.
    """
    if not messages:
        return ""
    if len(messages) == 1:
        return messages[0]
    choices = [m for m in messages if m != last_text]
    return random.choice(choices or messages)


def _stamp_assigned_instance(db, company_id: str, instance_name: str) -> None:
    """Write assigned_instance to the company doc if not already set.
    Called after every successful send so future sends (batch, scheduled, AI
    followup) always route back to the same WhatsApp number, preserving the
    conversation thread. Only sets; never overwrites an existing assignment."""
    if not company_id or len(company_id) != 24 or not instance_name:
        return
    try:
        from bson import ObjectId
        db.db.companies.update_one(
            {"_id": ObjectId(company_id), "assigned_instance": {"$in": [None, ""]}},
            {"$set": {"assigned_instance": instance_name}},
        )
    except Exception:
        pass


def _nc_aware_pick(db, candidates: list, company_id: str) -> str | None:
    """Pick the best connected instance for this send.

    For new contacts: prefer the instance with the most NC capacity left so the
    NC cap is shared evenly across sessions. Returns None if all instances are
    at their NC cap — the caller should treat this as "skipped_nc_cap".

    For existing contacts: returns the first instance not at its daily send cap
    (same as the old pick_connected_instance behavior).

    Returns None when candidates is empty (nothing connected) or when all
    instances are at their NC cap for a new contact.
    """
    from app.daily_cap import (
        is_new_contact, get_new_contacts_limit,
        count_new_contacts_today_for_instance,
    )
    if not candidates:
        return None

    # Exclude instances already at their daily send cap; fall back to all if
    # all are full (the existing daily-cap check handles it with a notification).
    available = [n for n in candidates if get_daily_count(db, n) < get_instance_cap(db, n)]
    pool = available or candidates

    if not company_id or not is_new_contact(db, company_id):
        return pool[0]  # existing contact: first available is fine

    # New contact: rank by NC space left (descending).
    scored = []
    for name in pool:
        inst = db.db.instances.find_one({"name": name}, {"warmup_mode": 1})
        warmup = bool((inst or {}).get("warmup_mode"))
        limit = get_new_contacts_limit(warmup)
        count = count_new_contacts_today_for_instance(db, name)
        scored.append((limit - count, name))
    scored.sort(reverse=True)
    # If the best candidate has no capacity left, all are saturated → skip.
    if scored[0][0] <= 0:
        return None
    return scored[0][1]


def _send_via_evolution(db, company_id: str, to_number: str, message: str, job_id: str, delay_ms: int = 0,
                         sent_by_username: str = "scheduler", sent_by_name: str = "Envio programado"):
    """Send a single WhatsApp message via Evolution API and log it.

    Mirrors the logic in routes.py POST /api/send-message, but runs in a
    background thread (no HTTP request context, no user token).
    """
    from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE
    from app.whatsapp_evolution import EvolutionClient

    if not EVOLUTION_API_KEY or not EVOLUTION_INSTANCE:
        log.warning("[Scheduler] Evolution API not configured — skipping %s", to_number)
        return False

    try:
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE)

        if get_daily_count(db, EVOLUTION_INSTANCE) >= get_instance_cap(db, EVOLUTION_INSTANCE):
            log.warning("[Scheduler] Daily cap %d reached for evolution=%s — skipping %s", get_instance_cap(db, EVOLUTION_INSTANCE), EVOLUTION_INSTANCE, to_number)
            notify_cap_reached_once(db, EVOLUTION_INSTANCE)
            return "skipped_daily_cap"

        from app.daily_cap import check_new_contact_cap
        _nc_ok, _nc_count, _nc_limit = check_new_contact_cap(db, EVOLUTION_INSTANCE, company_id)
        if not _nc_ok:
            log.info("[Scheduler] New-contact cap %d/day reached for evolution=%s — skipping new contact company=%s", _nc_limit, EVOLUTION_INSTANCE, company_id)
            return "skipped_nc_cap"

        # Learn JID before sending (so instant bot replies can be matched)
        real_jid_num = evo.get_jid(to_number)
        if real_jid_num:
            db.db.jid_map.update_one(
                {"jid": real_jid_num},
                {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
                upsert=True,
            )

        evo_result = evo.send_text(to_number, message, delay_ms=delay_ms)
        evo_json = evo_result.get("response_json", {})
        message_id = evo_json.get("key", {}).get("id") or evo_json.get("id")
        status = "sent" if evo_result.get("status_code") in (200, 201) else "failed"
        if status == "sent":
            increment_daily_count(db, EVOLUTION_INSTANCE, clean_digits(to_number))
            _stamp_assigned_instance(db, company_id, EVOLUTION_INSTANCE)

        # Learn JID from send response as fallback
        if not real_jid_num and status == "sent":
            remote_jid = evo_json.get("key", {}).get("remoteJid", "")
            jid_num = remote_jid.split("@")[0] if remote_jid else ""
            if jid_num:
                db.db.jid_map.update_one(
                    {"jid": jid_num},
                    {"$set": {"company_id": company_id, "updated_at": datetime.now()}},
                    upsert=True,
                )

        log_doc = {
            "channel": "whatsapp",
            "platform": "evolution",
            "direction": "outbound",
            "company_id": company_id,
            "to_number": to_number,
            "message_body": message,
            "message_text": message,
            "message_id": message_id,
            "status_code": evo_result.get("status_code"),
            "api_response": evo_json,
            "status": status,
            "sent_at": evo_result.get("sent_at"),
            "sent_by_username": sent_by_username,
            "sent_by_name": sent_by_name,
            "scheduled_send_id": job_id,
            # Outbound messages are not classified -- only inbound replies are
            "analysis_status": None,
        }
        db.insert_message_log(log_doc)
        log.info("[Scheduler] job=%s company=%s to=%s status=%s", job_id, company_id, to_number, status)
        return status == "sent"
    except Exception:
        log.exception("[Scheduler] _send_via_evolution failed for company=%s to=%s", company_id, to_number)
        return False


def _send_via_waha(db, company_id: str, to_number: str, message: str, job_id: str, delay_ms: int = 0, session: str = "",
                    sent_by_username: str = "scheduler", sent_by_name: str = "Envio programado"):
    """Send a single WhatsApp message via WAHA and log it."""
    from app.config import WAHA_API_KEY, WAHA_API_URL
    from app.whatsapp_waha import WAHAClient, get_all_connected_instances as _waha_all

    if not WAHA_API_KEY:
        log.warning("[Scheduler] WAHA not configured — skipping %s", to_number)
        return False
    try:
        if session:
            active_session = session
        else:
            active_session = _nc_aware_pick(db, _waha_all(db, WAHA_API_URL, WAHA_API_KEY), company_id)
        if not active_session:
            log.warning("[Scheduler] WAHA: no session connected — skipping %s", to_number)
            return False

        if get_daily_count(db, active_session) >= get_instance_cap(db, active_session):
            log.warning("[Scheduler] Daily cap %d reached for waha=%s — skipping %s", get_instance_cap(db, active_session), active_session, to_number)
            notify_cap_reached_once(db, active_session)
            return "skipped_daily_cap"

        from app.daily_cap import check_new_contact_cap
        _nc_ok, _nc_count, _nc_limit = check_new_contact_cap(db, active_session, company_id)
        if not _nc_ok:
            log.info("[Scheduler] New-contact cap %d/day reached for waha=%s — skipping new contact company=%s", _nc_limit, active_session, company_id)
            return "skipped_nc_cap"

        waha = WAHAClient(WAHA_API_URL, WAHA_API_KEY, active_session)

        from app.whatsapp_waha import _clean_digits as _wc
        real_jid_num  = waha.get_jid(to_number)
        _phone_digits = _wc(to_number)
        # Always store phone digits — webhook delivers @c.us (never @lid)
        db.db.jid_map.update_one(
            {"jid": _phone_digits},
            {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
            upsert=True,
        )
        if real_jid_num and real_jid_num != _phone_digits:
            db.db.jid_map.update_one(
                {"jid": real_jid_num},
                {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
                upsert=True,
            )

        # Save as contact before sending — reduces spam/ban signals
        try:
            from bson import ObjectId as _OId
            if company_id and len(company_id) == 24:
                _co = db.db.companies.find_one({"_id": _OId(company_id)}, {"name": 1})
                _co_name = (_co or {}).get("name", "")
                if _co_name:
                    waha.label_contact(_phone_digits, _co_name)
        except Exception:
            pass

        waha_result = waha.send_text(to_number, message, delay_ms=delay_ms)
        waha_json   = waha_result.get("response_json", {})
        message_id  = waha_json.get("id") or waha_json.get("key", {}).get("id")

        # Reachout Timelock — WA shadow-restricts the account (error 463)
        # Do NOT retry; the restriction lifts automatically.
        raw_text = waha_result.get("raw_text", "")
        if "463" in raw_text or waha_result.get("status_code") == 463:
            log.error("[Scheduler] WAHA ⛔ Reachout Timelock (error 463) on session=%s — pausando envíos nuevos", active_session)
            db.db.instances.update_one({"name": active_session},
                {"$set": {"reachout_timelock": True, "reachout_locked_at": datetime.now()}})
            return False

        status      = "sent" if waha_result.get("status_code") in (200, 201) else "failed"
        if status == "sent":
            increment_daily_count(db, active_session, _phone_digits)
            _stamp_assigned_instance(db, company_id, active_session)

        db.insert_message_log({
            "channel": "whatsapp",
            "platform": "waha",
            "direction": "outbound",
            "company_id": company_id,
            "to_number": to_number,
            "message_body": message,
            "message_text": message,
            "message_id": message_id,
            "status_code": waha_result.get("status_code"),
            "api_response": waha_json,
            "status": status,
            "sent_at": waha_result.get("sent_at"),
            "sent_by_username": sent_by_username,
            "sent_by_name": sent_by_name,
            "scheduled_send_id": job_id,
            "analysis_status": None,
        })
        log.info("[Scheduler] WAHA job=%s company=%s to=%s status=%s", job_id, company_id, to_number, status)
        return status == "sent"
    except Exception:
        log.exception("[Scheduler] _send_via_waha failed for company=%s to=%s", company_id, to_number)
        return False


def _send_via_wasender(db, company_id: str, to_number: str, message: str, job_id: str, delay_ms: int = 0, session: str = "",
                        sent_by_username: str = "scheduler", sent_by_name: str = "Envio programado"):
    """Send a single WhatsApp message via WasenderAPI and log it."""
    from app.config import WASENDER_PAT, WASENDER_BASE_URL
    from app.whatsapp_wasender import WasenderClient, get_all_connected_instances as _wasender_all, _clean_digits as _wc

    if not WASENDER_PAT:
        log.warning("[Scheduler] WasenderAPI not configured — skipping %s", to_number)
        return False
    try:
        if session:
            active_session = session
        else:
            active_session = _nc_aware_pick(db, _wasender_all(db, WASENDER_PAT, WASENDER_BASE_URL), company_id)
        if not active_session:
            log.warning("[Scheduler] Wasender: no session connected — skipping %s", to_number)
            return False

        if get_daily_count(db, active_session) >= get_instance_cap(db, active_session):
            log.warning("[Scheduler] Daily cap %d reached for wasender=%s — skipping %s", get_instance_cap(db, active_session), active_session, to_number)
            notify_cap_reached_once(db, active_session)
            return "skipped_daily_cap"

        from app.daily_cap import check_new_contact_cap
        _nc_ok, _nc_count, _nc_limit = check_new_contact_cap(db, active_session, company_id)
        if not _nc_ok:
            log.info("[Scheduler] New-contact cap %d/day reached for wasender=%s — skipping new contact company=%s", _nc_limit, active_session, company_id)
            return "skipped_nc_cap"

        inst_doc = db.db.instances.find_one({"name": active_session}, {"wasender_api_key": 1, "number": 1})
        api_key = (inst_doc or {}).get("wasender_api_key", "")
        if not api_key:
            log.warning("[Scheduler] Wasender: no api_key for instance=%s", active_session)
            return False

        client = WasenderClient(WASENDER_BASE_URL, api_key, active_session,
                                own_number=(inst_doc or {}).get("number", ""))

        _phone_digits = _wc(to_number)
        # Ensure jid_map entry so inbound replies can be routed
        db.db.jid_map.update_one(
            {"jid": _phone_digits},
            {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
            upsert=True,
        )

        result = client.send_text(to_number, message, delay_ms=delay_ms)
        resp_json = result.get("response_json", {})
        # WasenderAPI: {data: {message_id: "..."}}
        _data = resp_json.get("data") or {}
        message_id = _data.get("message_id") or _data.get("id")

        status = "sent" if result.get("status_code") in (200, 201) else "failed"
        if status == "sent":
            increment_daily_count(db, active_session, _phone_digits)
            _stamp_assigned_instance(db, company_id, active_session)

        db.insert_message_log({
            "channel": "whatsapp",
            "platform": "wasender",
            "direction": "outbound",
            "company_id": company_id,
            "to_number": to_number,
            "message_body": message,
            "message_text": message,
            "message_id": message_id,
            "status_code": result.get("status_code"),
            "api_response": resp_json,
            "status": status,
            "sent_at": result.get("sent_at"),
            "instance_name": active_session,
            "sent_by_username": sent_by_username,
            "sent_by_name": sent_by_name,
            "scheduled_send_id": job_id,
            "analysis_status": None,
        })
        log.info("[Scheduler] Wasender job=%s company=%s to=%s status=%s", job_id, company_id, to_number, status)
        return status == "sent"
    except Exception:
        log.exception("[Scheduler] _send_via_wasender failed for company=%s to=%s", company_id, to_number)
        return False


def _verify_wa_number(db, phone_digits: str, session: str) -> bool:
    """Return True if phone_digits is registered on WhatsApp. Caches result in jid_map."""
    cached = db.db.jid_map.find_one({"jid": phone_digits}, {"wa_valid": 1, "wa_checked_at": 1})
    if cached and "wa_valid" in cached:
        return cached["wa_valid"]
    try:
        from app.whatsapp_wwebjs import verify_number
        result = verify_number(session, phone_digits)
        # wwebjs service returns "registered"; "exists" was never in the response
        valid = bool(result.get("registered", result.get("exists", False)))
    except Exception:
        return True  # on error, allow send (don't block on verify failure)
    db.db.jid_map.update_one(
        {"jid": phone_digits},
        {"$set": {"wa_valid": valid, "wa_checked_at": datetime.now()}},
        upsert=True,
    )
    if not valid:
        log.info("[Scheduler] verify: %s not on WhatsApp — skipping", phone_digits)
    return valid


def _send_via_wwebjs(db, company_id: str, to_number: str, message: str, job_id: str, delay_ms: int = 0, session: str = "",
                      sent_by_username: str = "scheduler", sent_by_name: str = "Envio programado"):
    """Send a single WhatsApp message via whatsapp-web.js and log it."""
    from app.whatsapp_wwebjs import WWebjsClient
    if not session:
        log.warning("[Scheduler] wwebjs: no session provided — skipping %s", to_number)
        return False
    try:
        if get_daily_count(db, session) >= get_instance_cap(db, session):
            log.warning("[Scheduler] Daily cap %d reached for wwebjs=%s — skipping %s", get_instance_cap(db, session), session, to_number)
            notify_cap_reached_once(db, session)
            return "skipped_daily_cap"

        from app.daily_cap import check_new_contact_cap
        _nc_ok, _nc_count, _nc_limit = check_new_contact_cap(db, session, company_id)
        if not _nc_ok:
            log.info("[Scheduler] New-contact cap %d/day reached for wwebjs=%s — skipping new contact company=%s", _nc_limit, session, company_id)
            return "skipped_nc_cap"

        _phone_digits = clean_digits(to_number)

        if not _verify_wa_number(db, _phone_digits, session):
            return False
        db.db.jid_map.update_one(
            {"jid": _phone_digits},
            {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
            upsert=True,
        )

        ww_client = WWebjsClient(session)
        ww_result = ww_client.send(to_number, message, delay_ms=delay_ms)
        message_id = ww_result.get("messageId")
        status = "sent" if ww_result.get("success") else "failed"
        if status == "sent":
            increment_daily_count(db, session, _phone_digits)
            _stamp_assigned_instance(db, company_id, session)

        db.insert_message_log({
            "channel": "whatsapp",
            "platform": "wwebjs",
            "direction": "outbound",
            "company_id": company_id,
            "to_number": to_number,
            "message_body": message,
            "message_text": message,
            "message_id": message_id,
            "status": status,
            "instance_name": session,
            "sent_by_username": sent_by_username,
            "sent_by_name": sent_by_name,
            "scheduled_send_id": job_id,
            "analysis_status": None,
        })
        log.info("[Scheduler] wwebjs job=%s company=%s to=%s status=%s", job_id, company_id, to_number, status)
        return status == "sent"
    except Exception:
        log.exception("[Scheduler] _send_via_wwebjs failed for company=%s to=%s", company_id, to_number)
        return False


def _send_message(db, company_id: str, to_number: str, message: str, job_id: str, delay_ms: int = 0,
                   sent_by_username: str = "scheduler", sent_by_name: str = "Envio programado"):
    """Route to wwebjs, WasenderAPI, WAHA, or Evolution based on the company's assigned instance provider.

    sent_by_username/sent_by_name default to the scheduled-campaign attribution
    ("scheduler"/"Envio programado") but callers outside scheduler.py — e.g. the
    immediate send-now worker — pass the real acting user so message_logs
    attributes the send correctly instead of showing it as a scheduled campaign.
    """
    try:
        from bson import ObjectId
        if company_id and len(company_id) == 24:
            co = db.db.companies.find_one({"_id": ObjectId(company_id)}, {"assigned_instance": 1})
            inst_name = (co or {}).get("assigned_instance")
            if inst_name:
                inst_doc = db.db.instances.find_one({"name": inst_name}, {"provider": 1})
                provider = (inst_doc or {}).get("provider", "")
                if provider == "wwebjs":
                    return _send_via_wwebjs(db, company_id, to_number, message, job_id, delay_ms, session=inst_name,
                                             sent_by_username=sent_by_username, sent_by_name=sent_by_name)
                if provider == "wasender":
                    return _send_via_wasender(db, company_id, to_number, message, job_id, delay_ms, session=inst_name,
                                               sent_by_username=sent_by_username, sent_by_name=sent_by_name)
                if provider == "waha":
                    return _send_via_waha(db, company_id, to_number, message, job_id, delay_ms, session=inst_name,
                                           sent_by_username=sent_by_username, sent_by_name=sent_by_name)
    except Exception:
        pass
    # Fallback: wwebjs → WasenderAPI → WAHA → Evolution
    from app.config import WWEBJS_URL, WASENDER_PAT, WAHA_API_KEY, EVOLUTION_API_KEY
    if WWEBJS_URL:
        from app.whatsapp_wwebjs import get_all_connected_instances as _ww_all
        _ww_all_connected = _ww_all(db)
        # Only use instances that are claimed (assigned_to is set) — avoids picking
        # orphaned/test sessions that don't belong to any user's account.
        _ww_candidates = [
            n for n in _ww_all_connected
            if (db.db.instances.find_one({"name": n}, {"assigned_to": 1}) or {}).get("assigned_to")
        ]
        if _ww_candidates:
            _picked = _nc_aware_pick(db, _ww_candidates, company_id)
            if _picked:
                return _send_via_wwebjs(db, company_id, to_number, message, job_id, delay_ms, session=_picked,
                                        sent_by_username=sent_by_username, sent_by_name=sent_by_name)
    if WASENDER_PAT:
        return _send_via_wasender(db, company_id, to_number, message, job_id, delay_ms,
                                   sent_by_username=sent_by_username, sent_by_name=sent_by_name)
    if WAHA_API_KEY and not EVOLUTION_API_KEY:
        return _send_via_waha(db, company_id, to_number, message, job_id, delay_ms,
                               sent_by_username=sent_by_username, sent_by_name=sent_by_name)
    return _send_via_evolution(db, company_id, to_number, message, job_id, delay_ms,
                                sent_by_username=sent_by_username, sent_by_name=sent_by_name)


def _execute_send_job(job_id: str):
    """Run a scheduled send job end-to-end in a worker thread."""
    from bson import ObjectId
    from app.database import MongoDBManager

    db = MongoDBManager()

    try:
        job = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)})
        if not job:
            log.error("[Scheduler] Job %s not found", job_id)
            return

        industry = job.get("industry", "")
        company_ids = job.get("company_ids") or []
        selected_numbers = job.get("selected_numbers") or []
        messages = job.get("messages") or ([job["message"]] if job.get("message") else [])

        # ── Pre-flight: abort immediately if no WA instance is connected ─────
        # Reverts to "pending" so the scheduler retries in 5 min, instead of
        # burning through the entire recipient list producing only errors.
        if not _any_instance_connected(db):
            from datetime import timedelta
            deferred_count = job.get("no_instance_deferred_count", 0) + 1
            log.warning("[Scheduler] job=%s — no connected instance (defer #%d), retrying in 5min",
                        job_id, deferred_count)
            db.db.scheduled_sends.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {
                    "status": "pending",
                    "retry_not_before": datetime.now() + timedelta(minutes=5),
                    "no_instance_deferred_count": deferred_count,
                }},
            )
            return

        # ── Send timing config (saved from UI — same shape as sendConfig.js) ──
        _sc = job.get("send_config") or {}
        _msg_d   = _sc.get("msgDelay",   [25, 55])
        _batch_s = _sc.get("batchSize",  [3,  8])
        _batch_d = _sc.get("batchDelay", [3,  8])
        msg_delay_min,  msg_delay_max  = int(_msg_d[0]),   int(_msg_d[1])
        batch_size_min, batch_size_max = int(_batch_s[0]), int(_batch_s[1])
        batch_delay_min = int(_batch_d[0]) * 60  # minutes → seconds
        batch_delay_max = int(_batch_d[1]) * 60
        # Typing indicator sent to Evolution API (per-message, separate from inter-message spacing)
        typing_ms = random.randint(800, 1800)

        # State for batch-break tracking (mirrors SendQueueContext.jsx logic)
        _msgs_in_batch = 0
        _next_break_at = random.randint(batch_size_min, batch_size_max)

        def _antispam_delay(send_index: int):
            """Delay BEFORE the send_index-th message (0-based, skip for first)."""
            nonlocal _msgs_in_batch, _next_break_at
            if send_index == 0:
                return
            _msgs_in_batch += 1
            if _msgs_in_batch >= _next_break_at:
                pause_sec = random.uniform(batch_delay_min, batch_delay_max)
                _msgs_in_batch = 0
                _next_break_at = random.randint(batch_size_min, batch_size_max)
                log.warning("[Scheduler] job=%s ⏸  batch break %.0fs (cfg %d–%dmin) before msg #%d",
                            job_id, pause_sec, batch_delay_min // 60, batch_delay_max // 60, send_index + 1)
                time.sleep(pause_sec)
            else:
                delay_sec = random.uniform(msg_delay_min, msg_delay_max)
                log.warning("[Scheduler] job=%s ⏳ %.0fs (cfg %d–%ds) before msg #%d",
                            job_id, delay_sec, msg_delay_min, msg_delay_max, send_index + 1)
                time.sleep(delay_sec)

        def _finish(sent: int, errors: int):
            final_status = "done" if sent > 0 or errors == 0 else "error"
            db.db.scheduled_sends.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {
                    "status": final_status,
                    "sent_count": sent,
                    "error_count": errors,
                    "finished_at": datetime.now(),
                }},
            )
            log.warning("[Scheduler] job=%s ✅ finished status=%s sent=%d errors=%d",
                        job_id, final_status, sent, errors)

        # ── Branch A: explicit number list (from company picker) ──────────────
        if selected_numbers:
            db.db.scheduled_sends.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"total_count": len(selected_numbers), "status": "running", "started_at": datetime.now()}},
            )
            sent_count = 0
            error_count = 0
            last_text = None
            log.warning("[Scheduler] job=%s 🚀 starting Branch A — %d numbers, %d template variant(s)",
                        job_id, len(selected_numbers), len(messages))

            for idx, num_info in enumerate(selected_numbers):
                current = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)}, {"status": 1})
                if current and current.get("status") == "cancelled":
                    log.warning("[Scheduler] job=%s cancelled at msg %d", job_id, idx)
                    return

                cid = num_info.get("company_id", "")
                company_name = num_info.get("company_name", "") or cid
                to_number = num_info.get("number", "")
                if not to_number:
                    continue

                # Delay BEFORE sending (skipped for the very first message)
                _antispam_delay(idx)

                log.warning("[Scheduler] job=%s 📤 sending msg %d/%d to %s",
                            job_id, idx + 1, len(selected_numbers), to_number[-4:])
                message_variant = _pick_message(messages, last_text)
                last_text = message_variant
                message = _render_message(
                    message_variant, company_name,
                    num_info.get("industry", ""), num_info.get("city", ""), num_info.get("web", ""),
                )
                ok = _send_message(db, cid, to_number, message, job_id, delay_ms=typing_ms)
                if ok is True:
                    sent_count += 1
                elif ok is False:
                    error_count += 1

                db.db.scheduled_sends.update_one(
                    {"_id": ObjectId(job_id)},
                    {"$set": {"sent_count": sent_count, "error_count": error_count}},
                )

            _finish(sent_count, error_count)
            return

        # ── Branch B: resolve by company_ids / industry (legacy) ─────────────
        if company_ids:
            from bson import ObjectId as ObjId
            safe_ids = []
            for cid in company_ids:
                try:
                    safe_ids.append(ObjId(cid))
                except Exception:
                    pass
            companies = list(db.db.companies.find(
                {"_id": {"$in": safe_ids}},
                {"_id": 1, "name": 1, "business_name": 1, "industry": 1, "city": 1, "website": 1, "domain": 1},
            ))
        else:
            filter_q = {}
            if industry:
                filter_q["industry"] = {"$regex": industry, "$options": "i"}
            companies = list(db.db.companies.find(
                filter_q,
                {"_id": 1, "name": 1, "business_name": 1, "industry": 1, "city": 1, "website": 1, "domain": 1},
            ))

        total = 0
        for comp in companies:
            cid = str(comp["_id"])
            total += db.db.contacts.count_documents({"company_id": cid, "type": "whatsapp"})

        db.db.scheduled_sends.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {"total_count": total, "status": "running", "started_at": datetime.now()}},
        )

        sent_count = 0
        error_count = 0
        send_index = 0
        last_text = None
        log.warning("[Scheduler] job=%s 🚀 starting Branch B — %d companies, ~%d contacts, %d template variant(s)",
                    job_id, len(companies), total, len(messages))

        for comp in companies:
            current = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)}, {"status": 1})
            if current and current.get("status") == "cancelled":
                log.warning("[Scheduler] job=%s cancelled at company %s", job_id, comp["_id"])
                return

            cid = str(comp["_id"])
            company_name = comp.get("name") or comp.get("business_name") or cid
            company_industry = comp.get("industry", "")
            company_city = comp.get("city", "")
            company_web = comp.get("website") or comp.get("domain") or ""

            contacts = list(db.db.contacts.find(
                {"company_id": cid, "type": "whatsapp"},
                {"value": 1},
            ))

            for contact in contacts:
                to_number = contact.get("value", "")
                if not to_number:
                    continue

                # Delay BEFORE sending (skipped for the very first message)
                _antispam_delay(send_index)

                message_variant = _pick_message(messages, last_text)
                last_text = message_variant
                message = _render_message(message_variant, company_name, company_industry, company_city, company_web)
                ok = _send_message(db, cid, to_number, message, job_id, delay_ms=typing_ms)
                send_index += 1
                if ok is True:
                    sent_count += 1
                elif ok is False:
                    error_count += 1

                db.db.scheduled_sends.update_one(
                    {"_id": ObjectId(job_id)},
                    {"$set": {"sent_count": sent_count, "error_count": error_count}},
                )

        _finish(sent_count, error_count)

    except Exception:
        log.exception("[Scheduler] _execute_send_job failed for job %s", job_id)
        try:
            from bson import ObjectId
            db.db.scheduled_sends.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"status": "error", "finished_at": datetime.now()}},
            )
        except Exception:
            pass


def _poll_and_dispatch():
    """Check for due pending jobs and launch worker threads for each."""
    from app.database import MongoDBManager

    try:
        db = MongoDBManager()
        now = datetime.now()

        # Find pending jobs whose scheduled_at has arrived and are not in a retry backoff
        due_jobs = list(db.db.scheduled_sends.find(
            {
                "status": "pending",
                "scheduled_at": {"$lte": now},
                "$or": [
                    {"retry_not_before": {"$exists": False}},
                    {"retry_not_before": {"$lte": now}},
                ],
            },
            {"_id": 1},
        ))

        for job in due_jobs:
            job_id = str(job["_id"])
            # Atomically mark as running to prevent double-dispatch
            result = db.db.scheduled_sends.update_one(
                {"_id": job["_id"], "status": "pending"},
                {"$set": {"status": "running", "started_at": now}},
            )
            if result.modified_count == 0:
                # Another process already picked it up
                continue

            log.info("[Scheduler] Dispatching job %s", job_id)
            t = threading.Thread(
                target=_execute_send_job,
                args=(job_id,),
                daemon=True,
                name=f"scheduler-job-{job_id}",
            )
            t.start()

    except Exception:
        log.exception("[Scheduler] _poll_and_dispatch failed")


def _check_reminders():
    """Notify the user ~_REMINDER_LEAD_MIN minutes before a pending campaign
    fires. Guarded by `reminder_sent_at` so each campaign only reminds once,
    even though this runs every _POLL_INTERVAL_SEC."""
    from datetime import timedelta
    from app.database import MongoDBManager

    try:
        db = MongoDBManager()
        now = datetime.now()
        # Window sized to the poll interval so a campaign is caught exactly once
        # as it crosses the ~1h-away mark.
        window_start = now + timedelta(minutes=_REMINDER_LEAD_MIN) - timedelta(seconds=_POLL_INTERVAL_SEC)
        window_end   = now + timedelta(minutes=_REMINDER_LEAD_MIN)

        due = list(db.db.scheduled_sends.find(
            {
                "status": "pending",
                "reminder_sent_at": {"$exists": False},
                "scheduled_at": {"$gte": window_start, "$lte": window_end},
            },
            {"_id": 1, "name": 1, "scheduled_at": 1},
        ))

        for job in due:
            result = db.db.scheduled_sends.update_one(
                {"_id": job["_id"], "reminder_sent_at": {"$exists": False}},
                {"$set": {"reminder_sent_at": now}},
            )
            if result.modified_count == 0:
                continue  # another poll tick already claimed it
            db.db.app_notifications.insert_one({
                "type": "schedule_reminder",
                "scheduled_send_id": str(job["_id"]),
                "name": job.get("name", ""),
                "scheduled_at": job.get("scheduled_at"),
                "created_at": now,
            })
            log.info("[Scheduler] Reminder queued for job %s", job["_id"])

    except Exception:
        log.exception("[Scheduler] _check_reminders failed")


def _heartbeat_idle_waha_sessions():
    """Ping presence for WAHA sessions idle >3h so WhatsApp doesn't disconnect them.

    WAHA PR #1586 added maintainPresenceOnline() — a set_presence("available") call
    triggers it internally, resetting the inactivity timer without sending notifications.
    """
    from app.config import WAHA_API_KEY, WAHA_API_URL
    if not WAHA_API_KEY:
        return
    try:
        import requests as _req
        from app.whatsapp_waha import WAHAClient
        _idle_threshold = 3 * 3600  # 3 hours in seconds
        r = _req.get(f"{WAHA_API_URL}/api/sessions",
                     headers={"X-Api-Key": WAHA_API_KEY},
                     params={"all": "false"}, timeout=5)
        sessions = r.json() if r.ok else []
        now_ts = time.time()
        for s in sessions:
            if s.get("status") != "WORKING":
                continue
            session_name = s.get("name", "")
            if not session_name:
                continue
            last_ts = s.get("lastActivityTimestamp")
            if last_ts:
                # WAHA returns epoch-ms; convert to seconds for comparison
                last_ts_sec = last_ts / 1000 if last_ts > 1e10 else float(last_ts)
                idle_sec = now_ts - last_ts_sec
            else:
                idle_sec = _idle_threshold + 1  # no timestamp = treat as idle
            if idle_sec > _idle_threshold:
                WAHAClient(WAHA_API_URL, WAHA_API_KEY, session_name).set_presence("available")
                log.info("[Heartbeat] pinged presence for idle session=%s (idle=%.1fh)",
                         session_name, idle_sec / 3600)
    except Exception:
        log.exception("[Heartbeat] _heartbeat_idle_waha_sessions failed")


def start_scheduler():
    """Launch the scheduled-sends polling loop as a daemon thread. Call once at startup."""
    def _loop():
        global _last_heartbeat_at
        while True:
            _poll_and_dispatch()
            _check_reminders()
            if time.time() - _last_heartbeat_at >= _HEARTBEAT_INTERVAL_SEC:
                _heartbeat_idle_waha_sessions()
                _last_heartbeat_at = time.time()
            time.sleep(_POLL_INTERVAL_SEC)

    t = threading.Thread(target=_loop, daemon=True, name="scheduler-poll")
    t.start()
    log.info("Scheduler background poll started (every %ds)", _POLL_INTERVAL_SEC)
