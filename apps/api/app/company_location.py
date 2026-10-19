"""One read model for table and details. No geocoding or database writes."""
import re
import unicodedata


def _fold(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(value or '').casefold())
                   if not unicodedata.combining(c))


def resolve_company_location(company):
    from app.international_phone import site_country
    from app.searcher import COUNTRY_CONFIG, _get_country_config, _normalize_country_name
    result = dict(company)
    extra = company.get('_extra') if isinstance(company.get('_extra'), dict) else {}
    structured = company.get('address') if isinstance(company.get('address'), dict) else {}
    nested = company.get('location') if isinstance(company.get('location'), dict) else {}
    for field in ('city', 'state', 'country', 'postal_code', 'location_source'):
        value = extra.get(field) or nested.get(field)
        if not result.get(field) and isinstance(value, str):
            result[field] = value
    for field, key in [('city', 'addressLocality'), ('state', 'addressRegion'),
                       ('country', 'addressCountry'), ('postal_code', 'postalCode')]:
        value = structured.get(key)
        if not result.get(field) and isinstance(value, str):
            result[field] = value
    if structured:
        result['address'] = structured.get('streetAddress') or ''
    address = result.get('address') or extra.get('address') or ''
    if not isinstance(address, str):
        address = ''
    result['address'] = address
    country = site_country(company.get('website') or 'https://' + (company.get('domain') or ''), result.get('country'))
    if not country:
        named = [name for name in COUNTRY_CONFIG if re.search(r'\b' + re.escape(_fold(name)) + r'\b', _fold(address))]
        country = named[0] if len(named) == 1 else None
    foreign = country and _normalize_country_name(country) not in ('M\u00e9xico', 'MX', 'MEX')
    if foreign and result.get('location_source') == 'lada':
        result['city'] = ''
        result['state'] = ''
        result['location_source'] = 'unconfirmed'
    if not result.get('city') and address:
        cfg = _get_country_config(country) or {}
        found = [city for city in cfg.get('cities', [])
                 if re.search(r'\b' + re.escape(_fold(city)) + r'\b', _fold(address))]
        # Never choose an arbitrary branch from a list of several cities.
        if len(found) == 1:
            result['city'] = found[0]
            result['location_source'] = 'address'
    return result
