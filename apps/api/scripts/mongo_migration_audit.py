#!/usr/bin/env python3
"""Diagnóstico de SOLO LECTURA de la Mongo, para planear la migración a Postgres.

Qué mide (sin escribir nada):
  1. Tamaño de cada colección (documentos, MB de datos e índices).
  2. Duplicados que romperían las restricciones UNIQUE de Postgres — varios
     índices únicos se crean con try/except en database.py, así que en
     producción puede haber repetidos que Mongo nunca rechazó.
  3. Tipos mezclados en campos que serán llaves (p. ej. company_id guardado a
     veces como texto y a veces como ObjectId) y en _id.
  4. Forma real de los documentos (muestra): campos, tipos y largo de arreglos.
  5. Archivos en GridFS (fs.files / fs.chunks).

Uso (desde una máquina con acceso a la base; NO necesita el código de la app):
    MONGODB_URI="mongodb://..." DATABASE_NAME=commercial \
        python mongo_migration_audit.py --out audit.json

Imprime un resumen y deja el detalle en el JSON. Nunca imprime la URI.
Cada consulta tiene límite de tiempo (--max-seconds) y no crea índices ni
modifica documentos. Se puede correr con el usuario de solo lectura.
"""
import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

# Restricciones UNIQUE que tendrá Postgres (vienen de los índices únicos de
# database.py). Cada entrada: (colección, campo, filtro que define el universo).
UNIQUE_CANDIDATES = [
    ("companies", "domain", {"domain": {"$type": "string", "$gt": ""}}),
    ("companies", "maps_cid", {"maps_cid": {"$exists": True, "$ne": None}}),
    ("message_logs", "message_id", {"message_id": {"$type": "string", "$gt": ""}}),
    ("search_ideas", "url", {"url": {"$exists": True, "$ne": None}}),
    ("contacts", "value", {"source": "inbound_whatsapp", "type": "whatsapp"}),
    ("instances", "name", {"name": {"$exists": True}}),
    ("users", "username", {"username": {"$type": "string", "$gt": ""}}),
    ("users", "email", {"email": {"$type": "string", "$gt": ""}}),
    ("users", "session_token", {"session_token": {"$type": "string", "$gt": ""}}),
]

# Campos que serán llaves foráneas: ¿se guardan siempre con el mismo tipo?
FK_CANDIDATES = {
    "message_logs": ["company_id", "instance_name", "received_on_instance"],
    "contacts": ["company_id"],
    "jid_map": ["company_id"],
    "scheduled_sends": ["company_id", "created_by"],
    "send_queue_items": ["company_id", "user_id", "batch_id"],
    "ai_followup_sessions": ["company_id"],
    "conversation_ai_prefs": ["company_id"],
    "instances": ["assigned_to", "proxy_id"],
    "search_ideas": ["company_id"],
}

DATE_FIELDS = ["created_at", "updated_at", "sent_at", "scheduled_at", "finished_at", "ts", "started_at"]
SAMPLE_SIZE = 300


def _type_counts(coll, field, max_ms):
    from pymongo.errors import OperationFailure
    pipeline = [
        {"$group": {"_id": {"$type": f"${field}"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]
    try:
        return {row["_id"]: row["n"] for row in coll.aggregate(pipeline, allowDiskUse=True, maxTimeMS=max_ms)}
    except OperationFailure:
        # Servidor sin $type en agregaciones: contar del lado de Python
        # trayendo solo ese campo (sigue siendo solo lectura).
        counts = Counter()
        for doc in coll.find({}, {field: 1, "_id": 1 if field == "_id" else 0}).max_time_ms(max_ms):
            counts["missing" if field not in doc else _bson_type(doc[field])] += 1
        return dict(counts)


def _duplicates(coll, field, match, max_ms):
    pipeline = [
        {"$match": match},
        {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
        {"$sort": {"n": -1}},
        {"$group": {"_id": None, "keys": {"$sum": 1}, "extra_docs": {"$sum": {"$subtract": ["$n", 1]}},
                    "examples": {"$push": {"value": "$_id", "n": "$n"}}}},
        {"$project": {"_id": 0, "keys": 1, "extra_docs": 1, "examples": {"$slice": ["$examples", 5]}}},
    ]
    rows = list(coll.aggregate(pipeline, allowDiskUse=True, maxTimeMS=max_ms))
    return rows[0] if rows else {"keys": 0, "extra_docs": 0, "examples": []}


def _bson_type(value):
    from bson import ObjectId
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, ObjectId):
        return "objectId"
    if isinstance(value, datetime):
        return "date(aware)" if value.tzinfo else "date"
    if isinstance(value, (int, float)):
        return type(value).__name__
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _shape(coll, max_ms):
    """Campos de primer nivel en una muestra: en qué % aparecen, con qué tipos y
    el largo máximo de sus arreglos (para decidir columna vs. JSONB vs. tabla hija)."""
    fields = defaultdict(lambda: {"present": 0, "types": Counter(), "max_array_len": 0})
    sampled = 0
    for doc in coll.aggregate([{"$sample": {"size": SAMPLE_SIZE}}], maxTimeMS=max_ms):
        sampled += 1
        for key, value in doc.items():
            info = fields[key]
            info["present"] += 1
            info["types"][_bson_type(value)] += 1
            if isinstance(value, list):
                info["max_array_len"] = max(info["max_array_len"], len(value))
    return {
        "sampled": sampled,
        "fields": {
            key: {"present_pct": round(100 * info["present"] / sampled, 1) if sampled else 0,
                  "types": dict(info["types"]), "max_array_len": info["max_array_len"]}
            for key, info in sorted(fields.items())
        },
    }


def _safe(results, key, fn):
    try:
        results[key] = fn()
    except Exception as exc:  # una consulta lenta o no soportada no detiene el resto
        results[key] = {"error": f"{type(exc).__name__}: {exc}"[:300]}


def audit(db, max_ms=60000):
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "database": db.name, "collections": {}}
    names = sorted(n for n in db.list_collection_names() if not n.startswith("system."))
    for name in names:
        coll = db[name]
        entry = {}
        _safe(entry, "count", lambda: coll.estimated_document_count())

        def stats(name=name):
            s = db.command("collStats", name)
            return {"size_mb": round(s.get("size", 0) / 1_048_576, 2),
                    "storage_mb": round(s.get("storageSize", 0) / 1_048_576, 2),
                    "indexes_mb": round(s.get("totalIndexSize", 0) / 1_048_576, 2),
                    "avg_doc_bytes": s.get("avgObjSize")}
        _safe(entry, "stats", stats)
        _safe(entry, "_id_types", lambda: _type_counts(coll, "_id", max_ms))
        _safe(entry, "indexes", lambda: [
            {"name": ix.get("name"), "key": list(ix.get("key", {}).items()), "unique": ix.get("unique", False),
             "partial": ix.get("partialFilterExpression") is not None, "sparse": ix.get("sparse", False),
             "ttl_seconds": ix.get("expireAfterSeconds")}
            for ix in coll.list_indexes()])
        for field in FK_CANDIDATES.get(name, []):
            _safe(entry.setdefault("fk_types", {}), field, lambda f=field: _type_counts(coll, f, max_ms))
        for field in DATE_FIELDS:
            _safe(entry.setdefault("date_types", {}), field, lambda f=field: _type_counts(coll, f, max_ms))
        entry["date_types"] = {k: v for k, v in entry["date_types"].items() if v and v != {"missing": entry.get("count")}}
        _safe(entry, "shape", lambda: _shape(coll, max_ms))
        report["collections"][name] = entry

    report["unique_conflicts"] = {}
    for coll_name, field, match in UNIQUE_CANDIDATES:
        if coll_name in names:
            _safe(report["unique_conflicts"], f"{coll_name}.{field}",
                  lambda c=coll_name, f=field, m=match: _duplicates(db[c], f, m, max_ms))
    return report


def summarize(report):
    lines = [f"Base: {report['database']}  ({report['generated_at']})", "", "COLECCIONES (por tamaño)"]
    rows = sorted(report["collections"].items(), key=lambda kv: -(kv[1].get("stats", {}).get("size_mb") or 0))
    for name, entry in rows:
        stats = entry.get("stats", {})
        lines.append(f"  {name:32} {entry.get('count', '?'):>10} docs  {stats.get('size_mb', '?'):>9} MB  "
                     f"idx {stats.get('indexes_mb', '?')} MB")
    lines += ["", "DUPLICADOS QUE BLOQUEARÍAN UNIQUE EN POSTGRES"]
    for key, dup in report["unique_conflicts"].items():
        if dup.get("error"):
            lines.append(f"  {key:32} ERROR {dup['error']}")
        elif dup.get("keys"):
            lines.append(f"  {key:32} {dup['keys']} valores repetidos ({dup['extra_docs']} documentos sobrantes)")
        else:
            lines.append(f"  {key:32} OK, sin repetidos")
    lines += ["", "LLAVES CON TIPOS MEZCLADOS"]
    mixed = 0
    for name, entry in report["collections"].items():
        for field, types in (entry.get("fk_types") or {}).items():
            real = {t: n for t, n in (types or {}).items() if t not in ("missing", "null")} if isinstance(types, dict) else {}
            if len(real) > 1:
                mixed += 1
                lines.append(f"  {name}.{field}: {real}")
        ids = {t: n for t, n in (entry.get("_id_types") or {}).items()} if isinstance(entry.get("_id_types"), dict) else {}
        if len(ids) > 1:
            mixed += 1
            lines.append(f"  {name}._id: {ids}")
    if not mixed:
        lines.append("  ninguna")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="mongo_audit.json", help="archivo JSON con el detalle")
    parser.add_argument("--max-seconds", type=int, default=60, help="límite por consulta")
    args = parser.parse_args(argv)
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        print("Falta MONGODB_URI en el entorno.", file=sys.stderr)
        return 1
    from pymongo import MongoClient
    client = MongoClient(uri, serverSelectionTimeoutMS=10000, appname="migration-audit-readonly")
    db = client[os.environ.get("DATABASE_NAME", "commercial")]
    report = audit(db, max_ms=args.max_seconds * 1000)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2, default=str)
    print(summarize(report))
    print(f"\nDetalle completo en {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
