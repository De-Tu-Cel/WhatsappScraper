"""Safety regressions: all persistence is in memory and all sends are mocked."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from threading import RLock
from concurrent.futures import ThreadPoolExecutor

import pytest
from pymongo.errors import DuplicateKeyError
from requests.exceptions import ReadTimeout

from app.contact_permissions import (recipient_key, requests_opt_out, record_consent,
    record_inbound_permission, permission_block_reason)
from app.delivery_receipts import dispatch_once, DeliveryUncertain
from app import daily_cap, scheduler, send_now_worker


def expr(value, doc):
    if isinstance(value, str) and value.startswith('$'):
        return doc.get(value[1:])
    if not isinstance(value, dict):
        return value
    if '$ifNull' in value:
        a, b = value['$ifNull']
        found = expr(a, doc)
        return found if found is not None else b
    if '$size' in value:
        return len(expr(value['$size'], doc))
    if '$add' in value:
        return sum(expr(v, doc) for v in value['$add'])
    a, b = value['$lt']
    return expr(a, doc) < expr(b, doc)


def matches(doc, query):
    for key, wanted in query.items():
        actual = doc.get(key)
        if key == '$or':
            if not any(matches(doc, q) for q in wanted):
                return False
        elif key == '$expr':
            if not expr(wanted, doc):
                return False
        elif isinstance(wanted, dict):
            for op, v in wanted.items():
                if op == '$in' and actual not in v: return False
                if op == '$gte' and (actual is None or actual < v): return False
                if op == '$lt' and (actual is None or actual >= v): return False
        elif actual != wanted and not (isinstance(actual, list) and wanted in actual):
            return False
    return True


class Collection:
    def __init__(self):
        self.rows = []
        self.lock = RLock()

    def find(self, query, *args, **kwargs):
        with self.lock:
            return [deepcopy(r) for r in self.rows if matches(r, query)]

    def find_one(self, query, *args, **kwargs):
        return next(iter(self.find(query)), None)

    def insert_one(self, doc):
        with self.lock:
            if self.find_one({'_id': doc['_id']}):
                raise DuplicateKeyError('duplicate')
            self.rows.append(deepcopy(doc))
        return SimpleNamespace(inserted_id=doc['_id'])

    def update_one(self, query, update, upsert=False):
        with self.lock:
            found = next((r for r in self.rows if matches(r, query)), None)
            inserted = found is None
            if inserted:
                if not upsert:
                    return SimpleNamespace(upserted_id=None, modified_count=0)
                found = {k: v for k, v in query.items() if not k.startswith('$') and not isinstance(v, dict)}
                if self.find_one({'_id': found.get('_id')}) and '_id' in found:
                    raise DuplicateKeyError('duplicate')
                self.rows.append(found)
            if inserted: found.update(deepcopy(update.get('$setOnInsert', {})))
            found.update(deepcopy(update.get('$set', {})))
            for k, v in update.get('$max', {}).items():
                found[k] = max(found.get(k, v), v)
            for k, v in update.get('$push', {}).items():
                found.setdefault(k, []).append(deepcopy(v))
            for k, v in update.get('$addToSet', {}).items():
                for item in v.get('$each', []) if isinstance(v, dict) else [v]:
                    if item not in found.setdefault(k, []): found[k].append(item)
            for k, v in update.get('$pull', {}).items():
                found[k] = [x for x in found.get(k, []) if x != v]
            return SimpleNamespace(upserted_id=found.get('_id') if inserted else None, modified_count=1)

    def find_one_and_update(self, query, update, **kwargs):
        with self.lock:
            before = self.find_one(query)
            if before is not None:
                self.update_one(query, update)
            return before

    def delete_one(self, query):
        with self.lock:
            self.rows = [r for r in self.rows if not matches(r, query)]


@pytest.fixture
def db():
    names = ['contact_permissions', 'delivery_receipts', 'send_queue_items', 'message_logs',
             'instance_new_contacts_today', 'instances', 'send_queue_state', 'send_queue_requests']
    return SimpleNamespace(db=SimpleNamespace(**{n: Collection() for n in names}))


@pytest.mark.parametrize('text', ['STOP', 'Baja', 'No me escriban, por favor', 'Elimina mi número',
                                  'Deja de contactarme', 'unsubscribe'])
def test_clear_opt_out_requests(text):
    assert requests_opt_out(text)


@pytest.mark.parametrize('text', ['Baja California', '¿Pueden dar de baja mi servicio?', 'No me queda claro', 'Hola'])
def test_unrelated_text_is_not_opt_out(text):
    assert not requests_opt_out(text)


def test_first_contact_is_allowed_and_only_an_opt_out_blocks(db):
    """Decisión 2026-10-19: a un prospecto se le puede escribir por primera vez
    sin consentimiento registrado; lo único que bloquea (aparte de la
    blacklist) es que la persona haya pedido la baja."""
    number = '525500000001'
    assert permission_block_reason(db, number) is None
    record_inbound_permission(db, number, 'Hola')
    assert permission_block_reason(db, number) is None
    record_inbound_permission(db, number, 'No me escribas')
    # Un mensaje posterior sin relación no deshace la baja.
    record_inbound_permission(db, number, 'Hola otra vez')
    assert permission_block_reason(db, number)['reason'] == 'opt_out'
    assert permission_block_reason(db, '+52 1 5500000001', purpose='reply')['reason'] == 'opt_out'
    # Un consentimiento registrado explícitamente sí reactiva el contacto.
    record_consent(db, number, source='form', evidence='Formulario firmado 1234', actor='admin')
    assert permission_block_reason(db, '+52 1 5500000001') is None
    assert db.db.contact_permissions.rows[0]['consent']['actor'] == 'admin'


def test_an_old_reply_window_never_blocks_a_new_contact(db):
    now = datetime.now(timezone.utc)
    record_inbound_permission(db, '525500000001', 'Hola', now - timedelta(days=2))
    assert permission_block_reason(db, '525500000001') is None
    assert permission_block_reason(db, '525500000001', purpose='reply') is None


def test_permission_cannot_be_granted_without_a_source_and_evidence(db):
    with pytest.raises(ValueError):
        record_consent(db, '525500000001', source='scraped', evidence='Public website', actor='admin')
    assert not db.db.contact_permissions.rows


def test_uncertain_attempt_is_never_repeated(db):
    send = MagicMock(side_effect=ReadTimeout('unknown'))
    for _ in range(2):
        with pytest.raises(DeliveryUncertain): dispatch_once(db, 'attempt', send)
    send.assert_called_once()
    assert db.db.delivery_receipts.rows[0]['status'] == 'uncertain'


def test_missing_provider_outcome_is_uncertain(db):
    with pytest.raises(DeliveryUncertain):
        dispatch_once(db, 'unknown-response', lambda: {})


def test_confirmed_receipt_is_reused(db):
    send = MagicMock(return_value={'success': True, 'messageId': 'confirmed'})
    assert dispatch_once(db, 'attempt', send) == dispatch_once(db, 'attempt', send)
    send.assert_called_once()


def test_repeated_request_cannot_change_content(db):
    send = MagicMock(return_value={'success': True})
    dispatch_once(db, 'attempt', send, fingerprint='original')
    with pytest.raises(DeliveryUncertain):
        dispatch_once(db, 'attempt', send, fingerprint='changed')
    send.assert_called_once()


def test_concurrent_dispatch_claims_do_not_send_twice(db):
    from threading import Event
    started, release = Event(), Event()
    def send():
        started.set()
        assert release.wait(2)
        return {'success': True}
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(dispatch_once, db, 'attempt', send)
        assert started.wait(2)
        try:
            with pytest.raises(DeliveryUncertain):
                dispatch_once(db, 'attempt', MagicMock())
        finally:
            release.set()
        assert first.result()['success']


def test_confirmed_delivery_survives_receipt_update_failure(db):
    db.db.delivery_receipts.update_one = MagicMock(side_effect=RuntimeError('disk'))
    send = MagicMock(return_value={'success': True, 'messageId': 'confirmed'})
    assert dispatch_once(db, 'attempt', send)['success']
    with pytest.raises(DeliveryUncertain): dispatch_once(db, 'attempt', send)
    send.assert_called_once()


def test_known_unsent_can_be_retried(db):
    from app.whatsapp_wwebjs import LineBusy
    send = MagicMock(side_effect=[LineBusy('busy'), {'success': True}])
    with pytest.raises(LineBusy): dispatch_once(db, 'attempt', send)
    assert dispatch_once(db, 'attempt', send)['success']


def test_queue_normalizes_duplicates_and_repeat_request(db):
    jobs = [{'numbers': ['525500000001', '+52 1 5500000001', '525500000002'], 'messages': ['QA']}]
    assert send_now_worker.enqueue_send_items(db, jobs, 'same-request', '', {}) == 2
    assert send_now_worker.enqueue_send_items(db, jobs, 'same-request', '', {}) == 0
    assert len(db.db.send_queue_items.rows) == 2


def test_queue_endpoint_replay_and_conflicting_payload(db):
    from app.api import routes
    from fastapi import HTTPException
    body = {'request_id': 'stable-request', 'jobs': [{'numbers': ['525500000001'], 'messages': ['QA']}]}
    with (patch.object(routes, '_require_user', return_value={'id': 'qa'}),
          patch.object(routes, 'MongoDBManager', return_value=db)):
        first = routes.api_enqueue_send(body, 'token')
        again = routes.api_enqueue_send(body, 'token')
        assert first['batch_id'] == again['batch_id']
        assert first['queued'] == 1 and again['queued'] == 0
        changed = {**body, 'jobs': [{'numbers': ['525500000002'], 'messages': ['QA']}]}
        with pytest.raises(HTTPException) as error:
            routes.api_enqueue_send(changed, 'token')
        assert error.value.status_code == 409


def test_sending_without_an_operation_id_is_rejected_before_dispatch(db):
    from app.api import routes
    from app.schemas.company import SendMessageRequest
    from fastapi import HTTPException
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SendMessageRequest(company_id='', to_number='525500000001', message='QA')
    with patch.object(routes, '_require_user', return_value={'id': 'qa'}):
        with pytest.raises(HTTPException) as error:
            routes.api_enqueue_send({'jobs': [{'numbers': ['525500000001']}]}, 'token')
        assert error.value.status_code == 400


def test_only_admin_can_record_permission_and_unauthorized_send_stops_early():
    from app.api import routes
    from app.schemas.company import SendMessageRequest
    from fastapi import HTTPException
    with patch.object(routes, '_require_user', return_value={'id': 'agent', 'role': 'agent'}):
        with pytest.raises(HTTPException) as error:
            routes.api_record_contact_consent({'number': '525500000001'}, 'token')
        assert error.value.status_code == 403
    # Ya no se exige consentimiento para el primer contacto (2026-10-19): lo que
    # debe frenar el envío antes de tocar al proveedor es una baja del destinatario.
    db = MagicMock()
    db.db.blacklist.find_one.return_value = None
    db.db.contact_permissions.find_one.return_value = {'revoked': True}
    with (patch.object(routes, '_require_user', return_value={'id': 'qa'}),
          patch('app.database.MongoDBManager', return_value=db),
          patch('app.config.EVOLUTION_API_KEY', 'mock'),
          patch('app.whatsapp_wwebjs.WWebjsClient') as client):
        req = SendMessageRequest(request_id='qa', company_id='', to_number='525500000001', message='QA')
        with pytest.raises(HTTPException) as error:
            routes.api_send_message(req, 'token')
        assert error.value.status_code == 403
        assert 'no recibir mensajes' in error.value.detail
        client.assert_not_called()


def test_uncertain_item_is_terminal_even_after_disconnect():
    db = MagicMock()
    item = {'_id': 'item', 'user_id': 'qa', 'to_number': '525500000001', 'message': 'QA'}
    db.db.send_queue_items.count_documents.return_value = 0
    with (patch.object(send_now_worker, '_check_send_allowed', return_value=(True, '')),
          patch.object(send_now_worker, '_user_has_connected_instance', return_value=True),
          patch.object(send_now_worker, '_set_state'),
          patch.object(send_now_worker, '_maybe_finish_batch'),
          patch.object(scheduler, '_send_message', return_value='delivery_uncertain')):
        send_now_worker._process_item(db, 'qa', item, 0, 3)
    assert db.db.send_queue_items.update_one.call_args.args[1]['$set']['status'] == 'needs_review'


def test_two_numbers_of_same_company_cost_two_slots_but_alias_costs_one(db):
    db.db.instances.insert_one({'_id': 'line', 'name': 'qa', 'warmup_mode': True})
    assert daily_cap.reserve_new_contact_slot(db, 'qa', 'company', '525500000001') == (True, True)
    assert daily_cap.reserve_new_contact_slot(db, 'qa', 'company', '+52 1 5500000001') == (True, False)
    assert daily_cap.reserve_new_contact_slot(db, 'qa', 'company', '525500000002') == (True, True)
    assert daily_cap.count_new_contacts_today_for_instance(db, 'qa') == 2


def test_new_contact_cap_is_atomic_under_parallel_reservations(db):
    db.db.instances.insert_one({'_id': 'line', 'name': 'qa', 'warmup_mode': True})
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda i: daily_cap.reserve_new_contact_slot(db, 'qa', 'company', f'52550000{i:04d}'), range(12)))
    assert sum(allowed for allowed, new in results) == 5
    assert daily_cap.count_new_contacts_today_for_instance(db, 'qa') == 5


def test_failed_attempt_does_not_make_number_an_existing_contact(db):
    db.db.message_logs.insert_one({'_id': 'failed', 'direction': 'outbound', 'status': 'failed',
                                  'company_id': 'company', 'to_number': '525500000001'})
    assert daily_cap.is_new_contact(db, 'company', '525500000001')
    db.db.message_logs.insert_one({'_id': 'sent', 'direction': 'outbound', 'status': 'sent',
                                  'company_id': 'company', 'to_number': '525500000001'})
    assert not daily_cap.is_new_contact(db, 'company', '+5215500000001')
    assert daily_cap.is_new_contact(db, 'company', '525500000002')


def test_ia_must_disclose_identity_and_must_fail_closed():
    from app import ai_followup as ai
    assert 'automatizado' in ai._identity_disclosure('¿Eres un bot?', 'Soy una persona real')
    assert ai._identity_disclosure('Hola', 'Soy un asistente automatizado') is None
    with patch('app.send_guard.send_block_reason', side_effect=RuntimeError('database unavailable')):
        assert ai._is_blocked_or_blacklisted(MagicMock(), '', '525500000001')


def test_nested_domain_lookup_failure_cannot_authorize_a_send():
    from app.send_guard import send_block_reason
    db = MagicMock()
    db.db.blacklist.find_one.return_value = None
    db.db.companies.find_one.return_value = {'domain': 'example.test'}
    db.db.blacklist.find.side_effect = RuntimeError('blacklist unavailable')
    db.db.contact_permissions.find_one.return_value = {'outreach_allowed': True}
    with pytest.raises(RuntimeError, match='blacklist unavailable'):
        send_block_reason(db, '0123456789abcdef01234567', '525500000001')


@pytest.mark.parametrize('uncertain', [False, True])
def test_scheduler_preserves_confirmed_delivery_and_uncertain_quota(uncertain):
    db = MagicMock()
    db.db.blacklist.find_one.return_value = None
    db.db.contact_permissions.find_one.return_value = {'outreach_allowed': True, 'revoked': False}
    db.insert_message_log.side_effect = RuntimeError('log unavailable')
    client = MagicMock()
    client.send.return_value = {'success': True, 'messageId': 'confirmed'}
    if uncertain: client.send.side_effect = ReadTimeout('unknown')
    with (patch('app.whatsapp_wwebjs.WWebjsClient', return_value=client),
          patch.object(scheduler, 'reserve_daily_slot', return_value=(True, True)),
          patch.object(scheduler, 'reserve_new_contact_slot', return_value=(True, True)),
          patch.object(scheduler, 'get_instance_cap', return_value=20),
          patch.object(scheduler, '_verify_wa_number', return_value=True),
          patch.object(scheduler, '_stamp_assigned_instance'),
          patch.object(scheduler, 'release_daily_slot') as daily,
          patch.object(scheduler, 'release_new_contact_slot') as new):
        result = scheduler._send_via_wwebjs(db, '', '525500000001', 'QA', 'job', session='qa')
    assert result == ('delivery_uncertain' if uncertain else True)
    daily.assert_not_called()
    new.assert_not_called()


@pytest.mark.parametrize('uncertain', [False, True])
def test_manual_send_preserves_delivery_result_on_bookkeeping_failure(uncertain):
    from app.api import routes
    from app.schemas.company import SendMessageRequest
    from fastapi import HTTPException
    db = MagicMock()
    db.db.instances.find_one.return_value = {'name': 'qa-line', 'provider': 'wwebjs', 'number': '525500000099'}
    db.insert_message_log.side_effect = RuntimeError('log storage unavailable')
    client = MagicMock()
    client.send.return_value = {'success': True, 'messageId': 'confirmed'}
    if uncertain: client.send.side_effect = ReadTimeout('unknown')
    response = MagicMock(ok=True)
    response.json.return_value = {'status': 'connected'}
    req = SendMessageRequest(request_id='qa-manual', company_id='', to_number='525500000001',
                             message='QA', instance='qa-line')
    with (patch.object(routes, '_require_user', return_value={'id': 'qa'}),
          patch('app.auth.get_user_by_token', return_value={'id': 'qa'}),
          patch('app.database.MongoDBManager', return_value=db),
          patch('app.config.EVOLUTION_API_KEY', 'mock'),
          patch('app.send_guard.send_block_reason', return_value=None),
          patch('requests.get', return_value=response),
          patch('app.daily_cap.reserve_daily_slot', return_value=(True, True)),
          patch('app.daily_cap.reserve_new_contact_slot', return_value=(True, True)),
          patch('app.daily_cap.release_daily_slot') as daily,
          patch('app.daily_cap.release_new_contact_slot') as new,
          patch('app.whatsapp_wwebjs.WWebjsClient', return_value=client)):
        if uncertain:
            with pytest.raises(HTTPException) as error:
                routes.api_send_message(req, 'token')
            assert error.value.status_code == 409
        else:
            result = routes.api_send_message(req, 'token')
            assert result['status'] == 'sent'
            assert result['message_id'] == 'confirmed'
        daily.assert_not_called()
        new.assert_not_called()
