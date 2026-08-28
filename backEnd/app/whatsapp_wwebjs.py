import os, requests as _req, random, time
from app.config import WWEBJS_URL

API_SECRET = os.environ.get("WWEBJS_API_SECRET", "")

def _headers():
    h = {"Content-Type": "application/json"}
    if API_SECRET:
        h["x-api-secret"] = API_SECRET
    return h

def start_session(session_id: str) -> dict:
    r = _req.post(f"{WWEBJS_URL}/session/{session_id}/start", headers=_headers(), timeout=10)
    return r.json()

def get_status(session_id: str) -> dict:
    r = _req.get(f"{WWEBJS_URL}/session/{session_id}/status", headers=_headers(), timeout=5)
    return r.json()

def get_info(session_id: str) -> dict:
    r = _req.get(f"{WWEBJS_URL}/session/{session_id}/info", headers=_headers(), timeout=5)
    return r.json()

def get_qr(session_id: str) -> dict:
    r = _req.get(f"{WWEBJS_URL}/session/{session_id}/qr", headers=_headers(), timeout=5)
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_message(session_id: str, to: str, message: str, typing_ms: int = 0,
                 save_contact: bool = False, contact_first_name: str = "", contact_last_name: str = "") -> dict:
    payload = {"to": to, "message": message, "typingMs": typing_ms}
    if save_contact and contact_first_name:
        payload["saveContact"] = True
        payload["contactFirstName"] = contact_first_name
        payload["contactLastName"] = contact_last_name
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/send",
        json=payload,
        headers=_headers(),
        timeout=30,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_media(session_id: str, to: str, media_url: str,
               caption: str = "", filename: str = "", typing_ms: int = 0) -> dict:
    payload = {"to": to, "mediaUrl": media_url, "caption": caption, "typingMs": typing_ms}
    if filename:
        payload["filename"] = filename
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/send-media",
        json=payload,
        headers=_headers(),
        timeout=120,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def verify_number(session_id: str, phone: str) -> dict:
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/verify",
        json={"phone": phone},
        headers=_headers(),
        timeout=15,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def save_contact(session_id: str, phone: str, first_name: str, last_name: str = "") -> dict:
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/contact/save",
        json={"phone": phone, "firstName": first_name, "lastName": last_name},
        headers=_headers(),
        timeout=10,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def set_profile_status(session_id: str, status_text: str) -> dict:
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/profile/status",
        json={"status": status_text},
        headers=_headers(),
        timeout=10,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_reaction(session_id: str, message_id: str, emoji: str) -> dict:
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/react",
        json={"messageId": message_id, "emoji": emoji},
        headers=_headers(),
        timeout=10,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_typing(session_id: str, to: str):
    # Utility to start the composing indicator without sending a message.
    # The normal send path (send_message / WWebjsClient.send) already handles typing
    # internally via the `typingMs` field — the microservice calls sendStateTyping(),
    # waits typingMs ms, then clearState() before delivering the message.
    # This function is kept for external callers that need to control composing state
    # independently (e.g., a multi-step flow where typing starts before the reply
    # is ready), but ai_followup.py does NOT need to call it separately.
    try:
        _req.post(
            f"{WWEBJS_URL}/session/{session_id}/typing",
            json={"to": to},
            headers=_headers(),
            timeout=5,
        )
    except Exception:
        pass

def mark_read(session_id: str, to: str):
    try:
        _req.post(
            f"{WWEBJS_URL}/session/{session_id}/read",
            json={"to": to},
            headers=_headers(),
            timeout=5,
        )
    except Exception:
        pass

def delete_session(session_id: str):
    try:
        _req.delete(f"{WWEBJS_URL}/session/{session_id}", headers=_headers(), timeout=10)
    except Exception:
        pass

def list_sessions() -> dict:
    r = _req.get(f"{WWEBJS_URL}/sessions", headers=_headers(), timeout=5)
    if not r.ok:
        return {}
    return r.json()


def get_all_connected_instances(db) -> list:
    """Return session names currently connected in the wwebjs microservice."""
    try:
        sessions = list_sessions()
        return [sid for sid, info in sessions.items()
                if isinstance(info, dict) and info.get("status") == "connected"]
    except Exception:
        return []


class WWebjsClient:
    def __init__(self, session_id: str, instance_name: str = ""):
        self.session_id = session_id
        self.instance_name = instance_name or session_id

    def send(self, to: str, message: str, delay_ms: int | None = None,
             save_contact: bool = False, contact_name: str = "") -> dict:
        ms = delay_ms if delay_ms is not None else random.randint(800, 2500)
        first = contact_name.strip()
        last = ""
        print(f"[WWebjsClient] composing → {to} delayMs={ms} session={self.instance_name}")
        return send_message(
            self.session_id, to, message, typing_ms=ms,
            save_contact=save_contact, contact_first_name=first, contact_last_name=last,
        )

    def verify(self, phone: str) -> dict:
        return verify_number(self.session_id, phone)

    def save_contact(self, phone: str, first_name: str, last_name: str = "") -> dict:
        return save_contact(self.session_id, phone, first_name, last_name)

    def mark_read(self, to: str):
        mark_read(self.session_id, to)

    def react(self, message_id: str, emoji: str) -> dict:
        return send_reaction(self.session_id, message_id, emoji)

    def status(self) -> dict:
        return get_status(self.session_id)

    def info(self) -> dict:
        return get_info(self.session_id)
