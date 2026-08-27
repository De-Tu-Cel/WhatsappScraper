"""Quick live test — 2 queries only, DDG-only (no BD), short timeout."""
import sys, os, logging
logging.basicConfig(level=logging.WARNING)  # only warnings+
sys.path.insert(0, os.path.dirname(__file__))

from app.searcher import _extract_location, _search_via_duckduckgo

queries = [
    "gaseras en jalisco",
    "clinics in guadalajara",
    "dentists in london",
    "clinics",
]

for q in queries:
    ind, city, country = _extract_location(q)
    print(f"\n{'='*60}")
    print(f"Query: {q!r}")
    print(f"  -> industry={ind!r}  city={city!r}  country={country!r}")
    urls, _ = _search_via_duckduckgo(ind, city, set(), country, num_results=5)
    print(f"  DDG results: {len(urls)}")
    for u in urls[:4]:
        print(f"    {u}")
