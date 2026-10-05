# pipeline.py
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
# from pathlib import Path
import requests
from config import (
    FALLBACK_TO_NUMBER,
    N8N_WEBHOOK_URL,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_LANG,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TEMPLATE,
    EVOLUTION_API_URL,
    EVOLUTION_API_KEY,
    EVOLUTION_INSTANCE,
)
from database import MongoDBManager
from scraper import WebsiteScraper
from whatsapp_client import WhatAppClient
from providers.legacy.evolution import EvolutionClient

DEFAULT_MESSAGE = "Hola, encontré tu negocio en línea y me gustaría presentarte algo que puede ayudarte. ¿Tienes un momento? 😊"

def _domain_matches(domain: str, val: str) -> bool:
    """True if `domain` is exactly `val` or a subdomain of it (not just a substring —
    e.g. 'gaserasmx.com' must NOT match blacklisted value 'x.com')."""
    return domain == val or domain.endswith("." + val)

_INDUSTRY_STOPWORDS = {"en", "de", "del", "la", "el", "los", "las", "y", "e", "para", "con", "un", "una", "cerca"}

def _industry_words(term: str) -> set:
    """Loose, deterministic token set for the industry-mismatch heuristic below —
    normalizes accents/case and singularizes the head noun (reusing searcher.py's
    own helper, same one used to keep the AI filter prompt from misreading a
    plural as "give me a directory") so "restaurantes"/"Restaurante" compare equal
    without needing an LLM call on every single scraped URL.

    Deliberately does NOT expand via searcher.py's INDUSTRY_SYNONYMS table —
    tried that first, but that table is tuned for widening a SEARCH (it
    deliberately cross-links adjacent-but-different business types, e.g.
    "taller mecánico" <-> "refaccionaria", so a search for one also surfaces
    the other). Reusing it here made the exact case this check exists to
    catch invisible again: a "taller mecánico" search matched a scraped
    "Refaccionaria" (auto-parts store, not a mechanic) because the two
    industries are cross-referenced as related, not because they're the same
    business — confirmed while testing this fix, 2026-09-29. Plain token
    overlap is stricter and correctly tells those two apart, at the cost of
    missing pure vocabulary rephrasings the table WOULD have caught (e.g.
    "dentista" vs "clínica dental") — an acceptable trade for a flag-only,
    non-rejecting check where a false positive is far cheaper than a false
    negative."""
    from searcher import _norm_loc, _to_singular_es

    def _tokenize(s: str) -> set:
        norm = _norm_loc(s)
        return {w.strip(",.") for w in norm.split() if len(w) > 2 and w not in _INDUSTRY_STOPWORDS}

    return _tokenize(_to_singular_es(term or ""))


_GIRO_CATEGORY_CACHE: dict[str, str] = {}


def _giro_category(giro: str, scraper) -> str:
    """The scraper's own broad category for a searched giro ("plomeros" →
    "Servicios del Hogar"), so it can be compared with the category it gave
    a scraped site. A search text that still carries its location ("plomeros
    en Mérida", older ideas) is trimmed first. "" when it can't tell."""
    from searcher import _extract_location, _norm_loc
    giro = (_extract_location(giro)[0] or giro).strip()
    key = _norm_loc(giro)
    if key not in _GIRO_CATEGORY_CACHE:
        from bs4 import BeautifulSoup
        try:
            cat = scraper._detect_industry(giro, BeautifulSoup("", "html.parser"), company_name=giro)
        except Exception:
            return ""
        _GIRO_CATEGORY_CACHE[key] = "" if cat in ("", "No detectada") else cat
    return _GIRO_CATEGORY_CACHE[key]


_GIRO_COMPAT_CACHE: dict[tuple[str, str], bool] = {}


def _giro_fits_category(giro: str, category: str) -> bool:
    """Second opinion before flagging a mismatch: the classifier alone put
    "agencias … autos tijuana" under Transporte / Logística and so flagged
    five real car dealerships (Automotriz). True when unsure."""
    from searcher import _norm_loc
    key = (_norm_loc(giro), category)
    if key not in _GIRO_COMPAT_CACHE:
        try:
            from app.llm import call_llm
            ans = call_llm([{"role": "user", "content": (
                f'¿Un negocio clasificado como "{category}" puede ser lo que alguien busca '
                f'con "{giro}"? Responde solo "si" o "no".')}], max_tokens=3, temperature=0)
        except Exception:
            return True
        _GIRO_COMPAT_CACHE[key] = not (ans or "").strip().lower().startswith("n")
    return _GIRO_COMPAT_CACHE[key]


def _fold(text: str) -> str:
    """Lowercase without accents — "Médico" and "medico" compare equal."""
    import unicodedata
    t = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c)).strip()


def _industry_matches(industry: str, blocked: str) -> bool:
    """Accent-insensitive, matched at the start of a word. Short entries (< 4
    letters) must be the whole word (plural tolerated) so "gas" blocks "Gas LP /
    Energía" but not "Gastronomía"; longer ones may be a word's beginning, so
    "farmac" covers "Farmacia" and "cerrajer" both "Cerrajero" and "Cerrajería".
    A plain substring check made "gas" also block "Gastronomía" and "medico"
    miss "Médico"."""
    blocked = _fold(blocked)
    if not blocked:
        return False
    tail = r"(?:es|s)?\b" if len(blocked) < 4 else ""
    return re.search(rf"\b{re.escape(blocked)}{tail}", _fold(industry)) is not None


def _check_blacklist(domain: str, industry: str, name: str = "") -> dict:
    """Returns {reason, matched} if blacklisted, else None.

    An industry entry is checked against the detected industry AND the business
    name: industry detection is coarse for small businesses — "Cerrajería en
    Saltillo" came out as "Servicios", so blocking "cerrajer" let every
    locksmith through (tested 2026-10-04). For Maps leads `industry` is Google's
    category."""
    try:
        db = MongoDBManager()
        entries = list(db.db.blacklist.find({"type": {"$in": ["domain", "industry"]}}))
        domain = (domain or "").lower().strip()
        for e in entries:
            val = e.get("value", "").lower().strip()
            if not val:
                continue
            if e.get("type") == "domain" and domain and _domain_matches(domain, val):
                return {"reason": "domain", "matched": val}
            if e.get("type") == "industry" and any(t and _industry_matches(t, val) for t in (industry, name)):
                return {"reason": "industry", "matched": val}
    except Exception:
        pass
    return None

def _render_message(template: str, scraped: dict, website: str) -> str:
    if not template:
        return DEFAULT_MESSAGE
    _extra = scraped.get("_extra", {})
    name     = scraped.get("name") or scraped.get("metadata", {}).get("title") or "estimado cliente"
    city     = _extra.get("city") or scraped.get("city") or "tu ciudad"
    industry = scraped.get("industry") or "tu sector"
    return (template
        .replace("{{nombre}}",    name)
        .replace("{{ciudad}}",    city)
        .replace("{{industria}}", industry)
        .replace("{{web}}",       website))

def process_url(website: str, message_template: str = None, skip_send: bool = True, user_token: str = None, country: str = None, force: bool = False):
    """
    Pipeline completo con scraper extenso
    """
    db = MongoDBManager()
    scraper = WebsiteScraper()  # Ya usa el nuevo scraper extenso
    wa = WhatAppClient(WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)

    # Si esta URL estaba guardada como "idea" pendiente (ver /api/search), ya se
    # está procesando de verdad — quitarla de pendientes sin importar el resultado
    # (blacklist/fallo/éxito), para que no se quede fantasma en el panel de Ideas.
    # find_one_and_delete (en vez de delete_one) para recuperar target_state antes
    # de borrar el doc — es la única forma de saber a qué estado estaba acotada
    # la búsqueda que produjo esta URL, para el chequeo de ubicación de abajo.
    # También recupera la industria buscada — mismo motivo, para el chequeo
    # de industria (ver más abajo, misma idea que el de ubicación).
    _target_state = None
    _target_city = None
    _target_industry = None
    try:
        _idea = db.db.search_ideas.find_one_and_delete({"url": website})
        _target_state = (_idea or {}).get("target_state")
        _target_city = (_idea or {}).get("target_city")
        _target_industry = (_idea or {}).get("industry_giro") or (_idea or {}).get("industry")
    except Exception:
        pass

    # print(f"📸 Capturando screenshot de {website}...")
    # screenshot_path = capture_screenshot(website)
    screenshot_path = None

    # Domain blacklist check — before scraping to avoid unnecessary work
    from urllib.parse import urlparse as _urlparse
    _domain = _urlparse(website).netloc.lower().replace("www.", "")
    _bl_domain = _check_blacklist(_domain, "")
    if _bl_domain:
        print(f"🚫 Blacklisted domain: {_domain}")
        return {"blacklisted": True, "reason": "domain", "matched": _bl_domain["matched"]}

    print(f"🔍 Scrapeando datos de {website}...")
    scraped = scraper.scrape_site(website, force=force, country=country, target_state=_target_state,
                                  verify_phones=False, target_city=_target_city)
    _extra = scraped.get("_extra", {})
    _cr = scraped.get("_contacts_raw", {})

    # Industry blacklist check — after scraping, undo scraper's DB write if needed
    _industry = scraped.get("industry", "") or ""
    def _discard_new_company():
        _scraped_id = scraped.get("_company_id")
        if _scraped_id and scraped.get("_db_action") == "created":
            from bson import ObjectId
            _oid = ObjectId(str(_scraped_id))
            db.db.companies.delete_one({"_id": _oid})
            # the scraper already saved its contacts — don't leave them orphaned
            db.db.contacts.delete_many({"company_id": {"$in": [_oid, str(_oid)]}})

    _bl_industry = _check_blacklist("", _industry, scraped.get("name") or "")
    if _bl_industry:
        print(f"🚫 Blacklisted industry: {_industry}")
        _discard_new_company()
        return {"blacklisted": True, "reason": "industry", "matched": _bl_industry["matched"],
                "name": scraped.get("name") or "", "industry": _industry}

    # A directory/listing page, not a business: one site with WhatsApp numbers
    # spread over many area codes (vetty.mx: 20 numbers of 20 different
    # groomers across the country, saved as one "company", 2026-10-02).
    _wa_all = {re.sub(r"\D", "", n)[-10:] for n in _cr.get("all_whatsapp_numbers") or []}
    _ladas = {n[:3] for n in _wa_all}
    # Phones count too: electricistasmx.com listed 1,119 phone numbers from
    # all over the country but only 3 WhatsApp links, and got saved as one
    # "company" (2026-10-04).
    _all_nums = _wa_all | {re.sub(r"\D", "", n)[-10:] for n in _cr.get("phone_numbers") or []}
    _all_ladas = {n[:3] for n in _all_nums}
    if (len(_wa_all) >= 8 and len(_ladas) >= 5) or (len(_all_nums) >= 15 and len(_all_ladas) >= 5):
        print(f"🚫 Parece directorio: {len(_all_nums)} números de {len(_all_ladas)} ladas distintas en {website}")
        _discard_new_company()
        return {"blacklisted": True, "reason": "directory",
                "matched": f"directorio ({len(_all_nums)} números de {len(_all_ladas)} ladas)"}

    # Chequeo de ubicación post-scrape — la búsqueda pudo estar acotada a un
    # estado (target_state, recuperado arriba de search_ideas) pero el filtro
    # de "estado equivocado" del buscador solo ve el snippet de búsqueda, no la
    # página real; un negocio sin evidencia de ubicación en su snippet pasa
    # ese filtro aunque su dirección real (recién descubierta aquí, ya
    # scrapeada) sea de otro estado. Caso real que motivó esto (2026-09-24):
    # una búsqueda de "restaurantes en Culiacán, Sinaloa" trajo un restaurante
    # genuino pero ubicado en Tijuana, Baja California. No se rechaza (podría
    # ser una sucursal real, o el usuario decidir contactarlo de todos modos)
    # — solo se marca para que se vea distinto de un prospecto normal.
    _location_mismatch = None
    _detected_state = (_extra.get("state") or "").strip()
    if _target_state and _detected_state:
        from searcher import _norm_loc
        if _norm_loc(_detected_state) != _norm_loc(_target_state):
            _location_mismatch = {
                "searched_state": _target_state.title(),
                "detected_state": _detected_state,
                "detected_city": _extra.get("city") or "",
            }
            print(f"⚠️  Ubicación distinta a la buscada: se buscó {_target_state!r}, "
                  f"se detectó {_detected_state!r} ({_extra.get('city')!r})")
    # Same state, different city: a Torreón plumber in a "plomeros en Saltillo"
    # search is out of the searched zone even though both are in Coahuila (the
    # state check above can't see it). Municipalities of the same metro area
    # (Ramos Arizpe for Saltillo, Zapopan for Guadalajara…) count as the same
    # place. Only for a location the site or its phones gave — one assumed from
    # the search can't disagree with it.
    _detected_city = (_extra.get("city") or "").strip()
    if (_target_city and _detected_city and not _location_mismatch
            and (_extra.get("loc_source") or scraped.get("location_source")) in ("sitio", "texto", "lada")):
        from app.geo import same_area
        if not same_area(_detected_city, _target_city):
            _location_mismatch = {
                "searched_state": (_target_state or "").title(),
                "searched_city": _target_city,
                "detected_state": _detected_state,
                "detected_city": _detected_city,
            }
            print(f"⚠️  Ciudad distinta a la buscada: se buscó {_target_city!r}, se detectó {_detected_city!r}")
    # _target_state is only ever a Mexican state. When every number the site
    # lists is foreign, the address the scraper inferred (it leans on the
    # searched state as a hint) can't be trusted — "talleres mecánicos en León"
    # brought a real León, SPAIN shop (+34 only) saved as León, Guanajuato.
    _nums = (_cr.get("all_whatsapp_numbers") or []) + (_cr.get("phone_numbers") or [])
    if _target_state and not _location_mismatch and _nums and not any(n.lstrip("+").startswith("52") for n in _nums):
        from searcher import COUNTRY_CONFIG as _CC
        _known = sorted({c["phone_code"] for c in _CC.values()}, key=len, reverse=True)
        _codes = sorted({next((k for k in _known if ("+" + n.lstrip("+")).startswith(k)), "+" + n.lstrip("+")[:2])
                         for n in _nums})
        _location_mismatch = {
            "searched_state": _target_state.title(),
            "detected_state": f"otro país (teléfonos {', '.join(_codes)})",
            "detected_city": "",
        }
        print(f"⚠️  Ningún teléfono es de México ({_codes}) para una búsqueda en {_target_state!r}")

    # Chequeo de industria post-scrape — mismo problema que el de ubicación de
    # arriba, pero nunca se le hizo el equivalente: el filtro de industria del
    # buscador (_ai_filter_urls) solo ve el snippet/título de búsqueda, no la
    # página real. Si se equivoca (el propio historial de bugs de este archivo
    # ya tuvo falsos positivos reales — commit 5d12cdb, directorios/catálogos
    # coláandose), nada río abajo lo detectaba (audit finding, 2026-09-29).
    # Heurística determinista (no LLM, corre en CADA scrape, no solo en
    # búsquedas) — comparación difusa de palabras (ver _industry_words). Una
    # reformulación real (p.ej. "dentistas" vs "Clínica Dental") puede dar
    # falso positivo; se marca, no se rechaza — mismo criterio que
    # _location_mismatch, y ese costo es preferible a no detectar nada.
    _industry_mismatch = None
    _detected_industry = (scraped.get("industry") or "").strip()
    if _target_industry and _detected_industry and _detected_industry != "No detectada":
        _target_words = _industry_words(_target_industry)
        _detected_words = _industry_words(_detected_industry)
        if _target_words and _detected_words and not (_target_words & _detected_words):
            # Words alone flagged ~54% of real matches: the scraper files a
            # business under a broad category ("Servicios del Hogar") that never
            # shares a word with the giro searched ("plomeros"). Classify the
            # giro with the same classifier and compare category to category.
            _searched_category = _giro_category(_target_industry, scraper)
            if (_searched_category and _searched_category != _detected_industry
                    and not _giro_fits_category(_target_industry, _detected_industry)):
                _industry_mismatch = {
                    "searched_industry": _target_industry,
                    "searched_category": _searched_category,
                    "detected_industry": _detected_industry,
                }
                print(f"⚠️  Industria distinta a la buscada: se buscó {_target_industry!r} "
                      f"({_searched_category}), se detectó {_detected_industry!r}")

    print(f"💾 Guardando empresa en base de datos...")

    has_whatsapp = bool(_cr.get("whatsapp_numbers"))

    # El scraper ya maneja dedup/update internamente y devuelve el company_id
    _db_action = scraped.get("_db_action")
    _scraped_id = scraped.get("_company_id")

    if _scraped_id:
        # El scraper ya guardó la empresa (created/updated/skipped) — reutilizar ID
        company_id = str(_scraped_id)
        print(f"♻️  Empresa guardada por scraper ({_db_action}), ID: {company_id}")
    else:
        # Dedup por WhatsApp: si no hay dominio, buscar si ya existe una empresa con
        # el mismo número para no crear duplicados en búsquedas repetidas.
        _primary_wa = (_cr.get("whatsapp_numbers") or [None])[0]
        _existing_by_wa = None
        if _primary_wa and not _domain:
            _existing_contact = db.db.contacts.find_one(
                {"type": "whatsapp", "value": _primary_wa}
            )
            if _existing_contact:
                _existing_by_wa = str(_existing_contact["company_id"])
                print(f"♻️  Número WA {_primary_wa} ya existe en empresa {_existing_by_wa} — reutilizando")

        if _existing_by_wa:
            company_id = _existing_by_wa
        else:
            company_id = db.insert_company({
                "name": scraped["name"],
                "industry": scraped["industry"],
                "description": scraped["description"],
                "main_activity": _extra.get("main_activity"),
                "website": website,
                "domain": _domain,
                "address": _extra.get("address"),
                "city": _extra.get("city"),
                "state": _extra.get("state"),
                "country": _extra.get("country"),
                "postal_code": _extra.get("postal_code"),
                "all_locations": _extra.get("all_locations") or [],
                "business_hours": _extra.get("business_hours"),
                "services": _extra.get("services"),
                "products": _extra.get("products"),
                "metadata": scraped["metadata"],
                "has_whatsapp": has_whatsapp,
            })
            print(f"✅ Empresa nueva guardada con ID: {company_id}")

    # Aplicar los flags de ubicación/industria distinta (si los hubo) sin
    # importar cuál de las 3 rutas de arriba resolvió company_id — un solo
    # punto de escritura en vez de repetir el $set en cada rama.
    _mismatch_fields = {}
    if _location_mismatch:
        _mismatch_fields["location_mismatch"] = _location_mismatch
    if _industry_mismatch:
        _mismatch_fields["industry_mismatch"] = _industry_mismatch
    if _mismatch_fields:
        from bson import ObjectId
        db.db.companies.update_one(
            {"_id": ObjectId(company_id)},
            {"$set": _mismatch_fields},
        )

    # ========================================================================
    # GUARDAR CONTACTOS DE WHATSAPP
    # ========================================================================
    _wa_label_map = {c["number"]: c.get("label", "") for c in _cr.get("whatsapp_contacts", [])}
    primary_whatsapp_number = None
    if _cr.get("whatsapp_numbers"):
        primary_whatsapp_number = _cr["whatsapp_numbers"][0]
        print(f"📱 WhatsApp encontrado: {primary_whatsapp_number}")

        db.insert_contact({
            "company_id": company_id,
            "type": "whatsapp",
            "value": primary_whatsapp_number,
            "label": _wa_label_map.get(primary_whatsapp_number, ""),
            "source": website,
            "is_primary": True,
        })

        for wa_num in _cr.get("all_whatsapp_numbers", [])[1:]:
            db.insert_contact({
                "company_id": company_id,
                "type": "whatsapp",
                "value": wa_num,
                "label": _wa_label_map.get(wa_num, ""),
                "source": website,
                "is_primary": False,
            })

    # ========================================================================
    # GUARDAR TELÉFONOS (cap: 20 por empresa)
    # ========================================================================
    # Un número listado como "teléfono" en el sitio (sin ícono/link de WhatsApp)
    # puede tener WhatsApp de todos modos — isRegisteredUser() lo confirma con
    # una consulta real a WhatsApp (sin mandar mensaje), el mismo mecanismo que
    # ya se usa antes de cada envío real (getNumberId()). Antes esto nunca se
    # verificaba: cualquier teléfono sin marca explícita de WhatsApp se perdía
    # como oportunidad de contacto aunque sí tuviera cuenta (2026-09-18).
    MAX_PHONES = 20
    MAX_EMAILS = 10
    _MAX_PHONES_TO_VERIFY = 5  # no estancar el scraping en empresas con muchos números listados
    all_wa = _cr.get("all_whatsapp_numbers", [])
    _connected = []
    try:
        from whatsapp_wwebjs import get_all_connected_instances
        _connected = get_all_connected_instances(db) or []
    except Exception:
        _connected = []

    _verified_wa_found = False
    for _pidx, phone in enumerate(_cr.get("phone_numbers", [])[:MAX_PHONES]):
        if phone in all_wa:
            continue
        _is_wa = None
        if _connected and _pidx < _MAX_PHONES_TO_VERIFY:
            try:
                import random, time
                from daily_cap import reserve_verification_slot
                from whatsapp_wwebjs import verify_number
                # Randomize instance order each lookup instead of always the
                # same one — spreads the "does this number exist?" exposure
                # across every connected account instead of concentrating it
                # on whichever sorts first, forever. Skip any that already
                # used up today's verification quota.
                _candidates = _connected[:]
                random.shuffle(_candidates)
                _verify_instance = next((i for i in _candidates if reserve_verification_slot(db, i)), None)
                if _verify_instance:
                    if _pidx > 0:
                        time.sleep(random.uniform(2.0, 6.0))  # space out lookups — no burst pattern
                    _is_wa = bool(verify_number(_verify_instance, phone).get("registered"))
            except Exception as _verify_err:
                print(f"⚠️  No se pudo verificar WhatsApp para {phone}: {_verify_err}")
                _is_wa = None
        if _is_wa:
            print(f"📱 Teléfono {phone} sí tiene WhatsApp — guardado como contacto de WhatsApp")
            db.insert_contact({
                "company_id": company_id,
                "type": "whatsapp",
                "value": phone,
                "source": website,
                "is_primary": False,
                "detected_via": "phone_verification",
            })
            all_wa.append(phone)
            _verified_wa_found = True
        else:
            db.insert_contact({
                "company_id": company_id,
                "type": "phone",
                "value": phone,
                "source": website,
                # Only a real negative check (not "verification unavailable") should
                # be recorded — otherwise a re-scrape with no connected instance
                # would wrongly stamp verified=False and the backlog script would
                # skip a number that was actually never checked.
                **({"verified": False} if _is_wa is False else {}),
            })

    # has_whatsapp was computed above from the scraper's own whatsapp_numbers
    # BEFORE this verification loop ran — a company whose only WhatsApp-capable
    # number was listed as a plain "phone" would otherwise stay flagged
    # has_whatsapp=False forever despite now having a verified WA contact.
    if _verified_wa_found and not has_whatsapp:
        db.update_company(company_id, {"has_whatsapp": True})
        has_whatsapp = True

    # ========================================================================
    # GUARDAR EMAILS (cap: 10 por empresa)
    # ========================================================================
    for email in _cr.get("emails", [])[:MAX_EMAILS]:
        db.insert_contact({
            "company_id": company_id,
            "type": "email",
            "value": email,
            "source": website,
        })

    # ========================================================================
    # GUARDAR CONTACTOS DE PERSONAS ESPECÍFICAS
    # ========================================================================
    person_contact_ids = []
    for contact in _cr.get("persons", []):
        person_id = db.insert_person_contact({
            "company_id": company_id,
            "name": contact["name"],
            "role": contact.get("role", ""),
            "email": contact.get("email", ""),
            "phone": contact.get("phone", ""),
            "whatsapp": contact.get("whatsapp", ""),
            "source": website,
        })
        person_contact_ids.append(person_id)
        print(f"👤 Contacto guardado: {contact['name']} - {contact.get('role', '')}")

    # ========================================================================
    # GUARDAR REDES SOCIALES
    # ========================================================================
    social_media_id = None
    social_media = _extra.get("social_media", {})
    if social_media:
        social_media_id = db.insert_social_media({
            "company_id": company_id,
            **social_media,
            "source": website,
        })
        print(f"🌐 Redes sociales guardadas: {list(social_media.keys())}")

    # ========================================================================
    # GUARDAR SCREENSHOT EN GRIDFS Y EVIDENCIA (desactivado)
    # ========================================================================
    # screenshot_bytes = Path(screenshot_path).read_bytes()
    # screenshot_file_id = db.save_screenshot_file(
    #     image_bytes=screenshot_bytes,
    #     filename=Path(screenshot_path).name,
    #     metadata={
    #         "type": "page_screenshot",
    #         "source_url": website,
    #         "company_id": company_id,
    #     },
    # )
    # screenshot_evidence_id = db.insert_evidence({
    #     "type": "page_screenshot",
    #     "source_url": website,
    #     "company_id": company_id,
    #     "screenshot_path": screenshot_path,
    #     "screenshot_file_id": screenshot_file_id,
    #     "created_at": datetime.now(),
    # })
    screenshot_file_id = None
    screenshot_evidence_id = None

    # ========================================================================
    # ENVÍO DE WHATSAPP
    # ========================================================================
    to_number = primary_whatsapp_number or FALLBACK_TO_NUMBER

    send_result = None
    message_log_id = None
    message_evidence_id = None
    whatsapp_chat_screenshot_path = None
    whatsapp_chat_screenshot_evidence_id = None

    MESSAGE_TEXT = _render_message(message_template, scraped, website)

    if to_number and not skip_send:
        print(f"📤 Enviando mensaje de WhatsApp a {to_number}...")
        send_result = wa.send_template_message(to_number, WHATSAPP_TEMPLATE, WHATSAPP_LANG)

        response_json = send_result.get("response_json", {})
        message_id = None
        if isinstance(response_json, dict):
            messages = response_json.get("messages", [])
            if messages and isinstance(messages[0], dict):
                message_id = messages[0].get("id")

        message_log_id = db.insert_message_log({
            "channel": "whatsapp",
            "company_id": company_id,
            "to_number": to_number,
            "message_text": MESSAGE_TEXT,
            "status_code": send_result.get("status_code"),
            "message_id": message_id,
            "api_response": response_json,
            "raw_text": send_result.get("raw_text"),
            "sent_at": send_result.get("sent_at"),
            "status": "accepted_by_api" if send_result.get("status_code") == 200 else "failed",
        })

        message_evidence_id = db.insert_evidence({
            "type": "api_send_response",
            "company_id": company_id,
            "message_log_id": message_log_id,
            "to_number": to_number,
            "status_code": send_result.get("status_code"),
            "message_id": message_id,
            "payload": response_json,
            "created_at": datetime.now(),
        })

        # print(f"📸 Capturando screenshot de WhatsApp Web...")
        # whatsapp_chat_screenshot_path = capture_whatsapp_chat_screenshot(to_number)
        # whatsapp_chat_screenshot_evidence_id = db.insert_evidence({
        #     "type": "whatsapp_web_screenshot",
        #     "company_id": company_id,
        #     "message_log_id": message_log_id,
        #     "chat_identifier": to_number,
        #     "screenshot_path": whatsapp_chat_screenshot_path,
        #     "created_at": datetime.now(),
        # })

    # ========================================================================
    # EVOLUTION API — envío por número personal de WhatsApp
    # ========================================================================
    evolution_log_id = None
    evolution_result = None

    # Usar instancia del usuario logueado si hay token, sino la global del .env
    _evo_instance = EVOLUTION_INSTANCE
    _sent_by_name = ""
    _sent_by_user = ""
    if user_token:
        try:
            from auth import get_user_by_token
            _user = get_user_by_token(user_token)
            if _user and _user.get("evolution_instance"):
                _evo_instance = _user["evolution_instance"]
                _sent_by_name = _user.get("display_name", "")
                _sent_by_user = _user.get("username", "")
        except Exception:
            pass

    if EVOLUTION_API_KEY and _evo_instance and to_number and not skip_send:
        print(f"📲 Enviando por Evolution API a {to_number} (instancia: {_evo_instance})...")
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, _evo_instance)
        evolution_result = evo.send_text(to_number, MESSAGE_TEXT)

        evo_json = evolution_result.get("response_json", {})
        evo_message_id = (
            evo_json.get("key", {}).get("id")
            or evo_json.get("id")
            or None
        )
        evo_status = "sent" if evolution_result.get("status_code") == 201 else "failed"

        evolution_log_id = db.insert_message_log({
            "channel": "whatsapp",
            "platform": "evolution",
            "company_id": company_id,
            "to_number": to_number,
            "message_text": MESSAGE_TEXT,
            "status_code": evolution_result.get("status_code"),
            "message_id": evo_message_id,
            "api_response": evo_json,
            "raw_text": evolution_result.get("raw_text"),
            "sent_at": evolution_result.get("sent_at"),
            "status": evo_status,
            "direction": "outbound",
            "sent_by_username": _sent_by_user,
            "sent_by_name":     _sent_by_name,
        })
        print(f"✅ Evolution API: {evo_status} (id={evo_message_id})")

    print(f"✅ Pipeline completado para {website}")

    # ========================================================================
    # RETORNAR RESULTADO COMPLETO
    # ========================================================================
    return {
        "website": website,
        "company_id": company_id,
        "location_mismatch": _location_mismatch,
        "industry_mismatch": _industry_mismatch,
        "scraped": scraped,
        "primary_whatsapp_number": primary_whatsapp_number,
        "all_whatsapp_numbers": _cr.get("all_whatsapp_numbers", []),
        "to_number": to_number,
        "screenshot_path": screenshot_path,
        "screenshot_file_id": screenshot_file_id,
        "screenshot_evidence_id": screenshot_evidence_id,
        "send_result": send_result,
        "message_log_id": message_log_id,
        "message_evidence_id": message_evidence_id,
        "whatsapp_chat_screenshot_path": whatsapp_chat_screenshot_path,
        "whatsapp_chat_screenshot_evidence_id": whatsapp_chat_screenshot_evidence_id,
        "person_contact_ids": person_contact_ids,
        "social_media_id": social_media_id,
        "evolution_log_id": evolution_log_id,
        "evolution_result": evolution_result,
    }
    
_VERIFY_LOCK = threading.Lock()
_last_verify_at = 0.0


def _verify_whatsapp_paced(db, phone: str):
    """isRegisteredUser lookup (no message sent) on a random connected
    instance with verification quota left — True/False, or None when no
    instance could check. Lookups are spaced 3-7s apart process-wide: a Maps
    lead has no page to scrape in between, so a batch of them would otherwise
    fire lookups back-to-back from the same accounts."""
    global _last_verify_at
    import random
    import time
    from daily_cap import reserve_verification_slot
    from whatsapp_wwebjs import get_all_connected_instances, verify_number

    candidates = get_all_connected_instances(db) or []
    if not candidates:
        time.sleep(2)  # the sessions lookup has a 5s timeout; one blip shouldn't skip the check
        candidates = get_all_connected_instances(db) or []
    if not candidates:
        print(f"⚠️  Sin sesión de WhatsApp conectada para verificar {phone}")
        return None
    random.shuffle(candidates)
    with _VERIFY_LOCK:
        wait = _last_verify_at + random.uniform(3.0, 7.0) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        instance = next((i for i in candidates if reserve_verification_slot(db, i)), None)
        if not instance:
            print(f"⚠️  Cupo diario de verificaciones agotado en todas las sesiones — {phone} queda sin verificar")
            return None
        try:
            return bool(verify_number(instance, phone).get("registered"))
        except Exception as e:
            print(f"⚠️  No se pudo verificar WhatsApp para {phone}: {e}")
            return None
        finally:
            _last_verify_at = time.monotonic()


_SOCIAL_KEYS = {"facebook.com": "facebook", "fb.com": "facebook", "instagram.com": "instagram",
                "tiktok.com": "tiktok", "twitter.com": "twitter", "x.com": "twitter",
                "linkedin.com": "linkedin", "youtube.com": "youtube"}


def _country_name_for_code(code: str) -> str:
    from searcher import COUNTRY_CONFIG
    code = (code or "").lower()
    return next((name for name, cfg in COUNTRY_CONFIG.items() if cfg.get("bd_country") == code), "")


def process_maps_lead(maps_url: str, lead: dict = None) -> dict:
    """"Procesar" for a Google Maps business with no website of its own: there
    is no page to scrape, so the company is built from the Maps data captured
    at search time (saved on its search_ideas doc) and its phone is checked for
    WhatsApp. Returns the same shape as process_url so the scrape-job results,
    selection and send flow treat it like any scraped site."""
    from bson import ObjectId

    db = MongoDBManager()
    try:
        _idea = db.db.search_ideas.find_one_and_delete({"url": maps_url})
    except Exception:
        _idea = None
    lead = lead or (_idea or {}).get("maps_lead")
    if not lead:
        raise ValueError("Sin datos de Google Maps para este negocio — vuelve a buscarlo")

    _bl = _check_blacklist("", lead.get("category") or "", lead.get("name") or "")
    if _bl:
        return {"blacklisted": True, "reason": "industry", "matched": _bl["matched"],
                "name": lead.get("name") or "", "industry": lead.get("category") or ""}

    now = datetime.now()
    cid = str(lead["cid"])
    phone = lead["phone"]
    last10 = "".join(filter(str.isdigit, phone))[-10:]
    maps_fields = {
        "maps_url": maps_url,
        "maps_cid": cid,
        "maps_place_id": lead.get("place_id") or "",
        "rating": lead.get("rating"),
        "reviews": lead.get("reviews"),
        "photo_url": lead.get("photo_url") or "",
        "latitude": lead.get("latitude"),
        "longitude": lead.get("longitude"),
    }

    existing = db.db.companies.find_one({"maps_cid": cid})
    if not existing and last10:
        # Same phone AND a matching name — a shared phone alone merged six real
        # locksmiths into a directory site that listed their numbers.
        from searcher import same_business_name
        _extra_generic = (lead.get("category") or "").split() + (lead.get("city") or "").split()
        for _contact in db.db.contacts.find({"type": {"$in": ["whatsapp", "phone"]},
                                             "value": {"$regex": f"{last10}$"}}).limit(20):
            if not ObjectId.is_valid(str(_contact.get("company_id"))):
                continue
            _cand = db.db.companies.find_one({"_id": ObjectId(str(_contact["company_id"]))})
            if _cand and same_business_name(lead.get("name") or "", _cand.get("name") or "", _extra_generic):
                existing = _cand
                break

    if existing:
        company_id = str(existing["_id"])
        # Only fill what's missing — a company first found through its own
        # website keeps its scraped name/industry/address.
        fill = {k: v for k, v in maps_fields.items() if v not in (None, "") and not existing.get(k)}
        if fill:
            db.update_company(company_id, fill)
        company = {**existing, **fill}
        print(f"♻️  Negocio de Maps ya existía ({company.get('name')}), ID: {company_id}")
    else:
        company = {
            "name": lead.get("name") or phone,
            "industry": lead.get("category") or "",
            "description": "",
            "website": "",
            "source": "google_maps",
            "has_website": False,
            "listed_url": lead.get("listed_url") or "",
            "address": lead.get("address") or "",
            "city": lead.get("city") or "",
            "state": lead.get("state") or "",
            "country": _country_name_for_code(lead.get("country_code")),
            "postal_code": lead.get("postal_code") or "",
            "business_hours": lead.get("business_hours") or "",
            **maps_fields,
            "has_whatsapp": False,
            "status": "new",
            "last_scraped_at": now,
            "created_at": now,
            "updated_at": now,
            "metadata": {
                "source": "google_maps",
                "maps_category": lead.get("category") or "",
                "maps_additional_categories": lead.get("additional_categories") or [],
                "is_claimed": bool(lead.get("is_claimed")),
            },
        }
        # Upsert on maps_cid (no `domain` key at all — the unique domain index
        # is sparse, so an explicit null would collide with every other one).
        res = db.db.companies.update_one({"maps_cid": cid}, {"$setOnInsert": company}, upsert=True)
        if res.upserted_id:
            company_id = str(res.upserted_id)
            print(f"✅ Negocio de Maps guardado ({company['name']}), ID: {company_id}")
        else:
            company = db.db.companies.find_one({"maps_cid": cid})
            company_id = str(company["_id"])

    # The Business Profile is what a place with no website still publishes
    # (owner's description, logo, services, payments, review topics) — fetched
    # once per company, here rather than at search time so only the leads
    # someone actually processes cost the extra call.
    if not company.get("maps_profile_at"):
        from searcher import maps_business_details
        details = maps_business_details(cid, lead.get("country_code") or "MX")
        if details:
            upd = {
                "maps_profile": {k: details[k] for k in (
                    "payment_methods", "amenities", "price_level", "review_topics", "rating_distribution",
                    "total_photos", "book_online_url", "related_businesses", "is_claimed")},
                "maps_profile_at": now,
            }
            for k in ("description", "logo_url", "services"):
                if details.get(k) and not company.get(k):
                    upd[k] = details[k]
            db.update_company(company_id, upd)
            company = {**company, **upd}

    is_wa = _verify_whatsapp_paced(db, phone)
    if is_wa:
        db.insert_contact({
            "company_id": company_id, "type": "whatsapp", "value": phone,
            "source": maps_url, "is_primary": True,
            "detected_via": "phone_verification", "verified": True,
        })
        db.update_company(company_id, {"has_whatsapp": True})
        print(f"📱 {phone} sí tiene WhatsApp")
    else:
        db.insert_contact({
            "company_id": company_id, "type": "phone", "value": phone, "source": maps_url,
            **({"verified": False} if is_wa is False else {}),
        })

    listed = lead.get("listed_url") or ""
    if listed:
        from urllib.parse import urlparse as _urlparse
        _host = _urlparse(listed).netloc.lower().removeprefix("www.").removeprefix("m.")
        _key = next((v for k, v in _SOCIAL_KEYS.items() if _host == k or _host.endswith("." + k)), None)
        if _key and not db.db.social_media.find_one({"company_id": company_id, _key: {"$exists": True}}):
            db.insert_social_media({"company_id": company_id, _key: listed, "source": maps_url})

    wa_numbers = [phone] if is_wa else []
    scraped = {
        "name": company.get("name"),
        "industry": company.get("industry"),
        "description": company.get("description") or "",
        "website": "",
        "maps_url": maps_url,
        "no_website": True,
        "city": company.get("city") or "",
        "state": company.get("state") or "",
        "address": company.get("address") or "",
        "rating": company.get("rating"),
        "reviews": company.get("reviews"),
        "photo_url": company.get("photo_url") or "",
        "logo_url": company.get("logo_url") or "",
        "_extra": {"city": company.get("city") or "", "state": company.get("state") or "",
                   "services": company.get("services") or []},
    }
    return {
        "website": maps_url,
        "company_id": company_id,
        "scraped": scraped,
        "primary_whatsapp_number": wa_numbers[0] if wa_numbers else None,
        "all_whatsapp_numbers": wa_numbers,
        "wa_verified": is_wa,
        "phone": phone,
    }


_BATCH_WORKERS = 10  # URLs procesadas en paralelo
_SUB_WORKERS   = 4   # subpáginas en paralelo dentro de cada sitio


def run_pipeline_batch(urls: list, skip_send: bool = True) -> dict:
    """
    Procesa múltiples URLs en lote (10 workers en paralelo).
    skip_send defaults to True — this endpoint has no message_template input at
    all, so a caller that forgets to opt out would otherwise silently blast
    DEFAULT_MESSAGE (a generic sales pitch) to every WhatsApp number found.
    """
    ordered: dict[str, dict] = {}  # url → result entry, preserves input order

    def _process_one(url: str) -> tuple[str, dict]:
        try:
            result = process_url(url, skip_send=skip_send)
            return url, {"url": url, "status": "ok", "result": result}
        except Exception as e:
            return url, {"url": url, "status": "error", "error": str(e)}

    with ThreadPoolExecutor(max_workers=_BATCH_WORKERS) as pool:
        futures = {pool.submit(_process_one, url): url for url in urls}
        for future in as_completed(futures):
            url, entry = future.result()
            ordered[url] = entry

    # Reconstruct in original input order
    results = [ordered[url] for url in urls if url in ordered]

    summary = {
        "procesados": 0,
        "con_wa": 0,
        "mensajes_enviados": 0,
        "errores": 0,
    }
    for entry in results:
        if entry["status"] == "error":
            summary["errores"] += 1
        else:
            summary["procesados"] += 1
            r = entry["result"]
            if r.get("primary_whatsapp_number"):
                summary["con_wa"] += 1
            if r.get("send_result") and r["send_result"].get("status_code") == 200:
                summary["mensajes_enviados"] += 1

    return {"summary": summary, "results": results}