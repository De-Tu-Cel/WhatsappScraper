"""Country-aware extraction normalization; never derive an address from mobile prefixes."""
import re
from urllib.parse import unquote, urlparse

import phonenumbers


def international_spans(text):
    """Protect whole explicit international numbers from local regex slicing."""
    return [(m.start, m.end, m.raw_string) for m in phonenumbers.PhoneNumberMatcher(
        text, 'GB', leniency=phonenumbers.Leniency.POSSIBLE)
        if m.raw_string.lstrip().startswith(('+', '00'))]


def site_country(url, country=None):
    from app.searcher import COUNTRY_CONFIG, _normalize_country_name
    if country:
        region = str(country).strip().lower()
        for name, cfg in COUNTRY_CONFIG.items():
            if region == cfg.get('bd_country') or (region == 'uk' and cfg.get('bd_country') == 'gb'):
                return name
        return _normalize_country_name(country)
    host = (urlparse(url).hostname or '').lower().rstrip('.')
    # Country-specific domains are a fallback hint, not a verified address.
    for name, cfg in COUNTRY_CONFIG.items():
        region = cfg.get('bd_country', '').lower()
        suffix = '.uk' if region == 'gb' else '.' + region
        if region and host.endswith(suffix):
            return name
    return None


def normalize_extracted_phone(raw, calling_code='+52', region=None):
    text = unquote(str(raw or '')).strip()
    text = re.sub(r'^tel:', '', text, flags=re.I)
    text = re.split(r'(?:;ext=|\bext\.?\s*|\bextension\s*|\banexo\s*)', text, maxsplit=1, flags=re.I)[0]
    if re.search(r'[A-Za-z]', text):
        return None
    digits = re.sub(r'\D', '', text)
    if not digits or len(digits) > 15:
        return None
    international = text.startswith('+') or text.startswith('00')
    if text.startswith('00'):
        digits = digits[2:]
    # Historical MX mobile format is normalized regardless of search country.
    if len(digits) == 13 and digits.startswith('521'):
        digits = '52' + digits[3:]
        international = True
    code = (calling_code or '').lstrip('+')
    if not international and code == '52' and len(digits) == 13 and digits[:3] in ('044', '045'):
        digits = digits[3:]
    if not region and code:
        region = phonenumbers.region_code_for_country_code(int(code))
    try:
        if international:
            number = phonenumbers.parse('+' + digits, None)
        else:
            if not region:
                return None  # No silent MX fallback for an unsupported explicit country.
            number = phonenumbers.parse(digits, region)
            # WhatsApp and JSON often omit '+' from full international numbers.
            # Only prefer that interpretation when the local parse is impossible.
            if not phonenumbers.is_possible_number(number):
                number = phonenumbers.parse('+' + digits, None)
        if not phonenumbers.is_possible_number(number):
            return None
        return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    except (phonenumbers.NumberParseException, ValueError):
        return None
