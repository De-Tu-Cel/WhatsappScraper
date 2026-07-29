# scheduler.py
"""Background scheduler for sending pre-scheduled WhatsApp campaigns."""
import logging
import random
import threading
import time
from datetime import datetime

log = logging.getLogger(__name__)

_POLL_INTERVAL_SEC = 60  # check for due jobs every minute
_REMINDER_LEAD_MIN = 60  # notify ~1h before a scheduled campaign fires


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


def _send_via_evolution(db, company_id: str, to_number: str, message: str, job_id: str):
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

        # Learn JID before sending (so instant bot replies can be matched)
        real_jid_num = evo.get_jid(to_number)
        if real_jid_num:
            db.db.jid_map.update_one(
                {"jid": real_jid_num},
                {"$set": {"company_id": company_id, "to_number": to_number, "updated_at": datetime.now()}},
                upsert=True,
            )

        evo_result = evo.send_text(to_number, message)
        evo_json = evo_result.get("response_json", {})
        message_id = evo_json.get("key", {}).get("id") or evo_json.get("id")
        status = "sent" if evo_result.get("status_code") in (200, 201) else "failed"

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
            "sent_by_username": "scheduler",
            "sent_by_name": "Envio programado",
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

        def _antispam_delay(send_index: int):
            """Delay BEFORE the send_index-th message (0-based, skip for first)."""
            if send_index == 0:
                return
            if send_index % 5 == 0:
                pause_sec = random.uniform(3 * 60, 8 * 60)
                log.warning("[Scheduler] job=%s ⏸  long anti-spam pause %.0fs before msg #%d",
                            job_id, pause_sec, send_index + 1)
                time.sleep(pause_sec)
            else:
                delay_sec = random.uniform(25, 55)
                log.warning("[Scheduler] job=%s ⏳ %.0fs delay before msg #%d",
                            job_id, delay_sec, send_index + 1)
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
                ok = _send_via_evolution(db, cid, to_number, message, job_id)
                if ok:
                    sent_count += 1
                else:
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
                ok = _send_via_evolution(db, cid, to_number, message, job_id)
                send_index += 1
                if ok:
                    sent_count += 1
                else:
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

        # Find pending jobs whose scheduled_at has arrived
        due_jobs = list(db.db.scheduled_sends.find(
            {
                "status": "pending",
                "scheduled_at": {"$lte": now},
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


def start_scheduler():
    """Launch the scheduled-sends polling loop as a daemon thread. Call once at startup."""
    def _loop():
        while True:
            _poll_and_dispatch()
            _check_reminders()
            time.sleep(_POLL_INTERVAL_SEC)

    t = threading.Thread(target=_loop, daemon=True, name="scheduler-poll")
    t.start()
    log.info("Scheduler background poll started (every %ds)", _POLL_INTERVAL_SEC)
