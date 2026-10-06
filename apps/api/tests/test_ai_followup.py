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
             patch("app.providers.legacy.evolution.pick_connected_instance") as mock_pick, \
             patch("app.providers.legacy.evolution.EvolutionClient") as mock_client:
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
             patch("app.providers.legacy.evolution.pick_connected_instance") as mock_evo_pick:
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
             patch("app.providers.legacy.evolution.pick_connected_instance") as mock_evo_pick:
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


class TestPartialCopyOfPromptExampleIsDetected:
    """Real production case ("Ferra", 2026-09-07): the model didn't copy the
    CUANDO TE CONFRONTAN example whole — it wrote its own opening ("jaja no,
    tengo una pregunta sobre materiales.") but reused the example's exact
    tail ("qué tiene de raro?") verbatim. A plain full-phrase substring check
    misses this since the middle words differ from the example. Business had
    said something completely benign (offered to pass the contact to a sales
    agent) — nothing that should have triggered a "confronted" response at
    all, on top of the verbatim leak."""

    def test_fresh_opening_with_copied_tail_is_flagged(self):
        assert af._looks_copied_from_prompt(
            "jaja no, tengo una pregunta sobre materiales. qué tiene de raro?"
        ) is True

    def test_independently_written_short_reply_is_not_flagged(self):
        assert af._looks_copied_from_prompt(
            "ah perfecto, entonces me pasas el numero del area de servicio?"
        ) is False


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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value=None):
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
             patch("app.providers.legacy.evolution.pick_connected_instance") as mock_evo_pick:
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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value=None) as mock_evo_pick:
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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value="sender666"), \
             patch("app.providers.legacy.evolution.EvolutionClient", side_effect=RuntimeError("network blip")):
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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value="sender666"), \
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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value=None):
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
             patch("app.providers.legacy.evolution.pick_connected_instance", return_value=None):
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


# ── Reply hygiene, goodbyes, name, own number, stale replies (2026-10-04) ─────
#
# Real cases reviewed 2026-10-04 (all from 2026-10-02): PASA Tijuana got a bare
# "[2]"; Fame Querétaro got two replies at once, a booked test drive, "chido"
# twice and two more replies after Andy had already said goodbye; Renault Grupo
# Geisha asked to confirm Andy's own number and Andy said it didn't have it;
# Infiniti / Nissan asked for a name and Andy stayed silent.

from datetime import timedelta

from bson import ObjectId


class FakeMgrWithSend(FakeMgr):
    """FakeMgr plus what the post-send bookkeeping touches."""

    def __init__(self, session_doc):
        super().__init__(session_doc)
        self.db.instances = MagicMock()
        self.db.instances.find_one.return_value = {"profile_name": "Richie", "number": "5215527479218"}
        self.logged = []

    def insert_message_log(self, doc):
        self.logged.append(doc)
        return "ailog1"


def _ww_client():
    c = MagicMock()
    c.send.return_value = {"success": True, "messageId": "m1"}
    return c


def _run(mgr, llm, inbound="Mande", log_id="log1", ww=None):
    with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
         patch("app.ai_followup._call_llm_for_reply", **llm) as mock_llm, \
         patch("app.whatsapp_wwebjs.WWebjsClient", return_value=ww or _ww_client()):
        af.process_inbound_reply(phone_number="5214428079840", company_id="aabbccddeeff001122334455",
                                 inbound_body=inbound, inbound_log_id=log_id)
    return mock_llm


class TestReplyMarkersNeverSent:
    def test_bare_number_marker_closes_without_sending(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "[2]"}, inbound="Asi es\nNo hay de que, lindo dia", ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"

    def test_markers_inside_text_are_stripped(self):
        assert af._clean_reply("[1] va gracias [2] igual", "x") == ("va gracias igual", False)

    def test_bare_marker_answering_a_menu_becomes_the_option(self):
        assert af._clean_reply("[2]", "Elige una opción:\n1. Ventas\n2. Servicio") == ("2", False)

    def test_internal_tags_and_fin(self):
        assert af._clean_reply("[Sin respuesta]") == ("", False)
        assert af._clean_reply("ok gracias[FIN]") == ("ok gracias", True)
        assert af._clean_reply("👍") == ("👍", False)


class TestCourtesyAndFarewellDetection:
    @pytest.mark.parametrize("text", [
        "Muchas gracias, igual cualquier cosa, quedo a la orden", "Perfecto", "Excelente día",
        "Asi es\nNo hay de que, lindo dia", "gracias", "👍",
    ])
    def test_courtesy_only(self, text):
        assert af._is_courtesy_only(text) is True

    @pytest.mark.parametrize("text", [
        "Buenas tardes", "Hola", "No", "¿A las 10:00 am le quedaría bien?", "Licencia de manejo vigente",
        "Claro\nEl número de serie es importante, porque con el puedo saber si su unidad cuenta con recall",
    ])
    def test_not_courtesy(self, text):
        assert af._is_courtesy_only(text) is False

    def test_farewell_needs_an_actual_goodbye(self):
        assert af._is_farewell("Asi es\nNo hay de que, lindo dia") is True
        assert af._is_farewell("Excelente día") is True
        assert af._is_farewell("Perfecto") is False
        assert af._is_farewell("Buen día") is False


class TestFarewellClosesTheSession:
    def test_answering_their_goodbye_ends_the_session(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "igual que te vaya bien"}, inbound="No hay de que, lindo dia", ww=ww)
        ww.send.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "ai_decision"

    def test_normal_message_keeps_waiting(self, _common_patches):
        mgr = FakeMgrWithSend(_session_doc())
        _run(mgr, {"return_value": "ah va y abren el sabado?"}, inbound="Tenemos servicio de hojalateria")
        assert mgr.db.ai_followup_sessions._doc["status"] == "waiting"


class FakeClosedSessions:
    """No open session; the last one was closed by Andy after talking."""

    def __init__(self, last):
        self.last = last

    def find_one(self, query=None, *a, **kw):
        status = (query or {}).get("status")
        if isinstance(status, dict):          # open-session lookup
            return None
        return dict(self.last) if status == "ended" else None


class TestCourtesyAfterCloseDoesNotReactivate:
    def _mgr(self, **last):
        doc = {"_id": "old", "status": "ended", "end_reason": "ai_decision", "turn_count": 8,
               "last_activity": datetime.utcnow()}
        doc.update(last)
        mgr = FakeMgrWithSend(_session_doc())
        mgr.db.ai_followup_sessions = FakeClosedSessions(doc)
        return mgr

    def test_thanks_after_goodbye_gets_no_reply(self, _common_patches):
        mgr = self._mgr()
        mock_llm = _run(mgr, {"return_value": "va"}, inbound="Muchas gracias, igual cualquier cosa, quedo a la orden")
        mock_llm.assert_not_called()
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"] == {"ai_enabled": False, "auto_disabled": True}

    def test_closed_by_an_ack_without_talking_still_reactivates(self):
        assert af._recently_closed_after_talking(self._mgr(turn_count=0), "c1") is False

    def test_old_close_does_not_block(self):
        mgr = self._mgr(last_activity=datetime.utcnow() - timedelta(hours=60))
        assert af._recently_closed_after_talking(mgr, "c1") is False


class TestNameRequests:
    @pytest.mark.parametrize("text", [
        "Buen día. Le atiende Sandra López ¿Con quién tengo el gusto?",
        "¿Me compartes tu nombre completo, por favor?",
        "Podría compartirme su nombre completo por favor",
    ])
    def test_detected(self, text):
        assert af._asks_for_name(text) is True

    def test_sharing_someone_elses_number_is_not_a_name_request(self):
        assert af._asks_for_name("Le comparto el numero del asesor Javier Espinoza") is False

    def test_bot_asking_for_name_gets_the_account_name_not_silence(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc(context={"persona_name": "Andrés"})), _ww_client()
        with patch("app.classifier._looks_like_auto_reply", return_value=True):
            _run(mgr, {"return_value": "[FIN]"}, inbound="Le atiende Sandra López ¿Con quién tengo el gusto?", ww=ww)
        ww.send.assert_called_once()
        assert ww.send.call_args.args[1] == "Richie"      # the sending WhatsApp account's profile
        assert mgr.db.ai_followup_sessions._doc["status"] == "waiting"


class TestOwnNumberInPrompt:
    def test_real_number_reaches_the_prompt(self, _common_patches):
        mgr = FakeMgrWithSend(_session_doc())
        mock_llm = _run(mgr, {"return_value": "si es ese"}, inbound="¿Es correcto el 5527479218?")
        assert mock_llm.call_args.args[1]["own_number"] == "5527479218"

    def test_prompt_has_no_made_up_number_and_no_chido(self):
        text = af._DEFAULT_SYSTEM_PROMPT.format(
            persona_name="Richie", persona_full_name="Richie", own_number="5527479218", company_name="X",
            industry="Automotriz", city="Tijuana", initial_message="hola", company_context="", persona_seed="",
            extra_block="")
        assert "5527479218" in text and "5530123456" not in text
        assert "chido" not in text

    def test_seller_style_goodbye_counts_as_copied(self):
        assert af._looks_copied_from_prompt("de nada! aquí ando si necesitas algo más") is True


class TestRepeatedFillerRetry:
    def test_detection(self):
        assert af._repeated_filler("chido, estamos en contacto", ["chido, y qué documento necesito?"]) == "chido"
        assert af._repeated_filler("va, nos vemos", ["chido, y qué documento necesito?"]) is None
        assert af._repeated_filler("ok gracias por todo", ["ok gracias por la info"]) == "ok gracias"

    def test_retries_once_with_other_words(self, _common_patches):
        turns = [{"role": "assistant", "content": "chido y que documento necesito?"}]
        mgr, ww = FakeMgrWithSend(_session_doc(turns=turns)), _ww_client()
        mock_llm = _run(mgr, {"side_effect": ["chido, estamos en contacto", "va estamos en contacto entonces"]},
                        inbound="Licencia de manejo vigente", ww=ww)
        assert mock_llm.call_count == 2
        assert "chido" in mock_llm.call_args_list[1].kwargs["correction"]
        assert ww.send.call_args.args[1] == "va estamos en contacto entonces"


class TestStaleReplyDropped:
    def _logs(self, newer):
        ref_time = datetime.utcnow()

        def find_one(query, *a, **kw):
            if "_id" in query:
                return {"created_at": ref_time}
            return {"_id": "newer"} if newer else None
        m = MagicMock()
        m.find_one.side_effect = find_one
        m.count_documents.return_value = 1
        return m

    def test_reply_not_sent_when_business_wrote_again(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        mgr.db.message_logs = self._logs(newer=True)
        _run(mgr, {"return_value": "a que hora seria?"}, inbound="Claro, puede ser mañana",
             log_id=str(ObjectId()), ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc["status"] == "active"   # the newer reply will answer
        assert mgr.db.ai_followup_sessions._doc["ai_typing"] is False

    def test_reply_sent_when_nothing_newer(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        mgr.db.message_logs = self._logs(newer=False)
        _run(mgr, {"return_value": "a que hora seria?"}, inbound="Claro, puede ser mañana",
             log_id=str(ObjectId()), ww=ww)
        ww.send.assert_called_once()


class TestBookingGuard:
    """Nissan La Capilla, 2026-10-04: the AI took a real service slot (12/10,
    09:00, reserva 58132800) and gave an invented plate and email. Replaying
    the chat with the prompt rule in place it still committed in 2 of 4 runs,
    so the reply itself is checked before it goes out."""

    _SLOTS = ("Richie, para el 11/10/2026 en Nissan La Capilla ya no hay espacio. Sí encontré horarios "
              "cercanos: 10/10/2026 08:30, 09:00, 09:30. ¿Cuál fecha y horario te acomoda mejor?")
    _DATA = ("Te dejo apartado el 12/10/2026 a las 09:00 en Nissan La Capilla. Para generar tu reserva, "
             "¿me compartes por favor? Nombre completo, Placa del vehículo, Correo electrónico")

    @pytest.mark.parametrize("reply", [
        "ay qué mal, preferiría el 11/10 pero creo que me va mejor el 12/10 en la mañana. puedo a las 09:00, por favor?",
        "ah bueno, creo que el 10/10 en la mañana a las 09:00 estaría bien. puedes agendarlo?",
        "ah ok, mi nombre es Richie, la placa es ABC123, el año modelo es 2020 y mi correo es richie@email.com",
        "va, me queda bien el sábado en la mañana",
    ])
    def test_commitments_are_caught(self, reply):
        assert af._is_booking_step(self._SLOTS + " " + self._DATA)
        assert af._commits_to_booking(reply)

    @pytest.mark.parametrize("reply", [
        "mira, no tengo los datos a la mano. mejor lo checo y luego te aviso, gracias",
        "va, déjame ver y te confirmo",
        "ah ok, gracias por la info",
    ])
    def test_deflections_pass(self, reply):
        assert not af._commits_to_booking(reply, "¿Quieres que te agende el sábado?")

    def test_yes_to_a_booking_offer_is_a_commitment(self):
        assert af._commits_to_booking("sí, porfa", "¿Quieres que te agende para el sábado?")
        assert not af._commits_to_booking("sí, porfa", "¿Tienes alguna otra duda?")

    def test_ordinary_messages_are_not_a_booking_step(self):
        assert not af._is_booking_step("Buen día, ¿con quién tengo el gusto?")

    def _run(self, llm_replies, inbound):
        mgr = FakeMgr(_session_doc())
        mgr.db.instances = MagicMock()   # the post-send log reads the sending instance's number
        mgr.db.instances.find_one.return_value = {"number": "5214428079840"}
        mgr.insert_message_log = MagicMock(return_value="6abff06f006691a49cfa805c")
        client = MagicMock()
        client.send.return_value = {"success": True, "messageId": "abc123"}
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", side_effect=llm_replies) as llm, \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender666"]), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=client), \
             patch("app.whatsapp_wwebjs.mark_read"), \
             patch("app.classifier.classify_conversation_and_save"):  # runs when the session ends
            af.process_inbound_reply(phone_number="5214428079840", company_id="aabbccddeeff001122334455",
                                     inbound_body=inbound, inbound_log_id="log1")
        return llm, client, mgr.db.ai_followup_sessions._doc

    def test_commitment_is_retried_and_the_conversation_ends(self, _common_patches):
        llm, client, sess = self._run(
            ["ah bueno, a las 09:00 estaría bien, puedes agendarlo?", "mmm déjame checar y les confirmo[FIN]"],
            self._SLOTS)
        assert llm.call_count == 2
        assert "prohibido" in llm.call_args_list[1].kwargs["correction"]
        assert client.send.call_args.args[1] == "mmm déjame checar y les confirmo"
        assert sess["status"] == "ended"

    def test_fixed_deflection_when_the_retry_commits_too(self, _common_patches):
        llm, client, _ = self._run(
            ["ok, mi correo es richie@email.com", "la placa es ABC123"], self._DATA)
        assert client.send.call_args.args[1] == af.BOOKING_DEFLECT_REPLY

    def test_outside_a_booking_step_nothing_changes(self, _common_patches):
        llm, client, _ = self._run(["soy Richie, quería saber si abren el sábado a las 10"],
                                   "Buen día, ¿con quién tengo el gusto?")
        assert llm.call_count == 1
        assert client.send.call_args.args[1] == "soy Richie, quería saber si abren el sábado a las 10"


# ── Pláticas cortas (real ask, 2026-10-05: Nissan Autocom, Fame, Toyota BC) ──
class TestShortConversations:
    def _closed_mgr(self):
        doc = {"_id": "old", "status": "ended", "end_reason": "ai_decision", "turn_count": 8,
               "last_activity": datetime.utcnow()}
        mgr = FakeMgrWithSend(_session_doc())
        mgr.db.ai_followup_sessions = FakeClosedSessions(doc)
        return mgr

    @pytest.mark.parametrize("inbound", [
        # Nissan Autocom: recordatorio del bot después de que Andy ya se despidió.
        "¡Nos vemos, Richie! 😊 Aquí estaremos el 12/10/2026 a las 09:00. ¡Hasta pronto! 🚗",
        # Toyota BC: promoción masiva días después.
        "¡LLEGÓ EL TOYOTA FEST A TIJUANA! 🚗 Si estabas esperando la mejor oportunidad para estrenar auto, ¡es este fin de semana!",
    ])
    def test_message_without_question_after_close_gets_no_reply(self, _common_patches, inbound):
        mgr = self._closed_mgr()
        mock_llm = _run(mgr, {"return_value": "va"}, inbound=inbound)
        mock_llm.assert_not_called()
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"] == {"ai_enabled": False, "auto_disabled": True}

    def test_question_after_close_is_still_answered(self, _common_patches):
        mgr = self._closed_mgr()
        with patch("app.ai_followup._get_or_create_session", return_value=None) as goc:
            _run(mgr, {"return_value": "no es todo gracias"},
                 inbound="Richie, tu cita sigue registrada. ¿Hay algo más en lo que te pueda ayudar? 😊")
        goc.assert_called_once()
        assert mgr.db.conversation_ai_prefs.updates == []

    def test_max_turns_close_also_counts_as_closed(self):
        mgr = self._closed_mgr()
        mgr.db.ai_followup_sessions.last["end_reason"] = "max_turns"
        assert af._recently_closed_after_talking(mgr, "c1") is True

    def test_andy_goodbye_ends_the_session_without_fin(self, _common_patches):
        mgr = FakeMgrWithSend(_session_doc())
        _run(mgr, {"return_value": "gracias igualmente nos vemos pronto en la agencia"},
             inbound="¡Perfecto, Richie! Te esperamos el 12/10/2026 a las 09:00 en Nissan La Capilla.")
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "ai_decision"

    def test_goodbye_with_a_question_keeps_waiting(self):
        assert af._says_goodbye("va nos vemos y a qué hora abren?") is False
        assert af._says_goodbye("ok gracias hasta luego") is True


class _ReopenDB:
    def __init__(self, andy_already_talked):
        outer = self
        self.inserted = None

        class Sessions:
            def find_one(self, q, *a, **kw):
                if q.get("status") == "ended":
                    return {"_id": "old", "turn_count": 8} if andy_already_talked else None
                return None

            def insert_one(self, doc):
                outer.inserted = doc
                return MagicMock(inserted_id="new")

        self.ai_followup_sessions = Sessions()
        self.message_logs = MagicMock()
        self.message_logs.find_one.return_value = {"_id": "o1", "direction": "outbound", "created_at": datetime.utcnow()}
        self.message_logs.find.return_value = []
        self.conversation_ai_prefs = MagicMock()
        self.conversation_ai_prefs.find_one.return_value = {}


class TestReopenedSessionIsShort:
    def _create(self, talked):
        db = _ReopenDB(talked)
        mgr = MagicMock(db=db)
        with patch("app.ai_followup._build_context", return_value={"company_name": "Nissan"}):
            af._get_or_create_session(mgr, "5215597184834", "aabbccddeeff001122334455")
        return db.inserted

    def test_first_session_gets_the_normal_budget(self):
        assert self._create(talked=False)["max_turns"] == af.MAX_TURNS

    def test_session_after_andy_already_talked_is_short(self):
        assert self._create(talked=True)["max_turns"] == af.REOPEN_MAX_TURNS

    def test_reopened_session_is_marked_and_first_one_is_not(self):
        assert self._create(talked=True)["context"].get("reopened") is True
        assert not self._create(talked=False)["context"].get("reopened")

    def test_reopened_session_tells_the_model_not_to_retell_its_story(self):
        captured = {}

        def _fake_call_llm(messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return "todavía no, lo reviso y les aviso [FIN]"

        ctx = {"company_name": "Nissan", "industry": "Automotriz", "city": "Querétaro", "reopened": True}
        with patch("app.llm.call_llm", side_effect=_fake_call_llm), \
                patch("app.ai_followup._get_system_prompt", return_value="Eres {persona_name}."):
            af._call_llm_for_reply([{"role": "user", "content": "¿Pudiste revisar la propuesta?"}], ctx, db=MagicMock())
        assert "YA TE HABÍAS DESPEDIDO" in captured["system"]


class TestUnpromptedBotDenial:
    FOLLOWUP = "¡Hola! te escribo de nuevo para hacer seguimiento de la conversación. ¿Pudiste revisar la información que te enviamos?"

    def test_detects_unprompted_denial(self):
        # Caso real: Nissan Autocom, 2026-10-04.
        assert af._denies_being_bot("oye no soy un bot, solo estoy buscando que me ayuden con el servicio de mi carro",
                                    self.FOLLOWUP) is True

    @pytest.mark.parametrize("inbound", ["oye eres un bot?", "¿Hablo con una persona real?", "esto es spam?"])
    def test_denial_is_fine_when_they_asked(self, inbound):
        assert af._denies_being_bot("no, soy una persona real", inbound) is False

    def test_normal_reply_is_not_a_denial(self):
        assert af._denies_being_bot("todavia no lo reviso, ando viendo lo del servicio de mi carro", self.FOLLOWUP) is False

    def test_retry_replaces_the_denial(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"side_effect": ["oye no soy un bot, solo busco servicio para mi carro",
                                   "todavia no lo reviso, ando viendo lo del servicio"]},
             inbound=self.FOLLOWUP, ww=ww)
        ww.send.assert_called_once()
        assert "bot" not in ww.send.call_args.args[1]

    def test_insisting_on_the_denial_sends_nothing(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "oye no soy un bot, solo busco servicio para mi carro"}, inbound=self.FOLLOWUP, ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"


# ── Cerrar en cuanto Andy tiene lo que vino a buscar (replay real 2026-10-05) ──
class TestCloseWhenGoalReached:
    @pytest.mark.parametrize("inbound,goal", [
        ("¡Claro, Richie! Con gusto te ayudo a agendar el mantenimiento. ¿qué fecha te gustaría?", "cita"),
        ("¿Quisiera una prueba de manejo para este fin de semana?", "cita"),
        ("¿A las 10:00 am le quedaría bien?", "cita"),
        ("El servicio de 10 mil km cuesta $3,450", "precio"),
        ("Buen día, con gusto le comparto el número del área de Servicio: 664 123 4567", "contacto"),
        ("BEGIN:VCARD\nVERSION:3.0\nFN:Servicio Toyota\nEND:VCARD", "contacto"),
    ])
    def test_goal_detected(self, inbound, goal):
        assert af._goal_reached(inbound) == goal

    @pytest.mark.parametrize("inbound", [
        "¡Gracias por contactarnos en Nissan Autocom! Mi nombre es Carla 😊 ¿Me compartes tu nombre completo, por favor?",
        "1. Cotizar Mazda nuevo\n2. Cita inmediata de servicio\n3. Seminuevos",   # menú: Andy sigue navegando
        " [Opciones: Cancún | CDMX | Los Cabos]",
        "Tengo beneficios especiales para algunas unidades",
        "Podría compartirme su nombre completo por favor",
    ])
    def test_no_goal(self, inbound):
        assert af._goal_reached(inbound) is None

    def test_question_after_goal_is_retried_and_session_ends(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"side_effect": ["ah perfecto gracias, y tienen alguna promo ahorita?", "va gracias les marco al rato"]},
             inbound="Buen día, con gusto le comparto el número del área de Servicio: 664 123 4567", ww=ww)
        assert ww.send.call_args.args[1] == "va gracias les marco al rato"
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"

    def test_insisting_on_questions_falls_back_to_a_short_close(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "ah ok y cuánto cuesta el servicio?"},
             inbound="Buen día, con gusto le comparto el número del área de Servicio: 664 123 4567", ww=ww)
        assert ww.send.call_args.args[1] in af._GOAL_FALLBACK["contacto"]
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"

    def test_menu_keeps_the_conversation_going(self, _common_patches):
        mgr = FakeMgrWithSend(_session_doc())
        _run(mgr, {"return_value": "2"}, inbound="1. Cotizar Mazda nuevo\n2. Cita inmediata de servicio\n3. Seminuevos")
        assert mgr.db.ai_followup_sessions._doc["status"] == "waiting"


# ── Hallazgos del simulador del Chat IA (2026-10-06) ─────────────────────────
class TestSimulatorFindings:
    def test_greeting_only(self):
        assert af._is_greeting_only("¡Hola! 😊") and af._is_greeting_only("Hola, buenas tardes!")
        assert not af._is_greeting_only("¿Qué modelo buscas?")

    def test_real_answers_and_menus_are_not_auto_acks(self):
        assert not af._is_auto_ack("¡Hola! Gracias por tu mensaje. El costo de una limpieza es de $500 pesos.")
        assert not af._is_auto_ack("¡Hola! Sí, ofrecemos tratamientos para hombres. Quedo a la orden.")
        assert not af._is_auto_ack("Gracias por contactarnos. Para ayudarte mejor, por favor elige una de las siguientes opciones:")
        assert not af._is_auto_ack("3. Horarios de atención")
        assert af._is_auto_ack("Gracias por comunicarte con Hidrogas, en breve te atendemos.")

    def test_short_natural_phrases_are_not_copies_but_forbidden_ones_are(self):
        assert not af._looks_copied_from_prompt("ah gracias")
        assert not af._looks_copied_from_prompt("ah mira suena razonable déjame pensarlo y te aviso")
        assert af._looks_copied_from_prompt("va gracias quedo a la orden")

    def test_too_long(self):
        assert af._too_long(" ".join(["palabra"] * 30))
        assert not af._too_long("como 100 litros es pa un local chico")

    def test_goal_counts_the_whole_burst(self):
        turns = [{"role": "assistant", "content": "cuanto el gas"},
                 {"role": "user", "content": "El precio del gas LP es de $12.50 por litro."},
                 {"role": "user", "content": "¿Necesitas saber algo más?"}]
        assert af._goal_reached(af._business_since_last_reply(turns)) == "precio"

    def test_a_reply_with_a_question_does_not_close(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        mgr.db.instances = MagicMock()
        mgr.db.instances.find_one.return_value = {}
        mgr.insert_message_log = lambda doc: "log2"
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="y ustedes lo hacen?[FIN]"):
            af.process_inbound_reply(phone_number="5214428079840", company_id="aabbccddeeff001122334455",
                                     inbound_body="Hacemos servicio de mantenimiento", inbound_log_id="log1")
        final = [u["$set"] for u in mgr.db.ai_followup_sessions.updates if "status" in u.get("$set", {})][-1]
        assert final["status"] == "waiting"

    def test_greeting_only_waits_longer_before_answering(self, _common_patches, monkeypatch):
        slept = []
        monkeypatch.setattr(af.time, "sleep", lambda s: slept.append(s))
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="hola buenas"):
            af.process_inbound_reply(phone_number="5214428079840", company_id="aabbccddeeff001122334455",
                                     inbound_body="Hola, buenas tardes", inbound_log_id="log1")
        assert slept and slept[0] >= af.GREETING_WAIT_MIN


class TestSimulatorFindingsRound4:
    def test_menu_pick_must_be_one_of_the_options(self):
        menu = "Elige una opción:\n1. Ortodoncia\n2. Blanqueamiento\n3. Endodoncia"
        assert af._invalid_menu_pick("H", menu)
        assert not af._invalid_menu_pick("2", menu)
        assert not af._invalid_menu_pick("Si", "[Opciones: Si | No]")
        assert not af._invalid_menu_pick("ah va gracias", menu)

    def test_menus_and_notices_do_not_reopen_after_goodbye(self):
        assert af._is_bot_noise("¿Te gustaría saber más? Elige una de las siguientes opciones:")
        assert af._is_bot_noise("3. Volver al menú principal")
        assert not af._is_bot_noise("¿Y cuándo vienes a verlo?")

    def test_deflect_phrases_count_as_a_close(self):
        assert af._DEFLECT_RE.search(af._fold("mmm no estaba mal el precio déjame ver y te confirmo"))
        assert not af._DEFLECT_RE.search(af._fold("un aveo 2015 que necesita mantenimiento"))
