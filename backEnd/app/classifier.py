# classifier.py
"""Groq-based classifier for inbound WhatsApp responses."""
import json
from datetime import datetime

from app.config import GROQ_API_KEY
from app.database import MongoDBManager

_PROMPT_TEMPLATE = """\
Eres un analista de canales de comunicación B2B especializado en WhatsApp para PYMEs mexicanas. \
Tu tarea: detectar si la respuesta fue de un humano real o un sistema automatizado, y evaluar qué tan útil fue para el proceso de venta.

CONTEXTO: En México, la mayoría de las PYMEs usan WhatsApp Business pero lo atiende una persona real. \
Las respuestas informales, cortas o con errores ortográficos son NORMALES y señal de humano, no de bot.

═══════════════════════════════════════
MENSAJE ENVIADO (prospección):
{outbound_body}

RESPUESTA RECIBIDA:
{inbound_body}
═══════════════════════════════════════

CATEGORÍAS:

"humano" — persona real que leyó y contestó:
  ✓ Respuestas cortas o coloquiales: "Ok", "Muy bien", "Claro", "Sí", "Ahí te marco", "👍"
  ✓ Faltas de ortografía, sin acentos, abreviaciones: "xq", "tmb", "k", "pq", "ntp", "ahorita"
  ✓ Lenguaje regional mexicano o informal
  ✓ Responde aunque sea de forma mínima al tema
  ✓ Tiempo de respuesta 1–120 minutos
  ✓ Continuación natural de la conversación

"automatico" — respuesta automática sin IA ni flujo complejo:
  ✓ "Gracias por contactarnos, en breve te atendemos"
  ✓ Mensaje de fuera de horario con horarios exactos listados
  ✓ Contiene número de ticket, folio o ID automático
  ✓ Texto genérico idéntico que se envía a cualquier contacto
  ✗ NO tiene ningún elemento personalizado al mensaje recibido

"bot" — sistema automatizado con flujo o IA (señales EXCLUSIVAS):
  ✓ Se presenta con nombre de persona artificial ("Soy Olivia", "Hola, soy Ana")
  ✓ Dice explícitamente ser asistente virtual / chatbot / cuenta oficial
  ✓ Ofrece menú numerado o botones de opciones estructuradas
  ✓ Pide datos del usuario como primer paso (nombre, correo, empresa)
  ✓ Responde en < 30 segundos con texto largo y perfectamente formateado
  ✓ IGNORA completamente el contenido del mensaje y ejecuta su guión propio

REGLAS FINALES:
- Si hay duda entre humano y bot SIN señales explícitas de sistema → es HUMANO
- Si la respuesta contiene nombre de asistente virtual, menú numerado o folio automático → NO puede ser humano
- Las PYMEs mexicanas rara vez tienen bots; si no hay señal clara, es una persona desde su celular

═══════════════════════════════════════
EJEMPLOS DE CLASIFICACIÓN:

Enviado: "Hola, somos DeTuCel y quisiéramos hablar sobre tu negocio"
Respuesta: "Muy bien" (4 min) → humano, quality=2, notes="Acuse breve de recepción"

Enviado: "Hola, somos DeTuCel y quisiéramos hablar sobre tu negocio"
Respuesta: "k onda si me interesa dime mas" (12 min) → humano, quality=4, notes="Interés genuino con lenguaje informal"

Enviado: "Hola, somos DeTuCel..."
Respuesta: "Gracias por escribirnos. Nuestro horario es Lun-Vie 9-6pm. En breve le atendemos." (inmediato) → automatico, quality=1

Enviado: "Hola, somos DeTuCel..."
Respuesta: "Hola! Soy Olivia, asistente virtual de [Empresa]. Para continuar ingresa tu nombre:" (8 seg) → bot, is_ai=false, quality=1

Enviado: "Hola, somos DeTuCel..."
Respuesta: "¡Hola! Entiendo que deseas más información sobre nuestros servicios. Con gusto te ayudo. ¿Sobre qué área específica tienes dudas?" (15 seg) → bot, is_ai=true, quality=3
═══════════════════════════════════════

ESCALA DE CALIDAD (response_quality, SIEMPRE 1-5):
1 = Ignora el mensaje / respuesta genérica sin valor
2 = Acuse mínimo de recepción ("Ok", "Muy bien", "Recibido")
3 = Responde brevemente al tema o muestra algo de interés
4 = Proporciona información útil o hace preguntas relevantes al negocio
5 = Interés genuino: solicita reunión, pide detalles, expresa intención clara

is_ai (solo si category="bot"): true=IA conversacional fluida / false=flujo rígido o menús
bot_quality (solo si category="bot"): 1=básico, 3=funcional, 5=IA avanzada
ai_confidence: 0.0=sin IA, 1.0=IA confirmada

Responde ÚNICAMENTE con JSON válido sin markdown:
{{"category": "humano|automatico|bot", "is_ai": false, "ai_confidence": 0.0, "response_quality": 1-5, "bot_quality": null, "notes": "observación concisa en español"}}\
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
        chat_response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=256,
        )
        raw = chat_response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
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
    except Exception:
        return {
            "category": "humano",
            "response_quality": 3,
            "bot_quality": None,
            "notes": "Error al clasificar",
            "error": True,
        }


def classify_and_save(log_id: str, company_id: str, inbound_body: str, received_at: datetime):
    """Background task: classify the inbound message and persist the analysis."""
    try:
        from bson import ObjectId
        db = MongoDBManager()

        # Get the inbound message to know which number replied
        inbound_doc = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"from_number": 1, "number": 1})
        from_number = (inbound_doc or {}).get("from_number") or (inbound_doc or {}).get("number")

        # Find the most recent outbound BEFORE this inbound arrived, ideally to the same number
        last_outbound = db.get_last_outbound_for_company(
            company_id, before_dt=received_at, to_number=from_number
        )
        # Fallback: any outbound before this inbound
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

        db.save_message_analysis(log_id, analysis)
    except Exception:
        pass  # background task — fail silently
