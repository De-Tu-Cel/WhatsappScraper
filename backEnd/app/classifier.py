# classifier.py
"""LLM-based classifier for inbound WhatsApp responses."""
import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from app.database import MongoDBManager

log = logging.getLogger(__name__)

_MEXICO_TZ = timezone(timedelta(hours=-6))  # CST — UTC-6 year-round, matches ai_followup.py

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
Elige UNO: "humano" | "hibrido" | "bot"

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

"hibrido" — combina contenido automático/bot CON contenido humano en la misma respuesta o en el hilo inmediato.
  CASOS que califican como "hibrido":
    (1) Mensaje automático/bot + opción ACTIVA de hablar con humano ahora mismo:
        "¿Deseas hablar con un asesor? Responde SÍ", "Te conecto con un agente",
        "Escribe HUMANO", botón "Hablar con asesor"
    (2) El mensaje ES el anuncio del handoff: "Hola, soy [nombre], reemplazaré a nuestro asistente virtual",
        "Se está comunicando con un agente de [empresa] vía WhatsApp. Desde ahora reemplazaré al bot."
        → aunque el mensaje parezca humano, el contexto indica que antes había un bot → "hibrido"
  NO confundir con "bot" que solo promete contacto futuro sin dar opción activa ahora.

"bot" — cualquier respuesta generada por sistema, SIN menú numerado: desde una plantilla fija
que ignora el contenido enviado hasta una IA conversacional avanzada.
  Señales FUERTES de bot (cada una por sí sola es suficiente):
    · Número de ticket, folio o referencia (#TKT-0023, Ref: 45678, Folio: ABC-123)
    · Frases de plantilla reconocibles: "Tu mensaje es importante para nosotros",
      "En breve un asesor te contactará", "Estimado cliente", "Mensaje generado automáticamente",
      "Hemos recibido tu consulta", "Nos comunicaremos a la brevedad"
    · Respuesta idéntica sin importar el mensaje recibido (ignora completamente el tema)
    · Horarios de atención explícitos en el cuerpo ("Lun-Vie 8am-6pm", "Atención 24/7")
    · Responde en segundos a cualquier hora incluyendo madrugada, fines de semana o festivos
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
  is_ai=false (plantilla fija, menú/IVR, o bot de flujo/reglas):
    · Presenta un menú de opciones numeradas o con letra y ESPERA que el usuario seleccione una
      (1. Ventas 2. Soporte, 1️⃣/2️⃣, "Responde con el número", "Elige una opción")
    · Respuesta idéntica sin importar el mensaje recibido, o ignora preguntas fuera de su flujo
    · Respuestas excesivamente largas con bullets y estructura para mensajes simples
    · Tono corporativo perfecto sin personalidad real
    · Si respondes algo inesperado, hace loop de vuelta al mismo punto (o no responde nada más)
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
gestión de sesión, se autoidentifica como bot, menú numerado) → "bot" aunque también parezca natural.

══ PASO 2: CALIDAD DE SERVICIO (escala 1-5) ══
Mide CÓMO atendió la empresa al prospecto. Independiente del interés de compra del lead.
Automáticos/bots que ignoran la consulta: 1-2 en TODAS las dimensiones sin excepción.
Acuse de recibo o cortesía vacía sin abordar el tema ("gracias", "ok", "entendido",
"gracias por su mensaje", emoji solo, 1-4 palabras sin sustancia) — sea humano o bot —
TODAS las dimensiones en 1-2. El tono amable no compensa la falta de contenido real.

svc_prof   (Profesionalismo) — 1-2: errores graves o tono cortante/inapropiado · 4-5: impecable, tono cálido y consistente
svc_comp   (Completitud) — 1-2: ignora la pregunta o da algo genérico que no aplica · 4-5: responde punto por punto, sin dejar nada sin cubrir
svc_empa   (Empatía) — 1-2: trato robótico, no usa nombre ni contexto · 4-5: usa el nombre, reconoce la situación específica del prospecto
svc_solu   (Solución) — 1-2: nada concreto, solo "te contactaremos" · 4-5: precio/producto/cita específicos, no genéricos
svc_next   (Siguiente paso) — 1-2: termina sin ningún CTA · 4-5: CTA explícito y accionable de inmediato
svc_proact (Proactividad) — 1-2: solo reacciona, cero iniciativa · 4-5: anticipa, califica, ofrece más de lo pedido

CALIBRACIÓN: no asumas 3 por default. Un 3 exige evidencia mixta real (ni claramente bien ni mal) —
si dudas entre 2 y 3, o entre 3 y 4, elige el extremo que tenga evidencia concreta en el texto.

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
Si hay menú numerado: category="bot", is_ai=false siempre, bot_quality=null siempre.

Responde SOLO con JSON válido:
{{"category":"humano|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"bot_quality":null,"notes":"diagnóstico"}}\
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

2. ¿Toda la conversación es un bot (menús/opciones, plantilla fija, flujo automatizado, o IA
   conversacional) sin que jamás aparezca un humano real? → "bot"

3. ¿Todo indica persona real respondiendo a lo largo de toda la conversación? → "humano"

REGLA DE ORO: si tienes dudas entre "humano" y otro, elige "humano".
EXCEPCIÓN ABSOLUTA: si detectaste señales FUERTES de bot/menú en alguna fase, NO puede ser solo "humano".

══ PASO 3: CALIDAD DE SERVICIO (1-5) ══

Si la categoría es "hibrido": evalúa PRINCIPALMENTE la fase humana (ignora la calidad del bot).
Si es "bot" puro (incluye menú/IVR): TODAS las dimensiones van en 1-2, sin excepción.
Acuse de recibo o cortesía vacía sin abordar el tema ("gracias", "ok", "entendido",
"gracias por su mensaje", emoji solo, 1-4 palabras sin sustancia) — sea humano o bot —
TODAS las dimensiones en 1-2. El tono amable no compensa la falta de contenido real.

svc_prof   (Profesionalismo) — 1-2: errores graves o tono cortante/inapropiado · 4-5: impecable, tono cálido y consistente
svc_comp   (Completitud) — 1-2: ignora la pregunta o da algo genérico que no aplica · 4-5: responde punto por punto, sin dejar nada sin cubrir
svc_empa   (Empatía) — 1-2: trato robótico, no usa nombre ni contexto · 4-5: usa el nombre, reconoce la situación específica del prospecto
svc_solu   (Solución) — 1-2: nada concreto, solo "te contactaremos" · 4-5: precio/producto/cita específicos, no genéricos
svc_next   (Siguiente paso) — 1-2: termina sin ningún CTA · 4-5: CTA explícito y accionable de inmediato
svc_proact (Proactividad) — 1-2: solo reacciona, cero iniciativa · 4-5: anticipa, califica, ofrece más de lo pedido

CALIBRACIÓN: no asumas 3 por default. Un 3 exige evidencia mixta real (ni claramente bien ni mal) —
si dudas entre 2 y 3, o entre 3 y 4, elige el extremo que tenga evidencia concreta en el texto.

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
{{"category":"humano|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"bot_quality":null,"notes":"diagnóstico","conversation_analysis":true}}\
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
    """dt is the naive server-clock timestamp stored as created_at/received_at
    (server runs on UTC) — must convert to Mexico local time before comparing hours."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mx = dt.astimezone(_MEXICO_TZ)
    return mx.weekday() < 5 and 9 <= mx.hour < 18


def _build_prompt(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> str:
    reaction_hint = ""
    if reaction_time_min is not None:
        secs = reaction_time_min * 60
        if secs < 10:
            reaction_hint = (
                f"\n🚨 SEÑAL CRÍTICA DE TIEMPO: respuesta en {secs:.0f} segundos — CERTEZA de bot. "
                "Un humano no puede leer y responder en menos de 10 segundos."
            )
        elif secs < 30:
            reaction_hint = (
                f"\n⚠️ SEÑAL FUERTE DE TIEMPO: respuesta en {secs:.0f} segundos — casi con certeza bot. "
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


_VALID_CATEGORIES = {"humano", "hibrido", "bot"}


def _parse_llm_response(raw: str) -> dict:
    if raw.startswith("```"):
        raw = raw.split("```")[1].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    result = json.loads(raw)
    category = result.get("category", "humano")
    if category in ("automatico", "menu"):  # el prompt ya no las ofrece, pero por si el LLM alucina
        category = "bot"
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

    svc_scores = {
        "svc_prof":   _svc("svc_prof"),
        "svc_comp":   _svc("svc_comp"),
        "svc_empa":   _svc("svc_empa"),
        "svc_solu":   _svc("svc_solu"),
        "svc_next":   _svc("svc_next"),
        "svc_proact": _svc("svc_proact"),
    }
    return {
        "category": category,
        "is_ai": is_ai,
        "ai_confidence": round(float(result.get("ai_confidence", 0.0)), 2) if is_ai else 0.0,
        **svc_scores,
        "response_quality": _response_quality_from_svc(svc_scores),
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
# menu (category="bot", is_ai=False, bot_quality=None per the prompt rules above) and
# an explicit auto-reply template arriving near-instantly. Everything else
# (human vs bot vs conversational-AI vs hibrido) needs real judgment and still goes to
# the LLM — this is not an attempt to replace that, only to skip it when it's redundant.

_MENU_MARKERS = re.compile(
    r'\[Opciones:|\[Lista:|responde con el n[uú]mero|elige una opci[oó]n|'
    r'escribe (?:el )?(?:1|2|3|un n[uú]mero)|selecciona (?:una|la) opci[oó]n',
    re.IGNORECASE,
)
# El separador tras el número también viene como guión ("1 - Autos nuevos"), no solo
# punto/paréntesis ("1. Autos nuevos") — caso real (Nissan Vallejo) que se colaba
# como "humano" porque ningún ítem de la lista hacía match.
_MENU_LIST_ITEM = re.compile(
    r'(?:^|\n)\s*(?:[0-9]{1,2}[.\)-]|[*_]?[A-H][*_]?\s*[.\)-])\s+\S',
    re.MULTILINE,
)

_AUTO_REPLY_MARKERS = re.compile(
    r'folio|tkt-|ticket\s*#|ref(?:erencia)?\s*[:#]|tu mensaje es importante|'
    r'en breve (?:un asesor|te contactar)|hemos recibido tu (?:consulta|mensaje)|'
    r'nos comunicaremos a la brevedad|mensaje generado autom[aá]ticamente|'
    r'estimado cliente|apreciable cliente|horario de atenci[oó]n|'
    # "¿Sigues ahí?" / "Aquí sigo…" (nudge de continuidad de sesión) y mensajes de
    # cola/espera ("está en la cola", "buscando un agente disponible") — encontrados
    # repetidos en producción en varias empresas distintas (HSBC "Leo", KLM, Nissan
    # Vallejo) SIEMPRE clasificados "humano" pese a ser lenguaje típico de bot/IVR
    # que gestiona la sesión o la espera — ninguna otra regla los cubría.
    r'sigues ah[ií]|aqu[ií] sigo|est[aá] en la cola|buscando (?:un|una) agente|'
    r'espera un momento por favor|volver cuando quieras|'
    # Mensaje de "saludo automático" de WhatsApp Business — patrón real muy común
    # ("Bienvenido/a a [negocio]... gracias por contactarnos/escribirnos... te
    # responderemos/atenderemos en breve/pronto") que el regex anterior no cubría
    # y se colaba como "humano" (encontrado en producción: ~15 variantes reales
    # para una sola empresa, todas con reacción casi instantánea).
    r'bienvenid[oa]s?\s+a\b|gracias por (?:contactarnos|escribirnos|comunicarte|comunicarse)|'
    r'te (?:responderemos|atenderemos|contestaremos)\b',
    re.IGNORECASE,
)

# Autoidentificación como bot/IA — señal fuerte y barata (sin LLM) de que la
# respuesta la mandó un sistema, sin importar qué tan rápido llegó. El patrón
# "soy...virtual" (sin exigir la palabra exacta "asistente") cubre variantes
# reales encontradas en producción como "Soy Bell, el reclutador virtual de
# Smart Fit" — la redacción literal "asistente virtual" no las detectaba.
_BOT_SELFID_MARKERS = re.compile(
    r'asistente virtual|soy (?:un|una)?\s*bot\b|chatbot|soy\s+\w+[,.]?\s*tu\s+asistente|'
    r'\bsoy\b[^.!?\n]{0,45}\bvirtual\b|'
    r'inteligencia artificial|🤖|envía\s*["\']?hola["\']?\s*para\s+(?:comenzar|empezar)|'
    r'la sesi[oó]n ha finalizado|session (?:has )?ended',
    re.IGNORECASE,
)

# Anuncio de handoff bot→humano — el propio sistema documenta este patrón como
# "hibrido" (ver _PROMPT_TEMPLATE), pero el mensaje suele MENCIONAR literalmente
# "asistente virtual" al referirse a lo que está reemplazando ("reemplazaré a
# nuestro asistente virtual"), lo que sin este chequeo activaba por error
# _looks_like_bot_selfid — un caso real de producción (KLM) mostró exactamente
# este texto. No hay atajo determinista a "hibrido" (solo el LLM decide esa
# categoría) — lo único que hace este chequeo es evitar clasificar como "bot"
# con falsa certeza algo que en realidad anuncia lo contrario.
_HANDOFF_MARKERS = re.compile(
    r'reemplazar[eé] a (?:nuestro|nuestra)|se est[aá] comunicando con (?:un|una) agente|'
    r'te atender[aá] (?:un|una) (?:asesor|agente|persona)|lo atender[aá] (?:un|una) (?:asesor|agente)|'
    r'la atender[aá] (?:un|una) (?:asesor|agente)|un agente (?:humano|real)',
    re.IGNORECASE,
)


def _looks_like_handoff_announcement(text: str) -> bool:
    return bool(_HANDOFF_MARKERS.search(text or ""))

# Saludos cortos e informales tal como los escribe una persona real desde el
# celular — sin mayúscula inicial, sin acentos, alguna falta de ortografía.
# Sirve para NO dejar que "hola"/"buenas tardes" caiga siempre en "automatico"
# solo por haber llegado rápido, cuando el estilo de escritura ya delata humano.
_CASUAL_HUMAN_GREETING = re.compile(
    r'^\s*(hola|buenas?(?:\s+(?:dias?|tardes?|noches?))?|q\s*tal|que\s+tal|hey|oye|'
    r'gracias|ok(?:ay)?|va(?:le)?|si\b|s[ií]\b|no\b|claro|perfecto|entendido)\b',
    re.IGNORECASE,
)


def _looks_like_bot_selfid(text: str) -> bool:
    if _looks_like_handoff_announcement(text):
        return False
    return bool(_BOT_SELFID_MARKERS.search(text or ""))


def _looks_human_casual(text: str) -> bool:
    """Heurística barata: mensaje corto, informal, con pinta de escrito rápido
    desde el celular (sin mayúscula inicial, sin firma corporativa, sin señales
    de bot) — no PRUEBA que sea humano, pero es la mejor señal barata que
    tenemos para no etiquetar como "automatico" algo que en realidad se ve
    como un saludo humano normal.
    Tope de 20 caracteres (no 60): frases de plantilla tipo "gracias por
    contactarnos, un asesor te escribirá pronto" o "en breve te atendemos"
    también empiezan en minúscula o con una palabra "casual" ("gracias", "ok"),
    pero son mucho más largas que un saludo real tecleado rápido desde el
    celular ("hola", "buenas tardes!", "digame") — probado con ambos grupos
    de ejemplos reales antes de fijar este número."""
    t = (text or "").strip()
    if not t or len(t) > 20:
        return False
    if _looks_like_menu(t) or _looks_like_auto_reply(t) or _looks_like_bot_selfid(t):
        return False
    starts_lowercase = t[0].islower()
    is_casual_greeting = bool(_CASUAL_HUMAN_GREETING.match(t))
    return starts_lowercase or is_casual_greeting


def _looks_like_menu(text: str) -> bool:
    if _MENU_MARKERS.search(text):
        return True
    return len(_MENU_LIST_ITEM.findall(text)) >= 2


def _looks_like_auto_reply(text: str) -> bool:
    return bool(_AUTO_REPLY_MARKERS.search(text))


# El webhook (routes.py: _extract_body_and_interactive) guarda estos marcadores
# literales cuando la respuesta es un audio/sticker/ubicación/contacto/plantilla sin
# texto — nunca son el contenido real que escribió el prospecto. Sin este chequeo, se
# le mandaba "[audio]" tal cual al regex de menú o al LLM como si fuera texto real.
NON_TEXT_PLACEHOLDERS = {"[audio]", "[sticker]", "[location]", "[contact]", "[media]", "[template]"}


def _has_real_text(body: str | None) -> bool:
    return bool(body) and body.strip() not in NON_TEXT_PLACEHOLDERS


def _response_quality_from_svc(svc_scores: dict) -> int | None:
    """response_quality debe reflejar las 6 sub-dimensiones (svc_prof/comp/empa/solu/
    next/proact), no ser un número aparte que el LLM inventa por su cuenta — antes se
    pedía como campo independiente en el mismo JSON, sin ninguna garantía de que
    coincidiera con el detalle de las 6 dimensiones (podía decir svc_comp=4 y
    response_quality=1 sin que nada lo detectara). Se calcula como el promedio
    redondeado de las dimensiones evaluadas; si ninguna tiene valor, queda en None
    (sin base para calificar) — igual criterio que ya usa _quick_result_unrated."""
    values = [v for v in svc_scores.values() if v is not None]
    if not values:
        return None
    return max(1, min(5, round(sum(values) / len(values))))


def _quick_result(category: str, notes: str) -> dict:
    """Same shape as _parse_llm_response's output — low/None across the board,
    matching the prompt's own rule: menu/bot(non-AI) always score 1-2."""
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
        return _quick_result("bot", "Menú de opciones detectado por reglas — sin IA")

    responded_instantly = reaction_time_min is not None and reaction_time_min * 60 < 10
    if responded_instantly and _looks_like_auto_reply(text):
        return _quick_result("bot", "Plantilla de auto-respuesta + respuesta instantánea — sin IA")
    if responded_instantly:
        return _quick_result("bot", f"Respuesta en {reaction_time_min * 60:.0f}s — imposible para humano; bot o sistema automático")

    return None


def classify_response(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> dict:
    """Classify a single inbound reply using the outbound message as context.
    Cheap rules resolve the obvious cases first (see _quick_classify) — only
    genuine ambiguity spends an LLM call."""
    if not _has_real_text(inbound_body):
        # Audio/sticker/ubicación/contacto sin texto — no hay contenido que juzgar.
        # No es "humano" con certeza, pero sin base para nada más determinista aquí
        # (este es ya el fallback sin dato de tiempo) — no se manda al LLM un
        # marcador literal como si fuera lo que escribió el prospecto.
        return _quick_result_unrated("humano", "Respuesta multimedia sin texto — sin base para juzgar contenido")

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
        if not body:
            continue
        if body in NON_TEXT_PLACEHOLDERS:
            # classify_response() ya evita mandarle al LLM un marcador literal
            # como "[audio]" como si fuera texto real (ver _has_real_text) —
            # classify_conversation() no tenía la misma protección: el LLM
            # recibía "[Prospecto]: [audio]" tal cual y alucinaba un juicio
            # sobre "el tono" o "la claridad" de un mensaje sin contenido real
            # (visto en producción: "[audio]" evaluado como "informal").
            lines.append(f"[{role}]: (mensaje sin texto — audio/sticker/ubicación/contacto)")
            continue
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


# ── Flujo determinista T1/T2 ────────────────────────────────────────────────
# La decisión de origen (humano/bot/agente IA/automatico) se basa en tiempos de
# respuesta, NO en que el LLM lea el contenido. El LLM solo entra como fallback si
# no hay dato de tiempo, y en classify_conversation (detección de "hibrido" tras
# cierre de sesión de Andy) — eso no cambia.
#
# Los umbrales son configurables desde Settings > Clasificación (admin) — se leen en
# caliente de Mongo en cada punto donde se usan, sin caché, para que un cambio en la
# UI aplique al siguiente mensaje sin redeploy. Los defaults viven en database.py
# (CLASSIFIER_DEFAULTS) junto con la lectura/escritura real.
def _get_thresholds(db):
    s = db.get_classifier_settings()
    return (
        s["t1_threshold_seconds"], s["t2_threshold_seconds"],
        s["probe_wait_hours"], s["no_reply_wait_minutes"],
    )


def _quick_result_unrated(category: str, notes: str) -> dict:
    """Como _quick_result pero SIN forzar calidad de servicio a 1. Se usa cuando la
    categoría se decide 100% por tiempo, sin leer contenido — no hay base para
    calificar profesionalismo/empatía/solución/etc., así que quedan sin evaluar
    (None) en vez de mentir con un puntaje inventado."""
    return {
        "category": category,
        "is_ai": False,
        "ai_confidence": 0.0,
        "svc_prof": None, "svc_comp": None, "svc_empa": None,
        "svc_solu": None, "svc_next": None, "svc_proact": None,
        "response_quality": None,
        "bot_quality": None,
        "notes": notes,
        "conversation_analysis": False,
        "quick_classified": True,
    }


_QUALITY_ONLY_PROMPT_TEMPLATE = """\
Eres un auditor experto en calidad de atención comercial vía WhatsApp en Latinoamérica.
Ya se determinó que esta respuesta la escribió una PERSONA REAL (no bot, no automático) —
tu ÚNICA tarea es calificar la CALIDAD del servicio entregado. NO opines sobre el origen.

MENSAJE ENVIADO: {outbound_body}
RESPUESTA DEL PROSPECTO: {inbound_body}

══ CALIDAD DE SERVICIO (escala 1-5) ══
Acuse de recibo o cortesía vacía sin abordar el tema ("gracias", "ok", "entendido",
"gracias por su mensaje", emoji solo, 1-4 palabras sin sustancia) — aunque sea de una
persona real y el tono sea amable — TODAS las dimensiones en 1-2. El tono no compensa
la falta de contenido real; aquí se califica QUÉ tan útil fue la respuesta, no si la
persona fue agradable.

svc_prof   (Profesionalismo) — 1-2: errores graves o tono cortante/inapropiado · 4-5: impecable, tono cálido y consistente
svc_comp   (Completitud) — 1-2: ignora la pregunta o da algo genérico que no aplica · 4-5: responde punto por punto, sin dejar nada sin cubrir
svc_empa   (Empatía) — 1-2: trato robótico, no usa nombre ni contexto · 4-5: usa el nombre, reconoce la situación específica del prospecto
svc_solu   (Solución) — 1-2: nada concreto, solo "te contactaremos" · 4-5: precio/producto/cita específicos, no genéricos
svc_next   (Siguiente paso) — 1-2: termina sin ningún CTA · 4-5: CTA explícito y accionable de inmediato
svc_proact (Proactividad) — 1-2: solo reacciona, cero iniciativa · 4-5: anticipa, califica, ofrece más de lo pedido

CALIBRACIÓN: no asumas 3 por default. Un 3 exige evidencia mixta real (ni claramente bien ni mal) —
si dudas entre 2 y 3, o entre 3 y 4, elige el extremo que tenga evidencia concreta en el texto.

══ SEÑAL COMERCIAL (1-5) ══
¿Qué tan "caliente" quedó el lead?
1 — Ruido: "Ok","👍","Gracias", emoji solo, acuse de 1-2 palabras.
2 — Cortesía vacía: reconoce contacto pero evita el tema.
3 — Apertura tibia: toca el tema sin compromiso.
4 — Señal real: pregunta específica del producto/servicio, da contexto o menciona necesidad/timing.
5 — Lead caliente: pide cotización/precio, propone llamada o reunión, menciona urgencia o presupuesto.

══ CONCLUSIÓN PARA EL CLIENTE (máximo 30 palabras) ══
Lenguaje simple, como si hablaras con el dueño del negocio, no un técnico.

Responde SOLO con JSON válido:
{{"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"notes":"diagnóstico"}}\
"""


def _grade_quality_only(inbound_body: str, outbound_body: str) -> dict | None:
    """Para respuestas ya clasificadas como 'humano' por tiempo (T1 > umbral): el origen
    NO se decide aquí (ya es determinista), solo se intenta calificar la calidad del
    servicio leyendo el contenido — el matiz que se pierde al no mandar estos casos al
    LLM completo. Falla silenciosamente (devuelve None) ante cualquier problema — nunca
    debe bloquear ni tumbar la clasificación determinista que ya se guardó."""
    if all_quota_exhausted():
        return None
    try:
        from app.llm import active_provider
        if active_provider() == "none":
            return None
        prompt = _QUALITY_ONLY_PROMPT_TEMPLATE.format(
            outbound_body=outbound_body or "(sin texto)",
            inbound_body=inbound_body or "(sin texto)",
        )
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=200)
        if raw.startswith("```"):
            raw = raw.split("```")[1].strip()
            if raw.startswith("json"):
                raw = raw[4:].strip()
        result = json.loads(raw)

        def _svc(key):
            v = result.get(key)
            if v is None:
                return None
            try:
                return max(1, min(5, int(round(float(v)))))
            except (TypeError, ValueError):
                return None

        svc_scores = {
            "svc_prof":   _svc("svc_prof"),
            "svc_comp":   _svc("svc_comp"),
            "svc_empa":   _svc("svc_empa"),
            "svc_solu":   _svc("svc_solu"),
            "svc_next":   _svc("svc_next"),
            "svc_proact": _svc("svc_proact"),
        }
        return {
            **svc_scores,
            "response_quality": _response_quality_from_svc(svc_scores),
            "notes": result.get("notes", "") or "",
        }
    except LLMQuotaExceeded:
        return None
    except Exception:
        log.warning("_grade_quality_only failed — se deja sin calificar", exc_info=True)
        return None


_IS_AI_CONFIRM_PROMPT = """\
Este mensaje llegó muy rápido (≤{t2}s) como respuesta a un 2do mensaje que también se
respondió muy rápido. Ya se descartó que sea un menú de opciones — el ORIGEN ya se decidió
como sistema automatizado ("bot"), NO opines sobre eso. Tu ÚNICA tarea es distinguir el TIPO:
¿suena a una IA conversacional (Agente IA), o podría ser una persona real escribiendo muy
rápido (alguien muy atento al celular, esperando el mensaje)?

TEXTO: {text}

Responde SOLO con JSON: {{"is_ai": true/false, "reason": "breve justificación"}}\
"""


def _confirm_is_ai(text: str, t2_threshold_seconds: int) -> bool:
    """T2 rápido + sin menú ya decidió category="bot" de forma determinista — esta
    llamada NO decide bot/no-bot, solo confirma el matiz is_ai (Agente IA vs. posible
    humano muy rápido) leyendo el contenido. Si no hay LLM o falla, se mantiene el
    default determinista que ya teníamos: is_ai=True (rápido+rápido+sin-menú = Agente IA)."""
    if all_quota_exhausted():
        return True
    try:
        from app.llm import active_provider
        if active_provider() == "none":
            return True
        prompt = _IS_AI_CONFIRM_PROMPT.format(t2=t2_threshold_seconds, text=text or "(sin texto)")
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=60)
        if raw.startswith("```"):
            raw = raw.split("```")[1].strip()
            if raw.startswith("json"):
                raw = raw[4:].strip()
        result = json.loads(raw)
        return bool(result.get("is_ai", True))
    except LLMQuotaExceeded:
        return True
    except Exception:
        log.warning("_confirm_is_ai failed — se asume is_ai=True (default determinista)", exc_info=True)
        return True


def _find_open_probe(db, company_id: str, before_dt: datetime):
    """Busca un probe T1→T2 abierto (mandado, aún no resuelto ni vencido) para esta compañía."""
    return db.db.message_logs.find_one({
        "company_id": company_id,
        "direction": "inbound",
        "probe.stage": "awaiting_t2",
        "probe.deadline": {"$gte": before_dt},
    })


def _resolve_probe(db, probe_doc: dict, reply_body: str | None, received_at: datetime,
                    timed_out: bool = False) -> dict:
    """Resuelve un probe abierto — con la respuesta T2 recién llegada, o por timeout
    (timed_out=True, llamado desde el sweep en background cuando pasó 1hr sin 2da
    respuesta). Determinista, sin LLM."""
    _, t2_threshold, probe_wait_hours, _ = _get_thresholds(db)
    probe = probe_doc.get("probe", {}) or {}
    t2_seconds = None
    if not timed_out:
        # El "2do mensaje" lo manda Andy (ai_followup.py), activado automáticamente por
        # el webhook — no tenemos su log_id de antemano, así que lo identificamos como
        # el primer outbound generado por IA después de que arrancó este probe.
        # Acotado también por `received_at` (upper bound): sin este límite, si el
        # prospecto manda dos respuestas rápidas ANTES de que Andy termine de generar
        # y enviar su seguimiento (llamada a LLM con latencia real), la consulta
        # igual encuentra el mensaje de Andy — pero con created_at POSTERIOR a este
        # inbound — y el resultado (received_at - sent_at) sale negativo.
        started_at = probe.get("started_at")
        if started_at:
            msg2 = db.db.message_logs.find_one(
                {
                    "company_id": probe_doc.get("company_id"),
                    "direction": "outbound",
                    "ai_generated": True,
                    # status != "failed": ai_followup.py loguea el intento aunque el envío
                    # falle (p. ej. instancia desconectada) — un mensaje que nunca llegó al
                    # prospecto no puede ser la referencia de tiempo para T2.
                    "status": {"$ne": "failed"},
                    "created_at": {"$gt": started_at, "$lt": received_at},
                },
                sort=[("created_at", 1)],
            )
            sent_at = (msg2 or {}).get("created_at")
            if sent_at and isinstance(sent_at, datetime):
                t2_seconds = (received_at - sent_at).total_seconds()

    if not timed_out and t2_seconds is not None and 0 <= t2_seconds <= t2_threshold:
        if not _has_real_text(reply_body):
            # Audio/sticker/ubicación/contacto — el ORIGEN sigue siendo determinista
            # (T2 rápido = "bot"), pero no hay texto real que mandarle al LLM para
            # confirmar is_ai, así que se deja en el default seguro (True) sin gastar
            # una llamada con un marcador literal como "[audio]" de contenido.
            analysis = _quick_result("bot", f"Respuesta multimedia sin texto en 2do mensaje (T2={t2_seconds:.0f}s) — is_ai sin confirmar")
            analysis["is_ai"] = True
        elif _looks_like_menu(reply_body or ""):
            analysis = _quick_result("bot", f"Menú detectado en 2do mensaje (T2={t2_seconds:.0f}s) — determinista, sin IA")
            analysis["is_ai"] = False
        else:
            # category="bot" ya es determinista (T2 rápido, sin menú) — is_ai se
            # confirma aparte con una llamada de IA ligera que NO puede cambiar la
            # categoría, solo el matiz Agente IA vs. humano muy rápido.
            is_ai = _confirm_is_ai(reply_body, t2_threshold)
            analysis = _quick_result(
                "bot",
                f"Respuesta rápida sin menú en 2do mensaje (T2={t2_seconds:.0f}s) — "
                f"{'Agente IA' if is_ai else 'posible humano muy rápido'} (confirmado por IA)"
            )
            analysis["is_ai"] = is_ai
    else:
        # Sin T2 confirmado (bot o no) — antes esto SIEMPRE caía en "automatico"
        # sin mirar el contenido del primer mensaje. Si ese texto ya se ve como
        # un saludo humano informal ("hola", "buenas tardes", sin mayúscula
        # inicial) y no tiene ninguna señal de bot, es mejor etiquetarlo
        # "humano" que un genérico "automatico" que no calza con lo que se ve
        # en el chat.
        original_text = probe_doc.get("message_body") or ""
        reply_text = reply_body or ""
        if timed_out:
            base_notes = f"Sin 2da respuesta tras {probe_wait_hours}h"
        elif t2_seconds is None:
            # Andy (el 2do mensaje) aún no se había enviado cuando llegó esta
            # respuesta — no hay con qué medir T2. Antes esto caía al f-string de
            # abajo con t2_seconds=None y tronaba con TypeError (silenciado por el
            # try/except de classify_and_save, dejando el mensaje sin clasificar).
            base_notes = "2do mensaje (seguimiento automático) aún no enviado cuando llegó esta respuesta"
        else:
            base_notes = f"2do mensaje respondido en {t2_seconds:.0f}s (> {t2_threshold}s)"

        # El prospecto puede mandar más de un mensaje antes de que salga nuestro
        # 2do mensaje (Andy) — en ese caso reply_text es la respuesta MÁS RECIENTE,
        # con más información que original_text (la primera). Si esa última muestra
        # una señal fuerte de bot (menú, auto-respuesta, se autoidentifica), pesa más
        # que el estilo casual del primer mensaje — antes se ignoraba por completo.
        reply_has_bot_signal = bool(reply_text) and reply_text != original_text and (
            _looks_like_menu(reply_text) or _looks_like_bot_selfid(reply_text) or _looks_like_auto_reply(reply_text)
        )
        if reply_has_bot_signal:
            analysis = _quick_result(
                "bot", f"{base_notes} — el mensaje más reciente muestra señal de bot ('{reply_text[:30]}') — determinista"
            )
        elif _looks_human_casual(original_text) or (reply_text and reply_text != original_text and _looks_human_casual(reply_text)):
            sample = original_text if _looks_human_casual(original_text) else reply_text
            analysis = _quick_result_unrated(
                "humano", f"{base_notes} — sin señal de bot, estilo humano informal ('{sample[:30]}')"
            )
        else:
            analysis = _quick_result("automatico", f"{base_notes} — determinista")

    # reaction_time_min reportado = T1 (velocidad de la PRIMERA respuesta), no T2 —
    # es la métrica que ya existía y que usa el resto del sistema.
    analysis["reaction_time_min"] = probe.get("t1_reaction_min")
    analysis["reaction_time_seconds"] = probe.get("t1_reaction_seconds")
    analysis["business_hours"] = is_business_hours(received_at)
    analysis["classified_at"] = datetime.now().isoformat()
    analysis["pending_human_check"] = analysis.get("category") == "bot"
    if analysis["pending_human_check"]:
        analysis["followup_deadline"] = received_at + timedelta(minutes=5)
    return analysis


def classify_or_copy_recent(db, background_tasks, log_id: str, company_id: str,
                             inbound_body: str, received_at: datetime, throttle_minutes: int = 10):
    """Throttle-aware entry point used by the inbound webhooks (Evolution/WAHA/wwebjs,
    Wasender): if this company already has a classification within `throttle_minutes`,
    copy it onto this message instead of skipping it outright. Skipping used to leave
    the message with no `analysis_status` at all — permanently unclassified for any
    consumer that looks at individual messages, only ever recovered if someone happened
    to open Analytics and trigger requeue-unanalyzed (client-driven, not automatic).
    Copying forward keeps the original "don't re-run the LLM on every message in a fast
    back-and-forth" intent without leaving a silent gap."""
    from datetime import timedelta
    throttle_cutoff = datetime.now() - timedelta(minutes=throttle_minutes)
    recent = db.db.message_logs.find_one(
        {"company_id": company_id, "direction": "inbound",
         "analysis_status": "done", "updated_at": {"$gte": throttle_cutoff}},
        sort=[("updated_at", -1)],
    )
    if recent and recent.get("analysis"):
        copied = dict(recent["analysis"])
        copied["notes"] = (copied.get("notes") or "") + f" — copiado del análisis reciente de esta empresa (throttle {throttle_minutes} min)"
        copied["copied_from_throttle"] = True
        db.save_message_analysis(log_id, copied)
    else:
        background_tasks.add_task(classify_and_save, log_id, company_id, inbound_body, received_at)


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

        t1_threshold, _, probe_wait_hours, _ = _get_thresholds(db)

        # ── ¿Esta respuesta resuelve un probe T1→T2 abierto? ──────────────────
        open_probe = _find_open_probe(db, company_id, received_at)
        if open_probe:
            analysis = _resolve_probe(db, open_probe, inbound_body, received_at)
            db.save_message_analysis(str(open_probe["_id"]), analysis)
            if str(open_probe["_id"]) != log_id:
                db.save_message_analysis(log_id, analysis)
            db.db.message_logs.update_one(
                {"_id": open_probe["_id"]}, {"$set": {"probe.stage": "resolved"}}
            )
            return

        # Check if this message resolves a pending human-followup for the same company
        pending = db.db.message_logs.find_one({
            "company_id": company_id,
            "direction": "inbound",
            "analysis.pending_human_check": True,
            "analysis.followup_deadline": {"$gte": received_at},
        })
        if pending:
            # A human took over within the follow-up window. The prior message's
            # analysis (category + reaction_time_min) reflected its OWN instant
            # bot response and must stay intact — this new message gets
            # classified on its own below via the normal flow. We only clear the
            # pending flag on the prior entry and flag the handoff so it can surface
            # as "hibrido" behavior without overwriting the original, correct timing.
            db.db.message_logs.update_one(
                {"_id": pending["_id"]},
                {"$set": {
                    "analysis.pending_human_check": False,
                    "analysis.handoff_to_human_at": received_at.isoformat(),
                }},
            )

        inbound_doc = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"from_number": 1, "number": 1})
        from_number = (inbound_doc or {}).get("from_number") or (inbound_doc or {}).get("number")

        last_outbound = db.get_last_outbound_for_company(company_id, before_dt=received_at, to_number=from_number)
        if not last_outbound:
            last_outbound = db.get_last_outbound_for_company(company_id, before_dt=received_at)

        outbound_body = ""
        reaction_time_min = None
        raw_seconds = None  # segundos exactos, sin redondear — el umbral de T1 (10s)
        # necesita esto: reaction_time_min está redondeado a 0.1 min (6s) para mostrar
        # en UI, y ese redondeo por sí solo puede mover una respuesta de 9.6s a "12s"
        # y hacerla cruzar el umbral incorrectamente.
        if last_outbound:
            outbound_body = last_outbound.get("message_body") or last_outbound.get("message_text") or ""
            last_sent_at = last_outbound.get("created_at")
            if last_sent_at and isinstance(last_sent_at, datetime):
                delta = received_at - last_sent_at
                raw_seconds = delta.total_seconds()
                minutes = round(raw_seconds / 60, 1)
                # Sanity bound: get_last_outbound_for_company() falls back to "last
                # outbound to this company from ANY number" when the to_number match
                # fails — for a company with more than one WhatsApp number this can
                # pair the reply with an unrelated outbound and produce a technically
                # positive but meaningless delta. > 120 min already sits outside the
                # window ai_followup treats as "still relevant", and is the same cutoff
                # a past manual data-repair pass (fix_reaction.py) used to null out bad
                # historical values — keep that invariant live instead of only cleaning
                # it up after the fact.
                if minutes < 0 or minutes > 120:
                    reaction_time_min = None
                    raw_seconds = None
                else:
                    reaction_time_min = minutes

        business_hours = is_business_hours(received_at)

        # ── T1 determinista — sin dato de tiempo, único caso que cae al LLM ───
        if raw_seconds is None:
            analysis = classify_response(inbound_body, outbound_body, reaction_time_min)
        elif raw_seconds <= t1_threshold and _looks_like_menu(inbound_body):
            # Menú numerado/con letra en el PRIMER mensaje — señal determinista
            # e instantánea, no tiene caso esperar 1h de probe para confirmarlo.
            analysis = _quick_result("bot", "Menú de opciones detectado en el primer mensaje — determinista")
        elif raw_seconds <= t1_threshold and _looks_like_bot_selfid(inbound_body):
            # El propio texto se autoidentifica como bot/IA ("soy tu asistente
            # virtual", 🤖, etc.) — señal más fuerte y barata que esperar 1h a ver
            # si llega un T2. No tiene caso meterlo al probe: ya sabemos qué es.
            analysis = _quick_result("bot", "Se autoidentifica como bot/asistente virtual en el propio mensaje — determinista")
        elif raw_seconds <= t1_threshold and _looks_like_auto_reply(inbound_body):
            # Plantilla reconocible (folio, "tu mensaje es importante", horario de
            # atención, etc.) llegando casi al instante — mismo trato: determinista,
            # sin esperar al probe.
            analysis = _quick_result("bot", "Plantilla de auto-respuesta detectada en el primer mensaje — determinista")
        elif raw_seconds <= t1_threshold:
            # Respuesta rápida — podría ser bot/agente IA/automatico. NO mandamos
            # nosotros un 2do mensaje aquí: el webhook (routes.py) ya activa a Andy
            # automáticamente en la primera respuesta de cualquier prospecto (salvo que
            # el usuario lo haya desactivado) — solo marcamos el probe y esperamos a
            # ver si Andy contesta de forma natural. Si no contesta (fuera de horario,
            # detectó acuse automático, IA desactivada) el probe expira solo en 1h
            # (ver _sweep_pending) y cae a "automatico" — o a "humano" si el texto de
            # este primer mensaje ya se ve como un saludo humano informal (ver
            # _looks_human_casual en _resolve_probe).
            db.db.message_logs.update_one(
                {"_id": ObjectId(log_id)},
                {"$set": {
                    "analysis_status": "awaiting_t2",
                    "probe": {
                        "stage": "awaiting_t2",
                        "started_at": received_at,
                        "deadline": received_at + timedelta(hours=probe_wait_hours),
                        "t1_reaction_min": reaction_time_min,
                        "t1_reaction_seconds": round(raw_seconds, 1),
                    },
                }},
            )
            return
        elif _looks_like_menu(inbound_body) or _looks_like_bot_selfid(inbound_body) or _looks_like_auto_reply(inbound_body):
            # T1 > umbral pero el CONTENIDO igual muestra una señal fuerte de bot
            # (menú, autoidentificación, plantilla) — la regla "lento = humano sin
            # excepción" de abajo asumía que ningún bot tarda más de t1_threshold en
            # responder, pero varios casos reales de producción sí lo hacen (IVR de
            # varios pasos, delays de "escribiendo…", menús que llegan en un segundo
            # mensaje separado) y se colaban como "humano" pese a ser obviamente bot.
            analysis = _quick_result(
                "bot", f"Señal de bot en el contenido pese a T1={raw_seconds:.0f}s > {t1_threshold}s — determinista"
            )
        else:
            # T1 > umbral y sin señal de bot en el contenido — el ORIGEN es
            # determinista: "humano", sin IA. La CALIDAD sí se intenta calificar
            # aparte (llamada de IA separada, no decide categoría) — si falla o no
            # hay LLM disponible, queda sin calificar.
            analysis = _quick_result_unrated(
                "humano", f"T1={raw_seconds:.0f}s > {t1_threshold}s — origen determinista, sin IA"
            )
            quality = _grade_quality_only(inbound_body, outbound_body)
            if quality:
                analysis.update(quality)

        analysis["reaction_time_min"] = reaction_time_min
        # Segundos exactos, sin redondear a bloques de 6s (0.1 min) — para mostrar
        # el tiempo real en el reporte en vez de la versión redondeada.
        analysis["reaction_time_seconds"] = round(raw_seconds, 1) if raw_seconds is not None else None
        analysis["business_hours"] = business_hours
        analysis["classified_at"] = datetime.now().isoformat()

        if analysis.get("category") == "bot":
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

        # classify_conversation() nunca corre los chequeos deterministas (menú,
        # autoidentificación, plantilla) — depende 100% del juicio del LLM sobre
        # el hilo completo. Caso real de producción (Laboratorio del Chopo): una
        # sesión 100% automatizada (saludo bot → menú → "¿sigues ahí?" → menú de
        # nuevo) terminó con el último mensaje — un menú numerado literal —
        # etiquetado "humano" porque el LLM juzgó mal el hilo completo. Si el
        # mensaje al que se le va a adjuntar este veredicto muestra por sí solo
        # una señal determinista fuerte de bot, esa señal pesa más que un
        # "humano" del LLM — determinista y barato de verificar, sin riesgo de
        # pisar un "hibrido" legítimo (solo se corrige cuando el LLM dijo humano).
        if analysis.get("category") == "humano":
            try:
                last_msg = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"message_body": 1})
                last_body = (last_msg or {}).get("message_body") or ""
                if _looks_like_menu(last_body) or _looks_like_bot_selfid(last_body) or _looks_like_auto_reply(last_body):
                    analysis["category"] = "bot"
                    analysis["is_ai"] = False
                    analysis["notes"] = (
                        (analysis.get("notes") or "").strip()
                        + " — corregido: el último mensaje muestra una señal determinista de bot "
                          "(menú/plantilla/autoidentificación) que contradice el veredicto de la IA."
                    ).strip(" —")
            except Exception:
                pass

        analysis["classified_at"] = datetime.now().isoformat()
        analysis["pending_human_check"] = False
        db.save_message_analysis(log_id, analysis)
        log.info("classify_conversation_and_save: saved for company=%s log=%s", company_id, log_id)
    except LLMQuotaExceeded:
        log.warning("classify_conversation_and_save: LLM sin cuota para company=%s", company_id)
    except Exception as _exc:
        import traceback
        log.error("classify_conversation_and_save failed for %s: %s\n%s", company_id, _exc, traceback.format_exc())


_SWEEP_INTERVAL_SEC = 300


def _sweep_pending():
    try:
        db = MongoDBManager()
        # Naive-pero-UTC — se compara contra probe.deadline/created_at (guardados en
        # UTC real) y se pasa a is_business_hours() más abajo, que asume UTC cuando
        # no hay tzinfo. datetime.now() (hora local del servidor) desfasaba esto
        # exactamente igual que el bug ya arreglado en el webhook — los probes
        # tardaban horas de más (o de menos) en expirar según la hora local del
        # servidor vs. UTC real.
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        _, _, _, no_reply_wait_minutes = _get_thresholds(db)

        db.db.message_logs.update_many(
            {
                "direction": "inbound",
                "analysis.pending_human_check": True,
                "analysis.followup_deadline": {"$lt": now},
            },
            {"$set": {"analysis.pending_human_check": False}},
        )

        # ── Probes T1→T2 vencidos: no respondió el 2do mensaje en PROBE_WAIT_HOURS ──
        expired_probes = list(db.db.message_logs.find(
            {
                "direction": "inbound",
                "probe.stage": "awaiting_t2",
                "probe.deadline": {"$lt": now},
            },
            {"_id": 1},
        ))
        for probe_doc in expired_probes:
            log_id = str(probe_doc["_id"])
            full_doc = db.db.message_logs.find_one({"_id": probe_doc["_id"]})
            analysis = _resolve_probe(db, full_doc, None, now, timed_out=True)
            db.save_message_analysis(log_id, analysis)
            db.db.message_logs.update_one(
                {"_id": probe_doc["_id"]}, {"$set": {"probe.stage": "resolved"}}
            )

        cutoff = now - timedelta(minutes=no_reply_wait_minutes)
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
                    "notes":            f"Sin respuesta tras {no_reply_wait_minutes} min",
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
