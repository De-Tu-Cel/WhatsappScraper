"""Unit tests for the deterministic (non-LLM) rules in app/classifier.py.

These cover the logic that runs on EVERY message before (or instead of) an LLM
call: business-hours math, menu/auto-reply regex detection, the quick-classify
shortcuts, and LLM-response parsing/clamping. No network, no DB, no API key
needed — this is the layer where a silent bug would misclassify every single
message the same wrong way, so it's worth pinning down exactly.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.classifier import (
    _apply_deterministic_corrections,
    _apply_response_deterministic_corrections,
    _has_real_text,
    _looks_human_casual,
    _looks_like_auto_reply,
    _looks_like_bot_selfid,
    _looks_like_formal_bdc_greeting,
    _looks_like_menu,
    _parse_llm_response,
    _quick_classify,
    _quick_result,
    _quick_result_unrated,
    _resolve_probe,
    is_business_hours,
)


# ── is_business_hours ──────────────────────────────────────────────────────
# Mexico City is UTC-6 year-round per the module's own comment (no DST).
# 2024-01-08 is a Monday, 2024-01-13 is a Saturday — picked so the math is
# easy to double check by hand: MX time = UTC time - 6h.

class TestIsBusinessHours:
    def test_monday_9am_mx_is_open(self):
        # 09:00 MX = 15:00 UTC
        assert is_business_hours(datetime(2024, 1, 8, 15, 0, tzinfo=timezone.utc)) is True

    def test_monday_859am_mx_is_closed(self):
        # 08:59 MX = 14:59 UTC — one minute before opening
        assert is_business_hours(datetime(2024, 1, 8, 14, 59, tzinfo=timezone.utc)) is False

    def test_monday_559pm_mx_is_open(self):
        # 17:59 MX = 23:59 UTC — last minute of the business day
        assert is_business_hours(datetime(2024, 1, 8, 23, 59, tzinfo=timezone.utc)) is True

    def test_monday_6pm_mx_is_closed(self):
        # 18:00 MX (Mon Jan 8) = 00:00 UTC Jan 9 — closing boundary is exclusive
        assert is_business_hours(datetime(2024, 1, 9, 0, 0, tzinfo=timezone.utc)) is False

    def test_saturday_is_closed_even_during_business_hours(self):
        # 09:00 MX Saturday = 15:00 UTC
        assert is_business_hours(datetime(2024, 1, 13, 15, 0, tzinfo=timezone.utc)) is False

    def test_naive_datetime_is_treated_as_utc(self):
        # No tzinfo — must be interpreted as UTC (server clock), same as the tz-aware case.
        assert is_business_hours(datetime(2024, 1, 8, 15, 0)) is True
        assert is_business_hours(datetime(2024, 1, 8, 14, 59)) is False


# ── _looks_like_menu ────────────────────────────────────────────────────────

class TestLooksLikeMenu:
    @pytest.mark.parametrize("text", [
        "Elige una opción:\n1. Ventas\n2. Soporte",
        "1) Ventas\n2) Soporte\n3) Cobranza",
        "*A* - Ventas\n*B* - Soporte",
        "Responde con el número de la opción que te interese",
        "Escribe 1 para continuar",
        "Selecciona una opción del menú",
        # Prod cases: inline menus on a single line (Hidrogas, Rivera Gas)
        "¿Cómo podemos ayudarte? 1.- Solicitar un servicio   2.- Conocer nuestros servicios",
        "favor de indicar la ciudad:    1. Ciudad Obregón    2. Hermosillo    3. Culiacán",
        # Prod case: "selecciona un número" keyword (Laboratorio del Chopo)
        "Por favor, selecciona un número:  1. Cotizar, agendar mis estudios.  2. Solicitar estudios a domicilio.",
        # Nissan-style: "1 - Autos nuevos 2 - Seminuevos" on same line
        "Por favor selecciona la opción.  1 - Autos nuevos 2 - Seminuevos",
    ])
    def test_detects_numbered_or_lettered_menus(self, text):
        assert _looks_like_menu(text) is True

    @pytest.mark.parametrize("text", [
        "Hola, buenas tardes, ¿en qué te puedo ayudar?",
        "Tenemos 3 sucursales en la ciudad",  # a bare number shouldn't trigger it
        "Te marco en 5 minutos",
        "Sí, claro, con gusto te ayudo",
        "",
    ])
    def test_does_not_flag_normal_prose(self, text):
        assert _looks_like_menu(text) is False

    def test_single_list_like_line_is_not_enough(self):
        # _MENU_LIST_ITEM requires >= 2 matches when the explicit keyword markers
        # aren't present — one stray numbered line alone shouldn't flip it to bot.
        assert _looks_like_menu("1. Compramos maquinaria usada, escríbenos para más info") is False


# ── _looks_like_bot_selfid ──────────────────────────────────────────────────

class TestLooksLikeBotSelfid:
    @pytest.mark.parametrize("text", [
        # Classic virtual assistant labels
        "Hola, soy tu asistente virtual de Gas Express",
        "Hola, soy el asistente digital de Mazda de México.",
        # Role + virtual (HSBC Leo, Smart Fit Bell)
        "*Leo* Tu ejecutivo virtual oficial de HSBC México.",
        "¡Hola! Soy Bell, el reclutador virtual de Smart Fit.",
        "Me comunica con un asesor virtual",
        # Emoji bot marker
        "Bienvenido al asistente 🤖 de atención al cliente",
        # Session end (bilingual)
        "La sesión ha finalizado. / Session ended.",
    ])
    def test_detects_bot_selfid(self, text):
        assert _looks_like_bot_selfid(text) is True

    @pytest.mark.parametrize("text", [
        # Human with name — must NOT be flagged
        "Hola, soy Emmanuel, en qué le puedo ayudar",
        "Mi nombre es Juan, coordinador de ventas",
        # Hybrid handoff announcement — classifier excludes these on purpose
        "Reemplazaré a nuestro asistente virtual, soy Fernanda",
        "Se está comunicando con un agente de Bancomer",
    ])
    def test_does_not_flag_humans_or_handoffs(self, text):
        assert _looks_like_bot_selfid(text) is False


# ── _looks_like_auto_reply ──────────────────────────────────────────────────

class TestLooksLikeAutoReply:
    @pytest.mark.parametrize("text", [
        "Tu mensaje es importante para nosotros",
        "Hemos recibido tu consulta, en breve un asesor te contactará",
        "Folio: ABC-123",
        "Ref: 45678",
        "TKT-0023 generado correctamente",
        "Estimado cliente, gracias por contactarnos",
        "Nuestro horario de atención es Lun-Vie 9am-6pm",
        # Prod cases added in 2026-08
        "Bienvenido(a) a Laboratorio Médico del Chopo. Con 75 años de experiencia.",
        "Por el momento nuestro equipo se encuentra fuera del horario laboral.",
        "Por el momento nos encontramos fuera de nuestro horario de atención.",
    ])
    def test_detects_template_markers(self, text):
        assert _looks_like_auto_reply(text) is True

    @pytest.mark.parametrize("text", [
        "Hola, sí tenemos disponible, ¿cuántos necesitas?",
        "gracias por todo, fue un placer trabajar contigo",  # "gracias por" sin verbo de contacto
        # Caso real de producción (Ferra, 2026-09-07): un agente humano real escribió
        # esto y se clasificó "bot" por error — es cortesía humana normal, no plantilla.
        "Nosotros estamos en Tonalá, si gustas venir con gusto te atenderemos.",
        # Decisión de producto (2026-09-14): un saludo de bienvenida que TAMBIÉN pide
        # datos de calificación (nombre/negocio/ubicación) ya no se trata como ACK
        # silencioso — es un bot de calificación de leads, y Andy debe seguirle la
        # corriente (dar nombre/negocio falso) para intentar llegar a un humano real,
        # en vez de quedarse callado para siempre y perder el lead. Antes esta misma
        # frase estaba en test_detects_template_markers esperando True; caso real que
        # motivó el cambio: "Doctor Restaurant" / bot "Alondra" con las mismas 3
        # preguntas (nombre, negocio, ubicación) dejó la sesión atorada sin responder.
        "Gracias por escribir a Gas Flamazul, ¿nos puede proporcionar su nombre?",
    ])
    def test_normal_reply_is_not_flagged(self, text):
        assert _looks_like_auto_reply(text) is False

    @pytest.mark.parametrize("text", [
        "Gracias por tu mensaje, en breve te atenderemos",
        "Te responderemos pronto, gracias por tu paciencia",
    ])
    def test_still_detects_auto_reply_with_time_qualifier(self, text):
        assert _looks_like_auto_reply(text) is True


# ── _has_real_text ──────────────────────────────────────────────────────────

class TestHasRealText:
    @pytest.mark.parametrize("placeholder", [
        "[audio]", "[sticker]", "[location]", "[contact]", "[media]", "[template]",
    ])
    def test_placeholders_are_not_real_text(self, placeholder):
        assert _has_real_text(placeholder) is False

    def test_none_and_empty_are_not_real_text(self):
        assert _has_real_text(None) is False
        assert _has_real_text("") is False

    def test_whitespace_only_is_not_real_text(self):
        assert _has_real_text("   ") is False

    def test_actual_message_is_real_text(self):
        assert _has_real_text("hola, sí me interesa") is True


# ── _quick_classify ──────────────────────────────────────────────────────────

class TestQuickClassify:
    def test_menu_is_resolved_without_llm(self):
        result = _quick_classify("Elige una opción:\n1. Ventas\n2. Soporte", reaction_time_min=5.0)
        assert result is not None
        assert result["category"] == "bot"
        assert result["is_ai"] is False
        assert result["quick_classified"] is True

    def test_instant_reply_human_content_defers_to_llm(self):
        # The blanket "T1<10s = bot" rule was intentionally removed — speed alone
        # is a hint, not proof. Human-sounding casual content now defers to LLM.
        result = _quick_classify("hola que tal, en qué te puedo ayudar", reaction_time_min=5 / 60)
        assert result is None

    def test_instant_auto_reply_template_is_bot(self):
        result = _quick_classify("Tu mensaje es importante para nosotros", reaction_time_min=3 / 60)
        assert result is not None
        assert result["category"] == "bot"

    def test_10s_or_slower_defers_to_llm(self):
        # Exactly at the 10s boundary and above — no longer an automatic bot verdict,
        # must return None so the caller falls through to the LLM.
        assert _quick_classify("hola, sí tenemos disponible", reaction_time_min=10 / 60) is None
        assert _quick_classify("hola, sí tenemos disponible", reaction_time_min=5.0) is None

    def test_no_timing_data_defers_to_llm(self):
        assert _quick_classify("hola, sí tenemos disponible", reaction_time_min=None) is None

    def test_empty_text_defers(self):
        assert _quick_classify("", reaction_time_min=3.0) is None
        assert _quick_classify("   ", reaction_time_min=3.0) is None


# ── Typing-speed rule (_MAX_HUMAN_CHARS_PER_SEC inside _quick_classify) ─────
# A message >=80 chars that arrived implausibly fast for its length gets
# flagged "bot" even with no menu/template/self-id signal — but only when the
# timing itself is trustworthy.
class TestTypingSpeedRule:
    def test_exactly_at_8_chars_per_sec_does_not_flag(self):
        # 80 chars in exactly 10s = 8.0 char/s — the boundary itself must NOT
        # trigger (strict >, not >=): the threshold is deliberately loose so a
        # fast human isn't caught, only content clearly faster than the limit.
        text = "x" * 80
        assert _quick_classify(text, reaction_time_min=10 / 60) is None

    def test_just_over_the_boundary_flags_bot(self):
        text = "x" * 81  # 81 chars / 10s = 8.1 char/s
        result = _quick_classify(text, reaction_time_min=10 / 60)
        assert result is not None
        assert result["category"] == "bot"

    def test_under_80_chars_never_flags_regardless_of_speed(self):
        text = "x" * 79
        assert _quick_classify(text, reaction_time_min=1 / 60) is None

    def test_negative_reaction_time_does_not_flag(self):
        # Real bug found 2026-09-18: `max(reaction_time_min * 60, 0.1)` turned a
        # NEGATIVE reaction time (broken/unreliable timing data — clock skew, or
        # an outbound/inbound pairing race) into the FASTEST possible bucket
        # (0.1s), which made this rule fire on ANY long message regardless of
        # content. classify_and_save() already filters negative deltas to None
        # before calling in, but _quick_classify() must not silently misread a
        # negative value as "impossibly fast" if some other caller ever passes
        # one through directly.
        text = "x" * 200
        assert _quick_classify(text, reaction_time_min=-1) is None

    def test_zero_reaction_time_still_flags(self):
        # A genuinely instant (0s) reply to an 80+ char message is still real
        # signal, unlike a negative value — must not be swept up by the same fix.
        text = "x" * 80
        result = _quick_classify(text, reaction_time_min=0)
        assert result is not None
        assert result["category"] == "bot"


# ── _quick_result / _quick_result_unrated shape ─────────────────────────────

class TestQuickResultShapes:
    def test_quick_result_forces_low_quality_scores(self):
        r = _quick_result("bot", "test")
        for key in ("svc_prof", "svc_comp", "svc_empa", "svc_solu", "svc_next", "svc_proact"):
            assert r[key] == 1
        assert r["response_quality"] == 1
        assert r["quick_classified"] is True

    def test_quick_result_unrated_leaves_quality_as_none(self):
        r = _quick_result_unrated("humano", "test")
        for key in ("svc_prof", "svc_comp", "svc_empa", "svc_solu", "svc_next", "svc_proact"):
            assert r[key] is None
        assert r["response_quality"] is None


# ── _parse_llm_response ──────────────────────────────────────────────────────

class TestParseLlmResponse:
    def _raw(self, **overrides):
        base = {
            "category": "humano", "is_ai": False, "ai_confidence": 0.0,
            "svc_prof": 3, "svc_comp": 3, "svc_empa": 3,
            "svc_solu": 3, "svc_next": 3, "svc_proact": 3,
            "response_quality": 3, "bot_quality": None, "notes": "ok",
        }
        base.update(overrides)
        import json
        return json.dumps(base)

    def test_parses_valid_json(self):
        result = _parse_llm_response(self._raw())
        assert result["category"] == "humano"
        assert result["svc_prof"] == 3

    def test_strips_markdown_code_fence(self):
        raw = "```json\n" + self._raw() + "\n```"
        result = _parse_llm_response(raw)
        assert result["category"] == "humano"

    @pytest.mark.parametrize("hallucinated,expected", [
        ("automatico", "bot"),
        ("menu", "bot"),
        ("no_es_una_categoria_real", "humano"),
    ])
    def test_normalizes_invalid_or_legacy_categories(self, hallucinated, expected):
        result = _parse_llm_response(self._raw(category=hallucinated))
        assert result["category"] == expected

    def test_is_ai_forced_false_outside_bot_category(self):
        # Even if the model hallucinates is_ai=true on a "humano" verdict, it must
        # be ignored — is_ai only makes sense for category="bot".
        result = _parse_llm_response(self._raw(category="humano", is_ai=True))
        assert result["is_ai"] is False
        assert result["ai_confidence"] == 0.0

    def test_is_ai_true_is_kept_for_bot_category(self):
        result = _parse_llm_response(self._raw(category="bot", is_ai=True, ai_confidence=0.9))
        assert result["is_ai"] is True
        assert result["ai_confidence"] == 0.9

    @pytest.mark.parametrize("raw_value,expected", [
        (5, 5), (1, 1), (3.4, 3), (3.6, 4),   # rounds to nearest int
        (10, 5), (0, 1), (-3, 1),             # out-of-range clamps to [1,5]
    ])
    def test_svc_scores_are_clamped_to_1_5(self, raw_value, expected):
        result = _parse_llm_response(self._raw(svc_prof=raw_value))
        assert result["svc_prof"] == expected

    def test_svc_score_missing_or_non_numeric_becomes_none(self):
        result = _parse_llm_response(self._raw(svc_prof=None))
        assert result["svc_prof"] is None
        result = _parse_llm_response(self._raw(svc_comp="not-a-number"))
        assert result["svc_comp"] is None

    def test_lead_signal_forced_to_1_for_bot_category(self):
        # The prompt explicitly says "Automáticos/bots = 1 siempre" for the
        # commercial signal (PASO 3), but the LLM doesn't always comply — real
        # case: "Estrena tu próximo SEAT en SEAT FURIA" came back category=bot
        # with lead_signal=3. Enforced here the same way is_ai already is.
        result = _parse_llm_response(self._raw(category="bot", lead_signal=4))
        assert result["lead_signal"] == 1

    def test_lead_signal_kept_as_is_outside_bot_category(self):
        result = _parse_llm_response(self._raw(category="humano", lead_signal=4))
        assert result["lead_signal"] == 4
        result = _parse_llm_response(self._raw(category="hibrido", lead_signal=4))
        assert result["lead_signal"] == 4

    def test_lead_signal_none_stays_none_for_bot_category(self):
        result = _parse_llm_response(self._raw(category="bot", lead_signal=None))
        assert result["lead_signal"] is None


# ── _resolve_probe (T1→T2 probe resolution) ─────────────────────────────────
# Regression tests for a real production bug: when a prospect sends a second
# fast reply BEFORE Andy's automatic follow-up (ai_followup.py) has actually
# been generated and logged (LLM latency), the old code still matched Andy's
# eventual reply as "msg2" with no upper time bound, producing a NEGATIVE
# t2_seconds — which then passed the old `t2_seconds <= t2_threshold` check
# (any negative number is <= a positive threshold) and got mislabeled
# "🧠 Bot AI" with a note like "T2=-14s". A fake db is enough here — no real
# Mongo, no LLM call, since these cases never reach _confirm_is_ai.

class _FakeCollection:
    def __init__(self, doc):
        self._doc = doc

    def find_one(self, *args, **kwargs):
        return self._doc


class _FakeDb:
    def __init__(self, msg2_doc):
        self.message_logs = _FakeCollection(msg2_doc)


class FakeMongoDBManager:
    """Minimal stand-in for MongoDBManager — only implements what
    _resolve_probe actually touches: get_classifier_settings() and
    db.message_logs.find_one()."""
    def __init__(self, msg2_doc=None, settings=None):
        self.db = _FakeDb(msg2_doc)
        self._settings = settings or {
            "t1_threshold_seconds": 10,
            "t2_threshold_seconds": 5,
            "probe_wait_hours": 1,
            "no_reply_wait_minutes": 60,
        }

    def get_classifier_settings(self):
        return self._settings


T1_TIME = datetime(2024, 1, 8, 15, 0, 0, tzinfo=timezone.utc)  # probe started here


def _probe_doc(company_id="co1"):
    return {
        "company_id": company_id,
        "probe": {"stage": "awaiting_t2", "started_at": T1_TIME, "t1_reaction_min": 0.1},
    }


class TestResolveProbeT2Guard:
    def test_andy_not_sent_yet_falls_back_to_automatico_without_crashing(self):
        # No qualifying outbound AI message exists at all — msg2 stays None.
        # Reply body is deliberately long/neutral (>20 chars, no casual greeting)
        # so it doesn't trip the separate _looks_human_casual heuristic added later
        # — this test is about the T2-guard fallback mechanics, not text content.
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(seconds=8)
        result = _resolve_probe(db, _probe_doc(), "Aún no me han contactado por este tema", received_at)
        assert result["category"] == "automatico"
        assert "aún no enviado" in result["notes"]

    def test_andy_reply_logged_after_this_message_does_not_count_as_fast_bot(self):
        # The race that produced "T2=-14s" in production: Andy's reply ends up
        # timestamped AFTER received_at. The real Mongo query is now bounded by
        # `created_at < received_at` so this document would never be returned in
        # production — but this fake collection ignores the filter and hands the
        # doc back regardless, which lets us pin down the numeric `0 <= t2_seconds`
        # guard as its own independent safety net: even if a stale/out-of-window
        # doc ever slipped through, a negative delta must never read as "fast".
        # Reply body is deliberately long/neutral (>20 chars, no casual greeting)
        # so it doesn't trip the separate _looks_human_casual heuristic added later
        # — this test is about the negative-delta T2 guard, not text content.
        andy_sent_at = T1_TIME + timedelta(seconds=20)   # Andy replies "late"
        received_at = T1_TIME + timedelta(seconds=6)     # but this 2nd inbound came first
        db = FakeMongoDBManager(msg2_doc={"created_at": andy_sent_at})
        result = _resolve_probe(db, _probe_doc(), "No he recibido ninguna llamada de ustedes", received_at)
        assert result["category"] == "automatico"
        assert result["category"] != "humano"

    def test_genuine_fast_t2_within_window_is_still_detected(self):
        # Sanity check the fix didn't break the real positive-path case: Andy
        # replies between started_at and received_at, well within the threshold.
        # Reply body is a menu so this stays on the deterministic branch (no LLM
        # call via _confirm_is_ai) — keeps this test fast and network-free.
        andy_sent_at = T1_TIME + timedelta(seconds=3)
        received_at = T1_TIME + timedelta(seconds=4)     # 1s after Andy — fast
        db = FakeMongoDBManager(msg2_doc={"created_at": andy_sent_at})
        result = _resolve_probe(db, _probe_doc(), "1. Ventas\n2. Soporte", received_at)
        assert result["category"] == "bot"
        assert result["is_ai"] is False


# ── _resolve_probe: content-based branching when T2 is NOT fast (timed out,
#    not-yet-sent, or slow) — TestResolveProbeT2Guard above only covers the
#    FAST-T2 guard mechanics; these test the "else" branch's own content
#    fingerprinting (vCard/hybrid-offer/bot-template/casual/name-intro/
#    fallback), previously exercised only indirectly via production data. ──

class TestResolveProbeContentBranching:
    def _probe_doc_with_body(self, body: str):
        return {**_probe_doc(), "message_body": body}

    def test_vcard_share_is_humano_regardless_of_timing(self):
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("hola"),
            "BEGIN:VCARD\nVERSION:3.0\nFN:Juan Perez\nEND:VCARD",
            received_at, timed_out=True,
        )
        assert result["category"] == "humano"
        assert "contacto o archivo" in result["notes"]

    def test_hybrid_offer_in_original_text_is_hibrido_bot(self):
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("Responde SÍ y te conectamos con un asesor humano"),
            None, received_at, timed_out=True,
        )
        assert result["category"] == "hibrido_bot"

    def test_menu_in_original_text_is_bot(self):
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("1. Ventas\n2. Soporte"),
            None, received_at, timed_out=True,
        )
        assert result["category"] == "bot"

    def test_auto_reply_in_second_message_outweighs_casual_first_message(self):
        # First message looked human-casual, but the SECOND (more recent) reply
        # is an unambiguous auto-reply template — the template must win (see the
        # 2026-09-17 real-case comment in the source for why this ordering matters).
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("hola que tal"),
            "Tu mensaje es importante para nosotros, en breve te contactaremos",
            received_at, timed_out=True,
        )
        assert result["category"] == "bot"

    def test_casual_human_style_with_no_bot_signal_is_humano(self):
        # _looks_human_casual only trusts SHORT text (<=20 chars, see its own
        # docstring) — a longer casual-sounding sentence falls through to the
        # honest "automatico" fallback instead, which is correct, not a bug.
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("hola que tal"),
            None, received_at, timed_out=True,
        )
        assert result["category"] == "humano"

    def test_human_name_introduction_is_humano(self):
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("Mi nombre es Fernanda, coordinadora de ventas, en que le ayudo"),
            None, received_at, timed_out=True,
        )
        assert result["category"] == "humano"
        assert "presentación personal" in result["notes"]

    def test_no_signal_either_way_falls_back_to_automatico(self):
        # Long enough to skip _looks_human_casual (>20 chars, capitalized start,
        # no greeting match) and with no menu/template/self-id/name-intro
        # anywhere — genuinely ambiguous, must land on the honest "automatico"
        # label rather than overclaiming "bot" or "humano" without a fingerprint.
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(hours=1, seconds=1)
        result = _resolve_probe(
            db, self._probe_doc_with_body("Contamos con servicio de entrega a domicilio en toda la zona metropolitana"),
            None, received_at, timed_out=True,
        )
        assert result["category"] == "automatico"

    def test_second_message_not_yet_sent_note_when_not_timed_out(self):
        # timed_out=False and t2_seconds stays None (msg2/Andy hasn't been
        # logged yet) — distinct base_notes wording from the timed_out case.
        db = FakeMongoDBManager(msg2_doc=None)
        received_at = T1_TIME + timedelta(seconds=8)
        result = _resolve_probe(
            db, self._probe_doc_with_body("hola buenas tardes"),
            None, received_at, timed_out=False,
        )
        assert result["category"] == "humano"
        assert "aún no enviado" in result["notes"]


# ── _looks_like_formal_bdc_greeting ──────────────────────────────────────────

class TestLooksLikeFormalBdcGreeting:
    @pytest.mark.parametrize("text", [
        # Real prod case: Stellantis Country (Clarissa Flores) — a genuine
        # automated welcome template, not a casual self-introduction.
        "Le saluda Clarissa Flores, su asesora digital BDC de Stellantis Country.",
        "Le saluda Juan Pérez su ejecutivo de ventas de Toyota Reforma",
        "Le saluda María, agente virtual de Nissan Culiacán",
        "Le saluda Roberto, representante de Volkswagen del Valle",
    ])
    def test_detects_formal_template_greeting(self, text):
        assert _looks_like_formal_bdc_greeting(text) is True

    @pytest.mark.parametrize("text", [
        # Casual self-intro — must NOT be flagged (this is what the fix targets:
        # the LLM was over-flagging these as bot evidence based on tone alone)
        "Hola, soy Emmanuel, en qué le puedo ayudar",
        "Mi nombre es Juan, coordinador de ventas",
        "Reemplazaré a nuestro asistente virtual, soy Fernanda",
        "1. Ventas\n2. Soporte",
    ])
    def test_does_not_flag_casual_intros(self, text):
        assert _looks_like_formal_bdc_greeting(text) is False


# ── _apply_deterministic_corrections ─────────────────────────────────────────
# Pure post-LLM safety net — no network/DB, so these build minimal
# messages/thread/result fixtures directly instead of mocking classify_conversation.

def _msg(direction: str, body: str) -> dict:
    return {"direction": direction, "message_body": body}


class TestApplyDeterministicCorrections:
    def test_hibrido_with_no_hard_signal_downgrades_to_humano(self):
        # Real regression case (Ferra, Casacravioto — both 100% confirmed human):
        # the LLM said "hibrido" based only on formal tone, but nothing in the
        # actual thread is a hard bot signal.
        messages = [
            _msg("outbound", "Hola, ¿en qué le puedo ayudar?"),
            _msg("inbound", "Hola, quería preguntar por el precio del servicio"),
        ]
        thread = "[Representante]: Hola\n[Prospecto]: Hola, quería preguntar por el precio"
        result = {"category": "hibrido", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, thread)
        assert out["category"] == "humano"
        assert out["is_ai"] is False

    def test_hibrido_with_formal_bdc_greeting_is_not_downgraded(self):
        # Real case: Stellantis Country — a genuine automated greeting template
        # arrived before the customer's real question, so this one IS a real bot
        # and must survive the safety net instead of being downgraded.
        messages = [
            _msg("outbound", "Le saluda Clarissa, su asesora digital BDC de Stellantis Country."),
            _msg("inbound", "Le saluda Clarissa, su asesora digital BDC de Stellantis Country."),
        ]
        thread = "no fast marker here"
        result = {"category": "hibrido", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, thread)
        assert out["category"] == "hibrido"

    def test_hibrido_with_fast_reply_flag_is_not_downgraded(self):
        messages = [
            _msg("outbound", "Hola"),
            _msg("inbound", "Hola, sí tenemos disponible"),
        ]
        thread = "[Representante]: Hola\n[Prospecto ⚡ 3s — posible autorespuesta automática]: Hola, sí tenemos disponible"
        result = {"category": "hibrido", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, thread)
        assert out["category"] == "hibrido"

    def test_hibrido_with_repeated_inbound_text_is_not_downgraded(self):
        messages = [
            _msg("outbound", "Hola"),
            _msg("inbound", "Sí, disponible"),
            _msg("outbound", "Perfecto"),
            _msg("inbound", "Sí, disponible"),  # exact repeat
        ]
        thread = "no fast marker here"
        result = {"category": "hibrido", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, thread)
        assert out["category"] == "hibrido"

    def test_humano_category_is_untouched(self):
        result = {"category": "humano", "is_ai": False, "notes": ""}
        out = _apply_deterministic_corrections(result, [], "")
        assert out["category"] == "humano"
        assert out["is_ai"] is False

    def test_bot_with_single_business_text_corrects_is_ai_false(self):
        # "inbound" = the business's own reply (see the thread-builder above:
        # "[Representante]" = mensajes enviados (nosotros/outbound), "[Prospecto]"
        # = respuestas recibidas (el negocio/inbound)) — this check used to filter
        # "outbound" (our own probe messages, which almost always vary), so it
        # essentially never fired in production despite existing.
        messages = [
            _msg("inbound", "Bienvenido a Gas Flamazul"),
            # no follow-up business message — silence after the welcome template
        ]
        result = {"category": "bot", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, "")
        assert out["is_ai"] is False


# ── _looks_human_casual ─────────────────────────────────────────────────────
class TestLooksHumanCasual:
    @pytest.mark.parametrize("text", ["va", "ya", "hola", "ok", "sí", "no", "Grcs a ti"])
    def test_short_casual_replies_are_human(self, text):
        assert _looks_human_casual(text) is True

    def test_capitalized_but_very_short_still_human(self):
        # "Grcs a ti" (9 chars, capitalized abbreviation of "gracias") — real
        # case, 2026-09-18: missed before because it neither starts lowercase
        # nor matches the exact "gracias" greeting pattern.
        assert _looks_human_casual("Grcs a ti") is True

    def test_menu_text_is_never_casual_even_if_short(self):
        assert _looks_human_casual("1. Sí  2. No") is False

    def test_long_formal_template_is_not_casual(self):
        assert _looks_human_casual("Gracias por tu mensaje, en breve un asesor te contactará") is False


# ── _apply_response_deterministic_corrections (classify_response's post-LLM
#    safety net) ──────────────────────────────────────────────────────────
class TestApplyResponseDeterministicCorrections:
    def test_short_casual_reply_misjudged_as_bot_is_corrected_to_humano(self):
        # Real production cases, 2026-09-18 (company 6a919d3341a1232f02f0159a):
        # "Grcs a ti", "va", "ya" all came back category=bot/is_ai=True with an
        # LLM note like "la respuesta fue automática... no hay interacción
        # humana" — pure brevity mistaken for automation, no bot fingerprint at
        # all in the text. classify_response() had no post-LLM safety net for
        # this (classify_conversation()/classify_conversation_and_save() already
        # did) until this fix.
        for text in ("va", "ya", "Grcs a ti"):
            result = {"category": "bot", "is_ai": True, "notes": "La respuesta fue automática y no abordó el tema."}
            out = _apply_response_deterministic_corrections(result, text)
            assert out["category"] == "humano", f"{text!r} should be corrected to humano"
            assert out["is_ai"] is False

    def test_genuine_menu_reply_is_not_downgraded(self):
        result = {"category": "bot", "is_ai": False, "notes": "Menú detectado"}
        out = _apply_response_deterministic_corrections(result, "1. Ventas  2. Soporte")
        assert out["category"] == "bot"

    def test_genuine_bot_selfid_is_not_downgraded(self):
        result = {"category": "bot", "is_ai": True, "notes": "Autoidentificación"}
        out = _apply_response_deterministic_corrections(result, "Hola, soy Mateo tu asistente virtual")
        assert out["category"] == "bot"

    def test_humano_category_is_untouched(self):
        result = {"category": "humano", "is_ai": False, "notes": ""}
        out = _apply_response_deterministic_corrections(result, "cualquier texto largo aquí")
        assert out["category"] == "humano"

    def test_bot_with_multiple_distinct_substantive_business_texts_keeps_is_ai(self):
        # category "bot" also runs through the hibrido/bot hard-signal safety
        # net below, so this needs a real hard signal (a menu) to survive that
        # check and isolate the is_ai correction being tested here. The second
        # business message must be long and non-templated — otherwise the
        # "all business texts are templated/too short" branch of this same
        # correction would still zero out is_ai even with 2 distinct texts
        # (real cases: Anuto, Grupo Alden, Gas Elena, Barbaro — is_ai=true on
        # one/two-word templates like "diga" or "Buenas tardes!").
        messages = [
            _msg("outbound", "Hola"),
            _msg("inbound", "1. Ventas\n2. Soporte"),
            _msg("outbound", "2"),
            _msg("inbound", "Claro, para soporte técnico necesito el número de serie de tu equipo y una breve descripción de la falla que presenta"),
        ]
        result = {"category": "bot", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, "")
        assert out["is_ai"] is True
        assert out["category"] == "bot"

    def test_bot_with_multiple_distinct_but_all_templated_business_texts_corrects_is_ai_false(self):
        # Real regression: several distinct business messages exist, but ALL of
        # them are a menu/template/too short — no evidence of genuine
        # conversational AI, even though the old "len <= 1" check alone would
        # have missed this. The menu also keeps category="bot" alive through
        # the separate hard-signal safety net below, isolating the is_ai
        # correction under test instead of confounding it with a category
        # downgrade to "humano".
        messages = [
            _msg("inbound", "1. Ventas\n2. Refacciones\n3. Servicio"),
            _msg("inbound", "Buenas tardes!"),
        ]
        result = {"category": "bot", "is_ai": True, "notes": ""}
        out = _apply_deterministic_corrections(result, messages, "")
        assert out["category"] == "bot"
        assert out["is_ai"] is False
