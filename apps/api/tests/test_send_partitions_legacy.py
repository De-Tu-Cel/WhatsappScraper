"""Partición "legacy" de la cola de envíos: items pendientes sin user_id.

distinct("user_id") solo devuelve None por los items que NO tienen el campo cuando
Mongo responde desde el índice de user_id (depende de su plan; sin índice, o desde
Postgres, no lo devuelve). Si el despachador dependiera de eso, esos items nunca se
enviarían: por eso se revisa explícitamente.
"""
from types import SimpleNamespace

import mongomock

from app import send_now_worker as sw


def _db(*items):
    db = SimpleNamespace(db=mongomock.MongoClient().db)
    if items:
        db.db.send_queue_items.insert_many([dict(i) for i in items])
    return db


def test_items_without_user_id_get_the_legacy_partition_even_if_distinct_omits_them():
    db = _db({"status": "pending", "user_id": "u1"}, {"status": "pending"}, {"status": "sent", "user_id": "u2"})
    # Como Mongo sin índice (o Postgres): el item sin user_id no aparece en distinct.
    assert None not in db.db.send_queue_items.distinct("user_id", {"status": "pending"})
    assert sw._partitions_needed(db) == {"u1": "u1", sw._LEGACY_PARTITION: ""}


def test_null_or_empty_user_id_also_go_to_legacy():
    assert sw._partitions_needed(_db({"status": "pending", "user_id": None})) == {sw._LEGACY_PARTITION: ""}
    assert sw._partitions_needed(_db({"status": "pending", "user_id": ""})) == {sw._LEGACY_PARTITION: ""}


def test_no_legacy_partition_when_every_pending_item_has_a_user():
    db = _db({"status": "pending", "user_id": "u1"}, {"status": "pending", "user_id": "u2"}, {"status": "sent"})
    assert sw._partitions_needed(db) == {"u1": "u1", "u2": "u2"}
    assert sw._partitions_needed(_db()) == {}
