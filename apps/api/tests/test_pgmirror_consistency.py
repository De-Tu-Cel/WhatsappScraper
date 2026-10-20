"""Garantías para leer de Postgres (modo postgres) sin ver datos viejos:

- Leer-lo-que-escribiste: la copia de una escritura se hace antes de responder.
- Si esa copia falla, la colección queda "por conciliar" en Postgres y TODOS los procesos
  leen de Mongo hasta que una conciliación posterior la limpie.
- Dos procesos copiando el mismo documento se turnan (candado por documento).
- Los reclamos con find_one_and_* no hacen consulta previa.

Mongo: mongomock. Postgres: el desechable de pruebas; sin él se saltan.
"""
import os
import threading
import time
import uuid

import mongomock
import pytest
from bson import ObjectId
from pymongo import ReturnDocument

from app import pgmirror
from app.pgmirror import health, routing
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


@pytest.fixture
def pg(monkeypatch):
    name = f"c_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("DB_MODES", f"{name}=postgres")
    raw = mongomock.MongoClient().db
    rt = routing._Runtime(raw, monitor=False)
    routing._runtime = rt
    yield raw, rt, name
    import psycopg
    from psycopg import sql
    rt.worker.flush(5)
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", name)))
        for table in ("_dirty", "_reconcile_log", "_modes", "_counters"):
            conn.execute(sql.SQL("DELETE FROM {} WHERE collection = %s").format(sql.Identifier("mongo", table)), (name,))
    rt.store.close()
    routing._runtime = None


def test_a_write_is_readable_from_postgres_immediately(pg):
    raw, rt, name = pg
    col = pgmirror.wrap_database(raw)[name]
    _id = col.insert_one({"status": "nuevo", "n": 1}).inserted_id
    # Sin esperar al hilo de copia: la lectura sale de Postgres y ya trae el cambio.
    col.update_one({"_id": _id}, {"$set": {"status": "visto"}, "$inc": {"n": 1}})
    assert col.find_one({"_id": _id}) == {"_id": _id, "status": "visto", "n": 2}
    col.find_one_and_update({"status": "visto"}, {"$set": {"status": "tomado"}})
    assert col.count_documents({"status": "tomado"}) == 1
    col.delete_one({"_id": _id})
    assert col.find_one({"_id": _id}) is None and col.estimated_document_count() == 0
    assert rt.stats.get(name, {}).get("pg_fallback_dirty") is None  # todo se leyó de Postgres
    assert rt.worker.stats["synced_inline"] >= 3


def test_a_failed_copy_sends_every_process_back_to_mongo_until_reconciled(pg, monkeypatch):
    raw, rt, name = pg
    col = pgmirror.wrap_database(raw)[name]
    _id = col.insert_one({"v": 1}).inserted_id

    def broken(*_a, **_k):
        raise RuntimeError("postgres no contestó")
    monkeypatch.setattr(rt.worker, "sync_ids", broken)
    col.update_one({"_id": _id}, {"$set": {"v": 2}})  # Mongo sí cambió; Postgres se quedó en v=1
    assert col.find_one({"_id": _id})["v"] == 2  # este proceso lee de Mongo, no el dato viejo

    # Otro proceso del backend (su propia capa) tampoco lee el dato viejo.
    other = routing._Runtime(raw, monitor=False)
    try:
        other_col = routing.RoutedCollection(raw[name], name, "postgres", other)
        assert other_col.find_one({"_id": _id})["v"] == 2
        assert other.stats[name]["pg_fallback_dirty"] >= 1
    finally:
        other.store.close()

    monkeypatch.undo()  # Postgres "volvió"
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("DB_MODES", f"{name}=postgres")
    health.auto_reconcile(raw, rt.store, rt.worker, [name], "dirty")
    rt._dirty_cache_at = float("-inf")
    assert rt.pg_readable(name)
    assert col.find_one({"_id": _id})["v"] == 2 and reconcile(raw, rt.store, name)["in_sync"]


def test_two_processes_copying_the_same_document_take_turns(pg):
    import psycopg
    from app.pgmirror import store as store_module
    raw, rt, name = pg
    _id = ObjectId()
    raw[name].insert_one({"_id": _id, "v": 1})
    key = store_module._row_lock(name, str(_id))
    done = threading.Event()
    with psycopg.connect(TEST_PG) as holder:  # otro proceso copiando ese documento
        holder.execute("SELECT pg_advisory_xact_lock(%s, %s)", (store_module._LOCK_NAMESPACE, key))
        t = threading.Thread(target=lambda: (rt.worker.sync_ids(name, [_id]), done.set()))
        t.start()
        time.sleep(0.5)
        assert not done.is_set()  # espera su turno: no lee Mongo ni escribe mientras el otro copia
        raw[name].update_one({"_id": _id}, {"$set": {"v": 2}})
        holder.commit()
    t.join(10)
    assert done.is_set()
    # Leyó Mongo DESPUÉS de obtener el candado: copió la versión nueva.
    assert rt.store.query(f'SELECT doc->>\'v\' FROM mongo."{name}"')[0][0] == "2"


def test_queue_claims_do_not_pre_query(pg, monkeypatch):
    raw, rt, name = pg
    col = pgmirror.wrap_database(raw)[name]
    col.insert_many([{"status": "pending", "i": i} for i in range(3)])
    calls = []
    real = routing.RoutedCollection._ids_for
    monkeypatch.setattr(routing.RoutedCollection, "_ids_for", lambda self, f, **k: calls.append(f) or real(self, f, **k))

    claimed = col.find_one_and_update({"status": "pending"}, {"$set": {"status": "claimed"}},
                                      sort=[("i", 1)], return_document=ReturnDocument.AFTER)
    assert claimed["i"] == 0 and calls == []
    assert col.find_one({"_id": claimed["_id"]})["status"] == "claimed"
    # Si la proyección oculta el _id, sí hace falta averiguarlo antes.
    col.find_one_and_update({"status": "pending"}, {"$set": {"status": "claimed"}}, projection={"_id": 0})
    assert len(calls) == 1
    # Upsert con BEFORE: regresa None, el nuevo se encuentra después.
    assert col.find_one_and_update({"k": "lease"}, {"$set": {"holder": "me"}}, upsert=True) is None
    assert col.find_one({"k": "lease"})["holder"] == "me"
    assert reconcile(raw, rt.store, name)["in_sync"]
