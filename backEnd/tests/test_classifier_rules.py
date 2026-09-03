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
    _has_real_text,
    _looks_like_auto_reply,
    _looks_like_bot_selfid,
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
        "Gracias por escribir a Gas Flamazul, ¿nos puede proporcionar su nombre?",
        "Por el momento nuestro equipo se encuentra fuera del horario laboral.",
        "Por el momento nos encontramos fuera de nuestro horario de atención.",
    ])
    def test_detects_template_markers(self, text):
        assert _looks_like_auto_reply(text) is True

    @pytest.mark.parametrize("text", [
        "Hola, sí tenemos disponible, ¿cuántos necesitas?",
        "gracias por todo, fue un placer trabajar contigo",  # "gracias por" sin verbo de contacto
    ])
    def test_normal_reply_is_not_flagged(self, text):
        assert _looks_like_auto_reply(text) is False


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
        assert result["category"] == "bot"
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
        assert result["category"] == "bot"
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
