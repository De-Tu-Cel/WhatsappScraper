"""Mensajes que la sincronización volvió a guardar (57 pares, 2026-10-21; autorizado por el usuario).

Par = misma empresa, dirección y número (últimos 10 dígitos), ≤5 s, mismo texto (o casi: editado en
WhatsApp), y solo una copia con id de WhatsApp. Se conserva la del webhook (sin id: trae
received_on_instance, que usan las métricas) y recibe el id real; se borra la de la sincronización.
Todo por la capa (MongoDBManager().db), así el espejo de Postgres queda igual.

En la terminal del backend (Coolify):
    python scripts/limpiar_duplicados_sync.py            # solo revisa y escribe el respaldo
    python scripts/limpiar_duplicados_sync.py aplicar    # limpia
El respaldo (lo que se conserva y lo que se borra, completo) queda en /tmp del contenedor; además se
imprimen los _id. La causa ya está corregida en api_sync_conversation (_guardado_sin_id).
"""
import difflib
import re
import sys
from collections import defaultdict
from pathlib import Path

_API = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(_API / "app"), str(_API)]
from bson import json_util  # noqa: E402

from app.database import MongoDBManager  # noqa: E402

APLICAR = "aplicar" in sys.argv[1:]
RESPALDO = "/tmp/respaldo-duplicados-message_logs-20261021.json"
m = MongoDBManager()
raw, capa = m.raw_db.message_logs, m.db.message_logs


def num(d):
    return re.sub(r"\D", "", str(d.get("from_number") if d.get("direction") == "inbound" else d.get("to_number") or ""))[-10:]


def casi(a, b):
    a, b = " ".join(a.split()), " ".join(b.split())
    return a == b or (min(len(a), len(b)) >= 20 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.85)


grupos = defaultdict(list)
for d in raw.find({}).sort("created_at", 1):
    if d.get("created_at") and (d.get("message_body") or "").strip():
        grupos[(d.get("company_id"), d.get("direction"), num(d))].append(d)
pares, usados = [], set()
for ms in grupos.values():
    for i, a in enumerate(ms):
        for b in ms[i + 1:i + 4]:
            if (b["created_at"] - a["created_at"]).total_seconds() > 5:
                break
            if a["_id"] in usados or b["_id"] in usados:
                continue
            if casi(a["message_body"], b["message_body"]) and bool(a.get("message_id")) != bool(b.get("message_id")):
                queda, sobra = (a, b) if not a.get("message_id") else (b, a)
                pares.append((queda, sobra))
                usados |= {a["_id"], b["_id"]}
empresas = {q.get("company_id") for q, _ in pares}
print(f"pares: {len(pares)} en {len(empresas)} empresas · {'APLICANDO' if APLICAR else 'solo revisión'}")
with open(RESPALDO, "w", encoding="utf-8") as f:
    f.write(json_util.dumps([{"conservar": q, "borrar": s} for q, s in pares], indent=1))
print("respaldo:", RESPALDO)
if APLICAR:
    borrados = actualizados = 0
    for queda, sobra in pares:
        # El índice de message_id es único: primero se borra la copia, luego su id pasa a la que queda.
        borrados += capa.delete_one({"_id": sobra["_id"], "message_id": sobra["message_id"]}).deleted_count
        actualizados += capa.update_one({"_id": queda["_id"], "message_id": {"$in": [None, ""]}},
                                        {"$set": {"message_id": sobra["message_id"]}}).modified_count
    print(f"borrados: {borrados} · con su id real: {actualizados}")
    print("_id borrados:", ", ".join(str(s["_id"]) for _, s in pares))
    restantes = sum(1 for q, s in pares if raw.find_one({"_id": s["_id"]}))
    print("copias que siguen en Mongo:", restantes)
