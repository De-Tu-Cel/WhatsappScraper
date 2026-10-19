"""One informational notice per overnight rest window; no WhatsApp operations."""
from datetime import datetime, timedelta, timezone

from app.activity_hours import MEXICO, activity_allowed, next_activity_opening


def automation_notifications(since=None, *, now=None):
    current = now or datetime.now(timezone.utc)
    if activity_allowed(current):
        return []
    local = current.astimezone(MEXICO)
    closing = local.replace(hour=19, minute=0, second=0, microsecond=0)
    if local.hour < 8:
        closing -= timedelta(days=1)
    closing = closing.astimezone(timezone.utc)
    if since is not None:
        cutoff = since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since
        if closing <= cutoff:
            return []
    return [{
        '_id': f'automation-rest:{closing.isoformat()}',
        'type': 'automation_rest',
        'created_at': closing.isoformat(),
        'resumes_at': next_activity_opening(current).isoformat(),
        'timezone': 'America/Mexico_City',
    }]
