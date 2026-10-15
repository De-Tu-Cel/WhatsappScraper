from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth, billing, llm, llm_guard, searcher, service_health as health
from app.api import routes


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(health, '_states', {})
    monkeypatch.setattr(health, '_store', None)
    monkeypatch.setattr(llm, 'OPENAI_API_KEY', 'test-secret')
    monkeypatch.setattr(llm, 'DEEPSEEK_API_KEY', '')
    monkeypatch.setenv('DATAFORSEO_LOGIN', 'test-login')
    monkeypatch.setenv('DATAFORSEO_PASSWORD', 'test-password')
    llm_guard.reset_circuit()
    yield
    llm_guard.reset_circuit()


def response(data, code=200):
    return Mock(status_code=code, ok=code < 400, json=Mock(return_value=data))


@pytest.mark.parametrize('code,payload,reason', [
    (429, {'error': {'code': 'insufficient_quota'}}, 'billing'),
    (429, {'error': {'type': 'organization_spend_limit_exceeded'}}, 'billing'),
    (429, {'error': {'message': 'No credits remaining'}}, 'billing'),
    (429, {'error': {'code': 'rate_limit_exceeded'}}, 'rate_limit'),
    (402, {'error': {'message': 'insufficient balance'}}, 'billing'),
    (401, {'error': {'message': 'invalid api key'}}, 'auth'),
    (503, {'error': {'message': 'busy'}}, 'unavailable'),
])
def test_llm_failure_stops_retries_and_subsequent_requests(monkeypatch, code, payload, reason):
    post = Mock(return_value=response(payload, code))
    monkeypatch.setattr(llm.requests, 'post', post)
    for _ in range(2):
        with pytest.raises(health.ServiceUnavailable) as caught:
            llm.call_llm([{'role': 'user', 'content': 'test'}])
        assert caught.value.reason == reason
        assert 'test-secret' not in str(caught.value)
    assert post.call_count == 1
    assert not llm_guard.circuit_is_open()


@pytest.mark.parametrize('code,reason', [(40200, 'billing'), (40210, 'billing'),
    (40203, 'billing'), (40202, 'rate_limit'), (40209, 'rate_limit'), (40101, 'unavailable'), (40104, 'auth')])
def test_dataforseo_http_200_does_not_hide_task_errors(code, reason):
    with pytest.raises(health.ServiceUnavailable) as caught:
        health.inspect_response('dataforseo', 'account', response({'status_code': 20000, 'tasks': [{'status_code': code}]}))
    assert caught.value.reason == reason


@pytest.mark.parametrize('code', [20000, 40102, 40106])
def test_valid_empty_and_partial_search_results_are_not_billing_failures(code):
    data = {'status_code': 20000, 'tasks': [{'status_code': code, 'result': []}]}
    assert health.inspect_response('dataforseo', 'account', response(data)) == data
    assert health.state('dataforseo', 'account')['status'] == 'available'


def test_invalid_location_does_not_mark_account_without_credit():
    with pytest.raises(RuntimeError, match='consulta'):
        health.inspect_response('dataforseo', 'account', response({'tasks': [{'status_code': 40501}]}))
    assert health.state('dataforseo', 'account')['status'] == 'unknown'


def test_expired_cooldown_and_changed_credentials_allow_fresh_attempt():
    health.record('openai', 'old', 'billing')
    health.ensure_available('openai', 'new')
    health._states[health.account_id('openai', 'old')]['retry_at'] = datetime.now(timezone.utc) - timedelta(seconds=1)
    health.ensure_available('openai', 'old')


def test_other_worker_reads_shared_block_and_reset():
    docs = {}
    store = Mock()
    store.find_one.side_effect = lambda q: deepcopy(docs.get(q['_id']))
    store.update_one.side_effect = lambda q, u, **kw: docs.update({q['_id']: u['$set']})
    store.delete_one.side_effect = lambda q: docs.pop(q['_id'], None)
    health.configure_store(store)
    health.record('openai', 'account', 'billing')
    health._states.clear()  # A second process has an empty memory cache.
    with pytest.raises(health.ServiceUnavailable):
        health.ensure_available('openai', 'account')
    health.reset('openai', 'account')
    health.ensure_available('openai', 'account')


def test_free_location_check_cannot_clear_paid_search_block():
    health.record('dataforseo', 'account', 'billing')
    health.inspect_response('dataforseo', 'account', response({'tasks': [{'status_code': 20000}]}), mark_success=False)
    with pytest.raises(health.ServiceUnavailable):
        health.ensure_available('dataforseo', 'account')


def test_maps_details_stop_paid_calls_without_credit(monkeypatch):
    credentials = health.dataforseo_credentials()
    health.record('dataforseo', credentials, 'billing')
    post = Mock(); monkeypatch.setattr(searcher.requests, 'post', post)
    assert searcher.maps_business_details('123456') == {}
    post.assert_not_called()


def test_balance_zero_and_recharge_check(monkeypatch):
    get = Mock(return_value=response({'tasks': [{'status_code': 20000, 'result': [{'money': {'balance': 0}}]}]}))
    monkeypatch.setattr(billing.requests, 'get', get)
    assert billing.get_dataforseo_balance()['balance'] == 0
    assert health.public_status()['dataforseo']['reason'] == 'billing'
    get.return_value = response({'tasks': [{'status_code': 20000, 'result': [{'money': {'balance': 10}}]}]})
    billing.get_dataforseo_balance()
    assert health.public_status()['dataforseo']['status'] == 'blocked'
    billing.get_dataforseo_balance(clear_block=True)
    assert health.public_status()['dataforseo']['status'] == 'available'


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(auth, 'get_user_by_token', lambda token: {'role': token} if token in ('admin', 'agent') else None)
    app = FastAPI(); app.include_router(routes.router, prefix='/api')
    return TestClient(app)


@pytest.mark.parametrize('role', ['admin'])
def test_status_has_no_credentials_or_financial_details(client, role):
    health.record('openai', 'test-secret', 'billing')
    res = client.get('/api/services/status', headers={'x-user-token': role})
    assert res.status_code == 200
    assert res.json()['services']['ai']['reason'] == 'billing'
    assert all(s not in res.text for s in ('test-secret', 'test-password', 'test-login', 'balance', 'spend_this_month'))


def test_agents_and_anonymous_users_cannot_run_provider_checks(client, monkeypatch):
    call = Mock(); monkeypatch.setattr(llm, 'call_llm', call)
    assert client.get('/api/services/status').status_code == 401
    assert client.get('/api/services/status', headers={'x-user-token': 'agent'}).status_code == 403
    assert client.post('/api/services/check', json={'service': 'ai'}).status_code == 401
    assert client.post('/api/services/check', headers={'x-user-token': 'agent'}, json={'service': 'ai'}).status_code == 403
    call.assert_not_called()


def test_admin_probe_is_explicit_and_keeps_failure_visible(client, monkeypatch):
    def denied(*a, **kw):
        health.record('openai', 'test-secret', 'billing')
        raise health.ServiceUnavailable('openai', 'billing')
    call = Mock(side_effect=denied); monkeypatch.setattr(llm, 'call_llm', call)
    res = client.post('/api/services/check', headers={'x-user-token': 'admin'}, json={'service': 'ai'})
    assert res.status_code == 200
    assert res.json()['services']['ai']['status'] == 'blocked'
    assert call.call_args.kwargs['max_tokens'] == 3
    assert res.json()['check']['available'] is False
    assert res.json()['check']['reason'] == 'billing'


def test_admin_probe_reports_success_explicitly(client, monkeypatch):
    def accepted(*args, **kwargs):
        health.record('openai', 'test-secret')
        return 'OK'
    monkeypatch.setattr(llm, 'call_llm', accepted)
    res = client.post('/api/services/check', headers={'x-user-token':'admin'}, json={'service':'ai'})
    assert res.json()['check']['available'] is True


@pytest.mark.parametrize('balance', [-0.0048, 0, 50])
def test_balance_check_returns_amount_without_making_a_search(client, monkeypatch, balance):
    call = Mock(return_value={'ok':True, 'balance':balance})
    monkeypatch.setattr(billing, 'get_dataforseo_balance', call)
    paid = Mock(); monkeypatch.setattr(llm, 'call_llm', paid)
    res = client.post('/api/services/check', headers={'x-user-token':'admin'}, json={'service':'dataforseo'})
    assert res.json()['check']['balance'] == balance
    assert res.json()['check']['available'] == (balance > 0)
    call.assert_called_once_with(clear_block=True)
    paid.assert_not_called()


def test_balance_network_failure_is_not_reported_as_success(client, monkeypatch):
    monkeypatch.setattr(billing, 'get_dataforseo_balance', lambda **kwargs:{'ok':False,'error':'network'})
    res = client.post('/api/services/check', headers={'x-user-token':'admin'}, json={'service':'dataforseo'})
    assert res.json()['check']['ok'] is False


def test_unconfigured_provider_never_attempts_check(client, monkeypatch):
    monkeypatch.setattr(llm, 'OPENAI_API_KEY', '')
    call = Mock(); monkeypatch.setattr(llm, 'call_llm', call)
    res = client.post('/api/services/check', headers={'x-user-token': 'admin'}, json={'service': 'ai'})
    assert res.status_code == 409
    call.assert_not_called()


def test_pending_reply_reason_is_visible_to_authenticated_agent(client, monkeypatch):
    manager = Mock()
    manager.db.conversation_ai_prefs.find_one.return_value = {'ai_enabled': True}
    manager.db.ai_followup_sessions.find_one.return_value = {
        'status': 'active', 'ai_typing': False, 'provider_blocked': 'IA sin saldo',
    }
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: manager)
    res = client.get('/api/conversations/company/ai-status', headers={'x-user-token': 'agent'})
    assert res.status_code == 200
    assert 'saldo' not in res.json()['provider_blocked']
    assert 'manualmente' in res.json()['provider_blocked']
    assert res.json()['ai_typing'] is False


@pytest.mark.parametrize('role,expected', [('admin', 2), ('agent', 0)])
def test_service_notifications_and_badges_are_admin_only(client, monkeypatch, role, expected):
    manager = Mock()
    manager.db.message_logs.find.return_value = []
    manager.db.companies.find.return_value = []
    manager.db.app_notifications.find.return_value = []
    manager.db.message_logs.count_documents.return_value = 0
    manager.db.app_notifications.count_documents.return_value = 0
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: manager)
    health.record('openai', 'test-secret', 'billing')
    health.record('dataforseo', health.dataforseo_credentials(), 'billing')
    headers = {'x-user-token': role}
    notifications = client.get('/api/notifications', headers=headers)
    assert notifications.status_code == 200
    assert len(notifications.json()) == expected
    assert client.get('/api/notifications/count', headers=headers).json()['count'] == expected
    if role == 'agent':
        assert 'saldo' not in notifications.text


def test_repeated_failure_does_not_create_another_unread_notification():
    health.record('openai', 'test-secret', 'billing')
    first = health.admin_notifications()[0]
    read_at = datetime.now(timezone.utc)
    health.record('openai', 'test-secret', 'billing')
    assert health.admin_notifications()[0]['_id'] == first['_id']
    assert health.admin_notifications(read_at) == []
    health.record('openai', 'test-secret')
    assert health.admin_notifications() == []
    health.record('openai', 'test-secret', 'billing')
    assert len(health.admin_notifications(read_at)) == 1


@pytest.mark.parametrize('role', ['admin', 'agent'])
def test_search_failure_does_not_expose_billing_outside_notifications(client, monkeypatch, role):
    manager = Mock()
    manager.get_all_scraped_domains.return_value = set()
    manager.known_maps_lead_urls.return_value = set()
    manager.db.blacklist.find.return_value = []
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: manager)
    monkeypatch.setattr(routes, 'search_prospects', Mock(return_value=([], None, [])))
    health.record('dataforseo', health.dataforseo_credentials(), 'billing')
    res = client.post('/api/search', headers={'x-user-token': role}, json={'industry': 'dentistas'})
    assert res.status_code == 200
    assert res.json()['service_warnings']
    assert all(word not in res.text for word in ('saldo', 'billing', 'dataforseo', 'DataForSEO'))
