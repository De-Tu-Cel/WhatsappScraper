# searcher.py
import os
import re
import json
import requests
import concurrent.futures
from urllib.parse import urlparse, quote_plus
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

SERPAPI_KEY        = os.getenv("SERPAPI_KEY", "")
DEEPSEEK_API_KEY   = os.getenv("DEEPSEEK_API_KEY", "")
OPENAI_API_KEY     = os.getenv("OPENAI_API_KEY", "")

def _brightdata_key() -> str:
    return os.getenv("BRIGHTDATA_SERP_KEY", "")

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
    'oem.com.mx',  # Organización Editorial Mexicana — red de El Sol de X, La Voz de la Frontera, etc.
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
    # Marketplaces y comparadores de autos
    'kavak.com', 'kavak.com.mx', 'seminuevos.com', 'autos.com.mx',
    'autocosmos.com', 'autofact.com.mx', 'autofact.mx',
    'autoline.com.mx', 'cargurus.com', 'neoauto.com',
    'olxautos.com.mx', 'olx.com.mx', 'soloautos.mx', 'soloautos.com.mx',
    'edrive.com.mx', 'motorpasion.com.mx', 'motorpasion.com',
    'autoblog.com', 'cardealerpage.com', 'autobytel.com',
    'car.guru', 'coches.net', 'infocoche.com',
    'segundamano.com.mx',
    # Cadenas nacionales de gasolineras
    'g500.com.mx', 'oxxogas.com', 'bpmexico.com.mx',
    'totalenergies.mx', 'totalenergies.com',
    'exxon.com.mx', 'mobil.com.mx', 'shell.com.mx',
    'hidrosina.com.mx', 'redgas.com.mx', 'energygas.com.mx',
    'petro7.com.mx', 'lupe.com.mx', 'orsan.com.mx',
    # Precios de gasolina / regulación energética
    'energia.gob.mx', 'cre.gob.mx', 'cnh.gob.mx',
    'gasolinamx.com', 'precio-gasolina.mx', 'gasolina.com.mx',
    'gasnatural.mx', 'gas-natural.com.mx',
    'combustibles.com.mx', 'preciosgasolina.mx',
    # Marcas automotrices (corporativos, no negocios locales)
    'toyota.com.mx', 'honda.com.mx', 'nissan.com.mx', 'chevrolet.com.mx',
    'ford.com.mx', 'volkswagen.com.mx', 'kia.com.mx', 'mazda.com.mx',
    'hyundai.com.mx', 'bmw.com.mx', 'mercedesbenz.com.mx', 'audi.com.mx',
    'subaru.com.mx', 'jeep.com.mx', 'ram.com.mx', 'dodge.com.mx',
    'mitsubishi.com.mx', 'suzuki.com.mx', 'renault.com.mx', 'peugeot.com.mx',
    'seat.com.mx', 'acura.com.mx', 'lexus.com.mx', 'infiniti.com.mx',
    'volvo.com.mx', 'fiat.com.mx', 'citroen.com.mx',
    # Refacciones / autopartes (e-commerce, no talleres locales)
    'autozone.com.mx', 'refaccionariamoclis.com', 'oreillyauto.com',
    'napa.com.mx', 'advance-auto.com', 'rockauto.com',
    # Seguros de auto
    'gnp.com.mx', 'axa.com.mx', 'zurich.com.mx', 'qualitas.com.mx',
    'hdi.com.mx', 'mapfre.com.mx', 'ana.com.mx', 'chubb.com',
    'comparaseguros.mx', 'rastreator.mx', 'seguros.com.mx',
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
    '/informacion_general/', '/informacion-general/', '/estatal/',
    # Páginas de resultados / listados de directorios
    '/resultados/', '/busqueda/', '/buscar/', '/search/',
    '/directorio/', '/listado/', '/listing/', '/listings/',
    '/salones-de-belleza/', '/negocios/',
    # Páginas de empleo en directorios
    '/empleos/', '/empleo/', '/jobs/', '/vacantes/',
    # Páginas de proveedores/distribuidores de marcas
    '/salon-finder', '/salon-finder/', '/find-a-salon', '/find-a-salon/',
    '/salones-peluqueria', '/hair-salon/', '/peluquerias/',
    # Páginas de mapa/región genérica
    '/in/mx-', '/lp/en/', '/mp/mx/',
    # Automotriz: páginas de catálogo de modelos / comparadores
    '/modelos/', '/modelo/', '/marca/', '/marcas/',
    '/autos-nuevos/', '/autos-usados/', '/seminuevos/', '/usados/',
    '/ficha-tecnica/', '/especificaciones/', '/specs/',
    '/cotiza/', '/cotizacion/', '/cotizador/', '/cotizaciones/',
    '/precio-del/', '/precios-de/', '/precio-nuevo/', '/precio-usado/',
    '/dealer/', '/concesionarios/', '/agencias/',
    '/comparar-autos/', '/versus/', '/comparativa-de/',
    '/review/', '/reviews/', '/prueba-de-manejo/', '/test-drive/',
    # Gasolineras: páginas de precios / regulación
    '/precio-gasolina/', '/precio-combustible/', '/precios-gasolina/',
    '/gasolineras-cercanas/', '/gasolineras-en/', '/estaciones-de-servicio/',
    '/estacion/', '/estaciones/',
    # Páginas de asociaciones / contenido sectorial genérico
    '/sector/', '/industria/', '/gremio/', '/asociacion/', '/camara/',
    '/tendencias/', '/estadisticas/', '/mercado/', '/analisis-de-mercado/',
    '/informe/', '/reporte/', '/estudio/', '/investigacion/',
    '/franquicias/', '/franquicia/',
    '/find-your/', '/localizador/', '/locator/',
    # Catálogos y páginas de fichas comparativas
    '/catalogo/', '/categorias/', '/subcategoria/', '/subcategorias/',
    '/comparar/', '/comparativa/', '/compare/',
    '/mejores/', '/los-mejores/', '/las-mejores/', '/top-',
    '/recomendados/', '/destacados/', '/populares/', '/favoritos/',
    '/guia-de/', '/guia/', '/donde-encontrar/', '/donde-hay/',
    '/ver-todos/', '/todos-los/', '/todas-las/',
]

EXCLUDED_TLD_PATTERNS = ['.edu.mx', '.gob.mx', '.gov.mx', '.edu.']

# Domains whose *name* reveals they are a catalog/aggregator of multiple businesses.
# Checked against the full registered domain (www-stripped), so it catches
# mejoresrestaurantes.com.mx, directoriodentistas.mx, guiagymcdmx.com, etc.
_CATALOG_DOMAIN = re.compile(
    r'(?:directorios?de|directoriode|guiiade?|guia[-_]?de|guiade'
    r'|listado|ranking[-_]?de|losmejores|lasmejores|mejoresde'
    r'|topde|top[-_]?\d|buscadorde|encuentraen|dondehay'
    r'|catalogo|catalogode|paginas[-_]?amarillas|seccion[-_]?amarilla'
    r'|hotfrog|kompass|cylex|infobel|foursquare|groupon'
    r'|zomato|happycow|opentable|restorando'
    # Automotriz / gasolineras
    r'|gasolineras[-_]?en|gasolineras[-_]?cerca|precio[-_]?gasolina'
    r'|directorio[-_]?auto|autos[-_]?en|autos[-_]?usados[-_]?en'
    r'|seminuevos[-_]?en|concesionarios[-_]?en|agencias[-_]?en'
    r'|comparador[-_]?auto|cotizador[-_]?auto|precioauto'
    # Genéricos adicionales
    r'|encuentratu|buscanegocio|directoriolocal|negociosenlinea'
    r'|empresasmx|empresas[-_]?en|negocios[-_]?en|servicios[-_]?en'
    r'|profesionales[-_]?en|especialistas[-_]?en)',
    re.IGNORECASE,
)

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

# Mexico has hundreds of small local news outlets with "noticias"/"diario"/"vanguardia"
# baked into the domain itself (24-7noticias.com.mx, laplazadiario.com.mx,
# vanguardiaveracruz.mx…) — impossible to enumerate individually, match by substring.
_NEWS_DOMAIN_NAME = re.compile(r'notici|informate|vocero|diario|vanguardia', re.IGNORECASE)

# News headlines rendered as URL slugs read like full sentences — many
# hyphen/underscore-joined words, sometimes ending in a long CMS-generated numeric
# article id ("deberan-reubicar-20-gaseras-en-mexicali-17361106") or a .html/.php
# extension. A real business's own page slug is virtually never this long.
# 5+ separators (6+ words) is the cutoff.
_HEADLINE_SLUG = re.compile(r'(?:[a-z0-9]+[-_]){5,}[a-z0-9]+(?:\.\w+)?/?$', re.IGNORECASE)
_TRAILING_ARTICLE_ID = re.compile(r'-\d{6,}(?:\.\w+)?/?$')


def _is_business_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace('www.', '', 1)
        if not domain:
            return False
        if any(domain == ex or domain.endswith('.' + ex) for ex in EXCLUDED_DOMAINS):
            return False
        if any(domain.endswith(tld) for tld in EXCLUDED_TLD_PATTERNS):
            return False
        if any(domain.startswith(pfx) for pfx in _NEWS_SUBDOMAIN_PREFIXES):
            return False
        if _NEWS_DOMAIN_NAME.search(domain):
            return False
        # Reject domains whose *name* looks like a business catalog/aggregator
        if _CATALOG_DOMAIN.search(domain):
            return False
        path = parsed.path.lower()
        if any(pat in path for pat in EXCLUDED_PATH_PATTERNS):
            return False
        if _DATE_IN_PATH.search(path):
            return False
        if _LISTICLE_SLUG.search(path):
            return False
        if _HEADLINE_SLUG.search(path) or _TRAILING_ARTICLE_ID.search(path):
            return False
        # Query strings with search/filter params are directory result pages, not business sites
        qs = parsed.query.lower()
        if any(k in qs for k in ('q=', 'query=', 'search=', 'keyword=', 'ciudad=', 'categoria=')):
            return False
        return True
    except Exception:
        return False


def _get_domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().replace('www.', '', 1)
    except Exception:
        return url


MAJOR_CITIES = [
    # Las 32 capitales estatales — garantiza cobertura de cada estado de la república
    "Ciudad de México", "Mexicali", "La Paz", "Campeche", "Saltillo",
    "Colima", "Tuxtla Gutiérrez", "Chihuahua", "Durango", "Guanajuato",
    "Chilpancingo", "Pachuca", "Guadalajara", "Toluca", "Morelia",
    "Cuernavaca", "Tepic", "Monterrey", "Oaxaca", "Puebla",
    "Querétaro", "Chetumal", "San Luis Potosí", "Culiacán", "Hermosillo",
    "Villahermosa", "Ciudad Victoria", "Tlaxcala", "Xalapa", "Mérida", "Zacatecas",
    # Metrópolis y ciudades grandes que no son capital pero concentran mucho negocio
    "Tijuana", "Ciudad Juárez", "León", "Zapopan", "Ecatepec",
    "Nezahualcóyotl", "Cancún", "Naucalpan", "Torreón", "Reynosa",
    "Matamoros", "Nuevo Laredo", "Acapulco", "Irapuato", "Celaya",
    "Mazatlán", "Coatzacoalcos", "Poza Rica", "Uruapan", "Veracruz",
    "Tampico", "Ciudad Obregón", "Los Mochis", "Ensenada", "Playa del Carmen",
]

# Países soportados por el buscador — cada uno define el código de teléfono
# default (usado al normalizar números sin lada explícita), los TLDs a
# favorecer con site: en las queries, y una lista de ciudades para el fan-out
# cuando el usuario no especifica ciudad (vacía = solo queries base, sin
# fan-out por ciudad — evita generar decenas de queries irrelevantes para
# países donde no tenemos un listado curado de ciudades).
COUNTRY_CONFIG: dict[str, dict] = {
    # ── Norteamérica ──────────────────────────────────────────────────────────
    "México":         {"phone_code": "+52", "local_digits": 10, "tlds": [".mx", "com.mx"], "gl": "mx", "hl": "es", "bd_country": "mx", "cities": MAJOR_CITIES},
    "Estados Unidos": {"phone_code": "+1",  "local_digits": 10, "tlds": [".com"], "gl": "us", "hl": "en", "bd_country": "us", "cities": [
        "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
        "Philadelphia", "San Antonio", "San Diego", "Dallas", "Miami",
        "Atlanta", "Seattle", "Denver", "Boston", "Las Vegas",
        "Portland", "Minneapolis", "Nashville", "Charlotte", "Jacksonville",
        "Columbus", "Indianapolis", "San Francisco", "San Jose", "Austin",
        "Fort Worth", "Baltimore", "Memphis", "Louisville", "Milwaukee",
        "Albuquerque", "Tucson", "Sacramento", "Kansas City", "Cleveland",
        "Raleigh", "Tampa", "New Orleans", "Orlando", "Arlington",
        "Omaha", "Oakland", "Fresno", "Long Beach", "Virginia Beach",
    ]},
    "Canadá":         {"phone_code": "+1",  "local_digits": 10, "tlds": [".ca"], "gl": "ca", "hl": "en", "bd_country": "ca", "cities": [
        "Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton",
        "Ottawa", "Winnipeg", "Québec", "Hamilton", "Kitchener",
        "Halifax", "Victoria", "Saskatoon", "Regina", "St. John's",
        "Kelowna", "Abbotsford", "Windsor", "London", "Oshawa",
        "Barrie", "Burlington", "Sudbury", "Thunder Bay", "Lethbridge",
        "Red Deer", "Moncton", "Fredericton",
    ]},
    # ── Centroamérica y Caribe ────────────────────────────────────────────────
    "Guatemala":      {"phone_code": "+502", "local_digits": 8, "tlds": ["com.gt"], "gl": "gt", "hl": "es", "bd_country": "gt", "cities": [
        "Ciudad de Guatemala", "Mixco", "Villa Nueva", "San Juan Sacatepéquez",
        "Quetzaltenango", "Escuintla", "Huehuetenango", "Cobán",
        "Chiquimula", "Jalapa", "Zacapa", "Antigua Guatemala",
        "Mazatenango", "Retalhuleu", "San Marcos", "Totonicapán",
        "Petén", "Jutiapa", "Coatepeque", "Salama",
    ]},
    "Honduras":       {"phone_code": "+504", "local_digits": 8, "tlds": ["com.hn"], "gl": "hn", "hl": "es", "bd_country": "hn", "cities": [
        "Tegucigalpa", "San Pedro Sula", "La Ceiba", "Choloma",
        "El Progreso", "Choluteca", "Comayagua", "Juticalpa", "Santa Rosa de Copán",
        "Puerto Cortés", "Siguatepeque", "Danlí", "La Lima", "Villanueva",
        "Tela", "Roatán", "Copán", "Nacaome", "Trujillo",
    ]},
    "El Salvador":    {"phone_code": "+503", "local_digits": 8, "tlds": ["com.sv"], "gl": "sv", "hl": "es", "bd_country": "sv", "cities": [
        "San Salvador", "Soyapango", "Santa Ana", "San Miguel",
        "Mejicanos", "Apopa", "Santa Tecla", "Delgado", "Usulután",
        "Ahuachapán", "Zacatecoluca", "Chalatenango", "Sonsonate",
        "Cojutepeque", "Sensuntepeque", "San Vicente", "La Unión",
    ]},
    "Nicaragua":      {"phone_code": "+505", "local_digits": 8, "tlds": ["com.ni"], "gl": "ni", "hl": "es", "bd_country": "ni", "cities": [
        "Managua", "León", "Masaya", "Matagalpa",
        "Chinandega", "Estelí", "Granada", "Tipitapa", "Juigalpa",
        "Jinotega", "Rivas", "Ocotal", "Somoto", "Boaco",
        "Nueva Segovia", "Bluefields", "Puerto Cabezas",
    ]},
    "Costa Rica":     {"phone_code": "+506", "local_digits": 8, "tlds": ["com.cr"], "gl": "cr", "hl": "es", "bd_country": "cr", "cities": [
        "San José", "Alajuela", "Desamparados", "San Carlos",
        "Pérez Zeledón", "Liberia", "Heredia", "Cartago", "Puntarenas", "Limón",
        "Grecia", "Guápiles", "Nicoya", "Santa Cruz", "Ciudad Quesada",
        "Quepos", "Turrialba", "Cañas", "Palmares", "San Ramón",
    ]},
    "Panamá":         {"phone_code": "+507", "local_digits": 8, "tlds": ["com.pa"], "gl": "pa", "hl": "es", "bd_country": "pa", "cities": [
        "Ciudad de Panamá", "San Miguelito", "Tocumen", "David",
        "La Chorrera", "Colón", "Chitré", "Santiago", "Arraiján",
        "Penonomé", "Las Tablas", "Bocas del Toro", "Paso Canoas",
        "La Palma", "Changuinola", "Aguadulce",
    ]},
    "República Dominicana": {"phone_code": "+1", "local_digits": 10, "tlds": ["com.do"], "gl": "do", "hl": "es", "bd_country": "do", "cities": [
        "Santo Domingo", "Santiago", "La Romana", "San Pedro de Macorís",
        "La Vega", "Puerto Plata", "San Francisco de Macorís", "San Cristóbal", "Higüey",
        "Bonao", "Barahona", "Moca", "Cotuí", "Nagua",
        "Baní", "Jarabacoa", "Azua", "Monte Cristi", "Mao",
    ]},
    # ── Sudamérica ────────────────────────────────────────────────────────────
    "Colombia":       {"phone_code": "+57", "local_digits": 10, "tlds": ["com.co"], "gl": "co", "hl": "es", "bd_country": "co", "cities": [
        "Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena",
        "Cúcuta", "Bucaramanga", "Pereira", "Manizales", "Santa Marta",
        "Ibagué", "Pasto", "Montería", "Villavicencio", "Neiva",
        "Armenia", "Popayán", "Tunja", "Valledupar", "Sincelejo",
        "Florencia", "Yopal", "Riohacha", "Arauca", "Quibdó",
        "Bello", "Itagüí", "Envigado", "Soledad", "Soacha",
        "Palmira", "Floridablanca", "Buenaventura", "Barrancabermeja",
    ]},
    "Venezuela":      {"phone_code": "+58",  "local_digits": 10, "tlds": ["com.ve"], "gl": "ve", "hl": "es", "bd_country": "ve", "cities": [
        "Caracas", "Maracaibo", "Valencia", "Barquisimeto", "Maracay",
        "Maturín", "Barcelona", "Cumaná", "Barinas", "Ciudad Bolívar",
        "Mérida", "San Cristóbal", "Cabimas", "Coro", "Punto Fijo",
        "Puerto La Cruz", "Ciudad Guayana", "Los Teques", "Guanare",
        "Acarigua", "Carúpano", "El Tigre", "Porlamar", "Calabozo",
        "Valle de la Pascua", "Tucupita", "San Fernando de Apure",
    ]},
    "Ecuador":        {"phone_code": "+593", "local_digits": 9,  "tlds": ["com.ec"], "gl": "ec", "hl": "es", "bd_country": "ec", "cities": [
        "Guayaquil", "Quito", "Cuenca", "Santo Domingo", "Machala",
        "Manta", "Portoviejo", "Ambato", "Riobamba", "Esmeraldas",
        "Ibarra", "Loja", "Milagro", "Quevedo", "Latacunga",
        "Durán", "Salinas", "Babahoyo", "Tulcán", "Nueva Loja",
        "Tena", "Guaranda", "Azogues", "Zamora", "Macas",
    ]},
    "Perú":           {"phone_code": "+51",  "local_digits": 9,  "tlds": ["com.pe"], "gl": "pe", "hl": "es", "bd_country": "pe", "cities": [
        "Lima", "Arequipa", "Trujillo", "Chiclayo", "Piura",
        "Iquitos", "Cusco", "Chimbote", "Huancayo", "Tacna",
        "Juliaca", "Ica", "Pucallpa", "Cajamarca", "Sullana",
        "Ayacucho", "Huánuco", "Tumbes", "Puno", "Tarapoto",
        "Huaraz", "Jaén", "Moquegua", "Abancay", "Moyobamba",
        "Puerto Maldonado", "Pasco", "Tingo María", "Yurimaguas",
    ]},
    "Bolivia":        {"phone_code": "+591", "local_digits": 8,  "tlds": ["com.bo"], "gl": "bo", "hl": "es", "bd_country": "bo", "cities": [
        "Santa Cruz de la Sierra", "La Paz", "Cochabamba", "Sucre",
        "Oruro", "Potosí", "Tarija", "Trinidad", "Montero", "Riberalta",
        "El Alto", "Quillacollo", "Warnes", "Yacuiba", "Cobija",
        "Villamontes", "Camiri", "Llallagua", "Sacaba", "Punata",
    ]},
    "Argentina":      {"phone_code": "+54",  "local_digits": 10, "tlds": ["com.ar"], "gl": "ar", "hl": "es", "bd_country": "ar", "cities": [
        "Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Tucumán",
        "La Plata", "Mar del Plata", "Salta", "Santa Fe", "San Juan",
        "Resistencia", "Santiago del Estero", "Corrientes", "Bahía Blanca", "Posadas",
        "Neuquén", "Formosa", "La Rioja", "Catamarca", "San Luis",
        "Santa Rosa", "Viedma", "Rawson", "Río Gallegos", "Ushuaia",
        "Paraná", "Concordia", "San Rafael", "Río Cuarto", "Tandil",
        "Quilmes", "Lanús", "Lomas de Zamora", "General San Martín",
    ]},
    "Chile":          {"phone_code": "+56",  "local_digits": 9,  "tlds": [".cl"],    "gl": "cl", "hl": "es", "bd_country": "cl", "cities": [
        "Santiago", "Valparaíso", "Concepción", "La Serena", "Antofagasta",
        "Temuco", "Rancagua", "Arica", "Iquique", "Puerto Montt",
        "Viña del Mar", "Calama", "Talca", "Osorno", "Coquimbo",
        "Chillán", "Talcahuano", "San Bernardo", "Maipú", "Pudahuel",
        "Quilicura", "Curicó", "Linares", "Los Ángeles", "Valdivia",
        "Punta Arenas", "Ovalle", "Puerto Varas", "Copiapó", "Quillota",
    ]},
    "Paraguay":       {"phone_code": "+595", "local_digits": 9,  "tlds": ["com.py"], "gl": "py", "hl": "es", "bd_country": "py", "cities": [
        "Asunción", "Ciudad del Este", "San Lorenzo", "Luque",
        "Capiatá", "Lambaré", "Fernando de la Mora",
        "Concepción", "Encarnación", "Pedro Juan Caballero",
        "Caaguazú", "Coronel Oviedo", "Villeta", "San Ignacio",
        "Pilar", "Presidente Franco", "Caazapá", "Curuguaty",
    ]},
    "Uruguay":        {"phone_code": "+598", "local_digits": 8,  "tlds": ["com.uy"], "gl": "uy", "hl": "es", "bd_country": "uy", "cities": [
        "Montevideo", "Salto", "Paysandú", "Las Piedras", "Rivera",
        "Maldonado", "Tacuarembó", "Melo", "Mercedes", "Artigas",
        "San José", "Minas", "Colonia del Sacramento", "Canelones",
        "Florida", "Treinta y Tres", "Rocha", "Fray Bentos", "Young",
        "Durazno", "Trinidad", "Paso de los Toros",
    ]},
    "Brasil":         {"phone_code": "+55",  "local_digits": 11, "tlds": ["com.br"], "gl": "br", "hl": "pt", "bd_country": "br", "cities": [
        "São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza",
        "Belo Horizonte", "Manaus", "Curitiba", "Recife", "Porto Alegre",
        "Belém", "Goiânia", "Campinas", "São Luís", "Maceió",
        "Natal", "Teresina", "Campo Grande", "João Pessoa", "Aracaju",
        "Cuiabá", "Macapá", "Porto Velho", "Rio Branco", "Palmas",
        "Boa Vista", "Florianópolis", "Vitória", "Santos", "Ribeirão Preto",
        "Uberlândia", "Sorocaba", "Contagem", "Joinville", "Londrina",
        "Niterói", "São Bernardo do Campo", "Nova Iguaçu", "Duque de Caxias",
        "São Gonçalo", "Guarulhos", "São José dos Campos", "Osasco",
    ]},
    # ── Europa ────────────────────────────────────────────────────────────────
    "España":         {"phone_code": "+34", "local_digits": 9,  "tlds": [".es"], "gl": "es", "hl": "es", "bd_country": "es", "cities": [
        "Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza",
        "Málaga", "Murcia", "Palma", "Las Palmas", "Bilbao",
        "Alicante", "Córdoba", "Valladolid", "Vigo", "Gijón",
        "Granada", "Oviedo", "Badalona", "Hospitalet de Llobregat", "Vitoria",
        "Santa Cruz de Tenerife", "Pamplona", "Almería", "Jerez de la Frontera", "Burgos",
        "Santander", "Castellón", "Albacete", "Logroño", "Salamanca",
        "Huelva", "Badajoz", "Lleida", "Tarragona", "León",
    ]},
    "Portugal":       {"phone_code": "+351", "local_digits": 9, "tlds": [".pt"], "gl": "pt", "hl": "pt", "bd_country": "pt", "cities": [
        "Lisboa", "Porto", "Braga", "Coimbra", "Funchal",
        "Setúbal", "Viseu", "Leiria", "Évora", "Faro",
        "Aveiro", "Almada", "Guimarães", "Vila Nova de Gaia", "Amadora",
        "Matosinhos", "Loures", "Cascais", "Sintra", "Vila Franca de Xira",
        "Barcelos", "Viana do Castelo", "Caldas da Rainha", "Santarém", "Covilhã",
        "Beja", "Portimão", "Lagos", "Torres Vedras",
    ]},
    "Francia":        {"phone_code": "+33", "local_digits": 9,  "tlds": [".fr"], "gl": "fr", "hl": "fr", "bd_country": "fr", "cities": [
        "París", "Marsella", "Lyon", "Toulouse", "Niza",
        "Nantes", "Estrasburgo", "Montpellier", "Bordeaux", "Lille",
        "Rennes", "Reims", "Saint-Étienne", "Le Havre", "Grenoble",
        "Dijon", "Angers", "Tours", "Metz", "Clermont-Ferrand",
        "Aix-en-Provence", "Pau", "Brest", "Limoges", "Perpignan",
        "Amiens", "Orléans", "Besançon", "Mulhouse", "Nîmes",
        "Villeurbanne", "Caen", "Rouen", "Toulon", "Saint-Denis",
    ]},
    "Italia":         {"phone_code": "+39", "local_digits": 10, "tlds": [".it"], "gl": "it", "hl": "it", "bd_country": "it", "cities": [
        "Roma", "Milán", "Nápoles", "Turín", "Palermo",
        "Génova", "Bolonia", "Florencia", "Bari", "Catania",
        "Venecia", "Verona", "Messina", "Padua", "Trieste",
        "Reggio Calabria", "Perugia", "Cagliari", "Brescia", "Prato",
        "Modena", "Reggio Emilia", "Parma", "Livorno", "Foggia",
        "Salerno", "Ferrara", "Sassari", "Ancona", "Siracusa",
        "Bergamo", "Pescara", "Taranto", "Ravenna", "Trento",
    ]},
    "Alemania":       {"phone_code": "+49", "local_digits": 11, "tlds": [".de"], "gl": "de", "hl": "de", "bd_country": "de", "cities": [
        "Berlín", "Hamburgo", "Múnich", "Colonia", "Frankfurt",
        "Stuttgart", "Düsseldorf", "Dortmund", "Essen", "Leipzig",
        "Bremen", "Dresden", "Hanóver", "Núremberg", "Duisburg",
        "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster",
        "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden", "Gelsenkirchen",
        "Braunschweig", "Chemnitz", "Kiel", "Aachen", "Halle",
        "Magdeburg", "Freiburg", "Krefeld", "Erfurt", "Mainz",
        "Lübeck", "Rostock", "Oberhausen", "Kassel", "Saarbrücken",
    ]},
    "Reino Unido":    {"phone_code": "+44", "local_digits": 10, "tlds": [".co.uk"], "gl": "uk", "hl": "en", "bd_country": "gb", "cities": [
        "Londres", "Birmingham", "Manchester", "Leeds", "Liverpool",
        "Sheffield", "Bristol", "Edinburgh", "Leicester", "Coventry",
        "Bradford", "Cardiff", "Nottingham", "Glasgow", "Southampton",
        "Portsmouth", "Plymouth", "Wolverhampton", "Derby", "Stoke-on-Trent",
        "Sunderland", "Middlesbrough", "Huddersfield", "Reading", "Milton Keynes",
        "Northampton", "Luton", "Bolton", "Aberdeen", "Swansea",
        "Belfast", "Dundee", "Brighton", "Hull", "York",
    ]},
}
DEFAULT_COUNTRY = "México"

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
    # Automotriz — concesionarias / agencias / talleres / refacciones
    "concesionaria":   ["agencia de autos", "distribuidor autorizado", "agencia automotriz", "ventas de autos"],
    "concesionarias":  ["agencia de autos", "distribuidor autorizado", "agencia automotriz", "ventas de autos"],
    "concesionario":   ["agencia de autos", "distribuidor autorizado", "agencia automotriz", "ventas de autos"],
    "concesionarios":  ["agencia de autos", "distribuidor autorizado", "agencia automotriz", "ventas de autos"],
    "agencia de autos":       ["concesionaria", "distribuidor autorizado", "automotriz"],
    "agencias de autos":      ["concesionaria", "distribuidor autorizado", "automotriz"],
    "distribuidor autorizado": ["concesionaria", "agencia de autos", "automotriz"],
    "agencia":         ["concesionaria", "agencia de autos", "distribuidor autorizado"],
    "agencias":        ["concesionaria", "agencia de autos", "distribuidor autorizado"],
    "automotriz":      ["concesionaria", "agencia de autos", "taller mecánico", "refaccionaria"],
    "automotrices":    ["concesionaria", "agencia de autos", "taller mecánico", "refaccionaria"],
    "taller":          ["taller mecánico", "servicio automotriz", "hojalatería", "pintura automotriz"],
    "talleres":        ["taller mecánico", "servicio automotriz", "hojalatería", "pintura automotriz"],
    "taller mecanico": ["taller automotriz", "servicio mecánico", "mecánico", "hojalatería"],
    "mecanico":        ["taller mecánico", "taller automotriz", "servicio automotriz"],
    "refaccionaria":   ["refacciones", "autopartes", "taller mecánico", "accesorios automotrices"],
    "refaccionarias":  ["refacciones", "autopartes", "taller mecánico", "accesorios automotrices"],
    "refacciones":     ["refaccionaria", "autopartes", "accesorios automotrices"],
    "autopartes":      ["refaccionaria", "refacciones", "accesorios automotrices"],
    "gasera":        ["gas lp", "distribuidora de gas", "gas licuado", "gas butano"],
    "gaseras":       ["gas lp", "distribuidora de gas", "gas licuado", "gas butano"],
    "gasolinera":    ["gasera", "estación de servicio", "combustible"],
    "gas lp":        ["gasera", "distribuidora de gas", "gas licuado"],
    "distribuidora de gas": ["gasera", "gas lp", "gas licuado"],
    "clinica":       ["clínica", "médico", "consultorio", "hospital"],
    "medico":        ["médico", "clínica", "consultorio", "doctor"],
    "constructor":   ["constructora", "construcción", "obra", "contratista"],
    "inmobiliaria":  ["bienes raíces", "propiedades", "realty"],
    "seguridad":     ["vigilancia", "guardias", "alarmas", "cámaras"],
    "lavanderia":    ["lavandería", "tintorería", "dry cleaning"],
    "optometria":    ["óptica", "optometrista", "lentes", "anteojos"],
    "psicologia":    ["psicólogo", "terapeuta", "salud mental"],
}


_NOISE = '-directorio -guia -guía -blog -listado -noticias -revista -articulo'


_SYNONYM_CACHE: dict[str, list[str]] = {}


def _ai_expand_synonyms(industry: str) -> list[str]:
    """
    Ask the active LLM (OpenAI if configured, else DeepSeek — see app.llm) for extra
    Spanish search terms for this industry, since INDUSTRY_SYNONYMS only covers a
    fixed set of ~30 hardcoded trades. Any industry typed outside that list got zero
    synonym queries before this; this fills the gap for arbitrary/unlisted industries.
    Cached per-process by industry so repeat searches don't re-spend a call.
    """
    key = industry.lower().strip()
    if key in _SYNONYM_CACHE:
        return _SYNONYM_CACHE[key]
    syns: list[str] = []
    try:
        from app.llm import call_llm
        prompt = (
            f'Da de 4 a 6 términos o sinónimos en español de México que la gente usa para buscar '
            f'negocios del giro "{industry}" (nombres alternativos, jerga local, variantes regionales). '
            f'Responde ÚNICAMENTE con un array JSON de strings cortos, sin explicación. '
            f'Ejemplo: ["taller mecánico", "servicio automotriz"]'
        )
        content = call_llm([{"role": "user", "content": prompt}], max_tokens=150, temperature=0.3)
        m = re.search(r'\[.*\]', content, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
            syns = [s.strip() for s in parsed if isinstance(s, str) and s.strip()][:6]
    except Exception:
        syns = []
    _SYNONYM_CACHE[key] = syns
    return syns


def _build_variations(industry: str, city: str = "", country: str = None, num_results: int = 10) -> list[str]:
    """
    Build DDG query variations designed to return actual business WEBSITES,
    not directories. Uses advanced DDG operators:
      - Exact phrase quotes for the industry term
      - site:<tld> to favour domains of the selected country (only when one was given)
      - intitle: to find pages that are about the business, not listicles
      - -term exclusions to suppress directories/blogs at query level
    Avoid 'contacto teléfono dirección' — those attract Sección Amarilla / Hotfrog.

    `country` is optional — there's no country/city picker in the UI anymore,
    the user just types the location (a city, "Latinoamérica", nothing at all…)
    directly into the industry box. When `country` isn't given, this builds
    location-agnostic variations and trusts whatever location text the user
    already typed into `industry`/`city`, relying on ddgs's worldwide
    (region="wt-wt") search rather than biasing to one country's domains.

    `num_results` scales how many city/synonym variations get fanned out when a
    known country (with a curated city list) is given but no specific city —
    a small ask (e.g. 5-10) doesn't need to sweep all 55 curated cities, only a
    thorough one (30-50) does.
    """
    ind = industry.strip()
    ind_q = f'"{ind}"'
    static_synonyms = INDUSTRY_SYNONYMS.get(ind.lower(), [])
    ai_synonyms = _ai_expand_synonyms(ind) if (OPENAI_API_KEY or DEEPSEEK_API_KEY) else []
    synonyms = list(dict.fromkeys(static_synonyms + ai_synonyms))  # merge, dedup, keep order
    is_fitness = "gym" in synonyms or ind.lower() in ("gimnasio", "fitness")
    cfg = COUNTRY_CONFIG.get(country) if country else None

    if city.strip():
        loc = city.strip()
        queries = [f"{ind_q} {loc}"]
        if cfg:
            queries += [f"site:{tld} {ind} {loc}" for tld in cfg["tlds"]]
        queries += [
            f"intitle:{ind_q} {loc}",
            f"{ind} {loc} {_NOISE}",
            f"{ind} {loc} whatsapp",
            f"{ind} {loc} {'membresía' if is_fitness else 'servicio'}",
        ]
        for syn in synonyms[:4]:
            queries.append(f'"{syn}" {loc}')
        return queries

    if not cfg:
        # Sin ciudad ni país conocido — variaciones genéricas, sin sesgo geográfico.
        # El propio texto de `industry` puede ya incluir la ubicación
        # ("... en Bogotá", "... en Latinoamérica") escrita libremente por el usuario.
        queries = [
            ind_q,
            f"intitle:{ind_q}",
            f"{ind} {_NOISE}",
            f"{ind} whatsapp",
            f"{ind} {'membresía' if is_fitness else 'servicio'}",
        ]
        queries += [f'"{syn}"' for syn in synonyms[:6]]
        return queries

    # País conocido, sin ciudad: queries base + fan-out por sus ciudades
    # curadas + sinónimos. El número de ciudades fanned-out escala con
    # num_results para que pedir pocos resultados sea rápido y pedir muchos
    # sea exhaustivo.
    country_name = country
    tlds = cfg["tlds"]
    cities = cfg["cities"]
    base = [f"{ind_q} {country_name}"]
    base += [f"site:{tld} {ind}" for tld in tlds]
    base += [
        f"intitle:{ind_q} {country_name}",
        f"{ind} {country_name} {_NOISE}",
        f"{ind} {country_name} whatsapp",
        f"{ind} {country_name} {'inscripción' if is_fitness else 'servicio'}",
    ]
    max_cities = max(6, min(len(cities), num_results * 2))
    city_queries = [f"{ind_q} {c}" for c in cities[:max_cities]]
    synonym_queries = [f'"{syn}" {country_name}' for syn in synonyms[:6]]
    return base + city_queries + synonym_queries


def _fetch_ddg(query: str, max_results: int = 80) -> list[dict]:
    import time
    import random
    from ddgs import DDGS
    results = []
    # DDG throttles/blocks aggressively under bursty concurrent traffic — retry once
    # after a short backoff instead of just losing that query's results silently.
    for attempt in range(2):
        try:
            with DDGS() as ddgs:
                # wt-wt = worldwide, evita sesgo por IP del servidor
                # safesearch=off da más resultados de negocios reales
                for r in ddgs.text(query, region="wt-wt", safesearch="off", max_results=max_results):
                    href = r.get("href")
                    if href and _is_business_url(href):
                        results.append({"href": href, "title": r.get("title", ""), "body": r.get("body", "")})
            return results
        except Exception:
            if attempt == 0:
                time.sleep(1.5 + random.random() * 1.5)
            continue
    return results


def _ai_filter_urls(urls: list[str], industry: str, snippets: dict | None = None) -> list[str]:
    """
    Use the active LLM (OpenAI if configured, else DeepSeek) to rank URLs as real
    business websites. Processes in batches of 60, preserves ALL URLs (ranked first,
    unranked appended). Returns the full list — no cap applied here.
    """
    if not (OPENAI_API_KEY or DEEPSEEK_API_KEY) or not urls:
        return urls
    snippets = snippets or {}

    ranked: list[str] = []
    remaining = list(urls)

    batch_size = 60
    while remaining:
        batch = remaining[:batch_size]
        remaining = remaining[batch_size:]
        try:
            lines = []
            for i, u in enumerate(batch):
                s = snippets.get(u, {})
                title = (s.get("title") or "").strip()
                body = (s.get("body") or "").strip()[:150]
                line = f"{i+1}. {u}"
                if title:
                    line += f"\n   Título: {title}"
                if body:
                    line += f"\n   Resumen: {body}"
                lines.append(line)
            prompt = (
                f'Eres un filtro ESTRICTO de URLs. Se buscan ÚNICAMENTE sitios web oficiales '
                f'de negocios LOCALES e INDEPENDIENTES del sector "{industry}" en México.\n\n'
                f'INCLUIR SOLO si es la página oficial de UN negocio específico con nombre y dirección propios:\n'
                f'  ✓ Un restaurante, clínica, gimnasio, taller, tienda, despacho, salón específico.\n\n'
                f'EXCLUIR SIN EXCEPCIÓN (devuelve [] si ninguna aplica):\n'
                f'  ✗ Catálogos o agregadores del sector: sitios que reúnen o listan VARIOS negocios '
                f'del mismo tipo en una sola página (ej: "mejoresrestaurantes.com", "guiagymcdmx.com", '
                f'"directoriodentistas.mx", cualquier sitio con fichas de múltiples negocios similares).\n'
                f'  ✗ Listicles: "Los mejores X", "Top 10", "Guía de", "Dónde ir", "Lugares para", "Recomendados"\n'
                f'  ✗ Artículos, noticias, reportajes, blogs, columnas de opinión\n'
                f'  ✗ Directorios conocidos (Yelp, Sección Amarilla, Hotfrog, Páginas Amarillas, Kompass, Foursquare, Zomato)\n'
                f'  ✗ Redes sociales, YouTube, Wikipedia, Quora, Reddit\n'
                f'  ✗ Marketplaces (MercadoLibre, Amazon, Uber Eats, Rappi, Didi Food)\n'
                f'  ✗ Franquicias o cadenas NACIONALES con decenas de sucursales '
                f'(SmartFit, OXXO, Starbucks, McDonald\'s, Domino\'s, Cinépolis, etc.)\n'
                f'  ✗ Asociaciones gremiales, cámaras de comercio, federaciones del sector\n'
                f'  ✗ Proveedores de software/SaaS para el sector (herramientas, no el negocio mismo)\n'
                f'  ✗ Páginas gubernamentales o educativas\n'
                f'  ✗ Revistas, portales de contenido, medios digitales\n'
                f'  ✗ URLs con /blog/, /noticias/, /articulo/, /post/, /catalogo/, /directorio/ o año en la ruta\n\n'
                f'REGLA CLAVE: si el sitio parece ser un portal que AGRUPA o COMPARA negocios '
                f'del sector "{industry}", descártalo aunque el dominio sea desconocido.\n\n'
                f'URLs a evaluar:\n' + '\n'.join(lines) + '\n\n'
                f'Responde ÚNICAMENTE con un array JSON de enteros con los números de URLs aprobadas, '
                f'ordenadas de mayor a menor relevancia. Si ninguna califica, responde []. '
                f'Ejemplo: [3, 1, 7] o []'
            )
            from app.llm import call_llm
            content = call_llm([{"role": "user", "content": prompt}], max_tokens=800, temperature=0)
            m = re.search(r'\[[\d,\s]*\]', content)
            if m:
                indices = json.loads(m.group(0))
                approved_idx = {i for i in indices if 1 <= i <= len(batch)}
                batch_ranked = [batch[i - 1] for i in indices if i in approved_idx]
                # Anything DeepSeek didn't approve isn't discarded — just deprioritized,
                # per this function's contract of never dropping a candidate URL outright.
                batch_unranked = [u for i, u in enumerate(batch, start=1) if i not in approved_idx]
                ranked.extend(batch_ranked)
                ranked.extend(batch_unranked)
                continue
        except Exception:
            pass
        # Fallback sin DeepSeek: mantener el batch tal cual
        ranked.extend(batch)

    return ranked


# ---------------------------------------------------------------------------
# Sección Amarilla scraper
# ---------------------------------------------------------------------------
_SA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "es-MX,es;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
# Dominios de directorios/redes que no son sitios de empresa
_SA_EXCLUDE = re.compile(
    r"(seccionamarilla|paginasamarillas|paginas-amarillas|hotfrog|yelp|facebook|instagram"
    r"|twitter|linkedin|youtube|tiktok|google\.|maps\.google|whatsapp\.com|wa\.me"
    r"|wikipedia|tripadvisor|foursquare|trulia|zillow)\.com",
    re.IGNORECASE,
)


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[áàä]", "a", text)
    text = re.sub(r"[éèë]", "e", text)
    text = re.sub(r"[íìï]", "i", text)
    text = re.sub(r"[óòö]", "o", text)
    text = re.sub(r"[úùü]", "u", text)
    text = re.sub(r"ñ", "n", text)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def _sa_extract_urls(html: str) -> tuple[list, dict]:
    """Extraer URLs de negocios de una página de Sección Amarilla."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    urls: list[str] = []
    snippets: dict = {}

    def _add(href: str, name: str = "") -> None:
        href = href.strip()
        if not href.startswith("http"):
            return
        if _SA_EXCLUDE.search(href):
            return
        if not _is_business_url(href):
            return
        if href not in urls:
            urls.append(href)
            snippets[href] = {"title": name, "body": "Sección Amarilla"}

    # 1. External <a href> links
    for a in soup.find_all("a", href=True):
        name = ""
        parent = a.find_parent()
        for selector in ["h2", "h3", "h4"]:
            container = parent.find_previous(selector) if parent else None
            if container:
                name = container.get_text(strip=True)
                break
        _add(a["href"], name)

    # 2. data-website / data-site / data-url attributes (SA uses these on listing cards)
    for tag in soup.find_all(True):
        for attr in ("data-website", "data-site", "data-url", "data-href"):
            val = tag.get(attr, "")
            if val:
                _add(val)

    # 3. JSON-LD structured data (SA embeds Schema.org LocalBusiness)
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            entries = data if isinstance(data, list) else [data]
            for entry in entries:
                url = entry.get("url") or entry.get("website") or entry.get("sameAs")
                if isinstance(url, str):
                    _add(url, entry.get("name", ""))
                if isinstance(entry.get("sameAs"), list):
                    for u in entry["sameAs"]:
                        if isinstance(u, str):
                            _add(u, entry.get("name", ""))
        except Exception:
            pass

    return urls, snippets


def _sa_fetch_city_bd(industry_slug: str, city_slug: str, max_pages: int = 3) -> tuple[list, dict]:
    """Obtener resultados de Sección Amarilla via Bright Data (rendering JS incluido)."""
    urls: list[str] = []
    snippets: dict = {}
    bd_key = _brightdata_key()

    for page in range(1, max_pages + 1):
        page_url = (
            f"https://www.seccionamarilla.com.mx/buscar"
            f"?q={quote_plus(industry_slug.replace('-', ' '))}"
            f"&l={quote_plus(city_slug.replace('-', ' '))}"
            + (f"&pag={page}" if page > 1 else "")
        )
        try:
            resp = requests.post(
                "https://api.brightdata.com/request",
                headers={"Authorization": f"Bearer {bd_key}", "Content-Type": "application/json"},
                json={"zone": "serp_api1", "url": page_url, "format": "raw", "country": "mx"},
                timeout=35,
            )
            html = resp.text
            if not html or len(html) < 500:
                break
        except Exception:
            break

        page_urls, page_snips = _sa_extract_urls(html)
        if not page_urls:
            break

        for u in page_urls:
            if u not in urls:
                urls.append(u)
                snippets[u] = page_snips[u]

    return urls, snippets


def _sa_fetch_city(industry_slug: str, city_slug: str, max_pages: int = 3) -> tuple[list, dict]:
    """
    Scraper para una combinación industria+ciudad en Sección Amarilla.
    Usa Bright Data si está disponible (resuelve JS rendering); fallback a requests/Playwright.
    """
    if _brightdata_key():
        bd_urls, bd_snips = _sa_fetch_city_bd(industry_slug, city_slug, max_pages)
        if bd_urls:
            return bd_urls, bd_snips
        # BD returned nothing (zone may not support non-SERP URLs) — fall through to requests

    urls: list[str] = []
    snippets: dict = {}

    for page in range(1, max_pages + 1):
        page_url = (
            f"https://www.seccionamarilla.com.mx/buscar"
            f"?q={industry_slug.replace('-', '+')}&l={city_slug.replace('-', '+')}"
            + (f"&pag={page}" if page > 1 else "")
        )
        html = None

        try:
            resp = requests.get(page_url, headers=_SA_HEADERS, timeout=15, allow_redirects=True)
            if resp.status_code == 200 and len(resp.text) > 3000:
                html = resp.text
        except Exception:
            pass

        if not html or html.count("class=") < 10:
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(headless=True)
                    page_obj = browser.new_page()
                    page_obj.set_extra_http_headers({"Accept-Language": "es-MX,es;q=0.9"})
                    page_obj.goto(page_url, wait_until="networkidle", timeout=20000)
                    html = page_obj.content()
                    browser.close()
            except Exception:
                break

        if not html:
            break

        page_urls, page_snips = _sa_extract_urls(html)
        if not page_urls:
            break

        for u in page_urls:
            if u not in urls:
                urls.append(u)
                snippets[u] = page_snips[u]

    return urls, snippets


def _search_via_seccion_amarilla(
    industry: str, city: str = "", country: str = None,
    num_results: int = 10,
) -> tuple[list, dict]:
    """Fan-out por ciudades en Sección Amarilla MX y mergear resultados."""
    # SA solo cubre México — saltar si se detecta otro país
    _eff = _detect_effective_country(country, f"{industry} {city}")
    if _eff is not None and _eff != "México":
        return [], {}

    industry_clean = re.sub(
        r"\b(en\s+)?(mexico|méxico|colombia|argentina|españa)\b", "", industry, flags=re.IGNORECASE
    ).strip(" ,.-")
    ind_slug = _slugify(industry_clean)

    # Ciudades a barrer: si el usuario especificó ciudad solo esa; si no, las principales
    if city.strip():
        city_slugs = [_slugify(city.strip())]
        pages_per_city = 8
    else:
        cfg = COUNTRY_CONFIG.get("México", {})
        cities = cfg.get("cities", [])  # todas las ciudades (32)
        city_slugs = [_slugify(c) for c in cities]
        pages_per_city = 3

    seen_domains: set[str] = set()
    all_urls: list[str] = []
    all_snippets: dict = {}

    def _fetch_one(cslug: str) -> tuple[list, dict]:
        try:
            return _sa_fetch_city(ind_slug, cslug, max_pages=pages_per_city)
        except Exception:
            return [], {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(city_slugs), 16)) as ex:
        futures = [ex.submit(_fetch_one, cs) for cs in city_slugs]
        for f in concurrent.futures.as_completed(futures):
            city_urls, city_snips = f.result()
            for u in city_urls:
                d = _get_domain(u)
                if d and d not in seen_domains:
                    seen_domains.add(d)
                    all_urls.append(u)
                    all_snippets[u] = city_snips.get(u, {})

    return all_urls, all_snippets


def _search_via_google_maps(
    industry: str, city: str = "", country: str = None,
    keywords: str = "", num_results: int = 10,
) -> tuple[list, dict]:
    """Fan-out por ciudades en Google Maps via Bright Data — devuelve negocios locales con website."""
    effective_country = _detect_effective_country(country, f"{industry} {city}")
    cfg = COUNTRY_CONFIG.get(effective_country) if effective_country else None
    gl = cfg.get("gl", "mx") if cfg else "mx"
    hl = cfg.get("hl", "es") if cfg else "es"
    bd_country = cfg.get("bd_country", "mx") if cfg else "mx"

    _COUNTRY_NOISE = re.compile(
        r"\b(en\s+)?(mexico|méxico|colombia|argentina|españa|estados\s+unidos|eeuu|usa)\b",
        re.IGNORECASE,
    )
    ind_clean = _COUNTRY_NOISE.sub("", industry.strip()).strip(" ,.-")
    kw = keywords.strip()
    base = f"{kw} {ind_clean}".strip() if kw else ind_clean

    cities = cfg["cities"] if cfg and cfg.get("cities") else []
    # search_queries: list of (query_base, location) — allows synonyms with different query_base
    if city.strip():
        search_queries: list[tuple[str, str]] = [(base, city.strip())]
    elif cities:
        search_queries = [(base, c) for c in cities]
        # Synonyms × top cities to discover businesses registered under alternate terms
        # Try plural and singular forms for lookup
        _ik = ind_clean.lower()
        synonyms = (INDUSTRY_SYNONYMS.get(_ik) or INDUSTRY_SYNONYMS.get(_ik.rstrip("s")) or [])[:2]
        top_cities = cities[:14]
        for syn in synonyms:
            search_queries.extend((syn, c) for c in top_cities)
    else:
        search_queries = [(base, "")]

    seen_domains: set[str] = set()
    urls: list[str] = []
    snippets: dict = {}

    _maps_logged = False

    def _fetch_maps(qbase: str, location: str) -> tuple[list, dict]:
        nonlocal _maps_logged
        try:
            q = f"{qbase} {location}".strip() if location else qbase
            maps_url = (
                f"https://www.google.com/maps/search/{quote_plus(q)}/"
                f"?brd_json=1&gl={gl}&hl={hl}"
            )
            resp = requests.post(
                "https://api.brightdata.com/request",
                headers={"Authorization": f"Bearer {_brightdata_key()}", "Content-Type": "application/json"},
                json={"zone": "serp_api1", "url": maps_url, "format": "raw", "country": bd_country},
                timeout=30,
            )
            text = resp.text
            if not _maps_logged:
                _maps_logged = True
                print(f"[maps-debug] status={resp.status_code} len={len(text)} snippet={text[:400]!r}")

            body = json.loads(text)
            if isinstance(body.get("body"), str):
                body = json.loads(body["body"])

            batch_urls, batch_snips = [], {}
            results = (
                body.get("local_results") or body.get("results") or
                body.get("places") or body.get("organic") or []
            )
            for item in results:
                website = (
                    item.get("website") or item.get("url") or item.get("link") or
                    item.get("website_url") or item.get("web")
                )
                if website and isinstance(website, str) and _is_business_url(website):
                    if website not in batch_urls:
                        batch_urls.append(website)
                        batch_snips[website] = {
                            "title": item.get("name") or item.get("title", ""),
                            "body": item.get("address") or item.get("description", ""),
                        }
            return batch_urls, batch_snips
        except Exception as e:
            if not _maps_logged:
                print(f"[maps-debug] exception: {e}")
            return [], {}

    n_syn = len(search_queries) - len(cities) if cities else 0
    print(f"[maps] {len(search_queries)} queries ({len(cities)} cities + {n_syn} synonym variants)")
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(search_queries), 16)) as ex:
        futures = [ex.submit(_fetch_maps, qb, loc) for qb, loc in search_queries]
        for f in concurrent.futures.as_completed(futures):
            batch_urls, batch_snips = f.result()
            for u in batch_urls:
                d = _get_domain(u)
                if d and d not in seen_domains:
                    seen_domains.add(d)
                    urls.append(u)
                    snippets[u] = batch_snips.get(u, {})

    return urls, snippets


def search_prospects(
    industry: str,
    city: str = "",
    keywords: str = "",
    num_results: int = 10,
    offset: int = 0,
    exclude_domains: set | None = None,
    country: str = None,
) -> list:
    _bd_key = _brightdata_key()

    if _bd_key:
        # Correr 3 fuentes en paralelo: Bright Data + DuckDuckGo + Sección Amarilla
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            bd_future   = ex.submit(_search_via_brightdata_multi, industry, city, country, keywords, num_results, offset)
            ddg_future  = ex.submit(_search_via_duckduckgo, industry, city, exclude_domains or set(), country, num_results)
            sa_future   = ex.submit(_search_via_seccion_amarilla, industry, city, country, num_results)
            maps_future = ex.submit(_search_via_google_maps, industry, city, country, keywords, num_results)
            bd_urls,   bd_snips   = bd_future.result()
            ddg_urls,  ddg_snips  = ddg_future.result()
            sa_urls,   sa_snips   = sa_future.result()
            maps_urls, maps_snips = maps_future.result()

        print(f"[search] BD={len(bd_urls)} DDG={len(ddg_urls)} SA={len(sa_urls)} Maps={len(maps_urls)}")

        # Mergear: Maps y BD primero (más calidad), luego DDG, luego SA
        seen: set[str] = set()
        urls: list[str] = []
        snippets: dict = {}
        for u in maps_urls + bd_urls + ddg_urls + sa_urls:
            d = _get_domain(u)
            if d and d not in seen:
                seen.add(d)
                urls.append(u)
                snippets[u] = maps_snips.get(u) or bd_snips.get(u) or ddg_snips.get(u) or sa_snips.get(u, {})

    elif SERPAPI_KEY:
        query = f"{industry.strip()} empresa en {city.strip() or country or ''}".strip()
        if keywords.strip():
            query = f"{keywords.strip()} {query}"
        urls, snippets = _search_via_serpapi(query, num_results, offset)
    else:
        urls, snippets = _search_via_duckduckgo(industry, city, exclude_domains or set(), country, num_results)

    # Apply domain exclusion
    if exclude_domains:
        urls = [u for u in urls if _get_domain(u) not in exclude_domains]

    return _ai_filter_urls(urls, industry, snippets)  # no cap — caller decides how many to show


def _search_via_serpapi(query: str, num_results: int, offset: int = 0) -> tuple[list, dict]:
    params = {"q": query, "api_key": SERPAPI_KEY, "num": num_results, "start": offset, "hl": "es", "gl": "mx"}
    resp = requests.get("https://serpapi.com/search", params=params, timeout=30)
    resp.raise_for_status()
    urls = []
    snippets = {}
    for item in resp.json().get("organic_results", []):
        link = item.get("link")
        if link and link not in urls and _is_business_url(link):
            urls.append(link)
            snippets[link] = {"title": item.get("title", ""), "body": item.get("snippet", "")}
    return urls, snippets


_MX_KEYWORDS = {"mexico", "méxico", "mexicano", "mexicana", ".mx"}

# Map of keywords found in query text → COUNTRY_CONFIG key
# Ordered longest-first so "estados unidos" matches before "estados"
_COUNTRY_KEYWORDS: list[tuple[str, str]] = [
    # Frases multi-palabra primero
    ("estados unidos",        "Estados Unidos"),
    ("el salvador",           "El Salvador"),
    ("costa rica",            "Costa Rica"),
    ("republica dominicana",  "República Dominicana"),
    ("república dominicana",  "República Dominicana"),
    ("rep dominicana",        "República Dominicana"),
    ("reino unido",           "Reino Unido"),
    # Norteamérica
    ("mexico",    "México"),
    ("méxico",    "México"),
    ("mexicano",  "México"),
    ("mexicana",  "México"),
    (".mx",       "México"),
    ("eeuu",      "Estados Unidos"),
    ("canada",    "Canadá"),
    ("canadá",    "Canadá"),
    # Centroamérica y Caribe
    ("guatemala",    "Guatemala"),
    ("hondura",      "Honduras"),   # cubre "honduras" y "hondureño"
    ("salvador",     "El Salvador"),
    ("salvadoreño",  "El Salvador"),
    ("nicaragua",    "Nicaragua"),
    ("costarric",    "Costa Rica"),  # "costarricense"
    ("panama",       "Panamá"),
    ("panamá",       "Panamá"),
    ("dominicana",   "República Dominicana"),
    ("dominicano",   "República Dominicana"),
    # Sudamérica
    ("colombia",    "Colombia"),
    ("colombiano",  "Colombia"),
    ("venezuela",   "Venezuela"),
    ("venezolano",  "Venezuela"),
    ("ecuador",     "Ecuador"),
    ("ecuatoriano", "Ecuador"),
    ("peru",        "Perú"),
    ("perú",        "Perú"),
    ("peruano",     "Perú"),
    ("bolivia",     "Bolivia"),
    ("boliviano",   "Bolivia"),
    ("argentina",   "Argentina"),
    ("argentino",   "Argentina"),
    ("chile",       "Chile"),
    ("chileno",     "Chile"),
    ("paraguay",    "Paraguay"),
    ("paraguayo",   "Paraguay"),
    ("uruguay",     "Uruguay"),
    ("uruguayo",    "Uruguay"),
    ("brasil",      "Brasil"),
    ("brazil",      "Brasil"),
    ("brasileño",   "Brasil"),
    # Europa
    ("españa",    "España"),
    ("espana",    "España"),
    ("español",   "España"),
    ("portugal",  "Portugal"),
    ("portugues", "Portugal"),
    ("portugal",  "Portugal"),
    ("francia",   "Francia"),
    ("frances",   "Francia"),
    ("france",    "Francia"),
    ("italia",    "Italia"),
    ("italiano",  "Italia"),
    ("alemania",  "Alemania"),
    ("aleman",    "Alemania"),
]


def _detect_effective_country(country: str | None, text: str) -> str | None:
    """Return explicit country or auto-detect from text. Returns None if ambiguous."""
    if country:
        return country
    lower = text.lower()
    for kw, name in _COUNTRY_KEYWORDS:
        if kw in lower:
            return name
    return None


def _bd_build_queries(industry: str, city: str, country: str | None, keywords: str, num_results: int) -> list[str]:
    """Build Google-friendly query list for Bright Data (no DDG operators)."""
    import re
    ind = industry.strip()
    kw = keywords.strip()

    # Auto-detect país desde el texto del industria y configurar geo
    effective_country = _detect_effective_country(country, f"{ind} {city}")
    cfg = COUNTRY_CONFIG.get(effective_country) if effective_country else None

    # Limpiar palabras de ubicación del texto de industria cuando vamos a hacer city fan-out.
    # Ejemplo: "gaseras en mexico" → "gaseras" antes de agregar "Guadalajara"
    _COUNTRY_NOISE = re.compile(
        r"\b(en\s+)?(mexico|méxico|colombia|argentina|españa|estados\s+unidos|eeuu|usa|latinoam[eé]rica)\b",
        re.IGNORECASE,
    )
    ind_clean = _COUNTRY_NOISE.sub("", ind).strip(" ,.-")
    base_raw = f"{kw} {ind}".strip() if kw else ind          # query sin ciudad (usa texto original)
    base_city = f"{kw} {ind_clean}".strip() if kw else ind_clean  # query CON ciudad (texto limpio)

    if city.strip():
        loc = city.strip()
        return [
            f"{base_city} {loc}",
            f"{base_city} empresa {loc}",
            f"{base_city} negocio {loc}",
            f"{base_city} contacto {loc}",
            f"{base_city} whatsapp {loc}",
        ]

    cities = cfg["cities"] if cfg and cfg.get("cities") else []

    def _get_synonyms(key: str) -> list[str]:
        k = key.lower()
        return INDUSTRY_SYNONYMS.get(k) or INDUSTRY_SYNONYMS.get(k.rstrip("s")) or []

    if cities:
        # Obtener sinónimos del rubro para multiplicar queries con terminología diferente
        synonyms = _get_synonyms(ind_clean)
        # Fan-out primario: una query por ciudad
        city_queries = [f"{base_city} {c}" for c in cities]
        # Fan-out secundario: "empresa {city}" para todas las ciudades
        extra_queries = [f"{base_city} empresa {c}" for c in cities]
        # Fan-out terciario: sinónimos × ciudades top (max 3 sinónimos × top 16 ciudades)
        top_cities = cities[:16]
        syn_queries = [
            f"{syn} {c}"
            for syn in synonyms[:3]
            for c in top_cities
        ]
        return city_queries + extra_queries + syn_queries

    # Sin ciudad ni país — variaciones genéricas
    synonyms = _get_synonyms(ind_clean)
    base_queries = [base_raw, f"{base_raw} empresa", f"{base_raw} negocio", f"{base_raw} whatsapp", f"{base_raw} contacto"]
    syn_queries = [f'"{syn}"' for syn in synonyms[:5]]
    return base_queries + syn_queries


def _search_via_brightdata_multi(
    industry: str, city: str = "", country: str = None,
    keywords: str = "", num_results: int = 10, offset: int = 0,
) -> tuple[list, dict]:
    """Fan-out múltiples queries a Bright Data en paralelo."""
    # Escalar al máximo: el usuario dijo "explotar al límite aunque nos manchemos".
    # Con 5000 créditos free: 150 queries/búsqueda → ~33 búsquedas del free tier.
    MAX_QUERIES = min(max(30, num_results * 2), 150)
    all_queries = _bd_build_queries(industry, city, country, keywords, num_results)
    queries = all_queries[:MAX_QUERIES]

    # Geo-location: usar el gl/hl del país si está configurado
    effective_country = _detect_effective_country(country, f"{industry} {city}")
    cfg = COUNTRY_CONFIG.get(effective_country) if effective_country else None
    gl = cfg.get("gl", "mx") if cfg else "mx"
    hl = cfg.get("hl", "es") if cfg else "es"
    bd_country = cfg.get("bd_country", "mx") if cfg else "mx"

    seen_domains: set[str] = set()
    urls: list[str] = []
    snippets: dict[str, dict] = {}

    def _fetch_one(q: str) -> tuple[list, dict]:
        try:
            return _search_via_brightdata(q, num_results=10, offset=offset, gl=gl, hl=hl, bd_country=bd_country)
        except Exception:
            return [], {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as ex:
        futures = [ex.submit(_fetch_one, q) for q in queries]
        for f in concurrent.futures.as_completed(futures):
            batch_urls, batch_snips = f.result()
            for u in batch_urls:
                d = _get_domain(u)
                if d and d not in seen_domains:
                    seen_domains.add(d)
                    urls.append(u)
                    snippets[u] = batch_snips.get(u, {})

    return urls, snippets


def _search_via_brightdata(
    query: str, num_results: int = 10, offset: int = 0,
    gl: str = "mx", hl: str = "es", bd_country: str = "mx",
) -> tuple[list, dict]:
    import urllib.parse
    google_url = (
        f"https://www.google.com/search?q={urllib.parse.quote(query)}&hl={hl}&gl={gl}"
        + (f"&start={offset}" if offset else "")
    )
    payload = {
        "zone": "serp_api1",
        "url": google_url,
        "format": "json",
        "country": bd_country,  # proxy exit location — IP aparece desde ese país
    }
    resp = requests.post(
        "https://api.brightdata.com/request",
        headers={"Authorization": f"Bearer {_brightdata_key()}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    # Bright Data wraps the parsed page in {"status_code":200,"body":"<json string>"}
    outer = resp.json()
    body = json.loads(outer["body"]) if isinstance(outer.get("body"), str) else outer
    organic = body.get("organic") or body.get("organic_results", [])
    urls, snippets = [], {}
    for item in organic:
        link = item.get("link") or item.get("url")
        if link and link not in urls and _is_business_url(link):
            urls.append(link)
            snippets[link] = {
                "title": item.get("title", ""),
                "body": item.get("description") or item.get("snippet", ""),
            }
    return urls, snippets


def _search_via_duckduckgo(
    industry: str, city: str = "", exclude_domains: set | None = None,
    country: str = None, num_results: int = 10,
) -> tuple[list, dict]:
    variations = _build_variations(industry, city, country, num_results)
    skip = exclude_domains or set()

    all_raw: list[dict] = []
    # Kept below the point where DDG starts throttling/blocking (~10-15 simultaneous
    # requests), but higher than before since MAJOR_CITIES now covers all 32 state
    # capitals + big metros, nearly doubling the variation count per search.
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(variations), 12)) as executor:
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
    snippets: dict[str, dict] = {}

    for item in all_raw:
        url = item["href"]
        domain = _get_domain(url)
        if not domain or domain in seen_domains:
            continue
        seen_domains.add(domain)
        snippets[url] = {"title": item.get("title", ""), "body": item.get("body", "")}
        if domain in skip:
            known_urls.append(url)   # keep, but push to the end
        else:
            new_urls.append(url)

    # New domains first, already-scraped appended at the end
    return new_urls + known_urls, snippets
