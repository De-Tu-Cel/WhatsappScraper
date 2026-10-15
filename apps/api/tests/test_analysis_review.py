from copy import deepcopy
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.analysis_review import review_state
from app.classifier import classifier_messages, assign_thread_numbers
from app.database import collapse_echoed_messages
from app import classification_compare as cc

T0 = datetime(2026, 10, 9, 12)


def comparison(stamp=T0):
    return {'updated_at': stamp, 'timing': {'common': 'humano', 'ran_at': stamp},
            'ia': {'common': 'humano', 'ran_at': stamp}, 'hibrido': {
                'category': 'humano', 'common': 'humano', 'ran_at': stamp,
                'parecido': {'items': [{'category': 'humano', 'min': 80, 'max': 90}]}}}


def test_outbound_after_analysis_is_new_even_without_new_reply():
    assert 'new_messages' in review_state(comparison(), T0 + timedelta(hours=1), True)['flags']


def test_updating_another_number_does_not_refresh_old_company_methods():
    doc = comparison()
    doc['updated_at'] = T0 + timedelta(days=1)
    assert 'new_messages' in review_state(doc, T0 + timedelta(hours=1), True)['flags']


def test_consumed_input_timestamp_detects_a_message_arriving_during_analysis():
    doc = comparison(T0 + timedelta(minutes=5))
    doc['hibrido']['input_last_at'] = T0
    assert 'new_messages' in review_state(doc, T0 + timedelta(minutes=1), True)['flags']


def test_no_reply_needs_no_range_but_missing_methods_are_pending():
    doc = comparison()
    doc['hibrido'] = {'category': 'sin_respuesta', 'common': 'sin_respuesta'}
    doc['ia']['common'] = 'sin_respuesta'
    doc['timing']['common'] = 'humano_o_desconectado'
    assert review_state(doc, T0, False)['flags'] == []
    assert review_state(None, T0, False)['flags'] == ['pending']


def test_range_difference_is_reviewable_without_changing_official_category():
    doc = comparison()
    doc['hibrido']['parecido']['items'][0]['category'] = 'bot'
    assert 'different_results' in review_state(doc, T0, True)['flags']
    assert doc['hibrido']['category'] == 'humano'


def test_long_chat_retains_opening_and_late_human_handoff():
    messages = [{'direction': 'outbound' if i % 2 == 0 else 'inbound', 'created_at': T0 + timedelta(minutes=i),
                 'message_body': f'message {i}'} for i in range(250)]
    messages[-1]['message_body'] = 'Le atiende Elena, ya revisé su solicitud.'
    selected = classifier_messages(messages)
    assert selected[0] is messages[0]
    assert selected[-1] is messages[-1]
    assert len(selected) <= 121
    assert selected[12]['direction'] == 'outbound'


def test_webhook_echo_is_removed_but_other_phone_and_distinct_message_id_survive():
    msg = {'direction': 'inbound', 'message_body': 'Buenos días', 'created_at': T0, 'from_number': '5512345678'}
    echo = {**msg, 'created_at': T0 + timedelta(milliseconds=20)}
    other = {**echo, 'from_number': '5587654321'}
    assert collapse_echoed_messages([msg, echo, other]) == [msg, other]
    assert len(collapse_echoed_messages([{**msg, 'message_id': 'one'}, {**echo, 'message_id': 'two'}])) == 2


def test_related_number_scopes_correlated_business_reply():
    rows = assign_thread_numbers([{'direction': 'outbound', 'to_number': '+525512345678'},
                                  {'direction': 'inbound', 'from_number': 'other@lid', 'related_to_number': '+525512345678'}])
    assert rows[-1]['_num'] == '5512345678'


def test_number_reanalysis_preserves_other_results_and_uses_one_snapshot(monkeypatch):
    cid, number = '6a74ae6becf84e0f0eecaa81', '5512345678'
    sibling = {'number': '5587654321', **comparison()}
    original = {'company_id': cid, **comparison(), 'numbers': [sibling]}
    prod = Mock(); prod.find_one.return_value = deepcopy(original)
    target = Mock(); target.update_one.return_value = SimpleNamespace(matched_count=1)
    history = Mock()
    store = {'classification_comparisons': prod, 'qa_classification_comparisons': target, 'qa_classification_logs': history}
    manager = SimpleNamespace(db=SimpleNamespace(companies=Mock()))
    class Store(dict):
        companies = manager.db.companies
    manager.db = Store(store)
    manager.db.companies.find_one.return_value = {'name': 'Example', 'industry': 'Gas'}
    monkeypatch.setattr('app.database.MongoDBManager', lambda: manager)
    messages = [{'direction': 'outbound', 'created_at': T0, 'message_body': 'Hola'},
                {'direction': 'inbound', 'created_at': T0 + timedelta(minutes=1), 'message_body': 'Le atiende Elena'}]
    source = Mock(return_value=messages); monkeypatch.setattr(cc, '_messages', source)
    monkeypatch.setattr('app.classifier.classify_conversation', lambda *a, **kw: {'category': 'humano', 'input_last_at': T0})
    monkeypatch.setattr('app.classifier._apply_last_message_corrections', lambda analysis, *a: analysis)
    monkeypatch.setattr(cc, 'finish_parecido', lambda analysis, *a: analysis.update(parecido={'items': [{'category': 'humano'}]}))
    timing = Mock(return_value={'common': 'humano'}); ia = Mock(return_value={'common': 'humano'})
    monkeypatch.setattr(cc, 'run_timing', timing); monkeypatch.setattr(cc, 'run_ai_only', ia)
    monkeypatch.setattr(cc, 'COMPARISONS', 'qa_classification_comparisons'); monkeypatch.setattr(cc, 'LOGS', 'qa_classification_logs')
    monkeypatch.setattr(cc, '_contacted_numbers', lambda *a: [number, '5587654321'])
    monkeypatch.setattr(cc, 'get_comparison', lambda *a: {})
    cc.run_number_comparison(cid, number)
    assert source.call_count == 1
    assert timing.call_args.kwargs['messages'] is messages
    assert ia.call_args.kwargs['messages'] is messages
    assert not prod.update_one.called
    assert target.update_one.call_args_list[1].args[0]['numbers.number'] == number
    assert target.update_one.call_args_list[1].args[1]['$set']['numbers.$']['number'] == number
    assert sibling == original['numbers'][0]


def test_invalid_number_never_opens_a_database(monkeypatch):
    db = Mock(); monkeypatch.setattr('app.database.MongoDBManager', db)
    with pytest.raises(ValueError):
        cc.run_number_comparison('6a74ae6becf84e0f0eecaa81', '123')
    db.assert_not_called()


def test_single_answered_number_reuses_complete_saved_company_result_without_writes():
    doc = {'company_id': 'claro', 'numbers': [], **comparison()}
    original = deepcopy(doc)
    messages = [{'direction': 'outbound', 'to_number': '+573112000000', 'created_at': T0},
                {'direction': 'inbound', 'from_number': '+573112000000', 'created_at': T0}]
    db = Mock()
    result = cc.single_reply_thread_comparison(db, doc, messages)
    assert result['numbers'][0]['number'] == '3112000000'
    assert result['numbers'][0]['hibrido'] == doc['hibrido']
    assert result['numbers'][0]['ia']['ran_at'] == T0
    assert doc == original
    assert not db.mock_calls


@pytest.mark.parametrize('case', ['two_replied', 'unknown_inbound', 'no_reply', 'no_outbound', 'existing_numbers'])
def test_ambiguous_threads_and_existing_number_results_are_never_overwritten(case):
    doc = {'company_id': 'claro', 'numbers': [], **comparison()}
    messages = [{'direction': 'outbound', 'to_number': '+573112000000'},
                {'direction': 'inbound', 'from_number': '+573112000000'}]
    if case == 'two_replied': messages.append({'direction': 'inbound', 'from_number': '+573205000000'})
    if case == 'unknown_inbound': messages = [{'direction': 'inbound', 'from_number': 'unknown@lid'}]
    if case == 'no_reply': messages = messages[:1]
    if case == 'no_outbound': messages = messages[1:]
    if case == 'existing_numbers': doc['numbers'] = [{'number': '3205000000', **comparison()}]
    assert cc.single_reply_thread_comparison(Mock(), doc, messages) is doc


def test_extra_uncontacted_phone_does_not_mark_complete_analysis_pending():
    from app.analysis_review import attach_reviews
    manager = Mock()
    manager.db.message_logs.find.return_value = [
        {'company_id': 'claro', 'direction': 'outbound', 'to_number': '+573112000000', 'created_at': T0},
        {'company_id': 'claro', 'direction': 'inbound', 'from_number': '+573112000000', 'created_at': T0}]
    rows = [{'company_id': 'claro', 'numbers': [{'number': '+573112000000'}, {'number': '+573205000000'}]}]
    doc = {'company_id': 'claro', 'numbers': [], **comparison()}
    attach_reviews(manager, rows, {'claro': doc})
    assert rows[0]['review']['flags'] == []
    assert rows[0]['numbers'][0]['review']['status'] == 'current'
    assert rows[0]['numbers'][1]['review']['status'] == 'not_contacted'
    assert [n['number'] for n in rows[0]['comparison']['numbers']] == ['3112000000']
    assert doc['numbers'] == []
