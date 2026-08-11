# scraper.py - VERSIÓN EXTENDIDA
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

import requests
import urllib3
from bs4 import BeautifulSoup
from pymongo import MongoClient

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class WebsiteScraper:
    """
    Scraper extenso que extrae:
    - Datos de empresa (nombre, industria, descripción, dirección)
    - Contactos (WhatsApp, teléfonos, emails)
    - Contactos de personas (nombre, rol, email, teléfono)
    - Redes sociales
    - Metadata adicional
    """
    
    def __init__(self):
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Cache-Control": "max-age=0",
        }
        self._cs = None  # cloudscraper session, inicializado bajo demanda
        
        # Diccionario extendido de industrias
        self.INDUSTRY_KEYWORDS = {
            # ── Alimentos ─────────────────────────────────────────────────────
            "Alimentos y Bebidas": [
                "restaurant", "restaurante", "taqueria", "taquería", "taco", "tacos",
                "panaderia", "panadería", "pan", "pasteleria", "pastelería", "pastel",
                "cafeteria", "cafetería", "cafe", "café", "comida", "cocina", "bar",
                "menu", "menú", "chef", "platillo", "catering", "alimentos", "bebidas",
                "antojitos", "mariscos", "sushi", "pizza", "hamburguesa", "torta",
                "loncheria", "lonchería", "fonda", "birria", "carnitas", "barbacoa",
            ],
            # ── Salud ─────────────────────────────────────────────────────────
            "Salud": [
                "hospital", "clinica", "clínica", "medico", "médico", "doctor",
                "salud", "farmacia", "medicina", "dental", "odontologia", "odontología",
                "dentista", "nutricion", "nutrición", "nutriologo", "nutriólogo",
                "psicologia", "psicología", "psicologo", "psicólogo", "terapia",
                "laboratorio", "optometria", "optometría", "optica", "óptica",
            ],
            "Veterinaria": [
                "veterinaria", "veterinario", "mascota", "mascotas", "perro", "gato",
                "animales", "pet", "perruno", "clinica veterinaria", "grooming",
                "guarderia canina", "guardería canina", "tienda mascotas",
            ],
            # ── Belleza ───────────────────────────────────────────────────────
            "Belleza": [
                "salon", "salón", "belleza", "estetica", "estética", "spa",
                "peluqueria", "peluquería", "barberia", "barbería", "barbero",
                "uñas", "manicure", "pedicure", "maquillaje", "depilacion",
                "depilación", "facial", "masaje", "bronceado", "cejas", "pestañas",
            ],
            # ── Deportes ──────────────────────────────────────────────────────
            "Deportes / Fitness": [
                "gimnasio", "gym", "fitness", "entrenamiento", "ejercicio", "pesas",
                "crossfit", "yoga", "pilates", "musculacion", "musculación", "cardio",
                "membresia", "membresía", "instructor", "rutina", "smartfit", "sport",
                "atletismo", "natacion", "natación", "canchas", "boxeo", "spinning",
                "zumba", "funcional", "personal trainer",
            ],
            # ── Servicios del hogar ───────────────────────────────────────────
            "Servicios del Hogar": [
                "plomero", "plomeria", "plomería", "electricista", "electricidad",
                "lavanderia", "lavandería", "tintoreria", "tintorería", "limpieza",
                "fumigacion", "fumigación", "pintura", "pintor", "jardineria",
                "jardinería", "jardinero", "herreria", "herrería", "cerrajero",
                "cerrajeria", "cerrajería", "carpintero", "carpinteria", "carpintería",
                "mudanza", "mudanzas", "control de plagas",
            ],
            # ── Servicios profesionales ───────────────────────────────────────
            "Servicios": [
                "consultoria", "consultoría", "asesoria", "asesoría",
                "asesor", "consultor", "consulting", "outsourcing",
                "despacho", "firma de servicios", "servicios profesionales",
            ],
            # ── Comercio / Retail ─────────────────────────────────────────────
            "Ferretería / Construcción Retail": [
                "ferreteria", "ferretería", "materiales", "construccion", "tornillo",
                "pintura", "herramienta", "herramientas", "madera", "vidrio",
                "plomeria retail", "electricidad retail",
            ],
            "Muebles / Decoración": [
                "muebles", "muebleria", "mueblería", "decoracion", "decoración",
                "hogar", "sala", "recamara", "recámara", "colchon", "colchón",
                "cocina integral", "closet", "tapiceria", "tapicería",
            ],
            "Electrónica": [
                "electronica", "electrónica", "celular", "telefono", "teléfono",
                "computadora", "laptop", "tablet", "iphone", "samsung", "reparacion celular",
                "accesorio", "accesorios", "gadget", "tecnología retail",
            ],
            "Abarrotes / Minisuper": [
                "abarrotes", "minisuper", "mini super", "tienda", "super",
                "mercado", "despensa", "dulceria", "dulcería", "papeleria", "papelería",
                "cremeria", "cremería", "carniceria", "carnicería",
            ],
            "Ropa / Moda": [
                "ropa", "moda", "boutique", "vestido", "calzado", "zapatos",
                "tenis", "camisa", "pantalon", "pantalón", "playera", "uniforme",
                "taller de costura", "costura", "bordado", "estampado",
            ],
            "Retail General": [
                "tienda", "shop", "catalogo", "catálogo", "productos",
                "ecommerce", "compra", "comercio", "retail", "venta al público",
            ],
            # ── Educación ─────────────────────────────────────────────────────
            "Educación": [
                "escuela", "universidad", "curso", "capacitacion", "capacitación",
                "educacion", "educación", "academia", "instituto", "colegio",
                "guarderia", "guardería", "kinder", "preescolar", "primaria",
                "tutor", "tutoria", "tutoría", "clases particulares",
                "idiomas", "ingles", "inglés", "frances", "francés", "idioma",
                "escuela de manejo", "driving school",
            ],
            # ── Hospedaje / Eventos ───────────────────────────────────────────
            "Hospedaje": [
                "hotel", "hostal", "hosteria", "hostería", "motel", "cabaña", "cabañas",
                "glamping", "airbnb", "habitacion", "habitación", "cuarto", "suite",
                "resort", "posada", "bed and breakfast", "alojamiento",
                "reservacion", "reservación", "check-in", "checkout", "recepcion",
                "recepción", "noche", "noches", "tarifa", "tarifas", "estancia",
                "huesped", "huésped", "huespedes", "huéspedes", "lobby",
                "alberca", "desayuno incluido", "hab", "hotelero", "hotelera",
            ],
            "Eventos / Entretenimiento": [
                "salon de eventos", "salón de eventos", "salon de fiestas", "salón de fiestas",
                "banquetes", "evento", "eventos", "boda", "bodas", "quinceañera",
                "fotografia", "fotografía", "fotografo", "fotógrafo", "dj", "musica",
                "musica en vivo", "animacion", "animación", "show", "teatro", "cine",
            ],
            # ── Profesionales ─────────────────────────────────────────────────
            "Legal": [
                "abogado", "legal", "juridico", "jurídico", "notaria", "notaría",
                "derecho", "asesor legal", "licenciado", "despacho juridico",
                "despacho jurídico", "bufete",
            ],
            "Contabilidad / Finanzas": [
                "contador", "contadora", "contabilidad", "contable", "fiscal",
                "declaracion", "declaración", "impuesto", "impuestos", "sat",
                "nomina", "nómina", "auditoria", "auditoría", "despacho contable",
            ],
            "Inmobiliaria": [
                "inmobiliaria", "bienes raices", "bienes raíces", "propiedad",
                "renta", "venta casa", "departamento", "terreno", "casa", "lote",
                "agente inmobiliario", "broker", "plusvalia", "plusvalía",
            ],
            # ── Construcción ──────────────────────────────────────────────────
            "Construcción": [
                "construccion", "construcción", "obra", "arquitectura", "arquitecto",
                "ingeniero", "edificio", "remodelacion", "remodelación", "albañil",
                "contratista", "diseño arquitectonico", "diseño arquitectónico",
                "urbanismo", "concreto", "acero", "estructuras",
            ],
            # ── Automotriz ────────────────────────────────────────────────────
            "Automotriz": [
                "taller mecanico", "taller mecánico", "mecanico", "mecánico",
                "refacciones", "auto", "carro", "vehiculo", "vehículo", "automovil",
                "automóvil", "hojalateria", "hojalatería", "pintura automotriz",
                "llantas", "frenos", "alineacion", "alineación", "balanceo",
                "servicio automotriz", "agencia autos", "agencia de autos",
                "seminuevos", "autos nuevos", "autos usados", "concesionaria",
                "concesionario", "distribuidor autorizado", "test drive",
                "prueba de manejo", "cotizar auto", "financiamiento automotriz",
                "mantenimiento automotriz", "garantia de fabrica", "kilometraje",
                "autos", "carros", "nissan", "honda", "toyota", "ford",
                "chevrolet", "volkswagen", "bmw", "kia", "mazda", "audi",
                "hyundai", "ram", "jeep", "dodge",
            ],
            # ── Transporte ────────────────────────────────────────────────────
            "Transporte / Logística": [
                "transporte", "logistica", "logística", "envio", "envío",
                "paqueteria", "paquetería", "mensajeria", "mensajería", "flete",
                "carga", "distribucion", "distribución", "acarreo", "grua", "grúa",
            ],
            # ── Industria / Manufactura ───────────────────────────────────────
            "Manufactura": [
                "fabrica", "fábrica", "manufactura", "produccion", "producción",
                "industrial", "planta", "maquila", "ensamble", "proceso industrial",
                "acero", "acería", "metalurgia", "metal", "metales", "hierro",
                "aluminio", "lámina", "varilla", "tubería", "fundición",
                "siderurgia", "chatarra", "trefilado", "galvanizado",
            ],
            # ── Gas / Energía ─────────────────────────────────────────────────
            "Gas LP / Energía": [
                "gas", "gas lp", "cilindro", "tanque", "gasera", "combustible",
                "gas natural", "energia", "energía", "solar", "panel solar",
            ],
            # ── Financiero ────────────────────────────────────────────────────
            "Financiero": [
                "banco", "credito", "crédito", "prestamo", "préstamo", "financiero",
                "inversion", "inversión", "seguros", "finanzas", "caja de ahorro",
                "cooperativa", "microfinanciera", "hipoteca",
            ],
            # ── Tecnología ────────────────────────────────────────────────────
            "Tecnología": [
                "software", "desarrollo web", "desarrollo de software", "programacion",
                "programación", "tecnologia", "tecnología",
                "inteligencia artificial", "saas", "erp", "crm",
                "ciberseguridad", "infraestructura ti", "startup",
                "app movil", "aplicacion movil", "empresa tecnologica",
            ],
        }

        
        # Roles de contacto
        self.ROLE_KEYWORDS = {
            "Director General": ["director general", "ceo", "presidente", "fundador", "owner"],
            "Director Comercial": ["director comercial", "director ventas", "sales director"],
            "Gerente General": ["gerente general", "general manager"],
            "Gerente Comercial": ["gerente comercial", "gerente ventas", "sales manager"],
            "Gerente Operaciones": ["gerente operaciones", "operations manager"],
            "Coordinador": ["coordinador", "coordinator"],
            "Ventas": ["ventas", "comercial", "sales", "vendedor", "ejecutivo ventas"],
            "Marketing": ["marketing", "mercadotecnia", "publicidad", "community manager"],
            "Recursos Humanos": ["recursos humanos", "rh", "hr", "talento humano"],
            "Finanzas": ["finanzas", "contador", "contabilidad", "finance"],
            "Contacto General": ["contacto", "atencion", "informes", "recepcion"],
        }

        # Conexión MongoDB
        import os
        client = MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017/"))
        db = client[os.getenv("DATABASE_NAME", "comercial")]
        self.companies_col = db["companies"]
        self.contacts_col = db["contacts"]
        self.scraping_runs_col = db["scraping_runs"]

    def scrape_site(self, url: str, force: bool = False, country: str = None) -> Dict:
        """
        Scraping completo de un sitio web
        
        Returns:
            {
                "website": str,
                "company_name": str,
                "industry": str,
                "description": str,
                "main_activity": str,
                "address": str,
                "city": str,
                "state": str,
                "country": str,
                "postal_code": str,
                "social_media": {...},
                "whatsapp_numbers": [...],
                "all_whatsapp_numbers": [...],
                "phone_numbers": [...],
                "emails": [...],
                "contacts": [
                    {
                        "name": str,
                        "role": str,
                        "phone": str,
                        "email": str,
                        "whatsapp": str
                    }
                ],
                "business_hours": str,
                "services": [...],
                "products": [...],
                "metadata": {...}
            }
        """
        from app.searcher import COUNTRY_CONFIG, DEFAULT_COUNTRY
        _country_cfg = COUNTRY_CONFIG.get(country or DEFAULT_COUNTRY, COUNTRY_CONFIG[DEFAULT_COUNTRY])
        self._default_country_code = _country_cfg["phone_code"]
        self._default_local_digits = _country_cfg["local_digits"]

        print(f"🔍 Scrapeando: {url}")

        try:
            response = self._get_page(url, timeout=15)
            if response is None:
                raise requests.exceptions.HTTPError("No response")
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            if response is not None and response.status_code == 403:
                print(f"⚠️ Sitio bloqueó el scraper (403): {url}")
                return {
                    "website": url, "domain": urlparse(url).netloc.replace("www.", ""),
                    "name": urlparse(url).netloc.replace("www.", "").split(".")[0].capitalize(),
                    "industry": "No detectada", "description": "Sitio no accesible (403)",
                    "has_whatsapp": False, "status": "blocked",
                    "last_scraped_at": datetime.now(timezone.utc),
                    "next_allowed_scrape_at": datetime.now(timezone.utc) + timedelta(days=7),
                    "created_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "_extra": {}, "_contacts_raw": {
                        "whatsapp_numbers": [], "all_whatsapp_numbers": [],
                        "phone_numbers": [], "emails": [], "persons": []
                    },
                    "metadata": {"scraped_at": datetime.now(timezone.utc).isoformat()}
                }
            raise
        except Exception as e:
            print(f"❌ Error al obtener página: {e}")
            raise
        
        soup = BeautifulSoup(response.text, "html.parser")
        text = soup.get_text(" ", strip=True)

        # Datos adicionales de fuentes estáticas (JSON-LD, __NEXT_DATA__, script vars)
        structured_phones, structured_wa = self._extract_from_scripts(soup)

        domain = urlparse(url).netloc.replace("www.", "")

        # Extraer WhatsApp con labels (una sola pasada sobre el HTML)
        _wa_contacts_main = self._extract_whatsapp_with_labels(soup, text)
        _wa_seen = {c["number"] for c in _wa_contacts_main}
        for _n in structured_wa:
            if _n not in _wa_seen:
                _wa_contacts_main.append({"number": _n, "label": ""})
                _wa_seen.add(_n)

        # Extraer todos los datos
        result = {
            # Campos para MongoDB companies
            "website": url,
            "domain": domain,
            "name": self._extract_company_name(soup, url),
            "industry": self._detect_industry(text, soup),
            "description": self._extract_description(soup, text),
            "has_whatsapp": False,
            "status": "new",
            "last_scraped_at": datetime.now(timezone.utc),
            "next_allowed_scrape_at": datetime.now(timezone.utc) + timedelta(days=365),
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),

            # Campos extra (no van a companies)
            "_extra": {
                "main_activity": self._detect_main_activity(text),
                "address": self._extract_address(text, soup),
                "city": self._extract_city(text),
                "state": self._extract_state(text),
                "country": self._extract_country(text),
                "postal_code": self._extract_postal_code(text),
                "social_media": self._extract_social_media(soup),
                "business_hours": self._extract_business_hours(text, soup),
                "services": self._extract_services(text, soup),
                "products": self._extract_products(text, soup),
            },

            # Contactos en bruto (se guardan en contacts, no en companies)
            "_contacts_raw": {
                "whatsapp_contacts": list(_wa_contacts_main),
                "whatsapp_numbers": [],
                "all_whatsapp_numbers": [c["number"] for c in _wa_contacts_main],
                "phone_numbers": list(dict.fromkeys(
                    self._extract_phone_numbers(soup, text) + structured_phones
                )),
                "emails": self._extract_emails(text),
                "persons": self._extract_person_contacts(soup, text),
            },

            "metadata": {
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "page_title": soup.title.string if soup.title else "",
                "total_links": len(soup.find_all("a")),
                "language": self._detect_language(soup),
                "has_contact_form": self._has_contact_form(soup),
                "has_ecommerce": self._has_ecommerce(soup),
            }
        }

        # ── Subpage crawl: AI ranks every internal link by contact-info probability ──
        all_links = self._find_all_internal_links(soup, url, domain)

        # Sitios JS/SPA no exponen links en HTML estático — probar rutas comunes de contacto
        if not all_links:
            base = url.rstrip("/")
            _COMMON_PATHS = [
                "/contactanos", "/contacto", "/contact", "/contact-us", "/contactenos",
                "/nosotros", "/about", "/about-us", "/quienes-somos",
                "/ubicaciones", "/ubicacion", "/sucursales", "/sucursal",
                "/telefono", "/telefonos", "/directorio", "/informacion",
                "/ayuda", "/help", "/soporte", "/support", "/atencion",
                "/atencion-al-cliente", "/servicio-al-cliente", "/asistencia",
            ]
            all_links = [{"url": base + p, "text": p.strip("/"), "path": p} for p in _COMMON_PATHS]
            print(f"⚠️  Sitio JS/SPA detectado (0 links en HTML) — probando {len(all_links)} rutas comunes")

        sub_urls = self._ai_rank_subpages(all_links, result.get("industry", ""))
        print(f"🔗 {len(all_links)} links encontrados → crawleando top {min(12, len(sub_urls))} en paralelo")
        _existing_wa = {c["number"] for c in result["_contacts_raw"]["whatsapp_contacts"]}
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(self._fetch_sub, u): u for u in sub_urls[:12]}
            for future in as_completed(futures):
                data = future.result()
                if not data:
                    continue
                # Merge WhatsApp contacts
                for contact in data["wa_contacts"]:
                    if contact["number"] not in _existing_wa:
                        result["_contacts_raw"]["whatsapp_contacts"].append(contact)
                        result["_contacts_raw"]["all_whatsapp_numbers"].append(contact["number"])
                        _existing_wa.add(contact["number"])
                for num in data["wa_scripts"]:
                    if num not in _existing_wa:
                        result["_contacts_raw"]["whatsapp_contacts"].append({"number": num, "label": ""})
                        result["_contacts_raw"]["all_whatsapp_numbers"].append(num)
                        _existing_wa.add(num)
                # Merge phones, emails, hours, address
                for phone in data["phones"]:
                    if phone not in result["_contacts_raw"]["phone_numbers"]:
                        result["_contacts_raw"]["phone_numbers"].append(phone)
                for email in data["emails"]:
                    if email not in result["_contacts_raw"]["emails"]:
                        result["_contacts_raw"]["emails"].append(email)
                if not result["_extra"]["business_hours"] and data["hours"]:
                    result["_extra"]["business_hours"] = data["hours"]
                if not result["_extra"]["address"] and data["address"]:
                    result["_extra"]["address"] = data["address"]

        if result["_contacts_raw"]["all_whatsapp_numbers"]:
            result["_contacts_raw"]["whatsapp_numbers"] = result["_contacts_raw"]["all_whatsapp_numbers"]
            result["has_whatsapp"] = True

        # ── Fallback Playwright: si el scraping estático no encontró ningún contacto ──
        no_contacts_found = (
            not result["_contacts_raw"]["all_whatsapp_numbers"] and
            not result["_contacts_raw"]["phone_numbers"]
        )
        if no_contacts_found:
            print(f"🎭 Sin contactos en HTML estático — intentando Playwright para {url}")
            # Intentar primero la página de contacto directamente
            contact_candidates = [
                url.rstrip("/") + "/contactanos",
                url.rstrip("/") + "/contacto",
                url.rstrip("/") + "/contact",
                url,
            ]
            try:
                from playwright.sync_api import sync_playwright
            except ImportError:
                sync_playwright = None

            if sync_playwright is not None:
                # Un solo navegador reutilizado para las 4 URLs candidatas — lanzar
                # Chromium desde cero (~1-2s) en cada intento era el principal costo,
                # no la carga de la página en sí.
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(headless=True)
                    ctx = browser.new_context(
                        user_agent=self.headers["User-Agent"],
                        locale="es-MX",
                        viewport={"width": 1280, "height": 800},
                    )
                    pw_page = ctx.new_page()
                    for pw_url in contact_candidates:
                        js_html = self._get_page_js(pw_url, page=pw_page)
                        if not js_html:
                            continue  # esta URL falló — probar la siguiente candidata igual
                        js_soup = BeautifulSoup(js_html, "html.parser")
                        js_text = js_soup.get_text(" ", strip=True)
                        js_phones_s, js_wa_s = self._extract_from_scripts(js_soup)
                        _pw_contacts = self._extract_whatsapp_with_labels(js_soup, js_text)
                        found_wa  = [c["number"] for c in _pw_contacts] + js_wa_s
                        found_tel = self._extract_phone_numbers(js_soup, js_text) + js_phones_s
                        _existing_pw = {c["number"] for c in result["_contacts_raw"]["whatsapp_contacts"]}
                        for c in _pw_contacts:
                            if c["number"] not in result["_contacts_raw"]["all_whatsapp_numbers"]:
                                result["_contacts_raw"]["all_whatsapp_numbers"].append(c["number"])
                            if c["number"] not in _existing_pw:
                                result["_contacts_raw"]["whatsapp_contacts"].append(c)
                                _existing_pw.add(c["number"])
                        for n in js_wa_s:
                            if n not in result["_contacts_raw"]["all_whatsapp_numbers"]:
                                result["_contacts_raw"]["all_whatsapp_numbers"].append(n)
                            if n not in _existing_pw:
                                result["_contacts_raw"]["whatsapp_contacts"].append({"number": n, "label": ""})
                        for n in found_tel:
                            if n not in result["_contacts_raw"]["phone_numbers"]:
                                result["_contacts_raw"]["phone_numbers"].append(n)
                        if found_wa or found_tel:
                            print(f"🎭 Playwright encontró contactos en {pw_url}")
                            # Re-detectar industria con el texto completo renderizado
                            if result.get("industry") in ("No detectada", "", None):
                                detected = self._detect_industry(js_text, js_soup)
                                if detected != "No detectada":
                                    result["industry"] = detected
                                    print(f"🏷️  Industria detectada desde Playwright: {detected}")
                            break
                    browser.close()
            if result["_contacts_raw"]["all_whatsapp_numbers"]:
                result["_contacts_raw"]["whatsapp_numbers"] = result["_contacts_raw"]["all_whatsapp_numbers"]
                result["has_whatsapp"] = True

        # ── Enriquecimiento con IA: rellenar campos vacíos en una sola llamada ──
        self._deepseek_enrich_result(result, text[:1000])

        # Deduplicación y guardado en MongoDB
        existing = self.companies_col.find_one({"domain": domain})
        if existing:
            next_scrape = existing.get("next_allowed_scrape_at")
            already_has_contact = existing.get("has_whatsapp") or self.contacts_col.find_one(
                {"company_id": existing["_id"], "type": {"$in": ["whatsapp", "phone"]}}
            )
            # Solo saltar si ya tiene contactos — si no encontró nada antes, reintentar siempre
            if not force and next_scrape and next_scrape.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) and already_has_contact:
                print(f"⏭️  Dominio ya scrapeado recientemente con contactos: {domain}")
                result["_db_action"] = "skipped_duplicate"
                result["_company_id"] = existing["_id"]
                return result
            else:
                print(f"🔄 Re-scrapeando {domain} (sin contactos previos o cooldown expirado)")
                update_fields = {
                    "has_whatsapp": result["has_whatsapp"],
                    "last_scraped_at": result["last_scraped_at"],
                    "next_allowed_scrape_at": result["next_allowed_scrape_at"],
                    "updated_at": datetime.now(timezone.utc),
                }
                if force:
                    for field in ("name","industry","description","city","state","country",
                                  "address","phone_numbers","whatsapp_numbers","all_whatsapp_numbers",
                                  "social_media","business_hours","services","products"):
                        if field in result:
                            update_fields[field] = result[field]
                self.companies_col.update_one(
                    {"_id": existing["_id"]},
                    {"$set": update_fields}
                )
                result["_db_action"] = "updated"
                result["_company_id"] = existing["_id"]
        else:
            company_doc = {k: v for k, v in result.items() if not k.startswith("_")}
            company_doc.setdefault("created_at", datetime.now(timezone.utc))
            try:
                res = self.companies_col.update_one(
                    {"domain": domain},
                    {"$setOnInsert": company_doc},
                    upsert=True,
                )
                if res.upserted_id:
                    result["_db_action"] = "created"
                    result["_company_id"] = res.upserted_id
                else:
                    existing_doc = self.companies_col.find_one({"domain": domain})
                    result["_db_action"] = "updated"
                    result["_company_id"] = existing_doc["_id"] if existing_doc else None
            except Exception as e:
                if "E11000" in str(e) or "duplicate key" in str(e):
                    existing_doc = self.companies_col.find_one({"domain": domain})
                    result["_db_action"] = "skipped_duplicate"
                    result["_company_id"] = existing_doc["_id"] if existing_doc else None
                else:
                    raise

        self._save_contacts(result["_contacts_raw"], result["_company_id"], url)

        return result

    # ========================================================================
    # FETCH CON FALLBACK CLOUDFLARE
    # ========================================================================

    def _get_page(self, url: str, timeout: int = 15):
        """
        Intenta requests primero. Si Cloudflare bloquea (403 / 503 / 999),
        reintenta con cloudscraper que resuelve el desafío JS automáticamente.
        Si todo falla por un problema de SSL (certificado incompleto, hostname
        mismatch, handshake rechazado), reintenta ignorando la verificación del
        certificado y, como último recurso, por HTTP plano — muchos de estos
        sitios solo tienen mal configurado el HTTPS pero responden bien sin él.
        Devuelve el objeto Response o None si todo falla.
        """
        _CF_CODES = {403, 503, 999}
        ssl_failed = False
        try:
            resp = requests.get(url, headers=self.headers, timeout=timeout)
            if resp.status_code not in _CF_CODES:
                return resp
            print(f"🛡️  Cloudflare detectado ({resp.status_code}) en {url} — reintentando con cloudscraper…")
        except requests.exceptions.SSLError:
            ssl_failed = True
        except Exception:
            pass

        if not ssl_failed:
            try:
                import cloudscraper
                if self._cs is None:
                    self._cs = cloudscraper.create_scraper(
                        browser={"browser": "chrome", "platform": "windows", "mobile": False}
                    )
                resp = self._cs.get(url, timeout=timeout)
                if resp.status_code == 200:
                    print(f"✅ cloudscraper superó el desafío: {url}")
                    return resp
                print(f"⚠️  cloudscraper recibió {resp.status_code} en {url}")
            except requests.exceptions.SSLError:
                ssl_failed = True
            except Exception as e:
                print(f"⚠️  cloudscraper falló en {url}: {e}")

        if ssl_failed:
            try:
                resp = requests.get(url, headers=self.headers, timeout=timeout, verify=False)
                print(f"🔓 SSL roto en {url} — funcionó ignorando verificación de certificado")
                return resp
            except Exception as e:
                print(f"⚠️  verify=False falló en {url}: {e}")

            if url.startswith("https://"):
                http_url = "http://" + url[len("https://"):]
                try:
                    resp = requests.get(http_url, headers=self.headers, timeout=timeout)
                    print(f"🔓 HTTPS irrecuperable en {url} — funcionó por HTTP plano ({http_url})")
                    return resp
                except Exception as e:
                    print(f"⚠️  Fallback HTTP falló en {http_url}: {e}")

        return None

    # ========================================================================
    # MULTI-PAGE CRAWLING — AI-powered
    # ========================================================================

    # Fallback keywords when LLM is unavailable
    _CONTACT_KEYWORDS = [
        "contact", "contacto", "contactanos", "contáctanos",
        "about", "nosotros", "quienes", "empresa", "about-us",
        "servicio", "servicios", "service", "services",
        "ubicacion", "ubicación", "donde", "where", "sucursal",
        "llamanos", "llamenos", "telefono", "teléfono",
        "team", "equipo", "directorio", "offices", "stores",
        "find-us", "reach", "info", "informacion", "branch",
        "ayuda", "help", "soporte", "support", "atencion",
        "atención", "atencion-al-cliente", "servicio-al-cliente",
        "customer-service", "asistencia", "centro-de-ayuda",
    ]

    def _find_all_internal_links(self, soup: BeautifulSoup, base_url: str, base_domain: str) -> List[Dict]:
        """Extract every unique internal link with its anchor text and path."""
        seen: set = set()
        links: List[Dict] = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
                continue
            full = urljoin(base_url, href).split("?")[0].split("#")[0].rstrip("/")
            if urlparse(full).netloc.replace("www.", "") != base_domain:
                continue
            if full == base_url.rstrip("/") or full in seen:
                continue
            seen.add(full)
            text = a.get_text(strip=True)[:80]
            links.append({"url": full, "text": text, "path": urlparse(full).path})
        return links

    def _ai_rank_subpages(self, links: List[Dict], industry: str = "") -> List[str]:
        """
        Ask the active LLM (OpenAI or DeepSeek) to rank internal links by probability
        of containing contact info. Falls back to keyword scoring if no LLM is
        configured or the call fails.
        """
        import json as _json, re as _re
        from app.llm import active_provider
        has_llm = active_provider() != "none"

        # Páginas de contacto garantizadas — siempre van primero sin importar el ranking
        _MUST_CRAWL = {
            "contacto", "contactanos", "contacténos", "contact", "contactus",
            "contactenos", "ubicacion", "ubicaciones", "sucursales", "sucursal",
            "telefono", "telefonos", "directorio", "reach-us", "find-us",
            "ayuda", "help", "soporte", "support", "atencion", "atención",
            "atencion-al-cliente", "servicio-al-cliente", "customer-service",
            "asistencia", "centro-de-ayuda",
        }
        must_urls = [
            lk["url"] for lk in links
            if any(kw in lk["path"].lower() for kw in _MUST_CRAWL)
        ]
        non_must  = [lk for lk in links if lk["url"] not in set(must_urls)]

        if has_llm and non_must:
            batch = non_must[:20]
            lines = [f"{i+1}. {lk['path']!r}" for i, lk in enumerate(batch)]
            industry_hint = f" (industria del negocio: {industry})" if industry else ""
            prompt = (
                f"Paths de páginas internas{industry_hint}. "
                f"Ordena por probabilidad de tener contacto (tel, WA, dirección, horarios):\n"
                + "\n".join(lines) +
                f"\n\nResponde SOLO con array JSON de números. Ejemplo: [3,7,1]"
            )
            try:
                from app.llm import call_llm
                content = call_llm([{"role": "user", "content": prompt}], max_tokens=80, temperature=0)
                m = _re.search(r'\[[\d,\s]+\]', content)
                if m:
                    indices = _json.loads(m.group(0))
                    ranked = [batch[i - 1]["url"] for i in indices if 1 <= i <= len(batch)]
                    ranked_set = set(ranked) | set(must_urls)
                    rest = self._keyword_score_links([lk for lk in non_must if lk["url"] not in ranked_set])
                    print(f"🤖 AI ranked {len(ranked)} subpages + {len(must_urls)} páginas de contacto garantizadas")
                    return must_urls + ranked + rest
            except Exception as exc:
                print(f"⚠️  LLM subpage ranking failed ({exc}), using keyword fallback")

        keyword_ranked = self._keyword_score_links(non_must)
        return must_urls + keyword_ranked

    def _keyword_score_links(self, links: List[Dict]) -> List[str]:
        """Fallback: score links by keyword presence in path + anchor text."""
        scored = []
        for lk in links:
            path_lower = lk["path"].lower()
            text_lower = lk["text"].lower()
            score = sum(1 for kw in self._CONTACT_KEYWORDS if kw in path_lower or kw in text_lower)
            if score > 0:
                scored.append((score, lk["url"]))
        scored.sort(key=lambda x: -x[0])
        return [url for _, url in scored]

    def _get_page_js(self, url: str, timeout: int = 20, page=None) -> Optional[str]:
        """
        Renderiza la página con Playwright (Chromium headless) y devuelve el HTML
        completo tras ejecutar JS. Solo se usa cuando los métodos estáticos fallan.
        Si se pasa `page` (de un browser/context ya abiertos por el caller), lo
        reutiliza en vez de lanzar un Chromium nuevo — evita pagar el arranque del
        navegador otra vez cuando se prueban varias URLs candidatas seguidas.
        Devuelve el HTML como string o None si Playwright no está disponible/falla.
        """
        if page is not None:
            try:
                page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
                html = page.content()
                print(f"🎭 Playwright renderizó {url} ({len(html)} chars)")
                return html
            except Exception as e:
                print(f"⚠️  Playwright falló en {url}: {e}")
                return None

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            return None

        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                ctx = browser.new_context(
                    user_agent=self.headers["User-Agent"],
                    locale="es-MX",
                    viewport={"width": 1280, "height": 800},
                )
                page = ctx.new_page()
                page.goto(url, wait_until="networkidle", timeout=timeout * 1000)
                html = page.content()
                browser.close()
                print(f"🎭 Playwright renderizó {url} ({len(html)} chars)")
                return html
        except Exception as e:
            print(f"⚠️  Playwright falló en {url}: {e}")
            return None

    def _scrape_subpage(self, url: str):
        """Fetch a subpage; returns (soup, text) or (None, '') on failure."""
        try:
            resp = self._get_page(url, timeout=10)
            if resp is not None and resp.status_code == 200:
                sub_soup = BeautifulSoup(resp.text, "html.parser")
                return sub_soup, sub_soup.get_text(" ", strip=True)
        except Exception:
            pass
        return None, ""

    def _fetch_sub(self, url: str) -> dict | None:
        """Fetch one subpage and extract all data without touching shared state."""
        sub_soup, sub_text = self._scrape_subpage(url)
        if not sub_soup:
            return None
        phones_s, wa_s = self._extract_from_scripts(sub_soup)
        return {
            "wa_contacts": self._extract_whatsapp_with_labels(sub_soup, sub_text),
            "wa_scripts":  wa_s,
            "phones":      self._extract_phone_numbers(sub_soup, sub_text) + phones_s,
            "emails":      self._extract_emails(sub_text),
            "hours":       self._extract_business_hours(sub_text, sub_soup),
            "address":     self._extract_address(sub_text, sub_soup),
        }

    # ========================================================================
    # EXTRACCIÓN DESDE SCRIPTS (JSON-LD, __NEXT_DATA__, vars inline)
    # ========================================================================

    def _extract_from_scripts(self, soup: BeautifulSoup):
        """
        Extrae teléfonos y WhatsApps de fuentes JS estáticas:
          1. JSON-LD (<script type="application/ld+json">)
          2. __NEXT_DATA__ (Next.js SSR props)
          3. Patrones de teléfono en texto de cualquier <script>
        Devuelve (phones: list[str], wa_numbers: list[str])
        """
        import json as _json

        phones: List[str] = []
        wa_numbers: List[str] = []

        _PHONE_RE = re.compile(
            r'(?:\+52[\s\-]?)?'
            r'(?:\d{3}[\s\.\-]\d{3}[\s\.\-]\d{4}'      # 800 123 4567
            r'|\d{2}[\s\.\-]\d{4}[\s\.\-]\d{4}'          # 55 1234 5678
            r'|\d{10}'                                     # 10 dígitos continuos
            r'|\(\d{3}\)\s*\d{3}[\s\-]?\d{4})'           # (800) 123-4567
        )

        def _harvest(text_blob: str):
            """Busca números en un bloque de texto plano."""
            for m in _PHONE_RE.finditer(text_blob):
                raw = m.group(0)
                clean = self._normalize_phone(raw)
                if clean and clean not in phones:
                    if "whatsapp" in text_blob[max(0, m.start()-30):m.end()+30].lower():
                        if clean not in wa_numbers:
                            wa_numbers.append(clean)
                    else:
                        phones.append(clean)

        def _walk_json(obj):
            """Recorre recursivamente un dict/list buscando campos de teléfono."""
            if isinstance(obj, dict):
                for k, v in obj.items():
                    k_low = k.lower()
                    if any(kw in k_low for kw in ("phone", "telephone", "tel", "whatsapp", "celular", "movil", "móvil")):
                        if isinstance(v, str) and v.strip():
                            clean = self._normalize_phone(v)
                            if clean:
                                target = wa_numbers if "whatsapp" in k_low else phones
                                if clean not in target:
                                    target.append(clean)
                    else:
                        _walk_json(v)
            elif isinstance(obj, list):
                for item in obj:
                    _walk_json(item)
            elif isinstance(obj, str) and len(obj) < 30:
                clean = self._normalize_phone(obj)
                if clean and clean not in phones:
                    phones.append(clean)

        for script in soup.find_all("script"):
            stype = script.get("type", "")
            sid   = script.get("id", "")
            content = script.string or ""
            if not content.strip():
                continue

            # 1. JSON-LD estructurado
            if "application/ld+json" in stype:
                try:
                    data = _json.loads(content)
                    _walk_json(data)
                except Exception:
                    pass
                continue

            # 2. __NEXT_DATA__ (Next.js)
            if sid == "__NEXT_DATA__" or "application/json" in stype:
                try:
                    data = _json.loads(content)
                    _walk_json(data)
                    print(f"📦 __NEXT_DATA__ procesado ({len(str(data))} chars)")
                except Exception:
                    pass
                continue

            # 3. Cualquier script inline — buscar patrones de teléfono
            _harvest(content)

        if phones or wa_numbers:
            print(f"📜 Scripts: {len(phones)} teléfonos, {len(wa_numbers)} WhatsApps encontrados")
        return phones, wa_numbers

    # ========================================================================
    # EXTRACCIÓN DE DATOS DE EMPRESA
    # ========================================================================

    # Palabras genéricas que no sirven como nombre de empresa
    _GENERIC_NAME = re.compile(
        r"^(corporate\s+website|official\s+(site|website)|home\s*page?|bienvenidos?|"
        r"verifica\s+tu\s+identidad|verify\s+your\s+identity|access\s+denied|"
        r"just\s+a\s+moment|attention\s+required|error\s+\d+|403|404|503|"
        r"página\s+de\s+inicio|sitio\s+web\s+oficial|inicio)$",
        re.IGNORECASE,
    )

    def _extract_company_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extrae nombre de la empresa"""
        domain_hint = urlparse(url).netloc.replace("www.", "").split(".")[0].lower()

        # 1. og:site_name — diseñado específicamente para el nombre del sitio
        og_site = soup.find("meta", property="og:site_name")
        if og_site and og_site.get("content"):
            name = og_site["content"].strip()
            if name and len(name) <= 60 and not self._GENERIC_NAME.match(name):
                return name

        # 2. Title tag — buscar la parte que contiene el nombre real
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
            for sep in ["|", "–", "—", " - ", ":", "•", ","]:
                if sep in title:
                    parts = [p.strip() for p in title.split(sep) if p.strip()]
                    # Preferir la parte que contiene el nombre del dominio
                    for p in parts:
                        if domain_hint in p.lower() and len(p) <= 60 and not self._GENERIC_NAME.match(p):
                            return p
                    # Primera parte no genérica
                    for p in parts:
                        if len(p) <= 60 and not self._GENERIC_NAME.match(p):
                            return p
                    break
            # Sin separadores: usar título si es corto y no genérico
            if len(title) <= 60 and not self._GENERIC_NAME.match(title):
                return title

        # 3. Logo alt text — más fiable que H1 para el nombre de marca
        logo = soup.find("img", alt=re.compile(r"logo", re.IGNORECASE))
        if logo and logo.get("alt"):
            alt = logo["alt"].strip()
            if alt and len(alt) <= 60:
                return alt

        # 4. H1 principal
        h1 = soup.find("h1")
        if h1:
            text = h1.get_text(strip=True)
            if text and len(text) <= 60:
                return text

        # 5. Dominio como fallback
        domain = urlparse(url).netloc.replace("www.", "")
        return domain.split(".")[0].capitalize()

    def _detect_industry(self, text: str, soup: BeautifulSoup) -> str:
        """DeepSeek clasifica la industria; keywords como fallback si falla."""
        # 1. Intentar con DeepSeek primero
        llm_result = self._classify_industry_deepseek(text[:800])
        if llm_result:
            return llm_result

        # 2. Fallback: keywords
        import re as _re
        text_lower = text.lower()
        _words = set(_re.findall(r"[\w\u00C0-\u024F]+", text_lower))

        def _count(kw: str, t: str) -> int:
            if " " in kw:
                return t.count(kw)
            return 1 if kw in _words else 0

        # Normalizado por tamaño de lista: sin esto, categorías con más keywords (ej.
        # Manufactura, ~24 palabras) le ganan a categorías con listas cortas (ej.
        # Gas LP / Energía, ~9 palabras) solo por tener más oportunidades de matchear
        # palabras genéricas como "industrial", aunque el sitio sea claramente lo otro.
        scores = {}
        for industry, keywords in self.INDUSTRY_KEYWORDS.items():
            raw = sum(_count(kw, text_lower) for kw in keywords)
            if raw > 0:
                scores[industry] = raw / len(keywords)

        return max(scores, key=scores.get) if scores else "No detectada"

    def _classify_industry_deepseek(self, text_snippet: str) -> str:
        """Usa el LLM activo (OpenAI o DeepSeek) para clasificar industria cuando keywords no son suficientes."""
        from app.llm import active_provider
        if active_provider() == "none" or not text_snippet.strip():
            return ""
        try:
            categories = list(self.INDUSTRY_KEYWORDS.keys())
            prompt = (
                f"Eres un clasificador de industrias. Analiza el texto de este sitio web y elige UNA categor\u00EDa.\n\n"
                f"CATEGOR\u00CDAS DISPONIBLES:\n"
                f"{chr(10).join(f'- {c}' for c in categories)}\n\n"
                f"TEXTO DEL SITIO:\n{text_snippet}\n\n"
                f"INSTRUCCIONES:\n"
                f"- Responde \u00DANICAMENTE con el nombre exacto de la categor\u00EDa (copia y pega).\n"
                f"- Si la empresa distribuye o vende gas LP, GLP, gas natural o combustibles \u2192 responde: Gas LP / Energ\u00EDa\n"
                f"- Si no encaja en ninguna \u2192 responde: No detectada\n"
                f"- NO expliques nada, solo el nombre de la categor\u00EDa."
            )
            from app.llm import call_llm
            result = call_llm([{"role": "user", "content": prompt}], max_tokens=20, temperature=0)
            if result in self.INDUSTRY_KEYWORDS or result == "No detectada":
                return result
        except Exception:
            pass
        return ""

    def _deepseek_enrich_result(self, result: dict, text_snippet: str) -> None:
        """Una sola llamada al LLM activo (OpenAI o DeepSeek) para rellenar campos vacíos: descripción, horarios, servicios, ciudad."""
        import json

        from app.llm import OPENAI_API_KEY, DEEPSEEK_API_KEY
        if not (OPENAI_API_KEY or DEEPSEEK_API_KEY) or not text_snippet.strip():
            return

        extra = result.get("_extra", {})

        need_desc    = not result.get("description") or result["description"] == "Descripción no disponible"
        need_hours   = not extra.get("business_hours")
        need_services= not result.get("services") or len(result.get("services", [])) < 2
        need_city    = not extra.get("city")

        if not any([need_desc, need_hours, need_services, need_city]):
            return

        fields_needed = []
        if need_desc:     fields_needed.append('"descripcion": "2 oraciones sobre qué hace la empresa (null si no hay info)"')
        if need_hours:    fields_needed.append('"horarios": "Horario normalizado ej: Lun-Vie 9:00-18:00, Sáb 10:00-14:00 (null si no hay info)"')
        if need_services: fields_needed.append('"servicios": ["lista", "de", "servicios", "o", "productos"] (array vacío si no hay info)')
        if need_city:     fields_needed.append('"ciudad": "nombre de la ciudad o municipio donde opera (null si no hay info)"')

        prompt = (
            f"Extrae del siguiente texto de un sitio web mexicano solo estos campos en JSON:\n"
            f"{{{', '.join(fields_needed)}}}\n\n"
            f"Texto:\n{text_snippet}\n\n"
            f"Responde ÚNICAMENTE con el JSON, sin explicaciones."
        )

        try:
            from app.llm import call_llm
            raw = call_llm([{"role": "user", "content": prompt}], max_tokens=200, temperature=0)
            start = raw.find("{")
            end   = raw.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(raw[start:end])
                def _val(v):
                    if not v: return None
                    if str(v).strip().lower() in ("null", "none", "n/a", "no disponible", "no hay info", ""): return None
                    return v
                if need_desc and _val(data.get("descripcion")):
                    result["description"] = data["descripcion"]
                if need_hours and _val(data.get("horarios")):
                    result["_extra"]["business_hours"] = data["horarios"]
                if need_services and data.get("servicios"):
                    svs = data["servicios"]
                    if isinstance(svs, list) and svs:
                        result["services"] = svs[:8]
                if need_city and _val(data.get("ciudad")):
                    result["_extra"]["city"] = data["ciudad"]
        except Exception:
            pass  # DeepSeek falló — no bloquear el scraping

    def _extract_description(self, soup: BeautifulSoup, text: str) -> str:
        """Extrae descripción de la empresa"""
        # 1. Meta description
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            desc = meta_desc["content"].strip()
            if len(desc) > 20:
                return desc
        
        # 2. Open Graph description
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            desc = og_desc["content"].strip()
            if len(desc) > 20:
                return desc
        
        # 3. Sección "Acerca de" o "Nosotros"
        about_section = soup.find(["div", "section"], class_=re.compile(
            r"(about|acerca|nosotros|quienes|somos)", re.IGNORECASE
        ))
        if about_section:
            paragraphs = about_section.find_all("p")
            if paragraphs:
                desc = " ".join([p.get_text(strip=True) for p in paragraphs[:2]])
                if len(desc) > 50:
                    return desc[:500]
        
        # 4. Primer párrafo significativo
        paragraphs = soup.find_all("p")
        for p in paragraphs:
            text_p = p.get_text(strip=True)
            if 50 < len(text_p) < 500:
                return text_p
        
        return "Descripción no disponible"

    def _detect_main_activity(self, text: str) -> str:
        """Detecta actividad principal"""
        text_lower = text.lower()
        
        activities = {
            "Venta de productos": ["venta", "productos", "catalogo", "tienda", "comprar", "precio"],
            "Prestación de servicios": ["servicio", "servicios", "atención", "soluciones", "ofrecemos"],
            "Manufactura y producción": ["fabricación", "manufactura", "producción", "fabrica", "elaboramos"],
            "Distribución": ["distribución", "distribuidor", "mayorista", "proveedor", "suministro"],
            "Consultoría": ["consultoría", "asesoría", "consulting", "asesor", "consultores"],
            "Comercio electrónico": ["ecommerce", "tienda online", "compra online", "carrito"],
        }
        
        scores = {}
        for activity, keywords in activities.items():
            score = sum(text_lower.count(keyword) for keyword in keywords)
            if score > 0:
                scores[activity] = score
        
        if scores:
            return max(scores, key=scores.get)
        
        return "Actividad no detectada"

    # ========================================================================
    # EXTRACCIÓN DE DIRECCIÓN
    # ========================================================================

    def _extract_address(self, text: str, soup: BeautifulSoup) -> str:
        """Extrae dirección física completa"""
        # 1. Schema.org
        address_schema = soup.find(["span", "div"], {"itemprop": "address"})
        if address_schema:
            return address_schema.get_text(" ", strip=True)
        
        # 2. Patrones de dirección mexicana
        patterns = [
            r"(?:Calle|Av\.|Avenida|Boulevard|Blvd\.|Calzada)\s+[A-Za-zÁÉÍÓÚáéíóúñÑ\s]+\d+[^\.]{0,100}",
            r"(?:Dirección|Ubicación|Domicilio):\s*([^\n]{20,150})",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(0).strip()
        
        return ""

    def _extract_city(self, text: str) -> str:
        """Extrae ciudad buscando lo que aparece antes de un estado conocido."""
        import re as _re

        states_pat = (r'(Ciudad de México|Estado de México|Nuevo León|Jalisco|Puebla|'
                      r'Veracruz|Guanajuato|Chihuahua|Coahuila|Sonora|Oaxaca|Tamaulipas|'
                      r'Sinaloa|Baja California Sur|Baja California|Guerrero|Michoacán|'
                      r'Hidalgo|Tabasco|Yucatán|Querétaro|San Luis Potosí|Morelos|'
                      r'Aguascalientes|Tlaxcala|Quintana Roo|Nayarit|Campeche|'
                      r'Zacatecas|Colima|Durango|Chiapas)')
        m = _re.search(r'([A-ZÁÉÍÓÚÑ][^,\n]{2,50}),\s*' + states_pat, text)
        if m:
            candidate = m.group(1).strip()
            if not _re.search(r'\d|[Cc]ol\.|[Cc]olonia|[Aa]v\.|[Cc]alle|[Zz]ona', candidate):
                return candidate.title()

        # Fallback: lista de ciudades conocidas
        cities = [
            "Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Tijuana",
            "León", "Juárez", "Torreón", "San Luis Potosí", "Mérida", "Querétaro",
            "Aguascalientes", "Mexicali", "Culiacán", "Cancún", "Tlalnepantla",
            "Ecatepec", "Naucalpan", "Nezahualcóyotl", "Zapopan", "Saltillo",
            "San Pedro Garza García", "Chihuahua", "Hermosillo", "Veracruz",
            "Morelia", "Toluca", "Oaxaca", "Villahermosa", "Tuxtla Gutiérrez",
            "Tepic", "Colima", "La Paz", "Durango", "Zacatecas", "Campeche",
            "Chetumal", "Pachuca", "Tlaxcala", "Cuernavaca",
        ]
        tl = text.lower()
        for city in cities:
            if city.lower() in tl:
                return city
        return ""

    def _extract_state(self, text: str) -> str:
        """Extrae estado — los 32 estados de México."""
        states = [
            "Ciudad de México", "Estado de México", "Jalisco", "Nuevo León",
            "Veracruz", "Puebla", "Guanajuato", "Chihuahua", "Michoacán",
            "Oaxaca", "Tamaulipas", "Sinaloa", "Coahuila", "Guerrero",
            "Baja California", "Sonora", "Hidalgo", "San Luis Potosí",
            "Tabasco", "Yucatán", "Querétaro", "Morelos", "Aguascalientes",
            "Tlaxcala", "Quintana Roo", "Nayarit", "Campeche", "Zacatecas",
            "Colima", "Durango", "Chiapas", "Baja California Sur",
        ]
        tl = text.lower()
        for state in states:
            if state.lower() in tl:
                return state
        return ""

    def _extract_country(self, text: str) -> str:
        """Extrae país"""
        if any(word in text.lower() for word in ["méxico", "mexico", "mx"]):
            return "México"
        return ""

    def _extract_postal_code(self, text: str) -> str:
        """Extrae código postal"""
        # Patrón de CP mexicano (5 dígitos)
        match = re.search(r"\b\d{5}\b", text)
        if match:
            return match.group(0)
        return ""

    # ========================================================================
    # EXTRACCIÓN DE CONTACTOS
    # ========================================================================

    def _extract_wa_label(self, link_tag) -> str:
        """Extrae el nombre de sucursal/label del contexto cercano a un link wa.me."""
        _GENERIC = re.compile(
            r"^(whatsapp|wa|contacto|cont[aá]ctanos|chat|escr[ií]benos|com[uú]nicate|env[ií]anos|"
            r"mensaje|enviar|tel[eé]fono|llama|llamanos|ll[aá]manos|escr[ií]benos|ubi[ck]aci[oó]n|"
            r"direcci[oó]n|horario|sucursal|tienda|local)$",
            re.IGNORECASE,
        )
        _PHONE_RE = re.compile(r"[\d\s\(\)\-\+]{7,}")

        def _clean(raw: str) -> str:
            cleaned = _PHONE_RE.sub("", raw).strip(" \t\n\r|•·–—/\\")
            return cleaned if 2 < len(cleaned) < 60 else ""

        def _is_generic(text: str) -> bool:
            return bool(_GENERIC.match(text.strip()))

        # 1. Alt de imagen dentro del link (más específico que el texto del link)
        img = link_tag.find("img")
        if img and img.get("alt"):
            alt = _clean(img["alt"])
            if alt and not _is_generic(alt):
                return alt

        # 2. Texto del link mismo (si no es genérico)
        link_text = _clean(link_tag.get_text(" ", strip=True))
        if link_text and not _is_generic(link_text):
            return link_text

        # 3. Buscar heading (h1-h6) más cercano — subir hasta 6 niveles en el DOM
        node = link_tag.parent
        for _ in range(6):
            if node is None:
                break
            # Buscar heading hermano previo o dentro del mismo contenedor
            heading = node.find_previous_sibling(re.compile(r"^h[1-6]$"))
            if not heading:
                heading = node.find(re.compile(r"^h[1-6]$"))
            if heading:
                h_text = _clean(heading.get_text(" ", strip=True))
                if h_text and not _is_generic(h_text):
                    return h_text
            node = node.parent

        # 4. Texto del contenedor más cercano con un solo fragmento significativo
        node = link_tag.parent
        for _ in range(4):
            if node is None:
                break
            container_text = _clean(node.get_text(" ", strip=True))
            for fragment in re.split(r"[|•·\n\r–—]", container_text):
                fragment = fragment.strip()
                if 3 < len(fragment) < 60 and not _is_generic(fragment):
                    return fragment
            node = node.parent

        return ""

    def _extract_whatsapp_with_labels(self, soup: BeautifulSoup, text: str) -> List[Dict]:
        """Extrae números de WhatsApp junto con su label de sucursal/contexto."""
        seen: set = set()
        result: List[Dict] = []

        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            raw_num = None
            if "wa.me/" in href:
                raw_num = href.split("wa.me/")[-1].split("?")[0].split("/")[0]
            elif "api.whatsapp.com/send" in href and "phone=" in href:
                raw_num = href.split("phone=")[-1].split("&")[0]
            if not raw_num:
                continue
            clean = self._normalize_phone(raw_num)
            if clean and clean not in seen:
                seen.add(clean)
                result.append({"number": clean, "label": self._extract_wa_label(link)})

        # Texto con contexto "whatsapp" (sin label disponible)
        for raw_num in re.findall(
            r"(?:whatsapp|wa)[:\s]*(\+?\d[\d\s\-\(\)]{8,}\d)", text, re.IGNORECASE
        ):
            clean = self._normalize_phone(raw_num)
            if clean and clean not in seen:
                seen.add(clean)
                result.append({"number": clean, "label": ""})

        return result

    def _extract_whatsapp_numbers(self, soup: BeautifulSoup, text: str) -> List[str]:
        """Extrae números de WhatsApp (solo números, sin label). Usado en subpages."""
        candidates = []

        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            if "wa.me/" in href:
                candidates.append(href.split("wa.me/")[-1].split("?")[0].split("/")[0])
            elif "api.whatsapp.com/send" in href and "phone=" in href:
                candidates.append(href.split("phone=")[-1].split("&")[0])

        candidates.extend(re.findall(
            r"(?:whatsapp|wa)[:\s]*(\+?\d[\d\s\-\(\)]{8,}\d)", text, re.IGNORECASE
        ))

        normalized = []
        for candidate in candidates:
            clean = self._normalize_phone(candidate)
            if clean and clean not in normalized:
                normalized.append(clean)

        return normalized

    def _extract_phone_numbers(self, soup: BeautifulSoup, text: str) -> List[str]:
        """Extrae todos los números telefónicos"""
        candidates = []
        
        # 1. Links tel:
        for link in soup.find_all("a", href=True):
            if link["href"].startswith("tel:"):
                candidates.append(link["href"][4:])
        
        # 2. Patrones de teléfono
        phone_patterns = [
            r"\+?\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{4}",
            r"\d{10}",
            r"\(\d{3}\)\s*\d{3}[\s\-]?\d{4}",
            r"\d{3}[\s\.\-]\d{3}[\s\.\-]\d{4}",   # 800 123 4567 / 800.123.4567
            r"\d{2}[\s\.\-]\d{4}[\s\.\-]\d{4}",   # 55 1234 5678
            r"\d{3}[\s\.\-]\d{4}[\s\.\-]\d{4}",   # 800 1234 5678 (lada larga)
        ]
        
        for pattern in phone_patterns:
            matches = re.findall(pattern, text)
            candidates.extend(matches)
        
        # Normalizar
        normalized = []
        for candidate in candidates:
            clean = self._normalize_phone(candidate)
            if clean and clean not in normalized:
                normalized.append(clean)
        
        return normalized

    def _normalize_phone(self, raw_number: str, default_country_code: str = None) -> Optional[str]:
        """
        Normaliza número telefónico al país configurado en scrape_site (default MX
        si no se seteó — self._default_country_code/_default_local_digits). Descarta
        números con código de país distinto al configurado para esta búsqueda.
        """
        code = default_country_code or getattr(self, "_default_country_code", "+52")
        calling_code = code.lstrip("+")
        local_digits = getattr(self, "_default_local_digits", 10)
        digits = re.sub(r"\D", "", raw_number)

        # N dígitos → número local del país configurado
        if len(digits) == local_digits:
            return f"{code}{digits}"

        # local+código dígitos comenzando con el código de país → +<código><local>
        if len(digits) == local_digits + len(calling_code) and digits.startswith(calling_code):
            return f"+{digits}"

        # Formato viejo de WhatsApp MX con "1" extra tras el 52 → quitarlo
        if calling_code == "52" and len(digits) == local_digits + len(calling_code) + 1 and digits.startswith("521"):
            return f"+52{digits[3:]}"

        # Número explícito con + al inicio: acepta el país configurado para esta
        # búsqueda, o cualquier otro país conocido de COUNTRY_CONFIG — la búsqueda
        # ya no fuerza un solo país (puede cubrir toda Latinoamérica a la vez), así
        # que un número real con su propio código de país no debe descartarse solo
        # porque no coincide con el default de esta corrida.
        if raw_number.strip().startswith("+"):
            if digits.startswith(calling_code) and len(digits) in (
                local_digits + len(calling_code), local_digits + len(calling_code) + 1,
            ):
                return f"+{digits}"
            from app.searcher import COUNTRY_CONFIG as _cc
            for _cfg in _cc.values():
                _cc_code = _cfg["phone_code"].lstrip("+")
                _cc_local = _cfg["local_digits"]
                if digits.startswith(_cc_code) and len(digits) in (_cc_local + len(_cc_code), _cc_local + len(_cc_code) + 1):
                    return f"+{digits}"
            return None  # código de país no reconocido — descartar

        return None

    def _extract_emails(self, text: str) -> List[str]:
        """Extrae emails"""
        pattern = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
        emails = re.findall(pattern, text)
        
        # Filtrar emails no útiles
        excluded = ["example.com", "test.com", "domain.com", "email.com", "yoursite.com"]
        emails = [e for e in emails if not any(ex in e.lower() for ex in excluded)]
        
        return list(dict.fromkeys(emails))

    # Palabras de menú/navegación y vocabulario de negocio que NUNCA son nombres de persona.
    # Si cualquier palabra del candidato aparece aquí, se descarta (evita capturar ítems de menú).
    NAME_STOPWORDS = {
        "facturacion", "facturación", "contacto", "seleccionar", "solicitar", "gas",
        "facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok", "whatsapp",
        "somos", "empresa", "certificada", "contratos", "individuales", "servicio",
        "programado", "medidor", "leer", "condominios", "parque", "industrial",
        "inicio", "nosotros", "productos", "servicios", "sucursales", "sucursal",
        "ubicacion", "ubicación", "ubicaciones", "cotiza", "cotizar", "cotización",
        "menu", "menú", "buscar", "carrito", "iniciar", "sesion", "sesión", "registro",
        "politica", "política", "privacidad", "aviso", "legal", "terminos", "términos",
        "condiciones", "preguntas", "frecuentes", "blog", "noticias", "galeria", "galería",
        "clientes", "proveedores", "trabaja", "nosotros", "quienes", "quiénes", "somos",
        "avenida", "calle", "colonia", "municipio", "estado", "codigo", "código", "postal",
        "num", "numero", "número", "telefono", "teléfono", "email", "correo",
    }

    def _is_probable_person_name(self, name: str) -> bool:
        words = re.findall(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]+", name.lower())
        return bool(words) and not any(w in self.NAME_STOPWORDS for w in words)

    def _extract_person_contacts(self, soup: BeautifulSoup, text: str) -> List[Dict]:
        """Extrae nombres asociados a teléfonos (sucursales, personas, ubicaciones).
        Nota: los resultados van a person_contacts y se usan como labels de números en analytics,
        pero NO se muestran en la UI como 'Personas de contacto'."""
        # Quitar nav/header/footer/menú antes de buscar — ahí viven los falsos positivos
        # (ítems de menú en mayúscula inicial que el regex de nombres confunde con personas).
        clean_soup = BeautifulSoup(str(soup), "html.parser")
        for tag in clean_soup.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()
        for tag in clean_soup.find_all(class_=re.compile(r"(menu|nav|footer|header)", re.IGNORECASE)):
            tag.decompose()

        contacts = []
        team_sections = clean_soup.find_all(["div", "section"], class_=re.compile(
            r"(team|equipo|staff)",
            re.IGNORECASE
        ))
        for section in team_sections:
            contacts.extend(self._parse_contacts_from_text(section.get_text(" ", strip=True)))
        if not contacts:
            clean_text = clean_soup.get_text(" ", strip=True)
            contacts = self._parse_contacts_from_text(clean_text[:5000])
        return self._llm_filter_persons(contacts)

    def _llm_filter_persons(self, candidates: List[Dict]) -> List[Dict]:
        """El regex de arriba solo hace un primer filtro barato (stopwords). Para decidir
        cuáles candidatos son personas reales (vs. ítems de menú, direcciones, nombres de
        servicios que el regex no pudo descartar) y para inferirles un rol, delegamos el
        juicio semántico a un LLM — mucho más confiable que seguir creciendo la lista de
        stopwords a mano. Si no hay LLM configurado o la llamada falla, se usan los
        candidatos del regex tal cual (no bloquea el scraping)."""
        if not candidates:
            return []

        from app.llm import OPENAI_API_KEY, DEEPSEEK_API_KEY
        if not (OPENAI_API_KEY or DEEPSEEK_API_KEY):
            return candidates

        import json
        items = [
            {"name": c["name"], "email": c.get("email", ""), "phone": c.get("phone", "")}
            for c in candidates[:15]
        ]
        prompt = (
            "Te doy una lista de posibles nombres de personas extraídos de un sitio web mexicano "
            "por un regex ingenuo, junto con un teléfono/email cercano en el texto original. "
            "Algunos NO son personas reales: pueden ser ítems de menú de navegación, nombres de "
            "calles/colonias/ciudades, nombres de servicios o productos, o el nombre de la empresa.\n\n"
            f"Candidatos:\n{json.dumps(items, ensure_ascii=False)}\n\n"
            "Responde ÚNICAMENTE con un JSON array, un objeto por candidato, en el MISMO ORDEN:\n"
            '[{"is_person": true/false, "role": "puesto o rol si se puede inferir, si no cadena vacía"}]'
        )
        try:
            from app.llm import call_llm
            raw = call_llm([{"role": "user", "content": prompt}], max_tokens=500, temperature=0)
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start < 0 or end <= start:
                return candidates
            verdicts = json.loads(raw[start:end])
            if not isinstance(verdicts, list) or len(verdicts) != len(items):
                return candidates
            filtered = []
            for cand, verdict in zip(candidates[:15], verdicts):
                if isinstance(verdict, dict) and verdict.get("is_person"):
                    filtered.append({**cand, "role": verdict.get("role") or ""})
            return filtered
        except Exception:
            return candidates

    def _parse_contacts_from_text(self, text: str) -> List[Dict]:
        """Parsea contactos desde texto"""
        contacts = []
        
        # Patrón: Nombre (2-4 palabras capitalizadas)
        name_pattern = r"([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})"
        names = re.findall(name_pattern, text)
        
        for name in names:
            if not self._is_probable_person_name(name):
                continue

            # Buscar contexto alrededor del nombre
            name_pos = text.find(name)
            if name_pos == -1:
                continue
            
            context = text[max(0, name_pos - 150):min(len(text), name_pos + 250)]

            # Buscar email cerca
            email_match = re.search(
                r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
                context
            )
            email = email_match.group(0) if email_match else ""

            # Buscar teléfono cerca
            phone_match = re.search(r"\+?\d[\d\s\-\(\)]{8,}\d", context)
            phone = self._normalize_phone(phone_match.group(0)) if phone_match else ""

            # Solo agregar si tiene al menos email o teléfono
            if email or phone:
                contacts.append({
                    "name": name.strip(),
                    "email": email,
                    "phone": phone,
                    "whatsapp": phone if "whatsapp" in context.lower() else "",
                })
        
        return contacts[:10]  # Máximo 10 contactos

    def _detect_role(self, text: str) -> str:
        """Detecta rol/puesto de una persona"""
        text_lower = text.lower()
        
        for role, keywords in self.ROLE_KEYWORDS.items():
            if any(keyword in text_lower for keyword in keywords):
                return role
        
        return "Contacto General"

    # ========================================================================
    # EXTRACCIÓN DE REDES SOCIALES
    # ========================================================================

    def _extract_social_media(self, soup: BeautifulSoup) -> Dict[str, str]:
        """Extrae redes sociales"""
        social = {
            "facebook": "",
            "instagram": "",
            "twitter": "",
            "linkedin": "",
            "youtube": "",
            "tiktok": "",
        }
        
        for link in soup.find_all("a", href=True):
            href = link["href"].lower()
            
            if "facebook.com" in href and not social["facebook"]:
                social["facebook"] = link["href"]
            elif "instagram.com" in href and not social["instagram"]:
                social["instagram"] = link["href"]
            elif ("twitter.com" in href or "x.com" in href) and not social["twitter"]:
                social["twitter"] = link["href"]
            elif "linkedin.com" in href and not social["linkedin"]:
                social["linkedin"] = link["href"]
            elif "youtube.com" in href and not social["youtube"]:
                social["youtube"] = link["href"]
            elif "tiktok.com" in href and not social["tiktok"]:
                social["tiktok"] = link["href"]
        
        return {k: v for k, v in social.items() if v}

    # ========================================================================
    # EXTRACCIÓN DE INFORMACIÓN ADICIONAL
    # ========================================================================

    def _extract_business_hours(self, text: str, soup: BeautifulSoup = None) -> str:
        """Extrae horario de atención buscando primero patrones estructurados con horas HH:MM."""
        TIME_PAT = re.compile(r'\d{1,2}:\d{2}')
        DAY_PAT  = re.compile(
            r'\b(lun|mar|mié|mie|jue|vie|sáb|sab|dom|lunes|martes|miércoles|miercoles|'
            r'jueves|viernes|sábado|sabado|domingo|mon|tue|wed|thu|fri|sat|sun)\b',
            re.IGNORECASE
        )

        # ── 1. HTML estructurado ──────────────────────────────────────────────
        if soup:
            # a) Tablas cuyas celdas contengan HH:MM
            for table in soup.find_all("table"):
                rows = table.find_all("tr")
                lines = []
                for row in rows:
                    cells = [td.get_text(" ", strip=True) for td in row.find_all(["td", "th"])]
                    row_text = "  ".join(cells)
                    if TIME_PAT.search(row_text):
                        lines.append(row_text)
                if lines:
                    return "\n".join(lines)

            # b) <dl>/<dt>/<dd> que contengan horas
            for dl in soup.find_all("dl"):
                dl_text = dl.get_text(" ", strip=True)
                if TIME_PAT.search(dl_text):
                    pairs = []
                    for dt, dd in zip(dl.find_all("dt"), dl.find_all("dd")):
                        pairs.append(f"{dt.get_text(strip=True)}: {dd.get_text(strip=True)}")
                    if pairs:
                        return "\n".join(pairs)

            # c) Cualquier contenedor cuya clase/id mencione "horario/hours/schedule"
            #    y que contenga al menos un HH:MM
            schedule_el = soup.find(
                lambda tag: tag.name in ("div", "section", "aside", "ul", "p") and
                any(kw in " ".join(tag.get("class", []) + [tag.get("id", "")]).lower()
                    for kw in ("horario", "hours", "schedule", "timetable", "opening"))
            )
            if schedule_el and TIME_PAT.search(schedule_el.get_text()):
                lines = []
                for line in schedule_el.get_text("\n", strip=True).splitlines():
                    line = line.strip()
                    if line and (TIME_PAT.search(line) or DAY_PAT.search(line)):
                        lines.append(line)
                if lines:
                    return "\n".join(lines)

            # d) Cualquier elemento <li> o <p> que contenga día + hora en la misma línea
            candidates = []
            for el in soup.find_all(["li", "p", "span", "div"]):
                el_text = el.get_text(" ", strip=True)
                if TIME_PAT.search(el_text) and DAY_PAT.search(el_text) and len(el_text) < 120:
                    candidates.append(el_text)
            if candidates:
                return "\n".join(candidates[:7])

        # ── 2. Fallback texto plano: líneas con día + HH:MM ──────────────────
        hour_lines = []
        for line in text.splitlines():
            line = line.strip()
            if TIME_PAT.search(line) and DAY_PAT.search(line) and len(line) < 120:
                hour_lines.append(line)
        if hour_lines:
            return "\n".join(hour_lines[:7])

        # ── 3. Último recurso: patrón "horario:" seguido de HH:MM en la misma línea ──
        match = re.search(
            r"(?:horario|horarios|abierto)[^\n]{0,30}\d{1,2}:\d{2}[^\n]{0,80}",
            text, re.IGNORECASE
        )
        if match:
            return match.group(0).strip()

        return ""

    def _extract_services(self, text: str, soup: BeautifulSoup) -> List[str]:
        """Extrae lista de servicios"""
        services = []
        
        # Buscar sección de servicios
        service_section = soup.find(["div", "section"], class_=re.compile(
            r"(service|servicio)", re.IGNORECASE
        ))
        
        if service_section:
            items = service_section.find_all(["li", "h3", "h4"])
            services = [item.get_text(strip=True) for item in items[:10]]
        
        return services

    def _extract_products(self, text: str, soup: BeautifulSoup) -> List[str]:
        """Extrae lista de productos"""
        products = []
        
        # Buscar sección de productos
        product_section = soup.find(["div", "section"], class_=re.compile(
            r"(product|producto|catalogo)", re.IGNORECASE
        ))
        
        if product_section:
            items = product_section.find_all(["li", "h3", "h4"])
            products = [item.get_text(strip=True) for item in items[:10]]
        
        return products

    # ========================================================================
    # METADATA
    # ========================================================================

    def _detect_language(self, soup: BeautifulSoup) -> str:
        """Detecta idioma de la página"""
        html_tag = soup.find("html")
        if html_tag and html_tag.get("lang"):
            return html_tag["lang"]
        return "es"

    def _has_contact_form(self, soup: BeautifulSoup) -> bool:
        """Detecta si tiene formulario de contacto"""
        forms = soup.find_all("form")
        for form in forms:
            form_text = form.get_text().lower()
            if any(word in form_text for word in ["contacto", "mensaje", "email", "nombre"]):
                return True
        return False

    def _has_ecommerce(self, soup: BeautifulSoup) -> bool:
        """Detecta si tiene ecommerce"""
        text = soup.get_text().lower()
        return any(word in text for word in ["carrito", "comprar", "agregar al carrito", "checkout", "precio"])

    # ========================================================================
    # MONGODB — GUARDADO Y TRACKING
    # ========================================================================

    def _save_contacts(self, contacts_raw: Dict, company_id, source_url: str):
        """Guarda contactos en la colección contacts, sin duplicar por normalized_value"""
        all_contacts = []

        for number in contacts_raw.get("all_whatsapp_numbers", []):
            all_contacts.append({
                "company_id": company_id,
                "type": "whatsapp",
                "value": number,
                "normalized_value": number,
                "source": source_url,
                "is_primary": number == (contacts_raw["whatsapp_numbers"] or [None])[0],
                "is_valid": True,
                "has_been_contacted": False,
                "last_contacted_at": None,
                "do_not_contact": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })

        for email in contacts_raw.get("emails", []):
            all_contacts.append({
                "company_id": company_id,
                "type": "email",
                "value": email,
                "normalized_value": email.lower(),
                "source": source_url,
                "is_primary": False,
                "is_valid": True,
                "has_been_contacted": False,
                "last_contacted_at": None,
                "do_not_contact": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })

        for phone in contacts_raw.get("phone_numbers", []):
            all_contacts.append({
                "company_id": company_id,
                "type": "phone",
                "value": phone,
                "normalized_value": phone,
                "source": source_url,
                "is_primary": False,
                "is_valid": True,
                "has_been_contacted": False,
                "last_contacted_at": None,
                "do_not_contact": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })

        for contact in all_contacts:
            # Upsert: filtra por company_id + tipo + valor normalizado
            # Evita duplicados dentro de la misma empresa sin afectar otras
            self.contacts_col.update_one(
                {
                    "company_id": company_id,
                    "type":       contact["type"],
                    "normalized_value": contact["normalized_value"],
                },
                {
                    "$set":         {k: v for k, v in contact.items() if k != "created_at"},
                    "$setOnInsert": {"created_at": contact["created_at"]},
                },
                upsert=True,
            )

    def run_scraping_batch(self, urls: List[str], triggered_by: str = "user") -> Dict:
        """Scrapea múltiples URLs y registra la ejecución en scraping_runs"""
        run_doc = {
            "triggered_by": triggered_by,
            "input_type": "url_list",
            "input_reference": f"{len(urls)} URLs",
            "status": "running",
            "started_at": datetime.now(timezone.utc),
            "finished_at": None,
            "summary": {
                "total_targets": len(urls),
                "processed": 0,
                "failed": 0,
                "new_companies": 0,
                "duplicates": 0,
                "with_whatsapp": 0,
                "without_whatsapp": 0,
            },
            "errors": [],
            "created_at": datetime.now(timezone.utc),
        }
        run_id = self.scraping_runs_col.insert_one(run_doc).inserted_id

        for url in urls:
            try:
                result = self.scrape_site(url)
                run_doc["summary"]["processed"] += 1
                action = result.get("_db_action", "")
                if action == "created":
                    run_doc["summary"]["new_companies"] += 1
                elif action in ("skipped_duplicate", "updated"):
                    run_doc["summary"]["duplicates"] += 1
                if result.get("has_whatsapp"):
                    run_doc["summary"]["with_whatsapp"] += 1
                else:
                    run_doc["summary"]["without_whatsapp"] += 1
            except Exception as e:
                run_doc["summary"]["failed"] += 1
                run_doc["errors"].append({"url": url, "error": str(e)})

        run_doc["status"] = "completed"
        run_doc["finished_at"] = datetime.now(timezone.utc)
        self.scraping_runs_col.update_one(
            {"_id": run_id},
            {"$set": {
                "status": run_doc["status"],
                "finished_at": run_doc["finished_at"],
                "summary": run_doc["summary"],
                "errors": run_doc["errors"],
            }}
        )
        return run_doc["summary"]