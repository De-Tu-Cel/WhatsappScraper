"""Unit tests for app/searcher.py's URL relevance filtering (_is_business_url
and the domain/path exclusion lists it checks). Pure function, no network/DB.

Covers a real data-quality bug (2026-09-09): 9 companies got scraped and
stored as prospects from sites that were never a real business — a flight
tracker, a bus-ticket aggregator, directory/Excel-list sites, a blog, an
industry association, and a phrase-translation site. All 9 had zero messages
ever sent (confirmed live), so they were discarded from the DB entirely and
their domains added to EXCLUDED_DOMAINS so future searches don't re-find them.
"""
import pytest

from app.searcher import _is_business_url


class TestNonBusinessDomainsExcluded:
    """Real prod cases — confirmed 0 messages sent to any of these before
    they were discarded, i.e. genuinely never valid prospects."""

    @pytest.mark.parametrize("url", [
        "https://flightview.com/",
        "https://checkmybus.com.mx/ruta/ciudad-obregon-hermosillo",
        "https://datomex.com/directorio-gaseras-excel",
        "https://masterestaurant.com/blog/gerencia-restaurantes",
        "https://criregjal.com.mx/",
        "https://www.indifferentlanguages.com/es/words/surtidor-de-gasolina",
        "https://ofertasdetrabajosyempleos.com/salon-belleza-monterrey",
        # Already-excluded ones (confirm still excluded, not a regression)
        "https://occ.com.mx/empleos/salon-de-belleza",
        "https://vips.com.mx/",
        "https://citiservi.com.mx/gas-en-queretaro",
    ])
    def test_rejects_known_non_business_domains(self, url):
        assert _is_business_url(url) is False

    @pytest.mark.parametrize("url", [
        "https://gaschapultepec.com/",
        "https://restaurantelasaguilas.mx/menu",
        "https://polloasadito.com/contacto",
        "https://hidrogaspedidos.com.mx/",
    ])
    def test_accepts_real_small_business_sites(self, url):
        assert _is_business_url(url) is True


class TestBasicUrlValidation:
    @pytest.mark.parametrize("url", [
        "tel:+525512345678",
        "mailto:contacto@example.com",
        "javascript:void(0)",
        "",
        None,
        "ftp://example.com/",
        "not-a-url-at-all",
    ])
    def test_rejects_non_web_or_malformed(self, url):
        assert _is_business_url(url) is False

    def test_accepts_plain_https_url(self):
        assert _is_business_url("https://example.com/") is True
