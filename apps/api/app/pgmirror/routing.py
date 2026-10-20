"""Enrutamiento por colección: MongoDBManager.db pasa por aquí.

- Modo `mongo` (o sin POSTGRES_URL): se regresa la colección de pymongo tal cual.
- `dual`: las escrituras van a Mongo igual que hoy y luego se avisa al
  SyncWorker qué _id copiar. Las lecturas, a Mongo.
- `shadow`: como dual, y find / find_one / count_documents / distinct además se
  comparan contra Postgres en un hilo aparte (la petición no espera) y se registra
  cualquier diferencia. Siempre se responde con Mongo.
- `postgres`: como dual, pero find / find_one / count_documents / distinct /
  estimated_document_count se leen de Postgres. Lo que el traductor no soporta, o
  cualquier error de Postgres (también a mitad de un cursor), se lee de Mongo — nunca
  se adivina.
Todo lo demás (aggregate, create_index, …) va directo a Mongo.
"""
import json
import logging
import queue
import threading
import time

from app.pgmirror import codec, config, sqlfilter

log = logging.getLogger(__name__)
MAX_PREQUERY = 1000
SHADOW_FIND_MAX = 1000  # resultados más grandes no se comparan (bump shadow_skipped_large)
_PG_READ_KWARGS = {"projection", "sort", "skip", "limit", "max_time_ms", "batch_size"}


class _ShadowQueue:
    """Comparaciones del modo shadow en un hilo propio: la petición nunca espera a Postgres."""

    def __init__(self, maxsize=500):
        self._queue = queue.Queue(maxsize)
        threading.Thread(target=self._run, name="pgmirror-shadow", daemon=True).start()

    def submit(self, fn) -> bool:
        try:
            self._queue.put_nowait(fn)
            return True
        except queue.Full:
            return False

    def _run(self):
        while True:
            fn = self._queue.get()
            try:
                fn()
            except Exception:
                log.exception("pgmirror shadow task failed")
            finally:
                self._queue.task_done()

    def drain(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)
        return not self._queue.unfinished_tasks


class _Runtime:
    def __init__(self, raw_db):
        from app.pgmirror.store import Store
        from app.pgmirror.sync import SyncWorker
        self.store = Store(config.postgres_url())
        self.worker = SyncWorker(raw_db, self.store)
        self.shadow = _ShadowQueue()
        self.stats = {}
        self.stats_lock = threading.Lock()

    def bump(self, collection, key, n=1):
        with self.stats_lock:
            bucket = self.stats.setdefault(collection, {})
            bucket[key] = bucket.get(key, 0) + n


_runtime = None
_runtime_lock = threading.Lock()
_runtime_failed_at = 0.0


def get_runtime(raw_db):
    global _runtime, _runtime_failed_at
    if _runtime is not None:
        return _runtime
    if time.monotonic() - _runtime_failed_at < 60:
        return None
    with _runtime_lock:
        if _runtime is None:
            try:
                _runtime = _Runtime(raw_db)
            except Exception:
                _runtime_failed_at = time.monotonic()
                log.exception("pgmirror unavailable; collections stay on Mongo only (run reconcile later)")
                return None
    return _runtime


def route_collection(raw_db, name: str):
    mode = config.collection_mode(name)
    raw = raw_db[name]
    if mode == "mongo":
        return raw
    rt = get_runtime(raw_db)
    return raw if rt is None else RoutedCollection(raw, name, mode, rt)


class RoutedDatabase:
    """Se comporta como pymongo.database.Database; las colecciones se enrutan."""

    def __init__(self, raw_db):
        object.__setattr__(self, "_raw", raw_db)

    def __getattr__(self, name):
        if name.startswith("_") or hasattr(type(self._raw), name):
            return getattr(self._raw, name)
        return route_collection(self._raw, name)

    def __getitem__(self, name):
        return route_collection(self._raw, name)

    def get_collection(self, name, *args, **kwargs):
        if args or kwargs:
            return self._raw.get_collection(name, *args, **kwargs)
        return route_collection(self._raw, name)

    def __repr__(self):
        return f"RoutedDatabase({self._raw!r})"


def _mongo_cursor(coll, filter_, projection, sort, skip, limit):
    cursor = coll._raw.find(filter_, projection)
    if sort:
        cursor = cursor.sort(sort)
    if skip:
        cursor = cursor.skip(skip)
    if limit:
        cursor = cursor.limit(limit)
    return cursor


def _sort_list(key_or_list, direction=None):
    if isinstance(key_or_list, str):
        return [(key_or_list, direction if direction is not None else 1)]
    return list(key_or_list.items()) if isinstance(key_or_list, dict) else list(key_or_list)


class PgCursor:
    """Cursor sobre Postgres que se usa como el de pymongo (sort/skip/limit, iterar,
    next, rewind, clone, close, with). Cualquier otro método del cursor hace que la
    consulta se resuelva en Mongo, igual que un error de Postgres al leer."""

    def __init__(self, coll, filter_, projection, sort=None, skip=0, limit=0):
        self._coll, self._filter, self._projection = coll, filter_, projection
        self._sort, self._skip, self._limit = sort, skip or 0, limit or 0
        self._docs, self._pos = None, 0

    def sort(self, key_or_list, direction=None):
        self._sort = _sort_list(key_or_list, direction)
        return self

    def skip(self, n):
        self._skip = n
        return self

    def limit(self, n):
        self._limit = n
        return self

    def batch_size(self, _n):
        return self

    def max_time_ms(self, _ms):
        return self

    def _load(self):
        if self._docs is None:
            try:
                self._docs = self._coll._pg_find(self._filter, self._projection, self._sort, self._skip, self._limit)
            except Exception as exc:
                self._coll._fallback("find", exc)
                self._docs = list(_mongo_cursor(self._coll, self._filter, self._projection, self._sort, self._skip, self._limit))
        return self._docs

    def __iter__(self):
        return self

    def __next__(self):
        docs = self._load()
        if self._pos >= len(docs):
            raise StopIteration
        self._pos += 1
        return docs[self._pos - 1]

    next = __next__

    def rewind(self):
        self._pos = 0
        return self

    def clone(self):
        return PgCursor(self._coll, self._filter, self._projection, self._sort, self._skip, self._limit)

    def close(self):
        self._docs, self._pos = [], 0

    @property
    def alive(self):
        return self._docs is None or self._pos < len(self._docs)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __getattr__(self, name):
        # Algo que este cursor no conoce: la misma consulta, resuelta en Mongo.
        self._coll._rt.bump(self._coll._name, "pg_fallback_cursor")
        cursor = _mongo_cursor(self._coll, self._filter, self._projection, self._sort, self._skip, self._limit)
        return getattr(cursor, name)


def _path_value(doc, field):
    node = doc
    for part in field.split("."):
        node = node.get(part) if isinstance(node, dict) else None
    return node


def _snapshot(doc, sort_fields):
    """(id, huella, valores de sort) tomados ANTES de que la app pueda modificar el documento."""
    key = codec.id_key(doc["_id"])[0] if isinstance(doc, dict) and "_id" in doc else None
    sort_values = tuple(json.dumps(codec.encode_value(_path_value(doc, f)), sort_keys=True) for f in sort_fields)
    return key, codec.doc_hash(doc), sort_values


class ShadowCursor:
    """Envuelve el cursor de pymongo en modo shadow: la app recibe exactamente los
    documentos de Mongo; al agotarse, el mismo resultado se compara contra Postgres en
    segundo plano. Si la app usa algo fuera de lo básico, simplemente no se compara."""

    def __init__(self, coll, cursor, filter_, projection, sort, skip, limit):
        self._coll, self._cursor = coll, cursor
        self._filter, self._projection = filter_, projection
        self._sort, self._skip, self._limit = (_sort_list(sort) if sort else None), skip or 0, limit or 0
        self._seen, self._tracking, self._submitted = [], True, False

    def sort(self, key_or_list, direction=None):
        self._cursor.sort(key_or_list, direction) if direction is not None else self._cursor.sort(key_or_list)
        self._sort = _sort_list(key_or_list, direction)
        return self

    def skip(self, n):
        self._cursor.skip(n)
        self._skip = n
        return self

    def limit(self, n):
        self._cursor.limit(n)
        self._limit = n
        return self

    def batch_size(self, n):
        self._cursor.batch_size(n)
        return self

    def max_time_ms(self, ms):
        self._cursor.max_time_ms(ms)
        return self

    def __iter__(self):
        return self

    def __next__(self):
        try:
            doc = next(self._cursor)
        except StopIteration:
            if self._tracking and not self._submitted:
                self._submitted = True
                try:
                    self._coll._submit_find_compare(self._filter, self._projection, self._sort, self._skip,
                                                    self._limit, self._seen)
                except Exception:
                    log.exception("pgmirror shadow find submit failed for %s", self._coll._name)
            raise
        if self._tracking:
            if len(self._seen) >= SHADOW_FIND_MAX:
                self._tracking, self._seen = False, []
                self._coll._rt.bump(self._coll._name, "shadow_skipped_large")
            else:
                try:
                    self._seen.append(_snapshot(doc, [f for f, _ in (self._sort or [])]))
                except Exception:
                    self._tracking = False
        return doc

    next = __next__

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._cursor.close()

    def __getattr__(self, name):
        self._tracking = False
        return getattr(self._cursor, name)


def _same_result(mongo_rows, pg_rows, sorted_, windowed) -> str | None:
    """None si son equivalentes; si no, el tipo de diferencia."""
    if len(mongo_rows) != len(pg_rows):
        return "cantidad"
    if mongo_rows == pg_rows:
        return None
    pg_hash = {r[0]: r[1] for r in pg_rows if r[0] is not None}
    if any(r[0] in pg_hash and pg_hash[r[0]] != r[1] for r in mongo_rows):
        return "contenido"  # el mismo documento, distinto en Postgres
    if sorted_:
        if [r[2] for r in mongo_rows] != [r[2] for r in pg_rows]:
            return "orden"
        # Empates: mismos valores de sort en el mismo orden; dentro de un empate Mongo
        # tampoco garantiza qué documento va primero.
        if windowed or sorted(mongo_rows) == sorted(pg_rows):
            return None
        return "contenido"
    if sorted(mongo_rows) == sorted(pg_rows):
        return None  # sin sort el orden no está garantizado
    return "orden-natural" if windowed else "contenido"  # con limit, distinto orden natural = otros documentos


class RoutedCollection:
    def __init__(self, raw, name, mode, rt):
        self._raw, self._name, self._mode, self._rt = raw, name, mode, rt

    def __getattr__(self, attr):
        return getattr(self._raw, attr)

    def __getitem__(self, key):
        return self._raw[key]

    def __repr__(self):
        return f"RoutedCollection({self._name!r}, mode={self._mode!r})"

    # ── Escrituras: Mongo primero, luego copiar esos _id ─────────────────────────
    def _mirror(self, ids):
        try:
            self._rt.worker.enqueue(self._name, list(ids))
        except Exception:
            log.exception("pgmirror enqueue failed for %s", self._name)

    def _dirty(self, reason):
        try:
            self._rt.worker.mark_dirty(self._name, reason)
        except Exception:
            log.exception("pgmirror mark_dirty failed for %s", self._name)

    def _ids_for(self, filter_, **kwargs) -> list:
        if isinstance(filter_, dict) and list(filter_) == ["_id"] and not isinstance(filter_["_id"], dict):
            return [filter_["_id"]]
        try:
            find_kwargs = {"session": kwargs["session"]} if kwargs.get("session") is not None else {}
            ids = [d["_id"] for d in self._raw.find(filter_, {"_id": 1}, **find_kwargs).limit(MAX_PREQUERY + 1)]
        except Exception:
            self._dirty("pre-query failed")
            return []
        if len(ids) > MAX_PREQUERY:
            self._dirty(f"write touches more than {MAX_PREQUERY} documents")
            return ids[:MAX_PREQUERY]
        return ids

    def insert_one(self, document, *args, **kwargs):
        result = self._raw.insert_one(document, *args, **kwargs)
        self._mirror([result.inserted_id])
        return result

    def insert_many(self, documents, *args, **kwargs):
        documents = list(documents)
        try:
            result = self._raw.insert_many(documents, *args, **kwargs)
        except Exception:
            # Inserción parcial (p. ej. duplicado a la mitad): copiar lo que sí entró.
            self._mirror([d.get("_id") for d in documents if isinstance(d, dict)])
            raise
        self._mirror(result.inserted_ids)
        return result

    def _write_by_filter(self, method, filter_, *args, **kwargs):
        ids = self._ids_for(filter_, **kwargs)
        result = getattr(self._raw, method)(filter_, *args, **kwargs)
        upserted = getattr(result, "upserted_id", None)
        self._mirror(ids + ([upserted] if upserted is not None else []))
        return result

    def update_one(self, filter, update, *args, **kwargs):
        return self._write_by_filter("update_one", filter, update, *args, **kwargs)

    def update_many(self, filter, update, *args, **kwargs):
        return self._write_by_filter("update_many", filter, update, *args, **kwargs)

    def replace_one(self, filter, replacement, *args, **kwargs):
        return self._write_by_filter("replace_one", filter, replacement, *args, **kwargs)

    def delete_one(self, filter, *args, **kwargs):
        return self._write_by_filter("delete_one", filter, *args, **kwargs)

    def delete_many(self, filter, *args, **kwargs):
        return self._write_by_filter("delete_many", filter, *args, **kwargs)

    def _find_and_modify(self, method, filter_, *args, **kwargs):
        ids = self._ids_for(filter_, **kwargs)
        doc = getattr(self._raw, method)(filter_, *args, **kwargs)
        if isinstance(doc, dict) and "_id" in doc:
            ids.append(doc["_id"])
        if not ids and kwargs.get("upsert"):
            ids = self._ids_for(filter_, **kwargs)
            if not ids:
                self._dirty(f"{method} upsert without a resolvable _id")
        self._mirror(ids)
        return doc

    def find_one_and_update(self, filter, update, *args, **kwargs):
        return self._find_and_modify("find_one_and_update", filter, update, *args, **kwargs)

    def find_one_and_replace(self, filter, replacement, *args, **kwargs):
        return self._find_and_modify("find_one_and_replace", filter, replacement, *args, **kwargs)

    def find_one_and_delete(self, filter, *args, **kwargs):
        return self._find_and_modify("find_one_and_delete", filter, *args, **kwargs)

    def bulk_write(self, requests, *args, **kwargs):
        try:
            return self._raw.bulk_write(requests, *args, **kwargs)
        finally:
            self._dirty("bulk_write")

    def drop(self, *args, **kwargs):
        try:
            return self._raw.drop(*args, **kwargs)
        finally:
            self._dirty("drop")

    # ── Lecturas ────────────────────────────────────────────────────────────────
    def _pg_find(self, filter_, projection, sort, skip, limit):
        where = sqlfilter.where(filter_)
        plan = sqlfilter.sort_plan(sort)
        sqlfilter.check_projection(projection)
        docs = self._rt.store.query_docs(self._name, where, plan=plan, limit=limit or None, skip=skip or 0)
        return [sqlfilter.apply_projection(d, projection) for d in docs]

    def _fallback(self, op, exc):
        self._rt.bump(self._name, f"pg_fallback_{op}")
        if not isinstance(exc, sqlfilter.Unsupported):
            log.warning("pgmirror %s.%s read fell back to Mongo: %s", self._name, op, exc)

    @staticmethod
    def _plain_read(filter_, args, kwargs) -> bool:
        return isinstance(filter_, (dict, type(None))) and len(args) <= 1 and not (set(kwargs) - _PG_READ_KWARGS)

    def find(self, filter=None, *args, **kwargs):
        if self._mode == "dual":
            return self._raw.find(filter, *args, **kwargs)
        projection = args[0] if args else kwargs.get("projection")
        if self._mode == "shadow":
            cursor = self._raw.find(filter, *args, **kwargs)
            if not self._plain_read(filter, args, kwargs):
                return cursor
            return ShadowCursor(self, cursor, filter, projection, kwargs.get("sort"), kwargs.get("skip", 0), kwargs.get("limit", 0))
        if not self._plain_read(filter, args, kwargs):
            self._rt.bump(self._name, "pg_fallback_find_args")
            return self._raw.find(filter, *args, **kwargs)
        try:
            # Validar antes de prometer un cursor de Postgres.
            sqlfilter.where(filter)
            sqlfilter.sort_items(kwargs.get("sort"))
            sqlfilter.check_projection(projection)
            return PgCursor(self, filter, projection, kwargs.get("sort"), kwargs.get("skip", 0), kwargs.get("limit", 0))
        except Exception as exc:
            self._fallback("find", exc)
            return self._raw.find(filter, *args, **kwargs)

    def find_one(self, filter=None, *args, **kwargs):
        if self._mode == "dual":
            return self._raw.find_one(filter, *args, **kwargs)
        if not isinstance(filter, (dict, type(None))) and filter is not None:
            # find_one(ObjectId(...)) equivale a find_one({"_id": ...}).
            filter = {"_id": filter}
        projection = args[0] if args else kwargs.get("projection")
        if self._mode == "shadow":
            result = self._raw.find_one(filter, *args, **kwargs)
            if self._plain_read(filter, args, kwargs):
                try:
                    sort_fields = [f for f, _ in sqlfilter.sort_items(kwargs.get("sort"))]
                    rows = [_snapshot(result, sort_fields)] if result is not None else []
                    self._submit_find_compare(filter, projection, kwargs.get("sort"), kwargs.get("skip", 0), 1, rows, op="find_one")
                except Exception:
                    self._rt.bump(self._name, "shadow_unsupported")
            return result
        if not self._plain_read(filter, args, kwargs):
            self._rt.bump(self._name, "pg_fallback_find_one_args")
            return self._raw.find_one(filter, *args, **kwargs)
        try:
            docs = self._pg_find(filter, projection, kwargs.get("sort"), kwargs.get("skip", 0), 1)
            return docs[0] if docs else None
        except Exception as exc:
            self._fallback("find_one", exc)
            return self._raw.find_one(filter, *args, **kwargs)

    def count_documents(self, filter, *args, **kwargs):
        if self._mode == "dual" or args or kwargs:
            return self._raw.count_documents(filter, *args, **kwargs)
        if self._mode == "shadow":
            result = self._raw.count_documents(filter)
            self._shadow(lambda: self._compare_value("count_documents", filter, result,
                                                     lambda: self._rt.store.count(self._name, sqlfilter.where(filter))))
            return result
        try:
            return self._rt.store.count(self._name, sqlfilter.where(filter))
        except Exception as exc:
            self._fallback("count_documents", exc)
            return self._raw.count_documents(filter)

    def estimated_document_count(self, *args, **kwargs):
        if self._mode != "postgres" or args or kwargs:
            return self._raw.estimated_document_count(*args, **kwargs)
        try:
            return self._rt.store.count(self._name, sqlfilter.where(None))
        except Exception as exc:
            self._fallback("estimated_document_count", exc)
            return self._raw.estimated_document_count()

    def _pg_distinct(self, key, filter_):
        values, seen = [], set()
        for doc in self._pg_find(filter_, {key: 1}, None, 0, 0):
            found = sqlfilter.path_values(doc, key)
            if not found:
                # Mongo agrega null por los documentos sin el campo solo cuando responde desde un
                # índice de ese campo (depende de su plan). No se adivina: lo resuelve Mongo.
                raise sqlfilter.Unsupported("distinct con documentos sin el campo")
            for value in found:
                marker = sqlfilter.distinct_marker(value)
                if marker not in seen:
                    seen.add(marker)
                    values.append(value)
        return values

    def distinct(self, key, filter=None, *args, **kwargs):
        if self._mode == "dual" or args or kwargs:
            return self._raw.distinct(key, filter, *args, **kwargs)
        if self._mode == "shadow":
            result = self._raw.distinct(key, filter)
            expected = sorted(map(repr, (sqlfilter.distinct_marker(v) for v in result)))
            self._shadow(lambda: self._compare_value(
                f"distinct:{key}", filter, expected,
                lambda: sorted(map(repr, (sqlfilter.distinct_marker(v) for v in self._pg_distinct(key, filter))))))
            return result
        try:
            return self._pg_distinct(key, filter)
        except Exception as exc:
            self._fallback("distinct", exc)
            return self._raw.distinct(key, filter)

    # ── Comparación en modo shadow (en segundo plano) ───────────────────────────
    def _shadow(self, compare):
        def run():
            try:
                compare()
            except sqlfilter.Unsupported:
                self._rt.bump(self._name, "shadow_unsupported")
            except Exception:
                self._rt.bump(self._name, "shadow_errors")
                log.exception("pgmirror shadow compare failed for %s", self._name)
        if not self._rt.shadow.submit(run):
            self._rt.bump(self._name, "shadow_skipped_busy")

    def _settled(self, check) -> bool:
        """La copia es asíncrona: si no cuadra y hay copias pendientes, espera un
        momento y vuelve a comparar antes de llamarlo diferencia."""
        if check():
            return True
        if self._rt.worker.pending():
            self._rt.worker.flush(timeout=2)
            return check()
        return False

    def _report(self, operation, filter_, detail):
        self._rt.bump(self._name, "shadow_diffs")
        self._rt.store.record_diff(self._name, operation, f"filter={filter_!r} {detail}")
        log.warning("pgmirror shadow diff %s.%s: %s", self._name, operation, detail)

    def _compare_value(self, operation, filter_, mongo_value, pg_value_fn):
        holder = {}

        def check():
            holder["pg"] = pg_value_fn()
            return holder["pg"] == mongo_value
        if self._settled(check):
            self._rt.bump(self._name, "shadow_ok")
        else:
            self._report(operation, filter_, f"mongo={mongo_value!r} postgres={holder.get('pg')!r}")

    def _submit_find_compare(self, filter_, projection, sort, skip, limit, mongo_rows, op="find"):
        def compare():
            sort_fields = [f for f, _ in sqlfilter.sort_items(sort)]
            holder = {}

            def check():
                docs = self._pg_find(filter_, projection, sort, skip, limit)
                holder["pg"] = [_snapshot(d, sort_fields) for d in docs]
                holder["kind"] = _same_result(mongo_rows, holder["pg"], bool(sort_fields), bool(skip or limit))
                return holder["kind"] is None
            if self._settled(check):
                self._rt.bump(self._name, "shadow_ok")
            else:
                self._report(f"{op}:{holder['kind']}", filter_,
                             f"sort={sort!r} skip={skip} limit={limit} mongo={len(mongo_rows)} postgres={len(holder['pg'])}")
        self._shadow(compare)


def shadow_drain(timeout: float = 10) -> bool:
    """Espera a que terminen las comparaciones pendientes (pruebas y scripts)."""
    rt = _runtime
    return True if rt is None else rt.shadow.drain(timeout)


def status() -> dict:
    """Para el panel/endpoint de administración."""
    rt = _runtime
    return {
        "enabled": config.enabled(),
        "runtime": rt is not None,
        "pending": rt.worker.pending() if rt else 0,
        "dirty": sorted(rt.worker.dirty) if rt else [],
        "worker": dict(rt.worker.stats) if rt else {},
        "collections": dict(rt.stats) if rt else {},
    }
