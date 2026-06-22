# searcher.py
import os
import re
import json
import requests
import concurrent.futures
from urllib.parse import urlparse
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

SERPAPI_KEY  = os.getenv("SERPAPI_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

EXCLUDED_DOMAINS = {
    # Enciclopedias
    'wikipedia.org', 'wikimedia.org', 'wikidata.org',
    # Video
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
    # Redes sociales
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'linkedin.com', 'pinterest.com', 'snapchat.com', 'threads.net',
    # Buscadores y mapas
    'google.com', 'google.com.mx', 'maps.google.com', 'bing.com', 'duckduckgo.com',
    # Directorios de negocios
    'yelp.com', 'yelp.com.mx', 'tripadvisor.com', 'tripadvisor.com.mx',
    'cylex.mx', 'cylex.com', 'cylex-mexico.com', 'cybo.com',
    'seccion-amarilla.com', 'seccionamarilla.com.mx',
    'paginasamarillas.com.mx', 'paginas-amarillas.mx',
    'foursquare.com', 'empresasdebogota.com', 'empresite.com',
    'hotfrog.mx', 'hotfrog.com', 'dnbmx.com',
    'infobel.com', 'kompass.com', 'manta.com',
    'infoisinfo.com', 'infoisinfo.com.mx',
    'salir.com', 'mx.salir.com',
    'bripemedia.com', 'design.bripemedia.com',
    'tusalondeeventos.com', 'peluquerias.com.mx',
    'monterrey10.com.mx',
    # Directorios de agenda / reservas
    'agendapro.com', 'fresha.com', 'mindbodyonline.com',
    'treatwell.com', 'booksy.com', 'vagaro.com',
    # Clasificados y directorios de servicios
    'locanto.com', 'locanto.com.mx',
    'vivanuncios.com.mx', 'segundamano.mx',
    'bodas.com.mx', 'zankyou.com.mx',
    # Directorios de salones de marca (L'Oréal, Kérastase, etc.)
    'lorealprofessionnel.com', 'salones-es.lorealprofessionnel.com',
    'hair-salon-en.lorealprofessionnel.com',
    'kerastase.com', 'kerastase.com.mx',
    'schwarzkopfpro.com', 'schwarzkopf.com.mx',
    'wella.com', 'wella.com.mx',
    # Empleo
    'occ.com', 'occ.com.mx', 'indeed.com', 'indeed.com.mx',
    'computrabajo.com', 'bumeran.com',
    # Aerolíneas, cadenas nacionales (no prospectos locales)
    'aeromexico.com', 'volaris.com', 'vivaaerobus.com',
    'sephora.com.mx', 'maccosmetics.com', 'clinique.com',
    # Mapas y directorios geográficos
    'mapquest.com', 'yellowpages.com', 'superpages.com',
    'grandhotelier.com', 'spa.grandhotelier.com',
    # E-commerce y marketplaces
    'mercadolibre.com', 'amazon.com', 'amazon.com.mx', 'ebay.com',
    'walmart.com', 'walmart.com.mx', 'liverpool.com.mx', 'soriana.com',
    # Blogs y revistas de comida/viajes
    'directoalpaladar.com.mx', 'directoalpaladar.com',
    'foodandtravel.mx', 'foodandpleasure.com', 'foodandwine.com',
    'travelmania.mx', 'wayak.mx', 'booking.com', 'airbnb.com',
    'timeout.com', 'eltenedor.es', 'thefork.com',
    # Noticias y medios nacionales
    'eluniversal.com.mx', 'milenio.com', 'excelsior.com.mx',
    'reforma.com', 'jornada.com.mx', 'proceso.com.mx',
    'infobae.com', 'expansion.mx', 'forbes.com.mx', 'forbes.com',
    'elfinanciero.com.mx', 'eleconomista.com.mx',
    'cnnespanol.cnn.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
    'nytimes.com', 'washingtonpost.com', 'theguardian.com',
    'sdpnoticias.com', 'aristeguinoticias.com', 'sinembargo.mx',
    'animalpolitico.com', 'nexos.com.mx', 'letraslibres.com',
    'esmas.com', 'televisa.com', 'azteca.com', 'aztecauno.com',
    'mediotiempo.com', 'record.com.mx', 'marca.com', 'as.com',
    'elimparcial.com', 'debate.com.mx', 'noroeste.com',
    'heraldo.mx', 'heraldodemexico.com.mx', 'publimetro.com.mx',
    '24horas.mx', 'sopitas.com', 'elpais.com', 'larazondemexico.com.mx',
    # Revistas y medios de negocios/estilo de vida
    'entrepreneur.com', 'entrepreneur.com.mx',
    'merca20.com', 'altonivel.com.mx', 'soyentrepreneur.com',
    'businessinsider.com', 'businessinsider.mx',
    'hola.com', 'cosmopolitan.com', 'vogue.com', 'elle.com',
    'gq.com', 'esquire.com', 'menshealth.com', 'shape.com',
    'health.com', 'healthline.com', 'webmd.com', 'mayoclinic.org',
    'verywellfit.com', 'mensjournal.com', 'runnersworld.com',
    # Agregadores / SEO / directorios de artículos
    'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com',
    'wix.com', 'squarespace.com',
    'slideshare.net', 'scribd.com', 'issuu.com',
    # Software de restaurantes / SaaS
    'bistrosoft.com', 'poster.com', 'square.com', 'toast.com',
    'lightspeedhq.com', 'restroworks.com', 'loyverse.com',
    # Foros y preguntas
    'reddit.com', 'quora.com', 'yahoo.com', 'answers.com',
    'forocoches.com', 'taringa.net', 'hispachan.org',
    # Gobierno
    'gov.mx', 'gob.mx', 'imss.gob.mx', 'sat.gob.mx',
    # Otros
    'apple.com', 'play.google.com', 'spotify.com', 'soundcloud.com',
    'eventbrite.com', 'ticketmaster.com', 'meetup.com',
    # Franquicias y cadenas nacionales (cientos de sucursales, no son un negocio local contactable)
    'smartfit.com', 'smartfit.com.mx', 'oxxo.com', '7-eleven.com.mx',
    'starbucks.com', 'starbucks.com.mx', 'mcdonalds.com', 'mcdonalds.com.mx',
    'dominospizza.com.mx', 'pizzahut.com.mx', 'subway.com', 'kfc.com',
    'burger-king.com.mx', 'vips.com.mx', 'sanborns.com.mx', 'walmart.com.mx',
    'sams.com.mx', 'costco.com.mx', 'soriana.com', 'chedraui.com.mx',
    'bodegaaurrera.com.mx', 'heb.com.mx', 'superama.com.mx',
    'liverpool.com.mx', 'sanborns.com.mx', 'sears.com.mx', 'palacio.com.mx',
    'izzi.mx', 'totalplay.com.mx', 'megacable.com.mx', 'telmex.com',
    'telcel.com', 'att.com.mx', 'movistar.com.mx',
    # Asociaciones, cámaras y federaciones gremiales
    'canirac.org.mx', 'coparmex.org.mx', 'concamin.org.mx', 'canacintra.org.mx',
    'amfac.com.mx', 'conacero.org.mx', 'canaco.org.mx', 'amvo.org.mx',
    'anade.org.mx', 'anpact.com.mx', 'cmic.org.mx',
}


EXCLUDED_PATH_PATTERNS = [
    '/blog/', '/blogs/', '/noticias/', '/noticia/', '/articulo/', '/articulos/',
    '/news/', '/post/', '/posts/', '/tag/', '/tags/', '/category/', '/categoria/',
    '/archivo/', '/archive/', '/author/', '/autor/',
    '/opinion/', '/editorial/', '/prensa/', '/press/', '/media/',
    '/wiki/', '/revista/', '/magazine/', '/columna/', '/columnas/',
    '/nota/', '/notas/', '/reportaje/', '/reportajes/', '/tendencias/',
    '/actualidad/', '/mundo/', '/economia/', '/finanzas/', '/salud/',
    '/lifestyle/', '/entrevista/', '/entrevistas/',
    # Páginas de resultados / listados de directorios
    '/resultados/', '/busqueda/', '/buscar/', '/search/',
    '/directorio/', '/listado/', '/listing/', '/listings/',
    '/salones-de-belleza/', '/salones/', '/negocios/',
    '/ciudades/', '/ciudad/', '/estados/', '/estado/',
    '/nuevo-leon/', '/monterrey/', '/cdmx/',
    # Páginas de empleo en directorios
    '/empleos/', '/empleo/', '/jobs/', '/vacantes/',
    # Páginas de proveedores/distribuidores de marcas
    '/salon-finder', '/salon-finder/', '/find-a-salon', '/find-a-salon/',
    '/salones-peluqueria', '/hair-salon/', '/peluquerias/',
    # Páginas de mapa/región genérica
    '/in/mx-', '/lp/en/', '/mp/mx/',
    # Páginas de asociaciones / contenido sectorial genérico
    '/sector/', '/industria/', '/gremio/', '/asociacion/', '/camara/',
    '/tendencias/', '/estadisticas/', '/mercado/', '/analisis-de-mercado/',
    '/informe/', '/reporte/', '/estudio/', '/investigacion/',
    '/franquicias/', '/franquicia/', '/sucursales/', '/sucursal/',
    '/encuentra-tu/', '/find-your/', '/localizador/', '/locator/',
]

EXCLUDED_TLD_PATTERNS = ['.edu.mx', '.gob.mx', '.gov.mx', '.edu.']

# Matches article-style date slugs in paths: /2023/, /2024/01/, /2025/01/15/
_DATE_IN_PATH = re.compile(r'/20\d{2}/(?:0[1-9]|1[0-2])?/?')

# Roundup / listicle slug patterns — "los mejores X en Y", "top 10 X", "guía de X", etc.
_LISTICLE_SLUG = re.compile(
    r'/(los[-_]?mejores|las[-_]?mejores|mejor[-_]|mejores[-_]'
    r'|top[-_]\d|top\d|ranking[-_]|los[-_]?\d+[-_]|las[-_]?\d+[-_]'
    r'|guia[-_]de|guia[-_]|donde[-_]comer|donde[-_]ir|donde[-_]comprar'
    r'|lugares[-_]para|sitios[-_]para|opciones[-_]de|recomendaciones[-_]'
    r'|directorio[-_]de|lista[-_]de|conoce[-_]|descubre[-_]|visita[-_]'
    r'|tipos[-_]de|que[-_]es[-_]|que[-_]son[-_]|como[-_]elegir|como[-_]abrir'
    r'|historia[-_]de|beneficios[-_]de|ventajas[-_]de)',
    re.IGNORECASE,
)

# Domains that are only news/media (checked via substring for subdomains like 'noticias.example.com')
_NEWS_SUBDOMAIN_PREFIXES = ('noticias.', 'blog.', 'news.', 'revista.', 'magazine.')


def _is_business_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower().lstrip('www.')
        if not domain:
            return False
        if any(domain == ex or domain.endswith('.' + ex) for ex in EXCLUDED_DOMAINS):
            return False
        if any(domain.endswith(tld) for tld in EXCLUDED_TLD_PATTERNS):
            return False
        if any(domain.startswith(pfx) for pfx in _NEWS_SUBDOMAIN_PREFIXES):
            return False
        path = parsed.path.lower()
        if any(pat in path for pat in EXCLUDED_PATH_PATTERNS):
            return False
        if _DATE_IN_PATH.search(path):
            return False
        if _LISTICLE_SLUG.search(path):
            return False
        return True
    except Exception:
        return False


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().lstrip('www.')
    except Exception:
        return url


MAJOR_CITIES = [
    "Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Querétaro",
    "León", "Mérida", "Tijuana", "San Luis Potosí", "Aguascalientes",
    "Cancún", "Morelia", "Hermosillo", "Chihuahua", "Veracruz",
    "Saltillo", "Culiacán", "Toluca", "Mexicali", "Torreón",
]

# Sinónimos y términos relacionados por industria para ampliar la búsqueda
INDUSTRY_SYNONYMS: dict[str, list[str]] = {
    "gimnasio":      ["gym", "fitness center", "crossfit", "club deportivo", "smartfit", "iron gym"],
    "gym":           ["gimnasio", "fitness", "crossfit", "club deportivo"],
    "fitness":       ["gimnasio", "gym", "crossfit", "entrenamiento"],
    "restaurante":   ["restaurant", "comida", "gastronómico", "cocina"],
    "taqueria":      ["taquería", "tacos", "antojitos"],
    "dentista":      ["dental", "odontología", "clínica dental", "consultorio dental"],
    "farmacia":      ["farmacia", "droguería", "medicamentos"],
    "veterinaria":   ["veterinario", "clínica veterinaria", "mascotas"],
    "estetica":      ["salón de belleza", "peluquería", "barbería", "spa"],
    "spa":           ["spa", "masajes", "relajación", "wellness"],
    "hotel":         ["hostal", "motel", "posada", "alojamiento"],
    "plomero":       ["plomería", "fontanería", "sanitario"],
    "electricista":  ["electricidad", "instalaciones eléctricas"],
    "abogado":       ["despacho jurídico", "bufete", "legal"],
    "contador":      ["contabilidad", "fiscal", "despacho contable"],
    "ferreteria":    ["ferretería", "materiales", "construcción"],
    "panaderia":     ["panadería", "bakery", "pastelería"],
    "cafeteria":     ["café", "coffee shop", "cafetería"],
    "taller":        ["mecánico", "taller automotriz", "refacciones"],
}


def _build_variations(industry: str, city: str = "") -> list[str]:
    """
    Build DDG query variations designed to return actual business WEBSITES,
    not directories. Key insight: avoid 'contacto teléfono dirección' — those
    terms make DDG return Sección Amarilla / Yelp / Hotfrog.
    """
    ind = industry.strip()
    synonyms = INDUSTRY_SYNONYMS.get(ind.lower(), [])

    if city.strip():
        loc = city.strip()
        queries = [
            f"{ind} {loc}",
            f"{ind} {loc} sitio web",
            f"site:.mx {ind} {loc}",
            f"{ind} {loc} whatsapp",
            f"{ind} {loc} membresía" if "gym" in synonyms or ind.lower() in ("gimnasio", "fitness") else f"{ind} {loc} servicio",
        ]
        for syn in synonyms[:3]:
            queries.append(f"{syn} {loc}")
        return queries

    # Sin ciudad: queries base + por cada ciudad grande + sinónimos
    base = [
        f"{ind} México",
        f"site:.mx {ind}",
        f"{ind} México sitio web",
        f"{ind} México whatsapp",
        f"{ind} México inscripción" if ind.lower() in ("gimnasio", "gym", "fitness") else f"{ind} México servicio",
    ]
    city_queries = [f"{ind} {c}" for c in MAJOR_CITIES]
    synonym_queries = [f"{syn} México" for syn in synonyms[:4]]
    return base + city_queries + synonym_queries


def _fetch_ddg(query: str, max_results: int = 80) -> list[str]:
    from ddgs import DDGS
    urls = []
    try:
        with DDGS() as ddgs:
            # wt-wt = worldwide, evita sesgo por IP del servidor
            # safesearch=off da más resultados de negocios reales
            for r in ddgs.text(query, region="wt-wt", safesearch="off", max_results=max_results):
                href = r.get("href")
                if href and _is_business_url(href):
                    urls.append(href)
    except Exception:
        pass
    return urls


def _ai_filter_urls(urls: list[str], industry: str) -> list[str]:
    """
    Use Groq to rank URLs as real business websites.
    Processes in batches of 60, preserves ALL URLs (ranked first, unranked appended).
    Returns the full list — no cap applied here.
    """
    if not GROQ_API_KEY or not urls:
        return urls

    ranked: list[str] = []
    remaining = list(urls)

    # Process in batches so we rank ALL URLs, not just the first 50
    batch_size = 60
    while remaining:
        batch = remaining[:batch_size]
        remaining = remaining[batch_size:]
        try:
            from groq import Groq
            client = Groq(api_key=GROQ_API_KEY)
            lines = [f"{i+1}. {u}" for i, u in enumerate(batch)]
            prompt = (
                f'Eres un filtro ESTRICTO de URLs. Se buscan ÚNICAMENTE sitios web oficiales '
                f'de negocios LOCALES e INDEPENDIENTES del sector "{industry}" en México.\n\n'
                f'INCLUIR SOLO si es la página oficial de UN negocio específico con dirección física propia:\n'
                f'  ✓ Gimnasio local, restaurante, clínica, tienda, taller, despacho, salón, etc.\n\n'
                f'EXCLUIR SIN EXCEPCIÓN (devuelve lista vacía si ninguna aplica):\n'
                f'  ✗ Artículos, noticias, reportajes, blogs, columnas de opinión\n'
                f'  ✗ Listicles: "Los mejores X", "Top 10", "Guía de", "Dónde ir", "Lugares para"\n'
                f'  ✗ Páginas que LISTAN o MENCIONAN negocios de terceros\n'
                f'  ✗ Revistas, portales de contenido, medios digitales\n'
                f'  ✗ Directorios (Yelp, Sección Amarilla, Hotfrog, Páginas Amarillas, Kompass)\n'
                f'  ✗ Redes sociales, YouTube, Wikipedia, Quora, Reddit\n'
                f'  ✗ Marketplaces (MercadoLibre, Amazon, Uber Eats, Rappi)\n'
                f'  ✗ Franquicias o cadenas NACIONALES con cientos de sucursales (SmartFit, OXXO, 7-Eleven, Starbucks, McDonald\'s, Domino\'s, etc.)\n'
                f'  ✗ Asociaciones gremiales, cámaras de comercio, federaciones del sector\n'
                f'  ✗ Proveedores de software/SaaS para el sector (no son el negocio, son herramientas)\n'
                f'  ✗ Páginas gubernamentales o educativas\n'
                f'  ✗ URLs con /blog/, /noticias/, /articulo/, /post/ o año en la ruta\n\n'
                f'URLs a evaluar:\n' + '\n'.join(lines) + '\n\n'
                f'Responde ÚNICAMENTE con un array JSON de enteros con los números de URLs aprobadas, '
                f'ordenadas de mayor a menor relevancia. Si ninguna califica, responde []. '
                f'Ejemplo: [3, 1, 7] o []'
            )
            resp = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=800,
                temperature=0,
            )
            content = resp.choices[0].message.content.strip()
            m = re.search(r'\[[\d,\s]*\]', content)
            if m:
                indices = json.loads(m.group(0))
                # Solo incluir las aprobadas por Groq — las rechazadas se descartan
                batch_ranked = [batch[i - 1] for i in indices if 1 <= i <= len(batch)]
                ranked.extend(batch_ranked)
                continue
        except Exception:
            pass
        # Fallback sin Groq: mantener el batch tal cual
        ranked.extend(batch)

    return ranked


def search_prospects(
    industry: str,
    city: str = "",
    keywords: str = "",
    num_results: int = 10,
    offset: int = 0,
    exclude_domains: set | None = None,
) -> list:
    if SERPAPI_KEY:
        query = f"{industry.strip()} empresa en {city.strip() or 'México'}"
        if keywords.strip():
            query = f"{keywords.strip()} {query}"
        urls = _search_via_serpapi(query, num_results, offset)
    else:
        urls = _search_via_duckduckgo(industry, city, exclude_domains or set())

    # For SerpAPI path, apply domain exclusion after fetching
    if SERPAPI_KEY and exclude_domains:
        urls = [u for u in urls if _get_domain(u) not in exclude_domains]

    return _ai_filter_urls(urls, industry)  # no cap — caller decides how many to show


def _search_via_serpapi(query: str, num_results: int, offset: int = 0) -> list:
    params = {"q": query, "api_key": SERPAPI_KEY, "num": num_results, "start": offset, "hl": "es", "gl": "mx"}
    resp = requests.get("https://serpapi.com/search", params=params, timeout=30)
    resp.raise_for_status()
    urls = []
    for item in resp.json().get("organic_results", []):
        link = item.get("link")
        if link and link not in urls and _is_business_url(link):
            urls.append(link)
    return urls


def _search_via_duckduckgo(industry: str, city: str = "", exclude_domains: set | None = None) -> list:
    variations = _build_variations(industry, city)
    skip = exclude_domains or set()

    all_raw: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(variations), 25)) as executor:
        futures = {executor.submit(_fetch_ddg, v): v for v in variations}
        for future in concurrent.futures.as_completed(futures):
            try:
                all_raw.extend(future.result())
            except Exception:
                pass

    # Deduplicar por dominio; saltar los que ya están en la BD
    seen_domains: set[str] = set()
    new_urls: list[str] = []
    known_urls: list[str] = []       # already scraped but still returned (lower priority)

    for url in all_raw:
        domain = _get_domain(url)
        if not domain or domain in seen_domains:
            continue
        seen_domains.add(domain)
        if domain in skip:
            known_urls.append(url)   # keep, but push to the end
        else:
            new_urls.append(url)

    # New domains first, already-scraped appended at the end
    return new_urls + known_urls
