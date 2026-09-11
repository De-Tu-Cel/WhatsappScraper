# daily_cap.py — daily message cap tracking per WhatsApp instance
DAILY_CAP  = 150
WARMUP_CAP = 20

# Max first-time (never-messaged-before) contacts per instance per day.
# Warmup accounts are much newer/riskier; normal accounts get more room.
WARMUP_NEW_CONTACTS_CAP = 5
NORMAL_NEW_CONTACTS_CAP = 12

def get_instance_cap(db, instance_name: str) -> int:
    inst = db.db.instances.find_one({"name": instance_name}, {"warmup_mode": 1})
    return WARMUP_CAP if (inst or {}).get("warmup_mode") else DAILY_CAP

import os as _os

def _today() -> str:
    try:
        import pytz
        tz = pytz.timezone(_os.environ.get("APP_TIMEZONE", "America/Mexico_City"))
        from datetime import datetime
        return datetime.now(tz).strftime("%Y-%m-%d")
    except Exception:
        from datetime import datetime
        return datetime.now().strftime("%Y-%m-%d")


def get_daily_count(db, instance_name: str) -> int:
    """Number of DISTINCT phone numbers contacted today via this instance — not raw
    message count. The warmup cap exists to control how many new/ongoing people a
    warming-up number talks to per day, not how many messages it fires — the SAME
    number contacted twice today (a repeat send, or an Andy follow-up reply) should
    only ever cost 1 of today's slots, not N. Different numbers of the same
    company (a deliberate multi-number bulk send) DO each cost their own slot —
    that's real new-contact risk from WhatsApp's point of view, company or not."""
    doc = db.db.instance_daily_sends.find_one({"instance": instance_name, "date": _today()})
    return len(doc.get("companies", [])) if doc else 0


def increment_daily_count(db, instance_name: str, phone_digits: str = None) -> None:
    """Records a contact for today, deduped by the actual phone number (normalized
    digits) — sending a 2nd message to the same number today (a repeat, or an Andy
    follow-up reply) never grows the count. Callers with no resolvable number
    (shouldn't happen — you can't send without a destination) still get counted,
    just not deduped against anything.

    NOTE: this alone does NOT close the daily-cap race — see reserve_daily_slot()
    below, which is what actually gates a send. This function still exists for
    the couple of call sites that only ever run after a send already succeeded
    and don't need the atomic reserve/release pair (nothing else could have
    raced them by that point)."""
    import uuid
    key = phone_digits or f"_no_number_{uuid.uuid4().hex[:8]}"
    db.db.instance_daily_sends.update_one(
        {"instance": instance_name, "date": _today()},
        {"$addToSet": {"companies": key}},  # field name kept as-is, only key semantics changed
        upsert=True,
    )


def reserve_daily_slot(db, instance_name: str, cap: int, phone_digits: str = None) -> tuple[bool, bool]:
    """Atomically claims today's slot for phone_digits BEFORE sending, closing the
    check-then-act race that let two concurrent senders (manual send + scheduled
    campaign + queued batch all hit the same instance) both read "under cap" and
    both send, exceeding DAILY_CAP/WARMUP_CAP by however many raced. The old
    pattern was `if get_daily_count(...) >= cap: skip` followed by
    `increment_daily_count(...)` only after a real network send completed —
    two separate round trips with a real HTTP call in between, wide open to
    exactly that race.

    The $addToSet itself is what's atomic (MongoDB serializes writes to the same
    document) — there's no separate "check" step left to race against.

    Returns (allowed, was_new_reservation):
      allowed=False           → cap is full, nothing was changed, do not send.
      allowed=True,  new=False → phone_digits already had a slot from an earlier
                                  send today (a repeat) — this call didn't
                                  consume anything, never release it.
      allowed=True,  new=True  → a slot was freshly claimed for phone_digits. If
                                  the send this was reserved for ultimately
                                  fails, call release_daily_slot with the SAME
                                  phone_digits so a failed send doesn't cost
                                  real quota (matching the old increment-only
                                  -on-success behavior)."""
    import uuid
    from pymongo import ReturnDocument
    key = phone_digits or f"_no_number_{uuid.uuid4().hex[:8]}"
    today = _today()
    before = db.db.instance_daily_sends.find_one_and_update(
        {"instance": instance_name, "date": today},
        {"$addToSet": {"companies": key}},
        upsert=True,
        return_document=ReturnDocument.BEFORE,
    )
    if key in ((before or {}).get("companies") or []):
        return True, False  # repeat contact — already had a slot, didn't consume a new one

    after = db.db.instance_daily_sends.find_one({"instance": instance_name, "date": today}, {"companies": 1})
    if len((after or {}).get("companies", [])) > cap:
        # This reservation is the one that pushed it over — give it back.
        db.db.instance_daily_sends.update_one(
            {"instance": instance_name, "date": today},
            {"$pull": {"companies": key}},
        )
        return False, False
    return True, True


def release_daily_slot(db, instance_name: str, phone_digits: str) -> None:
    """Gives back a slot from reserve_daily_slot() when the send it was reserved
    for ultimately failed. Only call this when that call returned
    was_new_reservation=True — releasing a repeat's slot would incorrectly free
    up capacity an EARLIER successful send today is still legitimately using."""
    if not phone_digits:
        return
    db.db.instance_daily_sends.update_one(
        {"instance": instance_name, "date": _today()},
        {"$pull": {"companies": phone_digits}},
    )


def notify_cap_reached_once(db, instance_name: str) -> None:
    """Fires a `cap_reached` app_notifications entry the FIRST time this instance
    hits its daily cap today — later skipped sends the same day stay silent so a
    stalled batch doesn't flood the bell with duplicate alerts. Same atomic-claim
    pattern as scheduler.py's schedule_reminder (`reminder_sent_at` on the source
    doc), here claimed on the instance doc itself via `cap_notified_date`."""
    from datetime import datetime
    today = _today()
    result = db.db.instances.update_one(
        {"name": instance_name, "cap_notified_date": {"$ne": today}},
        {"$set": {"cap_notified_date": today}},
    )
    if result.modified_count == 0:
        return  # already notified today for this instance
    inst = db.db.instances.find_one({"name": instance_name}, {"label": 1, "assigned_to": 1}) or {}
    notif = {
        "type":       "cap_reached",
        "instance":   instance_name,
        "label":      inst.get("label") or instance_name,
        "cap":        get_instance_cap(db, instance_name),
        "created_at": datetime.now(),
    }
    if inst.get("assigned_to"):
        notif["user_id"] = inst["assigned_to"]
    db.db.app_notifications.insert_one(notif)


def get_scheduled_count_for_date(db, target_date, exclude_id=None, user_id=None) -> int:
    """Sum of all pending scheduled send recipients for a given local calendar day.
    Pass user_id to scope to a single user's campaigns (avoids cross-user inflation)."""
    from datetime import datetime, timedelta
    day_start = datetime(target_date.year, target_date.month, target_date.day)
    day_end   = day_start + timedelta(days=1)
    query = {"status": "pending", "scheduled_at": {"$gte": day_start, "$lt": day_end}}
    if user_id:
        query["user_id"] = user_id
    if exclude_id:
        from bson import ObjectId
        try:
            query["_id"] = {"$ne": ObjectId(exclude_id)}
        except Exception:
            pass
    docs = list(db.db.scheduled_sends.find(query, {"total_count": 1, "selected_numbers": 1}))
    return sum(d.get("total_count") or len(d.get("selected_numbers") or []) for d in docs)


def get_scheduled_count_today(db) -> int:
    """Sum of all pending scheduled send recipients for today (local time)."""
    from datetime import datetime
    return get_scheduled_count_for_date(db, datetime.now().date())


def get_new_contacts_limit(warmup_mode: bool) -> int:
    return WARMUP_NEW_CONTACTS_CAP if warmup_mode else NORMAL_NEW_CONTACTS_CAP


def _today_utc_range():
    """(today_start, tomorrow) as naive UTC datetimes for message_logs queries."""
    from datetime import datetime, timedelta
    today_str = _today()
    try:
        import pytz
        tz = pytz.timezone(_os.environ.get("APP_TIMEZONE", "America/Mexico_City"))
        today_local = tz.localize(datetime.strptime(today_str, "%Y-%m-%d"))
        today_start = today_local.astimezone(pytz.utc).replace(tzinfo=None)
    except Exception:
        today_start = datetime.strptime(today_str, "%Y-%m-%d")
    return today_start, today_start + timedelta(days=1)


def count_new_contacts_today_for_instance(db, instance_name: str) -> int:
    """How many first-ever contacts this instance made today.
    'New' = company_id has no outbound log from ANY instance before today."""
    today_start, tomorrow = _today_utc_range()

    companies_today = db.db.message_logs.distinct(
        "company_id",
        {
            "direction":     "outbound",
            "instance_name": instance_name,
            "company_id":    {"$exists": True, "$ne": None},
            "created_at":    {"$gte": today_start, "$lt": tomorrow},
        },
    )
    if not companies_today:
        return 0

    prior = set(db.db.message_logs.distinct(
        "company_id",
        {
            "direction":  "outbound",
            "company_id": {"$in": companies_today},
            "created_at": {"$lt": today_start},
        },
    ))
    return sum(1 for c in companies_today if c not in prior)


def is_new_contact(db, company_id: str) -> bool:
    """True if this company_id has never received an outbound message from any instance."""
    return db.db.message_logs.find_one(
        {"direction": "outbound", "company_id": company_id},
        {"_id": 1},
    ) is None


def check_new_contact_cap(db, instance_name: str, company_id: str) -> tuple:
    """Returns (allowed, count_today, limit).
    Existing contacts always pass. New contacts are gated against per-instance cap."""
    if not company_id or not is_new_contact(db, company_id):
        return True, 0, 0
    inst    = db.db.instances.find_one({"name": instance_name}, {"warmup_mode": 1})
    warmup  = bool((inst or {}).get("warmup_mode"))
    limit   = get_new_contacts_limit(warmup)
    count   = count_new_contacts_today_for_instance(db, instance_name)
    return count < limit, count, limit


def get_capacity_for_date(db, user_id: str, target_date, exclude_id=None) -> dict:
    """Estimated combined capacity for a future calendar day — used to warn before
    scheduling more than a day can hold. Per-instance attribution isn't possible here
    (which instance a not-yet-contacted company will use is only resolved at send
    time), so this is a combined total, not per-instance rows like get_daily_count."""
    instances = list(db.db.instances.find({"assigned_to": user_id})) if user_id else []
    total_cap = sum(get_instance_cap(db, i["name"]) for i in instances) if instances else 0
    scheduled_that_day = get_scheduled_count_for_date(db, target_date, exclude_id, user_id=user_id)
    # For today, also subtract messages already sent so the estimate reflects
    # real remaining capacity, not just the scheduled-sends portion of the quota.
    already_sent = 0
    if str(target_date) == _today():
        already_sent = sum(get_daily_count(db, i["name"]) for i in instances)
    total_available = max(0, total_cap - scheduled_that_day - already_sent)
    return {
        "total_cap":          total_cap,
        "scheduled_that_day": scheduled_that_day,
        "total_available":    total_available,
    }
