#!/usr/bin/env python3
"""Herramienta de la migración Mongo → Postgres (docs/MIGRACION_POSTGRES.md).

    # Todo de un vistazo: cada colección activa, si está igual, y si ya puede avanzar:
    python scripts/pg_mirror.py check
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
import math
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


def _check(raw_db, store) -> int:
    """Solo lee. Usa lo que el backend guarda cada minuto (app/pgmirror/health.py)."""
    from app.pgmirror import health
    health.ensure_meta(store)
    active = health.active_collections(raw_db)
    print(f"DB_MODES: {os.environ.get('DB_MODES') or '(vacío)'}")
    if not active:
        print("Ninguna colección activa: todo está solo en Mongo.")
        return 0
    wait = health.wait_hours()
    window_days = max(1, math.ceil(wait / 24))  # los contadores van por día: hoy y los N anteriores
    modes = {c: (m, float(age) / 3600) for c, m, age in store.query(
        "SELECT collection, mode, extract(epoch FROM now() - since) FROM mongo._modes")}
    counters = {(c, k): int(n) for c, k, n in store.query(
        "SELECT collection, key, sum(n) FROM mongo._counters WHERE day >= current_date - %s GROUP BY 1, 2", (window_days,))}
    fixed = {c: int(n) for c, n in store.query(
        "SELECT collection, sum(queued) FROM mongo._reconcile_log WHERE kind <> 'initial' "
        "AND at > now() - make_interval(secs => %s) GROUP BY 1", (wait * 3600,))}
    last_auto = {c: float(age) / 3600 for c, age in store.query(
        "SELECT collection, extract(epoch FROM now() - max(at)) FROM mongo._reconcile_log GROUP BY 1")}
    dirty = {row[0] for row in store.query("SELECT collection FROM mongo._dirty")}

    print(f"\n{'COLECCIÓN':30} {'MODO':8} {'HORAS':>6} {'MONGO':>8} {'POSTGRES':>9}  {'AHORA':6} "
          f"{'CORREGIDOS':>10} {'SHADOW ok/dif':>14} {'ÚLT.CONC.':>10}  →")
    all_ok = True
    for name, mode in sorted(active.items()):
        result = reconcile(raw_db, store, name)
        recorded = modes.get(name)
        hours = recorded[1] if recorded and recorded[0] == mode else None
        ok, diffs = counters.get((name, "shadow_ok"), 0), counters.get((name, "shadow_diffs"), 0)
        fallbacks = sum(v for (c, k), v in counters.items() if c == name and k.startswith("pg_fallback"))
        verdict = health.readiness(mode, hours, result["in_sync"], fixed.get(name, 0), ok, diffs, fallbacks, wait)
        if name in dirty:
            verdict = "POR CONCILIAR (lecturas en Mongo hasta que se concilie, ~1 min) · " + verdict
        all_ok &= result["in_sync"]
        last = f"hace {last_auto[name]:.1f} h" if name in last_auto else "aún no"
        print(f"{name:30} {mode:8} {'?' if hours is None else f'{hours:.1f}':>6} {result['mongo']:>8} "
              f"{result['mongo'] - result['missing_in_postgres'] + result['extra_in_postgres']:>9}  "
              f"{'OK' if result['in_sync'] else 'DIF':6} {fixed.get(name, 0):>10} {f'{ok}/{diffs}':>14} {last:>10}  {verdict}")
    print(f"\n(Para avanzar una colección: {wait:g} h en su modo sin correcciones ni diferencias "
          f"(PGMIRROR_WAIT_HOURS). CORREGIDOS: últimas {wait:g} h; SHADOW: hoy y {window_days} día(s) antes.)")

    print("\nProcesos del backend:")
    procs = store.query("SELECT process, extract(epoch FROM now() - updated_at), status FROM mongo._runtime ORDER BY 2")
    if not procs:
        print("  ninguno ha reportado todavía (se reporta cada minuto con la versión que trae health.py)")
    for process, age, status in procs:
        worker = status.get("worker", {})
        print(f"  {process}: hace {float(age):.0f} s · pendientes {status.get('pending', 0)} · "
              f"por conciliar {', '.join(status.get('dirty') or []) or 'ninguna'} · "
              f"copiados {worker.get('synced', 0)} · errores {worker.get('errors', 0)}")

    if store.query("SELECT to_regclass('mongo._shadow_diffs')")[0][0]:
        rows = store.query("SELECT at, collection, operation, left(detail, 160) FROM mongo._shadow_diffs "
                           "WHERE at > now() - make_interval(secs => %s) ORDER BY at DESC LIMIT 5", (wait * 3600,))
        print(f"\nDiferencias de shadow (últimas {wait:g} h): {'ninguna' if not rows else ''}")
        for at, collection, operation, detail in rows:
            print(f"  {at:%Y-%m-%d %H:%M} {collection}.{operation}: {detail}")
    return 0 if all_ok else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    rec = sub.add_parser("reconcile")
    rec.add_argument("collections", nargs="?", help="nombre o lista separada por comas")
    rec.add_argument("--all", action="store_true")
    rec.add_argument("--fix", action="store_true", help="copiar/borrar para dejar Postgres igual a Mongo")
    sub.add_parser("status")
    sub.add_parser("check", help="estado de las colecciones activas y si ya pueden avanzar de modo")
    args = parser.parse_args(argv)

    raw_db, store = _connect()
    try:
        if args.cmd == "check":
            return _check(raw_db, store)
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
