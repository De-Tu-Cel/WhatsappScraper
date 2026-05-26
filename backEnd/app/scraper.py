# scraper.py - VERSIÓN EXTENDIDA
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pymongo import MongoClient


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
                "servicio", "servicios", "consultoria", "consultoría", "asesoria",
                "asesoría", "mantenimiento", "reparacion", "reparación",
                "asesor", "consultor", "consulting", "outsourcing",
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
                "servicio automotriz", "agencia autos",
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
                "programación", "it", "tech", "tecnologia", "tecnología",
                "inteligencia artificial", "ia", "saas", "erp", "crm",
                "ciberseguridad", "redes", "infraestructura ti",
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
        client = MongoClient("mongodb://localhost:27017/")
        db = client["comercial"]
        self.companies_col = db["companies"]
        self.contacts_col = db["contacts"]
        self.scraping_runs_col = db["scraping_runs"]

    def scrape_site(self, url: str) -> Dict:
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
        print(f"🔍 Scrapeando: {url}")
        
        try:
            response = requests.get(url, headers=self.headers, timeout=15)
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            if response.status_code == 403:
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
        
        domain = urlparse(url).netloc.replace("www.", "")

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
                "whatsapp_numbers": [],
                "all_whatsapp_numbers": self._extract_whatsapp_numbers(soup, text),
                "phone_numbers": self._extract_phone_numbers(soup, text),
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

        if result["_contacts_raw"]["all_whatsapp_numbers"]:
            result["_contacts_raw"]["whatsapp_numbers"] = [result["_contacts_raw"]["all_whatsapp_numbers"][0]]
            result["has_whatsapp"] = True

        # Deduplicación y guardado en MongoDB
        existing = self.companies_col.find_one({"domain": domain})
        if existing:
            next_scrape = existing.get("next_allowed_scrape_at")
            if next_scrape and next_scrape.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc):
                print(f"⏭️  Dominio ya scrapeado recientemente: {domain}")
                result["_db_action"] = "skipped_duplicate"
                result["_company_id"] = existing["_id"]
                return result
            else:
                self.companies_col.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {
                        "has_whatsapp": result["has_whatsapp"],
                        "last_scraped_at": result["last_scraped_at"],
                        "next_allowed_scrape_at": result["next_allowed_scrape_at"],
                        "updated_at": datetime.now(timezone.utc),
                    }}
                )
                result["_db_action"] = "updated"
                result["_company_id"] = existing["_id"]
        else:
            company_doc = {k: v for k, v in result.items() if not k.startswith("_")}
            inserted = self.companies_col.insert_one(company_doc)
            result["_db_action"] = "created"
            result["_company_id"] = inserted.inserted_id

        self._save_contacts(result["_contacts_raw"], result["_company_id"], url)

        return result

    # ========================================================================
    # EXTRACCIÓN DE DATOS DE EMPRESA
    # ========================================================================

    def _extract_company_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extrae nombre de la empresa"""
        # 1. Meta tag og:site_name
        og_site = soup.find("meta", property="og:site_name")
        if og_site and og_site.get("content"):
            return og_site["content"].strip()
        
        # 2. Title tag (limpiando separadores)
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
            for sep in ["|", "-", "–", "—", ":", "•"]:
                if sep in title:
                    return title.split(sep)[0].strip()
            return title
        
        # 3. H1 principal
        h1 = soup.find("h1")
        if h1:
            return h1.get_text(strip=True)
        
        # 4. Logo alt text
        logo = soup.find("img", alt=re.compile(r"logo", re.IGNORECASE))
        if logo and logo.get("alt"):
            return logo["alt"].strip()
        
        # 5. Dominio
        domain = urlparse(url).netloc.replace("www.", "")
        return domain.split(".")[0].capitalize()

    def _detect_industry(self, text: str, soup: BeautifulSoup) -> str:
        """Detecta industria con keywords extendidos"""
        text_lower = text.lower()
        
        scores = {}
        for industry, keywords in self.INDUSTRY_KEYWORDS.items():
            score = sum(text_lower.count(keyword) for keyword in keywords)
            if score > 0:
                scores[industry] = score
        
        if scores:
            return max(scores, key=scores.get)
        
        return "No detectada"

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
        """Extrae ciudad"""
        # Ciudades principales de México
        cities = [
            "Querétaro", "Ciudad de México", "CDMX", "Guadalajara", "Monterrey",
            "Puebla", "Tijuana", "León", "Juárez", "Torreón", "San Luis Potosí",
            "Mérida", "Aguascalientes", "Mexicali", "Culiacán", "Cancún"
        ]
        
        text_lower = text.lower()
        for city in cities:
            if city.lower() in text_lower:
                return city
        
        return ""

    def _extract_state(self, text: str) -> str:
        """Extrae estado"""
        states = [
            "Querétaro", "Qro", "Ciudad de México", "CDMX", "Jalisco", "Nuevo León",
            "Puebla", "Baja California", "Guanajuato", "Chihuahua", "Coahuila",
            "San Luis Potosí", "Yucatán", "Aguascalientes", "Sinaloa", "Quintana Roo"
        ]
        
        text_lower = text.lower()
        for state in states:
            if state.lower() in text_lower:
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

    def _extract_whatsapp_numbers(self, soup: BeautifulSoup, text: str) -> List[str]:
        """Extrae números de WhatsApp"""
        candidates = []
        
        # 1. Links de WhatsApp
        for link in soup.find_all("a", href=True):
            href = link["href"].strip()
            
            if "wa.me/" in href:
                number = href.split("wa.me/")[-1].split("?")[0].split("/")[0]
                candidates.append(number)
            
            elif "api.whatsapp.com/send" in href:
                if "phone=" in href:
                    number = href.split("phone=")[-1].split("&")[0]
                    candidates.append(number)
            
            elif href.startswith("tel:"):
                candidates.append(href[4:])
        
        # 2. Texto con contexto "WhatsApp"
        whatsapp_context = re.findall(
            r"(?:whatsapp|wa)[:\s]*(\+?\d[\d\s\-\(\)]{8,}\d)",
            text,
            re.IGNORECASE
        )
        candidates.extend(whatsapp_context)
        
        # 3. Normalizar y deduplicar
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

    def _normalize_phone(self, raw_number: str, default_country_code="+52") -> Optional[str]:
        """Normaliza número telefónico"""
        digits = re.sub(r"\D", "", raw_number)
        
        if not 10 <= len(digits) <= 15:
            return None
        
        if raw_number.strip().startswith("+"):
            return f"+{digits}"
        
        if len(digits) == 10:
            return f"{default_country_code}{digits}"
        
        return f"+{digits}"

    def _extract_emails(self, text: str) -> List[str]:
        """Extrae emails"""
        pattern = r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
        emails = re.findall(pattern, text)
        
        # Filtrar emails no útiles
        excluded = ["example.com", "test.com", "domain.com", "email.com", "yoursite.com"]
        emails = [e for e in emails if not any(ex in e.lower() for ex in excluded)]
        
        return list(dict.fromkeys(emails))

    def _extract_person_contacts(self, soup: BeautifulSoup, text: str) -> List[Dict]:
        """
        Extrae contactos de personas específicas
        Busca: Nombre + Rol + Email/Teléfono
        """
        contacts = []
        
        # 1. Buscar secciones de equipo/contacto
        team_sections = soup.find_all(["div", "section"], class_=re.compile(
            r"(team|equipo|contact|contacto|staff|about|nosotros)", re.IGNORECASE
        ))
        
        for section in team_sections:
            section_text = section.get_text(" ", strip=True)
            contacts.extend(self._parse_contacts_from_text(section_text))
        
        # 2. Si no encontró nada, buscar en todo el texto
        if not contacts:
            contacts = self._parse_contacts_from_text(text[:5000])  # Primeros 5000 chars
        
        return contacts

    def _parse_contacts_from_text(self, text: str) -> List[Dict]:
        """Parsea contactos desde texto"""
        contacts = []
        
        # Patrón: Nombre (2-4 palabras capitalizadas)
        name_pattern = r"([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})"
        names = re.findall(name_pattern, text)
        
        for name in names:
            # Buscar contexto alrededor del nombre
            name_pos = text.find(name)
            if name_pos == -1:
                continue
            
            context = text[max(0, name_pos - 150):min(len(text), name_pos + 250)]
            
            # Detectar rol
            role = self._detect_role(context)
            
            # Buscar email cerca
            email_match = re.search(
                r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
                context
            )
            email = email_match.group(0) if email_match else ""
            
            # Buscar teléfono cerca
            phone_match = re.search(r"\+?\d[\d\s\-\(\)]{8,}\d", context)
            phone = self._normalize_phone(phone_match.group(0)) if phone_match else ""
            
            # Solo agregar si tiene rol identificable y al menos email o teléfono
            if role != "Contacto General" and (email or phone):
                contacts.append({
                    "name": name.strip(),
                    "role": role,
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
            if not self.contacts_col.find_one({"normalized_value": contact["normalized_value"]}):
                self.contacts_col.insert_one(contact)

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