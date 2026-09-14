"""Tests for app/followup_queue.py — per-instance anti-ban pacing.

Covers the bug fixed 2026-09-09: the inter-chat gap (45-90s) used to be
tracked with a single global timestamp, so a reply on instance A made a
completely unrelated reply on instance B wait behind it. It's now keyed by
assigned_instance (via _resolve_instance), so only two chats on the SAME
instance should ever wait on each other.

All tests run entirely in-memory:
  - MongoDBManager replaced with a fake exposing companies.find_one
  - process_inbound_reply replaced with a no-op mock (no real LLM/WhatsApp calls)
  - time.sleep replaced with a mock that records calls instead of blocking
"""
from unittest.mock import patch, MagicMock

import pytest

from app import followup_queue as fq


class FakeCompaniesCollection:
    """Maps company_id -> assigned_instance, mirroring the real
    companies.assigned_instance field _resolve_instance reads."""

    def __init__(self, mapping: dict):
        self._mapping = mapping

    def find_one(self, query, projection=None):
        cid = str(query.get("_id"))
        instance = self._mapping.get(cid)
        if instance is None and cid not in self._mapping:
            return None
        return {"assigned_instance": instance}


class FakeMgr:
    def __init__(self, mapping: dict):
        self.db = type("_DB", (), {"companies": FakeCompaniesCollection(mapping)})()


@pytest.fixture(autouse=True)
def _reset_module_state():
    """_last_send_ts is module-level shared state — isolate each test."""
    fq._last_send_ts.clear()
    yield
    fq._last_send_ts.clear()


def _item(phone, company_id, body="hola"):
    return {
        "phone_number": phone,
        "company_id": company_id,
        "inbound_body": body,
        "inbound_log_id": "log1",
        "manual_activation": False,
        "proactive": False,
    }


# ── _resolve_instance ──────────────────────────────────────────────────────

class TestResolveInstance:
    def test_returns_assigned_instance(self):
        mgr = FakeMgr({"aabbccddeeff001122334455": "tono-wa"})
        with patch("app.database.MongoDBManager", return_value=mgr):
            assert fq._resolve_instance("aabbccddeeff001122334455") == "tono-wa"

    def test_none_company_id_falls_back(self):
        assert fq._resolve_instance(None) == fq._UNASSIGNED_KEY

    def test_company_with_no_instance_falls_back(self):
        mgr = FakeMgr({"aabbccddeeff001122334455": None})
        with patch("app.database.MongoDBManager", return_value=mgr):
            assert fq._resolve_instance("aabbccddeeff001122334455") == fq._UNASSIGNED_KEY

    def test_lookup_failure_falls_back(self):
        # Not a valid 24-char hex ObjectId -> ObjectId() raises inside _resolve_instance
        assert fq._resolve_instance("not-a-real-id") == fq._UNASSIGNED_KEY


# ── _process_one — the actual anti-ban pacing behavior ─────────────────────

class TestProcessOnePacing:
    def _run(self, items, instance_map):
        """Process each item through _process_one with process_inbound_reply,
        random.uniform, and time.sleep mocked. Returns the mock so tests can
        inspect call counts/args."""
        mgr = FakeMgr(instance_map)
        sleep_mock = MagicMock()
        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch("app.ai_followup.process_inbound_reply", MagicMock()) as reply_mock,
            patch("app.followup_queue.time.sleep", sleep_mock),
            patch("app.followup_queue.random.uniform", return_value=60.0),
        ):
            for item in items:
                fq._process_one(item)
        return sleep_mock, reply_mock

    def test_different_instances_never_wait_on_each_other(self):
        """The core regression test: instance A processed, then instance B
        immediately after — B must NOT incur the inter-chat gap wait."""
        items = [
            _item("+5211111", "aaaaaaaaaaaaaaaaaaaaaaaa"),
            _item("+5222222", "bbbbbbbbbbbbbbbbbbbbbbbb"),
        ]
        instance_map = {
            "aaaaaaaaaaaaaaaaaaaaaaaa": "instance-A",
            "bbbbbbbbbbbbbbbbbbbbbbbb": "instance-B",
        }
        sleep_mock, reply_mock = self._run(items, instance_map)
        sleep_mock.assert_not_called()
        assert reply_mock.call_count == 2
        # Each instance's own clock is independent
        assert "instance-A" in fq._last_send_ts
        assert "instance-B" in fq._last_send_ts

    def test_same_instance_back_to_back_waits(self):
        """Two chats on the SAME instance processed back-to-back should hit
        the gap — this is the real anti-ban behavior the fix must preserve."""
        items = [
            _item("+5211111", "aaaaaaaaaaaaaaaaaaaaaaaa"),
            _item("+5233333", "cccccccccccccccccccccccc"),
        ]
        instance_map = {
            "aaaaaaaaaaaaaaaaaaaaaaaa": "instance-A",
            "cccccccccccccccccccccccc": "instance-A",  # same instance, different company
        }
        sleep_mock, reply_mock = self._run(items, instance_map)
        sleep_mock.assert_called_once()
        (wait_arg,), _ = sleep_mock.call_args
        assert wait_arg > 0
        assert reply_mock.call_count == 2

    def test_unassigned_companies_share_conservative_bucket(self):
        """Companies with no instance yet still share one fallback bucket —
        same conservative pacing as the pre-fix behavior for that edge case."""
        items = [
            _item("+5211111", "aaaaaaaaaaaaaaaaaaaaaaaa"),
            _item("+5222222", "bbbbbbbbbbbbbbbbbbbbbbbb"),
        ]
        instance_map = {
            "aaaaaaaaaaaaaaaaaaaaaaaa": None,
            "bbbbbbbbbbbbbbbbbbbbbbbb": None,
        }
        sleep_mock, _ = self._run(items, instance_map)
        sleep_mock.assert_called_once()

    def test_first_message_ever_on_an_instance_never_waits(self):
        items = [_item("+5211111", "aaaaaaaaaaaaaaaaaaaaaaaa")]
        instance_map = {"aaaaaaaaaaaaaaaaaaaaaaaa": "instance-A"}
        sleep_mock, reply_mock = self._run(items, instance_map)
        sleep_mock.assert_not_called()


# ── _expire_idle_sessions — the idle-timeout config-consistency fix ────────
#
# Covers the bug fixed 2026-09-14: this sweep used to hard-code
# SESSION_IDLE_TIMEOUT_HOURS = 4, completely separate from ai_followup.py's
# _get_idle_timeout_hours (configurable, production has it set to 48h). The
# sweep ran every 30 min regardless, so ANY "active"/"waiting" session got
# closed at the 4h mark no matter what the admin had configured — the 48h
# grace window could never actually apply. Now it reads the same config.

from datetime import datetime, timedelta


class FakeExpirySessionsCollection:
    def __init__(self, sessions):
        self._sessions = {s["_id"]: dict(s) for s in sessions}

    def find(self, query, projection=None):
        cutoff = query["last_activity"]["$lt"]
        statuses = set(query["status"]["$in"])
        return [dict(s) for s in self._sessions.values()
                if s["status"] in statuses and s["last_activity"] < cutoff]

    def update_many(self, query, update):
        ids = set(query["_id"]["$in"])
        n = 0
        for sid, s in self._sessions.items():
            if sid in ids:
                s.update(update.get("$set", {}))
                n += 1
        return MagicMock(modified_count=n)


class FakePrefsUpdateMany:
    def __init__(self):
        self.calls = []

    def update_many(self, query, update):
        self.calls.append((query, update))
        return MagicMock()


class FakeGlobalConfigCollection:
    def __init__(self, hours):
        self._hours = hours

    def find_one(self, query=None, *a, **kw):
        return {"_id": "global", "idle_timeout_hours": self._hours}


class FakeExpiryDB:
    def __init__(self, sessions, idle_timeout_hours):
        self.ai_followup_sessions = FakeExpirySessionsCollection(sessions)
        self.conversation_ai_prefs = FakePrefsUpdateMany()
        self.ai_global_config = FakeGlobalConfigCollection(idle_timeout_hours)
        self.message_logs = MagicMock()
        self.message_logs.find_one.return_value = None  # no last_inbound -> skip the analysis thread
        self.companies = MagicMock()
        self.companies.find.return_value = []


class FakeExpiryMgr:
    def __init__(self, sessions, idle_timeout_hours):
        self.db = FakeExpiryDB(sessions, idle_timeout_hours)


def _stale_session(sid, hours_silent, status="active"):
    return {
        "_id": sid,
        "company_id": f"company_{sid}",
        "phone_number": "5210000000000",
        "status": status,
        "last_activity": datetime.utcnow() - timedelta(hours=hours_silent),
    }


class TestExpireIdleSessionsRespectsConfig:
    def test_does_not_expire_before_the_configured_timeout(self):
        """10h of silence with idle_timeout_hours=48 (the real production value)
        must NOT expire the session — this would have wrongly expired under the
        old hardcoded 4h."""
        sess = _stale_session("s1", hours_silent=10)
        mgr = FakeExpiryMgr([sess], idle_timeout_hours=48)
        fq._expire_idle_sessions(mgr)
        assert mgr.db.ai_followup_sessions._sessions["s1"]["status"] == "active"
        assert mgr.db.conversation_ai_prefs.calls == []

    def test_expires_once_past_the_configured_timeout(self):
        sess = _stale_session("s2", hours_silent=50)
        mgr = FakeExpiryMgr([sess], idle_timeout_hours=48)
        fq._expire_idle_sessions(mgr)
        assert mgr.db.ai_followup_sessions._sessions["s2"]["status"] == "ended"
        assert mgr.db.ai_followup_sessions._sessions["s2"]["end_reason"] == "idle_timeout"
        assert len(mgr.db.conversation_ai_prefs.calls) == 1

    def test_shorter_configured_timeout_still_expires_promptly(self):
        """A company that configured a short idle_timeout_hours (e.g. 2h) should
        still get that honored, not silently stretched to some other default."""
        sess = _stale_session("s3", hours_silent=3)
        mgr = FakeExpiryMgr([sess], idle_timeout_hours=2)
        fq._expire_idle_sessions(mgr)
        assert mgr.db.ai_followup_sessions._sessions["s3"]["status"] == "ended"
