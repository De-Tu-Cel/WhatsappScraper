"""Modo primary (Postgres manda, app/pgmirror/primaria.py) contra Mongo 7 REAL.

La misma secuencia de escrituras sobre una colección en modo primary y sobre una colección solo de
Mongo debe devolver lo mismo (resultados, documentos devueltos, errores) y dejar lo mismo; la copia de
Mongo debe quedar igual a Postgres. Y con varios hilos a la vez: cada reclamo una sola vez, ningún $inc
perdido, un solo documento por upsert. Necesita el Mongo de pruebas (127.0.0.1:27029) y el Postgres de
pruebas; si falta alguno, se salta.
"""
import copy
import os
import random
import threading
import uuid
from datetime import datetime

import pymongo
import pytest
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import BulkWriteError, DuplicateKeyError, OperationFailure
from pymongo.results import DeleteResult, InsertManyResult, InsertOneResult, UpdateResult

from app import pgmirror
from app.pgmirror import codec, config, health, primaria, routing
from app.pgmirror import store as store_mod
from app.pgmirror.reconcile import reconcile

TEST_MONGO = os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029")
TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _engines_available():
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


pytestmark = pytest.mark.skipif(not _engines_available(), reason="sin Mongo real de pruebas (27029) o sin Postgres de pruebas")


@pytest.fixture
def entorno(monkeypatch):
    import psycopg
    from psycopg import sql
    client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=3000)
    raw_db = client[f"pgprim_{uuid.uuid4().hex[:8]}"]
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    routing._runtime = None
    primaria._mongo_caido_hasta = 0.0  # la pausa tras un Mongo caído no pasa de una prueba a otra
    creadas = []

    def nueva(prefijo="p", modo="primary"):
        name = f"{prefijo}_{uuid.uuid4().hex[:6]}"
        monkeypatch.setenv(config.env_name(name), modo)
        creadas.append(name)
        raw_db.create_collection(name)
        coleccion = pgmirror.wrap_database(raw_db)[name]
        assert isinstance(coleccion, routing.RoutedCollection)
        return coleccion, raw_db[name], raw_db[f"ref_{name}"]

    yield raw_db, nueva
    primaria._mongo_caido_hasta = 0.0
    if routing._runtime is not None:
        with psycopg.connect(TEST_PG, autocommit=True) as conn:
            for name in creadas:
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", name)))
                for tabla in ("_shadow_diffs", "_counters", "_modes", "_outbox", "_reconcile_log", "_dirty"):
                    if conn.execute("SELECT to_regclass(%s)", (f"mongo.{tabla}",)).fetchone()[0]:
                        conn.execute(sql.SQL("DELETE FROM {} WHERE collection = %s").format(sql.Identifier("mongo", tabla)), (name,))
        routing._runtime.store.close()
    routing._runtime = None
    client.drop_database(raw_db.name)


def _sin_oid(valor):
    """Los _id que genera un upsert son distintos en cada base: se comparan como «<oid>»."""
    if isinstance(valor, dict):
        return {k: ("<oid>" if k == "_id" and isinstance(v, ObjectId) else _sin_oid(v)) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_sin_oid(v) for v in valor]
    return valor


def _exacto(doc):
    return None if doc is None else codec.encode_doc(_sin_oid(doc))


def _resumen(r):
    if isinstance(r, InsertOneResult):
        return ("insert", r.inserted_id)
    if isinstance(r, InsertManyResult):
        return ("insert_many", list(r.inserted_ids))
    if isinstance(r, UpdateResult):
        return ("update", r.matched_count, r.modified_count, _sin_oid({"_id": r.upserted_id})["_id"])
    if isinstance(r, DeleteResult):
        return ("delete", r.deleted_count)
    return ("doc", _exacto(r))


def _aplicar(coleccion, op):
    metodo, args, kwargs = op
    try:
        return _resumen(getattr(coleccion, metodo)(*copy.deepcopy(args), **copy.deepcopy(kwargs)))
    except BulkWriteError as exc:
        return ("error", "BulkWriteError", exc.details["nInserted"], [e["index"] for e in exc.details["writeErrors"]])
    except OperationFailure as exc:  # WriteError y DuplicateKeyError incluidos
        return ("error", type(exc).__name__)


def _operaciones(r, n=400):
    estados, etiquetas = ["pending", "sending", "done"], ["a", "b", "c", "z"]
    siguiente = [100]

    def doc(_id=None):
        if _id is None:
            _id = siguiente[0]
            siguiente[0] += 1
        d = {"_id": _id, "k": f"k{_id % 40}", "status": r.choice(estados), "prio": r.randint(0, 9)}
        if r.random() < 0.7:
            d["n"] = r.choice([0, 1, 5, 2.5, "texto"])
        if r.random() < 0.6:
            d["tags"] = r.sample(etiquetas, r.randint(0, 3))
        if r.random() < 0.4:
            d["sub"] = {"a": r.randint(0, 2), "b": "x"}
        if r.random() < 0.2:
            d["at"] = datetime(2026, 10, 21, r.randint(0, 23), 0, 0, r.choice([0, 123456]))
        return d

    def filtro_uno():
        return r.choice([{"_id": r.randint(0, 140)}, {"status": r.choice(estados)}, {"k": f"k{r.randint(0, 45)}"},
                         {"tags": r.choice(etiquetas)}, {"sub.a": r.randint(0, 2)}, {"n": {"$gte": 1}},
                         {"status": "pending", "prio": {"$lte": r.randint(0, 9)}},
                         {"$or": [{"tags": "z"}, {"prio": r.randint(0, 9)}]}, {"falta": {"$exists": False}, "prio": 3}])

    def update():
        return r.choice([
            {"$set": {"status": r.choice(estados), "updated_at": datetime(2026, 10, 21, 12, 0, 0, 654321)}},
            {"$inc": {"n": r.choice([1, -2, 0.5])}}, {"$inc": {"intentos": 1}, "$set": {"sub.a": r.randint(0, 3)}},
            {"$push": {"tags": r.choice(etiquetas)}}, {"$push": {"hist": {"$each": [{"t": r.randint(0, 9)}], "$slice": -3}}},
            {"$addToSet": {"tags": {"$each": ["a", "nuevo"]}}}, {"$pull": {"tags": r.choice(etiquetas)}},
            {"$pull": {"tags": {"$in": ["a", "b"]}}}, {"$unset": {"sub": "", "n": ""}}, {"$max": {"prio": 5}}, {"$min": {"prio": 2}},
            {"$set": {"sub.c.d": 1}}, {"$setOnInsert": {"creado": True}, "$set": {"visto": 1}},
            {"$set": {"status": "pending"}, "$unset": {"status": ""}},  # conflicto: error en ambos
            # Lo que el motor no hace (va por Mongo con los documentos bloqueados en Postgres):
            {"$rename": {"prio": "prioridad"}}, {"$mul": {"prio": 2}},
        ])

    ops = []
    for _ in range(n):
        tirada = r.random()
        if tirada < 0.10:
            ops.append(("insert_one", (doc(r.choice([None, None, None, r.randint(0, 120)])),), {}))
        elif tirada < 0.14:
            lote = [doc() for _ in range(r.randint(1, 4))]
            if r.random() < 0.5:
                lote.insert(r.randint(0, len(lote)), doc(r.randint(0, 99)))  # un duplicado a la mitad
            ops.append(("insert_many", (lote,), {"ordered": r.random() < 0.5}))
        elif tirada < 0.40:
            filtro = filtro_uno()
            kwargs = {}
            if r.random() < 0.2 and set(filtro) <= {"_id", "k"}:
                kwargs["upsert"] = True
            ops.append(("update_one", (filtro, update()), kwargs))
        elif tirada < 0.50:
            ops.append(("update_many", (filtro_uno(), update()), {}))
        elif tirada < 0.56:
            nuevo = {k: v for k, v in doc().items() if k != "_id"}
            ops.append(("replace_one", ({"_id": r.randint(0, 140)}, nuevo), {"upsert": r.random() < 0.3}))
        elif tirada < 0.62:
            ops.append(("delete_one", (filtro_uno(),), {}))
        elif tirada < 0.64:
            ops.append(("delete_many", ({"status": "done", "prio": {"$gte": 8}},), {}))
        elif tirada < 0.86:
            filtro = filtro_uno()
            kwargs = {"sort": r.choice([None, [("prio", 1), ("_id", 1)], [("prio", -1), ("_id", -1)]]),
                      "return_document": r.choice([ReturnDocument.BEFORE, ReturnDocument.AFTER])}
            if r.random() < 0.3:
                kwargs["projection"] = r.choice([{"status": 1}, {"_id": 0, "k": 1, "prio": 1}, {"tags": 0}])
            if r.random() < 0.15 and set(filtro) <= {"_id", "k"}:
                kwargs["upsert"] = True
            ops.append(("find_one_and_update", (filtro, update()), {k: v for k, v in kwargs.items() if v is not None}))
        elif tirada < 0.92:
            nuevo = {k: v for k, v in doc().items() if k != "_id"}
            ops.append(("find_one_and_replace", ({"_id": r.randint(0, 140)}, nuevo),
                        {"return_document": r.choice([ReturnDocument.BEFORE, ReturnDocument.AFTER])}))
        else:
            ops.append(("find_one_and_delete", (filtro_uno(),), {"sort": [("prio", 1), ("_id", 1)]}))
    return ops


def _estado(coleccion):
    return [_exacto(d) for d in coleccion.find({}, sort=[("_id", 1)])]


@pytest.mark.parametrize("semilla", [7, 11, 23, 42])
def test_same_results_and_state_as_real_mongo(entorno, semilla):
    raw_db, nueva = entorno
    coleccion, copia, ref = nueva()
    r = random.Random(semilla)
    iniciales = [{"_id": i, "k": f"k{i % 40}", "status": r.choice(["pending", "done"]), "prio": r.randint(0, 9),
                  "tags": r.sample(["a", "b", "c"], r.randint(0, 3)), "n": r.choice([0, 3, "x"])} for i in range(100)]
    ref.insert_many(copy.deepcopy(iniciales))
    coleccion.insert_many(copy.deepcopy(iniciales))
    distintos = []
    for i, op in enumerate(_operaciones(r)):
        esperado, obtenido = _aplicar(ref, op), _aplicar(coleccion, op)
        if esperado != obtenido:
            distintos.append(f"#{i} {op!r}: mongo={esperado!r} primary={obtenido!r}")
    assert not distintos, "\n".join(distintos[:8])
    assert _estado(coleccion) == _estado(ref)  # lo que se lee (de Postgres) es lo mismo que dejó Mongo
    store = routing._runtime.store
    assert reconcile(raw_db, store, coleccion.name)["in_sync"]  # y la copia de Mongo es igual a Postgres
    stats = routing._runtime.stats[coleccion.name]
    assert stats.get("primaria_ok", 0) > 250 and stats.get("primaria_por_mongo", 0) > 5, stats
    assert stats.get("copia_a_mongo_pendiente", 0) == 0, stats
    assert not store.query("SELECT 1 FROM mongo._outbox WHERE collection = %s", (coleccion.name,))


def test_app_patterns(entorno):
    """Formas reales: reclamos con $or + upsert (classifier), lotes notificados una vez (send_now_worker),
    recibos de envío (delivery_receipts), el positional $ (classification_compare) y $expr (daily_cap)."""
    raw_db, nueva = entorno
    coleccion, copia, ref = nueva()
    ahora = datetime(2026, 10, 21, 12, 0, 0)
    pasos = [
        ("find_one_and_update", ({"_id": "c1", "$or": [{"expires_at": {"$lte": ahora}}, {"expires_at": {"$exists": False}}]},
                                 {"$set": {"holder": "t1", "expires_at": datetime(2026, 10, 21, 12, 5)}}),
         {"upsert": True, "return_document": ReturnDocument.AFTER}),
        # Ya reclamado y vigente: Mongo intenta insertar el mismo _id → DuplicateKeyError (la app lo espera).
        ("find_one_and_update", ({"_id": "c1", "$or": [{"expires_at": {"$lte": ahora}}, {"expires_at": {"$exists": False}}]},
                                 {"$set": {"holder": "t2"}}), {"upsert": True, "return_document": ReturnDocument.AFTER}),
        ("update_one", ({"_id": "b1", "notified": {"$ne": True}}, {"$set": {"notified": True}}), {"upsert": True}),
        ("update_one", ({"_id": "b1", "notified": {"$ne": True}}, {"$set": {"notified": True}}), {"upsert": True}),
        ("insert_one", ({"_id": "r1", "status": "dispatching"},), {}),
        ("insert_one", ({"_id": "r1", "status": "otra"},), {}),
        ("update_one", ({"_id": "v1"}, {"$setOnInsert": {"instance": "i", "date": "2026-10-21", "count": 0}}), {"upsert": True}),
        ("update_one", ({"_id": "v1"}, {"$setOnInsert": {"instance": "i", "date": "2026-10-21", "count": 0}}), {"upsert": True}),
        ("insert_one", ({"_id": "cmp", "company_id": "x", "numbers": [{"number": "1", "v": 0}, {"number": "2", "v": 0}]},), {}),
        ("update_one", ({"company_id": "x", "numbers.number": "2"}, {"$set": {"numbers.$": {"number": "2", "v": 9}, "u": 1}}), {}),
        ("insert_one", ({"_id": "cap", "instance": "i", "date": "d", "recipients": ["a"], "companies": []},), {}),
        ("find_one_and_update", ({"instance": "i", "date": "d", "$or": [{"recipients": "b"}, {"$expr": {"$lt": [
            {"$add": [{"$size": {"$ifNull": ["$recipients", []]}}, {"$size": {"$ifNull": ["$companies", []]}}]}, 2]}}]},
            {"$addToSet": {"recipients": "b"}}), {"return_document": ReturnDocument.BEFORE}),
        ("find_one_and_update", ({"instance": "i", "date": "d", "$or": [{"recipients": "c"}, {"$expr": {"$lt": [
            {"$add": [{"$size": {"$ifNull": ["$recipients", []]}}, {"$size": {"$ifNull": ["$companies", []]}}]}, 2]}}]},
            {"$addToSet": {"recipients": "c"}}), {"return_document": ReturnDocument.BEFORE}),
    ]
    for op in pasos:
        assert _aplicar(coleccion, op) == _aplicar(ref, op), op
    assert _estado(coleccion) == _estado(ref)
    assert reconcile(raw_db, routing._runtime.store, coleccion.name)["in_sync"]


def test_unique_indexes_like_mongo(entorno, monkeypatch):
    raw_db, nueva = entorno
    coleccion, copia, ref = nueva()
    monkeypatch.setitem(store_mod.UNICOS, coleccion.name, [("message_id", "string")])
    store = routing._runtime.store
    # Sin el índice todavía: las escrituras van por Mongo (que sí lo tiene), nunca se pierde la unicidad.
    copia.create_index("message_id", unique=True, partialFilterExpression={"message_id": {"$type": "string"}})
    coleccion.insert_one({"_id": 1, "message_id": "m1"})
    with pytest.raises(DuplicateKeyError):
        coleccion.insert_one({"_id": 2, "message_id": "m1"})
    assert routing._runtime.stats[coleccion.name]["primaria_por_mongo"] == 2
    assert store.ensure_unique_indexes(coleccion.name) and store.unique_ready(coleccion.name)
    coleccion.insert_one({"_id": 3, "message_id": "m3"})
    with pytest.raises(DuplicateKeyError):
        coleccion.insert_one({"_id": 4, "message_id": "m3"})
    with pytest.raises(DuplicateKeyError):
        coleccion.update_one({"_id": 1}, {"$set": {"message_id": "m3"}})
    coleccion.insert_many([{"_id": 5}, {"_id": 6, "message_id": None}, {"_id": 7, "message_id": None}])  # parcial: solo textos
    assert routing._runtime.stats[coleccion.name]["primaria_ok"] >= 2
    assert sorted(d["_id"] for d in coleccion.find({})) == [1, 3, 5, 6, 7]
    assert reconcile(raw_db, store, coleccion.name)["in_sync"]


def _hilos(n, fn):
    errores = []

    def correr(i):
        try:
            fn(i)
        except Exception as exc:  # pragma: no cover - se reporta abajo
            errores.append(repr(exc))
    hilos = [threading.Thread(target=correr, args=(i,)) for i in range(n)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(120)
    assert not errores, errores[:3]


def test_concurrent_claims_happen_exactly_once(entorno):
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    coleccion.insert_many([{"_id": i, "status": "pending", "prio": i % 7} for i in range(150)])
    reclamos = []

    def trabajador(t):
        while True:
            doc = coleccion.find_one_and_update({"status": "pending"}, {"$set": {"status": "claimed", "by": t}},
                                                sort=[("prio", 1), ("_id", 1)], return_document=ReturnDocument.AFTER)
            if doc is None:
                return
            reclamos.append(doc["_id"])
    _hilos(5, trabajador)
    assert sorted(reclamos) == list(range(150))  # cada uno una sola vez, ninguno perdido
    assert coleccion.count_documents({"status": "claimed"}) == 150
    assert reconcile(raw_db, routing._runtime.store, coleccion.name)["in_sync"]


def test_concurrent_increments_and_upserts(entorno):
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()

    def trabajador(t):
        for _ in range(40):
            coleccion.update_one({"_id": "contador"}, {"$inc": {"n": 1}}, upsert=True)
            coleccion.update_one({"instance": "gely-wa", "date": "2026-10-21"},
                                 {"$setOnInsert": {"recipients": []}, "$inc": {"count": 1}}, upsert=True)
            coleccion.find_one_and_update({"_id": "cupo"}, {"$addToSet": {"quien": t}, "$inc": {"usos": 1}}, upsert=True)
    _hilos(5, trabajador)
    assert coleccion.find_one({"_id": "contador"})["n"] == 200
    dias = list(coleccion.find({"instance": "gely-wa"}))
    assert len(dias) == 1 and dias[0]["count"] == 200  # un solo documento por upsert, ningún $inc perdido
    cupo = coleccion.find_one({"_id": "cupo"})
    assert cupo["usos"] == 200 and sorted(cupo["quien"]) == list(range(5))
    assert reconcile(raw_db, routing._runtime.store, coleccion.name)["in_sync"]


def test_outbox_recovers_a_failed_copy(entorno, monkeypatch):
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    coleccion.insert_one({"_id": 1, "v": 1})
    original = primaria._escribir_en_mongo

    def falla(*a, **k):
        raise pymongo.errors.ServerSelectionTimeoutError("Mongo no responde")
    monkeypatch.setattr(primaria, "_escribir_en_mongo", falla)
    coleccion.update_one({"_id": 1}, {"$set": {"v": 2}})  # la escritura en Postgres sí se hace
    monkeypatch.setattr(primaria, "_escribir_en_mongo", original)
    assert coleccion.find_one({"_id": 1})["v"] == 2 and copia.find_one({"_id": 1})["v"] == 1
    # Mongo acaba de fallar: los siguientes 30 s las copias van directo a la bandeja (sin esperar a Mongo).
    coleccion.insert_one({"_id": 2, "v": 1})
    assert copia.find_one({"_id": 2}) is None
    assert routing._runtime.stats[coleccion.name]["copia_a_mongo_pendiente"] == 2
    store = routing._runtime.store
    assert store.query("SELECT count(*) FROM mongo._outbox WHERE collection = %s", (coleccion.name,))[0][0] == 2
    assert health.drain_outbox(raw_db, store, {"otra"}, mayores_a_s=0) == 0  # solo colecciones en primary
    assert health.drain_outbox(raw_db, store, {coleccion.name}, mayores_a_s=0) == 2
    assert copia.find_one({"_id": 1})["v"] == 2 and copia.find_one({"_id": 2})["v"] == 1
    assert not store.query("SELECT 1 FROM mongo._outbox WHERE collection = %s", (coleccion.name,))


def test_failed_commit_puts_mongo_back(entorno, monkeypatch):
    """La copia a Mongo va antes del COMMIT: si el COMMIT falla, Mongo regresa a lo que tiene Postgres."""
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    coleccion.insert_one({"_id": 1, "v": 1})
    escritor = coleccion._escritor_pg()
    reflejar = primaria.Escritor._reflejar

    def y_luego_falla(self, conn, cambios, copiados):
        reflejar(self, conn, cambios, copiados)
        raise RuntimeError("se cayó la conexión antes del COMMIT")
    monkeypatch.setattr(primaria.Escritor, "_reflejar", y_luego_falla)
    with pytest.raises(RuntimeError):
        escritor.update({"_id": 1}, {"$set": {"v": 2}}, multi=False)
    assert coleccion.find_one({"_id": 1})["v"] == 1 and copia.find_one({"_id": 1})["v"] == 1


def test_outbox_keeps_a_newer_write(entorno):
    """Una anotación que cambió después de la foto de la copia no se borra."""
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    coleccion.insert_one({"_id": 1, "v": 1})
    store = routing._runtime.store
    escritor = coleccion._escritor_pg()
    with escritor._transaccion() as conn:
        escritor._marcar(conn, [1])
    seq = store.query("SELECT seq FROM mongo._outbox WHERE collection = %s", (coleccion.name,))[0][0]
    with store._pool.connection() as conn:
        primaria._quitar_de_bandeja(conn, coleccion.name, [("1", seq - 1)])  # una foto vieja
    assert store.query("SELECT seq FROM mongo._outbox WHERE collection = %s", (coleccion.name,))[0][0] == seq
    primaria.copiar_a_mongo(copia, store, coleccion.name, [1])
    assert not store.query("SELECT 1 FROM mongo._outbox WHERE collection = %s", (coleccion.name,))


def test_primary_reconcile_only_fixes_mongo(entorno):
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    coleccion.insert_many([{"_id": i, "v": i} for i in range(10)])
    copia.update_one({"_id": 3}, {"$set": {"v": "mal"}})  # alguien tocó la copia directo
    copia.delete_one({"_id": 4})
    copia.insert_one({"_id": 99, "sobra": True})
    store = routing._runtime.store
    store.query("INSERT INTO mongo._dirty (collection, reason) VALUES (%s, 'prueba') ON CONFLICT DO NOTHING", (coleccion.name,))
    assert coleccion.find_one({"_id": 3})["v"] == 3  # en primary se lee de Postgres aunque haya marca vieja
    # La conciliación hacia adelante nunca toca una colección en primary.
    assert health.auto_reconcile(raw_db, store, routing._runtime.worker, [coleccion.name]) == []
    assert coleccion.find_one({"_id": 3})["v"] == 3
    resultado = health.reconcile_primary(raw_db, store, [coleccion.name])
    assert resultado[0]["different"] == 1 and resultado[0]["missing_in_postgres"] == 1 and resultado[0]["extra_in_postgres"] == 1
    assert reconcile(raw_db, store, coleccion.name)["in_sync"]
    assert copia.find_one({"_id": 3})["v"] == 3 and copia.find_one({"_id": 99}) is None
    assert store.query("SELECT queued FROM mongo._reconcile_log WHERE collection = %s AND kind = 'primary'", (coleccion.name,))[0][0] == 3


def test_failed_postgres_write_restores_mongo(entorno, monkeypatch):
    """Por Mongo: si Postgres rechaza el resultado, Mongo vuelve a ser la copia de Postgres."""
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    monkeypatch.setitem(store_mod.UNICOS, coleccion.name, [("u", None)])
    coleccion.insert_many([{"_id": 1, "u": "a", "p": 1}, {"_id": 2, "u": "b", "p": 1}])
    store = routing._runtime.store
    assert store.ensure_unique_indexes(coleccion.name)
    # $mul va por Mongo, que aquí no tiene el índice único: Mongo deja u="a" en los dos y Postgres lo rechaza.
    copia.update_one({"_id": 2}, {"$set": {"lista": ["x"]}})  # una copia desigual: por_mongo la iguala antes
    with pytest.raises(DuplicateKeyError):
        coleccion.update_many({"p": 1}, {"$set": {"u": "a"}, "$mul": {"p": 1}})
    assert sorted((d["_id"], d["u"]) for d in coleccion.find({})) == [(1, "a"), (2, "b")]
    assert reconcile(raw_db, store, coleccion.name)["in_sync"]  # Mongo quedó como Postgres, no a medias


def test_insert_keeps_callers_id_and_reads_your_writes(entorno):
    raw_db, nueva = entorno
    coleccion, copia, _ref = nueva()
    doc = {"texto": "hola", "at": datetime(2026, 10, 21, 12, 0, 0, 123456)}
    resultado = coleccion.insert_one(doc)
    assert isinstance(doc["_id"], ObjectId) and resultado.inserted_id == doc["_id"]
    leido = coleccion.find_one({"_id": doc["_id"]})
    assert leido["at"] == datetime(2026, 10, 21, 12, 0, 0, 123000)  # al milisegundo, como Mongo
    assert copia.find_one({"_id": doc["_id"]}) == leido
    with pytest.raises(NotImplementedError):
        coleccion.bulk_write([])
