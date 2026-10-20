"""Tablas espejo en Postgres: una por colección, en el esquema `mongo`.

    mongo."<colección>" (id text PK, id_type text, doc jsonb, doc_hash text, synced_at)

`doc` es el documento completo (codec.encode_doc), así nada se pierde aunque
todavía no tenga columna propia. Las tablas "de verdad" (normalizadas) vendrán
después en `public`, colección por colección, partiendo de estas.
"""
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
            kwargs={"autocommit": True, "connect_timeout": 5,
                    "options": f"-c statement_timeout={int(statement_timeout_ms)}"},
        )
        self._ready = set()
        self._lock = threading.Lock()

    def close(self):
        self._pool.close()

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
            index = sql.Identifier(f"{collection}__doc_gin"[:63])
            with self._pool.connection() as conn:
                conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(SCHEMA)))
                conn.execute(sql.SQL(
                    "CREATE TABLE IF NOT EXISTS {} ("
                    " id text PRIMARY KEY, id_type text NOT NULL, doc jsonb NOT NULL,"
                    " doc_hash text NOT NULL, synced_at timestamptz NOT NULL DEFAULT now())").format(t))
                conn.execute(sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} USING gin (doc jsonb_path_ops)").format(index, t))
            self._ready.add(collection)

    def upsert(self, collection: str, docs: list[dict]) -> int:
        if not docs:
            return 0
        self.ensure_table(collection)
        rows = []
        for doc in docs:
            key, kind = codec.id_key(doc["_id"])
            rows.append((key, kind, codec.encode_doc(doc), codec.doc_hash(doc)))
        # Solo reescribe la fila si el contenido cambió (doc_hash distinto).
        stmt = sql.SQL(
            "INSERT INTO {} AS t (id, id_type, doc, doc_hash, synced_at) VALUES (%s, %s, %s::jsonb, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET id_type = EXCLUDED.id_type, doc = EXCLUDED.doc, "
            "doc_hash = EXCLUDED.doc_hash, synced_at = now() "
            "WHERE t.doc_hash IS DISTINCT FROM EXCLUDED.doc_hash").format(self.table(collection))
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
        """{id: doc_hash} de todas las filas, o solo de `keys`."""
        self.ensure_table(collection)
        query = sql.SQL("SELECT id, doc_hash FROM {}").format(self.table(collection))
        params = ()
        if keys is not None:
            query = query + sql.SQL(" WHERE id = ANY(%s)")
            params = (list(keys),)
        with self._pool.connection() as conn:
            return dict(conn.execute(query, params).fetchall())

    def query_docs(self, collection: str, where: sql.Composable, params: list, *,
                   order_by: sql.Composable | None = None, limit: int | None = None, skip: int = 0) -> list[dict]:
        self.ensure_table(collection)
        query = sql.SQL("SELECT doc::text FROM {} WHERE ").format(self.table(collection)) + where
        if order_by is not None:
            query = query + sql.SQL(" ORDER BY ") + order_by
        if limit:
            query = query + sql.SQL(" LIMIT {}").format(sql.Literal(int(limit)))
        if skip:
            query = query + sql.SQL(" OFFSET {}").format(sql.Literal(int(skip)))
        with self._pool.connection() as conn:
            return [codec.decode_doc(row[0]) for row in conn.execute(query, params).fetchall()]

    def count(self, collection: str, where: sql.Composable, params: list) -> int:
        self.ensure_table(collection)
        query = sql.SQL("SELECT count(*) FROM {} WHERE ").format(self.table(collection)) + where
        with self._pool.connection() as conn:
            return conn.execute(query, params).fetchone()[0]

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
