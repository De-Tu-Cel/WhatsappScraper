"""Bounded business evidence for industry classification; no I/O or credentials."""
import re
import unicodedata

from bs4 import BeautifulSoup


def fold(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.lower())
                   if not unicodedata.combining(c))


def industry_context(text, soup, company_name='', maps_category=''):
    # Work on a copy: removing forms/navigation must not affect contact scraping.
    clean = BeautifulSoup(str(soup), 'html.parser')
    parts = []
    if company_name:
        parts.append(f'Empresa: {company_name}')
    if maps_category:
        parts.append(f'Categoria del establecimiento: {maps_category}')
    for node in clean.select('title, meta[name="description"], meta[property="og:description"]'):
        value = node.get('content', '') if node.name == 'meta' else node.get_text(' ', strip=True)
        if value:
            parts.append(value[:700])
    for node in list(clean.select('script, style, nav, header, footer, form, select, noscript, [role="navigation"], [role="menu"], [role="dialog"], [hidden], [aria-hidden="true"]')):
        if node.parent is not None:
            node.decompose()
    headings = [node.get_text(' ', strip=True)[:200] for node in clean.select('h1, h2, h3')][:18]
    parts.extend(headings)
    body = clean.select_one('main, article, [role="main"]') or clean
    content = body.get_text(' ', strip=True)
    # Only use the raw text when no HTML was supplied, e.g. a search giro.
    if not str(soup).strip():
        content = text
    parts.append(content[:4200])
    seen = set()
    unique = []
    for part in parts:
        if part.strip() and part not in seen:
            seen.add(part)
            unique.append(part)
    return '\n'.join(unique)[:6500]


# Specific service phrases; broad words such as "gas", "technology", "events"
# or "distribution" alone are not enough to override other evidence.
SERVICE_CUES = {
    'Telecomunicaciones': (
        r'\b(?:telecomunicaciones|telecommunications|operador movil)\b',
        r'\b(?:telefonia movil|telefonia fija|planes moviles|planes postpago)\b',
        r'\b(?:internet de fibra|fibra optica|servicios moviles)\b',
    ),
    'Gases industriales / Medicinales': (
        r'\b(?:gases industriales|gases medicinales|industrial gases|medical gases)\b',
        r'\b(?:oxigeno medicinal|oxigeno industrial|medical oxygen)\b',
    ),
    'Transporte / Logística': (
        r'\b(?:transporte de carga|transporte terrestre|transportadora de carga|freight transport)\b',
        r'\b(?:carga masiva|carga semimasiva|carga semi masiva|freight forwarding)\b',
        r'\b(?:servicios logisticos|logistica de distribucion)\b',
    ),
    'Gas LP / Energía': (
        r'\b(?:gas lp|gas natural|gas licuado|gas propano|glp|liquefied petroleum gas)\b',
        r'\b(?:distribucion de gas|distribuidora de gas|venta de gas|gasera)\b',
    ),
    'Editorial / Publicaciones': (
        r'\b(?:editorial cientifica|publicaciones cientificas|research publisher|academic publisher|scientific publisher)\b',
        r'\b(?:revistas cientificas|scientific journals|open access publisher)\b',
    ),
    'Veterinaria': (r'\b(?:veterinaria|veterinario|veterinary|animal hospital)\b',),
}


def specific_industry(context):
    normalized = fold(context)
    scores = {category: sum(bool(re.search(pattern, normalized)) for pattern in patterns)
              for category, patterns in SERVICE_CUES.items()}
    ranked = sorted(((score, category) for category, score in scores.items() if score), reverse=True)
    # Conflicting equally strong service evidence needs the LLM or review.
    if not ranked or (len(ranked) > 1 and ranked[0][0] == ranked[1][0]):
        return ''
    return ranked[0][1]


_GENERIC = {'telefono', 'telefonos', 'phone', 'contacto', 'contact', 'accesorio',
            'accesorios', 'productos', 'servicios', 'evento', 'eventos', 'menu',
            'legal', 'derecho', 'industrial', 'distribucion', 'tecnologia', 'tienda'}


def keyword_industry(context, categories):
    normalized = fold(context)
    scores = {}
    for category, keywords in categories.items():
        hits = set()
        for keyword in keywords:
            term = fold(keyword)
            if term not in _GENERIC and re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', normalized):
                hits.add(term)
        # Count distinct evidence, not repetitions or the length of a keyword list.
        if hits:
            scores[category] = sum(3 if ' ' in term else 1 for term in hits)
    ranked = sorted(scores, key=scores.get, reverse=True)
    if not ranked or (len(ranked) > 1 and scores[ranked[0]] == scores[ranked[1]]):
        return 'No detectada'
    return ranked[0]
