"""aggregate() sobre Postgres (app/pgmirror/agregar.py) contra Mongo 7 REAL, con las formas de pipeline que
usa la app (inventario del 2026-10-21). Necesita el Mongo de pruebas (27029) y el Postgres de pruebas.
"""
import os
import random
import uuid
from datetime import datetime, timedelta

import pymongo
import pytest
from bson import ObjectId

from app.pgmirror import agregar, codec, sqlfilter

TEST_MONGO = os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029")
TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _motores():
    try:
        import psycopg
        psycopg.connect(TEST_PG, connect_timeout=2).close()
        client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=1500)
        if type(client).__module__.startswith("mongomock"):
            return False
        client.admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _motores(), reason="sin Mongo real de pruebas (27029) o sin Postgres de pruebas")
EMPRESAS = ["c1", "c2", "c3", ObjectId("6716b0f2a1b2c3d4e5f60718"), None, "manual", "unknown"]


def _mensaje(r, i):
    base = datetime(2026, 10, 1) + timedelta(minutes=r.randint(0, 60 * 24 * 20), microseconds=r.choice([0, 123456]))
    doc = {"_id": i, "direction": r.choice(["inbound", "outbound"]), "created_at": base,
           "status": r.choice(["sent", "delivered", "read", "failed", "received", None])}
    if r.random() < 0.9:
        doc["company_id"] = r.choice(EMPRESAS)
    for campo, valores in (("instance_name", ["gely-wa", "tania-sesion-1", "", None]), ("sent_by_name", ["Gely", "Andy", "", None]),
                           ("sent_by_username", ["gely", "andy", "", None]), ("to_number", ["5215511", "5215522", ""]),
                           ("from_number", ["5215533", None]), ("error", ["recipient_blocked", "otro"]),
                           ("industry", ["Gas", "Restaurantes", None]), ("created_by", ["marco", None]),
                           ("event", ["connected", "disconnected"]), ("reason", ["logout", "timeout"]),
                           ("reason_label", ["Cerró sesión", "Tiempo"]), ("analysis_status", ["pending", "done"]),
                           ("value", ["+525511111111", "5215522222222"]), ("instance_number", ["5214428079840", None])):
        if r.random() < 0.6:
            doc[campo] = r.choice(valores)
    if r.random() < 0.7:
        doc["analysis"] = {k: v for k, v in {
            "category": r.choice(["bot", "humano", "sin_respuesta", None]), "is_ai": r.choice([True, False]),
            "conversation_analysis": r.choice([True, False, None]), "error": r.choice([True, None]),
            "reaction_time_min": r.choice([None, 3, 12.5]), "notes": r.choice(["ok", ""]),
        }.items() if r.random() < 0.8}
    doc["ts"] = base
    doc["pending_since"] = base
    return doc


@pytest.fixture(scope="module")
def motores():
    from app.pgmirror.store import Store
    client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=3000)
    nombre_db = f"agregar_{uuid.uuid4().hex[:8]}"
    mongo = client[nombre_db]["c"]
    store = Store(TEST_PG, statement_timeout_ms=60000)
    tabla = f"agregar_{uuid.uuid4().hex[:8]}"
    r = random.Random(3)
    mongo.insert_many([_mensaje(r, i) for i in range(600)])
    store.upsert(tabla, list(mongo.find()))
    yield mongo, store, tabla
    import psycopg
    from psycopg import sql
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", tabla)))
    store.close()
    client.drop_database(nombre_db)


def _norm(v):
    """Para comparar: al milisegundo, $addToSet sin orden."""
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return v


def _canon(filas, ordenado: bool, conjuntos=()):
    salida = []
    for f in filas:
        f = codec.decode_doc(codec.encode_doc(_norm(f)))
        for c in conjuntos:
            if isinstance(f.get(c), list):
                f[c] = sorted(f[c], key=lambda x: codec.encode_doc({"v": x}))
        salida.append(codec.encode_doc(f))
    return salida if ordenado else sorted(salida)


DESDE = datetime(2026, 10, 5)
ENVIADOS = {"direction": "outbound", "created_at": {"$gte": DESDE}, "instance_name": {"$exists": True, "$ne": None},
            "status": {"$in": ["sent", "delivered", "read"]}}
CIDS = ["c1", "c2", ObjectId("6716b0f2a1b2c3d4e5f60718")]
GRUPO_CONTACTOS = {"$group": {"_id": {"$toString": "$company_id"}, "numbers": {"$push": {"contact_id": "$_id", "number": "$value"}},
                              "latest": {"$max": "$created_at"}}}
# (nombre, pipeline, el resultado tiene orden garantizado, campos que son conjuntos)
PIPELINES = [
    ("routes 2555 conteo de giros", [{"$match": {"industry": {"$ne": None}}}, {"$group": {"_id": "$industry"}}, {"$count": "n"}], True, ()),
    ("routes 2565 giros", [{"$match": {}}, {"$group": {"_id": "$industry", "count": {"$sum": 1}}}, {"$sort": {"count": -1, "_id": 1}},
                           {"$skip": 0}, {"$limit": 10}], True, ()),
    ("routes 2275 contactos (conteo)", [{"$match": {}}, GRUPO_CONTACTOS, {"$count": "n"}], True, ()),
    ("routes 2279 contactos", [{"$match": {"value": {"$exists": True}}}, GRUPO_CONTACTOS, {"$sort": {"latest": -1}}], False, ("numbers",)),
    ("routes 2591 conteo de usuarios", [{"$match": {}}, {"$group": {"_id": "$created_by"}}, {"$count": "n"}], True, ()),
    ("routes 2601 por usuario", [{"$match": {}}, {"$group": {"_id": "$created_by", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}], True, ()),
    ("routes 6724 por instancia", [{"$match": ENVIADOS}, {"$group": {
        "_id": "$instance_name", "messages_sent": {"$sum": 1},
        "contacts": {"$addToSet": {"$cond": [{"$ifNull": ["$company_id", False]}, "$company_id", "$$REMOVE"]}}}},
        {"$project": {"_id": 0, "instance_name": "$_id", "messages_sent": 1, "contacts_reached": {"$size": {"$ifNull": ["$contacts", []]}}}}], False, ()),
    ("routes 6810 serie por día", [{"$match": ENVIADOS}, {"$group": {
        "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "messages_sent": {"$sum": 1},
        "contacts": {"$addToSet": {"$cond": [{"$ifNull": ["$company_id", False]}, "$company_id", "$$REMOVE"]}}}},
        {"$project": {"_id": 0, "bucket": "$_id", "messages_sent": 1, "contacts_reached": {"$size": {"$ifNull": ["$contacts", []]}}}},
        {"$sort": {"bucket": 1}}], True, ()),
    ("database 500 giros", [{"$group": {"_id": "$industry", "n": {"$sum": 1}}}, {"$sort": {"n": -1, "_id": 1}}], True, ()),
    ("database 1046 primer envío", [{"$match": {"company_id": {"$in": CIDS}, "direction": "outbound", "status": {"$in": ["sent", "delivered", "read"]}}},
                                    {"$sort": {"created_at": 1}}, {"$group": {
                                        "_id": "$company_id", "first_sent_by_name": {"$first": "$sent_by_name"},
                                        "first_created_at": {"$first": "$created_at"}, "contacted_numbers": {"$addToSet": "$to_number"}}}],
     False, ("contacted_numbers",)),
    ("database 1416 último evento", [{"$match": {"instance_name": {"$in": ["gely-wa", "tania-sesion-1"]}, "ts": {"$lt": datetime(2026, 10, 15)}}},
                                     {"$sort": {"ts": -1}}, {"$group": {"_id": "$instance_name", "event": {"$first": "$event"}}}], False, ()),
    ("database 1534 conversaciones", [{"$match": {"company_id": {"$nin": [None, "unknown", "manual"]}}}, {"$sort": {"created_at": -1}}, {"$group": {
        "_id": "$company_id", "last_direction": {"$first": "$direction"}, "last_at": {"$first": "$created_at"},
        "last_status": {"$first": "$status"}, "last_error": {"$first": "$error"}, "total": {"$sum": 1},
        "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$direction", "inbound"]}, {"$ne": ["$status", "read"]}]}, 1, 0]}},
        "has_outbound": {"$sum": {"$cond": [{"$eq": ["$direction", "outbound"]}, 1, 0]}}}}, {"$sort": {"last_at": -1}}], True, ()),
    ("database 1586 quién envió", [{"$match": {"direction": "outbound", "company_id": {"$in": CIDS}, "sent_by_name": {"$nin": [None, "", "Andy"]}}},
                                   {"$sort": {"created_at": 1}}, {"$group": {
                                       "_id": {"cid": "$company_id", "username": "$sent_by_username"},
                                       "sent_by_name": {"$first": "$sent_by_name"}, "first_seen": {"$first": "$created_at"}}}], False, ()),
    ("database 1609 por qué línea", [{"$match": {"direction": "outbound", "company_id": {"$in": CIDS}, "instance_name": {"$nin": [None, ""]}}},
                                     {"$sort": {"created_at": -1}}, {"$group": {"_id": "$company_id", "via_instance": {"$first": "$instance_name"},
                                                                                "via_instance_number": {"$first": "$instance_number"}}}], False, ()),
    ("database 1648 números", [{"$match": {"company_id": {"$in": CIDS}}}, {"$project": {
        "company_id": 1, "num": {"$cond": [{"$eq": ["$direction", "outbound"]}, "$to_number", {"$ifNull": ["$from_number", "$number"]}]}}},
        {"$match": {"num": {"$nin": [None, ""]}}}, {"$group": {"_id": {"cid": "$company_id", "num": "$num"}}}], False, ()),
    ("database 1665 análisis", [{"$match": {"company_id": {"$in": CIDS}, "direction": "inbound", "analysis": {"$exists": True},
                                            "analysis.error": {"$ne": True}}},
                                {"$sort": {"analysis.conversation_analysis": -1, "created_at": -1}},
                                {"$group": {"_id": "$company_id", "analysis": {"$first": "$analysis"}}}], False, ()),
    ("database 1695 análisis sueltos", [{"$match": {"company_id": {"$in": CIDS}, "direction": "inbound", "analysis": {"$exists": True},
                                                    "analysis.conversation_analysis": {"$ne": True}, "analysis.error": {"$ne": True}}},
                                        {"$project": {"company_id": 1, "analysis": 1}}], False, ()),
    ("database 1926 analítica", [{"$match": {"direction": "inbound", "analysis": {"$exists": True}, "analysis.error": {"$ne": True}}},
                                 {"$sort": {"analysis.conversation_analysis": -1, "created_at": -1}}, {"$group": {
                                     "_id": "$company_id", "last_at": {"$max": "$created_at"}, "category": {"$first": "$analysis.category"},
                                     "is_ai": {"$first": "$analysis.is_ai"}, "notes": {"$first": "$analysis.notes"}, "total_responses": {"$sum": 1}}}],
     False, ()),
    ("database 1958 reacción", [{"$match": {"direction": "inbound", "analysis.reaction_time_min": {"$ne": None}}}, {"$sort": {"created_at": 1}},
                                {"$group": {"_id": "$company_id", "reaction_time_min": {"$first": "$analysis.reaction_time_min"}}}], False, ()),
    ("database 1989 mensajes", [{"$match": {"direction": "inbound", "analysis": {"$exists": True}, "analysis.error": {"$ne": True}}},
                                {"$group": {"_id": "$company_id", "msgs": {"$push": {
                                    "category": "$analysis.category", "is_ai": "$analysis.is_ai", "reaction_time_min": "$analysis.reaction_time_min"}},
                                    "has_conv": {"$max": {"$cond": ["$analysis.conversation_analysis", 1, 0]}}}}], False, ("msgs",)),
    ("database 2062 último envío", [{"$match": {"direction": "outbound"}}, {"$sort": {"created_at": -1}},
                                    {"$group": {"_id": "$company_id", "last_at": {"$first": "$created_at"}}}], False, ()),
    ("database 2075 sin respuesta", [{"$match": {"direction": "outbound", "analysis.category": "sin_respuesta"}}, {"$group": {"_id": "$company_id"}}],
     False, ()),
    ("database 2114 nombre del que envió", [{"$match": {"direction": "outbound", "company_id": {"$in": CIDS}, "sent_by_username": {"$nin": [None, ""]}}},
                                            {"$group": {"_id": {"cid": "$company_id", "username": "$sent_by_username"},
                                                        "name": {"$first": "$sent_by_name"}}}], False, ()),
    ("database 2156 pendientes", [{"$match": {"company_id": {"$in": CIDS}, "direction": "inbound", "analysis_status": "pending",
                                              "pending_since": {"$gte": DESDE}}}, {"$group": {"_id": "$company_id", "cnt": {"$sum": 1}}}], False, ()),
    ("instance_metrics 144 primer envío", [{"$match": {**ENVIADOS}}, {"$group": {"_id": "$company_id", "t": {"$min": "$created_at"}}}], False, ()),
    ("instance_metrics 169 respondieron 2+", [{"$match": {"direction": "inbound"}}, {"$group": {"_id": "$company_id", "n": {"$sum": 1}}},
                                              {"$match": {"n": {"$gte": 2}}}], False, ()),
    ("instance_metrics 183 resultados", [{"$match": {"direction": "outbound"}}, {"$group": {
        "_id": {"i": "$instance_name", "s": "$status", "b": {"$eq": ["$error", "recipient_blocked"]}}, "n": {"$sum": 1}}}], False, ()),
    ("instance_metrics 203 desconexiones", [{"$match": {"event": "disconnected", "ts": {"$gte": DESDE}}}, {"$sort": {"ts": 1}},
                                            {"$group": {"_id": {"i": "$instance_name", "r": "$reason"}, "n": {"$sum": 1},
                                                        "label": {"$last": "$reason_label"}}}], False, ()),
]


@pytest.mark.parametrize("nombre,pipeline,ordenado,conjuntos", PIPELINES, ids=[p[0] for p in PIPELINES])
def test_app_pipelines_match_real_mongo(motores, nombre, pipeline, ordenado, conjuntos):
    mongo, store, tabla = motores
    esperado = list(mongo.aggregate(pipeline))
    obtenido = agregar.ejecutar(store, tabla, pipeline)
    assert _canon(obtenido, ordenado, conjuntos) == _canon(esperado, ordenado, conjuntos)
    assert esperado, "el pipeline de prueba debe devolver algo"


def test_what_it_cannot_do_goes_to_mongo(motores):
    _mongo, store, tabla = motores
    for pipeline in ([{"$lookup": {"from": "x", "localField": "a", "foreignField": "b", "as": "c"}}],
                     [{"$group": {"_id": "$company_id", "x": {"$avg": "$n"}}}],
                     [{"$project": {"x": {"$toUpper": "$status"}}}],
                     [{"$group": {"_id": None, "x": {"$sum": 1}}}, {"$match": {"x.y": 1}}]):
        with pytest.raises(sqlfilter.Unsupported):
            agregar.ejecutar(store, tabla, pipeline)


def test_routed_aggregate_shadow_and_postgres_modes(motores, monkeypatch):
    """Por la capa: en shadow responde Mongo y compara (0 diferencias); en postgres responde el motor."""
    from app import pgmirror
    from app.pgmirror import config, routing
    mongo, _store, _tabla = motores
    raw_db = mongo.database
    nombre = mongo.name
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv(config.env_name(nombre), "postgres")
    routing._runtime = None
    try:
        db = pgmirror.wrap_database(raw_db)
        c = db[nombre]
        from app.pgmirror.reconcile import reconcile
        reconcile(raw_db, routing._runtime.store, nombre, fix=True)
        pipelines = [p[1] for p in PIPELINES]
        monkeypatch.setenv("PGMIRROR_AGGREGATE", "shadow")
        for pipeline in pipelines:
            conj = ("numbers", "msgs", "contacted_numbers")  # $addToSet no tiene orden ni en Mongo
            assert _canon(list(c.aggregate(pipeline)), False, conj) == _canon(list(mongo.aggregate(pipeline)), False, conj)
        assert routing.shadow_drain(30)
        stats = routing._runtime.stats.get(nombre, {})
        assert stats.get("agregado_ok") == len(pipelines) and not stats.get("agregado_dif"), stats
        monkeypatch.setenv("PGMIRROR_AGGREGATE", "postgres")
        for pipeline in pipelines:
            assert _canon(list(c.aggregate(pipeline)), False, ("numbers", "msgs", "contacted_numbers")) ==                    _canon(list(mongo.aggregate(pipeline)), False, ("numbers", "msgs", "contacted_numbers"))
        assert not any(k.startswith("pg_fallback") for k in routing._runtime.stats.get(nombre, {}))
        # Lo que el motor no hace se resuelve en Mongo.
        assert list(c.aggregate([{"$group": {"_id": None, "x": {"$avg": "$n"}}}]))
        assert routing._runtime.stats[nombre].get("pg_fallback_aggregate") == 1
    finally:
        if routing._runtime is not None:
            import psycopg
            from psycopg import sql
            with psycopg.connect(TEST_PG, autocommit=True) as conn:
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", nombre)))
                for t in ("_shadow_diffs", "_counters", "_modes"):
                    if conn.execute("SELECT to_regclass(%s)", (f"mongo.{t}",)).fetchone()[0]:
                        conn.execute(sql.SQL("DELETE FROM {} WHERE collection = %s").format(sql.Identifier("mongo", t)), (nombre,))
            routing._runtime.store.close()
        routing._runtime = None
