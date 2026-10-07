"""Comparación de clasificadores (app/classification_compare.py): el clasificador de
Timing sigue el diagrama de flujo determinista rama por rama, el de solo IA lee la
respuesta del modelo, y la coincidencia entre los tres se calcula igual que en Análisis."""
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app import classification_compare as cc

T0 = datetime(2026, 10, 1, 18, 56, 0)
SETTINGS = {"t1_threshold_seconds": 10, "t2_threshold_seconds": 5, "probe_wait_hours": 1, "no_reply_wait_minutes": 60}


class _Cursor(list):
    def limit(self, n):
        return _Cursor(self[:n])


class _Logs:
    def __init__(self, msgs):
        self.msgs = msgs

    def find(self, query=None, *a, **kw):
        rows = self.msgs
        status = (query or {}).get("status")
        if isinstance(status, dict) and "$ne" in status:
            rows = [m for m in rows if m.get("status") != status["$ne"]]
        elif isinstance(status, str):
            rows = [m for m in rows if m.get("status") == status]
        return _Cursor(rows)


class _DB:
    def __init__(self, msgs):
        self.db = type("D", (), {"message_logs": _Logs(msgs)})()


def _thread(*events):
    """("out"|"in", segundos desde el inicio, texto) → mensajes de message_logs."""
    return [{"direction": "outbound" if d == "out" else "inbound", "created_at": T0 + timedelta(seconds=s),
             "message_body": body, "ai_generated": d == "out" and s > 0} for d, s, body in events]


def _timing(*events, now=None):
    return cc.run_timing(_DB(_thread(*events)), "c1", settings=SETTINGS, now=now or T0 + timedelta(days=1))


class TestTimingFlowchart:
    def test_no_reply_within_an_hour(self):
        r = _timing(("out", 0, "Hola"))
        assert r["common"] == "humano_o_desconectado"

    def test_reply_after_an_hour(self):
        # Fame Querétaro: primera respuesta 16.6 h después.
        r = _timing(("out", 0, "Hola"), ("in", 16.6 * 3600, "Buen día"))
        assert r["common"] == "humano_o_desconectado"
        assert r["inputs"]["t1_s"] == pytest.approx(16.6 * 3600)

    def test_still_waiting_is_pending(self):
        r = _timing(("out", 0, "Hola"), now=T0 + timedelta(minutes=20))
        assert r["common"] == "pendiente"

    def test_slow_first_reply_is_human(self):
        # Nissan Autocom: T1 = 16 s > 10 s.
        r = _timing(("out", 0, "Hola"), ("in", 16, "¡Gracias por contactarnos! Mi nombre es Carla"))
        assert r["common"] == "humano"
        assert any("según el diagrama" in s["detalle"] for s in r["trace"])

    def test_fast_reply_without_second_message_is_pending(self):
        r = _timing(("out", 0, "Hola"), ("in", 3, "Gracias por escribir, en breve te atendemos"))
        assert r["common"] == "pendiente"

    def test_second_message_never_answered(self):
        r = _timing(("out", 0, "Hola"), ("in", 3, "Gracias por escribir"), ("out", 60, "busco servicio"))
        assert r["common"] == "automatico_sin_respuesta"

    def test_slow_second_reply(self):
        r = _timing(("out", 0, "Hola"), ("in", 3, "Gracias por escribir"), ("out", 60, "busco servicio"),
                    ("in", 60 + 240, "Claro, ¿qué modelo es?"))
        assert r["common"] == "automatico_humano"
        assert r["inputs"]["t2_s"] == 240

    def test_fast_second_reply_with_menu_is_bot(self):
        r = _timing(("out", 0, "Hola"), ("in", 2, "Bienvenido"), ("out", 30, "servicio"),
                    ("in", 33, "Elige una opción:\n1. Ventas\n2. Servicio\n3. Refacciones"))
        assert r["common"] == "bot"

    def test_fast_conversational_second_reply_is_ai_agent(self):
        r = _timing(("out", 0, "Hola"), ("in", 2, "Bienvenido"), ("out", 30, "servicio"),
                    ("in", 34, "¡Claro! Con gusto te ayudo a agendar el mantenimiento de tu Versa"))
        assert r["common"] == "agente_ia"

    def test_trace_ends_with_the_result(self):
        r = _timing(("out", 0, "Hola"), ("in", 16, "Buen día"))
        assert r["trace"][0]["paso"] == "Enviar primer mensaje"
        assert r["trace"][-1] == {"paso": "Resultado", "detalle": "Humano"}


class TestAgreement:
    def test_human_or_offline_matches_human_and_no_reply(self):
        assert cc._same("humano_o_desconectado", "humano") is True
        assert cc._same("humano_o_desconectado", "sin_respuesta") is True
        assert cc._same("humano_o_desconectado", "bot") is False

    def test_pending_has_no_verdict(self):
        assert cc.agreement("pendiente", "humano", "humano")["todos"] is None

    def test_all_three(self):
        assert cc.agreement("humano", "humano", "humano")["todos"] is True
        a = cc.agreement("humano", "humano", "agente_ia")
        assert a == {"timing_ia": True, "timing_hibrido": False, "ia_hibrido": False, "todos": False}

    @pytest.mark.parametrize("category,is_ai,common", [
        ("bot", True, "agente_ia"), ("bot", False, "bot"), ("hibrido_bot", False, "automatico_humano"),
        ("automatico", False, "automatico_humano"), ("automatico_sin_respuesta", False, "automatico_sin_respuesta"),
        ("humano", False, "humano"),
        ("hibrido_automatico", False, "automatico_humano"),
        ("sin_respuesta", False, "sin_respuesta"),
    ])
    def test_production_categories_map_to_common(self, category, is_ai, common):
        assert cc.to_common(category, is_ai) == common


class TestAiOnly:
    def _run(self, llm_reply, msgs=None):
        msgs = msgs or _thread(("out", 0, "Hola"), ("in", 16, "Mi nombre es Carla, ¿me compartes tu nombre?"))
        with patch("app.llm.call_llm", return_value=llm_reply) as call:
            r = cc.run_ai_only(_DB(msgs), "c1", model="gpt-4.1")
        return r, call

    def test_reads_category_reasoning_and_evidence(self):
        r, call = self._run('```json\n{"categoria": "agente_ia", "pasos": ["Responde en frases naturales", "Cambia de nombre"],'
                            ' "evidencia": ["Mi nombre es Carla"], "confianza": 0.8}\n```')
        assert r["common"] == "agente_ia" and r["confidence"] == 0.8
        assert [s["paso"] for s in r["trace"]][-3:] == ["Razonamiento 2", "Evidencia que cita", "Resultado"]
        assert call.call_args.kwargs["model"] == "gpt-4.1"

    def test_prompt_has_no_timing(self):
        _, call = self._run('{"categoria": "humano", "pasos": [], "evidencia": []}')
        prompt = call.call_args.args[0][0]["content"]
        assert "16" not in prompt.split("Conversación")[1].split("Responde SOLO")[0]
        assert "[Negocio]: Mi nombre es Carla" in prompt

    def test_invalid_answer_is_an_error_not_a_guess(self):
        r, _ = self._run("no sé")
        assert r["common"] is None and r["error"]

    def test_no_business_reply_skips_the_model(self):
        with patch("app.llm.call_llm") as call:
            r = cc.run_ai_only(_DB(_thread(("out", 0, "Hola"))), "c1")
        call.assert_not_called()
        assert r["common"] == "sin_respuesta"

    def test_truncated_answer_still_gives_the_category(self):
        # Caso real: el mensaje del negocio era un archivo codificado larguísimo y la
        # respuesta del modelo se cortó a la mitad del JSON.
        r, _ = self._run('{"categoria": "sin_respuesta", "pasos": ["El mensaje consiste en una cadena larga')
        assert r["common"] == "sin_respuesta"

    def test_binary_blob_is_described_not_pasted(self):
        blob = "/9j/" + "A" * 3000
        _, call = self._run('{"categoria": "humano"}', msgs=_thread(("out", 0, "Hola"), ("in", 20, blob)))
        prompt = call.call_args.args[0][0]["content"]
        assert blob not in prompt and "sin texto legible" in prompt


class TestRetriesAndNumbers:
    def test_reply_to_a_retry_follows_the_flowchart_and_is_noted(self):
        # Laboratorio del Chopo: al "Hola" no contestaron; al reintento del día siguiente
        # contestaron en 6 s. Desde 2026-10-06 el diagrama mide ese reintento. "Bienvenido a
        # Chopo" no es un menú y no hay un mensaje nuestro después, así que queda pendiente.
        r = _timing(("out", 0, "Hola"), ("out", 86400, "Buenas tardes"), ("in", 86406, "Bienvenido a Chopo"))
        assert r["common"] == "pendiente"
        assert r["inputs"]["t1_s"] == 6
        assert any(s["paso"] == "Se mide la respuesta al reintento" and "6 s" in s["detalle"] for s in r["trace"])

    def test_empty_body_is_not_t1(self):
        # Stellantis (2026-10-06): un mensaje vacío a los 2 s y el saludo real a los 42 s.
        r = _timing(("out", 0, "Hola"), ("in", 2, ""), ("in", 42, "Le saluda Clarissa"))
        assert r["common"] == "humano"
        assert r["inputs"]["t1_s"] == 42
        assert any(s["paso"] == "Mensajes que no cuentan" for s in r["trace"])

    def test_menu_on_the_first_reply_is_bot_even_past_t1(self):
        # Taboo / Rivera Gas (2026-10-06): menú a los 11 s, sin segundo mensaje.
        menu = "Selecciona una opción:\n1. Ventas\n2. Servicio\n3. Refacciones"
        r = _timing(("out", 0, "Hola"), ("in", 11, menu))
        assert r["common"] == "bot"
        assert next(c for c in r["checks"] if c["key"] == "menu1")["lleva_a"] == "Bot"
        assert "lleva_a" not in next(c for c in r["checks"] if c["key"] == "t1")

    def test_slow_menu_is_bot_and_the_arrow_is_not_on_the_slow_time(self):
        # Compugadget México (2026-10-06): el menú tardó 23 min 48 s. El log ponía
        # "→ Bot" en T1 y parecía que contestar tarde era lo que lo hacía bot.
        menu = "Selecciona una opción:\n1. Ventas\n2. Servicio\n3. Refacciones"
        r = _timing(("out", 0, "Hola"), ("in", 23 * 60 + 48, menu))
        assert r["common"] == "bot"
        assert next(c for c in r["checks"] if c["key"] == "t1")["estado"] == "no"
        assert next(c for c in r["checks"] if c["key"] == "menu1")["lleva_a"] == "Bot"
        plain = _timing(("out", 0, "Hola"), ("in", 23 * 60 + 48, "Buenas tardes, le atiende Ana"))
        assert plain["common"] == "humano"
        assert all(c["key"] != "menu1" for c in plain["checks"])

    def test_message_before_ours_is_shown_and_does_not_count(self):
        # Servi-Gas (2026-10-06): "Buenas tardes" 21 min antes. Solo IA lo ve y dice Humano.
        r = _timing(("in", -1200, "Buenas tardes"), ("out", 0, "Hola, buenas tardes"))
        assert r["common"] == "humano_o_desconectado"
        assert any(s["paso"] == "Llegó antes de que escribiéramos" and "Buenas tardes" in s["detalle"]
                   for s in r["trace"])
        assert next(c for c in r["checks"] if c.get("lleva_a"))["key"] == "resp1"

    def test_several_numbers_are_named_because_the_first_reply_decides(self):
        # Mazda Santa Anita (2026-10-06): el asistente digital contestó en otro número.
        msgs = [
            {"direction": "outbound", "created_at": T0, "message_body": "Hola",
             "to_number": "3338082667", "status": "sent"},
            {"direction": "outbound", "created_at": T0 + timedelta(seconds=2), "message_body": "Hola",
             "to_number": "5524944458", "status": "sent"},
            {"direction": "inbound", "created_at": T0 + timedelta(seconds=11),
             "message_body": "Hola, soy el asistente digital de Mazda", "from_number": "5524944458"},
            {"direction": "inbound", "created_at": T0 + timedelta(minutes=30),
             "message_body": "no estamos interesados", "from_number": "3338082667"},
        ]
        r = cc.run_timing(_DB(msgs), "c1", settings=SETTINGS, now=T0 + timedelta(days=1))
        assert r["common"] == "bot"
        assert any(s["paso"] == "Varios números" and "3338082667" in s["detalle"]
                   and "5524944458" in s["detalle"] for s in r["trace"])

    def test_failed_send_says_the_message_did_not_arrive(self):
        # GAS 5 DE MAYO (2026-10-06): los dos envíos fallaron. El log decía que no le habíamos escrito.
        msgs = [{"direction": "outbound", "created_at": T0, "message_body": "Hola", "status": "failed"}]
        r = cc.run_timing(_DB(msgs), "c1", settings=SETTINGS, now=T0 + timedelta(days=1))
        assert r["common"] == "pendiente"
        envio = next(c for c in r["checks"] if c["key"] == "envio1")
        assert envio["estado"] == "no"
        assert envio["medido"] == "no llegó"
        assert envio["lleva_a"] == "Pendiente"
        assert any("falló" in s["detalle"] for s in r["trace"])

    def test_virtual_assistant_on_the_first_reply_is_bot(self):
        r = _timing(("out", 0, "Hola"), ("in", 11, "Hola, soy tu asistente virtual"))
        assert r["common"] == "bot"

    def test_slow_menu_on_the_second_reply_is_bot(self):
        # El Chopo: el segundo mensaje era un menú a los 7 s, más que T2 (5 s).
        menu = "Elige una opción:\n1. Ventas\n2. Servicio\n3. Refacciones"
        r = _timing(("out", 0, "Hola"), ("in", 2, "Bienvenido"), ("out", 30, "servicio"), ("in", 37, menu))
        assert r["common"] == "bot"

    def test_slow_plain_second_reply_stays_automatic_plus_human(self):
        # Gas Flamazul: "Hola buen día" a los 9 s no es un menú.
        r = _timing(("out", 0, "Hola"), ("in", 2, "Bienvenido"), ("out", 30, "servicio"),
                    ("in", 39, "Hola buen día"))
        assert r["common"] == "automatico_humano"

    def test_second_reply_after_an_hour(self):
        r = _timing(("out", 0, "Hola"), ("in", 3, "Gracias por escribir"), ("out", 60, "busco servicio"),
                    ("in", 60 + 2 * 3600, "Claro, ¿qué modelo es?"))
        assert r["common"] == "automatico_sin_respuesta"

    def test_lid_replies_belong_to_the_number_we_last_wrote_to(self):
        msgs = [
            {"direction": "outbound", "to_number": "+525564811373", "created_at": T0, "message_body": "Hola"},
            {"direction": "outbound", "to_number": "+525255648113", "created_at": T0 + timedelta(seconds=1), "message_body": "Hola"},
            {"direction": "outbound", "to_number": "+525564811373", "created_at": T0 + timedelta(hours=30), "message_body": "Buenas"},
            {"direction": "inbound", "from_number": "127956202594427", "created_at": T0 + timedelta(hours=30, seconds=6), "message_body": "Bienvenido"},
        ]
        a = cc._messages(_DB(msgs), "c1", number="5564811373")
        b = cc._messages(_DB(msgs), "c1", number="5255648113")
        assert [m["direction"] for m in a] == ["outbound", "outbound", "inbound"]
        assert [m["direction"] for m in b] == ["outbound"]


class TestUnansweredThreadsAndSummary:
    def test_messages_to_numbers_that_never_answered_are_dropped(self):
        # OH EXPRESS: escribimos a muchos números; solo uno contestó, con LID.
        from app.classifier import drop_unanswered_threads
        msgs = [{"direction": "outbound", "to_number": f"+52556000{i:04d}", "created_at": T0 + timedelta(seconds=i),
                 "message_body": "Hola"} for i in range(30)]
        msgs += [{"direction": "outbound", "to_number": "+525564811373", "created_at": T0 + timedelta(seconds=40), "message_body": "Hola"},
                 {"direction": "inbound", "from_number": "127956202594427", "created_at": T0 + timedelta(seconds=50), "message_body": "Buen día"}]
        kept = drop_unanswered_threads(msgs)
        assert [m["direction"] for m in kept] == ["outbound", "inbound"]

    def test_nothing_is_dropped_when_nobody_answered(self):
        from app.classifier import drop_unanswered_threads
        msgs = [{"direction": "outbound", "to_number": "+525564811373", "created_at": T0, "message_body": "Hola"}]
        assert drop_unanswered_threads(msgs) == msgs

    def test_summary_counts_conversations_with_a_reply(self):
        class _Coll:
            def find(self, *a, **kw):
                both = {"timing": {"common": "humano"}, "ia": {"common": "humano"}, "hibrido": {"common": "humano"},
                        "agreement": cc.agreement("humano", "humano", "humano")}
                silent = {"timing": {"common": "humano_o_desconectado"}, "ia": {"common": "sin_respuesta"},
                          "hibrido": {"common": "sin_respuesta"}, "agreement": cc.agreement("humano_o_desconectado", "sin_respuesta", "sin_respuesta")}
                return [
                    {**both, "replied": True},                                                  # 1 número, contestó
                    {**silent, "replied": False},                                               # 1 número, nunca contestó
                    {**both, "replied": True, "numbers": [{**both, "replied": True},           # varios números:
                                                          {**silent, "replied": False}]},     # solo cuenta el que contestó
                ]
        db = type("M", (), {"db": {cc.COMPARISONS: _Coll()}})()
        s = cc.summary(db)
        assert s["total"] == 2
        assert s["coincidencia"]["todos"] == {"si": 2, "de": 2}


class TestReportVerdict:
    """El reporte dice lo mismo que la columna "Timing + IA" de Análisis (report_verdict)."""

    @staticmethod
    def _db(doc):
        class _Coll:
            def find_one(self, flt, projection=None):
                return doc if doc and flt.get("company_id") == doc["company_id"] else None
        return type("M", (), {"db": {cc.COMPARISONS: _Coll()}})()

    def _hybrid(self, category, is_ai=False, notes="", **scores):
        trace = [{"paso": "Resultado", "detalle": "x"}]
        return cc._hybrid_result({"category": category, "is_ai": is_ai, "notes": notes, **scores}, trace)

    def test_company_report_uses_the_latest_timing_ia_result(self):
        # Nissan Autocom La Capilla: el análisis guardado decía Bot + Humano; Análisis, Agente IA.
        db = self._db({"company_id": "c1", "hibrido": self._hybrid("bot", True, "Agente que agenda citas",
                                                                   svc_prof=4, response_quality=3.5)})
        v = cc.report_verdict(db, "c1")
        assert v == {"category": "bot", "is_ai": True, "notes": "Agente que agenda citas",
                     "svc_prof": 4, "response_quality": 3.5}

    def test_number_report_uses_that_numbers_result(self):
        db = self._db({"company_id": "c1", "hibrido": self._hybrid("hibrido_bot"),
                       "numbers": [{"number": "4421234834", "hibrido": self._hybrid("humano", notes="Una persona")},
                                   {"number": "4429999999", "hibrido": self._hybrid("sin_respuesta")}]})
        assert cc.report_verdict(db, "c1", "+52 1 442 123 4834")["category"] == "humano"
        assert cc.report_verdict(db, "c1", "4429999999")["category"] == "sin_respuesta"
        # Un número que no está en el desplegable: la de la empresa.
        assert cc.report_verdict(db, "c1", "5500000000")["category"] == "hibrido_bot"

    def test_without_a_usable_comparison_the_saved_analysis_stays(self):
        assert cc.report_verdict(self._db(None), "c1") is None
        failed = {"company_id": "c1", "hibrido": {**self._hybrid(None), "error": True}}
        assert cc.report_verdict(self._db(failed), "c1") is None

    def test_empty_notes_do_not_erase_the_saved_diagnosis(self):
        v = cc.report_verdict(self._db({"company_id": "c1", "hibrido": self._hybrid("humano")}), "c1")
        assert "notes" not in v


class TestFailedSendsDoNotCount:
    def test_timing_never_starts_from_a_send_that_failed(self):
        # Infiniti: un envío programado vacío falló 5 h antes del mensaje real; Timing lo tomaba
        # como nuestro primer mensaje y daba "Humano o canal desconectado".
        seen = {}

        class _Logs:
            def find(self, flt, *a, **kw):
                seen["filter"] = flt
                return _Cursor([])

            def distinct(self, field, flt):
                seen["distinct"] = flt
                return []

        db = type("M", (), {"db": type("D", (), {"message_logs": _Logs()})()})()
        cc._messages(db, "c1")
        cc._contacted_numbers(db, "c1")
        assert seen["filter"]["status"] == {"$ne": "failed"}
        assert seen["distinct"]["status"] == {"$ne": "failed"}
