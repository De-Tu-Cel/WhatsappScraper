from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from app import classifier


def test_failed_delivery_cannot_be_classified_as_no_response(monkeypatch):
    now=datetime.now(timezone.utc).replace(tzinfo=None)
    logs=MagicMock()
    failed={'_id':'failed-efigas','company_id':'qa-co','to_number':'523234710933','status':'failed','created_at':now-timedelta(hours=2)}
    sent={'_id':'sent','company_id':'qa-co','to_number':'573234710933','status':'sent','created_at':now-timedelta(hours=2)}
    # Devuelve ambos para verificar también la barrera defensiva, sin Mongo real.
    logs.find.side_effect=lambda query,*args,**kw: [failed,sent] if query.get('direction')=='outbound' else []
    logs.find_one.return_value=None
    db=SimpleNamespace(db=SimpleNamespace(message_logs=logs),save_message_analysis=MagicMock())
    monkeypatch.setattr(classifier,'MongoDBManager',lambda:db)
    monkeypatch.setattr(classifier,'_get_thresholds',lambda db:(10,5,1,60))
    monkeypatch.setattr(classifier,'_sweep_reply_analyses',lambda *args:None)
    classifier._sweep_pending()
    queries=[call.args[0] for call in logs.find.call_args_list if call.args[0].get('direction')=='outbound']
    assert queries[0]['status']=={'$ne':'failed'}
    assert db.save_message_analysis.call_count==1
    assert db.save_message_analysis.call_args.args[0]=='sent'
