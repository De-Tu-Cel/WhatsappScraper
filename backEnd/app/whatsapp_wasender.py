# whatsapp_wasender.py
"""WasenderAPI client — replaces whatsapp_waha.py.

Uses the official `wasenderapi` Python SDK for message sending, presence, and
number checks. Raw requests for endpoints not covered by the SDK (LID lookup,
mark-read).

Two-tier auth:
  - PAT (Personal Access Token): session management (CRUD)
  - per-session api_key: messaging, presence, read receipts
"""
import time
import requests
from datetime import datetime
from app.phone_utils import clean_digits as _clean_digits


WASENDER_DEFAULT_BASE_URL = "https://www.wasenderapi.com"

WASENDER_CONNECTED_STATUSES = {"connected"}

WASENDER_STATUS_LABELS = {
    "connected":    "Conectada",
    "connecting":   "Conectando",
    "need_scan":    "Esperando QR",
    "need_passkey": "Esperando clave",
    "disconnected": "Desconectada",
    "logged_out":   "Sesión cerrada",
    "expired":      "Expirada",
}

# ACK integer (0–5) → internal status string
WASENDER_ACK_MAP = {
    0: "failed",
    1: "pending",
    2: "sent",
    3: "delivered",
    4: "read",
    5: "read",  # PLAYED
}


# ── Session management ────────────────────────────────────────────────────────

def pick_connected_instance(db, pat: str, base_url: str = WASENDER_DEFAULT_BASE_URL, preferred: str | None = None) -> str | None:
    """Return the MongoDB instance name of a connected WasenderAPI session.

    Queries WasenderAPI for connected sessions, matches each by wasender_id to
    MongoDB instances. Returns the instance name (MongoDB key), or None.
    """
    try:
        from wasenderapi import create_sync_wasender
        # PAT is required for listing sessions. Pass it as both api_key and PAT:
        # get_all_whatsapp_sessions() uses personal_access_token; api_key is unused here.
        sdk = create_sync_wasender(api_key=pat, personal_access_token=pat)
        result = sdk.get_all_whatsapp_sessions()
        sessions = (result.response.data or []) if (result.response) else []
        connected = {
            s.id: s for s in sessions
            if s.status and s.status.value == "connected"
        }
    except Exception:
        return None

    if not connected:
        return None

    if preferred:
        inst = db.db.instances.find_one({"name": preferred, "provider": "wasender"}, {"wasender_id": 1})
        if inst and inst.get("wasender_id") in connected:
            return preferred

    for wasender_id in connected:
        inst = db.db.instances.find_one({"wasender_id": wasender_id, "provider": "wasender"}, {"name": 1})
        if inst:
            return inst["name"]

    return None


def get_all_connected_instances(db, pat: str, base_url: str = WASENDER_DEFAULT_BASE_URL) -> list:
    """Return all connected Wasender instance names (MongoDB names)."""
    try:
        from wasenderapi import create_sync_wasender
        sdk = create_sync_wasender(api_key=pat, personal_access_token=pat)
        result = sdk.get_all_whatsapp_sessions()
        sessions = (result.response.data or []) if result.response else []
        connected_ids = {s.id for s in sessions if s.status and s.status.value == "connected"}
        names = []
        for wid in connected_ids:
            inst = db.db.instances.find_one({"wasender_id": wid, "provider": "wasender"}, {"name": 1})
            if inst:
                names.append(inst["name"])
        return names
    except Exception:
        return []


# ── Client ────────────────────────────────────────────────────────────────────

class WasenderClient:
    """Wrapper using the official wasenderapi SDK for messaging + raw requests for the rest.

    api_key: per-session Bearer token (wasender_api_key field in MongoDB).
    instance_name: MongoDB name for this session (used for logging only).
    """

    def __init__(self, base_url: str, api_key: str, instance_name: str = "", own_number: str = ""):
        self.base = base_url.rstrip("/")
        self.api_key = api_key
        self.instance_name = instance_name
        # own_number: digits of this session's phone number (e.g. "521234567890").
        # Used to send "available" presence to own JID before composing.
        self.own_number = "".join(filter(str.isdigit, own_number)) if own_number else ""
        from wasenderapi import create_sync_wasender
        self._sdk = create_sync_wasender(api_key=api_key)
        # Fallback headers for endpoints not in the SDK
        self._headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # ── Sending ───────────────────────────────────────────────────────────────

    def send_text(self, number: str, text: str, delay_ms: int = 0) -> dict:
        """Send a plain-text WhatsApp message with human-like presence simulation.

        delay_ms: base composing duration in ms (+1ms per char, capped at 8s).

        Presence sequence (when delay_ms > 0):
          1. "available" on own JID  → appears to open WhatsApp
          2. 500ms pause             → brief moment before starting to type
          3. "composing" on contact JID with delayMs → API holds composing state
          4. sleep(scaled_ms)        → wait for typing window to expire
          5. send message
        """
        if delay_ms > 0:
            jid = f"{_clean_digits(number)}@s.whatsapp.net"
            scaled_ms = min(delay_ms + len(text), 8000)

            # Step 1: appear online before composing (simulates opening the app)
            if self.own_number:
                own_jid = f"{self.own_number}@s.whatsapp.net"
                self._send_presence(own_jid, "available")
                time.sleep(0.5)

            # Step 2: start composing with delayMs — API manages the duration
            self._set_typing(jid, delay_ms=scaled_ms)
            time.sleep(scaled_ms / 1000)

        from wasenderapi.errors import WasenderAPIError
        try:
            result = self._sdk.send_text(to=_to_phone(number), text_body=text)
            message_id = None
            if result.response and result.response.data:
                _d = result.response.data
                message_id = (
                    getattr(_d, "message_id", None)
                    or (isinstance(_d, dict) and (_d.get("message_id") or _d.get("id")))
                )
            return {
                "status_code": 200,
                "response_json": {"data": {"message_id": message_id}},
                "raw_text": "",
                "sent_at": datetime.now().isoformat(),
            }
        except WasenderAPIError as exc:
            return {
                "status_code": exc.status_code,
                "response_json": {"error": exc.api_message},
                "raw_text": str(exc.api_message),
                "sent_at": datetime.now().isoformat(),
                "error": str(exc.api_message),
            }
        except Exception as exc:
            return {
                "status_code": None,
                "response_json": {},
                "raw_text": str(exc),
                "sent_at": datetime.now().isoformat(),
                "error": str(exc),
            }

    def send_image(self, number: str, image_url: str, caption: str = "") -> dict:
        """Send an image via public URL. Formats: JPEG, PNG. Max 5MB.
        Shows 'available' presence before sending (no typing indicator for media).
        """
        if self.own_number:
            own_jid = f"{self.own_number}@s.whatsapp.net"
            self._send_presence(own_jid, "available")
            time.sleep(0.5)
        payload = {"to": _to_phone(number), "imageUrl": image_url}
        if caption:
            payload["text"] = caption
        return self._send_media(payload)

    def send_document(self, number: str, doc_url: str, caption: str = "", file_name: str = "") -> dict:
        """Send a document via public URL. Supports PDF, DOCX, XLSX, etc. Max 100MB."""
        if self.own_number:
            own_jid = f"{self.own_number}@s.whatsapp.net"
            self._send_presence(own_jid, "available")
            time.sleep(0.5)
        payload = {"to": _to_phone(number), "documentUrl": doc_url}
        if caption:
            payload["text"] = caption
        if file_name:
            payload["fileName"] = file_name
        return self._send_media(payload)

    def _send_media(self, payload: dict) -> dict:
        """Raw POST /api/send-message for image/document payloads."""
        try:
            resp = requests.post(
                f"{self.base}/api/send-message",
                json=payload,
                headers=self._headers,
                timeout=30,
            )
            data = resp.json() if resp.content else {}
            msg_id = (data.get("data") or {}).get("msgId")
            return {
                "status_code": resp.status_code,
                "response_json": {"data": {"message_id": str(msg_id) if msg_id else None}},
                "raw_text": resp.text,
                "sent_at": datetime.now().isoformat(),
            }
        except Exception as exc:
            return {
                "status_code": None,
                "response_json": {},
                "raw_text": str(exc),
                "sent_at": datetime.now().isoformat(),
                "error": str(exc),
            }

    def label_contact(self, number: str, first_name: str, last_name: str = "") -> bool:
        """Ensure contact is saved in the session's WhatsApp address book.
        GET first — only PUT if the contact is missing or has no name assigned."""
        digits = _clean_digits(number)
        jid = f"{digits}@s.whatsapp.net"
        full_name = f"{first_name} {last_name}".strip() if last_name else first_name
        try:
            get_resp = requests.get(
                f"{self.base}/api/contacts/{digits}",
                headers=self._headers,
                timeout=4,
            )
            if get_resp.ok:
                existing_name = (get_resp.json().get("data") or {}).get("name") or ""
                if existing_name:
                    return True  # already saved with a name, skip PUT
            resp = requests.put(
                f"{self.base}/api/contacts",
                json={"jid": jid, "fullName": full_name, "saveOnPrimaryAddressbook": False},
                headers=self._headers,
                timeout=4,
            )
            saved = resp.ok
            if saved:
                print(f"[WasenderClient] contact saved: {digits} → {full_name!r}")
            return saved
        except Exception:
            return False

    def set_presence(self, presence: str = "available") -> bool:
        """No-op: WasenderAPI handles keepalive via always_online=True at session level."""
        return True

    # ── Read receipts / presence ──────────────────────────────────────────────

    def mark_read(self, message_id: str, remote_jid: str, from_me: bool = False) -> bool:
        """Send a read receipt (blue tick) for an inbound message."""
        try:
            resp = requests.post(
                f"{self.base}/api/messages/read",
                json={"key": {"id": message_id, "remoteJid": remote_jid, "fromMe": from_me}},
                headers=self._headers,
                timeout=4,
            )
            return resp.ok
        except Exception:
            return False

    def _send_presence(self, jid: str, presence_type: str) -> None:
        """Send a raw presence update (available/unavailable/composing/paused/recording)."""
        try:
            requests.post(
                f"{self.base}/api/send-presence-update",
                json={"jid": jid, "type": presence_type},
                headers=self._headers,
                timeout=4,
            )
        except Exception:
            pass

    def _set_typing(self, jid: str, delay_ms: int = 0) -> None:
        """Send composing presence. If delay_ms > 0 the API holds the state for that duration."""
        payload = {"jid": jid, "type": "composing"}
        if delay_ms > 0:
            payload["delayMs"] = delay_ms
        try:
            requests.post(
                f"{self.base}/api/send-presence-update",
                json=payload,
                headers=self._headers,
                timeout=4,
            )
            print(f"[WasenderClient] composing → {jid} delayMs={delay_ms} session={self.instance_name}")
        except Exception as exc:
            print(f"[WasenderClient] composing FAILED → {jid}: {exc}")

    # ── Number / JID checks ───────────────────────────────────────────────────

    def check_number(self, number: str) -> bool:
        """Return True if the number has a WhatsApp account."""
        phone_id = f"{_clean_digits(number)}@s.whatsapp.net"
        try:
            result = self._sdk.check_if_on_whatsapp(phone_number=phone_id)
            _d = result.response.data if (result.response and result.response.data) else {}
            if isinstance(_d, dict):
                return _d.get("exists", False)
            return getattr(_d, "exists", False)
        except Exception:
            return False

    def get_jid(self, number: str) -> str:
        """Return phone digits for a number. WasenderAPI resolves JIDs internally on send."""
        return _clean_digits(number)

    def resolve_lid(self, lid_jid: str) -> str:
        """Resolve a @lid JID to a phone number JID via GET /api/pn-from-lid/{lid}.

        Returns the phone digits portion (e.g. "521234567890"), or the input stripped of
        @lid suffix if the API call fails or the JID is already a phone number.
        """
        if "@lid" not in lid_jid:
            return lid_jid.split("@")[0]
        from urllib.parse import quote
        try:
            resp = requests.get(
                f"{self.base}/api/pn-from-lid/{quote(lid_jid, safe='')}",
                headers=self._headers,
                timeout=5,
            )
            if resp.ok:
                pn = (resp.json().get("data") or {}).get("pn", "")
                if pn:
                    return pn.replace("@s.whatsapp.net", "").replace("@c.us", "")
        except Exception:
            pass
        return lid_jid.split("@")[0]

    # ── Message history ───────────────────────────────────────────────────────

    def fetch_messages(self, number: str, limit: int = 100) -> list:
        return []

    def fetch_messages_by_jid(self, jid: str, limit: int = 100) -> list:
        return []


# ── Webhook payload helpers ───────────────────────────────────────────────────

def wasender_status_label(status: str) -> str:
    return WASENDER_STATUS_LABELS.get(status, status)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _to_phone(number: str) -> str:
    """Convert to E.164 format: +521234567890"""
    return f"+{_clean_digits(number)}"
