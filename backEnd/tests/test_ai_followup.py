"""Tests for app/ai_followup.py — the "Andy" AI follow-up conversation flow.

Covers the bug fixed 2026-09-14: when the LLM's entire reply is just "[FIN]"
(no accompanying text — it decided to end the conversation with nothing left
to say), the code stripped "[FIN]" out and tried to send the resulting EMPTY
string. Every send path (Evolution/WAHA/Wasender/wwebjs) rejects an empty
message, and that exception was caught by a broad handler that only reset
ai_typing — the session was left stuck at status="active" forever (confirmed
live in production for a real company, "Alceautomotriz": turn_count stayed 0,
no retry, nothing else ever revisits an "active" session outside of a new
inbound message).

process_inbound_reply has a lot of surface area (anti-detection sleeps,
instance selection, daily caps, multi-provider sends) — these tests patch
every side effect and check only the one thing that matters here: a bare
"[FIN]" must close the session directly and must NEVER reach the send layer.
"""
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from app import ai_followup as af


class FakeSessionsCollection:
    """In-memory ai_followup_sessions — enough of find_one/update_one to drive
    process_inbound_reply's control flow without a real database."""

    def __init__(self, doc):
        self._doc = dict(doc)
        self.updates = []

    def find_one(self, query=None, *a, **kw):
        return dict(self._doc)

    def update_one(self, query, update):
        self.updates.append(update)
        for k, v in update.get("$set", {}).items():
            self._doc[k] = v
        return MagicMock(modified_count=1)


class FakePrefsCollection:
    def __init__(self):
        self.updates = []

    def find_one(self, query=None, *a, **kw):
        return {"ai_enabled": True}

    def update_one(self, query, update, **kw):
        self.updates.append(update)
        return MagicMock()


class FakeGlobalConfigCollection:
    def find_one(self, query=None, *a, **kw):
        return {"_id": "global", "idle_timeout_hours": 48}


class FakeDB:
    def __init__(self, session_doc):
        self.ai_followup_sessions = FakeSessionsCollection(session_doc)
        self.conversation_ai_prefs = FakePrefsCollection()
        self.ai_global_config = FakeGlobalConfigCollection()
        self.message_logs = MagicMock()


class FakeMgr:
    def __init__(self, session_doc):
        self.db = FakeDB(session_doc)


def _session_doc(**overrides):
    doc = {
        "_id": "sess1",
        "phone_number": "5214428079840",
        "company_id": "aabbccddeeff001122334455",
        "status": "active",
        "turns": [],
        "turn_count": 0,
        "max_turns": 10,
        "context": {},
        "ai_typing": False,
        "last_activity": datetime.utcnow(),
        "created_at": datetime.utcnow(),
    }
    doc.update(overrides)
    return doc


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    monkeypatch.setattr(af.time, "sleep", lambda *a, **kw: None)


@pytest.fixture
def _common_patches():
    """Everything process_inbound_reply touches before/around the LLM call,
    stubbed to a known-good state so the test isolates the [FIN]-handling path."""
    with patch("app.llm.active_provider", return_value="openai"), \
         patch("app.ai_followup._is_business_hours", return_value=True), \
         patch("app.ai_followup._is_blocked_or_blacklisted", return_value=False), \
         patch("app.classifier._looks_like_auto_reply", return_value=False):
        yield


class TestBareFinClosesWithoutSending:
    def test_session_marked_ended_not_left_active(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="[FIN]"):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "ai_decision"
        assert mgr.db.ai_followup_sessions._doc["ai_typing"] is False

    def test_never_reaches_the_send_layer(self, _common_patches):
        """The actual bug: sending an empty string. If the fix regresses, this
        also regresses back to attempting a send with instance=None/empty text."""
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="[FIN]"), \
             patch("app.whatsapp_evolution.pick_connected_instance") as mock_pick, \
             patch("app.whatsapp_evolution.EvolutionClient") as mock_client:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        mock_pick.assert_not_called()
        mock_client.assert_not_called()

    def test_disables_ai_toggle_for_the_company(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="[FIN]"):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"]["ai_enabled"] is False


class TestFinWithRealTextStillSends:
    """Sanity check the fix is scoped correctly: "[FIN]" attached to REAL text
    (the normal, working case — e.g. "ah ok déjame pensarlo[FIN]") must still
    go through the send path, not get swallowed by the new early-return."""

    def test_fin_with_text_does_not_take_the_early_return(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, luego te aviso[FIN]"), \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value=None) as mock_pick:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        # pick_connected_instance IS reached this time (returns None here only to
        # short-circuit the rest of the real send code, which needs a live wwebjs
        # client this test isn't set up to fake).
        mock_pick.assert_called_once()


class TestNoConnectedInstanceClosesSession:
    """Deep-audit finding (2026-09-14): every "no connected instance" exit used
    to just reset ai_typing and return, leaving the session stuck "active"
    forever — every future reply on the same chat would keep failing at this
    exact point (wasting an LLM call each time) with no visible signal that
    anything was wrong. This is structural (not a one-off network blip), so it
    should close the session and disable the toggle right away."""

    def test_closes_with_no_instance_reason(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value=None):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "no_instance"
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"]["ai_enabled"] is False


class TestTransientFailuresDoNotKillTheSession:
    """The other side of the same audit: failures that are typically transient
    (a single flaky LLM API call, a network blip during the actual send)
    should NOT close the session or disable the toggle — that would kill a
    perfectly healthy conversation over a one-off hiccup. They should leave it
    "active" so the next inbound message (or the idle-timeout sweep in
    followup_queue.py, if the contact never writes again) gets a clean retry."""

    def test_llm_returning_none_leaves_session_active(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value=None):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "active"
        assert "end_reason" not in mgr.db.ai_followup_sessions._doc
        assert mgr.db.conversation_ai_prefs.updates == []

    def test_send_exception_leaves_session_active(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value="sender666"), \
             patch("app.whatsapp_evolution.EvolutionClient", side_effect=RuntimeError("network blip")):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "active"
        assert mgr.db.ai_followup_sessions._doc["ai_typing"] is False
        assert mgr.db.conversation_ai_prefs.updates == []

    def test_daily_cap_reached_leaves_session_active(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value="sender666"), \
             patch("app.daily_cap.get_instance_cap", return_value=50), \
             patch("app.daily_cap.reserve_daily_slot", return_value=(False, False)), \
             patch("app.daily_cap.notify_cap_reached_once"):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "active"
        assert mgr.db.ai_followup_sessions._doc["ai_typing"] is False
        assert mgr.db.conversation_ai_prefs.updates == []


class FakeCompaniesForContext:
    def __init__(self, doc):
        self._doc = doc

    def find_one(self, query, projection=None):
        return dict(self._doc)


class FakeInstancesForContext:
    def __init__(self, doc):
        self._doc = doc

    def find_one(self, query, projection=None):
        return dict(self._doc) if self._doc is not None else None


class FakeGlobalConfigNone:
    def find_one(self, query=None, *a, **kw):
        return None


class FakeContextDB:
    def __init__(self, company_doc, instance_doc):
        self.companies = FakeCompaniesForContext(company_doc)
        self.instances = FakeInstancesForContext(instance_doc)
        self.ai_global_config = FakeGlobalConfigNone()


class FakeContextMgr:
    def __init__(self, company_doc, instance_doc):
        self.db = FakeContextDB(company_doc, instance_doc)


def _company_doc(**overrides):
    doc = {
        "name": "Doctor Restaurant", "domain": "doctor-restaurant.com.mx",
        "industry": "restaurante", "city": "Guadalajara",
        "assigned_instance": "sender666",
        "services": [], "products": [], "description": "", "main_activity": "", "website": "",
    }
    doc.update(overrides)
    return doc


class TestPersonaNameFromWhatsappProfile:
    """The AI's persona name must match whichever real WhatsApp profile is
    actually sending the messages (per-instance profile_name, synced from the
    real account) — not a single hardcoded name shared across every
    conversation regardless of which number is actually used. Verified with
    real production data: sender666.profile_name="Marco", sender4="Marco
    Adrian", gely-test2="Richie" — each instance has its own real name."""

    def test_uses_first_name_of_assigned_instance_profile(self):
        mgr = FakeContextMgr(_company_doc(), {"profile_name": "Marco Adrian"})
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        assert ctx["persona_name"] == "Marco"

    def test_falls_back_to_default_when_instance_has_no_profile_name(self):
        mgr = FakeContextMgr(_company_doc(), {})  # no profile_name synced yet
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        assert ctx["persona_name"] == af.DEFAULT_PERSONA_NAME

    def test_falls_back_to_default_when_company_has_no_assigned_instance(self):
        mgr = FakeContextMgr(_company_doc(assigned_instance=None), {"profile_name": "Marco"})
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        assert ctx["persona_name"] == af.DEFAULT_PERSONA_NAME

    def test_persona_name_actually_reaches_the_real_system_prompt_text(self):
        """End-to-end: the resolved persona_name must actually appear in the
        real system prompt text handed to the LLM, not just sit unused in the
        ctx dict — and the old hardcoded "Andrés" must be gone from it."""
        mgr = FakeContextMgr(_company_doc(), {"profile_name": "Richie"})
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        assert ctx is not None

        captured = {}

        def _fake_call_llm(messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return "ah ok gracias"

        with patch("app.llm.call_llm", side_effect=_fake_call_llm):
            af._call_llm_for_reply([], ctx, is_cold_start=True, db=mgr)

        assert "Eres Richie" in captured["system"]
        assert "Andrés" not in captured["system"]
