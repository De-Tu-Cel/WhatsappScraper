"""
Analiza sesiones reales de Andy AI en MongoDB.
Ejecutar: cd backEnd && python test_andy_sessions.py

Revisa:
  - Cómo cerraron las sesiones (end_reason)
  - Si [FIN] se disparó en los momentos correctos
  - Sesiones que expiraron sin cierre natural (posibles fallos)
  - Duración y turnos promedio
"""
import sys, os, io
sys.path.insert(0, '.')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.database import MongoDBManager
from datetime import datetime, timezone, timedelta

db = MongoDBManager()
col = db.db.ai_followup_sessions

# ─── 1. Resumen general ───────────────────────────────────────────────────────
total      = col.count_documents({})
ended      = col.count_documents({"status": "ended"})
active     = col.count_documents({"status": "active"})
waiting    = col.count_documents({"status": "waiting"})

print(f"\n{'='*55}")
print(f"  Andy AI — Análisis de sesiones reales")
print(f"{'='*55}")
print(f"  Total sesiones:    {total}")
print(f"  Activas ahora:     {active}")
print(f"  En espera:         {waiting}")
print(f"  Terminadas:        {ended}")

# ─── 2. Breakdown por end_reason ─────────────────────────────────────────────
print(f"\n--- Motivos de cierre (sesiones terminadas) ---")
reasons = col.aggregate([
    {"$match": {"status": "ended"}},
    {"$group": {"_id": "$end_reason", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}},
])
reason_map = {
    "ai_decision":       "LLM decidio cerrar ([FIN])",
    "max_turns":         "Limite de turnos alcanzado (10)",
    "user_disabled":     "Usuario desactivo manualmente",
    "repeated_message":  "Loop/mensaje repetido detectado",
    "idle_timeout":      "Timeout 4h sin actividad",
    "error":             "Error en LLM o envio",
    None:                "Sin motivo registrado",
}
for r in reasons:
    label = reason_map.get(r["_id"], str(r["_id"]))
    bar   = "#" * r["count"]
    print(f"  {label:<42}  {r['count']:>4}  {bar}")

# ─── 3. Sesiones que alcanzaron max_turns (no cerraron por [FIN]) ─────────────
max_turns_sessions = list(col.find(
    {"end_reason": "max_turns"},
    {"company_id": 1, "turn_count": 1, "turns": 1, "created_at": 1},
).sort("created_at", -1).limit(5))

if max_turns_sessions:
    print(f"\n--- Ultimas sesiones cerradas por max_turns (Andy no uso [FIN]) ---")
    for s in max_turns_sessions:
        cid   = s.get("company_id", "?")[:10]
        turns = s.get("turn_count", 0)
        date  = s.get("created_at", "?")
        # Ultimo turno de Andy para ver si habia intencion de cerrar
        andy_turns = [t for t in (s.get("turns") or []) if t.get("role") == "assistant" and not t.get("seeded")]
        last_andy  = andy_turns[-1].get("content", "") if andy_turns else ""
        print(f"\n  company: ...{cid}  turns: {turns}  fecha: {str(date)[:10]}")
        print(f"  ultimo mensaje Andy: \"{last_andy[:90]}\"")
        if "[FIN]" in last_andy:
            print(f"  [!] [FIN] estaba en el ultimo turno pero no se proceso — posible bug de parseo")
        else:
            print(f"  -> No habia [FIN] en el ultimo turno — el LLM no decidio cerrar antes del limite")

# ─── 4. Sesiones con idle_timeout — deberian haber cerrado antes ──────────────
idle_sessions = list(col.find(
    {"end_reason": "idle_timeout"},
    {"company_id": 1, "turn_count": 1, "last_activity": 1},
).sort("last_activity", -1).limit(5))

if idle_sessions:
    print(f"\n--- Ultimas sesiones por idle_timeout (4h sin respuesta del cliente) ---")
    for s in idle_sessions:
        cid    = s.get("company_id", "?")[:10]
        turns  = s.get("turn_count", 0)
        last   = s.get("last_activity", "?")
        print(f"  company: ...{cid}  turns: {turns}  ultima actividad: {str(last)[:16]}")

# ─── 5. Sesiones activas — ver si llevan mucho tiempo sin moverse ─────────────
cutoff_warn = datetime.now(timezone.utc) - timedelta(hours=1)
stale_active = list(col.find(
    {"status": {"$in": ["active", "waiting"]},
     "last_activity": {"$lt": cutoff_warn}},
    {"company_id": 1, "status": 1, "turn_count": 1, "last_activity": 1},
).sort("last_activity", 1).limit(10))

if stale_active:
    print(f"\n--- Sesiones activas/waiting sin actividad hace +1h (posiblemente olvidadas) ---")
    for s in stale_active:
        cid    = s.get("company_id", "?")[:10]
        status = s.get("status", "?")
        turns  = s.get("turn_count", 0)
        last   = s.get("last_activity") or s.get("created_at", "?")
        delta  = ""
        if hasattr(last, "replace"):
            now = datetime.now(timezone.utc)
            la  = last.replace(tzinfo=timezone.utc) if last.tzinfo is None else last
            h   = int((now - la).total_seconds() / 3600)
            delta = f"({h}h sin actividad)"
        print(f"  [{status}] company: ...{cid}  turns: {turns}  {str(last)[:16]} {delta}")
else:
    print(f"\n--- Sesiones activas/waiting: todas tienen actividad reciente ---")

# ─── 6. Muestra los ultimos 3 dialogos completos de sesiones terminadas ───────
print(f"\n--- Ultimos 3 dialogos terminados (para revisar calidad) ---")
recent_ended = list(col.find(
    {"status": "ended"},
    {"company_id": 1, "end_reason": 1, "turn_count": 1, "turns": 1, "created_at": 1},
).sort("created_at", -1).limit(3))

for i, s in enumerate(recent_ended, 1):
    cid    = s.get("company_id", "?")
    reason = s.get("end_reason", "?")
    turns_raw = [t for t in (s.get("turns") or []) if not t.get("seeded")]
    print(f"\n  [{i}] company: {cid}  cierre: {reason}  turnos: {s.get('turn_count',0)}")
    for t in turns_raw[-8:]:   # ultimos 8 turnos del dialogo
        role    = "Andy  " if t.get("role") == "assistant" else "Ellos "
        content = (t.get("content") or "")[:100].replace("\n", " ")
        print(f"    {role}: {content}")

print(f"\n{'='*55}\n")
