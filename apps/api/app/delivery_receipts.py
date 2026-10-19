"""A durable dispatch claim. An uncertain attempt is never automatically repeated."""
import hashlib
import json
import logging
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError

log = logging.getLogger(__name__)


class DeliveryUncertain(Exception):
    pass


def operation_key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def dispatch_once(db, key, send, *, message_body=None, fingerprint=None):
    collection = db.db.delivery_receipts
    try:
        collection.insert_one({'_id': key, 'status': 'dispatching', 'fingerprint': fingerprint,
                               'created_at': datetime.now(timezone.utc)})
    except DuplicateKeyError:
        previous = collection.find_one({'_id': key}) or {}
        if fingerprint is not None and previous.get('fingerprint') != fingerprint:
            raise DeliveryUncertain('La misma solicitud contiene otro mensaje; revisa el intento original.')
        if previous.get('status') in {'sent', 'failed'}:
            return previous['result']
        raise DeliveryUncertain('Entrega pendiente de revisión; no se repetirá automáticamente.')
    try:
        result = dict(send())
        if not isinstance(result.get('success'), bool):
            raise ValueError('Provider did not confirm a delivery outcome')
        if message_body is not None:
            result['sent_message_body'] = message_body
    except Exception as exc:
        from app.whatsapp_wwebjs import LineBusy, SendWindowClosed
        if isinstance(exc, (LineBusy, SendWindowClosed)):
            # These responses explicitly guarantee the send did not start.
            collection.delete_one({'_id': key, 'status': 'dispatching'})
            raise
        try:
            collection.update_one({'_id': key}, {'$set': {'status': 'uncertain'}})
        except Exception:
            log.exception('Could not persist uncertain delivery %s', key)
        raise DeliveryUncertain('No se pudo confirmar la entrega. Revisa el chat antes de repetir.') from exc
    try:
        collection.update_one({'_id': key}, {'$set': {
            'status': 'sent' if result.get('success') else 'failed',
            'result': result, 'finished_at': datetime.now(timezone.utc),
        }})
    except Exception:
        # The provider result remains authoritative even if persistence is unavailable.
        # The existing dispatching claim prevents an automatic repeat after a crash.
        log.exception('Provider result could not be persisted for %s', key)
    return result
