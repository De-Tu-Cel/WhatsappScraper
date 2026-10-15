from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from bson import ObjectId

from app import activity_hours, scheduler, send_now_worker, whatsapp_wwebjs


@pytest.mark.parametrize('utc,allowed', [
    ('2026-10-15T13:59:59', False), ('2026-10-15T14:00:00', True),
    ('2026-10-16T00:59:59', True), ('2026-10-16T01:00:00', False),
])
def test_shared_hours_use_mexico_city(utc, allowed):
    assert activity_hours.activity_allowed(datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)) is allowed


@pytest.mark.parametrize('utc,expected', [
    ('2026-10-15T09:00:00', '2026-10-15T14:00:00+00:00'),
    ('2026-10-16T01:00:00', '2026-10-16T14:00:00+00:00'),
])
def test_next_opening_is_08_local(utc, expected):
    assert activity_hours.next_activity_opening(datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)).isoformat() == expected


@pytest.mark.parametrize('code,error', [
    ('LINE_BUSY', whatsapp_wwebjs.LineBusy), ('LINE_UNAVAILABLE', whatsapp_wwebjs.LineBusy),
    ('ACTIVITY_CANCELLED', whatsapp_wwebjs.LineBusy), ('SEND_WINDOW_CLOSED', whatsapp_wwebjs.SendWindowClosed),
])
@pytest.mark.parametrize('operation', ['send', 'media', 'verify'])
def test_known_unsent_operation_is_deferred_not_failed(code, error, operation):
    response = MagicMock(status_code=409, ok=False)
    response.json.return_value = {'code': code}
    with patch.object(whatsapp_wwebjs._req, 'post', return_value=response):
        with pytest.raises(error):
            if operation == 'send':
                whatsapp_wwebjs.send_message('qa', '525500000001', 'test')
            elif operation == 'media':
                whatsapp_wwebjs.send_media('qa', '525500000001', 'https://example.invalid/a.png')
            else:
                whatsapp_wwebjs.verify_number('qa', '525500000001')


def test_manual_send_explicitly_identifies_itself_and_automatic_is_the_default():
    response = MagicMock(status_code=200, ok=True)
    response.json.return_value = {'success': True}
    with patch.object(whatsapp_wwebjs._req, 'post', return_value=response) as post:
        whatsapp_wwebjs.WWebjsClient('qa').send('525500000001', 'test', automatic=False)
        assert post.call_args.kwargs['json']['automatic'] is False
        whatsapp_wwebjs.WWebjsClient('qa').send('525500000001', 'test')
        assert post.call_args.kwargs['json'].get('automatic', True) is True


def test_campaign_cannot_enter_provider_routing_outside_hours(monkeypatch):
    monkeypatch.setattr(activity_hours, 'activity_allowed', lambda: False)
    db = MagicMock()
    assert scheduler._send_message(db, 'company', '525500000001', 'test', 'job') == 'deferred_hours'
    assert not db.mock_calls


@pytest.mark.parametrize('error,outcome', [
    (whatsapp_wwebjs.LineBusy(), 'deferred_busy'),
    (whatsapp_wwebjs.SendWindowClosed(), 'deferred_hours'),
])
def test_deferred_send_returns_both_capacity_reservations_without_failure_log(error, outcome):
    db = MagicMock()
    with (patch.object(scheduler, 'reserve_daily_slot', return_value=(True, True)),
          patch.object(scheduler, 'reserve_new_contact_slot', return_value=(True, True)),
          patch.object(scheduler, 'get_instance_cap', return_value=20),
          patch.object(scheduler, '_verify_wa_number', side_effect=error),
          patch.object(scheduler, 'release_daily_slot') as release_daily,
          patch.object(scheduler, 'release_new_contact_slot') as release_new):
        assert scheduler._send_via_wwebjs(db, 'company', '525500000001', 'test', 'job', session='qa') == outcome
    release_daily.assert_called_once()
    release_new.assert_called_once()
    db.insert_message_log.assert_not_called()


@pytest.mark.parametrize('reason', ['deferred_busy', 'deferred_hours'])
def test_immediate_campaign_item_stays_pending_when_activity_is_deferred(reason):
    db = MagicMock()
    item = {'_id': ObjectId(), 'company_id': 'company', 'to_number': '525500000001', 'message': 'test'}
    with (patch.object(send_now_worker, '_check_send_allowed', return_value=(True, None)),
          patch.object(send_now_worker, '_user_has_connected_instance', return_value=True),
          patch.object(send_now_worker, '_set_state') as state,
          patch.object(scheduler, '_send_message', return_value=reason)):
        result = send_now_worker._process_item(db, 'user', item, 0, 4)
    assert result == ('activity_paused', 0, 4)
    assert db.db.send_queue_items.update_one.call_args.args[1]['$set']['status'] == 'pending'
    assert state.call_args.kwargs['wait_reason'] == reason
    db.db.app_notifications.insert_one.assert_not_called()


def test_scheduled_campaign_resumes_without_resending_completed_recipients():
    job_id = ObjectId()
    job = {'_id': job_id, 'messages': ['test'], 'selected_numbers': [
        {'company_id': '', 'number': '525500000001', 'company_name': 'A'},
        {'company_id': '', 'number': '525500000002', 'company_name': 'B'},
    ]}
    db = MagicMock()
    db.db.scheduled_sends.find_one.side_effect = lambda *args, **kwargs: dict(job)

    def update(query, change):
        job.update(change.get('$set', {}))
        for key, value in change.get('$addToSet', {}).items():
            job.setdefault(key, [])
            if value not in job[key]:
                job[key].append(value)
        return MagicMock(modified_count=1)

    db.db.scheduled_sends.update_one.side_effect = update
    with (patch('app.database.MongoDBManager', return_value=db),
          patch.object(scheduler, '_any_instance_connected', return_value=True),
          patch.object(scheduler, 'send_block_reason', return_value=None),
          patch.object(scheduler.time, 'sleep'),
          patch.object(scheduler, '_send_message', side_effect=[True, 'deferred_busy']) as send):
        scheduler._execute_send_job(str(job_id))
        assert send.call_count == 2
    assert job['status'] == 'pending'
    assert job['sent_count'] == 1
    assert job['activity_completed'] == [':525500000001']
    db.db.app_notifications.insert_one.assert_not_called()
    with (patch('app.database.MongoDBManager', return_value=db),
          patch.object(scheduler, '_any_instance_connected', return_value=True),
          patch.object(scheduler, 'send_block_reason', return_value=None),
          patch.object(scheduler.time, 'sleep'),
          patch.object(scheduler, '_send_message', return_value=True) as send):
        scheduler._execute_send_job(str(job_id))
    assert [c.args[2] for c in send.call_args_list] == ['525500000002']
    assert job['sent_count'] == 2
    assert job['status'] == 'done'


def test_warmup_window_cannot_extend_beyond_global_rest_hours():
    from app.warmup_queue import _load_config
    db = MagicMock()
    db.db.warmup_config.find_one.return_value = {'business_hour_start': 6, 'business_hour_end': 23}
    config = _load_config(db)
    assert (config['hour_start'], config['hour_end']) == (8, 19)


def test_phone_lookup_forwards_its_stricter_closing_deadline():
    response = MagicMock(status_code=200, ok=True)
    response.json.return_value = {'registered': True}
    with patch.object(whatsapp_wwebjs._req, 'post', return_value=response) as post:
        whatsapp_wwebjs.verify_number('qa', '525500000001', send_before='2026-10-16T00:00:00Z')
    assert post.call_args.kwargs['json']['sendBefore'] == '2026-10-16T00:00:00Z'
