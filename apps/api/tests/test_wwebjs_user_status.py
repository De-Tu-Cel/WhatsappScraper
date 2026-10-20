"""Configuración usa /wwebjs/instances/user-status para listar los números del usuario."""
from unittest.mock import MagicMock, patch

from requests.exceptions import ConnectTimeout

from app.api import routes


def _db_with(instances):
    db = MagicMock()
    db.db.instances.find.return_value = instances
    return db


def _status_response(status):
    response = MagicMock(ok=True)
    response.json.return_value = {"status": status}
    return response


def test_lists_disconnected_numbers_and_counts_only_live_connections():
    instances = [
        {"name": "marco-wa", "number": "5214428380107", "status": "need_scan", "disconnect_reason": "LOGOUT"},
        {"name": "sender666", "number": "5214428079840", "status": "connected"},
        {"name": "sin-numero", "number": "", "status": "connected"},
    ]
    live = {"marco-wa": "need_scan", "sender666": "connected", "sin-numero": "connected"}
    with (patch("app.auth.get_user_by_token", return_value={"id": "u1", "role": "agent"}),
          patch.object(routes, "MongoDBManager", return_value=_db_with(instances)),
          patch("requests.get", side_effect=lambda url, **_: _status_response(live[url.split("/session/")[1].split("/")[0]]))):
        result = routes.api_wwebjs_user_status("token")
    assert result["total"] == 3
    assert result["connected_count"] == 1  # sin número no cuenta como conectado
    assert [(i["name"], i["live_status"]) for i in result["instances"]] == [
        ("marco-wa", "need_scan"), ("sender666", "connected"), ("sin-numero", "connected")]
    assert result["instances"][0]["disconnect_reason"] == "LOGOUT"


def test_unreachable_service_never_reports_a_stale_connection():
    instances = [{"name": "sender666", "number": "5214428079840", "status": "connected"}]
    with (patch("app.auth.get_user_by_token", return_value={"id": "u1", "role": "agent"}),
          patch.object(routes, "MongoDBManager", return_value=_db_with(instances)),
          patch("requests.get", side_effect=ConnectTimeout())):
        result = routes.api_wwebjs_user_status("token")
    assert result["connected_count"] == 0
    assert result["instances"][0]["live_status"] == "unknown"


def test_user_without_numbers_gets_an_empty_list():
    with (patch("app.auth.get_user_by_token", return_value={"id": "u1", "role": "agent"}),
          patch.object(routes, "MongoDBManager", return_value=_db_with([]))):
        assert routes.api_wwebjs_user_status("token") == {"connected": False, "connected_count": 0, "total": 0, "instances": []}
