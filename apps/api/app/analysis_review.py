"""Estado de revisión del análisis: lectura y funciones puras, sin ejecutar IA."""
from datetime import datetime, timezone


def utc(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def review_state(entry, latest_at=None, replied=False, fallback_at=None):
    from app.classification_compare import METHODS, _same, to_common
    flags = []
    if not entry or any(not entry.get(m) or entry[m].get('error') or
                        not (entry[m].get('common') or entry[m].get('category')) for m in METHODS):
        flags.append('pending')
    dates = [utc((entry or {}).get(m, {}).get('ran_at')) for m in METHODS]
    method_stamp = min((d for d in dates if d), default=None)
    stamp = utc((entry or {}).get('input_last_at') or (entry or {}).get('hibrido', {}).get('input_last_at')
                or method_stamp or (entry or {}).get('updated_at') or fallback_at)
    latest = utc(latest_at)
    if entry and latest and (not stamp or latest > stamp):
        flags.append('new_messages')
    hybrid = (entry or {}).get('hibrido') or {}
    if replied and hybrid.get('category') not in (None, 'sin_respuesta') and not (
        (hybrid.get('parecido') or {}).get('items') or hybrid.get('rango')
    ):
        flags.append('pending')
    categories = [(entry or {}).get(m, {}).get('common') for m in METHODS]
    different = any(_same(a, b) is False for i, a in enumerate(categories) for b in categories[i+1:])
    items = (hybrid.get('parecido') or {}).get('items') or []
    if items and categories[-1] and to_common(items[0].get('category'), items[0].get('is_ai')) != categories[-1]:
        different = True
    if different:
        flags.append('different_results')
    flags = list(dict.fromkeys(flags))
    return {'flags': flags, 'status': flags[0] if flags else 'current',
            'latest_message_at': latest, 'analyzed_at': stamp, 'replied': replied}


def attach_reviews(manager, rows, comparisons):
    """Gas Líquido/Hidrogas (2026-10-13): revisar salientes nuevos también.

    Se calcula antes de paginar para que los filtros incluyan todas las empresas.
    """
    from app.classifier import assign_thread_numbers, phone_last10
    ids = [r['company_id'] for r in rows]
    if not ids:
        return
    histories = {}
    for m in manager.db.message_logs.find(
        {'company_id': {'$in': ids}, 'direction': {'$in': ['inbound', 'outbound']}, 'status': {'$ne': 'failed'}},
        {'company_id': 1, 'direction': 1, 'created_at': 1, 'to_number': 1, 'from_number': 1, 'related_to_number': 1},
        sort=[('created_at', 1)],
    ):
        histories.setdefault(m['company_id'], []).append(m)
    for row in rows:
        doc = comparisons.get(row['company_id'])
        messages = assign_thread_numbers(histories.get(row['company_id'], []))
        latest = max((m['created_at'] for m in messages if m.get('created_at')), default=None)
        replied = any(m['direction'] == 'inbound' for m in messages)
        row['comparison'] = doc
        row['review'] = review_state(doc, latest, replied)
        entries = {n['number']: n for n in (doc or {}).get('numbers', [])}
        all_flags = list(row['review']['flags'])
        for number in row.get('numbers', []):
            n10 = phone_last10(number.get('number'))
            thread = [m for m in messages if (phone_last10(m.get('related_to_number')) or m['_num']) == n10]
            last = max((m['created_at'] for m in thread if m.get('created_at')), default=None)
            entry = entries.get(n10)
            if not entries and len(row.get('numbers', [])) == 1:
                entry = doc
            number['review'] = review_state(entry, last, any(m['direction'] == 'inbound' for m in thread), (doc or {}).get('updated_at'))
            all_flags.extend(number['review']['flags'])
        row['review']['flags'] = list(dict.fromkeys(all_flags))
        row['review']['status'] = next((flag for flag in ('new_messages', 'pending', 'different_results')
                                      if flag in row['review']['flags']), 'current')
