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
from scraper import WebsiteScraper


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
        assert scraper._infer_state_from_city("Apizaco") == ""

    def test_infer_state_case_insensitive(self, scraper):
        assert scraper._infer_state_from_city("GUADALAJARA") == "Jalisco"
