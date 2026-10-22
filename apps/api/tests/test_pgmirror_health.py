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
        for table in ("_modes", "_counters", "_reconcile_log", "_shadow_diffs", "_reviews"):
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


def test_readiness_rules(monkeypatch):
    r = health.readiness
    assert health.wait_hours() == 24 and health.reconcile_hours() == 3
    assert r("dual", 6.0, True, 0, 0, 0, 0) == "esperar 18.0 h más"
    assert r("dual", 25, True, 0, 0, 0, 0) == "LISTA para shadow"
    assert "revisar" in r("dual", 30, True, 2, 0, 0, 0)
    assert "DIFERENCIAS" in r("dual", 30, False, 0, 0, 0, 0)
    assert r("dual", None, True, 0, 0, 0, 0).startswith("el backend aún no")
    assert r("shadow", 25, True, 0, 150, 0, 0) == "LISTA para postgres"
    assert "diferencias de shadow" in r("shadow", 25, True, 0, 150, 1, 0)
    assert "más tráfico" in r("shadow", 25, True, 0, 5, 0, 0)
    assert "resueltas en Mongo" in r("postgres", 2, True, 0, 0, 0, 3)
    monkeypatch.setenv("PGMIRROR_WAIT_HOURS", "6")
    assert r("dual", 7, True, 0, 0, 0, 0) == "LISTA para shadow"
    monkeypatch.setenv("PGMIRROR_WAIT_HOURS", "")  # vacía (como la pasa docker-compose) = valor por defecto
    assert health.wait_hours() == 24


def test_primary_readiness_rejects_write_comparison_errors():
    result = health.readiness("postgres", 48, True, 0, 0, 0, 0, wait=24,
                              escrituras={"ok": 100, "error": 1})
    assert "LISTA para primary" not in result
    assert "errores al comparar escrituras" in result


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
    assert _log(rt, a) == [("initial", 0, 0, 0, 0)]  # el espejo en vivo ya lo tenía todo
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
def test_a_write_the_live_mirror_copies_during_the_check_is_not_a_correction(env, monkeypatch):
    # Producción 2026-10-21: contacts se escribe cada ~30 s; la conciliación vio Mongo ya nuevo y
    # Postgres un segundo antes de que el espejo en vivo lo copiara, y lo contó como corregido.
    raw, rt, a, _b = env
    db = pgmirror.wrap_database(raw)
    db[a].insert_many([{"i": i} for i in range(5)])
    rt.worker.flush(10)
    rt.monitor.tick()
    raw[a].update_one({"i": 2}, {"$set": {"checked": 1}})  # escrita; su copia en vivo todavía no llega
    in_flight = raw[a].find_one({"i": 2})["_id"]
    flush = rt.worker.flush

    def flush_with_the_copy_landing(timeout=None):
        rt.store.upsert(a, [raw[a].find_one({"_id": in_flight})])  # la copia en vivo llega mientras se vacía la cola
        return flush(timeout)
    monkeypatch.setattr(rt.worker, "flush", flush_with_the_copy_landing)
    monkeypatch.setenv("PGMIRROR_RECONCILE_HOURS", "0.0001")
    time.sleep(0.5)
    rt.monitor.tick()
    assert _log(rt, a)[-1] == ("periodic", 0, 1, 0, 0)  # se vio distinto, pero no se corrigió nada


@needs_pg
def test_live_writes_before_the_first_reconcile_do_not_turn_the_initial_load_into_corrections(env):
    # Producción 2026-10-20: contacts tenía 2 docs copiados en vivo cuando llegó la primera
    # conciliación, y los otros 75 925 salieron como "corregidos".
    raw, rt, a, _b = env
    raw[a].insert_many([{"i": i} for i in range(50)])  # ya existían en Mongo
    pgmirror.wrap_database(raw)[a].insert_many([{"live": i} for i in range(2)])  # la app escribe tras el deploy
    rt.worker.flush(10)
    rt.monitor.tick()
    rt.worker.flush(10)
    assert _log(rt, a) == [("initial", 50, 0, 0, 50)]
    assert reconcile(raw, rt.store, a)["in_sync"]


@needs_pg
def test_old_log_rows_are_reclassified_automatically(env):
    raw, rt, a, _b = env
    for queued in (75925, 0):
        rt.store.query("INSERT INTO mongo._reconcile_log (kind, collection, queued) VALUES ('periodic', %s, %s)", (a, queued))
    health._meta_ready.discard(id(rt.store))
    health.ensure_meta(rt.store)  # corre al arrancar cada proceso (y en `check`)
    assert [(k, q) for k, *_x, q in _log(rt, a)] == [("initial", 75925), ("periodic", 0)]


@needs_pg
def test_a_collection_marked_dirty_is_reconciled_soon(env, monkeypatch):
    raw, rt, a, _b = env
    # Máquina recién encendida (como los runners de CI): time.monotonic() aún es chico.
    clock = {"now": 10.0}
    monkeypatch.setattr(health.time, "monotonic", lambda: clock["now"])
    raw[a].insert_one({"i": 1})
    rt.monitor.tick()
    rt.worker.flush(10)
    raw[a].insert_one({"i": 2})  # una copia que "falló"
    rt.worker.mark_dirty(a, "prueba")
    rt.monitor.tick()  # el primer intento es inmediato
    rt.worker.flush(10)
    assert a not in rt.worker.dirty and reconcile(raw, rt.store, a)["in_sync"]
    assert _log(rt, a)[-1] == ("dirty", 1, 0, 0, 1)
    # Los siguientes esperan DIRTY_RETRY_SECONDS entre intentos.
    rt.worker.mark_dirty(a, "prueba")
    rt.monitor.tick()
    assert len(_log(rt, a)) == 2
    clock["now"] += health.DIRTY_RETRY_SECONDS
    rt.monitor.tick()
    assert len(_log(rt, a)) == 3 and a not in rt.worker.dirty


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
    out = capsys.readouterr().out
    line = next(row for row in out.splitlines() if row.startswith(a))
    assert " OK " in line and "LISTA para shadow" in line
    # El vigilante también creó los índices de orden de las colecciones activas.
    assert "Índices de orden (created_at -1, created_at +1): 2 de 2 listos" in out


@needs_pg
def test_reviewed_shadow_diffs_are_shown_then_discarded_and_the_clock_restarts(env, monkeypatch, capsys):
    # Prod 2026-10-20: 245 diferencias falsas (comparador corregido) bloqueaban hasta pasado mañana.
    from app.pgmirror.store import Store
    raw, rt, _a, b = env
    raw[b].insert_many([{"i": i} for i in range(3)])
    rt.monitor.tick()
    rt.worker.flush(10)
    rt.store.query("UPDATE mongo._modes SET since = now() - interval '4 days' WHERE collection = %s", (b,))
    rt.bump(b, "shadow_ok", 30)
    rt.bump(b, "shadow_diffs", 2)
    rt.store.record_diff(b, "find_one:contenido", "filter={'instance': 'gely-wa'} mongo=1 postgres=1")
    rt.monitor.tick()
    spec = importlib.util.spec_from_file_location("pg_mirror_cli", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "pg_mirror.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    monkeypatch.setattr(cli, "_connect", lambda: (raw, Store(TEST_PG)))

    def linea():
        cli.main(["check"])
        out = capsys.readouterr().out
        return next(row for row in out.splitlines() if row.startswith(b)), out
    fila, _ = linea()
    assert "2 diferencias de shadow" in fila

    assert cli.main(["revisadas", b]) == 0  # sin --confirmar: solo muestra
    out = capsys.readouterr().out
    assert "30 comparaciones iguales, 2 diferencias" in out and "gely-wa" in out and "No se cambió nada" in out
    assert "2 diferencias de shadow" in linea()[0]

    assert cli.main(["revisadas", b, "--confirmar", "--nota", "carrera entre leer e incrementar"]) == 0
    capsys.readouterr()
    rt.bump(b, "shadow_unsupported", 7)
    rt.bump(b, "shadow_raced", 3)
    rt.monitor.tick()
    fila, out = linea()
    assert "esperar" in fila and "diferencias" not in fila  # reloj nuevo, sin las descartadas
    assert "gely-wa" not in out  # el listado del check ya no las muestra
    # Y dice por qué una colección junta pocas comparaciones, y cuántas cuadraron al releer Mongo.
    assert f"  {b}: 7 consultas que Postgres no traduce" in out and f"{b} 3" in out
    assert rt.store.query("SELECT count(*) FROM mongo._shadow_diffs WHERE collection = %s", (b,))[0][0] == 1  # la evidencia queda
    assert rt.store.query("SELECT note FROM mongo._reviews WHERE collection = %s", (b,))[0][0] == "carrera entre leer e incrementar"


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
