"""Pure mapping/eligibility helpers: scraper prospects -> dtc-crm ingest payloads."""
import re

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CHANNELS = ("whatsapp", "phone", "email")
_COUNTRIES = {"méxico": "MX", "mexico": "MX"}
_MIN_PHONE_DIGITS = 8


def _s(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _valid_phone(value) -> str:
    value = _s(value)
    return value if sum(c.isdigit() for c in value) >= _MIN_PHONE_DIGITS else ""


def _valid_email(value) -> str:
    value = _s(value)
    return value if _EMAIL_RE.match(value) else ""


def _first(contacts: list[dict], kind: str, prefer_primary: bool = False) -> str:
    values = [c for c in contacts if c.get("type") == kind and _s(c.get("value"))]
    if prefer_primary:
        values.sort(key=lambda c: not c.get("is_primary"))
    return _s(values[0]["value"]) if values else ""


def _compact(d: dict) -> dict:
    return {k: v for k, v in d.items() if v}


def is_eligible(company: dict, contacts: list[dict]) -> bool:
    if company.get("status") in ("manual", "inbound"):
        return False
    if company.get("source") == "inbound_whatsapp":
        return False
    if company.get("location_mismatch") or company.get("industry_mismatch"):
        return False
    return any(c.get("type") in _CHANNELS and _s(c.get("value")) for c in contacts)


def company_payload(company: dict, contacts: list[dict]) -> dict:
    notes = [
        f"Giro: {_s(company.get('industry'))}" if _s(company.get("industry")) else "",
        _s(company.get("description")),
    ]
    origin = _s(company.get("website")) or _s(company.get("listed_url")) or _s(company.get("maps_url"))
    if origin:
        notes.append(f"Origen: {origin}")
    address = _compact({
        "street": _s(company.get("address")),
        "city": _s(company.get("city")),
        "state": _s(company.get("state")),
        "zip": _s(company.get("postal_code")),
    })
    return _compact({
        "name": _s(company.get("name")),
        "source": "scraper",
        "external_ref": str(company["_id"]),
        "website": _s(company.get("website")),
        "phone": _valid_phone(_first(contacts, "phone")),
        "whatsapp": _valid_phone(_first(contacts, "whatsapp", prefer_primary=True)),
        "email": _valid_email(_first(contacts, "email")),
        "address": address,
        "country": _COUNTRIES.get(_s(company.get("country")).lower(), ""),
        "notes": "\n".join(n for n in notes if n),
    })


def lead_payloads(company: dict, contacts: list[dict], persons: list[dict]) -> list[dict]:
    payloads = []
    base = company_payload(company, contacts)
    for person in persons:
        name = _s(person.get("name"))
        if not name:
            continue
        first, _, rest = name.partition(" ")
        payloads.append({
            "company": base,
            "contact": _compact({
                "first_name": first,
                "last_name": rest.strip() or "-",
                "job_title": _s(person.get("role")),
                "email": _valid_email(person.get("email")),
                "phone": _valid_phone(person.get("phone")),
                "mobile": _valid_phone(person.get("whatsapp")),
            }),
        })
    return payloads
