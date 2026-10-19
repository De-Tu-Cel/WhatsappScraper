from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, MagicMock

import pytest
from fastapi import HTTPException

from app import verification_audit as audit
from app import phone_verification as worker
from app import daily_cap
from app.whatsapp_wwebjs import LineBusy, SendWindowClosed, VerificationLookupError
from test_phone_verification import db, Collection


@pytest.mark.parametrize('registered', [True, False])
def test_durable_history_tracks_confirmed_lookup_and_contact_without_raw_phone(db, registered):
    def lookup(instance, phone, **kwargs):
        row = db.db.phone_verification_attempts.docs[0]
        assert row['status'] == 'dispatching' and row['finished_at'] is None
        assert row['lookup_started'] is None
        assert kwargs['request_id'] == row['_id']
        return {'registered': registered, 'verification': {
            'lookup_started': True, 'request_id': kwargs['request_id'], 'client_calls': 2,
            'started_at': '2026-10-16T15:20:00Z', 'finished_at': '2026-10-16T15:20:01Z',
            'error': 'secret phone +525512345678',
        }}
    result = audit.verify_with_audit(db, 'wa-a', '+525512345678', source='automatic',
                                     contact_id='contact-a', company_id='company-a', lookup=lookup, cap_reserved=True)
    row = db.db.phone_verification_attempts.docs[0]
    assert result['registered'] is registered
    assert row['status'] == ('registered' if registered else 'not_registered')
    assert row['lookup_started'] is True and row['cap_reserved'] is True
    assert row['contact_id'] == 'contact-a' and row['instance_name'] == 'wa-a'
    assert row['duration_ms'] >= 0 and row['finished_at'] >= row['started_at']
    assert '+525512345678' not in str(row) and 'secret' not in str(row)


@pytest.mark.parametrize('exception, expected', [
    (LineBusy(), False), (SendWindowClosed(), False),
    (TimeoutError('phone +525512345678 secret'), None),
    (VerificationLookupError(400, {'lookup_started': False}), False),
    (VerificationLookupError(500, {'lookup_started': True}), True),
])
def test_failures_distinguish_rejection_confirmed_start_and_unknown(db, exception, expected):
    with pytest.raises(type(exception)):
        audit.verify_with_audit(db, 'wa-a', '+525512345678', source='manual_single', lookup=Mock(side_effect=exception))
    row = db.db.phone_verification_attempts.docs[0]
    assert row['lookup_started'] is expected and row['finished_at'] is not None
    assert row['status'] == ('deferred' if isinstance(exception, (LineBusy, SendWindowClosed)) else 'error')
    assert 'secret' not in str(row) and '+525512345678' not in str(row)


@pytest.mark.parametrize('response', [{}, {'registered': True}])
def test_old_service_is_not_mistaken_for_confirmation_of_started_lookup(db, response):
    audit.verify_with_audit(db, 'wa-a', 'private-phone', source='scheduled_send', lookup=Mock(return_value=response))
    assert db.db.phone_verification_attempts.docs[0]['lookup_started'] is None


def test_missing_durable_storage_prevents_whatsapp_call(db):
    db.db.phone_verification_attempts.insert_one = Mock(side_effect=RuntimeError('database unavailable'))
    lookup = Mock()
    with pytest.raises(RuntimeError):
        audit.verify_with_audit(db, 'wa-a', 'private-phone', source='automatic', lookup=lookup)
    lookup.assert_not_called()


def test_completion_storage_failure_leaves_uncertain_attempt_not_false_success(db):
    collection = db.db.phone_verification_attempts
    original = collection.update_one
    def update(query, changes, **kwargs):
        if changes['$set'].get('finished_at'):
            raise RuntimeError('failed final write')
        return original(query, changes, **kwargs)
    collection.update_one = update
    with pytest.raises(RuntimeError):
        audit.verify_with_audit(db, 'wa-a', 'private-phone', source='automatic', lookup=Mock(return_value={'registered': True}))
    assert collection.docs[0]['status'] == 'dispatching'
    assert collection.docs[0]['lookup_started'] is None
    assert collection.docs[0]['finished_at'] is None


def test_cap_rejection_is_audited_without_lookup_and_rotation_continues(db, monkeypatch):
    monkeypatch.setattr(worker, 'get_all_connected_instances', lambda db: ['wa-a', 'wa-b'])
    monkeypatch.setattr(worker, 'reserve_verification_slot', lambda db, name: name == 'wa-b')
    assert worker.process_next(db, source='admin_queue')['checked'] == 1
    rejected, accepted = db.db.phone_verification_attempts.docs
    assert rejected['status'] == 'daily_cap_rejected' and rejected['lookup_started'] is False
    assert accepted['instance_name'] == 'wa-b' and accepted['source'] == 'admin_queue'
    assert worker.verify_number.call_count == 1
    contact = next(d for d in db.db.contacts.docs if d.get('wa_checked_at'))
    assert contact['wa_checked_by'] == 'wa-b' and contact['wa_check_source'] == 'admin_queue'


def test_service_rejected_lookup_refunds_reservation_and_records_release(db, monkeypatch):
    monkeypatch.setattr(daily_cap, '_today', lambda: '2026-10-16')
    db.db.instance_daily_verifications = Collection([{'_id': 'counter', 'instance': 'qa-connected', 'date': '2026-10-16', 'count': 1}])
    monkeypatch.setattr(worker, 'verify_number', Mock(side_effect=VerificationLookupError(400, {'lookup_started': False})))
    assert worker.process_next(db)['pending'] == 1
    assert db.db.instance_daily_verifications.docs[0]['count'] == 0
    attempt = db.db.phone_verification_attempts.docs[0]
    assert attempt['lookup_started'] is False and attempt['cap_released'] is True


@pytest.mark.parametrize('initial', [0, 2, 3, 8])
def test_cap_rejections_never_increment_and_preserve_historical_counts(monkeypatch, initial):
    monkeypatch.setattr(daily_cap, 'VERIFY_DAILY_CAP', 3)
    monkeypatch.setattr(daily_cap, '_today', lambda: '2026-10-16')
    collection = Collection([{'_id': 'legacy', 'instance': 'wa-a', 'date': '2026-10-16', 'count': initial}])
    db = SimpleNamespace(db=SimpleNamespace(instance_daily_verifications=collection))
    accepted = sum(daily_cap.reserve_verification_slot(db, 'wa-a') for _ in range(12))
    assert accepted == max(0, 3 - initial)
    assert collection.docs[0]['count'] == max(initial, 3)
    assert len(collection.docs) == 1


def test_concurrent_counter_creation_and_last_slot_have_one_owner(monkeypatch):
    monkeypatch.setattr(daily_cap, 'VERIFY_DAILY_CAP', 3)
    monkeypatch.setattr(daily_cap, '_today', lambda: '2026-10-16')
    collection = Collection()
    db = SimpleNamespace(db=SimpleNamespace(instance_daily_verifications=collection))
    with ThreadPoolExecutor(max_workers=12) as pool:
        accepted = list(pool.map(lambda _: daily_cap.reserve_verification_slot(db, 'wa-a'), range(50)))
    assert sum(accepted) == 3
    assert len(collection.docs) == 1 and collection.docs[0]['count'] == 3


def test_counter_separates_lines_and_days_without_erasing_previous_usage(monkeypatch):
    monkeypatch.setattr(daily_cap, 'VERIFY_DAILY_CAP', 1)
    day = ['2026-10-16']
    monkeypatch.setattr(daily_cap, '_today', lambda: day[0])
    collection = Collection()
    db = SimpleNamespace(db=SimpleNamespace(instance_daily_verifications=collection))
    assert daily_cap.reserve_verification_slot(db, 'wa-a') is True
    assert daily_cap.reserve_verification_slot(db, 'wa-a') is False
    assert daily_cap.reserve_verification_slot(db, 'wa-b') is True
    day[0] = '2026-10-17'
    assert daily_cap.reserve_verification_slot(db, 'wa-a') is True
    assert len(collection.docs) == 3 and all(d['count'] == 1 for d in collection.docs)


def test_http_contract_correlates_request_and_preserves_service_acknowledgement(monkeypatch):
    from app import whatsapp_wwebjs
    response = Mock(ok=True, status_code=200)
    response.json.return_value = {'registered': True, 'verification': {'lookup_started': True, 'request_id': 'a' * 32}}
    post = Mock(return_value=response);monkeypatch.setattr(whatsapp_wwebjs._req, 'post', post)
    result = whatsapp_wwebjs.verify_number('wa-a', 'private-phone', send_before='2026-10-16T23:00:00Z', request_id='a' * 32)
    assert post.call_args.kwargs['json']['requestId'] == 'a' * 32
    assert post.call_args.kwargs['json']['sendBefore'] == '2026-10-16T23:00:00Z'
    assert result['verification']['lookup_started'] is True


@pytest.mark.parametrize('code, metadata', [(400, {'lookup_started': False}), (500, {'lookup_started': True})])
def test_http_failure_preserves_start_evidence_without_echoing_service_error(monkeypatch, code, metadata):
    from app import whatsapp_wwebjs
    response = Mock(ok=False, status_code=code)
    response.json.return_value = {'error': 'private-phone secret', 'verification': metadata}
    monkeypatch.setattr(whatsapp_wwebjs._req, 'post', Mock(return_value=response))
    with pytest.raises(VerificationLookupError) as error:
        whatsapp_wwebjs.verify_number('wa-a', 'private-phone')
    assert error.value.verification == metadata
    assert 'private-phone' not in str(error.value)


def test_scheduler_uncached_lookup_is_audited_with_origin(db, monkeypatch):
    from app import scheduler, whatsapp_wwebjs
    db.db.jid_map.find_one = Mock(return_value=None)
    monkeypatch.setattr(whatsapp_wwebjs, 'verify_number', Mock(return_value={'registered': True}))
    assert scheduler._verify_wa_number(db, '525500000001', 'wa-a') is True
    assert db.db.phone_verification_attempts.docs[0]['source'] == 'scheduled_send'


def test_manual_single_lookup_is_audited(db, monkeypatch):
    monkeypatch.setattr('app.api.routes._require_session_access', lambda *args: {'role': 'admin'})
    from app.api import routes
    from app import whatsapp_wwebjs
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: db)
    monkeypatch.setattr(whatsapp_wwebjs, 'verify_number', Mock(return_value={'registered': False}))
    assert routes.api_wwebjs_verify('wa-a', {'phone': '525500000001'})['registered'] is False
    assert db.db.phone_verification_attempts.docs[0]['source'] == 'manual_single'


def test_admin_history_is_read_only_filtered_and_serializes_timezone(monkeypatch):
    from app.api import routes
    collection = MagicMock()
    ts = datetime(2026, 10, 16, 15, 30, tzinfo=timezone.utc)
    collection.find.return_value.sort.return_value.skip.return_value.limit.return_value = [{'_id': 'attempt', 'started_at': ts}]
    collection.count_documents.return_value = 1
    auth = Mock(); monkeypatch.setattr(routes, '_require_admin', auth)
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: SimpleNamespace(db=SimpleNamespace(phone_verification_attempts=collection)))
    response = routes.api_phone_verification_history('tania-sesion-3', ts, ts + timedelta(hours=1), 25, 0, 'token')
    auth.assert_called_once_with('token')
    assert collection.find.call_args.args[0]['instance_name'] == 'tania-sesion-3'
    assert collection.find.call_args.args[0]['started_at']['$gte'] == ts
    assert response['items'][0]['started_at'].endswith('+00:00')
    assert response['total'] == 1
    collection.update_one.assert_not_called();collection.insert_one.assert_not_called()


def test_history_requires_admin_before_database_access(monkeypatch):
    from app.api import routes
    monkeypatch.setattr(routes, '_require_admin', Mock(side_effect=HTTPException(403)))
    connect = Mock(); monkeypatch.setattr(routes, 'MongoDBManager', connect)
    with pytest.raises(HTTPException):
        routes.api_phone_verification_history(x_user_token='agent')
    connect.assert_not_called()


@pytest.mark.parametrize('kwargs', [dict(limit=0), dict(limit=201), dict(offset=-1),
    dict(since=datetime(2026, 10, 16)), dict(since=datetime(2030, 1, 1, tzinfo=timezone.utc)),
    dict(since=datetime(2000, 1, 1, tzinfo=timezone.utc))])
def test_history_rejects_invalid_unbounded_or_ambiguous_ranges(monkeypatch, kwargs):
    from app.api import routes
    monkeypatch.setattr(routes, '_require_admin', lambda token: None)
    connect = Mock(); monkeypatch.setattr(routes, 'MongoDBManager', connect)
    with pytest.raises(HTTPException) as exc:
        routes.api_phone_verification_history(x_user_token='admin', **kwargs)
    assert exc.value.status_code == 422
    connect.assert_not_called()
