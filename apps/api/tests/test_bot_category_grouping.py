"""Public Bot grouping preserves saved diagnoses and counts companies once."""
from copy import deepcopy
from datetime import datetime, timedelta

import pytest

from app.classification_categories import company_categories, display_category
from app import classification_compare as cc
from app.classifier import verdict_label, _apply_deterministic_corrections, _apply_last_message_corrections
from app.report_generator import CATEGORY_INFO, generate_report


@pytest.mark.parametrize("category,is_ai,expected", [
    ("hibrido", False, "bot"), ("hibrido_bot", True, "bot"),
    ("bot", False, "bot"), ("menu", False, "bot"),
    ("bot", True, "bot_ia"), ("bot_ia", True, "bot_ia"),
    ("hibrido_automatico", False, "automatico"), ("automatico", False, "automatico"),
])
def test_public_categories_keep_automatic_and_ai_separate(category, is_ai, expected):
    assert display_category(category, is_ai) == expected


def test_one_company_with_bot_and_bot_human_numbers_counts_only_once():
    row = {"category": "hibrido_bot", "numbers": [
        {"category": "hibrido", "hybrid_verdict": True},
        {"category": "bot", "hybrid_verdict": True},
        {"category": "sin_respuesta", "hybrid_verdict": False},
    ]}
    assert company_categories(row) == {"bot"}
    row["numbers"].append({"category": "bot", "is_ai": True, "hybrid_verdict": True})
    assert company_categories(row) == {"bot", "bot_ia"}


@pytest.mark.parametrize("opening,expected", [
    ("Selecciona una opción:", "hibrido_bot"),
    ("Elige una opción: 1. Pedidos 2. Facturas 3. Horarios", "hibrido_bot"),
    ("1.- Pedidos 2.- Facturas 3.- Horarios. Envíe el número que corresponda.", "hibrido_bot"),
    ("1.- Pedidos 2.- Facturas 3.- Horarios. Envié el número que corresponda.", "hibrido_bot"),
    ("Gracias por escribirnos. En este momento estamos fuera de horario.", "automatico"),
    ("Nuestros precios: 1. Cilindro $500 2. Tanque $900", "automatico"),
    ("Comparte los datos: 1. Nombre completo 2. Correo electrónico 3. Teléfono", "automatico"),
    ("Si ya eres usuario digita tu número de cliente. Si eres nuevo proporciona nombre, dirección y teléfono.",
     "automatico"),
])
def test_human_handoff_retains_interactive_menu_but_not_notices_or_data_lists(opening, expected):
    start = datetime(2026, 1, 1, 12)
    messages = [
        dict(direction="outbound", message_body="Hola", created_at=start),
        dict(direction="inbound", message_body=opening, created_at=start + timedelta(seconds=4)),
        dict(direction="inbound", message_body="Hola, te atiende Ana. Sí, podemos entregar mañana.",
             created_at=start + timedelta(minutes=5)),
    ]
    result = _apply_deterministic_corrections(
        dict(category="automatico", is_ai=False, notes=""), messages, "⚡")
    result = _apply_last_message_corrections(result, messages[-1]["message_body"])
    assert result["category"] == expected
    assert result["is_ai"] is False


def _old_comparison():
    return {"company_id": "test", "replied": True,
            "timing": {"common": "bot"}, "ia": {"common": "bot"},
            "hibrido": {"category": "hibrido_bot", "common": "automatico_humano", "label": "Bot + Humano"},
            "agreement": cc.agreement("bot", "bot", "automatico_humano")}


def test_old_comparisons_are_grouped_and_agreement_recalculated_without_mutation():
    original = _old_comparison()
    original["numbers"] = [deepcopy(original)]
    before = deepcopy(original)
    grouped = cc.group_bot_human(original)
    for result in (grouped, grouped["numbers"][0]):
        assert result["hibrido"]["category"] == "hibrido_bot"
        assert result["hibrido"]["common"] == "bot"
        assert result["hibrido"]["label"] == "Bot"
        assert result["agreement"]["todos"] is True
    assert original == before
    assert cc.group_bot_human(grouped) == grouped


def test_saved_summary_uses_the_new_grouping_and_agreement():
    class Collection:
        def find(self, *args, **kwargs):
            return [_old_comparison()]

    db = type("DB", (), {"db": {cc.COMPARISONS: Collection()}})()
    summary = cc.summary(db)
    assert summary["por_metodo"]["hibrido"] == {"bot": 1}
    assert summary["coincidencia"]["todos"] == {"si": 1, "de": 1}


@pytest.mark.parametrize("category", ["hibrido", "hibrido_bot"])
def test_reports_share_bots_label_color_and_still_generate(category):
    assert verdict_label(category) == "Bot"
    assert CATEGORY_INFO[category] == CATEGORY_INFO["bot"]
    report = generate_report({"name": "Empresa de prueba"}, {"category": category}, [], None)
    assert report.getvalue().startswith(b"%PDF")
