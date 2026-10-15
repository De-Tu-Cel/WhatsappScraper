"""Verificación diferida de teléfonos guardados; no envía mensajes (2026-10-14)."""
import logging
import os
import random
import threading
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
import pytz
from app.daily_cap import reserve_verification_slot
from app.whatsapp_wwebjs import get_all_connected_instances, verify_number, registration_status

log = logging.getLogger(__name__)
INITIAL_DELAY = 30
MIN_PAUSE, MAX_PAUSE = 20, 40
LEASE_SECONDS = 90


def within_working_hours(now=None):
    """Lunes a viernes, 09:00–18:00 CDMX; fuera de horario no consultar WA."""
    local = (now or datetime.now(timezone.utc)).astimezone(pytz.timezone('America/Mexico_City'))
    try:
        start = int(os.getenv('PHONE_VERIFICATION_START_HOUR', '9'))
        end = int(os.getenv('PHONE_VERIFICATION_END_HOUR', '18'))
    except ValueError:
        return False
    return 0 <= start < end <= 24 and local.weekday() < 5 and start <= local.hour < end


def rotating_candidates(names, last_instance=None):
    """Turnos deterministas: continuar después de la última sesión utilizada."""
    names = sorted(set(names))
    if not names or not last_instance:
        return names
    index = next((i for i, name in enumerate(names) if name > last_instance), 0)
    return names[index:] + names[:index]


def pending_filter(now):
    return {'type': 'phone', '$and': [
        {'$or': [{'verified': {'$exists': False}},
                 # Negativos antiguos sin fecha: no sabemos si la consulta fue válida.
                 {'verified': False, 'wa_checked_at': {'$exists': False}},
                 {'verified': 'checking', 'verification_lease_until': {'$lte': now}},
                 {'verified': 'checking', 'verification_lease_until': {'$exists': False}}]},
        {'$or': [{'verification_retry_at': {'$exists': False}}, {'verification_retry_at': {'$lte': now}}]},
        {'$or': [{'created_at': {'$exists': False}}, {'created_at': {'$lte': now - timedelta(seconds=INITIAL_DELAY)}}]},
    ]}


def process_next(db):
    """Un número por turno, con exclusión y pausa compartidas entre procesos."""
    now = datetime.now(timezone.utc)
    if not within_working_hours(now):
        return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'outside_schedule'}
    candidates = get_all_connected_instances(db) or []
    if not candidates:
        return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'disconnected'}
    token = uuid.uuid4().hex
    control = db.db.phone_verification_control
    control.update_one({'_id': 'pace'}, {'$setOnInsert': {'next_at': now + timedelta(seconds=INITIAL_DELAY)}}, upsert=True)
    slot = control.find_one_and_update(
        {'_id': 'pace', 'next_at': {'$lte': now}, '$or': [
            {'lease_until': {'$exists': False}}, {'lease_until': {'$lte': now}}]},
        {'$set': {'token': token, 'lease_until': now + timedelta(seconds=LEASE_SECONDS)}, '$inc': {'turn': 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not slot:
        return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'paced'}
    doc = None
    try:
        doc = db.db.contacts.find_one_and_update(
            pending_filter(now), {'$set': {'verified': 'checking', 'verification_token': token,
                                         'verification_lease_until': now + timedelta(seconds=LEASE_SECONDS)}},
            # Cuatro turnos recientes por uno antiguo: el backlog no bloquea nuevas empresas.
            sort=[('created_at', 1 if slot.get('turn', 1) % 5 == 0 else -1), ('_id', 1)],
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            return {'checked': 0, 'promoted': 0, 'paused': False}
        # El cursor persiste en Mongo: reinicios y otros workers continúan la rotación.
        candidates = rotating_candidates(candidates, slot.get('last_instance'))
        if not within_working_hours():
            _retry(db, doc, token, now)
            return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'outside_schedule'}
        instance = next((name for name in candidates if reserve_verification_slot(db, name)), None)
        if not instance:
            _retry(db, doc, token, now)
            return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'daily_cap'}
        moved = control.update_one({'_id': 'pace', 'token': token}, {'$set': {'last_instance': instance}})
        if not moved.matched_count:
            _retry(db, doc, token, now)
            return {'checked': 0, 'promoted': 0, 'paused': True, 'reason': 'lease_lost'}
        local = datetime.now(timezone.utc).astimezone(pytz.timezone('America/Mexico_City'))
        closing = local.replace(hour=min(19, int(os.getenv('PHONE_VERIFICATION_END_HOUR', '18'))),
                                minute=0, second=0, microsecond=0)
        try:
            result = registration_status(verify_number(instance, doc['value'], send_before=closing.isoformat()))
        except Exception as exc:
            from app.whatsapp_wwebjs import LineBusy, SendWindowClosed
            if isinstance(exc, (LineBusy, SendWindowClosed)):
                # The service explicitly confirmed no lookup started.
                from app.daily_cap import _today
                db.db.instance_daily_verifications.update_one(
                    {'instance': instance, 'date': _today(), 'count': {'$gt': 0}},
                    {'$inc': {'count': -1}},
                )
            raise
        if result is None:
            _retry(db, doc, token, now)
            return {'checked': 1, 'promoted': 0, 'pending': 1, 'paused': True, 'reason': 'unavailable'}
        fields = {'verified': result, 'wa_valid': result, 'wa_checked_at': now}
        if result:
            fields.update(type='whatsapp', detected_via='phone_verification')
        updated = db.db.contacts.update_one(
            {'_id': doc['_id'], 'verification_token': token},
            {'$set': fields, '$unset': {'verification_token': '', 'verification_lease_until': '', 'verification_retry_at': ''}},
        )
        if updated.modified_count:
            db.db.jid_map.update_one({'jid': ''.join(filter(str.isdigit, doc['value']))},
                                    {'$set': {'wa_valid': result, 'wa_checked_at': now}}, upsert=True)
        if result and updated.modified_count:
            db.update_company(str(doc['company_id']), {'has_whatsapp': True})
        return {'checked': 1, 'promoted': int(result and bool(updated.modified_count)), 'paused': False}
    except Exception:
        if doc:
            _retry(db, doc, token, now)
        log.warning('Consulta de WhatsApp pendiente; se reintentará sin marcar el teléfono como inválido.')
        return {'checked': int(doc is not None), 'promoted': 0, 'pending': int(doc is not None), 'paused': True, 'reason': 'unavailable'}
    finally:
        control.update_one({'_id': 'pace', 'token': token}, {
            '$set': {'next_at': datetime.now(timezone.utc) + timedelta(seconds=random.uniform(MIN_PAUSE, MAX_PAUSE))},
            '$unset': {'token': '', 'lease_until': ''},
        })


def _retry(db, doc, token, now):
    db.db.contacts.update_one({'_id': doc['_id'], 'verification_token': token}, {
        '$unset': {'verified': '', 'verification_token': '', 'verification_lease_until': ''},
        '$set': {'verification_retry_at': now + timedelta(minutes=5)},
    })


def start_phone_verification_worker():
    stop = threading.Event()
    # Las pausas no garantizan ausencia de restricciones. No recorrer el
    # historial al desplegar sin una activación expresa (2026-10-14).
    if os.getenv('PHONE_VERIFICATION_AUTO_ENABLED', 'false').lower() != 'true':
        stop.set()
        log.info('Verificación automática desactivada; los teléfonos conservan su estado pendiente.')
        return stop

    def run():
        from app.database import MongoDBManager
        # Importar este módulo no arranca workers; QA sigue usando solo rutas.
        while not stop.wait(INITIAL_DELAY):
            try:
                process_next(MongoDBManager())
            except Exception:
                log.warning('Verificación diferida en pausa; se volverá a intentar.')

    threading.Thread(target=run, name='phone-verification', daemon=True).start()
    return stop
