from copy import deepcopy
import re
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from bson import ObjectId
import pytest
from app import ai_reply_recovery as recovery, followup_queue


def matches(doc, query):
    for key, expected in query.items():
        if key == '$or':
            if not any(matches(doc, q) for q in expected):
                return False
            continue
        actual = doc.get(key)
        if isinstance(expected, dict):
            for op, value in expected.items():
                if op == '$lte' and (actual is None or actual > value): return False
                if op == '$gt' and (actual is None or actual <= value): return False
                if op == '$nin' and actual in value: return False
                if op == '$regex' and (not isinstance(actual, str) or not re.search(value, actual)): return False
        elif actual != expected:
            return False
    return True


class Collection:
    def __init__(self, docs=()): self.docs = deepcopy(list(docs))
    def find_one(self, query, *args, sort=None, **kwargs):
        docs = [d for d in self.docs if matches(d, query)]
        if sort:
            field, order = sort[0]
            docs.sort(key=lambda d: d.get(field, datetime.min), reverse=order < 0)
        return deepcopy(docs[0]) if docs else None
    def update_one(self, query, update, upsert=False):
        doc = next((d for d in self.docs if matches(d, query)), None)
        if doc is None and upsert:
            doc = {**query, **update.get('$setOnInsert', {})}
            self.docs.append(doc)
        if doc is not None:
            doc.update(deepcopy(update.get('$set', {})))
            for key in update.get('$unset', {}): doc.pop(key, None)
        return SimpleNamespace(modified_count=int(doc is not None))
    def find_one_and_update(self, query, update, **kwargs):
        doc = self.find_one(query, sort=kwargs.get('sort'))
        if doc is None: return None
        self.update_one({'_id':doc['_id']}, update)
        return self.find_one({'_id':doc['_id']})


@pytest.fixture
def db(monkeypatch):
    now = datetime.utcnow()
    cid = 'aabbccddeeff001122334455'
    log_id = ObjectId()
    database = SimpleNamespace(
        ai_reply_pending=Collection(),
        ai_followup_sessions=Collection([{'_id':'session', 'company_id':cid, 'phone_number':'526622800606', 'status':'active', 'last_activity':now-timedelta(hours=20)}]),
        conversation_ai_prefs=Collection([{'company_id':cid, 'ai_enabled':True}]),
        message_logs=Collection([{'_id':log_id, 'company_id':cid, 'direction':'inbound', 'created_at':now-timedelta(hours=20), 'message_body':'¿En qué podemos ayudarte?'}]),
        companies=Collection([{'_id':ObjectId(cid), 'assigned_instance':'wa1'}]),
    )
    mgr = SimpleNamespace(db=database)
    monkeypatch.setattr('app.ai_followup._get_idle_timeout_hours', lambda db:48)
    monkeypatch.setattr('app.ai_followup._is_business_hours', lambda:True)
    monkeypatch.setattr('app.ai_followup._is_blocked_or_blacklisted', lambda *args:False)
    monkeypatch.setattr('app.service_health.configured_services', lambda:{'ai':('openai','fake-test-key')})
    monkeypatch.setattr('app.service_health.ensure_available', lambda *args:None)
    monkeypatch.setattr('app.daily_cap.connected_session_names', lambda db:{'wa1'})
    recovery.defer_reply(mgr, session_id='session', phone_number='526622800606', company_id=cid,
                         inbound_body='¿En qué podemos ayudarte?', inbound_log_id=str(log_id),
                         retry_at=now-timedelta(minutes=1))
    return mgr


def test_recharge_and_restart_resume_once_without_a_new_inbound(db, monkeypatch):
    # Toda la información se reconstruye de los documentos persistidos.
    restarted = deepcopy(db)
    queued=[]
    recovery.queue_due(restarted, queued.append)
    recovery.queue_due(restarted, queued.append)
    assert len(queued) == 1
    sender=MagicMock(return_value=True)
    monkeypatch.setattr('app.database.MongoDBManager', lambda:restarted)
    monkeypatch.setattr('app.ai_followup.process_inbound_reply', sender)
    monkeypatch.setattr(followup_queue, '_resolve_instance', lambda cid:'wa1')
    followup_queue._last_send_ts.clear()
    followup_queue._process_one(queued[0])
    followup_queue._process_one(queued[0])
    assert sender.call_count == 1
    assert sender.call_args.kwargs['recovery']['session_id'] == 'session'
    assert restarted.db.ai_reply_pending.docs[0]['status'] == 'completed'


def test_pending_replies_stay_persisted_at_night_then_resume_at_opening(db, monkeypatch):
    queued = []
    monkeypatch.setattr('app.ai_followup._is_business_hours', lambda: False)
    recovery.queue_due(db, queued.append)
    assert not queued
    assert db.db.ai_reply_pending.docs[0]['status'] == 'pending'
    monkeypatch.setattr('app.ai_followup._is_business_hours', lambda: True)
    recovery.queue_due(db, queued.append)
    assert len(queued) == 1
    assert queued[0]['recovery']['session_id'] == 'session'


@pytest.mark.parametrize('case', ['manual', 'ai_answered', 'disabled', 'closed', 'blocked', 'newer', 'expired', 'idle_expired'])
def test_obsolete_replies_are_cancelled_without_send(db, monkeypatch, case):
    job=db.db.ai_reply_pending.docs[0]
    if case in ('manual','ai_answered'):
        db.db.message_logs.docs.append({'_id':ObjectId(), 'company_id':job['company_id'], 'direction':'outbound', 'status':'sent', 'created_at':datetime.utcnow(), 'ai_generated':case=='ai_answered'})
    elif case=='disabled': db.db.conversation_ai_prefs.docs[0]['ai_enabled']=False
    elif case=='closed': db.db.ai_followup_sessions.docs[0]['status']='ended'
    elif case=='blocked': monkeypatch.setattr('app.ai_followup._is_blocked_or_blacklisted', lambda *args:True)
    elif case=='newer': db.db.message_logs.docs.append({'_id':ObjectId(), 'company_id':job['company_id'], 'direction':'inbound', 'created_at':datetime.utcnow()})
    elif case=='expired': job['expires_at']=datetime.utcnow()-timedelta(seconds=1)
    else: db.db.ai_followup_sessions.docs[0]['last_activity']=datetime.utcnow()-timedelta(hours=49)
    queued=[]
    recovery.queue_due(db, queued.append)
    assert queued == []
    assert job['status'] == 'cancelled'


def test_no_balance_does_not_consume_pending_job(db, monkeypatch):
    from app.service_health import ServiceUnavailable
    def unavailable(*args): raise ServiceUnavailable('openai','billing')
    monkeypatch.setattr('app.service_health.ensure_available', unavailable)
    queued=[]
    recovery.queue_due(db, queued.append)
    assert queued == []
    assert db.db.ai_reply_pending.docs[0]['status']=='pending'


def test_disconnected_assigned_session_waits_without_closing_chat(db, monkeypatch):
    monkeypatch.setattr('app.daily_cap.connected_session_names', lambda db:{'someone-else'})
    queued=[]
    recovery.queue_due(db, queued.append)
    assert not queued
    assert db.db.ai_reply_pending.docs[0]['status']=='pending'
    assert db.db.ai_followup_sessions.docs[0]['status']=='active'


def test_provider_change_resumes_saved_reply_with_current_provider(db, monkeypatch):
    from app import service_health
    ensure=MagicMock()
    monkeypatch.setattr(service_health,'configured_services',lambda:{'ai':('anthropic','fake-anthropic')})
    monkeypatch.setattr(service_health,'ensure_available',ensure)
    queued=[]
    recovery.queue_due(db,queued.append)
    ensure.assert_called_once_with('anthropic','fake-anthropic')
    assert len(queued)==1
    assert queued[0]['recovery']['status']=='processing'
    # El job guarda la conversación; no queda ligado a la clave o proveedor anterior.
    assert 'provider' not in queued[0]['recovery']


def test_expired_lease_can_be_recovered_after_a_crash(db):
    old=db.db.ai_reply_pending.docs[0]
    old.update(status='processing', lease_token='crashed', lease_until=datetime.utcnow()-timedelta(seconds=1))
    queued=[]
    recovery.queue_due(db, queued.append)
    assert len(queued)==1
    assert queued[0]['recovery']['lease_token']!='crashed'


def test_stale_worker_cannot_clear_a_newer_job(db):
    queued=[]
    recovery.queue_due(db, queued.append)
    old=queued[0]['recovery']
    latest=db.db.ai_reply_pending.docs[0]
    latest.update(revision='new-message', status='pending', lease_token=None)
    recovery.finish(db, old, 'completed')
    assert latest['status']=='pending'


@pytest.mark.parametrize('direction', ['inbound', 'outbound'])
@pytest.mark.parametrize('other', ['526622800607', '576622800606'])
def test_another_number_or_country_does_not_cancel_pending_reply(db, direction, other):
    job = db.db.ai_reply_pending.docs[0]
    field = 'from_number' if direction == 'inbound' else 'to_number'
    db.db.message_logs.docs.append({'_id': ObjectId(), 'company_id': job['company_id'],
                                   'direction': direction, field: other, 'status': 'sent',
                                   'created_at': datetime.utcnow()})
    queued = []
    recovery.queue_due(db, queued.append)
    assert len(queued) == 1


@pytest.mark.parametrize('number', ['526622800606', '5216622800606', '+52 662 280 0606'])
def test_manual_reply_to_same_number_cancels_even_with_legacy_mexican_prefix(db, number):
    job = db.db.ai_reply_pending.docs[0]
    db.db.message_logs.docs.append({'_id': ObjectId(), 'company_id': job['company_id'],
                                   'direction': 'outbound', 'to_number': number,
                                   'status': 'sent', 'created_at': datetime.utcnow()})
    queued = []
    recovery.queue_due(db, queued.append)
    assert queued == [] and job['reason'] == 'already_answered'
