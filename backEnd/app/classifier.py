# classifier.py
"""Groq-based classifier for inbound WhatsApp responses."""
import json
from datetime import datetime

from app.config import GROQ_API_KEY
from app.database import MongoDBManager

_PROMPT_TEMPLATE = """\
Eres un analista de ventas B2B especializado en WhatsApp. Tu tarea es detectar si una respuesta fue enviada por un humano real o por un sistema automatizado.

MENSAJE ENVIADO (prospección):
{outbound_body}

RESPUESTA RECIBIDA:
{inbound_body}

CATEGORÍAS:
- "humano": persona real que leyó y respondió el mensaje de prospección. Señales de humano: faltas de ortografía, palabras abreviadas (xq, tmb, pq, ntp), falta de acentos, lenguaje informal o coloquial, responde al tema específico del mensaje, hace preguntas relevantes al negocio.
- "automatico": mensaje automático simple sin IA. Ejemplos: "Gracias por contactarnos, en breve te atendemos", mensaje de fuera de horario, número de ticket, confirmación de recepción.
- "bot": sistema automatizado con flujo predefinido o IA conversacional. Señales claras de bot:
  * Se presenta con un nombre propio ("Soy Olivia", "Hola, soy Ana")
  * Dice ser la cuenta oficial de la empresa
  * Hace disclaimers de privacidad o datos ("no guardaré tus datos")
  * Pregunta el nombre o datos del usuario como primer paso (onboarding)
  * Ofrece menús numerados o botones de opciones
  * NO responde al contenido específico del mensaje enviado
  * Responde en segundos (tiempo de reacción < 1 minuto)
  * Usa emojis de forma estructurada y repetitiva

Adicionalmente evalúa si el bot usa Inteligencia Artificial (is_ai):
- is_ai = true si: responde con lenguaje natural fluido y variado, entiende preguntas abiertas, adapta sus respuestas al contexto, usa frases como "entiendo tu consulta" / "con gusto te ayudo" / "puedo ayudarte con...", nunca repite el mismo texto exacto, maneja conversación sin menús fijos.
- is_ai = false si: usa menús numerados fijos, siempre responde igual, solo reconoce palabras clave, flujo completamente rígido.
- Si category es "humano" o "automatico", is_ai = false siempre.

IMPORTANTE:
- Ortografía perfecta + emojis estructurados + no responde al tema = BOT o AUTOMÁTICO.
- Faltas de ortografía o lenguaje informal = señal fuerte de HUMANO.
- Si la respuesta NO aborda el tema del mensaje enviado y sigue un flujo propio = BOT o AUTOMÁTICO.

Responde ÚNICAMENTE con JSON válido:
{{"category": "humano|automatico|bot", "is_ai": true|false, "ai_confidence": 0.0-1.0, "response_quality": 1-5, "bot_quality": 1-5 o null, "notes": "frase corta"}}

response_quality: 1=ignora el mensaje/genérica, 2=mínima sin contexto, 3=reconoce el mensaje, 4=útil con info relevante, 5=interés genuino en el negocio
bot_quality: solo si category es "bot". 1=básico/menús, 3=conversacional funcional, 5=IA avanzada
ai_confidence: qué tan seguro estás de que uses IA (0.0=seguro que no, 1.0=seguro que sí)\
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
        if reaction_time_min is not None and reaction_time_min < 1:
            reaction_hint = "\n⚠️ DATO ADICIONAL: La respuesta llegó en menos de 1 minuto — señal fuerte de sistema automatizado."
        elif reaction_time_min is not None and reaction_time_min < 3:
            reaction_hint = f"\n⚠️ DATO ADICIONAL: La respuesta llegó en {reaction_time_min:.1f} minutos — posible automatización."

        prompt = _PROMPT_TEMPLATE.format(
            outbound_body=outbound_body or "(sin texto)",
            inbound_body=inbound_body or "(sin texto)",
        ) + reaction_hint
        chat_response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
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
            "response_quality": result.get("response_quality"),
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
        db = MongoDBManager()

        last_outbound = db.get_last_outbound_for_company(company_id)
        outbound_body = ""
        reaction_time_min = None

        if last_outbound:
            outbound_body = last_outbound.get("message_body") or last_outbound.get("message_text") or ""
            last_sent_at = last_outbound.get("created_at")
            if last_sent_at and isinstance(last_sent_at, datetime):
                delta = received_at - last_sent_at
                reaction_time_min = round(delta.total_seconds() / 60, 1)

        business_hours = is_business_hours(received_at)

        analysis = classify_response(inbound_body, outbound_body, reaction_time_min)
        analysis["reaction_time_min"] = reaction_time_min
        analysis["business_hours"] = business_hours
        analysis["classified_at"] = datetime.now().isoformat()

        db.save_message_analysis(log_id, analysis)
    except Exception:
        pass  # background task — fail silently
