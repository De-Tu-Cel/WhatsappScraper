# geo.py
"""
Where a Mexican phone number is from, by its area code (lada).

A local business's WhatsApp / phone lada is a strong location signal, and the
only one available for the ~1 in 5 sites that publish no usable address
(measured 2026-10-04 on 46 real sites: the page-based detection was right
whenever it found something, but found nothing on 9). Uses libphonenumber's
geocoder (432 of the ~456 valid 3-digit ladas map to a specific city/state),
plus the few big gaps it reports only as "México".
"""
import collections
import unicodedata

import phonenumbers
from phonenumbers import geocoder

_ABBR = {
    "AGS": "Aguascalientes", "BC": "Baja California", "BCS": "Baja California Sur", "CAMP": "Campeche",
    "CHIS": "Chiapas", "CHIH": "Chihuahua", "CDMX": "Ciudad de México", "COAH": "Coahuila", "COL": "Colima",
    "DGO": "Durango", "GTO": "Guanajuato", "GRO": "Guerrero", "HGO": "Hidalgo", "JAL": "Jalisco",
    "MEX": "Estado de México", "MICH": "Michoacán", "MOR": "Morelos", "NAY": "Nayarit", "NL": "Nuevo León",
    "OAX": "Oaxaca", "PUE": "Puebla", "QRO": "Querétaro", "QROO": "Quintana Roo", "SLP": "San Luis Potosí",
    "SIN": "Sinaloa", "SON": "Sonora", "TAB": "Tabasco", "TAMPS": "Tamaulipas", "TLAX": "Tlaxcala",
    "VER": "Veracruz", "YUC": "Yucatán", "ZAC": "Zacatecas",
}
# Ladas libphonenumber only knows as "México".
_OVERRIDES = {
    "663": ("Tijuana", "Baja California"),
    "664": ("Tijuana", "Baja California"),
    "55": ("", "Ciudad de México"),   # metro area: CDMX and part of Estado de México share it
    "56": ("", "Ciudad de México"),
}
_NOT_LOCAL = ("800", "900", "300", "500", "888")


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c)).strip()


_STATE_BY_FOLD = {_fold(v): v for v in _ABBR.values()}


def area_location(number: str):
    """{"city", "state"} for a Mexican number's lada, or None (foreign, toll-free,
    or a lada the geocoder can't place). city may be "" when only the state is known."""
    digits = "".join(filter(str.isdigit, str(number or "")))
    if not digits:
        return None
    if len(digits) == 13 and digits.startswith("521"):   # old mobile prefix, how WhatsApp sends MX numbers
        digits = "52" + digits[3:]
    try:
        p = phonenumbers.parse("+" + digits if len(digits) > 10 else digits, "MX")
    except phonenumbers.NumberParseException:
        return None
    if p.country_code != 52:
        return None
    nat = str(p.national_number)
    if nat[:3] in _NOT_LOCAL:
        return None
    for prefix in (nat[:3], nat[:2]):
        if prefix in _OVERRIDES:
            city, state = _OVERRIDES[prefix]
            return {"city": city, "state": state}
    desc = geocoder.description_for_number(p, "es") or ""
    if not desc or desc == "México":
        return None
    if "," in desc:                                   # "Saltillo, COAH" / "Conkal/Mérida, YUC"
        place, abbr = desc.rsplit(",", 1)
        state = _ABBR.get(abbr.strip())
        return {"city": place.split("/")[-1].strip(), "state": state} if state else None
    if _fold(desc) in _STATE_BY_FOLD:                 # a state name ("Coahuila") or a capital named like it
        return {"city": "", "state": _STATE_BY_FOLD[_fold(desc)]}
    try:
        from app.searcher import _find_state_for_city
        from app.scraper import WebsiteScraper
        key = _find_state_for_city(desc.split("/")[-1])
        state = WebsiteScraper._STATE_KEY_TO_DISPLAY.get(key, "") if key else ""
    except Exception:
        state = ""
    return {"city": desc.split("/")[-1].strip(), "state": state} if state else None


def phones_location(numbers):
    """The location most of a business's Mexican numbers point to, or None when
    they don't clearly agree (a directory, a national chain, mixed branches)."""
    located = [loc for loc in (area_location(n) for n in (numbers or [])[:10]) if loc]
    if not located:
        return None
    votes = collections.Counter(loc["state"] for loc in located)
    state, n = votes.most_common(1)[0]
    if n / len(located) < 0.75:
        return None
    cities = collections.Counter(loc["city"] for loc in located if loc["state"] == state and loc["city"])
    city = cities.most_common(1)[0][0] if cities else ""
    return {"city": city, "state": state}


# ── State names ───────────────────────────────────────────────────────────────

_STATE_ALIASES = {
    "ags": "Aguascalientes", "bc": "Baja California", "bcn": "Baja California", "bcs": "Baja California Sur",
    "camp": "Campeche", "chis": "Chiapas", "chih": "Chihuahua", "cdmx": "Ciudad de México", "df": "Ciudad de México",
    "distrito federal": "Ciudad de México", "coah": "Coahuila", "coahuila de zaragoza": "Coahuila", "col": "Colima",
    "dgo": "Durango", "gto": "Guanajuato", "gro": "Guerrero", "hgo": "Hidalgo", "jal": "Jalisco",
    "mex": "Estado de México", "edomex": "Estado de México", "edo mex": "Estado de México", "edo de mex": "Estado de México",
    "estado de mexico": "Estado de México", "mich": "Michoacán", "michoacan de ocampo": "Michoacán", "mor": "Morelos",
    "nay": "Nayarit", "nl": "Nuevo León", "oax": "Oaxaca", "pue": "Puebla", "qro": "Querétaro",
    "queretaro de arteaga": "Querétaro", "qroo": "Quintana Roo", "q roo": "Quintana Roo", "slp": "San Luis Potosí",
    "sin": "Sinaloa", "son": "Sonora", "tab": "Tabasco", "tamps": "Tamaulipas", "tamp": "Tamaulipas",
    "tlax": "Tlaxcala", "ver": "Veracruz", "veracruz de ignacio de la llave": "Veracruz", "yuc": "Yucatán",
    "zac": "Zacatecas",
}


def _loose(s: str) -> str:
    import re
    return re.sub(r"[^a-z ]+", " ", _fold(s)).split() and " ".join(re.sub(r"[^a-z ]+", " ", _fold(s)).split())


def canonical_state(state: str) -> str:
    """"Coah." / "N.L." / "Querétaro de Arteaga" → "Coahuila" / "Nuevo León" /
    "Querétaro". Unknown values come back unchanged."""
    if not state:
        return state
    key = _loose(state) or ""
    if key in _STATE_BY_FOLD:
        return _STATE_BY_FOLD[key]
    if key.replace(" ", "") in _STATE_ALIASES:
        return _STATE_ALIASES[key.replace(" ", "")]
    return _STATE_ALIASES.get(key, state)


# ── Same local area ───────────────────────────────────────────────────────────
# Municipalities that are one market with the main city — a business in Ramos
# Arizpe is "in Saltillo" for a search there; Torreón is not.
_METROS = {
    "ciudad de mexico": ["cdmx", "alvaro obregon", "azcapotzalco", "benito juarez", "coyoacan", "cuajimalpa",
                         "cuauhtemoc", "gustavo a madero", "iztacalco", "iztapalapa", "magdalena contreras",
                         "miguel hidalgo", "milpa alta", "tlahuac", "tlalpan", "venustiano carranza", "xochimilco",
                         "naucalpan", "tlalnepantla", "ecatepec", "nezahualcoyotl", "atizapan", "cuautitlan izcalli",
                         "cuautitlan", "tultitlan", "coacalco", "huixquilucan", "chimalhuacan", "la paz", "chalco",
                         "ixtapaluca", "nicolas romero", "tecamac", "valle de chalco", "texcoco"],
    "guadalajara": ["zapopan", "tlaquepaque", "san pedro tlaquepaque", "tonala", "tlajomulco", "tlajomulco de zuniga",
                    "el salto"],
    "monterrey": ["san pedro garza garcia", "san pedro", "san nicolas de los garza", "san nicolas", "guadalupe",
                  "apodaca", "escobedo", "general escobedo", "santa catarina", "garcia", "juarez", "cadereyta"],
    "saltillo": ["ramos arizpe", "arteaga"],
    "torreon": ["gomez palacio", "lerdo", "ciudad lerdo"],
    "tijuana": ["rosarito", "playas de rosarito", "tecate"],
    "queretaro": ["santiago de queretaro", "corregidora", "el marques"],
    "puebla": ["san andres cholula", "san pedro cholula", "cholula", "cuautlancingo", "amozoc"],
    "leon": ["silao"],
    "merida": ["kanasin", "uman"],
    "toluca": ["metepec", "zinacantepec", "lerma", "san mateo atenco"],
    "veracruz": ["boca del rio"],
    "tampico": ["ciudad madero", "madero", "altamira"],
    "san luis potosi": ["soledad de graciano sanchez", "soledad"],
    "aguascalientes": ["jesus maria"],
    "cuernavaca": ["jiutepec", "temixco", "emiliano zapata"],
    "pachuca": ["mineral de la reforma"],
    "oaxaca": ["oaxaca de juarez", "santa lucia del camino", "santa cruz xoxocotlan"],
    "cancun": ["benito juarez"],
}
_AREA_OF = {}
for _main, _members in _METROS.items():
    _AREA_OF[_main] = _main
    for _m in _members:
        _AREA_OF.setdefault(_m, _main)


def _city_key(city: str) -> str:
    k = _loose(city) or ""
    for prefix in ("ciudad de ", "cd "):
        if k.startswith(prefix) and k not in ("ciudad de mexico",):
            k = k[len(prefix):]
    return k


def same_area(city_a: str, city_b: str) -> bool:
    """Same city or same metro area (accent/case-insensitive). Unknown names
    compare by text only."""
    a, b = _city_key(city_a), _city_key(city_b)
    if not a or not b:
        return True          # nothing to compare — don't flag
    if a == b or a in b or b in a:
        return True
    return _AREA_OF.get(a, a) == _AREA_OF.get(b, b)


def tidy_city(city: str) -> str:
    """"saltillo" → "Saltillo", "san pedro garza garcia" → "San Pedro Garza Garcia"
    (only all-lowercase / all-uppercase values are touched)."""
    if not city or not (city.islower() or city.isupper()):
        return city
    small = {"de", "del", "la", "las", "los", "y"}
    words = city.lower().split()
    return " ".join(w if (i and w in small) else w.capitalize() for i, w in enumerate(words))
