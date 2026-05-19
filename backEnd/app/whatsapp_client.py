import re
import requests
from datetime import datetime

class WhatAppClient:
    def __init__(self, phone_number_id, access_token):
        self.phone_number_id = phone_number_id
        self.access_token = access_token
        self.base_url = f"https://graph.facebook.com/v25.0/{phone_number_id}/messages"

    def _clean_number(self, to_number):
        return re.sub(r"\D", "", to_number or "")

    def send_message(self, to_number, message_text):
        clean_to = self._clean_number(to_number)

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "text",
            "text": {"body": message_text},
        }

        response = requests.post(self.base_url, headers=headers, json=payload, timeout=30)
        return {
            "sent_at": datetime.now().isoformat(),
            "status_code": response.status_code,
            "response_json": response.json() if response.content else {},
            "raw_text": response.text,
        }

    def send_template_message(self, to_number, template_name="hello_world", lang="en_US"):
        clean_to = self._clean_number(to_number)

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

        payload = {
            "messaging_product": "whatsapp",
            "to": clean_to,
            "type": "template",
            "template": {
                "name": "hello_world",
                "language": {"code": "en_US"}
            },
        }

        response = requests.post(self.base_url, headers=headers, json=payload, timeout=30)
        return {
            "sent_at": datetime.now().isoformat(),
            "status_code": response.status_code,
            "response_json": response.json() if response.content else {},
            "raw_text": response.text,
        }