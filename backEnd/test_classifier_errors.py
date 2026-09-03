"""
Diagnóstico de los "Error al clasificar" — cuándo, con qué mensajes, patrón de fallas.
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
    return dt.astimezone(MX).strftime("%Y-%m-%d %H:%M")

errors = list(db.db.message_logs.find(
    {"direction": "inbound", "analysis.notes": "Error al clasificar"},
    sort=[("created_at", 1)]
))
print(f"\nTotal 'Error al clasificar': {len(errors)}")

# Agrupar por día
by_day = Counter()
for e in errors:
    dt = e.get("created_at")
    if dt:
        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
        day = dt.astimezone(MX).strftime("%Y-%m-%d")
        by_day[day] += 1

print("\nDistribución por día:")
for day, cnt in sorted(by_day.items()):
    bar = "█" * cnt
    print(f"  {day}  {cnt:3d}  {bar}")

# Muestra de mensajes que fallaron — ¿qué tipo de contenido?
print("\nMuestras de mensajes que fallaron (primeros 15):")
for e in errors[:15]:
    body = str(e.get("message_body") or "").strip()[:120]
    rt = (e.get("analysis") or {}).get("reaction_time_min", "?")
    dt = fmt(e.get("created_at"))
    enc = "non-ASCII" if any(ord(c) > 127 for c in body) else "ASCII"
    print(f"  [{dt}] rt={rt}m  [{enc}]  {body!r}")

# ¿Hay mensajes no-latinos?
non_latin = [e for e in errors if any(ord(c) > 0x04FF for c in str(e.get("message_body") or ""))]
print(f"\n  No-latinos (hebreo, árabe, chino, etc.): {len(non_latin)}")
for e in non_latin[:5]:
    body = str(e.get("message_body") or "").strip()[:80]
    print(f"    {body!r}")

# Clústeres de tiempo — errores en ráfagas (sugieren outage del LLM)
print("\nRáfagas de errores (>3 en 10 min):")
times = sorted([e["created_at"].replace(tzinfo=timezone.utc) if e.get("created_at") and e["created_at"].tzinfo is None else e.get("created_at") for e in errors if e.get("created_at")])
bursts = []
window_start = None
window_count = 0
for t in times:
    if window_start is None:
        window_start, window_count = t, 1
    elif (t - window_start).total_seconds() <= 600:
        window_count += 1
    else:
        if window_count >= 3:
            bursts.append((window_start, window_count))
        window_start, window_count = t, 1
if window_count >= 3:
    bursts.append((window_start, window_count))

if bursts:
    for ts, cnt in bursts:
        print(f"  {fmt(ts)}: {cnt} errores en ≤10 min → posible outage LLM")
else:
    print("  Ninguna — errores dispersos (parsing/red esporádicos)")
