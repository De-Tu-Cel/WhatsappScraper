"""
Muestra 3 conversaciones reales de cada categoría con contexto completo,
para verificar manualmente si la clasificación es correcta.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
from app.database import MongoDBManager
from datetime import datetime, timedelta, timezone
db = MongoDBManager()
now = datetime.now(timezone.utc)
MX = timezone(timedelta(hours=-6))

def fmt(dt):
    if not dt: return "?"
    if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MX).strftime("%m-%d %H:%M")

# humano/bot/hibrido/automatico → stored on INBOUND messages (the reply)
# sin_respuesta → stored on OUTBOUND messages (no reply came)
INBOUND_CATS = ["humano", "bot", "hibrido", "automatico"]

print("\n" + "="*70)
print("MUESTRAS DE CLASIFICACIÓN — revisión manual")
print("="*70)

for cat in INBOUND_CATS:
    docs = list(db.db.message_logs.find(
        {"direction": "inbound", "analysis.category": cat},
        sort=[("created_at", -1)], limit=3
    ))
    print(f"\n{'='*70}")
    print(f"CATEGORÍA: {cat.upper()}  ({len(docs)} muestras recientes de todas las épocas)")
    print("="*70)

    for doc in docs:
        a = doc.get("analysis", {})
        cid = str(doc.get("company_id", ""))
        recv_at = doc.get("created_at")
        ib_body = str(doc.get("message_body", "")).strip()[:200]
        notes = a.get("notes", "")

        # Find the most recent outbound BEFORE this inbound
        prev_ob = None
        if cid and recv_at:
            prev_ob = db.db.message_logs.find_one(
                {"company_id": cid, "direction": "outbound", "created_at": {"$lt": recv_at}},
                sort=[("created_at", -1)]
            )

        print(f"\n  [{fmt(recv_at)}] company={cid[:16]}")
        if prev_ob:
            ob_body = str(prev_ob.get("message_body", "")).strip()[:150]
            print(f"  OUTBOUND : {ob_body!r}  [{fmt(prev_ob.get('created_at'))}]")
        print(f"  INBOUND  : {ib_body!r}")
        if notes:
            print(f"  notes    : {notes[:120]}")
        rt = a.get("reaction_time_min")
        if rt is not None:
            print(f"  reacción : {rt:.1f} min")

# sin_respuesta — on outbound
print(f"\n{'='*70}")
print("CATEGORÍA: SIN_RESPUESTA  (3 más recientes)")
print("="*70)
for doc in db.db.message_logs.find(
    {"direction": "outbound", "analysis.category": "sin_respuesta"},
    sort=[("created_at", -1)], limit=3
):
    a = doc.get("analysis", {})
    cid = str(doc.get("company_id", ""))
    sent_at = doc.get("created_at")
    ob_body = str(doc.get("message_body", "")).strip()[:150]
    print(f"\n  [{fmt(sent_at)}] company={cid[:16]}")
    print(f"  OUTBOUND : {ob_body!r}")
    print(f"  (no reply after 60 min)")

# ── Stuck: inbounds with company_id but no analysis > 2h ─────────────────────
print(f"\n{'='*70}")
print("INBOUNDS SIN ANÁLISIS (últimos 30 días, > 2h sin clasificar)")
print("="*70)
cutoff_30d = now - timedelta(days=30)
cutoff_2h  = now - timedelta(hours=2)
stuck = list(db.db.message_logs.find(
    {
        "direction": "inbound",
        "company_id": {"$nin": ["unknown", "", None]},
        "created_at": {"$gte": cutoff_30d, "$lte": cutoff_2h},
        "analysis": {"$exists": False},
    },
    sort=[("created_at", -1)], limit=15
))

if not stuck:
    print("  ✓ Todos los inbounds dentro de ventana tienen análisis (o son recientes)")
else:
    print(f"  ⚠  {len(stuck)} inbounds sin análisis:")
    for m in stuck:
        cid = str(m.get("company_id", ""))
        body = str(m.get("message_body", "")).strip()[:100]
        when = fmt(m.get("created_at"))
        ob = db.db.message_logs.find_one(
            {"company_id": cid, "direction": "outbound", "created_at": {"$lt": m["created_at"]}},
            sort=[("created_at", -1)]
        )
        ob_tag = "✓ob" if ob else "✗ob (inbound no solicitado)"
        print(f"  [{when}] {ob_tag}  {body!r}")

# ── Probe state summary ───────────────────────────────────────────────────────
print(f"\n{'='*70}")
print("ESTADO DE PROBES T1/T2")
print("="*70)
for stage in ["awaiting_t2", "resolved"]:
    cnt = db.db.message_logs.count_documents({"probe.stage": stage})
    print(f"  {stage:15s}: {cnt}")
stuck_probes = db.db.message_logs.count_documents({
    "probe.stage": "awaiting_t2",
    "created_at": {"$lte": now - timedelta(hours=1)},
})
print(f"  awaiting_t2 > 1h: {stuck_probes}  {'⚠ stuck!' if stuck_probes else '✓ ok'}")

# ── Overall stats ─────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print("DISTRIBUCIÓN GLOBAL (todos los tiempos)")
print("="*70)
pipeline = [
    {"$match": {"analysis": {"$exists": True}}},
    {"$group": {"_id": {"cat": "$analysis.category", "dir": "$direction"}, "count": {"$sum": 1}}},
    {"$sort": {"count": -1}},
]
for r in db.db.message_logs.aggregate(pipeline):
    cat = r["_id"]["cat"] or "(None)"
    dr  = r["_id"]["dir"] or "?"
    print(f"  {cat:20s}  {dr:8s}  {r['count']:4d}")

print()
