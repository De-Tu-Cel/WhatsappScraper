"""Resolve the sender of a specific conversation, without moving it across lines."""
import re
from bson import ObjectId
from app.phone_utils import conversation_phone_key


def reply_source_instance(db, company_id, phone, inbound_log_id=None):
    if inbound_log_id and ObjectId.is_valid(str(inbound_log_id)):
        message = db.db.message_logs.find_one(
            {'_id': ObjectId(str(inbound_log_id)), 'company_id': company_id, 'direction': 'inbound'},
            {'received_on_instance': 1},
        )
        name = message.get('received_on_instance') if isinstance(message, dict) else None
        if isinstance(name, str) and name.strip():
            return name.strip()
    key = conversation_phone_key(phone)
    if len(key) == 10:
        key = '52' + key
    if not key.isdigit() or len(key) < 11:
        return None
    aliases = [key]
    if key.startswith('52') and len(key) == 12:
        aliases.append('521' + key[2:])
    pattern = r'^\D*(?:' + '|'.join(r'\D*'.join(re.escape(c) for c in n) for n in aliases) + r')(?:@c\.us|@s\.whatsapp\.net)?\D*$'
    message = db.db.message_logs.find_one(
        {'company_id': company_id, 'direction': 'outbound',
         'status': {'$in': ['sent', 'delivered', 'read', 'synced']},
         '$or': [{'to_number': {'$regex': pattern}}, {'number': {'$regex': pattern}}]},
        {'instance_name': 1}, sort=[('created_at', -1)],
    )
    name = message.get('instance_name') if isinstance(message, dict) else None
    return name.strip() if isinstance(name, str) and name.strip() else None
