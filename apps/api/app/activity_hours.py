"""Shared automatic activity window, independent of the server timezone."""
from datetime import datetime, timedelta, timezone
import pytz

MEXICO = pytz.timezone('America/Mexico_City')


def activity_allowed(now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(MEXICO)
    return 8 <= local.hour < 19


def next_activity_opening(now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(MEXICO)
    opening = local.replace(hour=8, minute=0, second=0, microsecond=0)
    if local >= opening:
        opening += timedelta(days=1)
    return opening.astimezone(timezone.utc)
