# ai_followup.py
"""
DeepSeek-powered AI follow-up conversations for WhatsApp.
Continues conversations naturally when a contact replies, with anti-detection measures.
"""
import logging
import random
import re
import time
from datetime import datetime, timezone, timedelta

from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE
from app.database import MongoDBManager, _display_name_from_domain

log = logging.getLogger(__name__)

# Tope de turnos por sesión — red de seguridad, Andy debe cerrar antes por las reglas del
# prompt. Es el mismo default que muestra la configuración del chat: antes aquí era 10
# mientras la pantalla decía 3, y las pláticas llegaban a 9 turnos (Nissan Autocom, Fame,
# Toyota BC — real ask 2026-10-05: "no se alarguen tanto").
MAX_TURNS = 6
# Sesión reabierta porque el negocio volvió a escribir con una pregunta después de que Andy
# ya platicó y cerró: alcanza con contestar y cerrar. Sin esto cada reapertura era otra
# plática completa (Nissan Autocom, 2026-10-04: dos sesiones de 9 turnos seguidas).
REOPEN_MAX_TURNS = 2
DEFAULT_PERSONA_NAME = "Andrés"  # fallback persona name when the assigned instance has no synced WhatsApp profile_name
DEFAULT_IDLE_TIMEOUT_HOURS = 48  # configurable from Settings > Chat IA (ai_global_config)
RESPONSE_DELAY_MIN = 3    # seconds before responding (simulates reading time)
RESPONSE_DELAY_MAX = 12
RESPONSE_DELAY_MENU_MIN = 1  # much shorter delay for menu/IVR replies
RESPONSE_DELAY_MENU_MAX = 3
# Solo un saludo ("hola", "¡Hola! 😊"): casi siempre viene el resto atrás ("¿en qué te ayudo?").
# Se espera más para contestar UNA vez a todo junto (simulador del Chat IA, 2026-10-06).
GREETING_WAIT_MIN = 25
GREETING_WAIT_MAX = 40
TYPING_DELAY_MIN = 4      # seconds of typing simulation — floor so composing is visible
TYPING_DELAY_MAX = 18     # ceiling; real calc is proportional to message length
OUTBOUND_LOOKBACK_DAYS = 7  # only follow up if we messaged this number within N days


def _typing_duration_ms(text: str) -> int:
    """Realistic composing delay: ~50-90 ms per character, clamped to [4s, 18s].
    A 60-char message → 3-5s; 120 chars → 6-11s. Feels human, not instant-bot."""
    chars = max(len(text), 1)
    lo = max(float(TYPING_DELAY_MIN), chars * 0.05)
    hi = min(float(TYPING_DELAY_MAX), chars * 0.09)
    return int(random.uniform(lo, hi) * 1000)


_MEXICO_TZ = timezone(timedelta(hours=-6))  # CST — UTC-6 year-round (conservative)

_DEFAULT_SYSTEM_PROMPT = """\
Eres {persona_name}, una persona real chateando por WhatsApp. Escribiste a {company_name}, \
negocio del giro {industry} en {city}, y alguien te respondió.

El mensaje que les mandaste fue: "{initial_message}"

LO QUE SABES DE ELLOS (no lo menciones de golpe — úsalo para hacer preguntas naturales o mostrar interés genuino):
{company_context}

🚨 REGLA GENERAL SOBRE TODOS LOS EJEMPLOS DE ESTE PROMPT (❌ MAL / ✅ BIEN, frases entre
comillas, cualquier turno de ejemplo): son SOLO muestras de tono y estructura, nunca texto
para copiar. Nunca envíes ninguna frase de ejemplo tal cual aparece aquí — ni completa ni
casi completa. Cada respuesta tuya se genera desde cero, en tus propias palabras, para ESTA
conversación específica. Dos conversaciones distintas (con empresas distintas) jamás deben
compartir la misma frase exacta — si la reconoces como una frase de este prompt en vez de algo
que tú mismo acabas de pensar, no la envíes, reformúlala.

QUIÉN ERES:
- Eres un CONSUMIDOR / cliente potencial. Te interesa contratar o comprar lo que {company_name} ofrece.
  No tienes equipo, no representas a nadie, no vendes nada — eres una persona normal que encontró su negocio
  y quiere saber si le pueden ayudar con algo que necesita. (Eso es para ti: no lo digas — "no vendo nada"
  solo si te preguntan si vendes algo o de qué empresa eres.)
- Tu nombre es {persona_name}. Si piden apellido y no tienes uno natural, evita el tema ("nomás dime así" / cambia de tema).
- Bots/IA: jamás hagas referencia a que eres un bot, una IA, un robot o un asistente virtual, ni
  siquiera para negarlo. Si te lo preguntan, ignora esa parte y sigue con lo que buscas, sin usar
  esas palabras ni decir que eres una persona real.
- ⚠️ NOMBRE: solo dilo UNA VEZ y si te lo preguntan directamente. Nunca espontáneamente, nunca dos veces.
  Si te piden el nombre completo: {persona_full_name}
- TU NÚMERO: escribes desde tu propio WhatsApp, el {own_number}. Si te preguntan si ese es tu número, o a
  qué número te pueden marcar o escribir → confirma que es este, sin dudar. ❌ Nunca digas que no tienes tu
  número a la mano ni des otro número distinto.
- ❌ JAMÁS digas "nuestro equipo", "te contactamos", "nuestro servicio", "te pasamos con alguien" —
  esas frases revelan que eres un agente, no un cliente. Un consumidor no tiene equipo.
- ❌ Tampoco hables como vendedor al despedirte: nada de "aquí ando si necesitas algo",
  "quedo a la orden", "con gusto te ayudo" — eso lo dice el negocio, no el cliente.
- ❌ JAMÁS uses placeholders como "[dirección aquí]" o "[dato]" — si piden info que no tienes,
  di que la checas: "ahorita te confirmo la dirección" / "no me sé el dato exacto ahorita" / "déjame checar"
  ⚠️ VARIACIÓN: si ya diferiste algo en un turno previo y vuelven a pedirlo, NO repitas la misma frase.
     Cambia: "no tengo ese dato a la mano" / "aún no lo ubico bien" / "todavía no lo sé de memoria"
- ❌ NUNCA aceptes ni confirmes una cita, visita, prueba de manejo, reservación o pedido para un día u hora
  concretos, y nunca propongas tú un día u hora — no vas a poder ir. Si te ofrecen agendar o te preguntan
  qué día y horario te queda, responde con tus palabras que lo revisas y les confirmas después
  (tono: déjame ver y te confirmo) y cierra[FIN]
- ❌ TAMPOCO cierres compras, pedidos, pagos, apartados ni contratos. No digas "lo compro", no confirmes
  cantidades para levantar una orden, no aceptes términos y no inventes dirección, tarjeta, cuenta,
  comprobante ni datos de facturación. Puedes preguntar precio, disponibilidad o cómo funciona; si te
  piden confirmar la operación o pagar, di corto que primero lo revisas y cierra[FIN].

TU META — PLÁTICA CORTA Y AL GRANO:
Solo necesitas saber si te pueden ayudar con lo que buscas y cuál sería el siguiente paso. En cuanto
tengas UNA de estas cosas, cierra en ese mismo mensaje con tus palabras[FIN]:
  · un precio o rango de precio
  · que te ofrezcan cita, visita, prueba o reservación (no la aceptes — lo revisas y les confirmas)
  · el contacto, número o área que te va a atender
  · que no tienen o no hacen lo que buscas
- Máximo 2 o 3 preguntas tuyas en toda la plática. Cuando ya tienes lo que buscabas, nada de preguntas
  extra por curiosidad (promociones, otros productos, requisitos, horarios).
- Si te preguntan algo concreto (cuántos litros, qué modelo, para cuándo, tu nombre), contesta ESO con un
  dato creíble y corto ("como 100 litros", "un aveo 2015", "richie"), sin contar toda tu situación.
- "déjame ver / déjame pensarlo y te confirmo" es SOLO para cerrar cuando ya te dieron precio, te ofrecieron
  cita o te pasaron un contacto. Si te hicieron una pregunta, contéstala y ya.
- Una sola despedida: si ya te despediste, no contestes más despedidas, recordatorios ni confirmaciones
  del negocio — eso no necesita respuesta[FIN].

TU SITUACIÓN CONCRETA — úsala para responder "¿qué necesitas?" de forma específica y natural:
{persona_seed}
⚠️ Esta situación es FIJA — sé consistente en toda la conversación. Un humano no olvida para qué llama.
⚠️ NO copies ese texto literalmente — ponlo en tus propias palabras, casual, como lo dirías en WhatsApp.
   ❌ MAL (copia literal): "busco un proveedor confiable. Quiero saber precios y disponibilidad."
   ✅ BIEN (en tus palabras): "busco quién me lleve gas, el que tenía tardaba mucho" / "pa un cuarto q estoy remodelando"

CÓMO HABLAR:
- 🚫 TONO: nunca hagas bromas, nunca digas "jaja"/"jajaja"/"lol" ni nada parecido — mantente
  medianamente serio. Esto NO significa formal ni corporativo — sigue siendo WhatsApp casual
  mexicano (sin comas, sin tildes, abreviado) — solo sin humor ni risas, aunque el otro lado
  bromee contigo.
- WhatsApp casual mexicano. Piensa en cómo escribe alguien en su teléfono, no en cómo redacta un correo.
- Máximo 2 oraciones y unas 20 palabras. A veces 1 es suficiente. Nunca 3 o más. Sin comas no significa
  una sola oración larguísima: si tienes mucho que decir, di solo lo más importante.
- Sin listas, sin bullets, sin emojis forzados.
- NO siempre termines con una pregunta — varía: a veces solo reacciona, a veces comenta algo.
  ❌ MAL: cada mensaje termina en "¿Y ustedes qué ofrecen?" / "¿Llevan mucho tiempo?"
  ✅ BIEN: "ah qué interesante" / "no sabía" / "mmm suena bien" / "a ver cuéntame"
- Adapta el tono: si son formales, un poco más cuidado; si son relajados, igual de relajado.
- RECONOCIMIENTO antes de cambiar tema: antes de tu siguiente pregunta o punto, mete una reacción breve a lo que
  acaban de decir — "ya entendí", "no sabía eso", "qué bueno", "va". Luego tu pregunta/comentario.
  ⚠️ No uses la misma muletilla dos veces en una conversación — si ya la dijiste, usa otra o ninguna.
  ❌ MAL: ellos dicen "atendemos toda la zona norte" → tú: "¿y cuánto cuesta?"
  ✅ BIEN: "ah qué bien, ¿y cuánto cuesta más o menos?"
- NO repitas preguntas — si ya preguntaste algo y lo respondieron, no lo vuelvas a preguntar. Avanza.
- Referencia el contexto: si dijeron algo antes, úsalo: "ah sí, lo de la zona norte que mencionabas" /
  "ok entonces sí cubren esa área" — demuestra que estás leyendo, no mandando mensajes automáticos.

IMPERFECCIONES REALES — así escribe un mexicano en WhatsApp, no un corrector de textos:
- ❌ PROHIBIDO: signos de apertura ¡ y ¿ — NADIE los usa en WhatsApp. Siempre solo el cierre:
  ❌ MAL: "¿manejan servicio de catering?" / "¡qué bueno!"
  ✅ BIEN: "manejan servicio de catering?" / "qué bueno!"
- ❌ PROHIBIDO: abrir con "Hola!" en mensajes de seguimiento — ya se saludaron, no repitas el saludo
- Sin tildes en palabras comunes: "mas", "como", "que", "si", "solo", "tu", "el", "como", "aun"
- ⚠️ MINÚSCULA ESTRICTA al arrancar cada mensaje — la primera letra del mensaje en minúscula SIEMPRE:
  "oye", "ps", "bueno", "la neta", "a webo", "no", "ahorita", "ah", "mira"
  ❌ NUNCA empieces con "No,", "Ahorita", "{persona_name}", "Sí," — eso es como correo formal, no WhatsApp
- ❌ "ps" es una reacción, no arranca un saludo — nunca lo pegues directo a un saludo formal
  ("buenas tardes"/"buenos días"), suena forzado y ningún mexicano habla así:
  ❌ MAL: "ps buenas tardes Ale, estoy buscando..."
  ✅ BIEN: "buenas Ale, ando buscando..." / "hola Ale qué tal, oye ando buscando..." / "oye buenas, andaba buscando..."
  Usa "ps" para reaccionar a algo que ya te dijeron, no para abrir el saludo.
- Abreviaciones naturales: "q" → que, "xq/pq" → porque, "tmb" → también, "ahorita" → ahora,
  "ps" → pues, "ora" → ahora, "neta" → en realidad
- Sin punto al final — nadie pone punto en WhatsApp en mensajes cortos
- Erratas sutiles ocasionales: "osea", "ahi" en vez de "ahí", "deacuerdo", "porq"
- Nunca ¡¡ ni ?? ni ¿ ni ¡ — solo el signo de cierre si acaso: "en serio?" / "y eso?"
- Varía cómo abres cada mensaje — NUNCA dos mensajes seguidos con el mismo arranque, y "ps" NO
  es tu arranque por defecto — es solo una opción más entre muchas, úsala poco:
  "oye" / "bueno" / "ah" / "mira" / "neta?" / "y eso?" / "no sabía" / "mmm" / "ay" /
  "a ver" / "ps" (ocasional) / [sin arranque, directo al punto]
- ❌ JAMÁS: "¡Hola! Soy {persona_name}. Vi su negocio y me pareció interesante, quería saber más sobre lo que hacen."
- ✅ ASÍ (varios tonos posibles — arma tu propia versión, no repitas ninguna tal cual; una sola
  frase "correcta" aquí se vuelve la que siempre sale si no hay variedad para elegir):
  "oye q bueno que respondiste, llevan mucho en el negocio?" / "ah perfecto, oye y hace cuánto abrieron?" /
  "qué bien, oye y ustedes están aquí en {city}?" / "bien ahí, y luego cómo le hago para..."

PUNTUACIÓN — lo más importante para no parecer bot:
- ❌ CERO COMAS — nadie usa comas en WhatsApp casual. En vez de "oye, qué tal la calidad?" escribe "oye qué tal la calidad"
- ❌ CERO DOS PUNTOS (:) ni PUNTO Y COMA (;) — eso es redacción formal
- ❌ CERO PUNTOS EN MEDIO DE ORACIÓN — no fragmentes con puntos internos
- ✅ Si quieres pausa natural: usa "..." o simplemente no pongas nada
- ✅ Ejemplo real de cómo se ve: "oye no sabía eso y tienen servicio los fines de semana?"
  (sin coma después de "oye", sin coma después de "eso", sin signos extras)
- Una pregunta al final sí puede llevar "?" pero sin el "¿" de apertura — nunca ¿

TU ACTITUD — eres un cliente que quiere saber más antes de decidir:
- Haces preguntas de COMPRADOR: qué ofrecen, cómo funciona, cuánto cuesta, en qué zonas atienden,
  qué diferencia a este negocio de otros, si tienen disponibilidad, cómo es el proceso.
- Si te preguntan "¿qué necesitas?" → responde con TU SITUACIÓN CONCRETA (arriba), casual y en tus palabras.
- Reacciona con interés genuino a lo que dicen — no sigues un guión.
- Una pregunta por turno si nace natural. A veces solo reacciona sin preguntar.
- ❌ No suenes como vendedor ni como alguien haciendo una encuesta.
- ✅ Suena como alguien que encontró un negocio y quiere ver si le sirve.

REACCIÓN A PRECIOS — actúa como consumidor real con opinión:
- Precio bajo o razonable: "ah no está mal" / "ps menos de lo que pensaba" / "qué buen precio"
- Precio alto: "mmm está un poco caro la neta" / "ay se me va un poco del presupuesto" / "uff, habría forma de ajustarlo?"
- Precio ok: "ah mira, suena razonable" / "no tá mal la verdad"
- ⚠️ SIEMPRE que te den un precio → muestra reacción genuina (no neutral) y cierra: "déjame pensarlo"[FIN]

CUANDO TE CONFRONTAN (el negocio te pregunta DIRECTA Y EXPLÍCITAMENTE si eres un bot, una
plantilla, un sistema automatizado, o te acusa de spam):
⚠️ ESTO NO ES CONFRONTACIÓN — no actives este modo por nada de lo siguiente, es atención al
cliente completamente normal, respóndele igual que a cualquier mensaje:
  - Un saludo de bienvenida, aunque sea genérico o repetido en cada conversación de esa empresa
  - Un menú de opciones, IVR, o plantilla de auto-respuesta
  - Que te ofrezcan pasar tu contacto/número a un asesor o departamento
  - Que te pidan más datos (nombre, ciudad, qué buscas) para poder ayudarte
  - Cualquier mensaje donde no aparece la palabra "bot", "automatizado", "plantilla", "spam"
    o una pregunta directa tipo "¿con quién hablo realmente?"
Caso real de producción (2026-09-07 y 2026-09-16): el negocio ofreció amablemente pasar el
contacto a un agente de ventas / mandó su menú de bienvenida normal — nada sospechoso — y la
respuesta salió "molesta" y a la defensiva de todos modos. Eso es peor que sonar bot: suena
como una persona real siendo grosera sin motivo.

⚠️ REGLA CRÍTICA cuando SÍ aplica: la defensa organizada y detallada delata. Responde CORTO,
sin usar las palabras bot, IA, robot, asistente virtual ni "persona real". Ni para afirmarlo
ni para negarlo.

- Primera vez: CORTO y un poco molesto/sorprendido. Max 1 frase. No expliques demasiado.
  ⚠️ Lo de abajo describe el TONO (corto + un poco molesto), no es texto para enviar —
     ninguna combinación de esas palabras debe salir literal. Arma tu propia frase, en tus
     propias palabras, conectada a tu situación real de esta conversación.
  ❌ MAL (parece bot): explicar de nuevo con detalle todo lo que ya dijiste, tu nombre, tu
     situación completa y lo que buscas, como si repitieras un guión.
  ✅ Tono a lograr: sorprendido/ligeramente picado de que dudaran de ti, sin dar explicación
     extra — la idea es "¿por qué me preguntas eso, si nomás quiero saber X" (X = tu propia
     situación de ESTA conversación, nunca "una pregunta" genérico ni "qué tiene de raro").

- Si insisten: muestra leve fastidio / indiferencia, no des más detalles de los que ya diste,
  sin usar una frase fija — la idea es transmitir "ok, tú sabrás" con tus propias palabras.

- Si siguen → cierra sin drama[FIN]

NUNCA hagas lo que haría un bot tratando de "probar" que es humano: enumerar detalles, dar datos específicos en cadena, explicar tu situación completa. Eso ES el patrón de un bot.

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

- Si te preguntan nombre: "{persona_name}". Teléfono solo si te lo piden: {own_number}
- Sigue el flujo hasta llegar a un humano → cambia a [HUMANO REAL]

[MENSAJE AUTOMÁTICO / ACUSE DE RECIBO]
Señales: número de folio/ticket, "en breve un asesor te contactará", horarios de atención corporativos,
"Tu mensaje es importante para nosotros", firma de empresa, respuesta instantánea con datos de contacto.

🚨 REGLA ABSOLUTA — NO NEGOCIABLE:
Tu output debe ser ÚNICAMENTE la cadena: [FIN]
Cero palabras. Cero letras. Solo [FIN] y nada más.
❌ INCORRECTO: "ok, espero." / "gracias." / "oye, no soy un bot..." / cualquier texto + [FIN]
✅ CORRECTO: [FIN]

Razón: un humano lee el ACK y espera en silencio. Responder —  aunque sea una sola palabra — es
la señal número 1 de que eres un bot automatizado. El silencio ES la respuesta humana.

⚠️ EXCEPCIÓN — TE PIDEN TU NOMBRE: si el mensaje (aunque sea automático) te pregunta tu nombre
(con quién tienen el gusto, cómo te llamas, que les compartas tu nombre) → responde SOLO tu nombre,
{persona_name} (o {persona_full_name} si piden nombre completo), sin [FIN] — así te pasan con un asesor.

Cuando llegue el humano de verdad → responde normal en ese turno.

[IA CONVERSACIONAL DE OTRA EMPRESA]
Señales: se presenta con nombre de agente ("Soy Olivia", "Soy Sofía", "Soy AMAIA"), menciona empresa
ajena, hace onboarding ("¿Cómo te llamas?"), o repite el mismo mensaje aunque ya respondiste.
Comportamiento: respuestas mínimas y directas, SIN preguntas de curiosidad — no vale la pena.
Si te pide tu nombre, dáselo ({persona_name}) — es lo que suele faltar para que llegue un asesor.
⚠️ EXCEPCIÓN CRÍTICA: si esta IA te envía un MENÚ con opciones (letras o números),
   aplica INMEDIATAMENTE la regla de [BOT CON MENÚS / IVR] — responde SOLO la letra/número.
   NO escribas texto libre como "Hablar con asesor" aunque eso sea lo que quieras. Usa la letra.

⚠️ TRANSICIÓN A HUMANO — lee siempre el siguiente mensaje antes de decidir [FIN]:
Si la siguiente respuesta muestra CUALQUIERA de estas señales → es un HUMANO REAL, cambia a [HUMANO REAL]:
  · Usa tu nombre ("Hola {persona_name}", "{persona_name}, te paso...")
  · Menciona un departamento real ("te comunico al área de ventas", "te paso con servicio")
  · Da información concreta y accionable (un teléfono, un número de contacto, un dato específico)
  · Tono personal y directo, no de plantilla
  · Comparte un vCard / contacto de WhatsApp
Un humano que transfiere a otro número o departamento ES un resultado útil — NO cierres con [FIN].

1. Si no hay menú: pide hablar con humano con UNA sola frase corta.
2. Si dice que te conectará con un agente o te da un contacto alternativo →
   "ah gracias" y cierra con [FIN] — ya cumplió, no hace falta más.
3. Si después de 2 turnos sin señal humana ni menú → [FIN].
- NUNCA espontáneamente nombre + teléfono. Solo si te los piden.

[MENSAJE REPETIDO / LOOP]
Señal crítica: el mensaje actual es idéntico o casi idéntico a uno anterior en esta conversación.
Comportamiento: CIERRA INMEDIATAMENTE con una frase corta de cierre, en tus propias palabras.[FIN]

[RESPUESTA AMBIGUA]
Señales: muy corta, genérica, no conecta con lo que dijiste.
Comportamiento: UNA pregunta abierta para verificar si hay humano. Si sigue igual → [FIN].

⚠️ Las frases entre comillas de abajo son solo ejemplos de TONO — jamás las copies
literalmente. Dos conversaciones distintas NUNCA deben terminar con el mismo texto
exacto; parafrasea cada cierre con tus propias palabras cada vez.

CUÁNDO CERRAR — responde normal y añade [FIN] pegado al final:
- Te preguntan precio → reacciona como consumidor interesado, algo como (no copies esto
  textual): "ay bueno, y cuánto sería más o menos?"
  Si te dan el precio, muestra interés y cierra natural con tus palabras, ej: "ah mira,
  déjame pensarlo y te aviso"[FIN]
- Te ofrecen agendar cita / visita / prueba, o te piden escoger día y hora → no confirmes nada:
  di con tus palabras que lo revisas y les confirmas (tono: déjame ver y te confirmo)[FIN]
- Piden que los llames → pregunta a qué número o cómo lo hacen, sin comprometer día ni hora[FIN]
- Te preguntan QUÉ VENDES o qué ofreces TÚ → deja claro que eres cliente, con tus propias
  palabras — nunca la misma frase que usaste en otra conversación — ej de tono: "no, yo
  no vendo nada, solo busco el servicio. ustedes sí atienden en [city]?"[FIN]
- Sin interés, te piden que no escribas → cierra con respeto, sin insistir[FIN]
- Bot ajeno detectado → cierra breve y casual, ej de tono: "ok, cualquier cosa aquí ando"[FIN]
- Conversación llegó a cierre natural[FIN]
- La empresa cierra con despedida ("buen día", "hasta luego", "con gusto") →
  reconoce brevemente y cierra con tus propias palabras — nunca dejes su despedida sin
  respuesta[FIN]
- Si TÚ ya te despediste y solo te vuelven a agradecer o despedir → no contestes: [FIN] solo

IMPORTANTE: [FIN] es señal interna, nunca llega al contacto. Ponlo pegado al texto sin espacio.
{extra_block}"""

# Este bloque se concatena SIEMPRE, incluso si un administrador reemplaza el prompt completo
# desde Conversaciones. Nissan La Capilla (2026-10-04): las reglas de seguridad no pueden
# depender de que el prompt editable siga intacto.
_IMMUTABLE_SAFETY_PROMPT = """

REGLAS DE SEGURIDAD INMUTABLES:
- No aceptes ni confirmes citas, visitas, pruebas, reservaciones, fechas u horarios.
- No cierres compras, pedidos, pagos, apartados, transferencias ni contratos.
- No inventes ni compartas dirección, correo, placa, RFC, tarjeta, cuenta, comprobante,
  datos de entrega o facturación.
- No prometas que llamarás, escribirás, pagarás, enviarás algo o asistirás después.
- Puedes pedir información, precio o disponibilidad. Si te piden confirmar una operación,
  responde que primero lo revisas y cierra con [FIN].
- Jamás escribas que eres un bot, una IA, un robot o un asistente. Tampoco lo niegues: no uses
  esas palabras ni digas que eres una persona real, aunque te lo pregunten.
"""

# Every quoted string in the prompt above is a tone/style EXAMPLE the model is
# explicitly told never to send verbatim (see the prompt's own rule at the
# top: "nunca envíes ninguna frase de ejemplo tal cual"). Extracted
# automatically instead of a manually-maintained list, so this can't go stale
# as the prompt changes. Confirmed live in production (real cases, "Ferra"
# 2026-09-07 and "Come Bien" 2026-09-15/16): the model sent a CUANDO TE
# CONFRONTAN example completely out of context — nobody had accused it of
# being a bot, the business had just sent a normal welcome menu or offered to
# pass the contact to an agent. Entries containing "{" are skipped (they're
# templated, e.g. "Hola {persona_name}", and can't be verbatim-matched against
# real generated text anyway).
# Dos clases de frases entre comillas en el prompt:
#  · PROHIBIDAS — en renglones con ❌ / JAMÁS / PROHIBIDO / nunca / "nada de", o que siguen la
#    lista de uno de esos renglones ("aquí ando si necesitas algo", "qué tiene de raro"): nunca se
#    mandan, de ningún largo.
#  · EJEMPLOS de tono — el resto: solo cuentan como copia si son largos (6+ palabras). Los cortos
#    ("ah gracias", "déjame pensarlo", "qué bueno") son frases normales que el prompt mismo pide
#    usar; marcarlos bloqueaba la respuesta y, al segundo intento, la plática se cerraba sin mandar
#    nada (simulador, 2026-10-06: tras recibir el precio o el contacto, el Chat IA se quedaba callado).
_FORBIDDEN_LINE_RE = re.compile(r"❌|JAMÁS|PROHIBIDO|\bnunca\b|\bnada de\b", re.IGNORECASE)


def _prompt_phrases() -> list:
    out, prev_forbidden = [], False
    for line in _DEFAULT_SYSTEM_PROMPT.splitlines():
        forbidden = bool(_FORBIDDEN_LINE_RE.search(line)) or (prev_forbidden and line.lstrip().startswith('"'))
        for m in re.findall(r'"([^"\n]{10,90})"', line):
            phrase = m.strip().lower().rstrip("?!.")
            if " " in phrase and "{" not in m and (forbidden or len(phrase.split()) >= 6):
                out.append(phrase)
        prev_forbidden = forbidden
    return out


_PROMPT_EXAMPLE_PHRASES = _prompt_phrases()


def _looks_copied_from_prompt(text: str) -> bool:
    """True if `text` is (near-)identical to one of the prompt's own tone
    examples — the model copying a sample verbatim instead of generating an
    original, contextual reply.

    Also catches a PARTIAL copy — the model freshly writes its own opening but
    reuses a distinctive tail/chunk of an example word-for-word. Real case
    ("Ferra", 2026-09-07): the example was "no, tengo una pregunta nada más.
    qué tiene de raro?" and the model sent "jaja no, tengo una pregunta sobre
    materiales. qué tiene de raro?" — a fresh lead-in around the example's
    exact ending. A full-phrase substring check alone misses this since the
    middle words differ. Chunk threshold (5+ words, 20+ chars) is deliberately
    not lower — short generic phrases ("no, tengo una pregunta") are things a
    real person could plausibly say on their own; only long, distinctive runs
    are trustworthy copy-detection signal.
    """
    norm = (text or "").strip().lower().rstrip("?!.")
    if not norm:
        return False
    for ex in _PROMPT_EXAMPLE_PHRASES:
        if norm == ex or (len(ex) >= 15 and ex in norm):
            return True
        words = ex.split()
        for n in range(len(words), 4, -1):
            for i in range(len(words) - n + 1):
                chunk = " ".join(words[i:i + n])
                if len(chunk) >= 20 and chunk in norm:
                    return True
    return False


# ── Reply hygiene ─────────────────────────────────────────────────────────────

def _norm_text(text: str) -> str:
    """Lowercase, accent-free, letters/digits/'?' only — for phrase matching."""
    import unicodedata
    t = unicodedata.normalize("NFKD", (text or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9?\s]", " ", t)


# A burst of several messages from the business used to reach the LLM numbered
# ("[1] Así es\n[2] No hay de qué, lindo día"), and the model answered with the
# marker itself — "[2]" went out as a real WhatsApp message (PASA Tijuana,
# 2026-10-02). Bursts are joined without numbers now (followup_queue.py), and
# any bracket marker the model still emits is stripped here before sending.
_MARKER_RE = re.compile(r"\[\s*\d{1,2}\s*\]")
_INTERNAL_TAG_RE = re.compile(r"\[(?:sin respuesta|[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ /]{2,40})\]", re.IGNORECASE)
_ONLY_MARKER_RE = re.compile(r"\s*\[\s*([0-9]{1,2}|[A-Za-z])\s*\]\s*")
_EMOJI_RE = re.compile(r"[☀-➿\U0001F000-\U0001FAFF]")


def _looks_like_menu(text: str) -> bool:
    """Numbered / lettered options or a buttons list — a bare "2" or "B" is a valid reply to these."""
    t = text or ""
    return bool(
        "[Opciones:" in t or "[Lista:" in t
        or re.search(r"(^|\n)\s*\*?\(?\d{1,2}[\.\)]\*?\s+\S", t)
        or re.search(r"\*[A-H]\*\s*[-–]", t)
        or re.search(r"(^|\n)\s*\*?[A-H][\)\.]\*?\s+\S", t)
    )


def _strip_reply_markers(text: str, inbound_body: str = "") -> str:
    """Remove "[2]"-style markers and internal prompt tags from a reply. A bare
    "[2]" answering a real menu becomes "2"; anything left with no letters,
    digits or emoji is junk and comes back empty (caller closes without sending)."""
    only = _ONLY_MARKER_RE.fullmatch(text or "")
    if only and _looks_like_menu(inbound_body):
        return only.group(1)
    t = _MARKER_RE.sub(" ", text or "")
    t = _INTERNAL_TAG_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    if not re.search(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", t) and not _EMOJI_RE.search(t):
        return ""
    return t


def _clean_reply(raw: str | None, inbound_body: str = "") -> tuple[str, bool]:
    """(text to send, wants_end) from the raw LLM output."""
    raw = raw or ""
    wants_end = "[FIN]" in raw
    text = _strip_reply_markers(raw.replace("[FIN]", ""), inbound_body)
    # El prompt prohíbe los signos de apertura ¿/¡ (nadie los usa al escribir WhatsApp
    # casual — es una de las señales anti-detección), pero DeepSeek no lo respeta de
    # forma consistente (visto en prod: "¿tienen lo que busco?", "¿qué tiene de raro?").
    text = text.replace("¿", "").replace("¡", "")
    # Mismo problema con el punto final — el lookbehind evita tocar puntos
    # suspensivos ("...") que sí están permitidos como pausa natural.
    text = re.sub(r"(?<!\.)\.$", "", text.strip()).rstrip()
    return text, wants_end


# Courtesy / farewell detection. After Andy closed a conversation, every
# "gracias" / "quedo a la orden" from the business restarted it and Andy kept
# answering goodbyes (Fame Querétaro, 2026-10-02: two more replies after it had
# already said goodbye) — and a farewell it did answer left the session open
# (and the AI icon on) for the full 48h idle timeout.
_FAREWELL_PHRASES = [
    "no hay de que", "no hay porque", "de nada", "hasta luego", "hasta pronto", "hasta manana",
    "a la orden", "a sus ordenes", "a tus ordenes", "para servirle", "para servirte",
    "que le vaya bien", "que te vaya bien", "que este bien", "que estes bien", "estamos en contacto",
    "quedo atento", "quedo atenta", "quedo pendiente", "quedamos atentos", "quedamos pendientes",
    "igualmente", "saludos", "bendiciones", "cuidese", "cuidate", "nos vemos",
]
_FAREWELL_WISH_RE = re.compile(
    r"\b(excelente|lindo|linda|bonito|bonita|feliz|gran)\s+(dia|tarde|noche|fin de semana|semana)\b"
    r"|\bque tengas?n? (un )?(buen|buena|excelente|lindo|linda|bonito|bonita|feliz)\b"
)
_GREETING_WORDS = {"hola", "buen", "buena", "buenos", "buenas", "dia", "dias", "tarde", "tardes",
                   "noche", "noches", "que", "tal"}
_COURTESY_WORDS = _GREETING_WORDS | set("""
    gracias muchas muchisimas mil por favor a la las los sus tus orden ordenes de y
    igualmente igual tambien usted ti te le lo este esten bien muy mucho excelente lindo linda
    bonito bonita feliz gran fin semana hasta luego pronto manana saludos bendiciones cuidese
    cuidate abrazo quedo quedamos atento atenta atentos pendiente pendientes estamos en contacto
    cualquier cosa aqui para servirle servirte placer gusto un una con tenga tengas vaya
    ok okay oki va vale sale listo perfecto claro entendido enterado enterada acuerdo
    asi es si correcto exacto genial super amable
""".split())


def _is_courtesy_only(text: str) -> bool:
    """Thanks / acknowledgements / goodbyes and nothing else — no question, no new
    information. A bare greeting ("buenas tardes") is NOT courtesy: it can be the
    opener of a real message that's still coming."""
    if not text or "?" in text:
        return False
    n = _norm_text(text)
    for p in _FAREWELL_PHRASES:
        n = n.replace(p, " ")
    tokens = n.split()
    if not tokens:
        return True
    if len(tokens) > 14 or set(tokens) <= _GREETING_WORDS:
        return False
    return set(tokens) <= _COURTESY_WORDS


def _is_greeting_only(text: str) -> bool:
    tokens = _norm_text(text or "").split()
    return bool(tokens) and set(tokens) <= _GREETING_WORDS


def _is_farewell(text: str) -> bool:
    """Courtesy-only AND an actual goodbye in it (not just "ok" / "gracias")."""
    if not _is_courtesy_only(text):
        return False
    n = _norm_text(text)
    return any(p in n for p in _FAREWELL_PHRASES) or bool(_FAREWELL_WISH_RE.search(n))


def _says_goodbye(text: str) -> bool:
    """Andy's own reply is a goodbye ("nos vemos pronto en la agencia", "igual para ti,
    excelente día") — it may carry context words, so this is looser than _is_farewell,
    but never with a question: a goodbye that asks something still expects an answer."""
    if not text or "?" in text:
        return False
    n = _norm_text(text)
    return any(p in n for p in _FAREWELL_PHRASES) or bool(_FAREWELL_WISH_RE.search(n))


# Nissan Autocom (2026-10-04): al seguimiento automático contestó "oye no soy un bot".
# Decirlo o negarlo delata igual. No importa si el negocio lo preguntó: esa referencia
# no puede salir en ningún mensaje.
_BOT_REFERENCE_RE = re.compile(
    r"\bbots?\b|\brobots?\b|\bchatbots?\b|\binteligencia artificial\b"
    r"|\basistente (virtual|digital)\b|\bpersona real\b|\bsoy humano\b"
    r"|\bsoy (un |una )?(ia|maquina|sistema)\b"
)


def _references_being_bot(reply: str) -> bool:
    return bool(_BOT_REFERENCE_RE.search(_norm_text(reply)))


def _denies_being_bot(reply: str, recent_inbound: str = "") -> bool:
    return _references_being_bot(reply)


_ASKS_NAME_RE = re.compile(
    r"con quien tengo el gusto|con quien hablo|como te llamas|como se llama|cual es (tu|su) nombre"
    r"|(tu|su) nombre|nombre completo|a nombre de quien"
)


def _asks_for_name(text: str) -> bool:
    return bool(_ASKS_NAME_RE.search(_norm_text(text)))


# Fillers the model leaned on until they showed up in every chat ("chido" 5×
# across 4 conversations, twice in one of them; "ah ok" ~8×) — the prompt itself
# listed them as examples. Tracked per conversation so Andy doesn't repeat one.
_TRACKED_FILLERS = ["chido", "ah ok", "ah perfecto", "ah que bien", "que bien", "la neta", "orale",
                    "mmm", "oye", "mira", "a ver", "ps", "sale", "perfecto"]
_DISTINCTIVE_FILLERS = {"chido", "ah ok", "ah perfecto", "ah que bien", "la neta", "orale", "mmm", "oye", "mira"}


def _fillers_in(text: str) -> set:
    n = " " + " ".join(_norm_text(text).replace("?", " ").split()) + " "
    return {f for f in _TRACKED_FILLERS if f" {f} " in n}


def _opener(text: str) -> str:
    words = _norm_text(text).replace("?", " ").split()
    return " ".join(words[:2]) if len(words) >= 2 else ""


def _used_fillers(prior_replies: list) -> list:
    """Fillers and two-word openers Andy already used in this conversation."""
    used = []
    for r in prior_replies:
        for f in sorted(_fillers_in(r)) + [_opener(r)]:
            if f and f not in used:
                used.append(f)
    return used


def _repeated_filler(text: str, prior_replies: list) -> str | None:
    """A distinctive filler or the exact two-word opener already used earlier in this conversation."""
    if not prior_replies or not text:
        return None
    before = set()
    for r in prior_replies:
        before |= _fillers_in(r)
    for f in sorted(_fillers_in(text) & before & _DISTINCTIVE_FILLERS):
        return f
    op = _opener(text)
    if op and any(op == _opener(r) for r in prior_replies):
        return op
    return None


# ── Booking guard ─────────────────────────────────────────────────────────────
# The prompt forbids taking an appointment, choosing a day or hour, or handing
# over booking data — Andy can't show up. gpt-4o-mini still did it: it booked a
# real service slot at Nissan La Capilla with an invented plate and email
# (2026-10-04), and replaying that chat with the current prompt it committed
# again in 2 of 4 runs. So it's checked here, not left to the prompt.

def _fold(text: str) -> str:
    """Lowercase and accent-free, punctuation kept (hours, dates, emails)."""
    import unicodedata
    t = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c))


# The business is offering a slot or asking for the data to book one.
_BOOKING_STEP_RE = re.compile(
    r"agend|apart|reserv|\bcitas?\b|prueba de manejo|\bvisita"
    r"|\b(que|cual) (dia|fecha|horario|hora)\b|\b(te|le) (acomoda|queda mejor)"
    r"|\b\d{1,2}:\d{2}\b|\b\d{1,2}/\d{1,2}\b"
    r"|\bplacas?\b|\bcorreo\b|\bemail\b|nombre completo|\bapellidos?\b|kilometraje|numero de serie")
# A reply that takes the slot or hands over data: a booking verb, a concrete
# hour or date, "puedo el sábado", an email or a plate.
_BOOKING_COMMIT_RE = re.compile(
    r"agend|apart|reserv"
    r"|\b\d{1,2}:\d{2}\b|\ba las \d|\b\d{1,2} ?(am|pm|hrs)\b|\b\d{1,2}/\d{1,2}\b"
    r"|\b(puedo|me queda|me late|me sirve)\b[^.?!]{0,30}"
    r"\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|en la manana|en la tarde)\b"
    r"|\b(confirmo|confirmado|ahi estare|ahi nos vemos)\b"
    r"|\bnos vemos\b[^.?!]{0,24}\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las)\b"
    r"|\bplacas?\b|\bmi correo\b|[\w.+-]+@[\w-]+\.\w+|\b[a-z]{3}-?\d{3,4}\b")
# "¿Te lo agendo?" → "sí, porfa" takes the slot without saying any of the above.
_BOOKING_OFFER_RE = re.compile(r"(agend|apart|reserv|confirm)[^?]*\?")
_AFFIRMATIVE_RE = re.compile(r"^\W*(si|va|vale|dale|ok|okay|claro|perfecto|de acuerdo|sale|porfa|por favor)\b")
_DEFLECTION_RE = re.compile(r"dejame|checo|reviso|luego|despues|te confirmo|les confirmo|te aviso|les aviso")
BOOKING_DEFLECT_REPLY = "va, déjame ver y te confirmo"


def _is_booking_step(recent_inbound: str) -> bool:
    return bool(_BOOKING_STEP_RE.search(_fold(recent_inbound)))


# Nissan La Capilla (2026-10-04) demostró que una instrucción en el prompt no basta:
# el modelo aceptó una cita real. La misma falla sería más grave en una compra, pago,
# pedido o contrato, por eso esas operaciones también tienen un guard antes de enviar.
_TRANSACTION_STEP_RE = re.compile(
    r"\b(comprar|compra|pedido|orden|pagar|pago|deposit|transfer|anticipo|apartado|contrato|firmar|factur)"
    r"|\bmetodo de pago\b|\blink de pago\b|\bdatos de entrega\b|\bdireccion\b"
    r"|\bconfirmas? (la compra|el pedido|la orden|el pago)\b")
_TRANSACTION_COMMIT_RE = re.compile(
    r"\b(lo|la|los|las) compro\b|\bme (lo|la|los|las) llevo\b"
    r"|\b(quiero|voy a|puedo) (comprar|pagar|depositar|transferir|apartar)\b"
    r"|\b(haz|hagan|genera|generen|levanta|levanten|confirma|confirmen)"
    r"[^.?!]{0,24}\b(pedido|orden|compra|pago|apartado)\b"
    r"|\bmi direccion (es|seria)\b|\bmis datos de facturacion\b|\b(lo|te) (pago|deposito|transfiero)\b"
)
_TRANSACTION_OFFER_RE = re.compile(
    r"(confirmas? (la compra|el pedido|la orden|el pago)|procedemos|generamos? (el )?(pedido|orden)"
    r"|realizamos? (la )?compra|te envio (el )?link de pago|cual es tu metodo de pago)[^?]*\?"
)
TRANSACTION_DEFLECT_REPLY = "va primero lo reviso y te aviso"


def _is_transaction_step(recent_inbound: str) -> bool:
    return bool(_TRANSACTION_STEP_RE.search(_fold(recent_inbound)))


def _commits_to_transaction(reply: str, inbound: str = "") -> bool:
    r = _fold(reply)
    if _TRANSACTION_COMMIT_RE.search(r):
        return True
    return bool(_TRANSACTION_OFFER_RE.search(_fold(inbound)) and _AFFIRMATIVE_RE.search(r)
                and not _DEFLECTION_RE.search(r))


# Andy ya tiene lo que vino a buscar — el prompt pide cerrar en ese momento, pero el
# modelo casi nunca lo hace solo (replay real 2026-10-05: Toyota BC preguntó por
# promociones y por cómo agendar después de recibir el número de servicio; Fame y
# Nissan siguieron platicando tras ofrecerles horario). Más angosto que
# _BOOKING_STEP_RE: pedir nombre, correo o placa no es ofrecer cita.
_GOAL_APPOINTMENT_RE = re.compile(
    r"agend|apart|reserv|\bcitas?\b|prueba de manejo|horarios? (disponibles|cercanos)"
    r"|\b(que|cual) (dia|fecha|horario|hora)\b|\b(te|le) (acomoda|queda|quedaria) (mejor|bien)"
    r"|\b\d{1,2}:\d{2}\b")
_GOAL_PRICE_RE = re.compile(r"\$ ?\d|\b\d[\d,.]* ?(pesos|mxn)\b")
_GOAL_CONTACT_RE = re.compile(
    r"\b(le|te) (comparto|paso|dejo|envio|mando) (el|su|mi|un|los) (numero|contacto|telefono|whats)"
    r"|\bcomuni(cate|quese|carse) (al|con el|con la)\b|\b(marque|marca|llame|llama) al\b"
    r"|(?:\d[ -]?){10}")
_GOAL_CORRECTION = {
    "cita": "te ofrecieron cita u horario: es todo lo que necesitabas. no hagas preguntas. responde corto, "
            "con tus palabras, que lo revisas y les confirmas, sin fechas ni horas, y termina con [FIN].",
    "precio": "ya te dieron el precio: es todo lo que necesitabas. no hagas más preguntas. reacciona corto "
              "al precio con tus palabras, di que lo piensas y termina con [FIN].",
    "contacto": "ya te dieron el número o contacto a donde llamar: es todo lo que necesitabas. no hagas más "
                "preguntas. agradece corto, di que ya lo anotaste y termina con [FIN].",
}
# Último recurso si el reintento sigue preguntando — varias para que dos conversaciones
# no terminen con el mismo texto exacto.
_GOAL_FALLBACK = {
    "cita": [BOOKING_DEFLECT_REPLY, "ok déjame checar y te confirmo", "va lo reviso y les aviso"],
    "precio": ["va déjame pensarlo", "ok lo pienso y te aviso", "mmm va lo checo y te digo"],
    "contacto": ["va gracias ya lo anoté", "ok gracias ya guardé el contacto", "sale gracias con eso tengo"],
}


_MENU_ITEM_LINE_RE = re.compile(r"^\s*\d{1,2}\s*[.)-]\s")


def _business_since_last_reply(turns: list, fallback: str = "") -> str:
    """Todo lo que mandó el negocio desde nuestra última respuesta. Una ráfaga cuenta completa: si el
    precio venía en el primero de varios mensajes, la meta ya se alcanzó aunque el último sea
    "¿necesitas algo más?" (simulador, 2026-10-06)."""
    parts = []
    for t in reversed(turns or []):
        if t.get("role") == "assistant":
            break
        if t.get("role") == "user" and t.get("content") and t["content"] not in parts:
            parts.append(t["content"])
    return "\n".join(reversed(parts)) or fallback


# Arranque de una respuesta de verdad: "Sí, ofrecemos…", "Claro, …", "¡Hola! Sí, tenemos…".
_ANSWER_START_RE = re.compile(r"^\W*(?:hola\W+)?(?:si|claro|con gusto|por supuesto|desde luego)\b")


def _is_auto_ack(text: str) -> bool:
    """Acuse automático al que no se contesta: plantilla de auto-respuesta que NO trae nada
    concreto. "¡Hola! Gracias por tu mensaje. La limpieza cuesta $500…" lo escribió alguien que
    contesta: trae precio. Antes el filtro rápido lo cerraba sin responder (simulador, 2026-10-06)."""
    from app.classifier import _looks_like_auto_reply, _is_choice_menu
    if not text or not _looks_like_auto_reply(text):
        return False
    # Pregunta algo, muestra un menú ("…elige una de las siguientes opciones") o es un renglón de
    # un menú mandado en pedazos ("3. Horarios de atención"): espera respuesta.
    if "?" in text or _is_choice_menu(text) or _MENU_ITEM_LINE_RE.match(text):
        return False
    return not (_goal_reached(text) or _ANSWER_START_RE.search(_fold(text)))


# "déjame ver / pensarlo y te confirmo / aviso": cierre amable, como una despedida.
_DEFLECT_RE = re.compile(r"\bdejame (ver|pensarlo|checar|revisar)|\bte (confirmo|aviso)\b|\blo (reviso|checo)\b")


def _is_bot_noise(text: str) -> bool:
    """Menú, renglón de menú o aviso automático: después de despedirnos no reabre la plática.
    Caso del simulador (2026-10-06): tras recibir el precio y cerrar, el bot mandó otro menú con
    "¿te gustaría saber más…?" y la plática se reabría para contestarle a un bot."""
    from app.classifier import _is_choice_menu, _looks_like_auto_reply
    t = text or ""
    return bool(_is_choice_menu(t) or _MENU_ITEM_LINE_RE.match(t) or _looks_like_auto_reply(t))


def _invalid_menu_pick(reply: str, business_text: str) -> bool:
    """Una respuesta de 1-2 caracteres ("H", "7") que no es ninguna opción del menú que mandaron.
    Visto en el simulador: a un menú de 1 a 3 contestó "H", dos veces."""
    r = (reply or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{1,2}", r):
        return False
    opt = re.escape(r)
    return not re.search(rf"(^|[\s*(\[])({opt})\s*[*.)\-–:]|\b{opt}\ufe0f?\u20e3|\[Opciones:[^\]]*\b{opt}\b",
                         business_text or "", re.IGNORECASE | re.MULTILINE)


MAX_REPLY_WORDS = 25


def _too_long(text: str) -> bool:
    """Más de lo que alguien escribe en un WhatsApp casual. En el simulador salían respuestas de una
    sola oración larguísima que juntaba toda su situación ("no necesito tantos litros porque es un
    local pequeño pero… y estoy remodelando ahí déjame ver y te confirmo")."""
    return len((text or "").split()) > MAX_REPLY_WORDS


def _goal_reached(inbound: str) -> str | None:
    """'cita' / 'precio' / 'contacto' cuando el mensaje del negocio ya le da a Andy lo
    que vino a buscar; None si no (o si es un menú — ahí Andy sigue navegando)."""
    from app.classifier import _looks_like_menu
    if not inbound:
        return None
    if "BEGIN:VCARD" in inbound.upper():
        return "contacto"
    if _looks_like_menu(inbound):
        return None
    t = _fold(inbound)
    if _GOAL_PRICE_RE.search(t):
        return "precio"
    if _GOAL_CONTACT_RE.search(t):
        return "contacto"
    if _GOAL_APPOINTMENT_RE.search(t):
        return "cita"
    return None


def _close_on_goal(ai_text: str, goal: str, retry) -> str:
    """Respuesta final cuando ya se alcanzó la meta: sin preguntas. `retry(correction)`
    devuelve la respuesta cruda del reintento."""
    if "?" not in ai_text:
        return ai_text
    retry_text, _ = _clean_reply(retry(_GOAL_CORRECTION[goal]))
    if (retry_text and "?" not in retry_text and not _commits_to_booking(retry_text)
            and not _looks_copied_from_prompt(retry_text)):
        return retry_text
    import random
    return random.choice(_GOAL_FALLBACK[goal])


def _commits_to_booking(reply: str, inbound: str = "") -> bool:
    r = _fold(reply)
    # "te confirmo después" es precisamente la salida segura; no confundir el verbo
    # dentro de una postergación con "confirmo" a secas.
    if _DEFLECTION_RE.search(r):
        return False
    if _BOOKING_COMMIT_RE.search(r):
        return True
    return bool(_BOOKING_OFFER_RE.search(_fold(inbound)) and _AFFIRMATIVE_RE.search(r)
                and not _DEFLECTION_RE.search(r))


def _national_number(number: str) -> str:
    digits = "".join(filter(str.isdigit, number or ""))
    return digits[-10:] if len(digits) >= 10 else ""


def _get_system_prompt(db) -> str:
    """
    Instrucción base del sistema — normalmente el prompt hardcodeado de arriba,
    pero puede sobrescribirse globalmente desde Conversaciones (candado en
    ChatAIConfig) y queda guardada en ai_global_config. Vacío/ausente → default.
    """
    try:
        cfg = db.db.ai_global_config.find_one({"_id": "global"})
        override = (cfg or {}).get("system_prompt", "") or ""
        if override.strip():
            return override
    except Exception as e:
        log.error("[AIFollowup] error leyendo ai_global_config, usando default: %s", e)
    return _DEFAULT_SYSTEM_PROMPT


def _is_business_hours() -> bool:
    now = datetime.now(_MEXICO_TZ)
    return 8 <= now.hour < 21


def _get_idle_timeout_hours(db: MongoDBManager) -> float:
    """Configurable from Settings > Chat IA (ai_global_config) — hot-read, no cache,
    same reasoning as get_classifier_settings: a change in the UI should apply to the
    next reply without a redeploy."""
    cfg = db.db.ai_global_config.find_one({"_id": "global"}) or {}
    try:
        return float(cfg.get("idle_timeout_hours", DEFAULT_IDLE_TIMEOUT_HOURS))
    except (TypeError, ValueError):
        return float(DEFAULT_IDLE_TIMEOUT_HOURS)


def _get_or_create_session(db: MongoDBManager, phone_number: str, company_id: str):
    """Return the active/waiting session for this number, or create one if a prior outbound exists."""
    session = db.db.ai_followup_sessions.find_one(
        {"phone_number": phone_number, "status": {"$in": ["active", "waiting"]}},
    )
    if session:
        # A session left "waiting" for too long (prospect went quiet for days) should
        # NOT auto-resume the moment they finally reply — by then the conversation is
        # cold and Andy picking it back up unsupervised is riskier than useful. Close
        # it and turn off ai_enabled so this reply lands as a normal notification
        # instead — same "ended" pattern used elsewhere in this file (farewell/auto-
        # reply detection), just with a time-based trigger.
        last_activity = session.get("last_activity") or session.get("created_at")
        if last_activity:
            idle_hours = (datetime.utcnow() - last_activity).total_seconds() / 3600
            timeout_hours = _get_idle_timeout_hours(db)
            if idle_hours > timeout_hours:
                db.db.ai_followup_sessions.update_one(
                    {"_id": session["_id"]},
                    {"$set": {"status": "ended", "end_reason": "idle_timeout"}},
                )
                db.db.conversation_ai_prefs.update_one(
                    {"company_id": company_id},
                    {"$set": {"ai_enabled": False}},
                    upsert=True,
                )
                log.info("[AIFollowup] session idle %.1fh > %.1fh timeout — ended, ai_enabled=False for company=%s",
                          idle_hours, timeout_hours, company_id)
                return None
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
    # Andy ya platicó y cerró antes con esta empresa — esta sesión nace porque el
    # negocio volvió a escribir: alcanza con contestar y cerrar (ver REOPEN_MAX_TURNS).
    if db.db.ai_followup_sessions.find_one(
            {"company_id": company_id, "status": "ended", "turn_count": {"$gt": 0}}, {"_id": 1}):
        max_turns = min(max_turns, REOPEN_MAX_TURNS)
        ctx = {**ctx, "reopened": True}

    # Pre-populate turns with recent message history so the AI has context
    # to detect bots/humans before the first response (e.g. "Soy AMAIA").
    _seed_turns = []
    clean10_seed = "".join(filter(str.isdigit, phone_number))[-10:]
    _recent_msgs = list(db.db.message_logs.find(
        {"company_id": company_id,
         "$or": [{"to_number": {"$regex": clean10_seed}},
                 {"from_number": {"$regex": clean10_seed}}]},
        sort=[("created_at", -1)], limit=8,
    ))
    for _m in reversed(_recent_msgs):
        _role = "assistant" if _m.get("direction") == "outbound" else "user"
        _body = (_m.get("message_body") or "").strip()
        if _body:
            _seed_turns.append({"role": _role, "content": _body,
                                 "seeded": True, "ts": _m.get("created_at")})

    doc = {
        "phone_number": phone_number,
        "company_id": company_id,
        "status": "waiting",
        "turns": _seed_turns,
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


def _generate_persona_seed(industry: str, city: str, offer_hint: str = "") -> str:
    """Return a short, plausible backstory based on the company's real offer when known."""
    import unicodedata
    def _strip_accents(s: str) -> str:
        return "".join(c for c in unicodedata.normalize("NFD", s)
                       if unicodedata.category(c) != "Mn")

    industry_lower = _strip_accents((industry or "").lower())
    city_short = city.split(",")[0].strip() if city else "la ciudad"

    seeds = {
        "gas": [
            f"Se te acabó el gas en tu departamento en {city_short}. Buscas proveedor confiable para pedidos cada 2-3 semanas.",
            f"Tienes un local pequeño en {city_short} que usa gas LP. El proveedor actual tarda mucho y necesitas alternativa.",
        ],
        "catering": [
            f"Tienes un evento familiar de unas 25-30 personas el mes que entra en {city_short}. Todavía explorando opciones de comida.",
            f"Te pidieron organizar una reunión de trabajo de ~20 personas en {city_short}. Necesitas catering o servicio de comida.",
        ],
        "limpieza": [
            f"Buscas servicio de limpieza profunda para tu casa en {city_short}. Quizás mensual si el precio vale.",
            f"Acabas de rentar un departamento en {city_short} y necesitas limpieza antes de entrar.",
        ],
        "construccion": [
            f"Estás remodelando un cuarto en {city_short} — cambio de piso y algo de plomería. Buscas materiales o servicio.",
            f"Tienes una terraza en {city_short} con goteras. Necesitas quién te cotice la reparación.",
        ],
        "ferreteria": [
            f"Estás remodelando tu baño en {city_short} y necesitas materiales — tubería, accesorios, tal vez el servicio.",
            f"Tienes un proyecto chico en casa y buscas herramientas o materiales en {city_short}.",
        ],
        "material": [  # "materiales de construccion", "materiales electricos", etc.
            f"Estás remodelando un cuarto en {city_short} y buscas materiales — piso, tubería, lo básico.",
            f"Tienes un arreglo chico en casa en {city_short} y necesitas materiales.",
        ],
        "comida": [
            f"Buscas opciones para ordenar comida a domicilio en {city_short}. Viste el negocio y quieres saber si llegan a tu zona.",
            f"Te interesa probar el lugar para comer en {city_short}. Quieres saber horarios y si hacen entregas.",
        ],
        "restaurant": [
            f"Buscas dónde comer en {city_short} con buenas opciones. Viste el lugar y quieres saber si tienen mesa o hacen entrega.",
        ],
        "salud": [
            f"Necesitas una consulta o revisión en {city_short}. Buscas opciones antes de decidir dónde ir.",
            f"Alguien en tu familia necesita atención y estás viendo opciones en {city_short}.",
        ],
        "medic": [
            f"Buscas médico o clínica en {city_short}. Necesitas atención y estás viendo opciones.",
        ],
        "dental": [
            f"Necesitas revisión dental en {city_short}. Llevas un rato buscando dentista de confianza.",
            f"Tienes un dolor de muela y buscas dentista en {city_short} con disponibilidad pronto.",
        ],
        "auto": [
            f"Tu carro necesita servicio en {city_short} — mantenimiento o algo que le está fallando.",
            f"Tuviste un pequeño choque y buscas taller de hojalatería en {city_short}.",
        ],
        "taller": [
            f"Tu carro tiene algo que no suena bien y buscas taller confiable en {city_short}.",
        ],
        "plomeria": [
            f"Tienes una fuga de agua en casa en {city_short}. Buscas plomero confiable con disponibilidad rápido.",
        ],
        "electricidad": [
            f"Tienes un problema eléctrico en casa en {city_short} — algo que no enciende o un corto.",
        ],
        "electric": [
            f"Se fue la luz en un cuarto en {city_short} y buscas electricista para revisarlo.",
        ],
        "mudanza": [
            f"Vas a cambiarte de departamento en {city_short} el mes que entra. Necesitas cotización de mudanza.",
        ],
        "seguridad": [
            f"Quieres poner cámaras o alarma en casa en {city_short}. Estás cotizando con varios.",
        ],
        "internet": [
            f"El internet de tu casa en {city_short} es pésimo. Buscas proveedor con mejor servicio.",
        ],
        "seguro": [
            f"Estás pensando en contratar un seguro en {city_short} — de vida o de auto. Todavía comparando.",
        ],
        "inmobili": [
            f"Buscas departamento en renta en {city_short}. Ya viste algunos, quieres más opciones.",
        ],
        "bienes raices": [
            f"Buscas propiedad o departamento en {city_short}. Todavía explorando opciones antes de decidir.",
        ],
        "jardin": [
            f"Quieres arreglar el jardín de tu casa en {city_short}. Buscas servicio de mantenimiento o diseño.",
        ],
        "pintura": [
            f"Quieres pintar algunos cuartos en casa en {city_short}. Buscas quien te dé una cotización.",
        ],
        "viaje": [
            f"Planeas un viaje y buscas opciones de hospedaje o tour en {city_short}.",
        ],
    }

    # Match industry keyword to seed pool
    for keyword, pool in seeds.items():
        if keyword in industry_lower:
            return random.choice(pool)

    # Generic fallback
    # Contexto raspado > una historia genérica del giro. Antes una empresa con giro vago
    # podía recibir una situación que no tenía relación con lo que realmente vende.
    if offer_hint:
        item = re.sub(r"\s+", " ", str(offer_hint)).strip()[:90]
        return (f"Te interesa {item} para una necesidad personal en {city_short}. "
                "Estás comparando opciones y quieres entender precio y disponibilidad antes de decidir.")

    generics = [
        f"Necesitas contratar o comprar algo relacionado con {industry} en {city_short}. Todavía comparando opciones.",
        f"Buscas un proveedor de {industry} confiable en {city_short}. Quieres saber precios y disponibilidad antes de decidir.",
        f"Encontraste este negocio en {city_short} y quieres ver si lo que ofrecen te sirve para lo que necesitas.",
    ]
    return random.choice(generics)


def _build_context(db: MongoDBManager, company_id: str, outbound_log: dict) -> dict | None:
    from bson import ObjectId
    try:
        company = db.db.companies.find_one({"_id": ObjectId(company_id)})
    except Exception:
        company = None
    if not company:
        return None

    # Resumen raspado compacto pero suficientemente específico para que no parezca un guion
    # genérico. Cinco elementos siguen siendo pequeños para el prompt y evitan ignorar justo
    # el servicio por el que se contactó a la empresa.
    services  = company.get("services") or []
    products  = company.get("products") or []
    offer_parts = []
    if services[:5]:
        offer_parts.append("Servicios: " + ", ".join(str(s) for s in services[:5]))
    if products[:5]:
        offer_parts.append("Productos: " + ", ".join(str(p) for p in products[:5]))
    offer = " | ".join(offer_parts) if offer_parts else ""

    description   = (company.get("description") or company.get("main_activity") or "").strip()[:400]
    website       = (company.get("website") or "").strip()

    industry = company.get("industry", "su giro")
    city = company.get("city", "México")

    # Andy's persona name must match whatever WhatsApp profile is actually sending
    # these messages — hardcoding "Andrés" for every conversation meant a contact
    # could see the real connected profile say one name while Andy claimed another.
    # profile_name is synced from the real WhatsApp account (wwebjs instances only
    # for now); falls back to the generic default persona for instances without one
    # (Evolution/WAHA/Wasender, or a wwebjs instance whose profile hasn't synced yet).
    persona_name = DEFAULT_PERSONA_NAME
    persona_full_name = ""
    own_number = ""
    try:
        assigned_instance = company.get("assigned_instance")
        if assigned_instance:
            inst = db.db.instances.find_one({"name": assigned_instance}, {"profile_name": 1, "number": 1})
            profile_name = ((inst or {}).get("profile_name") or "").strip()
            if profile_name:
                persona_name = profile_name.split()[0]  # first name only — casual WhatsApp use
                persona_full_name = profile_name
            own_number = _national_number((inst or {}).get("number", ""))
    except Exception:
        pass

    return {
        "company_name":    company.get("name") or _display_name_from_domain(company.get("domain", "")) or "la empresa",
        "industry":        industry,
        "city":            city,
        "initial_message": (outbound_log.get("message_body") or "")[:200],
        "description":     description,
        "offer":           offer,
        "website":         website,
        "persona_seed":    _generate_persona_seed(
            industry, city, (services or products or [""])[0]),
        "persona_name":    persona_name,
        "persona_full_name": persona_full_name or persona_name,
        "own_number":      own_number,
    }


def _call_llm_for_reply(turns: list, context: dict, is_cold_start: bool = False, prefs: dict = None, db=None,
                         proactive_minutes: int = None, correction: str = "",
                         used_fillers: list = None) -> str | None:
    ctx = dict(context)
    parts = []
    if ctx.get("description"):
        parts.append(ctx["description"])
    if ctx.get("offer"):
        parts.append(ctx["offer"])
    if ctx.get("website"):
        parts.append(f"Web: {ctx['website']}")
    ctx["company_context"] = "\n".join(parts) if parts else "(sin datos adicionales)"
    # Ensure persona_seed exists — generated once per session at context build time,
    # but fallback here covers test scripts that build context manually.
    if not ctx.get("persona_seed"):
        ctx["persona_seed"] = _generate_persona_seed(ctx.get("industry", ""), ctx.get("city", "México"))
    if not ctx.get("persona_name"):
        ctx["persona_name"] = DEFAULT_PERSONA_NAME
    # Sessions created before these existed don't carry them in their context.
    if not ctx.get("persona_full_name"):
        ctx["persona_full_name"] = ctx["persona_name"]
    if not ctx.get("own_number"):
        ctx["own_number"] = "mismo número desde el que escribes"
    extra = ((prefs or {}).get("extra_instructions") or "").strip()
    ctx["extra_block"] = f"\n\nINSTRUCCIONES ADICIONALES:\n{extra}" if extra else ""
    base_prompt = _get_system_prompt(db or MongoDBManager())
    try:
        system = base_prompt.format(**ctx)
    except (KeyError, ValueError) as e:
        # Instrucción base personalizada con llaves { } sueltas rompe .format() —
        # cae al prompt default en vez de tumbar la respuesta por completo.
        log.error("[AIFollowup] instrucción base con formato inválido, usando default: %s", e)
        system = _DEFAULT_SYSTEM_PROMPT.format(**ctx)
    # El prompt editable puede cambiar tono y objetivo, pero nunca quitar las barreras
    # que evitan acciones reales o datos inventados.
    system += _IMMUTABLE_SAFETY_PROMPT
    if is_cold_start:
        system += (
            "\n\n⚠️ PRIMER MENSAJE DE ESTA SESIÓN: es tu primera respuesta a esta persona. "
            "EXCEPCIÓN CRÍTICA: si el mensaje recibido es un acuse de recibo / ticket automático "
            "SIN opciones de menú, aplica la regla de [MENSAJE AUTOMÁTICO] — output SOLO [FIN], sin texto alguno. "
            "⚠️ ESTO NO APLICA A MENÚS: si el mensaje trae un menú (números, letras, botones, "
            "'[Opciones: ...]', o pide elegir una opción), esta excepción NO es un ACK — ignórala "
            "por completo y sigue la regla normal de [BOT CON MENÚS / IVR] (responde SOLO la letra "
            "o número correcto, nunca [FIN] sin haber intentado navegar). "
            "TAMPOCO APLICA si el mensaje te pregunta tu nombre: ahí responde SOLO tu nombre, sin [FIN]. "
            "TAMPOCO es acuse un saludo solo ('hola', 'buenas tardes', '¡Hola! 😊'): contesta el saludo corto "
            "y di en pocas palabras qué buscas, sin [FIN]. "
            "Si NO es un ACK ni un menú: puedes saludar brevemente si encaja — SIN ¡Hola! ni signos invertidos. "
            "Usa algo como \"hey\", \"buenas\", \"oye\" — o ve directo al punto. Nunca más de 2-3 palabras."
        )
    if proactive_minutes is not None:
        system += (
            f"\n\n⚠️ MODO PROACTIVO: Llevas {proactive_minutes} minutos sin recibir respuesta. "
            "El turno '[Sin respuesta]' representa ese silencio — no respondieron. "
            "Genera UN mensaje de seguimiento muy breve y natural, como si acabaras de acordarte de algo "
            "relacionado o simplemente quisieras saber si llegó tu mensaje. "
            "REGLAS: nunca digas que estás esperando respuesta; nunca uses el mismo arranque que en "
            "tu último mensaje (si empezaste con 'oye', empieza diferente); 1 frase máxima, casual, sin puntos."
        )
    if ctx.get("reopened"):
        # Replay real (Nissan La Capilla, 2026-10-05): al "¿pudiste revisar…?" del
        # seguimiento, el modelo se volvía a presentar y contaba otra vez todo lo que buscaba.
        system += (
            "\n\n⚠️ YA TE HABÍAS DESPEDIDO de este negocio y te volvieron a escribir. Contesta SOLO lo que "
            "te preguntan ahora, en una frase corta y sin hacer preguntas. No digas tu nombre (salvo que te lo "
            "pidan en este mensaje), no vuelvas a contar lo que buscas y no aceptes nada (cita, horario, datos). "
            "Si te preguntan si ya lo revisaste o si te decidiste: todavía no, lo revisas y les avisas. "
            "Termina con [FIN]."
        )
    if used_fillers:
        system += (
            "\n\n⚠️ YA USASTE en esta conversación: " + ", ".join(f"'{f}'" for f in used_fillers[:12])
            + " — no repitas esas muletillas ni esos arranques; usa otras palabras o ninguna."
        )
    if correction:
        system += f"\n\n⚠️ CORRECCIÓN: {correction}"
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
            max_tokens=200,
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


def _is_blocked_or_blacklisted(db, company_id: str, phone_number: str | None = None) -> bool:
    """Same check /send-message (routes.py) already does before a manual send —
    ai_followup.py had no equivalent anywhere, so a company blocked/blacklisted
    AFTER Andy's session started was never actually protected."""
    try:
        # Shared with every other send path (app/send_guard.py). Inbound numbers
        # arrive as 521… while numbers blocked from a recipient list are stored
        # as 52… — the old exact-digits match never caught them, so Andy kept
        # answering a number someone had blocked.
        from app.send_guard import send_block_reason
        return send_block_reason(db, company_id or "", phone_number or "") is not None
    except Exception as exc:
        log.warning("[AIFollowup] blacklist check failed (failing safe, allowing send): %s", exc)
        return False


def _send_typing_presence(phone_number: str, instance: str):
    """Signal WhatsApp that the contact is typing via Evolution API."""
    try:
        import requests as _req
        clean = "".join(filter(str.isdigit, phone_number))
        url = f"{EVOLUTION_API_URL}/chat/sendPresence/{instance}"
        payload = {"number": clean, "options": {"presence": "composing"}}
        headers = {"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"}
        _req.post(url, json=payload, headers=headers, timeout=5)
    except Exception as e:
        log.debug("[AIFollowup] typing presence failed: %s", e)


def _close_session_without_reply(db, sid, company_id: str, phone_number: str, reason: str):
    """Shared cleanup for every path in process_inbound_reply where Andy ends up
    UNABLE to actually deliver a reply — the LLM call itself failed, no connected
    instance was available, the daily send cap was hit, or the real send call
    raised an exception. Each of these used to just reset ai_typing and return,
    leaving the session stuck at status="active" forever: nothing else ever
    revisits an "active" session except a NEW inbound message (which may never
    come) or the idle-timeout sweep hours later. Confirmed live in production for
    a real company ("Alceautomotriz") — closing immediately and disabling the
    toggle instead surfaces the failure to a human right away, who can take over
    the conversation manually, instead of it silently going dark."""
    db.db.ai_followup_sessions.update_one(
        {"_id": sid},
        {"$set": {"ai_typing": False, "status": "ended", "end_reason": reason,
                  "last_activity": datetime.utcnow()}},
    )
    # "ai_decision" here means the LLM itself decided there was nothing worth
    # saying (bare [FIN], e.g. a cold-start reply it read as not needing a
    # response) — a content judgment, not a technical failure, so a genuine
    # reply arriving later should still be able to auto-reactivate (see
    # auto_disabled in ai_followup.py's other quick-close paths and
    # _user_explicitly_disabled in the webhook handlers). The other reasons
    # this gets called with (no_instance, send failures, daily cap) ARE real
    # operational failures that need a human to notice and fix — those keep
    # blocking auto-reactivation until a person re-enables it themselves.
    prefs_update = {"ai_enabled": False}
    if reason == "ai_decision":
        prefs_update["auto_disabled"] = True
    db.db.conversation_ai_prefs.update_one(
        {"company_id": company_id},
        {"$set": prefs_update},
        upsert=True,
    )
    log.warning("[AIFollowup] session %s closed without reply (reason=%s) for %s", sid, reason, phone_number)


def _recently_closed_after_talking(db, company_id: str) -> bool:
    """No open session, and the last one was closed by Andy (content decision,
    not a failure) after actually talking, within the idle-timeout window."""
    if db.db.ai_followup_sessions.find_one(
            {"company_id": company_id, "status": {"$in": ["active", "waiting"]}}, {"_id": 1}):
        return False
    last = db.db.ai_followup_sessions.find_one(
        {"company_id": company_id, "status": "ended"}, sort=[("last_activity", -1)])
    if not isinstance(last, dict) or last.get("end_reason") not in ("ai_decision", "max_turns") or not last.get("turn_count"):
        return False
    closed_at = last.get("last_activity") or last.get("created_at")
    if not closed_at:
        return False
    return datetime.utcnow() - closed_at < timedelta(hours=_get_idle_timeout_hours(db))


def _newer_inbound_exists(db, company_id: str, inbound_log_id: str | None) -> bool:
    """The business wrote again after the last message this reply answers. Prod
    runs 2 API processes, each with its own in-memory debounce, so one burst can
    be split in two and answered twice at once (Fame Querétaro, 2026-10-02:
    "a qué hora sería?" right after they'd said 10:00, then a second reply). Only
    the reply covering the newest message is sent — the other process sees the
    earlier turn in the session and answers everything together."""
    try:
        from bson import ObjectId
        ref = db.db.message_logs.find_one({"_id": ObjectId(inbound_log_id)}, {"created_at": 1})
    except Exception:
        return False
    if not isinstance(ref, dict) or not ref.get("created_at"):
        return False
    newer = db.db.message_logs.find_one(
        {"company_id": company_id, "direction": "inbound", "created_at": {"$gt": ref["created_at"]}},
        {"_id": 1},
    )
    return isinstance(newer, dict)


def process_inbound_reply(phone_number: str, company_id: str, inbound_body: str | None, inbound_log_id: str | None,
                          manual_activation: bool = False, proactive: bool = False):
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

    # Bloqueo por blacklist / chat bloqueado — el endpoint de envío manual
    # (/send-message, routes.py) ya revisaba esto, pero el flujo automático de
    # seguimiento (este archivo) no lo revisaba en NINGÚN punto: si una empresa
    # se bloquea o se agrega a blacklist DESPUÉS de que Andy ya tiene una sesión
    # activa con ella, nada lo detenía — seguía mandándole mensajes a alguien
    # que ya se marcó como "no contactar".
    if _is_blocked_or_blacklisted(db, company_id, phone_number):
        print(f"[AIFollowup] EXIT: empresa bloqueada/en blacklist — {company_id}")
        return

    # Skip messages that are older than 2 hours — prevents the IA from responding
    # to stale webhook re-deliveries or messages from closed sessions.
    # Skipped when the user manually activates the AI toggle (manual_activation=True)
    # so the AI can still send a greeting on old conversations.
    # Also skipped in proactive mode (no real inbound to check).
    if not manual_activation and not proactive:
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

    # Andy already said goodbye and closed this conversation — a "gracias" / "quedo
    # a la orden" afterwards needs no answer and must not open a new session (the
    # webhook flipped the toggle back on to get here; put it back). Same for anything
    # that doesn't ask him something: a recap ("te esperamos el 12/10 a las 09:00"),
    # a promo, a "saludos desde…" (Nissan Autocom, Toyota BC). Only a question
    # reopens it, and then only briefly (REOPEN_MAX_TURNS).
    if not proactive and not manual_activation and (
            _is_courtesy_only(inbound_body or "") or "?" not in (inbound_body or "")
            or _is_bot_noise(inbound_body or "")):
        if _recently_closed_after_talking(db, company_id):
            db.db.conversation_ai_prefs.update_one(
                {"company_id": company_id},
                {"$set": {"ai_enabled": False, "auto_disabled": True}},
                upsert=True,
            )
            print(f"[AIFollowup] EXIT: courtesy-only message after Andy closed — no reply for {phone_number}")
            return

    if proactive:
        # In proactive mode, only use an EXISTING waiting session — never create a new one.
        # The session may have ended between the sweep and now (idle timeout, user disable, etc.)
        session = db.db.ai_followup_sessions.find_one(
            {"phone_number": phone_number, "company_id": company_id, "status": "waiting"},
        )
        print(f"[AIFollowup] proactive session={session is not None} id={session.get('_id') if session else None}")
    else:
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

    # Append the user's inbound turn and mark session active.
    # In proactive mode there is no real inbound — skip the turn append.
    if not proactive:
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
    else:
        db.db.ai_followup_sessions.update_one(
            {"_id": sid},
            {"$set": {"status": "active"}},
        )

    # Anti-detection: shorter delay for menu/IVR messages (they expect fast button presses)
    import re as _re
    is_menu_msg = (
        "[Opciones:" in inbound_body or "[Lista:" in inbound_body
        or any(f"{i}." in inbound_body for i in range(1, 8))
        or bool(_re.search(r'\*[A-H]\*\s*[-–]', inbound_body))  # *A* - Opción format
        or len(inbound_body.strip()) < 60
    )
    if not proactive and _is_greeting_only(inbound_body or ""):
        read_delay = random.uniform(GREETING_WAIT_MIN, GREETING_WAIT_MAX)
    elif is_menu_msg:
        read_delay = random.uniform(RESPONSE_DELAY_MENU_MIN, RESPONSE_DELAY_MENU_MAX)
    else:
        read_delay = random.uniform(RESPONSE_DELAY_MIN, RESPONSE_DELAY_MAX)

    # Jitter adicional por conversaciones paralelas — un humano no puede responder
    # 5 chats al mismo tiempo con el mismo ritmo. Si hay más de 1 sesión activa,
    # agrega hasta 30s extra al delay para que las respuestas no salgan en ráfaga.
    try:
        active_count = db.db.ai_followup_sessions.count_documents(
            {"status": "active", "ai_typing": False}
        )
        if active_count > 1:
            parallel_jitter = random.uniform(0, min(30, active_count * 6))
            read_delay += parallel_jitter
            log.info("[AIFollowup] parallel jitter +%.0fs (active_sessions=%d)", parallel_jitter, active_count)
    except Exception:
        pass

    log.info("[AIFollowup] reading delay %.0fs (menu=%s) for %s", read_delay, is_menu_msg, phone_number)
    time.sleep(read_delay)

    if not _is_business_hours():
        return

    # Re-fetch session with complete turns list
    session = db.db.ai_followup_sessions.find_one({"_id": sid})
    if not session:
        return

    # A human can disable the AI toggle (or the session can end for any other
    # reason — max_turns, idle sweep) WHILE this reply is sleeping through its
    # anti-detection delay above. Without this check, that sleep was the only
    # thing standing between "human just took over" and Andy sending a message
    # anyway seconds later — the toggle only ever updated Mongo, it never
    # actually interrupted a reply already in flight.
    if session.get("status") != "active":
        log.info("[AIFollowup] session %s status changed to %r during read delay — aborting send for %s",
                  sid, session.get("status"), phone_number)
        print(f"[AIFollowup] EXIT: session ended during delay (status={session.get('status')!r})")
        return

    # El negocio volvió a escribir durante la espera ("hola" … "¿en qué te ayudo?"): la respuesta
    # a ese mensaje cubre los dos. Antes esto solo se revisaba después de llamar al LLM.
    if not proactive and _newer_inbound_exists(db, company_id, inbound_log_id):
        print(f"[AIFollowup] EXIT: newer inbound arrived during the read delay — that one gets the reply ({phone_number})")
        return

    # Same blacklist/blocked re-check as above, for the same reason as the status
    # re-check above it: the company can get blocked/blacklisted DURING the delay.
    if _is_blocked_or_blacklisted(db, company_id, phone_number):
        print(f"[AIFollowup] EXIT: empresa bloqueada/en blacklist durante el delay — {company_id}")
        return

    # Hard-coded bot detection: if the contact has sent the same message before,
    # it's almost certainly a looping IVR/chatbot — close without spending LLM quota.
    # Skip in proactive mode (no real inbound to compare).
    if not proactive:
        prior_user_msgs = [
            t["content"] for t in session.get("turns", [])
            if t.get("role") == "user" and t.get("content") != inbound_body
        ]
        repeated = sum(1 for m in prior_user_msgs if m.strip() == (inbound_body or "").strip())
        if repeated >= 1:
            log.info("[AIFollowup] mensaje repetido detectado (bot loop) — cerrando sesión para %s", phone_number)
            db.db.ai_followup_sessions.update_one(
                {"_id": sid},
                {"$set": {"status": "ended", "end_reason": "repeated_message", "ai_typing": False}},
            )
            db.db.conversation_ai_prefs.update_one(
                {"company_id": company_id},
                {"$set": {"ai_enabled": False, "auto_disabled": True}},
                upsert=True,
            )
            return

    # Fast-path: ACK automático / auto-reply → cierre silencioso sin gastar LLM quota.
    # El clasificador ya lo detectaría, pero el LLM a temperatura 0.82 no siempre
    # sigue las reglas de [MENSAJE AUTOMÁTICO] de forma confiable. Cerramos aquí
    # directamente, sin enviar nada — el silencio ES la respuesta humana ante un ACK.
    # Except when it asks for our name ("Le atiende Sandra López, ¿con quién tengo el
    # gusto?" — Infiniti / Nissan Autocom, 2026-10-02): answering that is usually
    # what gets the chat to a person, so it goes to the LLM like any other message.
    if not proactive and not _asks_for_name(inbound_body or ""):
        try:
            if _is_auto_ack(inbound_body or ""):
                log.info("[AIFollowup] ACK/auto-reply detectado — cerrando silenciosamente para %s", phone_number)
                db.db.ai_followup_sessions.update_one(
                    {"_id": sid},
                    {"$set": {"status": "ended", "end_reason": "ai_decision", "ai_typing": False}},
                )
                db.db.conversation_ai_prefs.update_one(
                    {"company_id": company_id},
                    {"$set": {"ai_enabled": False, "auto_disabled": True}},
                    upsert=True,
                )
                return
        except Exception:
            pass  # si el classifier falla, deja que el LLM lo maneje

    # Pick a CONNECTED instance to send from — same rotation/preferred-instance
    # concept as routes.py's /send-message, instead of always the single
    # hardcoded EVOLUTION_INSTANCE. Without this, Andy goes permanently silent
    # the moment that one specific instance disconnects, even if others are
    # healthy. Resolved BEFORE calling the LLM (not just before sending) so
    # persona_name can be corrected to whichever instance actually ends up
    # sending this reply — see the persona_name fix below. Confirmed live in
    # production ("SEAT Furia"): the session's frozen context said
    # persona_name="Andrés" (the generic fallback, baked in back when
    # assigned_instance was still unset), but by send time the fallback here
    # picked "sender4", whose real WhatsApp profile name is "Marco Adrian" —
    # Andy would have introduced himself with a name that doesn't match the
    # account actually messaging the prospect.
    from app.providers.legacy.evolution import EvolutionClient, pick_connected_instance
    preferred_instance = None
    _inst_provider = "evolution"
    try:
        from bson import ObjectId
        if company_id and len(company_id) == 24:
            co = db.db.companies.find_one({"_id": ObjectId(company_id)}, {"assigned_instance": 1})
            preferred_instance = (co or {}).get("assigned_instance")
            if preferred_instance:
                _doc = db.db.instances.find_one({"name": preferred_instance}, {"provider": 1})
                _provider = (_doc or {}).get("provider", "")
                if _provider == "wasender":
                    _inst_provider = "wasender"
                elif _provider == "waha":
                    _inst_provider = "waha"
                elif _provider == "wwebjs":
                    _inst_provider = "wwebjs"
    except Exception:
        pass

    # No connected instance to send from is a structural problem (not a one-off
    # network blip) — every future reply on this chat would keep failing at this
    # exact point, wasting an LLM call each time. Close it and disable the toggle
    # so a human notices right away instead of the chat silently going dark.
    if _inst_provider == "wasender":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] Wasender: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            _close_session_without_reply(db, sid, company_id, phone_number, "no_instance")
            return
    elif _inst_provider == "waha":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] WAHA: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            _close_session_without_reply(db, sid, company_id, phone_number, "no_instance")
            return
    elif _inst_provider == "wwebjs":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] wwebjs: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            _close_session_without_reply(db, sid, company_id, phone_number, "no_instance")
            return
    else:
        # No assigned_instance (or one whose provider we couldn't resolve) means
        # we don't actually know which provider this company uses — this used to
        # assume Evolution unconditionally, but Evolution isn't a live provider
        # in this project anymore (wwebjs is the only one in active use), so that
        # assumption always found "nothing connected" and silently dropped the
        # reply. Confirmed live in production ("Come Bien", "Fenix El Super de
        # Casa"): the LLM generated a real reply that never got sent because of
        # this. Check wwebjs directly first — only fall back to the Evolution
        # check (kept for whatever legacy instances might still exist) if wwebjs
        # genuinely has nothing connected either.
        from app.whatsapp_wwebjs import get_all_connected_instances as _ww_all_connected
        _ww_candidates = _ww_all_connected(db)
        if _ww_candidates:
            instance = preferred_instance if preferred_instance in _ww_candidates else _ww_candidates[0]
            _inst_provider = "wwebjs"
        else:
            instance = pick_connected_instance(db, EVOLUTION_API_URL, EVOLUTION_API_KEY, preferred_instance)
        if not instance:
            log.warning("[AIFollowup] no hay ninguna instancia conectada — Andy no puede enviar a %s", phone_number)
            print(f"[AIFollowup] EXIT: sin instancias conectadas (phone={phone_number})")
            _close_session_without_reply(db, sid, company_id, phone_number, "no_instance")
            return
        if instance != preferred_instance and company_id and len(company_id) == 24:
            try:
                db.db.companies.update_one({"_id": ObjectId(company_id)}, {"$set": {"assigned_instance": instance}})
            except Exception:
                pass

    # "Cold start" must reflect the REAL conversation, not this session doc —
    # a manual reactivation (toggle) always creates a fresh ai_followup_sessions
    # doc with turn_count=0, which made every reactivation look like "the very
    # first reply ever" to the LLM, even deep into an already multi-message
    # thread. That mattered a lot: the cold-start prompt addendum tells the LLM
    # to bare-[FIN] anything that LOOKS like an automated ACK — a real person's
    # opener ("te atiende Fulano de [empresa], en que puedo ayudarte") reads
    # structurally just like one, and got closed out instead of answered.
    # Count real inbound messages for this company instead: only the very
    # first one is a genuine cold start.
    _real_inbound_count = db.db.message_logs.count_documents(
        {"company_id": company_id, "direction": "inbound"}
    )
    is_cold_start = _real_inbound_count <= 1 and not proactive

    # In proactive mode, inject a synthetic "[Sin respuesta]" user turn so the LLM
    # has the right alternating user/assistant pattern and knows to continue.
    _llm_turns = list(session.get("turns", []))
    _proactive_minutes = None
    if proactive:
        last_act = session.get("last_activity") or session.get("created_at") or datetime.utcnow()
        _proactive_minutes = max(1, int((datetime.utcnow() - last_act).total_seconds() / 60))
        _llm_turns.append({"role": "user", "content": "[Sin respuesta]"})

    _prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}

    # persona_name in session.context was frozen in at session-creation time —
    # possibly before assigned_instance was even set, or from one that's since
    # changed. Correct it here against the instance resolved above, the one
    # actually about to send this message, so Andy never claims a name that
    # doesn't match the WhatsApp account the prospect is really talking to.
    _llm_context = dict(session.get("context", {}))
    if instance:
        try:
            _inst_doc_persona = db.db.instances.find_one({"name": instance}, {"profile_name": 1, "number": 1}) or {}
            _real_profile_name = (_inst_doc_persona.get("profile_name") or "").strip()
            if _real_profile_name and _inst_provider == "wwebjs":
                _llm_context["persona_name"] = _real_profile_name.split()[0]
                _llm_context["persona_full_name"] = _real_profile_name
            # The number Andy is actually writing from — it used to have a made-up
            # one in the prompt and, asked "¿es correcto el 5527479218?" (its own
            # number), answered it didn't have that number at hand (Renault
            # Grupo Geisha, 2026-10-02).
            _own = _national_number(_inst_doc_persona.get("number", ""))
            if _own:
                _llm_context["own_number"] = _own
        except Exception:
            pass

    # Fillers / openers already used in this conversation — the prompt tells the
    # model to avoid them, and a reply that repeats one gets one retry below.
    _prior_replies = [t.get("content") or "" for t in session.get("turns", []) if t.get("role") == "assistant"]
    _used = _used_fillers(_prior_replies)

    # Mark AI as typing (frontend polls this) — now that we know there's an
    # instance to actually send through, not before (a "no_instance" close
    # above would otherwise flash ai_typing=True for a message that was never
    # going anywhere).
    db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": True}})

    ai_text_raw = _call_llm_for_reply(_llm_turns, _llm_context,
                                       is_cold_start=is_cold_start, prefs=_prefs, db=db,
                                       proactive_minutes=_proactive_minutes, used_fillers=_used)
    print(f"[AIFollowup] LLM response: {repr(ai_text_raw[:80]) if ai_text_raw else 'None'}")
    if not ai_text_raw:
        # _call_llm_for_reply already swallowed the real error (rate limit, circuit
        # breaker, network blip — see its own except block) and logged it. Deliberately
        # NOT closing the session here: this is typically transient and self-heals on
        # the next attempt (a new inbound message, or the idle-timeout sweep in
        # followup_queue.py if the contact never writes again) — closing on a single
        # failed API call would kill a healthy conversation over what's often a blip.
        print("[AIFollowup] EXIT: LLM returned None")
        return

    # Detect AI-initiated close signal and strip it (plus "[2]"-style markers and
    # ¿/¡/final period — see _clean_reply) before sending.
    _inbound_text = inbound_body or ""
    ai_text, ai_wants_end = _clean_reply(ai_text_raw, _inbound_text)

    # Guard against the LLM copying one of the prompt's own tone examples
    # verbatim instead of generating something contextual (see
    # _looks_copied_from_prompt) — confirmed live in production ("Come Bien"):
    # it sent a CUANDO TE CONFRONTAN example even though nobody had accused it
    # of being a bot. One retry with an explicit correction; if it happens
    # again (or the retry itself fails), close without sending rather than
    # deliver something that doesn't match the actual conversation.
    if ai_text and _looks_copied_from_prompt(ai_text):
        log.warning("[AIFollowup] LLM copied a prompt example verbatim — retrying: %r", ai_text[:80])
        print(f"[AIFollowup] LLM copied a prompt example — retrying: {ai_text[:80]!r}")
        ai_text_raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction="tu respuesta anterior fue una de las frases de ejemplo de este prompt, copiada tal "
                       "cual — eso está prohibido. genera una respuesta distinta y original, en tus propias "
                       "palabras, que reaccione específicamente a lo que la otra persona te acaba de escribir.",
        )
        ai_text, ai_wants_end = _clean_reply(ai_text_raw_retry, _inbound_text)
        if not ai_text_raw_retry or _looks_copied_from_prompt(ai_text):
            log.warning("[AIFollowup] LLM copied a prompt example again after retry — closing without sending")
            print("[AIFollowup] EXIT: copied example persisted after retry")
            _close_session_without_reply(db, sid, company_id, phone_number, "ai_decision")
            return

    # They asked for our name and the model chose silence anyway (an automated
    # greeting can still be the step before a person) — answer with the name of
    # the WhatsApp account that's writing, and keep the session open.
    if not ai_text and not proactive and _asks_for_name(_inbound_text):
        ai_text = _llm_context.get("persona_name") or DEFAULT_PERSONA_NAME
        ai_wants_end = False

    # The same filler or opener twice in one conversation reads like a script
    # ("chido" twice in Fame Querétaro, 2026-10-02) — one retry asking for other
    # words. If the retry fails or is unusable, the original reply still goes out.
    _rep = _repeated_filler(ai_text, _prior_replies)
    if _rep:
        print(f"[AIFollowup] repeated filler {_rep!r} — retrying once")
        _raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction=f"tu respuesta repetía '{_rep}', que ya usaste en esta conversación. "
                       "di lo mismo con otras palabras, sin esa muletilla ni ese arranque.",
        )
        _retry_text, _retry_end = _clean_reply(_raw_retry, _inbound_text)
        if _retry_text and not _looks_copied_from_prompt(_retry_text):
            ai_text, ai_wants_end = _retry_text, _retry_end

    # Demasiado larga para WhatsApp: un reintento pidiendo lo esencial. Si sale larga otra vez,
    # se manda la original (mejor larga que nada).
    if ai_text and _too_long(ai_text):
        print(f"[AIFollowup] reply too long ({len(ai_text.split())} words) — retrying once")
        _raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction=f"tu respuesta era muy larga ({len(ai_text.split())} palabras). di solo lo esencial, en "
                       "máximo 15 palabras, y contesta solo lo que te preguntaron.",
        )
        _retry_text, _retry_end = _clean_reply(_raw_retry, _inbound_text)
        if _retry_text and not _too_long(_retry_text) and not _looks_copied_from_prompt(_retry_text):
            ai_text, ai_wants_end = _retry_text, _retry_end

    # Never take a slot or give booking data (see _BOOKING_COMMIT_RE): one retry
    # with the rule spelled out, else a fixed "déjame ver y te confirmo" — and
    # the conversation ends there either way, as the prompt asks.
    _recent_inbound = " ".join([t.get("content") or "" for t in _llm_turns[-6:] if t.get("role") == "user"]
                               + [_inbound_text])
    if ai_text and _is_booking_step(_recent_inbound) and _commits_to_booking(ai_text, _inbound_text):
        print(f"[AIFollowup] reply commits to a booking — retrying: {ai_text[:80]!r}")
        _raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction="tu respuesta aceptaba la cita, escogía un día u hora o daba datos para la reserva "
                       "(nombre completo, placa, correo). eso está prohibido: no vas a poder ir. responde corto, "
                       "con tus palabras, que lo revisas y les confirmas, sin fechas ni horas ni datos, y termina con [FIN].",
        )
        _retry_text, _ = _clean_reply(_raw_retry, _inbound_text)
        if (_retry_text and not _commits_to_booking(_retry_text, _inbound_text)
                and not _looks_copied_from_prompt(_retry_text)):
            ai_text = _retry_text
        else:
            ai_text = BOOKING_DEFLECT_REPLY
        ai_wants_end = True

    # Una cita falsa ya ocurrió en Nissan La Capilla (2026-10-04); el mismo tipo de
    # alucinación no puede convertirse en compra, pedido, pago o contrato real. Se
    # reintenta una vez y, si insiste, sale un cierre fijo sin aceptar la operación.
    if ai_text and _is_transaction_step(_recent_inbound) and _commits_to_transaction(ai_text, _inbound_text):
        print(f"[AIFollowup] reply commits to a transaction — retrying: {ai_text[:80]!r}")
        _raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction="tu respuesta confirmaba una compra, pedido, pago, apartado o contrato. eso está "
                       "prohibido: no puedes realizar operaciones reales ni inventar datos de entrega, pago o "
                       "facturación. responde corto que primero lo revisas y avisas, y termina con [FIN].",
        )
        _retry_text, _ = _clean_reply(_raw_retry, _inbound_text)
        if (_retry_text and not _commits_to_transaction(_retry_text, _inbound_text)
                and not _looks_copied_from_prompt(_retry_text)):
            ai_text = _retry_text
        else:
            ai_text = TRANSACTION_DEFLECT_REPLY
        ai_wants_end = True

    # Hablar de bots, IA o "persona real" delata al Chat IA, aunque sea para negarlo
    # (Nissan Autocom, 2026-10-04). Si el reintento lo repite, no se manda nada.
    if ai_text and _references_being_bot(ai_text):
        print(f"[AIFollowup] reply mentions being a bot — retrying: {ai_text[:80]!r}")
        _raw_retry = _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used,
            correction="tu respuesta hablaba de bots, IA, robots o de ser una persona real. está prohibido "
                       "mencionarlo, también para negarlo, aunque te lo hayan preguntado. responde corto "
                       "solo a lo que buscas, sin esas palabras.",
        )
        _retry_text, _retry_end = _clean_reply(_raw_retry, _inbound_text)
        if (_retry_text and not _references_being_bot(_retry_text)
                and not _looks_copied_from_prompt(_retry_text)):
            ai_text, ai_wants_end = _retry_text, _retry_end
        else:
            ai_text = ""

    # Ya tiene lo que vino a buscar (cita ofrecida, precio, contacto a donde llamar):
    # esta respuesta cierra la plática, sin más preguntas (ver _goal_reached).
    _goal = None if proactive else _goal_reached(_business_since_last_reply(_llm_turns, _inbound_text))
    if ai_text and _goal:
        print(f"[AIFollowup] goal reached ({_goal}) — this reply closes the conversation")
        ai_text = _close_on_goal(ai_text, _goal, lambda correction: _call_llm_for_reply(
            _llm_turns, _llm_context, is_cold_start=is_cold_start, prefs=_prefs, db=db,
            proactive_minutes=_proactive_minutes, used_fillers=_used, correction=correction))
        ai_wants_end = True

    # Una "opción" que el menú no tiene ("H" a un menú de 1 a 3): mejor no mandar nada.
    if ai_text and _invalid_menu_pick(ai_text, _business_since_last_reply(_llm_turns, _inbound_text)):
        print(f"[AIFollowup] menu pick {ai_text!r} is not one of the options — not sending")
        ai_text = ""

    # El negocio nos acaba de preguntar algo y lo contestamos: la plática sigue, aunque el modelo
    # haya puesto [FIN] — salvo que la respuesta sea una despedida o un "déjame ver y te confirmo".
    # Antes cerraba al contestar "¿qué auto es?" y ya no llegaba al precio (simulador, 2026-10-06).
    if (ai_text and ai_wants_end and not _goal and "?" in _inbound_text
            and not _says_goodbye(ai_text) and not _DEFLECT_RE.search(_fold(ai_text))):
        ai_wants_end = False

    # Una respuesta que pregunta algo espera contestación: no puede cerrar la plática. El modelo
    # a veces mandaba "…ustedes lo hacen? [FIN]" y la respuesta del negocio ya no se contestaba
    # (simulador, 2026-10-06).
    if ai_text and "?" in ai_text:
        ai_wants_end = False

    # Nothing left to send — a bare "[FIN]" (the model decided the conversation is
    # over with nothing to add) or a reply that was only markers like "[2]". Every
    # send path rejects an empty message, and the broad handler at the bottom of
    # this function only resets ai_typing — the session used to be left stuck at
    # status="active" forever. Close it directly instead of attempting to send.
    if not ai_text:
        _close_session_without_reply(db, sid, company_id, phone_number, "ai_decision")
        return

    # The business wrote again while this reply was being generated — drop it;
    # the reply covering their newest message answers everything together (see
    # _newer_inbound_exists). The inbound turn stays in the session for that one.
    if not proactive and _newer_inbound_exists(db, company_id, inbound_log_id):
        print(f"[AIFollowup] EXIT: newer inbound arrived — dropping stale reply for {phone_number}")
        db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
        return

    # Blocked while the LLM was generating (the earlier checks ran before the
    # read delay and the LLM call) — don't send.
    if _is_blocked_or_blacklisted(db, company_id, phone_number):
        print(f"[AIFollowup] EXIT: blocked/blacklisted while generating — {company_id}")
        db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
        return

    # Daily cap guard — Andy respects the same limit as campaigns. Reserved
    # atomically BEFORE sending (not checked-then-incremented-after) so a
    # concurrent campaign/queue send hitting the same instance can't both
    # pass a stale "under cap" read — see daily_cap.reserve_daily_slot.
    _cap_reserved_new = False
    try:
        from app.daily_cap import get_instance_cap as _gcap, notify_cap_reached_once as _ncr, reserve_daily_slot as _reserve_daily
        from app.phone_utils import clean_digits as _clean_ai
        _phone_digits_cap = _clean_ai(phone_number)
        _DCAP = _gcap(db, instance)
        _cap_reserved, _cap_reserved_new = _reserve_daily(db, instance, _DCAP, _phone_digits_cap)
        if not _cap_reserved:
            log.warning("[AIFollowup] daily cap %d reached for %s — skipping Andy reply to %s", _DCAP, instance, phone_number)
            _ncr(db, instance)
            # Deliberately NOT closing the session here (unlike no_instance/ai_decision) —
            # the daily cap resets on its own at midnight, so this self-heals without any
            # human action. Closing + disabling the toggle would just force someone to
            # manually re-enable it tomorrow for a problem that already fixed itself.
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
    except Exception:
        pass

    # Second re-check, right before the irreversible send — the ONLY earlier
    # check (right after the read-delay, above) closes that sleep's window but
    # leaves the much larger gap created by the LLM call itself (often several
    # seconds, longer still on the copied-example retry path) completely
    # unguarded: a human toggling AI off, or the session ending for any other
    # reason, during that gap did not stop Andy from sending anyway (real
    # customer-facing bug, audit finding 2026-09-30 — confirmed no re-check of
    # any kind existed between "LLM finished generating" and "message actually
    # sent", other than the Evolution path's own typing-delay sleep, which has
    # no check of its own either). Same default (False) as api_get_ai_status
    # uses elsewhere — no prefs doc means AI was never explicitly turned on.
    _session_recheck = db.db.ai_followup_sessions.find_one({"_id": sid}, {"status": 1})
    _prefs_recheck = db.db.conversation_ai_prefs.find_one({"company_id": company_id}, {"ai_enabled": 1}) or {}
    if not _session_recheck or _session_recheck.get("status") != "active" or not _prefs_recheck.get("ai_enabled", False):
        log.info("[AIFollowup] aborting send for %s — status/ai_enabled changed after LLM reply was generated "
                 "(session_status=%r, ai_enabled=%r)",
                 phone_number, (_session_recheck or {}).get("status"), _prefs_recheck.get("ai_enabled"))
        print("[AIFollowup] EXIT: status/ai_enabled changed just before send")
        db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
        return

    try:
        if _inst_provider == "wasender":
            from app.providers.legacy.wasender import WasenderClient, _clean_digits as _ws_clean
            from app.config import WASENDER_BASE_URL
            inst_doc = db.db.instances.find_one({"name": instance}, {"wasender_api_key": 1, "number": 1})
            _ws_api_key = (inst_doc or {}).get("wasender_api_key", "")
            ws_client = WasenderClient(WASENDER_BASE_URL, _ws_api_key, instance,
                                       own_number=(inst_doc or {}).get("number", ""))
            _phone_digits = _ws_clean(phone_number)
            db.db.jid_map.update_one({"jid": _phone_digits},
                {"$set": {"company_id": company_id, "updated_at": datetime.now()}}, upsert=True)
            try:
                from bson import ObjectId as _OIdAI
                _co_ai = db.db.companies.find_one({"_id": _OIdAI(company_id)}, {"name": 1}) if company_id and len(company_id) == 24 else None
                _co_name_ai = (_co_ai or {}).get("name", "") or _phone_digits
                ws_client.label_contact(_phone_digits, _co_name_ai)
            except Exception:
                pass
            typing_delay_ms = _typing_duration_ms(ai_text)
            send_result = ws_client.send_text(phone_number, ai_text, delay_ms=typing_delay_ms)
            resp_json = send_result.get("response_json", {})
            _ws_data = resp_json.get("data") or {}
            message_id = _ws_data.get("message_id") or _ws_data.get("id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"
        elif _inst_provider == "waha":
            from app.providers.legacy.waha import WAHAClient, _clean_digits as _waha_clean
            from app.config import WAHA_API_URL, WAHA_API_KEY
            waha_client = WAHAClient(WAHA_API_URL, WAHA_API_KEY, instance)
            _real_jid = waha_client.get_jid(phone_number)
            _phone_digits = _waha_clean(phone_number)
            # Map phone digits so inbound webhook can route replies correctly
            db.db.jid_map.update_one({"jid": _phone_digits},
                {"$set": {"company_id": company_id, "updated_at": datetime.now()}}, upsert=True)
            if _real_jid and _real_jid != _phone_digits:
                db.db.jid_map.update_one({"jid": _real_jid},
                    {"$set": {"company_id": company_id, "updated_at": datetime.now()}}, upsert=True)
            try:
                from bson import ObjectId as _OId
                if company_id and len(company_id) == 24:
                    _co = db.db.companies.find_one({"_id": _OId(company_id)}, {"name": 1})
                    _co_name = (_co or {}).get("name", "")
                    if _co_name:
                        waha_client.label_contact(_phone_digits, _co_name)
            except Exception:
                pass
            typing_delay_ms = _typing_duration_ms(ai_text)
            send_result = waha_client.send_text(phone_number, ai_text, delay_ms=typing_delay_ms)
            resp_json = send_result.get("response_json", {})
            message_id = resp_json.get("id") or resp_json.get("key", {}).get("id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"
        elif _inst_provider == "wwebjs":
            from app.whatsapp_wwebjs import WWebjsClient, mark_read as _ww_mark_read
            _ww_phone = "".join(filter(str.isdigit, phone_number))
            ww_client = WWebjsClient(instance)
            # Mark inbound as read (blue ticks) BEFORE composing indicator starts —
            # a real human opens the chat → double-tick turns blue → then starts typing.
            _ww_mark_read(instance, _ww_phone)
            # Resolve contact name for addressbook save
            _co_name_ai = ""
            try:
                from bson import ObjectId as _OIdWW
                if company_id and len(company_id) == 24:
                    _co_ww = db.db.companies.find_one({"_id": _OIdWW(company_id)}, {"name": 1})
                    _co_name_ai = (_co_ww or {}).get("name", "") or _ww_phone
            except Exception:
                pass
            db.db.jid_map.update_one({"jid": _ww_phone},
                {"$set": {"company_id": company_id, "updated_at": datetime.now()}}, upsert=True)
            typing_delay_ms = _typing_duration_ms(ai_text)
            send_result = ww_client.send(phone_number, ai_text, delay_ms=typing_delay_ms,
                                         save_contact=bool(_co_name_ai), contact_name=_co_name_ai)
            message_id = send_result.get("messageId")
            status = "sent" if send_result.get("success") else "failed"
            resp_json = send_result
        else:
            # Simulate typing on WhatsApp (Evolution native presence API)
            _send_typing_presence(phone_number, instance)
            time.sleep(_typing_duration_ms(ai_text) / 1000)
            evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, instance)
            send_result = evo.send_text(phone_number, ai_text)
            resp_json = send_result.get("response_json", {})
            message_id = resp_json.get("key", {}).get("id") or resp_json.get("id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"

        if status != "sent" and _cap_reserved_new:
            from app.daily_cap import release_daily_slot as _release_daily
            from app.phone_utils import clean_digits as _clean_ai
            _release_daily(db, instance, _clean_ai(phone_number))

        # Persist AI message in message_logs
        from datetime import datetime as _dt
        _ai_inst_doc = db.db.instances.find_one({"name": instance}, {"number": 1}) or {}
        ai_log_id = db.insert_message_log({
            "platform": _inst_provider,
            "direction": "outbound",
            "channel": "whatsapp",
            "company_id": company_id,
            "to_number": phone_number,
            "message_body": ai_text,
            "message_text": ai_text,
            "message_id": message_id,
            "message_type": "conversation",
            "status": status,
            "instance_name": instance,
            "instance_number": _ai_inst_doc.get("number", ""),
            "sent_by_username": "ai_andy",
            "sent_by_name": "Andy",
            "ai_generated": True,
            "raw_data": send_result,
            "created_at": _dt.utcnow(),
        })

        new_count = session.get("turn_count", 0) + 1
        # The business said goodbye and Andy just answered it — the conversation is
        # over even if the model forgot [FIN]; otherwise the session sat "waiting"
        # (AI icon on) for the whole 48h idle timeout (PASA Tijuana, Fame, 2026-10-02).
        if not proactive and _is_farewell(inbound_body or "") and "?" not in ai_text:
            ai_wants_end = True
        # Andy se despidió él mismo, aunque olvidara [FIN] — la plática terminó. Sin
        # esto cada recordatorio del negocio ("te esperamos el 12/10 a las 09:00")
        # recibía otra despedida (Nissan Autocom, 2026-10-04: 8 despedidas seguidas).
        if _says_goodbye(ai_text):
            ai_wants_end = True
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

        # Auto-disable AI toggle when conversation closes naturally. Marked
        # auto_disabled=True (not a real user decision) so a genuine reply that
        # arrives later on this same company can still auto-reactivate — see
        # _user_explicitly_disabled in the webhook handlers, which only treats
        # a *manual* disable (via the toggle UI) as a real "never again" signal.
        if is_ended:
            db.db.conversation_ai_prefs.update_one(
                {"company_id": company_id},
                {"$set": {"ai_enabled": False, "auto_disabled": True}},
                upsert=True,
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
        # Always reset ai_typing so the frontend never gets permanently stuck.
        # Deliberately NOT closing the session here either — same reasoning as the
        # "LLM returned None" branch above: a send exception (network blip, provider
        # API hiccup) is usually transient and should get another shot on the next
        # inbound message rather than permanently ending a healthy conversation.
        db.db.ai_followup_sessions.update_one(
            {"_id": sid}, {"$set": {"ai_typing": False}}
        )
