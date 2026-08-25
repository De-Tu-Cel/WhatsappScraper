# whatsapp_waha.py
"""WAHA (WhatsApp HTTP API) client — drop-in replacement for whatsapp_evolution.py.

Same public interface so callers (routes.py, scheduler.py, ai_followup.py,
pipeline.py) can switch by changing one import line.
"""
import time
import requests
from datetime import datetime
from app.phone_utils import clean_digits as _clean_digits


# ── Session management ────────────────────────────────────────────────────────

def get_all_connected_instances(db, api_url: str, api_key: str) -> list:
    """Return all WAHA session names currently WORKING (connected)."""
    try:
        resp = requests.get(
            f"{api_url.rstrip('/')}/api/sessions",
            headers={"X-Api-Key": api_key},
            params={"all": "false"},
            timeout=5,
        )
        sessions = resp.json() if resp.ok else []
        return [s["name"] for s in sessions if s.get("status") == "WORKING"]
    except Exception:
        return []


def pick_connected_instance(db, api_url: str, api_key: str, preferred: str | None = None) -> str | None:
    """Return a WAHA session name that is currently WORKING (connected).

    Mirrors pick_connected_instance() from whatsapp_evolution.py — same
    signature so callers need no changes.
    """
    working = get_all_connected_instances(db, api_url, api_key)
    if not working:
        return None
    if preferred and preferred in working:
        return preferred
    return working[0]


# ── Client ────────────────────────────────────────────────────────────────────

class WAHAClient:
    """Thin wrapper around the WAHA REST API.

    Equivalent to EvolutionClient in whatsapp_evolution.py — same method
    names and return shapes so callers require minimal changes.
    """

    def __init__(self, api_url: str, api_key: str, session: str):
        self.base_url = api_url.rstrip("/")
        self.session = session
        self.headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}

    # ── Sending ───────────────────────────────────────────────────────────────

    def set_presence(self, presence: str = "available") -> bool:
        """Set session presence ('available' or 'unavailable').

        Calling with 'available' before sending makes the session appear
        online to WhatsApp, reducing spam-detection signals.
        """
        try:
            resp = requests.post(
                f"{self.base_url}/api/{self.session}/presence",
                json={"presence": presence},
                headers=self.headers,
                timeout=5,
            )
            if resp.ok:
                return True
            if resp.status_code not in (400, 404, 405):
                # 400/404/405 = engine doesn't support presence (NOWEB) — silent
                print(f"[WAHAClient] set_presence {presence} → session={self.session} status={resp.status_code}")
            return False
        except Exception as exc:
            print(f"[WAHAClient] set_presence {presence} → session={self.session} FAILED: {exc}")
            return False

    def send_text(self, number: str, text: str, delay_ms: int = 0) -> dict:
        """Send a plain-text WhatsApp message.

        delay_ms: base typing indicator duration in ms. Actual delay is scaled
        by message length (≈1ms per char) to look human — short messages type
        fast, long ones take longer. Cap at 8 000ms so we don't stall forever.
        """
        chat_id = _to_chat_id(number)
        if delay_ms > 0:
            # Scale by char count: +1ms per char, capped at 8s total
            scaled_ms = min(delay_ms + len(text), 8000)
            self._set_typing(chat_id, True)
            time.sleep(scaled_ms / 1000)
            self._set_typing(chat_id, False)

        url = f"{self.base_url}/api/sendText"
        payload = {"chatId": chat_id, "text": text, "session": self.session}
        try:
            resp = requests.post(url, json=payload, headers=self.headers, timeout=15)
            resp_json = resp.json() if resp.content else {}
            result = {
                "status_code": resp.status_code,
                "response_json": resp_json,
                "raw_text": resp.text,
                "sent_at": datetime.now().isoformat(),
            }
            # 463 = Reachout Timelock: WhatsApp shadow-restricted the account.
            # Session stays WORKING — do NOT restart. Pause new-contact outreach.
            if resp.status_code == 463 or '"error":463' in resp.text:
                result["reachout_timelock"] = True
                print(f"[WAHAClient] Reachout Timelock on {self.session} — session stays up, pause new contacts")
            return result
        except Exception as exc:
            return {
                "status_code": None,
                "response_json": {},
                "raw_text": str(exc),
                "sent_at": datetime.now().isoformat(),
                "error": str(exc),
            }

    def label_contact(self, number: str, first_name: str, last_name: str = "") -> bool:
        """Save/update contact in the phone address book before messaging.

        WhatsApp is much less likely to flag sends to saved contacts.
        Uses PUT /api/{session}/contacts/{chatId}.
        Returns True on success, False on any error (non-fatal).
        """
        chat_id = _to_chat_id(number)
        try:
            resp = requests.put(
                f"{self.base_url}/api/{self.session}/contacts/{chat_id}",
                json={"firstName": first_name[:60], "lastName": last_name[:60]},
                headers=self.headers,
                timeout=8,
            )
            print(f"[WAHAClient] label_contact {chat_id} name={first_name!r} status={resp.status_code}")
            return resp.ok
        except Exception as exc:
            print(f"[WAHAClient] label_contact failed: {exc}")
            return False

    def _set_typing(self, chat_id: str, typing: bool):
        endpoint = "startTyping" if typing else "stopTyping"
        try:
            resp = requests.post(
                f"{self.base_url}/api/{endpoint}",
                json={"chatId": chat_id, "session": self.session},
                headers=self.headers,
                timeout=5,
            )
            print(f"[WAHAClient] {endpoint} → chat={chat_id} session={self.session} status={resp.status_code}")
        except Exception as exc:
            print(f"[WAHAClient] {endpoint} FAILED → chat={chat_id}: {exc}")

    # ── Message history ───────────────────────────────────────────────────────

    def fetch_messages(self, number: str, limit: int = 100) -> list:
        """Fetch message history for a phone number."""
        return self._fetch_by_chat_id(_to_chat_id(number), limit)

    def fetch_messages_by_jid(self, jid: str, limit: int = 100) -> list:
        """Fetch messages using an explicit JID (supports @lid and @c.us)."""
        chat_id = jid if "@" in jid else f"{jid}@c.us"
        return self._fetch_by_chat_id(chat_id, limit)

    def _fetch_by_chat_id(self, chat_id: str, limit: int) -> list:
        url = f"{self.base_url}/api/{self.session}/chats/{chat_id}/messages"
        try:
            resp = requests.get(
                url,
                params={"limit": limit, "downloadMedia": "false", "sortOrder": "desc"},
                headers=self.headers,
                timeout=15,
            )
            data = resp.json() if resp.ok else []
            return data if isinstance(data, list) else []
        except Exception:
            return []

    # ── Number / JID checks ───────────────────────────────────────────────────

    def check_number(self, number: str) -> bool:
        """Return True if the number has a WhatsApp account."""
        try:
            resp = requests.get(
                f"{self.base_url}/api/contacts/check-exists",
                params={"phone": _clean_digits(number), "session": self.session},
                headers=self.headers,
                timeout=10,
            )
            return resp.json().get("numberExists", False) if resp.ok else False
        except Exception:
            return False

    def get_jid(self, number: str) -> str:
        """Return the real WhatsApp JID for a number.

        Tries @lid first (Business API numbers), falls back to @c.us chatId.
        Returns just the numeric part (without @suffix), empty string if unknown.
        """
        digits = _clean_digits(number)
        # Try lid endpoint first (Business numbers have a @lid address)
        try:
            resp = requests.get(
                f"{self.base_url}/api/{self.session}/lids/pn/{digits}@c.us",
                headers=self.headers,
                timeout=5,
            )
            if resp.ok:
                lid = resp.json().get("lid", "")
                if lid:
                    print(f"[getJID] number={digits} lid={lid}")
                    return lid.split("@")[0]
        except Exception:
            pass
        # Fallback: check-exists returns chatId which is the @c.us address
        try:
            resp = requests.get(
                f"{self.base_url}/api/contacts/check-exists",
                params={"phone": digits, "session": self.session},
                headers=self.headers,
                timeout=5,
            )
            if resp.ok:
                chat_id = resp.json().get("chatId", "")
                if chat_id:
                    print(f"[getJID] number={digits} chatId={chat_id}")
                    return chat_id.split("@")[0]
        except Exception:
            pass
        return ""


# ── Webhook payload helpers ───────────────────────────────────────────────────

# WAHA session statuses that mean "connected and ready"
WAHA_CONNECTED_STATUSES = {"WORKING"}

# WAHA status → human label (mirrors Baileys disconnect codes in evolution)
WAHA_STATUS_LABELS = {
    "STOPPED":       "Detenida",
    "STARTING":      "Iniciando",
    "SCAN_QR_CODE":  "Esperando QR",
    "WORKING":       "Conectada",
    "FAILED":        "Error",
}

def waha_status_label(status: str) -> str:
    return WAHA_STATUS_LABELS.get(status, status)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _to_chat_id(number: str) -> str:
    """Convert a phone number to WAHA chatId format (e.g. '521234567890@c.us')."""
    return f"{_clean_digits(number)}@c.us"
