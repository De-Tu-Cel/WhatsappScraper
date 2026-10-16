import re
from unittest.mock import MagicMock
from bson import ObjectId
from app.reply_routing import reply_source_instance


def test_actual_receiving_session_overrides_an_unrelated_company_phone_assignment():
    db = MagicMock()
    db.db.message_logs.find_one.return_value = {'received_on_instance': 'actual-chat-line'}
    inbound = str(ObjectId())
    assert reply_source_instance(db, 'company', '+522228120419', inbound) == 'actual-chat-line'
    assert db.db.message_logs.find_one.call_args.args[0] == {
        '_id': ObjectId(inbound), 'company_id': 'company', 'direction': 'inbound',
    }


def test_legacy_history_uses_only_successful_sends_to_the_exact_phone_country():
    db = MagicMock()
    db.db.message_logs.find_one.side_effect = [None, {'instance_name': 'source-line'}]
    assert reply_source_instance(db, 'company', '+573112000000', str(ObjectId())) == 'source-line'
    query = db.db.message_logs.find_one.call_args.args[0]
    pattern = query['$or'][0]['to_number']['$regex']
    assert re.match(pattern, '+57 311 200 0000')
    assert not re.match(pattern, '+52 311 200 0000')
    assert query['status']['$in'] == ['sent', 'delivered', 'read', 'synced']


def test_mexican_52_521_aliases_resolve_to_the_same_chat():
    db = MagicMock()
    db.db.message_logs.find_one.return_value = {'instance_name': 'source-line'}
    assert reply_source_instance(db, 'company', '+522228120419') == 'source-line'
    pattern = db.db.message_logs.find_one.call_args.args[0]['$or'][0]['to_number']['$regex']
    assert re.match(pattern, '5212228120419@c.us')
    assert re.match(pattern, '+52 222 812 0419')
    assert not re.match(pattern, '+52 222 113 1901')


def test_unresolved_lid_or_empty_profile_does_not_invent_a_sender():
    db = MagicMock()
    assert reply_source_instance(db, 'company', '12345@lid') is None
    db.db.message_logs.find_one.assert_not_called()
