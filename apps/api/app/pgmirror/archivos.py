"""Archivos (GridFS) → Postgres: tabla mongo._files, con su propio interruptor `archivos=<modo>` en DB_MODES.

La app solo usa `fs.put(datos, filename=, content_type=, metadata=)` y `fs.get(id)` (subidas de
WhatsApp, stickers, medios entrantes, capturas): los archivos nunca se modifican ni se borran, así que
copiar es solo «el que falte de un lado, al otro» por _id.

  mongo     — GridFS como hoy (sin POSTGRES_URL, igual).
  dual / shadow — se guarda en GridFS y se copia a Postgres; se lee de GridFS.
  postgres  — se guarda en GridFS y se copia a Postgres; se lee de Postgres (si no está, de GridFS).
  primary   — se guarda en Postgres y se copia a GridFS; se lee de Postgres (si no está, de GridFS).

Si la copia falla, la escritura no falla: el vigilante (health.py) copia cada minuto lo que falte de
un lado o del otro (sincronizar).
"""
import io
import logging
from datetime import datetime, timezone

from bson import ObjectId
from gridfs import GridFS
from gridfs.errors import NoFile

from app.pgmirror import codec, config

log = logging.getLogger(__name__)
LLAVE = "archivos"
DDL = [
    "CREATE TABLE IF NOT EXISTS mongo._files (id text PRIMARY KEY, id_type text NOT NULL, filename text, "
    "content_type text, length bigint NOT NULL, upload_date timestamptz NOT NULL, metadata jsonb, data bytea NOT NULL)",
    # Imágenes y documentos ya vienen comprimidos: Postgres no intenta comprimirlos otra vez.
    "ALTER TABLE mongo._files ALTER COLUMN data SET STORAGE EXTERNAL",
]


def modo() -> str:
    return config.collection_mode(LLAVE)


class ArchivoPG(io.BytesIO):
    """Lo que la app usa de un GridOut: read(), filename, content_type, length, upload_date, metadata."""

    def __init__(self, _id, filename, content_type, length, upload_date, metadata, data):
        super().__init__(bytes(data))
        self._id, self.filename, self.content_type = _id, filename, content_type
        self.length, self.upload_date, self.metadata = length, upload_date, metadata

    @property
    def name(self):
        return self.filename


def _bytes(data, encoding=None) -> bytes:
    if isinstance(data, (bytes, bytearray, memoryview)):
        return bytes(data)
    if isinstance(data, str):
        if not encoding:
            raise TypeError("must specify an encoding for file in order to write str")
        return data.encode(encoding)
    return data.read()  # como GridFS: cualquier objeto con read()


def guardar(store, _id, data: bytes, *, filename=None, content_type=None, metadata=None, upload_date=None):
    llave, tipo = codec.id_key(_id)
    upload_date = upload_date or datetime.now(timezone.utc)
    store.query("INSERT INTO mongo._files (id, id_type, filename, content_type, length, upload_date, metadata, data) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb -> 'm', %s) ON CONFLICT (id) DO NOTHING",
                (llave, tipo, filename, content_type, len(data), upload_date,
                 codec.encode_doc({"m": metadata}) if metadata is not None else None, data))


def leer(store, _id):
    filas = store.query("SELECT filename, content_type, length, upload_date, metadata::text, data FROM mongo._files "
                        "WHERE id = %s", (codec.id_key(_id)[0],))
    if not filas:
        return None
    filename, content_type, length, upload_date, metadata, data = filas[0]
    if metadata is not None:
        metadata = codec.decode_doc('{"m": ' + metadata + "}")["m"]
    # Como GridFS: la fecha sin zona (pymongo regresa fechas UTC sin tzinfo por defecto).
    return ArchivoPG(_id, filename, content_type, length, upload_date.astimezone(timezone.utc).replace(tzinfo=None),
                     metadata, data)


class ArchivosRuteados:
    """Se comporta como gridfs.GridFS para lo que usa la app; lo demás va directo a GridFS."""

    def __init__(self, raw_db, modo_, rt):
        self._gridfs, self._modo, self._rt = GridFS(raw_db), modo_, rt

    def __getattr__(self, attr):
        return getattr(self._gridfs, attr)

    def put(self, data, **kwargs):
        datos = _bytes(data, kwargs.get("encoding"))
        _id = kwargs.pop("_id", None) or ObjectId()
        campos = {"filename": kwargs.get("filename"), "content_type": kwargs.get("content_type"),
                  "metadata": kwargs.get("metadata")}
        if self._modo == "primary":
            guardar(self._rt.store, _id, datos, **campos)
            try:
                self._gridfs.put(datos, _id=_id, **kwargs)
            except Exception:
                self._rt.bump(LLAVE, "copia_a_mongo_pendiente")
                log.exception("pgmirror: el archivo %s no se copió a GridFS (lo copia el vigilante)", _id)
            return _id
        self._gridfs.put(datos, _id=_id, **kwargs)
        try:
            guardar(self._rt.store, _id, datos, **campos)
        except Exception:
            self._rt.bump(LLAVE, "copia_pendiente")
            log.exception("pgmirror: el archivo %s no se copió a Postgres (lo copia el vigilante)", _id)
        return _id

    def get(self, file_id):
        if self._modo in ("postgres", "primary"):
            try:
                archivo = leer(self._rt.store, file_id)
                if archivo is not None:
                    return archivo
                self._rt.bump(LLAVE, "pg_fallback_get")
            except Exception:
                self._rt.bump(LLAVE, "pg_fallback_get")
                log.exception("pgmirror: no se pudo leer el archivo %s de Postgres; se lee de GridFS", file_id)
        return self._gridfs.get(file_id)


def sincronizar(raw_db, store) -> tuple[int, int]:
    """Copia lo que falte de un lado o del otro (los archivos no cambian ni se borran).
    Devuelve (copiados a Postgres, copiados a GridFS)."""
    fs = GridFS(raw_db)
    en_mongo = {codec.id_key(d["_id"])[0]: d["_id"] for d in raw_db["fs.files"].find({}, {"_id": 1})}
    en_pg = {llave: codec.id_from_key(llave, tipo) for llave, tipo in store.query("SELECT id, id_type FROM mongo._files")}
    a_pg = a_mongo = 0
    for llave, _id in en_mongo.items():
        if llave in en_pg:
            continue
        try:
            archivo = fs.get(_id)
            guardar(store, _id, archivo.read(), filename=archivo.filename, content_type=getattr(archivo, "content_type", None),
                    metadata=archivo.metadata, upload_date=archivo.upload_date.replace(tzinfo=timezone.utc))
            a_pg += 1
        except NoFile:
            continue  # se está subiendo justo ahora (fs.files se escribe al final): en el siguiente minuto
        except Exception:
            log.exception("pgmirror: el archivo %s no se pudo copiar a Postgres", _id)
    for llave, _id in en_pg.items():
        if llave in en_mongo:
            continue
        try:
            archivo = leer(store, _id)
            extra = {"metadata": archivo.metadata} if archivo.metadata is not None else {}
            fs.put(archivo.read(), _id=_id, filename=archivo.filename, content_type=archivo.content_type, **extra)
            a_mongo += 1
        except Exception:
            log.exception("pgmirror: el archivo %s no se pudo copiar a GridFS", _id)
    return a_pg, a_mongo
