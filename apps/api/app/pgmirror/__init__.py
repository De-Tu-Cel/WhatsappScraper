"""Migración gradual Mongo → Postgres (ver docs/MIGRACION_POSTGRES.md).

Puntos de entrada: `wrap_database(raw_db)` y `wrap_gridfs(raw_db)`. Sin POSTGRES_URL regresan
la base y el GridFS de pymongo sin tocar — cero cambio de comportamiento.
"""
from app.pgmirror import config


def wrap_database(raw_db):
    if not config.enabled():
        return raw_db
    from app.pgmirror.routing import RoutedDatabase
    return RoutedDatabase(raw_db)


def wrap_gridfs(raw_db):
    """GridFS, o su versión con Postgres si `archivos` tiene modo en DB_MODES (archivos.py)."""
    from gridfs import GridFS
    if not config.enabled():
        return GridFS(raw_db)
    from app.pgmirror import archivos
    modo = archivos.modo()
    if modo == "mongo":
        return GridFS(raw_db)
    from app.pgmirror.routing import get_runtime
    rt = get_runtime(raw_db)
    return GridFS(raw_db) if rt is None else archivos.ArchivosRuteados(raw_db, modo, rt)


def status() -> dict:
    if not config.enabled():
        return {"enabled": False}
    from app.pgmirror.routing import status as _status
    return _status()
