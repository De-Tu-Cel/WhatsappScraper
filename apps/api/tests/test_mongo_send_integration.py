"""Opt-in real Mongo tests. Only a dedicated loopback Mongo on port 27029 is allowed.

RUN_MONGO_SEND_TESTS=1 python -m pytest tests/test_mongo_send_integration.py
No WhatsApp client is instantiated: fake deliveries are rows in the test database.
"""
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
from multiprocessing import get_context
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pymongo import MongoClient

URI = 'mongodb://127.0.0.1:27029'
pytestmark = pytest.mark.skipif(os.getenv('RUN_MONGO_SEND_TESTS') != '1', reason='dedicated local Mongo required')


def _connection(name):
    assert name.startswith('qa_send_20261018_')
    client = MongoClient(URI, serverSelectionTimeoutMS=3000, socketTimeoutMS=5000)
    return client, SimpleNamespace(db=client[name])


def _worker(kind, name, index=0):
    client, db = _connection(name)
    try:
        if kind == 'quota':
            from app.daily_cap import reserve_new_contact_slot
            return reserve_new_contact_slot(db, 'qa-line', 'same-company', f'52550000{index:04d}')
        from app.delivery_receipts import dispatch_once, DeliveryUncertain
        def deliver():
            db.db.fake_deliveries.insert_one({'attempt': 'same-operation', 'worker': index})
            if kind == 'crash':
                os._exit(23)
            time.sleep(.15)
            return {'success': True, 'messageId': 'mock-confirmed'}
        try:
            return dispatch_once(db, 'same-operation', deliver)
        except DeliveryUncertain:
            return {'uncertain': True}
    finally:
        client.close()


@pytest.fixture
def mongo():
    name = 'qa_send_20261018_' + uuid.uuid4().hex
    client, db = _connection(name)
    client.admin.command('ping')
    yield name, db
    # Retain these small isolated databases for review; never drop another database.
    client.close()


def test_quota_is_atomic_across_processes(mongo):
    name, db = mongo
    db.db.instances.insert_one({'name': 'qa-line', 'warmup_mode': True})
    with ProcessPoolExecutor(6, mp_context=get_context('spawn')) as pool:
        futures = [pool.submit(_worker, 'quota', name, i) for i in range(24)]
        results = [f.result(timeout=45) for f in futures]
    assert sum(allowed for allowed, _ in results) == 5
    doc = db.db.instance_new_contacts_today.find_one({'instance': 'qa-line'})
    assert len(doc['recipients']) == 5
    assert db.db.instance_new_contacts_today.count_documents({}) == 1


def test_delivery_is_claimed_once_across_processes(mongo):
    name, db = mongo
    with ProcessPoolExecutor(6, mp_context=get_context('spawn')) as pool:
        futures = [pool.submit(_worker, 'send', name, i) for i in range(18)]
        results = [f.result(timeout=45) for f in futures]
    assert db.db.fake_deliveries.count_documents({}) == 1
    assert any(r.get('success') for r in results)
    assert db.db.delivery_receipts.find_one({'_id': 'same-operation'})['status'] == 'sent'


def test_crash_after_delivery_does_not_repeat_on_process_restart(mongo):
    name, db = mongo
    # A separate process dies after the simulated provider accepted delivery.
    code = ('import sys;sys.path.insert(0,sys.argv[1]);'
            'from test_mongo_send_integration import _worker;_worker("crash",sys.argv[2])')
    result = subprocess.run([sys.executable, '-c', code, str(Path(__file__).parent), name], timeout=30)
    assert result.returncode == 23
    assert db.db.fake_deliveries.count_documents({}) == 1
    assert db.db.delivery_receipts.find_one({'_id': 'same-operation'})['status'] == 'dispatching'
    assert _worker('send', name).get('uncertain')
    assert db.db.fake_deliveries.count_documents({}) == 1


def test_consent_and_opt_out_remain_after_reconnect(mongo):
    name, db = mongo
    from app.contact_permissions import record_consent, record_inbound_permission, permission_block_reason
    number = '525500000001'
    assert permission_block_reason(db, number) is None  # primer contacto permitido (2026-10-19)
    record_consent(db, number, source='recorded_request', evidence='Synthetic test evidence only', actor='qa-admin')
    assert permission_block_reason(db, number) is None
    record_inbound_permission(db, '+5215500000001', 'No me escribas')
    other_client, other = _connection(name)
    try:
        assert permission_block_reason(other, number)['reason'] == 'opt_out'
        record_inbound_permission(other, number, 'Hola')
        assert permission_block_reason(db, number, purpose='reply')['reason'] == 'opt_out'
    finally:
        other_client.close()


def test_midnight_transition_and_legacy_reservations(mongo):
    _, db = mongo
    from app import daily_cap
    number = '525500000001'
    first = '2026-10-18'
    db.db.instances.insert_one({'name': 'qa-line', 'warmup_mode': True})
    db.db.instance_new_contacts_today.insert_one({'instance': 'qa-line', 'date': first,
                                                 'companies': ['legacy-company']})
    with patch.object(daily_cap, '_today', return_value=first):
        assert daily_cap.reserve_new_contact_slot(db, 'qa-line', 'company', number) == (True, True)
        assert daily_cap.count_new_contacts_today_for_instance(db, 'qa-line') == 2
    with patch.object(daily_cap, '_today', return_value='2026-10-19'):
        assert daily_cap.count_new_contacts_today_for_instance(db, 'qa-line') == 0
        assert daily_cap.reserve_new_contact_slot(db, 'qa-line', 'company', number) == (True, True)
        assert daily_cap.count_new_contacts_today_for_instance(db, 'qa-line') == 1


def test_confirmed_logs_and_failed_logs_count_different_recipients(mongo):
    _, db = mongo
    from app import daily_cap
    start, _ = daily_cap._today_utc_range()
    for i, status in enumerate(['sent', 'failed', 'sent']):
        db.db.message_logs.insert_one({'direction': 'outbound', 'instance_name': 'qa-line',
            'company_id': 'same-company', 'to_number': f'52550000000{i + 1}',
            'status': status, 'created_at': start + timedelta(hours=1)})
    assert daily_cap.count_new_contacts_today_for_instance(db, 'qa-line') == 2
    assert daily_cap.is_new_contact(db, 'same-company', '525500000002')


def test_queue_repetition_deduplicates_with_real_unique_ids(mongo):
    _, db = mongo
    from app.send_now_worker import enqueue_send_items
    jobs = [{'numbers': ['525500000001', '+5215500000001', '525500000002'], 'messages': ['Synthetic QA']}]
    assert enqueue_send_items(db, jobs, 'operation', '', {}) == 2
    assert enqueue_send_items(db, jobs, 'operation', '', {}) == 0
    assert db.db.send_queue_items.count_documents({}) == 2


def test_real_worker_preserves_requested_order_with_hash_ids(mongo, monkeypatch):
    _, db = mongo
    from app import database, send_now_worker as worker
    jobs = [{'numbers': [f'52550000{i:04d}' for i in range(12)], 'messages': ['Synthetic QA']}]
    worker.enqueue_send_items(db, jobs, 'operation-order', '', {}, user_id='qa-user')
    observed = []
    def process(manager, partition, item, count, next_break):
        observed.append(item['to_number'])
        manager.db.send_queue_items.update_one({'_id': item['_id']}, {'$set': {'status': 'sent'}})
        return True, count, next_break
    monkeypatch.setattr(database, 'MongoDBManager', lambda: db)
    monkeypatch.setattr(worker, '_renew_lease', lambda manager: True)
    monkeypatch.setattr(worker, '_process_item', process)
    worker._partition_worker('qa-user', 'qa-user')
    assert observed == jobs[0]['numbers']


def test_receipt_persistence_error_keeps_authoritative_provider_result(mongo):
    name, db = mongo
    from app.delivery_receipts import dispatch_once, DeliveryUncertain
    class BrokenReceiptUpdate:
        def insert_one(self, doc): return db.db.delivery_receipts.insert_one(doc)
        def update_one(self, *args, **kwargs): raise RuntimeError('simulated write outage')
    proxy = SimpleNamespace(db=SimpleNamespace(delivery_receipts=BrokenReceiptUpdate()))
    def send():
        db.db.fake_deliveries.insert_one({'attempt': 'operation'})
        return {'success': True, 'messageId': 'mock-confirmed'}
    assert dispatch_once(proxy, 'operation', send)['success']
    client, reconnected = _connection(name)
    try:
        with pytest.raises(DeliveryUncertain): dispatch_once(reconnected, 'operation', send)
        assert db.db.fake_deliveries.count_documents({}) == 1
    finally:
        client.close()


@pytest.fixture(params=['mongo', 'primary', 'postgres_only'])
def api(mongo, monkeypatch, request):
    """Actual API, actual Mongo, HTTP-only fake provider; no app.main/workers."""
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app import auth, config, database, pipeline, whatsapp_wwebjs
    from app.api import routes
    _, wrapped = mongo
    manager = database.MongoDBManager.__new__(database.MongoDBManager)
    manager.db = wrapped.db
    pg_runtime = None
    pg_tables = ('instances', 'blacklist', 'contact_permissions', 'companies', 'contacts',
                 'delivery_receipts', 'jid_map', 'message_logs', 'instance_daily_sends',
                 'instance_new_contacts_today', 'fake_deliveries', 'ai_followup_sessions',
                 'conversation_ai_prefs')
    if request.param != 'mongo':
        from app import pgmirror
        from app.pgmirror import routing
        monkeypatch.setenv('POSTGRES_URL', os.getenv('TEST_POSTGRES_URL',
            'postgresql://app:app_local_only@127.0.0.1:55432/pgmirror_test'))
        monkeypatch.setenv('DB_MODES', ','.join(name + '=primary' for name in pg_tables))
        if request.param == 'postgres_only':
            monkeypatch.setenv('PGMIRROR_POSTGRES_ONLY', '1')
        pg_runtime = routing._Runtime(wrapped.db, monitor=False)
        monkeypatch.setattr(routing, '_runtime', pg_runtime)
        for name in pg_tables:
            pg_runtime.store.ensure_table(name)
            assert pg_runtime.store.ensure_unique_indexes(name)
        manager.db = pgmirror.wrap_database(wrapped.db)
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status":"connected"}')
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            manager.db.fake_deliveries.insert_one({'path': self.path, 'payload': payload})
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"success":true,"messageId":null,"typing":{"started":true}}')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    url = f'http://127.0.0.1:{server.server_port}'
    for module in (config, whatsapp_wwebjs): monkeypatch.setattr(module, 'WWEBJS_URL', url)
    for key in ('EVOLUTION_API_KEY', 'WAHA_API_KEY', 'WASENDER_PAT'): monkeypatch.setattr(config, key, '')
    for module in (database, pipeline, routes): monkeypatch.setattr(module, 'MongoDBManager', lambda: manager)
    monkeypatch.setattr(auth, 'get_user_by_token', lambda token: {'id': 'qa-user', 'username': 'qa', 'role': token} if token in ('admin', 'agent') else None)
    for line in ('qa-a', 'qa-b'):
        manager.db.instances.insert_one({'name': line, 'provider': 'wwebjs', 'number': '525500000099', 'warmup_mode': True})
    app = FastAPI(); app.include_router(routes.router, prefix='/api')
    with TestClient(app) as client:
        yield client, manager
    server.shutdown(); server.server_close(); thread.join(3)
    if pg_runtime:
        from psycopg import sql
        for name in pg_tables:
            pg_runtime.store.query(sql.SQL('DROP TABLE {}').format(sql.Identifier('mongo', name)))
        pg_runtime.store.close()


def test_incoming_webhook_persists_and_schedules_analysis_and_followup(api, monkeypatch):
    from bson import ObjectId
    from threading import Event
    from app import whatsapp_wwebjs, llm, classifier, followup_queue
    from unittest.mock import MagicMock
    client, manager = api
    number = '525500000001'
    cid = str(manager.db.companies.insert_one({'name': 'Synthetic external business', 'domain': 'qa.example'}).inserted_id)
    manager.db.contacts.insert_one({'company_id': cid, 'type': 'whatsapp', 'value': '+' + number})
    manager.db.conversation_ai_prefs.insert_one({'company_id': cid, 'ai_enabled': True})
    monkeypatch.setattr(whatsapp_wwebjs, 'API_SECRET', 'isolated-webhook-secret')
    monkeypatch.setattr(whatsapp_wwebjs, 'mark_read', lambda *args: None)
    monkeypatch.setattr(llm, 'active_provider', lambda: 'anthropic')
    classified = Event()

    def classify(log_id, company_id, body, received_at):
        manager.db.message_logs.update_one({'_id': ObjectId(log_id)}, {'$set': {
            'analysis': {'category': 'humano', 'synthetic_test': True}, 'analysis_status': 'done'}})
        classified.set()

    monkeypatch.setattr(classifier, 'classify_and_save', classify)
    enqueue = MagicMock()
    monkeypatch.setattr(followup_queue, 'enqueue', enqueue)
    payload = {'event': 'messages.received', 'sessionId': 'qa-a', 'data': {
        'number': number, 'from': number + '@c.us', 'fromMe': False,
        'body': 'Synthetic external response', 'messageId': 'qa-inbound-one', 'type': 'chat'}}
    response = client.post('/api/wwebjs/webhook', headers={'x-api-secret': 'isolated-webhook-secret'}, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['action'] == 'processed'
    assert classified.wait(5)
    row = manager.db.message_logs.find_one({'message_id': 'qa-inbound-one'})
    assert row['company_id'] == cid and row['direction'] == 'inbound'
    assert row['analysis']['category'] == 'humano'
    assert row['received_on_instance'] == 'qa-a'
    enqueue.assert_called_once_with(number, cid, 'Synthetic external response', str(row['_id']))

    # Own registered lines stay excluded, as in the real gely-wa test.
    payload['data'].update(number='525500000099', messageId='qa-internal')
    payload['data']['from'] = '525500000099@c.us'
    response = client.post('/api/wwebjs/webhook', headers={'x-api-secret': 'isolated-webhook-secret'}, json=payload)
    assert response.json()['action'] == 'ignored_internal'
    assert manager.db.message_logs.count_documents({'message_id': 'qa-internal'}) == 0


def test_real_api_permission_send_replay_and_cross_line_opt_out(api):
    client, manager = api
    headers = {'x-user-token': 'admin'}
    body = {'request_id': 'one-operation', 'company_id': '', 'to_number': '525500000001',
            'message': 'Synthetic QA only', 'instance': 'qa-a'}
    # Current product policy permits first contact, but a persisted opt-out
    # must deny it until an administrator records renewed consent.
    from app.contact_permissions import record_inbound_permission
    record_inbound_permission(manager, body['to_number'], 'No me escribas')
    denied = client.post('/api/send-message', headers=headers, json=body)
    assert denied.status_code == 403, denied.text
    permission = {'number': body['to_number'], 'source': 'recorded_request', 'evidence': 'Synthetic evidence in isolated test'}
    assert client.post('/api/contacts/consent', headers={'x-user-token': 'agent'}, json=permission).status_code == 403
    assert client.post('/api/contacts/consent', headers=headers, json=permission).status_code == 200
    log_ids = []
    for _ in range(2):
        response = client.post('/api/send-message', headers=headers, json=body)
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'sent'
        log_ids.append(response.json()['log_id'])
    assert manager.db.fake_deliveries.count_documents({}) == 1
    assert manager.db.message_logs.count_documents({'direction': 'outbound'}) == 1
    assert log_ids[0] == log_ids[1]
    manager.save_evolution_log('inbound', 'unknown', '+5215500000001', 'No me escribas', message_id='mock-opt-out')
    for line in ('qa-a', 'qa-b'):
        response = client.post('/api/send-message', headers=headers,
            json={**body, 'request_id': 'after-opt-out-' + line, 'instance': line})
        assert response.status_code == 403, response.text
    assert manager.db.fake_deliveries.count_documents({}) == 1
