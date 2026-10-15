"""Respuestas pendientes por indisponibilidad de IA, con lease compartido.

2026-10-14: recargar saldo no debe perder la respuesta ni duplicar una que
ya atendió una persona. Esta cola no reactiva conversaciones cerradas.
"""
from datetime import datetime, timedelta
from uuid import uuid4
from bson import ObjectId
from pymongo import ReturnDocument


def _thread_address(job, direction):
    """Otro teléfono de la empresa no debe cancelar esta respuesta (2026-10-14)."""
    digits = ''.join(c for c in str(job['phone_number']) if c.isdigit())
    variants = {digits}
    if digits.startswith('52') and len(digits) == 12:
        variants.add('521' + digits[2:])
    elif digits.startswith('521') and len(digits) == 13:
        variants.add('52' + digits[3:])
    pattern = r'^\D*(?:' + '|'.join(r'\D*'.join(number) for number in sorted(variants)) + r')(?:@.*)?\D*$'
    address = 'from_number' if direction == 'inbound' else 'to_number'
    # Registros antiguos sin dirección se tratan con cautela: pueden ser del hilo.
    return {'$or': [{address: {'$regex': pattern}}, {address: None}]}


def defer_reply(db, *, session_id, phone_number, company_id, inbound_body,
                inbound_log_id, manual_activation=False, proactive=False, retry_at=None):
    now = datetime.utcnow()
    from app.ai_followup import _get_idle_timeout_hours
    ref = None
    if inbound_log_id and ObjectId.is_valid(str(inbound_log_id)):
        ref = db.db.message_logs.find_one({'_id': ObjectId(str(inbound_log_id))})
    if isinstance(retry_at, str):
        retry_at = datetime.fromisoformat(retry_at.replace('Z', '+00:00'))
    if retry_at and retry_at.tzinfo:
        retry_at = retry_at.replace(tzinfo=None)
    job = {
        'session_id': session_id, 'phone_number': phone_number,
        'company_id': company_id, 'inbound_body': inbound_body,
        'inbound_log_id': inbound_log_id, 'manual_activation': manual_activation,
        'proactive': proactive, 'reference_at': (ref or {}).get('created_at') or now,
        'revision': uuid4().hex, 'status': 'pending', 'updated_at': now,
        'retry_at': retry_at or now + timedelta(minutes=5),
        'expires_at': now + timedelta(hours=_get_idle_timeout_hours(db)),
    }
    db.db.ai_reply_pending.update_one(
        {'_id': f'{company_id}:{phone_number}'},
        {'$set': job, '$setOnInsert': {'created_at': now}, '$unset': {'lease_token': '', 'lease_until': ''}},
        upsert=True,
    )


def current_reason(db, job, now=None):
    """None si sigue vigente. Fallar cerrado si cambió sesión, usuario o turno."""
    now = now or datetime.utcnow()
    current = db.db.ai_reply_pending.find_one({'_id': job['_id']})
    if not current or current.get('revision') != job['revision'] or current.get('lease_token') != job.get('lease_token') or current.get('status') != 'processing':
        return 'superseded'
    if current.get('lease_until', now) <= now:
        return 'lease_expired'
    if job['expires_at'] <= now:
        return 'expired'
    prefs = db.db.conversation_ai_prefs.find_one({'company_id': job['company_id']}) or {}
    if not prefs.get('ai_enabled'):
        return 'ai_disabled'
    session = db.db.ai_followup_sessions.find_one({'_id': job['session_id']}) or {}
    if session.get('company_id') != job['company_id'] or session.get('phone_number') != job['phone_number'] or session.get('status') not in ('active', 'waiting'):
        return 'session_closed'
    from app.ai_followup import _is_blocked_or_blacklisted, _get_idle_timeout_hours
    if session.get('last_activity') and session['last_activity'] <= now - timedelta(hours=_get_idle_timeout_hours(db)):
        return 'session_expired'
    if _is_blocked_or_blacklisted(db, job['company_id'], job['phone_number']):
        return 'blocked'
    latest = db.db.message_logs.find_one(
        {'company_id': job['company_id'], 'direction': 'inbound', **_thread_address(job, 'inbound')},
        sort=[('created_at', -1)])
    if isinstance(latest, dict) and latest.get('_id') and job.get('inbound_log_id') and str(latest['_id']) != str(job['inbound_log_id']):
        return 'newer_inbound'
    if isinstance(latest, dict) and not job.get('inbound_log_id') and latest.get('created_at') and latest['created_at'] > job['reference_at']:
        return 'newer_inbound'
    answered = db.db.message_logs.find_one({
        'company_id': job['company_id'], 'direction': 'outbound',
        **_thread_address(job, 'outbound'),
        'created_at': {'$gt': job['reference_at']}, 'status': {'$nin': ['failed', 'error']},
    })
    if isinstance(answered, dict) and answered.get('_id'):
        return 'already_answered'
    return None


def finish(db, job, status, reason=None, retry_at=None):
    values = {'status': status, 'updated_at': datetime.utcnow(), 'reason': reason}
    if retry_at:
        values['retry_at'] = retry_at.replace(tzinfo=None)
    db.db.ai_reply_pending.update_one(
        {'_id': job['_id'], 'revision': job['revision'], 'lease_token': job.get('lease_token')},
        {'$set': values, '$unset': {'lease_until': '', 'lease_token': ''}},
    )


def queue_due(db, enqueue, limit=3):
    from app.ai_followup import _is_business_hours
    from app.service_health import configured_services, ensure_available, ServiceUnavailable
    if not _is_business_hours():
        return
    provider, credential = configured_services()['ai']
    if provider == 'none':
        return
    try:
        ensure_available(provider, credential)
    except ServiceUnavailable:
        return
    from app.daily_cap import connected_session_names
    connected = connected_session_names(db)
    if not connected:
        return
    for _ in range(limit):
        now = datetime.utcnow()
        token = uuid4().hex
        job = db.db.ai_reply_pending.find_one_and_update({
            'retry_at': {'$lte': now}, '$or': [
                {'status': 'pending'}, {'status': 'processing', 'lease_until': {'$lte': now}}],
        }, {'$set': {'status': 'processing', 'lease_token': token,
                     'lease_until': now + timedelta(minutes=10)}},
            sort=[('retry_at', 1)], return_document=ReturnDocument.AFTER)
        if not isinstance(job, dict):
            break
        reason = current_reason(db, job, now)
        if reason:
            finish(db, job, 'cancelled', reason)
            continue
        co = db.db.companies.find_one({'_id': ObjectId(job['company_id'])}) if ObjectId.is_valid(job['company_id']) else None
        assigned = (co or {}).get('assigned_instance')
        if assigned and assigned not in connected:
            finish(db, job, 'pending', 'instance_disconnected', now + timedelta(minutes=1))
            continue
        enqueue({key: job.get(key) for key in ('phone_number', 'company_id', 'inbound_body', 'inbound_log_id', 'manual_activation', 'proactive')} | {'recovery': job})
