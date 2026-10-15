"""Avisos preventivos para admins; gasto de OpenAI nunca se presenta como saldo."""
import math
import os
from datetime import datetime, timezone, timedelta

from app import service_health as health


def _limit(name, default):
    try:
        value = float(os.getenv(name, default))
        return value if math.isfinite(value) and value >= 0 else default
    except (ValueError, TypeError):
        return default


def limits():
    warning = _limit('DATAFORSEO_LOW_BALANCE_USD', 5)
    return {'openai_monthly_budget_usd': _limit('OPENAI_MONTHLY_BUDGET_USD', 10),
            'dataforseo_warning_usd': warning,
            'dataforseo_critical_usd': min(warning, _limit('DATAFORSEO_CRITICAL_BALANCE_USD', 1))}


def _key(service):
    provider, credentials = health.configured_services()[service]
    if service == 'ai':
        from app.billing import OPENAI_PROJECT_ID
        credentials = f'{credentials}:{OPENAI_PROJECT_ID}'
    return 'balance:' + health.account_id(provider, credentials)


def _read(key):
    with health._lock:
        value = dict(health._states.get(key) or {})
    if health._store is not None:
        try:
            value = health._store.find_one({'_id': key}) or value
        except Exception:
            pass
    return value


def record_balance(service, data):
    """Solo muestras válidas; una consulta fallida no inventa un saldo nuevo."""
    if not data.get('ok'):
        return
    try:
        amount = float(data['balance' if service == 'dataforseo' else 'spend_this_month'])
    except (KeyError, ValueError, TypeError):
        return
    if not math.isfinite(amount):
        return
    now = datetime.now(timezone.utc)
    settings = limits()
    if service == 'dataforseo':
        # Saldo agotado usa el aviso de pausa existente, sin duplicarlo.
        level = ('critical' if amount <= settings['dataforseo_critical_usd'] else
                 'warning' if amount <= settings['dataforseo_warning_usd'] else None) if amount > 0 else None
        period = None
        budget = None
    else:
        budget = settings['openai_monthly_budget_usd']
        level = ('critical' if amount >= budget * .95 else 'warning' if amount >= budget * .8 else None) if budget > 0 else None
        period = now.strftime('%Y-%m')
    key = _key(service)
    with health._lock:
        previous = _read(key)
        unchanged = (previous.get('level'), previous.get('period'), previous.get('budget')) == (level, period, budget)
        value = {'service': service, 'amount': amount, 'level': level, 'period': period,
                 'budget': budget, 'checked_at': now,
                 'alert_since': previous.get('alert_since', now) if unchanged else now}
        health._states[key] = value
        if health._store is not None:
            try:
                health._store.update_one({'_id': key}, {'$set': value}, upsert=True)
            except Exception:
                pass


def admin_notifications(since=None):
    now = datetime.now(timezone.utc)
    if since and since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    result = []
    for service in ('ai', 'dataforseo'):
        provider, _ = health.configured_services()[service]
        if service == 'ai' and provider != 'openai':
            continue
        value = _read(_key(service))
        if service == 'ai' and (value.get('period') != now.strftime('%Y-%m') or value.get('budget') != limits()['openai_monthly_budget_usd']):
            continue
        checked = value.get('checked_at')
        if isinstance(checked, datetime) and checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        # No presentar una muestra antigua como una comprobación actual.
        if not checked or now - checked > timedelta(minutes=30) or not value.get('level'):
            continue
        if health.public_status()[service].get('status') == 'blocked':
            continue
        stamp = value['alert_since']
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if since and stamp <= since:
            continue
        result.append({'_id': f'balance:{service}:{stamp.isoformat()}', 'type': 'service_balance',
                       'service': service, 'label': 'OpenAI' if service == 'ai' else 'DataForSEO',
                       'severity': value['level'], 'amount': value['amount'], 'budget': value['budget'],
                       'period': value['period'], 'checked_at': checked.isoformat(),
                       'created_at': stamp.isoformat()})
    return result
