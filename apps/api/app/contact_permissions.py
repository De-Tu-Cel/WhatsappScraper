"""Recipient permission and durable suppression, shared across sending lines."""
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from app.phone_utils import clean_digits, conversation_phone_key


def recipient_key(number):
    return conversation_phone_key(clean_digits(str(number or '')))


def requests_opt_out(text):
    text = ''.join(c for c in unicodedata.normalize('NFKD', str(text or '').lower())
                   if not unicodedata.combining(c))
    text = re.sub(r'\s+', ' ', text).strip()
    return (bool(re.fullmatch(r'[\W_]*(?:stop|baja|cancelar suscripcion|unsubscribe)[\W_]*', text))
            or bool(re.search(r'\b(?:no me (?:escribas|escriban|contactes|contacten|mandes mensajes|manden mensajes)|'
                              r'deja de (?:escribirme|contactarme)|dejen de (?:escribirme|contactarme)|'
                              r'eliminame|(?:elimina|eliminen|borra|borren) mi numero|'
                              r'no (?:quiero|deseo) recibir (?:mas )?mensajes|'
                              r'no vuelv(?:as|an) a (?:escribirme|contactarme))\b', text)))


def record_inbound_permission(db, number, text, received_at=None):
    """Inbound grants only a bounded reply window, never outreach consent."""
    key = recipient_key(number)
    if not key or '@' in key:
        return
    stamp = received_at or datetime.now(timezone.utc)
    if stamp.tzinfo:
        stamp = stamp.astimezone(timezone.utc).replace(tzinfo=None)
    stamp = min(stamp, datetime.now(timezone.utc).replace(tzinfo=None))
    if requests_opt_out(text):
        db.db.contact_permissions.update_one({'_id': key}, {'$set': {
            'revoked': True, 'revoked_at': stamp, 'source': 'recipient_opt_out',
        }}, upsert=True)
    else:
        # Does not unset revoked: an unrelated subsequent inbound is not renewed consent.
        db.db.contact_permissions.update_one({'_id': key}, {'$max': {
            'reply_allowed_until': stamp + timedelta(hours=24),
        }}, upsert=True)


def permission_block_reason(db, number, *, purpose='outreach', now=None):
    """Solo bloquea a quien pidió la baja ("stop", "baja", "no me escribas"…).

    Del 2026-10-18 (cf7a74d) al 2026-10-19 también exigía consentimiento
    registrado (outreach_allowed) para cualquier primer mensaje; como no había
    pantalla para registrarlo, en la práctica no salía ningún mensaje a
    prospectos. Decisión del dueño (2026-10-19): para prospectos se vuelve a
    permitir el primer contacto; la baja y la blacklist se respetan siempre.
    record_consent / reply_allowed_until se conservan por si se vuelve a exigir.
    `purpose` y `now` se mantienen por compatibilidad con los llamadores."""
    key = recipient_key(number)
    doc = db.db.contact_permissions.find_one({'_id': key}) if key else None
    if doc and doc.get('revoked'):
        return {'reason': 'opt_out', 'matched': ''}
    return None


def record_consent(db, number, *, source, evidence, actor):
    if source not in {'form', 'contract', 'recorded_request'} or len(evidence.strip()) < 8:
        raise ValueError('Indica el origen y la evidencia del consentimiento del destinatario.')
    key = recipient_key(number)
    if not 10 <= len(key) <= 15 or not key.isdigit():
        raise ValueError('Número no válido')
    stamp = datetime.now(timezone.utc)
    entry = {'source': source, 'evidence': evidence.strip()[:1000], 'actor': str(actor), 'at': stamp}
    db.db.contact_permissions.update_one({'_id': key}, {
        '$set': {'outreach_allowed': True, 'revoked': False, 'consent': entry},
        '$push': {'consent_history': entry},
    }, upsert=True)
