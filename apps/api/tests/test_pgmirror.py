"""Capa de migración Mongo → Postgres (app/pgmirror).

Mongo: mongomock (conftest.py). Postgres: uno REAL y desechable — el local de
migration/docker-compose.yml o el servicio de CI (TEST_POSTGRES_URL). Si no hay
Postgres disponible estas pruebas se saltan; nunca usan POSTGRES_URL de producción.

Los resultados "esperados" de las pruebas de semántica (rutas que cruzan arreglos,
null, orden, proyecciones) se midieron en Mongo 7 real; tests/test_pgmirror_vs_mongo.py
los vuelve a comparar contra el motor real cuando hay uno disponible.
"""
import json
import os
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import mongomock
import pytest
from bson import Binary, Int64, ObjectId
from psycopg import sql

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


@pytest.mark.parametrize("mode", ["postgres", "primary"])
def test_primary_never_falls_back_to_a_mongo_only_runtime(monkeypatch, mode):
    import mongomock.gridfs
    mongomock.gridfs.enable_gridfs_integration()
    raw = mongomock.MongoClient().db
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("DB_MODES", f"evaluaciones={mode},archivos={mode}")
    monkeypatch.setattr(routing, "get_runtime", lambda db: None)
    if mode == "primary":
        with pytest.raises(RuntimeError, match="refusing Mongo-only"):
            routing.route_collection(raw, "evaluaciones")
        with pytest.raises(RuntimeError, match="refusing GridFS-only"):
            pgmirror.wrap_gridfs(raw)
    else:
        assert routing.route_collection(raw, "evaluaciones") is raw["evaluaciones"]
        assert pgmirror.wrap_gridfs(raw).__class__.__name__ == "GridFS"


def test_ci_never_skips_the_real_engine_tests():
    """En CI (REQUIRE_REAL_ENGINES=1) Postgres y el Mongo 7 de pruebas tienen que estar: si no,
    las pruebas contra los motores reales se saltarían y CI saldría verde sin haberlas corrido."""
    if os.getenv("REQUIRE_REAL_ENGINES") != "1":
        pytest.skip("solo se exige en CI")
    import pymongo
    assert _pg_available(), "no hay Postgres de pruebas"
    client = pymongo.MongoClient(os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029"), serverSelectionTimeoutMS=5000)
    assert not type(client).__module__.startswith("mongomock"), "TEST_MONGO_URL debe ser el Mongo dedicado (puerto 27029)"
    assert client.admin.command("ping")["ok"] == 1


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
        routing.shadow_drain(5)
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


def test_int64_comes_back_as_int_with_the_same_hash():
    # fs.files.length es int64; el jsonb no guarda el ancho y para la app es el mismo número.
    doc = {"_id": 1, "length": Int64(5), "huge": Int64(2**40), "plain": 5}
    back = codec.decode_doc(codec.encode_doc(doc))
    assert back == doc and codec.doc_hash(back) == codec.doc_hash(doc)
    assert codec.doc_hash({"x": 5}) != codec.doc_hash({"x": 5.0})  # double sigue siendo distinto de int
    # El orden de las llaves cuenta (Mongo y la app lo conservan): un reordenamiento no se esconde.
    assert codec.doc_hash({"a": 1, "b": 2}) != codec.doc_hash({"b": 2, "a": 1})


@needs_pg
def test_documents_come_back_with_their_key_order(store, coll_name):
    # jsonb ordena las llaves a su manera (p. ej. un horario lunes…domingo saldría revuelto).
    doc = {"_id": 1, "zeta": 1, "hours": {"lunes": "9-18", "martes": "9-18", "miercoles": "9-14", "domingo": None}, "a": [{"y": 1, "b": 2}]}
    store.upsert(coll_name, [doc])
    back = store.query_docs(coll_name, sqlfilter.where({}))[0]
    assert list(back) == ["_id", "zeta", "hours", "a"]
    assert list(back["hours"]) == ["lunes", "martes", "miercoles", "domingo"] and list(back["a"][0]) == ["y", "b"]
    assert codec.doc_hash(back) == codec.doc_hash(doc)


def test_without_postgres_url_the_database_is_untouched(monkeypatch):
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    raw = mongomock.MongoClient().db
    assert pgmirror.wrap_database(raw) is raw
    assert config.collection_mode("anything") == "mongo"


def test_modes_come_from_one_variable_and_typos_never_activate_anything(monkeypatch):
    monkeypatch.setenv("POSTGRES_URL", "postgresql://x@127.0.0.1:1/x")
    monkeypatch.setenv("DB_MODES", " settings=dual, message_templates=DUAL,blacklist=shadow ,users=postgress,bad")
    assert config.collection_mode("settings") == "dual"
    assert config.collection_mode("message_templates") == "dual"
    assert config.collection_mode("blacklist") == "shadow"
    assert config.collection_mode("users") == "mongo"  # mal escrito → se queda en Mongo
    assert config.collection_mode("contacts") == "mongo"
    monkeypatch.setenv("DB_MODE_SETTINGS", "mongo")  # la variable por colección gana
    assert config.collection_mode("settings") == "mongo"
    monkeypatch.delenv("POSTGRES_URL")
    assert config.collection_mode("blacklist") == "mongo"


def test_compose_passes_the_migration_variables_to_the_backend():
    # El backend solo recibe las variables que lista docker-compose.yml: sin estas
    # líneas, ponerlas en Coolify no haría nada.
    import pathlib
    import yaml
    compose = yaml.safe_load((pathlib.Path(__file__).resolve().parents[3] / "docker-compose.yml").read_text(encoding="utf-8"))
    env = compose["services"]["backend"]["environment"]
    for name in ("POSTGRES_URL", "DB_MODES", "PGMIRROR_WAIT_HOURS", "PGMIRROR_RECONCILE_HOURS"):
        assert f"{name}=${{{name}:-}}" in env, name


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
    got = sorted(codec.id_key(d["_id"])[0] for d in store.query_docs(coll_name, sqlfilter.where(filter_)))
    assert got == expected


def test_untranslatable_filters_are_refused_not_guessed():
    for bad in ({"tags": {"$size": 2}}, {"$expr": {"$gt": ["$a", "$b"]}}, {"$expr": {"$lt": [{"$size": "$a"}, 2]}},
                {"a": {"$elemMatch": {"b": {"$gt": 1}}}}, {"a": {"$elemMatch": {"b": None}}}, {"a": {"$elemMatch": {"$gt": 1}}},
                {"name": {"$regex": "x", "$options": "m"}}, {"a.0.b": 1}, {"a": {"$not": re.compile("x")}},
                # Igualdad con subdocumento: Mongo compara el orden de las llaves, jsonb no.
                {"loc": {"city": "x", "state": "y"}}, {"loc": {"$in": [{"city": "x"}]}}, {"t": [{"a": 1}]},
                # Sintaxis que significa otra cosa en Postgres que en PCRE (Mongo):
                {"name": {"$regex": r"\bfoo"}}, {"name": {"$regex": r"\w+"}}, {"name": {"$regex": "(?i)x"}},
                {"name": {"$regex": "[^a]"}}, {"name": {"$regex": "[[:alpha:]]"}}, {"name": re.compile("x", re.M)}):
        with pytest.raises(sqlfilter.Unsupported):
            sqlfilter.where(bad)
    for bad_sort in ([("a", 2)], [("a.0", 1)], [("a", True)]):
        with pytest.raises(sqlfilter.Unsupported):
            sqlfilter.sort_plan(bad_sort)


# ── Semántica medida en Mongo 7 real (rutas por arreglos, null, orden, proyección) ──
EDGE = {
    1: {"a": {"b": 1}}, 2: {"a": {"b": None}}, 3: {"a": {}}, 4: {}, 5: {"a": [{"b": 1}, {"c": 2}]},
    6: {"a": [{"b": 1}]}, 7: {"a": [{"b": None}]}, 8: {"a": []}, 9: {"a": [1, 2]}, 10: {"a": 5},
    11: {"a": [{"b": [1, 2]}]}, 12: {"a": [[{"b": 1}]]}, 13: {"a": [{"b": 2}, {"b": 3}]}, 14: {"a": None},
    15: {"a": [{"b": [None]}]}, 16: {"a": {"b": [None, 1]}}, 17: {"a": {"b": []}}, 18: {"a": [{"b": 0}, 7]},
    20: {"a": [{"b": [{"c": 1}, {"c": 2}]}, {"b": {"c": 3}}]}, 21: {"a": {"b": [{"c": [1, 5]}]}},
    22: {"s": "ÑANDÚ Éxito"}, 23: {"s": "nandu exito"}, 24: {"s": ["x", "ÉXITO"]}, 25: {"a": [{"b": 1, "c": 9}, {"b": 2}], "z": 1},
}
_FIRST = [k for k in EDGE if k <= 18]
MONGO7_FILTERS = [
    ({"a.b": None}, [2, 3, 4, 5, 7, 10, 14, 15, 16], _FIRST),
    ({"a.b": {"$exists": True}}, [1, 2, 5, 6, 7, 11, 13, 15, 16, 17, 18], _FIRST),
    ({"a.b": {"$exists": False}}, [3, 4, 8, 9, 10, 12, 14], _FIRST),
    ({"a.b": {"$ne": None}}, [1, 6, 8, 9, 11, 12, 13, 17, 18], _FIRST),
    ({"a.b": 1}, [1, 5, 6, 11, 16], _FIRST),
    ({"a.b": {"$gt": 1}}, [11, 13], _FIRST),
    ({"a.b": {"$in": [None, 1]}}, [1, 2, 3, 4, 5, 6, 7, 10, 11, 14, 15, 16], _FIRST),
    ({"a": None}, [4, 14], _FIRST),
    ({"a": {"$gt": 1}}, [9, 10, 18], _FIRST),
    ({"a.b": []}, [17], _FIRST),
    ({"a": []}, [8], _FIRST),
    ({"a.b.c": 1}, [20, 21], [1, 2, 3, 4, 5, 8, 9, 10, 14, 20, 21, 22, 23, 24, 25]),
    ({"a.b.c": {"$gt": 2}}, [20, 21], [1, 2, 3, 4, 5, 8, 9, 10, 14, 20, 21, 22, 23, 24, 25]),
    ({"a.b.c": None}, [1, 2, 3, 4, 5, 10, 14, 22, 23, 24, 25], [1, 2, 3, 4, 5, 8, 9, 10, 14, 20, 21, 22, 23, 24, 25]),
    ({"a.b.c": {"$exists": True}}, [20, 21], [1, 2, 3, 4, 5, 8, 9, 10, 14, 20, 21, 22, 23, 24, 25]),
    ({"s": {"$regex": "ñandú éxito", "$options": "i"}}, [22], None),
    ({"s": re.compile("^éxito", re.I)}, [24], None),
    ({"s": {"$regex": "éxito$", "$options": "i"}}, [22, 24], None),
]


@pytest.fixture
def edge_store(store, coll_name):
    store.upsert(coll_name, [{"_id": k, **v} for k, v in EDGE.items()])
    return store, coll_name


def _ids(store, coll, filter_, among=None, sort=None):
    flt = filter_ if among is None else {"$and": [filter_, {"_id": {"$in": among}}]}
    plan = sqlfilter.sort_plan(sort) if sort else None
    return [d["_id"] for d in store.query_docs(coll, sqlfilter.where(flt), plan=plan)]


@needs_pg
@pytest.mark.parametrize("filter_,expected,among", MONGO7_FILTERS, ids=[repr(f[0]) for f in MONGO7_FILTERS])
def test_filters_follow_mongo7_through_arrays(edge_store, filter_, expected, among):
    store, coll = edge_store
    assert sorted(_ids(store, coll, filter_, among)) == expected


MONGO7_SORTS = [
    ("a.b", 1, _FIRST, [17, 2, 3, 4, 5, 7, 8, 9, 10, 12, 14, 15, 16, 18, 1, 6, 11, 13]),
    ("a.b", -1, _FIRST, [13, 11, 1, 5, 6, 16, 18, 2, 3, 4, 7, 8, 9, 10, 12, 14, 15, 17]),
    # Ordenar por un campo cuyo valor es objeto no se replica (orden de objetos BSON): solo escalares/arreglos.
    ("a", 1, [4, 8, 9, 10, 14], [8, 4, 14, 9, 10]),
    ("a", -1, [4, 8, 9, 10, 14], [10, 9, 4, 14, 8]),
]


@needs_pg
@pytest.mark.parametrize("field,direction,among,expected", MONGO7_SORTS, ids=[f"{s[0]} {s[1]}" for s in MONGO7_SORTS])
def test_sort_follows_mongo7(edge_store, field, direction, among, expected):
    store, coll = edge_store
    assert _ids(store, coll, {}, among, sort=[(field, direction), ("_id", 1)]) == expected


ABSENT = "<sin a>"
MONGO7_PROJECTIONS = [
    ({"a.b": 1}, {1: {"b": 1}, 2: {"b": None}, 3: {}, 4: ABSENT, 5: [{"b": 1}, {}], 8: [], 9: [], 10: ABSENT, 14: ABSENT,
                  11: [{"b": [1, 2]}], 12: [[{"b": 1}]], 18: [{"b": 0}], 20: [{"b": [{"c": 1}, {"c": 2}]}, {"b": {"c": 3}}],
                  25: [{"b": 1}, {"b": 2}]}),
    ({"a.b": 1, "a.c": 1}, {5: [{"b": 1}, {"c": 2}], 25: [{"b": 1, "c": 9}, {"b": 2}]}),
    ({"a.b.c": 1}, {20: [{"b": [{"c": 1}, {"c": 2}]}, {"b": {"c": 3}}], 21: {"b": [{"c": [1, 5]}]}}),
    ({"a.b": 0}, {3: {}, 8: [], 10: 5, 14: None, 25: [{"c": 9}, {}], 5: [{}, {"c": 2}], 9: [1, 2], 12: [[{}]], 18: [{}, 7]}),
    ({"a.b.c": 0}, {20: [{"b": [{}, {}]}, {"b": {}}], 21: {"b": [{}]}}),
]


@pytest.mark.parametrize("projection,expected", MONGO7_PROJECTIONS, ids=[repr(p[0]) for p in MONGO7_PROJECTIONS])
def test_projection_follows_mongo7(projection, expected):
    for _id, a in expected.items():
        out = sqlfilter.apply_projection({"_id": _id, **EDGE[_id]}, projection)
        assert out["_id"] == _id
        assert out.get("a", ABSENT) == a, _id


def test_projection_shapes_and_never_touches_the_original():
    doc = {"_id": 1, "a": 1, "b": {"c": 2, "d": 3}, "e": 4}
    assert sqlfilter.apply_projection(doc, {"a": 1, "b.c": 1}) == {"_id": 1, "a": 1, "b": {"c": 2}}
    assert sqlfilter.apply_projection(doc, {"b.d": 0, "_id": 0}) == {"a": 1, "b": {"c": 2}, "e": 4}
    assert sqlfilter.apply_projection(doc, {"_id": 1}) == {"_id": 1}
    assert sqlfilter.apply_projection(doc, {"_id": 0}) == {"a": 1, "b": {"c": 2, "d": 3}, "e": 4}
    assert doc["b"] == {"c": 2, "d": 3}  # la proyección nunca modifica el original
    for bad in ({"a": 1, "b": 0}, {"a": 1, "a.b": 1}, {"a": {"$elemMatch": {"x": 1}}}, {"numbers.$": 1}):
        with pytest.raises(sqlfilter.Unsupported):
            sqlfilter.apply_projection(doc, bad)


def test_distinct_values_walk_arrays_like_mongo():
    doc = {"a": [{"b": 1}, {"b": [2, 3]}, {"c": 4}, 5], "t": ["x", ["y"]], "n": None}
    assert sqlfilter.path_values(doc, "a.b") == [1, 2, 3]
    assert sqlfilter.path_values(doc, "t") == ["x", ["y"]]
    assert sqlfilter.path_values(doc, "n") == [None]
    assert sqlfilter.path_values(doc, "missing") == []
    assert sqlfilter.distinct_marker(1) == sqlfilter.distinct_marker(1.0)


@needs_pg
def test_search_text_with_percent_does_not_break_the_query(edge_store):
    store, coll = edge_store
    store.upsert(coll, [{"_id": 99, "s": "descuento 100% real"}])
    assert _ids(store, coll, {"s": {"$regex": re.escape("100%"), "$options": "i"}}) == [99]


@needs_pg
def test_without_sort_rows_come_back_in_insertion_order(store, coll_name):
    ids = [ObjectId() for _ in range(5)]
    for _id in (ids[3], ids[0], ids[4], ids[1], ids[2]):
        store.upsert(coll_name, [{"_id": _id, "k": 1}])
    store.upsert(coll_name, [{"_id": ids[3], "k": 2}])  # actualizar no cambia el orden (como Mongo/WiredTiger)
    assert [d["_id"] for d in store.query_docs(coll_name, sqlfilter.where({}))] == [ids[3], ids[0], ids[4], ids[1], ids[2]]


@needs_pg
def test_date_sort_key_is_the_exact_millisecond(store):
    """La llave de orden de una fecha (aritmética, sin ::timestamptz) = milisegundos desde 1970,
    como los guarda Mongo, en las dos formas de Extended JSON y con desfase horario."""
    from datetime import timezone
    store.ensure_functions()
    tz = timezone(timedelta(hours=-6))
    dates = [datetime(1900, 1, 1), datetime(1969, 12, 31, 23, 59, 59, 999000), datetime(1970, 1, 1),
             datetime(2000, 2, 29, 12), datetime(2000, 3, 1), datetime(2024, 2, 29, 23, 59, 59, 1000),
             datetime(2026, 10, 20, 12, 0, 0, 789000), datetime(2026, 1, 1, 0, 0, 0, 999),
             datetime(9999, 12, 31, 23, 59, 59, 999000), datetime(2026, 10, 20, 6, 30, tzinfo=tz),
             datetime(2026, 1, 1, 0, 0, 0, 5000, tzinfo=timezone(timedelta(hours=5, minutes=30)))]
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    for d in dates:
        aware = d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        expected = (aware - epoch) // timedelta(milliseconds=1)
        encoded = json.dumps(codec.encode_value(d))
        got = store.query("SELECT (mongo.sortkey_v1_of(%s::jsonb)).n", (encoded,))[0][0]
        assert got == expected, (d, encoded)
    # Desfase con dos puntos y fracción de otro largo (no lo produce el codec, pero es ISO válido).
    assert store.query("""SELECT (mongo.sortkey_v1_of('{"$date": "1970-01-01T05:30:00.5+05:30"}'::jsonb)).n""")[0][0] == Decimal("500")


@needs_pg
def test_sort_key_never_fails(store):
    """La llave va en índices: si fallara con algún valor, esa fila no se podría escribir en el espejo."""
    store.ensure_functions()
    odd = ['{"$date": "basura"}', '{"$date": "2026-13-45T99:99:99Z"}', '{"$date": {"$numberLong": "x"}}',
           '{"$date": {"$numberLong": "' + "9" * 400 + '"}}', '{"$numberDecimal": "1e999999"}', '{"$numberDecimal": "NaN"}',
           '{"$numberDecimal": "-Infinity"}', '{"$numberDecimal": "' + "1" * 5000 + '"}', '{"$numberDouble": "NaN"}',
           '{"$numberLong": "12"}', '{"$oid": 5}', '{"$binary": {"base64": "", "subType": "00"}}', '{"$emptyArray": 1}',
           '[]', '[[1]]', '{"a": {"b": []}}', '"\\u00f1"', 'true', 'null']
    for value in odd:
        store.query("SELECT mongo.sortkey_v1_of(%s::jsonb), mongo.sortkey_v1_pick(jsonb_build_object('a', %s::jsonb), '{a,b}', -1)",
                    (value, value))
    # NaN ordena junto con -Infinity, antes que cualquier otro número (como Mongo).
    nan, minus_inf, one = (store.query("SELECT mongo.sortkey_v1_of(%s::jsonb)::text", (v,))[0][0]
                           for v in ('{"$numberDecimal": "NaN"}', '{"$numberDouble": "-Infinity"}', '1'))
    assert nan == minus_inf and store.query("SELECT %s::mongo.sortkey_v1 < %s::mongo.sortkey_v1", (nan, one))[0][0]


@needs_pg
def test_sort_index_serves_the_order_and_date_ranges(store, coll_name):
    from app.pgmirror.store import sort_index_name
    base = datetime(2026, 10, 1)
    docs = [{"_id": i, "created_at": base + timedelta(minutes=(i * 37) % 3000), "k": i % 3} for i in range(3000)]
    docs[5]["created_at"] = None
    del docs[6]["created_at"]
    store.upsert(coll_name, docs)
    for direction in (-1, 1):
        assert store.ensure_sort_index(coll_name, "created_at", direction)
        assert store.ensure_sort_index(coll_name, "created_at", direction)  # ya listo: no hace nada
    names = {row[0] for row in store.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'mongo' AND tablename = %s", (coll_name,))}
    assert {sort_index_name(coll_name, "created_at", d) for d in (-1, 1)} <= names

    def plan(filter_, sort, limit):
        query = (sql.SQL("EXPLAIN SELECT id FROM {} WHERE ").format(store.table(coll_name)) + sqlfilter.where(filter_)
                 + sql.SQL(" ORDER BY ") + sqlfilter.sort_plan(sort).order + sql.SQL(" LIMIT {}").format(sql.Literal(limit)))
        return "\n".join(row[0] for row in store.query(query))

    assert sort_index_name(coll_name, "created_at", -1) in plan({}, [("created_at", -1)], 1)
    assert sort_index_name(coll_name, "created_at", 1) in plan({}, [("created_at", 1)], 1)
    since = base + timedelta(minutes=2990)
    assert "Index Cond" in plan({"created_at": {"$gte": since}}, [("created_at", -1)], 50)
    # Con índice el resultado es el mismo que el de Mongo: fecha desc; null/faltante al final; empates por inserción.
    by_date = sorted((d for d in docs if d.get("created_at")), key=lambda d: d["created_at"], reverse=True)
    assert [d["_id"] for d in store.query_docs(coll_name, sqlfilter.where({}), plan=sqlfilter.sort_plan([("created_at", -1)]), limit=3)] == \
           [d["_id"] for d in by_date[:3]]
    assert [d["_id"] for d in store.query_docs(coll_name, sqlfilter.where({}), plan=sqlfilter.sort_plan([("created_at", 1)]), limit=2)] == [5, 6]
    assert sorted(d["_id"] for d in store.query_docs(coll_name, sqlfilter.where({"created_at": {"$gte": since}}))) == \
           sorted(d["_id"] for d in docs if d.get("created_at") and d["created_at"] >= since)


@needs_pg
def test_doc_is_stored_uncompressed_without_changing_anything(store, coll_name):
    # ~1.3 KB por documento: con doc y src en la misma fila pasaban de 2 KB y Postgres comprimía doc.
    store.upsert(coll_name, [{"_id": i, "texto": f"mensaje {i} " * 110, "n": i} for i in range(40)])
    table = store.table(coll_name)

    def compressed():
        return store.query(sql.SQL("SELECT count(*) FILTER (WHERE pg_column_compression(doc) IS NOT NULL) FROM {}").format(table))[0][0]
    before, hashes = store.query_docs(coll_name, sqlfilter.where({})), store.hashes(coll_name)
    assert compressed() > 0
    assert store.ensure_doc_storage(coll_name)
    assert compressed() == 0
    assert store.query_docs(coll_name, sqlfilter.where({})) == before  # mismos documentos, mismo orden de inserción
    assert store.hashes(coll_name) == hashes
    assert store.ensure_doc_storage(coll_name)  # ya listo: no hace nada
    store.upsert(coll_name, [{"_id": 99, "texto": "nuevo " * 220}])
    assert compressed() == 0  # lo nuevo ya entra sin comprimir
    store.query("DELETE FROM mongo._storage WHERE collection = %s", (coll_name,))


@needs_pg
def test_equality_on_a_field_can_use_the_gin_index(store, coll_name):
    import psycopg
    store.upsert(coll_name, [{"_id": i, "company_id": f"c{i % 50}", "tags": [f"c{i % 7}"]} for i in range(2000)])
    query = sql.SQL("EXPLAIN SELECT id FROM {} WHERE ").format(store.table(coll_name)) + sqlfilter.where({"company_id": "c7"})
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        conn.execute("SET enable_seqscan = off")
        assert "__doc_gin" in "\n".join(row[0] for row in conn.execute(query).fetchall())
    assert len(store.query_docs(coll_name, sqlfilter.where({"company_id": "c7"}))) == 40
    assert len(store.query_docs(coll_name, sqlfilter.where({"tags": "c3"}))) == len([i for i in range(2000) if i % 7 == 3])


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
    # Sin sort: orden de inserción, como el orden natural de Mongo.
    assert ids(col.find({"kind": "even"}).limit(4)) == ids(raw_col.find({"kind": "even"}).limit(4))
    # Se usa como un cursor de pymongo.
    cursor = col.find({"i": {"$lt": 3}}).sort("i", 1)
    assert next(cursor)["i"] == 0 and [d["i"] for d in cursor] == [1, 2]
    assert [d["i"] for d in cursor.rewind()] == [0, 1, 2] and [d["i"] for d in cursor.clone()] == [0, 1, 2]
    # Lo que no se puede traducir se resuelve en Mongo, con el mismo resultado.
    assert col.count_documents({"tags": {"$size": 1}}) == 30
    assert routing._runtime.stats[coll_name]["pg_fallback_count_documents"] == 1
    # distinct con documentos sin el campo: Mongo devuelve null o no según use un índice;
    # no se adivina (send_now_worker dependía de ese null para la partición legacy).
    col.insert_one({"kind": "odd"})
    routing._runtime.worker.flush(10)
    assert sorted(col.distinct("tags"), key=str) == sorted(raw_col.distinct("tags"), key=str)
    assert routing._runtime.stats[coll_name]["pg_fallback_distinct"] == 1


@needs_pg
def test_postgres_error_in_the_middle_of_a_cursor_falls_back_to_mongo(routed, coll_name, monkeypatch):
    raw, db = routed("postgres")
    col = db[coll_name]
    col.insert_many([{"i": i} for i in range(5)])
    routing._runtime.worker.flush(10)
    cursor = col.find({"i": {"$gte": 2}}).sort("i", 1)

    def broken(*_a, **_k):
        raise RuntimeError("postgres se cayó")
    monkeypatch.setattr(routing._runtime.store, "query_docs", broken)
    assert [d["i"] for d in cursor] == [2, 3, 4]
    assert col.find_one({"i": 4})["i"] == 4
    assert routing._runtime.stats[coll_name]["pg_fallback_find"] == 1


@needs_pg
def test_shadow_mode_reports_a_divergence_and_still_answers_with_mongo(routed, coll_name, store):
    raw, db = routed("shadow")
    col = db[coll_name]
    _id = col.insert_one({"k": "v", "n": 1}).inserted_id
    routing._runtime.worker.flush(10)
    assert col.find_one({"_id": _id})["n"] == 1
    assert routing.shadow_drain()
    assert routing._runtime.stats[coll_name].get("shadow_ok") == 1
    # Alguien cambia la fila de Postgres a mano: la sombra lo detecta (también en find).
    store.upsert(coll_name, [{"_id": _id, "k": "v", "n": 999}])
    assert col.find_one({"_id": _id})["n"] == 1  # sigue respondiendo con Mongo
    assert [d["n"] for d in col.find({"k": "v"})] == [1]
    assert col.count_documents({"k": "v"}) == 1
    assert routing.shadow_drain()
    assert routing._runtime.stats[coll_name]["shadow_diffs"] == 2


@needs_pg
def test_shadow_compares_in_the_background_and_tolerates_ties(routed, coll_name):
    raw, db = routed("shadow")
    col = db[coll_name]
    col.insert_many([{"g": i % 2, "i": i} for i in range(10)])
    routing._runtime.worker.flush(10)
    docs = list(col.find({}).sort("g", 1).limit(3))  # empate en g=0: cualquier orden dentro del empate vale
    for d in docs:
        d.clear()  # la app modifica lo que recibe: la comparación usa una copia tomada antes
    assert routing.shadow_drain()
    stats = routing._runtime.stats[coll_name]
    assert stats.get("shadow_diffs", 0) == 0 and stats.get("shadow_ok") == 1


@needs_pg
def test_shadow_does_not_flag_a_write_made_right_after_the_read(routed, coll_name, monkeypatch, store):
    # Prod 2026-10-20: reserve_verification_slot lee el contador y enseguida hace $inc. Cuando
    # la sombra comparaba, Postgres ya traía el valor nuevo y la foto de Mongo era la de antes:
    # 245 "diferencias" con Postgres idéntico a Mongo. Se reproduce reteniendo las comparaciones.
    raw, db = routed("shadow")
    col = db[coll_name]
    col.insert_one({"_id": "verification:2026-10-20:gely", "instance": "gely", "date": "2026-10-20", "count": 0})
    routing._runtime.worker.flush(10)
    retenidas = []
    monkeypatch.setattr(routing._runtime.shadow, "submit", lambda fn: retenidas.append(fn) or True)
    for _ in range(3):
        col.find_one({"instance": "gely", "date": "2026-10-20"}, sort=[("count", -1)])
        list(col.find({"instance": "gely"}))
        col.count_documents({"count": {"$lt": 2}})
        col.distinct("count")
        col.find_one_and_update({"_id": "verification:2026-10-20:gely", "count": {"$lt": 10}}, {"$inc": {"count": 1}})
    routing._runtime.worker.flush(10)  # Postgres ya tiene count=3; las fotos de Mongo dicen 0, 1 y 2
    for fn in retenidas:
        fn()
    stats = routing._runtime.stats[coll_name]
    assert stats.get("shadow_diffs", 0) == 0, stats
    # 11 necesitaron releer Mongo; la 3.ª count_documents ($lt 2 con count=2) ya cuadraba: 0 y 0.
    assert stats["shadow_ok"] == 12 and stats["shadow_raced"] == 11

    # Una diferencia de verdad (Postgres distinto de Mongo, aun leyendo Mongo otra vez) se sigue reportando.
    store.upsert(coll_name, [{"_id": "verification:2026-10-20:gely", "instance": "gely", "date": "2026-10-20", "count": 99}])
    retenidas.clear()
    col.find_one({"instance": "gely", "date": "2026-10-20"}, sort=[("count", -1)])
    col.count_documents({"count": 3})
    for fn in retenidas:
        fn()
    assert routing._runtime.stats[coll_name]["shadow_diffs"] == 2


@needs_pg
def test_reconcile_fix_is_the_initial_load_and_is_idempotent(store, coll_name):
    raw = mongomock.MongoClient().db
    raw[coll_name].insert_many([{"i": i} for i in range(1200)])
    store.upsert(coll_name, [{"_id": "ghost", "x": 1}])
    first = reconcile(raw, store, coll_name, fix=True)
    assert first["copied"] == 1200 and first["deleted"] == 1
    again = reconcile(raw, store, coll_name)
    assert again["in_sync"] and again["mongo"] == 1200


def test_write_shadow_comparator_on_leases():
    """Medido en prod (2026-10-22) con los leases de envío y calentamiento: tomarlos casi nunca encuentra
    documento (siguen vigentes), y otro proceso los renueva a cada rato. Nada de eso es una diferencia."""
    from app.pgmirror import sombra_escrituras as sombra
    lease = {"_id": "singleton", "holder": "a", "expires_at": datetime(2026, 10, 22, 0, 14, 3, 289000)}
    tomar = {"_id": "singleton", "expires_at": {"$lte": datetime(2026, 10, 22, 0, 18, 45)}}
    assert sombra.comparar("update_one", tomar, {"$set": {"holder": "b"}}, {}, {}, modificados=0)[0] == "escritura_sin_candidatos"
    assert sombra.comparar("update_one", tomar, {"$set": {"holder": "b"}}, {}, {"singleton": lease}, modificados=1)[0] == "escritura_carrera"
    renovado = {**lease, "expires_at": datetime(2026, 10, 22, 0, 14, 3, 335000)}
    crear = {"$setOnInsert": {"holder": None, "expires_at": datetime(1, 1, 1)}}
    assert sombra.comparar("update_one", {"_id": "singleton"}, crear, {"singleton": lease}, {"singleton": renovado},
                           modificados=0)[0] == "escritura_carrera"
    assert sombra.comparar("update_one", {"_id": "singleton"}, crear, {"singleton": lease}, {"singleton": lease},
                           modificados=0)[0] == "escritura_ok"
    # Puso holder "b" y quedó "c": lo escribió otro proceso después (carrera).
    assert sombra.comparar("update_one", {"_id": "singleton"}, {"$set": {"holder": "b"}}, {"singleton": lease},
                           {"singleton": {**lease, "holder": "c"}}, modificados=1)[0] == "escritura_carrera"
    assert sombra.comparar("update_one", {"_id": "singleton"}, {"$set": {"holder": "b"}}, {"singleton": lease},
                           {"singleton": lease}, modificados=0)[0] == "escritura_dif"


def test_write_shadow_comparator_spots_a_later_writer():
    """Prod 2026-10-22: dos procesos guardan el mismo documento con ms de diferencia. Lo que esta escritura
    puso ($set) o quitó ($unset) y en Mongo quedó distinto lo cambió otro proceso: carrera, no diferencia."""
    from app.pgmirror import sombra_escrituras as sombra
    saldo = {"_id": "balance", "amount": 49.9, "checked_at": datetime(2026, 10, 22, 1, 51, 28, 100000)}
    escritura = {"$set": {"amount": 49.9, "checked_at": datetime(2026, 10, 22, 1, 51, 28, 591254)}}
    otro = {**saldo, "checked_at": datetime(2026, 10, 22, 1, 51, 28, 595000)}
    assert sombra.comparar("update_one", {"_id": "balance"}, escritura, {"balance": saldo}, {"balance": otro},
                           modificados=1)[0] == "escritura_carrera"
    proxies = {"_id": "proxies", "migrating_since": datetime(2026, 10, 22, 1, 0)}
    de_nuevo = {**proxies, "migrating_since": datetime(2026, 10, 22, 2, 1, 57, 179000)}
    assert sombra.comparar("update_one", {"_id": "proxies"}, {"$unset": {"migrating_since": ""}}, {"proxies": proxies},
                           {"proxies": de_nuevo}, modificados=1)[0] == "escritura_carrera"
    # Si lo que esta escritura puso sí quedó, pero el motor calcula otra cosa, es una diferencia de verdad.
    assert sombra.comparar("update_one", {"_id": "balance"}, {"$set": {"amount": 1}, "$inc": {"n": 1}},
                           {"balance": saldo}, {"balance": {**saldo, "amount": 1, "n": 2}}, modificados=1)[0] == "escritura_dif"

