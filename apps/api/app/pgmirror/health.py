"""Vigilancia del espejo en producción, sin que nadie tenga que acordarse.

Un hilo por proceso del backend, cada minuto:
- Guarda en Postgres las estadísticas de la capa: contadores por día y colección
  (mongo._counters: copias, comparaciones de shadow, diferencias, lecturas que
  regresaron a Mongo…), el estado de este proceso (mongo._runtime) y desde cuándo
  está cada colección en su modo (mongo._modes).
- Concilia: a cada colección activa (dual/shadow/postgres) le toca una vez cada
  PGMIRROR_RECONCILE_HOURS horas (3 por defecto; 0 = apagado), y antes si quedó
  "por conciliar". Una colección recién agregada a DB_MODES recibe así su carga
  inicial al minuto: su primera conciliación queda como kind='initial' y no cuenta
  como corrección. Compara Mongo contra Postgres y lo que difiere NO lo copia
  directo: manda esos _id al SyncWorker, que relee de Mongo al aplicar, así nunca
  pisa una escritura más nueva. Lo corregido queda en mongo._reconcile_log: si
  aparece algo ahí, el espejo en vivo se saltó algo y hay que revisarlo antes de
  avanzar esa colección. Un solo proceso concilia a la vez (pg_try_advisory_lock).
- Crea los índices de orden (store.SORT_INDEXES) que falten, sin bloquear las escrituras, y deja
  `doc` guardado sin comprimir (store.ensure_doc_storage). En modo primary, también los índices
  únicos de Mongo (store.UNICOS).
- Modo primary (Postgres manda): la conciliación va al revés (Postgres → Mongo, nunca pisa
  Postgres) y la bandeja de salida (mongo._outbox) se vuelve a copiar a Mongo si una copia en
  línea no se hizo (proceso caído, Mongo que falló).

`python scripts/pg_mirror.py check` lo lee todo y dice qué colección está lista
para el siguiente modo (tras PGMIRROR_WAIT_HOURS, 24 por defecto, sin correcciones
ni diferencias). Si Postgres falla, este hilo solo lo anota en el log.
"""
import json
import logging
import os
import socket
import threading
import time

from app.pgmirror import codec, config, primaria
from app.pgmirror.reconcile import reconcile, still_different
from app.pgmirror.store import SORT_INDEXES

log = logging.getLogger(__name__)
TICK_SECONDS = 60
DIRTY_RETRY_SECONDS = 300
INDEX_RETRY_SECONDS = 3600
LOCK_KEY = 7340211  # pg_try_advisory_lock de la conciliación automática
OUTBOX_LOCK_KEY = 7340213  # pg_try_advisory_lock de la bandeja de salida (un proceso a la vez)
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
    # Registros de antes de la regla "la primera conciliación es la carga inicial": se corrigen solos.
    "UPDATE mongo._reconcile_log l SET kind = 'initial' WHERE kind <> 'initial' "
    "AND id = (SELECT min(f.id) FROM mongo._reconcile_log f WHERE f.collection = l.collection)",
    # Colecciones "por conciliar" vistas por TODOS los procesos: en modo postgres sus lecturas
    # vuelven a Mongo hasta que una conciliación posterior a la marca la borre.
    "CREATE TABLE IF NOT EXISTS mongo._dirty (collection text PRIMARY KEY, "
    "since timestamptz NOT NULL DEFAULT now(), reason text)",
    *primaria.OUTBOX_DDL,
]
_meta_ready = set()


def ensure_meta(store):
    if id(store) in _meta_ready:
        return
    for statement in _META:
        store.query(statement)
    _meta_ready.add(id(store))


def _hours(env: str, default: float) -> float:
    try:
        return float(os.getenv(env, "") or default)
    except ValueError:
        return default


def reconcile_hours() -> float:
    return _hours("PGMIRROR_RECONCILE_HOURS", 3)


def wait_hours() -> float:
    """Tiempo mínimo en un modo, sin correcciones ni diferencias, antes de avanzar."""
    return _hours("PGMIRROR_WAIT_HOURS", 24)


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
            if config.collection_mode(name) == "primary":
                continue  # ahí manda Postgres: nunca se copia de Mongo encima (reconcile_primary)
            started = store.query("SELECT now()")[0][0]
            # Se quita la marca ANTES de revisar: un fallo nuevo durante la revisión la vuelve a poner.
            worker.dirty.discard(name)
            # La primera conciliación de una colección ES su carga inicial, aunque el espejo en vivo
            # ya haya copiado unos cuantos documentos escritos desde que se activó (contacts:
            # 75 925 de 75 927 en producción el 2026-10-20 salían como "corregidos").
            first = not store.query("SELECT 1 FROM mongo._reconcile_log WHERE collection = %s LIMIT 1", (name,))
            result = reconcile(raw_db, store, name, want_ids=True)
            mongo_ids, extra_keys = result.pop("mongo_ids"), result.pop("extra_keys")
            if not first and (mongo_ids or extra_keys):
                # Lo escrito mientras se revisaba lo copia el espejo en vivo un momento después: con la
                # cola vacía se vuelven a comparar solo esos _id, y lo que ya cuadra no es una corrección.
                worker.flush(timeout=30)
                mongo_ids, extra_keys = still_different(raw_db, store, name, mongo_ids, extra_keys)
            ids = mongo_ids + store.id_values(name, extra_keys)
            kind_here = "initial" if first else kind
            applied = True
            for i in range(0, len(ids), CHUNK):
                worker.enqueue(name, ids[i:i + CHUNK])
                applied &= worker.flush(timeout=120)
            if applied:
                # Solo marcas anteriores a esta revisión: una falla nueva sigue contando.
                store.query("DELETE FROM mongo._dirty WHERE collection = %s AND since <= %s", (name, started))
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


def reconcile_primary(raw_db, store, collections) -> list:
    """Modo primary: compara y deja Mongo igual a Postgres (nunca al revés). Lo recién escrito que
    todavía no llega a Mongo (copia en línea en camino o en la bandeja) no cuenta como corrección."""
    ensure_meta(store)
    results = []
    with store.advisory_lock(LOCK_KEY) as got:
        if not got:
            return results
        for name in collections:
            result = reconcile(raw_db, store, name, want_ids=True)  # solo lee
            mongo_ids, extra_keys = result.pop("mongo_ids"), result.pop("extra_keys")
            if mongo_ids or extra_keys:
                time.sleep(1)
                mongo_ids, extra_keys = still_different(raw_db, store, name, mongo_ids, extra_keys)
            en_bandeja = {row[0] for row in store.query("SELECT id FROM mongo._outbox WHERE collection = %s", (name,))}
            ids = [i for i in mongo_ids + store.id_values(name, extra_keys) if codec.id_key(i)[0] not in en_bandeja]
            for i in range(0, len(ids), CHUNK):
                primaria.copiar_a_mongo(raw_db[name], store, name, ids[i:i + CHUNK])
            store.query(
                "INSERT INTO mongo._reconcile_log (kind, collection, mongo, postgres, missing, different, extra, queued, process) "
                "VALUES ('primary', %s, %s, %s, %s, %s, %s, %s, %s)",
                (name, result["mongo"], result["postgres_before"], result["missing_in_postgres"],
                 result["different"], result["extra_in_postgres"], len(ids), PROCESS))
            if ids:
                log.warning("pgmirror reconcile (primary) %s: %d documents in Mongo were behind Postgres and were re-copied",
                            name, len(ids))
            results.append(result)
    return results


def drain_outbox(raw_db, store, collections, mayores_a_s: float = 30) -> int:
    """Copia a Mongo lo que la bandeja tiene de hace más de 30 s, solo de colecciones en primary (si una
    regresó a postgres, ahí Mongo vuelve a mandar y su bandeja ya no se aplica)."""
    copied = 0
    with store.advisory_lock(OUTBOX_LOCK_KEY) as got:
        if not got:
            return 0
        for name, ids in primaria.pendientes(store, mayores_a_s=mayores_a_s).items():
            if name not in collections:
                continue
            try:
                copied += primaria.copiar_a_mongo(raw_db[name], store, name, ids)
            except Exception:
                log.exception("pgmirror outbox: copy to Mongo failed for %s (%d ids); retrying next minute", name, len(ids))
    if copied:
        log.warning("pgmirror outbox: %d documents copied to Mongo late (an inline copy had not finished)", copied)
    return copied


class Monitor:
    def __init__(self, rt, raw_db, *, start: bool = True):
        self._rt, self._raw_db = rt, raw_db
        self._sent = {}  # (colección, llave) → último valor ya sumado en mongo._counters
        # None = nunca: el primer intento es inmediato. (Con 0.0, en una máquina recién
        # encendida time.monotonic() es menor a 300 y el primer intento se retrasaba.)
        self._last_dirty_attempt = None
        self._index_failures = {}  # (colección, campo, dirección) → time.monotonic() del último fallo
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
        primarias = {name for name, mode in active.items() if mode == "primary"}
        if primarias:
            n = drain_outbox(self._raw_db, store, primarias)
            if n:
                self._rt.bump("_bandeja", "copiados_tarde", n)
        self._maybe_reconcile(store, active)
        self._ensure_sort_indexes(store, active)

    def _ensure_sort_indexes(self, store, active):
        """Mantenimiento de cada colección activa: `doc` sin comprimir (store.ensure_doc_storage) y
        los índices de orden (store.SORT_INDEXES). Lo ya listo no cuesta nada. Un paso que falla no
        detiene lo demás y se reintenta en una hora."""
        for name in sorted(active):
            steps = [((name, "storage"), lambda n=name: store.ensure_doc_storage(n))]
            if active[name] == "primary":
                # Solo en primary: con la copia Mongo → Postgres (sin orden entre procesos) un valor que
                # pasa de un documento a otro podría chocar un momento y marcar la colección por conciliar.
                steps.append(((name, "unicos"), lambda n=name: store.ensure_unique_indexes(n)))
            steps += [((name, field, direction), lambda n=name, f=field, d=direction: store.ensure_sort_index(n, f, d))
                      for field, direction in SORT_INDEXES]
            for key, step in steps:
                failed_at = self._index_failures.get(key)
                if failed_at is not None and time.monotonic() - failed_at < INDEX_RETRY_SECONDS:
                    continue
                try:
                    if not step():
                        return  # otro proceso está en mantenimiento o la tabla estaba ocupada: en el siguiente minuto
                except Exception:
                    self._index_failures[key] = time.monotonic()
                    log.exception("pgmirror maintenance %s failed", key)

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
            "SELECT DISTINCT collection FROM mongo._reconcile_log WHERE kind IN ('periodic', 'initial', 'primary') "
            "AND at > now() - make_interval(secs => %s)", (hours * 3600,))}
        primarias = {name for name, mode in active.items() if mode == "primary"}
        due = sorted(name for name in active if name not in recent)
        if due:
            if [n for n in due if n not in primarias]:
                auto_reconcile(self._raw_db, store, self._rt.worker, [n for n in due if n not in primarias], "periodic")
            if [n for n in due if n in primarias]:
                reconcile_primary(self._raw_db, store, [n for n in due if n in primarias])
            return
        dirty = sorted((set(self._rt.worker.dirty) & set(active)) - primarias)
        if dirty and (self._last_dirty_attempt is None
                      or time.monotonic() - self._last_dirty_attempt >= DIRTY_RETRY_SECONDS):
            self._last_dirty_attempt = time.monotonic()
            auto_reconcile(self._raw_db, store, self._rt.worker, dirty, "dirty")


# ── Lectura para `pg_mirror.py check` ──────────────────────────────────────────
MIN_SHADOW_CHECKS = 20


MIN_WRITE_CHECKS = 20


def readiness(mode, hours_in_mode, in_sync, fixes, shadow_ok, shadow_diffs, fallbacks, wait=None, escrituras=None) -> str:
    wait = wait_hours() if wait is None else wait
    if mode == "primary":
        estado = "Postgres manda" if hours_in_mode is None else f"Postgres manda hace {hours_in_mode:.1f} h"
        if fixes:
            estado += f" · {fixes} docs de la copia de Mongo se corrigieron: revisar"
        return estado + ("" if in_sync else " · la copia de Mongo va atrás ahora mismo (la bandeja la alcanza)")
    if not in_sync:
        return "DIFERENCIAS ahora mismo: revisar, no avanzar"
    if hours_in_mode is None:
        return "el backend aún no registra esta colección (se anota cada minuto)"
    left = wait - hours_in_mode
    if mode == "dual":
        if fixes:
            return f"se corrigieron {fixes} docs en {wait:g} h: revisar antes de avanzar"
        return f"esperar {left:.1f} h más" if left > 0 else "LISTA para shadow"
    if mode == "shadow":
        if shadow_diffs:
            return f"{shadow_diffs} diferencias de shadow: revisar antes de avanzar"
        if fixes:
            return f"se corrigieron {fixes} docs en {wait:g} h: revisar antes de avanzar"
        if left > 0:
            return f"esperar {left:.1f} h más"
        if shadow_ok < MIN_SHADOW_CHECKS:
            return f"solo {shadow_ok} comparaciones: esperar más tráfico"
        return "LISTA para postgres"
    if mode == "postgres":
        extra = f" ({fallbacks} lecturas resueltas en Mongo)" if fallbacks else ""
        base = f"leyendo de Postgres hace {hours_in_mode:.1f} h{extra}"
        e = escrituras or {}
        if e.get("dif"):
            return f"{base} · {e['dif']} diferencias del motor de escrituras: revisar antes de primary"
        if fixes or left > 0 or e.get("ok", 0) < MIN_WRITE_CHECKS:
            return base
        return f"{base} · LISTA para primary"
    return ""
