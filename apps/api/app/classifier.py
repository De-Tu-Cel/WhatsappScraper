# classifier.py
"""LLM-based classifier for inbound WhatsApp responses."""
import json
import logging
import re
import unicodedata
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
    · Se presenta con NOMBRE COMPLETO de persona real (nombre + apellido o nombre + cargo): "le saluda Clarissa Flores",
      "soy Juan Martínez, asesor de ventas" — aunque el saludo parezca plantilla, el nombre personal identifica humano
    · Usa el NOMBRE DEL PROSPECTO tomado del propio mensaje ("Hola Andrés", "entiendo [nombre]") — señal fuerte de lectura real
    · Redirige al área correcta con explicación natural y contextual ("te comunicas al área de ventas, te paso servicio")
    · Menciona detalles propios de su empresa/situación ("nosotros manejamos...", "mi jefa...", "ahorita en reunión")
    · Hace una pregunta espontánea propia sobre el tema
    · Primera persona auténtica con opinión o contexto personal
    · Responde fuera de horario laboral con comentario personal ("disculpa la tardanza, estaba en campo")
  Señales DÉBILES (solo apoyo, no determinantes):
    · Errores tipográficos (un humano formal puede escribir perfecto)
    · Respuesta muy corta (humano ocupado también responde con 1-2 palabras)
    · Lenguaje coloquial (un bot también puede usarlo)
  CLAVE: lo que importa es que RESPONDE AL TEMA, no que tenga errores ortográficos.
  ⚠️ NOTA INDUSTRIA: "asesor/a digital BDC", "ejecutivo/a de ventas digital", "agente BDC" son TÍTULOS DE PERSONA REAL
  muy comunes en agencias automotrices de México. "Digital" = canal (WhatsApp), NO = inteligencia artificial.
  Clasificar como "humano" o "hibrido" salvo señales fuertes de bot en el CONTENIDO de la respuesta.

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
    · BIENVENIDA GENÉRICA que ignora el contenido recibido: "Agradecemos su preferencia y le damos
      la más cordial bienvenida", "Bienvenido a [empresa], estamos para servirle" — texto corporativo
      estándar sin referenciar en NADA lo que dijo el prospecto → bot de autorespuesta CERTEZA
    · Respuesta idéntica sin importar el mensaje recibido (ignora completamente el tema)
    · RESPUESTA COMPLETAMENTE FUERA DE TEMA: hiciste una pregunta específica (horario, precio, servicio)
      y respondieron con algo TOTALMENTE diferente sin reconocer la pregunta — por ejemplo, preguntaste
      "¿a qué hora abren?" y respondieron solo con una dirección física o datos de contacto sin mencionar
      el horario → bot que disparó su plantilla de contacto ignorando la pregunta específica
    · SILENCIO total tras el mensaje automático: respondió con plantilla y luego no volvió a responder
      a preguntas concretas del prospecto → solo había bot, sin humano disponible detrás
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
  ⚠️ ACLARACIÓN: vCard compartida (tarjeta de contacto) NO es señal de bot por sí sola.
  Si antes del vCard hubo una respuesta contextual que entendió el tema → puede ser "humano" o "hibrido".
  Solo es señal de bot si el vCard es la ÚNICA respuesta sin ningún texto contextual previo.
  is_ai=false (plantilla fija, menú/IVR, o bot de flujo/reglas):
    · Presenta un menú de opciones numeradas o con letra y ESPERA que el usuario seleccione una
      (1. Ventas 2. Soporte, 1️⃣/2️⃣, "Responde con el número", "Elige una opción")
    · Respuesta idéntica sin importar el mensaje recibido, o ignora preguntas fuera de su flujo
    · AUTORESPUESTA DE BIENVENIDA + SILENCIO: envía un único mensaje genérico de bienvenida
      y luego NO responde a las preguntas concretas del prospecto → bot básico, is_ai=false SIEMPRE
      (una IA conversacional intentaría responder, aunque fuera mal — el silencio descarta IA)
    · Respuestas excesivamente largas con bullets y estructura para mensajes simples
    · Tono corporativo perfecto sin personalidad real
    · Si respondes algo inesperado, hace loop de vuelta al mismo punto (o no responde nada más)
  is_ai=true (IA conversacional avanzada):
    · Entiende y responde al contenido ESPECÍFICO del mensaje (no flujo rígido)
    · Reformula o parafrasea lo que dijo el interlocutor
    · Responde con naturalidad, sin bullets ni estructura excesiva
    · Español perfecto, extremadamente servicial, nunca impaciente, siempre positivo
    · Puede admitir que no sabe algo de forma natural
    · Usa el nombre del usuario si lo conoce
    · DIFERENCIA de humano: demasiado perfecto y consistente, sin personalidad única,
      sin opiniones propias, sin referencia a situaciones personales reales
    · REQUISITO MÍNIMO de is_ai=true: debe haber respondido AL MENOS UNA vez a algo específico
      del prospecto. Si solo envió bienvenida genérica y silenció → is_ai=false sin excepción.
    · PREGUNTA DE CIERRE BIFURCADA: termina con una pregunta que ofrece exactamente dos opciones
      alternativas como "¿Te gustaría conocer los precios o tienes alguna otra consulta?",
      "¿Deseas agendar una cita o prefieres más información?" — patrón muy típico de LLM entrenado
      para mantener la conversación activa; un humano normalmente pregunta una sola cosa o cierra
      con algo más coloquial ("¿te interesa?", "avísame si necesitas algo más")
    · DATOS TÉCNICOS EXACTOS SIN HESITACIÓN: recita especificaciones técnicas precisas (capacidad,
      modelo, número de pieza, tecnología) sin ninguna pausa, "déjame verificar", "creo que" o
      "ahorita te confirmo" — un vendedor humano rara vez tiene todos los specs de memoria

REGLA DE ORO: ante la duda → "humano". EXCEPCIÓN: si hay señales FUERTES de bot (bilingüe,
gestión de sesión, se autoidentifica como bot, menú numerado) → "bot" aunque también parezca natural.

⛔ REGLA ABSOLUTA — SUPERA LA REGLA DE ORO:
Si el mensaje cumple LAS DOS condiciones siguientes → SIEMPRE "bot" is_ai=true, sin excepción:
  CONDICIÓN 1 — DATOS TÉCNICOS/ESPECÍFICOS SIN HESITACIÓN: el mensaje contiene información
    concreta sobre el producto o servicio (specs, capacidad, tecnología, número de modelo,
    tiempo de ejecución exacto, características técnicas) sin ningún marcador de consulta
    humana: sin "déjame verificar", "creo que", "ahorita te confirmo", "permíteme checar"
  CONDICIÓN 2 — CIERRE BIFURCADO: el mensaje TERMINA con una pregunta que ofrece
    exactamente dos alternativas del tipo "¿Te gustaría A o prefieres/tienes B?",
    "¿Le gustaría X o prefiere Y?" — patrón de LLM entrenado para mantener la conversación
  EXCEPCIÓN a esta regla: si el mensaje incluye nombre propio de persona (Ramiro, Mónica García),
    error tipográfico, o expresión coloquial (jaja, neta, ahorita, qué onda) → puede ser humano.

══ PASO 2: CALIDAD DE SERVICIO (escala 1-5) ══
Mide CÓMO atendió la empresa al prospecto. Independiente del interés de compra del lead.
Automáticos/bots que ignoran la consulta: 1-2 en TODAS las dimensiones sin excepción.
Acuse de recibo o cortesía vacía que EVADE el tema ya planteado ("gracias", "ok", "entendido",
"gracias por su mensaje", emoji solo como única respuesta a una pregunta) — sea humano o bot —
TODAS las dimensiones en 1-2. El tono amable no compensa la falta de contenido real.
⚠️ UN SALUDO DE APERTURA NO ES "CORTESÍA VACÍA": "hola", "buen día", "buenas tardes" como
PRIMER mensaje de la conversación (antes de que exista una pregunta que evadir) es atención
profesional normal, no un esquive — no lo califiques igual que un "ok" que ignora algo ya
preguntado. Evalúalo con lo poco que hay (normalmente 3, ni mal ni excepcional) en vez de
forzarlo a 1-2 solo por ser corto.

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
{{"category":"humano|hibrido|bot","is_ai":false,"ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"bot_quality":null,"lead_signal":1,"notes":"diagnóstico"}}\
"""


# ── Full-conversation prompt (used after AI session closes) ───────────────────

_CONV_PROMPT_TEMPLATE = """\
Eres un analista que revisa conversaciones de WhatsApp de un "cliente misterioso" con negocios en México.
Acabas de leer TODA la conversación con {company_name} ({industry}). Tu trabajo es decidir QUIÉN o QUÉ
contestó del lado del negocio.

⚠️ PISTA DE NOMBRE: si "{company_name}" contiene "Bot", "Chatbot", "IA", "Asistente", "Virtual",
"Robótico" → casi certeza de sistema automatizado, salvo evidencia clara de lo contrario.

CONVERSACIÓN COMPLETA (cronológica — [Representante] = lo que mandamos nosotros, [Prospecto] = lo que respondió el negocio):
{thread}

══ CÓMO LEER LOS TIEMPOS ══
Cada respuesta del negocio puede traer entre corchetes cuánto tardó desde nuestro mensaje:
  · [⚡ Ns — posible autorespuesta automática]: llegó en menos de 10 s con más texto del que una persona
    escribe en ese tiempo → lo mandó un sistema
  · [~Xs]: tardó segundos (10-60 s) · [~Nmin]: tardó minutos → lo normal en una persona
Si el negocio manda varios mensajes seguidos, cada uno trae su tiempo desde nuestro último mensaje.

══ CÓMO SE VE CADA COSA ══
MENSAJE AUTOMÁTICO (nadie lo escribe en ese momento):
  · Bienvenida de WhatsApp Business al primer contacto, en segundos: "Gracias por comunicarte con X…",
    "¡Hola! le saluda [Nombre] su [cargo] de [EMPRESA]… ¿Con quién tengo el gusto?" (emoji + nombre +
    cargo + empresa en un solo bloque, como primera respuesta en menos de un minuto) — es automática
    aunque traiga el nombre de una persona
  · Aviso de horario o de ausencia: "en este momento no podemos atender", "nuestro horario es…",
    "en breve te contactamos", "este es un servicio automatizado", "estamos buscando un agente disponible"
  · Aviso de privacidad, folio o ticket, "tu mensaje es importante para nosotros"
  · El mismo texto exacto que se repite cada vez que escribimos
BOT DE MENÚ O FLUJO: opciones numeradas, con letras o botones ([Opciones: …]), "selecciona una opción",
  sesiones que "finalizan por inactividad", "soy tu asistente virtual" con pasos fijos; no entiende texto libre.
  También es flujo el que pide pasos fijos antes de contestar —aceptar el aviso de privacidad con Sí/No,
  luego tu nombre, luego tu correo—, cada paso en segundos: aunque al final dé precios, no es una IA.
AGENTE DE IA: entiende texto libre y contesta a lo que se le pregunta con frases naturales, PERO todo
  llega en segundos durante toda la plática (incluso textos largos o con listas), cambia de nombre o de
  área en segundos, repite el mismo resumen en cada despedida o sigue escribiendo solo a intervalos
  exactos. Usar un nombre de persona ("Carla", "Sofía") no lo hace humano.
PERSONA: responde a lo que le preguntamos en concreto, tarda minutos u horas, comete errores de dedo,
  escribe corto o casual ("mande", "diga", "buen día"), manda audios o contactos, contesta a medias, se
  disculpa por la demora. Puede usar respuestas guardadas y saludos formales.
⚠️ "asesor/a digital BDC", "ejecutivo/a de cuenta digital", "consultor digital" = título de una persona en
  agencias automotrices. "Digital" = el canal (WhatsApp), no inteligencia artificial — pero su bienvenida
  sí puede ser automática (ver arriba).
⚠️ Un saludo formal que llega minutos u horas después lo escribió una persona: lo automático llega en
  menos de un minuto o se repite igual.

══ ELIGE UNA CATEGORÍA ══
  "humano"                   — una persona escribió todas las respuestas del negocio.
  "automatico_humano"        — hubo al menos un mensaje automático (bienvenida, horario, ausencia, aviso)
                               y después contestó una persona.
  "automatico_sin_respuesta" — el negocio solo mandó mensajes automáticos (bienvenida, horario, ausencia,
                               aviso) y ninguna persona contestó después. Sin menú de opciones.
  "bot_humano"               — primero un bot de menú o flujo y después contestó una persona.
  "bot"                      — bot de menú o flujo fijo, sin ninguna persona.
  "agente_ia"                — agente de IA conversacional de principio a fin, sin ninguna persona.
Reglas para decidir:
  1. Si hay un mensaje automático al inicio y después escribe una persona, NO es "humano": es
     "automatico_humano" (o "bot_humano" si lo automático era un menú). Esto aplica aunque la parte
     automática sea un solo mensaje.
  2. Si solo hubo bienvenida o aviso automático y después silencio u otros avisos automáticos, es
     "automatico_sin_respuesta", no "bot": un bot necesita menú, botones o un flujo de pasos.
  3. Un cambio de nombre o un "te paso con un asesor" que llega en segundos no es una persona: sigue
     siendo el mismo sistema.
  4. Elige "humano" solo si no hay ningún mensaje claramente automático.

══ CALIDAD DE SERVICIO (1-5) ══
Evalúa lo que escribió la persona, si la hubo. Si no hubo persona ("automatico_sin_respuesta", "bot",
"agente_ia"): TODAS las dimensiones van en 1-2, sin excepción.
Acuse de recibo o cortesía vacía sin abordar el tema ("gracias", "ok", "entendido",
"gracias por su mensaje", emoji solo, 1-4 palabras sin sustancia) — TODAS las dimensiones en 1-2.
El tono amable no compensa la falta de contenido real.

svc_prof   (Profesionalismo) — 1-2: errores graves o tono cortante/inapropiado · 4-5: impecable, tono cálido y consistente
svc_comp   (Completitud) — 1-2: ignora la pregunta o da algo genérico que no aplica · 4-5: responde punto por punto, sin dejar nada sin cubrir
svc_empa   (Empatía) — 1-2: trato robótico, no usa nombre ni contexto · 4-5: usa el nombre, reconoce la situación específica del prospecto
svc_solu   (Solución) — 1-2: nada concreto, solo "te contactaremos" · 4-5: precio/producto/cita específicos, no genéricos
svc_next   (Siguiente paso) — 1-2: termina sin ningún CTA · 4-5: CTA explícito y accionable de inmediato
svc_proact (Proactividad) — 1-2: solo reacciona, cero iniciativa · 4-5: anticipa, califica, ofrece más de lo pedido

CALIBRACIÓN: no asumas 3 por default. Un 3 exige evidencia mixta real (ni claramente bien ni mal) —
si dudas entre 2 y 3, o entre 3 y 4, elige el extremo que tenga evidencia concreta en el texto.

══ SEÑAL COMERCIAL FINAL (1-5) ══
Estado del lead al cierre de la conversación:
1 — Descartado / bloqueó / sin interés
2 — Frío / dejó de responder / cortesía vacía
3 — Tibio / pidió info sin compromiso claro
4 — Interesado / preguntó detalles, pidió que lo contacten
5 — Caliente / pidió precio, cita, propuesta o mostró urgencia

══ CONCLUSIÓN (máximo 35 palabras) ══
Para un dueño de negocio sin tecnicismos: quién contestó (si hubo una parte automática y luego una
persona, dilo), cómo fue la atención y la acción concreta más importante a tomar.

Responde SOLO con JSON válido:
{{"category":"humano|automatico_humano|automatico_sin_respuesta|bot_humano|bot|agente_ia","ai_confidence":0.0,"svc_prof":3,"svc_comp":3,"svc_empa":3,"svc_solu":3,"svc_next":3,"svc_proact":3,"bot_quality":null,"lead_signal":1,"notes":"diagnóstico","conversation_analysis":true}}\
"""


def llm_instruction_preview() -> str:
    """El texto fijo que lee el modelo en Timing + IA, sin una conversación real.
    La pantalla de plantillas lo muestra para verificarlo (2026-10-07)."""
    return _CONV_PROMPT_TEMPLATE.format(
        company_name="«EMPRESA»",
        industry="«INDUSTRIA»",
        thread="«AQUÍ VA LA CONVERSACIÓN, CON EL TIEMPO DE CADA MENSAJE DEL NEGOCIO»",
    )

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
                f"\n⚠️ SEÑAL FUERTE DE TIEMPO: respuesta en {secs:.0f} segundos — muy probable bot. "
                "Es poco común para humano, pero analiza el CONTENIDO: si el mensaje responde específicamente "
                "al tema enviado, menciona un nombre real o da contexto personal, puede ser humano muy rápido "
                "(p.ej. WhatsApp abierto en ese momento, contestó con voz a texto, o copió texto previo). "
                "Clasifica 'bot' solo si el contenido también lo respalda."
            )
        elif secs < 30:
            reaction_hint = (
                f"\n⚠️ TIEMPO CORTO: respuesta en {secs:.0f} segundos — posible bot, pero un humano "
                "con el chat abierto también puede responder en ese tiempo. "
                "Analiza el CONTENIDO: si ignora el tema o tiene estructura automática → bot; "
                "si responde con naturalidad al contexto o muestra razonamiento propio → puede ser humano."
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
    def _esc(s: str) -> str:
        return s.replace("{", "{{").replace("}", "}}")
    return _PROMPT_TEMPLATE.format(
        outbound_body=_esc(outbound_body or "(sin texto)"),
        inbound_body=_esc(inbound_body or "(sin texto)"),
    ) + reaction_hint


# Taxonomía de UN mensaje. La de la conversación completa (automatico_humano,
# automatico_sin_respuesta, bot_humano, agente_ia) no entra aquí a propósito:
# classify_conversation vuelve a leer la categoría cruda con _conv_category
# (2026-10-05). Si ese segundo paso se quita, el prompt nuevo se guarda todo
# como "humano".
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
    def _bq(v):
        if v is None:
            return None
        try:
            v = int(round(float(v)))
            return v if v in (1, 3, 5) else (1 if v <= 2 else 3 if v <= 4 else 5)
        except (TypeError, ValueError):
            return None

    # El prompt le pide al LLM "Automáticos/bots = 1 siempre" para la señal
    # comercial (PASO 3) — no siempre lo respeta (mismo patrón de incumplimiento
    # ya documentado para otras reglas de este prompt, ver REGLA DE ORO arriba).
    # Caso real: "Estrena tu próximo SEAT en SEAT FURIA" — category=bot con
    # lead_signal=3 pese a la instrucción explícita. Se refuerza aquí en vez
    # de confiar solo en el prompt, mismo patrón que is_ai unas líneas arriba.
    lead_signal = _svc("lead_signal")
    if category == "bot" and lead_signal is not None:
        lead_signal = 1

    return {
        "category": category,
        "is_ai": is_ai,
        "ai_confidence": round(float(result.get("ai_confidence") or 0.0), 2) if is_ai else 0.0,
        **svc_scores,
        "response_quality": _response_quality_from_svc(svc_scores),
        "bot_quality": _bq(result.get("bot_quality")),
        "lead_signal": lead_signal,
        "notes": result.get("notes") or "",
        "conversation_analysis": bool(result.get("conversation_analysis", False)),
    }


def _call_deepseek(messages: list, max_tokens: int = 280) -> str:
    """Call active LLM provider with BATCH priority. Raises LLMQuotaExceeded on billing errors."""
    from app.llm import call_llm, PRIORITY_BATCH
    from app.config import CLASSIFIER_MODEL
    try:
        return call_llm(messages, max_tokens=max_tokens, temperature=0, priority=PRIORITY_BATCH,
                        model=CLASSIFIER_MODEL)
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
    r'\[Opciones:|\[Lista:|responde con el n[uú]mero|elige una? opci[oó]n|'
    r'escribe (?:el )?(?:1|2|3|un n[uú]mero)|selecciona (?:una?|la|el)\s+(?:opci[oó]n|n[uú]mero)|'
    # "Por favor, selecciona un número: 1. Cotizar..." (Laboratorio Chopo, Hidrogas)
    r'selecciona (?:un )?n[uú]mero|favor de indicar (?:la )?(?:ciudad|opci[oó]n)',
    re.IGNORECASE,
)
# El separador tras el número también viene como guión ("1 - Autos nuevos"), no solo
# punto/paréntesis ("1. Autos nuevos") — caso real (Nissan Vallejo) que se colaba
# como "humano" porque ningún ítem de la lista hacía match. Los menús con letra
# ("A)Agua", sin espacio tras el paréntesis) también se colaban — a diferencia de los
# numéricos, aquí el espacio es opcional para no perder ese caso (no hay ambigüedad
# tipo "1.5" con letras).
_MENU_LIST_ITEM = re.compile(
    r'(?:^|\n)\s*(?:[0-9]{1,2}[.\)-]\s+\S|[*_]?[A-H][*_]?\s*[.\)-]\s*\S)',
    re.MULTILINE,
)
# Listas numeradas inline — ítems en la misma línea, separador "." o ".-" o "-"
# Casos reales: "1.- Solicitar un servicio  2.- Conocer nuestros servicios" (Hidrogas),
# "1. Ciudad Obregón  2. Hermosillo" (Rivera Gas), "1. 🔬 Cotizar  2. 🏠 Solicitar" (Chopo).
# [-.)]{1,2} cubre tanto "1." como "1.-" como "1-".
_INLINE_MENU_ITEM = re.compile(
    r'(?<![0-9])\b[1-9][0-9]?\s*[-.)]{1,2}\s+\S',
    re.MULTILINE,
)
# IVR de opción por letra, todo en una sola línea — "Escribe *A* para Ventas o
# *B* para Soporte" no calzaba con _MENU_LIST_ITEM (exige la letra al INICIO de
# línea) ni con _INLINE_MENU_ITEM (exige número, no letra), así que un menú
# rígido de este tipo se le pasaba de largo a la reglas y terminaba en el LLM
# — que a veces lo juzga "IA conversacional" (is_ai=True) cuando en realidad es
# un flujo fijo sin nada de IA. Requiere ≥2 letras marcadas para no disparar
# con una sola mención suelta de "opción A" en prosa normal.
_INLINE_LETTER_MENU_ITEM = re.compile(
    r'[*_]?\b[A-H]\b[*_]?\s*(?:para|[-.):])\s*\S',
)

_AUTO_REPLY_MARKERS = re.compile(
    r'folio|tkt-|ticket\s*#|ref(?:erencia)?\s*[:#]|tu mensaje es importante|'
    r'en breve (?:un asesor|te (?:contactar|responderemos|atenderemos|contestaremos))|'
    r'hemos recibido tu (?:consulta|mensaje)|'
    r'nos comunicaremos a la brevedad|mensaje generado autom[aá]ticamente|'
    r'estimado cliente|apreciable cliente|horarios? de atenci[oó]n|'
    # "¿Sigues ahí?" / "Aquí sigo…" (nudge de continuidad de sesión) y mensajes de
    # cola/espera ("está en la cola", "buscando un agente disponible") — encontrados
    # repetidos en producción en varias empresas distintas (HSBC "Leo", KLM, Nissan
    # Vallejo) SIEMPRE clasificados "humano" pese a ser lenguaje típico de bot/IVR
    # que gestiona la sesión o la espera — ninguna otra regla los cubría.
    r'sigues ah[ií]|aqu[ií] sigo|est[aá] en la cola|buscando (?:un|una) agente|'
    r'espera un momento por favor|volver cuando quieras|'
    # Mensaje de "saludo automático" de WhatsApp Business — patrón real muy común.
    # "(a)" es notación inclusiva ("bienvenido(a)") que rompe [oa] simple.
    # "\s+al?\b" cubre tanto "bienvenido a X" como la contracción "bienvenido al
    # WhatsApp de X" — sin el "l?" opcional, "al" nunca hacía match porque "a\b"
    # exige un límite de palabra justo después de la "a", que "al" no tiene
    # (caso real: Grupo Alden / Audi Center Satélite, 2026-08-12).
    r'bienvenid[oa]s?(?:\([ao]\))?\s+al?\b|'
    r'gracias por (?:contactarnos|escribir(?:nos)?|comunicarte|comunicarse)|'
    # Caso real de producción (Ferra, 2026-09-07): un agente humano real escribió
    # "...con gusto te atenderemos" y esta marca lo clasificó "bot" por error — la
    # frase suelta es una cortesía humana normal en México, NO exclusiva de
    # plantilla. Solo es señal de bot cuando además trae el "en breve/pronto" que
    # sí delata la plantilla de bienvenida automática de WhatsApp Business.
    r'te (?:responderemos|atenderemos|contestaremos)\s*(?:lo más\s+)?(?:en breve|pronto|lo antes posible|a la brevedad)\b|'
    # "Gracias por tu mensaje. En este momento no podemos responder..." — variante
    # de auto-ausencia real (Barbaro, 2026-09-01) que ninguna de las frases de
    # arriba cubría ("gracias por tu mensaje" no está en la lista de "gracias por
    # contactarnos/escribirnos/...", y "no podemos responder" es una frase nueva).
    r'gracias por tu mensaje|no podemos responder|'
    # "Te comunicas a [Empresa]" / "Se comunica a [Empresa]" — variante de "has llegado a".
    # Un humano diría "te comunico con alguien", no "te comunicas a".
    r'(?:te|se)\s+comunica[sz]?\s+a\s+\w|'
    # "Agradecemos su preferencia" / "cordial bienvenida" — plantillas corporativas formales
    # que nunca escribe un humano real en WhatsApp.
    r'agradecemos (?:su|tu) (?:preferencia|contacto|confianza|visita)|'
    r'(?:cordial|afectuosa)\s+bienvenida|'
    # "Por el momento nuestro equipo se encuentra fuera del horario laboral" —
    # plantilla de fuera de horario, caso real (Salones de Belleza, Nissan Vallejo).
    r'fuera de(?:l| nuestro)?\s+horario|'
    # Mensaje de cierre de sesión por inactividad de WhatsApp Business — caso real
    # (Rivera Gas, 2026-07-30): "En este momento finalizaremos la sesión por
    # inactividad" fue evaluado por el LLM como una respuesta humana genérica,
    # sin ninguna regla determinista que lo atrapara. Ningún humano avisa que va
    # a "finalizar la sesión por inactividad" — es lenguaje de sistema.
    r'por inactividad\b',
    re.IGNORECASE,
)

# Autoidentificación como bot/IA — señal fuerte y barata (sin LLM) de que la
# respuesta la mandó un sistema, sin importar qué tan rápido llegó. El patrón
# "soy...virtual" (sin exigir la palabra exacta "asistente") cubre variantes
# reales encontradas en producción como "Soy Bell, el reclutador virtual de
# Smart Fit" — la redacción literal "asistente virtual" no las detectaba.
# "consultor digital" (SEAT Furia, 2026-09-16) mostró que "digital" es tan
# fuerte como "virtual" para este patrón — ningún humano se presenta así por
# WhatsApp — así que ambos modificadores aplican a toda la lista de puestos.
_BOT_SELFID_MARKERS = re.compile(
    # "asistente virtual/digital", "ejecutivo virtual" (HSBC Leo), "reclutador virtual" (Smart Fit)
    r'asistente (?:virtual|digital)|'
    r'\b(?:asesor|agente|ejecutivo|operador|reclutador|coordinador|consultor)\s+(?:virtual|digital)\b|'
    # "chatbot" suelto no basta: Whato CRM (2026-10-06) — María, 14 h después, escribió
    # "El chatbot de whato responde automáticamente" para describir el producto.
    r'soy (?:un|una)?\s*(?:chat)?bot\b|soy\s+\w+[,.]?\s*tu\s+asistente|'
    r'\bsoy\b[^.!?\n]{0,45}\bvirtual\b|'
    r'inteligencia artificial|🤖|envía\s*["\']?hola["\']?\s*para\s+(?:comenzar|empezar)|'
    r'la sesi[oó]n ha finalizado|session (?:has )?ended',
    re.IGNORECASE,
)

# Plantilla de "auto-greeting" de WhatsApp Business en agencias automotrices/BDC:
# "le saluda [Nombre] su asesor(a) [digital/virtual] [BDC] de [EMPRESA]" — estructura
# en tercera persona ("le saluda", no "hola, soy" ni "atiende"), que es la forma real
# en que se configuran estos mensajes automáticos, distinta de un empleado presentándose
# casual en primera persona ("hola, atiende Fulanita, con quién tengo el gusto" —
# eso SÍ es humano, ver nota en el prompt de classify_conversation). No requiere la
# palabra "virtual" (a diferencia de _BOT_SELFID_MARKERS) porque "asesora digital BDC"
# es el título real más común y NO debe tratarse como autoidentificación de IA — pero
# la estructura completa de plantilla (saludo en tercera persona + puesto + empresa)
# sí es evidencia real de mensaje automático de bienvenida, venga o no firmado por un
# nombre real. Caso real: Stellantis Country (Clarissa Flores, "asesora digital BDC").
_FORMAL_BDC_GREETING = re.compile(
    # Coma incluida en el tramo del nombre — "Le saluda Clarissa, su asesora..." es la
    # puntuación natural en español y el propio caso real (Stellantis Country) la lleva;
    # sin la coma en la clase de caracteres el regex nunca hace match contra ese texto.
    r'le saluda\s+[\w\s,áéíóúñ]{2,40}?(?:su\s+)?(?:asesor|ejecutiv|agente|representante)\w*'
    r'\s*(?:digital|virtual)?\s*(?:bdc)?\s+de\s+\w',
    re.IGNORECASE,
)


def _looks_like_formal_bdc_greeting(text: str) -> bool:
    return bool(_FORMAL_BDC_GREETING.search(text or ""))

# Anuncio de handoff bot→humano — el propio sistema documenta este patrón como
# "hibrido" (ver _PROMPT_TEMPLATE), pero el mensaje suele MENCIONAR literalmente
# "asistente virtual" al referirse a lo que está reemplazando ("reemplazaré a
# nuestro asistente virtual"), lo que sin este chequeo activaba por error
# _looks_like_bot_selfid — un caso real de producción (KLM) mostró exactamente
# este texto. No hay atajo determinista a "hibrido" (solo el LLM decide esa
# categoría) — lo único que hace este chequeo es evitar clasificar como "bot"
# con falsa certeza algo que en realidad anuncia lo contrario.
# "en lugar de"/"en vez de" nuestro asistente virtual: misma idea de reemplazo
# que "reemplazaré a", solo con otra preposición — caso real de auditoría:
# "soy Diana... en lugar de nuestro asistente virtual" se clasificaba como bot
# por _looks_like_bot_selfid al no calzar con ningún patrón de arriba.
_HANDOFF_MARKERS = re.compile(
    r'reemplazar[eé] a (?:nuestro|nuestra)|se est[aá] comunicando con (?:un|una) agente|'
    r'te atender[aá] (?:un|una) (?:asesor|agente|persona)|lo atender[aá] (?:un|una) (?:asesor|agente)|'
    r'la atender[aá] (?:un|una) (?:asesor|agente)|un agente (?:humano|real)|'
    r'en (?:lugar|vez) de (?:nuestro|nuestra) (?:asistente|bot)',
    re.IGNORECASE,
)


def _looks_like_handoff_announcement(text: str) -> bool:
    return bool(_HANDOFF_MARKERS.search(text or ""))

# Presentación personal humana — "mi nombre es Emmanuel", "soy Juan, asesor".
# Señal fuerte de humano real, especialmente útil cuando el probe T1→T2 timeout
# caería por default a "automatico" (texto largo, sin menú ni plantilla de bot).
# Caso real: "Buen día, gracias por contactar a Aceromex, mi nombre es Emmanuel,
# ¿En qué le puedo ayudar?" → T1 rápido → probe timeout → caía a "automatico".
_HUMAN_NAME_INTRO = re.compile(
    r'\bmi nombre es\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\b|'
    r'\bme llamo\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\b|'
    r'\bsoy\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,?\s+(?:asesor|vendedor|ejecutivo|gerente|coordinador|encargado|agente)\b',
    re.IGNORECASE,
)

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


# "asesor/consultor/ejecutivo digital" es el puesto de una persona en las agencias (BDC):
# "digital" es el canal. Cuenta como autoidentificación de bot solo si hay otra señal.
_HUMAN_DIGITAL_TITLE_RE = re.compile(r"^(asesor|agente|ejecutivo|operador|coordinador|consultor)\s+digital$", re.I)


def _strong_bot_selfid(text: str) -> bool:
    if _looks_like_handoff_announcement(text):
        return False
    return any(not _HUMAN_DIGITAL_TITLE_RE.match(m.group(0)) for m in _BOT_SELFID_MARKERS.finditer(text or ""))


# Hybrid offer: auto-ACK that ALSO gives the user an active option to reach a human.
# "Responde SÍ y te conectamos", "Escribe HUMANO", "¿Deseas hablar con un asesor ahora?"
# When this appears alongside an auto-reply template → the category is "hibrido", not "bot".
_HYBRID_OFFER_MARKERS = re.compile(
    r'responde\s+["\']?s[ií]["\']?\s*(?:y\s+te|para\s+(?:hablar|conectar|ser\s+atendido))|'
    r'escribe\s+(?:humano|asesor|agente|s[ií])\b|'
    r'[¿]?deseas?\s+hablar\s+con\s+(?:un\s+|una\s+)?(?:asesor|agente|humano|person)|'
    r'[¿]?quieres?\s+(?:que\s+te\s+conecte|hablar\s+con)|'
    r'te\s+conectamos\s+(?:de\s+inmediato|ahora|en\s+este\s+momento)|'
    r'para\s+hablar\s+con\s+(?:un\s+|una\s+)?(?:asesor|agente|humano|persona)\s+(?:real|ahora|ya)',
    re.IGNORECASE,
)


def _looks_like_hybrid_offer(text: str) -> bool:
    return bool(_HYBRID_OFFER_MARKERS.search(text or ""))


# IA conversacional que no se autoidentifica: cierra con pregunta bifurcada
# ("¿Te gustaría X o prefieres Y?", "¿Le gustaría A o prefiere B?") al final
# de un mensaje sustancial. Patrón muy típico de LLM entrenado para mantener
# la conversación — un humano suele preguntar una sola cosa o cerrar de forma
# más coloquial ("¿te interesa?", "avísame", "¿para cuándo lo necesitas?").
# El check de longitud (≥80 chars) excluye preguntas cortas genuinamente humanas
# del tipo "¿para casa o negocio?" (30 chars).
_BIFURCATED_AI_CLOSE = re.compile(
    # Matches: [¿?] ... "o <alternative>" ... ?$
    # where <alternative> is one of the typical LLM closing options.
    # Note: Spanish "preferir" stem-changes (e→ie) in several conjugations:
    #   preferir/preferimos/preferís  → "prefer\w*"  (no stem change)
    #   prefieres/prefiere/prefiero/prefieren  → "prefi\w+"  (stem changes: i inserted)
    # Both patterns needed; just "prefer\w+" misses the most common conjugations.
    r'[¿?][^?]*\bo\s+(?:'
    r'prefi\w+|prefer\w+|'                      # prefieres/prefiere/prefiero + preferir/preferimos
    r'tienes?\s+alguna|'                        # tienes alguna otra consulta
    r'desea\w+\s+(?:m[aá]s|conocer|saber|recibir|hablar)|'   # deseas más info
    r'te\s+gustar[ií]a|'                        # te gustaría (segunda alternativa)
    r'quiere\w*\s+(?:que|m[aá]s|conocer|saber)'   # quieres que / quiere más
    r')\b[^?]*\?\s*$',
    re.IGNORECASE,
)

# Marcadores de personalidad humana — si aparecen en el mensaje junto al
# cierre bifurcado, prevalece "humano" (o se manda al LLM). Incluye:
#  · expresiones coloquiales mexicanas (jaja, neta, wey, ahorita)
#  · abreviaciones de teclado (q, xq, tb, xfa)
#  · frases de duda humana (déjame verificar, creo que)
#  · presentación personal con apellido ("le saluda Nombre Apellido")
_HUMAN_PERSONALITY_MARKERS = re.compile(
    r'\bjaj[ae]+\b|jeje|xd\b|'
    r'\bneta\b|\bwey\b|g[uü]ey\b|'
    r'\bahorita\b|\bórale\b|\bandale\b|\bsale\b|'
    r'\bq\s+|\bxq\b|\btb\b|\bxfa\b|\bpls\b|\btmb\b|'
    r'd[eé]jame\s+(?:verificar|checar|ver|buscar)|'
    r'\bcreo\s+que\b|'
    r'le\s+saluda\s+[A-ZÁÉÍÓÚÑ]\w+\s+[A-ZÁÉÍÓÚÑ]\w+',    # "le saluda Nombre Apellido"
    re.IGNORECASE,
)


_MAX_HUMAN_CHARS_PER_SEC = 8.0
# Respuesta en menos de 10s: por debajo de esta velocidad es alguien escribiendo en
# el chat ("Mucho gusto" en 9s), no una autorespuesta.
_FAST_REPLY_MIN_CHARS_PER_SEC = 4.0


def _typed_too_fast(text: str, seconds: float | None) -> bool:
    """Mensaje largo, sin marcas de persona, que llegó más rápido de lo que alguien
    lo teclea (> 8 car/seg). Ver la regla de velocidad de tecleo en _quick_classify."""
    # Un tiempo negativo significa que el dato de tiempo está roto (desfase de reloj
    # o carrera al emparejar outbound/inbound) — sin este chequeo, max(x, 0.1)
    # convertiría un tiempo NEGATIVO en el más rápido posible y la regla dispararía
    # con cualquier mensaje de 80+ caracteres.
    if seconds is None or seconds < 0 or len(text) < 80 or _HUMAN_PERSONALITY_MARKERS.search(text):
        return False
    return len(text) / max(seconds, 0.1) > _MAX_HUMAN_CHARS_PER_SEC


def _is_plain_text(body: str) -> bool:
    """Texto escrito, no audio/sticker/archivo/contacto compartido — un vCard o un
    blob binario pueden ser largos y llegar en segundos sin que nadie los teclee."""
    return (body not in NON_TEXT_PLACEHOLDERS and not _looks_like_binary_blob(body)
            and "BEGIN:VCARD" not in body.upper())


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
    # Muy corto (<=15) y sin ninguna señal de bot (ya descartada arriba) — casi
    # seguro humano tecleado rápido sin importar mayúscula inicial. Ningún
    # auto-reply/plantilla real visto en producción es esto de corto (el más
    # breve, "Gracias por tu mensaje...", ya pasa de 20). Caso real: "Grcs a ti"
    # (abreviatura de "gracias" con mayúscula inicial) clasificado "bot"/is_ai=True
    # por el LLM de classify_response — no atrapaba antes por empezar en
    # mayúscula y no calzar el patrón exacto de saludo casual (2026-09-18).
    if len(t) <= 15:
        return True
    starts_lowercase = t[0].islower()
    is_casual_greeting = bool(_CASUAL_HUMAN_GREETING.match(t))
    return starts_lowercase or is_casual_greeting


_FILE_SHARE_RE = re.compile(
    r'\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp4|mp3|ogg|opus)(\s*\(\d+\))?\s*$',
    re.IGNORECASE,
)


def _is_vcard_or_file_share(text: str) -> bool:
    """A prospect sharing a contact card or a file — always a human action, no
    matter how machine-generated the raw text looks (a vCard's structured
    fields, a bare filename). Shared by every path that judges a message from
    its raw text: the per-message quick-classifier AND the probe-resolution
    fallback both saw this text and needed the same carve-out (observed live:
    Volkswagen del Centro's vCard, La Casona del Arco's PDF filename, and
    Grupo Hakkasan's probe-resolved vCard reply — all on 2026-09-17)."""
    t = text.strip()
    if not t:
        return False
    return "BEGIN:VCARD" in t.upper() or bool(_FILE_SHARE_RE.search(t))


def _looks_like_menu(text: str) -> bool:
    if _MENU_MARKERS.search(text):
        return True
    if len(_MENU_LIST_ITEM.findall(text)) >= 2:
        return True
    # Inline numbered list: "1.- Solicitar  2.- Conocer" o "1. 🔬 Cotizar  2. 🏠 Solicitar"
    if len(_INLINE_MENU_ITEM.findall(text)) >= 2:
        return True
    # Opciones numeradas con emoji: "elige una de las siguientes opciones: 1️⃣ Cotiza un
    # MAZDA 2️⃣ Cotiza Auto SEMINUEVOS" (Mazda Acueducto) — ningún patrón de arriba ve el
    # número dentro del emoji. Solo si pide escoger: una promo que enumera sus sucursales
    # con 1️⃣ 2️⃣ 3️⃣ (Toyota Fest) no es un menú.
    if len(_KEYCAP_MENU_ITEM.findall(text)) >= 2 and _PICK_ONE_RE.search(text):
        return True
    # IVR de letras en una sola línea: "Escribe *A* para Ventas o *B* para Soporte"
    return len(_INLINE_LETTER_MENU_ITEM.findall(text)) >= 2


_KEYCAP_MENU_ITEM = re.compile(r"[0-9]️?⃣")
_PICK_ONE_RE = re.compile(r"opci[oó]n|elige|selecciona|escribe|responde|marca|digita|teclea", re.IGNORECASE)
# Pide ESCOGER una opción. Una lista numerada sola no basta para decir "menú": un agente de
# IA también enumera precios, pasos o datos ("1. Tu nombre completo 2. Dirección…").
_CHOICE_PHRASE_RE = re.compile(
    r"\b(elige|elija|selecciona|seleccione|escoge|escoja|escribe|escriba|responde|responda|marca|marque|"
    r"digita|digite|teclea|env[ií]a)\b[^.?!\n]{0,40}\b(opci[oó]n|n[uú]mero|letra)|\bsiguientes opciones\b",
    re.IGNORECASE)


def _is_choice_menu(text: str) -> bool:
    t = text or ""
    # Menú corto de opciones sin frase ("1. Ventas 2. Refacciones 3. Servicio") también cuenta;
    # un mensaje largo con información numerada solo si pide escoger.
    return bool(_MENU_MARKERS.search(t) or _CHOICE_PHRASE_RE.search(t) or (len(t) <= 220 and _is_options_menu(t)))


# A "gracias por comunicarte/escribir..." greeting is usually a static ACK worth
# staying silent for — but when the SAME message also asks a real qualifying
# question (name / business / location), it's a lead-qualification bot, not a
# dead-end ticket. Going silent there just kills the lead before Andy ever gets
# a chance to answer and get through to a human. Real case (Doctor Restaurant,
# "Alondra" bot): "Gracias por comunicarte... Cuál es tu nombre? Cómo se llama
# tu negocio? Dónde está ubicado?" — Andy should play along (persona name/negocio
# falso, per the [IA CONVERSACIONAL DE OTRA EMPRESA] rules in the system prompt),
# not go silent forever.
_ONBOARDING_QUESTION_RE = re.compile(
    r'cu[aá]l es (?:tu|su) nombre|c[oó]mo te llamas|c[oó]mo se llama|'
    r'(?:proporcionar|compartir|decirnos|darnos)(?:nos)?\s+(?:su|tu)\s+nombre|'
    r'd[oó]nde (?:est[aá]s?|se encuentra|ubicad[oa])|(?:me|nos)\s+puede[sn]?\s+compartir|'
    r'plat[ií]came (?:un poco )?(?:de|sobre) tu negocio|cu[eé]ntame (?:un poco )?(?:de|sobre) tu negocio',
    re.IGNORECASE,
)


def _looks_like_auto_reply(text: str) -> bool:
    if _ONBOARDING_QUESTION_RE.search(text or ""):
        return False
    return bool(_AUTO_REPLY_MARKERS.search(text))


# El webhook (routes.py: _extract_body_and_interactive) guarda estos marcadores
# literales cuando la respuesta es un audio/sticker/ubicación/contacto/plantilla sin
# texto — nunca son el contenido real que escribió el prospecto. Sin este chequeo, se
# le mandaba "[audio]" tal cual al regex de menú o al LLM como si fuera texto real.
NON_TEXT_PLACEHOLDERS = {"[audio]", "[sticker]", "[location]", "[contact]", "[media]", "[template]",
                          "[image]", "[video]", "[document]"}

# Caso real de auditoría: un mensaje de imagen llegó con el JPEG en base64 crudo
# metido directo en message_body (en vez de uno de los placeholders de arriba —
# el bug real está en cómo el webhook arma ese campo, no aquí), y el LLM lo
# clasificó como si fuera texto real, inventando una nota "coherente" sobre
# contenido que ni siquiera podía leer. Esta es una última barrera defensiva en
# el clasificador: cualquier bloque largo sin espacios que sea puro alfabeto
# base64, o un data URI explícito, se trata igual que un placeholder de no-texto.
_DATA_URI_RE = re.compile(r'^data:[\w/+.-]+;base64,', re.IGNORECASE)
_BASE64_BLOB_RE = re.compile(r'^[A-Za-z0-9+/]{80,}={0,2}$')


def _looks_like_binary_blob(body: str) -> bool:
    stripped = (body or "").strip()
    if not stripped:
        return False
    if _DATA_URI_RE.match(stripped):
        return True
    # Un mensaje real, aunque sea largo, casi siempre tiene espacios o
    # puntuación — un blob base64 es una sola "palabra" gigante sin espacios.
    return " " not in stripped and bool(_BASE64_BLOB_RE.match(stripped))


def _has_real_text(body: str | None) -> bool:
    if not body or not body.strip():
        return False
    stripped = body.strip()
    return stripped not in NON_TEXT_PLACEHOLDERS and not _looks_like_binary_blob(stripped)


def _is_ignorable_body(body: str | None) -> bool:
    """Vacío o un archivo ilegible. Un audio, sticker o contacto sí es una respuesta
    (El Wero del gas, 2026-08: mandó un audio)."""
    stripped = (body or "").strip()
    if not stripped:
        return True
    return _looks_like_binary_blob(stripped)


# Seguimiento o campaña, no una contestación a lo que escribimos. Agencia de autos Toyota
# (2026-10-06): lo único que llegó, 56 días después, fue "Seguimos atentos a su proceso".
_CAMPAIGN_RE = re.compile(
    r"seguimos atentos|te escribo de nuevo|dar seguimiento a (?:tu|su|la)|"
    r"lleg[oó] el .{0,30}fest|solo quer[ií]a dar seguimiento",
    re.IGNORECASE,
)
# Aviso de ausencia, aunque tarde minutos en entregarse. AgendaPro (2026-10-06): varios
# "fuera de horario" y después una persona contestó el pedicure.
_AWAY_RE = re.compile(
    r"fuera de horario|no estamos disponibles|no podemos responder|"
    r"en este momento no podemos|te contactar[aá] lo antes|"
    r"tan pronto (?:veamos|regresemos)|mientras respondemos",
    re.IGNORECASE,
)
_LATE_CAMPAIGN_SEC = 24 * 3600


def _substantive_replies(messages: list) -> list:
    """Respuestas del negocio posteriores a nuestro primer mensaje, sin vacíos ni blobs."""
    first_out = next((m.get("created_at") for m in messages
                      if m.get("direction") == "outbound" and m.get("created_at")), None)
    if not first_out:
        return []
    out = []
    for m in messages:
        if m.get("direction") != "inbound" or not m.get("created_at") or m["created_at"] <= first_out:
            continue
        if _is_ignorable_body(m.get("message_body")):
            continue
        out.append(m)
    return out


def _reply_delay(messages: list, inbound: dict) -> float | None:
    prev = None
    for m in messages:
        if m.get("direction") == "outbound" and m.get("created_at") and inbound.get("created_at") and m["created_at"] < inbound["created_at"]:
            prev = m["created_at"]
        if m is inbound:
            break
    if not prev or not inbound.get("created_at"):
        return None
    return (inbound["created_at"] - prev).total_seconds()


def _only_late_campaign(messages: list, replies: list) -> bool:
    if not replies:
        return False
    bodies = [(m.get("message_body") or "") for m in replies]
    if not all(_CAMPAIGN_RE.search(t) for t in bodies):
        return False
    delay = _reply_delay(messages, replies[0])
    return delay is not None and delay > _LATE_CAMPAIGN_SEC


def _no_reply_analysis(note: str) -> dict:
    return {
        "category": "sin_respuesta", "is_ai": False, "ai_confidence": 0.0,
        "svc_prof": None, "svc_comp": None, "svc_empa": None,
        "svc_solu": None, "svc_next": None, "svc_proact": None,
        "response_quality": None, "bot_quality": None, "lead_signal": None,
        "notes": note, "conversation_analysis": True,
    }


def _no_reply_verdict(messages: list) -> dict | None:
    """Sin contestación real, o solo una campaña al día siguiente o después.
    Sin hora en los mensajes no se puede saber qué llegó antes: se deja a las otras reglas
    (los tests de menú y de asistente virtual arman el hilo sin created_at)."""
    if not any(m.get("direction") == "outbound" and m.get("created_at") for m in messages):
        return None
    undated = [m for m in messages
               if m.get("direction") == "inbound" and not m.get("created_at")
               and not _is_ignorable_body(m.get("message_body"))]
    if undated:
        return None
    replies = _substantive_replies(messages)
    if not replies:
        # Servi-Gas (2026-10-06): "Buenas tardes" llegó 21 min antes de nuestro saludo.
        # Timing + IA debe decir eso; si no, el log parece que no hubo ningún mensaje
        # y solo IA (que sí lo lee, sin hora) lo clasifica como Humano.
        first_out = next(m.get("created_at") for m in messages
                         if m.get("direction") == "outbound" and m.get("created_at"))
        early = [m for m in messages
                 if m.get("direction") == "inbound" and m.get("created_at") and m["created_at"] < first_out
                 and not _is_ignorable_body(m.get("message_body"))]
        if early:
            snippet = " ".join((early[-1].get("message_body") or "").split())[:80]
            return _no_reply_analysis(
                f"«{snippet}» llegó antes de que escribiéramos. Después de nuestro mensaje no contestó."
            )
        return _no_reply_analysis(
            "No llegó ningún mensaje con texto, audio o archivo después de que escribimos."
        )
    if _only_late_campaign(messages, replies):
        delay = _reply_delay(messages, replies[0]) or 0
        return _no_reply_analysis(
            f"Lo único que llegó fue un seguimiento {_fmt_elapsed(delay)} después, no una contestación."
        )
    return None


def _bot_drip_after_menu(messages: list) -> bool:
    """Menú y, sin que volviéramos a escribir, guiones largos del mismo flujo. Universidad UVM
    (2026-10-06): el mismo menú cada 20 min y luego "James, asesor educativo". Un saludo corto
    sí es una persona (Diesgas, 2026-08: "Hola buenas tardes" después del menú)."""
    seen_menu = wrote_after = False
    scripts = []
    for m in messages:
        body = (m.get("message_body") or "").strip()
        if m.get("direction") == "outbound":
            if seen_menu:
                wrote_after = True
            continue
        if not body or _is_ignorable_body(body):
            continue
        if _is_choice_menu(body) or _looks_like_menu(body):
            seen_menu = True
            continue
        if seen_menu and not wrote_after:
            scripts.append(body)
    if not seen_menu or wrote_after or len(scripts) < 2:
        return False
    return any(len(s) > 50 for s in scripts)


def _person_after_away_notice(messages: list) -> bool:
    """Aviso de ausencia y, después, un mensaje que ya no es plantilla. AgendaPro (2026-10-06)."""
    seen = False
    for m in messages:
        if m.get("direction") != "inbound":
            continue
        body = (m.get("message_body") or "").strip()
        if not body or _is_ignorable_body(body):
            continue
        if _AWAY_RE.search(body):
            seen = True
            continue
        if seen and len(body) >= 20 and not _looks_like_auto_reply(body) and not _is_choice_menu(body):
            return True
    return False


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


def _quick_result(category: str, notes: str, is_ai: bool = False, soft_signal: bool = False) -> dict:
    """Same shape as _parse_llm_response's output — low/None across the board,
    matching the prompt's own rule: menu/bot(non-AI) always score 1-2.
    Pass is_ai=True when the bot self-identifies as a conversational AI assistant.
    Pass soft_signal=True for rules that infer "bot" purely from CONTENT SHAPE
    (typing speed, closing-question phrasing) rather than an actual bot
    fingerprint (menu, template, self-identification) — a human pasting a
    saved reply produces the exact same shape, so these rules can't rule out
    a genuine person the way a real menu/template match can. Used by the
    hibrido mixed-signal aggregation in database.py to avoid promoting a
    conversation to "hibrido" off a single soft-signal message when the same
    conversation already shows clearly human-paced timing elsewhere (real
    case: Grupo Hakkasan, 2026-09-17 — a 22-minute reply gap on one message,
    a fast pasted-looking brochure on another, same person)."""
    return {
        "category": category,
        "is_ai": is_ai,
        "ai_confidence": 0.0,
        "svc_prof": 1, "svc_comp": 1, "svc_empa": 1,
        "svc_solu": 1, "svc_next": 1, "svc_proact": 1,
        "response_quality": 1,
        "bot_quality": None,
        "lead_signal": None,
        "notes": notes,
        "conversation_analysis": False,
        "quick_classified": True,  # marks that this skipped the LLM, for auditing
        "soft_signal": soft_signal,
    }


# Subset of _BOT_SELFID_MARKERS that implies a *conversational* AI (is_ai=True),
# not a simple IVR/flow bot. Session-management signals ("la sesión ha finalizado")
# and activation instructions are excluded — those are flow bots (is_ai=False).
_AI_ASSISTANT_MARKERS = re.compile(
    r'asistente (?:virtual|digital)|'
    r'\b(?:asesor|agente|ejecutivo|operador|reclutador|coordinador)\s+virtual\b|'
    r'soy\s+\w+[,.]?\s*tu\s+asistente|'
    r'\bsoy\b[^.!?\n]{0,45}\bvirtual\b|'
    r'inteligencia artificial',
    re.IGNORECASE,
)


def _quick_classify(inbound_body: str, reaction_time_min: float = None) -> dict | None:
    """Resolve the obvious cases with cheap rules. Returns None when the text needs
    real judgment — that residual is what actually reaches the LLM.

    Rule order matters: check bot_selfid and auto_reply before timing, since templates
    and self-identified bots are deterministic regardless of how long they took to arrive."""
    text = (inbound_body or "").strip()
    if not text:
        return None

    # ── Content-driven rules (timing irrelevant) ──────────────────────────────

    # vCard/file share (prospect sends a WhatsApp contact card or a document) —
    # always a human action, no matter how machine-generated the raw text looks.
    # The LLM used to see raw "BEGIN:VCARD\nVERSION:3.0\n..." or a bare filename
    # and guess "bot"/is_ai=true from how structured/machine-generated it looks
    # (observed live: Volkswagen del Centro's vCard, La Casona del Arco's PDF
    # filename — both 2026-09-17).
    if _is_vcard_or_file_share(text):
        if "BEGIN:VCARD" in text.upper():
            return _quick_result_unrated(
                "humano", "El prospecto compartió un contacto de WhatsApp (vCard) — acción humana, sin texto que evaluar"
            )
        return _quick_result_unrated(
            "humano", "El prospecto compartió un archivo — acción humana, sin texto que evaluar"
        )

    if _looks_like_menu(text):
        return _quick_result("bot", "Menú de opciones detectado por reglas — sin IA")

    # Bot self-identification ("soy tu asistente virtual", 🤖, etc.) — always deterministic.
    if _looks_like_bot_selfid(text):
        _is_conversational_ai = bool(_AI_ASSISTANT_MARKERS.search(text))
        return _quick_result("bot", "El mensaje dice ser un bot o una IA",
                             is_ai=_is_conversational_ai)

    # Auto-reply template (folio, "tu mensaje es importante", "horario de atención", etc.)
    # combined with an active human-connection offer → hybrid. A confirmed template
    # match (not just a shape-based guess) is hard evidence, so this is the
    # "hibrido_bot" flavor, not the ambiguous "hibrido_automatico" one (split
    # 2026-09-18 — see database.py's _mixed_signal_category for the full rationale).
    if _looks_like_auto_reply(text) and _looks_like_hybrid_offer(text):
        return _quick_result("hibrido_bot", "ACK automático + oferta activa de conexión con humano — sin IA")

    # Plain auto-reply template with no hybrid offer → bot.
    if _looks_like_auto_reply(text):
        return _quick_result("bot", "Plantilla de auto-respuesta detectada — sin IA")

    # Conversational AI without self-identification: substantial message ending with
    # a bifurcated closing question ("¿Te gustaría X o prefieres Y?") and no human
    # personality markers. LLM cannot distinguish this from an expert human, so we
    # apply the rule deterministically here and skip the LLM call.
    if (len(text) >= 80
            and _BIFURCATED_AI_CLOSE.search(text)
            and not _HUMAN_PERSONALITY_MARKERS.search(text)):
        return _quick_result("bot", "Cierre bifurcado de IA en mensaje sustancial — parece IA", is_ai=True, soft_signal=True)

    # Velocidad de tecleo imposible para un humano — cierre NO bifurcado (la regla
    # de arriba no lo atrapa) pero el mensaje es largo, específico (sin "déjame
    # verificar"/"creo que", sin coloquialismos) Y llegó implausiblemente rápido
    # para su longitud. Caso real de auditoría: 244 caracteres con precio exacto
    # en 15s = ~16 car/seg sostenido — ni el tecleo humano más rápido sostiene eso,
    # ni copiando/pegando una respuesta guardada (antes hay que leer el mensaje
    # entrante, decidir cuál pegar, y eso ya consume varios segundos). El umbral
    # (8 car/seg) se dejó deliberadamente holgado para no atrapar a un vendedor
    # humano rápido pegando una respuesta corta — solo dispara con mensajes largos
    # Y rápidos a la vez, la combinación que un humano no puede sostener.
    if reaction_time_min is not None and _typed_too_fast(text, reaction_time_min * 60):
        reaction_seconds = max(reaction_time_min * 60, 0.1)
        return _quick_result(
            "bot",
            f"Velocidad de tecleo imposible para humano ({len(text)} caracteres en {reaction_seconds:.0f}s) — parece IA",
            is_ai=True,
            soft_signal=True,
        )

    # ── Timing-only signal: never enough alone, LLM evaluates content ─────────
    # T1<10s was previously a blanket bot rule — removed. Speed is a hint, not proof.

    return None


def classify_response(inbound_body: str, outbound_body: str, reaction_time_min: float = None) -> dict:
    """Classify a single inbound reply using the outbound message as context.
    Cheap rules resolve the obvious cases first (see _quick_classify) — only
    genuine ambiguity spends an LLM call."""
    if not _has_real_text(inbound_body):
        stripped = (inbound_body or "").strip()
        if stripped in NON_TEXT_PLACEHOLDERS:
            # Audio/sticker/ubicación/contacto sin texto — un humano sí mandó algo real,
            # solo que no hay contenido que juzgar.
            return _quick_result_unrated("humano", "Respuesta multimedia sin texto — sin base para juzgar contenido")
        # message_body vacío sin ningún placeholder — no es una respuesta real, es un
        # registro fantasma (visto en prod: creado ms antes de nuestro propio outbound,
        # artefacto del paso de verificación de número previo al envío). Antes se
        # clasificaba "humano" por default, generando falsos positivos de "ya respondió".
        return _quick_result_unrated("sin_respuesta", "Registro entrante sin contenido — no se considera una respuesta real")

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
        result = _parse_llm_response(raw)
        return _apply_response_deterministic_corrections(result, inbound_body)
    except LLMQuotaExceeded:
        raise
    except Exception as e:
        import traceback
        log.error("classify_response failed: %s\n%s", e, traceback.format_exc())
        result = dict(_ERROR_RESULT)
        result["notes"] = "Error al clasificar"
        result["error"] = True
        if reaction_time_min is not None and reaction_time_min * 60 < 30:
            result["category"] = "bot"
        return result


def _apply_response_deterministic_corrections(result: dict, inbound_body: str) -> dict:
    """Post-LLM safety net for classify_response() — this per-message path had
    none before, unlike classify_conversation()/classify_conversation_and_save()
    which already correct the mirror-image mistake. Real production cases,
    2026-09-18 (company 6a919d3341a1232f02f0159a, all same day): "Grcs a ti",
    "va", "ya" all judged category=bot/is_ai=True with notes like "la respuesta
    fue automática... no hay interacción humana" — the LLM read terse, off-topic
    brevity as proof of automation even with zero actual bot fingerprint in the
    text (no menu, no template, no self-identification)."""
    if result.get("category") == "bot":
        text = (inbound_body or "").strip()
        has_bot_signal = _looks_like_menu(text) or _looks_like_auto_reply(text) or _looks_like_bot_selfid(text)
        has_human_signal = _looks_human_casual(text) or bool(_HUMAN_NAME_INTRO.search(text))
        if not has_bot_signal and has_human_signal:
            result = dict(result)
            result["category"] = "humano"
            result["is_ai"] = False
            result["notes"] = (
                (result.get("notes") or "").strip()
                + " — corregido: la respuesta es corta y casual sin ninguna señal de bot, "
                  "lo que contradice el análisis anterior."
            ).strip(" —")
    return result


def phone_last10(value) -> str:
    """Últimos 10 dígitos de un teléfono. Más de 13 dígitos no es un teléfono: es el
    identificador interno (LID) con que WhatsApp entrega muchos mensajes."""
    d = "".join(filter(str.isdigit, str(value or "")))
    return d[-10:] if 10 <= len(d) <= 13 else ""


def assign_thread_numbers(messages: list) -> list:
    """Marca cada mensaje con el número de su plática (`_num`): el teléfono, o — si un
    mensaje recibido llegó con LID — el número al que le escribimos justo antes, que es
    la plática que está contestando. `messages` en orden cronológico."""
    last_out = ""
    for m in messages:
        if m.get("direction") == "outbound":
            m["_num"] = phone_last10(m.get("to_number"))
            # Mazda Santa Anita (2026-10-06): un envío fallido entre dos que sí llegaron no
            # puede quedarse con la respuesta que llegó con LID.
            if m.get("status") != "failed":
                last_out = m["_num"]
        else:
            m["_num"] = phone_last10(m.get("from_number")) or last_out
    return messages


# Lo que intentamos mandar y falló no le llegó al negocio: no cuenta como mensaje nuestro.
# Caso real: Infiniti (2026-10-02) — un envío programado salió vacío y falló ("to and message
# required"); Timing lo tomó como nuestro primer mensaje y midió la respuesta 5 h después.
NOT_FAILED = {"status": {"$ne": "failed"}}


def drop_unanswered_threads(messages: list) -> list:
    """Quita lo que mandamos a números que nunca contestaron, si algún número sí contestó.
    Caso real: OH EXPRESS — le escribimos a 16 números; los primeros 40 mensajes eran
    puros "Hola" nuestros y la plática real quedaba fuera de lo que lee el clasificador."""
    assign_thread_numbers(messages)
    answered = {m["_num"] for m in messages if m.get("direction") == "inbound"}
    if not answered:
        return messages
    return [m for m in messages if m.get("direction") == "inbound" or m["_num"] in answered or not m["_num"]]


def _trace(trace: list | None, paso: str, detalle: str) -> None:
    """Agrega un paso legible al log de cómo se llegó al resultado (ver
    classification_compare.py — real ask 2026-10-05: ver cómo decide cada algoritmo)."""
    if trace is not None:
        trace.append({"paso": paso, "detalle": detalle})


_THREAD_LINE_RE = re.compile(r"^\[(Representante|Prospecto)(?: \[(.*?)\])?\]: (.*)$", re.DOTALL)


def thread_items(lines: list, secs: list | None = None) -> list:
    """Las líneas del hilo que recibe la IA, en forma de lista para mostrarlas en el log
    ("Lo que recibió la IA"): quién escribió, cuánto tardó y el texto (recortado). secs: los
    segundos exactos de cada línea (alineados con lines) — la etiqueta para la IA los redondea."""
    items = []
    for i, line in enumerate(lines):
        m = _THREAD_LINE_RE.match(line)
        if not m:
            continue
        role, note, text = m.groups()
        t = ""
        exact = secs[i] if secs and i < len(secs) else None
        if exact is not None:
            t = ("⚡ " if note and "⚡" in note else "") + _fmt_elapsed(exact)
        elif note:
            num = re.search(r"(\d+)\s*(s|min)", note)
            t = (("⚡ " if "⚡" in note else "") + (f"{num.group(1)} {num.group(2)}" if num else "")).strip()
        items.append({"de": "Nosotros" if role == "Representante" else "Negocio", "t": t,
                      "texto": text if len(text) <= 300 else text[:300] + "…"})
    return items


def _fmt_elapsed(seconds: float) -> str:
    """Cuánto tardó, exacto y legible: "6 s", "1 min 10 s", "16 h 36 min", "2 días 5 h" — no "996 min"."""
    s = max(0, int(round(seconds)))
    if s < 60:
        return f"{s} s"
    m, s = divmod(s, 60)
    if m < 60:
        return f"{m} min {s} s" if s else f"{m} min"
    h, m = divmod(m, 60)
    if h < 24:
        return f"{h} h {m} min" if m else f"{h} h"
    d, h = divmod(h, 24)
    days = f"{d} día" if d == 1 else f"{d} días"
    return f"{days} {h} h" if h else days


def _fmt_secs(seconds: float) -> str:
    """La misma duración que el ejemplo de Timing + IA. 80 s es "1 min 20 s", no "1 min"
    (Autostar, 2026-10-06: el log de Timing redondeaba 80.4 s a "1 min")."""
    return _fmt_elapsed(seconds)


def verdict_label(category: str | None, is_ai: bool | None = None) -> str:
    """Nombre para personas de una categoría del clasificador."""
    if category == "bot":
        return "Agente IA" if is_ai else "Bot"
    return {
        "humano": "Humano", "hibrido": "Bot + Humano", "hibrido_bot": "Bot + Humano",
        "hibrido_automatico": "Automático + Humano", "automatico": "Automático + Humano",
        "sin_respuesta": "Sin respuesta", "menu": "Bot", "automatico_sin_respuesta": "Automático + Sin respuesta",
    }.get(category or "", category or "Sin definir")


# Categorías del prompt de conversación completa (la taxonomía de Análisis, real ask
# 2026-10-05) → (categoría guardada, is_ai). Las guardadas no cambian, así la lista, los
# filtros y el reporte siguen igual: "automatico" se muestra como Automático + Humano y
# "hibrido_bot" como Bot + Humano.
_CONV_CATEGORY_MAP = {
    "humano": ("humano", False),
    "automatico_humano": ("automatico", False),
    "automatico_sin_respuesta": ("automatico_sin_respuesta", False),
    "bot_humano": ("hibrido_bot", False),
    "bot": ("bot", False),
    "agente_ia": ("bot", True),
    "hibrido": ("hibrido_bot", False),   # respuesta con la taxonomía anterior
}


def _conv_category(raw: str) -> tuple | None:
    m = re.search(r'"category"\s*:\s*"([a-z_]+)"', raw or "")
    return _CONV_CATEGORY_MAP.get(m.group(1)) if m else None


# Las mismas palabras que el filtro de gas en Análisis. "energia" sin acento:
# el texto ya viene normalizado.
_GAS_INDUSTRY_RE = re.compile(r"\b(gas|lp|gasera|gaseras|gasolinera|energia)\b", re.IGNORECASE)
_AUTO_INDUSTRY_RE = re.compile(
    r"automotriz|automotrices|concesionari[oa]s?|agencias? de autos|\bautos\b",
    re.IGNORECASE,
)


def industry_profile(industry: str) -> str | None:
    """'gas', 'auto' o None. Sirve para pegarle al modelo la nota de ese giro."""
    import unicodedata
    norm = unicodedata.normalize("NFD", industry or "")
    norm = "".join(c for c in norm if unicodedata.category(c) != "Mn").lower()
    if _GAS_INDUSTRY_RE.search(norm):
        return "gas"
    if _AUTO_INDUSTRY_RE.search(norm):
        return "auto"
    return None


def _fold_industry(value: str) -> str:
    norm = unicodedata.normalize("NFD", value or "")
    norm = "".join(c for c in norm if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", norm).strip().lower()


def industry_note_text(industry: str, notes: dict | None) -> str:
    """La plantilla de este giro. Una lista guardada reemplaza las de siempre.
    Si todavía no hay lista, gas y automotriz usan el texto actual."""
    from app.database import DEFAULT_INDUSTRY_NOTES
    notes = notes or {}
    templates = notes.get("industry_templates")
    if isinstance(templates, list):
        return _text_for_industry(industry, templates)[:800]
    profile = industry_profile(industry)
    key = {"gas": "note_gas", "auto": "note_automotriz"}.get(profile or "")
    if not key:
        return ""
    custom = str(notes.get(key) or "").strip()
    return (custom or DEFAULT_INDUSTRY_NOTES[key])[:800]


def _text_for_industry(industry: str, templates: list) -> str:
    """Una sola plantilla: la de la misma industria de Prospectos. Si la empresa trae
    una industria vieja escrita a mano ("Agencia de autos"), cae al giro gas/auto
    (2026-10-07). "Servicios" no debe tomar la de "Servicios del Hogar": por eso es
    igualdad y no búsqueda de palabras."""
    profile = industry_profile(industry)
    norm = _fold_industry(industry)
    best_text, best_score = "", -1
    for item in templates:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        label = _fold_industry(str(item.get("industry") or ""))
        score = 0
        if label and label == norm:
            score = 100
        else:
            tmatch = item.get("match") or industry_profile(str(item.get("industry") or ""))
            if tmatch and tmatch == profile:
                score = 10
        if score > best_score and score > 0:
            best_score = score
            best_text = text
    return best_text


def _pct_bounds(raw_a: str, raw_b: str) -> tuple[int, int]:
    """Dos números a un piso y un techo entre 0 y 100. 0.62 cuenta como 62%."""
    a, b = float(raw_a), float(raw_b)
    if max(a, b) <= 1 and ("." in raw_a or "." in raw_b):
        a, b = a * 100, b * 100
    lo, hi = sorted((int(round(a)), int(round(b))))
    return max(0, min(100, lo)), max(0, min(100, hi))


def parecido_exacto(lo: int, hi: int) -> int:
    """Un solo porcentaje, el centro del piso y el techo. 88 y 96 dan 92.
    No es otro número que inventa el modelo (Análisis, 2026-10-07)."""
    return int(round((int(lo) + int(hi)) / 2))


def parse_rango(raw: str) -> dict | None:
    """Piso y techo (0-100) del formato viejo, cuando el intervalo venía en el
    mismo JSON de Timing + IA. Las corridas nuevas no lo piden ahí (2026-10-07)."""
    m = re.search(
        r'"rango"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]',
        raw or "",
    )
    if not m:
        return None
    lo, hi = _pct_bounds(m.group(1), m.group(2))
    return {"min": lo, "max": hi}


def parse_parecidos(raw: str) -> list[dict]:
    """Hasta tres parecidos de la petición aparte. Cada uno es una categoría y
    el intervalo de qué tanto se le parece el chat. Una categoría desconocida
    o repetida no entra. El más alto queda primero (Análisis, 2026-10-07)."""
    found = []
    seen = set()
    for blob in re.findall(r"\{[^{}]+\}", raw or ""):
        cat_m = re.search(r'"category"\s*:\s*"([a-z_]+)"', blob)
        min_m = re.search(r'"min"\s*:\s*(-?\d+(?:\.\d+)?)', blob)
        max_m = re.search(r'"max"\s*:\s*(-?\d+(?:\.\d+)?)', blob)
        if not (cat_m and min_m and max_m):
            continue
        mapped = _CONV_CATEGORY_MAP.get(cat_m.group(1))
        if not mapped or mapped in seen:
            continue
        seen.add(mapped)
        lo, hi = _pct_bounds(min_m.group(1), max_m.group(1))
        found.append({
            "category": mapped[0], "is_ai": mapped[1],
            "min": lo, "max": hi, "pct": parecido_exacto(lo, hi),
        })
    found.sort(key=lambda item: (-item["max"], -item["min"]))
    return found[:3]


_PARECI_PROMPT = """\
Eres un segundo analista. NO eliges la categoría oficial del chat de {company_name} ({industry}).
Otra lectura ya hizo eso. Tú solo dices qué tanto se PARECE esta conversación a cada tipo,
porque un chat mixto puede verse como una persona y como una IA a la vez y eso engaña.

CONVERSACIÓN:
{thread}

Tipos, con estos nombres exactos:
  "humano" — una persona escribió todo.
  "automatico_humano" — hubo un aviso automático y después escribió una persona.
  "automatico_sin_respuesta" — solo avisos automáticos, nadie escribió después.
  "bot_humano" — primero un menú o un flujo y después una persona.
  "bot" — menú o flujo fijo, sin persona.
  "agente_ia" — una IA conversacional de principio a fin.

Devuelve de 1 a 3 parecidos, los que de verdad compiten. Si el caso es claro, uno solo,
con un intervalo alto y estrecho (por ejemplo 88 y 96). Si está mixto, cada tipo que
compite con su propio piso y techo: no inventes un tercero para llenar. Cada intervalo
es independiente; no tienen que sumar 100. Enteros de 0 a 100.

Responde SOLO con JSON:
{{"parecidos":[{{"category":"humano","min":55,"max":75}}]}}
"""


def score_parecido(thread: str, company_name: str = "", industry: str = "") -> dict:
    """Petición aparte de Timing + IA. Su log no se mezcla con el de la categoría
    (Análisis, 2026-10-07): el intervalo dice parecido, no el veredicto."""
    from app.config import CLASSIFIER_MODEL
    trace = [{"paso": "Petición aparte",
              "detalle": "No decide la categoría del reporte. Mide qué tanto se parece el chat "
                         "a una clasificación, o a varias si el caso está mixto."}]
    if not (thread or "").strip():
        trace.append({"paso": "Sin consultar al modelo", "detalle": "No hay conversación que medir."})
        return {"items": [], "trace": trace, "model": None}
    def _esc(s: str) -> str:
        return s.replace("{", "{{").replace("}", "}}")
    prompt = _PARECI_PROMPT.format(
        company_name=_esc(company_name or "la empresa"),
        industry=_esc(industry or "desconocido"),
        thread=_esc(thread),
    )
    # La misma nota del giro que lee Timing + IA: si no, el parecido contradice la
    # plantilla (gaseras con precio guardado de una persona, 2026-10-07).
    try:
        giro = industry_note_text(industry, MongoDBManager().get_classifier_notes())
    except Exception:
        giro = ""
    if giro:
        safe = giro.replace("{", "(").replace("}", ")")
        prompt = "NOTA DEL EQUIPO PARA ESTE GIRO:\n" + safe + "\n\n" + prompt
        trace.append({"paso": "Nota del giro", "detalle": f"Usó la plantilla de {industry}."})
    try:
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=220)
    except LLMQuotaExceeded:
        raise
    except Exception as e:
        trace.append({"paso": "Consulta al modelo", "detalle": f"Falló: {e}"})
        return {"items": [], "trace": trace, "model": CLASSIFIER_MODEL, "error": True}
    items = parse_parecidos(raw)
    if not items:
        trace.append({"paso": "Respuesta", "detalle": "El modelo no devolvió un parecido usable."})
    elif len(items) == 1:
        it = items[0]
        trace.append({"paso": "Un solo parecido",
                      "detalle": f"Se parece a {verdict_label(it['category'], it['is_ai'])} "
                                 f"en {it['pct']}%, el centro de {it['min']}% y {it['max']}%."})
    else:
        bits = ", ".join(
            f"{verdict_label(it['category'], it['is_ai'])} {it['pct']}% "
            f"(centro de {it['min']}% y {it['max']}%)" for it in items
        )
        trace.append({"paso": "Varios parecidos",
                      "detalle": f"El chat está mixto. Cada porcentaje es el centro de su piso y su techo. {bits}."})
    return {"items": items, "trace": trace, "model": CLASSIFIER_MODEL}


def classify_conversation(company_id: str, company_name: str = "", industry: str = "",
                          trace: list | None = None, messages: list | None = None,
                          with_thread: bool = False) -> dict:
    """Analyze the full message thread for a company after an AI session closes.
    Fetches all messages from message_logs and builds a complete conversation view."""
    from app.llm import active_provider
    if active_provider() == "none":
        return dict(_ERROR_RESULT)
    if all_quota_exhausted():
        raise LLMQuotaExceeded("Circuit breaker activo — DeepSeek sin cuota.")

    db = MongoDBManager()
    # messages: la plática ya armada (la de un solo número, en empresas con varios —
    # comparación por número en Análisis, ver classification_compare.py).
    if messages is None:
        messages = drop_unanswered_threads(list(db.db.message_logs.find(
            {"company_id": company_id, "direction": {"$in": ["inbound", "outbound"]}, **NOT_FAILED},
            {"direction": 1, "message_body": 1, "sent_by_name": 1, "created_at": 1, "to_number": 1, "from_number": 1},
            sort=[("created_at", 1)],
        )))
    messages = messages[:40]
    if not messages:
        return dict(_ERROR_RESULT)

    # Vacío, anterior a lo que escribimos, o solo una campaña días después: no se le pregunta
    # a la IA. OH EXPRESS, Gas LP Irapuato, Servi-Gas y Agencia Toyota (2026-10-06) salían
    # "humano" porque la regla "no hay evidencia automática" reescribía un hilo sin respuesta.
    no_reply = _no_reply_verdict(messages)
    if no_reply:
        _trace(trace, "No hubo contestación", no_reply["notes"])
        return no_reply

    lines, line_secs = [], []
    last_out_ts = None
    for m in messages:
        role = "Representante" if m["direction"] == "outbound" else "Prospecto"
        body = (m.get("message_body") or "").strip()
        if not body:
            continue

        # Cada mensaje del negocio lleva cuánto tardó desde nuestro último mensaje — no solo el
        # primero de cada tanda. Antes los demás iban sin tiempo y el prompt decía que "llegaron
        # seguidos": Infiniti (2026-10-06) — bienvenida automática a los 6 s y "Le atiende Sandra
        # López" un minuto después, que la IA no podía ver.
        timing_note = ""
        delta = None
        cur_ts = m.get("created_at")
        if m["direction"] == "inbound" and last_out_ts is not None and cur_ts is not None:
            try:
                delta = (cur_ts - last_out_ts).total_seconds()
                # Menos de 10s solo cuenta como autorespuesta si el texto es más largo de lo
                # que alguien teclea en ese tiempo. Caso real: Fame Querétaro (2026-10-02),
                # 100% humano — "Mucho gusto" a los 9s y "Muchas gracias!" a los 10s de una
                # persona que ya estaba en el chat se marcaban ⚡, el LLM concluyó "comenzó
                # con un bot" y la marca impedía que la corrección de abajo lo regresara a humano.
                if delta < 10 and len(body) / max(delta, 1) > _FAST_REPLY_MIN_CHARS_PER_SEC:
                    timing_note = f" [⚡ {delta:.0f}s — posible autorespuesta automática]"
                elif delta < 60:
                    timing_note = f" [~{delta:.0f}s]"
                else:
                    mins = int(delta // 60)
                    timing_note = f" [~{mins}min]"
            except Exception:
                delta = None
        if m["direction"] == "outbound":
            last_out_ts = cur_ts
        line_secs.append(delta)

        if body in NON_TEXT_PLACEHOLDERS or _looks_like_binary_blob(body):
            lines.append(f"[{role}{timing_note}]: (mensaje sin texto — audio/sticker/ubicación/contacto)")
            continue
        # vCards: el prospecto comparte un contacto — señal HUMANA, no de bot.
        if "BEGIN:VCARD" in body.upper():
            fn_match = re.search(r'FN:(.+)', body)
            vcard_label = fn_match.group(1).strip() if fn_match else ""
            desc = f"(compartió contacto de WhatsApp: '{vcard_label}')" if vcard_label else "(compartió un contacto de WhatsApp)"
            lines.append(f"[{role}{timing_note}]: {desc}")
            continue
        # Mismo caso que el vCard, pero con archivos — algunos canales guardan el
        # nombre del archivo tal cual en vez del placeholder "[document]" (real:
        # La Casona del Arco mandó un PDF de menú, el body era literalmente
        # "1o-menu-casona-11-ago-2026 (1).pdf") — sin este chequeo el LLM lo leía
        # como texto y adivinaba "bot" por lo estructurado que se ve un nombre de
        # archivo.
        if re.search(r'\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|mp4|mp3|ogg|opus)(\s*\(\d+\))?\s*$', body, re.IGNORECASE):
            lines.append(f"[{role}{timing_note}]: (compartió un archivo: '{body}')")
            continue
        lines.append(f"[{role}{timing_note}]: {body}")
    thread = "\n".join(lines)
    if trace is not None:
        n_in = sum(1 for m in messages if m["direction"] == "inbound")
        ignored = sum(1 for m in messages if m["direction"] == "inbound" and _is_ignorable_body(m.get("message_body")))
        _trace(trace, "Arma la conversación para la IA",
               f"{len(messages)} mensajes en orden — {len(messages) - n_in} nuestros y {n_in} del negocio — "
               "marcando quién escribió cada uno"
               + (f". Se dejaron fuera {ignored} mensajes vacíos o ilegibles." if ignored else "")
               + (" (solo los primeros 40)." if len(messages) >= 40 else "."))
        _timed = [s for s in line_secs if s is not None]
        _trace(trace, "Le agrega cuánto tardó cada respuesta",
               ("A cada mensaje del negocio le pone el tiempo desde nuestro último mensaje: "
                + ", ".join(_fmt_elapsed(s) for s in _timed)
                + f". Marca con ⚡ los que llegaron en menos de 10 s con más texto del que una persona escribe "
                  f"en ese tiempo: {thread.count('⚡')}.")
               if _timed else "No hay respuestas del negocio a las que se les pueda medir el tiempo.")
        trace.append({"paso": "Lo que recibió la IA",
                      "detalle": "La conversación tal cual se la pasamos, con el tiempo de cada mensaje del negocio.",
                      "hilo": thread_items(lines, line_secs)})

    def _esc(s: str) -> str:
        return s.replace("{", "{{").replace("}", "}}")
    prompt = _CONV_PROMPT_TEMPLATE.format(
        company_name=_esc(company_name or company_id),
        industry=_esc(industry or "desconocido"),
        thread=_esc(thread),
    )
    # Gas LP / agencias de autos (2026-10-07): el equipo puede dejar una nota por giro
    # en Clasificación. Se le pega al modelo solo si la industria coincide, y no
    # sustituye las reglas fijas de después.
    try:
        giro = industry_note_text(industry, db.get_classifier_notes())
    except Exception:
        giro = ""
    if giro:
        safe = giro.replace("{", "(").replace("}", ")")
        prompt = prompt.replace(
            "CONVERSACIÓN COMPLETA",
            "NOTA DEL EQUIPO PARA ESTE GIRO (aplícala junto con las reglas de abajo; "
            "no puede contradecir una regla fija):\n" + safe + "\n\nCONVERSACIÓN COMPLETA",
            1,
        )
        # Una plantilla de Fitness no debe decir "automotriz" en el log (2026-10-07).
        _trace(trace, "Nota del giro",
               f"Industria en Prospectos: {industry or 'desconocida'}. Nota del equipo: {safe[:160]}")
    try:
        # 450: con "notes" y el cierre, 350 a veces cortaba el JSON (2026-10-07).
        # El parecido no va en esta petición: es otra llamada, con su propio log.
        raw = _call_deepseek([{"role": "user", "content": prompt}], max_tokens=450)
        result = _parse_llm_response(raw)
        mapped = _conv_category(raw)
        if mapped:
            result["category"], result["is_ai"] = mapped
            if not mapped[1]:
                result["ai_confidence"] = 0.0
    except LLMQuotaExceeded:
        raise
    except Exception as e:
        import traceback
        log.error("classify_conversation failed for %s: %s\n%s", company_id, e, traceback.format_exc())
        _trace(trace, "Consulta al modelo", f"Falló: {e}")
        return {"category": "humano", "response_quality": 3, "bot_quality": None, "notes": "Error al analizar conversación", "error": True}

    from app.config import CLASSIFIER_MODEL
    _trace(trace, f"La IA ({CLASSIFIER_MODEL}) busca patrones y decide",
           "Con la conversación y los tiempos revisa menús, plantillas, textos repetidos, respuestas en segundos, "
           f"cambios de nombre y trato personal. Decide: {verdict_label(result.get('category'), result.get('is_ai'))}. "
           f"Su explicación: {result.get('notes') or '—'}")
    result = _apply_deterministic_corrections(result, messages, thread, trace)
    # La comparación pide el hilo para la petición de parecido. No se guarda en el mensaje.
    if with_thread and thread and not result.get("error") and result.get("category") != "sin_respuesta":
        result["_thread"] = thread
    return result


_VIRTUAL_ASSISTANT_RE = re.compile(
    r"\b(asistente|agente|reclutador|reclutadora|ejecutivo|ejecutiva)\s+virtual\b"
    r"|\basistente\s+digital\b|\bsoy (un|tu) (bot|chatbot)\b",
    re.IGNORECASE)

# Campos que se piden en una lista numerada de datos ("1.- Nombre completo 2.- Correo"):
# eso es una solicitud de datos, no un menú de opciones.
_DATA_FIELD_RE = re.compile(
    r"\b(nombre|apellidos?|correo|e-?mail|tel[eé]fono|celular|domicilio|direcci[oó]n|municipio|"
    r"n[uú]mero de serie|kilometraje|forma de pago)\b",
    re.IGNORECASE)


def _is_options_menu(text: str) -> bool:
    return _looks_like_menu(text) and len({m.lower() for m in _DATA_FIELD_RE.findall(text or "")}) < 2


_WORD_RE = re.compile(r"\w+")


def _all_business_templated(messages: list) -> bool:
    """Nada de lo que mandó el negocio lo escribió alguien: cada mensaje es un menú, un aviso
    automático o casi el mismo texto que otro suyo (la plantilla repetida cambiando solo el nombre:
    "¡Buen día! Antonio ¿En qué te podemos ayudar?" / "¡Buen día! Master ¿En qué…?")."""
    texts = [(m.get("message_body") or "").strip() for m in messages if m["direction"] == "inbound"]
    texts = [t for t in texts if t and t not in NON_TEXT_PLACEHOLDERS]
    if not texts:
        return False
    words = [set(_WORD_RE.findall(t.lower())) for t in texts]

    def templated(i, t):
        if _is_choice_menu(t) or _looks_like_auto_reply(t):
            return True
        a = words[i]
        return any(j != i and a and len(a & b) / len(a | b) >= 0.8 for j, b in enumerate(words))
    return all(templated(i, t) for i, t in enumerate(texts))


# Palabras que no cuentan para "retoma lo que preguntamos": saludo, cortesía y lo que cualquier
# aviso automático menciona (precios, horarios, disponibilidad).
_ECHO_STOPWORDS = set("""hola buenas buenos tardes noches gracias quiero quisiera saber tienen tiene cuales cuanto
cuesta precio precios disponible disponibles disponibilidad informacion favor ustedes puedes pueden podrian sobre
tambien horario horarios servicio servicios bueno claro perfecto genial""".split())


def _content_words(text: str) -> set:
    t = unicodedata.normalize("NFD", (text or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z]{5,}", t) if w not in _ECHO_STOPWORDS}


def _fast_contextual_replies(messages: list) -> bool:
    """2+ respuestas del negocio en ≤30 s, distintas, de 60+ caracteres, que no son plantilla ni
    menú, y que retoman lo que preguntamos ("sedanes", "seminuevos"): un agente de IA contestando,
    no un aviso automático, que no responde a lo que se le pregunta. Agente simulado "Carla"
    (2026-10-06): el modelo lo vio automatizado pero lo dejó en "Automático + Sin respuesta"."""
    pairs, prev = [], None
    for m in messages:
        if prev is not None and prev["direction"] == "outbound" and m["direction"] == "inbound":
            pairs.append((prev.get("message_body") or "", m.get("message_body") or ""))
        prev = m
    if sum(1 for q, a in pairs if _content_words(q) & _content_words(a)) < 2:
        return False
    timings = _business_reply_timings(messages)
    texts = [t for _, t in timings]
    return (len(timings) >= 2 and len(set(texts)) == len(texts) and all(s <= 30 for s, _ in timings)
            and all(len(t) >= 60 and not _looks_like_auto_reply(t) and not _is_choice_menu(t) for t in texts))


def _business_reply_timings(messages: list) -> list:
    """(segundos, texto) de la primera respuesta del negocio a cada mensaje nuestro — la que
    contesta directo. El hilo de la IA además le pone tiempo a los mensajes que le siguen."""
    out = []
    prev = None
    for m in messages:
        body = (m.get("message_body") or "").strip()
        if not body or _is_ignorable_body(body):
            continue
        if (prev is not None and prev["direction"] == "outbound" and m["direction"] == "inbound"
                and prev.get("created_at") and m.get("created_at")):
            seconds = (m["created_at"] - prev["created_at"]).total_seconds()
            if seconds >= 0:
                out.append((seconds, body))
        prev = m
    return out


def _person_wrote_after_auto_reply(messages: list) -> bool:
    """Después de un aviso automático llegó otro mensaje del negocio que no es plantilla, menú ni
    texto repetido, a su propio ritmo (10 s o más después del mensaje anterior, de quien sea, y no
    más rápido de lo que alguien teclea): alguien tomó la plática. Un aviso en dos partes llega en
    uno o dos segundos, y un bot contesta en segundos a lo que le escribimos.
    Fénix El Super de Casa (2026-10-06): "En un momento un agente te brindará ayuda" a los 12 s y
    "Buenas tardes" 14 s después — salía Automático + Sin respuesta."""
    thread = [m for m in messages if (m.get("message_body") or "").strip()]
    bodies = [(m.get("message_body") or "").strip() for m in thread if m["direction"] == "inbound"]
    seen_auto, prev_at = False, None
    for m in thread:
        at, body = m.get("created_at"), (m.get("message_body") or "").strip()
        if m["direction"] != "inbound":
            prev_at = at
            continue
        if seen_auto and prev_at and at:
            gap = (at - prev_at).total_seconds()
            if (gap >= 10 and _is_plain_text(body) and not _typed_too_fast(body, gap) and bodies.count(body) == 1
                    and not (_looks_like_auto_reply(body) or _looks_like_menu(body) or _is_choice_menu(body)
                             or _strong_bot_selfid(body))):
                return True
        seen_auto = seen_auto or _looks_like_auto_reply(body)
        prev_at = at
    return False


# Más que esto en contestar nuestro primer mensaje no es una bienvenida ni un aviso automático
# (esos llegan en segundos). Autostar (2026-10-06): Kimberly saludó a los 80 s con la plantilla
# guardada de la agencia y después escribió "si clar"; con 120 s ese chat se quedaba automático.
_SLOW_FIRST_REPLY_SEC = 60


def _answers_each_message_in_seconds(messages: list) -> bool:
    """Contestó en segundos (≤30 s) al menos dos mensajes nuestros, con respuestas distintas que
    no son menú ni aviso automático: entiende lo que le escriben, no sigue un flujo fijo."""
    timings = _business_reply_timings(messages)
    texts = [t for _, t in timings]
    free = [t for t in texts if len(t) >= 60 and not _is_choice_menu(t) and not _looks_like_auto_reply(t)]
    return (len(timings) >= 2 and len(set(texts)) == len(texts) and all(s <= 30 for s, _ in timings)
            and len(free) >= 2)


def _apply_deterministic_corrections(result: dict, messages: list, thread: str,
                                     trace: list | None = None) -> dict:
    """Post-LLM safety net for classify_conversation() — pure function of the
    LLM's parsed result plus the conversation data (no network/DB), so it's
    directly unit-testable without mocking the LLM call itself."""
    # OH EXPRESS, Gas LP Irapuato, Servi-Gas y Agencia Toyota (2026-10-06): un hilo vacío, un
    # mensaje anterior al nuestro, o solo una campaña días después no es una persona. Esta
    # regla va primero para que "no hay evidencia de algo automático" no lo reescriba a humano.
    no_reply = _no_reply_verdict(messages)
    if no_reply:
        result.update(no_reply)
        # El intervalo era de la categoría que había elegido la IA. Sin contestación
        # esa categoría ya no queda, y mostrar el rango al lado mentiría.
        result.pop("rango", None)
        _trace(trace, "Corrección fija: el negocio no contestó", no_reply["notes"])
        return result

    # Simulaciones adversariales (2026-10-06): gpt-4.1-mini puede llamar "Humano" incluso
    # a un único "recibimos tu mensaje / fuera de horario" llegado en 2-9 segundos. Si TODOS
    # los textos son avisos reconocibles y cada uno llegó en menos de un minuto, no existe
    # evidencia de que una persona haya escrito. El límite evita convertir en automático un
    # saludo guardado que alguien mandó minutos después (Autostar / Toyota Baja California).
    if result.get("category") == "humano":
        inbound_bodies = [
            (m.get("message_body") or "").strip()
            for m in messages
            if m.get("direction") == "inbound" and (m.get("message_body") or "").strip()
        ]
        timings = _business_reply_timings(messages)
        if (inbound_bodies and len(timings) == len(inbound_bodies)
                and all(s <= _SLOW_FIRST_REPLY_SEC for s, _ in timings)
                and all(_looks_like_auto_reply(body) for body in inbound_bodies)):
            result["category"] = "automatico_sin_respuesta"
            result["is_ai"] = False
            result["notes"] = (
                "Solo llegaron avisos automáticos en menos de un minuto; ninguna persona contestó."
            )
            _trace(trace, "Corrección fija: solo llegaron avisos automáticos", result["notes"])

    # Agente de IA conversacional de principio a fin que el LLM confunde con "bot +
    # humano". Caso real: Nissan Autocom Querétaro La Capilla (2026-10-04) — "Carla,
    # asesora de ventas" y 15s después "Martina, asistente de PostVenta"; agendó una
    # cita y siguió contestando cada despedida. Las 18 respuestas llegaron en 1-31s,
    # varias de 100-420 caracteres, y el LLM leyó el cambio de nombre como traspaso a
    # una persona. Un traspaso real tarda minutos: si TODAS las respuestas llegaron en
    # menos de un minuto y también en la segunda mitad hay mensajes largos imposibles
    # de teclear a esa velocidad (no solo un saludo automático al inicio, que sí puede
    # ir seguido de una persona rápida), no hubo fase humana.
    if result.get("category") in ("hibrido", "hibrido_bot", "automatico"):
        timings = _business_reply_timings(messages)
        fast = [i for i, (s, t) in enumerate(timings) if _is_plain_text(t) and _typed_too_fast(t, s)]
        if (len(timings) >= 4 and len(fast) >= 2 and fast[-1] >= len(timings) // 2
                and max(s for s, _ in timings) <= 60):
            # Un bot de menús o botones también contesta todo en segundos, pero no es un
            # Agente IA (caso real: Taboo Restaurant — "[Opciones: Cancún | CDMX | …]").
            texts = [t for _, t in timings]
            flow_bot = any(_looks_like_menu(t) for t in texts) or len(texts) != len(set(texts))
            result["category"] = "bot"
            result["is_ai"] = not flow_bot
            result["lead_signal"] = 1 if result.get("lead_signal") is not None else None
            # Se reemplaza la nota en vez de anexarle la corrección: la del LLM narra el
            # traspaso a una persona que no existió, y esta nota sale tal cual en el reporte.
            result["notes"] = (
                f"Fue {'un bot de menús' if flow_bot else 'un agente de IA'} de principio a fin: "
                f"las {len(timings)} respuestas llegaron en menos de un minuto y {len(fast)} eran más "
                "largas de lo que alguien teclea a esa velocidad. No hubo traspaso a una persona."
            )
            _trace(trace, "Corrección fija: no hubo traspaso a una persona",
                   f"El modelo vio una persona, pero las {len(timings)} respuestas llegaron en menos de un minuto "
                   f"y {len(fast)} eran más largas de lo que alguien teclea a esa velocidad. Resultado: "
                   f"{verdict_label('bot', result['is_ai'])}"
                   + (" (usa menús o repite textos, no es IA conversacional)." if flow_bot else "."))
            return result

    # Todas las respuestas (2 o más) llegaron más rápido de lo que alguien teclea: no hay
    # rastro de una persona aunque el texto suene natural. Caso real: Universidad ESDIE
    # (2026-10) — "Sofía" contestó en 21 s y 14 s con 322 y 188 caracteres y siguió
    # escribiendo sola a intervalos exactos; el modelo lo leyó como persona por el tono
    # cálido. Solo cuando el modelo vio a una persona (humano, o automático/bot + humano):
    # en la revisión de 62 conversaciones reales ninguna persona cumplió esta condición.
    if result.get("category") in ("humano", "automatico", "hibrido_bot", "hibrido"):
        timings = _business_reply_timings(messages)
        if len(timings) >= 2 and all(_is_plain_text(t) and _typed_too_fast(t, s) for s, t in timings):
            texts = [t for _, t in timings]
            flow_bot = any(_looks_like_menu(t) for t in texts) or len(texts) != len(set(texts))
            result["category"] = "bot"
            result["is_ai"] = not flow_bot
            result["lead_signal"] = 1 if result.get("lead_signal") is not None else None
            result["notes"] = (
                f"Fue {'un bot de menús' if flow_bot else 'un agente de IA'}: las {len(timings)} respuestas "
                "llegaron más rápido de lo que alguien teclea, aunque el texto suene natural."
            )
            _trace(trace, "Corrección fija: ninguna respuesta la tecleó una persona",
                   f"El modelo vio una persona, pero las {len(timings)} respuestas llegaron más rápido de lo que "
                   f"alguien teclea. Resultado: {verdict_label('bot', result['is_ai'])}.")
            return result

    # Un solo mensaje del negocio no puede ser "algo automático y después una persona":
    # el modelo a veces lo dice de un saludo guardado ("Soy consultor digital de SEAT
    # FURIA… ¿Con quién tengo el gusto?", 19 h después). Se decide con lo que sí hay: si
    # llegó en un minuto o menos fue automático; si tardó más, lo mandó una persona. Un
    # menú o un asistente virtual lo resuelve la regla de abajo (→ Bot).
    if result.get("category") in ("automatico", "hibrido_bot", "hibrido"):
        business = [m for m in messages if m["direction"] == "inbound" and (m.get("message_body") or "").strip()]
        if len(business) == 1:
            timings = _business_reply_timings(messages)
            body = business[0]["message_body"]
            fast = bool(timings) and timings[0][0] <= 60
            if fast or _is_options_menu(body) or _VIRTUAL_ASSISTANT_RE.search(body):
                result["category"] = "automatico_sin_respuesta"
                porque = ("Llegó en un minuto o menos: fue automático." if fast else
                          "Es un menú o un asistente virtual.")
            else:
                result["category"] = "humano"
                porque = "Tardó más de un minuto: lo mandó una persona."
            result["is_ai"] = False
            result["notes"] = (
                "El negocio mandó un solo mensaje. " + porque
                + f" Resultado: {verdict_label(result['category'], False)}."
            )
            _trace(trace, "Corrección fija: el negocio mandó un solo mensaje",
                   "El modelo vio algo automático y después una persona, pero el negocio mandó un solo mensaje. "
                   + ("Llegó en un minuto o menos: fue automático." if fast else
                      "Tardó más de un minuto: lo mandó una persona." if result["category"] == "humano" else
                      "Es un menú o un asistente virtual.")
                   + f" Resultado: {verdict_label(result['category'], False)}.")

    # "Automático/Bot + Humano" sin ninguna persona: todo lo que mandó el negocio es un menú, un
    # aviso automático o la misma plantilla repetida, y hay un menú → es un bot. Caso real:
    # Nissan Vallejo (2026-10) — saludo con menú, a las 2 h "estamos buscando a un agente
    # disponible", y otra vez el saludo y el menú; gpt-4.1-mini lo leyó como traspaso a una
    # persona que nunca escribió. Sin menú no se toca: "Le atiende Sandra López ¿con quién tengo
    # el gusto?" un minuto después puede ser Sandra pegando su saludo (Infiniti).
    if result.get("category") in ("automatico", "hibrido_bot", "hibrido"):
        business = [(m.get("message_body") or "") for m in messages if m["direction"] == "inbound"]
        if any(_is_choice_menu(t) for t in business) and _all_business_templated(messages):
            result["category"] = "bot"
            result["is_ai"] = False
            _trace(trace, "Corrección fija: ninguna persona escribió",
                   "El modelo vio que después contestó una persona, pero todo lo que mandó el negocio es un menú, "
                   "un aviso automático o la misma plantilla repetida. Resultado: Bot.")

    # "Automático + Sin respuesta" que en realidad es un agente de IA: contesta en segundos a cada
    # cosa que preguntamos, no manda un aviso fijo (ver _fast_contextual_replies).
    if result.get("category") == "automatico_sin_respuesta" and _fast_contextual_replies(messages):
        result["category"] = "bot"
        result["is_ai"] = True
        _trace(trace, "Corrección fija: contesta a lo que se le pregunta, en segundos",
               "El modelo vio solo avisos automáticos, pero el negocio contestó en segundos a cada cosa que "
               "preguntamos, con respuestas distintas y que retoman la pregunta. Resultado: Agente IA.")

    # "Automático + Sin respuesta" que en realidad es un bot: se presenta como asistente
    # virtual o manda un menú de opciones, o sea un flujo que espera que elijas algo, no un
    # aviso. Casos reales: Whirlpool México ("soy *Mateo* tu asistente virtual"), Mazda
    # ("soy el asistente digital de Mazda de México"), Hidrogas (menú "1.- Solicitar un
    # servicio 2.- Conocer nuestros servicios…" dos veces en segundos). Regex angosta a
    # propósito: "consultor/asesor digital" es el título de una persona; y una lista
    # numerada de datos ("1.- Nombre completo 2.- Correo", Audi Center Satélite) no es menú.
    if result.get("category") == "automatico_sin_respuesta":
        inbound_bodies = [(m.get("message_body") or "") for m in messages if m["direction"] == "inbound"]
        selfid = any(_VIRTUAL_ASSISTANT_RE.search(t) for t in inbound_bodies)
        # Un asistente virtual que contesta en segundos cada cosa que preguntamos, con respuestas
        # distintas, es un agente de IA, no un flujo fijo (simulación "Sofía", Gas Express Norte,
        # 2026-10-06: tres preguntas, tres respuestas en 4-15 s, y salía Bot).
        agent = selfid and _answers_each_message_in_seconds(messages)
        if selfid or any(_is_options_menu(t) for t in inbound_bodies):
            result["category"] = "bot"
            result["is_ai"] = agent
            _trace(trace, "Corrección fija: " + ("se presenta como asistente virtual" if selfid
                                                  else "manda un menú de opciones"),
                   "El modelo vio solo avisos automáticos, pero el negocio "
                   + ("se presenta como asistente virtual" if selfid else "manda un menú de opciones")
                   + (" y contestó en segundos cada cosa que preguntamos, con respuestas distintas. "
                      "Resultado: Agente IA." if agent else ", un flujo que espera respuesta. Resultado: Bot."))

    # "Automático + Sin respuesta" donde después del aviso sí escribió alguien: un mensaje que no es
    # plantilla ni menú, a su propio ritmo (ver _person_wrote_after_auto_reply).
    if result.get("category") == "automatico_sin_respuesta" and _person_wrote_after_auto_reply(messages):
        result["category"] = "automatico"
        result["is_ai"] = False
        _trace(trace, "Corrección fija: alguien escribió después del aviso",
               "El modelo vio solo avisos automáticos, pero después del aviso el negocio mandó otro mensaje "
               "que no es plantilla ni menú, a ritmo de persona. Resultado: Automático + Humano.")

    # El prompt le pide explícitamente al LLM "is_ai=false sin excepción" cuando solo
    # hubo bienvenida + silencio (ver _CONV_PROMPT_TEMPLATE), pero en producción se
    # encontraron varios casos reales donde el LLM marcó is_ai=true de todas formas.
    # Corrección determinista y barata (mismo patrón que el corrector de menú de
    # abajo): un bot conversacional real necesita más de UN texto distinto del lado
    # del NEGOCIO (direction="inbound" — ver el thread-builder de arriba: "inbound"
    # son las respuestas recibidas del negocio, "outbound" es lo que nosotros
    # mandamos; este filtro decía "outbound" y contaba nuestros propios mensajes de
    # sondeo, que casi siempre varían — por eso este corrector casi nunca disparaba
    # en producción pese a existir) — si todo lo que mandó el negocio fue una sola
    # plantilla (repetida o no), no hubo conversación real que evaluar como "IA".
    if result.get("category") == "bot" and result.get("is_ai"):
        business_texts = {
            (m.get("message_body") or "").strip()
            for m in messages
            if m["direction"] == "inbound"
            and (m.get("message_body") or "").strip()
            and (m.get("message_body") or "").strip() not in NON_TEXT_PLACEHOLDERS
        }
        # Aun con varios mensajes DISTINTOS del negocio, si TODOS son plantillas
        # reconocibles (auto-respuesta/ausencia) o demasiado cortos para mostrar
        # comprensión real ("diga", "Buenas tardes!") no hay evidencia de IA
        # conversacional — casos reales: Anuto, Grupo Alden, Gas Elena, Barbaro
        # (2026-09), todos con is_ai=true sobre plantillas de una o dos palabras.
        _MIN_SUBSTANTIVE_LEN = 20
        # _is_choice_menu y no _looks_like_menu: un agente de IA que enumera precios o datos
        # quedaba como "solo plantillas" (agente simulado, 2026-10-06).
        all_templated = bool(business_texts) and all(
            _is_choice_menu(t) or _looks_like_auto_reply(t) or len(t) < _MIN_SUBSTANTIVE_LEN
            for t in business_texts
        )
        if len(business_texts) <= 1 or all_templated:
            result["is_ai"] = False
            result["notes"] = (
                (result.get("notes") or "").strip()
                + " — corregido: no se detectó más de un mensaje sustantivo y no genérico "
                  "del negocio, no hay base para is_ai=true."
            ).strip(" —")
            _trace(trace, "Corrección fija: no es IA conversacional",
                   "El modelo dijo Agente IA, pero el negocio solo mandó plantillas, menús o un único texto. Resultado: Bot.")

    # Universidad UVM (2026-10-06): el mismo menú cada 20 min y, sin que volviéramos a escribir,
    # "Soy James, asesor educativo" y un pitch largo. Diesgas manda el menú y luego "a sus órdenes":
    # esos textos cortos no entran aquí.
    if _bot_drip_after_menu(messages):
        result["category"] = "bot"
        result["is_ai"] = False
        result["notes"] = ("El mismo menú se repitió y, sin que volviéramos a escribir, llegaron guiones "
                           "largos de un asesor. Eso es un bot, no una persona que tomó la plática.")
        _trace(trace, "Corrección fija: el menú siguió solo", result["notes"])
        return result

    # Corrección determinista adicional (2026-09-09): el LLM (DeepSeek) marca
    # "hibrido"/"bot" con relativa frecuencia basándose solo en el TONO formal de
    # un saludo inicial, aun con instrucciones explícitas en el prompt de no
    # hacerlo — mismo patrón de no-cumplimiento ya documentado para otras reglas
    # de este mismo prompt (ver REGLA DE ORO arriba). Si no hay NINGUNA evidencia
    # dura de automatización en los mensajes del prospecto (los mismos detectores
    # ya afinados para el flujo determinista T1/T2: menú, auto-respuesta,
    # autoidentificación como bot, o texto exacto repetido), no hay base real para
    # "hibrido"/"bot" — se corrige a "humano". Verificado en vivo (Ferra,
    # Casacravioto, ambas 100% humanas confirmadas): el LLM seguía diciendo
    # "hibrido" pese a que ninguna de estas señales aparece en el hilo real.
    if result.get("category") in ("hibrido", "hibrido_bot", "automatico", "automatico_sin_respuesta", "bot"):
        inbound_bodies = [
            (m.get("message_body") or "").strip()
            for m in messages
            if m["direction"] == "inbound" and (m.get("message_body") or "").strip()
        ]
        has_hard_signal = any(
            _looks_like_menu(b) or _looks_like_auto_reply(b) or _looks_like_bot_selfid(b)
            or _looks_like_formal_bdc_greeting(b)
            for b in inbound_bodies
        )
        # Whato CRM (2026-10-06): la primera respuesta tardó 14 h y en medio pegaron un precio
        # de 74 caracteres a los 0.7 s. Esa ⚡ sola no vuelve automático todo el chat.
        _paced = _business_reply_timings(messages)
        _slow_open = bool(_paced) and _paced[0][0] > _SLOW_FIRST_REPLY_SEC
        _machine = any(_is_plain_text(t) and _typed_too_fast(t, s) for s, t in _paced)
        _one_fast_paste = _slow_open and thread.count("⚡") <= 1 and not _machine
        has_fast_reply_flag = "⚡" in thread and not _one_fast_paste
        has_repeated_text = len(inbound_bodies) != len(set(inbound_bodies))
        # Respuestas largas más rápido de lo que alguien teclea (agente de IA que contesta en
        # 15-30 s, sin la marca ⚡ de los primeros 10 s — caso real: Universidad ESDIE).
        has_machine_speed = _machine
        if not has_hard_signal and not has_fast_reply_flag and not has_repeated_text and not has_machine_speed:
            result["category"] = "humano"
            result["is_ai"] = False
            # Whato CRM (2026-10-06): la nota del modelo decía que hubo una bienvenida
            # automática y debajo se le pegaba "corregido… es humano". En el reporte se leían
            # las dos cosas. La nota que se guarda es solo la corrección.
            result["notes"] = (
                "Nada contestó como sistema: no hay menú, aviso automático, asistente virtual "
                "ni una respuesta más rápida de lo que alguien teclea. Resultado: Humano."
            )
            _trace(trace, "Corrección fija: no hay evidencia de algo automático",
                   "El modelo vio algo automático, pero no hay menú, plantilla, autoidentificación de bot, "
                   "texto repetido ni respuesta más rápida de lo que alguien teclea. Resultado: Humano.")

    # AgendaPro (2026-10-06): la IA leyó todo como persona, pero primero llegaron avisos de
    # "fuera de horario" y después alguien contestó el pedicure.
    if result.get("category") == "humano" and _person_after_away_notice(messages):
        result["category"] = "automatico"
        result["is_ai"] = False
        result["notes"] = ("Primero llegaron avisos de fuera de horario y después escribió una persona. "
                           "Resultado: Automático + Humano.")
        _trace(trace, "Corrección fija: avisaron que no estaban y luego escribió alguien", result["notes"])

    # "Automático + Humano" donde nada contestó como sistema: la bienvenida de WhatsApp Business,
    # un aviso de ausencia o un bot contestan en segundos. Si la primera respuesta tardó más de un
    # minuto y ninguna llegó como sistema, los saludos con firma y los textos repetidos son
    # respuestas guardadas que manda una persona. Concesionario Toyota en Baja California
    # (2026-10-06): "Soy Chanely Zaragoza, tu consultor digital" a los 11 min. Autostar (2026-10-06):
    # el saludo de Kimberly a los 80 s. Un aviso de ausencia sí cuenta como sistema, aunque tarde
    # minutos en entregarse (AgendaPro), para no regresarlo a Humano.
    if result.get("category") in ("automatico", "hibrido_automatico"):
        replies = _business_reply_timings(messages)
        inbound_bodies = [(m.get("message_body") or "").strip() for m in messages if m["direction"] == "inbound"]
        slow_open = bool(replies) and replies[0][0] > _SLOW_FIRST_REPLY_SEC
        machine = any(_is_plain_text(t) and _typed_too_fast(t, s) for s, t in replies)
        one_fast_paste = slow_open and thread.count("⚡") <= 1 and not machine
        system_like = (
            (("⚡" in thread or machine) and not one_fast_paste)
            or any(_looks_like_menu(b) or _is_choice_menu(b) or _strong_bot_selfid(b)
                   or _VIRTUAL_ASSISTANT_RE.search(b) or _AWAY_RE.search(b)
                   for b in inbound_bodies if b))
        if slow_open and not system_like:
            result["category"] = "humano"
            result["is_ai"] = False
            result["notes"] = (
                f"Primera respuesta real: {_fmt_elapsed(replies[0][0])}. "
                "Nada contestó como un sistema: el saludo con firma y un texto corto pegado en medio "
                "son de una persona."
            )
            _trace(trace, "Corrección fija: nada contestó como sistema",
                   f"El modelo vio algo automático, pero la primera respuesta tardó {_fmt_elapsed(replies[0][0])} "
                   "y ninguna llegó como sistema. Resultado: Humano.")
    replies = _business_reply_timings(messages)
    if replies and result.get("category") != "sin_respuesta":
        fact = f"Primera respuesta real: {_fmt_elapsed(replies[0][0])}."
        notes = result.get("notes") or ""
        if "Primera respuesta real" not in notes:
            result["notes"] = (notes.strip() + " " + fact).strip()
    if trace is not None and not any(t["paso"].startswith("Corrección fija") for t in trace):
        _trace(trace, "Revisión con reglas fijas", "Ninguna regla cambió la decisión de la IA.")
    return result


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
        "lead_signal": None,
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
        def _esc(s: str) -> str:
            return s.replace("{", "{{").replace("}", "}}")
        prompt = _QUALITY_ONLY_PROMPT_TEMPLATE.format(
            outbound_body=_esc(outbound_body or "(sin texto)"),
            inbound_body=_esc(inbound_body or "(sin texto)"),
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
        def _esc(s: str) -> str:
            return s.replace("{", "{{").replace("}", "}}")
        prompt = _IS_AI_CONFIRM_PROMPT.format(t2=t2_threshold_seconds, text=_esc(text or "(sin texto)"))
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
            analysis = _quick_result("bot", f"Respondió con audio/imagen sin texto en {t2_seconds:.0f}s — no se pudo confirmar si es Agente IA")
            analysis["is_ai"] = True
        elif _looks_like_menu(reply_body or ""):
            analysis = _quick_result("bot", f"Mandó un menú de opciones, respondió en {t2_seconds:.0f}s")
            analysis["is_ai"] = False
        else:
            # category="bot" ya es determinista (T2 rápido, sin menú) — is_ai se
            # confirma aparte con una llamada de IA ligera que NO puede cambiar la
            # categoría, solo el matiz Agente IA vs. humano muy rápido.
            is_ai = _confirm_is_ai(reply_body, t2_threshold)
            analysis = _quick_result(
                "bot",
                f"Respondió muy rápido ({t2_seconds:.0f}s) y sin menú — "
                f"{'parece Agente IA' if is_ai else 'posible humano muy rápido'}"
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
            base_notes = f"Respondió al mensaje de seguimiento en {t2_seconds:.0f}s"

        # A vCard/file share is always a human action regardless of timing —
        # check it before any bot/hybrid signal so it can't be outweighed by how
        # "machine-generated" the raw text looks (same carve-out as
        # _quick_classify; this path had been missing it — real case: Grupo
        # Hakkasan's probe-resolved vCard reply, 2026-09-17).
        _probe_vcard_sample = reply_text if (reply_text and reply_text != original_text) else original_text
        if _is_vcard_or_file_share(_probe_vcard_sample):
            analysis = _quick_result_unrated(
                "humano", f"{base_notes} — el prospecto compartió un contacto o archivo, acción humana"
            )
        else:
            # El prospecto puede mandar más de un mensaje antes de que salga nuestro
            # 2do mensaje (Andy) — en ese caso reply_text es la respuesta MÁS RECIENTE,
            # con más información que original_text (la primera). Si esa última muestra
            # una señal fuerte de bot/híbrido (menú, auto-respuesta, se autoidentifica,
            # oferta de conexión con humano), pesa más que el estilo casual del primer
            # mensaje — antes se ignoraba por completo.
            #
            # But the message BEING probed (original_text) needs the same check too —
            # this used to only look at _rt, so a single-message probe (no distinct
            # second reply, _rt is None) never got its OWN text checked for an obvious
            # auto-reply template/menu/self-id, even when it plainly was one ("¡Hola!
            # Bienvenido a *Mazda Acueducto*...", "Horarios de atención: Lunes a...").
            # Found auditing today's classifier changes against production data — 9
            # real messages (BPartes, Diesgas, Mazda Acueducto, ISUZU Plasencia
            # Abastos, Audi Center Satélite, KIA Satélite, Fábricas Fermon) fell
            # through to the generic "automatico" fallback instead, 2026-09-17.
            _rt = reply_text if (bool(reply_text) and reply_text != original_text) else None
            _hybrid_sample = original_text if _looks_like_hybrid_offer(original_text) else (
                _rt if (_rt and _looks_like_hybrid_offer(_rt)) else None
            )
            _bot_sample = original_text if (
                _looks_like_menu(original_text) or _looks_like_bot_selfid(original_text) or _looks_like_auto_reply(original_text)
            ) else (
                _rt if (_rt and (_looks_like_menu(_rt) or _looks_like_bot_selfid(_rt) or _looks_like_auto_reply(_rt))) else None
            )
            if _hybrid_sample is not None:
                # Confirmed hybrid-offer pattern match (hard evidence) — "hibrido_bot"
                # flavor, same rationale as the equivalent rule in _quick_classify.
                analysis = _quick_result(
                    "hibrido_bot", f"{base_notes} — un mensaje ofrece conectar con un humano ('{_hybrid_sample[:30]}')"
                )
            elif _bot_sample is not None:
                analysis = _quick_result(
                    "bot", f"{base_notes} — un mensaje suena automático ('{_bot_sample[:30]}')"
                )
            elif _looks_human_casual(original_text) or (reply_text and reply_text != original_text and _looks_human_casual(reply_text)):
                sample = original_text if _looks_human_casual(original_text) else reply_text
                analysis = _quick_result_unrated(
                    "humano", f"{base_notes} — sin señal de bot, estilo humano informal ('{sample[:30]}')"
                )
            elif bool(_HUMAN_NAME_INTRO.search(original_text)) or (reply_text and bool(_HUMAN_NAME_INTRO.search(reply_text))):
                # "mi nombre es Emmanuel", "soy Juan, asesor" — persona real presentándose.
                # Sin este chequeo caía a "bot" porque el texto es largo (> 20 chars)
                # aunque no tenga ninguna señal de bot.
                sample = original_text if _HUMAN_NAME_INTRO.search(original_text) else reply_text
                analysis = _quick_result_unrated(
                    "humano", f"{base_notes} — presentación personal detectada ('{sample[:40]}')"
                )
            else:
                # No hard bot signal (menu/template/self-id) AND no human signal (casual
                # style, name intro) either — we genuinely don't have a fingerprint of an
                # actual chatbot mechanism here, so calling it "bot" ("Chatbot") overstates
                # what was actually detected. "automatico" is the honest label: doesn't
                # look human-driven, but we don't know what it actually is. Unrated (not
                # _quick_result) since there's no real content basis to score quality on.
                # Si venció la espera sin 2da respuesta, es "Automático + Sin respuesta":
                # contestó algo automático al instante y después nadie (real ask,
                # 2026-10-05 — antes caía en el mismo "automatico" que cuando sí
                # respondieron después).
                analysis = _quick_result_unrated("automatico_sin_respuesta" if timed_out else "automatico",
                                                 f"{base_notes} — sin señal clara de bot ni de humano")

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
                             inbound_body: str, received_at: datetime, throttle_minutes: int = 3):
    """Throttle-aware entry point used by the inbound webhooks (Evolution/WAHA/wwebjs,
    Wasender): if this company already has a full LLM classification within `throttle_minutes`,
    copy it onto this message instead of skipping it outright. Skipping used to leave
    the message with no `analysis_status` at all — permanently unclassified for any
    consumer that looks at individual messages.

    Copy is only done when the recent analysis used the LLM (not quick_classified). If the
    most recent classification was a quick rule (no content analysis), we always run the LLM
    on the new message so it gets proper content-aware classification."""
    from datetime import timedelta, timezone
    throttle_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=throttle_minutes)
    recent = db.db.message_logs.find_one(
        {"company_id": company_id, "direction": "inbound",
         "analysis_status": "done", "updated_at": {"$gte": throttle_cutoff}},
        sort=[("updated_at", -1)],
    )
    # Never overwrite a message that already has a full conversation analysis
    target = db.db.message_logs.find_one({"_id": __import__('bson').ObjectId(log_id)}, {"analysis": 1})
    if (target or {}).get("analysis", {}).get("conversation_analysis"):
        log.debug("classify_or_copy_recent: log_id=%s ya tiene conversation_analysis, skip", log_id)
        return
    recent_analysis = (recent or {}).get("analysis") if recent else None
    # Don't copy quick_classified (rule-only) analyses — they have no content judgment
    can_copy = recent_analysis and not recent_analysis.get("quick_classified")
    if can_copy:
        copied = dict(recent_analysis)
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
            {"_id": ObjectId(log_id)}, {"analysis_status": 1, "analysis": 1}
        )
        if (existing or {}).get("analysis_status") == "quota_exceeded":
            log.debug("classify_and_save: ya marcado quota_exceeded, skip log_id=%s", log_id)
            return
        if (existing or {}).get("analysis", {}).get("conversation_analysis"):
            log.debug("classify_and_save: ya tiene análisis de conversación completa, skip log_id=%s", log_id)
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
        # Cómo de viejo puede ser el outbound emparejado antes de que el hueco deje de
        # significar "tiempo de reacción" y pase a ser solo ruido. Casos reales de
        # producción confirmaron el problema: un company con 2 mensajes en total
        # (outbound "Hola" el 6 de julio, inbound "Seguimos atentos a su proceso..."
        # el 31 de agosto — 56 días después) reportaba reaction_time_min=80615.8
        # (1343h36m), un valor matemáticamente correcto pero sin ningún sentido como
        # métrica — ese inbound es una plantilla de seguimiento de CRM, no alguien
        # reaccionando rápido al contacto original. Auditoría sobre 49 empresas: todo
        # lo legítimo cae por debajo de ~9h; los únicos casos por encima de 24h (3 de
        # 49) resultaron ser exactamente este tipo de emparejamiento sin sentido —
        # hay margen limpio para cortar en 48h sin descartar ninguna reacción real.
        _STALE_REACTION_CUTOFF_SECONDS = 48 * 3600
        if last_outbound:
            outbound_body = last_outbound.get("message_body") or last_outbound.get("message_text") or ""
            last_sent_at = last_outbound.get("created_at")
            if last_sent_at and isinstance(last_sent_at, datetime):
                delta = received_at - last_sent_at
                raw_seconds = delta.total_seconds()
                minutes = round(raw_seconds / 60, 1)
                if minutes < 0 or raw_seconds > _STALE_REACTION_CUTOFF_SECONDS:
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
            analysis = _quick_result("bot", "Mandó un menú de opciones desde el primer mensaje")
        elif raw_seconds <= t1_threshold and _looks_like_bot_selfid(inbound_body):
            # El propio texto se autoidentifica como bot/IA ("soy tu asistente
            # virtual", 🤖, etc.) — señal más fuerte y barata que esperar 1h a ver
            # si llega un T2. No tiene caso meterlo al probe: ya sabemos qué es.
            analysis = _quick_result("bot", "El mensaje dice ser un bot o asistente virtual")
        elif raw_seconds <= t1_threshold and _looks_like_auto_reply(inbound_body):
            # Plantilla reconocible (folio, "tu mensaje es importante", horario de
            # atención, etc.) llegando casi al instante — mismo trato: determinista,
            # sin esperar al probe.
            analysis = _quick_result("bot", "El primer mensaje es una plantilla de respuesta automática")
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
                "bot", f"Tardó {raw_seconds:.0f}s en responder, pero el mensaje suena automático"
            )
        else:
            # T1 > umbral y sin señal determinista de bot en el contenido.
            # Se manda al LLM completo para que juzgue origen + calidad: el LLM
            # puede detectar bots de lenguaje natural (CRMs de respuesta lenta,
            # IVR con delay, IA conversacional sin auto-identificación) que las
            # reglas deterministas no pueden distinguir de un humano real.
            # Si el LLM no está disponible o falla, el fallback es "humano" sin
            # calificar — comportamiento conservador idéntico al anterior.
            from app.llm import active_provider
            if active_provider() == "none" or all_quota_exhausted():
                analysis = _quick_result_unrated(
                    "humano", f"Tardó {raw_seconds:.0f}s en responder — no se pudo analizar más a fondo, se asumió humano"
                )
            else:
                try:
                    analysis = classify_response(inbound_body, outbound_body, reaction_time_min)
                except LLMQuotaExceeded:
                    raise
                except Exception:
                    analysis = _quick_result_unrated(
                        "humano", f"Tardó {raw_seconds:.0f}s en responder — hubo un error al analizarlo, se asumió humano"
                    )

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


def _apply_last_message_corrections(analysis: dict, last_body: str, trace: list | None = None) -> dict:
    """Correcciones del veredicto de classify_conversation() según el último mensaje
    del negocio (al que se le adjunta). Separadas de classify_conversation_and_save()
    para que scripts/classifier_real_cases.py mida exactamente lo mismo que prod."""
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
    # Solo menú o "soy un bot": las frases de cortesía de plantilla ("gracias por
    # contactarnos") también las escribe una persona, y el LLM ya ve cuánto tardó cada
    # respuesta. Caso real: Luxe Hair (2026-06) contestó a las 2.8 h, punto por punto, con
    # "¡Muchas gracias por contactarnos!" al inicio y esto lo volteaba a Bot.
    if analysis.get("category") == "humano":
        try:
            if _looks_like_menu(last_body) or _strong_bot_selfid(last_body):
                analysis["category"] = "bot"
                analysis["is_ai"] = False
                analysis["notes"] = (
                    (analysis.get("notes") or "").strip()
                    + " — corregido: el último mensaje tiene un menú o se identifica "
                      "como bot, lo que contradice el análisis anterior."
                ).strip(" —")
                _trace(trace, "Corrección por el último mensaje",
                       "El veredicto era Humano, pero el último mensaje del negocio es un menú "
                       "o dice ser bot. Resultado: Bot.")
        except Exception:
            pass

    # Mirror-image of the correction above: the LLM's holistic read of the
    # whole thread can also err the other way, calling it "bot" off a
    # generically terse/repetitive-looking exchange even though the message
    # this verdict attaches to is a short, casual, unsigned human reply with
    # no bot fingerprint at all. Real case: Anuto, 2026-08-12 — the prospect
    # first hit the wrong business's auto-greeting bot, then a person replied
    # "hola" / "buenas tardes" / "digame" / "diga", and the holistic call
    # judged the whole thread "comportamiento automatizado... no hay
    # interacción humana clara" off that brevity alone.
    elif analysis.get("category") == "bot":
        try:
            # Solo un menú de verdad (pide escoger): un agente de IA que termina pidiendo tus datos
            # en lista numerada pasaba a Bot (agente simulado, 2026-10-06).
            is_menu_or_template = _is_choice_menu(last_body) or _looks_like_auto_reply(last_body)
            is_ai_selfid = _looks_like_bot_selfid(last_body) and bool(_AI_ASSISTANT_MARKERS.search(last_body))
            has_bot_signal = is_menu_or_template or _looks_like_bot_selfid(last_body)
            has_human_signal = _looks_human_casual(last_body) or bool(_HUMAN_NAME_INTRO.search(last_body))
            if not has_bot_signal and has_human_signal:
                # Hubo algo automático (por eso el modelo dijo Bot) y al final escribió una
                # persona: Automático + Humano. Antes se pasaba a "humano" a secas y se
                # perdía la parte automática (Diesgas, 2026-10-05).
                analysis["category"] = "automatico"
                analysis["is_ai"] = False
                analysis["notes"] = (
                    (analysis.get("notes") or "").strip()
                    + " — corregido: el último mensaje es un saludo/respuesta corta y casual sin ninguna "
                      "señal de bot, lo que contradice el análisis anterior."
                ).strip(" —")
                _trace(trace, "Corrección por el último mensaje",
                       "El veredicto era Bot, pero el último mensaje del negocio es un saludo o respuesta corta "
                       "y casual de una persona. Resultado: Automático + Humano.")
            elif analysis.get("is_ai") and is_menu_or_template and not is_ai_selfid:
                # The LLM called it "Bot AI" but the message is just a deterministic
                # menu/template match, not a self-identified conversational AI — the
                # per-message quick rule for this exact text would say is_ai=False.
                # Real cases (all plain auto-reply templates flagged "Bot AI" by the
                # holistic call, 2026-09-18): Barbaro ("Gracias por tu mensaje... no
                # podemos responder"), Daltontoyota ("agradecemos su preferencia..."),
                # Gas Elena ("Gracias por comunicarte con Pipgas...").
                analysis["is_ai"] = False
                analysis["notes"] = (
                    (analysis.get("notes") or "").strip()
                    + " — corregido: el último mensaje es una plantilla/menú determinista sin "
                      "autoidentificarse como asistente de IA conversacional."
                ).strip(" —")
                _trace(trace, "Corrección por el último mensaje",
                       "El veredicto era Agente IA, pero el último mensaje del negocio es una plantilla o un menú "
                       "fijo. Resultado: Bot.")
        except Exception:
            pass
    return analysis


def classify_conversation_and_save(company_id: str, log_id: str, force: bool = False,
                                   trace: list | None = None, compare: bool = True) -> dict | None:
    """Analyze the full conversation thread and save the result on the given log_id.
    Called after an AI session closes — replaces any prior single-message analysis.

    Es el clasificador "Timing + IA". force=True vuelve a clasificar aunque ese mensaje
    ya tenga análisis completo (comparación a pedido desde Análisis). trace recibe el log
    paso a paso. compare=True corre además los clasificadores de Timing y solo IA y guarda
    la comparación de los tres (classification_compare.py). Devuelve el análisis guardado."""
    if trace is None:
        trace = []
    try:
        from bson import ObjectId
        db = MongoDBManager()

        # Idempotency guard — if a concurrent call already wrote the conversation
        # analysis for this log_id, skip to avoid a double LLM call and overwrite.
        if not force:
            try:
                _target = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"analysis.conversation_analysis": 1})
                if (_target or {}).get("analysis", {}).get("conversation_analysis"):
                    log.debug("classify_conversation_and_save: log_id=%s ya tiene conversation_analysis, skip", log_id)
                    return None
            except Exception:
                pass

        try:
            company = db.db.companies.find_one({"_id": ObjectId(company_id)}) or {}
        except Exception:
            company = {}
        company_name = company.get("name", "")
        industry = company.get("industry", "")

        analysis = classify_conversation(company_id, company_name, industry, trace=trace,
                                         with_thread=compare)

        try:
            _last = db.db.message_logs.find_one({"_id": ObjectId(log_id)}, {"message_body": 1})
            analysis = _apply_last_message_corrections(analysis, (_last or {}).get("message_body") or "", trace)
        except Exception:
            pass
        _trace(trace, "Resultado", verdict_label(analysis.get("category"), analysis.get("is_ai")))
        # El parecido no se guarda en el mensaje: es de la comparación, con su propio log.
        parecido = None
        if compare:
            from app.classification_compare import finish_parecido
            finish_parecido(analysis, company_name, industry)
            parecido = analysis.pop("parecido", None)

        analysis["classified_at"] = datetime.now().isoformat()
        analysis["pending_human_check"] = False
        db.save_message_analysis(log_id, analysis)
        log.info("classify_conversation_and_save: saved for company=%s log=%s", company_id, log_id)

        # When the full-conversation analysis determines "hibrido", retroactively
        # promote any prior "bot"-classified messages for this company so the
        # conversation view reflects the true arc (auto-response → human handoff).
        if analysis.get("category") in ("hibrido", "hibrido_bot"):
            try:
                result = db.db.message_logs.update_many(
                    {
                        "company_id": company_id,
                        "_id": {"$ne": ObjectId(log_id)},
                        "analysis.category": "bot",
                        "analysis_status": "done",
                    },
                    {
                        "$set": {
                            # Promoting confirmed "bot" records specifically — hard
                            # evidence, so "hibrido_bot", not the ambiguous
                            # "hibrido_automatico" flavor (split 2026-09-18).
                            "analysis.category": "hibrido_bot",
                            "analysis.conversation_analysis": True,
                            "analysis.notes": "Reclasificado retroactivamente: análisis completo detectó fases automática + humana.",
                        }
                    },
                )
                if result.modified_count:
                    log.info("classify_conversation_and_save: promoted %d bot→hibrido records for company=%s",
                             result.modified_count, company_id)
            except Exception:
                pass

        if compare:
            try:
                from app.classification_compare import save_comparison
                hybrid = dict(analysis)
                if parecido:
                    hybrid["parecido"] = parecido
                save_comparison(db, company_id, company, hybrid=hybrid, hybrid_trace=trace)
            except Exception as _ce:
                log.error("classify_conversation_and_save: comparison failed for %s: %s", company_id, _ce)
        # run_comparison vuelve a guardar la comparación con este dict. El mensaje ya se
        # guardó arriba, sin el parecido.
        if parecido:
            analysis["parecido"] = parecido
        return analysis
    except LLMQuotaExceeded:
        log.warning("classify_conversation_and_save: LLM sin cuota para company=%s", company_id)
    except Exception as _exc:
        import traceback
        log.error("classify_conversation_and_save failed for %s: %s\n%s", company_id, _exc, traceback.format_exc())
    return None


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
        # Lower bound: outbounds older than 7 days that still have no analysis are
        # unreachable by normal flow — cap the window so the scan stays O(recent sends)
        # instead of growing O(total sends) as old replied-to messages accumulate.
        outbound_lower = now - timedelta(days=7)
        outbounds = list(db.db.message_logs.find(
            {
                "direction": "outbound",
                "created_at": {"$gte": outbound_lower, "$lte": cutoff},
                "analysis": {"$exists": False},
            },
            {"_id": 1, "company_id": 1, "to_number": 1, "created_at": 1},
        ))

        for ob in outbounds:
            company_id = str(ob.get("company_id", ""))
            sent_at    = ob.get("created_at")
            to_number  = ob.get("to_number", "")
            _clean10   = "".join(filter(str.isdigit, to_number))[-10:] if to_number else None
            # Filter by phone number so a reply from contact A doesn't mask
            # an unanswered outbound sent to contact B under the same company.
            reply_filter: dict = {
                "company_id": company_id,
                "direction": "inbound",
                "created_at": {"$gt": sent_at},
            }
            if _clean10:
                reply_filter["from_number"] = {"$regex": _clean10}
            has_reply = db.db.message_logs.find_one(reply_filter)
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
