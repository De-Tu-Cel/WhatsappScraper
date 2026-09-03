"""
Revisión profunda del clasificador:
  1. Distribución de tiempos de reacción por categoría
  2. Todos los "automatico" con contexto completo
  3. Casos HUMANO con tiempo < 2 min (potencial misclasificación)
  4. Casos BOT con tiempo > 5 min (potencial misclasificación)
  5. Distribución de notas para detectar patrones
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
from app.database import MongoDBManager
from datetime import datetime, timedelta, timezone
from collections import Counter
db = MongoDBManager()
MX = timezone(timedelta(hours=-6))

def fmt(dt):
    if not dt: return "?"
    if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MX).strftime("%m-%d %H:%M")

def get_reply(cid, recv_at):
    if not cid or not recv_at: return None
    return db.db.message_logs.find_one(
        {"company_id": cid, "direction": "outbound", "created_at": {"$lt": recv_at}},
        sort=[("created_at", -1)]
    )

print("\n" + "="*70)
print("REVISIÓN PROFUNDA DEL CLASIFICADOR")
print("="*70)

# ── 1. Tiempos de reacción por categoría ─────────────────────────────────────
print("\n1. DISTRIBUCIÓN DE TIEMPOS DE REACCIÓN POR CATEGORÍA")
print("-"*70)

for cat in ["humano", "bot", "hibrido", "automatico"]:
    docs = list(db.db.message_logs.find(
        {"direction": "inbound", "analysis.category": cat,
         "analysis.reaction_time_min": {"$exists": True}},
        {"analysis.reaction_time_min": 1}
    ))
    if not docs:
        print(f"  {cat:12s}: sin datos")
        continue
    times = [d["analysis"]["reaction_time_min"] for d in docs if d["analysis"].get("reaction_time_min") is not None]
    if not times:
        print(f"  {cat:12s}: sin reaction_time_min")
        continue
    times.sort()
    n = len(times)
    avg = sum(times) / n
    med = times[n//2]
    mn, mx_ = times[0], times[-1]
    # Buckets
    instant  = sum(1 for t in times if t < 1)
    fast     = sum(1 for t in times if 1 <= t < 5)
    medium   = sum(1 for t in times if 5 <= t < 30)
    slow     = sum(1 for t in times if t >= 30)
    print(f"  {cat:12s}  n={n:3d}  avg={avg:6.1f}m  med={med:6.1f}m  min={mn:.1f}  max={mx_:.0f}m")
    print(f"             <1m:{instant:3d}  1-5m:{fast:3d}  5-30m:{medium:3d}  >30m:{slow:3d}")


# ── 2. Todos los AUTOMATICO con contexto completo ────────────────────────────
print("\n\n2. TODOS LOS 'AUTOMATICO' — revisión completa")
print("-"*70)

autos = list(db.db.message_logs.find(
    {"direction": "inbound", "analysis.category": "automatico"},
    sort=[("created_at", -1)]
))
print(f"  Total: {len(autos)}")
for i, doc in enumerate(autos, 1):
    a = doc.get("analysis", {})
    cid = str(doc.get("company_id", ""))
    recv_at = doc.get("created_at")
    ib_body = str(doc.get("message_body", "")).strip()[:120]
    rt = a.get("reaction_time_min", "?")
    notes = (a.get("notes") or "")[:100]
    prev = get_reply(cid, recv_at)
    ob_body = str(prev.get("message_body", "")).strip()[:80] if prev else "(sin prev outbound)"
    print(f"\n  [{i:2d}] [{fmt(recv_at)}] rt={rt:.1f}m  cid={cid[:14]}")
    print(f"       OUT: {ob_body!r}")
    print(f"       IN : {ib_body!r}")
    print(f"       notes: {notes}")


# ── 3. HUMANO con reacción < 2 min — posible misclasificación ────────────────
print("\n\n3. HUMANO con reacción < 2 min (posible bot)")
print("-"*70)

fast_humans = list(db.db.message_logs.find(
    {"direction": "inbound", "analysis.category": "humano",
     "analysis.reaction_time_min": {"$lt": 2}},
    sort=[("analysis.reaction_time_min", 1)], limit=10
))
if not fast_humans:
    print("  ✓ Ninguno — todos los humano tienen reacción ≥ 2 min")
else:
    print(f"  {len(fast_humans)} casos (mostrando hasta 10):")
    for doc in fast_humans:
        a = doc.get("analysis", {})
        cid = str(doc.get("company_id", ""))
        recv_at = doc.get("created_at")
        ib_body = str(doc.get("message_body", "")).strip()[:120]
        rt = a.get("reaction_time_min", "?")
        notes = (a.get("notes") or "")[:100]
        prev = get_reply(cid, recv_at)
        ob_body = str(prev.get("message_body", "")).strip()[:80] if prev else "(sin outbound)"
        print(f"\n  [{fmt(recv_at)}] rt={rt}m  cid={cid[:14]}")
        print(f"    OUT: {ob_body!r}")
        print(f"    IN : {ib_body!r}")
        print(f"    notes: {notes}")


# ── 4. BOT con reacción > 5 min ───────────────────────────────────────────────
print("\n\n4. BOT con reacción > 5 min (posible humano)")
print("-"*70)

slow_bots = list(db.db.message_logs.find(
    {"direction": "inbound", "analysis.category": "bot",
     "analysis.reaction_time_min": {"$gt": 5}},
    sort=[("analysis.reaction_time_min", -1)], limit=10
))
if not slow_bots:
    print("  ✓ Ninguno — todos los bot tienen reacción ≤ 5 min")
else:
    print(f"  {len(slow_bots)} casos:")
    for doc in slow_bots:
        a = doc.get("analysis", {})
        cid = str(doc.get("company_id", ""))
        recv_at = doc.get("created_at")
        ib_body = str(doc.get("message_body", "")).strip()[:150]
        rt = a.get("reaction_time_min")
        notes = (a.get("notes") or "")[:100]
        prev = get_reply(cid, recv_at)
        ob_body = str(prev.get("message_body", "")).strip()[:80] if prev else "(sin outbound)"
        print(f"\n  [{fmt(recv_at)}] rt={rt:.0f}m  cid={cid[:14]}")
        print(f"    OUT: {ob_body!r}")
        print(f"    IN : {ib_body!r}")
        print(f"    notes: {notes}")


# ── 5. Notas más frecuentes — detectar patrones de clasificación ──────────────
print("\n\n5. PATRONES DE NOTAS POR CATEGORÍA (top 5)")
print("-"*70)
for cat in ["humano", "bot", "automatico"]:
    docs = list(db.db.message_logs.find(
        {"direction": "inbound", "analysis.category": cat,
         "analysis.notes": {"$exists": True, "$ne": ""}},
        {"analysis.notes": 1}
    ))
    # Take first 60 chars of notes as signature
    sigs = Counter(
        (d["analysis"].get("notes") or "")[:60].strip()
        for d in docs
        if (d["analysis"].get("notes") or "").strip()
    )
    print(f"\n  [{cat.upper()}]")
    for note, cnt in sigs.most_common(5):
        print(f"    {cnt:3d}x  {note!r}")

print()
