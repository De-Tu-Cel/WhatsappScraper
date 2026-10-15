"""Diesgas: los PDF de Cotizar tanque y PIDE TU GAS deben ser independientes."""
from copy import deepcopy
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from app.api.routes import api_generate_report
from app.schemas.company import ReportRequest
from app.classification_compare import report_verdict
from app.report_scope import report_thread_for_number, select_number_analytics, first_response_seconds
from app.report_generator import generate_report


FIRST, SECOND = "+524421705112", "+524621465725"


def fixture():
    numbers = [
        {"number": FIRST, "label": "Cotizar tanque", "responses": 10, "reaction_time_min": 0.1,
         "notes": "Atencion de octubre", "response_quality": 4, "category": "automatico"},
        {"number": SECOND, "label": "PIDE TU GAS", "responses": 3, "reaction_time_min": 0.2,
         "notes": "Atencion de agosto", "response_quality": 2, "category": "automatico"},
    ]
    manager = MagicMock()
    manager.get_company_full_data.return_value = {"name": "Diesgas", "contacts": [{"type": "whatsapp", "value": FIRST}]}
    manager.get_analytics.return_value = {"items": [{"notes": "Resumen general", "reaction_time_min": 999,
                                                  "numbers": numbers, "industry": "Gas LP"}]}
    manager.db.message_logs.find_one.return_value = None
    manager.get_conversation_thread.return_value = [
        {"direction": "outbound", "to_number": FIRST, "body": "Consulta de octubre"},
        {"direction": "inbound", "from_number": FIRST, "body": "Respuesta de octubre"},
        {"direction": "outbound", "to_number": SECOND, "body": "Consulta de agosto"},
        {"direction": "inbound", "from_number": SECOND, "body": "Respuesta de agosto"},
    ]
    return manager


@pytest.mark.parametrize("index", [0, 1])
def test_report_endpoint_selects_contact_metrics_evidence_and_filename(index):
    manager = fixture()
    selected = manager.get_analytics.return_value["items"][0]["numbers"][index]
    original = deepcopy(manager.get_company_full_data.return_value)
    with patch("app.api.routes.MongoDBManager", return_value=manager), \
         patch("app.classification_compare.report_verdict", return_value={"category": "automatico", "model": "saved-model"}), \
         patch("app.report_generator.generate_report", return_value=BytesIO(b"%PDF")) as generate:
        response = api_generate_report("diesgas", ReportRequest(filter_number=selected["number"]))
    args = generate.call_args.kwargs
    assert args["company"]["report_number"] == selected["number"]
    assert args["company"]["report_contact_label"] == selected["label"]
    assert args["analytics"]["notes"] == selected["notes"]
    assert args["analytics"]["reaction_time_min"] == selected["reaction_time_min"]
    assert args["analytics"]["total_responses"] == selected["responses"]
    assert args["analytics"]["model"] == "saved-model"
    assert len(args["thread"]) == 2
    assert all(selected["number"] in (m.get("to_number"), m.get("from_number")) for m in args["thread"])
    assert selected["number"].strip("+") in response.headers["content-disposition"]
    assert manager.get_company_full_data.return_value == original


def test_unknown_number_never_uses_another_branch_report():
    with patch("app.api.routes.MongoDBManager", return_value=fixture()), \
         patch("app.report_generator.generate_report") as generate:
        with pytest.raises(HTTPException) as exc:
            api_generate_report("diesgas", ReportRequest(filter_number="+525500000000"))
    assert exc.value.status_code == 404
    generate.assert_not_called()


@pytest.mark.parametrize("entry,requested,match", [
    (FIRST, FIRST, True), (FIRST, "+5214421705112", True),
    (FIRST, SECOND, False), ("4421705112", FIRST, True),
    ("+523112000000", "+573112000000", False),
])
def test_full_country_identity_and_legacy_mexican_alias(entry, requested, match):
    assert bool(select_number_analytics({"numbers": [{"number": entry}]}, requested)) == match


def test_thread_keeps_lid_reply_with_last_successful_target_without_other_countries():
    thread = [
        {"direction": "outbound", "to_number": "+523112000000"},
        {"direction": "inbound", "from_number": "123@lid", "body": "Mexico"},
        {"direction": "outbound", "to_number": "+573112000000", "status": "failed"},
        {"direction": "inbound", "from_number": "123@lid", "body": "Mexico otra vez"},
        {"direction": "outbound", "to_number": "+573112000000"},
        {"direction": "inbound", "from_number": "123@lid", "body": "Colombia"},
    ]
    assert [m.get("body") for m in report_thread_for_number(thread, "+523112000000")] == [None, "Mexico", "Mexico otra vez"]


def test_missing_branch_comparison_does_not_inherit_company_verdict():
    manager = MagicMock()
    manager.db.__getitem__.return_value.find_one.return_value = {"hibrido": {"category": "bot"}, "numbers": []}
    assert report_verdict(manager, "diesgas", SECOND) is None


def test_branch_comparisons_retain_distinct_notes_and_models():
    manager = MagicMock()
    manager.db.__getitem__.return_value.find_one.return_value = {
        "hibrido": {"category": "bot", "notes": "General"},
        "numbers": [
            {"number": "4421705112", "hibrido": {"category": "automatico", "notes": "Octubre", "model": "model-a"}},
            {"number": "4621465725", "hibrido": {"category": "automatico", "notes": "Agosto", "model": "model-b"}},
        ],
    }
    assert report_verdict(manager, "diesgas", FIRST)["notes"] == "Octubre"
    assert report_verdict(manager, "diesgas", SECOND)["model"] == "model-b"


def test_pdf_renders_selected_number_label_and_specific_verdict():
    # El texto final del PDF debe identificar el canal, no sólo la categoría común.
    with patch("reportlab.rl_config.pageCompression", 0):
        pdf = generate_report(
            {"name": "Diesgas", "report_number": SECOND, "report_contact_label": "PIDE TU GAS",
             "contacts": [{"type": "whatsapp", "value": FIRST}]},
            {"category": "automatico", "notes": "Resultado exclusivo de agosto"}, [], None,
        ).getvalue()
    assert SECOND.encode() in pdf
    assert FIRST.encode() not in pdf
    assert b"PIDE TU GAS" in pdf
    assert b"Resultado exclusivo de agosto" in pdf


def test_exact_response_seconds_preserve_subminute_precision_and_ignore_failed_send():
    thread = [
        {"direction": "outbound", "created_at": "2026-08-10T17:05:00Z", "status": "failed"},
        {"direction": "outbound", "created_at": "2026-08-10T17:06:07.732"},
        {"direction": "inbound", "created_at": "2026-08-10T17:06:11.028+00:00"},
    ]
    assert first_response_seconds(thread) == pytest.approx(3.296)


@pytest.mark.parametrize("thread", [[], [{"direction": "inbound", "created_at": "invalid"}],
                                    [{"direction": "outbound", "created_at": "2026-08-10T17:06:07"}]])
def test_missing_response_timestamps_do_not_invent_a_latency(thread):
    assert first_response_seconds(thread) is None
