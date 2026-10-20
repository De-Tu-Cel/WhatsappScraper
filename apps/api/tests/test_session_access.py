"""HTTP permission and dispatch regressions. No providers or real DB are used."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.testclient import TestClient

from app.api import routes
from app import auth
from app.session_diagnostics import sanitize_diagnostics
from app.send_guard import dispatch_guard
from app.delivery_receipts import dispatch_once
from test_messaging_safety import Collection


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes.router, prefix='/api')
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize('method,path,body', [
    ('post', '/wwebjs/session/other/start', {}),
    ('get', '/wwebjs/session/other/status', None),
    ('get', '/wwebjs/session/other/qr', None),
    ('get', '/wwebjs/session/other/pairing-code', None),
    ('get', '/wwebjs/session/other/info', None),
    ('post', '/wwebjs/session/other/verify', {'phone': '525500000000'}),
    ('post', '/wwebjs/session/other/contact/save', {}),
    ('post', '/wwebjs/session/other/profile/name', {}),
    ('post', '/wwebjs/session/other/profile/status', {}),
    ('post', '/wwebjs/session/other/profile/picture', {}),
    ('post', '/wwebjs/session/other/react', {}),
    ('delete', '/wwebjs/session/other', None),
    ('post', '/wwebjs/session/create', {}),
    ('get', '/wwebjs/sessions', None),
])
def test_anonymous_session_routes_reject_before_db_or_provider(client, method, path, body):
    with patch.object(routes, 'MongoDBManager') as database:
        response = client.request(method, '/api' + path, **({'json': body} if body is not None else {}))
    assert response.status_code == 401
    database.assert_not_called()


@pytest.mark.parametrize('role,owner,expected', [('agent', 'user-a', 200), ('agent', 'user-b', 403), ('admin', 'user-b', 200)])
def test_owned_session_and_admin_scope(client, role, owner, expected):
    db = MagicMock()
    db.db.instances.find_one.return_value = {'name': 'sample', 'assigned_to': owner}
    with (patch('app.auth.get_user_by_token', return_value={'id': 'user-a', 'role': role}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('app.whatsapp_wwebjs.get_qr', return_value={'qr': 'dummy'}) as provider):
        response = client.get('/api/wwebjs/session/sample/qr', headers={'x-user-token': 'dummy'})
    assert response.status_code == expected
    assert provider.call_count == int(expected == 200)


def test_agent_cannot_create_sessions(client):
    with patch('app.auth.get_user_by_token', return_value={'id': 'a', 'role': 'agent'}):
        assert client.post('/api/wwebjs/session/create', json={}, headers={'x-user-token': 'dummy'}).status_code == 403


@pytest.mark.parametrize('owner,expected', [('a', 200), ('someone-else', 403)])
def test_agent_can_only_stop_its_own_session_and_never_deletes_it(client, owner, expected):
    """DELETE /wwebjs/session/{id} es "detener" (cerrar el diálogo de QR): el dueño
    puede hacerlo desde Configuración; nunca borra el documento de la instancia."""
    db = MagicMock()
    db.db.instances.find_one.return_value = {'name': 'sample', 'assigned_to': owner}
    with (patch('app.auth.get_user_by_token', return_value={'id': 'a', 'role': 'agent'}),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('app.whatsapp_wwebjs.delete_session') as stop):
        response = client.delete('/api/wwebjs/session/sample', headers={'x-user-token': 'dummy'})
    assert response.status_code == expected
    assert stop.call_count == int(expected == 200)
    db.db.instances.delete_one.assert_not_called()


def test_personal_link_never_steals_an_instance_or_changes_number():
    db = MagicMock()
    db.users.find_one.return_value = {'_id': ObjectId()}
    db.instances.find_one.return_value = None
    with patch.object(auth, '_db', return_value=db):
        with pytest.raises(PermissionError):
            auth.update_evolution('dummy', 'someone-elses-instance', 'fake-number')
    db.users.update_one.assert_not_called()
    db.instances.update_one.assert_not_called()


@pytest.mark.parametrize('secret,header,code', [('', '', 503), ('test', '', 401), ('test', 'wrong', 401)])
def test_webhook_requires_service_secret_before_reading_body(secret, header, code):
    request = MagicMock(headers={'x-api-secret': header})
    request.json = AsyncMock()
    with patch('app.whatsapp_wwebjs.API_SECRET', secret), patch.object(routes, 'MongoDBManager') as db:
        with pytest.raises(HTTPException) as error:
            asyncio.run(routes.api_wwebjs_webhook(request, BackgroundTasks()))
    assert error.value.status_code == code
    request.json.assert_not_called()
    db.assert_not_called()


@pytest.mark.parametrize('reason', ['missing_consent', 'opt_out', 'phone', 'domain', 'industry'])
def test_dispatch_rechecks_blocks_without_contacting_provider(reason):
    db = SimpleNamespace(db=SimpleNamespace(delivery_receipts=Collection()))
    provider = MagicMock(return_value={'success': True})
    with patch('app.send_guard.send_block_reason', return_value={'reason': reason}):
        result = dispatch_once(db, 'attempt', provider, authorize=dispatch_guard(db, '', '525500000000'))
    assert result['success'] is False
    assert result['blocked_reason'] == reason
    provider.assert_not_called()
    assert db.db.delivery_receipts.find_one({'_id': 'attempt'})['status'] == 'failed'


def test_permission_database_failure_fails_closed_at_dispatch():
    db = SimpleNamespace(db=SimpleNamespace(delivery_receipts=Collection()))
    provider = MagicMock()
    with patch('app.send_guard.send_block_reason', side_effect=RuntimeError('DB unavailable')):
        result = dispatch_once(db, 'attempt', provider, authorize=dispatch_guard(db, '', '525500000000'))
    assert result['blocked_reason'] == 'permission_check_failed'
    provider.assert_not_called()


def test_health_evidence_drops_message_bodies_secrets_and_invalid_numbers():
    clean = sanitize_diagnostics({'service_memory_mb': float('nan'), 'api_key': 'secret',
        'activity': {'operation': 'send', 'last_operation': 'verify', 'message': 'private', 'queued': 2},
        'last_error': {'source': 'heartbeat', 'message': 'private'},
        'session_memory': {'memory_mb': 500, 'processes': 4}})
    assert clean['session_memory']['memory_mb'] == 500
    assert clean['activity']['last_operation'] == 'verify'
    assert 'secret' not in str(clean) and 'private' not in str(clean) and 'nan' not in str(clean)
