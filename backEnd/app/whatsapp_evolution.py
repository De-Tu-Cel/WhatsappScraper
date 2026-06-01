# whatsapp_evolution.py
import requests
from datetime import datetime


class EvolutionClient:
    def __init__(self, api_url: str, api_key: str, instance: str):
        self.base_url = api_url.rstrip("/")
        self.instance = instance
        self.headers = {"apikey": api_key, "Content-Type": "application/json"}

    def send_text(self, number: str, text: str) -> dict:
        """Send a plain-text WhatsApp message via Evolution API."""
        clean = _clean_number(number)
        url = f"{self.base_url}/message/sendText/{self.instance}"
        payload = {"number": clean, "text": text}
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


def _clean_number(number: str) -> str:
    """Normalize to international format without + or spaces."""
    digits = "".join(filter(str.isdigit, number))
    if len(digits) == 10:
        digits = "521" + digits   # local → Mexican mobile
    elif len(digits) == 12 and digits.startswith("52"):
        digits = "521" + digits[2:]  # 52XXXXXXXXXX → 521XXXXXXXXXX
    return digits
