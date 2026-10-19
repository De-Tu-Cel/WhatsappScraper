from datetime import datetime, timedelta
from types import SimpleNamespace

from app.instance_metrics import (
    first_response_delays,
    summarize_disconnects,
    summarize_response_delays,
    summarize_send_outcomes,
)

T0 = datetime(2026, 10, 19, 15, 0)


def test_send_outcomes_split_blocked_from_real_failures():
    totals, instances = summarize_send_outcomes([
        {"_id": {"i": "a", "s": "sent", "b": False}, "n": 4},
        {"_id": {"i": "a", "s": "read", "b": False}, "n": 2},
        {"_id": {"i": "a", "s": "failed", "b": False}, "n": 1},
        {"_id": {"i": "b", "s": "failed", "b": True}, "n": 3},
        {"_id": {"i": "b", "s": "delivered", "b": False}, "n": 1},
        {"_id": {"i": "b", "s": None, "b": False}, "n": 5},
    ])
    assert totals == {"confirmed": 7, "delivered": 3, "failed": 1, "blocked": 3, "other": 5}
    assert instances == [
        {"instance_name": "a", "confirmed": 6, "failed": 1, "blocked": 0},
        {"instance_name": "b", "confirmed": 1, "failed": 0, "blocked": 3},
    ]


def test_first_response_uses_first_reply_after_first_send_only():
    first_outbound = {"c1": T0, "c2": T0, "c3": T0}
    inbound = [
        {"company_id": "c1", "created_at": T0 - timedelta(minutes=10)},  # anterior al envío: no cuenta
        {"company_id": "c1", "created_at": T0 + timedelta(minutes=3)},
        {"company_id": "c1", "created_at": T0 + timedelta(minutes=50)},  # segunda respuesta: ignorada
        {"company_id": "c2", "created_at": T0 + timedelta(hours=2)},
        {"company_id": "zz", "created_at": T0 + timedelta(minutes=1)},  # no contactada
    ]
    delays = first_response_delays(first_outbound, inbound)
    assert [round(m) for _, m in delays] == [3, 120]


def test_response_summary_median_histogram_and_buckets():
    day2 = T0 + timedelta(days=1)
    summary = summarize_response_delays(
        [(T0, 3), (T0, 45), (day2, 600), (day2, 2000)], "%Y-%m-%d")
    assert summary["count"] == 4
    assert summary["median_minutes"] == 322.5
    assert {h["key"]: h["count"] for h in summary["histogram"]} == {
        "lt5m": 1, "5_30m": 0, "30m_2h": 1, "2_8h": 0, "8_24h": 1, "gt24h": 1}
    assert summary["timeseries"] == [
        {"bucket": "2026-10-19", "median_minutes": 24.0, "count": 2},
        {"bucket": "2026-10-20", "median_minutes": 1300.0, "count": 2},
    ]


def test_response_summary_without_replies_is_empty_not_zero():
    summary = summarize_response_delays([], "%Y-%m-%d")
    assert summary["median_minutes"] is None
    assert summary["count"] == 0
    assert summary["timeseries"] == []


def test_disconnects_grouped_per_instance_and_reason():
    stability, reasons = summarize_disconnects(
        [
            {"_id": {"i": "a", "r": "HEARTBEAT_TIMEOUT"}, "n": 2, "label": "Sesión desconectada"},
            {"_id": {"i": "b", "r": "HEARTBEAT_TIMEOUT"}, "n": 1, "label": "Sesión desconectada"},
            {"_id": {"i": "b", "r": "LOGOUT"}, "n": 1, "label": "Requiere volver a escanear QR/código"},
        ],
        ["a", "b", "c"],
        {"a": {"uptime_pct": 90.0}, "b": {"uptime_pct": 40.0}, "c": {"uptime_pct": None}},
    )
    assert [(s["instance_name"], s["disconnects"]) for s in stability] == [("b", 2), ("a", 2), ("c", 0)]
    assert stability[0]["reasons"] == {"HEARTBEAT_TIMEOUT": 1, "LOGOUT": 1}
    assert [(r["reason"], r["count"]) for r in reasons] == [("HEARTBEAT_TIMEOUT", 3), ("LOGOUT", 1)]


def test_wwebjs_ack_never_downgrades_or_touches_failed(monkeypatch):
    from app.database import MongoDBManager
    calls = []

    class Collection:
        def update_one(self, query, update):
            calls.append(query)
            return SimpleNamespace(modified_count=1)

    manager = MongoDBManager.__new__(MongoDBManager)
    manager.db = SimpleNamespace(message_logs=Collection())
    assert manager.update_message_ack_status("m1", "delivered") is True
    assert "read" not in calls[-1]["status"]["$in"] and "failed" not in calls[-1]["status"]["$in"]
    manager.update_message_ack_status("m1", "read")
    assert "delivered" in calls[-1]["status"]["$in"] and "failed" not in calls[-1]["status"]["$in"]
    assert manager.update_message_ack_status("m1", "played") is False
    assert manager.update_message_ack_status("", "read") is False
    assert len(calls) == 2
