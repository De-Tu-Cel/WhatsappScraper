"""
Test manual del sistema warmup.
Ejecutar desde backEnd/:  python test_warmup.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

from app.database import MongoDBManager
from app.warmup_queue import (
    _get_warmup_instances,
    _get_today_pairs,
    _get_or_create_session,
    _generate_message,
    _process_pair,
    _mx_now,
)

db = MongoDBManager()

print("\n=== 1. Instancias disponibles para warmup ===")
instances = _get_warmup_instances(db)
if not instances:
    print("  ❌ Ninguna instancia conectada con warmup habilitado")
    sys.exit(1)
for i in instances:
    status = "⏸ pausada" if i.get("paused") else "✅ activa"
    print(f"  {status}  {i['name']}  ({i['number']})")

print(f"\n=== 2. Pares de hoy ({_mx_now().strftime('%Y-%m-%d')}) ===")
pairs = _get_today_pairs(instances)
if not pairs:
    print("  ❌ No hay pares (se necesitan al menos 2 instancias)")
    sys.exit(1)
for a, b in pairs:
    print(f"  {a['name']}  ↔  {b['name']}")

print("\n=== 3. Generando mensaje de prueba (LLM) ===")
try:
    msg = _generate_message([], "a", session_id="test-123")
    print(f"  Mensaje generado: «{msg}»")
except Exception as e:
    print(f"  ❌ Error LLM: {e}")
    sys.exit(1)

print("\n=== 4. Sesión del primer par ===")
inst_a, inst_b = pairs[0]
today = _mx_now().strftime("%Y-%m-%d")
session = _get_or_create_session(db, inst_a, inst_b, today)
print(f"  Session ID: {session['_id']}")
print(f"  Mensajes hoy: {session['total_messages_today']}")
print(f"  Próximo turno: {session.get('next_speaker', 'a').upper()}")
print(f"  Próximo envío: {session.get('next_send_at', 'ahora')}")

print("\n=== 5. Forzar un turno de envío ===")
from datetime import datetime
from app.warmup_queue import _load_config
config = _load_config(db)

# Forzar next_send_at al pasado para que _process_pair envíe ahora
db.db.warmup_sessions.update_one(
    {"_id": session["_id"]},
    {"$set": {"next_send_at": datetime(2000, 1, 1)}}
)
session["next_send_at"] = datetime(2000, 1, 1)

print(f"\n  Enviando mensaje de {inst_a['name']} → {inst_b['name']}...")
if True:
    try:
        _process_pair(db, inst_a, inst_b, session, config)
        updated = db.db.warmup_sessions.find_one({"_id": session["_id"]})
        new_count = updated.get("total_messages_today", 0)
        last_msg = (updated.get("messages") or [{}])[-1].get("content", "")
        print(f"\n  ✅ Mensaje enviado — total hoy: {new_count}")
        print(f"  Texto: «{last_msg}»")
    except Exception as e:
        print(f"\n  ❌ Error al enviar: {e}")
else:
    print("  Skipped.")

print("\n=== Done ===\n")
