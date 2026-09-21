"""
Test 2 — Andy conversacional en gely-test2
==========================================
Simula un mensaje entrante al webhook para disparar el AI followup
sin depender de que un humano mande un WhatsApp real.

Flujo simulado:
  1. Crea (o reutiliza) una sesión ai_followup para el número de prueba
  2. Llama process_inbound_message() directamente — mismo código que el webhook real
  3. Mide tiempos: read_delay + typing_delay + tiempo total
  4. Imprime la respuesta generada por Andy y evalúa si suena humano

Uso:
    # Simular conversación con número de prueba (no envía WhatsApp real):
    python test_andy_conversation.py --phone +521234567890 --dry-run

    # Enviar respuesta real a ese número:
    python test_andy_conversation.py --phone +521234567890

    # Múltiples turnos (simular conversación de ida y vuelta):
    python test_andy_conversation.py --phone +521234567890 --turns 3 --dry-run
"""
import sys, os, time, argparse, random, re
_tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_tests_dir, '..', 'app'))
sys.path.insert(0, os.path.join(_tests_dir, '..'))

from config import MONGODB_URI, DATABASE_NAME
from database import MongoDBManager

INSTANCE = "gely-test2"
GREEN, YELLOW, RED, CYAN, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[96m", "\033[0m"

def ok(msg):   print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET} {msg}")
def fail(msg): print(f"  {RED}✗{RESET} {msg}")
def info(msg): print(f"  {CYAN}→{RESET} {msg}")


# ─── Frases simuladas como si un contacto respondiera ────────────────────────

SIMULATED_REPLIES = [
    "Hola, sí quién eres?",
    "De qué empresa eres?",
    "Qué tipo de servicio ofreces?",
    "Cuánto cuesta?",
    "Ah ok, y cómo puedo saber más?",
    "Eres un bot?",
    "Sí me interesa, cuéntame más",
    "No gracias, no necesito nada",
    "Mándame info por favor",
]


# ─── Análisis de calidad "suena humano" ─────────────────────────────────────

def score_humanness(text: str) -> dict:
    """Evalúa qué tan humano suena el texto de Andy. Retorna score 0-100."""
    issues = []
    score = 100

    if len(text) > 300:
        issues.append("Muy largo para WhatsApp (>300 chars)")
        score -= 20

    sentences = [s.strip() for s in re.split(r'[.!?]', text) if s.strip()]
    if len(sentences) > 3:
        issues.append(f"Demasiadas oraciones: {len(sentences)} (máx 3)")
        score -= 15

    if re.search(r'^\s*[-•*]\s+', text, re.MULTILINE):
        issues.append("Contiene bullet points — no es estilo WhatsApp")
        score -= 20

    if re.search(r'^\d+\.\s+', text, re.MULTILINE):
        issues.append("Contiene lista numerada — no es estilo WhatsApp")
        score -= 15

    perfect_punctuation = all(s[0].isupper() for s in sentences if s)
    all_accented = not re.search(r'\b(mas|como|que|si|solo|tu|el)\b', text)
    if perfect_punctuation and all_accented and len(text) > 50:
        issues.append("Ortografía demasiado perfecta — puede sonar a bot")
        score -= 10

    if text.endswith('.') and len(text) < 100:
        issues.append("Termina en punto en mensaje corto (WhatsApp no suele)")
        score -= 5

    emoji_count = len(re.findall(r'[\U0001F300-\U0001FFFF]', text))
    if emoji_count > 3:
        issues.append(f"Demasiados emojis: {emoji_count}")
        score -= 10

    return {"score": max(0, score), "issues": issues}


# ─── Simular un turno de conversación ───────────────────────────────────────

def simulate_turn(db, phone: str, inbound_text: str, turn_num: int, dry_run: bool):
    print(f"\n{'─'*55}")
    print(f"  TURNO {turn_num}")
    print(f"  Inbound : \"{inbound_text}\"")
    print(f"{'─'*55}\n")

    # Asegurar que existe la sesión y el company en DB (necesario para el followup)
    from datetime import datetime
    company = db.db.companies.find_one({"whatsapp_number": phone})
    if not company:
        # Crear empresa ficticia para el test
        result = db.db.companies.insert_one({
            "name": f"Test Contact ({phone})",
            "whatsapp_number": phone,
            "assigned_instance": INSTANCE,
            "industry": "Comercio",
            "city": "México",
            "created_at": datetime.now(),
            "_test": True,
        })
        company_id = str(result.inserted_id)
        info(f"Empresa de prueba creada: {company_id}")
    else:
        company_id = str(company["_id"])
        info(f"Usando empresa existente: {company.get('name')} ({company_id})")

    # Asegurar que asignada la instancia correcta
    db.db.companies.update_one(
        {"_id": company["_id"] if company else db.db.companies.find_one({"_id": __import__('bson').ObjectId(company_id)})["_id"]},
        {"$set": {"assigned_instance": INSTANCE}},
    )

    # Registrar un outbound previo para que el followup sepa que contactamos a este número
    existing_log = db.db.message_logs.find_one({"company_id": company_id, "direction": "outbound"})
    if not existing_log:
        db.db.message_logs.insert_one({
            "company_id": company_id,
            "direction": "outbound",
            "channel": "whatsapp",
            "platform": "wwebjs",
            "instance_name": INSTANCE,
            "to_number": phone,
            "message_body": "Hola, vi que tienen un negocio interesante — ¿siguen en operación?",
            "created_at": datetime.now(),
            "_test": True,
        })
        info("Outbound log de prueba creado (necesario para que Andy responda)")

    if dry_run:
        # Solo llamar al LLM para generar la respuesta, sin enviarla por WA
        info("DRY RUN — generando respuesta sin enviar por WhatsApp")
        _test_llm_only(db, phone, inbound_text, company_id)
    else:
        # Llamar al followup real (envía por WhatsApp)
        info("Llamando process_inbound_message() (enviará mensaje real)...")
        t0 = time.time()
        from ai_followup import process_inbound_message
        process_inbound_message(
            db=db,
            phone_number=phone,
            inbound_body=inbound_text,
            instance_name=INSTANCE,
        )
        elapsed = time.time() - t0
        ok(f"Completado en {elapsed:.1f}s total")


def _test_llm_only(db, phone: str, inbound_text: str, company_id: str):
    """Llama solo al LLM sin enviar por WhatsApp — para evaluar calidad de respuesta."""
    from ai_followup import _call_llm_for_reply, RESPONSE_DELAY_MIN, RESPONSE_DELAY_MAX, _typing_duration_ms
    from datetime import datetime

    company = db.db.companies.find_one({"whatsapp_number": phone}) or {}
    context = {
        "company_name": company.get("name", "Test"),
        "industry":     company.get("industry", "Comercio"),
        "city":         company.get("city", "México"),
        "initial_message": "Hola, vi que tienen un negocio interesante",
    }

    turns = [{"role": "user", "content": inbound_text}]
    prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}

    info("Llamando al LLM...")
    t0 = time.time()
    response = _call_llm_for_reply(turns, context, is_cold_start=True, prefs=prefs, db=db)
    llm_time = time.time() - t0

    if not response:
        fail("LLM no retornó respuesta")
        return

    # Calcular delays simulados
    read_delay_sim = random.uniform(RESPONSE_DELAY_MIN, RESPONSE_DELAY_MAX)
    typing_ms_sim  = _typing_duration_ms(response)

    print()
    print(f"  {'─'*50}")
    print(f"  Respuesta Andy: \"{response}\"")
    print(f"  {'─'*50}")
    print(f"  LLM tiempo     : {llm_time:.2f}s")
    print(f"  Read delay sim : {read_delay_sim:.1f}s")
    print(f"  Typing delay   : {typing_ms_sim/1000:.1f}s  ({len(response)} chars × ~70ms)")
    print(f"  Total simulado : {read_delay_sim + typing_ms_sim/1000:.1f}s")
    print()

    # Score humanness
    eval_result = score_humanness(response)
    score = eval_result["score"]
    color = GREEN if score >= 80 else (YELLOW if score >= 60 else RED)
    print(f"  Score humano: {color}{score}/100{RESET}")
    if eval_result["issues"]:
        for issue in eval_result["issues"]:
            warn(issue)
    else:
        ok("Sin problemas detectados — respuesta suena natural")


# ─── Cleanup de datos de prueba ──────────────────────────────────────────────

def cleanup_test_data(db, phone: str):
    print(f"\n  Limpiando datos de prueba para {phone}...")
    r1 = db.db.companies.delete_many({"whatsapp_number": phone, "_test": True})
    r2 = db.db.message_logs.delete_many({"to_number": phone, "_test": True})
    r3 = db.db.ai_followup_sessions.delete_many({"phone_number": phone})
    ok(f"Eliminados: {r1.deleted_count} empresas, {r2.deleted_count} logs, {r3.deleted_count} sesiones Andy")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Andy conversacional en gely-test2")
    parser.add_argument("--phone", required=True, help="Número de prueba, ej: +521234567890")
    parser.add_argument("--dry-run", action="store_true", help="Solo LLM, sin enviar WhatsApp real")
    parser.add_argument("--turns", type=int, default=1, help="Número de turnos a simular (default: 1)")
    parser.add_argument("--message", help="Mensaje específico a simular (si no, se elige aleatoriamente)")
    parser.add_argument("--cleanup", action="store_true", help="Eliminar datos de prueba al final")
    args = parser.parse_args()

    print(f"\n{'='*55}")
    print(f"  TEST ANDY CONVERSACIONAL — {INSTANCE}")
    print(f"  Teléfono : {args.phone}")
    print(f"  Modo     : {'DRY RUN' if args.dry_run else 'REAL (enviará WhatsApp)'}")
    print(f"  Turnos   : {args.turns}")
    print(f"{'='*55}")

    db = MongoDBManager()

    for turn in range(1, args.turns + 1):
        if args.message and turn == 1:
            msg = args.message
        else:
            msg = random.choice(SIMULATED_REPLIES)
        simulate_turn(db, args.phone, msg, turn, dry_run=args.dry_run)
        if turn < args.turns:
            wait = random.uniform(8, 20)
            print(f"\n  Esperando {wait:.0f}s entre turnos...")
            time.sleep(wait)

    if args.cleanup:
        cleanup_test_data(db, args.phone)

    print(f"\n{'='*55}\n")
