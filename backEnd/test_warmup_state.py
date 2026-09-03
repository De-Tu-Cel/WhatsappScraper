"""
Estado actual del sistema warmup en DB — sin tocar nada.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
from app.database import MongoDBManager
from datetime import datetime, timedelta, timezone
db = MongoDBManager()
MX = timezone(timedelta(hours=-6))
now = datetime.now(timezone.utc)

def fmt(dt):
    if not dt: return "?"
    if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MX).strftime("%m-%d %H:%M")

print("\n" + "="*65)
print("WARMUP — Estado actual en DB")
print("="*65)

# ── 1. Configuración global ───────────────────────────────────────
cfg = db.db.warmup_config.find_one({"_id": "global"}) or {}
print("\n1. WARMUP CONFIG GLOBAL")
if not cfg:
    print("  ⚠ No existe doc 'global' en warmup_config — defaults en código")
else:
    for k, v in cfg.items():
        if k != "_id":
            print(f"  {k:30s}: {v}")

# ── 2. Instancias wwebjs con peer warmup ─────────────────────────
print("\n2. INSTANCIAS WWEBJS")
instances = list(db.db.instances.find({"provider": "wwebjs"}))
print(f"  Total wwebjs: {len(instances)}")
for inst in instances:
    name   = inst.get("name", "?")
    num    = inst.get("number", "?")
    wm     = inst.get("warmup_mode", False)
    pe     = inst.get("peer_warmup_enabled", None)
    pp     = inst.get("peer_warmup_paused", False)
    user   = inst.get("assigned_to", "?")[:8]
    status = []
    if pe is False:   status.append("peer_OFF")
    elif pe:          status.append("peer_ON")
    else:             status.append("peer_?")
    if pp:            status.append("PAUSED")
    if wm:            status.append("warmup_mode")
    print(f"  {name:20s}  {num:15s}  user={user}  [{', '.join(status)}]")

# ── 3. Sesiones de hoy ────────────────────────────────────────────
today = now.astimezone(MX).strftime("%Y-%m-%d")
print(f"\n3. SESIONES DE HOY ({today})")
sessions_today = list(db.db.warmup_sessions.find({"date": today}))
print(f"  Total sesiones hoy: {len(sessions_today)}")
for s in sessions_today:
    a = s.get("instance_a", "?")
    b = s.get("instance_b", "?")
    spk = s.get("next_speaker", "?")
    nxt = fmt(s.get("next_send_at"))
    tot = s.get("total_messages_today", 0)
    msgs = s.get("messages", [])
    last_msg = msgs[-1].get("content", "")[:50] if msgs else "(sin mensajes)"
    print(f"  {a} ↔ {b}  spk={spk}  next={nxt}  msgs={tot}")
    print(f"    último: {last_msg!r}")

# ── 4. Sesiones recientes (últimos 3 días) ────────────────────────
cutoff = (now - timedelta(days=3)).astimezone(MX).strftime("%Y-%m-%d")
recent = list(db.db.warmup_sessions.find({"date": {"$gte": cutoff}}).sort("date", -1))
print(f"\n4. SESIONES ÚLTIMOS 3 DÍAS ({cutoff} → hoy)")
print(f"  Total: {len(recent)}")
by_date = {}
for s in recent:
    d = s.get("date", "?")
    by_date.setdefault(d, []).append(s)
for date, sess in sorted(by_date.items(), reverse=True):
    total_msgs = sum(s.get("total_messages_today", 0) for s in sess)
    print(f"  {date}: {len(sess)} pares, {total_msgs} mensajes totales")

# ── 5. Últimos message_logs de warmup ────────────────────────────
print("\n5. ÚLTIMOS 5 MENSAJES DE WARMUP")
wm_logs = list(db.db.message_logs.find(
    {"is_warmup": True},
    sort=[("created_at", -1)], limit=5
))
if not wm_logs:
    print("  (ninguno)")
for log in wm_logs:
    inst = log.get("instance_name", "?")
    to   = log.get("to_number", "?")
    body = str(log.get("message_text") or log.get("message_body") or "")[:60]
    when = fmt(log.get("created_at"))
    print(f"  [{when}] {inst} → {to}: {body!r}")

print()
