"""Google Maps businesses with no website of their own ("Sin sitio web"):
lead building at search time, category filtering, processing into a company,
and logo extraction for scraped sites. No network, no real Mongo."""
import re
import sys
import os
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from bson import ObjectId
from bs4 import BeautifulSoup

from app import searcher, pipeline, scrape_jobs
import searcher as top_searcher  # the module pipeline imports lazily


def _item(**over):
    base = {
        "title": "PANECITO BAKERY", "category": "Panadería", "additional_categories": None,
        "phone": "+524421234567", "cid": "4373184075551142933", "place_id": "ChIJq1g",
        "address": "Calle Luis M. Vega 44, Cimatario, 76030 Santiago de Querétaro, Qro.",
        "address_info": {"city": "Santiago de Querétaro", "region": "Querétaro", "zip": "76030", "country_code": "MX"},
        "rating": {"value": 4.7, "votes_count": 102}, "main_image": "https://lh3.googleusercontent.com/p.jpg",
        "latitude": 20.58, "longitude": -100.39, "is_claimed": True,
        "work_hours": {"timetable": {
            "monday": [{"open": {"hour": 8, "minute": 30}, "close": {"hour": 13, "minute": 0}},
                       {"open": {"hour": 16, "minute": 30}, "close": {"hour": 20, "minute": 0}}],
            "sunday": None,
        }},
    }
    base.update(over)
    return base


class TestLeadFromItem:
    def test_builds_contactable_lead(self):
        lead = searcher._maps_lead_from_item(_item(), "+52")
        assert lead["url"] == "https://www.google.com/maps?cid=4373184075551142933"
        assert searcher.is_maps_lead_url(lead["url"])
        assert lead["city"] == "Santiago de Querétaro" and lead["state"] == "Querétaro"
        assert lead["rating"] == 4.7 and lead["reviews"] == 102
        assert lead["business_hours"] == "Lun 08:30-13:00, 16:30-20:00"

    def test_switchboard_extension_is_dropped(self):
        assert searcher._maps_lead_from_item(_item(phone="+525562850400ext.9411"), "+52") is None

    def test_other_country_phone_is_dropped(self):
        # a +92 number showed up for a London dentist
        assert searcher._maps_lead_from_item(_item(phone="+923709898205"), "+44") is None

    def test_no_phone_or_cid_is_dropped(self):
        assert searcher._maps_lead_from_item(_item(phone=None), "+52") is None
        assert searcher._maps_lead_from_item(_item(cid=None), "+52") is None

    def test_keeps_social_page_as_listed_url(self):
        lead = searcher._maps_lead_from_item(_item(), "+52", listed_url="https://www.facebook.com/x/")
        assert lead["listed_url"] == "https://www.facebook.com/x/"

    @pytest.mark.parametrize("region,expected", [
        ("Qro.", "Querétaro"), ("Jal.", "Jalisco"), ("N.L.", "Nuevo León"), ("Q. Roo", "Quintana Roo"),
        ("Edo. Méx.", "Estado de México"), ("B.C.S.", "Baja California Sur"), ("Yucatán", "Yucatán"),
    ])
    def test_state_abbreviations_are_expanded(self, region, expected):
        it = _item(address_info={"city": "X", "region": region, "country_code": "MX"})
        assert searcher._maps_lead_from_item(it, "+52")["state"] == expected

    def test_missing_city_and_state_come_from_address(self):
        it = _item(address="C. 60 No. 500, Centro, 97000 Mérida, Yuc.", address_info={"country_code": "MX"})
        lead = searcher._maps_lead_from_item(it, "+52")
        assert (lead["city"], lead["state"]) == ("Mérida", "Yucatán")

    def test_non_mexican_region_is_left_alone(self):
        it = _item(phone="+5713334444", address_info={"city": "Bogotá", "region": "Bogotá", "country_code": "CO"})
        assert searcher._maps_lead_from_item(it, "+57")["state"] == "Bogotá"

    def test_regular_site_url_is_not_a_maps_lead_url(self):
        assert not searcher.is_maps_lead_url("https://panecito.mx/")
        assert not searcher.is_maps_lead_url("https://www.google.com/maps?cid=1&x=2")


class TestSameBusinessName:
    @pytest.mark.parametrize("a,b,same", [
        ("PANECITO BAKERY", "Panecito (sitio)", True),
        ("Dental Villarreal", "Clínica Dental Villarreal", True),
        ("Cerrajeria Las Varas", "Electricistas MX", False),
        ("Cerrajería Pérez", "Cerrajería López", False),
        ("Consultorio Dental", "Clínica Dental Sonrisa", False),
    ])
    def test_names(self, a, b, same):
        assert searcher.same_business_name(a, b) is same


class TestCategoryFilter:
    @pytest.fixture(autouse=True)
    def _fresh_cache(self, monkeypatch):
        monkeypatch.setattr(searcher, "_MAPS_CATEGORY_VERDICTS", {})

    LEADS = [{"url": f"u{i}", "name": "", "category": c}
             for i, c in enumerate(["Panadería", "Repostería", "Cafetería", "Equipos para panaderías"])]

    def test_llm_verdicts_decide_non_exact_categories(self):
        # pending order is first-seen: Repostería=1, Cafetería=2, Equipos=3
        with patch("app.llm.call_llm", return_value='{"1": "si", "2": "no", "3": "no"}') as llm:
            out = searcher._filter_maps_leads_by_category(self.LEADS, "panaderías")
        assert [l["category"] for l in out] == ["Panadería", "Repostería"]
        assert "Panadería" not in llm.call_args[0][0][0]["content"]  # exact match never asked

    def test_verdicts_are_cached_per_process(self):
        with patch("app.llm.call_llm", return_value='{"1": "si", "2": "no", "3": "no"}'):
            searcher._filter_maps_leads_by_category(self.LEADS, "panaderías")
        with patch("app.llm.call_llm", side_effect=AssertionError("should be cached")):
            out = searcher._filter_maps_leads_by_category(self.LEADS, "panaderías")
        assert len(out) == 2

    def test_name_with_giro_stem_is_kept_despite_category(self):
        leads = [
            {"url": "u1", "name": "Electricista plomero", "category": "Electricista"},
            {"url": "u2", "name": "Plomería y Electricidad Figueroa", "category": "Constructor"},
            {"url": "u3", "name": "Material Eléctrico y Plomería", "category": "Ferretería"},
            {"url": "u4", "name": "Electricidad Rai", "category": "Electricista"},
        ]
        with patch("app.llm.call_llm", return_value="[]"):
            out = searcher._filter_maps_leads_by_category(leads, "plomeros")
        assert [l["url"] for l in out] == ["u1", "u2"]  # store category goes to the LLM, which said no

    def test_multiword_giro_stem(self):
        leads = [{"url": "u1", "name": "ESTETICA CANINA", "category": "Hospital veterinario"},
                 {"url": "u2", "name": "Clínica Veterinaria Canina", "category": "Veterinario"}]
        with patch("app.llm.call_llm", return_value="[]"):
            out = searcher._filter_maps_leads_by_category(leads, "estéticas caninas")
        assert [l["url"] for l in out] == ["u1"]

    def test_llm_failure_falls_back_to_prefix_rule(self):
        with patch("app.llm.call_llm", side_effect=RuntimeError("down")):
            out = searcher._filter_maps_leads_by_category(self.LEADS, "panaderías")
        assert [l["category"] for l in out] == ["Panadería"]


# ── process_maps_lead ──────────────────────────────────────────────────────

def _matches(doc, query):
    for k, cond in query.items():
        val = doc.get(k)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$regex" in cond and not (isinstance(val, str) and re.search(cond["$regex"], val)):
                return False
            if "$exists" in cond and (k in doc) != cond["$exists"]:
                return False
        elif val != cond:
            return False
    return True


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find_one(self, query=None, projection=None):
        return next((d for d in self.docs if _matches(d, query or {})), None)

    def find(self, query=None, projection=None):
        class _Cursor(list):
            def limit(self, n):
                return _Cursor(self[:n])
        return _Cursor(d for d in self.docs if _matches(d, query or {}))

    def find_one_and_delete(self, query):
        d = self.find_one(query)
        if d:
            self.docs.remove(d)
        return d

    def update_one(self, query, update, upsert=False):
        d = self.find_one(query)
        if d:
            d.update(update.get("$set", {}))
            return SimpleNamespace(upserted_id=None)
        if upsert:
            new = {**query, **update.get("$setOnInsert", {}), **update.get("$set", {}), "_id": ObjectId()}
            self.docs.append(new)
            return SimpleNamespace(upserted_id=new["_id"])
        return SimpleNamespace(upserted_id=None)


class _FakeMgr:
    def __init__(self, companies=(), contacts=(), ideas=()):
        self.db = SimpleNamespace(companies=_Col(companies), contacts=_Col(contacts),
                                  social_media=_Col(), search_ideas=_Col(ideas))

    def insert_contact(self, c):
        self.db.contacts.docs.append(dict(c))

    def update_company(self, cid, fields):
        self.db.companies.update_one({"_id": ObjectId(cid)}, {"$set": fields})

    def insert_social_media(self, s):
        self.db.social_media.docs.append(dict(s))


PROFILE = {"description": "Panadería artesanal con masa madre", "logo_url": "https://lh6.g/s256-p/photo.jpg",
           "services": ["Entrega a domicilio", "Para llevar"], "payment_methods": ["Tarjeta de crédito"],
           "amenities": ["Café"], "price_level": "$", "review_topics": ["brownies", "café"],
           "rating_distribution": {"5": 40}, "total_photos": 32, "book_online_url": "",
           "related_businesses": ["Panadería La Joya"], "is_claimed": True}


def _run_lead(mgr, lead, is_wa, profile=PROFILE):
    with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
         patch.object(pipeline, "_check_blacklist", return_value=None), \
         patch.object(top_searcher, "maps_business_details", return_value=profile), \
         patch.object(pipeline, "_verify_whatsapp_paced", return_value=is_wa):
        return pipeline.process_maps_lead(lead["url"], lead)


class TestProcessMapsLead:
    LEAD = searcher._maps_lead_from_item(_item(), "+52", listed_url="https://www.instagram.com/panecito/")

    def test_new_business_with_whatsapp(self):
        mgr = _FakeMgr()
        out = _run_lead(mgr, self.LEAD, True)
        company = mgr.db.companies.docs[0]
        assert "domain" not in company  # sparse unique index: an explicit null would collide
        assert company["maps_cid"] == self.LEAD["cid"] and company["has_whatsapp"] is True
        assert company["city"] == "Santiago de Querétaro" and company["country"] == "México"
        wa = mgr.db.contacts.docs[0]
        assert wa["type"] == "whatsapp" and wa["value"] == "+524421234567"
        assert out["primary_whatsapp_number"] == "+524421234567"
        assert out["scraped"]["website"] == "" and out["scraped"]["no_website"] is True
        assert mgr.db.social_media.docs[0]["instagram"] == "https://www.instagram.com/panecito/"

    def test_business_profile_is_stored(self):
        mgr = _FakeMgr()
        out = _run_lead(mgr, self.LEAD, True)
        company = mgr.db.companies.docs[0]
        assert company["description"] == PROFILE["description"] and company["logo_url"] == PROFILE["logo_url"]
        assert company["services"] == PROFILE["services"]
        assert company["maps_profile"]["review_topics"] == ["brownies", "café"] and company["maps_profile_at"]
        assert out["scraped"]["description"] == PROFILE["description"]

    def test_profile_never_overwrites_scraped_website_data(self):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Panecito", "domain": "panecito.mx",
                                   "description": "Desde 1990", "logo_url": "https://panecito.mx/logo.png"}],
                       contacts=[{"company_id": str(oid), "type": "phone", "value": "+524421234567"}])
        _run_lead(mgr, self.LEAD, False)
        c = mgr.db.companies.docs[0]
        assert c["description"] == "Desde 1990" and c["logo_url"] == "https://panecito.mx/logo.png"
        assert c["services"] == PROFILE["services"] and c["maps_profile"]["price_level"] == "$"

    def test_without_whatsapp_saves_phone_marked_unverified(self):
        mgr = _FakeMgr()
        out = _run_lead(mgr, self.LEAD, False)
        assert mgr.db.contacts.docs[0]["type"] == "phone"
        assert mgr.db.contacts.docs[0]["verified"] is False
        assert out["all_whatsapp_numbers"] == []

    def test_unchecked_phone_is_not_marked_verified(self):
        mgr = _FakeMgr()
        _run_lead(mgr, self.LEAD, None)
        assert "verified" not in mgr.db.contacts.docs[0]

    def test_existing_company_by_phone_is_reused_without_overwriting(self):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Panecito (sitio)", "domain": "panecito.mx"}],
                       contacts=[{"company_id": str(oid), "type": "phone", "value": "+524421234567"}])
        out = _run_lead(mgr, self.LEAD, False)
        assert out["company_id"] == str(oid)
        assert len(mgr.db.companies.docs) == 1
        assert mgr.db.companies.docs[0]["name"] == "Panecito (sitio)"
        assert mgr.db.companies.docs[0]["maps_cid"] == self.LEAD["cid"]

    def test_shared_phone_with_another_business_is_not_a_merge(self):
        # a directory site that lists this phone among hundreds of others
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Electricistas MX", "domain": "electricistasmx.com"}],
                       contacts=[{"company_id": str(oid), "type": "phone", "value": "+524421234567"}])
        out = _run_lead(mgr, self.LEAD, True)
        assert out["company_id"] != str(oid)
        assert len(mgr.db.companies.docs) == 2
        assert "maps_cid" not in mgr.db.companies.docs[0]

    def test_lead_data_falls_back_to_saved_idea(self):
        mgr = _FakeMgr(ideas=[{"url": self.LEAD["url"], "maps_lead": self.LEAD}])
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(top_searcher, "maps_business_details", return_value={}), \
             patch.object(pipeline, "_verify_whatsapp_paced", return_value=True):
            out = pipeline.process_maps_lead(self.LEAD["url"])
        assert out["scraped"]["name"] == "PANECITO BAKERY"
        assert mgr.db.search_ideas.docs == []

    def test_missing_lead_data_is_an_error(self):
        mgr = _FakeMgr()
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             pytest.raises(ValueError):
            pipeline.process_maps_lead(self.LEAD["url"])


class TestForeignPhonesFlagLocation:
    """A León, SPAIN shop (+34 only) came back for "talleres mecánicos en León"
    and the scraper, leaning on the searched state, saved it as Guanajuato."""

    def _run(self, phones):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Bauti Motor"}],
                       ideas=[{"url": "https://bautimotor.com/", "target_state": "guanajuato", "industry": "talleres"}])
        mgr.insert_person_contact = lambda c: None
        scraped = {"name": "Bauti Motor", "industry": "Automotriz", "description": "", "metadata": {},
                   "_company_id": oid, "_db_action": "created",
                   "_extra": {"city": "León", "state": "Guanajuato"},
                   "_contacts_raw": {"whatsapp_numbers": [], "all_whatsapp_numbers": [], "phone_numbers": phones,
                                     "emails": [], "persons": []}}
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(pipeline, "_giro_category", return_value=""), \
             patch.object(pipeline.WebsiteScraper, "scrape_site", return_value=scraped) as scrape, \
             patch("whatsapp_wwebjs.get_all_connected_instances", return_value=[]):
            out = pipeline.process_url("https://bautimotor.com/")
        # the pipeline verifies phones itself — the scraper must not do it again
        assert scrape.call_args.kwargs.get("verify_phones") is False
        return out["location_mismatch"], mgr.db.companies.docs[0].get("location_mismatch")

    def test_only_foreign_phones_flag_the_company(self):
        returned, saved = self._run(["+34987275678", "+34619167825"])
        assert saved and "+34" in saved["detected_state"] and returned == saved

    def test_a_mexican_phone_clears_it(self):
        assert self._run(["+34987275678", "+524772170772"]) == (None, None)


class TestIndustryMismatch:
    """Comparing words flagged ~54% of real matches ("plomeros en Mérida" vs
    "Servicios del Hogar"); compare the giro's category with the site's."""

    def _run(self, detected, giro_category, fits=False):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "X"}],
                       ideas=[{"url": "https://x.mx/", "industry": "plomeros en Mérida", "industry_giro": "plomeros"}])
        mgr.insert_person_contact = lambda c: None
        scraped = {"name": "X", "industry": detected, "description": "", "metadata": {},
                   "_company_id": oid, "_db_action": "created", "_extra": {},
                   "_contacts_raw": {"whatsapp_numbers": [], "all_whatsapp_numbers": [], "phone_numbers": [],
                                     "emails": [], "persons": []}}
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(pipeline, "_giro_category", return_value=giro_category), \
             patch.object(pipeline, "_giro_fits_category", return_value=fits), \
             patch.object(pipeline.WebsiteScraper, "scrape_site", return_value=scraped), \
             patch("whatsapp_wwebjs.get_all_connected_instances", return_value=[]):
            pipeline.process_url("https://x.mx/")
        return mgr.db.companies.docs[0].get("industry_mismatch")

    def test_same_category_is_not_flagged(self):
        assert self._run("Servicios del Hogar", "Servicios del Hogar") is None

    def test_different_category_is_flagged(self):
        flag = self._run("Eventos / Entretenimiento", "Servicios del Hogar")
        assert flag == {"searched_industry": "plomeros", "searched_category": "Servicios del Hogar",
                        "detected_industry": "Eventos / Entretenimiento"}

    def test_second_opinion_can_clear_it(self):
        assert self._run("Automotriz", "Transporte / Logística", fits=True) is None

    def test_unknown_giro_category_is_not_flagged(self):
        assert self._run("Eventos / Entretenimiento", "") is None


class TestDirectoryDetection:
    def _run(self, wa):
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Vetty"}],
                       contacts=[{"company_id": str(oid), "type": "whatsapp", "value": n} for n in wa])
        mgr.db.contacts.delete_many = lambda q: setattr(mgr, "contacts_deleted", True)
        mgr.db.companies.delete_one = lambda q: setattr(mgr, "company_deleted", True)
        scraped = {"name": "Vetty", "industry": "Veterinaria", "description": "", "metadata": {},
                   "_company_id": oid, "_db_action": "created", "_extra": {},
                   "_contacts_raw": {"whatsapp_numbers": wa, "all_whatsapp_numbers": wa, "phone_numbers": [],
                                     "emails": [], "persons": []}}
        mgr.insert_person_contact = lambda c: None
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(pipeline.WebsiteScraper, "scrape_site", return_value=scraped), \
             patch("whatsapp_wwebjs.get_all_connected_instances", return_value=[]):
            return pipeline.process_url("https://vetty.mx/negocio/x"), mgr

    def test_many_numbers_across_area_codes_is_a_directory(self):
        wa = [f"+52{lada}5551234" for lada in ["222", "552", "557", "333", "353", "982", "999", "833"]]
        out, mgr = self._run(wa)
        assert out["blacklisted"] and out["reason"] == "directory"
        assert getattr(mgr, "company_deleted", False) and getattr(mgr, "contacts_deleted", False)

    def test_many_phones_across_area_codes_is_a_directory(self):
        # electricistasmx.com: 1,119 phones, only 3 WhatsApp links
        phones = [f"+52{lada}{i:07d}" for i, lada in enumerate(["861", "782", "983", "331", "639", "417", "554", "871"] * 2)]
        oid = ObjectId()
        mgr = _FakeMgr(companies=[{"_id": oid, "name": "Electricistas MX"}])
        mgr.db.contacts.delete_many = lambda q: None
        mgr.db.companies.delete_one = lambda q: setattr(mgr, "company_deleted", True)
        mgr.insert_person_contact = lambda c: None
        scraped = {"name": "Electricistas MX", "industry": "Servicios del Hogar", "description": "", "metadata": {},
                   "_company_id": oid, "_db_action": "created", "_extra": {},
                   "_contacts_raw": {"whatsapp_numbers": [], "all_whatsapp_numbers": [], "phone_numbers": phones,
                                     "emails": [], "persons": []}}
        with patch.object(pipeline, "MongoDBManager", return_value=mgr), \
             patch.object(pipeline, "_check_blacklist", return_value=None), \
             patch.object(pipeline.WebsiteScraper, "scrape_site", return_value=scraped), \
             patch("whatsapp_wwebjs.get_all_connected_instances", return_value=[]):
            out = pipeline.process_url("https://electricistasmx.com/cerrajeros/x")
        assert out["reason"] == "directory" and getattr(mgr, "company_deleted", False)

    def test_a_business_with_a_few_lines_is_kept(self):
        out, _ = self._run(["+524422087967", "+524421112233", "+524423334455"])
        assert not out.get("blacklisted")


class TestScraperContactsShape:
    def test_contacts_use_string_company_id_and_skip_wa_as_phone(self):
        from scraper import WebsiteScraper
        ws = WebsiteScraper()
        calls = []
        ws.contacts_col = SimpleNamespace(update_one=lambda f, u, upsert=False: calls.append(f))
        oid = ObjectId()
        raw = {"all_whatsapp_numbers": ["+524422087967"], "whatsapp_numbers": ["+524422087967"],
               "emails": ["a@panecito.mx"], "phone_numbers": ["+524422087967", "+524421112233"]}
        ws._save_contacts(raw, oid, "https://panecito.mx", verify_phones=False)
        assert all(f["company_id"] == str(oid) for f in calls)
        assert [(f["type"], f["normalized_value"]) for f in calls] == [
            ("whatsapp", "+524422087967"), ("email", "a@panecito.mx"), ("phone", "+524421112233")]


class TestScraperVerificationToggle:
    def test_save_contacts_skips_whatsapp_lookups_when_asked(self):
        from scraper import WebsiteScraper
        ws = WebsiteScraper()
        ws.contacts_col = SimpleNamespace(update_one=lambda *a, **k: None)
        raw = {"all_whatsapp_numbers": [], "whatsapp_numbers": [], "emails": [], "phone_numbers": ["+524422087967"]}
        with patch.object(WebsiteScraper, "_verify_new_phone_contacts") as verify:
            ws._save_contacts(raw, ObjectId(), "https://x.mx", verify_phones=False)
            verify.assert_not_called()
            ws._save_contacts(raw, ObjectId(), "https://x.mx")
            verify.assert_called_once()


class TestScrapeJobOrder:
    def test_maps_leads_are_processed_first(self):
        inserted = {}
        fake_db = SimpleNamespace(db=SimpleNamespace(scrape_jobs=SimpleNamespace(
            insert_one=lambda d: (inserted.update(d), SimpleNamespace(inserted_id=ObjectId()))[1])))
        urls = ["https://a.mx/", "https://www.google.com/maps?cid=1", "https://b.mx/",
                "https://www.google.com/maps?cid=2"]
        with patch.object(scrape_jobs, "_claim_and_dispatch"):
            scrape_jobs.create_scrape_job(fake_db, "search", urls, {"username": "qa"},
                                          maps_leads={u: {"cid": u[-1], "phone": "+52"} for u in urls if "cid=" in u})
        assert inserted["urls"] == ["https://www.google.com/maps?cid=1", "https://www.google.com/maps?cid=2",
                                    "https://a.mx/", "https://b.mx/"]
        assert len(inserted["maps_leads"]) == 2


class TestScrapeJobRow:
    def test_verified_whatsapp_and_warnings_reach_the_row(self):
        fake = {"website": "https://x.mx", "company_id": "abc", "primary_whatsapp_number": None,
                "all_whatsapp_numbers": ["+528711112222"],
                "location_mismatch": {"searched_state": "Coahuila", "detected_state": "Guanajuato", "detected_city": "Celaya"},
                "industry_mismatch": None,
                "scraped": {"name": "Cerrajero 24h", "industry": "Servicios", "city": "Celaya", "state": "Guanajuato",
                            "_contacts_raw": {"phone_numbers": ["+524611112222", "+524613334444"]}}}
        with patch("app.pipeline.process_url", return_value=fake):
            row = scrape_jobs._process_one_url("https://x.mx")
        assert row["whatsapp"] == "+528711112222"  # was "" → "Empty" status next to a WhatsApp chip
        assert row["city"] == "Celaya" and row["phones_count"] == 2
        assert row["location_mismatch"]["detected_city"] == "Celaya"


class TestScrapeJobRouting:
    def test_maps_url_goes_to_process_maps_lead(self):
        url = "https://www.google.com/maps?cid=4373184075551142933"
        fake = {"website": url, "company_id": "abc", "phone": "+524421234567", "wa_verified": True,
                "primary_whatsapp_number": "+524421234567", "all_whatsapp_numbers": ["+524421234567"],
                "scraped": {"name": "PANECITO", "industry": "Panadería", "no_website": True, "photo_url": "p.jpg"}}
        with patch("app.pipeline.process_maps_lead", return_value=fake) as pml, \
             patch("app.pipeline.process_url", side_effect=AssertionError("must not scrape")):
            row = scrape_jobs._process_one_url(url, {"cid": "1"})
        pml.assert_called_once_with(url, {"cid": "1"})
        assert row["no_website"] is True and row["whatsapp"] == "+524421234567"
        assert row["photo_url"] == "p.jpg"


# ── Phone plausibility ─────────────────────────────────────────────────────

class TestPhonePlausibility:
    """Unix timestamps (1790990963 = 2026-10-02) and integer constants in Wix
    page scripts were saved as phones and then spent WhatsApp lookups."""

    @pytest.fixture
    def ws(self):
        from scraper import WebsiteScraper
        return WebsiteScraper()

    @pytest.mark.parametrize("raw", ["1790990963", "+521790990963", "0099999997", "4294967295",
                                     "+15555555555", "8100000000"])
    def test_rejects_non_phones(self, ws, raw):
        assert ws._normalize_phone(raw, "+52") is None

    def test_rejects_leading_zero_national_number_any_country(self, ws):
        ws._default_country_code, ws._default_local_digits = "+57", 10
        assert ws._normalize_phone("0000056492", "+57") is None
        assert ws._normalize_phone("3112095047", "+57") == "+573112095047"
        assert ws._normalize_phone("601 744 3466", "+57") == "+576017443466"

    def test_colombian_numbering_plan(self, ws):
        ws._default_country_code, ws._default_local_digits = "+57", 10
        assert ws._normalize_phone("7294921875", "+57") is None
        assert ws._normalize_phone("6766378392", "+57") is None

    def test_junk_emails_are_dropped(self, ws):
        text = "escríbenos a reservas@gallo.com.co o f@h.tGq y servicio@seratta.com"
        assert ws._extract_emails(text) == ["reservas@gallo.com.co", "servicio@seratta.com"]

    def test_js_noise_words_are_not_contact_hints(self, ws):
        js = 'function callback(){var contactForm=1, telemetry="4423456789"; hotel=4423456780}'
        assert ws._extract_from_scripts(BeautifulSoup(f"<script>{js}</script>", "html.parser")) == ([], [])

    @pytest.mark.parametrize("raw,expected", [
        ("442 208 7967", "+524422087967"),
        ("+52 1 81 2038 6801", "+528120386801"),
        ("(55) 5985-4268", "+525559854268"),
    ])
    def test_keeps_real_numbers(self, ws, raw, expected):
        assert ws._normalize_phone(raw, "+52") == expected


class TestScriptPhoneHarvest:
    """Bare digit runs inside page JS are IDs/dates far more often than phones."""

    @pytest.fixture
    def ws(self):
        from scraper import WebsiteScraper
        s = WebsiteScraper()
        s._default_country_code, s._default_local_digits = "+52", 10
        return s

    def _harvest(self, ws, js):
        return ws._extract_from_scripts(BeautifulSoup(f"<script>{js}</script>", "html.parser"))

    def test_ids_and_dates_in_js_are_ignored(self, ws):
        phones, wa = self._harvest(ws, 'var a={"id":"2220260929","ts":4423456789,"h":"9019607843123"};')
        assert phones == [] and wa == []

    def test_formatted_or_labelled_numbers_are_kept(self, ws):
        phones, _ = self._harvest(ws, 'var c={"telefono":"4422087967"}; footer("442 312 4567");')
        assert "+524422087967" in phones and "+524423124567" in phones
        _, wa = self._harvest(ws, 'var w={"whatsapp_phone":"5214421277252"};')
        assert "+524421277252" in wa

    def test_visible_text_numbers_are_not_sliced_from_longer_runs(self, ws):
        soup = BeautifulSoup("<p>CLABE 012180001234567890 · Tel. 442 208 7967</p>", "html.parser")
        assert ws._extract_phone_numbers(soup, soup.get_text(" ")) == ["+524422087967"]


# ── Logo extraction ────────────────────────────────────────────────────────

def _logo(html, url="https://panecito.mx/inicio"):
    from scraper import WebsiteScraper
    return WebsiteScraper()._extract_logo_url(BeautifulSoup(html, "html.parser"), url)


class TestLogoExtraction:
    def test_json_ld_logo_wins(self):
        html = ('<script type="application/ld+json">{"@type":"Bakery","logo":{"url":"/img/brand.png"}}</script>'
                '<img class="site-logo" src="/other.png">')
        assert _logo(html) == "https://panecito.mx/img/brand.png"

    def test_img_identified_as_logo(self):
        html = '<img src="/hero.jpg"><div class="logo"><img src="assets/panecito.svg"></div>'
        assert _logo(html) == "https://panecito.mx/assets/panecito.svg"

    def test_inline_data_uri_is_skipped(self):
        html = ('<img class="logo" src="data:image/png;base64,AAAA">'
                '<link rel="apple-touch-icon" href="/apple.png">')
        assert _logo(html) == "https://panecito.mx/apple.png"

    def test_largest_favicon_then_og_image(self):
        html = ('<link rel="icon" sizes="16x16" href="/f16.png"><link rel="icon" sizes="192x192" href="/f192.png">'
                '<meta property="og:image" content="https://cdn.x/banner.jpg">')
        assert _logo(html) == "https://panecito.mx/f192.png"
        assert _logo('<meta property="og:image" content="https://cdn.x/banner.jpg">') == "https://cdn.x/banner.jpg"

    def test_header_logo_beats_footer_badge(self):
        html = ('<main><img src="/promo.jpg"></main>'
                '<footer><img alt="NHS logo" src="/nhs-logo.svg"></footer>'
                '<header class="site-header"><a><img alt="Soho Dental logo" src="/soho.svg"></a></header>')
        assert _logo(html) == "https://panecito.mx/soho.svg"

    def test_site_builder_default_icons_are_skipped(self):
        html = ('<link rel="icon" href="https://www.wix.com/favicon.ico">'
                '<meta property="og:image" content="https://static.wixstatic.com/media/abc~mv2.png">')
        assert _logo(html) == "https://static.wixstatic.com/media/abc~mv2.png"

    def test_nothing_usable(self):
        assert _logo("<p>hola</p>") == ""
