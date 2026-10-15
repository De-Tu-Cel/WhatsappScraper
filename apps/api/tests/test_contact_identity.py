import pytest

from app.contact_identity import payload_whatsapp_name, whatsapp_name_for_number


@pytest.mark.parametrize('payload', [
    {'name': 'Mi contacto', 'label': 'Reportar fuga'},
    {'pushName': {'name': 'bad'}}, None, {},
])
def test_scraped_labels_and_address_book_names_are_not_public_names(payload):
    assert payload_whatsapp_name(payload) == ''


def test_public_name_is_taken_from_latest_inbound_for_the_exact_phone():
    messages = [
        {'direction': 'inbound', 'from_number': '5212228120419', 'raw_data': {'whatsappName': 'Gas Uno Puebla'}},
        {'direction': 'inbound', 'from_number': '522221131901', 'raw_data': {'whatsappName': 'Otra sucursal'}},
        {'direction': 'outbound', 'to_number': '522228120419', 'raw_data': {'whatsappName': 'Antonio'}},
    ]
    assert whatsapp_name_for_number('+522228120419', messages) == 'Gas Uno Puebla'
    assert whatsapp_name_for_number('+522221131901', messages) == 'Otra sucursal'


def test_same_local_number_in_another_country_does_not_supply_the_name():
    messages = [{'direction': 'inbound', 'from_number': '573112000000', 'raw_data': {'pushName': 'Claro Colombia'}}]
    assert whatsapp_name_for_number('523112000000', messages) == ''


def test_trusted_profile_cache_is_distinct_from_scraped_label():
    contacts = [{'value': '+522228120419', 'label': 'Reportar fuga',
                 'whatsapp_name': 'Gas Uno Puebla', 'whatsapp_name_source': 'whatsapp'}]
    assert whatsapp_name_for_number('5212228120419', [], contacts) == 'Gas Uno Puebla'
    assert whatsapp_name_for_number('522221131901', [], contacts) == ''
    contacts[0].pop('whatsapp_name_source')
    assert whatsapp_name_for_number('522228120419', [], contacts) == ''


def test_latest_message_name_overrides_old_profile_cache():
    contacts = [{'value': '522228120419', 'whatsapp_name': 'Old', 'whatsapp_name_source': 'whatsapp'}]
    messages = [{'direction': 'inbound', 'from_number': '522228120419',
                 'raw_data': {'whatsappName': '  Gas   Uno\nPuebla  '}}]
    assert whatsapp_name_for_number('522228120419', messages, contacts) == 'Gas Uno Puebla'


def test_invalid_candidate_does_not_hide_valid_name_or_expose_other_fields():
    assert payload_whatsapp_name({'whatsappName': {}, 'pushName': 'Unknown', 'notifyName': 'Gas Uno'}) == 'Gas Uno'


def test_legacy_local_inbound_and_explicit_related_phone_are_supported():
    message = {'direction': 'inbound', 'from_number': '123456789012345@lid',
               'related_to_number': '2228120419', 'whatsapp_name': 'Gas Uno', 'whatsapp_name_source': 'whatsapp'}
    assert whatsapp_name_for_number('522228120419', [message]) == 'Gas Uno'


def test_latest_nonempty_public_name_wins_without_inventing_a_missing_name():
    messages = [
        {'direction': 'inbound', 'from_number': '522228120419', 'raw_data': {'pushName': 'Old'}},
        {'direction': 'inbound', 'from_number': '522228120419', 'raw_data': {'pushName': 'New'}},
        {'direction': 'inbound', 'from_number': '522228120419', 'raw_data': {'label': 'Reportar fuga'}},
    ]
    assert whatsapp_name_for_number('522228120419', messages) == 'New'


def test_history_sync_enriches_existing_inbound_without_reclassifying_or_overwriting_body(monkeypatch):
    from unittest.mock import MagicMock
    from fastapi import BackgroundTasks
    from app.api import routes
    from app.whatsapp_wwebjs import WWebjsClient

    company_id = '6a7633cbecf84e0f0e0336e1'
    manager = MagicMock()
    manager.db.companies.find_one.return_value = {'assigned_instance': 'session'}
    manager.db.instances.find_one.return_value = {'provider': 'wwebjs'}
    manager.db.contacts.find.return_value = [{'value': '+522228120419'}]
    manager.db.message_logs.find_one.side_effect = [None, {'message_id': 'real-wa-id'}]
    monkeypatch.setattr(routes, '_require_user', lambda token: {'role': 'agent'})
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: manager)
    monkeypatch.setattr(WWebjsClient, 'fetch_messages', lambda *args, **kwargs: [
        {'id': 'real-wa-id', 'fromMe': False, 'body': 'Original',
         'timestamp': 1791504000, 'whatsappName': 'Gas Uno Puebla'},
    ])
    tasks = BackgroundTasks()
    result = routes.api_sync_conversation(company_id, tasks, 'mock')
    assert result['synced'] == 0
    manager.save_evolution_log.assert_not_called()
    assert tasks.tasks == []
    manager.db.message_logs.update_one.assert_called_once_with(
        {'message_id': 'real-wa-id', 'company_id': company_id, 'direction': 'inbound'},
        {'$set': {'whatsapp_name': 'Gas Uno Puebla', 'whatsapp_name_source': 'whatsapp'}},
    )
