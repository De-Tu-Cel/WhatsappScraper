"""Un warmup con message_id='' no debe tragar inbound nuevo (SIMAGAS/GUVAL, 2026-10-08)."""
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.database import MongoDBManager


class _Logs:
    def __init__(self):
        self.warmup = {
            "_id": ObjectId("6a91d124a0d29d7b7b66c35e"),
            "direction": "outbound",
            "message_id": "",
            "is_warmup": True,
        }
        self.inserted = []

    def find_one(self, q, *args, **kwargs):
        if q.get("message_id") == "":
            return self.warmup
        if q.get("direction") == "inbound":
            return None
        return None

    def insert_one(self, doc):
        if doc.get("message_id") == "":
            raise DuplicateKeyError("E11000 duplicate key message_id: ''")
        self.inserted.append(doc)
        return type("R", (), {"inserted_id": ObjectId()})()


class _Companies:
    def find_one(self, *args, **kwargs):
        return {"domain": "simagas.mx", "source": "scrape"}


def _mgr():
    mgr = MongoDBManager.__new__(MongoDBManager)
    logs = _Logs()
    mgr.db = type("DB", (), {"message_logs": logs, "companies": _Companies()})()
    return mgr, logs


def test_empty_message_id_does_not_reuse_warmup_doc():
    mgr, logs = _mgr()
    log_id = mgr.save_evolution_log(
        direction="inbound",
        company_id="6a74ba6becf84e0f0eedb588",
        number="5215528842109",
        message_body="Buenas tardes, ¿en qué le puedo ayudar?",
        message_id="",
        instance_name="gely-wa",
    )
    assert log_id != "6a91d124a0d29d7b7b66c35e"
    assert len(logs.inserted) == 1
    assert logs.inserted[0]["message_id"] is None
    assert logs.inserted[0]["from_number"] == "5215528842109"
    assert logs.inserted[0]["company_id"] == "6a74ba6becf84e0f0eedb588"


def test_real_message_id_still_dedups():
    mgr, logs = _mgr()
    existing_id = ObjectId()
    logs.find_one = lambda q, *a, **k: (
        {"_id": existing_id, "company_id": "6a74ba6becf84e0f0eedb588"}
        if q.get("message_id") == "true_123@c.us" else None
    )
    log_id = mgr.save_evolution_log(
        direction="inbound",
        company_id="6a74ba6becf84e0f0eedb588",
        number="5215528842109",
        message_body="Hola",
        message_id="true_123@c.us",
    )
    assert log_id == str(existing_id)
    assert logs.inserted == []
