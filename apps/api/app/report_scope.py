"""Identidad del número elegido para un reporte, sin mezclar sucursales."""
from app.phone_utils import conversation_phone_key
from datetime import datetime, timezone


def number_matches(stored, requested):
    a, b = conversation_phone_key(stored), conversation_phone_key(requested)
    if a == b:
        return bool(a)
    # Compatibilidad con análisis antiguos que sólo guardaron el número nacional.
    return len(a) == 10 and len(b) >= 10 and a == b[-10:]


def select_number_analytics(analytics, number):
    entries = analytics.get("numbers") or []
    exact = next((n for n in entries if conversation_phone_key(n.get("number")) == conversation_phone_key(number)), None)
    return exact or next((n for n in entries if number_matches(n.get("number"), number)), None)


def report_thread_for_number(thread, number):
    # Diesgas (2026-10-15): mantener cada conversación separada, incluyendo LID
    # cuando sólo se conoce el último destino. Dos países no comparten identidad.
    last_out = None
    selected = []
    for message in thread:
        if message.get("status") == "failed":
            continue
        if message.get("direction") == "outbound":
            address = message.get("to_number")
            last_out = address
        else:
            address = message.get("related_to_number") or message.get("from_number") or message.get("number")
            if not address or "@lid" in str(address):
                address = last_out
        if number_matches(address, number):
            selected.append(message)
    return selected


def first_response_seconds(thread):
    """Evitar convertir 3s a 6s al reutilizar minutos históricos redondeados a 0.1."""
    sent = None
    for message in thread:
        if message.get("status") == "failed":
            continue
        value = message.get("created_at")
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
            if not isinstance(stamp, datetime):
                continue
            stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp
        except ValueError:
            continue
        if message.get("direction") == "outbound" and sent is None:
            sent = stamp
        elif message.get("direction") == "inbound" and sent is not None:
            seconds = (stamp - sent).total_seconds()
            if seconds >= 0:
                return seconds
    return None
