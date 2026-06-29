# ai_followup.py
"""
DeepSeek-powered AI follow-up conversations for WhatsApp.
Continues conversations naturally when a contact replies, with anti-detection measures.
"""
import logging
import random
import time
from datetime import datetime, timezone, timedelta

from app.config import DEEPSEEK_API_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE
from app.database import MongoDBManager

log = logging.getLogger(__name__)

MAX_TURNS = 10  # safety net — Andy should close naturally via prompt rules before this
RESPONSE_DELAY_MIN = 20   # seconds before responding (simulates reading time)
RESPONSE_DELAY_MAX = 90
TYPING_DELAY_MIN = 3      # seconds of typing simulation
TYPING_DELAY_MAX = 8
OUTBOUND_LOOKBACK_DAYS = 7  # only follow up if we messaged this number within N days

_MEXICO_TZ = timezone(timedelta(hours=-6))  # CST — UTC-6 year-round (conservative)

_SYSTEM_PROMPT = """\
Eres un representante de ventas de Detucel. Estás chateando por WhatsApp con alguien \
de {company_name}, empresa del giro {industry} en {city}.

El mensaje que les mandamos originalmente fue: "{initial_message}"

REGLAS — violarlas arruina la conversación:
1. Responde MUY casual y breve, máximo 2 oraciones.
2. NUNCA menciones precios, costos, tarifas ni hagas compromisos de ningún tipo.
3. NUNCA ofrezcas citas, llamadas, reuniones, demos, ni nada que requiera agenda.
4. NUNCA reveles que eres IA, bot o software. Si te preguntan, di algo como "nah jaja".
5. Usa lenguaje coloquial mexicano: "oye", "la verdad", "qué onda", "está chido", etc.
6. MENÚS Y BOTONES INTERACTIVOS: si el mensaje contiene opciones para elegir (formato "[Opciones: X | Y | Z]", "[Lista: X | Y | Z]", o lista numerada "1. X  2. Y"), elige la opción que lleve a ventas, atención comercial o contacto con un asesor humano y responde ÚNICAMENTE con ese texto exacto (o su número). Sin texto adicional.
   Ejemplos: llega "[Opciones: Español | English]" → responde: Español
             llega "[Opciones: Ventas | Soporte | Admin]" → responde: Ventas
             llega "1. Ventas  2. Soporte  3. Info" → responde: 1

CUÁNDO CERRAR LA CONVERSACIÓN — cuando alguna de estas situaciones ocurra, responde normalmente Y agrega [FIN] al final de tu mensaje (sin espacio antes):
- El contacto pregunta precio, costo o tarifa → di "eso ya te lo puede dar alguien del equipo, ahorita te contactan"[FIN]
- El contacto pide una cita, llamada o reunión → di "con gusto, le aviso a quien lleva eso"[FIN]
- El contacto dice que no le interesa, está ocupado o pide que no le escribas → cierra con respeto[FIN]
- La plática llegó a un acuerdo o conclusión natural → cierra cálidamente[FIN]
- El contacto no responde con sentido (spam, otro idioma) → di "ok, cualquier cosa aquí andamos"[FIN]

IMPORTANTE: [FIN] no se envía al contacto, es solo tu señal interna de que la conversación terminó. Ponlo pegado al final del texto sin espacio.
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


def _call_deepseek(turns: list, context: dict) -> str | None:
    if not DEEPSEEK_API_KEY:
        return None
    system = _SYSTEM_PROMPT.format(**context)
    messages = []
    for t in turns:
        messages.append({
            "role": "user" if t["role"] == "user" else "assistant",
            "content": t["content"],
        })
    try:
        from openai import OpenAI
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
        resp = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "system", "content": system}] + messages,
            temperature=0.82,
            max_tokens=120,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        log.error("[AIFollowup] DeepSeek error: %s", e)
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
    if not DEEPSEEK_API_KEY:
        return
    if not _is_business_hours():
        log.info("[AIFollowup] outside business hours, skipping %s", phone_number)
        return

    db = MongoDBManager()
    session = _get_or_create_session(db, phone_number, company_id)
    if not session:
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

    # Anti-detection: random reading delay before responding
    read_delay = random.uniform(RESPONSE_DELAY_MIN, RESPONSE_DELAY_MAX)
    log.info("[AIFollowup] reading delay %.0fs for %s", read_delay, phone_number)
    time.sleep(read_delay)

    if not _is_business_hours():
        return

    # Re-fetch session with complete turns list
    session = db.db.ai_followup_sessions.find_one({"_id": sid})
    if not session:
        return

    ai_text_raw = _call_deepseek(session.get("turns", []), session.get("context", {}))
    if not ai_text_raw:
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
                from app.config import DEEPSEEK_API_KEY as _DS
                if _DS:
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
