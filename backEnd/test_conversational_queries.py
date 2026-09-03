"""
Test de queries conversacionales/descriptivos del usuario
contra el pipeline completo de extracción + simplificación.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

from app.searcher import _extract_location, _simplify_industry_for_search

OPENAI_OR_DS = True  # asumir que hay LLM disponible

CASES = [
    # (query, expected_industry_core, expected_city)
    ("busco talleres de hojalatería para autos en guadalajara",      "talleres hojalatería",   "Guadalajara"),
    ("necesito proveedores de uniformes para restaurantes en monterrey", "uniformes restaurantes","Monterrey"),
    ("quiero encontrar clínicas dentales que ofrezcan ortodoncia en cdmx", "clínicas dentales",  "Ciudad de México"),
    ("ando buscando empresas que hagan mantenimiento de refrigeración", "mantenimiento refrigeración", ""),
    ("busco distribuidores de gas lp para uso doméstico en jalisco",  "distribuidores gas",     "Guadalajara"),
    ("me interesa contactar dueños de restaurantes de mariscos en veracruz", "restaurantes mariscos", "Veracruz"),
    ("necesito encontrar talleres mecánicos especializados en transmisiones en monterrey", "talleres transmisiones", "Monterrey"),
    ("ando buscando plomerías o electricistas para remodelaciones en queretaro", "plomerías electricistas", "Querétaro"),
    ("quiero llegar a vendedores de refacciones para camiones pesados", "refacciones camiones",   ""),
    ("busco agencias de marketing digital para pequeñas empresas",    "agencias marketing",      ""),
    # Queries cortas que deben pasar sin simplificación
    ("dentistas en monterrey",                                        "dentistas",               "Monterrey"),
    ("restaurantes",                                                   "restaurantes",            ""),
    ("gaseras en jalisco",                                            "gaseras",                 "Guadalajara"),
]

print("\n" + "="*75)
print("QUERIES CONVERSACIONALES — extracción + simplificación")
print("="*75)
print(f"{'Query original':50s}  {'industry extraído':25s}  {'city':15s}  {'simplificado'}")
print("-"*75)

issues = []
for query, exp_ind, exp_city in CASES:
    ind, city, country = _extract_location(query)
    needs_simplify = len(ind.split()) > 3
    simplified = _simplify_industry_for_search(ind) if needs_simplify else ind
    changed = simplified != ind

    ok_city = (city == exp_city) or (not exp_city and not city)
    flag = ""
    if not ok_city:
        flag += " ⚠CITY"
        issues.append((query, "city", city, exp_city))

    print(f"  {query[:48]:50s}  {ind[:23]:25s}  {city:15s}  {'→ ' + simplified if changed else '(sin cambio)'}{flag}")

if issues:
    print(f"\n⚠ PROBLEMAS DETECTADOS:")
    for q, kind, got, exp in issues:
        print(f"  {kind}: got={got!r}  expected={exp!r}  query={q!r}")
else:
    print(f"\n✓ Extracción de ubicación correcta en todos los casos")

print()
