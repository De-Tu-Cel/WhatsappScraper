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
        self.delivery_receipts = MagicMock()
        self.message_logs = MagicMock()
        # is_cold_start now counts real inbound message_logs docs (see
        # ai_followup.py) instead of the session's own turn_count — default to
        # 1 (a genuine cold start) so existing tests keep their prior behavior
        # unless a test overrides this to exercise the "mid-conversation
        # reactivation" case specifically.
        self.message_logs.count_documents.return_value = 1
        self.jid_map = MagicMock()
        self.ai_reply_pending = MagicMock()


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
         patch("app.whatsapp_wwebjs.WWebjsClient", return_value=MagicMock(send=MagicMock(return_value={"success": True, "messageId": "qa-default"}))), \
         patch("app.whatsapp_wwebjs.mark_read"):
        yield


class TestBareFinClosesWithoutSending:
    def test_recovery_uses_phone_scoped_checks_even_when_another_chat_has_new_messages(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch('app.ai_followup.MongoDBManager', return_value=mgr), \
             patch('app.ai_reply_recovery.current_reason', return_value=None) as check, \
             patch('app.ai_followup._newer_inbound_exists', return_value=True) as company_check, \
             patch('app.ai_followup._call_llm_for_reply', return_value='[FIN]') as generate:
            af.process_inbound_reply(phone_number='5214428079840',
                company_id='aabbccddeeff001122334455', inbound_body='Mande', inbound_log_id='log1',
                recovery={'session_id': 'sess1'})
        generate.assert_called_once()
        company_check.assert_not_called()
        assert check.call_count >= 3
        assert mgr.db.ai_followup_sessions._doc['end_reason'] == 'ai_decision'

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

    @pytest.mark.parametrize('replies', [[None], ['[FIN]', None]])
    def test_billing_failure_on_initial_or_correction_call_keeps_reply_pending(self, _common_patches, replies):
        from app.service_health import ServiceUnavailable
        mgr = FakeMgr(_session_doc())
        with patch('app.ai_followup.MongoDBManager', return_value=mgr), \
             patch('app.ai_followup._call_llm_for_reply', side_effect=replies), \
             patch('app.service_health.public_status', return_value={'ai': {
                 'status': 'blocked', 'reason': 'billing', 'message': 'IA sin saldo',
             }}), \
             patch('app.whatsapp_wwebjs.WWebjsClient') as sender:
            with pytest.raises(ServiceUnavailable):
                af.process_inbound_reply(phone_number='5214428079840',
                    company_id='aabbccddeeff001122334455',
                    inbound_body='¿En qué podemos ayudarte?', inbound_log_id='log1')
        assert mgr.db.ai_followup_sessions._doc['status'] == 'active'
        assert mgr.db.ai_followup_sessions._doc['ai_typing'] is False
        assert mgr.db.ai_followup_sessions._doc['provider_blocked'] == 'IA sin saldo'
        saved = mgr.db.ai_reply_pending.update_one.call_args.args[1]['$set']
        assert saved['status'] == 'pending'
        assert saved['session_id'] == 'sess1'
        assert saved['inbound_log_id'] == 'log1'
        sender.return_value.send_message.assert_not_called()

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
        assert mgr.db.ai_followup_sessions._doc['ai_typing'] is False
        assert 'provider_blocked' in mgr.db.ai_followup_sessions._doc
        assert mgr.db.conversation_ai_prefs.updates == []

    def test_uncertain_send_stops_automatic_replies_for_review(self, _common_patches):
        mgr = FakeMgr(_session_doc())
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", return_value="ah ok, gracias"), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=MagicMock(send=MagicMock(side_effect=RuntimeError("network blip")))):
            af.process_inbound_reply(
                phone_number="5214428079840",
                company_id="aabbccddeeff001122334455",
                inbound_body="Mande",
                inbound_log_id="log1",
            )
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"
        assert mgr.db.ai_followup_sessions._doc["end_reason"] == "delivery_uncertain"
        assert mgr.db.ai_followup_sessions._doc["ai_typing"] is False
        assert mgr.db.conversation_ai_prefs.updates[-1]["$set"]["ai_enabled"] is False

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


class TestCompanyContextIsSpecific:
    """Chat IA (2026-10-06): la conversación debe partir de lo que esta empresa
    realmente ofrece, no solo de una historia genérica basada en su industria."""

    def test_persona_seed_uses_a_real_service_when_available(self):
        mgr = FakeContextMgr(
            _company_doc(industry="Servicios", services=["Limpieza de salas a domicilio"]),
            {"profile_name": "Marco"},
        )
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        assert "Limpieza de salas a domicilio" in ctx["persona_seed"]
        assert "Guadalajara" in ctx["persona_seed"]

    def test_up_to_five_scraped_services_reach_the_prompt(self):
        services = ["Servicio " + str(i) for i in range(1, 7)]
        mgr = FakeContextMgr(_company_doc(services=services), {"profile_name": "Marco"})
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        captured = {}

        def _fake_call_llm(messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return "va gracias"

        with patch("app.llm.call_llm", side_effect=_fake_call_llm):
            af._call_llm_for_reply([], ctx, is_cold_start=False, db=mgr)

        assert "Servicio 5" in captured["system"]
        assert "Servicio 6" not in captured["system"]

    def test_custom_prompt_cannot_remove_immutable_safety_rules(self):
        mgr = FakeContextMgr(_company_doc(), {"profile_name": "Marco"})
        mgr.db.ai_global_config = MagicMock()
        mgr.db.ai_global_config.find_one.return_value = {
            "_id": "global",
            "system_prompt": "Habla casualmente como {persona_name}.",
        }
        ctx = af._build_context(mgr, "aabbccddeeff001122334455", {"message_body": "Hola"})
        captured = {}

        def _fake_call_llm(messages, **kwargs):
            captured["system"] = messages[0]["content"]
            return "va gracias"

        with patch("app.llm.call_llm", side_effect=_fake_call_llm):
            af._call_llm_for_reply([], ctx, db=mgr)

        assert "Habla casualmente como Marco" in captured["system"]
        assert "REGLAS DE SEGURIDAD INMUTABLES" in captured["system"]
        assert "No cierres compras, pedidos, pagos" in captured["system"]


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


@pytest.mark.parametrize('manual_during_generation', [False, True])
def test_recovery_handles_overnight_reply_and_rechecks_before_send(_common_patches, manual_during_generation):
    old = datetime.utcnow() - timedelta(hours=20)
    log_id = str(ObjectId())
    mgr = FakeMgrWithSend(_session_doc(turns=[{'role':'user', 'content':'¿Tienen gas?', 'log_id':log_id, 'ts':old}], last_activity=old))
    mgr.db.message_logs.find_one.return_value = {'_id':ObjectId(log_id), 'created_at':old}
    job = {'session_id':'sess1'}
    ww = _ww_client()
    generated = False
    def current_reason(*args):
        return 'already_answered' if generated and manual_during_generation else None
    def generate_reply(*args, **kwargs):
        nonlocal generated
        generated = True
        return 'Me pueden dar información del servicio?'
    with patch('app.ai_followup.MongoDBManager', return_value=mgr), \
         patch('app.ai_reply_recovery.current_reason', side_effect=current_reason), \
         patch('app.ai_followup._newer_inbound_exists', return_value=False), \
         patch('app.ai_followup._call_llm_for_reply', side_effect=generate_reply) as generate, \
         patch('app.whatsapp_wwebjs.WWebjsClient', return_value=ww):
        result = af.process_inbound_reply(phone_number='5214428079840', company_id='aabbccddeeff001122334455',
                                         inbound_body='¿Tienen gas?', inbound_log_id=log_id, recovery=job)
    generate.assert_called_once()
    assert not any(update.get('$push', {}).get('turns', {}).get('role') == 'user' for update in mgr.db.ai_followup_sessions.updates)
    if manual_during_generation:
        ww.send.assert_not_called()
    else:
        ww.send.assert_called_once()
        assert result is True


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


def test_busy_line_persists_reply_for_retry_without_recording_a_failed_send(_common_patches):
    from app.whatsapp_wwebjs import LineBusy
    mgr = FakeMgrWithSend(_session_doc())
    ww = _ww_client()
    ww.send.side_effect = LineBusy('busy')
    with patch('app.ai_reply_recovery.defer_reply') as defer:
        _run(mgr, {'return_value': 'Me pueden decir el precio?'},
             inbound='Buenas tardes, en qué te ayudo?', ww=ww)
    ww.send.assert_called_once()
    defer.assert_called_once()
    assert defer.call_args.kwargs['phone_number'] == '5214428079840'
    assert defer.call_args.kwargs['retry_at'] > datetime.utcnow()
    assert mgr.logged == []


def test_ai_defers_offline_sender_before_llm_instead_of_using_other_available_lines(_common_patches):
    mgr = FakeMgrWithSend(_session_doc())
    mgr.db.companies = MagicMock()
    mgr.db.companies.find_one.return_value = {'assigned_instance': 'original'}
    mgr.db.instances.find_one.return_value = {'provider': 'wwebjs'}
    ww = _ww_client()
    with (patch('app.whatsapp_wwebjs.get_all_connected_instances', return_value=['backup', 'foreign']),
          patch('app.ai_reply_recovery.defer_reply') as defer):
        llm = _run(mgr, {'return_value': 'Precio?'}, ww=ww)
    llm.assert_not_called()
    ww.send.assert_not_called()
    defer.assert_called_once()
    assert mgr.db.ai_followup_sessions._doc['status'] == 'active'


def test_ai_without_sender_identity_does_not_choose_first_line_from_other_users(_common_patches):
    mgr = FakeMgrWithSend(_session_doc())
    ww = _ww_client()
    with (patch('app.whatsapp_wwebjs.get_all_connected_instances', return_value=['unrelated-a', 'unrelated-b']),
          patch('app.ai_reply_recovery.defer_reply') as defer):
        llm = _run(mgr, {'return_value': 'Precio?'}, ww=ww)
    llm.assert_not_called()
    ww.send.assert_not_called()
    defer.assert_called_once()


def test_ai_uses_receiving_line_for_the_exact_chat_instead_of_company_default(_common_patches):
    mgr = FakeMgrWithSend(_session_doc())
    mgr.db.companies = MagicMock()
    mgr.db.companies.find_one.return_value = {'assigned_instance': 'other-company-phone-line'}
    mgr.db.instances.find_one.return_value = {'provider': 'wwebjs', 'profile_name': 'Ana'}
    mgr.db.message_logs.find_one.return_value = {'received_on_instance': 'actual-chat'}
    ww = _ww_client()
    with patch('app.whatsapp_wwebjs.get_all_connected_instances', return_value=['actual-chat']):
        llm = _run(mgr, {'return_value': 'Me dicen el precio?'}, log_id=str(ObjectId()), ww=ww)
    ww.send.assert_called_once()
    assert mgr.logged[0]['instance_name'] == 'actual-chat'
    assert llm.call_args.args[1]['persona_name'] == 'Ana'


class TestBusinessHoursAndDeferredReplies:
    @pytest.mark.parametrize('hour,minute,expected', [
        (0, 0, False), (7, 59, False), (8, 0, True),
        (18, 59, True), (19, 0, False), (23, 59, False),
    ])
    def test_business_hours_boundaries_in_mexico(self, hour, minute, expected):
        local = datetime(2026, 10, 14, hour, minute, tzinfo=af._MEXICO_TZ)
        with patch.object(af, 'datetime') as clock:
            clock.now.return_value = local
            assert af._is_business_hours() is expected
            clock.now.assert_called_once_with(af._MEXICO_TZ)

    @pytest.mark.parametrize('hour,next_day', [(1, 14), (7, 14), (19, 15), (23, 15)])
    def test_next_opening_is_saved_as_utc(self, hour, next_day):
        local = datetime(2026, 10, 14, hour, 30, tzinfo=af._MEXICO_TZ)
        with patch.object(af, 'datetime') as clock:
            clock.now.return_value = local
            assert af._next_business_opening() == datetime(2026, 10, next_day, 14)
            assert af._business_send_deadline().startswith('2026-10-15T01:00:00')

    @pytest.mark.parametrize('hours,llm_calls', [
        ([False], 0), ([True, False], 0), ([True, True, False], 1),
    ])
    def test_nighttime_and_delays_crossing_closing_persist_without_send(self, _common_patches, hours, llm_calls):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        opening = datetime(2026, 10, 15, 14)
        with patch.object(af, '_is_business_hours', side_effect=hours), \
             patch.object(af, '_next_business_opening', return_value=opening):
            generate = _run(mgr, {'return_value': 'busco información del servicio'},
                            inbound='¿En qué zona necesitas servicio?', ww=ww)
        assert generate.call_count == llm_calls
        ww.send.assert_not_called()
        job = mgr.db.ai_reply_pending.update_one.call_args.kwargs['upsert']
        assert job is True
        saved = mgr.db.ai_reply_pending.update_one.call_args.args[1]['$set']
        assert saved['retry_at'] == opening
        assert saved['session_id'] == 'sess1'
        assert saved['inbound_body'] == '¿En qué zona necesitas servicio?'
        assert mgr.db.ai_followup_sessions._doc['ai_typing'] is False
        assert mgr.db.ai_followup_sessions._doc['status'] == 'active'

    def test_delivery_deadline_rejection_keeps_reply_pending(self, _common_patches):
        from app.whatsapp_wwebjs import SendWindowClosed
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        ww.send.side_effect = SendWindowClosed()
        _run(mgr, {'return_value': 'busco información del servicio'}, inbound='¿En qué zona necesitas servicio?', ww=ww)
        assert ww.send.call_args.kwargs['send_before']
        mgr.db.ai_reply_pending.update_one.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc['turn_count'] == 0
        assert mgr.db.ai_followup_sessions._doc['status'] == 'active'

    @pytest.mark.parametrize('flags', [{'manual_activation': True}, {'proactive': True}])
    def test_activation_and_followups_also_wait_until_opening(self, _common_patches, flags):
        mgr = FakeMgrWithSend(_session_doc())
        with patch.object(af, '_is_business_hours', return_value=False), \
             patch.object(af, 'MongoDBManager', return_value=mgr), \
             patch.object(af, '_call_llm_for_reply') as generate:
            af.process_inbound_reply(phone_number='5214428079840', company_id='aabbccddeeff001122334455',
                                     inbound_body='¿Tienen servicio?', inbound_log_id='log1', **flags)
        generate.assert_not_called()
        job = mgr.db.ai_reply_pending.update_one.call_args.args[1]['$set']
        for key, value in flags.items():
            assert job[key] == value


class TestReplyMarkersNeverSent:
    @pytest.mark.parametrize('raw,expected', [
        ('¿Me dicen el precio?', 'Me dicen el precio?'),
        ('Hola. Quiero información. ¿Entregan hoy?', 'Hola\nQuiero información\nEntregan hoy?'),
        ('Hola\n\n¿Entregan hoy?', 'Hola\n\nEntregan hoy?'),
        ('Cuesta $12.50. Revisaré https://example.com.mx/precios.',
         'Cuesta $12.50\nRevisaré https://example.com.mx/precios'),
        ('gracias. [FIN]', 'gracias'),
        ('S.A. de C.V. vende gas', 'S.A. de C.V. vende gas'),
    ])
    def test_casual_layout_preserves_linebreaks_prices_and_urls(self, raw, expected):
        assert af._clean_reply(raw)[0] == expected

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


class TestHelpOfferIsNotAnAutomaticAck:
    def test_detects_how_can_we_help(self):
        assert af._offers_help("buen dia como le podemos ayudar?") is True
        assert af._offers_help("Hola! en qué te puedo ayudar") is True
        assert af._offers_help("Disculpa estas equivocado") is False
        assert af._offers_help("quedo a la orden") is False

    def test_bare_fin_on_a_help_offer_still_sends(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"side_effect": ["[FIN]", "[FIN]"]}, inbound="buen dia como le podemos ayudar?", ww=ww)
        ww.send.assert_called_once()
        sent = ww.send.call_args.args[1]
        assert sent in af._HELP_FALLBACK_REPLIES
        assert mgr.db.ai_followup_sessions._doc.get("end_reason") != "ai_decision"


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

    @pytest.mark.parametrize("reply", [
        "confirmo",
        "perfecto ahi estare",
        "va ahi nos vemos",
        "listo nos vemos el sábado",
    ])
    def test_short_confirmation_bypasses_are_caught(self, reply):
        assert af._commits_to_booking(reply, "Tu cita sería el sábado a las 9, ¿confirmas?")

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


class TestTransactionGuard:
    """Nissan La Capilla (2026-10-04): el guard de citas existe porque el prompt solo no
    evitó una acción real. Una compra, pago, apartado o contrato necesita la misma defensa."""

    @pytest.mark.parametrize("inbound,reply", [
        ("¿Confirmas el pedido de 100 litros?", "sí porfa"),
        ("Podemos generar el pedido ahora, ¿procedemos?", "va genera el pedido"),
        ("Te envío el link de pago, ¿cuál es tu método de pago?", "te pago con tarjeta"),
        ("Para entregar necesito tu dirección", "mi direccion es Av Juarez 123"),
        ("Con $5,000 de anticipo apartamos la unidad", "va lo deposito hoy"),
        ("¿Firmamos el contrato y levantamos la orden?", "de acuerdo confirma la orden"),
    ])
    def test_detects_real_transaction_commitments(self, inbound, reply):
        assert af._is_transaction_step(inbound)
        assert af._commits_to_transaction(reply, inbound)

    @pytest.mark.parametrize("reply", [
        "cuanto cuesta más o menos?",
        "tienen disponible el modelo azul?",
        "cómo funciona el pago?",
        "va primero lo reviso y te aviso",
    ])
    def test_questions_and_deflections_are_safe(self, reply):
        inbound = "¿Confirmas la compra y realizamos el pedido?"
        assert not af._commits_to_transaction(reply, inbound)

    def _run(self, llm_replies, inbound):
        mgr = FakeMgr(_session_doc())
        mgr.db.instances = MagicMock()
        mgr.db.instances.find_one.return_value = {"number": "5214428079840"}
        mgr.insert_message_log = MagicMock(return_value="6abff06f006691a49cfa805c")
        client = MagicMock()
        client.send.return_value = {"success": True, "messageId": "abc123"}
        with patch("app.ai_followup.MongoDBManager", return_value=mgr), \
             patch("app.ai_followup._call_llm_for_reply", side_effect=llm_replies) as llm, \
             patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["sender666"]), \
             patch("app.whatsapp_wwebjs.WWebjsClient", return_value=client), \
             patch("app.whatsapp_wwebjs.mark_read"), \
             patch("app.classifier.classify_conversation_and_save"):
            af.process_inbound_reply(phone_number="5214428079840", company_id="aabbccddeeff001122334455",
                                     inbound_body=inbound, inbound_log_id="log1")
        return llm, client, mgr.db.ai_followup_sessions._doc

    def test_purchase_commitment_is_retried_and_closed(self, _common_patches):
        llm, client, sess = self._run(
            ["sí porfa genera el pedido de 100 litros", "va primero reviso bien y te aviso[FIN]"],
            "Son 100 litros por $1,250. ¿Confirmas el pedido?")
        assert llm.call_count == 2
        assert "operaciones reales" in llm.call_args_list[1].kwargs["correction"]
        assert client.send.call_args.args[1] == "va primero reviso bien y te aviso"
        assert sess["status"] == "ended"

    def test_fixed_deflection_when_retry_still_commits(self, _common_patches):
        _, client, sess = self._run(
            ["va genera el pedido", "sí te transfiero ahorita"],
            "¿Confirmas la compra y generamos el pedido?")
        assert client.send.call_args.args[1] == af.TRANSACTION_DEFLECT_REPLY
        assert sess["status"] == "ended"

    def test_asking_about_price_does_not_trigger_guard(self, _common_patches):
        llm, client, _ = self._run(
            ["cuanto saldría el pedido con envío?"],
            "Sí tenemos disponible. Puedes realizar tu compra con nosotros.")
        assert llm.call_count == 1
        assert client.send.call_args.args[1] == "cuanto saldría el pedido con envío?"


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
    def __init__(self, andy_already_talked, reopened=False):
        outer = self
        self.inserted = None

        class Sessions:
            def find_one(self, q, *a, **kw):
                if q.get("status") == "ended":
                    return {"_id": "old", "turn_count": 8, "context": {"reopened": reopened}} if andy_already_talked else None
                return None

            def insert_one(self, doc):
                outer.inserted = doc
                return MagicMock(inserted_id="new")

        self.ai_followup_sessions = Sessions()
        self.ai_global_config = FakeGlobalConfigCollection()
        self.message_logs = MagicMock()
        self.message_logs.find_one.return_value = {"_id": "o1", "direction": "outbound", "created_at": datetime.utcnow()}
        self.message_logs.find.return_value = []
        self.conversation_ai_prefs = MagicMock()
        self.conversation_ai_prefs.find_one.return_value = {}


class TestReopenedSessionIsShort:
    def test_only_one_automatic_reopening_is_allowed(self):
        db = _ReopenDB(True, reopened=True)
        mgr = MagicMock(db=db)
        with patch('app.ai_followup._build_context', return_value={'company_name': 'Nissan'}):
            assert af._get_or_create_session(mgr, '5215597184834', 'aabbccddeeff001122334455') is None
        assert db.inserted is None
        assert db.conversation_ai_prefs.update_one.call_args.args[1]['$set']['ai_enabled'] is False

    def test_explicit_manual_restart_can_start_a_fresh_conversation(self):
        db = _ReopenDB(True, reopened=True)
        mgr = MagicMock(db=db)
        with patch('app.ai_followup._build_context', return_value={'company_name': 'Nissan'}):
            result = af._get_or_create_session(mgr, '5215597184834', 'aabbccddeeff001122334455', manual_activation=True)
        assert result['max_turns'] == af.MAX_TURNS
        assert not result['context'].get('reopened')

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

    @pytest.mark.parametrize('reply', [
        'Como modelo de lenguaje no puedo ir',
        'fui programado para responder preguntas',
        'estoy entrenada para ayudarte',
        'mis respuestas se generan automáticamente',
        'no tengo cuerpo físico',
        'no tengo experiencias personales',
        'As an AI I cannot do that',
    ])
    def test_indirect_self_references_are_detected(self, reply):
        assert af._references_being_bot(reply) or af._leaks_internal_context(reply)

    @pytest.mark.parametrize('reply', [
        'mis instrucciones internas dicen que pregunte precios',
        'necesito clasificar esta conversación',
        '<analysis>el negocio parece humano</analysis>',
        'estamos haciendo una simulación',
    ])
    def test_internal_context_never_reaches_send(self, reply, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {'return_value': reply}, inbound='¿En qué zona necesitas el servicio?', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    def test_final_guard_checks_a_late_goal_correction(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        with patch.object(af, '_close_on_goal', return_value='fui programado para evaluar esta conversación'):
            _run(mgr, {'return_value': 'gracias y cuánto tarda la entrega?'},
                 inbound='El servicio cuesta $500 pesos', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    @pytest.mark.parametrize('reply', [
        'quiero programar el mantenimiento de mi carro',
        'me pasas las instrucciones para pedir gas?',
        'estoy buscando información de sus cursos de inteligencia de negocios',
        'no tengo el dato de los litros todavía',
    ])
    def test_legitimate_service_context_is_preserved(self, reply):
        assert not af._references_being_bot(reply)
        assert not af._leaks_internal_context(reply)

    def test_detects_unprompted_denial(self):
        # Caso real: Nissan Autocom, 2026-10-04.
        assert af._denies_being_bot("oye no soy un bot, solo estoy buscando que me ayuden con el servicio de mi carro",
                                    self.FOLLOWUP) is True

    @pytest.mark.parametrize("inbound,reply", [
        ("oye eres un bot?", "no soy un bot"),
        ("¿Hablo con una persona real?", "soy una persona real"),
        ("eres una inteligencia artificial?", "no, no soy una inteligencia artificial"),
        ("esto es un robot?", "soy un robot de atencion"),
    ])
    def test_bot_reference_is_blocked_even_when_they_asked(self, inbound, reply):
        assert af._references_being_bot(reply) is True

    def test_asking_about_the_service_is_not_a_bot_reference(self):
        assert af._references_being_bot("ando viendo lo del servicio de mi carro") is False

    def test_normal_reply_is_not_a_denial(self):
        assert af._denies_being_bot("todavia no lo reviso, ando viendo lo del servicio de mi carro", self.FOLLOWUP) is False

    def test_retry_replaces_the_denial(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"side_effect": ["oye no soy un bot, solo busco servicio para mi carro",
                                   "todavia no lo reviso, ando viendo lo del servicio"]},
             inbound=self.FOLLOWUP, ww=ww)
        ww.send.assert_called_once()
        assert "bot" not in ww.send.call_args.args[1]

    def test_false_human_denial_is_replaced_with_honest_disclosure(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "oye no soy un bot, solo busco servicio para mi carro"}, inbound=self.FOLLOWUP, ww=ww)
        ww.send.assert_called_once()
        assert 'Soy un asistente automatizado' in ww.send.call_args.args[1]
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"

    def test_direct_accusation_still_cannot_mention_bots(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"side_effect": ["jajaja no soy un bot", "ando buscando el servicio de mi carro"]},
             inbound="oye eres un bot?", ww=ww)
        ww.send.assert_called_once()
        assert "bot" not in ww.send.call_args.args[1].lower()


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

    def test_contact_fallback_does_not_promise_a_future_call_or_message(self):
        for reply in af._GOAL_FALLBACK["contacto"]:
            folded = af._fold(reply)
            assert not any(phrase in folded for phrase in ("les marco", "les escribo", "te llamo", "te mando"))

    def test_menu_keeps_the_conversation_going(self, _common_patches):
        mgr = FakeMgrWithSend(_session_doc())
        _run(mgr, {"return_value": "2"}, inbound="1. Cotizar Mazda nuevo\n2. Cita inmediata de servicio\n3. Seminuevos")
        assert mgr.db.ai_followup_sessions._doc["status"] == "waiting"


# ── Hallazgos del simulador del Chat IA (2026-10-06) ─────────────────────────
class TestSimulatorFindings:
    def test_changing_price_does_not_hide_a_repeated_closing(self):
        previous = ['ah ok 450 no está mal\ndéjame pensarlo y te aviso']
        assert af._repeated_wording('300 está razonable\ndéjame pensarlo y te aviso', previous)

    def test_repeated_required_information_is_not_a_closing(self):
        assert af._repeated_closing_wording('como 100 litros más o menos', ['como 100 litros más o menos']) is None
        assert af._repeated_closing_wording('Ana Pérez', ['Ana Pérez']) is None

    def test_final_guard_preserves_price_while_removing_repeated_closing(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        mgr.db.message_logs.find.return_value = [{'message_body': '450 está razonable\ndéjame pensarlo y te aviso'}]
        _run(mgr, {'return_value': '300 está razonable\ndéjame pensarlo y te aviso[FIN]'},
             inbound='El diagnóstico cuesta $300.', ww=ww)
        assert '300' in ww.send.call_args.args[1]
        assert 'pensarlo' not in ww.send.call_args.args[1]
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    @pytest.mark.parametrize('inbound', [
        'No tenemos cobertura en Puebla y no podemos ofrecerte el servicio.',
        'No hay cobertura en tu código postal.',
        'Lo sentimos, no contamos con cobertura en esa zona.',
        'Lamentablemente no llegamos a tu colonia.',
        'No atendemos en esa ciudad.',
        'Por ahora no damos servicio en tu zona.',
    ])
    def test_explicit_coverage_refusal_is_a_closing_goal(self, inbound):
        assert af._goal_reached(inbound) == 'negativa'

    @pytest.mark.parametrize('inbound', [
        'Si no hay cobertura, te avisamos antes de instalar.',
        'No tenemos cobertura en toda la ciudad, dime tu colonia para verificar.',
        'No contamos con cobertura total, necesitamos revisar tu código postal.',
        'Estamos revisando si tenemos cobertura en tu colonia.',
        'Sí tenemos cobertura. Qué paquete necesitas?',
    ])
    def test_conditional_or_partial_coverage_does_not_close_early(self, inbound):
        assert af._goal_reached(inbound) is None

    def test_coverage_refusal_closes_even_when_model_omits_fin(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {'return_value': 'ah ok gracias por avisar'},
             inbound='No tenemos cobertura en Puebla y no podemos ofrecerte el servicio.', ww=ww)
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'
        ww.send.assert_called_once()

    def test_repeated_long_closing_can_finish_silently(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        text = 'ah ok no está mal déjame pensarlo y te aviso'
        mgr.db.message_logs.find.return_value = [{'message_body': text}]
        _run(mgr, {'return_value': text}, inbound='El servicio cuesta $500 pesos.', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    def test_lexical_variety_does_not_suppress_requested_quantity(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc(context={'reopened': True})), _ww_client()
        text = 'como 100 litros más o menos'
        mgr.db.message_logs.find.return_value = [{'message_body': text}]
        _run(mgr, {'return_value': text}, inbound='Cuántos litros necesitas?', ww=ww)
        ww.send.assert_called_once()
        assert '100 litros' in ww.send.call_args.args[1]

    def test_explicit_service_refusal_closes_without_fin(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {'return_value': 'ah ok gracias por avisar'},
             inbound='No ofrecemos el servicio que necesitas.', ww=ww)
        ww.send.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'
        assert af._goal_reached('No ofrecemos el servicio que necesitas.') == 'negativa'
        assert af._goal_reached('No tenemos ese producto pero te paso el contacto: 55 1234 5678') == 'contacto'

    def test_refusing_an_order_closes_even_without_fin_marker(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {'return_value': 'todavía no confirmo nada primero quiero ver precios'},
             inbound='Confirma tu pedido de 100 litros y pásanos tu dirección para cobrar.', ww=ww)
        ww.send.assert_called_once()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    def test_trimming_an_overused_greeting_preserves_facts_and_negation(self):
        history = ['Buenas tardes ando cotizando', 'Buenas tardes ando buscando información']
        assert af._trim_repeated_opening('Buenas tardes, ando cotizando 100 litros en Bogotá', history) == 'ando cotizando 100 litros en Bogotá'
        assert af._trim_repeated_opening('No quiero confirmar el pedido de 100 litros', history) == 'No quiero confirmar el pedido de 100 litros'
        assert af._trim_repeated_opening('Ana', ['Ana', 'Ana']) == 'Ana'

    def test_repeated_greeting_is_counted_independently_of_the_following_verb(self):
        history = ['Buenas tardes, busco gas', 'buenas tardes ocupo información']
        text = 'buenas tardes, no quiero confirmar los 100 litros'
        assert af._trim_repeated_opening(text, history) == 'no quiero confirmar los 100 litros'
        assert af._trim_repeated_opening(text, history[:1]) == text
        assert af._trim_repeated_opening('Buenas noches, busco gas para mi local', history) == 'Buenas noches, busco gas para mi local'

    def test_repeated_morning_greeting_preserves_accents_names_and_newlines(self):
        history = ['Buenos días, busco gas', 'buenos dias ocupo información']
        assert af._trim_repeated_opening('Buenos días, soy Ana\nnecesito 100 litros en Bogotá', history) == 'soy Ana\nnecesito 100 litros en Bogotá'

    def test_default_tone_examples_are_removed_without_changing_forbidden_examples(self):
        prompt = af._without_tone_examples(af._DEFAULT_SYSTEM_PROMPT)
        assert 'busco quién me lleve gas, el que tenía tardaba mucho' not in prompt
        assert 'qué tiene de raro' in prompt
        assert '{persona_name}' in prompt

    def test_what_do_you_need_is_a_real_help_offer(self):
        assert af._offers_help('Buenas tardes, ¿qué necesita?')

    def test_repeated_wording_ignores_names_menu_choices_and_required_short_facts(self):
        for text in ('Ana', '2', '100 litros', 'Gas LP a domicilio'):
            assert af._repeated_wording(text, [text]) is None
        assert af._repeated_wording('ah ok no está mal déjame pensarlo y te aviso',
                                   ['Ah ok, no esta mal\ndejame pensarlo y te aviso'])

    def test_repeated_opening_requires_a_pattern_not_a_single_shared_greeting(self):
        text = 'Buenas tardes ando viendo opciones para el servicio'
        assert af._repeated_wording(text, ['Buenas tardes ando cotizando gas']) is None
        assert af._repeated_wording(text, ['Buenas tardes ando cotizando gas',
                                          'Buenas tardes ando consultando horarios']) == 'buenas tardes ando'

    def test_recent_wording_query_is_scoped_to_sending_instance_and_bounded(self):
        mgr = MagicMock()
        mgr.db.message_logs.find.return_value = [{'message_body': 'mensaje de esta cuenta'}]
        assert af._recent_ai_wording(mgr, 'mi-cuenta') == ['mensaje de esta cuenta']
        query = mgr.db.message_logs.find.call_args.args[0]
        assert query['instance_name'] == 'mi-cuenta' and query['ai_generated'] is True
        assert query['direction'] == 'outbound' and query['created_at']['$gte']
        assert mgr.db.message_logs.find.call_args.kwargs['limit'] == 24

    def test_variation_is_stable_per_conversation_without_replacing_its_facts(self):
        ctx = {'wording_seed': 'conversation-1', 'persona_name': 'Ana', 'city': 'Bogotá',
               'recent_wording': ['buenas tardes ando buscando información del servicio']}
        before = dict(ctx)
        assert af._variation_instruction(ctx, [], True) == af._variation_instruction(ctx, [], True)
        assert ctx == before
        assert 'Mantén el mismo nombre, ciudad, cantidades y necesidad' in af._variation_instruction(ctx, [], True)
        instructions = {af._variation_instruction({'wording_seed': str(i)}, [], True) for i in range(30)}
        assert len(instructions) >= 6

    def test_overlong_initial_answer_to_help_offer_keeps_a_short_contextual_question(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc(context={'industry': 'Gas LP'})), _ww_client()
        _run(mgr, {'return_value': ' '.join(['consulta'] * 26)}, inbound='Buenas tardes, ¿en qué te ayudo?', ww=ww)
        ww.send.assert_called_once()
        text = ww.send.call_args.args[1]
        assert 'Gas LP' in text and '\n' in text and '?' in text
        assert not af._too_long(text) and '¿' not in text
        assert mgr.db.ai_followup_sessions._doc['status'] == 'waiting'

    def test_common_tail_of_positive_example_does_not_block_useful_reply(self):
        assert not af._looks_copied_from_prompt(
            'hola ando buscando quien me lleve gas a domicilio el que tenía tardaba mucho')
        assert af._looks_copied_from_prompt('va gracias quedo a la orden')

    def test_final_length_guard_rejects_an_overlong_retry(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {'return_value': ' '.join(['consulta'] * 26)}, inbound='Me comentas más detalles?', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    def test_reopening_cannot_ask_another_question(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc(context={'reopened': True})), _ww_client()
        _run(mgr, {'return_value': 'todavía no y tienen descuento?'}, inbound='Ya revisaste la información?', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

    def test_three_previous_questions_stop_further_questions(self, _common_patches):
        turns = [{'role': 'assistant', 'content': text} for text in ('tienen servicio?', 'en qué zona?', 'a domicilio?')]
        mgr, ww = FakeMgrWithSend(_session_doc(turns=turns, turn_count=3)), _ww_client()
        _run(mgr, {'return_value': 'y cuál es el horario?'}, inbound='En la zona norte', ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc['status'] == 'ended'

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


def test_closing_without_a_reply_still_queues_the_four_analyses_when_they_wrote():
    # Accesorios para estufas (2026-10-08): Andy cerró sin contestar y nadie clasificó.
    mgr = FakeMgr(_session_doc())
    mgr.db.message_logs.find_one.return_value = {"_id": "log-accesorios"}
    with patch("app.classifier.queue_reply_analysis") as queued:
        af._close_session_without_reply(mgr, "sess1", "aabbccddeeff001122334455", "5214428079840", "ai_decision")
    queued.assert_called_once_with("aabbccddeeff001122334455", "log-accesorios")


def test_closing_without_a_reply_does_not_analyze_a_chat_that_never_answered():
    mgr = FakeMgr(_session_doc())
    mgr.db.message_logs.find_one.return_value = None
    with patch("app.classifier.queue_reply_analysis") as queued:
        af._close_session_without_reply(mgr, "sess1", "aabbccddeeff001122334455", "5214428079840", "ai_decision")
    queued.assert_not_called()


class TestWrongNumberIsNotOurNumber:
    """Insprogas / Supergas LP (2026-10-08): 'tu número está equivocado' no es
    una pregunta por el número de Andy, y no hay que seguir vendiendo gas."""

    @pytest.mark.parametrize("text", [
        "Tu número está equibocado",
        "Disculpa estas equivocado",
        "Este número al que estás escribiendo es particular. No es de ninguna gas",
        "Tu contacto está mal este número es particular",
    ])
    def test_detected(self, text):
        assert af._is_wrong_number(text) is True

    def test_normal_chat_is_not_wrong_number(self):
        assert af._is_wrong_number("Buenas noches le atiende Araceli. En que le puedo ayudar?") is False
        assert af._is_wrong_number("¿Es correcto el 5527479218?") is False

    def test_giving_our_number_is_replaced_and_the_chat_closes(self, _common_patches):
        mgr, ww = FakeMgrWithSend(_session_doc()), _ww_client()
        _run(mgr, {"return_value": "ah, perdón, mi número es 5527479218. Pueden ayudarme con el servicio de gas?"},
             inbound="Tu número está equivocado", ww=ww)
        ww.send.assert_called_once()
        sent = ww.send.call_args.args[1]
        assert sent in af._WRONG_NUMBER_REPLIES
        assert "5527479218" not in sent
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"

    def test_second_message_after_apology_gets_silence(self, _common_patches):
        turns = [{"role": "assistant",
                  "content": "ah ok, creo que me equivoqué de número. Gracias por avisar"}]
        mgr, ww = FakeMgrWithSend(_session_doc(turns=turns, turn_count=1)), _ww_client()
        mock_llm = _run(mgr, {"return_value": "ah perdón, creo que me confundí de contacto"},
                        inbound="Dnd", ww=ww)
        ww.send.assert_not_called()
        assert mgr.db.ai_followup_sessions._doc["status"] == "ended"


class TestNamePlusHelpIsNotNameOnly:
    """Diesgas (2026-10-08): pidieron nombre y en qué ayudar; solo salió 'Richie'."""

    def test_name_only_is_detected(self):
        assert af._is_name_only_reply("Richie", "Richie", "Richie Pérez") is True
        assert af._is_name_only_reply("richie ando buscando gas", "Richie", "Richie Pérez") is False

    def test_name_plus_help_sends_what_we_need(self, _common_patches):
        inbound = ("Gracias por comunicarte a Diesgas. Menciona tu nombre y en que puedo "
                   "ayudarte. Nos encontramos fuera de nuestro horario de atención")
        mgr, ww = FakeMgrWithSend(_session_doc(context={"persona_name": "Richie"})), _ww_client()
        _run(mgr, {"side_effect": ["Richie", "Richie"]}, inbound=inbound, ww=ww)
        ww.send.assert_called_once()
        sent = ww.send.call_args.args[1]
        assert sent != "Richie"
        assert "richie" in sent.lower()
        assert "servicio" in sent or "atender" in sent
