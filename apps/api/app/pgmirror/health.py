"""Vigilancia del espejo en producción, sin que nadie tenga que acordarse.

Un hilo por proceso del backend, cada minuto:
- Guarda en Postgres las estadísticas de la capa: contadores por día y colección
  (mongo._counters: copias, comparaciones de shadow, diferencias, lecturas que
  regresaron a Mongo…), el estado de este proceso (mongo._runtime) y desde cuándo
  está cada colección en su modo (mongo._modes).
- Concilia: a cada colección activa (dual/shadow/postgres) le toca una vez cada
  PGMIRROR_RECONCILE_HOURS horas (6 por defecto; 0 = apagado), y antes si quedó
  "por conciliar". Una colección recién agregada a DB_MODES recibe así su carga
  inicial al minuto (queda como kind='initial', no cuenta como error). Compara Mongo contra Postgres y lo que difiere NO lo copia
  directo: manda esos _id al SyncWorker, que relee de Mongo al aplicar, así nunca
  pisa una escritura más nueva. Lo corregido queda en mongo._reconcile_log: si
  aparece algo ahí, el espejo en vivo se saltó algo y hay que revisarlo antes de
  avanzar esa colección. Un solo proceso concilia a la vez (pg_try_advisory_lock).

`python scripts/pg_mirror.py check` lo lee todo y dice qué colección está lista
para el siguiente modo. Si Postgres falla, este hilo solo lo anota en el log.
"""
import json
import logging
import os
import socket
import threading
import time

from app.pgmirror import config
from app.pgmirror.reconcile import reconcile

log = logging.getLogger(__name__)
TICK_SECONDS = 60
DIRTY_RETRY_SECONDS = 300
LOCK_KEY = 7340211  # pg_try_advisory_lock de la conciliación automática
CHUNK = 500
PROCESS = f"{socket.gethostname()}:{os.getpid()}"

_META = [
    "CREATE SCHEMA IF NOT EXISTS mongo",
    "CREATE TABLE IF NOT EXISTS mongo._runtime (process text PRIMARY KEY, "
    "updated_at timestamptz NOT NULL DEFAULT now(), status jsonb NOT NULL)",
    "CREATE TABLE IF NOT EXISTS mongo._modes (collection text PRIMARY KEY, mode text NOT NULL, "
    "since timestamptz NOT NULL DEFAULT now())",
    "CREATE TABLE IF NOT EXISTS mongo._counters (day date NOT NULL, collection text NOT NULL, key text NOT NULL, "
    "n bigint NOT NULL, PRIMARY KEY (day, collection, key))",
    "CREATE TABLE IF NOT EXISTS mongo._reconcile_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), "
    "kind text NOT NULL, collection text NOT NULL, mongo integer, postgres integer, missing integer, "
    "different integer, extra integer, queued integer, process text)",
    "CREATE INDEX IF NOT EXISTS _reconcile_log__collection_at ON mongo._reconcile_log (collection, at)",
]
_meta_ready = set()


def ensure_meta(store):
    if id(store) in _meta_ready:
        return
    for statement in _META:
        store.query(statement)
    _meta_ready.add(id(store))


def reconcile_hours() -> float:
    try:
        return float(os.getenv("PGMIRROR_RECONCILE_HOURS", "6"))
    except ValueError:
        return 6.0


def active_collections(raw_db) -> dict:
    """{colección: modo} de las colecciones que existen en Mongo y no están en modo mongo."""
    modes = {}
    for name in raw_db.list_collection_names():
        mode = config.collection_mode(name)
        if mode != "mongo":
            modes[name] = mode
    return modes


def auto_reconcile(raw_db, store, worker, collections, kind: str = "periodic") -> list:
    """Compara y manda a copiar (vía SyncWorker) lo que difiera. [] si otro proceso ya está en eso."""
    ensure_meta(store)
    results = []
    with store.advisory_lock(LOCK_KEY) as got:
        if not got:
            return results
        for name in collections:
            # Se quita la marca ANTES de revisar: un fallo nuevo durante la revisión la vuelve a poner.
            worker.dirty.discard(name)
            result = reconcile(raw_db, store, name, want_ids=True)
            ids = result.pop("mongo_ids") + store.id_values(name, result.pop("extra_keys"))
            # Tabla vacía: es la carga inicial de una colección recién activada, no un error del espejo.
            kind_here = "initial" if result["postgres_before"] == 0 and ids else kind
            for i in range(0, len(ids), CHUNK):
                worker.enqueue(name, ids[i:i + CHUNK])
                worker.flush(timeout=120)
            store.query(
                "INSERT INTO mongo._reconcile_log (kind, collection, mongo, postgres, missing, different, extra, queued, process) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (kind_here, name, result["mongo"], result["postgres_before"], result["missing_in_postgres"],
                 result["different"], result["extra_in_postgres"], len(ids), PROCESS))
            if ids and kind_here == "initial":
                log.info("pgmirror initial load %s: %d documents copied", name, len(ids))
            elif ids:
                log.warning("pgmirror reconcile (%s) %s: %d documents were out of sync and were re-copied from Mongo",
                            kind_here, name, len(ids))
            results.append(result)
    return results


class Monitor:
    def __init__(self, rt, raw_db, *, start: bool = True):
        self._rt, self._raw_db = rt, raw_db
        self._sent = {}  # (colección, llave) → último valor ya sumado en mongo._counters
        # None = nunca: el primer intento es inmediato. (Con 0.0, en una máquina recién
        # encendida time.monotonic() es menor a 300 y el primer intento se retrasaba.)
        self._last_dirty_attempt = None
        if start:
            threading.Thread(target=self._run, name="pgmirror-monitor", daemon=True).start()

    def _run(self):
        from app.pgmirror import routing
        while True:
            time.sleep(TICK_SECONDS)
            if routing._runtime is not self._rt:
                return  # la capa se reinició (pruebas): este vigilante ya no aplica
            try:
                self.tick()
            except Exception:
                log.exception("pgmirror monitor tick failed")

    def tick(self):
        store = self._rt.store
        ensure_meta(store)
        active = active_collections(self._raw_db)
        self._record_modes(store, active)
        self._record_counters(store)
        self._record_status(store, active)
        self._maybe_reconcile(store, active)

    def _record_modes(self, store, active):
        for name, mode in active.items():
            store.query("INSERT INTO mongo._modes (collection, mode) VALUES (%s, %s) ON CONFLICT (collection) DO UPDATE "
                        "SET mode = EXCLUDED.mode, since = now() WHERE mongo._modes.mode IS DISTINCT FROM EXCLUDED.mode",
                        (name, mode))
        store.query("UPDATE mongo._modes SET mode = 'mongo', since = now() WHERE mode <> 'mongo' AND NOT (collection = ANY(%s))",
                    (list(active),))

    def _record_counters(self, store):
        with self._rt.stats_lock:
            snapshot = {(c, k): v for c, bucket in self._rt.stats.items() for k, v in bucket.items()}
        snapshot.update({("_worker", k): v for k, v in dict(self._rt.worker.stats).items()})
        for (collection, key), value in snapshot.items():
            delta = value - self._sent.get((collection, key), 0)
            if delta > 0:
                store.query("INSERT INTO mongo._counters (day, collection, key, n) VALUES (current_date, %s, %s, %s) "
                            "ON CONFLICT (day, collection, key) DO UPDATE SET n = mongo._counters.n + EXCLUDED.n",
                            (collection, key, delta))
                self._sent[(collection, key)] = value

    def _record_status(self, store, active):
        status = {"pending": self._rt.worker.pending(), "dirty": sorted(self._rt.worker.dirty),
                  "worker": dict(self._rt.worker.stats), "modes": active}
        store.query("INSERT INTO mongo._runtime (process, updated_at, status) VALUES (%s, now(), %s::jsonb) "
                    "ON CONFLICT (process) DO UPDATE SET updated_at = now(), status = EXCLUDED.status",
                    (PROCESS, json.dumps(status, default=str)))
        store.query("DELETE FROM mongo._runtime WHERE updated_at < now() - interval '1 day'")

    def _maybe_reconcile(self, store, active):
        hours = reconcile_hours()
        if hours <= 0 or not active:
            return
        recent = {row[0] for row in store.query(
            "SELECT DISTINCT collection FROM mongo._reconcile_log WHERE kind IN ('periodic', 'initial') "
            "AND at > now() - make_interval(secs => %s)", (hours * 3600,))}
        due = sorted(name for name in active if name not in recent)
        if due:
            auto_reconcile(self._raw_db, store, self._rt.worker, due, "periodic")
            return
        dirty = sorted(set(self._rt.worker.dirty) & set(active))
        if dirty and (self._last_dirty_attempt is None
                      or time.monotonic() - self._last_dirty_attempt >= DIRTY_RETRY_SECONDS):
            self._last_dirty_attempt = time.monotonic()
            auto_reconcile(self._raw_db, store, self._rt.worker, dirty, "dirty")


# ── Lectura para `pg_mirror.py check` ──────────────────────────────────────────
WAIT_DAYS = 3
MIN_SHADOW_CHECKS = 20


def readiness(mode, days_in_mode, in_sync, fixes, shadow_ok, shadow_diffs, fallbacks) -> str:
    if not in_sync:
        return "DIFERENCIAS ahora mismo: revisar, no avanzar"
    if days_in_mode is None:
        return "el backend aún no registra esta colección (se anota cada minuto)"
    wait = WAIT_DAYS - days_in_mode
    if mode == "dual":
        if fixes:
            return f"se corrigieron {fixes} docs en {WAIT_DAYS} días: revisar antes de avanzar"
        return f"esperar {wait:.1f} días más" if wait > 0 else "LISTA para shadow"
    if mode == "shadow":
        if shadow_diffs:
            return f"{shadow_diffs} diferencias de shadow: revisar antes de avanzar"
        if fixes:
            return f"se corrigieron {fixes} docs en {WAIT_DAYS} días: revisar antes de avanzar"
        if wait > 0:
            return f"esperar {wait:.1f} días más"
        if shadow_ok < MIN_SHADOW_CHECKS:
            return f"solo {shadow_ok} comparaciones: esperar más tráfico"
        return "LISTA para postgres"
    if mode == "postgres":
        extra = f" ({fallbacks} lecturas resueltas en Mongo)" if fallbacks else ""
        return f"leyendo de Postgres hace {days_in_mode:.1f} días{extra}"
    return ""
