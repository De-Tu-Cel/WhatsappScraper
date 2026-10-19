"""Provider confirmation must precede removing a registry entry or proxy."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from requests.exceptions import HTTPError, ReadTimeout

from app.api import routes
from app import whatsapp_wwebjs


@pytest.mark.parametrize('failure', [ReadTimeout('timeout'), HTTPError('provider failed')])
def test_admin_keeps_registry_and_proxy_when_provider_stop_is_not_confirmed(failure):
    db = MagicMock()
    db.db.instances.find_one.return_value = {'provider': 'wwebjs'}
    response = MagicMock()
    response.raise_for_status.side_effect = failure
    with (patch.object(routes, '_require_user', return_value={'role': 'admin'}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('requests.delete', return_value=response),
          patch('app.proxies.forget_instance') as forget):
        with pytest.raises(HTTPException) as error:
            routes.api_delete_instance('dummy', 'mock-token')
        assert error.value.status_code == 502
        db.db.instances.delete_one.assert_not_called()
        forget.assert_not_called()


def test_admin_removes_registry_and_proxy_only_after_provider_confirmation():
    db, response = MagicMock(), MagicMock()
    db.db.instances.find_one.return_value = {'provider': 'wwebjs'}
    events = []
    response.raise_for_status.side_effect = lambda: events.append('confirmed')
    db.db.instances.delete_one.side_effect = lambda *args: events.append('registry')
    with (patch.object(routes, '_require_user', return_value={'role': 'admin'}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('requests.delete', return_value=response) as request,
          patch('app.proxies.forget_instance', side_effect=lambda *args: events.append('proxy'))):
        assert routes.api_delete_instance('dummy', 'mock-token') == {'ok': True}
        assert events == ['confirmed', 'proxy', 'registry']
        assert request.call_args.kwargs['timeout'] == 35


def test_network_failure_cannot_silently_delete_instance():
    db = MagicMock()
    db.db.instances.find_one.return_value = {'provider': 'wwebjs'}
    with (patch.object(routes, '_require_user', return_value={'role': 'admin'}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('requests.delete', side_effect=ReadTimeout()),
          patch('app.proxies.forget_instance') as forget):
        with pytest.raises(HTTPException):
            routes.api_delete_instance('dummy', 'mock-token')
        db.db.instances.delete_one.assert_not_called()
        forget.assert_not_called()


def test_closing_the_qr_dialog_only_stops_the_session_and_keeps_the_instance():
    """DELETE /wwebjs/session/{id} (cierre del diálogo de QR) detiene el navegador;
    nunca borra el documento de la instancia ni suelta su proxy."""
    db = MagicMock()
    with (patch.object(routes, '_require_session_access', return_value={'role': 'agent'}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch.object(whatsapp_wwebjs, 'delete_session') as stop,
          patch('app.proxies.forget_instance') as forget):
        assert routes.api_wwebjs_delete('dummy', 'mock-token') == {'ok': True}
        stop.assert_called_once_with('dummy')
        db.db.instances.delete_one.assert_not_called()
        forget.assert_not_called()


def test_session_delete_client_propagates_network_and_http_errors():
    with patch.object(whatsapp_wwebjs._req, 'delete', side_effect=ReadTimeout()):
        with pytest.raises(ReadTimeout):
            whatsapp_wwebjs.delete_session('dummy')
    response = MagicMock()
    response.raise_for_status.side_effect = HTTPError()
    with patch.object(whatsapp_wwebjs._req, 'delete', return_value=response):
        with pytest.raises(HTTPError):
            whatsapp_wwebjs.delete_session('dummy')
