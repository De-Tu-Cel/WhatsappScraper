"""
Test _simplify_industry_for_search con industrias > 3 palabras.
Run desde backEnd/:
    python test_simplify_industry.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.searcher import _simplify_industry_for_search

CASES = [
    # (input, max_expected_words)
    ("proveedores de materia prima para panaderías",      3),
    ("fabricantes de muebles de madera para oficinas",   3),
    ("talleres de reparación de electrodomésticos del hogar", 3),
    ("distribuidores mayoristas de productos de limpieza", 3),
    ("empresas que venden materiales de construcción",   3),
    ("servicios de consultoría en tecnología de la información", 3),
    ("fabricantes de empaques y envases de plástico",    3),
    ("clínicas de estética y cirugía plástica",          3),
    ("proveedores de insumos para la industria alimentaria", 3),
    ("empresas de fumigación y control de plagas",       3),
    # Estos ya son ≤3 palabras — deben quedar igual o ser simplificados también
    ("dentistas",                    3),
    ("talleres mecánicos",           3),
    ("restaurantes",                 3),
]

print("\n" + "="*65)
print("_simplify_industry_for_search — test con industrias largas")
print("="*65)

passed = 0
failed = 0
for industry, max_words in CASES:
    simplified = _simplify_industry_for_search(industry)
    word_count = len(simplified.split())
    is_long_input = len(industry.split()) > 3
    ok = word_count <= max_words
    status = "✓" if ok else "✗"
    if ok:
        passed += 1
    else:
        failed += 1

    changed = " (sin cambio)" if simplified == industry else f" → '{simplified}'"
    words_tag = f"[{word_count}w]"
    print(f"  {status} {words_tag:5s} '{industry}'{changed}")

print(f"\n  {passed}/{len(CASES)} correctos  |  {failed} fallidos\n")
