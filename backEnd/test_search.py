"""
Test script for the search pipeline — run from backEnd/ directory:
    cd backEnd && python test_search.py

Tests location extraction and (optionally) live search calls.
Set LIVE=1 to actually hit the APIs:
    LIVE=1 python test_search.py
"""
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

sys.path.insert(0, os.path.dirname(__file__))
from app.searcher import _extract_location, DEFAULT_COUNTRY

# ── 1. Location extraction tests ─────────────────────────────────────────────

CASES = [
    # (input, expected_industry, expected_city, expected_country_or_None)
    # Spanish preposition + Mexican states
    ("gaseras en jalisco",            "gaseras",        "Guadalajara",       "México"),
    ("clinicas en chihuahua",         "clinicas",       "Chihuahua",         "México"),
    ("dentistas en guerrero",         "dentistas",      "Chilpancingo",      "México"),
    ("restaurants en nuevo leon",     "restaurants",    "Monterrey",         "México"),
    ("farmacias en quintana roo",     "farmacias",      "Chetumal",          "México"),
    ("gyms en yucatan",               "gyms",           "Mérida",            "México"),
    # Spanish preposition + known cities
    ("restaurantes en monterrey",     "restaurantes",   "Monterrey",         "México"),
    ("gimansios en bogotá",           "gimansios",      "Bogotá",            "Colombia"),
    ("clínicas en madrid",            "clínicas",       "Madrid",            "España"),
    ("dentistas en buenos aires",     "dentistas",      "Buenos Aires",      "Argentina"),
    ("restaurantes en lima",          "restaurantes",   "Lima",              "Perú"),
    # English preposition "in"
    ("clinics in guadalajara",        "clinics",        "Guadalajara",       "México"),
    ("dentists in monterrey",         "dentists",       "Monterrey",         "México"),
    ("gyms in london",                "gyms",           "Londres",           "Reino Unido"),
    ("restaurants in rome",           "restaurants",    "Roma",              "Italia"),
    ("clinics in mexico city",        "clinics",        "Ciudad de México",  "México"),
    ("lawyers in buenos aires",       "lawyers",        "Buenos Aires",      "Argentina"),
    ("dentists in bogota",            "dentists",       "Bogotá",            "Colombia"),
    # English preposition "near"
    ("gyms near monterrey",           "gyms",           "Monterrey",         "México"),
    ("clinics near madrid",           "clinics",        "Madrid",            "España"),
    # No location → should pass through unchanged
    ("clinics",                       "clinics",        "",                  None),
    ("gaseras",                       "gaseras",        "",                  None),
    ("dentistas",                     "dentistas",      "",                  None),
]

print("\n" + "="*70)
print("1. LOCATION EXTRACTION")
print("="*70)
passed = 0
failed_cases = []
for raw, exp_ind, exp_city, exp_country in CASES:
    ind, city, country = _extract_location(raw)
    ok = ind == exp_ind and city == exp_city and country == exp_country
    status = "✓" if ok else "✗"
    if ok:
        passed += 1
    else:
        failed_cases.append((raw, ind, city, country, exp_ind, exp_city, exp_country))
    print(f"  {status} {raw!r}")
    if not ok:
        if ind != exp_ind:
            print(f"      industry: got={ind!r}     expected={exp_ind!r}")
        if city != exp_city:
            print(f"      city:     got={city!r}     expected={exp_city!r}")
        if country != exp_country:
            print(f"      country:  got={country!r}  expected={exp_country!r}")

print(f"\n  {passed}/{len(CASES)} passed")
if failed_cases:
    print(f"  {len(failed_cases)} FAILED ^^\n")
else:
    print("  All OK!\n")

# ── 2. No-location queries: show that they stay untouched ────────────────────

print("="*70)
print("2. NO-LOCATION QUERIES (country=None → worldwide search, no geo bias)")
print("="*70)
queries_no_loc = ["clinics", "gaseras", "dentistas", "gym", "restaurants"]
for q in queries_no_loc:
    ind, city, country = _extract_location(q)
    print(f"  {q!r} → industry={ind!r} city={city!r} country={country!r}  (worldwide)")

# ── 3. Live search (optional, LIVE=1) ────────────────────────────────────────

if os.getenv("LIVE"):
    from app.searcher import search_prospects
    print("\n" + "="*70)
    print("3. LIVE SEARCH")
    print("="*70)
    live_cases = [
        "gaseras en jalisco",
        "clinics in guadalajara",
        "dentists in monterrey",
        "gyms in london",
        "clinics",
        "dentistas en monterrey",
    ]
    for q in live_cases:
        print(f"\n  Searching: {q!r}")
        try:
            results = search_prospects(q, num_results=5)
            print(f"  → {len(results)} results")
            for r in results[:3]:
                print(f"     {r}")
        except Exception as e:
            import traceback
            print(f"  ERROR: {e}")
            traceback.print_exc()
else:
    print("\n  (Set LIVE=1 to run actual API searches)")
