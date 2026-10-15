from copy import deepcopy
from unittest.mock import Mock
import pytest
from app import llm, llm_guard, service_health as health


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.delenv('LLM_PROVIDER',raising=False)
    monkeypatch.setattr(llm,'OPENAI_API_KEY','fake-openai')
    monkeypatch.setattr(llm,'DEEPSEEK_API_KEY','fake-deepseek')
    monkeypatch.setattr(llm,'ANTHROPIC_API_KEY','fake-anthropic')
    monkeypatch.setattr(health,'_states',{})
    monkeypatch.setattr(health,'_store',None)
    llm_guard.reset_circuit()
    yield
    llm_guard.reset_circuit()


def response(content=None,status=200,stop='end_turn'):
    payload={'content':content or [{'type':'text','text':'{"category":"humano"}'}],'stop_reason':stop}
    return Mock(status_code=status,json=Mock(return_value=payload))


def test_adding_anthropic_key_does_not_switch_chat_provider():
    assert llm.active_provider()=='openai'


def test_isolated_haiku_probe_adapts_system_and_selects_text_blocks(monkeypatch):
    post=Mock(return_value=response([{'type':'thinking','thinking':'private'},
        {'type':'text','text':' Hola'}, {'type':'text','text':' Marco '}]))
    monkeypatch.setattr(llm.requests,'post',post)
    messages=[{'role':'system','content':'Habla en español.'},{'role':'system','content':'No agendes citas.'},
              {'role':'user','content':'Hola'},{'role':'assistant','content':'Buenas tardes'},
              {'role':'user','content':'¿Tienen servicio?'}]
    original=deepcopy(messages)
    result=llm.call_llm(messages,provider='anthropic',model='claude-haiku-5-5',priority=llm.PRIORITY_LIVE)
    assert result=='Hola Marco'
    assert messages==original and llm.active_provider()=='openai'
    request=post.call_args.kwargs
    assert post.call_args.args[0]=='https://api.anthropic.com/v1/messages'
    assert request['headers']['anthropic-version']=='2023-06-01'
    assert request['json']['system']=='Habla en español.\n\nNo agendes citas.'
    assert request['json']['messages']==messages[2:]
    assert 'temperature' not in request['json']
    assert request['json']['thinking']=={'type':'disabled'}


def test_explicit_selection_uses_claude_default_and_health_key(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER','anthropic')
    post=Mock(return_value=response());monkeypatch.setattr(llm.requests,'post',post)
    llm.call_llm([{'role':'user','content':'Prueba'}])
    assert post.call_args.kwargs['json']['model']=='claude-haiku-5-5'
    assert health.configured_services()['ai']==('anthropic','fake-anthropic')


def test_missing_selected_key_never_falls_back_to_a_paid_provider(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER','anthropic');monkeypatch.setattr(llm,'ANTHROPIC_API_KEY','')
    post=Mock();monkeypatch.setattr(llm.requests,'post',post)
    with pytest.raises(RuntimeError,match='No hay clave'):llm.call_llm([{'role':'user','content':'Hola'}])
    post.assert_not_called()


@pytest.mark.parametrize('status,error,reason',[
    (400,{'type':'invalid_request_error','message':'Your credit balance is too low to access the Anthropic API.'},'billing'),
    (401,{'type':'authentication_error'},'auth'),
    (429,{'type':'rate_limit_error'},'rate_limit'),
    (529,{'type':'overloaded_error'},'unavailable'),
])
def test_provider_errors_pause_without_repeated_token_spend(monkeypatch,status,error,reason):
    r=Mock(status_code=status,json=Mock(return_value={'type':'error','error':error}))
    post=Mock(return_value=r);monkeypatch.setattr(llm.requests,'post',post)
    for _ in range(2):
        with pytest.raises(health.ServiceUnavailable) as caught:
            llm.call_llm([{'role':'user','content':'Hola'}],provider='anthropic')
        assert caught.value.reason==reason
        assert 'fake-anthropic' not in str(caught.value)
    assert post.call_count==1


@pytest.mark.parametrize('stop',['max_tokens','refusal','model_context_window_exceeded'])
def test_truncated_or_refused_analysis_cannot_be_used_as_a_valid_result(monkeypatch,stop):
    monkeypatch.setattr(llm.requests,'post',Mock(return_value=response(stop=stop)))
    with pytest.raises(RuntimeError,match='no completó'):
        llm.call_llm([{'role':'user','content':'Clasifica'}],provider='anthropic')


def test_existing_openai_request_keeps_temperature_and_classifier_model(monkeypatch):
    r=Mock(status_code=200,json=Mock(return_value={'choices':[{'message':{'content':'OK'}}]}))
    post=Mock(return_value=r);monkeypatch.setattr(llm.requests,'post',post)
    assert llm.call_llm([{'role':'user','content':'Hola'}],model='gpt-4.1-mini')=='OK'
    assert post.call_args.kwargs['json']['temperature']==0
    assert post.call_args.kwargs['json']['model']=='gpt-4.1-mini'


def test_wrong_provider_model_is_rejected_before_network(monkeypatch):
    post=Mock();monkeypatch.setattr(llm.requests,'post',post)
    with pytest.raises(ValueError,match='CLASSIFIER_MODEL'):
        llm.call_llm([{'role':'user','content':'Clasifica'}],provider='anthropic',model='gpt-4.1-mini')
    post.assert_not_called()


def test_analysis_gets_json_instruction_and_larger_budget_without_changing_chat(monkeypatch):
    post=Mock(return_value=response());monkeypatch.setattr(llm.requests,'post',post)
    llm.call_llm([{'role':'user','content':'Clasifica'}],provider='anthropic',model='claude-haiku-5-5',max_tokens=450,json_output=True)
    assert post.call_args.kwargs['json']['max_tokens']==1024
    assert 'JSON válido' in post.call_args.kwargs['json']['system']
    llm.call_llm([{'role':'user','content':'Hola'}],provider='anthropic',max_tokens=200)
    assert post.call_args.kwargs['json']['max_tokens']==200


def test_explanation_instead_of_json_is_a_failure_not_an_analysis(monkeypatch):
    monkeypatch.setattr(llm.requests,'post',Mock(return_value=response([{'type':'text','text':'Analizo la conversación y parece humano.'}])))
    with pytest.raises(RuntimeError,match='JSON válido'):
        llm.call_llm([{'role':'user','content':'Clasifica'}],provider='anthropic',json_output=True)
