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
_MAX_MSGS_PER_PAIR   = 10    # messages per pair per day
_MIN_DELAY_MIN       = 8     # min minutes between turns
_MAX_DELAY_MIN       = 25    # max minutes between turns
_BUSINESS_HOUR_START = 9     # 09:00 hora México
_BUSINESS_HOUR_END   = 21    # 21:00 hora México
_BUSY_WINDOW_SECS    = 180   # si la instancia envió/recibió msg real en los últimos 3 min, skip warmup

# Temas rotativos para la conversación
_TOPICS = [
    "están hablando de películas clásicas de los 80s-90s (Volver al Futuro, Matrix, Terminator, etc.)",
    "están hablando de series que están viendo en Netflix o alguna plataforma de streaming",
    "están platicando de sus planes para el fin de semana o el siguiente puente",
    "están hablando de comida, de algún restaurante que probaron o de un antojo que tienen",
    "están hablando de fútbol, ya sea la liga MX, algún equipo o la Champions",
    "están hablando de música, canciones o artistas que están escuchando últimamente",
    "están platicando casualmente del trabajo o de algo que les pasó en la semana",
    "están hablando de viajes, algún lugar que visitaron o que quieren visitar",
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
        {"name": 1, "number": 1, "label": 1, "peer_warmup_paused": 1},
    ))
    if not candidates:
        return []

    # Check live connection status
    try:
        import requests
        from app.config import WWEBJS_URL
        from app.whatsapp_wwebjs import _headers
        resp = requests.get(f"{WWEBJS_URL}/sessions", headers=_headers(), timeout=5)
        session_status: dict = resp.json()  # {name: {status, phone}}
    except Exception:
        session_status = {}

    connected = []
    for inst in candidates:
        name = inst.get("name", "")
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


def _generate_message(history: list[dict], speaker_key: str, session_id=None) -> str:
    """Ask the LLM for the next message in the warmup conversation."""
    from app.llm import call_llm, PRIORITY_BATCH

    # Seleccionar tema determinista por sesión para que ambos hablen del mismo tema
    topic_idx = abs(hash(str(session_id))) % len(_TOPICS) if session_id else random.randint(0, len(_TOPICS) - 1)
    topic = _TOPICS[topic_idx]

    system = (
        "Eres una persona real mexicana chateando con un amigo por WhatsApp. "
        f"Contexto: {topic}. "
        "REGLAS para sonar como humano de verdad:\n"
        "- Mensajes MUY cortos: máximo 1-2 oraciones, a veces solo 2-4 palabras\n"
        "- Español mexicano informal: 'wey', 'bro', 'nel', 'simon', 'sale', 'órale', 'chido', 'ps sí', 'a poco', 'no manches'\n"
        "- A veces omite acentos o signos de apertura (¿ ¡) como lo hacen en chat\n"
        "- Usa 'jaja', 'jajaja', 'haha', 'ajá', 'oye' cuando corresponde\n"
        "- Emojis ocasionalmente (no en cada mensaje): 😂 🔥 👀 😭 💀\n"
        "- NO seas formal ni perfecto en gramática\n"
        "- NO uses puntuación perfecta — a veces sin punto final, sin coma\n"
        "- Varía el tono: a veces entusiasmado, a veces relajado, a veces sorprendido\n"
        "- Reacciona genuinamente a lo que dijo la otra persona antes de añadir algo nuevo\n"
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


def _send_warmup_message(db, from_inst: dict, to_inst: dict, text: str, session_id, save_contact: bool = False) -> str:
    """Send via wwebjs and write an is_warmup log entry. Returns message_id."""
    from app.whatsapp_wwebjs import send_message

    to_wa = to_inst["number"].lstrip("+") + "@c.us"
    contact_name = (to_inst.get("label") or to_inst["name"]).split("-")[0].strip().capitalize()
    result = send_message(
        from_inst["name"], to_wa, text,
        typing_ms=random.randint(800, 2500),
        save_contact=save_contact,
        contact_first_name=contact_name if save_contact else "",
    )
    msg_id = (result.get("id") or {}).get("id") or result.get("messageId", "")

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
    return msg_id


def _process_pair(db, inst_a: dict, inst_b: dict, session: dict) -> None:
    """Send one message for this pair if it's their turn and time."""
    now = datetime.utcnow()

    if session["total_messages_today"] >= _MAX_MSGS_PER_PAIR:
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

    try:
        text = _generate_message(messages, speaker_key, session_id=session["_id"])
    except Exception as exc:
        log.error("[Warmup] LLM error for %s↔%s: %s", inst_a["name"], inst_b["name"], exc)
        return

    try:
        _send_warmup_message(db, from_inst, to_inst, text, session["_id"], save_contact=is_first_msg)
    except Exception as exc:
        log.error("[Warmup] send error %s→%s: %s", from_inst["name"], to_inst["name"], exc)
        return

    delay_min = random.randint(_MIN_DELAY_MIN, _MAX_DELAY_MIN)
    db.db.warmup_sessions.update_one(
        {"_id": session["_id"]},
        {
            "$push": {"messages": {"speaker": speaker_key, "content": text, "ts": now}},
            "$set": {
                "next_speaker": next_key,
                "next_send_at": now + timedelta(minutes=delay_min),
            },
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
            if not _is_business_hours():
                time.sleep(_POLL_INTERVAL)
                continue

            from app.database import MongoDBManager
            db = MongoDBManager()

            cfg = db.db.warmup_config.find_one({"_id": "global"}) or {}
            if not cfg.get("enabled", True):
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
                _process_pair(db, inst_a, inst_b, session)
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
