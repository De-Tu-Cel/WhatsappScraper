from types import SimpleNamespace
from unittest.mock import Mock, MagicMock

import pytest
from fastapi import HTTPException
from app.blacklist_preview import check_saved_rules
from test_blacklist_phone import FakeMgr


@pytest.mark.parametrize('value,blocked', [
    ('https://www.example.com/contacto', True), ('SHOP.EXAMPLE.COM', True),
    ('example.com', True), ('otherexample.com', False), ('example.com.evil.test', False),
])
def test_domain_preview_uses_exact_and_subdomain_rules(value, blocked):
    db = FakeMgr(blacklist=[{'type': 'domain', 'value': 'example.com'}])
    result = check_saved_rules(db, 'domain', value)
    assert result['blocked'] is blocked
    if blocked: assert result['matches'][0]['source'] == 'saved'


@pytest.mark.parametrize('value,rule,blocked', [
    ('Médico general','medico',True), ('Gas LP / Energía','gas',True),
    ('Gastronomía','gas',False), ('Cerrajería López','cerrajer',True),
])
def test_industry_preview_reuses_pipeline_word_and_accent_matching(value, rule, blocked):
    result = check_saved_rules(FakeMgr(blacklist=[{'type':'industry','value':rule}]), 'industry', value)
    assert result['blocked'] is blocked


@pytest.mark.parametrize('value', ['+52 55 1234 5678','5215512345678','5512345678'])
def test_phone_preview_reuses_send_guard_aliases_without_a_whatsapp_query(value):
    result = check_saved_rules(FakeMgr(blacklist=[{'type':'phone','value':'525512345678'}]), 'phone', value)
    assert result['blocked'] and result['matches'][0]['source'] == 'saved'


def test_system_domains_are_reported_separately(monkeypatch):
    from app import searcher
    monkeypatch.setattr(searcher, 'EXCLUDED_DOMAINS', {'system.example'})
    result = check_saved_rules(FakeMgr(), 'domain', 'https://shop.system.example/path')
    assert result['matches'] == [{'value':'system.example','source':'system','type':'domain'}]
    assert result['scope'] == 'saved_rules_and_system_domain_list'


@pytest.mark.parametrize('kind,value', [('unknown','example.com'), ('domain',''), ('domain','not a url'), ('phone','123'), ('industry',''), ('industry','a'*501)])
def test_invalid_inputs_do_not_read_database(kind, value):
    collection = MagicMock()
    with pytest.raises(ValueError):
        check_saved_rules(SimpleNamespace(db=SimpleNamespace(blacklist=collection)), kind, value)
    collection.find.assert_not_called()


def test_failure_does_not_claim_the_value_is_allowed():
    collection = MagicMock();collection.find.side_effect=RuntimeError('offline')
    with pytest.raises(RuntimeError):
        check_saved_rules(SimpleNamespace(db=SimpleNamespace(blacklist=collection)), 'domain','example.com')


def test_check_and_counts_endpoints_require_login_before_accessing_database(monkeypatch):
    from app.api import routes
    monkeypatch.setattr(routes, '_require_user', Mock(side_effect=HTTPException(401)))
    connect = Mock();monkeypatch.setattr(routes, 'MongoDBManager',connect)
    for call in [lambda: routes.api_blacklist_check('domain','example.com',''), lambda: routes.api_blacklist_stats('')]:
        with pytest.raises(HTTPException): call()
    connect.assert_not_called()


def test_stats_are_global_counts_and_read_only(monkeypatch):
    from app.api import routes
    collection=MagicMock();collection.count_documents.side_effect=lambda q: {'domain':361,'industry':0,'phone':3}[q['type']]
    monkeypatch.setattr(routes, '_require_user', lambda token: None)
    monkeypatch.setattr(routes, 'MongoDBManager', lambda:SimpleNamespace(db=SimpleNamespace(blacklist=collection)))
    assert routes.api_blacklist_stats('token') == {'domain':361,'industry':0,'phone':3}
    collection.update_one.assert_not_called();collection.insert_one.assert_not_called();collection.delete_one.assert_not_called()


def test_check_endpoint_is_read_only_and_returns_validation_error(monkeypatch):
    from app.api import routes
    monkeypatch.setattr(routes, '_require_user', lambda token: None)
    db = FakeMgr(blacklist=[{'type':'domain','value':'example.com'}])
    monkeypatch.setattr(routes, 'MongoDBManager', lambda:db)
    assert routes.api_blacklist_check('domain','example.com','token')['blocked'] is True
    with pytest.raises(HTTPException) as error: routes.api_blacklist_check('phone','12','token')
    assert error.value.status_code == 422
