# daily_cap.py — daily message cap tracking per WhatsApp instance
DAILY_CAP = 250

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
    doc = db.db.instance_daily_sends.find_one({"instance": instance_name, "date": _today()})
    return doc["count"] if doc else 0


def increment_daily_count(db, instance_name: str) -> None:
    db.db.instance_daily_sends.update_one(
        {"instance": instance_name, "date": _today()},
        {"$inc": {"count": 1}},
        upsert=True,
    )


def get_scheduled_count_today(db) -> int:
    """Sum of all pending scheduled send recipients for today (local time)."""
    from datetime import datetime, timedelta
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end   = today_start + timedelta(days=1)
    docs = list(db.db.scheduled_sends.find(
        {"status": "pending", "scheduled_at": {"$gte": today_start, "$lt": today_end}},
        {"total_count": 1, "selected_numbers": 1},
    ))
    return sum(d.get("total_count") or len(d.get("selected_numbers") or []) for d in docs)
