from unittest.mock import Mock
from datetime import datetime, timedelta
from app import llm, config, classifier, classification_compare as compare


def test_historical_identity_does_not_change_when_current_model_changes(monkeypatch):
    historical={'category':'humano','notes':'Histórico','model':'gpt-4.1-mini-2025-04-14',
                'model_requested':'gpt-4.1-mini','provider':'openai','analysis_origin':'llm'}
    monkeypatch.setattr(config,'CLASSIFIER_MODEL','claude-haiku-5-5')
    result=compare._hybrid_result(historical,[])
    assert result['model']=='gpt-4.1-mini-2025-04-14'
    assert result['provider']=='openai'
    assert result['model_requested']=='gpt-4.1-mini'


def test_unknown_historical_model_is_not_attributed_to_current_configuration(monkeypatch):
    monkeypatch.setattr(config,'CLASSIFIER_MODEL','claude-haiku-5-5')
    assert compare._hybrid_result({'category':'humano'},[])['model'] is None


def test_anthropic_api_model_is_retained_in_response_and_analysis(monkeypatch):
    monkeypatch.setattr(llm,'active_provider',lambda:'anthropic')
    raw=llm.LLMText('{"category":"humano","notes":"Mensaje humano","response_quality":3}',
                   provider='anthropic',model='claude-haiku-5-5',requested_model='claude-haiku-5-5')
    monkeypatch.setattr(classifier,'_call_deepseek',lambda *args,**kw:raw)
    monkeypatch.setattr(classifier,'_quick_classify',lambda *args:None)
    monkeypatch.setattr(classifier,'all_quota_exhausted',lambda:False)
    result=classifier.classify_response('Estoy revisando el pedido que nos mandaste ayer','Hola',3)
    assert result['model']=='claude-haiku-5-5' and result['provider']=='anthropic'


def test_openai_returns_actual_version_not_only_requested_alias(monkeypatch):
    monkeypatch.setattr(llm,'OPENAI_API_KEY','fake')
    monkeypatch.setattr('app.service_health.ensure_available',lambda *args:None)
    data={'model':'gpt-4.1-mini-2025-04-14','choices':[{'message':{'content':'OK'}}]}
    monkeypatch.setattr(llm.requests,'post',Mock(return_value=Mock()))
    monkeypatch.setattr('app.service_health.inspect_response',lambda *args,**kw:data)
    raw=llm._call_openai([{'role':'user','content':'Hola'}],10,0,'gpt-4.1-mini')
    assert raw=='OK'
    assert llm.response_metadata(raw)['model']=='gpt-4.1-mini-2025-04-14'
    assert llm.response_metadata(raw)['model_requested']=='gpt-4.1-mini'


def test_no_response_is_explicitly_rule_based_without_inference(monkeypatch):
    monkeypatch.setattr(llm,'active_provider',lambda:'anthropic')
    monkeypatch.setattr(classifier,'all_quota_exhausted',lambda:False)
    monkeypatch.setattr(classifier,'MongoDBManager',lambda:Mock())
    call=Mock();monkeypatch.setattr(classifier,'_call_deepseek',call)
    result=classifier.classify_conversation('qa',messages=[{'direction':'outbound','message_body':'Hola','created_at':datetime.utcnow()-timedelta(hours=2)}])
    assert result['category']=='sin_respuesta' and result['model'] is None
    assert result['analysis_origin']=='rules'
    assert compare._hybrid_result(result,[])['model'] is None
    call.assert_not_called()


def test_report_retains_model_and_uses_final_rule_explanation():
    hybrid={'category':'bot','notes':'Diagnóstico previo humano','model':'claude-haiku-5-5','provider':'anthropic',
            'trace':[{'paso':'Corrección fija: menú','detalle':'Hay un menú, no atención humana.'}]}
    db=Mock();db.db.__getitem__=Mock(return_value=Mock(find_one=Mock(return_value={'hibrido':hybrid})))
    result=compare.report_verdict(db,'qa')
    assert result['model']=='claude-haiku-5-5'
    assert result['notes']=='Hay un menú, no atención humana.'
