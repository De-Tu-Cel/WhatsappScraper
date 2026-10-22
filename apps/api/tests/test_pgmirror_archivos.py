"""Archivos (GridFS → mongo._files, app/pgmirror/archivos.py) con Mongo 7 y Postgres REALES: lo que la
app guarda con fs.put se lee igual con fs.get (bytes, nombre, tipo, metadata) en cada modo, y el
vigilante copia lo que falte de un lado o del otro. Si falta alguno de los motores, se salta."""
import os
import uuid

import pymongo
import pytest
from bson import ObjectId
from gridfs import GridFS
from gridfs.errors import NoFile

from app import pgmirror
from app.pgmirror import archivos, config, routing

TEST_MONGO = os.getenv("TEST_MONGO_URL", "mongodb://127.0.0.1:27029")
TEST_PG = os.getenv("TEST_POSTGRES_URL", "postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test")


def _engines_available():
    try:
        import psycopg
        psycopg.connect(TEST_PG, connect_timeout=2).close()
        client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=1500)
        if type(client).__module__.startswith("mongomock"):
            return False
        client.admin.command("ping")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _engines_available(), reason="sin Mongo real de pruebas (27029) o sin Postgres de pruebas")


@pytest.fixture
def entorno(monkeypatch):
    import psycopg
    client = pymongo.MongoClient(TEST_MONGO, serverSelectionTimeoutMS=3000)
    raw_db = client[f"pgfiles_{uuid.uuid4().hex[:8]}"]
    monkeypatch.setenv("POSTGRES_URL", TEST_PG)
    routing._runtime = None
    ids = []

    def fs(modo):
        monkeypatch.setenv(config.env_name(archivos.LLAVE), modo)
        return pgmirror.wrap_gridfs(raw_db)

    yield raw_db, fs, ids
    with psycopg.connect(TEST_PG, autocommit=True) as conn:
        if conn.execute("SELECT to_regclass('mongo._files')").fetchone()[0]:
            conn.execute("DELETE FROM mongo._files WHERE id = ANY(%s)", ([str(i) for i in ids],))
    if routing._runtime is not None:
        routing._runtime.store.close()
    routing._runtime = None
    client.drop_database(raw_db.name)
    client.close()


@pytest.mark.parametrize("modo", ["dual", "postgres", "primary"])
def test_put_and_get_like_gridfs(entorno, modo):
    raw_db, fs, ids = entorno
    rutas = fs(modo)
    assert isinstance(rutas, archivos.ArchivosRuteados)
    datos = bytes(range(256)) * 300  # varios chunks de GridFS
    _id = rutas.put(datos, filename="foto.png", content_type="image/png", metadata={"empresa": "x", "n": 1})
    ids.append(_id)
    assert isinstance(_id, ObjectId)
    leido = rutas.get(_id)
    assert leido.read() == datos and leido.filename == "foto.png" and leido.content_type == "image/png"
    assert leido.length == len(datos) and leido.metadata == {"empresa": "x", "n": 1}
    # Las dos bases lo tienen, sea quien sea la fuente.
    assert GridFS(raw_db).get(_id).read() == datos
    assert archivos.leer(routing._runtime.store, _id).read() == datos
    if modo in ("postgres", "primary"):
        assert isinstance(leido, archivos.ArchivoPG)
    with pytest.raises(NoFile):
        rutas.get(ObjectId())


def test_sync_copies_what_is_missing_on_each_side(entorno):
    raw_db, fs, ids = entorno
    rutas = fs("postgres")
    store = routing._runtime.store
    solo_mongo = GridFS(raw_db).put(b"de antes de la migracion", filename="viejo.pdf", content_type="application/pdf")
    solo_pg = ObjectId()
    archivos.guardar(store, solo_pg, b"escrito con Mongo caido", filename="nuevo.webp", content_type="image/webp")
    ids += [solo_mongo, solo_pg]
    assert archivos.sincronizar(raw_db, store) == (1, 1)
    assert archivos.sincronizar(raw_db, store) == (0, 0)  # repetir no hace nada
    assert rutas.get(solo_mongo).read() == b"de antes de la migracion"
    assert isinstance(rutas.get(solo_mongo), archivos.ArchivoPG)
    copia = GridFS(raw_db).get(solo_pg)
    assert copia.read() == b"escrito con Mongo caido" and copia.filename == "nuevo.webp"


def test_without_mode_it_is_plain_gridfs(entorno):
    raw_db, fs, _ids = entorno
    assert type(fs("mongo")) is GridFS
