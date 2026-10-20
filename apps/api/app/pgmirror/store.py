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
import logging
import threading

from psycopg import sql

from app.pgmirror import codec

log = logging.getLogger(__name__)
SCHEMA = "mongo"


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

    def upsert(self, collection: str, docs: list[dict]) -> int:
        if not docs:
            return 0
        self.ensure_table(collection)
        rows = []
        for doc in docs:
            key, kind = codec.id_key(doc["_id"])
            text = codec.encode_doc(doc)
            rows.append((key, kind, text, text, codec.doc_hash(doc)))
        # Solo reescribe la fila si el contenido cambió (texto exacto distinto, orden incluido).
        stmt = sql.SQL(
            "INSERT INTO {} AS t (id, id_type, doc, src, doc_hash, synced_at) VALUES (%s, %s, %s::jsonb, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET id_type = EXCLUDED.id_type, doc = EXCLUDED.doc, src = EXCLUDED.src, "
            "doc_hash = EXCLUDED.doc_hash, synced_at = now() "
            "WHERE t.src IS DISTINCT FROM EXCLUDED.src").format(self.table(collection))
        with self._pool.connection() as conn, conn.cursor() as cur:
            cur.executemany(stmt, rows)
        return len(rows)

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
        query = sql.SQL("SELECT COALESCE(src, doc::text) FROM {} ").format(self.table(collection))
        if plan is not None and plan.lateral is not None:
            query = query + sql.SQL(", ") + plan.lateral
        query = query + sql.SQL(" WHERE ") + where + sql.SQL(" ORDER BY ") + (plan.order if plan is not None else sql.SQL("seq"))
        if limit:
            query = query + sql.SQL(" LIMIT {}").format(sql.Literal(int(limit)))
        if skip:
            query = query + sql.SQL(" OFFSET {}").format(sql.Literal(int(skip)))
        with self._pool.connection() as conn:
            return [codec.decode_doc(row[0]) for row in conn.execute(query, params or None).fetchall()]

    def count(self, collection: str, where: sql.Composable, params=None) -> int:
        self.ensure_table(collection)
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
