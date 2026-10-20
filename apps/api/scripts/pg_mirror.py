#!/usr/bin/env python3
"""Herramienta de la migración Mongo → Postgres (docs/MIGRACION_POSTGRES.md).

    # Comparar (solo lee Mongo; no cambia nada en ningún lado):
    python scripts/pg_mirror.py reconcile message_templates
    # Copiar a Postgres lo que falte o difiera, y borrar lo sobrante (carga inicial):
    python scripts/pg_mirror.py reconcile message_templates --fix
    # Varias o todas:
    python scripts/pg_mirror.py reconcile settings,blacklist --fix
    python scripts/pg_mirror.py reconcile --all
    # Conteos lado a lado:
    python scripts/pg_mirror.py status

Lee MONGODB_URI, DATABASE_NAME y POSTGRES_URL del entorno. Nunca imprime URIs.
Mongo solo se lee. No importa app.database (ese módulo crea índices al conectar).
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pgmirror.reconcile import reconcile  # noqa: E402
from app.pgmirror.store import Store  # noqa: E402


def _connect():
    from pymongo import MongoClient
    mongo_uri, pg_url = os.environ.get("MONGODB_URI"), os.environ.get("POSTGRES_URL")
    if not mongo_uri or not pg_url:
        sys.exit("Faltan MONGODB_URI y/o POSTGRES_URL en el entorno.")
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000, appname="pg-mirror-readonly")
    raw_db = client[os.environ.get("DATABASE_NAME", "commercial")]
    return raw_db, Store(pg_url, statement_timeout_ms=600000)


def _collections(raw_db, spec, use_all):
    names = sorted(n for n in raw_db.list_collection_names() if not n.startswith("system."))
    if use_all:
        return names
    wanted = [n.strip() for n in (spec or "").split(",") if n.strip()]
    unknown = [n for n in wanted if n not in names]
    if unknown:
        sys.exit(f"No existen en Mongo: {', '.join(unknown)}")
    return wanted


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("reconcile")
    rec.add_argument("collections", nargs="?", help="nombre o lista separada por comas")
    rec.add_argument("--all", action="store_true")
    rec.add_argument("--fix", action="store_true", help="copiar/borrar para dejar Postgres igual a Mongo")
    sub.add_parser("status")
    args = parser.parse_args(argv)

    raw_db, store = _connect()
    try:
        if args.cmd == "status":
            for name in _collections(raw_db, None, True):
                pg = len(store.hashes(name))
                print(f"{name:34} mongo={raw_db[name].estimated_document_count():>9}  postgres={pg:>9}")
            return 0
        if not args.all and not args.collections:
            sys.exit("Indica la(s) colección(es) o --all.")
        all_ok = True
        for name in _collections(raw_db, args.collections, args.all):
            result = reconcile(raw_db, store, name, fix=args.fix)
            all_ok &= result["in_sync"] or args.fix
            flag = "OK " if result["in_sync"] else ("FIX" if args.fix else "DIF")
            print(f"[{flag}] {name:30} mongo={result['mongo']:>8} faltan={result['missing_in_postgres']:>6} "
                  f"distintos={result['different']:>6} sobran={result['extra_in_postgres']:>6}"
                  + (f"  copiados={result['copied']} borrados={result['deleted']}" if args.fix else ""))
            if not result["in_sync"] and not args.fix:
                print("      ejemplos: " + json.dumps(result["samples"], ensure_ascii=False))
        return 0 if all_ok else 2
    finally:
        store.close()


if __name__ == "__main__":
    sys.exit(main())
