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

SERPAPI_KEY     = os.getenv("SERPAPI_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")

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
    "taller":        ["mecánico", "taller automotriz", "servicio automotriz"],
    "automotriz":    ["taller mecánico", "servicio automotriz", "refacciones", "concesionario"],
    "concesionario": ["agencia de autos", "distribuidor automotriz", "automotriz"],
    "agencia":       ["concesionario", "distribuidor", "automotriz"],
    "refaccionaria": ["refacciones", "autopartes", "taller mecánico"],
    "gasera":        ["gasolinera", "estación de servicio", "combustible"],
    "gasolinera":    ["gasera", "estación de servicio", "combustible"],
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


def _build_variations(industry: str, city: str = "") -> list[str]:
    """
    Build DDG query variations designed to return actual business WEBSITES,
    not directories. Uses advanced DDG operators:
      - Exact phrase quotes for the industry term
      - site:.mx and site:com.mx to favour Mexican domains
      - intitle: to find pages that are about the business, not listicles
      - -term exclusions to suppress directories/blogs at query level
    Avoid 'contacto teléfono dirección' — those attract Sección Amarilla / Hotfrog.
    """
    ind = industry.strip()
    ind_q = f'"{ind}"'
    static_synonyms = INDUSTRY_SYNONYMS.get(ind.lower(), [])
    ai_synonyms = _ai_expand_synonyms(ind) if (OPENAI_API_KEY or DEEPSEEK_API_KEY) else []
    synonyms = list(dict.fromkeys(static_synonyms + ai_synonyms))  # merge, dedup, keep order
    is_fitness = "gym" in synonyms or ind.lower() in ("gimnasio", "fitness")

    if city.strip():
        loc = city.strip()
        queries = [
            f"{ind_q} {loc}",
            f"site:.mx {ind} {loc}",
            f"site:com.mx {ind} {loc}",
            f"intitle:{ind_q} {loc}",
            f"{ind} {loc} {_NOISE}",
            f"{ind} {loc} whatsapp",
            f"{ind} {loc} {'membresía' if is_fitness else 'servicio'}",
        ]
        for syn in synonyms[:4]:
            queries.append(f'"{syn}" {loc}')
        return queries

    # Sin ciudad: queries base + por cada ciudad grande + sinónimos
    base = [
        f"{ind_q} México",
        f"site:.mx {ind}",
        f"site:com.mx {ind}",
        f"intitle:{ind_q} México",
        f"{ind} México {_NOISE}",
        f"{ind} México whatsapp",
        f"{ind} México {'inscripción' if is_fitness else 'servicio'}",
    ]
    city_queries = [f"{ind_q} {c}" for c in MAJOR_CITIES]
    synonym_queries = [f'"{syn}" México' for syn in synonyms[:6]]
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
        urls, snippets = _search_via_serpapi(query, num_results, offset)
    else:
        urls, snippets = _search_via_duckduckgo(industry, city, exclude_domains or set())

    # For SerpAPI path, apply domain exclusion after fetching
    if SERPAPI_KEY and exclude_domains:
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


def _search_via_duckduckgo(industry: str, city: str = "", exclude_domains: set | None = None) -> tuple[list, dict]:
    variations = _build_variations(industry, city)
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
