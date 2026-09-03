"""
Test de efectividad del clasificador de chats.
Consulta conversaciones reales de prod y verifica:
  1. Distribución de categorías (últimas 48h)
  2. Muestras de cada categoría para revisión manual
  3. Probes atascados (awaiting_t2 por más de 30 min)
  4. Detección de stuck: conversaciones sin categoría que deberían haberla tenido

Run desde backEnd/:
    python test_classifier_effectiveness.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

from datetime import datetime, timedelta, timezone
from collections import defaultdict
from app.database import MongoDBManager

db = MongoDBManager()
now = datetime.now(timezone.utc)
cutoff_48h = now - timedelta(hours=48)
cutoff_7d  = now - timedelta(days=7)

def fmt_dt(dt):
    if not dt:
        return "?"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mx = dt.astimezone(timezone(timedelta(hours=-6)))
    return mx.strftime("%m-%d %H:%M")

print("\n" + "="*65)
print("CLASIFICADOR DE CHATS — Análisis de efectividad")
print(f"Ventana: últimas 48h  ({fmt_dt(cutoff_48h)} → ahora)")
print("="*65)


# ── 1. Distribución de categorías ─────────────────────────────────────────────
print("\n1. DISTRIBUCIÓN DE CATEGORÍAS (message_logs con analysis, 48h)")
print("-"*65)

pipeline = [
    {"$match": {
        "direction": "outbound",
        "created_at": {"$gte": cutoff_48h},
        "analysis": {"$exists": True},
    }},
    {"$group": {
        "_id": "$analysis.category",
        "count": {"$sum": 1},
    }},
    {"$sort": {"count": -1}},
]
cat_counts = list(db.db.message_logs.aggregate(pipeline))
total = sum(r["count"] for r in cat_counts)
for row in cat_counts:
    cat = row["_id"] or "(None)"
    cnt = row["count"]
    pct = cnt / total * 100 if total else 0
    print(f"  {cat:20s}  {cnt:4d}  ({pct:5.1f}%)")
print(f"  {'TOTAL':20s}  {total:4d}")


# ── 2. Muestras de cada categoría ─────────────────────────────────────────────
SAMPLE_CATS = ["humano", "bot", "hibrido", "sin_respuesta"]
print("\n2. MUESTRAS (3 por categoría, más recientes)")
print("-"*65)

for cat in SAMPLE_CATS:
    samples = list(db.db.message_logs.find(
        {
            "direction": "outbound",
            "created_at": {"$gte": cutoff_48h},
            "analysis.category": cat,
        },
        {
            "_id": 1, "message_body": 1, "created_at": 1,
            "analysis.category": 1, "analysis.notes": 1,
            "analysis.response_quality": 1, "company_id": 1,
        },
        limit=3,
    ).sort("created_at", -1))

    print(f"\n  [{cat.upper()}] ({len(samples)} muestras)")
    for s in samples:
        body = (s.get("message_body") or "")[:120].replace("\n", " ")
        notes = (s.get("analysis") or {}).get("notes") or ""
        rq    = (s.get("analysis") or {}).get("response_quality")
        when  = fmt_dt(s.get("created_at"))
        cid   = str(s.get("company_id", ""))[:12]
        print(f"    [{when}] cid={cid}")
        print(f"      outbound: {body!r}")
        if notes:
            print(f"      notes:    {notes[:100]}")
        if rq is not None:
            print(f"      quality:  {rq}")

    # Para humano/bot/hibrido, intentar mostrar también la respuesta inbound
    if cat in ("humano", "bot", "hibrido"):
        sample_doc = samples[0] if samples else None
        if sample_doc:
            cid      = str(sample_doc.get("company_id", ""))
            sent_at  = sample_doc.get("created_at")
            if cid and sent_at:
                reply = db.db.message_logs.find_one(
                    {
                        "company_id": cid,
                        "direction": "inbound",
                        "created_at": {"$gt": sent_at},
                    },
                    sort=[("created_at", 1)],
                )
                if reply:
                    rb = (reply.get("message_body") or "")[:150].replace("\n", " ")
                    rw = fmt_dt(reply.get("created_at"))
                    print(f"\n    → inbound [{rw}]: {rb!r}")


# ── 3. Probes atascados (awaiting_t2 > 30 min) ────────────────────────────────
print("\n\n3. PROBES ATASCADOS (awaiting_t2 > 30 min sin resolver)")
print("-"*65)

stuck_threshold = now - timedelta(minutes=30)
stuck_probes = list(db.db.message_logs.find(
    {
        "probe.stage": "awaiting_t2",
        "created_at": {"$lte": stuck_threshold},
    },
    {
        "_id": 1, "created_at": 1, "company_id": 1,
        "probe.sent_at": 1, "analysis.category": 1,
    },
    limit=20,
).sort("created_at", 1))

if not stuck_probes:
    print("  ✓ No hay probes atascados")
else:
    print(f"  ⚠  {len(stuck_probes)} probes atascados:")
    for p in stuck_probes:
        sent   = p.get("probe", {}).get("sent_at")
        when   = fmt_dt(p.get("created_at"))
        cid    = str(p.get("company_id", ""))[:12]
        age_m  = int((now - (p["created_at"].replace(tzinfo=timezone.utc) if p["created_at"].tzinfo is None else p["created_at"])).total_seconds() / 60)
        print(f"    [{when}] cid={cid}  age={age_m}m")


# ── 4. Conversaciones stuck: inbounds sin análisis > 60 min ──────────────────
print("\n4. INBOUNDS SIN ANÁLISIS > 60 MIN (posible stuck/fallo del clasificador)")
print("-"*65)

stuck_cutoff = now - timedelta(minutes=60)
stuck_cutoff_7d = now - timedelta(days=7)

stuck_inbounds = list(db.db.message_logs.find(
    {
        "direction": "inbound",
        "company_id": {"$nin": ["unknown", "", None]},
        "created_at": {"$gte": stuck_cutoff_7d, "$lte": stuck_cutoff},
        "analysis": {"$exists": False},
    },
    {"_id": 1, "created_at": 1, "company_id": 1, "message_body": 1},
    limit=20,
).sort("created_at", -1))

if not stuck_inbounds:
    print("  ✓ No hay inbounds sin análisis en ventana 7d-60m")
else:
    print(f"  ⚠  {len(stuck_inbounds)} inbounds sin análisis:")
    for m in stuck_inbounds:
        when  = fmt_dt(m.get("created_at"))
        cid   = str(m.get("company_id", ""))[:12]
        body  = (m.get("message_body") or "")[:80].replace("\n", " ")
        # Check if there's a corresponding outbound before it
        outbound = db.db.message_logs.find_one(
            {
                "company_id": m["company_id"],
                "direction": "outbound",
                "created_at": {"$lt": m["created_at"]},
            },
            sort=[("created_at", -1)],
        )
        has_ob = "✓ob" if outbound else "✗ob"
        print(f"    [{when}] {has_ob} cid={cid}  {body!r}")


# ── 5. Tasa de respuesta global ───────────────────────────────────────────────
print("\n5. TASA DE RESPUESTA (48h)")
print("-"*65)

responded = db.db.message_logs.count_documents({
    "direction": "outbound",
    "created_at": {"$gte": cutoff_48h},
    "analysis.category": {"$in": ["humano", "bot", "hibrido"]},
})
no_resp = db.db.message_logs.count_documents({
    "direction": "outbound",
    "created_at": {"$gte": cutoff_48h},
    "analysis.category": "sin_respuesta",
})
pending = db.db.message_logs.count_documents({
    "direction": "outbound",
    "created_at": {"$gte": cutoff_48h},
    "analysis": {"$exists": False},
})

total_sent = responded + no_resp + pending
rate = responded / (responded + no_resp) * 100 if (responded + no_resp) else 0
print(f"  Respondieron:    {responded:4d}  ({rate:.1f}% de clasificados)")
print(f"  Sin respuesta:   {no_resp:4d}")
print(f"  Aún pendientes:  {pending:4d}  (pueden ser recientes)")
print(f"  Total enviados:  {total_sent:4d}")

print("\n" + "="*65 + "\n")
