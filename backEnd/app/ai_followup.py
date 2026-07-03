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
RESPONSE_DELAY_MIN = 3    # seconds before responding (simulates reading time)
RESPONSE_DELAY_MAX = 12
RESPONSE_DELAY_MENU_MIN = 1  # much shorter delay for menu/IVR replies
RESPONSE_DELAY_MENU_MAX = 3
TYPING_DELAY_MIN = 1      # seconds of typing simulation
TYPING_DELAY_MAX = 3
OUTBOUND_LOOKBACK_DAYS = 7  # only follow up if we messaged this number within N days

_MEXICO_TZ = timezone(timedelta(hours=-6))  # CST — UTC-6 year-round (conservative)

_SYSTEM_PROMPT = """\
Eres Andrés, una persona real chateando por WhatsApp. Escribiste a {company_name}, \
negocio del giro {industry} en {city}, y alguien te respondió.

El mensaje que les mandaste fue: "{initial_message}"

LO QUE SABES DE ELLOS (no lo menciones de golpe — úsalo para hacer preguntas naturales o mostrar interés genuino):
{company_context}

QUIÉN ERES:
- Te llamas Andrés. Si preguntan tu apellido: "Flores". Si preguntan si eres IA o bot: "No, soy Andrés."
- No representas ninguna empresa en particular — eres alguien que se interesó en ellos.
- Nunca menciones a quién representas ni el nombre de tu empresa.

CÓMO HABLAR (aplica SOLO con humanos reales):
- Escribe como una persona real en WhatsApp: corto, natural, sin formalidades innecesarias.
- Máximo 2 oraciones por mensaje. Si la respuesta lo amerita, hasta 3. Nunca más.
- Sin listas, sin bullets, sin emojis en exceso. Uno ocasional si encaja bien.
- Adapta tu tono al de la persona: si es formal, tú también; si es relajado, tú también.
- Frases que suenan humanas: "Oye", "la verdad", "qué interesante", "con gusto", "no sabía eso"

TU ACTITUD con humanos — curiosidad genuina, sin agenda:
- Sigue CUALQUIER tema que la persona traiga. Si hablan de su empresa, del clima, del negocio o de lo que sea — engancha.
- NO tienes un guión ni una lista de preguntas. Reacciona a lo que dicen como lo haría una persona real.
- Muestra interés auténtico en lo que hacen, cómo lo hacen, qué los mueve.
- Si la conversación deriva a algo sobre su operación, equipo o clientes — escucha y pregunta con curiosidad natural.
- No ametrallas preguntas. Una a la vez, y solo si nace naturalmente de la conversación.
- La calificación es consecuencia de una buena plática, no el objetivo explícito.

IDENTIFICA CON QUIÉN HABLAS — esto cambia COMPLETAMENTE cómo respondes:

[HUMANO REAL]
Señales: responde con contexto propio, lenguaje natural e imperfecto, da info voluntaria sobre su rol
o empresa, menciona su nombre, reacciona a lo que dijiste.
Comportamiento: conversación genuina. Sigue su ritmo. Una pregunta natural por turno si surge orgánicamente.
Usa el contexto scrapeado para mostrar interés genuino en lo que hacen. Nada de guión.

[BOT CON MENÚS / IVR]
Señales: lista de opciones numeradas o con letras, frases como "Elige una opción", "Escribe el número",
botones interactivos en formato [Opciones: Texto A | Texto B | Texto C].
Comportamiento: navegación directa, CERO preguntas, CERO texto libre.

⚠️ REGLA ABSOLUTA DE MENÚ: cuando el mensaje contiene opciones (números, letras, o [Opciones:]),
tu respuesta COMPLETA es ÚNICAMENTE la letra o número de la opción elegida — nada más.
NO escribas el nombre de la opción. NO escribas frases. NO agregues punto ni texto extra.
❌ MAL: "Hablar con asesor" / "H. Otro" / "Opción H" / "B - Hablar con agente"
✅ BIEN: "H" / "B" / "2"

- Si llega [Opciones: Texto A | Texto B]: responde con el TEXTO EXACTO de la opción correcta.
  Nunca copies el formato [Opciones: ...].
- Si son opciones NUMERADAS: responde SOLO el número. Ej: "2"
- Si son opciones CON LETRA (*A*, *B*, A), B)): responde SOLO la letra. Ej: "H"

Prioridad al elegir la opción:
  1. La que diga "Asesor", "Agente", "Humano", "Soporte", "Hablar con" → esa directamente
  2. Si no hay opción directa de humano → la que diga "Otro" / "Other" (suele llevar a humano)
  3. Si ninguna → la primera opción del menú

Ejemplo KLM (*A*-Reserva *B*-Equipaje *C*-Reembolso *D*-Reclamación *E*-Facturación
*F*-Flying Blue *G*-Estado vuelo *H*-Otro): ninguna dice "Asesor" → responde "H" (Otro)

Ejemplo KLM (*A*-Volver al menú / *B*-Hablar con un agente): opción B dice "agente" → responde "B"

- Si te preguntan nombre: "Andrés". Teléfono solo si te lo piden: "5530123456"
- Sigue el flujo hasta llegar a un humano → cambia a [HUMANO REAL]

[MENSAJE AUTOMÁTICO / ACUSE DE RECIBO]
Señales: "Tu mensaje es importante", número de ticket/folio, "En breve un asesor te contactará",
horarios de atención, firma corporativa, respuesta en segundos a cualquier hora.
Comportamiento: NO respondas — es un acuse de recibo, no una conversación. Espera al humano.
Si después de 30 min no hay humano → cierra con [FIN].

[IA CONVERSACIONAL DE OTRA EMPRESA]
Señales: se presenta con nombre de agente ("Soy Olivia", "Soy Sofía", "Soy AMAIA"), menciona empresa
ajena, hace onboarding ("¿Cómo te llamas?"), o repite el mismo mensaje aunque ya respondiste.
Comportamiento: respuestas mínimas y directas, SIN preguntas de curiosidad — no vale la pena.
⚠️ EXCEPCIÓN CRÍTICA: si esta IA te envía un MENÚ con opciones (letras o números),
   aplica INMEDIATAMENTE la regla de [BOT CON MENÚS / IVR] — responde SOLO la letra/número.
   NO escribas texto libre como "Hablar con asesor" aunque eso sea lo que quieras. Usa la letra.
1. Si no hay menú: pide hablar con humano con UNA sola frase corta.
2. Si dice que te conectará con un agente → "Gracias, aquí espero." y NO mandes más mensajes.
   Si en el siguiente turno sigue siendo el bot → [FIN].
3. Si después de 2 turnos sin menú ni humano → [FIN].
- NUNCA espontáneamente nombre + teléfono. Solo si te los piden.

[MENSAJE REPETIDO / LOOP]
Señal crítica: el mensaje actual es idéntico o casi idéntico a uno anterior en esta conversación.
Comportamiento: CIERRA INMEDIATAMENTE. "Entendido, cualquier cosa aquí estamos."[FIN]

[RESPUESTA AMBIGUA]
Señales: muy corta, genérica, no conecta con lo que dijiste.
Comportamiento: UNA pregunta abierta para verificar si hay humano. Si sigue igual → [FIN].

CUÁNDO CERRAR — responde normal y añade [FIN] pegado:
- Preguntan precio o costo → "Eso te lo puede dar alguien de nuestro equipo directamente, en breve te contactan."[FIN]
- Piden cita, llamada o reunión → "Con gusto, le aviso a la persona que lleva eso."[FIN]
- Sin interés o piden que no escribas → cierra con respeto[FIN]
- Bot ajeno detectado → "Entendido, cualquier cosa aquí estamos."[FIN]
- Conversación llegó a cierre natural[FIN]

IMPORTANTE: [FIN] es señal interna, nunca llega al contacto. Ponlo pegado al texto sin espacio.
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

    # Look for a prior outbound within the lookback window
    cutoff = datetime.utcnow() - timedelta(days=OUTBOUND_LOOKBACK_DAYS)
    clean10 = "".join(filter(str.isdigit, phone_number))[-10:]
    outbound = db.db.message_logs.find_one({
        "direction": "outbound",
        "to_number": {"$regex": clean10},
        "created_at": {"$gte": cutoff},
    }, sort=[("created_at", -1)])

    if not outbound:
        # No recent outbound — but if the user explicitly enabled AI for this company,
        # relax the lookback and find any historical outbound so the session can resume
        # without forcing the user to toggle off/on after a page refresh.
        prefs_check = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}
        if prefs_check.get("ai_enabled"):
            outbound = db.db.message_logs.find_one({
                "direction": "outbound",
                "to_number": {"$regex": clean10},
            }, sort=[("created_at", -1)])
            if outbound:
                log.info("[AIFollowup] ai_enabled=True — usando outbound histórico para %s", phone_number)

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

    # Compact scraped summary — max 3 items each to keep prompt tight
    services  = company.get("services") or []
    products  = company.get("products") or []
    offer_parts = []
    if services[:3]:
        offer_parts.append("Servicios: " + ", ".join(str(s) for s in services[:3]))
    if products[:3]:
        offer_parts.append("Productos: " + ", ".join(str(p) for p in products[:3]))
    offer = " | ".join(offer_parts) if offer_parts else ""

    description   = (company.get("description") or company.get("main_activity") or "").strip()[:200]
    website       = (company.get("website") or "").strip()

    return {
        "company_name":    company.get("name", "la empresa"),
        "industry":        company.get("industry", "su giro"),
        "city":            company.get("city", "México"),
        "initial_message": (outbound_log.get("message_body") or "")[:200],
        "description":     description,
        "offer":           offer,
        "website":         website,
    }


def _call_llm_for_reply(turns: list, context: dict, is_cold_start: bool = False) -> str | None:
    ctx = dict(context)
    parts = []
    if ctx.get("description"):
        parts.append(ctx["description"])
    if ctx.get("offer"):
        parts.append(ctx["offer"])
    if ctx.get("website"):
        parts.append(f"Web: {ctx['website']}")
    ctx["company_context"] = "\n".join(parts) if parts else "(sin datos adicionales)"
    system = _SYSTEM_PROMPT.format(**ctx)
    if is_cold_start:
        system += (
            "\n\n⚠️ PRIMER MENSAJE DE ESTA SESIÓN: empieza TU respuesta con un saludo "
            "breve y natural (\"¡Hola!\", \"Hey, hola!\", \"¡Buenas!\") antes de "
            "responder al tema. Máximo 2-3 palabras de saludo, luego continúa normal."
        )
    messages = []
    for t in turns:
        messages.append({
            "role": "user" if t["role"] == "user" else "assistant",
            "content": t["content"],
        })
    try:
        from app.llm import call_llm, PRIORITY_LIVE
        return call_llm(
            [{"role": "system", "content": system}] + messages,
            max_tokens=120,
            temperature=0.82,
            priority=PRIORITY_LIVE,
        )
    except Exception as e:
        err = str(e)
        if "429" in err:
            log.error("[AIFollowup] LLM rate-limited (429) — reintentando según guard")
        elif "circuit breaker" in err.lower():
            log.error("[AIFollowup] LLM pausado por circuit breaker")
        else:
            log.error("[AIFollowup] LLM error: %s", e)
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


def process_inbound_reply(phone_number: str, company_id: str, inbound_body: str, inbound_log_id: str,
                          manual_activation: bool = False):
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

    # Skip messages that are older than 2 hours — prevents the IA from responding
    # to stale webhook re-deliveries or messages from closed sessions.
    # Skipped when the user manually activates the AI toggle (manual_activation=True)
    # so the AI can still send a greeting on old conversations.
    if not manual_activation:
        try:
            from bson import ObjectId
            _msg = db.db.message_logs.find_one({"_id": ObjectId(inbound_log_id)}, {"created_at": 1})
            if _msg and _msg.get("created_at"):
                _age_min = (datetime.utcnow() - _msg["created_at"]).total_seconds() / 60
                if _age_min > 120:
                    print(f"[AIFollowup] EXIT: mensaje con {_age_min:.0f} min de antigüedad — ignorado para {phone_number}")
                    return
        except Exception as _age_err:
            print(f"[AIFollowup] age check error (ignored): {_age_err}")

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
    import re as _re
    is_menu_msg = (
        "[Opciones:" in inbound_body or "[Lista:" in inbound_body
        or any(f"{i}." in inbound_body for i in range(1, 8))
        or bool(_re.search(r'\*[A-H]\*\s*[-–]', inbound_body))  # *A* - Opción format
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

    is_cold_start = session.get("turn_count", 0) == 0
    ai_text_raw = _call_llm_for_reply(session.get("turns", []), session.get("context", {}), is_cold_start=is_cold_start)
    print(f"[AIFollowup] LLM response: {repr(ai_text_raw[:80]) if ai_text_raw else 'None'}")
    if not ai_text_raw:
        print("[AIFollowup] EXIT: LLM returned None")
        return

    # Detect AI-initiated close signal and strip it before sending
    ai_wants_end = "[FIN]" in ai_text_raw
    ai_text = ai_text_raw.replace("[FIN]", "").strip()

    # Mark AI as typing (frontend polls this)
    db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": True}})

    try:
        # Simulate typing on WhatsApp
        _send_typing_presence(phone_number)
        typing_delay = random.uniform(TYPING_DELAY_MIN, TYPING_DELAY_MAX)
        time.sleep(typing_delay)

        # Send message
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
            "created_at": _dt.utcnow(),
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
        # Always reset ai_typing so the frontend never gets permanently stuck
        db.db.ai_followup_sessions.update_one(
            {"_id": sid}, {"$set": {"ai_typing": False}}
        )
