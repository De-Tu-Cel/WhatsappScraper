"""Accuracy evaluation for the classifier's LLM judgment (humano / bot / hibrido).

This is NOT a fast unit test — it sends every case below to the ACTUAL configured
LLM provider (OPENAI_API_KEY takes priority over DEEPSEEK_API_KEY, see
app/llm.py:active_provider) via the real classify_response()/classify_conversation()
functions, and checks the verdict against a hand-labeled expected answer. It costs
real tokens and takes real wall-clock time, so it's skipped by default.

Run it explicitly with:
    pytest tests/test_classifier_llm_eval.py --run-llm-eval -v -s

The labeled cases are synthetic (written to match realistic WhatsApp reply
patterns for a Mexican SMB), not pulled from production data — they're meant to
catch prompt regressions and give a rough accuracy baseline, not to be the final
word on real-world accuracy. For a stronger signal, replace/extend
SINGLE_MESSAGE_CASES with real (outbound, inbound, reaction_time_min) triples
pulled from message_logs and label them by hand.
"""
import pytest

from app.classifier import classify_conversation, classify_response

pytestmark = pytest.mark.llm_eval


# Each case is a single outbound→inbound exchange. reaction_time_min=None means
# "no timing data" (forces the LLM path with no time hint at all). Values below
# 10/60 (10 seconds) are intentionally avoided unless the case is ALSO expected to
# be "bot" — under 10s is a hard deterministic short-circuit in _quick_classify,
# so it never actually reaches the LLM (see test_classifier_rules.py for that).
SINGLE_MESSAGE_CASES = [
    dict(
        name="humano_precio_especifico",
        outbound="Hola, vi que buscan proveedor de gas LP, ¿les interesa una cotización?",
        inbound="Hola sí, ahorita andamos buscando para la sucursal de Reforma, ¿cuánto sale el tanque de 20kg?",
        reaction_time_min=6.0,
        expected_category="humano",
    ),
    dict(
        name="humano_respuesta_corta_en_tema",
        outbound="¿Manejan servicio a domicilio en la colonia Nápoles?",
        inbound="Sí tenemos, son 350 el tanque de 20kg puesto en tu domicilio",
        reaction_time_min=3.0,
        expected_category="humano",
    ),
    dict(
        name="humano_fuera_de_horario_personal",
        outbound="Buenas, ¿tienen disponibilidad para instalación esta semana?",
        inbound="Disculpa la tardanza, andaba en campo todo el día. Sí claro, mañana temprano te caigo",
        reaction_time_min=190.0,
        expected_category="humano",
    ),
    dict(
        name="humano_rapido_pero_especifico",
        outbound="¿Cuánto cuesta el mantenimiento anual del tanque estacionario?",
        inbound="uy sí, justo ando en la sucursal, dame 2 min y te paso precios exactos",
        reaction_time_min=40 / 60,
        expected_category="humano",
    ),
    dict(
        name="humano_numero_en_prosa_no_es_menu",
        outbound="¿Cuál es el mejor número para contactarlos?",
        inbound="Claro, marca al 55 1234 5678 ext 3 y ahí te atienden directo",
        reaction_time_min=6.0,
        expected_category="humano",
    ),
    dict(
        name="humano_default_ante_duda_emoji_solo",
        outbound="Quedamos atentos a tu confirmación",
        inbound="👍",
        reaction_time_min=None,
        expected_category="humano",
    ),
    dict(
        name="humano_default_ok_gracias",
        outbound="Con gusto, cualquier cosa me avisas",
        inbound="Ok gracias",
        reaction_time_min=2.0,
        expected_category="humano",
    ),
    dict(
        name="bot_menu_numerado",
        outbound="Hola, gracias por escribirnos",
        inbound="Elige una opción:\n1. Ventas\n2. Soporte técnico\n3. Cobranza",
        reaction_time_min=8 / 60,
        expected_category="bot",
        expected_is_ai=False,
    ),
    dict(
        name="bot_ivr_letras",
        outbound="Hola, ¿en qué te podemos ayudar?",
        inbound="Escribe *A* para Ventas o *B* para Soporte",
        reaction_time_min=6 / 60,
        expected_category="bot",
        expected_is_ai=False,
    ),
    dict(
        name="bot_plantilla_folio_instantaneo",
        outbound="Hola, quiero información de sus productos",
        inbound="Hemos recibido tu consulta. Folio: TKT-0458. En breve un asesor te contactará.",
        reaction_time_min=4 / 60,
        expected_category="bot",
    ),
    dict(
        name="bot_bilingue_cierre_sesion",
        outbound="¿Sigues ahí?",
        inbound="La sesión ha finalizado. / Session ended.",
        reaction_time_min=45 / 60,
        expected_category="bot",
    ),
    dict(
        name="bot_se_autoidentifica",
        outbound="Hola, buenas tardes",
        inbound="Hola, soy Max, tu asistente virtual. ¿En qué puedo ayudarte hoy? 🤖",
        reaction_time_min=20 / 60,
        expected_category="bot",
    ),
    dict(
        name="bot_generico_madrugada",
        outbound="Hola, ¿tienen servicio de emergencia?",
        inbound="Gracias por tu interés. Nuestro equipo te contactará pronto.",
        reaction_time_min=6 / 60,
        expected_category="bot",
    ),
    dict(
        name="bot_ia_conversacional",
        outbound="¿Cuánto cuesta el tanque estacionario de 300 litros instalado?",
        inbound=(
            "¡Con gusto te ayudo! El tanque estacionario de 300 litros instalado tiene un costo "
            "aproximado de $8,500 MXN, incluyendo válvulas de seguridad y revisión inicial. "
            "¿Te gustaría que agende una visita técnica para cotización exacta en tu domicilio?"
        ),
        reaction_time_min=15 / 60,
        expected_category="bot",
    ),
    dict(
        name="hibrido_oferta_activa_de_asesor",
        outbound="Hola, gracias por contactar a Gas Ejemplo 🔥",
        inbound="¿Deseas hablar con un asesor ahora mismo? Responde SÍ y te conectamos de inmediato.",
        reaction_time_min=25 / 60,
        expected_category="hibrido",
    ),
    dict(
        name="hibrido_anuncio_de_relevo",
        outbound="¿Cuánto tardarían en surtir un pedido de 5 tanques?",
        inbound="Hola, soy Diana, a partir de ahora te atenderé yo en lugar de nuestro asistente virtual 😊 ¿me repites qué necesitas?",
        reaction_time_min=8.0,
        expected_category="hibrido",
    ),
]


CONVERSATION_CASES = [
    dict(
        name="conv_puro_bot",
        company_name="Gas Ejemplo",
        industry="Gas LP",
        expected_category="bot",
        thread=[
            ("outbound", "Hola, gracias por escribirnos. Elige una opción:\n1. Ventas\n2. Soporte"),
            ("inbound", "1"),
            ("outbound", "Gracias por tu interés en Ventas. En breve un asesor te contactará. Folio: TKT-9921"),
            ("inbound", "¿Y cuánto tardan?"),
            ("outbound", "Gracias por tu interés en Ventas. En breve un asesor te contactará. Folio: TKT-9921"),
        ],
    ),
    dict(
        name="conv_hibrido_handoff",
        company_name="Gas Ejemplo",
        industry="Gas LP",
        expected_category="hibrido",
        thread=[
            ("outbound", "Hola, gracias por escribirnos. Elige una opción:\n1. Ventas\n2. Soporte"),
            ("inbound", "1"),
            ("outbound", "Gracias, en breve un asesor te contactará."),
            ("inbound", "Necesito 3 tanques de 20kg para mañana"),
            ("outbound", "Hola, soy Carlos, te atenderé personalmente de aquí en adelante. Sí tenemos disponibilidad, ¿a qué dirección los llevamos?"),
            ("inbound", "A Av. Reforma 123, colonia Centro"),
            ("outbound", "Perfecto, quedan agendados para mañana 10am, el total es $1,050 MXN"),
        ],
    ),
    dict(
        name="conv_puro_humano",
        company_name="Gas Ejemplo",
        industry="Gas LP",
        expected_category="humano",
        thread=[
            ("outbound", "Hola, vimos que buscan proveedor de gas LP"),
            ("inbound", "Hola sí, ¿manejan tanques estacionarios?"),
            ("outbound", "Sí claro, tenemos de 300 y 500 litros, ¿para qué uso los necesitas?"),
            ("inbound", "Es para un restaurante que estamos abriendo en la Roma"),
            ("outbound", "Perfecto, para restaurante normalmente recomendamos el de 500L, ¿quieres que te mande una cotización con instalación incluida?"),
            ("inbound", "Sí por favor, y si pueden pasar a ver el espacio mejor"),
        ],
    ),
]


def _run_cases(cases):
    """Runs every case through classify_response, never stopping at the first
    mismatch — we want the full accuracy picture, not just the first failure."""
    results = []
    for case in cases:
        analysis = classify_response(case["inbound"], case["outbound"], case["reaction_time_min"])
        cat_ok = analysis.get("category") == case["expected_category"]
        ai_ok = "expected_is_ai" not in case or analysis.get("is_ai") == case["expected_is_ai"]
        results.append({
            "name": case["name"],
            "expected": case["expected_category"],
            "got": analysis.get("category"),
            "is_ai_expected": case.get("expected_is_ai"),
            "is_ai_got": analysis.get("is_ai"),
            "notes": analysis.get("notes", ""),
            "ok": cat_ok and ai_ok,
        })
    return results


def _print_report(title, results):
    print(f"\n\n=== {title} ===")
    correct = 0
    per_category = {}
    for r in results:
        mark = "OK  " if r["ok"] else "FAIL"
        print(f"  [{mark}] {r['name']}: expected={r['expected']!r} got={r['got']!r}"
              + (f" (is_ai expected={r['is_ai_expected']} got={r['is_ai_got']})" if r.get("is_ai_expected") is not None else "")
              + f"\n      notes: {r['notes']}")
        per_category.setdefault(r["expected"], [0, 0])
        per_category[r["expected"]][1] += 1
        if r["ok"]:
            correct += 1
            per_category[r["expected"]][0] += 1
    total = len(results)
    print(f"\n  Overall: {correct}/{total} ({correct / total:.0%})")
    for cat, (ok, n) in sorted(per_category.items()):
        print(f"    {cat}: {ok}/{n} ({ok / n:.0%})")
    return correct / total if total else 0.0


def test_single_message_classification_accuracy():
    results = _run_cases(SINGLE_MESSAGE_CASES)
    accuracy = _print_report("Single-message classification", results)
    failed = [r["name"] for r in results if not r["ok"]]
    assert accuracy >= 0.75, (
        f"Classifier accuracy {accuracy:.0%} is below the 75% bar. "
        f"Failed cases: {failed}. See printed report above for what it got vs. expected."
    )


def test_conversation_classification_accuracy(monkeypatch):
    import app.classifier as classifier_module

    results = []
    for case in CONVERSATION_CASES:
        lines = []
        for role, body in case["thread"]:
            label = "Representante" if role == "outbound" else "Prospecto"
            lines.append(f"[{label}]: {body}")
        thread_text = "\n".join(lines)

        # classify_conversation() reads message_logs from Mongo internally — since
        # this eval only cares about the LLM's judgment given a thread, we build
        # the prompt the same way the real function does and swap in our text
        # directly rather than standing up a live DB fixture just to feed it rows.
        from app.classifier import _CONV_PROMPT_TEMPLATE, _call_deepseek, _parse_llm_response

        prompt = _CONV_PROMPT_TEMPLATE.format(
            company_name=case["company_name"],
            industry=case["industry"],
            thread=thread_text,
        )
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=350)
        analysis = _parse_llm_response(raw)
        results.append({
            "name": case["name"],
            "expected": case["expected_category"],
            "got": analysis.get("category"),
            "notes": analysis.get("notes", ""),
            "ok": analysis.get("category") == case["expected_category"],
        })

    accuracy = _print_report("Full-conversation classification", results)
    failed = [r["name"] for r in results if not r["ok"]]
    assert accuracy >= 0.66, (
        f"Conversation classifier accuracy {accuracy:.0%} is below the bar. "
        f"Failed cases: {failed}. See printed report above."
    )
