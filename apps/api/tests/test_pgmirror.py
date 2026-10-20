"""Capa de migración Mongo → Postgres (app/pgmirror).

Mongo: mongomock (conftest.py). Postgres: uno REAL y desechable — el local de
migration/docker-compose.yml o el servicio de CI (TEST_POSTGRES_URL). Si no hay
Postgres disponible estas pruebas se saltan; nunca usan POSTGRES_URL de producción.
"""
import os
import re
import uuid
from datetime import datetime, timedelta

import mongomock
import pytest
from bson import Binary, ObjectId

from app import pgmirror
from app.pgmirror import codec, config, routing, sqlfilter
from app.pgmirror.reconcile import reconcile

# Base propia de pruebas (no la "commercial" local, que es donde se ensaya la carga real).
TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _pg_available():
    try:
        import psycopg
        psycopg.connect(TEST_PG, connect_timeout=2).close()
        return True
    except Exception:
        return False


needs_pg = pytest.mark.skipif(not _pg_available(), reason="sin Postgres de pruebas (docker compose -f migration/docker-compose.yml up -d)")


@pytest.fixture
def store():
    from app.pgmirror.store import Store
    s = Store(TEST_PG)
    yield s
    s.close()


@pytest.fixture
def coll_name(store):
    name = f"t_{uuid.uuid4().hex[:10]}"
    yield name
    import psycopg
    from psycopg import sql
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", name)))


@pytest.fixture
def routed(monkeypatch, coll_name):
    """Base mongomock envuelta por la capa, con la colección de prueba en el modo pedido."""
    def make(mode):
        monkeypatch.setenv("POSTGRES_URL", TEST_PG)
        monkeypatch.setenv(config.env_name(coll_name), mode)
        routing._runtime = None
        raw = mongomock.MongoClient().db
        return raw, pgmirror.wrap_database(raw)
    yield make
    if routing._runtime is not None:
        routing._runtime.worker.flush(5)
        routing._runtime.store.close()
    routing._runtime = None


SAMPLE = {
    "_id": ObjectId(), "name": "Ferretería López", "n": 42, "big": 2**53 + 7, "price": 19.5, "ok": True,
    "nothing": None, "when": datetime(2026, 10, 19, 12, 30, 15, 123000),
    "company_id": ObjectId(), "company_id_str": "6716b0f2a1b2c3d4e5f60718",
    # pymongo entrega los binarios subtipo 0 (p. ej. fs.chunks.data) como bytes.
    "tags": ["a", "b"], "nested": {"deep": {"x": [1, {"y": "z"}]}}, "nul": "a\x00b", "blob": b"\x00\x01",
}


def test_codec_roundtrip_keeps_every_type():
    back = codec.decode_doc(codec.encode_doc(SAMPLE))
    assert back == SAMPLE
    assert isinstance(back["company_id"], ObjectId) and isinstance(back["company_id_str"], str)
    assert codec.doc_hash(back) == codec.doc_hash(SAMPLE)
    assert codec.doc_hash({"b": Binary(b"\x00\x01", 0)}) == codec.doc_hash({"b": b"\x00\x01"})
    for value in (ObjectId(), "settings", 7):
        assert codec.id_from_key(*codec.id_key(value)) == value


def test_without_postgres_url_the_database_is_untouched(monkeypatch):
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    raw = mongomock.MongoClient().db
    assert pgmirror.wrap_database(raw) is raw
    assert config.collection_mode("anything") == "mongo"


def test_mongo_mode_returns_the_plain_collection(routed):
    raw, db = routed("mongo")
    assert not isinstance(db["whatever"], routing.RoutedCollection)


# ── Traductor de filtros: mismos resultados que Mongo ───────────────────────────
DOCS = [
    {"_id": ObjectId(), "status": "sent", "n": 1, "tags": ["x", "y"], "cid": "abc", "when": datetime(2026, 1, 1), "name": "Alpha"},
    {"_id": ObjectId(), "status": "failed", "n": 5, "tags": ["y"], "cid": ObjectId("6716b0f2a1b2c3d4e5f60718"), "when": datetime(2026, 6, 1), "name": "beta"},
    {"_id": ObjectId(), "status": "sent", "n": 10, "cid": None, "name": "Gamma ñ"},
    {"_id": "settings", "status": None, "n": 2.5, "nested": {"k": "v"}},
    {"_id": ObjectId(), "n": -3, "tags": [], "name": "delta"},
]
FILTERS = [
    {}, {"status": "sent"}, {"status": None}, {"status": {"$ne": "sent"}}, {"status": {"$in": ["sent", "failed"]}},
    {"status": {"$nin": ["sent"]}}, {"tags": "y"}, {"tags": {"$in": ["x"]}}, {"cid": {"$exists": True}},
    {"cid": {"$exists": False}}, {"cid": ObjectId("6716b0f2a1b2c3d4e5f60718")}, {"cid": "abc"},
    {"n": {"$gt": 1}}, {"n": {"$gte": 2.5, "$lt": 10}}, {"when": {"$gte": datetime(2026, 3, 1)}},
    {"name": {"$regex": "^g", "$options": "i"}}, {"name": re.compile("ta$")},
    {"$or": [{"status": "failed"}, {"n": {"$lt": 0}}]}, {"$and": [{"status": "sent"}, {"n": {"$gt": 1}}]},
    {"_id": "settings"}, {"nested.k": "v"}, {"status": {"$exists": True, "$ne": None}},
]


@needs_pg
@pytest.mark.parametrize("filter_", FILTERS, ids=[str(f) for f in FILTERS])
def test_filter_translation_matches_mongo(store, coll_name, filter_):
    raw = mongomock.MongoClient().db
    raw[coll_name].insert_many([dict(d) for d in DOCS])
    store.upsert(coll_name, list(raw[coll_name].find()))
    expected = sorted(codec.id_key(d["_id"])[0] for d in raw[coll_name].find(filter_))
    got = sorted(codec.id_key(d["_id"])[0] for d in store.query_docs(coll_name, sqlfilter.where(filter_), []))
    assert got == expected


def test_untranslatable_filters_are_refused_not_guessed():
    for bad in ({"tags": {"$size": 2}}, {"$expr": {"$gt": ["$a", "$b"]}}, {"a": {"$elemMatch": {"b": 1}}},
                {"name": {"$regex": "x", "$options": "m"}}):
        with pytest.raises(sqlfilter.Unsupported):
            sqlfilter.where(bad)


def test_projection_matches_mongo_shapes():
    doc = {"_id": 1, "a": 1, "b": {"c": 2, "d": 3}, "e": 4}
    assert sqlfilter.apply_projection(doc, {"a": 1, "b.c": 1}) == {"_id": 1, "a": 1, "b": {"c": 2}}
    assert sqlfilter.apply_projection(doc, {"b.d": 0, "_id": 0}) == {"a": 1, "b": {"c": 2}, "e": 4}
    assert doc["b"] == {"c": 2, "d": 3}  # la proyección nunca modifica el original


# ── Modo dual: cada escritura de Mongo queda igual en Postgres ─────────────────
@needs_pg
def test_dual_mode_mirrors_every_kind_of_write(routed, coll_name, store):
    raw, db = routed("dual")
    col = db[coll_name]
    assert isinstance(col, routing.RoutedCollection)
    a = col.insert_one({"k": "a", "n": 1}).inserted_id
    col.insert_many([{"k": "b", "n": 2}, {"k": "c", "n": 3}, {"k": "d", "n": 4}])
    col.update_one({"k": "a"}, {"$set": {"n": 10}, "$push": {"log": "x"}})
    col.update_many({"n": {"$gte": 3}}, {"$inc": {"n": 100}})
    col.update_one({"k": "new"}, {"$setOnInsert": {"n": 0}}, upsert=True)
    col.replace_one({"_id": a}, {"k": "a", "replaced": True})
    col.find_one_and_update({"k": "b"}, {"$set": {"claimed": True}})
    col.find_one_and_update({"k": "upsert-fam"}, {"$set": {"x": 1}}, upsert=True)
    col.delete_one({"k": "c"})
    col.find_one_and_delete({"k": "d"})
    col.insert_one({"_id": "settings", "theme": "navy"})
    routing._runtime.worker.flush(10)

    result = reconcile(raw, store, coll_name)
    assert result["in_sync"], result
    assert result["mongo"] == raw[coll_name].count_documents({}) == 5


@needs_pg
def test_postgres_down_never_breaks_a_write(monkeypatch, coll_name):
    monkeypatch.setenv("POSTGRES_URL", "postgresql://nobody:x@127.0.0.1:1/none")
    monkeypatch.setenv(config.env_name(coll_name), "dual")
    routing._runtime = None
    raw = mongomock.MongoClient().db
    db = pgmirror.wrap_database(raw)
    try:
        db[coll_name].insert_one({"k": 1})
        db[coll_name].update_one({"k": 1}, {"$set": {"k": 2}})
        assert raw[coll_name].find_one({"k": 2})
        routing._runtime.worker.flush(30)
        assert coll_name in routing._runtime.worker.dirty
    finally:
        routing._runtime.store.close()
        routing._runtime = None


# ── Lecturas desde Postgres y comparación en sombra ─────────────────────────────
@needs_pg
def test_postgres_mode_reads_match_mongo(routed, coll_name):
    raw, db = routed("postgres")
    col = db[coll_name]
    base = datetime(2026, 10, 1)
    col.insert_many([{"i": i, "kind": "even" if i % 2 == 0 else "odd", "when": base + timedelta(days=i), "tags": [f"t{i % 3}"]}
                     for i in range(30)])
    routing._runtime.worker.flush(10)
    raw_col = raw[coll_name]

    def ids(cursor):
        return [d["_id"] for d in cursor]

    assert ids(col.find({"kind": "odd"}).sort("i", -1).skip(2).limit(5)) == ids(raw_col.find({"kind": "odd"}).sort("i", -1).skip(2).limit(5))
    assert col.find_one({"i": 7}, {"i": 1, "_id": 0}) == raw_col.find_one({"i": 7}, {"i": 1, "_id": 0})
    assert col.count_documents({"when": {"$gte": base + timedelta(days=10)}}) == raw_col.count_documents({"when": {"$gte": base + timedelta(days=10)}})
    assert sorted(col.distinct("tags")) == sorted(raw_col.distinct("tags"))
    assert col.estimated_document_count() == 30
    # Lo que no se puede traducir se resuelve en Mongo, con el mismo resultado.
    assert col.count_documents({"tags": {"$size": 1}}) == 30
    assert routing._runtime.stats[coll_name]["pg_fallback_count_documents"] == 1


@needs_pg
def test_shadow_mode_reports_a_divergence_and_still_answers_with_mongo(routed, coll_name, store):
    raw, db = routed("shadow")
    col = db[coll_name]
    _id = col.insert_one({"k": "v", "n": 1}).inserted_id
    routing._runtime.worker.flush(10)
    assert col.find_one({"_id": _id})["n"] == 1
    assert routing._runtime.stats[coll_name].get("shadow_ok") == 1
    # Alguien cambia la fila de Postgres a mano: la sombra lo detecta.
    store.upsert(coll_name, [{"_id": _id, "k": "v", "n": 999}])
    assert col.find_one({"_id": _id})["n"] == 1  # sigue respondiendo con Mongo
    assert routing._runtime.stats[coll_name]["shadow_diffs"] == 1
    assert col.count_documents({"k": "v"}) == 1


@needs_pg
def test_reconcile_fix_is_the_initial_load_and_is_idempotent(store, coll_name):
    raw = mongomock.MongoClient().db
    raw[coll_name].insert_many([{"i": i} for i in range(1200)])
    store.upsert(coll_name, [{"_id": "ghost", "x": 1}])
    first = reconcile(raw, store, coll_name, fix=True)
    assert first["copied"] == 1200 and first["deleted"] == 1
    again = reconcile(raw, store, coll_name)
    assert again["in_sync"] and again["mongo"] == 1200
