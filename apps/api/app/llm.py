"""
Shared LLM helper — routes to OpenAI, DeepSeek or Anthropic.

Priority:
  1. OPENAI_API_KEY   → OpenAI  (gpt-4o-mini)
  2. DEEPSEEK_API_KEY → DeepSeek (deepseek-chat)
  3. None             → raises RuntimeError

All calls pass through llm_guard (concurrency semaphore, exponential-backoff
retry, and circuit breaker). Import PRIORITY_LIVE / PRIORITY_BATCH from here
and pass them as the `priority` keyword argument to call_llm().
"""
import logging
import os
import json

import requests

from app.llm_guard import (  # noqa: F401 — re-exported for callers
    PRIORITY_BATCH,
    PRIORITY_LIVE,
    guarded_call,
)

log = logging.getLogger(__name__)

OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

OPENAI_MODEL   = "gpt-4o-mini"
DEEPSEEK_MODEL = "deepseek-chat"
ANTHROPIC_MODEL = os.getenv('ANTHROPIC_MODEL', 'claude-haiku-5-5')


class LLMText(str):
    """Texto compatible con callers existentes, con identidad devuelta por la API."""
    def __new__(cls, value, *, provider, model, requested_model=None):
        text = super().__new__(cls, value)
        text.provider, text.model, text.requested_model = provider, model, requested_model or model
        return text


def response_metadata(value, requested_model=None):
    return {'model': getattr(value, 'model', None) or requested_model,
            'provider': getattr(value, 'provider', None),
            'model_requested': getattr(value, 'requested_model', None) or requested_model,
            'analysis_origin': 'llm'}


def active_provider() -> str:
    """Selección explícita opcional; agregar una clave no cambia el proveedor actual."""
    selected = os.getenv('LLM_PROVIDER', '').strip().lower()
    if selected and selected != 'auto':
        if selected not in ('openai', 'deepseek', 'anthropic'):
            raise RuntimeError('LLM_PROVIDER debe ser openai, deepseek, anthropic o auto')
        return selected
    if OPENAI_API_KEY:
        return "openai"
    if DEEPSEEK_API_KEY:
        return "deepseek"
    if ANTHROPIC_API_KEY:
        return 'anthropic'
    return "none"


def provider_credentials(provider=None):
    return {'openai': OPENAI_API_KEY, 'deepseek': DEEPSEEK_API_KEY,
            'anthropic': ANTHROPIC_API_KEY}.get(provider or active_provider(), '')


def call_llm(
    messages: list,
    max_tokens: int = 300,
    temperature: float = 0,
    priority: int = PRIORITY_BATCH,
    model: str | None = None,
    provider: str | None = None,
    json_output: bool = False,
) -> str:
    """
    Send messages to the active LLM provider and return the response text.
    All calls are routed through llm_guard (semaphore + retry + circuit breaker).
    Pass priority=PRIORITY_LIVE for real-time Chat IA calls.
    `model` overrides the provider's model. `provider` permits an isolated
    evaluation without changing the active provider used by Chat IA.
    Raises RuntimeError if no API key is configured.
    """
    selected = provider or active_provider()
    if not provider_credentials(selected):
        raise RuntimeError('No hay clave configurada para el proveedor de IA seleccionado')
    if selected == 'openai':
        return guarded_call(_call_openai, messages, max_tokens, temperature, model, priority=priority)
    if selected == 'deepseek':
        return guarded_call(_call_deepseek, messages, max_tokens, temperature, priority=priority)
    if selected == 'anthropic':
        return guarded_call(_call_anthropic, messages, max_tokens, temperature, model, json_output, priority=priority)
    raise RuntimeError('Proveedor de IA no reconocido')


def _call_anthropic(messages: list, max_tokens: int, temperature: float, model: str | None = None,
                    json_output: bool = False) -> str:
    """Adaptador de texto, sin cambiar prompts ni reglas del clasificador (2026-10-14)."""
    from app.service_health import ensure_available, inspect_response
    selected_model = model or ANTHROPIC_MODEL
    if not selected_model.startswith('claude-'):
        raise ValueError('Anthropic requiere un modelo Claude; configura CLASSIFIER_MODEL para este proveedor')
    system, conversation = [], []
    for message in messages:
        role, content = message.get('role'), message.get('content', '')
        if not isinstance(content, str):
            raise ValueError('El adaptador Claude admite mensajes de texto')
        if role == 'system' and not conversation:
            system.append(content)
        elif role in ('user', 'assistant'):
            conversation.append({'role': role, 'content': content})
        else:
            raise ValueError('Rol no compatible con el adaptador Claude')
    if not conversation or conversation[-1]['role'] != 'user':
        raise ValueError('Claude requiere que la solicitud termine con un mensaje de usuario')
    if json_output:
        system.append('Devuelve exclusivamente un objeto JSON válido con los campos solicitados. '
                      'No escribas introducciones, explicaciones externas ni bloques Markdown. '
                      'Las justificaciones van dentro de los campos del JSON, nunca fuera.')
    # Prueba real 2026-10-14: 450 cortó 3/10 análisis JSON aun sin thinking.
    # El tope no se cobra por adelantado; Chat IA conserva su presupuesto corto.
    output_limit = max(max_tokens, 1024) if model is not None else max_tokens
    payload = {'model': selected_model, 'messages': conversation, 'max_tokens': output_limit,
               # Evitar que los presupuestos cortos de Chat IA y JSON se consuman en thinking.
               'thinking': {'type': 'disabled'}}
    if system:
        payload['system'] = '\n\n'.join(system)
    # Haiku 5.5 rechaza temperature=0; los otros proveedores conservan ese parámetro.
    ensure_available('anthropic', ANTHROPIC_API_KEY)
    response = requests.post('https://api.anthropic.com/v1/messages',
        headers={'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01',
                 'Content-Type': 'application/json'}, json=payload, timeout=30)
    data = inspect_response('anthropic', ANTHROPIC_API_KEY, response)
    if data.get('stop_reason') in ('max_tokens', 'refusal', 'model_context_window_exceeded'):
        raise RuntimeError('Claude no completó la respuesta; no se usará un análisis truncado')
    text = ''.join(block.get('text', '') for block in data.get('content', []) if block.get('type') == 'text').strip()
    if not text:
        raise RuntimeError('Claude devolvió una respuesta sin texto utilizable')
    if json_output:
        try:
            decoded = json.loads(text)
        except (ValueError, TypeError) as error:
            raise RuntimeError('Claude no devolvió JSON válido; el resultado no se usará como análisis') from error
        if not isinstance(decoded, dict):
            raise RuntimeError('Claude no devolvió un objeto JSON válido para el análisis')
    return LLMText(text, provider='anthropic', model=data.get('model') or selected_model,
                   requested_model=selected_model)


def _call_openai(messages: list, max_tokens: int, temperature: float, model: str | None = None) -> str:
    from app.service_health import ensure_available, inspect_response
    ensure_available('openai', OPENAI_API_KEY)
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}",
                 "Content-Type": "application/json"},
        json={"model": model or OPENAI_MODEL, "messages": messages,
              "max_tokens": max_tokens, "temperature": temperature},
        timeout=30,
    )
    data = inspect_response('openai', OPENAI_API_KEY, resp)
    return LLMText(data["choices"][0]["message"]["content"].strip(), provider='openai',
                   model=data.get('model') or model or OPENAI_MODEL, requested_model=model or OPENAI_MODEL)


def _call_deepseek(messages: list, max_tokens: int, temperature: float) -> str:
    from app.service_health import ensure_available, inspect_response
    ensure_available('deepseek', DEEPSEEK_API_KEY)
    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                 "Content-Type": "application/json"},
        json={"model": DEEPSEEK_MODEL, "messages": messages,
              "max_tokens": max_tokens, "temperature": temperature},
        timeout=30,
    )
    data = inspect_response('deepseek', DEEPSEEK_API_KEY, resp)
    return LLMText(data["choices"][0]["message"]["content"].strip(), provider='deepseek',
                   model=data.get('model') or DEEPSEEK_MODEL, requested_model=DEEPSEEK_MODEL)
