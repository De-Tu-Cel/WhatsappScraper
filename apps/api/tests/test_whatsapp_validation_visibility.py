from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.database import MongoDBManager
from app.whatsapp_wwebjs import registration_status


@pytest.mark.parametrize('response,expected', [
    ({'registered': True}, True), ({'registered': False}, False),
    ({'registered': True, 'exists': False}, True), ({'exists': True}, True),
    ({}, None), ({'registered': 'false'}, None),
])
def test_registration_uses_service_field_without_turning_unknown_into_invalid(response, expected):
    assert registration_status(response) is expected


def test_saved_status_matches_mexican_number_variants_and_keeps_unknown_separate():
    now = datetime(2026, 10, 9)
    collection = MagicMock()
    collection.find.return_value = [
        {'jid': '5215512345678', 'wa_valid': False, 'wa_checked_at': now},
        {'jid': '525512345678', 'wa_valid': True, 'wa_checked_at': now - timedelta(days=1)},
        {'jid': '525500000000', 'wa_valid': 'false'},
    ]
    manager = object.__new__(MongoDBManager)
    manager.db = SimpleNamespace(jid_map=collection)
    result = manager.get_whatsapp_validation(['+52 55 1234 5678', '+525500000000', '+525599999999'])
    assert result['+52 55 1234 5678'] == {'valid': False, 'checked_at': now}
    assert result['+525500000000']['valid'] is None
    assert result['+525599999999']['valid'] is None
    collection.update_one.assert_not_called()


@pytest.mark.parametrize('response,valid,unknown', [({'registered': True}, 1, 0), ({}, 0, 1)])
def test_bulk_verifier_does_not_cache_false_for_a_registered_or_unknown_response(monkeypatch, response, valid, unknown):
    from app.api import routes
    from app import auth, whatsapp_wwebjs
    collection = MagicMock()
    collection.find.return_value = []
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: SimpleNamespace(db=SimpleNamespace(jid_map=collection)))
    monkeypatch.setattr(auth, 'get_user_by_token', lambda token: {'id': 'local-test'})
    monkeypatch.setattr(whatsapp_wwebjs, 'verify_number', lambda session, phone: response)
    result = routes.api_wwebjs_bulk_verify({'numbers': ['+525512345678'], 'session': 'local-test'}, 'local-token')
    assert result['valid'] == valid
    assert result['invalid'] == 0
    assert result['unknown'] == unknown
    if unknown:
        collection.update_one.assert_not_called()
    else:
        assert collection.update_one.call_args.args[1]['$set']['wa_valid'] is True
