"""
Test de efectividad del buscador de prospectos.

Ejecuta búsquedas reales para múltiples industrias y reporta:
  • Cuántas queries genera
  • Cuántas URLs raw retorna cada fuente (BD, DDG, SA, Maps)
  • Cuántas pasan el AI filter
  • Resultado final vs mínimo esperado

Uso:
  cd backEnd
  python tests/test_search_effectiveness.py              # todas las industrias
  python tests/test_search_effectiveness.py --dry-run   # solo queries, sin API calls
"""
import sys, os, time, logging, io, argparse, re

BACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACK)
os.chdir(BACK)

# ── Captura de logs del searcher ───────────────────────────────────────────────
log_capture = io.StringIO()
_handler = logging.StreamHandler(log_capture)
_handler.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger('searcher').addHandler(_handler)
logging.getLogger('searcher').setLevel(logging.INFO)

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true',
                    help='Solo verifica generación de queries, sin llamar APIs')
args = parser.parse_args()

# ── Paleta de colores ──────────────────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def badge(n, low, mid):
    if not isinstance(n, int): return str(n)
    if n >= mid:  return f"{GREEN}{n}{RESET}"
    if n >= low:  return f"{YELLOW}{n}{RESET}"
    return f"{RED}{n}{RESET}"

# ── Casos de prueba ────────────────────────────────────────────────────────────
# (industria, ciudad, min_aceptable, min_bueno)
CASES = [
    ("restaurantes",            "Querétaro",        5, 12),
    ("taquerías",               "Guadalajara",      5, 12),
    ("dentistas",               "Monterrey",        5, 12),
    ("gaseras",                 "Irapuato",         3,  8),
    ("gimnasios",               "Puebla",           5, 12),
    ("hoteles boutique",        "Oaxaca",           4, 10),
    ("veterinarias",            "León",             5, 12),
    ("talleres mecánicos",      "Tijuana",          5, 12),
    ("escuelas de idiomas",     "Ciudad de México", 5, 12),
    ("distribuidoras de agua",  "Guadalajara",      3,  8),
]

NUM_RESULTS = 20   # pequeño para no gastar créditos en el test

# ── DRY RUN: solo query generation ────────────────────────────────────────────
if args.dry_run:
    print(f"\n{BOLD}=== DRY RUN — Verificación de queries generadas ==={RESET}\n")
    from app.searcher import _bd_build_queries, INDUSTRY_SYNONYMS
    all_ok = True
    for industry, city, min_ok, min_good in CASES:
        queries = _bd_build_queries(industry, city, None, '', NUM_RESULTS)
        ind_l = industry.lower()
        syns = INDUSTRY_SYNONYMS.get(ind_l) or INDUSTRY_SYNONYMS.get(ind_l.rstrip('s')) or []
        ok = len(queries) >= 8
        status = f"{GREEN}OK{RESET}" if ok else f"{RED}BAJO{RESET}"
        print(f"  {status}  {CYAN}{industry} / {city}{RESET}: "
              f"{len(queries)} queries, {len(syns)} sinónimos estáticos")
        if not ok:
            all_ok = False
    print()
    sys.exit(0 if all_ok else 1)

# ── LIVE RUN ───────────────────────────────────────────────────────────────────
from pathlib import Path as _Path
from dotenv import load_dotenv as _ldenv
# Busca .env en varios lugares posibles (raíz, backEnd, backEnd/app)
for _env_path in [
    _Path(BACK).parent / '.env',
    _Path(BACK) / '.env',
    _Path(BACK) / 'app' / '.env',
]:
    if _env_path.exists():
        _ldenv(dotenv_path=_env_path, override=False)

BD_KEY = os.getenv("BRIGHTDATA_SERP_KEY", "")
if not BD_KEY:
    print(f"{RED}SKIP: BRIGHTDATA_SERP_KEY no configurado{RESET}")
    print("  Ejecuta este test en el servidor (EC2) donde está el .env con la clave.")
    sys.exit(0)

has_llm = bool(os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY"))
print(f"\n{BOLD}=== Test de efectividad del buscador ==={RESET}")
print(f"  BrightData: {GREEN}configurado{RESET}")
print(f"  LLM AI filter: {(GREEN+'activado'+RESET) if has_llm else (YELLOW+'desactivado (sin clave LLM)'+RESET)}")
print(f"  num_results por búsqueda: {NUM_RESULTS}  |  casos: {len(CASES)}\n")

from app.searcher import search_prospects, _bd_build_queries, INDUSTRY_SYNONYMS

summary_rows = []
failures = []

for industry, city, min_ok, min_good in CASES:
    log_capture.truncate(0)
    log_capture.seek(0)

    print(f"  {CYAN}{BOLD}{industry} / {city}{RESET}  ", end='', flush=True)
    t0 = time.monotonic()

    queries = _bd_build_queries(industry, city, None, '', NUM_RESULTS)

    try:
        results = search_prospects(
            industry, city, '', NUM_RESULTS, 0,
            exclude_domains=set(), country='México',
        )
    except Exception as e:
        elapsed = time.monotonic() - t0
        print(f"{RED}ERROR{RESET}: {e}")
        failures.append((industry, city, str(e)))
        summary_rows.append((industry, city, len(queries), '?', '?', '?', 0, min_ok, elapsed))
        continue

    elapsed = time.monotonic() - t0
    n = len(results)

    # Extraer conteos de los logs capturados
    logs = log_capture.getvalue()
    raw_bd = raw_ddg = raw_sa = raw_maps = 0
    before_ai = after_ai = n
    for line in logs.splitlines():
        m = re.search(r'BD=(\d+).*DDG=(\d+).*SA=(\d+).*Maps=(\d+)', line)
        if m:
            raw_bd, raw_ddg, raw_sa, raw_maps = (int(x) for x in m.groups())
        m = re.search(r'sending (\d+) URLs to AI', line)
        if m: before_ai = int(m.group(1))
        m = re.search(r'AI filter returned (\d+)', line)
        if m: after_ai = int(m.group(1))

    raw_total = raw_bd + raw_ddg + raw_sa + raw_maps
    print(f"→ {badge(n, min_ok, min_good)} resultados  ({elapsed:.0f}s)")
    print(f"       queries={len(queries)}  "
          f"raw={raw_total} (BD={raw_bd} DDG={raw_ddg} SA={raw_sa} Maps={raw_maps})"
          f"  →pre-AI={before_ai}  →AI={badge(after_ai, min_ok, min_good)}"
          f"  →final={badge(n, min_ok, min_good)}")

    summary_rows.append((industry, city, len(queries), raw_total, before_ai, after_ai, n, min_ok, elapsed))
    if n < min_ok:
        failures.append((industry, city, f"solo {n} resultados, mínimo esperado {min_ok}"))

# ── Resumen tabular ────────────────────────────────────────────────────────────
print(f"\n{BOLD}{'':3}{'Industria':<28} {'Ciudad':<20} {'Q':>4} {'Raw':>5} "
      f"{'PreAI':>6} {'→AI':>5} {'Final':>6} {'t(s)':>5}{RESET}")
print('─' * 85)
for industry, city, q, raw, pre_ai, ai_out, final, min_ok, t in summary_rows:
    ok_mark = f"{GREEN}✓{RESET}" if isinstance(final, int) and final >= min_ok else f"{RED}✗{RESET}"
    print(f"  {ok_mark} {industry:<27} {city:<20} {q:>4} {str(raw):>5} "
          f"{str(pre_ai):>6} {str(ai_out):>5} {badge(final, min_ok, min_ok+5):>6} {t:>5.0f}s")

print()
if failures:
    print(f"{RED}FALLÓ ({len(failures)}/{len(CASES)} casos):{RESET}")
    for ind, city, reason in failures:
        print(f"  ✗ {ind} / {city}: {reason}")
    sys.exit(1)
else:
    passed = len(CASES)
    print(f"{GREEN}✓ {passed}/{passed} búsquedas superaron el mínimo esperado{RESET}")
    sys.exit(0)
