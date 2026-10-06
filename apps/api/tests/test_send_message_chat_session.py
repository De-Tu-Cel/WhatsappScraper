"""/send-message desde un chat cuya sesión ya no sirve (real ask, 2026-10-05).

Un chat no se bloquea porque la sesión que lo llevaba se desconectó o ya no
existe: la respuesta sale por la rotación normal de quien escribe. Estos tests
cortan el flujo justo después de elegir la sesión (el cupo diario se simula
lleno), así que nunca llegan a enviar nada.
"""
from unittest.mock import patch

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.api.routes import api_send_message
from app.schemas.company import SendMessageRequest

CID = "6a0000000000000000000001"
GILAD_ID = "6a0000000000000000000002"
ANTONIO_ID = "6a0000000000000000000003"


class _Coll:
    def __init__(self, docs=None):
        self.docs = docs or []
        self.updates = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in q.items())

    def find_one(self, q, proj=None, **kw):
        return next((dict(d) for d in self.docs if self._match(d, q)), None)

    def find(self, q, proj=None, **kw):
        return [dict(d) for d in self.docs if self._match(d, q)]

    def update_one(self, q, u, **kw):
        self.updates.append((q, u))

    def find_one_and_update(self, q, u, **kw):
        return {"rr_index": 0}


class _DB:
    def __init__(self, instances):
        self.instances = _Coll(instances)
        self.companies = _Coll([{"_id": ObjectId(CID), "assigned_instance": "gely-wa"}])
        self.users = _Coll()


class _Mgr:
    def __init__(self, db):
        self.db = db


GELY = {"name": "gely-wa", "provider": "wwebjs", "number": "5215527479218", "assigned_to": ANTONIO_ID}
GILAD_SESSION = {"name": "francisco-wa", "provider": "wwebjs", "number": "5214420000000", "assigned_to": GILAD_ID}


class _Resp:
    def __init__(self, status):
        self.ok = True
        self._status = status

    def json(self):
        return {"status": self._status}


def _send(instances, statuses, user_id=GILAD_ID):
    """Corre /send-message como Gilad respondiendo en el chat de gely-wa. Devuelve
    (sesión elegida, error HTTP)."""
    db = _DB(instances)
    chosen = {}

    def fake_get(url, headers=None, timeout=None):
        st = statuses[url.split("/session/")[1].split("/")[0]]
        if isinstance(st, Exception):
            raise st
        return _Resp(st)

    def fake_reserve(_db, instance, cap, phone=None):
        chosen["instance"] = instance
        return False, False  # cupo "lleno": corta antes de enviar

    req = SendMessageRequest(company_id=CID, to_number="+525597184834", message="Saludos", instance="gely-wa")
    with patch("app.api.routes._require_user"), \
         patch("app.auth.get_user_by_token", return_value={"id": user_id, "username": "gilad"}), \
         patch("app.database.MongoDBManager", return_value=_Mgr(db)), \
         patch("app.send_guard.send_block_reason", return_value=None), \
         patch("app.config.EVOLUTION_API_KEY", "k"), \
         patch("app.daily_cap.is_new_contact", return_value=False), \
         patch("app.daily_cap.reserve_daily_slot", side_effect=fake_reserve), \
         patch("requests.get", side_effect=fake_get):
        with pytest.raises(HTTPException) as exc:
            api_send_message(req, x_user_token="tok")
    return chosen.get("instance"), exc.value, db


class TestChatSessionDown:
    def test_connected_chat_session_is_still_used(self):
        # Comportamiento de siempre: Gilad contesta por la sesión de Antonio.
        inst, err, _ = _send([GELY, GILAD_SESSION], {"gely-wa": "connected", "francisco-wa": "connected"})
        assert inst == "gely-wa"
        assert err.status_code == 429  # el corte simulado, no un bloqueo

    @pytest.mark.parametrize("status", ["not_found", "disconnected", "need_scan"])
    def test_down_chat_session_falls_back_to_senders_rotation(self, status):
        inst, err, db = _send([GELY, GILAD_SESSION], {"gely-wa": status, "francisco-wa": "connected"})
        assert inst == "francisco-wa"
        assert err.status_code == 429
        # La empresa queda asignada a la sesión nueva — las respuestas siguientes salen por ahí.
        assert ({"_id": ObjectId(CID)}, {"$set": {"assigned_instance": "francisco-wa"}}) in db.companies.updates

    def test_chat_session_deleted_from_instances_falls_back(self):
        # Antes se intentaba por el proveedor legado y quedaba "failed" sin aviso.
        inst, _, _ = _send([GILAD_SESSION], {"francisco-wa": "connected"})
        assert inst == "francisco-wa"

    def test_flaky_status_check_does_not_count_as_down(self):
        inst, _, _ = _send([GELY, GILAD_SESSION], {"gely-wa": TimeoutError(), "francisco-wa": "connected"})
        assert inst == "gely-wa"

    def test_no_connected_session_of_sender_explains_both(self):
        inst, err, _ = _send([GELY, GILAD_SESSION], {"gely-wa": "not_found", "francisco-wa": "disconnected"})
        assert inst is None
        assert err.status_code == 503
        assert "gely-wa" in err.detail and "ya no existe" in err.detail

    def test_sender_without_sessions_gets_clear_error(self):
        inst, err, _ = _send([GELY], {"gely-wa": "disconnected"})
        assert inst is None
        assert err.status_code == 400
        assert "no está conectada (disconnected)" in err.detail
