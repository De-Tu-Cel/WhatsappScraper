# classifier.py
"""Groq-based classifier for inbound WhatsApp responses."""
import json
import logging
import threading
import time
from datetime import datetime, timedelta

# Allow at most 2 concurrent Groq calls to stay within TPM limits
_GROQ_SEMAPHORE = threading.Semaphore(2)

from app.config import GROQ_API_KEY
from app.database import MongoDBManager

log = logging.getLogger(__name__)

_PROMPT_TEMPLATE = """\
Eres un director comercial con 15 años de experiencia en ventas B2B por WhatsApp en Latinoamérica. \
Evalúas respuestas de prospectos con criterio brutalmente honesto — tu análisis define si un agente invierte tiempo en este lead o no.

MENSAJE ENVIADO: {outbound_body}
RESPUESTA DEL PROSPECTO: {inbound_body}

── PASO 1: CLASIFICAR ORIGEN ──
- "humano": persona real. Señales: informalidad, errores, responde aunque sea vagamente al tema
- "automatico": plantilla sin personalización (horarios, folio, "en breve te atendemos")
- "bot": sistema con lógica propia (menú, pide datos, nombre artificial, ignora completamente el mensaje)
Regla: ante la duda → humano. Solo "automatico" o "bot" si hay evidencia clara.

── PASO 2: CALIDAD COMERCIAL (criterio estricto) ──
Pregúntate: ¿Esta respuesta acerca o aleja una venta? ¿Hay señal de intención real?

1 — Ruido: no aporta nada. "Ok", "👍", "Gracias", "Recibido", emoji solo, respuesta de 1-2 palabras sin contenido
2 — Cortesía vacía: reconoce el contacto pero evita el tema. "Ahorita te marco", "Luego hablamos", "Estamos en reunión"
3 — Apertura tibia: toca el tema pero sin compromiso. "Mándame info", "¿De qué se trata?", "Puede interesarnos"
4 — Señal real: muestra interés concreto. Hace preguntas específicas, da contexto de su situación, menciona necesidad o timing
5 — Lead caliente: intención clara de avanzar. Pide cotización, propone llamada/reunión, menciona presupuesto o urgencia

IMPORTANTE: El 80% de las respuestas son 1 o 2. Un 3 requiere que el prospecto haya dicho algo específico sobre el tema. Un 4 o 5 son excepcionales y deben ganarse con evidencia textual concreta.

── PASO 3: NOTAS (máximo 12 palabras) ──
Di exactamente qué reveló la respuesta sobre la intención de compra. Sé clínico, no optimista.
✓ "Pidió precio de tanque estacionario, tiene urgencia de cambio"
✓ "Cortesía pura, no leyó el mensaje, no hay señal"
✓ "Mencionó proveedor actual Zeta Gas, abierto a cotizar"
✗ "Respuesta breve" / "Muestra interés" / "Acuse de recepción"

is_ai (solo si bot): true=IA conversacional, false=flujo rígido/menú
bot_quality (solo si bot): 1=básico 3=funcional 5=IA avanzada
ai_confidence: 0.0-1.0

Responde SOLO con JSON válido:
{{"category":"humano|automatico|bot","is_ai":false,"ai_confidence":0.0,"response_quality":1,"bot_quality":null,"notes":"observación clínica"}}\
"""

_ERROR_RESULT = {
    "category": "humano",
    "is_ai": False,
    "ai_confidence": 0.0,
    "response_quality": 3,
    "bot_quality": None,
    "notes": "Groq no configurado",
    "error": True,
}


def is_business_hours(dt: datetime) -> bool:
    """Returns True if dt falls within Monday–Friday 09:00–18:00."""
    return dt.weekday() < 5 and 9 <= dt.hour < 18


def classify_response(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> dict:
    """Call Groq to classify an inbound response. Returns a dict with classification data."""
    if not GROQ_API_KEY:
        return dict(_ERROR_RESULT)

    try:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)
        reaction_hint = ""
        if reaction_time_min is not None and reaction_time_min < 0.5:
            reaction_hint = "\n⚠️ DATO ADICIONAL: La respuesta llegó en menos de 30 segundos — señal fuerte de sistema automatizado."
        elif reaction_time_min is not None and reaction_time_min < 1:
            reaction_hint = f"\n⚠️ DATO ADICIONAL: La respuesta llegó en {reaction_time_min:.1f} minutos — posible automatización, verificar contenido."
        elif reaction_time_min is not None and 1 <= reaction_time_min <= 60:
            reaction_hint = f"\nℹ️ DATO ADICIONAL: La respuesta llegó en {reaction_time_min:.0f} minutos — tiempo normal de respuesta humana."

        prompt = _PROMPT_TEMPLATE.format(
            outbound_body=outbound_body or "(sin texto)",
            inbound_body=inbound_body or "(sin texto)",
        ) + reaction_hint

        _messages = [{"role": "user", "content": prompt}]
        chat_response = None
        with _GROQ_SEMAPHORE:
            for _attempt in range(4):
                try:
                    chat_response = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=_messages,
                        temperature=0,
                        max_tokens=150,
                    )
                    break
                except Exception as _e:
                    _is_429 = "429" in str(_e) or "rate_limit" in str(_e).lower()
                    if _is_429 and _attempt < 3:
                        _wait = 5 * (2 ** _attempt)  # 5s, 10s, 20s
                        log.warning("Groq 429 — reintentando en %ds (intento %d/4)", _wait, _attempt + 1)
                        time.sleep(_wait)
                    else:
                        raise
        raw = chat_response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].strip()
            if raw.startswith("json"):
                raw = raw[4:].strip()
        result = json.loads(raw)
        category = result.get("category", "humano")
        is_ai = bool(result.get("is_ai", False)) if category == "bot" else False
        return {
            "category": category,
            "is_ai": is_ai,
            "ai_confidence": round(float(result.get("ai_confidence", 0.0)), 2) if is_ai else 0.0,
            "response_quality": result.get("response_quality") or 2,  # nunca null
            "bot_quality": result.get("bot_quality"),
            "notes": result.get("notes", ""),
        }
    except Exception as e:
        import traceback
        log.error("classify_response failed: %s\n%s", e, traceback.format_exc())
        return {
            "category": "humano",
            "response_quality": 3,
            "bot_quality": None,
            "notes": "Error al clasificar",
            "error": True,
        }


_AUTO_FOLLOWUP_MINUTES = 5   # wait up to 5 min for human after auto-response


def classify_and_save(log_id: str, company_id: str, inbound_body: str, received_at: datetime):
    """Background task: classify inbound message. For auto-responses, waits for a possible
    human follow-up message before finalising the classification."""
    try:
        from bson import ObjectId
        db = MongoDBManager()

        # Check if this message resolves a pending human-followup for the same company
        pending = db.db.message_logs.find_one({
            "company_id": company_id,
            "direction": "inbound",
            "analysis.pending_human_check": True,
            "analysis.followup_deadline": {"$gte": received_at},
        })
        if pending:
            # A human message arrived within the wait window — upgrade the prior auto analysis
            prior_id = str(pending["_id"])
            prior_outbound = db.get_last_outbound_for_company(
                company_id,
                before_dt=pending.get("created_at", received_at),
            )
            outbound_body = (prior_outbound or {}).get("message_body") or ""
            reaction_time_min = None
            if prior_outbound and prior_outbound.get("created_at"):
                delta = received_at - prior_outbound["created_at"]
                reaction_time_min = round(delta.total_seconds() / 60, 1)
            upgraded = classify_response(inbound_body, outbound_body, reaction_time_min)
            upgraded["reaction_time_min"] = reaction_time_min
            upgraded["business_hours"] = is_business_hours(received_at)
            upgraded["classified_at"] = datetime.now().isoformat()
            upgraded["pending_human_check"] = False
            upgraded["upgraded_from_auto"] = True
            db.save_message_analysis(prior_id, upgraded)
            # Also classify the current message normally (it will link to the same company)

        # Standard classification for this message
        inbound_doc = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"from_number": 1, "number": 1})
        from_number = (inbound_doc or {}).get("from_number") or (inbound_doc or {}).get("number")

        last_outbound = db.get_last_outbound_for_company(
            company_id, before_dt=received_at, to_number=from_number
        )
        if not last_outbound:
            last_outbound = db.get_last_outbound_for_company(company_id, before_dt=received_at)

        outbound_body = ""
        reaction_time_min = None
        if last_outbound:
            outbound_body = last_outbound.get("message_body") or last_outbound.get("message_text") or ""
            last_sent_at = last_outbound.get("created_at")
            if last_sent_at and isinstance(last_sent_at, datetime):
                delta = received_at - last_sent_at
                minutes = round(delta.total_seconds() / 60, 1)
                reaction_time_min = minutes if minutes >= 0 else None

        business_hours = is_business_hours(received_at)
        analysis = classify_response(inbound_body, outbound_body, reaction_time_min)
        analysis["reaction_time_min"] = reaction_time_min
        analysis["business_hours"] = business_hours
        analysis["classified_at"] = datetime.now().isoformat()

        # If auto-response: mark as pending human-followup for the next 5 minutes
        if analysis.get("category") in ("automatico", "bot"):
            analysis["pending_human_check"] = True
            analysis["followup_deadline"] = received_at + timedelta(minutes=_AUTO_FOLLOWUP_MINUTES)
        else:
            analysis["pending_human_check"] = False

        db.save_message_analysis(log_id, analysis)
    except Exception:
        pass  # background task — fail silently


_NO_REPLY_WAIT_MINUTES = 30   # classify outbound with no reply after this window
_SWEEP_INTERVAL_SEC    = 300  # run sweep every 5 minutes


def _sweep_pending():
    """
    Runs every 5 minutes. Two jobs:

    1. Expire pending_human_check — auto/bot messages whose followup window
       passed without a human reply: mark pending_human_check=False so the UI
       stops waiting and shows the final auto/bot classification.

    2. Mark no-reply — outbound messages sent more than 30 minutes ago with
       no inbound response at all: save an analysis with category='sin_respuesta'.
    """
    try:
        db = MongoDBManager()
        now = datetime.now()

        # ── Job 1: expire stale pending_human_check ──────────────────────────
        db.db.message_logs.update_many(
            {
                "direction": "inbound",
                "analysis.pending_human_check": True,
                "analysis.followup_deadline": {"$lt": now},
            },
            {"$set": {"analysis.pending_human_check": False}},
        )

        # ── Job 2: no-reply outbound → mark sin_respuesta ────────────────────
        cutoff = now - timedelta(minutes=_NO_REPLY_WAIT_MINUTES)
        # Find outbound messages older than cutoff with no analysis yet
        outbounds = list(db.db.message_logs.find(
            {
                "direction": "outbound",
                "created_at": {"$lte": cutoff},
                "analysis": {"$exists": False},
            },
            {"_id": 1, "company_id": 1, "to_number": 1, "created_at": 1},
        ))

        for ob in outbounds:
            company_id = str(ob.get("company_id", ""))
            sent_at    = ob.get("created_at")
            # Check if ANY inbound arrived for this company after this outbound
            has_reply = db.db.message_logs.find_one({
                "company_id": company_id,
                "direction": "inbound",
                "created_at": {"$gt": sent_at},
            })
            if not has_reply:
                db.save_message_analysis(str(ob["_id"]), {
                    "category":        "sin_respuesta",
                    "response_quality": 0,
                    "notes":           f"Sin respuesta tras {_NO_REPLY_WAIT_MINUTES} min",
                    "classified_at":   now.isoformat(),
                    "pending_human_check": False,
                })
        # ── Job 3: re-resolve inbound messages saved with company_id="unknown" ──
        unknowns = list(db.db.message_logs.find(
            {
                "direction": "inbound",
                "company_id": "unknown",
                "created_at": {"$gte": now - timedelta(hours=24)},
            },
            {"_id": 1, "from_number": 1, "message_body": 1},
        ))
        for msg in unknowns:
            from_number = msg.get("from_number", "")
            if not from_number:
                continue
            resolved = db.find_company_id_by_phone(from_number)
            if resolved:
                db.db.message_logs.update_one(
                    {"_id": msg["_id"]},
                    {"$set": {"company_id": resolved}},
                )
                body = msg.get("message_body", "")
                if body and GROQ_API_KEY:
                    import threading as _t
                    _t.Thread(
                        target=classify_and_save,
                        args=(str(msg["_id"]), resolved, body, now),
                        daemon=True,
                    ).start()

    except Exception:
        log.exception("_sweep_pending failed")


def start_classifier_background():
    """Launch the periodic sweep as a daemon thread. Call once at app startup."""
    def _loop():
        while True:
            time.sleep(_SWEEP_INTERVAL_SEC)
            _sweep_pending()

    t = threading.Thread(target=_loop, daemon=True, name="classifier-sweep")
    t.start()
    log.info("Classifier background sweep started (every %ds)", _SWEEP_INTERVAL_SEC)
