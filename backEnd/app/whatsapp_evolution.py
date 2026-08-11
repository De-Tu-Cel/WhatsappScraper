# whatsapp_evolution.py
import requests
from datetime import datetime


def pick_connected_instance(db, api_url: str, api_key: str, preferred: str | None = None) -> str | None:
    """Return an Evolution API instance name that's currently connected — checks
    every instance in the `instances` collection that has a registered number,
    prefers `preferred` if it's among the connected ones. Returns None if none
    are connected (caller should skip sending rather than fire at a dead instance).

    Mirrors the connection-check + preferred-instance logic in
    routes.py's /send-message (round-robin + per-company routing) — used by
    ai_followup.py so Andy's automatic replies don't get stuck on a single
    hardcoded instance when it's the one that happens to be disconnected."""
    names = [
        i["name"] for i in db.db.instances.find(
            {"number": {"$exists": True, "$ne": ""}}, {"name": 1}
        )
    ]
    if not names:
        return None

    from concurrent.futures import ThreadPoolExecutor

    def _check_state(name):
        try:
            r = requests.get(
                f"{api_url}/instance/connectionState/{name}",
                headers={"apikey": api_key}, timeout=2,
            )
            state = (r.json().get("instance") or {}).get("state") or r.json().get("state", "")
            return name if state == "open" else None
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=len(names)) as ex:
        connected = [n for n in ex.map(_check_state, names) if n]

    if not connected:
        return None
    if preferred and preferred in connected:
        return preferred
    return connected[0]


class EvolutionClient:
    def __init__(self, api_url: str, api_key: str, instance: str):
        self.base_url = api_url.rstrip("/")
        self.instance = instance
        self.headers = {"apikey": api_key, "Content-Type": "application/json"}

    def send_text(self, number: str, text: str, delay_ms: int = 0) -> dict:
        """Send a plain-text WhatsApp message via Evolution API.

        delay_ms: typing-indicator duration in ms shown to the recipient before
                  the message arrives (Evolution native feature, 0 = disabled).
        """
        clean = _clean_number(number)
        url = f"{self.base_url}/message/sendText/{self.instance}"
        payload = {"number": clean, "text": text, "textMessage": {"text": text}}
        if delay_ms > 0:
            payload["delay"] = delay_ms
        try:
            resp = requests.post(url, json=payload, headers=self.headers, timeout=15)
            return {
                "status_code": resp.status_code,
                "response_json": resp.json() if resp.content else {},
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

    def fetch_messages(self, number: str, limit: int = 100) -> list:
        """Fetch message history for a number from Evolution API."""
        clean = _clean_number(number)
        jid   = f"{clean}@s.whatsapp.net"
        url   = f"{self.base_url}/chat/findMessages/{self.instance}"
        try:
            resp = requests.post(url, json={
                "where": {"key": {"remoteJid": jid}},
                "limit": limit,
            }, headers=self.headers, timeout=15)
            data = resp.json()
            # Response can be {"messages": {"records": [...]}} or {"messages": [...]}
            msgs = data.get("messages", data)
            if isinstance(msgs, dict):
                return msgs.get("records", [])
            if isinstance(msgs, list):
                return msgs
        except Exception:
            pass
        return []

    def check_number(self, number: str) -> bool:
        """Check whether a number has WhatsApp (Evolution API /chat/whatsappNumbers)."""
        clean = _clean_number(number)
        url = f"{self.base_url}/chat/whatsappNumbers/{self.instance}"
        try:
            resp = requests.post(url, json={"numbers": [clean]}, headers=self.headers, timeout=10)
            data = resp.json()
            if isinstance(data, list) and data:
                return data[0].get("exists", False)
        except Exception:
            pass
        return False

    def get_jid(self, number: str) -> str:
        """Return the real WhatsApp JID (may be @lid for Business API) for a number."""
        clean = _clean_number(number)
        url = f"{self.base_url}/chat/whatsappNumbers/{self.instance}"
        try:
            resp = requests.post(url, json={"numbers": [clean]}, headers=self.headers, timeout=10)
            data = resp.json()
            print(f"[getJID] number={clean} response={str(data)[:300]}")
            if isinstance(data, list) and data:
                item = data[0]
                # Prefer @lid JID if present in any field
                for field in ("jid", "remoteJid", "lid", "businessJid"):
                    val = item.get(field, "")
                    if val and "@lid" in val:
                        return val.split("@")[0]
                # Fall back to any JID
                jid = item.get("jid") or item.get("remoteJid") or ""
                return jid.split("@")[0] if jid else ""
        except Exception as e:
            print(f"[getJID] error: {e}")
        return ""

    def fetch_messages_by_jid(self, jid: str, limit: int = 100) -> list:
        """Fetch messages using an explicit JID string (supports @lid format)."""
        url = f"{self.base_url}/chat/findMessages/{self.instance}"
        try:
            resp = requests.post(url, json={
                "where": {"key": {"remoteJid": jid}},
                "limit": limit,
            }, headers=self.headers, timeout=15)
            data = resp.json()
            msgs = data.get("messages", data)
            if isinstance(msgs, dict):
                return msgs.get("records", [])
            if isinstance(msgs, list):
                return msgs
        except Exception:
            pass
        return []


def _clean_number(number: str) -> str:
    """Normalize to international format without + or spaces."""
    digits = "".join(filter(str.isdigit, number))
    if len(digits) == 10:
        digits = "52" + digits    # local 10-digit → Mexican
    return digits
