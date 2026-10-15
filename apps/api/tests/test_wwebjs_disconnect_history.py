"""Caídas reales que exigen QR y su causa: auditoría del 2026-10-15."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks
from app.api.routes import api_wwebjs_webhook


@pytest.mark.parametrize("previous,status,reason,expected", [
    ("connected", "need_scan", "LOGOUT", "LOGOUT"),
    ("connected", "need_scan", "UNPAIRED_IDLE", "UNPAIRED_IDLE"),
    ("need_scan", "need_scan", None, None),
    ("initializing", "need_scan", None, None),
    ("connected", "disconnected", "HEARTBEAT_TIMEOUT", "HEARTBEAT_TIMEOUT"),
    ("connected", "auth_failure", None, "auth_failure"),
])
def test_real_disconnect_history(previous, status, reason, expected):
    manager = MagicMock()
    manager.db.instances.find_one.return_value = {"name": "qa", "status": previous}
    request = MagicMock()
    request.json = AsyncMock(return_value={
        "event": "session.status", "sessionId": "qa",
        "data": {"status": status, "reason": reason},
    })
    tasks = BackgroundTasks()  # se inspeccionan, no se ejecutan notificaciones.
    with patch("app.api.routes.MongoDBManager", return_value=manager):
        assert asyncio.run(api_wwebjs_webhook(request, tasks)) == {"ok": True}
    if expected:
        manager.save_instance_health_log.assert_called_once()
        assert manager.save_instance_health_log.call_args.args == ("qa", "disconnected")
        assert manager.save_instance_health_log.call_args.kwargs["reason"] == expected
    else:
        manager.save_instance_health_log.assert_not_called()
    update = manager.db.instances.update_one.call_args.args[1]["$set"]
    assert update["disconnect_reason"] == (reason or status)
    assert len(tasks.tasks) == (1 if previous == "connected" else 0)
