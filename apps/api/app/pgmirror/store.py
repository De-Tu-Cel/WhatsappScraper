"""Tablas espejo en Postgres: una por colección, en el esquema `mongo`.

    mongo."<colección>" (id text PK, id_type text, doc jsonb, doc_hash text, synced_at, seq, src)

`doc` es el documento completo (codec.encode_doc), así nada se pierde aunque
todavía no tenga columna propia; sobre él se filtra. `src` es el mismo texto tal cual:
jsonb reordena las llaves y los documentos se reconstruyen desde `src` para conservar
el orden que tienen en Mongo. `seq` es el orden de inserción: el equivalente del
orden natural de Mongo (la carga inicial y el espejo copian en ese orden). Las tablas
"de verdad" (normalizadas) vendrán después en `public`, colección por colección,
partiendo de estas.

Los filtros llegan ya armados con sql.Literal (sqlfilter), así que las consultas se
ejecutan sin parámetros: un '%' dentro de una búsqueda no se confunde con uno.
"""
import contextlib
import hashlib
import logging
import threading

from psycopg import sql

from app.pgmirror import codec, sqlfilter

log = logging.getLogger(__name__)
SCHEMA = "mongo"
_LOCK_NAMESPACE = 0x504D  # pg_advisory_xact_lock(int4, int4): espacio propio para los candados por documento
_DDL_LOCK = (0x504E, 1)  # crear las funciones de orden (un proceso a la vez)
_INDEX_LOCK_KEY = 7340212  # pg_try_advisory_lock: mantenimiento (índices de orden, forma de guardar doc), uno a la vez
_INDEX_BUILD_TIMEOUT = "15min"
_STORAGE_VERSION = 1
_STORAGE_BATCH = 500

# Órdenes con índice propio en todas las tablas espejo. created_at es el que la app pide en casi
# todas las colecciones (la "última actividad" de message_logs cada 5 s, las páginas de
# companies…): sin índice, ordenar calcula la llave de cada fila de la tabla.
SORT_INDEXES = [("created_at", -1), ("created_at", 1)]


def _row_lock(collection: str, key: str) -> int:
    digest = hashlib.blake2b(f"{collection}\x1f{key}".encode("utf-8"), digest_size=4).digest()
    return int.from_bytes(digest, "big", signed=True)


def sort_index_name(collection: str, field: str, direction: int) -> str:
    name = f"{collection}__sk1_{field}_{'asc' if direction == 1 else 'desc'}"
    if len(name) > 63:
        digest = hashlib.blake2b(name.encode("utf-8"), digest_size=6).hexdigest()
        name = f"{collection[:40]}__sk1_{digest}"
    return name


class Store:
    def __init__(self, url: str, *, statement_timeout_ms: int = 5000, max_size: int = 4):
        from psycopg_pool import ConnectionPool
        self._pool = ConnectionPool(
            url, min_size=0, max_size=max_size, open=True, timeout=5,
            # jit=off: el JIT de Postgres tardaba ~12 s en compilar las expresiones de orden de
            # sqlfilter (la consulta en sí tarda <1 s; medido sobre contacts, 76 k filas).
            kwargs={"autocommit": True, "connect_timeout": 5,
                    "options": f"-c statement_timeout={int(statement_timeout_ms)} -c jit=off"},
        )
        self._ready = set()
        self._functions_ready = False
        self._maintained = set()
        self._lock = threading.Lock()

    def close(self):
        self._pool.close()

    def query(self, statement, params=None):
        """Consulta/sentencia suelta (tablas de vigilancia de health.py). Filas o None."""
        with self._pool.connection() as conn:
            cur = conn.execute(statement, params)
            return cur.fetchall() if cur.description else None

    @contextlib.contextmanager
    def advisory_lock(self, key: int):
        """True si este proceso obtuvo el candado (y lo suelta al salir); False si otro lo tiene."""
        with self._pool.connection() as conn:
            got = conn.execute("SELECT pg_try_advisory_lock(%s)", (key,)).fetchone()[0]
            try:
                yield got
            finally:
                if got:
                    conn.execute("SELECT pg_advisory_unlock(%s)", (key,))

    def id_values(self, collection: str, keys: list[str]) -> list:
        """Los _id originales (ObjectId, texto, número…) de esas filas."""
        if not keys:
            return []
        self.ensure_table(collection)
        rows = self.query(sql.SQL("SELECT id, id_type FROM {} WHERE id = ANY(%s)").format(self.table(collection)), (list(keys),))
        return [codec.id_from_key(key, kind) for key, kind in rows]

    @staticmethod
    def table(collection: str):
        return sql.Identifier(SCHEMA, collection)

    def ensure_table(self, collection: str):
        if collection in self._ready:
            return
        with self._lock:
            if collection in self._ready:
                return
            t = self.table(collection)
            with self._pool.connection() as conn:
                conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(SCHEMA)))
                conn.execute(sql.SQL(
                    "CREATE TABLE IF NOT EXISTS {} ("
                    " id text PRIMARY KEY, id_type text NOT NULL, doc jsonb NOT NULL,"
                    " doc_hash text NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(), seq bigserial, src text)").format(t))
                conn.execute(sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS seq bigserial").format(t))
                conn.execute(sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS src text").format(t))
                conn.execute(sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} USING gin (doc jsonb_path_ops)").format(
                    sql.Identifier(f"{collection}__doc_gin"[:63]), t))
                conn.execute(sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} (seq)").format(
                    sql.Identifier(f"{collection}__seq"[:63]), t))
            self._ready.add(collection)

    def ensure_functions(self):
        """Tipo y funciones de la llave de orden (sqlfilter.SORT_KEY_DDL), una sola vez. Las
        consultas que ordenan o filtran por rango las usan; las escrituras no las necesitan."""
        if self._functions_ready:
            return
        with self._lock:
            if self._functions_ready:
                return
            with self._pool.connection() as conn, conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(%s, %s)", _DDL_LOCK)
                conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(SCHEMA)))
                if conn.execute("SELECT to_regprocedure(%s)", (sqlfilter.SORT_KEY_CHECK,)).fetchone()[0] is None:
                    for statement in sqlfilter.SORT_KEY_DDL:
                        conn.execute(statement)
            self._functions_ready = True

    def ensure_sort_index(self, collection: str, field: str, direction: int) -> bool:
        """Índice de expresión con la llave de orden de `field` (la misma expresión que el ORDER BY
        de sqlfilter.sort_plan y que los rangos de los filtros). Se construye CONCURRENTLY, así el
        espejo sigue escribiendo, y un solo proceso a la vez. True si quedó (o ya estaba) listo;
        False si otro proceso está construyendo uno."""
        name = sort_index_name(collection, field, direction)
        if (collection, name) in self._maintained:
            return True
        self.ensure_table(collection)
        self.ensure_functions()
        with self._pool.connection() as conn:
            if not conn.execute("SELECT pg_try_advisory_lock(%s)", (_INDEX_LOCK_KEY,)).fetchone()[0]:
                return False
            try:
                state = conn.execute(
                    "SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = %s AND c.relname = %s",
                    (SCHEMA, name)).fetchall()
                if not (state and state[0][0]):
                    conn.execute(f"SET statement_timeout = '{_INDEX_BUILD_TIMEOUT}'")
                    try:
                        if state:
                            # Inválido = una construcción anterior que se interrumpió (nadie más
                            # construye: tenemos el candado). Postgres no lo usa; se rehace.
                            conn.execute(sql.SQL("DROP INDEX CONCURRENTLY IF EXISTS {}").format(sql.Identifier(SCHEMA, name)))
                        conn.execute(sql.SQL("CREATE INDEX CONCURRENTLY IF NOT EXISTS {} ON {} ({} {}, seq)").format(
                            sql.Identifier(name), self.table(collection), sqlfilter.sort_key(field, direction),
                            sql.SQL("ASC" if direction == 1 else "DESC")))
                        conn.execute(sql.SQL("ANALYZE {}").format(self.table(collection)))
                    finally:
                        conn.execute("RESET statement_timeout")
                    log.info("pgmirror sort index ready: %s.%s", SCHEMA, name)
            finally:
                conn.execute("SELECT pg_advisory_unlock(%s)", (_INDEX_LOCK_KEY,))
        self._maintained.add((collection, name))
        return True

    def ensure_doc_storage(self, collection: str) -> bool:
        """Guarda `doc` sin comprimir dentro de la fila (STORAGE MAIN) y reescribe una vez las filas
        que ya lo tienen comprimido. Cada fila trae el documento dos veces (doc y su texto src): casi
        todas pasaban de 2 KB y Postgres comprimía las dos, así que cada condición de un filtro
        descomprimía el documento entero (15 µs por fila en producción). Con MAIN, Postgres comprime
        y saca de la fila primero `src`, que solo se lee al devolver resultados. La reescritura no
        cambia el contenido (doc || '{}' es el mismo jsonb) y va en lotes por _id. True si quedó
        listo; False si otro proceso está en mantenimiento o la tabla estaba ocupada."""
        if (collection, "storage") in self._maintained:
            return True
        self.ensure_table(collection)
        t = self.table(collection)
        with self._pool.connection() as conn:
            if not conn.execute("SELECT pg_try_advisory_lock(%s)", (_INDEX_LOCK_KEY,)).fetchone()[0]:
                return False
            try:
                conn.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {} (collection text PRIMARY KEY, version integer NOT NULL, "
                                     "done_at timestamptz NOT NULL DEFAULT now())").format(sql.Identifier(SCHEMA, "_storage")))
                done = conn.execute(sql.SQL("SELECT version FROM {} WHERE collection = %s").format(
                    sql.Identifier(SCHEMA, "_storage")), (collection,)).fetchone()
                if not (done and done[0] >= _STORAGE_VERSION):
                    storage = conn.execute(
                        "SELECT a.attstorage FROM pg_attribute a WHERE a.attrelid = to_regclass(%s) AND a.attname = 'doc'",
                        (f'{SCHEMA}."{collection}"',)).fetchone()[0]
                    if storage != "m":
                        # Solo cambia el catálogo, pero pide un candado exclusivo: si la tabla está
                        # ocupada no se espera más de medio segundo (se reintenta en el siguiente minuto).
                        conn.execute("SET lock_timeout = '500ms'")
                        try:
                            conn.execute(sql.SQL("ALTER TABLE {} ALTER COLUMN doc SET STORAGE MAIN").format(t))
                        except Exception as exc:
                            if getattr(exc, "sqlstate", None) == "55P03":  # lock_not_available
                                return False
                            raise
                        finally:
                            conn.execute("RESET lock_timeout")
                    # Solo las filas con doc comprimido o fuera de la fila (Postgres 17: pg_column_toast_chunk_id).
                    last, rewritten = "", 0
                    while True:
                        rows = conn.execute(sql.SQL(
                            "UPDATE {t} SET doc = doc || '{{}}'::jsonb, src = src || '' WHERE id IN ("
                            "SELECT id FROM {t} WHERE id > %s AND (pg_column_compression(doc) IS NOT NULL "
                            "OR pg_column_toast_chunk_id(doc) IS NOT NULL) ORDER BY id LIMIT %s) "
                            "RETURNING id").format(t=t), (last, _STORAGE_BATCH)).fetchall()
                        if not rows:
                            break
                        last, rewritten = max(r[0] for r in rows), rewritten + len(rows)
                    if rewritten:
                        # Las versiones viejas de las filas reescritas se recorren en cada lectura hasta el VACUUM.
                        conn.execute(f"SET statement_timeout = '{_INDEX_BUILD_TIMEOUT}'")
                        try:
                            conn.execute(sql.SQL("VACUUM (ANALYZE) {}").format(t))
                        finally:
                            conn.execute("RESET statement_timeout")
                    conn.execute(sql.SQL("INSERT INTO {} (collection, version) VALUES (%s, %s) ON CONFLICT (collection) "
                                         "DO UPDATE SET version = EXCLUDED.version, done_at = now()").format(
                        sql.Identifier(SCHEMA, "_storage")), (collection, _STORAGE_VERSION))
                    log.info("pgmirror doc storage ready: %s (%d rows rewritten)", collection, rewritten)
            finally:
                conn.execute("SELECT pg_advisory_unlock(%s)", (_INDEX_LOCK_KEY,))
        self._maintained.add((collection, "storage"))
        return True

    @staticmethod
    def _rows(docs):
        rows = []
        for doc in docs:
            key, kind = codec.id_key(doc["_id"])
            text = codec.encode_doc(doc)
            rows.append((key, kind, text, text, codec.doc_hash(doc)))
        return rows

    def _upsert_sql(self, collection):
        # Solo reescribe la fila si el contenido cambió (texto exacto distinto, orden incluido).
        return sql.SQL(
            "INSERT INTO {} AS t (id, id_type, doc, src, doc_hash, synced_at) VALUES (%s, %s, %s::jsonb, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET id_type = EXCLUDED.id_type, doc = EXCLUDED.doc, src = EXCLUDED.src, "
            "doc_hash = EXCLUDED.doc_hash, synced_at = now() "
            "WHERE t.src IS DISTINCT FROM EXCLUDED.src").format(self.table(collection))

    def upsert(self, collection: str, docs: list[dict]) -> int:
        """Escritura directa, sin candados (pruebas y herramientas). La copia en vivo usa replace_from_source."""
        if not docs:
            return 0
        self.ensure_table(collection)
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.executemany(self._upsert_sql(collection), self._rows(docs))
        return len(docs)

    def replace_from_source(self, collection: str, ids: list, fetch) -> int:
        """Deja estas filas iguales a lo que `fetch(ids)` lee de Mongo en ese momento, con un
        candado por documento (pg_advisory_xact_lock) tomado ANTES de leer. Así, si dos procesos
        copian el mismo documento a la vez, se turnan y el último en escribir también fue el último
        en leer: nunca queda una versión vieja encima de una nueva. Lo que ya no existe en Mongo se
        borra. Devuelve cuántos documentos copió."""
        if not ids:
            return 0
        self.ensure_table(collection)
        by_key = {codec.id_key(i)[0]: i for i in ids}
        locks = sorted({_row_lock(collection, key) for key in by_key})
        with self._pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
            cur.executemany("SELECT pg_advisory_xact_lock(%s, %s)", [(_LOCK_NAMESPACE, k) for k in locks])
            docs = fetch(list(by_key.values()))
            if docs:
                cur.executemany(self._upsert_sql(collection), self._rows(docs))
            found = {codec.id_key(d["_id"])[0] for d in docs}
            gone = [key for key in by_key if key not in found]
            if gone:
                cur.execute(sql.SQL("DELETE FROM {} WHERE id = ANY(%s)").format(self.table(collection)), (gone,))
        return len(docs)

    def delete(self, collection: str, keys: list[str]) -> int:
        if not keys:
            return 0
        self.ensure_table(collection)
        with self._pool.connection() as conn:
            cur = conn.execute(sql.SQL("DELETE FROM {} WHERE id = ANY(%s)").format(self.table(collection)), (list(keys),))
            return cur.rowcount

    def hashes(self, collection: str, keys: list[str] | None = None) -> dict[str, str]:
        """{id: doc_hash} de todas las filas, o solo de `keys`. Una fila sin `src` (de
        antes de esa columna) sale distinta para que reconcile --fix la reescriba."""
        self.ensure_table(collection)
        query = sql.SQL("SELECT id, CASE WHEN src IS NULL THEN '' ELSE doc_hash END FROM {}").format(self.table(collection))
        params = ()
        if keys is not None:
            query = query + sql.SQL(" WHERE id = ANY(%s)")
            params = (list(keys),)
        with self._pool.connection() as conn:
            return dict(conn.execute(query, params).fetchall())

    def query_docs(self, collection: str, where: sql.Composable, params=None, *,
                   plan=None, limit: int | None = None, skip: int = 0) -> list[dict]:
        """`plan`: sqlfilter.SortPlan; sin él, orden de inserción (seq)."""
        self.ensure_table(collection)
        self.ensure_functions()
        query = sql.SQL("SELECT COALESCE(src, doc::text) FROM {} WHERE ").format(self.table(collection))
        query = query + where + sql.SQL(" ORDER BY ") + (plan.order if plan is not None else sql.SQL("seq"))
        if limit:
            query = query + sql.SQL(" LIMIT {}").format(sql.Literal(int(limit)))
        if skip:
            query = query + sql.SQL(" OFFSET {}").format(sql.Literal(int(skip)))
        with self._pool.connection() as conn:
            return [codec.decode_doc(row[0]) for row in conn.execute(query, params or None).fetchall()]

    def distinct_values(self, collection: str, field: str, where: sql.Composable) -> list[str] | None:
        """Valores distintos (texto JSON) del campo de primer nivel `field` en las filas que cumplen
        `where`, en orden de primera aparición; un arreglo cuenta por sus elementos. Se calcula en
        Postgres: traer los documentos completos a Python tardaba 600-700 ms en message_logs.
        None si alguna fila no aporta ningún valor (le falta el campo o es []): con esas, el
        distinct de Mongo depende de su plan (routing._pg_distinct)."""
        self.ensure_table(collection)
        self.ensure_functions()
        query = sql.SQL("WITH m AS MATERIALIZED (SELECT doc -> {} AS v, seq FROM {} WHERE ").format(
            sql.Literal(field), self.table(collection)) + where + sql.SQL(
            ") SELECT NULL::text, 0::bigint, 0::bigint WHERE EXISTS (SELECT 1 FROM m WHERE v IS NULL OR v = '[]'::jsonb) "
            "UNION ALL SELECT e::text, min(seq), min(i) FROM m, jsonb_array_elements("
            "CASE WHEN jsonb_typeof(v) = 'array' THEN v ELSE jsonb_build_array(v) END) WITH ORDINALITY AS x(e, i) "
            "WHERE v IS NOT NULL GROUP BY e")
        with self._pool.connection() as conn:
            rows = conn.execute(query).fetchall()
        if any(text is None for text, _seq, _i in rows):
            return None
        return [text for text, _seq, _i in sorted(rows, key=lambda r: (r[1], r[2]))]

    def count(self, collection: str, where: sql.Composable, params=None) -> int:
        self.ensure_table(collection)
        self.ensure_functions()
        query = sql.SQL("SELECT count(*) FROM {} WHERE ").format(self.table(collection)) + where
        with self._pool.connection() as conn:
            return conn.execute(query, params or None).fetchone()[0]

    def record_diff(self, collection: str, operation: str, detail: str):
        """Diferencia encontrada en modo shadow (para revisar después)."""
        try:
            with self._pool.connection() as conn:
                conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(SCHEMA)))
                conn.execute(sql.SQL(
                    "CREATE TABLE IF NOT EXISTS {} (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), "
                    "collection text NOT NULL, operation text NOT NULL, detail text NOT NULL)").format(
                        sql.Identifier(SCHEMA, "_shadow_diffs")))
                conn.execute(sql.SQL("INSERT INTO {} (collection, operation, detail) VALUES (%s, %s, %s)").format(
                    sql.Identifier(SCHEMA, "_shadow_diffs")), (collection, operation, detail[:2000]))
        except Exception:
            log.exception("Could not record shadow diff for %s", collection)
