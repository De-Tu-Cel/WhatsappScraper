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
        # is_cold_start now counts real inbound message_logs docs (see
        # ai_followup.py) instead of the session's own turn_count — default to
        # 1 (a genuine cold start) so existing tests keep their prior behavior
        # unless a test overrides this to exercise the "mid-conversation
        # reactivation" case specifically.
        self.message_logs.count_documents.return_value = 1
        self.jid_map = MagicMock()


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
    stubbed to a known-good state so the test isolates the [FIN]-handling path.

    get_all_connected_instances defaults to ["sender666"] — instance
    resolution now happens BEFORE the LLM call (see ai_followup.py: persona_name
    must be corrected to the real sending instance before the LLM generates
    text), so every test needs a resolvable instance to even reach the LLM,
    not just the ones that exercise sending. Without this, every test would
    also hit a REAL network call out to wwebjs-service via the un-mocked
    default. Tests that specifically exercise "no instance connected" override
    this to []."""
    with patch("app.llm.active_provider", return_value="openai"), \
         patch("app.ai_followup._is_business_hours", return_value=True), \
         patch("app.ai_followup._is_blocked_or_blacklisted", return_value=False), \
         patch("app.classifier._looks_like_auto_reply", return_value=False), \
         patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender666"]), \
         patch("app.whatsapp_wwebjs.WWebjsClient"), \
         patch("app.whatsapp_wwebjs.mark_read"):
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
        # A bare [FIN] is the LLM's own content judgment, not a technical failure —
        # a genuine reply arriving later on this same company must still be able
        # to auto-reactivate (see _user_explicitly_disabled in routes.py's webhook
        # handlers, which only treats a real MANUAL disable as a permanent block).
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"]["auto_disabled"] is True


class TestCopiedPromptExampleTriggersRetry:
    """Bug fixed 2026-09-15: confirmed live in production ("Come Bien") — the
    LLM sent "no, tengo una pregunta nada más. qué tiene de raro?", a CUANDO TE
    CONFRONTAN example lifted verbatim from its own prompt, even though nobody
    had accused it of being a bot. The prompt already says never to copy its
    examples; this catches it anyway and gives the model one corrected retry
    before giving up."""

    _COPIED_EXAMPLE = "no, tengo una pregunta nada más. qué tiene de raro?"

    def test_retries_once_and_sends_the_corrected_reply(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        fake_ww_client = MagicMock()
        fake_ww_client.send.return_value = {"success": True, "messageId": "abc123"}
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply",
                   side_effect=[self._COPIED_EXAMPLE, "oye que bien que ya me contestas, tienen servicio a domicilio?"]) as mock_llm, \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender666"]), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=fake_ww_client), \
             patch("app.whatsapp_wwebjs.mark_read"), \
             patch("app.whatsapp_evolution.pick_connected_instance") as mock_evo_pick:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mock_llm.call_count == 2
        assert "copiada" in mock_llm.call_args_list[1].kwargs["correction"]
        mock_evo_pick.assert_not_called()
        fake_ww_client.send.assert_called_once()
        sent_text = fake_ww_client.send.call_args.args[1]
        assert sent_text == "oye que bien que ya me contestas, tienen servicio a domicilio?"
        assert mgr.db.ai_followup_sessions._doc.get("end_reason") != "ai_decision"

    def test_closes_without_sending_if_retry_also_copies(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value=self._COPIED_EXAMPLE) as mock_llm, \
             patch("app.whatsapp_evolution.pick_connected_instance") as mock_evo_pick:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mock_llm.call_count == 2
        mock_evo_pick.assert_not_called()  # never even reached instance-picking
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "ai_decision"


class TestFinWithRealTextStillSends:
    """Sanity check the fix is scoped correctly: "[FIN]" attached to REAL text
    (the normal, working case — e.g. "ah ok déjame pensarlo[FIN]") must still
    go through the send path, not get swallowed by the new early-return."""

    def test_fin_with_text_does_not_take_the_early_return(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        fake_ww_client = MagicMock()
        fake_ww_client.send.return_value = {"success": True, "messageId": "abc123"}
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, luego te aviso[FIN]"), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=fake_ww_client):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        # The real send path IS reached this time (unlike the bare-[FIN] case) —
        # proven by the actual send call going through, not just by inspecting
        # the early-return's absence.
        fake_ww_client.send.assert_called_once()


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
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=[]), \
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
        # A disconnected instance / send failure is a real operational problem —
        # a human needs to notice and fix it, so this must stay a hard block
        # (unlike the "ai_decision" / bare-[FIN] case, see auto_disabled tests below).
        assert "auto_disabled" not in mgr.db.conversation_ai_prefs.updates[-1]["$set"]


class TestWwebjsCheckedBeforeEvolutionFallback:
    """Bug fixed 2026-09-15: when a company has no assigned_instance (e.g. it
    was only ever contacted via /send-message with an explicit `instance`,
    which never stamps assigned_instance — see routes.py), the code defaulted
    to _inst_provider="evolution" and only ever asked the Evolution API whether
    anything was connected. Evolution isn't a live provider in this project
    anymore, so that check always came back empty and Andy's reply was silently
    dropped — confirmed live in production ("Come Bien", "Fenix El Super de
    Casa"): the LLM generated a real reply, but "no hay ninguna instancia
    conectada" ate it. Now wwebjs (the only provider actually in use) is
    checked first, before ever asking Evolution."""

    def test_uses_a_connected_wwebjs_session_without_asking_evolution(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        fake_ww_client = MagicMock()
        fake_ww_client.send.return_value = {"success": True, "messageId": "abc123"}
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender666"]), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=fake_ww_client), \
             patch("app.whatsapp_wwebjs.mark_read"), \
             patch("app.whatsapp_evolution.pick_connected_instance") as mock_evo_pick:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        mock_evo_pick.assert_not_called()
        fake_ww_client.send.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc.get("end_reason") != "no_instance"

    def test_falls_back_to_evolution_when_wwebjs_has_nothing_connected(self, _common_patches):
        """Sanity check the fix is scoped correctly — Evolution is still consulted
        (not abandoned entirely) when wwebjs genuinely has no session up."""
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=[]), \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value=None) as mock_evo_pick:
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        mock_evo_pick.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "no_instance"


class TestPersonaNameCorrectedToActualSendingInstance:
    """Bug fixed 2026-09-15: session.context.persona_name is frozen in at
    session-creation time (via _build_context — see
    TestPersonaNameFromWhatsappProfile below), but the instance that actually
    ends up SENDING a given reply can be resolved later and differently — e.g.
    when assigned_instance was unset at creation time and the wwebjs fallback
    later picks whichever session happens to be connected. Confirmed live in
    production ("SEAT Furia"): the frozen context said persona_name="Andrés"
    (the generic default), but the reply ended up sending through "sender4",
    whose real WhatsApp profile name is "Marco Adrian" — Andy would have
    introduced himself with a name that doesn't match the account the
    prospect was actually talking to."""

    def test_overrides_stale_persona_name_with_the_resolved_instance_profile(self, _common_patches):
        mgr = FakeMgr(_session_doc(context={"persona_name": "Andrés", "company_name": "Acme"}))
        mgr.db.instances = MagicMock()
        mgr.db.instances.find_one.return_value = {"profile_name": "Marco Adrian"}
        captured = {}

        def _fake_llm(turns, context, **kwargs):
            captured["persona_name"] = context.get("persona_name")
            return "ah ok, gracias"

        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", side_effect=_fake_llm), \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender4"]):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert captured["persona_name"] == "Marco"

    def test_keeps_context_persona_name_when_instance_has_no_synced_profile(self, _common_patches):
        """Sanity check: if the resolved instance has no profile_name synced yet,
        don't blank out whatever persona_name was already in context."""
        mgr = FakeMgr(_session_doc(context={"persona_name": "Andrés", "company_name": "Acme"}))
        mgr.db.instances = MagicMock()
        mgr.db.instances.find_one.return_value = {}  # no profile_name synced
        captured = {}

        def _fake_llm(turns, context, **kwargs):
            captured["persona_name"] = context.get("persona_name")
            return "ah ok, gracias"

        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", side_effect=_fake_llm), \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender4"]):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert captured["persona_name"] == "Andrés"


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


class TestColdStartReflectsRealHistory:
    """Bug fixed 2026-09-15: a manual AI-toggle reactivation always creates a
    brand-new ai_followup_sessions doc (turn_count=0), which used to make
    is_cold_start=True even deep into an already multi-message WhatsApp thread.
    That mattered because the cold-start prompt addendum tells the LLM to
    bare-[FIN] anything resembling an automated ACK — and a real person's
    opener ("te atiende Fulano de la empresa, en que puedo ayudarte") reads
    structurally just like one. Confirmed live in production: "Come Bien"
    reactivated after a real human ("Ale") took over from the company's bot,
    and Andy closed with a bare [FIN] instead of answering.

    Fix: is_cold_start now counts real inbound message_logs docs for the
    company instead of trusting the fresh session's own turn_count."""

    def test_manual_reactivation_mid_conversation_is_not_cold_start(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        mgr.db.message_logs.count_documents.return_value = 3  # 3 real replies already in this thread
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias") as mock_llm, \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value=None):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Hola, buenas tardes\nTe atiende Ale de come bien, en que te puedo ayudar?",
                inbound_log_id="log1",
                manual_activation=True,
            )
        assert mock_llm.call_args.kwargs["is_cold_start"] is False

    def test_first_ever_reply_is_still_cold_start(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        mgr.db.message_logs.count_documents.return_value = 1  # only this reply exists
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias") as mock_llm, \
             patch("app.whatsapp_evolution.pick_connected_instance", return_value=None):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Buenas tardes",
                inbound_log_id="log1",
            )
        assert mock_llm.call_args.kwargs["is_cold_start"] is True


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
