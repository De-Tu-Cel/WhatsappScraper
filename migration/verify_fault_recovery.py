"""Real failure drill using two NEW disposable containers, never the app's DBs.

Run from the repository root: python migration/verify_fault_recovery.py
Requires local Docker, Mongo 7, Postgres 17 and the API dependencies.
"""
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = uuid.uuid4().hex[:10]
MONGO, PG = f"qa-pg-fault-mongo-{RUN}", f"qa-pg-fault-postgres-{RUN}"
LABEL = "com.detucel.qa-fault-drill"
created = []
checks = []


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.STDOUT).strip()


def lifecycle(action, name):
    info = json.loads(docker('inspect', name))[0]
    assert name in created and info['Config']['Labels'].get(LABEL) == RUN
    return docker(action, name)


def port(name, internal):
    return docker('port', name, str(internal)).rsplit(':', 1)[1]


def child(phase, mongo_url, pg_url):
    env = {k:v for k,v in os.environ.items() if not (k.startswith(('DB_MODE_', 'PGMIRROR_')) or k in ('DB_MODES','POSTGRES_URL'))}
    primary_names='fault_documents users companies message_logs warmup_sessions contacts jid_map phone_verification_attempts search_ideas scrape_jobs archivos'.split()
    env.update(PYTHON_DOTENV_DISABLED='1', POSTGRES_URL=pg_url,
               DB_MODES=','.join(name+'=primary' for name in primary_names),
               MONGODB_URI=mongo_url,DATABASE_NAME='qa_fault',QA_FAULT_MONGO=mongo_url)
    if phase == 'postgres_only':
        env['PGMIRROR_POSTGRES_ONLY'] = '1'
    program = r'''
import os,sys,json
sys.path.insert(0, 'apps/api')
sys.path.insert(0, 'apps/api/app')
from pymongo import MongoClient
from app.pgmirror import routing, primaria, health
from app.pgmirror.routing import RoutedCollection
client=MongoClient(os.environ['QA_FAULT_MONGO'],serverSelectionTimeoutMS=2000,connectTimeoutMS=2000,socketTimeoutMS=2000)
db=client.qa_fault
rt=routing._Runtime(db,monitor=False)
col=RoutedCollection(db.fault_documents,'fault_documents','primary',rt)
phase=sys.argv[1]
try:
 if phase=='seed':
  col.insert_one({'_id':'test','value':1})
  assert col.find_one({'_id':'test'})['value']==1
 elif phase=='mongo_down':
  # The actual application DB manager must also open with Mongo offline,
  # rather than only testing a pre-existing routed collection.
  routing._runtime=rt
  from app.database import MongoDBManager
  col=MongoDBManager().db.fault_documents
  col.update_one({'_id':'test'},{'$set':{'value':2}})
  assert col.find_one({'_id':'test'})['value']==2
  assert rt.store.query('SELECT count(*) FROM mongo._outbox')[0][0]==1
 elif phase=='recover':
  assert health.drain_outbox(db,rt.store,{'fault_documents'},mayores_a_s=0)==1
  assert health.drain_outbox(db,rt.store,{'fault_documents'},mayores_a_s=0)==0
  assert db.fault_documents.find_one({'_id':'test'})['value']==2
 elif phase=='pg_down':
  failed=0
  for op in (lambda:col.find_one({'_id':'test'}),lambda:col.update_one({'_id':'test'},{'$set':{'value':3}})):
   try:op()
   except Exception:failed+=1
  assert failed==2, 'Must not acknowledge stale reads or Mongo-only writes'
  assert db.fault_documents.find_one({'_id':'test'})['value']==2
 elif phase=='final':
  assert col.find_one({'_id':'test'})['value']==2
  col.update_one({'_id':'test'},{'$set':{'value':4}})
  assert col.find_one({'_id':'test'})['value']==4
  assert db.fault_documents.find_one({'_id':'test'})['value']==4
  assert rt.store.query('SELECT count(*) FROM mongo._outbox')[0][0]==0
 elif phase=='postgres_only':
  # Mongo is stopped. No mock intercepts any database call in this phase.
  routing._runtime=rt
  from app.database import MongoDBManager
  from bson import ObjectId
  manager=MongoDBManager()
  manager.db.fault_documents.update_one({'_id':'test'},{'$set':{'value':5}})
  assert manager.db.fault_documents.find_one({'_id':'test'})['value']==5
  for name in ['stickers','evidence']:
   manager.db[name].insert_one({'_id':'native','name':'Synthetic native-only record'})
   assert manager.db[name].find_one({'_id':'native'})['name'].startswith('Synthetic')
   manager.db[name].delete_one({'_id':'native'})
  manager.db.companies.insert_many([{'_id':ObjectId(),'city':'Bogota'},{'_id':ObjectId()}])
  assert manager.get_distinct_values('city')==['Bogota']
  assert manager.list_companies()['total']==2
  file_id=manager.fs.put(b'synthetic PDF bytes',filename='qa.pdf',content_type='application/pdf')
  assert manager.fs.get(file_id).read()==b'synthetic PDF bytes'
  rt.monitor.tick()
  assert rt.store.query('SELECT count(*) FROM mongo._outbox')[0][0]==0
  assert not any(k.startswith('pg_fallback') or k=='primaria_por_mongo' for b in rt.stats.values() for k,v in b.items() if v)
  import subprocess
  checked=subprocess.run([sys.executable,'apps/api/scripts/pg_mirror.py','check'],capture_output=True,text=True,timeout=30)
  assert checked.returncode==0, checked.stderr
 print(json.dumps({'phase':phase,'passed':True}),flush=True)
finally:
 rt.store.close();client.close()
'''
    p = subprocess.run([sys.executable, '-c', program, phase], cwd=ROOT, env=env,
                       capture_output=True, text=True, timeout=60)
    if p.returncode:
        raise RuntimeError(f'{phase} failed: {p.stderr[-1800:]}')
    result = json.loads(p.stdout.splitlines()[-1])
    checks.append(result)
    print(json.dumps(result), flush=True)


def wait_ready(name, engine):
    for _ in range(40):
        try:
            if engine == 'pg':
                docker('exec',name,'pg_isready','-U','app','-d','qa_fault')
            else:
                docker('exec',name,'mongosh','--quiet','--eval','db.adminCommand({ping:1}).ok')
            return
        except subprocess.CalledProcessError:
            time.sleep(.5)
    raise RuntimeError('Disposable engine did not become ready')


try:
    docker('run','-d','--name',MONGO,'--label',f'{LABEL}={RUN}',
           '-p','127.0.0.1::27017','mongo:7.0')
    created.append(MONGO)
    docker('run','-d','--name',PG,'--label',f'{LABEL}={RUN}',
           '-e','POSTGRES_USER=app','-e','POSTGRES_PASSWORD=local_fault_only',
           '-e','POSTGRES_DB=qa_fault','-p','127.0.0.1::5432','postgres:17-alpine')
    created.append(PG)
    wait_ready(MONGO,'mongo');wait_ready(PG,'pg')
    mongo_url=f'mongodb://127.0.0.1:{port(MONGO,27017)}'
    pg_url=f'postgresql://app:local_fault_only@127.0.0.1:{port(PG,5432)}/qa_fault'
    child('seed',mongo_url,pg_url)
    lifecycle('stop',MONGO)
    child('mongo_down',mongo_url,pg_url)
    lifecycle('start',MONGO);wait_ready(MONGO,'mongo')
    mongo_url=f'mongodb://127.0.0.1:{port(MONGO,27017)}'
    child('recover',mongo_url,pg_url)
    lifecycle('stop',PG)
    child('pg_down',mongo_url,pg_url)
    lifecycle('start',PG);wait_ready(PG,'pg')
    pg_url=f'postgresql://app:local_fault_only@127.0.0.1:{port(PG,5432)}/qa_fault'
    child('final',mongo_url,pg_url)
    lifecycle('stop',MONGO)
    child('postgres_only',mongo_url,pg_url)
finally:
    for name in reversed(created):
        info=json.loads(docker('inspect',name))[0]
        assert info['Config']['Labels'].get(LABEL)==RUN
        docker('rm','-f','-v',name)
    report=ROOT/'backups'/'migration-real-fault-drill.json'
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({'checks':checks,'passed':len(checks)==6},indent=2),encoding='utf-8')
