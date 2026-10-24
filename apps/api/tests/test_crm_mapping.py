from bson import ObjectId

from app.integrations.crm.mapping import company_payload, is_eligible, lead_payloads

COMPANY = {
    "_id": ObjectId(), "name": "Panificadora Sol", "website": "https://sol.mx",
    "industry": "Panadería", "description": "Pan artesanal", "address": "Av. 5 de Febrero 10",
    "city": "Santiago de Querétaro", "state": "Querétaro", "postal_code": "76000",
    "country": "México", "status": "new", "source": "google",
}
CONTACTS = [
    {"type": "phone", "value": "442 123 4567"},
    {"type": "whatsapp", "value": "+524420000000"},
    {"type": "whatsapp", "value": "+524421234567", "is_primary": True},
    {"type": "email", "value": "hola@sol.mx"},
]


def test_manual_inbound_and_mismatch_are_not_eligible():
    for extra in ({"status": "manual"}, {"status": "inbound"}, {"source": "inbound_whatsapp"},
                  {"location_mismatch": True}, {"industry_mismatch": True}):
        assert is_eligible({**COMPANY, **extra}, CONTACTS) is False
    assert is_eligible(COMPANY, CONTACTS) is True


def test_needs_at_least_one_contact_channel():
    assert is_eligible(COMPANY, []) is False
    assert is_eligible(COMPANY, [{"type": "email", "value": ""}]) is False
    assert is_eligible(COMPANY, [{"type": "email", "value": "a@b.mx"}]) is True


def test_company_payload_maps_core_fields():
    p = company_payload(COMPANY, CONTACTS)
    assert p["source"] == "scraper" and p["external_ref"] == str(COMPANY["_id"])
    assert p["whatsapp"] == "+524421234567" and p["address"]["city"] == "Santiago de Querétaro"
    assert p["address"]["zip"] == "76000" and p["phone"] == "442 123 4567"
    assert p["country"] == "MX" and "Giro: Panadería" in p["notes"]
    assert "Origen: https://sol.mx" in p["notes"]
    assert "industry" not in p


def test_unknown_country_and_empty_values_omitted():
    p = company_payload({"_id": ObjectId(), "name": "X", "country": "Atlantis"}, [])
    assert set(p) == {"name", "source", "external_ref"}


def test_bad_email_and_short_phone_are_dropped():
    p = company_payload(COMPANY, [{"type": "email", "value": "info@"}, {"type": "phone", "value": "123"}])
    assert "email" not in p and "phone" not in p


def test_person_names_split_and_single_name_gets_dash():
    persons = [
        {"name": "Juan Pérez López", "role": "Dueño", "email": "j@sol.mx", "phone": "12", "whatsapp": "+524429999999"},
        {"name": "Ventas"},
        {"name": ""},
    ]
    leads = lead_payloads(COMPANY, CONTACTS, persons)
    assert len(leads) == 2
    c0 = leads[0]["contact"]
    assert (c0["first_name"], c0["last_name"], c0["job_title"]) == ("Juan", "Pérez López", "Dueño")
    assert c0["mobile"] == "+524429999999" and "phone" not in c0 and c0["email"] == "j@sol.mx"
    assert leads[1]["contact"]["first_name"] == "Ventas" and leads[1]["contact"]["last_name"] == "-"
    assert leads[0]["company"] == company_payload(COMPANY, CONTACTS)


def test_phone_must_match_crm_regex_and_have_8_digits():
    base = {"type": "phone"}
    for bad in ("442.123.4567", "442 123 4567 ext 12", "442/123/4567", "442abc1234567",
                "1" * 21, "+52 (442) 123-45-67-89-0123"):
        payload = company_payload(COMPANY, [{**base, "value": bad}])
        assert "phone" not in payload, bad
    for good in ("+52 (442) 123-4567", "442 123 4567", "+524421234567"):
        assert company_payload(COMPANY, [{**base, "value": good}])["phone"] == good
    assert "phone" not in company_payload(COMPANY, [{**base, "value": "123-45"}])


def test_phone_with_unicode_space_is_dropped():
    # CRM regex has no /u flag: NBSP (U+00A0) is not whitespace there, so it must not pass.
    for bad in ("+52 442 123 4567", "+52 442 123 4567"):
        assert "phone" not in company_payload(COMPANY, [{"type": "phone", "value": bad}]), bad


def test_email_over_254_chars_is_dropped():
    long = "a" * 250 + "@x.mx"
    assert "email" not in company_payload(COMPANY, [{"type": "email", "value": long}])


def test_first_valid_value_of_each_type_is_used():
    contacts = [
        {"type": "email", "value": "not-an-email"}, {"type": "email", "value": "ok@sol.mx"},
        {"type": "phone", "value": "12"}, {"type": "phone", "value": "442 123 4567"},
        {"type": "whatsapp", "value": "x.y"}, {"type": "whatsapp", "value": "+524420000000"},
    ]
    p = company_payload(COMPANY, contacts)
    assert (p["email"], p["phone"], p["whatsapp"]) == ("ok@sol.mx", "442 123 4567", "+524420000000")


def test_empty_name_is_not_eligible():
    assert is_eligible({**COMPANY, "name": "  "}, CONTACTS) is False
    assert is_eligible({k: v for k, v in COMPANY.items() if k != "name"}, CONTACTS) is False
