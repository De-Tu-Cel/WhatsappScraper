"""Nombres públicos recibidos de WhatsApp, separados de etiquetas raspadas."""
from app.phone_utils import conversation_phone_key


def clean_whatsapp_name(value):
    if not isinstance(value, str):
        return ''
    name = ' '.join(value.split())[:150]
    return '' if name.lower() in {'', '-', 'unknown', 'desconocido'} else name


def payload_whatsapp_name(payload):
    if not isinstance(payload, dict):
        return ''
    # No usar name/label: pueden ser el nombre guardado en la agenda o un botón web.
    for key in ('whatsappName', 'pushName', 'notifyName'):
        name = clean_whatsapp_name(payload.get(key))
        if name:
            return name
    return ''


def whatsapp_name_for_number(number, messages, contacts=()):
    wanted = conversation_phone_key(number)
    for message in reversed(messages):
        if message.get('direction') != 'inbound':
            continue
        actual = conversation_phone_key(message.get('related_to_number') or message.get('from_number') or message.get('number'))
        if len(actual) == 10 and wanted.startswith('52') and len(wanted) == 12:
            actual = '52' + actual
        if actual != wanted:
            continue
        name = (clean_whatsapp_name(message.get('whatsapp_name'))
                if message.get('whatsapp_name_source') == 'whatsapp' else '')
        name = name or payload_whatsapp_name(message.get('raw_data'))
        if name:
            return name
    for contact in contacts:
        if (contact.get('whatsapp_name_source') == 'whatsapp'
                and conversation_phone_key(contact.get('value')) == wanted):
            name = clean_whatsapp_name(contact.get('whatsapp_name'))
            if name:
                return name
    return ''
