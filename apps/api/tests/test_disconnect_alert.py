"""Correo de "sesión desconectada" (routes._notify_disconnect_if_still_down): a los 5 min se
reconfirma el estado, y si la base dice "conectada" se le pregunta a wwebjs — tania-sesion-3
(2026-10-12): dos avisos tardíos de "conectada" taparon un LOGOUT y el correo nunca salió."""
import asyncio

from app.api import routes


class _Instances:
    def __init__(self, doc):
        self.doc = doc
        self.updates = []

    def find_one(self, flt):
        return dict(self.doc) if self.doc else None

    def update_one(self, flt, upd):
        self.updates.append(upd["$set"])


def _run(monkeypatch, doc, live):
    inst = _Instances(doc)
    mgr = type("M", (), {"db": type("D", (), {"instances": inst})()})()
    sent = []

    async def no_sleep(_):
        return None

    monkeypatch.setattr(routes.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(routes, "MongoDBManager", lambda: mgr)
    monkeypatch.setattr(routes, "_wwebjs_live_status", lambda d: live)
    import app.email_service as es
    monkeypatch.setattr(es, "send_session_disconnected_email", lambda to, name, label: sent.append((name, label)))
    asyncio.run(routes._notify_disconnect_if_still_down("tania-sesion-3", "Requiere volver a escanear QR/código"))
    return sent, inst.updates


def test_a_stale_connected_in_the_db_does_not_hide_a_logout(monkeypatch):
    doc = {"name": "tania-sesion-3", "provider": "wwebjs", "status": "connected"}
    sent, updates = _run(monkeypatch, doc, "need_scan")
    assert sent and sent[0][0] == "tania-sesion-3"
    assert updates[0]["status"] == "need_scan"


def test_really_connected_sends_nothing(monkeypatch):
    doc = {"name": "tania-sesion-3", "provider": "wwebjs", "status": "connected"}
    sent, updates = _run(monkeypatch, doc, "connected")
    assert sent == [] and updates == []


def test_if_wwebjs_cannot_be_asked_the_db_is_trusted(monkeypatch):
    doc = {"name": "tania-sesion-3", "provider": "wwebjs", "status": "connected"}
    sent, _ = _run(monkeypatch, doc, None)
    assert sent == []


def test_still_down_in_the_db_sends_the_email(monkeypatch):
    doc = {"name": "tania-sesion-3", "provider": "wwebjs", "status": "need_scan",
           "disconnect_reason_label": "Requiere volver a escanear QR/código"}
    sent, _ = _run(monkeypatch, doc, "need_scan")
    assert sent == [("tania-sesion-3", "Requiere volver a escanear QR/código")]
