# searcher.py
import os
import requests
import concurrent.futures
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")

EXCLUDED_DOMAINS = {
    # Enciclopedias
    'wikipedia.org', 'wikimedia.org', 'wikidata.org',
    # Video
    'youtube.com', 'youtu.be', 'vimeo.com',
    # Redes sociales
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
    'linkedin.com', 'pinterest.com', 'snapchat.com', 'threads.net',
    # Buscadores y mapas
    'google.com', 'google.com.mx', 'maps.google.com', 'bing.com', 'duckduckgo.com',
    # Directorios de negocios
    'yelp.com', 'yelp.com.mx', 'tripadvisor.com', 'tripadvisor.com.mx',
    'cylex.mx', 'cylex.com', 'cylex-mexico.com',
    'seccion-amarilla.com', 'paginasamarillas.com.mx', 'paginas-amarillas.mx',
    'foursquare.com', 'empresasdebogota.com', 'empresite.com',
    'hotfrog.mx', 'hotfrog.com', 'dnbmx.com',
    'infobel.com', 'kompass.com', 'manta.com',
    # E-commerce y marketplaces
    'mercadolibre.com', 'amazon.com', 'amazon.com.mx', 'ebay.com',
    'walmart.com', 'walmart.com.mx', 'liverpool.com.mx', 'soriana.com',
    # Blogs y revistas de comida/viajes
    'directoalpaladar.com.mx', 'directoalpaladar.com',
    'foodandtravel.mx', 'foodandpleasure.com', 'foodandwine.com',
    'travelmania.mx', 'wayak.mx', 'booking.com', 'airbnb.com',
    'timeout.com', 'eltenedor.es', 'thefork.com',
    # Noticias y medios
    'eluniversal.com.mx', 'milenio.com', 'excelsior.com.mx',
    'reforma.com', 'jornada.com.mx', 'proceso.com.mx',
    'infobae.com', 'expansion.mx', 'forbes.com.mx',
    # Software de restaurantes / SaaS
    'bistrosoft.com', 'poster.com', 'square.com', 'toast.com',
    # Foros y preguntas
    'reddit.com', 'quora.com', 'yahoo.com', 'answers.com',
    # Gobierno
    'gov.mx', 'gob.mx', 'imss.gob.mx', 'sat.gob.mx',
    # Otros
    'apple.com', 'play.google.com',
}


def _is_business_url(url: str) -> bool:
    try:
        domain = urlparse(url).netloc.lower().lstrip('www.')
        return bool(domain) and not any(domain == ex or domain.endswith('.' + ex) for ex in EXCLUDED_DOMAINS)
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
]

def _build_variations(industry: str, city: str = "") -> list[str]:
    ind = industry.strip()
    if city.strip():
        loc = city.strip()
        return [
            f"{ind} {loc} contacto teléfono dirección",
            f"{ind} {loc} página oficial",
            f"{ind} {loc} sitio web whatsapp",
            f"{ind} {loc} -directorio -blog -revista -tripadvisor -yelp",
            f"site:.mx {ind} {loc} contacto",
            f"{ind} {loc} número teléfono dirección",
            f"{ind} cerca de {loc} página web",
        ]
    else:
        # Sin ciudad: combina queries genéricas + rotación por ciudades principales
        base = [
            f"{ind} México contacto teléfono dirección",
            f"{ind} México página oficial",
            f"site:.mx {ind} contacto whatsapp",
            f"{ind} México -directorio -blog -tripadvisor -yelp",
            f"{ind} México sitio web oficial",
        ]
        city_queries = [
            f"{ind} {c} contacto teléfono" for c in MAJOR_CITIES
        ]
        return base + city_queries


def _fetch_ddg(query: str, max_results: int = 40) -> list[str]:
    from ddgs import DDGS
    urls = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, region="mx-es", max_results=max_results):
                href = r.get("href")
                if href and _is_business_url(href):
                    urls.append(href)
    except Exception:
        pass
    return urls


def search_prospects(industry: str, city: str = "", keywords: str = "", num_results: int = 10, offset: int = 0) -> list:
    if SERPAPI_KEY:
        query = f"{industry.strip()} empresa en {city.strip() or 'México'}"
        if keywords.strip():
            query = f"{keywords.strip()} {query}"
        return _search_via_serpapi(query, num_results, offset)
    return _search_via_duckduckgo(industry, city)


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


def _search_via_duckduckgo(industry: str, city: str = "") -> list:
    variations = _build_variations(industry, city)

    # Ejecutar todas las variaciones en paralelo
    all_raw: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(variations)) as executor:
        futures = {executor.submit(_fetch_ddg, v, 40): v for v in variations}
        for future in concurrent.futures.as_completed(futures):
            try:
                all_raw.extend(future.result())
            except Exception:
                pass

    # Deduplicar por dominio (no por URL exacta) para máxima variedad
    seen_domains: set[str] = set()
    unique: list[str] = []
    for url in all_raw:
        domain = _get_domain(url)
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            unique.append(url)

    return unique
