from unittest.mock import MagicMock, patch
import pytest
import requests
from app import proxies as px


def response(data):
    r = MagicMock()
    r.json.return_value = data
    return r


def db_fixture():
    db = MagicMock()
    inst = {'_id': 'instance', 'name': 'dummy', 'provider': 'wwebjs', 'proxy_id': 'a' * 24}
    db.instances.find_one.return_value = inst
    db.instances.find_one_and_update.return_value = inst
    return db, inst


@pytest.mark.parametrize('scheme', ['socks5', 'socks4', 'https'])
def test_unsupported_protocol_is_rejected_instead_of_silently_converting_to_http(scheme):
    with pytest.raises(ValueError):
        px.parse_proxy_text(f'{scheme}://dummy:dummy@127.0.0.1:8080')


def test_import_reports_unsupported_protocol_before_any_database_or_service_call():
    from app.api import routes
    from fastapi import HTTPException
    with patch.object(routes, '_require_admin'), patch.object(routes, 'MongoDBManager') as db:
        with pytest.raises(HTTPException) as error:
            routes.api_proxies_import({'text': 'socks5://dummy:dummy@proxy.invalid:8080'}, 'mock')
        assert error.value.status_code == 400
        db.assert_not_called()


def test_fallback_confirms_egress_when_primary_ip_service_is_down():
    with patch.object(px.requests, 'get', side_effect=[requests.Timeout(), response({'ip': '1.2.3.4'})]) as get:
        result = px.check_proxy({'host': 'proxy.invalid', 'port': 80, 'username': 'dummy', 'password': 'dummy',
                                 'exit_ip': '1.2.3.4', 'country': 'MX'})
    assert result['ok'] and result['country'] == 'MX'
    assert result['geo_verified'] is False
    assert get.call_count == 2
    assert all(call.kwargs['proxies']['https'].startswith('http://') for call in get.call_args_list)


def test_changed_fallback_ip_does_not_inherit_the_previous_country():
    with patch.object(px.requests, 'get', side_effect=[requests.Timeout(), response({'ip': '5.6.7.8'})]):
        result = px.check_proxy({'host': 'proxy.invalid', 'port': 80, 'exit_ip': '1.2.3.4', 'country': 'MX'})
    assert result['ok'] and result['country'] is None


def test_ip_change_is_recorded_without_restarting_a_session():
    db = MagicMock()
    px.record_check(db, {'_id': 'proxy', 'exit_ip': '1.2.3.4'},
                    {'ok': True, 'ip': '5.6.7.8', 'country': 'MX', 'city': None, 'geo_verified': True})
    update = db.proxies.update_one.call_args.args[1]
    assert update['$inc']['exit_ip_change_count'] == 1
    assert update['$push']['exit_ip_history']['$slice'] == -30
    db.instances.update_one.assert_not_called()


def test_failed_assignment_keeps_previous_proxy_and_marks_result_unknown():
    db, inst = db_fixture()
    with (patch.object(px, '_proxy_doc', return_value={'host': 'proxy.invalid', 'port': 80, 'status': 'ok'}),
          patch.object(px, '_push_payload', side_effect=requests.Timeout())):
        with pytest.raises(requests.Timeout):
            px.assign(db, 'dummy', 'b' * 24)
    updates = [call.args[1] for call in db.instances.update_one.call_args_list]
    assert not any('proxy_id' in u.get('$set', {}) for u in updates)
    assert any(u.get('$set', {}).get('proxy_sync_status') == 'unknown' for u in updates)
    assert inst['proxy_id'] == 'a' * 24


def test_assignment_commits_only_after_ack_and_distinguishes_pending_restart():
    db, _ = db_fixture()
    ack = {'success': True, 'stored': True, 'applied': False, 'pending_restart': True}
    def send(name, body):
        db.instances.update_one.assert_not_called()
        return ack
    with patch.object(px, '_proxy_doc', return_value={'host': 'proxy.invalid', 'port': 80, 'status': 'ok'}), patch.object(px, '_push_payload', side_effect=send):
        px.assign(db, 'dummy', 'b' * 24)
    fields = db.instances.update_one.call_args_list[0].args[1]['$set']
    assert fields['proxy_id'] == 'b' * 24 and fields['proxy_sync_status'] == 'pending_restart'
    assert 'proxy_applied_id' not in fields


def test_parallel_change_is_refused_before_contacting_the_service():
    db, _ = db_fixture()
    db.instances.find_one_and_update.return_value = None
    with patch.object(px, '_proxy_doc', return_value={}), patch.object(px, '_push_payload') as send:
        with pytest.raises(RuntimeError):
            px.assign(db, 'dummy', None)
        send.assert_not_called()


@pytest.mark.parametrize('candidate', [{'status': 'failing'}, {'status': 'unchecked'}, {'status': 'ok', 'enabled': False}])
def test_unhealthy_assignment_is_refused_before_touching_the_active_session(candidate):
    db, _ = db_fixture()
    with patch.object(px, '_proxy_doc', return_value=candidate), patch.object(px, '_push_payload') as send:
        with pytest.raises(ValueError):
            px.assign(db, 'dummy', 'b' * 24)
        send.assert_not_called()
        db.instances.update_one.assert_not_called()


def test_sync_does_not_restart_active_sessions_and_cannot_drop_a_missing_assigned_proxy():
    db, _ = db_fixture()
    with patch.object(px, '_proxy_doc', return_value={'host': 'proxy.invalid', 'port': 80}), patch.object(px, '_push_payload', return_value={}) as send:
        px.push_instance_settings(db, 'dummy')
        assert send.call_args.args[1]['restart'] is False
    with patch.object(px, '_proxy_doc', return_value=None), patch.object(px, '_push_payload') as send:
        with pytest.raises(RuntimeError):
            px.push_instance_settings(db, 'dummy')
        send.assert_not_called()


def test_new_instance_cannot_start_without_required_proxy_or_confirmation():
    with patch.object(px, 'get_settings', return_value={'auto_assign': True}), patch.object(px, 'pick_proxy', return_value=None):
        with pytest.raises(RuntimeError):
            px.prepare_new_instance(MagicMock(), 'dummy')
    with patch.object(px, 'get_settings', return_value={'auto_assign': True}), patch.object(px, 'pick_proxy', return_value={'_id': 'proxy', 'host': 'proxy.invalid', 'port': 80}), patch.object(px, '_push_payload', side_effect=requests.Timeout()):
        with pytest.raises(requests.Timeout):
            px.prepare_new_instance(MagicMock(), 'dummy')


def test_old_or_negative_ack_cannot_confirm_proxy_configuration():
    for ack in [{'success': True}, {'success': False, 'stored': True, 'proxy_required': True}]:
        with patch.object(px.requests, 'put', return_value=response(ack)):
            with pytest.raises(RuntimeError):
                px._push_payload('dummy', {'proxy_required': True})


def test_failed_health_check_does_not_move_connected_or_unconfirmed_sessions():
    failing = {'_id': 'proxy', 'host': 'proxy.invalid', 'port': 80, 'status': 'failing', 'fail_streak': 8}
    db = MagicMock(); db.proxies.find.return_value = [failing]
    for state in ['connected', None, 'need_scan']:
        with (patch.object(px, 'check_many', return_value=[failing]),
              patch.object(px, 'get_settings', return_value={'auto_assign': True}),
              patch.object(px, 'usage_by_proxy', return_value={'proxy': ['dummy']}),
              patch.object(px, '_live_status', return_value=state), patch.object(px, 'assign') as assign):
            px.health_round(db, [])
            assign.assert_not_called()


def test_failover_attempts_only_one_session_and_waits_for_confirmation():
    failing = {'_id': 'proxy', 'host': 'proxy.invalid', 'port': 80, 'status': 'failing', 'fail_streak': 8}
    db = MagicMock(); db.proxies.find.return_value = [failing]
    with (patch.object(px, 'check_many', return_value=[failing]),
          patch.object(px, 'get_settings', return_value={'auto_assign': True}),
          patch.object(px, 'usage_by_proxy', return_value={'proxy': ['one', 'two']}),
          patch.object(px, '_live_status', return_value='disconnected'),
          patch.object(px, '_wait_connected', return_value='error') as wait,
          patch.object(px, '_proxy_doc', return_value={}),
          patch.object(px, 'assign', return_value={'proxy_id': 'other'}) as assign):
        px.health_round(db, [])
        assert assign.call_count == 1 and wait.call_count == 1
        assert db.settings.update_one.call_args.args[1]['$set']['failover_paused']['name'] == 'one'


def test_failed_failover_stays_paused_until_review():
    failing = {'_id': 'proxy', 'host': 'proxy.invalid', 'port': 80, 'status': 'failing', 'fail_streak': 8}
    db = MagicMock(); db.proxies.find.return_value = [failing]
    with (patch.object(px, 'check_many', return_value=[failing]),
          patch.object(px, 'get_settings', return_value={'auto_assign': True, 'failover_paused': {'name': 'one'}}),
          patch.object(px, 'usage_by_proxy', return_value={'proxy': ['two']}), patch.object(px, 'assign') as assign):
        px.health_round(db, [])
        assign.assert_not_called()
