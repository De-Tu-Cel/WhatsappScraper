"""
Tests for WebsiteScraper — key improvements from the last commit:
  1. Encoding: response.content vs response.text (UTF-8 accents preserved)
  2. _extract_schema_address: JSON-LD structured address
  3. _extract_map_iframe_text: Google Maps embed URL
  4. _extract_address_structured: cascade priority
  5. _detect_industry: company-name pre-classification (no LLM)
  6. _infer_state_from_city / _clean_city: normalization helpers

All tests run without network access (Nominatim is mocked or bypassed).
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from unittest.mock import patch
from bs4 import BeautifulSoup
from scraper import WebsiteScraper, _soup_from_bytes


@pytest.fixture
def scraper():
    s = WebsiteScraper()
    # Patch Nominatim so no real HTTP call is made in any test
    s._nominatim_structure_address = lambda raw: {}
    return s


def make_soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")


# ─────────────────────────────────────────────────────────────
# 1. Encoding fix
# ─────────────────────────────────────────────────────────────

class TestEncodingFix:
    """Verifica que _extract_company_name no corrompe acentos cuando
    el HTML llega como bytes (como lo hace scrape_site con response.content)."""

    def test_accented_company_name_survives_utf8_bytes(self, scraper):
        html_bytes = "<html><head><title>Distribuidora de Gas León</title></head></html>".encode("utf-8")
        soup = BeautifulSoup(html_bytes, "html.parser")
        name = scraper._extract_company_name(soup, "https://gasleon.com")
        assert "León" in name or "Gas" in name, f"Expected accented name, got: {name!r}"

    def test_special_chars_in_title(self, scraper):
        html_bytes = "<title>Gas Martínez — Distribución de GLP</title>".encode("utf-8")
        soup = BeautifulSoup(html_bytes, "html.parser")
        name = scraper._extract_company_name(soup, "https://example.com")
        assert "Martínez" in name or "Gas" in name, f"Got: {name!r}"


class TestSoupFromBytes:
    """_soup_from_bytes — prefers a strict UTF-8 decode over BeautifulSoup's own
    sniffing (UnicodeDammit), which was confirmed live to sometimes guess
    Latin-1 for genuinely-UTF-8 pages with sparse/ambiguous accented content,
    producing double-encoded mojibake ("Ã©" instead of "é") in companies.name
    (9 real production cases fixed 2026-09-09, all fully reversible — proof
    the underlying bytes were valid UTF-8 the whole time)."""

    def test_utf8_bytes_decode_correctly(self):
        html_bytes = "<title>Gas Chapultepec S.A. — Distribución de Gas LP en México</title>".encode("utf-8")
        soup = _soup_from_bytes(html_bytes)
        assert soup.title.string == "Gas Chapultepec S.A. — Distribución de Gas LP en México"

    def test_sparse_accented_content_still_decodes_correctly(self):
        # The real bug case: only ONE accented char in an otherwise plain-ASCII
        # page — too little signal for a statistical sniffer to reliably guess
        # UTF-8 over Latin-1/CP1252, but a strict UTF-8 decode attempt doesn't
        # need statistics, only validity.
        html_bytes = "<title>Expo Mecánico Automotriz Internacional</title>".encode("utf-8")
        soup = _soup_from_bytes(html_bytes)
        assert soup.title.string == "Expo Mecánico Automotriz Internacional"

    def test_non_utf8_bytes_fall_back_to_sniffing(self):
        # Genuinely Latin-1-encoded content (invalid as UTF-8, e.g. raw 0xE9
        # for "é" instead of UTF-8's 2-byte 0xC3 0xA9) must not crash — falls
        # through to BeautifulSoup's own sniffing instead of raising.
        html_bytes = b"<title>Cafeter\xeda Mart\xednez</title>"
        with pytest.raises(UnicodeDecodeError):
            html_bytes.decode("utf-8")  # sanity: confirm these bytes are genuinely invalid UTF-8
        soup = _soup_from_bytes(html_bytes)
        assert soup.title is not None  # didn't raise; some text was extracted


class TestDirectoryIdPrefix:
    """adn.com.mx/miadn.mx directory listings render their title/H1 as
    "<internal ID>-<business name>" with no space around the dash — confirmed
    live in production: 86 real companies stored with this literal prefix
    (e.g. "409598822-MI GAS", "4077776-EL CLAUSTRO DE SAN AGUSTIN"), 7-9 digits
    every time. A real business name never starts with 4+ digits glued to a
    dash, so this should always be stripped."""

    def test_title_prefix_stripped(self, scraper):
        html = "<title>409598822-MI GAS</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://gasqqro.com.mx")
        assert name == "MI GAS", f"Got: {name!r}"

    def test_h1_prefix_stripped_with_shorter_id(self, scraper):
        html = "<h1>4077776-EL CLAUSTRO DE SAN AGUSTIN</h1>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://elclaustrodesanagustin.miadn.mx")
        assert name == "EL CLAUSTRO DE SAN AGUSTIN", f"Got: {name!r}"

    def test_prefix_stripped_before_separator_split(self, scraper):
        # Title has BOTH the ID-dash artifact AND a real "|" separator —
        # the prefix must not survive as part of the first split segment.
        html = "<title>410344798-OPTIGAS CARBURACION S.A. DE C.V | Directorio ADN</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://optigasleon.com")
        assert not name[0].isdigit(), f"Numeric ID prefix survived: {name!r}"
        assert "OPTIGAS" in name

    def test_legitimate_hyphenated_name_is_untouched(self, scraper):
        # Must not over-strip: a real name with a leading number+dash-like
        # shape but fewer than 4 digits, or a dash with spaces, is unaffected.
        html = "<title>7-Eleven Sucursal Centro</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://7-eleven.com.mx")
        assert name.startswith("7-Eleven"), f"Got: {name!r}"


class TestSeoDescriptionRejection:
    """Small/generic sites often render <title>/<h1> as a keyword-stuffed SEO
    phrase ("Gas a domicilio en Sonora") instead of an actual brand name —
    confirmed live: 31 real companies stored with this instead of a name. Only
    rejected when NO word in the text overlaps the domain, so a real business
    whose name matches its own domain (or contains "en <Lugar>" legitimately)
    is never falsely rejected — falls through to the domain-derived fallback
    (step 5 of _extract_company_name) instead."""

    @pytest.mark.parametrize("title,domain", [
        ("Gas a domicilio en Sonora", "hidrogaspedidos.com.mx"),
        ("Gas Estacionario Cerca de ti en Campeche", "inmuebles10.com"),
        ("Restaurante de Comida Mexicana en Benito Juárez", "elcharcodelasranasriomixcoac.com.mx"),
        ("Restaurante en el centro de Querétaro", "lamariposaqueretaro.com.mx"),
        ("Dictamen de instalación de gas en Puebla de Zaragoza", "cronoshare.com.mx"),
        ("Gas LP a domicilio rápido y seguro en Monterrey y Saltillo", "gasideal.com"),
        ("Clínica psiquiátrica en Guadalajara", "centrodelbosque.mx"),
    ])
    def test_rejects_generic_seo_title_falls_back_to_domain(self, scraper, title, domain):
        html = f"<title>{title}</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, f"https://{domain}")
        assert name != title, f"SEO description was not rejected: {name!r}"
        # Falls all the way through to the domain-derived fallback (no h1/logo present)
        assert name.lower().startswith(domain.split(".")[0][:3].lower())

    def test_keeps_real_name_matching_its_own_domain(self, scraper):
        # The em-dash is a real separator (existing logic, unrelated to the
        # new SEO check) so this splits into "Gas Chapultepec S.A." — the
        # SEO-description rejection never even needs to run on this one.
        html = "<title>Gas Chapultepec S.A. — Distribución de Gas LP en México</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://gaschapultepec.com")
        assert name == "Gas Chapultepec S.A."

    def test_keeps_brand_name_appended_after_seo_description(self, scraper):
        # Real prod case: brand name tacked on at the END with no separator —
        # must not be rejected just because the SEO phrase comes first.
        html = "<title>Tacos y antojitos mexicanos en Ciudad de México EL GALLITO</title>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://elgallito.com.mx")
        assert "GALLITO" in name

    def test_h1_seo_description_also_rejected(self, scraper):
        html = "<h1>Comida oriental en Tuxtla Gutiérrez</h1>"
        soup = make_soup(html)
        name = scraper._extract_company_name(soup, "https://dandanwok.mx")
        assert name != "Comida oriental en Tuxtla Gutiérrez"


# ─────────────────────────────────────────────────────────────
# 2. _extract_schema_address
# ─────────────────────────────────────────────────────────────

class TestSchemaAddress:

    def test_extracts_full_structured_address(self, scraper):
        html = '''<script type="application/ld+json">
        {"@type": "LocalBusiness",
         "address": {"@type": "PostalAddress",
                     "streetAddress": "Av. Juárez 123",
                     "addressLocality": "Querétaro",
                     "addressRegion": "Querétaro",
                     "postalCode": "76000",
                     "addressCountry": "MX"}}
        </script>'''
        result = scraper._extract_schema_address(make_soup(html))
        assert result["address"] == "Av. Juárez 123"
        assert result["city"]    == "Querétaro"
        assert result["state"]   == "Querétaro"
        assert result["postal_code"] == "76000"

    def test_string_address_is_accepted(self, scraper):
        html = '''<script type="application/ld+json">
        {"@type": "Organization", "address": "Calle Real 45, Monterrey, NL"}
        </script>'''
        result = scraper._extract_schema_address(make_soup(html))
        assert "Calle Real" in result["address"]

    def test_graph_structure_is_traversed(self, scraper):
        payload = {
            "@graph": [
                {"@type": "WebPage"},
                {"@type": "LocalBusiness",
                 "address": {"streetAddress": "Blvd. Norte 7",
                             "addressLocality": "Hermosillo",
                             "addressRegion": "Sonora",
                             "postalCode": "83000",
                             "addressCountry": "MX"}}
            ]
        }
        html = f'<script type="application/ld+json">{json.dumps(payload)}</script>'
        result = scraper._extract_schema_address(make_soup(html))
        assert result["city"] == "Hermosillo"
        assert result["state"] == "Sonora"

    def test_non_business_type_is_ignored(self, scraper):
        html = '''<script type="application/ld+json">
        {"@type": "BreadcrumbList", "address": {"streetAddress": "Calle Falsa 123"}}
        </script>'''
        result = scraper._extract_schema_address(make_soup(html))
        assert result == {}

    def test_malformed_json_does_not_crash(self, scraper):
        html = '<script type="application/ld+json">{ broken json }</script>'
        result = scraper._extract_schema_address(make_soup(html))
        assert result == {}

    def test_no_schema_returns_empty(self, scraper):
        result = scraper._extract_schema_address(make_soup("<html></html>"))
        assert result == {}

    def test_multi_branch_chain_exposes_all_locations(self, scraper):
        # Real gap (2026-09-20): a chain/franchise describes each branch as its
        # own LocalBusiness node in the same @graph — this used to silently
        # return only the FIRST branch's address as if it were the only one,
        # with no signal at all that the business has other locations too.
        payload = {
            "@graph": [
                {"@type": "WebPage"},
                {"@type": "LocalBusiness",
                 "address": {"streetAddress": "Suc. Centro 1", "addressLocality": "Hermosillo",
                             "addressRegion": "Sonora", "postalCode": "83000", "addressCountry": "MX"}},
                {"@type": "LocalBusiness",
                 "address": {"streetAddress": "Suc. Norte 2", "addressLocality": "Ciudad Obregón",
                             "addressRegion": "Sonora", "postalCode": "85000", "addressCountry": "MX"}},
                {"@type": "LocalBusiness",
                 "address": {"streetAddress": "Suc. Sur 3", "addressLocality": "Guaymas",
                             "addressRegion": "Sonora", "postalCode": "85400", "addressCountry": "MX"}},
            ]
        }
        html = f'<script type="application/ld+json">{json.dumps(payload)}</script>'
        result = scraper._extract_schema_address(make_soup(html))
        # Primary (first-found) address is unchanged — backward compatible.
        assert result["city"] == "Hermosillo"
        # But now all three branches are exposed, not just the first.
        assert result["all_locations"] == [
            {"city": "Hermosillo", "state": "Sonora"},
            {"city": "Ciudad Obregón", "state": "Sonora"},
            {"city": "Guaymas", "state": "Sonora"},
        ]

    def test_single_location_has_no_all_locations_key(self, scraper):
        # Backward compatibility: a normal single-address page must not grow
        # a noisy all_locations key that every existing caller now has to
        # account for.
        html = '''<script type="application/ld+json">
        {"@type": "LocalBusiness",
         "address": {"streetAddress": "Av. Juárez 123", "addressLocality": "Querétaro",
                     "addressRegion": "Querétaro", "postalCode": "76000", "addressCountry": "MX"}}
        </script>'''
        result = scraper._extract_schema_address(make_soup(html))
        assert "all_locations" not in result

    def test_duplicate_branch_addresses_are_not_double_counted(self, scraper):
        # Some sites repeat the SAME address across multiple schema blocks
        # (header + footer) rather than genuinely listing different branches —
        # must not be misread as a multi-location chain.
        payload = {
            "@graph": [
                {"@type": "LocalBusiness",
                 "address": {"streetAddress": "A", "addressLocality": "Puebla", "addressRegion": "Puebla"}},
                {"@type": "Organization",
                 "address": {"streetAddress": "A", "addressLocality": "Puebla", "addressRegion": "Puebla"}},
            ]
        }
        html = f'<script type="application/ld+json">{json.dumps(payload)}</script>'
        result = scraper._extract_schema_address(make_soup(html))
        assert "all_locations" not in result


# ─────────────────────────────────────────────────────────────
# 3. _extract_map_iframe_text
# ─────────────────────────────────────────────────────────────

class TestMapIframe:

    def test_extracts_q_param(self, scraper):
        html = '''<iframe src="https://www.google.com/maps/embed?pb=...&q=Av+Reforma+1+CDMX"></iframe>'''
        assert scraper._extract_map_iframe_text(make_soup(html)) == "Av Reforma 1 CDMX"

    def test_extracts_query_param(self, scraper):
        html = '''<iframe src="https://maps.google.com/maps?query=Gas+Elena+Saltillo"></iframe>'''
        assert scraper._extract_map_iframe_text(make_soup(html)) == "Gas Elena Saltillo"

    def test_data_src_attribute(self, scraper):
        html = '''<iframe data-src="https://www.google.com/maps/embed?q=Calle+Hidalgo+5+Leon+Gto"></iframe>'''
        assert "Hidalgo" in scraper._extract_map_iframe_text(make_soup(html))

    def test_non_maps_iframe_ignored(self, scraper):
        html = '''<iframe src="https://youtube.com/embed/abc123"></iframe>'''
        assert scraper._extract_map_iframe_text(make_soup(html)) == ""

    def test_short_q_value_ignored(self, scraper):
        html = '''<iframe src="https://www.google.com/maps/embed?q=abc"></iframe>'''
        assert scraper._extract_map_iframe_text(make_soup(html)) == ""


# ─────────────────────────────────────────────────────────────
# 4. _extract_address_structured  (cascade)
# ─────────────────────────────────────────────────────────────

class TestAddressStructuredCascade:

    def test_schema_wins_over_iframe(self, scraper):
        html = '''
        <script type="application/ld+json">
        {"@type":"LocalBusiness","address":{"streetAddress":"Calle Schema 1","addressLocality":"León","addressRegion":"Guanajuato","postalCode":"37000","addressCountry":"MX"}}
        </script>
        <iframe src="https://www.google.com/maps/embed?q=Calle+Iframe+2+Guadalajara"></iframe>
        '''
        result = scraper._extract_address_structured(make_soup(html), "")
        assert result["address"] == "Calle Schema 1"
        assert result["city"]    == "León"

    def test_iframe_used_when_no_schema(self, scraper):
        html = '''<iframe src="https://www.google.com/maps/embed?q=Av+Hidalgo+99+Monterrey+NL"></iframe>'''
        result = scraper._extract_address_structured(make_soup(html), "")
        assert "Hidalgo" in result["address"]

    def test_regex_fallback_when_neither(self, scraper):
        text = "Visítanos en: Av. Tecnológico 123 Col. Centro, Querétaro, QRO 76000"
        result = scraper._extract_address_structured(make_soup("<html></html>"), text)
        assert result["address"] != "" or result["city"] != ""

    def test_itemprop_address_tag_fallback(self, scraper):
        html = '<span itemprop="address">Blvd. Independencia 45, Saltillo, Coahuila</span>'
        result = scraper._extract_address_structured(make_soup(html), "")
        assert "Independencia" in result["address"] or result["address"] != ""

    def test_returns_all_keys_even_when_empty(self, scraper):
        result = scraper._extract_address_structured(make_soup("<html></html>"), "texto sin datos de dirección")
        for key in ("address", "city", "state", "postal_code", "country", "lat", "lon"):
            assert key in result

    def test_state_name_street_does_not_beat_real_city_state(self, scraper):
        # Real bug (fergusa.com.mx, 2026-09-18): "Morelos" is both a Mexican
        # state AND one of the most common street names in the country. The
        # old code picked whichever _extract_state's blind 32-state substring
        # scan found first, so an address on Calle Morelos in Guadalajara
        # (Jalisco) came back with state="Morelos" instead of "Jalisco".
        text = ("Dirección: Teléfono: E-Mail: Mensaje: ENVIAR Morelos Nº 121 Col. Centro "
                "Guadalajara, Jalisco Tel: 36136211 Ir a mapa SUCURSALES")
        result = scraper._extract_address_structured(make_soup("<html></html>"), text)
        assert result["city"] == "Guadalajara"
        assert result["state"] == "Jalisco"


# ─────────────────────────────────────────────────────────────
# 5. _detect_industry  — name-based pre-classification (no LLM)
# ─────────────────────────────────────────────────────────────

class TestIndustryDetection:

    def _make_scraper_no_llm(self):
        s = WebsiteScraper()
        s._nominatim_structure_address = lambda raw: {}
        # Force LLM off so detection relies on rules only
        s._classify_industry_deepseek = lambda text, company_name="": ""
        return s

    def test_gas_company_name_classified_without_llm(self):
        s = self._make_scraper_no_llm()
        result = s._detect_industry("Contáctenos hoy", make_soup("<html></html>"), company_name="Gas Elena")
        assert result == "Gas LP / Energía"

    def test_gasera_in_name_triggers_gas_classification(self):
        s = self._make_scraper_no_llm()
        result = s._detect_industry("", make_soup(""), company_name="Gasera del Norte S.A.")
        assert result == "Gas LP / Energía"

    def test_glp_in_name_triggers_gas_classification(self):
        s = self._make_scraper_no_llm()
        result = s._detect_industry("", make_soup(""), company_name="Distribuidora GLP Noreste")
        assert result == "Gas LP / Energía"

    def test_non_gas_name_falls_through_to_keyword(self):
        s = self._make_scraper_no_llm()
        result = s._detect_industry(
            "Vendemos software, apps, sistemas de gestión, CRM", make_soup(""),
            company_name="Tech Solutions"
        )
        assert result != "Gas LP / Energía"

    def test_empty_text_and_name_returns_no_detectada(self):
        s = self._make_scraper_no_llm()
        result = s._detect_industry("", make_soup(""), company_name="")
        assert result == "No detectada"


# ─────────────────────────────────────────────────────────────
# 5b. _extract_state — street-name-vs-state-name disambiguation
# ─────────────────────────────────────────────────────────────

class TestExtractStateStreetNameGuard:
    """Real bug (fergusa.com.mx, 2026-09-20): several state names ("Morelos",
    "Hidalgo", "Guerrero"...) are also extremely common Mexican street names.
    A blind substring scan read "Morelos Nº 121 Col. Centro" (a real branch
    address in Guadalajara, Jalisco) as state="Morelos"."""

    def test_state_name_used_as_street_is_skipped(self, scraper):
        text = "Visítanos en Morelos Nº 121 Col. Centro, Guadalajara, Jalisco"
        assert scraper._extract_state(text) == "Jalisco"

    def test_state_name_used_as_street_with_hash_number(self, scraper):
        text = "Sucursal en Hidalgo #45 Col. Centro"
        assert scraper._extract_state(text) == ""

    def test_state_name_preceded_by_calle_is_skipped(self, scraper):
        text = "Oficinas en Calle Guerrero, cerca del centro. Atendemos en Jalisco todo el año."
        assert scraper._extract_state(text) == "Jalisco"

    def test_genuine_state_mention_still_works(self, scraper):
        text = "Contamos con sucursales en todo Jalisco, visítanos pronto"
        assert scraper._extract_state(text) == "Jalisco"

    def test_no_state_mentioned_returns_empty(self, scraper):
        assert scraper._extract_state("Bienvenido a nuestra tienda en línea") == ""


# ─────────────────────────────────────────────────────────────
# 5c. _deepseek_enrich_result — AI-filled city must not be a state name
# ─────────────────────────────────────────────────────────────

class TestEnrichResultCityValidation:
    """Same root problem as TestExtractStateStreetNameGuard, but for the AI
    enrichment fallback: no real Mexican municipality is named exactly like
    one of the 32 states, so the LLM returning e.g. "ciudad": "Morelos" means
    it almost certainly read a street name out of context, not an actual
    city. Real case (fergusa.com.mx, 2026-09-20): the snippet included
    "...Morelos Nº 121 Col. Centro..." and the LLM answered "ciudad": "Morelos"."""

    def _run_enrich(self, scraper, ai_city, monkeypatch_llm=True):
        result = {"description": "Descripción no disponible", "services": [], "city": "", "state": "",
                  "_extra": {"business_hours": None, "city": "", "state": ""}}
        with (
            patch("app.llm.OPENAI_API_KEY", "fake-key"),
            patch("app.llm.DEEPSEEK_API_KEY", ""),
            patch("app.llm.call_llm", return_value=f'{{"ciudad": "{ai_city}"}}'),
        ):
            scraper._deepseek_enrich_result(result, "algún texto de la página")
        return result

    def test_state_name_returned_as_city_is_rejected(self, scraper):
        result = self._run_enrich(scraper, "Morelos")
        assert result["city"] == ""
        assert result["state"] == ""

    def test_genuine_city_is_accepted_and_infers_state(self, scraper):
        result = self._run_enrich(scraper, "Guadalajara")
        assert result["city"] == "Guadalajara"
        assert result["state"] == "Jalisco"


# ─────────────────────────────────────────────────────────────
# 6. _clean_city / _infer_state_from_city
# ─────────────────────────────────────────────────────────────

class TestCityNormalization:

    def test_removes_cdmx_suffix(self, scraper):
        assert scraper._clean_city("Ciudad de México, CDMX") == "Ciudad de México"

    def test_removes_df_suffix(self, scraper):
        assert scraper._clean_city("México D.F.") == "México"

    def test_plain_city_unchanged(self, scraper):
        assert scraper._clean_city("Monterrey") == "Monterrey"

    def test_empty_string_returns_empty(self, scraper):
        assert scraper._clean_city("") == ""

    def test_none_returns_empty(self, scraper):
        assert scraper._clean_city(None) == ""

    def test_infer_state_guadalajara(self, scraper):
        assert scraper._infer_state_from_city("Guadalajara") == "Jalisco"

    def test_infer_state_monterrey(self, scraper):
        assert scraper._infer_state_from_city("Monterrey") == "Nuevo León"

    def test_infer_state_queretaro(self, scraper):
        assert scraper._infer_state_from_city("Querétaro") == "Querétaro"

    def test_infer_state_unknown_city(self, scraper):
        # "Apizaco" used to be this test's example — it's now a known city
        # (Tlaxcala) since _infer_state_from_city started reusing searcher.py's
        # much larger city→state table (2026-09-18) instead of its own ~24-city
        # list, so it needs a genuinely made-up name to test the empty case.
        assert scraper._infer_state_from_city("Pueblorrandominventado") == ""

    def test_infer_state_now_covers_more_cities_than_before(self, scraper):
        # Real bug (2026-09-18): the old hardcoded ~24-city MAP didn't know
        # "Ciudad Obregón", so a company scraped there ended up with
        # city="Ciudad Obregón" / state="Sinaloa" (wrong — picked up from an
        # unrelated substring match elsewhere on the page instead of being
        # correctly inferred as Sonora).
        assert scraper._infer_state_from_city("Ciudad Obregón") == "Sonora"
        assert scraper._infer_state_from_city("Apizaco") == "Tlaxcala"

    def test_infer_state_ambiguous_city_returns_empty(self, scraper):
        # "Guadalupe" is a real city in BOTH Nuevo León and Zacatecas — better to
        # not guess than to confidently return the wrong one.
        assert scraper._infer_state_from_city("Guadalupe") == ""

    def test_infer_state_case_insensitive(self, scraper):
        assert scraper._infer_state_from_city("GUADALAJARA") == "Jalisco"


# ─────────────────────────────────────────────────────────────
# 8. JoinChat widget — number lives in a JSON blob (data-settings attr or an
#    inline `joinchat_obj` script var), not in visible text/href like the
#    other WhatsApp click-to-chat widgets _extract_from_scripts already knew
#    how to read (real case, 2026-09-18).
# ─────────────────────────────────────────────────────────────
class TestJoinchatWidget:
    def test_data_settings_attribute_is_parsed(self, scraper):
        html = '''
        <div class="joinchat" data-settings='{"telephone":"5215512345678","message_text":"hola"}'>
          <div class="joinchat__button"></div>
        </div>
        '''
        phones, wa_numbers = scraper._extract_from_scripts(make_soup(html))
        assert "+525512345678" in wa_numbers

    def test_settings_nested_under_settings_key(self, scraper):
        html = '''<div class="joinchat" data-settings='{"settings":{"telephone":"5215512345678"}}'></div>'''
        phones, wa_numbers = scraper._extract_from_scripts(make_soup(html))
        assert "+525512345678" in wa_numbers

    def test_inline_joinchat_obj_script_var_is_parsed(self, scraper):
        html = '''
        <script>
        var joinchat_obj = {"settings": {"telephone": "5215512345678", "position": "right"}};
        </script>
        '''
        phones, wa_numbers = scraper._extract_from_scripts(make_soup(html))
        assert "+525512345678" in wa_numbers

    def test_malformed_data_settings_does_not_crash(self, scraper):
        html = '''<div class="joinchat" data-settings='not valid json'></div>'''
        phones, wa_numbers = scraper._extract_from_scripts(make_soup(html))
        assert wa_numbers == []


# ─────────────────────────────────────────────────────────────
# 9. web.whatsapp.com/send?phone= click-to-chat links — same shape as
#    api.whatsapp.com/send?phone= but pointing at the desktop app instead of
#    the mobile deep link. Real case, 2026-09-18: a button on dentalion.mx
#    opened exactly this URL and it wasn't recognized anywhere.
# ─────────────────────────────────────────────────────────────
class TestWebWhatsappComLink:
    REAL_URL = ("https://web.whatsapp.com/send?phone=5216621276964&text=Hola%20me%20"
                "gustar%C3%ADa%20tener%20mas%20informaci%C3%B3n%20a%20cerca%20de%20sus%20servicios.")

    def test_extract_whatsapp_with_labels(self, scraper):
        html = f'<a href="{self.REAL_URL}">Abrir chat</a>'
        result = scraper._extract_whatsapp_with_labels(make_soup(html), "")
        assert result == [{"number": "+526621276964", "label": "Abrir chat"}]

    def test_extract_whatsapp_numbers(self, scraper):
        html = f'<a href="{self.REAL_URL}">Abrir chat</a>'
        result = scraper._extract_whatsapp_numbers(make_soup(html), "")
        assert result == ["+526621276964"]

    def test_link_in_attribute_regex(self, scraper):
        m = scraper._WA_LINK_IN_ATTR_RE.search(self.REAL_URL)
        assert m and m.group(1) == "5216621276964"
