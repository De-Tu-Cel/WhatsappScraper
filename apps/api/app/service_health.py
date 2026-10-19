"""Disponibilidad de proveedores: saldo, credenciales y límites no son resultados vacíos.

Se comparte entre procesos cuando main instala la colección de estados. Los tests y
el backend local sin workers usan memoria; importar este módulo no abre MongoDB.
"""
import hashlib
import threading
from datetime import datetime, timedelta, timezone

_lock = threading.RLock()
_states = {}
_store = None
LABELS = {'openai': 'IA', 'deepseek': 'IA', 'anthropic': 'IA', 'dataforseo': 'DataForSEO'}
MESSAGES = {
    'billing': 'El proveedor no tiene saldo o alcanzó su límite de gasto. Un administrador debe revisar la cuenta.',
    'auth': 'El proveedor rechazó las credenciales. Un administrador debe revisar la configuración.',
    'rate_limit': 'El proveedor limitó temporalmente las solicitudes. Se podrá reintentar en unos momentos.',
    'unavailable': 'El proveedor no está disponible temporalmente. Se podrá reintentar más tarde.',
}


class ServiceUnavailable(RuntimeError):
    def __init__(self, service, reason, retry_at=None):
        self.service, self.reason, self.retry_at = service, reason, retry_at
        super().__init__(f'{LABELS.get(service, service)}: {MESSAGES[reason]}')


def configure_store(collection):
    global _store
    _store = collection


def account_id(service, credentials):
    return service + ':' + hashlib.sha256(str(credentials).encode()).hexdigest()[:20]


def state(service, credentials):
    key = account_id(service, credentials)
    with _lock:
        result = dict(_states.get(key) or {})
    if _store is not None:
        try:
            persisted = _store.find_one({'_id': key})
            if persisted:
                result = persisted
        except Exception:
            pass  # El diagnóstico local sigue disponible si Mongo no responde.
    result.pop('_id', None)
    return result or {'service': service, 'status': 'unknown', 'reason': None, 'message': None}


def record(service, credentials, reason=None):
    now = datetime.now(timezone.utc)
    previous = state(service, credentials)
    seconds = {'billing': 900, 'auth': 1800, 'rate_limit': 30, 'unavailable': 60}.get(reason, 0)
    value = {'service': service, 'status': 'blocked' if reason else 'available', 'reason': reason,
             'blocked_since': (previous.get('blocked_since') or previous.get('checked_at') or now) if reason and previous.get('reason') == reason else now if reason else None,
             'message': MESSAGES.get(reason), 'checked_at': now, 'retry_at': now + timedelta(seconds=seconds) if reason else None}
    key = account_id(service, credentials)
    with _lock:
        _states[key] = value
    if _store is not None:
        try:
            _store.update_one({'_id': key}, {'$set': value}, upsert=True)
        except Exception:
            pass
    return value


def reset(service, credentials):
    key = account_id(service, credentials)
    with _lock:
        _states.pop(key, None)
    if _store is not None:
        _store.delete_one({'_id': key})


def ensure_available(service, credentials):
    value = state(service, credentials)
    retry = value.get('retry_at')
    if isinstance(retry, str):
        retry = datetime.fromisoformat(retry.replace('Z', '+00:00'))
    if retry and retry.tzinfo is None:
        retry = retry.replace(tzinfo=timezone.utc)
    if value.get('status') == 'blocked' and retry and retry > datetime.now(timezone.utc):
        raise ServiceUnavailable(service, value['reason'], retry)


def inspect_response(service, credentials, response, *, mark_success=True):
    """OpenAI: leer code/type; DataForSEO: leer también los estados de cada task."""
    try:
        data = response.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    error = data.get('error') or {}
    if not isinstance(error, dict):
        error = {}
    codes = [data.get('status_code')] + [t.get('status_code') for t in (data.get('tasks') or []) if isinstance(t, dict)]
    words = ' '.join(str(error.get(k) or '') for k in ('code', 'type', 'message')).lower()
    code = response.status_code
    reason = None
    if code == 402 or any(c in (40200, 40203, 40210) for c in codes) or any(w in words for w in (
        'insufficient_quota', 'insufficient_balance', 'no credits remaining', 'credit_balance_too_low',
        'spend_limit_exceeded', 'usage_limit_exceeded', 'billing_hard_limit',
        'credit balance is too low', 'credit balance exhausted',
    )):
        reason = 'billing'
    elif code in (401, 403) or any(c in (40100, 40104, 40201, 40204, 40207) for c in codes):
        reason = 'auth'
    elif code == 429 or any(c in (40202, 40209) for c in codes):
        reason = 'rate_limit'
    elif code >= 500 or any(c in (40101, 40103) or (isinstance(c, int) and c >= 50000) for c in codes):
        reason = 'unavailable'
    if reason:
        value = record(service, credentials, reason)
        raise ServiceUnavailable(service, reason, value['retry_at'])
    response.raise_for_status()
    if not data:
        value = record(service, credentials, 'unavailable')
        raise ServiceUnavailable(service, 'unavailable', value['retry_at'])
    # No atribuir saldo agotado a una ubicación inválida u otro error de consulta.
    if service == 'dataforseo' and any(c not in (None, 20000, 20100, 40102, 40106) for c in codes):
        raise RuntimeError('DataForSEO no pudo completar la consulta; revisa los datos de búsqueda.')
    if mark_success:
        record(service, credentials)
    return data


def configured_services():
    from app import llm
    import os
    provider = llm.active_provider()
    credential = llm.provider_credentials(provider)
    search_key = os.getenv('DATAFORSEO_LOGIN', '') + ':' + os.getenv('DATAFORSEO_PASSWORD', '')
    return {'ai': (provider, credential), 'dataforseo': ('dataforseo', search_key)}


def public_status():
    services = {}
    for name, (provider, credentials) in configured_services().items():
        configured = provider != 'none' and (all(credentials.split(':', 1)) if name == 'dataforseo' else bool(credentials))
        value = state(provider, credentials) if configured else {'status': 'not_configured', 'reason': None}
        services[name] = {**value, 'configured': configured, 'label': 'IA' if name == 'ai' else 'DataForSEO'}
    return services


def warnings():
    return [{'service': name, 'reason': value.get('reason'), 'message': value.get('message')}
            for name, value in public_status().items() if value.get('status') == 'blocked']


def admin_notifications(since=None):
    """Avisos vigentes para admins; un fallo repetido no genera otro aviso."""
    if since and since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    result = []
    for name, value in public_status().items():
        if value.get('status') != 'blocked':
            continue
        stamp = value.get('blocked_since') or value.get('checked_at')
        if isinstance(stamp, str):
            stamp = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if not stamp:
            continue
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if since and stamp <= since:
            continue
        result.append({'_id': f'service:{name}:{stamp.isoformat()}', 'type': 'service_health',
                       'service': name, 'label': value['label'], 'reason': value['reason'],
                       'message': value.get('message'), 'created_at': stamp.isoformat()})
    from app.balance_alerts import admin_notifications as balance_notifications
    return result + balance_notifications(since)


def dataforseo_credentials():
    return configured_services()['dataforseo'][1]


def start_balance_monitor(interval=300):
    """Comprobar saldo de búsqueda sin gastar en búsquedas ni tokens de IA."""
    import logging
    stop = threading.Event()

    def run():
        from app.billing import get_dataforseo_balance, get_openai_spend, get_anthropic_spend
        while not stop.is_set():
            try:
                get_dataforseo_balance()
                # Costs es una consulta administrativa; no genera completions ni búsquedas.
                if configured_services()['ai'][0] == 'openai':
                    get_openai_spend()
                elif configured_services()['ai'][0] == 'anthropic':
                    get_anthropic_spend()
            except Exception:
                logging.getLogger(__name__).warning('No se pudo comprobar el saldo de búsqueda.')
            stop.wait(interval)

    worker = threading.Thread(target=run, name='provider-balance-monitor', daemon=True)
    worker.start()
    return stop
