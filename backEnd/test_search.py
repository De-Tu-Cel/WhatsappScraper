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
    ("gaseras en jalisco",          "gaseras",       "Guadalajara",       "México"),
    ("clinicas en chihuahua",       "clinicas",      "Chihuahua",         "México"),
    ("dentistas en guerrero",       "dentistas",     "Chilpancingo",      "México"),
    ("restaurants en nuevo leon",   "restaurants",   "Monterrey",         "México"),
    ("farmacias en quintana roo",   "farmacias",     "Chetumal",          "México"),
    ("gyms en yucatan",             "gyms",          "Mérida",            "México"),
    ("restaurantes en monterrey",   "restaurantes",  "Monterrey",         "México"),
    ("gimansios en bogotá",         "gimansios",     "Bogotá",            "Colombia"),
    ("clínicas en madrid",          "clínicas",      "Madrid",            "España"),
    ("clinics",                     "clinics",       "",                  None),    # no location → falls through to default
    ("gaseras",                     "gaseras",       "",                  None),
]

print("\n" + "="*70)
print("1. LOCATION EXTRACTION")
print("="*70)
passed = 0
for raw, exp_ind, exp_city, exp_country in CASES:
    ind, city, country = _extract_location(raw)
    ok_ind     = ind == exp_ind
    ok_city    = city == exp_city
    ok_country = country == exp_country
    status = "✓" if (ok_ind and ok_city and ok_country) else "✗"
    if ok_ind and ok_city and ok_country:
        passed += 1
    print(f"  {status} {raw!r}")
    if not ok_ind:
        print(f"      industry: got={ind!r} expected={exp_ind!r}")
    if not ok_city:
        print(f"      city:     got={city!r} expected={exp_city!r}")
    if not ok_country:
        print(f"      country:  got={country!r} expected={exp_country!r}")

print(f"\n  {passed}/{len(CASES)} passed\n")

# ── 2. Default-country fill (simulates search_prospects behaviour) ────────────

print("="*70)
print("2. DEFAULT COUNTRY FILL (what search_prospects does)")
print("="*70)
queries_no_loc = ["clinics", "gaseras", "dentistas", "gym"]
for q in queries_no_loc:
    ind, city, country = _extract_location(q)
    effective_country = country if (city or country) else DEFAULT_COUNTRY
    print(f"  {q!r} → industry={ind!r} city={city!r} country={effective_country!r}")

# ── 3. Live search (optional, LIVE=1) ────────────────────────────────────────

if os.getenv("LIVE"):
    from app.searcher import search_prospects
    print("\n" + "="*70)
    print("3. LIVE SEARCH (5 queries)")
    print("="*70)
    live_cases = [
        "gaseras en jalisco",
        "clinics",
        "dentistas en monterrey",
        "farmacias en cdmx",
        "restaurantes en guerrero",
    ]
    for q in live_cases:
        print(f"\n  Searching: {q!r}")
        try:
            results = search_prospects(q, num_results=5)
            print(f"  → {len(results)} results")
            for r in results[:3]:
                print(f"     {r}")
        except Exception as e:
            print(f"  ERROR: {e}")
else:
    print("\n  (Set LIVE=1 to run actual API searches)")
