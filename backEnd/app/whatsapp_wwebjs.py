import os, requests as _req, random, time

WWEBJS_URL = os.environ.get("WWEBJS_URL", "http://wwebjs:3001")
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

def get_qr(session_id: str) -> dict:
    r = _req.get(f"{WWEBJS_URL}/session/{session_id}/qr", headers=_headers(), timeout=5)
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_message(session_id: str, to: str, message: str, typing_ms: int = 0) -> dict:
    r = _req.post(
        f"{WWEBJS_URL}/session/{session_id}/send",
        json={"to": to, "message": message, "typingMs": typing_ms},
        headers=_headers(),
        timeout=30,
    )
    if not r.ok:
        raise Exception(r.json().get("error", r.text))
    return r.json()

def send_typing(session_id: str, to: str):
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
    return r.json()


class WWebjsClient:
    def __init__(self, session_id: str, instance_name: str = ""):
        self.session_id = session_id
        self.instance_name = instance_name or session_id

    def send(self, to: str, message: str, delay_ms: int | None = None) -> dict:
        ms = delay_ms if delay_ms is not None else random.randint(800, 2500)
        print(f"[WWebjsClient] composing → {to} delayMs={ms} session={self.instance_name}")
        return send_message(self.session_id, to, message, typing_ms=ms)

    def mark_read(self, to: str):
        mark_read(self.session_id, to)

    def status(self) -> dict:
        return get_status(self.session_id)
