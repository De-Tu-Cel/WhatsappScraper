from copy import deepcopy
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app import service_health as health, balance_alerts as alerts, billing, llm
from app.api import routes


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(health, '_states', {})
    monkeypatch.setattr(health, '_store', None)
    monkeypatch.setattr(llm, 'OPENAI_API_KEY', 'test-key')
    monkeypatch.setattr(llm, 'DEEPSEEK_API_KEY', '')
    monkeypatch.setenv('DATAFORSEO_LOGIN', 'test')
    monkeypatch.setenv('DATAFORSEO_PASSWORD', 'password')
    monkeypatch.setenv('OPENAI_MONTHLY_BUDGET_USD', '10')
    monkeypatch.setenv('DATAFORSEO_LOW_BALANCE_USD', '5')
    monkeypatch.setenv('DATAFORSEO_CRITICAL_BALANCE_USD', '1')


@pytest.mark.parametrize('balance,level', [(50,None),(5,'warning'),(1,'critical'),(.01,'critical'),(0,None),(-1,None)])
def test_real_balance_thresholds(balance, level):
    alerts.record_balance('dataforseo', {'ok':True,'balance':balance})
    notices = health.admin_notifications()
    assert [n['severity'] for n in notices] == ([level] if level else [])


@pytest.mark.parametrize('spend,level', [(0,None),(7.99,None),(8,'warning'),(9.5,'critical'),(12,'critical')])
def test_openai_uses_monthly_budget_not_wallet_credit(spend, level):
    alerts.record_balance('ai', {'ok':True,'spend_this_month':spend})
    notices = health.admin_notifications()
    assert [n['severity'] for n in notices] == ([level] if level else [])
    if notices:
        assert notices[0]['budget'] == 10
        assert 'balance' not in notices[0]


def test_dedup_escalation_recharge_and_recurrence():
    alerts.record_balance('dataforseo', {'ok':True,'balance':4})
    first = health.admin_notifications()[0]['_id']
    read = datetime.now(timezone.utc)
    alerts.record_balance('dataforseo', {'ok':True,'balance':3})
    assert health.admin_notifications()[0]['_id'] == first
    assert health.admin_notifications(read) == []
    alerts.record_balance('dataforseo', {'ok':True,'balance':.9})
    assert len(health.admin_notifications(read)) == 1
    alerts.record_balance('dataforseo', {'ok':True,'balance':50})
    assert health.admin_notifications() == []
    alerts.record_balance('dataforseo', {'ok':True,'balance':4})
    assert health.admin_notifications()[0]['_id'] != first


def test_blocked_provider_uses_only_existing_pause_notice():
    alerts.record_balance('dataforseo', {'ok':True,'balance':1})
    health.record('dataforseo', health.dataforseo_credentials(), 'billing')
    assert [n['type'] for n in health.admin_notifications()] == ['service_health']


def test_failures_and_stale_samples_do_not_invent_balances():
    alerts.record_balance('ai', {'ok':False,'spend_this_month':9})
    assert health.admin_notifications() == []
    alerts.record_balance('ai', {'ok':True,'spend_this_month':9})
    alerts.record_balance('ai', {'ok':False})
    assert health.admin_notifications()[0]['amount'] == 9
    health._states[alerts._key('ai')]['checked_at'] -= timedelta(minutes=31)
    assert health.admin_notifications() == []


def test_project_credential_and_month_changes_do_not_leak_alerts(monkeypatch):
    alerts.record_balance('ai', {'ok':True,'spend_this_month':9})
    health._states[alerts._key('ai')]['period'] = '2000-01'
    assert health.admin_notifications() == []
    alerts.record_balance('ai', {'ok':True,'spend_this_month':9})
    monkeypatch.setattr(billing, 'OPENAI_PROJECT_ID', 'other-project')
    assert health.admin_notifications() == []
    alerts.record_balance('ai', {'ok':True,'spend_this_month':9})
    monkeypatch.setattr(llm, 'OPENAI_API_KEY', 'different-key')
    assert health.admin_notifications() == []


def test_snapshots_survive_worker_restart_without_touching_health():
    docs = {}
    store = Mock()
    store.find_one.side_effect = lambda q: deepcopy(docs.get(q['_id']))
    store.update_one.side_effect = lambda q,u,**kw: docs.update({q['_id']:deepcopy(u['$set'])})
    health.configure_store(store)
    alerts.record_balance('dataforseo', {'ok':True,'balance':3})
    notice = health.admin_notifications()[0]
    health._states.clear()
    assert health.admin_notifications()[0]['_id'] == notice['_id']
    assert health.public_status()['dataforseo']['status'] == 'unknown'


@pytest.mark.parametrize('role,count', [('admin',2),('agent',0)])
def test_notifications_and_counter_are_admin_only(monkeypatch, role, count):
    monkeypatch.setattr('app.activity_notices.automation_notifications', lambda *args, **kwargs: [])
    monkeypatch.setattr(routes, '_require_user', lambda token: {'id':'qa','role':token})
    db = Mock()
    for collection in ('message_logs','companies','app_notifications'):
        getattr(db.db,collection).find.return_value = []
        getattr(db.db,collection).count_documents.return_value = 0
    monkeypatch.setattr(routes, 'MongoDBManager', lambda:db)
    app = FastAPI(); app.include_router(routes.router, prefix='/api')
    client = TestClient(app)
    alerts.record_balance('ai', {'ok':True,'spend_this_month':8})
    alerts.record_balance('dataforseo', {'ok':True,'balance':4})
    headers = {'x-user-token':role}
    assert len(client.get('/api/notifications',headers=headers).json()) == count
    assert client.get('/api/notifications/count',headers=headers).json()['count'] == count
    if role == 'agent':
        assert 'budget' not in client.get('/api/notifications',headers=headers).text


def test_billing_queries_feed_alerts_without_inference(monkeypatch):
    monkeypatch.setattr(billing, 'OPENAI_ADMIN_API_KEY', 'test-admin')
    response = Mock(status_code=200, json=Mock(return_value={'data':[{'results':[{'amount':{'value':8}}]}]}))
    get = Mock(return_value=response); monkeypatch.setattr(billing.requests,'get',get)
    paid = Mock(); monkeypatch.setattr(llm,'call_llm',paid)
    assert billing.get_openai_spend()['monthly_budget_usd'] == 10
    assert health.admin_notifications()[0]['severity'] == 'warning'
    assert get.call_args.kwargs['params']['project_ids'] == [billing.OPENAI_PROJECT_ID]
    response.json.return_value = {'tasks':[{'result':[{'money':{'balance':.9}}]}]}
    assert billing.get_dataforseo_balance()['balance'] == .9
    assert len(health.admin_notifications()) == 2
    paid.assert_not_called()


def test_missing_admin_key_is_not_an_estimate_of_prepaid_credit(monkeypatch):
    monkeypatch.setattr(billing, 'OPENAI_ADMIN_API_KEY', '')
    get = Mock(); monkeypatch.setattr(billing.requests, 'get', get)
    assert billing.get_openai_spend() == {'configured':False}
    assert health.admin_notifications() == []
    get.assert_not_called()


def test_disabled_budget_and_invalid_settings(monkeypatch):
    monkeypatch.setenv('OPENAI_MONTHLY_BUDGET_USD', '0')
    alerts.record_balance('ai', {'ok':True,'spend_this_month':50})
    assert health.admin_notifications() == []
    monkeypatch.setenv('OPENAI_MONTHLY_BUDGET_USD', 'NaN')
    monkeypatch.setenv('DATAFORSEO_LOW_BALANCE_USD', 'bad')
    monkeypatch.setenv('DATAFORSEO_CRITICAL_BALANCE_USD', '100')
    assert alerts.limits() == {'openai_monthly_budget_usd':10,'dataforseo_warning_usd':5,'dataforseo_critical_usd':5}


def test_missing_project_cannot_query_unrelated_organization_spend(monkeypatch):
    monkeypatch.setattr(billing,'OPENAI_ADMIN_API_KEY','test-admin')
    monkeypatch.setattr(billing,'OPENAI_PROJECT_ID','')
    get = Mock(); monkeypatch.setattr(billing.requests,'get',get)
    assert billing.get_openai_spend()['reason'] == 'missing_project'
    get.assert_not_called()
