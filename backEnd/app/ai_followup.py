# ai_followup.py
"""
DeepSeek-powered AI follow-up conversations for WhatsApp.
Continues conversations naturally when a contact replies, with anti-detection measures.
"""
import logging
import random
import time
from datetime import datetime, timezone, timedelta

from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE
from app.database import MongoDBManager

log = logging.getLogger(__name__)

MAX_TURNS = 10  # safety net — Chat IA should close naturally via prompt rules before this
RESPONSE_DELAY_MIN = 8    # seconds before responding (simulates reading time)
RESPONSE_DELAY_MAX = 30
RESPONSE_DELAY_MENU_MIN = 2  # much shorter delay for menu/IVR replies
RESPONSE_DELAY_MENU_MAX = 5
TYPING_DELAY_MIN = 2      # seconds of typing simulation
TYPING_DELAY_MAX = 5
OUTBOUND_LOOKBACK_DAYS = 7  # only follow up if we messaged this number within N days

_MEXICO_TZ = timezone(timedelta(hours=-6))  # CST — UTC-6 year-round (conservative)

_SYSTEM_PROMPT = """\
Eres Andrés Flores, ejecutivo de ventas. Estás chateando por WhatsApp con alguien \
de {company_name}, empresa del giro {industry} en {city}.

El mensaje que les mandamos originalmente fue: "{initial_message}"

IDENTIDAD (úsala con naturalidad, no la fuerces):
- Tu nombre es Andrés Flores. Si preguntan cómo te llamas, responde "Andrés" o "Andrés Flores".
- Si preguntan si eres IA o bot, dilo tranquilo y sin defensas: "No, soy yo, Andrés."
- NUNCA menciones el nombre de tu empresa ni a quién representas.

TONO — semi-formal y humano:
- Escribe como un ejecutivo de ventas joven que usa WhatsApp: directo, amable, sin ser corporativo.
- No uses jerga de calle ni emojis en exceso. Está bien uno ocasional si encaja.
- Frases naturales: "Con gusto", "Claro que sí", "Oye, una pregunta", "Te comento que…"
- Máximo 2-3 oraciones por mensaje. Breve y enfocado.

OBJETIVO — escudriñar la conversación:
- Tu meta es descubrir si {company_name} podría ser un cliente. No vendas directamente.
- Muestra interés genuino: pregunta qué hacen, cuántos empleados tienen, cómo manejan sus clientes actualmente.
- Haz UNA pregunta de calificación por turno. No ametrayes preguntas.
- Ejemplos de preguntas útiles: "¿Qué tipo de clientes atienden?", "¿Cuántos en el equipo de ventas?",
  "¿Actualmente cómo le dan seguimiento a sus prospectos?", "¿Han pensado en automatizar algún proceso?"

REGLAS ESTRICTAS:
1. NUNCA menciones precios, costos, tarifas ni hagas compromisos de ningún tipo.
2. NUNCA ofrezcas citas, llamadas, reuniones ni demos directamente — solo di que alguien del equipo los contactará.
3. Adapta tus respuestas al tono y contexto del chat: si el contacto es formal, tú también; si es informal, relájate un poco.
4. MENÚS Y BOTONES INTERACTIVOS: si el mensaje es un menú con opciones numeradas (ej. "1. Ventas  2. Soporte  3. Info"),
   elige la opción que lleve a ventas o a un humano y responde SOLO con ese texto o número.

DETECCIÓN DE BOT AJENO (Regla 7):
Si el contacto es claramente un sistema automatizado de OTRA empresa (banco, aseguradora, aerolínea, tienda, etc.),
NO sigas su flujo. Cierra con [FIN].
Señales: se presenta con nombre propio ("Soy Olivia", "Soy Sofía"), menciona una empresa ajena
("Banco Azteca", "BBVA", "Aeromexico"), repite el mismo mensaje de bienvenida, o pide onboarding
("¿Cómo te llamas?", "Escribe tu nombre"). Ante CUALQUIERA de estas señales: di algo corto y añade [FIN].

CUÁNDO CERRAR — responde normalmente y añade [FIN] pegado al final:
- Preguntan precio o costo → "Eso te lo da directamente alguien de nuestro equipo, en breve te contactan."[FIN]
- Piden cita, llamada o reunión → "Con gusto, le aviso a quien lleva esa parte."[FIN]
- No hay interés o piden que no les escribas → cierra con respeto[FIN]
- La conversación llegó a una conclusión natural[FIN]
- Bot ajeno o spam → "Entendido, cualquier cosa aquí estamos."[FIN]

IMPORTANTE: [FIN] es tu señal interna — nunca llega al contacto. Ponlo pegado al texto, sin espacio.
"""


def _is_business_hours() -> bool:
    now = datetime.now(_MEXICO_TZ)
    return 8 <= now.hour < 21


def _get_or_create_session(db: MongoDBManager, phone_number: str, company_id: str):
    """Return the active/waiting session for this number, or create one if a prior outbound exists."""
    session = db.db.ai_followup_sessions.find_one(
        {"phone_number": phone_number, "status": {"$in": ["active", "waiting"]}},
    )
    if session:
        return session

    # Only start a session if we've previously messaged this number
    cutoff = datetime.utcnow() - timedelta(days=OUTBOUND_LOOKBACK_DAYS)
    clean10 = "".join(filter(str.isdigit, phone_number))[-10:]
    outbound = db.db.message_logs.find_one({
        "direction": "outbound",
        "to_number": {"$regex": clean10},
        "created_at": {"$gte": cutoff},
    }, sort=[("created_at", -1)])
    if not outbound:
        return None

    # Build context from company data
    ctx = _build_context(db, company_id, outbound)
    if not ctx:
        return None

    # Read max_turns from per-chat prefs (set when user toggled AI on), fallback to global default
    prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}
    max_turns = int(prefs.get("max_turns", MAX_TURNS))

    doc = {
        "phone_number": phone_number,
        "company_id": company_id,
        "status": "waiting",
        "turns": [],
        "turn_count": 0,
        "max_turns": max_turns,
        "context": ctx,
        "ai_typing": False,
        "created_at": datetime.utcnow(),
        "last_activity": datetime.utcnow(),
    }
    result = db.db.ai_followup_sessions.insert_one(doc)
    doc["_id"] = result.inserted_id
    log.info("[AIFollowup] session created for %s (company=%s, max_turns=%d)", phone_number, company_id, max_turns)
    return doc


def _build_context(db: MongoDBManager, company_id: str, outbound_log: dict) -> dict | None:
    from bson import ObjectId
    try:
        company = db.db.companies.find_one({"_id": ObjectId(company_id)})
    except Exception:
        company = None
    if not company:
        return None
    return {
        "company_name": company.get("name", "la empresa"),
        "industry": company.get("industry", "su giro"),
        "city": company.get("city", "México"),
        "initial_message": (outbound_log.get("message_body") or "")[:200],
    }


def _call_llm_for_reply(turns: list, context: dict) -> str | None:
    import re
    system = _SYSTEM_PROMPT.format(**context)
    messages = []
    for t in turns:
        messages.append({
            "role": "user" if t["role"] == "user" else "assistant",
            "content": t["content"],
        })
    for attempt in range(1, 4):
        try:
            from app.llm import call_llm
            return call_llm(
                [{"role": "system", "content": system}] + messages,
                max_tokens=120,
                temperature=0.82,
            )
        except Exception as e:
            err = str(e)
            # Circuit breaker tripped by another thread — wait it out (fast-fail path)
            m = re.search(r"circuit breaker open for (\d+)s more", err)
            if m:
                wait = int(m.group(1)) + 5
                log.warning("[AIFollowup] circuit breaker activo, esperando %ds (intento %d/3)", wait, attempt)
                print(f"[AIFollowup] circuit breaker activo — esperando {wait}s, intento {attempt}/3")
                time.sleep(wait)
                continue
            # Direct 429 after internal retries exhausted — daily quota hit, no point waiting
            if "429" in err:
                log.error("[AIFollowup] Groq cuota diaria agotada (429 directo), abortando")
                return None
            log.error("[AIFollowup] LLM error: %s", e)
            return None
    log.error("[AIFollowup] LLM error: circuit breaker no cedió tras 3 intentos")
    return None


def _send_typing_presence(phone_number: str):
    """Signal WhatsApp that the contact is typing via Evolution API."""
    try:
        import requests as _req
        clean = "".join(filter(str.isdigit, phone_number))
        url = f"{EVOLUTION_API_URL}/chat/sendPresence/{EVOLUTION_INSTANCE}"
        payload = {"number": clean, "options": {"presence": "composing"}}
        headers = {"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"}
        _req.post(url, json=payload, headers=headers, timeout=5)
    except Exception as e:
        log.debug("[AIFollowup] typing presence failed: %s", e)


def process_inbound_reply(phone_number: str, company_id: str, inbound_body: str, inbound_log_id: str):
    """
    Entry point called from the follow-up queue worker.
    Applies anti-detection delays, generates an AI response, and sends it.
    """
    from app.llm import active_provider
    provider = active_provider()
    print(f"[AIFollowup] process_inbound_reply START phone={phone_number} company={company_id} provider={provider}")
    if provider == "none":
        log.warning("[AIFollowup] no LLM provider configured, skipping")
        print("[AIFollowup] EXIT: no LLM provider")
        return
    biz = _is_business_hours()
    print(f"[AIFollowup] business_hours={biz}")
    if not biz:
        log.info("[AIFollowup] outside business hours, skipping %s", phone_number)
        print("[AIFollowup] EXIT: outside business hours")
        return

    db = MongoDBManager()
    session = _get_or_create_session(db, phone_number, company_id)
    print(f"[AIFollowup] session={session is not None} id={session.get('_id') if session else None}")
    if not session:
        print("[AIFollowup] EXIT: no session found/created")
        return

    sid = session["_id"]

    session_max_turns = session.get("max_turns", MAX_TURNS)

    # Skip if max turns already reached
    if session.get("turn_count", 0) >= session_max_turns:
        db.db.ai_followup_sessions.update_one(
            {"_id": sid},
            {"$set": {"status": "ended", "end_reason": "max_turns"}},
        )
        return

    # Append the user's inbound turn and mark session active
    db.db.ai_followup_sessions.update_one(
        {"_id": sid},
        {
            "$push": {"turns": {
                "role": "user",
                "content": inbound_body,
                "log_id": inbound_log_id,
                "ts": datetime.utcnow(),
            }},
            "$set": {"status": "active", "last_activity": datetime.utcnow()},
        },
    )

    # Anti-detection: shorter delay for menu/IVR messages (they expect fast button presses)
    is_menu_msg = (
        "[Opciones:" in inbound_body or "[Lista:" in inbound_body
        or any(f"{i}." in inbound_body for i in range(1, 8))
        or len(inbound_body.strip()) < 60
    )
    if is_menu_msg:
        read_delay = random.uniform(RESPONSE_DELAY_MENU_MIN, RESPONSE_DELAY_MENU_MAX)
    else:
        read_delay = random.uniform(RESPONSE_DELAY_MIN, RESPONSE_DELAY_MAX)
    log.info("[AIFollowup] reading delay %.0fs (menu=%s) for %s", read_delay, is_menu_msg, phone_number)
    time.sleep(read_delay)

    if not _is_business_hours():
        return

    # Re-fetch session with complete turns list
    session = db.db.ai_followup_sessions.find_one({"_id": sid})
    if not session:
        return

    # Hard-coded bot detection: if the contact has sent the same message before,
    # it's almost certainly a looping IVR/chatbot — close without spending LLM quota.
    prior_user_msgs = [
        t["content"] for t in session.get("turns", [])
        if t.get("role") == "user" and t.get("content") != inbound_body
    ]
    repeated = sum(1 for m in prior_user_msgs if m.strip() == inbound_body.strip())
    if repeated >= 1:
        log.info("[AIFollowup] mensaje repetido detectado (bot loop) — cerrando sesión para %s", phone_number)
        db.db.ai_followup_sessions.update_one(
            {"_id": sid},
            {"$set": {"status": "ended", "end_reason": "repeated_message", "ai_typing": False}},
        )
        db.db.conversation_ai_prefs.update_one(
            {"company_id": company_id},
            {"$set": {"ai_enabled": False}},
        )
        return

    ai_text_raw = _call_llm_for_reply(session.get("turns", []), session.get("context", {}))
    print(f"[AIFollowup] LLM response: {repr(ai_text_raw[:80]) if ai_text_raw else 'None'}")
    if not ai_text_raw:
        print("[AIFollowup] EXIT: LLM returned None")
        return

    # Detect AI-initiated close signal and strip it before sending
    ai_wants_end = "[FIN]" in ai_text_raw
    ai_text = ai_text_raw.replace("[FIN]", "").strip()

    # Mark AI as typing (frontend polls this)
    db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": True}})

    # Simulate typing on WhatsApp
    _send_typing_presence(phone_number)
    typing_delay = random.uniform(TYPING_DELAY_MIN, TYPING_DELAY_MAX)
    time.sleep(typing_delay)

    # Send message
    try:
        from app.whatsapp_evolution import EvolutionClient
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE)
        send_result = evo.send_text(phone_number, ai_text)
        evo_json = send_result.get("response_json", {})
        message_id = evo_json.get("key", {}).get("id") or evo_json.get("id")
        status = "sent" if send_result.get("status_code") in (200, 201) else "failed"

        # Persist AI message in message_logs
        from datetime import datetime as _dt
        ai_log_id = db.insert_message_log({
            "platform": "evolution",
            "direction": "outbound",
            "channel": "whatsapp",
            "company_id": company_id,
            "to_number": phone_number,
            "message_body": ai_text,
            "message_id": message_id,
            "message_type": "conversation",
            "status": status,
            "sent_by_username": "ai_andy",
            "sent_by_name": "Andy",
            "ai_generated": True,
            "raw_data": send_result,
            "created_at": _dt.now(),
        })

        new_count = session.get("turn_count", 0) + 1
        is_ended = ai_wants_end or (new_count >= session_max_turns)
        end_reason = "ai_decision" if ai_wants_end else ("max_turns" if is_ended else None)
        db.db.ai_followup_sessions.update_one(
            {"_id": sid},
            {
                "$push": {"turns": {
                    "role": "assistant",
                    "content": ai_text,
                    "log_id": ai_log_id,
                    "ts": datetime.utcnow(),
                }},
                "$set": {
                    "ai_typing": False,
                    "turn_count": new_count,
                    "status": "ended" if is_ended else "waiting",
                    "end_reason": end_reason,
                    "last_activity": datetime.utcnow(),
                },
            },
        )

        # Auto-disable AI toggle when conversation closes naturally
        if is_ended:
            db.db.conversation_ai_prefs.update_one(
                {"company_id": company_id},
                {"$set": {"ai_enabled": False}},
            )
            log.info("[AIFollowup] conversation closed (%s), toggle disabled for %s", end_reason, company_id)

            # Trigger full-conversation analysis so analytics reflects the entire exchange
            try:
                from app.llm import active_provider as _ap
                if _ap() != "none":
                    last_inbound = db.db.message_logs.find_one(
                        {"company_id": company_id, "direction": "inbound"},
                        sort=[("created_at", -1)],
                    )
                    if last_inbound:
                        from app.classifier import classify_conversation_and_save
                        import threading
                        threading.Thread(
                            target=classify_conversation_and_save,
                            args=(company_id, str(last_inbound["_id"])),
                            daemon=True,
                        ).start()
                        log.info("[AIFollowup] queued conversation analysis for %s", company_id)
            except Exception as _ae:
                log.warning("[AIFollowup] conversation analysis failed: %s", _ae)

        log.info("[AIFollowup] sent turn %d/%d to %s", new_count, session_max_turns, phone_number)

    except Exception as e:
        log.error("[AIFollowup] send failed: %s", e)
        db.db.ai_followup_sessions.update_one(
            {"_id": sid}, {"$set": {"ai_typing": False}}
        )
