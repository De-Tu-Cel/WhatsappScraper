from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import RLock
from types import SimpleNamespace
from unittest.mock import Mock
from concurrent.futures import ThreadPoolExecutor

import pytest
from app import phone_verification as worker


def matches(doc, query):
    for key, expected in query.items():
        if key == '$and':
            if not all(matches(doc, item) for item in expected): return False
        elif key == '$or':
            if not any(matches(doc, item) for item in expected): return False
        elif isinstance(expected, dict):
            for op,value in expected.items():
                if op == '$exists' and (key in doc) != value: return False
                if op == '$lte' and (doc.get(key) is None or doc[key] > value): return False
                if op == '$lt' and (doc.get(key) is None or doc[key] >= value): return False
                if op == '$gt' and (doc.get(key) is None or doc[key] <= value): return False
        elif doc.get(key) != expected: return False
    return True


class Collection:
    def __init__(self, docs=()):
        self.docs=deepcopy(list(docs)); self.lock=RLock()
    def insert_one(self, doc):
        with self.lock:
            self.docs.append(deepcopy(doc))
    def find_one(self, query, sort=None):
        with self.lock:
            docs=[d for d in self.docs if matches(d,query)]
            for key,direction in reversed(sort or []):docs.sort(key=lambda d:d.get(key,0),reverse=direction<0)
            return deepcopy(docs[0]) if docs else None
    def update_one(self, query, update, upsert=False):
        with self.lock:
            doc=next((d for d in self.docs if matches(d,query)),None)
            if doc is None and upsert:
                doc={**query,**deepcopy(update.get('$setOnInsert',{}))};self.docs.append(doc)
            if doc is not None:
                previous=deepcopy(doc)
                doc.update(deepcopy(update.get('$set',{})))
                for key,value in update.get('$inc',{}).items():doc[key]=doc.get(key,0)+value
                for key in update.get('$unset',{}):doc.pop(key,None)
            return SimpleNamespace(matched_count=int(doc is not None),modified_count=int(doc is not None and previous!=doc))
    def find_one_and_update(self, query, update, **kwargs):
        with self.lock:
            docs=[d for d in self.docs if matches(d,query)]
            if not docs:return None
            for key,direction in reversed(kwargs.get('sort',[('_id',1)])):
                docs.sort(key=lambda d:d.get(key, datetime.min.replace(tzinfo=timezone.utc) if key=='created_at' else ''),reverse=direction<0)
            doc=docs[0];self.update_one({'_id':doc['_id']},update)
            return deepcopy(doc)
    def count_documents(self, query):return sum(matches(d,query) for d in self.docs)


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(worker,'within_working_hours',lambda *args:True)
    now=datetime.now(timezone.utc)
    contacts=[{'_id':f'{i:02}', 'company_id':'qa-company', 'type':'phone',
               'value':f'+5255123456{i:02}', 'created_at':now-timedelta(minutes=10)} for i in range(8)]
    mgr=SimpleNamespace(db=SimpleNamespace(contacts=Collection(contacts),
        phone_verification_control=Collection([{'_id':'pace','next_at':now-timedelta(seconds=1)}]),
        jid_map=Collection(), phone_verification_attempts=Collection()),update_company=Mock())
    monkeypatch.setattr(worker,'get_all_connected_instances',lambda db:['qa-connected'])
    monkeypatch.setattr(worker,'reserve_verification_slot',lambda *args:True)
    monkeypatch.setattr(worker,'verify_number',Mock(return_value={'registered':True}))
    return mgr


def ready(db):
    db.db.phone_verification_control.docs[0]['next_at']=datetime.now(timezone.utc)-timedelta(seconds=1)


@pytest.mark.parametrize('error_name', ['LineBusy', 'SendWindowClosed'])
def test_service_deferral_keeps_phone_pending_and_releases_unused_lookup_cap(db, monkeypatch, error_name):
    from app import whatsapp_wwebjs
    db.db.instance_daily_verifications = Mock()
    monkeypatch.setattr(worker, 'verify_number', Mock(side_effect=getattr(whatsapp_wwebjs, error_name)()))
    result = worker.process_next(db)
    assert result['pending'] == 1
    assert all(c.get('type') == 'phone' for c in db.db.contacts.docs)
    assert not any(c.get('verified') == 'checking' for c in db.db.contacts.docs)
    update = db.db.instance_daily_verifications.update_one.call_args
    assert update.args[0]['instance'] == 'qa-connected'
    assert update.args[1] == {'$inc': {'count': -1}}
    assert 'send_before' in worker.verify_number.call_args.kwargs


def test_all_eight_phones_are_processed_once_and_after_restart(db):
    for _ in range(8):
        assert worker.process_next(db)['promoted']==1
        ready(db)
    assert all(d['type']=='whatsapp' and d['verified'] is True for d in db.db.contacts.docs)
    assert worker.verify_number.call_count==8
    assert worker.process_next(db)['checked']==0
    assert db.update_company.call_count==8
    assert len(db.db.jid_map.docs)==8


def test_scraped_phone_and_new_worker_wait_before_first_lookup(db):
    db.db.phone_verification_control.docs=[]
    assert worker.process_next(db)['reason']=='paced'
    worker.verify_number.assert_not_called()
    ready(db)
    for doc in db.db.contacts.docs:doc['created_at']=datetime.now(timezone.utc)
    assert worker.process_next(db)['checked']==0
    worker.verify_number.assert_not_called()


def test_pause_is_shared_even_when_two_workers_and_manual_call_compete(db):
    with ThreadPoolExecutor(max_workers=3) as pool:
        result=list(pool.map(lambda _:worker.process_next(db),range(3)))
    assert sum(r['checked'] for r in result)==1
    assert worker.verify_number.call_count==1
    now=datetime.now(timezone.utc)
    remaining=(db.db.phone_verification_control.docs[0]['next_at']-now).total_seconds()
    assert 19 < remaining <=40


@pytest.mark.parametrize('failure',[{}, {'registered':'false'}, RuntimeError('network')])
def test_unknown_is_retried_and_never_cached_as_negative(db,monkeypatch,failure):
    lookup=Mock(side_effect=failure) if isinstance(failure,Exception) else Mock(return_value=failure)
    monkeypatch.setattr(worker,'verify_number',lookup)
    assert worker.process_next(db)['pending']==1
    doc=db.db.contacts.docs[0]
    assert 'verified' not in doc and doc['verification_retry_at']>datetime.now(timezone.utc)
    assert db.db.jid_map.docs==[]
    ready(db)
    monkeypatch.setattr(worker,'verify_number',Mock(return_value={'registered':True}))
    worker.process_next(db)
    assert doc['type']=='phone' # Retry delay lets other contacts progress first.
    doc['verification_retry_at']=datetime.now(timezone.utc)-timedelta(seconds=1)
    ready(db)
    assert worker.process_next(db)['promoted']==1
    assert doc['type']=='whatsapp'


def test_real_negative_is_finished_without_losing_phone(db,monkeypatch):
    monkeypatch.setattr(worker,'verify_number',Mock(return_value={'registered':False}))
    assert worker.process_next(db)['promoted']==0
    doc=db.db.contacts.docs[0]
    assert doc['type']=='phone' and doc['verified'] is False
    assert db.db.jid_map.docs[0]['wa_valid'] is False
    ready(db);worker.process_next(db)
    assert worker.verify_number.call_args.args[1]!=doc['value']


@pytest.mark.parametrize('case',['offline','cap'])
def test_disconnection_or_daily_cap_keeps_pending(db,monkeypatch,case):
    if case=='offline':monkeypatch.setattr(worker,'get_all_connected_instances',lambda db:[])
    else:monkeypatch.setattr(worker,'reserve_verification_slot',lambda *args:False)
    assert worker.process_next(db)['checked']==0
    worker.verify_number.assert_not_called()
    assert all('verified' not in d for d in db.db.contacts.docs)


@pytest.mark.parametrize('legacy',[False,True])
def test_restart_recovers_crashed_or_legacy_checking_claim(db,legacy):
    doc=db.db.contacts.docs[0];doc['verified']='checking';doc['verification_token']='dead-worker'
    if not legacy:doc['verification_lease_until']=datetime.now(timezone.utc)-timedelta(seconds=1)
    assert worker.process_next(db)['promoted']==1
    assert doc['verified'] is True and 'verification_token' not in doc


def test_live_claim_is_not_taken_by_another_worker(db):
    doc=db.db.contacts.docs[0];doc['verified']='checking'
    doc['verification_lease_until']=datetime.now(timezone.utc)+timedelta(seconds=60)
    worker.process_next(db)
    assert worker.verify_number.call_args.args[1]!=doc['value']


def test_legacy_negative_without_check_date_is_rechecked_once(db):
    doc=db.db.contacts.docs[0];doc['verified']=False
    assert worker.process_next(db)['promoted']==1
    assert doc['verified'] is True and doc['wa_checked_at']


def test_new_scrapes_are_prioritized_but_old_backlog_gets_a_turn(db):
    now=datetime.now(timezone.utc)
    for i,doc in enumerate(db.db.contacts.docs):doc['created_at']=now-timedelta(days=8-i)
    for _ in range(5):worker.process_next(db);ready(db)
    checked=[call.args[1] for call in worker.verify_number.call_args_list]
    assert checked[:4]==[db.db.contacts.docs[i]['value'] for i in (7,6,5,4)]
    assert checked[4]==db.db.contacts.docs[0]['value']


def test_maps_and_direct_scraper_do_not_query_whatsapp_inline(monkeypatch):
    from app import pipeline
    from app.scraper import WebsiteScraper
    lookup=Mock();monkeypatch.setattr('app.whatsapp_wwebjs.verify_number',lookup)
    assert pipeline._verify_whatsapp_paced(None,'+525512345678') is None
    scraper=object.__new__(WebsiteScraper)
    scraper._verify_new_phone_contacts('qa-company',['+525512345678']*8)
    lookup.assert_not_called()


def test_admin_turn_uses_same_pause_and_counts_all_pending(db,monkeypatch):
    from app.api import routes
    monkeypatch.setattr(routes,'_require_admin',lambda token:None)
    monkeypatch.setattr(routes,'MongoDBManager',lambda:db)
    first=routes.api_verify_phone_contacts(10,'qa-token')
    assert first['checked']==1 and first['remaining']==7
    second=routes.api_verify_phone_contacts(10,'qa-token')
    assert second['checked']==0 and second['paused'] and second['remaining']==7


@pytest.mark.parametrize('flag',[None,'false','1'])
def test_deploy_does_not_start_automatic_lookups_by_default(monkeypatch,flag):
    if flag is None:monkeypatch.delenv('PHONE_VERIFICATION_AUTO_ENABLED',raising=False)
    else:monkeypatch.setenv('PHONE_VERIFICATION_AUTO_ENABLED',flag)
    thread=Mock();monkeypatch.setattr(worker.threading,'Thread',thread)
    assert worker.start_phone_verification_worker().is_set()
    thread.assert_not_called()


def test_only_explicit_activation_starts_worker(monkeypatch):
    monkeypatch.setenv('PHONE_VERIFICATION_AUTO_ENABLED','true')
    thread=Mock();monkeypatch.setattr(worker.threading,'Thread',thread)
    stop=worker.start_phone_verification_worker()
    assert not stop.is_set()
    thread.return_value.start.assert_called_once()
    stop.set()


@pytest.mark.parametrize('utc,allowed',[
    ('2026-10-12T14:59:59+00:00',False),
    ('2026-10-12T15:00:00+00:00',True),
    ('2026-10-12T23:59:59+00:00',True),
    ('2026-10-13T00:00:00+00:00',False),
    ('2026-10-16T20:00:00+00:00',True),
    ('2026-10-17T20:00:00+00:00',False),
    ('2026-10-18T20:00:00+00:00',False),
])
def test_working_hours_use_mexico_city_even_when_server_uses_utc(monkeypatch,utc,allowed):
    monkeypatch.setenv('PHONE_VERIFICATION_START_HOUR','9')
    monkeypatch.setenv('PHONE_VERIFICATION_END_HOUR','18')
    assert worker.within_working_hours(datetime.fromisoformat(utc)) is allowed


def test_outside_schedule_has_no_whatsapp_or_database_activity(db,monkeypatch):
    monkeypatch.setattr(worker,'within_working_hours',lambda *args:False)
    connected=Mock();monkeypatch.setattr(worker,'get_all_connected_instances',connected)
    assert worker.process_next(db)['reason']=='outside_schedule'
    connected.assert_not_called();worker.verify_number.assert_not_called()
    assert 'turn' not in db.db.phone_verification_control.docs[0]
    assert all('verified' not in d for d in db.db.contacts.docs)


def test_closing_time_during_claim_defers_contact(db,monkeypatch):
    monkeypatch.setattr(worker,'within_working_hours',Mock(side_effect=[True,False]))
    assert worker.process_next(db)['reason']=='outside_schedule'
    worker.verify_number.assert_not_called()
    assert all('verified' not in d for d in db.db.contacts.docs)


def test_round_robin_is_fair_and_persists_across_restart(db,monkeypatch):
    monkeypatch.setattr(worker,'get_all_connected_instances',lambda db:['wa-c','wa-a','wa-b'])
    for turn in range(6):
        if turn==3:db=SimpleNamespace(db=db.db,update_company=db.update_company)
        worker.process_next(db);ready(db)
    assert [call.args[0] for call in worker.verify_number.call_args_list]==['wa-a','wa-b','wa-c']*2


def test_rotation_skips_exhausted_and_disconnected_sessions(db,monkeypatch):
    connected=['wa-a','wa-b','wa-c']
    monkeypatch.setattr(worker,'get_all_connected_instances',lambda db:connected[:])
    monkeypatch.setattr(worker,'reserve_verification_slot',lambda db,name:name!='wa-b')
    worker.process_next(db);ready(db)
    worker.process_next(db);ready(db)
    assert [call.args[0] for call in worker.verify_number.call_args_list]==['wa-a','wa-c']
    connected.remove('wa-a')
    worker.process_next(db);ready(db)
    assert worker.verify_number.call_args.args[0]=='wa-c'
    connected[:]=['wa-a','wa-b','wa-c']
    monkeypatch.setattr(worker,'reserve_verification_slot',lambda *args:True)
    worker.process_next(db)
    assert worker.verify_number.call_args.args[0]=='wa-a'


def test_failed_lookup_advances_rotation_without_retrying_same_session_immediately(db,monkeypatch):
    monkeypatch.setattr(worker,'get_all_connected_instances',lambda db:['wa-a','wa-b'])
    monkeypatch.setattr(worker,'verify_number',Mock(side_effect=[RuntimeError('offline'),{'registered':True}]))
    assert worker.process_next(db)['pending']==1
    ready(db);assert worker.process_next(db)['promoted']==1
    assert [call.args[0] for call in worker.verify_number.call_args_list]==['wa-a','wa-b']
