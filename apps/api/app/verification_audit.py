"""Durable verification attempts. No raw phone numbers, tokens or error bodies."""
import time
import uuid
from datetime import datetime, timezone


def service_details(raw):
    """Accept only acknowledgement fields; never persist arbitrary service errors."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    if isinstance(raw.get('lookup_started'), bool):
        out['lookup_started'] = raw['lookup_started']
    for key in ('request_id', 'started_at', 'finished_at'):
        if isinstance(raw.get(key), str):
            out[key] = raw[key][:64]
    if raw.get('outcome') in ('registered', 'not_registered', 'error'):
        out['outcome'] = raw['outcome']
    if type(raw.get('client_calls')) is int and 0 <= raw['client_calls'] <= 2:
        out['client_calls'] = raw['client_calls']
    return out


def begin(db, instance, source, *, contact_id=None, company_id=None):
    attempt = {
        '_id': uuid.uuid4().hex, 'instance_name': instance, 'source': source,
        'contact_id': str(contact_id) if contact_id is not None else None,
        'company_id': str(company_id) if company_id is not None else None,
        'started_at': datetime.now(timezone.utc), 'finished_at': None,
        'status': 'pending', 'lookup_started': False, 'cap_released': False,
    }
    # If durable recording fails, do not launch an untraceable lookup.
    db.db.phone_verification_attempts.insert_one(attempt)
    return attempt


def finish(db, attempt, status, duration_ms, **fields):
    db.db.phone_verification_attempts.update_one({'_id': attempt['_id']}, {'$set': {
        'status': status, 'finished_at': datetime.now(timezone.utc),
        'duration_ms': max(0, round(duration_ms)), **fields,
    }})


def cap_rejected(db, instance, source, doc):
    attempt = begin(db, instance, source, contact_id=doc['_id'], company_id=doc.get('company_id'))
    finish(db, attempt, 'daily_cap_rejected', 0, cap_reserved=False, lookup_started=False)


def verify_with_audit(db, instance, phone, *, source, contact_id=None, company_id=None,
                      send_before=None, lookup=None, cap_reserved=False):
    from app.whatsapp_wwebjs import verify_number, registration_status, LineBusy, SendWindowClosed
    attempt = begin(db, instance, source, contact_id=contact_id, company_id=company_id)
    started = time.monotonic()
    # None means we may have dispatched but have no service acknowledgement.
    db.db.phone_verification_attempts.update_one({'_id': attempt['_id']}, {'$set': {
        'status': 'dispatching', 'lookup_started': None, 'cap_reserved': cap_reserved,
    }})
    try:
        kwargs = {'request_id': attempt['_id']}
        if send_before is not None:
            kwargs['send_before'] = send_before
        result = (lookup or verify_number)(instance, phone, **kwargs)
    except Exception as exc:
        exc.verification_attempt_id = attempt['_id']
        metadata = service_details(getattr(exc, 'verification', {}))
        not_started = isinstance(exc, (LineBusy, SendWindowClosed))
        finish(db, attempt, 'deferred' if not_started else 'error', (time.monotonic() - started) * 1000,
               lookup_started=False if not_started else metadata.get('lookup_started'),
               error_type=type(exc).__name__, service=metadata)
        raise
    result = result if isinstance(result, dict) else {}
    metadata = service_details(result.get('verification'))
    value = registration_status(result)
    finish(db, attempt, 'registered' if value is True else 'not_registered' if value is False else 'unknown',
           (time.monotonic() - started) * 1000, registered=value,
           # Older service versions do not acknowledge whether a lookup started.
           lookup_started=metadata.get('lookup_started'), service=metadata)
    return result
