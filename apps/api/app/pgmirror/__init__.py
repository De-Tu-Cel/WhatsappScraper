"""Migración gradual Mongo → Postgres (ver docs/MIGRACION_POSTGRES.md).

Punto de entrada único: `wrap_database(raw_db)`. Sin POSTGRES_URL regresa la base
de pymongo sin tocar — cero cambio de comportamiento.
"""
from app.pgmirror import config


def wrap_database(raw_db):
    if not config.enabled():
        return raw_db
    from app.pgmirror.routing import RoutedDatabase
    return RoutedDatabase(raw_db)


def status() -> dict:
    if not config.enabled():
        return {"enabled": False}
    from app.pgmirror.routing import status as _status
    return _status()
