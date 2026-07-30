# classifier.py
"""LLM-based classifier for inbound WhatsApp responses."""
import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta

from app.database import MongoDBManager

log = logging.getLogger(__name__)

def all_quota_exhausted() -> bool:
    """Return True if the LLM circuit breaker is open (delegates to llm_guard)."""
    from app.llm_guard import circuit_is_open
    return circuit_is_open()


def reset_quota_circuit() -> None:
    """Re-close the circuit breaker (delegates to llm_guard)."""
    from app.llm_guard import reset_circuit
    reset_circuit()


class LLMQuotaExceeded(Exception):
    pass

GroqQuotaExceeded = LLMQuotaExceeded  # legacy alias


# ── Single-message prompt (first reply / cold response) ───────────────────────

_PROMPT_TEMPLATE = """\
Eres un auditor experto en calidad de atención comercial vía WhatsApp en Latinoamérica.
Evalúas dos cosas: (1) el ORIGEN de la respuesta y (2) la CALIDAD del servicio entregado.

MENSAJE ENVIADO: {outbound_body}
RESPUESTA DEL PROSPECTO: {inbound_body}

══ PASO 1: ORIGEN DE LA RESPUESTA ══
Elige UNO: "humano" | "automatico" | "menu" | "hibrido" | "bot"

"humano" — persona real respondiendo en tiempo real.
  Señales FUERTES (cada una por sí sola es suficiente):
    · Responde DIRECTAMENTE al contenido específico del mensaje enviado (no genérico)
    · Menciona detalles propios de su empresa/situación ("nosotros manejamos...", "mi jefa...", "ahorita en reunión")
    · Hace una pregunta espontánea propia sobre el tema
    · Primera persona auténtica con opinión o contexto personal
    · Menciona nombres de personas o departamentos reales
    · Responde fuera de horario laboral con comentario personal ("disculpa la tardanza, estaba en campo")
  Señales DÉBILES (solo apoyo, no determinantes):
    · Errores tipográficos (un humano formal puede escribir perfecto)
    · Respuesta muy corta (humano ocupado también responde con 1-2 palabras)
    · Lenguaje coloquial (un bot también puede usarlo)
  CLAVE: lo que importa es que RESPONDE AL TEMA, no que tenga errores ortográficos.

"automatico" — plantilla fija activada por cualquier entrada, ignora el contenido enviado.
  Señales FUERTES:
    · Número de ticket, folio o referencia (#TKT-0023, Ref: 45678, Folio: ABC-123)
    · Frases de plantilla reconocibles: "Tu mensaje es importante para nosotros",
      "En breve un asesor te contactará", "Estimado cliente", "Mensaje generado automáticamente",
      "Hemos recibido tu consulta", "Nos comunicaremos a la brevedad"
    · Respuesta idéntica sin importar el mensaje recibido (ignora completamente el tema)
    · Horarios de atención explícitos en el cuerpo ("Lun-Vie 8am-6pm", "Atención 24/7")
    · Firma de empresa muy formal o URL corporativa al pie
    · Responde en segundos a cualquier hora incluyendo madrugada, fines de semana o festivos
    · Texto muy largo y formal para un simple saludo inicial
  DIFERENCIA vs "menu": no espera respuesta del usuario, solo acusa recibo.

"menu" — chatbot IVR que presenta opciones y ESPERA que el usuario seleccione una.
  Señales FUERTES:
    · Lista numerada de opciones de navegación (1. Ventas  2. Soporte  3. Información)
    · Emojis de número como ícono de opción (1️⃣ Ventas  2️⃣ Soporte  3️⃣ Facturación)
    · Opciones separadas por | o / (Ventas | Soporte | Admin)
    · Instrucción explícita de selección ("Responde con el número", "Elige una opción", "Escribe 1, 2 o 3")
    · Árbol de decisión paso a paso (cada respuesta lleva a un nuevo submenú)
    · Pregunta binaria de navegación ("¿Eres cliente? Responde SÍ o NO")
  DIFERENCIA vs "bot": no intenta entender el mensaje libre, solo presenta opciones fijas.
  DIFERENCIA vs "automatico": SÍ espera input del usuario para continuar el flujo.

"hibrido" — combina contenido automático CON contenido humano en la misma respuesta o en el hilo inmediato.
  CASOS que califican como "hibrido":
    (1) Mensaje automático + opción ACTIVA de hablar con humano ahora mismo:
        "¿Deseas hablar con un asesor? Responde SÍ", "Te conecto con un agente",
        "Escribe HUMANO", botón "Hablar con asesor"
    (2) El mensaje ES el anuncio del handoff: "Hola, soy [nombre], reemplazaré a nuestro asistente virtual",
        "Se está comunicando con un agente de [empresa] vía WhatsApp. Desde ahora reemplazaré al bot."
        → aunque el mensaje parezca humano, el contexto indica que antes había un bot → "hibrido"
  NO confundir con "automatico" que solo promete contacto futuro sin dar opción activa ahora.

"bot" — sistema con lógica propia o IA conversacional, SIN menú numerado.
  Señales FUERTES de bot (cada una por sí sola es suficiente):
    · Mensaje bilingüe en el mismo bloque: español + inglés separados por "/" o "---"
      (ej: "La sesión ha finalizado. / Session ended." → bot CERTEZA)
    · Gestión de sesión explícita: "cerraré la sesión", "La sesión ha finalizado",
      "Session ended", "podemos continuar cuando quieras", "Recuerda enviar X para chatear"
    · Se identifica como IA o bot: "Soy [Nombre] tu asistente virtual", "soy un bot",
      "Hola, soy Max", o el nombre del contacto/empresa contiene "Bot", "Chatbot", "IA",
      "Asistente Virtual", "Robótico", "Virtual"
    · Instrucciones de activación: "envía 'HOLA' para comenzar", "escribe X para chatear conmigo 🤖"
    · Estructura de IA: responde en tercera persona sobre sí mismo describiendo sus capacidades
      ("Estoy diseñado para...", "Mi enfoque es...", "Puedo ayudarte con...")
  is_ai=false (bot de flujo/reglas):
    · Ignora preguntas fuera de su flujo o repite el mismo mensaje ante entradas inesperadas
    · Respuestas excesivamente largas con bullets y estructura para mensajes simples
    · Tono corporativo perfecto sin personalidad real
    · Si respondes algo inesperado, hace loop de vuelta al mismo punto
  is_ai=true (IA conversacional avanzada):
    · Entiende y responde al contenido específico del mensaje (no flujo rígido)
    · Reformula o parafrasea lo que dijo el interlocutor
    · Responde con naturalidad, sin bullets ni estructura excesiva
    · Español perfecto, extremadamente servicial, nunca impaciente, siempre positivo
    · Puede admitir que no sabe algo de forma natural
    · Usa el nombre del usuario si lo conoce
    · DIFERENCIA de humano: demasiado perfecto y consistente, sin personalidad única,
      sin opiniones propias, sin referencia a situaciones personales reales

REGLA DE ORO: ante la duda → "humano". EXCEPCIÓN: si hay señales FUERTES de bot (bilingüe,
gestión de sesión, se autoidentifica como bot) → "bot" aunque también parezca natural.
JERARQUÍA: si hay menú numerado → "menu" aunque también tenga frases automáticas.

══ PASO 2: CALIDAD DE SERVICIO (escala 1-5) ══
Mide CÓMO atendió la empresa al prospecto. Independiente del interés de compra del lead.
1=inexistente/pésimo · 2=deficiente · 3=aceptable · 4=bueno · 5=excelente
Automáticos/bots que ignoran la consulta: 1-2 en TODAS las dimensiones sin excepción.

svc_prof  (Profesionalismo): ortografía, tono apropiado, coherencia y claridad
svc_comp  (Completitud): ¿respondió específicamente lo que se preguntó o solicitó?
svc_empa  (Empatía): calidez, personalización, reconoce y valida la necesidad del prospecto
svc_solu  (Solución): ¿ofreció algo concreto? (precio orientativo, producto específico, alternativa, cita)
svc_next  (Siguiente paso): ¿quedó claro qué sigue? (CTA explícito: llamada, link, reunión, precio)
svc_proact (Proactividad): ¿anticipó necesidades, hizo preguntas de calificación, ofreció info extra?

══ PASO 3: SEÑAL COMERCIAL (1-5) ══
¿Qué tan "caliente" quedó el lead? ¿Esta respuesta acerca o aleja una venta?
1 — Ruido: "Ok","👍","Gracias", emoji solo, acuse de 1-2 palabras. Automáticos/bots = 1 siempre.
2 — Cortesía vacía: reconoce contacto pero evita el tema. "Ahorita te marco", template de bienvenida.
3 — Apertura tibia: toca el tema sin compromiso. "Mándame info", "¿De qué se trata?", "¿Qué venden?"
4 — Señal real: pregunta específica del producto/servicio, da contexto de su situación o menciona necesidad/timing.
5 — Lead caliente: pide cotización/precio, propone llamada o reunión, menciona urgencia o presupuesto.
ESTADÍSTICA: 75% son 1-2. Un 3 requiere evidencia explícita. 4-5 son genuinamente excepcionales.

══ PASO 4: CONCLUSIÓN PARA EL CLIENTE (máximo 30 palabras) ══
Escribe en lenguaje simple (como si hablaras con un dueño de negocio, no un técnico):
qué pasó con este contacto, cómo respondió la empresa y qué acción concreta conviene tomar.
✓ "Respondieron rápido con un asesor real y ofrecieron una cita. Vale la pena dar seguimiento."
✓ "El sistema solo manda mensajes automáticos. No hay persona disponible. Contactar por otro medio."
✓ "Mostraron interés real y pidieron más información. Buen momento para enviar una propuesta."
✗ "Respuesta breve" / "Muestra interés" / "Sistema automático" (demasiado vago, no ayuda al cliente)

is_ai: true SOLO si category="bot" Y claramente es IA conversacional (no menú, no flujo rígido)
bot_quality: SOLO si category="bot": 1=flujo básico · 3=flujo funcional · 5=IA avanzada
ai_confidence: 0.0-1.0 solo si is_ai=true
Para category="menu": is_ai=false siempre, bot_quality=null siempre.

Responde SOLO con JSON válido:
{{"category":"humano|automatico|menu|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"response_quality":1,"bot_quality":null,"notes":"diagnóstico"}}\
"""


# ── Full-conversation prompt (used after AI session closes) ───────────────────

_CONV_PROMPT_TEMPLATE = """\
Eres un analista comercial experto en comportamiento de empresas en WhatsApp.
Acabas de leer TODA la conversación con {company_name} ({industry}).

⚠️ PISTA DE NOMBRE: si "{company_name}" contiene "Bot", "Chatbot", "IA", "Asistente", "Virtual",
"Robótico" → casi certeza de sistema automatizado, clasifica como "bot" salvo evidencia clara de lo contrario.

CONVERSACIÓN COMPLETA (cronológica — [Representante] = mensajes enviados, [Prospecto] = respuestas recibidas):
{thread}

══ PASO 1: DETECTA LAS FASES DE LA CONVERSACIÓN ══

Lee el hilo completo e identifica si hubo CAMBIOS de comportamiento a lo largo del tiempo.
NO te quedes solo con el primer o último mensaje — analiza el ARC completo.

SEÑALES DE FASE AUTOMÁTICA / BOT (cualquiera de estas confirma fase automática):
  · Menú con opciones letradas o numeradas (A/B/C, 1/2/3, *A* - Opción, 1️⃣ Ventas)
  · Se auto-identifica: "Hola, soy el asistente virtual de X", "soy un bot", emoji 🤖 en su mensaje
  · El mismo texto aparece REPETIDO ante entradas diferentes (loop de bot)
  · Responde en segundos a cualquier hora incluyendo madrugada
  · Frases de plantilla: "Antes de prestarle asistencia…", "Ahora está en la cola…",
    "Hemos recibido tu consulta", "Un agente te contactará a la brevedad"

SEÑALES DE FASE HUMANA (cualquiera de estas confirma fase humana):
  · Anuncia la transición: "Hola, soy [nombre], reemplazaré a nuestro asistente",
    "Se está comunicando con un agente de [empresa]", "Ahora lo atenderá un asesor"
  · Responde AL CONTENIDO ESPECÍFICO enviado, no a una plantilla
  · Usa el nombre del interlocutor de forma natural ("Entiendo Andrés…")
  · Lenguaje conversacional real: explica con contexto, hace preguntas propias, varía el tono
  · Da información concreta (precios, políticas, procesos) que no es un menú
  · Firma personal o despedida informal ("Saludos", "Quedamos atentos")

══ PASO 2: CLASIFICA — ÁRBOL DE DECISIÓN OBLIGATORIO ══

Aplica en orden. La PRIMERA regla que coincida es la categoría correcta:

1. ¿La conversación tiene AMBAS: una fase claramente automática/bot/menú Y posteriormente
   una fase claramente humana (agente real)? → "hibrido"
   EJEMPLOS que son "hibrido":
     · Bot de bienvenida → menú de opciones → agente humano toma la conversación
     · Auto-respuesta de acuse → días después responde un vendedor real
     · IVR de WhatsApp que transfiere a agente cuando el usuario pide ayuda
   IMPORTANTE: si hay handoff bot→humano, siempre es "hibrido" sin excepción.

2. ¿Toda la conversación del prospecto son menús/opciones sin que jamás aparezca un humano real?
   → "menu"

3. ¿Toda la conversación es un bot con IA o flujo automatizado sin menús y sin humano?
   → "bot"

4. ¿Toda la conversación del prospecto son plantillas automáticas (acuses, folios, horarios)
   sin menús y sin humano? → "automatico"

5. ¿Todo indica persona real respondiendo a lo largo de toda la conversación? → "humano"

REGLA DE ORO: si tienes dudas entre "humano" y otro, elige "humano".
EXCEPCIÓN ABSOLUTA: si detectaste señales FUERTES de bot/menú en alguna fase, NO puede ser solo "humano".

══ PASO 3: CALIDAD DE SERVICIO (1-5) ══

Si la categoría es "hibrido": evalúa PRINCIPALMENTE la fase humana (ignora la calidad del bot).
Si es "menu" / "automatico" / "bot" puro: TODAS las dimensiones van en 1-2, sin excepción.

svc_prof  (Profesionalismo): ortografía, tono, coherencia
svc_comp  (Completitud): ¿respondió específicamente lo que se pidió?
svc_empa  (Empatía): calidez, personalización, valida la necesidad
svc_solu  (Solución): ¿ofreció algo concreto? (precio, producto, alternativa, cita)
svc_next  (Siguiente paso): ¿quedó claro qué sigue? (CTA explícito)
svc_proact (Proactividad): ¿anticipó necesidades o hizo preguntas de calificación?

══ PASO 4: SEÑAL COMERCIAL FINAL (1-5) ══
Estado del lead al cierre de la conversación:
1 — Descartado / bloqueó / sin interés
2 — Frío / dejó de responder / cortesía vacía
3 — Tibio / pidió info sin compromiso claro
4 — Interesado / preguntó detalles, pidió que lo contacten
5 — Caliente / pidió precio, cita, propuesta o mostró urgencia

══ PASO 5: CONCLUSIÓN (máximo 35 palabras) ══
Para un dueño de negocio sin tecnicismos. Si es "hibrido": menciona explícitamente
que hubo un bot inicial y luego un agente real, y evalúa la calidad del agente.
Indica la acción concreta más importante a tomar.

Responde SOLO con JSON válido:
{{"category":"humano|automatico|menu|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"response_quality":3,"bot_quality":null,"notes":"diagnóstico","conversation_analysis":true}}\
"""

_ERROR_RESULT = {
    "category": "humano",
    "is_ai": False,
    "ai_confidence": 0.0,
    "svc_prof": None,
    "svc_comp": None,
    "svc_empa": None,
    "svc_solu": None,
    "svc_next": None,
    "svc_proact": None,
    "response_quality": 3,
    "bot_quality": None,
    "notes": "LLM no configurado",
    "error": True,
}


def is_business_hours(dt: datetime) -> bool:
    return dt.weekday() < 5 and 9 <= dt.hour < 18


def _build_prompt(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> str:
    reaction_hint = ""
    if reaction_time_min is not None:
        secs = reaction_time_min * 60
        if secs < 10:
            reaction_hint = (
                f"\n🚨 SEÑAL CRÍTICA DE TIEMPO: respuesta en {secs:.0f} segundos — CERTEZA de bot/automatico. "
                "Un humano no puede leer y responder en menos de 10 segundos."
            )
        elif secs < 30:
            reaction_hint = (
                f"\n⚠️ SEÑAL FUERTE DE TIEMPO: respuesta en {secs:.0f} segundos — casi con certeza bot/automatico. "
                "Solo un sistema puede responder tan rápido."
            )
        elif secs < 120:
            reaction_hint = (
                f"\n⚠️ POSIBLE BOT: respuesta en {secs:.0f} segundos ({reaction_time_min:.1f} min) — "
                "tiempo corto, puede ser bot rápido o humano muy atento. Analizar contenido."
            )
        elif reaction_time_min < 10:
            reaction_hint = (
                f"\nℹ️ TIEMPO NORMAL: respuesta en {reaction_time_min:.0f} minutos — "
                "compatible con humano. Analizar contenido para confirmar."
            )
        elif reaction_time_min < 60:
            reaction_hint = (
                f"\nℹ️ TIEMPO HUMANO: respuesta en {reaction_time_min:.0f} minutos — "
                "muy probable que sea humano. Automáticos responden en segundos."
            )
        else:
            h = int(reaction_time_min // 60); mn = int(reaction_time_min % 60)
            time_str = f"{h}h {mn}m" if mn else f"{h}h"
            reaction_hint = (
                f"\nℹ️ RESPUESTA TARDÍA: {time_str} — puede ser humano fuera de horario "
                "o mensaje automático de bienvenida demorado."
            )
    return _PROMPT_TEMPLATE.format(
        outbound_body=outbound_body or "(sin texto)",
        inbound_body=inbound_body or "(sin texto)",
    ) + reaction_hint


_VALID_CATEGORIES = {"humano", "automatico", "menu", "hibrido", "bot"}


def _parse_llm_response(raw: str) -> dict:
    if raw.startswith("```"):
        raw = raw.split("```")[1].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    result = json.loads(raw)
    category = result.get("category", "humano")
    if category not in _VALID_CATEGORIES:
        category = "humano"
    is_ai = bool(result.get("is_ai", False)) if category == "bot" else False

    def _svc(key):
        v = result.get(key)
        if v is None:
            return None
        try:
            v = int(round(float(v)))
            return max(1, min(5, v))
        except (TypeError, ValueError):
            return None

    return {
        "category": category,
        "is_ai": is_ai,
        "ai_confidence": round(float(result.get("ai_confidence", 0.0)), 2) if is_ai else 0.0,
        "svc_prof":   _svc("svc_prof"),
        "svc_comp":   _svc("svc_comp"),
        "svc_empa":   _svc("svc_empa"),
        "svc_solu":   _svc("svc_solu"),
        "svc_next":   _svc("svc_next"),
        "svc_proact": _svc("svc_proact"),
        "response_quality": result.get("response_quality") or 2,
        "bot_quality": result.get("bot_quality"),
        "notes": result.get("notes", ""),
        "conversation_analysis": bool(result.get("conversation_analysis", False)),
    }


def _call_deepseek(messages: list, max_tokens: int = 280) -> str:
    """Call active LLM provider with BATCH priority. Raises LLMQuotaExceeded on billing errors."""
    from app.llm import call_llm, PRIORITY_BATCH
    try:
        return call_llm(messages, max_tokens=max_tokens, temperature=0, priority=PRIORITY_BATCH)
    except Exception as e:
        err = str(e).lower()
        if "402" in str(e) or "insufficient_balance" in err:
            raise LLMQuotaExceeded("DeepSeek saldo insuficiente")
        # Circuit breaker open or rate limit — surface as quota exhaustion for callers
        if "circuit breaker" in err or "rate-limited" in err or "429" in err:
            raise LLMQuotaExceeded(f"LLM cuota/rate-limit: {e}")
        raise


# ── Cheap pre-filter — resolves the unambiguous cases without spending an LLM call ──
# Only the two signals that are deterministic enough to trust blindly: a structured
# menu (category="menu" is always is_ai=False, bot_quality=None per the prompt rules
# above) and an explicit auto-reply template arriving near-instantly. Everything else
# (human vs bot vs conversational-AI vs hibrido) needs real judgment and still goes to
# the LLM — this is not an attempt to replace that, only to skip it when it's redundant.

_MENU_MARKERS = re.compile(
    r'\[Opciones:|\[Lista:|responde con el n[uú]mero|elige una opci[oó]n|'
    r'escribe (?:el )?(?:1|2|3|un n[uú]mero)|selecciona una opci[oó]n',
    re.IGNORECASE,
)
_MENU_LIST_ITEM = re.compile(
    r'(?:^|\n)\s*(?:[0-9]{1,2}[.\)]|[*_]?[A-H][*_]?\s*[.\)-])\s+\S',
    re.MULTILINE,
)

_AUTO_REPLY_MARKERS = re.compile(
    r'folio|tkt-|ticket\s*#|ref(?:erencia)?\s*[:#]|tu mensaje es importante|'
    r'en breve (?:un asesor|te contactar)|hemos recibido tu (?:consulta|mensaje)|'
    r'nos comunicaremos a la brevedad|mensaje generado autom[aá]ticamente|'
    r'estimado cliente|horario de atenci[oó]n',
    re.IGNORECASE,
)


def _looks_like_menu(text: str) -> bool:
    if _MENU_MARKERS.search(text):
        return True
    return len(_MENU_LIST_ITEM.findall(text)) >= 2


def _looks_like_auto_reply(text: str) -> bool:
    return bool(_AUTO_REPLY_MARKERS.search(text))


def _quick_result(category: str, notes: str) -> dict:
    """Same shape as _parse_llm_response's output — low/None across the board,
    matching the prompt's own rule: menu/automatico/bot(non-AI) always score 1-2."""
    return {
        "category": category,
        "is_ai": False,
        "ai_confidence": 0.0,
        "svc_prof": 1, "svc_comp": 1, "svc_empa": 1,
        "svc_solu": 1, "svc_next": 1, "svc_proact": 1,
        "response_quality": 1,
        "bot_quality": None,
        "notes": notes,
        "conversation_analysis": False,
        "quick_classified": True,  # marks that this skipped the LLM, for auditing
    }


def _quick_classify(inbound_body: str, reaction_time_min: float = None) -> dict | None:
    """Resolve the obvious cases with cheap rules. Returns None when the text needs
    real judgment — that residual is what actually reaches the LLM."""
    text = (inbound_body or "").strip()
    if not text:
        return None

    if _looks_like_menu(text):
        return _quick_result("menu", "Menú de opciones detectado por reglas — sin IA")

    responded_instantly = reaction_time_min is not None and reaction_time_min * 60 < 10
    if responded_instantly and _looks_like_auto_reply(text):
        return _quick_result("automatico", "Plantilla de auto-respuesta + respuesta instantánea — sin IA")
    if responded_instantly:
        return _quick_result("bot", f"Respuesta en {reaction_time_min * 60:.0f}s — imposible para humano; bot o sistema automático")

    return None


def classify_response(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> dict:
    """Classify a single inbound reply using the outbound message as context.
    Cheap rules resolve the obvious cases first (see _quick_classify) — only
    genuine ambiguity spends an LLM call."""
    quick = _quick_classify(inbound_body, reaction_time_min)
    if quick is not None:
        return quick

    from app.llm import active_provider
    if active_provider() == "none":
        result = dict(_ERROR_RESULT)
        if reaction_time_min is not None and reaction_time_min * 60 < 30:
            result["category"] = "bot"
            result["notes"] = "LLM no configurado — bot inferido por tiempo de respuesta < 30s"
        return result
    if all_quota_exhausted():
        raise LLMQuotaExceeded("Circuit breaker activo — DeepSeek sin cuota.")
    prompt = _build_prompt(inbound_body, outbound_body, reaction_time_min)
    try:
        raw = _call_deepseek([{"role": "user", "content": prompt}])
        return _parse_llm_response(raw)
    except LLMQuotaExceeded:
        raise
    except Exception as e:
        import traceback
        log.error("classify_response failed: %s\n%s", e, traceback.format_exc())
        category = "bot" if (reaction_time_min is not None and reaction_time_min * 60 < 30) else "humano"
        return {"category": category, "response_quality": 3, "bot_quality": None, "notes": "Error al clasificar", "error": True}


def classify_conversation(company_id: str, company_name: str = "", industry: str = "") -> dict:
    """Analyze the full message thread for a company after an AI session closes.
    Fetches all messages from message_logs and builds a complete conversation view."""
    from app.llm import active_provider
    if active_provider() == "none":
        return dict(_ERROR_RESULT)
    if all_quota_exhausted():
        raise LLMQuotaExceeded("Circuit breaker activo — DeepSeek sin cuota.")

    db = MongoDBManager()
    messages = list(db.db.message_logs.find(
        {"company_id": company_id, "direction": {"$in": ["inbound", "outbound"]}},
        {"direction": 1, "message_body": 1, "sent_by_name": 1, "created_at": 1},
        sort=[("created_at", 1)],
        limit=40,
    ))
    if not messages:
        return dict(_ERROR_RESULT)

    lines = []
    for m in messages:
        role = "Representante" if m["direction"] == "outbound" else "Prospecto"
        body = (m.get("message_body") or "").strip()
        if body:
            lines.append(f"[{role}]: {body}")
    thread = "\n".join(lines)

    prompt = _CONV_PROMPT_TEMPLATE.format(
        company_name=company_name or company_id,
        industry=industry or "desconocido",
        thread=thread,
    )
    try:
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=350)
        return _parse_llm_response(raw)
    except LLMQuotaExceeded:
        raise
    except Exception as e:
        import traceback
        log.error("classify_conversation failed for %s: %s\n%s", company_id, e, traceback.format_exc())
        return {"category": "humano", "response_quality": 3, "bot_quality": None, "notes": "Error al analizar conversación", "error": True}


def classify_and_save(log_id: str, company_id: str, inbound_body: str, received_at: datetime):
    """Background task: classify a single inbound message and save the analysis."""
    if all_quota_exhausted():
        log.debug("classify_and_save: cuota agotada, skip log_id=%s", log_id)
        return
    try:
        from bson import ObjectId
        db = MongoDBManager()
        existing = db.db.message_logs.find_one(
            {"_id": ObjectId(log_id)}, {"analysis_status": 1}
        )
        if (existing or {}).get("analysis_status") == "quota_exceeded":
            log.debug("classify_and_save: ya marcado quota_exceeded, skip log_id=%s", log_id)
            return

        # Check if this message resolves a pending human-followup for the same company
        pending = db.db.message_logs.find_one({
            "company_id": company_id,
            "direction": "inbound",
            "analysis.pending_human_check": True,
            "analysis.followup_deadline": {"$gte": received_at},
        })
        if pending:
            prior_id = str(pending["_id"])
            prior_outbound = db.get_last_outbound_for_company(
                company_id, before_dt=pending.get("created_at", received_at),
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

        inbound_doc = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"from_number": 1, "number": 1})
        from_number = (inbound_doc or {}).get("from_number") or (inbound_doc or {}).get("number")

        last_outbound = db.get_last_outbound_for_company(company_id, before_dt=received_at, to_number=from_number)
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

        if analysis.get("category") in ("automatico", "bot"):
            analysis["pending_human_check"] = True
            analysis["followup_deadline"] = received_at + timedelta(minutes=5)
        else:
            analysis["pending_human_check"] = False

        db.save_message_analysis(log_id, analysis)
    except LLMQuotaExceeded:
        log.warning("classify_and_save: LLM sin cuota para log_id=%s — marcado como quota_exceeded", log_id)
        try:
            from bson import ObjectId
            db.db.message_logs.update_one(
                {"_id": ObjectId(log_id)},
                {"$set": {"analysis_status": "quota_exceeded"}, "$unset": {"analysis": ""}},
            )
        except Exception:
            pass
    except Exception as _exc:
        import traceback
        log.error("classify_and_save failed for log_id=%s: %s\n%s", log_id, _exc, traceback.format_exc())
        try:
            from bson import ObjectId
            db.db.message_logs.update_one(
                {"_id": ObjectId(log_id)},
                {"$set": {"analysis_status": "error"}},
            )
        except Exception:
            pass


def classify_conversation_and_save(company_id: str, log_id: str):
    """Analyze the full conversation thread and save the result on the given log_id.
    Called after an AI session closes — replaces any prior single-message analysis."""
    try:
        from bson import ObjectId
        db = MongoDBManager()

        try:
            company = db.db.companies.find_one({"_id": ObjectId(company_id)}) or {}
        except Exception:
            company = {}
        company_name = company.get("name", "")
        industry = company.get("industry", "")

        analysis = classify_conversation(company_id, company_name, industry)
        analysis["classified_at"] = datetime.now().isoformat()
        analysis["pending_human_check"] = False
        db.save_message_analysis(log_id, analysis)
        log.info("classify_conversation_and_save: saved for company=%s log=%s", company_id, log_id)
    except LLMQuotaExceeded:
        log.warning("classify_conversation_and_save: LLM sin cuota para company=%s", company_id)
    except Exception as _exc:
        import traceback
        log.error("classify_conversation_and_save failed for %s: %s\n%s", company_id, _exc, traceback.format_exc())


_NO_REPLY_WAIT_MINUTES = 30
_SWEEP_INTERVAL_SEC    = 300


def _sweep_pending():
    try:
        db = MongoDBManager()
        now = datetime.now()

        db.db.message_logs.update_many(
            {
                "direction": "inbound",
                "analysis.pending_human_check": True,
                "analysis.followup_deadline": {"$lt": now},
            },
            {"$set": {"analysis.pending_human_check": False}},
        )

        cutoff = now - timedelta(minutes=_NO_REPLY_WAIT_MINUTES)
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
            has_reply = db.db.message_logs.find_one({
                "company_id": company_id,
                "direction": "inbound",
                "created_at": {"$gt": sent_at},
            })
            if not has_reply:
                db.save_message_analysis(str(ob["_id"]), {
                    "category":         "sin_respuesta",
                    "svc_prof":         None,
                    "svc_comp":         None,
                    "svc_empa":         None,
                    "svc_solu":         None,
                    "svc_next":         None,
                    "svc_proact":       None,
                    "response_quality": 0,
                    "notes":            f"Sin respuesta tras {_NO_REPLY_WAIT_MINUTES} min",
                    "classified_at":    now.isoformat(),
                    "pending_human_check": False,
                })

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
                from app.llm import active_provider as _ap
                if body and _ap() != "none":
                    import threading as _t
                    _t.Thread(
                        target=classify_and_save,
                        args=(str(msg["_id"]), resolved, body, now),
                        daemon=True,
                    ).start()

    except Exception:
        log.exception("_sweep_pending failed")


def start_classifier_background():
    def _loop():
        while True:
            time.sleep(_SWEEP_INTERVAL_SEC)
            _sweep_pending()

    t = threading.Thread(target=_loop, daemon=True, name="classifier-sweep")
    t.start()
    log.info("Classifier background sweep started (every %ds)", _SWEEP_INTERVAL_SEC)
