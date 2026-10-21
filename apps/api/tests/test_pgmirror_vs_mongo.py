"""La capa contra Mongo 7 REAL: filtros, orden, proyecciones, distinct y el modo
shadow deben dar exactamente lo mismo que el motor, con documentos de formas difíciles
(tipos mezclados, arreglos de objetos, arreglos vacíos, null, acentos, saltos de línea…).

Necesita el Mongo dedicado de pruebas (127.0.0.1:27029: migration/docker-compose.yml o el
servicio de CI) y el Postgres de pruebas. Si falta alguno, se salta.
"""
import os
import random
import re
import uuid
from datetime import datetime

import pymongo
import pytest
from bson import ObjectId

from app import pgmirror
from app.pgmirror import codec, config, routing, sqlfilter

TEST_MONGO = os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029")
TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _engines_available():
    try:
        import psycopg
        psycopg.connect(TEST_PG, connect_timeout=2).close()
        client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=1500)
        # conftest.py convierte cualquier otro host en mongomock: aquí solo vale el real.
        if type(client).__module__.startswith("mongomock"):
            return False
        client.admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _engines_available(), reason="sin Mongo real de pruebas (27029) o sin Postgres de pruebas")

WORDS = ["Ñandú", "ñandú", "ÉXITO", "éxito", "Exito", "alpha", "Alpha", "beta\nline", "zeta", "", "100%",
         "a.b", "über", "Z", "a", "ab", "aB"]


def _oid(r):
    return ObjectId(bytes(r.getrandbits(8) for _ in range(12)))


def _scalar(r):
    return r.choice([
        None, 0, 1, -3, 2.5, 1.0, 10**12, True, False, r.choice(WORDS), r.choice(WORDS),
        datetime(2026, r.randint(1, 12), r.randint(1, 28), r.randint(0, 23), r.randint(0, 59), 0, r.choice([0, 123000])),
        _oid(r), FIXED_OID, str(FIXED_OID),
    ])


FIXED_OID = ObjectId("6716b0f2a1b2c3d4e5f60718")


def _deep(r, depth=0):
    roll = r.random()
    if depth < 3 and roll < 0.25:
        return {k: _deep(r, depth + 1) for k in r.sample(["b", "c"], r.randint(0, 2))}
    if depth < 3 and roll < 0.5:
        return [(_deep(r, depth + 1) if r.random() < 0.5 else _scalar(r)) for _ in range(r.randint(0, 3))]
    return _scalar(r)


def _keyed(r):
    """Formas para ordenar por k.v: llaves siempre escalares (el orden de objetos BSON no se replica)."""
    return r.choice([
        {"v": _scalar(r)}, {}, [], None, 5, [{"v": _scalar(r)}, {"w": 1}], [{"v": _scalar(r)}, 7],
        [[{"v": 1}]], {"v": [_scalar(r), _scalar(r)]}, [{"v": []}], {"v": []},
    ])


def make_docs(n=400, seed=11):
    r = random.Random(seed)
    docs = []
    for i in range(n):
        doc = {"_id": i}
        gens = {
            "n": lambda: r.choice([r.randint(-5, 5), r.random() * 10, None, [r.randint(0, 9), r.randint(0, 9)], [], "7"]),
            "s": lambda: r.choice([r.choice(WORDS), [r.choice(WORDS), r.choice(WORDS)], None, 3]),
            "d": lambda: r.choice([_scalar(r), datetime(2026, 10, 19, 12, 0, 0, r.choice([0, 1000, 999000]))]),
            "o": lambda: r.choice([FIXED_OID, str(FIXED_OID), _oid(r), None, [FIXED_OID, "x"]]),
            "mix": lambda: r.choice([_scalar(r), [_scalar(r), _scalar(r)], []]),
            "k": lambda: _keyed(r),
            "a": lambda: _deep(r),
            "tags": lambda: [r.choice(WORDS) for _ in range(r.randint(0, 3))],
        }
        for field, gen in gens.items():
            if r.random() < 0.85:
                doc[field] = gen()
        docs.append(doc)
    return docs


@pytest.fixture(scope="module")
def engines():
    from app.pgmirror.store import Store
    client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=3000)
    db_name = f"pgmirror_diff_{uuid.uuid4().hex[:8]}"
    mongo = client[db_name]["c"]
    store = Store(TEST_PG, statement_timeout_ms=60000)
    table = f"diff_{uuid.uuid4().hex[:8]}"
    docs = make_docs()
    mongo.insert_many(docs)
    store.upsert(table, list(mongo.find()))  # orden natural, como la carga inicial
    yield mongo, store, table, docs
    import psycopg
    from psycopg import sql
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", table)))
    store.close()
    client.drop_database(db_name)


def _values(docs):
    out = []

    def walk(v):
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        else:
            out.append(v)
    for d in docs:
        walk({k: v for k, v in d.items() if k != "_id"})
    return out


FIELDS = ["n", "s", "d", "o", "mix", "k", "k.v", "a", "a.b", "a.c", "a.b.c", "a.b.b", "tags"]


def _filters(docs):
    r = random.Random(5)
    pool = _values(docs)
    out = []
    for f in FIELDS:
        out += [{f: None}, {f: {"$ne": None}}, {f: {"$exists": True}}, {f: {"$exists": False}}, {f: []}]
        for v in r.sample(pool, 10):
            other = r.choice(pool)
            out += [{f: v}, {f: {"$ne": v}}, {f: {"$in": [v, other]}}, {f: {"$nin": [v, None]}}]
            if isinstance(v, (int, float, str, datetime, ObjectId)) and not isinstance(v, bool):
                out += [{f: {"$gt": v}}, {f: {"$lte": v}}, {f: {"$gte": v, "$lt": other}}]
            if isinstance(v, str) and v:
                out += [{f: {"$regex": "^" + re.escape(v[:2]), "$options": "i"}}, {f: {"$regex": re.escape(v[-2:]) + "$"}},
                        {f: re.compile(re.escape(v[:1]), re.I)}]
        out += [{f: {"$regex": "a.b"}}, {f: {"$regex": "^$"}}, {f: {"$in": [re.compile("^z", re.I), None]}}]
    out += [{"$or": [{"n": {"$gt": 2}}, {"s": None}]}, {"$and": [{"a.b": {"$exists": True}}, {"tags": "zeta"}]},
            {"$nor": [{"mix": None}, {"k.v": 1}]}, {"o": {"$in": [FIXED_OID, str(FIXED_OID)]}},
            {"_id": {"$in": [1, 2, 300]}}, {"_id": {"$gt": 390}}]
    return out


def _mongo_ids(mongo, flt):
    return sorted(d["_id"] for d in mongo.find(flt, {"_id": 1}))


def test_filters_match_real_mongo(engines):
    mongo, store, table, docs = engines
    mismatches, compared = [], 0
    for flt in _filters(docs):
        try:
            where = sqlfilter.where(flt)
        except sqlfilter.Unsupported:
            continue
        compared += 1
        got = sorted(d["_id"] for d in store.query_docs(table, where))
        expected = _mongo_ids(mongo, flt)
        if got != expected:
            mismatches.append(f"{flt!r}: mongo={len(expected)} pg={len(got)} solo_pg={sorted(set(got) - set(expected))[:5]} "
                              f"solo_mongo={sorted(set(expected) - set(got))[:5]}")
    assert compared > 600
    assert not mismatches, "\n".join(mismatches[:20])


def test_long_in_lists_match_real_mongo(engines):
    """$in/$nin de más de 20 textos o números: se resuelve leyendo el campo una vez y buscando en la lista
    con hash (contacts de 100 empresas tardaba 210 ms); debe dar lo mismo que Mongo, arreglos incluidos."""
    mongo, store, table, docs = engines
    r = random.Random(9)
    pool = [v for v in _values(docs) if isinstance(v, (str, int, float, ObjectId, datetime))]  # company_id mezcla texto y ObjectId
    compared = 0
    for field in ["n", "s", "mix", "tags", "o", "k", "a"]:
        for op in ("$in", "$nin"):
            values = r.sample(pool, 30) + [1, 1.0, "zeta", 10**12, FIXED_OID, str(FIXED_OID)]
            flt = {field: {op: values}}
            got = sorted(d["_id"] for d in store.query_docs(table, sqlfilter.where(flt)))
            assert got == _mongo_ids(mongo, flt), flt
            compared += 1
    assert "= ANY(" in sqlfilter.where({"s": {"$in": pool[:25]}}).as_string(None)
    assert "= ANY(" not in sqlfilter.where({"s": {"$in": pool[:5]}}).as_string(None)  # corta: índice GIN
    assert compared == 14


SORT_FIELDS = ["n", "s", "d", "o", "mix", "k.v", "tags", "_id"]


@pytest.mark.parametrize("field", SORT_FIELDS)
@pytest.mark.parametrize("direction", [1, -1])
def test_sort_matches_real_mongo(engines, field, direction):
    mongo, store, table, _docs = engines
    sort = [(field, direction)] + ([("_id", 1)] if field != "_id" else [])  # _id desempata
    expected = [d["_id"] for d in mongo.find({}, {"_id": 1}).sort(sort)]
    got = [d["_id"] for d in store.query_docs(table, sqlfilter.where({}), plan=sqlfilter.sort_plan(sort))]
    assert got == expected


def test_natural_order_and_skip_limit_match_real_mongo(engines):
    mongo, store, table, _docs = engines
    assert [d["_id"] for d in store.query_docs(table, sqlfilter.where({"n": {"$gt": 0}}), limit=25, skip=5)] == \
           [d["_id"] for d in mongo.find({"n": {"$gt": 0}}, {"_id": 1}).skip(5).limit(25)]


PROJECTIONS = [{"a.b": 1}, {"a.b": 0}, {"a.b.c": 1}, {"a.b": 1, "a.c": 1}, {"a": 1, "_id": 0}, {"_id": 1}, {"_id": 0},
               {"k.v": 1}, {"tags": 1, "n": 1}, {"a.b.b": 0}, {"mix": 0, "a.c": 0}, {"a.b.c": 0, "_id": 0},
               # $slice (sesiones de calentamiento: el último mensaje)
               {"tags": {"$slice": -1}, "n": 1}, {"tags": {"$slice": 2}}, {"tags": {"$slice": [1, 1]}, "s": 1},
               {"mix": {"$slice": [-2, 1]}, "_id": 0, "n": 1}, {"tags": {"$slice": 0}, "_id": 0}]


@pytest.mark.parametrize("projection", PROJECTIONS, ids=[repr(p) for p in PROJECTIONS])
def test_projection_matches_real_mongo(engines, projection):
    mongo, store, table, _docs = engines
    expected = list(mongo.find({}, projection).sort("_id", 1))
    got = [sqlfilter.apply_projection(d, projection)
           for d in store.query_docs(table, sqlfilter.where({}), plan=sqlfilter.sort_plan([("_id", 1)]))]
    assert len(got) == len(expected)
    bad = [i for i, (g, e) in enumerate(zip(got, expected)) if g != e or codec.doc_hash(g) != codec.doc_hash(e)]
    assert not bad, f"{len(bad)} distintos; primero: mongo={expected[bad[0]]!r} pg={got[bad[0]]!r}"


@pytest.mark.parametrize("field", ["n", "s", "mix", "o", "a.b", "a.b.c", "k.v", "tags", "d"])
def test_distinct_matches_real_mongo(engines, field):
    mongo, store, table, _docs = engines
    expected = sorted(map(repr, {sqlfilter.distinct_marker(v) for v in mongo.distinct(field)}))
    seen = set()
    for doc in store.query_docs(table, sqlfilter.where({})):
        for v in sqlfilter.path_values(doc, field):
            seen.add(sqlfilter.distinct_marker(v))
    assert sorted(map(repr, seen)) == expected


@pytest.mark.parametrize("field", ["n", "s", "mix", "o", "tags", "d"])
def test_distinct_in_sql_matches_real_mongo(engines, field):
    """El distinct que calcula Postgres (campo de primer nivel, sin traer los documentos)."""
    mongo, store, table, _docs = engines
    flt = {field: {"$exists": True, "$ne": []}}
    texts = store.distinct_values(table, field, sqlfilter.where(flt))
    assert texts is not None
    got = [codec.decode_value(t) for t in texts]
    assert len(got) == len({sqlfilter.distinct_marker(v) for v in got})  # sin repetidos
    assert sorted(map(repr, {sqlfilter.distinct_marker(v) for v in got})) == \
           sorted(map(repr, {sqlfilter.distinct_marker(v) for v in mongo.distinct(field, flt)}))
    # Si algún documento no aporta valores (sin el campo o []), no se adivina.
    assert store.distinct_values(table, field, sqlfilter.where({})) is None


def test_routed_collection_against_real_mongo(engines, monkeypatch):
    """La capa completa sobre un Mongo real: postgres responde igual, shadow no ve diferencias."""
    mongo, _store, _table, _docs = engines
    raw_db = mongo.database
    name = mongo.name
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    routing._runtime = None
    try:
        for mode in ("postgres", "shadow"):
            monkeypatch.setenv(config.env_name(name), mode)
            db = pgmirror.wrap_database(raw_db)
            coll = db[name]
            assert isinstance(coll, routing.RoutedCollection)
            from app.pgmirror.reconcile import reconcile
            assert reconcile(raw_db, routing._runtime.store, name, fix=True)["mongo"] == len(_docs)
            checks = [
                lambda c: [d["_id"] for d in c.find({"n": {"$gte": 1}}).sort([("d", -1), ("_id", 1)]).skip(3).limit(20)],
                lambda c: [d for d in c.find({"a.b": {"$exists": True}}, {"a.b": 1}).sort("_id", 1)],
                lambda c: c.find_one({"tags": "zeta"}, sort=[("_id", -1)]),
                lambda c: c.find_one({"s": {"$regex": "^ñ", "$options": "i"}}),
                lambda c: c.count_documents({"mix": None}),
                lambda c: sorted(map(repr, {sqlfilter.distinct_marker(v) for v in c.distinct("k.v", {"n": {"$ne": None}})})),
                lambda c: sorted(map(repr, {sqlfilter.distinct_marker(v) for v in c.distinct("s", {"s": {"$exists": True}})})),
                lambda c: [d["_id"] for d in c.find({"o": FIXED_OID}).limit(7)],
            ]
            for check in checks:
                assert check(coll) == check(mongo)
            if mode == "shadow":
                assert routing.shadow_drain(30)
                stats = routing._runtime.stats.get(name, {})
                assert stats.get("shadow_diffs", 0) == 0, stats
                assert stats.get("shadow_ok", 0) >= 6, stats
    finally:
        if routing._runtime is not None:
            import psycopg
            from psycopg import sql
            with psycopg.connect(TEST_PG, autocommit=True) as conn:
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", name)))
            routing._runtime.store.close()
        routing._runtime = None


def test_write_shadow_matches_real_mongo(engines, monkeypatch):
    """Sombra de escrituras: cada update por la capa (modo postgres) se calcula también con el motor y se
    compara contra lo que dejó Mongo. Con escrituras como las de la app: 0 diferencias; y si el motor se
    equivocara, la diferencia queda registrada."""
    from datetime import datetime as _dt
    from pymongo import ReturnDocument
    from app.pgmirror import actualizar
    mongo, _store, _table, _docs = engines
    raw_db = mongo.database
    name = f"sombra_{uuid.uuid4().hex[:6]}"
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("PGMIRROR_WRITE_SHADOW", "1")
    monkeypatch.setenv(config.env_name(name), "postgres")
    routing._runtime = None
    try:
        db = pgmirror.wrap_database(raw_db)
        c = db[name]
        c.insert_many([{"_id": i, "instance": "gely-wa", "date": "2026-10-21", "recipients": ["a"], "n": i, "tags": []} for i in range(20)])
        c.update_one({"_id": 1}, {"$addToSet": {"recipients": "b"}, "$set": {"updated_at": _dt(2026, 10, 21, 12, 0, 0, 123456)}})
        c.update_one({"_id": 1}, {"$addToSet": {"recipients": "b"}})  # no-op
        c.update_one({"_id": 2}, {"$pull": {"recipients": {"$in": ["a"]}}, "$inc": {"n": 5}})
        c.update_many({"n": {"$gte": 15}}, {"$push": {"tags": {"$each": ["x", "y"], "$slice": -1}}, "$unset": {"date": ""}})
        c.update_one({"instance": "otra", "date": "2026-10-22"}, {"$setOnInsert": {"recipients": []}, "$inc": {"count": 1}}, upsert=True)
        c.find_one_and_update({"_id": 3}, {"$max": {"seen": _dt(2026, 10, 21)}})
        c.find_one_and_update({"n": {"$lt": 5}}, {"$set": {"claimed": True}}, sort=[("n", -1)], return_document=ReturnDocument.AFTER)
        c.update_one({"_id": 4}, {"$rename": {"n": "m"}})  # el motor no lo hace: no soportada, nunca falla la escritura
        stats = routing._runtime.stats.get(name, {})
        assert stats.get("escritura_dif", 0) == 0, stats
        assert stats.get("escritura_ok", 0) == 7 and stats.get("escritura_no_soportada", 0) == 1, stats
        assert mongo.database[name].find_one({"_id": 4}).get("m") == 4  # la escritura real sí se hizo
        # Si el motor se equivocara, se registra la diferencia.
        monkeypatch.setattr(actualizar, "aplicar", lambda doc, update, **k: {**doc, "mal": 1})
        c.update_one({"_id": 5}, {"$set": {"x": 1}})
        assert routing._runtime.stats[name].get("escritura_dif") == 1
    finally:
        if routing._runtime is not None:
            import psycopg
            from psycopg import sql as _sql
            with psycopg.connect(TEST_PG, autocommit=True) as conn:
                conn.execute(_sql.SQL("DROP TABLE IF EXISTS {}").format(_sql.Identifier("mongo", name)))
                for tabla in ("_shadow_diffs", "_counters", "_modes"):  # la diferencia forzada no se queda
                    if conn.execute("SELECT to_regclass(%s)", (f"mongo.{tabla}",)).fetchone()[0]:
                        conn.execute(_sql.SQL("DELETE FROM {} WHERE collection = %s").format(_sql.Identifier("mongo", tabla)), (name,))
            routing._runtime.store.close()
        routing._runtime = None
        raw_db.drop_collection(name)
