"""Contrato: con la capa activa (dual/shadow), cada operación de pymongo que usa la app
regresa EXACTAMENTE lo mismo que sin la capa, y Postgres termina igual que Mongo.

La suite general casi siempre simula la base con MagicMock, así que no ejercita la
capa; esta prueba sí: corre la misma secuencia contra una base sin capa y contra
otra con capa, y compara resultado por resultado.
"""
import os
import uuid

import mongomock
import pytest
from bson import ObjectId
from pymongo import ReturnDocument

from app import pgmirror
from app.pgmirror import config, routing
from app.pgmirror.reconcile import reconcile

TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _pg_available():
    try:
        import psycopg
        psycopg.connect(TEST_PG, connect_timeout=2).close()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _pg_available(), reason="sin Postgres de pruebas")


def _normalize(value):
    """Resultados de pymongo → algo comparable (los objetos *Result no implementan ==)."""
    for attr in ("inserted_id", "inserted_ids", "matched_count", "modified_count", "deleted_count", "upserted_id"):
        if hasattr(value, attr):
            return {a: getattr(value, a) for a in ("inserted_id", "inserted_ids", "matched_count", "modified_count",
                                                   "deleted_count", "upserted_id") if hasattr(value, a)}
    if hasattr(value, "__iter__") and not isinstance(value, (dict, list, str, bytes)):
        return list(value)
    return value


def _scenario(db, coll, ids):
    """La misma secuencia de operaciones que hace la app (colas, cupos, upserts, búsquedas…)."""
    c = db[coll]
    out = []
    out.append(c.insert_one({"_id": ids[0], "name": "Alpha", "status": "pending", "n": 1, "tags": ["a"]}))
    out.append(c.insert_many([{"_id": ids[i], "name": f"N{i}", "status": "pending", "n": i, "tags": []} for i in range(1, 5)]))
    out.append(c.update_one({"_id": ids[1]}, {"$set": {"status": "sent"}, "$push": {"tags": "x"}}))
    out.append(c.update_one({"name": "nobody"}, {"$set": {"status": "x"}}))
    out.append(c.update_one({"_id": ids[5]}, {"$setOnInsert": {"name": "upserted", "n": 0}}, upsert=True))
    out.append(c.update_many({"status": "pending"}, {"$inc": {"n": 10}, "$addToSet": {"tags": "bulk"}}))
    # Reclamo atómico tipo cola (send_queue_items / ai_reply_pending).
    out.append(c.find_one_and_update({"status": "pending"}, {"$set": {"status": "claimed"}},
                                     sort=[("n", 1)], return_document=ReturnDocument.AFTER))
    out.append(c.find_one_and_update({"_id": ids[2]}, {"$set": {"x": 1}}, return_document=ReturnDocument.BEFORE))
    out.append(c.find_one_and_update({"_id": "lease"}, {"$set": {"holder": "me"}}, upsert=True,
                                     return_document=ReturnDocument.AFTER))
    out.append(c.replace_one({"_id": ids[3]}, {"name": "replaced", "n": 3}))
    out.append(c.delete_one({"_id": ids[4]}))
    out.append(c.find_one_and_delete({"name": "replaced"}))
    out.append(c.delete_many({"status": "nonexistent"}))
    # Lecturas (en dual/shadow responden desde Mongo).
    out.append(c.find_one({"_id": ids[0]}))
    out.append(c.find_one({"status": "claimed"}, {"name": 1, "_id": 0}))
    out.append(list(c.find({}, {"name": 1}).sort("n", -1).skip(1).limit(3)))
    out.append(c.count_documents({"n": {"$gte": 10}}))
    out.append(sorted(c.distinct("tags")))
    out.append(list(c.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}, {"$sort": {"_id": 1}}])))
    c.create_index("name")
    out.append(sorted(ix["name"] for ix in c.list_indexes()))
    return [_normalize(v) for v in out]


@pytest.mark.parametrize("mode", ["dual", "shadow"])
def test_layer_is_invisible_to_the_app_and_postgres_ends_identical(monkeypatch, mode):
    coll = f"contract_{uuid.uuid4().hex[:8]}"
    ids = [ObjectId() for _ in range(6)]
    plain = mongomock.MongoClient().db
    expected = _scenario(plain, coll, ids)

    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv(config.env_name(coll), mode)
    routing._runtime = None
    raw = mongomock.MongoClient().db
    layered = pgmirror.wrap_database(raw)
    try:
        assert isinstance(layered[coll], routing.RoutedCollection)
        assert _scenario(layered, coll, ids) == expected
        rt = routing._runtime
        assert rt.worker.flush(15)
        assert not rt.worker.dirty, rt.worker.dirty
        assert reconcile(raw, rt.store, coll)["in_sync"]
        if mode == "shadow":
            assert rt.stats[coll].get("shadow_diffs", 0) == 0, rt.stats[coll]
            assert rt.stats[coll].get("shadow_ok", 0) >= 3
    finally:
        if routing._runtime is not None:
            import psycopg
            from psycopg import sql
            with psycopg.connect(TEST_PG, autocommit=True) as conn:
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", coll)))
            routing._runtime.store.close()
        routing._runtime = None
