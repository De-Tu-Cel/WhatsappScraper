"""Interruptores de la migración Mongo → Postgres (docs/MIGRACION_POSTGRES.md).

Sin POSTGRES_URL y sin modos primary todo queda solo en Mongo. Un primary sin URL falla cerrado. Cada colección
se mueve por separado, con una sola variable para todas (la que declara
docker-compose.yml, así no hay que tocar ese archivo por cada colección):

  DB_MODES=settings=dual,message_templates=dual,blacklist=dual

o con DB_MODE_<COLECCION> (p. ej. DB_MODE_MESSAGE_TEMPLATES), que gana sobre DB_MODES.
Modos:

  mongo     — como hoy; la capa ni se mete (valor por defecto).
  dual      — todo sigue en Mongo; cada escritura se copia a Postgres en segundo plano.
  shadow    — dual + lee también de Postgres, compara y registra diferencias;
              responde con lo de Mongo.
  postgres  — dual + lee de Postgres (lo no traducible vuelve a Mongo).
  primary   — Postgres es la fuente de verdad: escribe en Postgres y copia a Mongo
              (primaria.py). Solo después de días de postgres + sombra de escrituras en 0.

Regresar = poner otra vez `mongo` (o `dual`) y reiniciar el backend. Desde `primary` se regresa a
`postgres` (Mongo vuelve a mandar): antes, la bandeja mongo._outbox debe estar vacía.
"""
import functools
import os
import re

MODES = ("mongo", "dual", "shadow", "postgres", "primary")


def postgres_url() -> str:
    return os.getenv("POSTGRES_URL", "").strip()


def postgres_only() -> bool:
    """Explicit retirement switch: no reads, writes or mirror copies to Mongo."""
    return os.getenv('PGMIRROR_POSTGRES_ONLY', '').strip().lower() in {'1', 'true', 'yes'}


def enabled() -> bool:
    if not postgres_url():
        if postgres_only():
            raise RuntimeError('POSTGRES_URL is required in Postgres-only mode')
        modes = _parse_modes(os.getenv("DB_MODES", ""))
        names = set(modes)
        names.update(key[len("DB_MODE_"):] for key in os.environ if key.startswith("DB_MODE_"))
        if any((os.getenv(env_name(name), "").strip().lower() or modes.get(name)) == "primary"
               for name in names):
            raise RuntimeError("POSTGRES_URL is required for primary mode; refusing Mongo-only access")
    return bool(postgres_url())


def env_name(collection: str) -> str:
    return "DB_MODE_" + re.sub(r"[^A-Za-z0-9]", "_", collection).upper()


@functools.lru_cache(maxsize=8)
def _parse_modes(raw: str) -> dict:
    modes = {}
    for item in raw.split(","):
        name, sep, mode = item.partition("=")
        if sep and name.strip():
            modes[name.strip()] = mode.strip().lower()
    return modes


def collection_mode(collection: str) -> str:
    if not enabled():
        return "mongo"
    mode = (os.getenv(env_name(collection), "").strip().lower()
            or _parse_modes(os.getenv("DB_MODES", "")).get(collection, 'primary' if postgres_only() else 'mongo'))
    if postgres_only() and mode != 'primary':
        raise RuntimeError(f'Postgres-only mode requires primary routing for {collection}')
    return mode if mode in MODES else "mongo"  # un valor mal escrito nunca activa nada


def aggregate_mode() -> str:
    """PGMIRROR_AGGREGATE: dónde se resuelven los aggregate() de las colecciones en modo postgres.
    mongo (por defecto) · shadow (responde Mongo y se compara contra Postgres) · postgres."""
    if postgres_only():
        return 'postgres'
    mode = os.getenv("PGMIRROR_AGGREGATE", "").strip().lower()
    return mode if mode in ("mongo", "shadow", "postgres") else "mongo"
