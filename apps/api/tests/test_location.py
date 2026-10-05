"""Location of a scraped business (2026-10-04).

Measured on 46 real sites: the page-based detection was right whenever it found
something but found nothing on ~1 in 5. Those now take the location most of the
business's Mexican phones point to (area code), else the place the search was
aimed at. Plus two guards: form drop-downs / lists of places are not an address
(Nissan Tijuana was saved in Puebla from a states <select>), and a city implies
its state ("Querétaro, Hidalgo" came from a street named Hidalgo).
"""
from bs4 import BeautifulSoup

from app.geo import area_location, phones_location
from app.scraper import WebsiteScraper


class TestAreaCodes:
    def test_known_cities(self):
        assert area_location("+526631276258") == {"city": "Tijuana", "state": "Baja California"}
        assert area_location("+528441234567") == {"city": "Saltillo", "state": "Coahuila"}
        assert area_location("+523312345678")["state"] == "Jalisco"

    def test_formats(self):
        # 521… (how WhatsApp delivers MX numbers), spaces, bare 10 digits
        assert area_location("5218441234567")["city"] == "Saltillo"
        assert area_location("+52 1 664 285 7783")["city"] == "Tijuana"
        assert area_location("6642857783")["state"] == "Baja California"

    def test_metro_and_not_local(self):
        assert area_location("+525512345678") == {"city": "", "state": "Ciudad de México"}
        assert area_location("+528001234567") is None      # toll-free
        assert area_location("+34911234567") is None       # Spain
        assert area_location("") is None

    def test_majority_vote(self):
        assert phones_location(["+528441111111", "+528442222222"]) == {"city": "Saltillo", "state": "Coahuila"}
        assert phones_location(["+528441111111", "+526641234567"]) is None   # no clear majority
        assert phones_location([]) is None


class TestListOfPlacesIsNotAnAddress:
    def setup_method(self):
        self.s = WebsiteScraper()

    def test_real_addresses_pass(self):
        for a in ["Av. Hidalgo 123, Col. Centro, Ciudad de México, México",
                  "Calle Morelos 45, Querétaro, Qro. México",
                  "Blvd. Agua Caliente 10, Tijuana, Baja California, México",
                  "Av. Juárez 5, Estado de México, CP 55000"]:
            assert self.s._mentions_many_states(a) is False, a

    def test_lists_and_form_labels_rejected(self):
        for a in ["Dirección: *Ciudad, Estado, Código Postal: Ciudad Estado Aguascalientes Baja California Baja California Sur",
                  "Domicilio: Municipio* San Luis Potosi Ahualulco Alaquines Aquismon",
                  "Dirección: Selecciona la dirección donde vas a instalar"]:
            assert self.s._mentions_many_states(a) is True, a

    def test_form_dropdowns_removed_from_the_page(self):
        soup = BeautifulSoup("<p>Tijuana, BC</p><select><option>Puebla</option><option>Oaxaca</option></select>", "html.parser")
        clean = WebsiteScraper._without_form_lists(soup)
        assert "Puebla" not in clean.get_text() and "Tijuana" in clean.get_text()
        assert "Puebla" in soup.get_text()     # the original page is untouched


class TestCityImpliesState:
    def test_street_name_does_not_win(self):
        assert WebsiteScraper()._consistent_state("Querétaro", "Hidalgo") == "Querétaro"

    def test_ambiguous_city_keeps_detected_state(self):
        assert WebsiteScraper()._consistent_state("Guadalupe", "Nuevo León") == "Nuevo León"


def _result(state="", city="", numbers=()):
    return {"state": state, "city": city, "_extra": {"state": state, "city": city},
            "_contacts_raw": {"all_whatsapp_numbers": list(numbers), "phone_numbers": []}}


class TestFinalizeLocation:
    def _scraper(self, target_state="", target_city=""):
        s = WebsiteScraper()
        s._target_state_raw, s._target_city_raw = target_state, target_city
        return s

    def test_page_location_is_kept(self):
        r = _result("Jalisco", "Guadalajara", ["+528441234567", "+528442222222"])
        self._scraper("Coahuila", "Saltillo")._finalize_location(r)
        assert (r["city"], r["state"], r["location_source"]) == ("Guadalajara", "Jalisco", "sitio")

    def test_area_code_fills_an_empty_location(self):
        r = _result(numbers=["+528441234567", "+528442222222"])
        self._scraper("Nuevo León", "Monterrey")._finalize_location(r)
        assert (r["city"], r["state"], r["location_source"]) == ("Saltillo", "Coahuila", "lada")
        assert r["_extra"]["state"] == "Coahuila"     # what the pipeline's location check reads

    def test_search_place_is_the_last_resort(self):
        r = _result(numbers=["+528001234567"])        # toll-free only: no area code to go by
        self._scraper("coahuila", "Saltillo")._finalize_location(r)
        assert (r["city"], r["state"], r["location_source"]) == ("Saltillo", "Coahuila", "busqueda")

    def test_nothing_to_go_by(self):
        r = _result()
        self._scraper()._finalize_location(r)
        assert r["state"] == "" and "location_source" not in r


class TestGasNamePattern:
    def test_word_gas_in_the_name(self):
        """The pattern held backspace characters instead of word boundaries
        (r"\\x08gas\\x08"), so a name with the word "gas" alone never matched."""
        soup = BeautifulSoup("", "html.parser")
        assert WebsiteScraper()._detect_industry("", soup, company_name="MI GAS") == "Gas LP / Energía"


# ── Normalization, metro areas, city-level "out of zone" ─────────────────────

from unittest.mock import patch

from bson import ObjectId

from app import pipeline
from app.geo import canonical_state, same_area, tidy_city
from test_maps_leads import _FakeMgr


class TestNormalization:
    def test_state_abbreviations_and_official_names(self):
        assert canonical_state("Coah.") == "Coahuila"
        assert canonical_state("N.L.") == "Nuevo León"
        assert canonical_state("Querétaro de Arteaga") == "Querétaro"
        assert canonical_state("Edo. Méx.") == "Estado de México"
        assert canonical_state("Atlantis") == "Atlantis"

    def test_city_casing(self):
        assert tidy_city("saltillo") == "Saltillo"
        assert tidy_city("SAN PEDRO DE LAS COLONIAS") == "San Pedro de las Colonias"
        assert tidy_city("Torreón") == "Torreón"

    def test_page_location_is_normalized(self):
        r = _result("Coah.", "saltillo")
        s = WebsiteScraper()
        s._target_state_raw = s._target_city_raw = ""
        s._finalize_location(r)
        assert (r["city"], r["state"], r["_extra"]["state"]) == ("Saltillo", "Coahuila", "Coahuila")


class TestSameArea:
    def test_metro_municipalities(self):
        assert same_area("Ramos Arizpe", "Saltillo")
        assert same_area("Zapopan", "Guadalajara")
        assert same_area("Santiago de Querétaro", "Querétaro")

    def test_other_city_same_state(self):
        assert not same_area("Torreón", "Saltillo")

    def test_nothing_to_compare(self):
        assert same_area("", "Saltillo")


class TestCityOutOfZone:
    """"plomeros en Saltillo" brought a Torreón plumber — same state, so only
    the city can tell it's out of the searched zone (end-to-end test 2026-10-04)."""

    def _run(self, city, source="sitio"):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Plomeros"}],
                       ideas=[{"url": "https://plomeros.mx/", "target_state": "coahuila", "target_city": "Saltillo",
                               "industry": "plomeros"}])
        mgr.insert_person_contact = lambda c: None
        scraped = {"name": "Plomeros", "industry": "Fontanero", "description": "", "metadata": {},
                   "_company_id": oid, "_db_action": "created", "location_source": source,
                   "_extra": {"city": city, "state": "Coahuila", "loc_source": source},
                   "_contacts_raw": {"whatsapp_numbers": [], "all_whatsapp_numbers": [], "phone_numbers": ["+528711234567"],
                                     "emails": [], "persons": []}}
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(pipeline, "_giro_category", return_value=""), \
             patch.object(pipeline.WebsiteScraper, "scrape_site", return_value=scraped) as scrape, \
             patch("whatsapp_wwebjs.get_all_connected_instances", return_value=[]):
            out = pipeline.process_url("https://plomeros.mx/")
        assert scrape.call_args.kwargs.get("target_city") == "Saltillo"   # the searched city reaches the scraper
        return out["location_mismatch"]

    def test_other_city_is_flagged(self):
        lm = self._run("Torreón")
        assert lm and lm["detected_city"] == "Torreón" and lm["searched_city"] == "Saltillo"

    def test_metro_municipality_is_not(self):
        assert self._run("Ramos Arizpe") is None

    def test_location_assumed_from_the_search_is_not(self):
        assert self._run("Saltillo", source="busqueda") is None
