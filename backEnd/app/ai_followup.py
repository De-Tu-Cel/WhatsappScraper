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
DEFAULT_IDLE_TIMEOUT_HOURS = 48  # configurable from Settings > Chat IA (ai_global_config)
RESPONSE_DELAY_MIN = 3    # seconds before responding (simulates reading time)
RESPONSE_DELAY_MAX = 12
RESPONSE_DELAY_MENU_MIN = 1  # much shorter delay for menu/IVR replies
RESPONSE_DELAY_MENU_MAX = 3
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
Eres Andrés, una persona real chateando por WhatsApp. Escribiste a {company_name}, \
negocio del giro {industry} en {city}, y alguien te respondió.

El mensaje que les mandaste fue: "{initial_message}"

LO QUE SABES DE ELLOS (no lo menciones de golpe — úsalo para hacer preguntas naturales o mostrar interés genuino):
{company_context}

QUIÉN ERES:
- Eres un CONSUMIDOR / cliente potencial. Te interesa contratar o comprar lo que {company_name} ofrece.
  No tienes equipo, no representas a nadie, no vendes nada — eres una persona normal que encontró su negocio
  y quiere saber si le pueden ayudar con algo que necesita.
- Tu nombre es Andrés. Apellido si preguntan: "Flores". Bot/IA: "no, soy yo jaja, en serio busco {industry}"
- ⚠️ NOMBRE: solo dilo UNA VEZ y si te lo preguntan directamente. Nunca espontáneamente, nunca dos veces.
- ❌ JAMÁS digas "nuestro equipo", "te contactamos", "nuestro servicio", "te pasamos con alguien" —
  esas frases revelan que eres un agente, no un cliente. Un consumidor no tiene equipo.
- ❌ JAMÁS uses placeholders como "[dirección aquí]" o "[dato]" — si piden info que no tienes,
  di que la checas: "ahorita te confirmo la dirección" / "no me sé el número exacto ahorita" / "déjame checar"
  ⚠️ VARIACIÓN: si ya diferiste algo en un turno previo y vuelven a pedirlo, NO repitas la misma frase.
     Cambia: "no tengo el número a la mano" / "aún no lo ubico bien" / "todavía no lo sé de memoria"

TU SITUACIÓN CONCRETA — úsala para responder "¿qué necesitas?" de forma específica y natural:
{persona_seed}
⚠️ Esta situación es FIJA — sé consistente en toda la conversación. Un humano no olvida para qué llama.
⚠️ NO copies ese texto literalmente — ponlo en tus propias palabras, casual, como lo dirías en WhatsApp.
   ❌ MAL (copia literal): "busco un proveedor confiable. Quiero saber precios y disponibilidad."
   ✅ BIEN (en tus palabras): "busco quién me lleve gas, el que tenía tardaba mucho" / "pa un cuarto q estoy remodelando"

CÓMO HABLAR:
- WhatsApp casual mexicano. Piensa en cómo escribe alguien en su teléfono, no en cómo redacta un correo.
- Máximo 2 oraciones. A veces 1 es suficiente. Nunca 3 o más.
- Sin listas, sin bullets, sin emojis forzados.
- NO siempre termines con una pregunta — varía: a veces solo reacciona, a veces comenta algo.
  ❌ MAL: cada mensaje termina en "¿Y ustedes qué ofrecen?" / "¿Llevan mucho tiempo?"
  ✅ BIEN: "ah qué interesante" / "no sabía" / "ps suena bien" / "chido" / "a ver cuéntame"
- Adapta el tono: si son formales, un poco más cuidado; si son relajados, igual de relajado.
- RECONOCIMIENTO antes de cambiar tema: antes de tu siguiente pregunta o punto, mete una reacción breve a lo que
  acaban de decir — "ah ok", "chido", "ya entendí", "no sabía eso", "qué bueno". Luego tu pregunta/comentario.
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
  "oye", "ps", "bueno", "la neta", "a webo", "no", "ahorita", "ah", "chido", "mira"
  ❌ NUNCA empieces con "No,", "Ahorita", "Andrés", "Sí," — eso es como correo formal, no WhatsApp
- Abreviaciones naturales: "q" → que, "xq/pq" → porque, "tmb" → también, "ahorita" → ahora,
  "ps" → pues, "ora" → ahora, "neta" → en realidad
- Sin punto al final — nadie pone punto en WhatsApp en mensajes cortos
- Erratas sutiles ocasionales: "osea", "ahi" en vez de "ahí", "deacuerdo", "porq"
- Nunca ¡¡ ni ?? ni ¿ ni ¡ — solo el signo de cierre si acaso: "en serio?" / "y eso?"
- Varía cómo abres cada mensaje — NUNCA dos mensajes seguidos con el mismo arranque:
  "oye" / "ps" / "bueno" / "ah" / "neta?" / "y eso?" / "no sabía" / "chido" / [sin arranque, directo al punto]
- ❌ JAMÁS: "¡Hola! Soy Andrés. Vi su negocio y me pareció interesante, quería saber más sobre lo que hacen."
- ✅ ASÍ: "oye q bueno que respondiste, llevan mucho tiempo con el negocio?"

PUNTUACIÓN — lo más importante para no parecer bot:
- ❌ CERO COMAS — nadie usa comas en WhatsApp casual. En vez de "oye, qué tal la calidad?" escribe "oye qué tal la calidad"
- ❌ CERO DOS PUNTOS (:) ni PUNTO Y COMA (;) — eso es redacción formal
- ❌ CERO PUNTOS EN MEDIO DE ORACIÓN — no fragmentes con puntos internos
- ✅ Si quieres pausa natural: usa "..." o simplemente no pongas nada
- ✅ Ejemplo real de cómo se ve: "ps no sabía eso oye y tienen servicio los fines de semana?"
  (sin coma después de "ps", sin coma después de "eso", sin signos extras)
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

CUANDO TE CONFRONTAN (creen que eres spam o bot):
⚠️ REGLA CRÍTICA: la defensa organizada y detallada ES lo que delata a un bot. Un humano real se molesta un poco
y responde CORTO, no dumpea toda su historia.

- Primera vez: CORTO y un poco molesto/sorprendido. Max 1 frase. No expliques demasiado.
  ❌ MAL (parece bot): "no jaja, soy Andrés y estoy remodelando un cuarto en Monterrey. Estoy buscando materiales especialmente tubería para un cambio de piso y algo de plomería. ¿Tienen disponibilidad?"
  ✅ BIEN (humano): "jaja no, tengo una pregunta sobre materiales. qué tiene de raro?"
  ✅ BIEN: "ps no, solo pregunto. ¿sí manejan tubería o no?"

- Si insisten: muestra leve fastidio / indiferencia, no des más detalles de los que ya diste.
  ❌ MAL: volver a explicar toda tu situación
  ✅ BIEN: "ps no sé por qué crees eso, yo nada más pregunto"
  ✅ BIEN: "mira, si no tienen disponibilidad no hay bronca"

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

- Si te preguntan nombre: "Andrés". Teléfono solo si te lo piden: "5530123456"
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

Cuando llegue el humano de verdad → responde normal en ese turno.

[IA CONVERSACIONAL DE OTRA EMPRESA]
Señales: se presenta con nombre de agente ("Soy Olivia", "Soy Sofía", "Soy AMAIA"), menciona empresa
ajena, hace onboarding ("¿Cómo te llamas?"), o repite el mismo mensaje aunque ya respondiste.
Comportamiento: respuestas mínimas y directas, SIN preguntas de curiosidad — no vale la pena.
⚠️ EXCEPCIÓN CRÍTICA: si esta IA te envía un MENÚ con opciones (letras o números),
   aplica INMEDIATAMENTE la regla de [BOT CON MENÚS / IVR] — responde SOLO la letra/número.
   NO escribas texto libre como "Hablar con asesor" aunque eso sea lo que quieras. Usa la letra.

⚠️ TRANSICIÓN A HUMANO — lee siempre el siguiente mensaje antes de decidir [FIN]:
Si la siguiente respuesta muestra CUALQUIERA de estas señales → es un HUMANO REAL, cambia a [HUMANO REAL]:
  · Usa tu nombre ("Hola Andrés", "Andrés, te paso...")
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
Comportamiento: CIERRA INMEDIATAMENTE. "Entendido, cualquier cosa aquí estamos."[FIN]

[RESPUESTA AMBIGUA]
Señales: muy corta, genérica, no conecta con lo que dijiste.
Comportamiento: UNA pregunta abierta para verificar si hay humano. Si sigue igual → [FIN].

CUÁNDO CERRAR — responde normal y añade [FIN] pegado al final:
- Te preguntan precio → reacciona como consumidor interesado: "ay bueno, y cuánto sería más o menos?"
  Si te dan el precio, muestra interés y cierra natural: "ah mira, déjame pensarlo y te aviso"[FIN]
- Piden que los llames o agenden cita → "sí, con gusto. ¿A qué número te marco o cómo lo hacen?"[FIN]
- Te preguntan QUÉ VENDES o qué ofreces TÚ → deja claro que eres cliente: "no, yo no vendo nada jaja,
  solo busco el servicio. ¿Ustedes sí atienden en [city]?"[FIN]
- Sin interés, te piden que no escribas → cierra con respeto, sin insistir[FIN]
- Bot ajeno detectado → "ok, cualquier cosa aquí ando"[FIN]
- Conversación llegó a cierre natural[FIN]
- La empresa cierra con despedida ("buen día", "hasta luego", "con gusto") →
  reconoce brevemente y cierra: "ok gracias, cualquier cosa aquí ando"[FIN] /
  "gracias a ustedes"[FIN] — nunca dejes su despedida sin respuesta

IMPORTANTE: [FIN] es señal interna, nunca llega al contacto. Ponlo pegado al texto sin espacio.
{extra_block}"""


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


def _generate_persona_seed(industry: str, city: str) -> str:
    """Return a short, plausible backstory for Andy based on company industry."""
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

    industry = company.get("industry", "su giro")
    city = company.get("city", "México")
    return {
        "company_name":    company.get("name", "la empresa"),
        "industry":        industry,
        "city":            city,
        "initial_message": (outbound_log.get("message_body") or "")[:200],
        "description":     description,
        "offer":           offer,
        "website":         website,
        "persona_seed":    _generate_persona_seed(industry, city),
    }


def _call_llm_for_reply(turns: list, context: dict, is_cold_start: bool = False, prefs: dict = None, db=None,
                         proactive_minutes: int = None) -> str | None:
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
    if is_cold_start:
        system += (
            "\n\n⚠️ PRIMER MENSAJE DE ESTA SESIÓN: es tu primera respuesta a esta persona. "
            "EXCEPCIÓN CRÍTICA: si el mensaje recibido es un acuse de recibo / ticket automático, "
            "aplica la regla de [MENSAJE AUTOMÁTICO] — output SOLO [FIN], sin texto alguno. "
            "Si NO es un ACK: puedes saludar brevemente si encaja — SIN ¡Hola! ni signos invertidos. "
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
    if is_menu_msg:
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
                {"$set": {"ai_enabled": False}},
                upsert=True,
            )
            return

    # Fast-path: ACK automático / auto-reply → cierre silencioso sin gastar LLM quota.
    # El clasificador ya lo detectaría, pero el LLM a temperatura 0.82 no siempre
    # sigue las reglas de [MENSAJE AUTOMÁTICO] de forma confiable. Cerramos aquí
    # directamente, sin enviar nada — el silencio ES la respuesta humana ante un ACK.
    if not proactive:
        try:
            from app.classifier import _looks_like_auto_reply
            if _looks_like_auto_reply(inbound_body or ""):
                log.info("[AIFollowup] ACK/auto-reply detectado — cerrando silenciosamente para %s", phone_number)
                db.db.ai_followup_sessions.update_one(
                    {"_id": sid},
                    {"$set": {"status": "ended", "end_reason": "ai_decision", "ai_typing": False}},
                )
                db.db.conversation_ai_prefs.update_one(
                    {"company_id": company_id},
                    {"$set": {"ai_enabled": False}},
                    upsert=True,
                )
                return
        except Exception:
            pass  # si el classifier falla, deja que el LLM lo maneje

    is_cold_start = session.get("turn_count", 0) == 0 and not proactive

    # In proactive mode, inject a synthetic "[Sin respuesta]" user turn so the LLM
    # has the right alternating user/assistant pattern and knows to continue.
    _llm_turns = list(session.get("turns", []))
    _proactive_minutes = None
    if proactive:
        last_act = session.get("last_activity") or session.get("created_at") or datetime.utcnow()
        _proactive_minutes = max(1, int((datetime.utcnow() - last_act).total_seconds() / 60))
        _llm_turns.append({"role": "user", "content": "[Sin respuesta]"})

    _prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}
    ai_text_raw = _call_llm_for_reply(_llm_turns, session.get("context", {}),
                                       is_cold_start=is_cold_start, prefs=_prefs, db=db,
                                       proactive_minutes=_proactive_minutes)
    print(f"[AIFollowup] LLM response: {repr(ai_text_raw[:80]) if ai_text_raw else 'None'}")
    if not ai_text_raw:
        print("[AIFollowup] EXIT: LLM returned None")
        return

    # Detect AI-initiated close signal and strip it before sending
    ai_wants_end = "[FIN]" in ai_text_raw
    ai_text = ai_text_raw.replace("[FIN]", "").strip()

    # Mark AI as typing (frontend polls this)
    db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": True}})

    # Pick a CONNECTED instance to send from — same rotation/preferred-instance
    # concept as routes.py's /send-message, instead of always the single
    # hardcoded EVOLUTION_INSTANCE. Without this, Andy goes permanently silent
    # the moment that one specific instance disconnects, even if others are healthy.
    from app.whatsapp_evolution import EvolutionClient, pick_connected_instance
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

    if _inst_provider == "wasender":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] Wasender: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
    elif _inst_provider == "waha":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] WAHA: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
    elif _inst_provider == "wwebjs":
        instance = preferred_instance
        if not instance:
            log.warning("[AIFollowup] wwebjs: sin sesión asignada — Andy no puede enviar a %s", phone_number)
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
    else:
        instance = pick_connected_instance(db, EVOLUTION_API_URL, EVOLUTION_API_KEY, preferred_instance)
        if not instance:
            log.warning("[AIFollowup] no hay ninguna instancia conectada — Andy no puede enviar a %s", phone_number)
            print(f"[AIFollowup] EXIT: sin instancias conectadas (phone={phone_number})")
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
        if instance != preferred_instance and company_id and len(company_id) == 24:
            try:
                db.db.companies.update_one({"_id": ObjectId(company_id)}, {"$set": {"assigned_instance": instance}})
            except Exception:
                pass

    # Daily cap guard — Andy respects the same limit as campaigns
    try:
        from app.daily_cap import get_daily_count as _gdc, get_instance_cap as _gcap, notify_cap_reached_once as _ncr
        _DCAP = _gcap(db, instance)
        if _gdc(db, instance) >= _DCAP:
            log.warning("[AIFollowup] daily cap %d reached for %s — skipping Andy reply to %s", _DCAP, instance, phone_number)
            _ncr(db, instance)
            db.db.ai_followup_sessions.update_one({"_id": sid}, {"$set": {"ai_typing": False}})
            return
    except Exception:
        pass

    try:
        if _inst_provider == "wasender":
            from app.whatsapp_wasender import WasenderClient, _clean_digits as _ws_clean
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
            from app.whatsapp_waha import WAHAClient, _clean_digits as _waha_clean
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

        if status == "sent":
            from app.daily_cap import increment_daily_count as _incr_daily
            from app.phone_utils import clean_digits as _clean_ai
            _incr_daily(db, instance, _clean_ai(phone_number))

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
        # Always reset ai_typing so the frontend never gets permanently stuck
        db.db.ai_followup_sessions.update_one(
            {"_id": sid}, {"$set": {"ai_typing": False}}
        )
