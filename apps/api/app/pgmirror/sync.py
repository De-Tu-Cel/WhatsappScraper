"""Copia en segundo plano de Mongo → Postgres (modo dual/shadow/postgres).

Después de cada escritura en Mongo la capa de enrutamiento manda aquí los _id que
pudieron cambiar. El hilo vuelve a leer ESOS documentos de Mongo (la fuente de
verdad) y los deja iguales en Postgres; si ya no existen en Mongo, los borra.
Como siempre copia el estado actual, el orden de llegada no importa y repetir es
inofensivo. Si Postgres falla o la cola se llena, la colección queda marcada como
"pendiente de conciliar" (scripts/pg_mirror.py reconcile la arregla) y la app
sigue funcionando: nunca se bloquea ni falla una petición por esto.
"""
import logging
import queue
import threading
import time
from collections import Counter

from app.pgmirror import codec

log = logging.getLogger(__name__)
BATCH = 500


class SyncWorker:
    def __init__(self, raw_db, store, *, maxsize: int = 20000, retries: int = 3):
        self._raw_db = raw_db
        self._store = store
        self._queue: queue.Queue = queue.Queue(maxsize=maxsize)
        self._retries = retries
        self._thread = None
        self._lock = threading.Lock()
        self.dirty: set[str] = set()
        self.stats = Counter()
        self.on_dirty = None  # callback(colección, motivo): la capa la anota también en Postgres

    def enqueue(self, collection: str, ids) -> None:
        ids = [i for i in ids if i is not None]
        if not ids:
            return
        self._start()
        try:
            self._queue.put_nowait((collection, ids))
        except queue.Full:
            self.stats["dropped"] += len(ids)
            self.mark_dirty(collection, "queue full")

    def mark_dirty(self, collection: str, reason: str) -> None:
        self.dirty.add(collection)
        self.stats["dirty_marks"] += 1
        log.warning("pgmirror: %s needs reconcile (%s)", collection, reason)
        if self.on_dirty is not None:
            try:
                self.on_dirty(collection, reason)
            except Exception:
                log.exception("pgmirror could not record %s as dirty", collection)

    def flush(self, timeout: float = 10.0) -> bool:
        """Espera a que la cola se vacíe (pruebas y apagado ordenado)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._queue.unfinished_tasks == 0:
                return True
            time.sleep(0.01)
        return False

    def pending(self) -> int:
        return self._queue.unfinished_tasks

    def _start(self):
        if self._thread and self._thread.is_alive():
            return
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._run, name="pgmirror-sync", daemon=True)
            self._thread.start()

    def _run(self):
        carry = None
        while True:
            collection, ids = carry or self._queue.get()
            carry, batch, taken = None, list(ids), 1
            # Junta lo que ya esté esperando para la misma colección; lo de otra
            # colección se guarda aparte para la siguiente vuelta (no se re-encola).
            while len(batch) < BATCH:
                try:
                    nxt = self._queue.get_nowait()
                except queue.Empty:
                    break
                if nxt[0] != collection:
                    carry = nxt
                    break
                batch.extend(nxt[1])
                taken += 1
            try:
                self._sync_with_retry(collection, batch)
            finally:
                for _ in range(taken):
                    self._queue.task_done()

    def _sync_with_retry(self, collection, ids):
        for attempt in range(1, self._retries + 1):
            try:
                self.sync_ids(collection, ids)
                self.stats["synced"] += len(ids)
                return
            except Exception:
                if attempt == self._retries:
                    self.stats["errors"] += 1
                    self.mark_dirty(collection, "sync failed")
                    log.exception("pgmirror sync failed for %s (%d ids)", collection, len(ids))
                    return
                time.sleep(0.2 * attempt)

    def sync_ids(self, collection: str, ids) -> None:
        """Relee esos documentos de Mongo y los deja iguales en Postgres (candado por documento:
        ver Store.replace_from_source). También lo usa el modo postgres al escribir, en línea."""
        unique = list({codec.id_key(i): i for i in ids}.values())
        self._store.replace_from_source(
            collection, unique, lambda batch: list(self._raw_db[collection].find({"_id": {"$in": batch}})))
