"""Análisis filtra con la clasificación de Timing + IA (database._use_hybrid_verdict)."""
from app import classification_compare as cc
from app.database import _use_hybrid_verdict


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    def find(self, flt, *a, **kw):
        ids = set(flt["company_id"]["$in"])
        return [d for d in self.docs if d["company_id"] in ids]


def _db(docs):
    return {cc.COMPARISONS: _Coll(docs)}


def test_company_takes_the_hybrid_verdict():
    # Universidad UVM (2026-10-06): el mensaje decía Bot + Humano y Timing + IA, Bot.
    rows = [{"company_id": "uvm", "category": "hibrido_bot", "is_ai": False, "numbers": []}]
    _use_hybrid_verdict(_db([{"company_id": "uvm", "hibrido": {"category": "bot", "is_ai": False}}]), rows)
    assert (rows[0]["category"], rows[0]["is_ai"]) == ("bot", False)


def test_several_numbers_agreeing_override_the_mixed_company_thread():
    # Diesgas (2026-10-06): la plática de los dos números juntos salía Agente IA.
    rows = [{"company_id": "d", "category": "bot", "is_ai": True,
             "numbers": [{"number": "+52 442 170 5112"}, {"number": "4621465725"}]}]
    doc = {"company_id": "d", "hibrido": {"category": "bot", "is_ai": True}, "numbers": [
        {"number": "4421705112", "replied": True, "hibrido": {"category": "automatico", "is_ai": False}},
        {"number": "4621465725", "replied": True, "hibrido": {"category": "automatico", "is_ai": False}},
    ]}
    _use_hybrid_verdict(_db([doc]), rows)
    assert (rows[0]["category"], rows[0]["is_ai"]) == ("automatico", False)
    assert all(n["hybrid_verdict"] for n in rows[0]["numbers"])


def test_failed_comparison_keeps_the_stored_category():
    rows = [{"company_id": "x", "category": "humano", "is_ai": False, "numbers": []}]
    _use_hybrid_verdict(_db([{"company_id": "x", "hibrido": {"category": None, "error": True}}]), rows)
    assert rows[0]["category"] == "humano"


def test_lid_replies_belong_to_the_number_we_wrote_last_skipping_failed_sends():
    # Mazda Santa Anita (2026-10-06): las respuestas llegaron con LID y un envío
    # falló justo antes; los 4 números salían "Sin respuesta" y el PDF apagado.
    from datetime import datetime, timedelta
    from app.classifier import assign_thread_numbers
    t0 = datetime(2026, 6, 16, 16, 4)
    msgs = [
        {"direction": "outbound", "to_number": "+523338082667", "created_at": t0},
        {"direction": "outbound", "to_number": "+525524944458", "created_at": t0 + timedelta(seconds=1)},
        {"direction": "outbound", "to_number": "+523344441000", "status": "failed", "created_at": t0 + timedelta(seconds=2)},
        {"direction": "inbound", "from_number": "48306134737067", "created_at": t0 + timedelta(seconds=10)},
        {"direction": "outbound", "to_number": "+523338082667", "created_at": t0 + timedelta(minutes=7)},
        {"direction": "inbound", "from_number": "87506150269111", "created_at": t0 + timedelta(minutes=30)},
    ]
    nums = [m["_num"] for m in assign_thread_numbers(msgs) if m["direction"] == "inbound"]
    assert nums == ["5524944458", "3338082667"]


def test_numbers_that_never_replied_do_not_join_the_filters():
    rows = [{"company_id": "h", "category": "hibrido_bot", "is_ai": False,
             "numbers": [{"number": "6622290155"}, {"number": "6440000891"}]}]
    doc = {"company_id": "h", "hibrido": {"category": "hibrido_bot", "is_ai": False}, "numbers": [
        {"number": "6622290155", "replied": True, "hibrido": {"category": "hibrido_bot", "is_ai": False}},
        {"number": "6440000891", "replied": False, "hibrido": {"category": "sin_respuesta", "is_ai": False}},
    ]}
    _use_hybrid_verdict(_db([doc]), rows)
    assert rows[0]["numbers"][0].get("hybrid_verdict") is True
    assert not rows[0]["numbers"][1].get("hybrid_verdict")
    assert rows[0]["numbers"][1]["category"] == "sin_respuesta"
