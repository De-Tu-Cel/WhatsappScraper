"""Read-only rule checks using the same matchers as scraping and sending."""
from urllib.parse import urlsplit


def check_saved_rules(db, kind, value):
    from app.pipeline import _domain_matches, _industry_matches
    from app.send_guard import phone_key, is_phone_blacklisted
    from app.searcher import EXCLUDED_DOMAINS

    value = value.strip()
    normalized = value
    if kind == 'domain':
        parsed = urlsplit(value if '://' in value else 'https://' + value)
        normalized = (parsed.hostname or '').lower().removeprefix('www.')
        if not normalized or '.' not in normalized or any(c.isspace() for c in normalized):
            raise ValueError('Introduce un dominio o una URL válida')
    elif kind == 'phone':
        normalized = phone_key(value)
        if len(normalized) < 7:
            raise ValueError('Introduce un teléfono con al menos 7 dígitos')
    elif kind != 'industry':
        raise ValueError('Tipo de regla inválido')
    if not value or len(value) > 500:
        raise ValueError('Introduce un valor de hasta 500 caracteres')

    entries = list(db.db.blacklist.find({'type': kind}, {'value': 1}))
    matches = []
    if kind == 'phone':
        # Match the send guard's suffix rule, not a new phone-number heuristic.
        if is_phone_blacklisted(db, value):
            matches = [{'value': e['value'], 'source': 'saved', 'type': kind}
                       for e in entries if str(e.get('value', '')).endswith(normalized)]
    else:
        matcher = _domain_matches if kind == 'domain' else _industry_matches
        matches = [{'value': e['value'], 'source': 'saved', 'type': kind}
                   for e in entries if e.get('value') and matcher(normalized, e['value'].lower().strip())]
    if kind == 'domain':
        matches.extend({'value': domain, 'source': 'system', 'type': kind}
                       for domain in sorted(EXCLUDED_DOMAINS) if _domain_matches(normalized, domain))
    return {'blocked': bool(matches), 'matches': matches, 'normalized': normalized, 'type': kind,
            'scope': 'saved_rules_and_system_domain_list'}
