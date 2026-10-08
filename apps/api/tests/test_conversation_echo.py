from datetime import datetime, timedelta

from app.database import collapse_echoed_messages


def _msg(direction, body, seconds, mid=None):
    return {
        "direction": direction,
        "message_body": body,
        "created_at": datetime(2026, 10, 8, 17, 9, 0) + timedelta(seconds=seconds),
        "message_id": mid,
    }


def test_supergas_double_hola_disappears_from_the_thread():
    rows = collapse_echoed_messages([
        _msg("outbound", "Hola", 0),
        _msg("inbound", "Hola", 2571),
        _msg("inbound", "Hola", 2571.002),
        _msg("outbound", "oye qué tal", 2580),
        _msg("inbound", "Disculpa estas equivocado", 2763),
        _msg("inbound", "Disculpa estas equivocado", 2763.002),
    ])
    bodies = [(r["direction"], r["message_body"]) for r in rows]
    assert bodies == [
        ("outbound", "Hola"),
        ("inbound", "Hola"),
        ("outbound", "oye qué tal"),
        ("inbound", "Disculpa estas equivocado"),
    ]


def test_two_real_holas_a_minute_apart_stay():
    rows = collapse_echoed_messages([
        _msg("inbound", "Hola", 0),
        _msg("inbound", "Hola", 60),
    ])
    assert len(rows) == 2
