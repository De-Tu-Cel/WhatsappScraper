from unittest.mock import Mock

import pytest

from app import billing, balance_alerts, service_health


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('ANTHROPIC_ADMIN_API_KEY', 'fake-admin')
    monkeypatch.setenv('ANTHROPIC_WORKSPACE_ID', 'workspace-app')
    monkeypatch.setenv('ANTHROPIC_MONTHLY_BUDGET_USD', '20')
    record = Mock()
    monkeypatch.setattr(balance_alerts, 'record_balance', record)
    return record


def response(data, **extra):
    return Mock(json=Mock(return_value={'data': [{'results': data}], 'has_more': False, **extra}))


def test_scope_decimal_cents_pagination_and_budget(monkeypatch, configured):
    get = Mock(side_effect=[
        response([{'workspace_id': 'unrelated', 'currency': 'USD', 'amount': '990000'},
                  {'workspace_id': 'workspace-app', 'currency': 'USD', 'amount': '123.78912'}], has_more=True, next_page='second'),
        response([{'workspace_id': 'workspace-app', 'currency': 'USD', 'amount': '82.5'}]),
    ])
    monkeypatch.setattr(billing.requests, 'get', get)
    data = billing.get_anthropic_spend()
    assert data['spend_this_month'] == 2.06
    assert data['monthly_budget_usd'] == 20
    assert get.call_args_list[1].kwargs['params']['page'] == 'second'
    configured.assert_called_once_with('ai', data)


@pytest.mark.parametrize('name', ['ANTHROPIC_ADMIN_API_KEY', 'ANTHROPIC_WORKSPACE_ID'])
def test_missing_config_never_queries_org(monkeypatch, configured, name):
    monkeypatch.delenv(name)
    get = Mock()
    monkeypatch.setattr(billing.requests, 'get', get)
    assert billing.get_anthropic_spend()['configured'] is False
    get.assert_not_called()
    configured.assert_not_called()


def test_partial_failure_is_not_reported_as_total(monkeypatch, configured):
    get = Mock(side_effect=[response([], has_more=True, next_page='second'), RuntimeError('secret')])
    monkeypatch.setattr(billing.requests, 'get', get)
    data = billing.get_anthropic_spend()
    assert data['ok'] is False
    assert 'secret' not in str(data)
    assert 'spend_this_month' not in data
    configured.assert_not_called()


def test_claude_alert_is_scoped_and_does_not_reuse_openai(monkeypatch):
    monkeypatch.setattr(service_health, '_states', {})
    monkeypatch.setattr(service_health, '_store', None)
    monkeypatch.setattr(service_health, 'configured_services', lambda: {'ai': ('anthropic', 'fake-key'), 'dataforseo': ('dataforseo', '')})
    monkeypatch.setattr(service_health, 'public_status', lambda: {'ai': {}, 'dataforseo': {}})
    monkeypatch.setenv('ANTHROPIC_WORKSPACE_ID', 'workspace-app')
    monkeypatch.setenv('ANTHROPIC_MONTHLY_BUDGET_USD', '20')
    balance_alerts.record_balance('ai', {'ok': True, 'provider': 'openai', 'spend_this_month': 100})
    assert balance_alerts.admin_notifications() == []
    balance_alerts.record_balance('ai', {'ok': True, 'provider': 'anthropic', 'spend_this_month': 17})
    notice = balance_alerts.admin_notifications()[0]
    assert notice['label'] == 'Claude'
    assert notice['budget'] == 20
    monkeypatch.setenv('ANTHROPIC_WORKSPACE_ID', 'another-workspace')
    assert balance_alerts.admin_notifications() == []
