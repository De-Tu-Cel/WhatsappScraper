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


# ── Regression tests, 2026-10-02 search-quality pass ─────────────────────────

from unittest.mock import patch

from app import searcher


def _approve_all(msgs, **kwargs):
    return "[" + ",".join(str(i) for i in range(1, 61)) + "]"


class TestAccentInsensitiveDomainChecks:
    """"panadería" (accented) never matched ASCII domains, so the searched
    giro stayed in the wrong-sector block list and its own sites got dropped
    even after the LLM approved them; the domain-keyword rescue was inert."""

    def test_bakery_domain_kept_for_bakery_search(self):
        urls = ["https://www.panaderialaespiga.com.mx/", "https://taqueriaelguero.mx/"]
        with patch("app.llm.call_llm", side_effect=_approve_all):
            out = searcher._ai_filter_urls(urls, "panadería", {})
        assert "https://www.panaderialaespiga.com.mx/" in out
        assert "https://taqueriaelguero.mx/" not in out  # other giro still blocked

    def test_dental_clinic_domain_kept_for_dentist_search(self):
        urls = ["https://clinicadentalsonrisa.mx/"]
        with patch("app.llm.call_llm", side_effect=_approve_all):
            out = searcher._ai_filter_urls(urls, "dentista", {})
        assert out == urls

    def test_rescue_recovers_accented_industry_domain(self):
        urls = ["https://www.panaderialaespiga.com.mx/", "https://donpan.mx/"]
        with patch("app.llm.call_llm", side_effect=lambda msgs, **k: "[]"):
            out = searcher._ai_filter_urls(urls, "panadería", {})
        assert "https://www.panaderialaespiga.com.mx/" in out

    def test_rescue_does_not_match_generic_half_of_synonym(self):
        # "clínica dental" must not let "clinica" alone rescue a vet clinic
        urls = ["https://clinicadentalsonrisa.mx/", "https://clinicaveterinariamty.mx/"]
        with patch("app.llm.call_llm", side_effect=lambda msgs, **k: "[]"):
            out = searcher._ai_filter_urls(urls, "dentista", {})
        assert "https://clinicadentalsonrisa.mx/" in out
        assert "https://clinicaveterinariamty.mx/" not in out


class TestDataForSeoLocationResolution:
    """DataForSEO only accepts its official ASCII names — the hand-built
    "Querétaro,Queretaro,Mexico" got 40501 and Maps returned 0 silently."""

    ROWS = [
        ("santiago de queretaro", "queretaro", "Municipality", "Santiago de Queretaro,Queretaro,Mexico"),
        ("santiago de queretaro", "queretaro", "City", "Santiago de Queretaro,Santiago de Queretaro,Queretaro,Mexico"),
        ("leon", "guanajuato", "City", "Leon,Guanajuato,Mexico"),
        ("monterrey", "nuevo leon", "City", "Monterrey,Nuevo Leon,Mexico"),
        ("juarez", "nuevo leon", "City", "Juarez,Juarez,Nuevo Leon,Mexico"),
    ]

    @pytest.fixture(autouse=True)
    def _cache(self, monkeypatch):
        monkeypatch.setitem(searcher._DFS_LOCATIONS_CACHE, "mx", self.ROWS)

    @pytest.mark.parametrize("city,state,expected", [
        ("Querétaro", "queretaro", "Santiago de Queretaro,Queretaro,Mexico"),
        ("León", "guanajuato", "Leon,Guanajuato,Mexico"),
        ("Monterrey", "nuevo leon", "Monterrey,Nuevo Leon,Mexico"),
    ])
    def test_resolves_official_name(self, city, state, expected):
        assert searcher._resolve_dfs_location(city, state, "mx") == expected

    def test_same_name_in_other_state_is_rejected(self):
        assert searcher._resolve_dfs_location("Juárez", "chihuahua", "mx") is None

    def test_unknown_city_returns_none(self):
        assert searcher._resolve_dfs_location("Ciudad Inventada", None, "mx") is None


class TestRejectGuard:
    """One sporadic LLM answer flagged all 53 real gyms as directories and
    wiped the whole search; 5 reruns on the same input kept 52/53."""

    URLS = [f"https://gym{i}.mx/" for i in range(1, 21)]
    ALL = "[" + ",".join(str(i) for i in range(1, 21)) + "]"

    def _run(self, answers):
        it = iter(answers)
        with patch("app.llm.call_llm", side_effect=lambda msgs, **k: next(it)):
            return searcher._reject_directories_and_institutions(self.URLS, {}, degraded=[])

    def test_sporadic_mass_rejection_gets_second_opinion(self):
        assert len(self._run([self.ALL, "[3]"])) == 19

    def test_consistent_mass_rejection_is_respected(self):
        assert self._run([self.ALL, self.ALL]) == []

    def test_normal_answer_needs_no_retry(self):
        assert len(self._run(["[3,7]"])) == 18


class TestSynonymLookup:
    """52/53 synonym keys are unaccented; accented/plural industries missed."""

    @pytest.mark.parametrize("industry,expected_member", [
        ("panaderías", "bakery"),
        ("panadería", "pastelería"),
        ("dentistas", "dental"),
        ("hoteles", "motel"),
        ("estéticas", "spa"),
    ])
    def test_accent_and_plural_insensitive(self, industry, expected_member):
        assert expected_member in searcher._get_industry_synonyms(industry)

    def test_unknown_industry_is_empty(self):
        assert searcher._get_industry_synonyms("industria inventada") == []


class TestMapsCategoryRescue:
    """Google Maps' primary category "Panadería" was ignored when the LLM
    rejected the URL (La Dulce Compañía, Querétaro, 2026-10-02)."""

    SNIPS = {
        "https://ladulce.co/": {"title": "La Dulce Compañía", "body": "", "maps_category": "Panadería"},
        "https://maestropanadero.com/": {"title": "Maestro Panadero", "body": "",
                                         "maps_category": "Tienda de suministros para hornear"},
        "https://centralchef.com.mx/": {"title": "Central Chef", "body": "",
                                        "maps_category": "Equipos para panaderías"},
    }

    def test_rescues_matching_primary_category_only(self):
        with patch("app.llm.call_llm", side_effect=lambda msgs, **k: "[]"):
            out = searcher._ai_filter_urls(list(self.SNIPS), "panadería", self.SNIPS)
        assert out == ["https://ladulce.co/"]
