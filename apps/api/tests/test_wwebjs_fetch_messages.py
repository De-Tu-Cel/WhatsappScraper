"""Historial wwebjs para recuperar inbound perdido (SIMAGAS/GUVAL, 2026-10-08)."""
from unittest.mock import patch, MagicMock

from app.whatsapp_wwebjs import fetch_messages, WWebjsClient


def test_fetch_messages_posts_to_session_and_returns_list():
    resp = MagicMock()
    resp.ok = True
    resp.json.return_value = {
        "messages": [
            {"id": "true_1", "fromMe": False, "body": "Buenas tardes", "timestamp": 1760000000},
        ]
    }
    with patch("app.whatsapp_wwebjs._req.post", return_value=resp) as post:
        rows = fetch_messages("gely-wa", "+525528842109", limit=40)
    assert len(rows) == 1
    assert rows[0]["body"] == "Buenas tardes"
    args, kwargs = post.call_args
    assert args[0].endswith("/session/gely-wa/messages")
    assert kwargs["json"] == {"to": "+525528842109", "limit": 40}


def test_client_fetch_messages_uses_session():
    with patch("app.whatsapp_wwebjs.fetch_messages", return_value=[]) as fn:
        WWebjsClient("gely-wa").fetch_messages("+525612991789", limit=20)
    fn.assert_called_once_with("gely-wa", "+525612991789", 20)
