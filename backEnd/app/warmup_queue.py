# warmup_queue.py
"""
Peer warmup: connected WhatsApp instances chat with each other to generate
mutual inbound/outbound traffic for number health.  Messages are generated
by the active LLM (OpenAI / DeepSeek) and sent via wwebjs.  Runs as a
single daemon background thread that polls every _POLL_INTERVAL seconds.
"""
import logging
import random
import threading
import time
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _MX_TZ = _ZoneInfo("America/Mexico_City")
except Exception:
    try:
        import pytz as _pytz
        _MX_TZ = _pytz.timezone("America/Mexico_City")
    except Exception:
        _MX_TZ = None  # fallback: UTC-6 offset

log = logging.getLogger(__name__)

_thread: threading.Thread | None = None
_lock = threading.Lock()

_POLL_INTERVAL       = 300   # seconds between checks
_MAX_MSGS_PER_PAIR   = 12   # messages per pair per day
_MIN_DELAY_MIN       = 20   # min minutes between turns
_MAX_DELAY_MIN       = 45   # max minutes between turns
_BUSINESS_HOUR_START = 7    # 07:00 hora México
_BUSINESS_HOUR_END   = 18   # 18:00 hora México
_BUSY_WINDOW_SECS    = 180   # si la instancia envió/recibió msg real en los últimos 3 min, skip warmup

# Temas rotativos para la conversación
_TOPICS = [
    "están hablando de videojuegos — pueden mencionar partidas recientes, algún juego que están jugando (Elden Ring, GTA, Minecraft, Valorant, etc.), un logro que obtuvieron o algo que los frustró",
    "están hablando de películas de culto y clásicos de los 80s-90s (Volver al Futuro, Terminator, El Club de los Cinco, Akira, Blade Runner, etc.) — comparan cuáles aguantan el paso del tiempo",
    "están hablando de teorías conspiranoicas y aliens — Área 51, avistamientos, si el gobierno oculta contacto extraterrestre, Ancient Aliens, etc. Tono de broma pero con algo de 'y si de verdad…'",
    "están hablando de anime — pueden mencionar una serie que están viendo (Jujutsu Kaisen, One Piece, Chainsaw Man, Dragon Ball, etc.), discutir un arco o hablar de cuál es el mejor de todos los tiempos",
    "están hablando de cosas geek y friki — memes de internet, cultura gamer, series de superhéroes, Star Wars vs Marvel, easter eggs en películas, etc.",
    "están hablando de películas de terror y de culto — El resplandor, It, Hereditary, El exorcista, Annihilation, etc. Comparten cuáles los asustaron de verdad o cuáles son sobrevaloradas",
    "están hablando de tecnología y gadgets — algún celular nuevo, inteligencia artificial, si los robots van a quitarles el trabajo, algún gadget cool que vieron",
    "están hablando de música — pueden hablar de metal, rock alternativo, electrónica, rap, o lo que sea. Comparten canciones, artistas o conciertos a los que quieren ir",
]


# ── helpers ──────────────────────────────────────────────────────────────────

def _is_instance_busy(db, instance_name: str) -> bool:
    """True if the instance sent a real (non-warmup) message in the last _BUSY_WINDOW_SECS.
    Prevents warmup messages from overlapping with active campaign/manual sends."""
    cutoff = datetime.utcnow() - timedelta(seconds=_BUSY_WINDOW_SECS)
    return db.db.message_logs.find_one(
        {
            "instance_name": instance_name,
            "is_warmup":     {"$ne": True},
            "created_at":    {"$gte": cutoff},
        },
        {"_id": 1},
    ) is not None


def _mx_now() -> datetime:
    if _MX_TZ is not None:
        return datetime.now(_MX_TZ)
    return datetime.utcnow() - timedelta(hours=6)

def _is_business_hours() -> bool:
    now = _mx_now()
    return _BUSINESS_HOUR_START <= now.hour < _BUSINESS_HOUR_END


def _get_warmup_instances(db) -> list[dict]:
    """Return connected wwebjs instances that have peer warmup enabled."""
    candidates = list(db.db.instances.find(
        {"provider": "wwebjs", "peer_warmup_enabled": {"$ne": False}},
        {"name": 1, "number": 1, "label": 1, "peer_warmup_paused": 1, "created_at": 1},
    ))
    if not candidates:
        return []

    # Check live connection status — call each session individually, same
    # pattern as user-status endpoint (bulk /sessions is unreliable in prod).
    try:
        import requests
        from concurrent.futures import ThreadPoolExecutor
        from app.config import WWEBJS_URL
        from app.whatsapp_wwebjs import _headers

        def _check(inst):
            try:
                r = requests.get(f"{WWEBJS_URL}/session/{inst['name']}/status", headers=_headers(), timeout=3)
                return inst["name"], r.json() if r.ok else {}
            except Exception:
                return inst["name"], {}

        with ThreadPoolExecutor(max_workers=8) as ex:
            session_status = dict(ex.map(_check, candidates))
    except Exception:
        session_status = {}

    _MIN_AGE_DAYS = 7
    age_cutoff = datetime.utcnow() - timedelta(days=_MIN_AGE_DAYS)

    connected = []
    for inst in candidates:
        name = inst.get("name", "")
        created_at = inst.get("created_at")
        # Instances without created_at were created before the field existed — treat as old enough.
        # Guard against created_at stored as a string (legacy docs).
        if created_at and isinstance(created_at, str):
            try:
                from dateutil.parser import parse as _parse_dt
                created_at = _parse_dt(created_at).replace(tzinfo=None)
            except Exception:
                created_at = None
        if created_at and created_at > age_cutoff:
            log.debug("[Warmup] skip %s — instance < %d days old (created %s)", name, _MIN_AGE_DAYS, created_at)
            continue
        st = session_status.get(name, {})
        number = inst.get("number") or st.get("phone", "")
        if st.get("status") == "connected" and number:
            connected.append({
                "name": name,
                "number": number,
                "label": inst.get("label", name),
                "paused": bool(inst.get("peer_warmup_paused", False)),
            })
    return connected


def _get_today_pairs(instances: list[dict]) -> list[tuple[dict, dict]]:
    """
    Ring-rotation pairing (Berger / circle method).
    Each day every instance pairs with a different partner.
    Returns list of (inst_a, inst_b) — both guaranteed non-None and connected.
    """
    names = sorted(i["name"] for i in instances)
    n = len(names)
    if n < 2:
        return []

    inst_map = {i["name"]: i for i in instances}
    day = datetime.utcnow().timetuple().tm_yday

    if n % 2 == 1:
        names = names + [None]   # bye slot
        n += 1

    # Fix names[0], rotate the rest
    rotating = list(names[1:])
    r = day % (n - 1)
    rotating = rotating[r:] + rotating[:r]

    pairs: list[tuple[dict, dict]] = []
    # Pair 0: fixed ↔ rotating[0]
    a, b = names[0], rotating[0]
    if a and b:
        pairs.append((inst_map[a], inst_map[b]))

    # Remaining symmetric pairs
    for i in range(1, n // 2):
        a = rotating[i]
        b = rotating[n - 1 - i]
        if a and b:
            pairs.append((inst_map[a], inst_map[b]))

    return pairs


def _get_or_create_session(db, inst_a: dict, inst_b: dict, today: str) -> dict:
    """Fetch or create the warmup_sessions document for this pair today."""
    query = {"date": today, "$or": [
        {"instance_a": inst_a["name"], "instance_b": inst_b["name"]},
        {"instance_a": inst_b["name"], "instance_b": inst_a["name"]},
    ]}
    session = db.db.warmup_sessions.find_one(query)
    if session:
        return session

    now = datetime.utcnow()
    doc = {
        "instance_a": inst_a["name"],
        "instance_b": inst_b["name"],
        "phone_a":    inst_a["number"],
        "phone_b":    inst_b["number"],
        "date":       today,
        "next_speaker": "a",    # A sends first
        "next_send_at": now,    # can send immediately
        "messages": [],
        "total_messages_today": 0,
        "created_at": now,
    }
    result = db.db.warmup_sessions.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


def _generate_message(history: list[dict], speaker_key: str, session_id=None, topic_override: str | None = None) -> str:
    """Ask the LLM for the next message in the warmup conversation."""
    from app.llm import call_llm, PRIORITY_BATCH

    if topic_override and topic_override != "auto":
        try:
            idx = int(topic_override)
            topic = _TOPICS[idx] if 0 <= idx < len(_TOPICS) else _TOPICS[0]
        except (ValueError, IndexError):
            topic = _TOPICS[0]
    else:
        # Seleccionar tema determinista por sesión para que ambos hablen del mismo tema
        topic_idx = abs(hash(str(session_id))) % len(_TOPICS) if session_id else random.randint(0, len(_TOPICS) - 1)
        topic = _TOPICS[topic_idx]

    system = (
        "Eres una persona real mexicana chateando con un amigo por WhatsApp. "
        f"Contexto: {topic}. "
        "REGLAS para sonar como humano de verdad:\n"
        "- Mensajes MUY cortos: máximo 1-2 oraciones, a veces solo 2-5 palabras\n"
        "- Español mexicano informal: 'wey', 'bro', 'nel', 'simon', 'sale', 'órale', 'chido', 'a poco', 'no manches', 'neta', 'chale', 'qué onda'\n"
        "- Omite acentos y signos de apertura (¿ ¡) como se hace en chat real\n"
        "- Usa 'jaja', 'jajajaja', 'haha', 'ajá', 'oye', 'neta?', 'en serio??' cuando corresponde\n"
        "- Emojis ocasionalmente, nunca en cada mensaje: 😂 🔥 👀 😭 💀 😤 👾\n"
        "- Nunca uses puntuación perfecta — sin punto final, comas opcionales, todo minúsculas\n"
        "- Varía el largo: a veces 3 palabras, a veces una oración completa\n"
        "- Reacciona a lo que dijo el otro antes de agregar algo tuyo\n"
        "- NUNCA uses frases de IA como 'claro que sí', 'por supuesto', 'sin duda', 'interesante punto'\n\n"
        "Ejemplos de mensajes CORRECTOS (así debes escribir):\n"
        "  'noo wey en serio 😂'\n"
        "  'simon buenísima esa'\n"
        "  'ps si ba, yo preferiría quedarme jaja'\n"
        "  'nel yo creí que ibas a decir otra cosa'\n"
        "  'a poco no la has visto??'\n"
        "  'chale yo también quiero ir'\n"
        "  'oye y el final que?? jajaja'\n"
        "  'no manches llevaba años esperando eso'\n"
        "  'bro igual, me caga ese personaje'\n"
        "  'simon es de lo mejor que han sacado'\n\n"
        "Escribe SOLO el mensaje, sin comillas ni explicaciones."
    )

    openai_msgs = [{"role": "system", "content": system}]

    for msg in history[-12:]:
        role = "assistant" if msg["speaker"] == speaker_key else "user"
        openai_msgs.append({"role": role, "content": msg["content"]})

    if not history:
        openai_msgs.append({
            "role": "user",
            "content": "(Inicia la conversación con un mensaje corto y casual sobre el tema, como si hubiera pasado algo relevante hace poco)"
        })

    return call_llm(openai_msgs, max_tokens=90, temperature=0.95, priority=PRIORITY_BATCH)


def _contact_already_saved(db, instance_name: str, number: str) -> bool:
    """True if this instance already saved this number as a contact in a prior warmup session."""
    return db.db.warmup_sessions.find_one(
        {
            "$or": [
                {"instance_a": instance_name, "phone_b": number, "contact_saved_ab": True},
                {"instance_b": instance_name, "phone_a": number, "contact_saved_ba": True},
            ]
        },
        {"_id": 1},
    ) is not None


def _send_warmup_message(db, from_inst: dict, to_inst: dict, text: str, session_id, save_contact: bool = False) -> str:
    """Send via wwebjs and write an is_warmup log entry. Returns message_id."""
    from app.whatsapp_wwebjs import send_message

    to_wa = to_inst["number"].lstrip("+") + "@c.us"
    contact_name = (to_inst.get("label") or to_inst["name"]).split("-")[0].strip().capitalize()

    # Skip save_contact if already saved in a previous session
    should_save = save_contact and not _contact_already_saved(db, from_inst["name"], to_inst["number"])

    result = send_message(
        from_inst["name"], to_wa, text,
        typing_ms=random.randint(800, 2500),
        save_contact=should_save,
        contact_first_name=contact_name if should_save else "",
    )
    from bson import ObjectId as _ObjId
    msg_id = (result.get("id") or {}).get("id") or result.get("messageId") or str(_ObjId())

    now = datetime.utcnow()
    db.db.message_logs.insert_one({
        "direction":          "outbound",
        "instance_name":      from_inst["name"],
        "to_number":          to_inst["number"],
        "message_text":       text,
        "message_id":         msg_id,
        "status":             "sent",
        "is_warmup":          True,
        "warmup_session_id":  str(session_id),
        "created_at":         now,
        "sent_at":            now,
    })

    if should_save:
        # Mark in the session doc so future sessions skip saving again
        is_a_sender = from_inst["name"] == db.db.warmup_sessions.find_one(
            {"_id": session_id}, {"instance_a": 1}
        ).get("instance_a")
        flag_field = "contact_saved_ab" if is_a_sender else "contact_saved_ba"
        db.db.warmup_sessions.update_one({"_id": session_id}, {"$set": {flag_field: True}})

    return msg_id


def _load_config(db) -> dict:
    """Read warmup settings from MongoDB, falling back to module-level constants."""
    cfg = db.db.warmup_config.find_one({"_id": "global"}) or {}
    return {
        "enabled":    cfg.get("enabled", True),
        "hour_start": cfg.get("business_hour_start", 9),
        "hour_end":   cfg.get("business_hour_end", 21),
        "min_msgs":   cfg.get("min_msgs_per_pair", 6),
        "max_msgs":   cfg.get("max_msgs_per_pair", _MAX_MSGS_PER_PAIR),
        "min_delay":  cfg.get("min_delay_min", _MIN_DELAY_MIN),
        "max_delay":  cfg.get("max_delay_min", _MAX_DELAY_MIN),
        "topic":      cfg.get("topic", "auto"),
    }


def _process_pair(db, inst_a: dict, inst_b: dict, session: dict, config: dict | None = None) -> None:
    """Send one message for this pair if it's their turn and time."""
    now = datetime.utcnow()
    if config is None:
        config = _load_config(db)

    if session["total_messages_today"] >= config["max_msgs"]:
        return

    next_send_at = session.get("next_send_at")
    if next_send_at and now < next_send_at:
        return

    speaker_key = session.get("next_speaker", "a")
    from_inst, to_inst = (inst_a, inst_b) if speaker_key == "a" else (inst_b, inst_a)
    next_key = "b" if speaker_key == "a" else "a"

    if from_inst.get("paused") or to_inst.get("paused"):
        return

    if _is_instance_busy(db, from_inst["name"]):
        log.info("[Warmup] %s has recent non-warmup activity — skipping turn to avoid overlap", from_inst["name"])
        return

    messages = session.get("messages", [])
    is_first_msg = len(messages) == 0

    # Receiver marks the last incoming message as read before replying (blue ticks)
    if messages:
        last_msg = messages[-1]
        if last_msg.get("speaker") != speaker_key:
            sender_wa = from_inst["number"].lstrip("+") + "@c.us"
            try:
                from app.whatsapp_wwebjs import mark_read
                mark_read(to_inst["name"], sender_wa)
            except Exception:
                pass
            time.sleep(random.uniform(1.5, 4.0))

    try:
        text = _generate_message(messages, speaker_key, session_id=session["_id"], topic_override=config.get("topic"))
    except Exception as exc:
        log.error("[Warmup] LLM error for %s↔%s: %s", inst_a["name"], inst_b["name"], exc)
        return

    # Occasionally react to the previous message instead of (or before) replying (~15% chance)
    if messages and random.random() < 0.15:
        last_msg_id = session.get("last_message_id")
        if last_msg_id:
            _REACTIONS = ["👍", "❤️", "😂", "😮", "🔥"]
            try:
                from app.whatsapp_wwebjs import send_reaction
                send_reaction(to_inst["name"], last_msg_id, random.choice(_REACTIONS))
                time.sleep(random.uniform(1.0, 2.5))
            except Exception:
                pass

    try:
        msg_id = _send_warmup_message(db, from_inst, to_inst, text, session["_id"], save_contact=is_first_msg)
    except Exception as exc:
        log.error("[Warmup] send error %s→%s: %s", from_inst["name"], to_inst["name"], exc)
        return

    delay_min = random.randint(config["min_delay"], config["max_delay"])
    update_set = {
        "next_speaker": next_key,
        "next_send_at": now + timedelta(minutes=delay_min),
    }
    if msg_id:
        update_set["last_message_id"] = msg_id
    db.db.warmup_sessions.update_one(
        {"_id": session["_id"]},
        {
            "$push": {"messages": {"speaker": speaker_key, "content": text, "ts": now}},
            "$set": update_set,
            "$inc": {"total_messages_today": 1},
        },
    )
    log.info(
        "[Warmup] %s→%s msg #%d (next in %dmin): %.60s",
        from_inst["name"], to_inst["name"],
        session["total_messages_today"] + 1, delay_min, text,
    )


# ── main loop ─────────────────────────────────────────────────────────────────

def _warmup_loop() -> None:
    while True:
        try:
            from app.database import MongoDBManager
            db = MongoDBManager()

            config = _load_config(db)

            now_mx = _mx_now()
            if not (config["hour_start"] <= now_mx.hour < config["hour_end"]):
                time.sleep(_POLL_INTERVAL)
                continue

            if not config["enabled"]:
                time.sleep(_POLL_INTERVAL)
                continue

            instances = _get_warmup_instances(db)
            if len(instances) < 2:
                time.sleep(_POLL_INTERVAL)
                continue

            pairs = _get_today_pairs(instances)
            today = _mx_now().strftime("%Y-%m-%d")

            for inst_a, inst_b in pairs:
                session = _get_or_create_session(db, inst_a, inst_b, today)
                _process_pair(db, inst_a, inst_b, session, config)
                time.sleep(random.uniform(2, 5))

        except Exception as exc:
            log.error("[Warmup] loop error: %s", exc)

        time.sleep(_POLL_INTERVAL)


def start_warmup_worker() -> None:
    """Launch the peer warmup daemon thread. Call once at startup."""
    global _thread
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(
                target=_warmup_loop, daemon=True, name="warmup-worker"
            )
            _thread.start()
            log.info("[Warmup] worker started")
