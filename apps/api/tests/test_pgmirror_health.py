"""Vigilancia automática del espejo (app/pgmirror/health.py) y `pg_mirror.py check`.

Mongo: mongomock. Postgres: el desechable de pruebas (TEST_POSTGRES_URL); sin él se saltan.
El hilo vigilante no se arranca aquí: cada prueba llama monitor.tick() a mano.
"""
import importlib.util
import os
import pathlib
import time
import uuid

import mongomock
import pytest
from bson import ObjectId

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


needs_pg = pytest.mark.skipif(not _pg_available(), reason="sin Postgres de pruebas")


def _cleanup(names):
    import psycopg
    from psycopg import sql
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        for name in names:
            conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier("mongo", name)))
        for table in ("_modes", "_counters", "_reconcile_log"):
            if conn.execute("SELECT to_regclass(%s)", (f"mongo.{table}",)).fetchone()[0]:
                conn.execute(sql.SQL("DELETE FROM {} WHERE collection = ANY(%s)").format(sql.Identifier("mongo", table)), (list(names),))
        if conn.execute("SELECT to_regclass('mongo._runtime')").fetchone()[0]:
            conn.execute("DELETE FROM mongo._runtime WHERE process = %s", (health.PROCESS,))


@pytest.fixture
def env(monkeypatch):
    a, b = f"h_{uuid.uuid4().hex[:8]}", f"h_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("DB_MODES", f"{a}=dual,{b}=shadow")
    raw = mongomock.MongoClient().db
    rt = routing._Runtime(raw, monitor=False)
    routing._runtime = rt
    yield raw, rt, a, b
    routing.shadow_drain(5)
    rt.worker.flush(5)
    _cleanup([a, b])
    rt.store.close()
    routing._runtime = None


def _log(rt, name):
    return rt.store.query("SELECT kind, missing, different, extra, queued FROM mongo._reconcile_log "
                          "WHERE collection = %s ORDER BY id", (name,))


def test_readiness_rules():
    r = health.readiness
    assert r("dual", 1.0, True, 0, 0, 0, 0) == "esperar 2.0 días más"
    assert r("dual", 3.5, True, 0, 0, 0, 0) == "LISTA para shadow"
    assert "revisar" in r("dual", 5, True, 2, 0, 0, 0)
    assert "DIFERENCIAS" in r("dual", 5, False, 0, 0, 0, 0)
    assert r("dual", None, True, 0, 0, 0, 0).startswith("el backend aún no")
    assert r("shadow", 4, True, 0, 150, 0, 0) == "LISTA para postgres"
    assert "diferencias de shadow" in r("shadow", 4, True, 0, 150, 1, 0)
    assert "más tráfico" in r("shadow", 4, True, 0, 5, 0, 0)
    assert "resueltas en Mongo" in r("postgres", 2, True, 0, 0, 0, 3)


@needs_pg
def test_monitor_does_the_initial_load_by_itself_and_records_modes_and_status(env):
    raw, rt, a, b = env
    raw[a].insert_many([{"i": i} for i in range(7)])  # ya existían antes de activar la colección
    raw[b].insert_one({"k": 1})
    rt.monitor.tick()
    rt.worker.flush(10)
    assert reconcile(raw, rt.store, a)["in_sync"] and reconcile(raw, rt.store, b)["in_sync"]
    assert _log(rt, a) == [("initial", 7, 0, 0, 7)] and _log(rt, b) == [("initial", 1, 0, 0, 1)]
    assert dict(rt.store.query("SELECT collection, mode FROM mongo._modes WHERE collection = ANY(%s)", ([a, b],))) == {a: "dual", b: "shadow"}
    status = rt.store.query("SELECT status FROM mongo._runtime WHERE process = %s", (health.PROCESS,))[0][0]
    assert status["modes"] == {a: "dual", b: "shadow"} and status["dirty"] == []
    rt.monitor.tick()  # recién conciliadas: no vuelve a tocarles hasta dentro de PGMIRROR_RECONCILE_HOURS
    assert len(_log(rt, a)) == 1


@needs_pg
def test_drift_is_repaired_through_the_worker_and_logged_as_a_correction(env, monkeypatch):
    raw, rt, a, _b = env
    db = pgmirror.wrap_database(raw)
    db[a].insert_many([{"i": i} for i in range(5)])
    rt.worker.flush(10)
    rt.monitor.tick()
    assert _log(rt, a) == [("periodic", 0, 0, 0, 0)]  # el espejo en vivo ya lo tenía todo
    # Alguien escribe en Mongo saltándose la capa, y sobra una fila en Postgres.
    raw[a].update_one({"i": 1}, {"$set": {"i": 100}})
    raw[a].insert_one({"i": 9})
    rt.store.upsert(a, [{"_id": ObjectId(), "ghost": True}])
    monkeypatch.setenv("PGMIRROR_RECONCILE_HOURS", "0.0001")
    time.sleep(0.5)
    rt.monitor.tick()
    rt.worker.flush(10)
    assert reconcile(raw, rt.store, a)["in_sync"]
    assert _log(rt, a)[-1] == ("periodic", 1, 1, 1, 3)


@needs_pg
def test_a_collection_marked_dirty_is_reconciled_soon(env):
    raw, rt, a, _b = env
    raw[a].insert_one({"i": 1})
    rt.monitor.tick()
    rt.worker.flush(10)
    raw[a].insert_one({"i": 2})  # una copia que "falló"
    rt.worker.mark_dirty(a, "prueba")
    rt.monitor._last_dirty_attempt = 0
    rt.monitor.tick()
    rt.worker.flush(10)
    assert a not in rt.worker.dirty and reconcile(raw, rt.store, a)["in_sync"]
    assert _log(rt, a)[-1] == ("dirty", 1, 0, 0, 1)


@needs_pg
def test_only_one_process_reconciles_at_a_time(env):
    import psycopg
    raw, rt, a, _b = env
    raw[a].insert_one({"i": 1})
    with psycopg.connect(TEST_PG, autocommit=True) as other:
        other.execute("SELECT pg_advisory_lock(%s)", (health.LOCK_KEY,))
        assert health.auto_reconcile(raw, rt.store, rt.worker, [a]) == []
        other.execute("SELECT pg_advisory_unlock(%s)", (health.LOCK_KEY,))
    assert len(health.auto_reconcile(raw, rt.store, rt.worker, [a])) == 1


@needs_pg
def test_counters_accumulate_without_double_counting(env):
    raw, rt, a, _b = env
    rt.bump(a, "shadow_ok", 3)
    rt.monitor.tick()
    rt.bump(a, "shadow_ok", 2)
    rt.monitor.tick()
    rt.monitor.tick()
    assert rt.store.query("SELECT sum(n) FROM mongo._counters WHERE collection = %s AND key = 'shadow_ok'", (a,))[0][0] == 5


@needs_pg
def test_check_command_says_when_a_collection_can_advance(env, monkeypatch, capsys):
    from app.pgmirror.store import Store
    raw, rt, a, b = env
    raw[a].insert_many([{"i": i} for i in range(3)])
    rt.monitor.tick()
    rt.worker.flush(10)
    rt.store.query("UPDATE mongo._modes SET since = now() - interval '4 days' WHERE collection = %s", (a,))
    spec = importlib.util.spec_from_file_location("pg_mirror_cli", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "pg_mirror.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    monkeypatch.setattr(cli, "_connect", lambda: (raw, Store(TEST_PG)))
    assert cli.main(["check"]) == 0
    line = next(row for row in capsys.readouterr().out.splitlines() if row.startswith(a))
    assert " OK " in line and "LISTA para shadow" in line


@needs_pg
def test_backend_start_only_spins_up_the_layer_when_something_is_active(monkeypatch):
    raw = mongomock.MongoClient().db
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    assert routing.start(raw) is None
    name = f"h_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    monkeypatch.setenv("DB_MODES", f"{name}=dual")
    routing._runtime = None
    try:
        assert routing.start(raw) is None  # está en DB_MODES pero no existe en Mongo
        raw[name].insert_one({"x": 1})
        assert routing.start(raw) is routing._runtime is not None
    finally:
        if routing._runtime is not None:
            routing._runtime.store.close()
        routing._runtime = None
        _cleanup([name])
