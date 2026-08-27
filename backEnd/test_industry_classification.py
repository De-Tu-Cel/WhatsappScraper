"""
Test de clasificación de industria — dos secciones:
  1. Pre-clasificación por nombre + keyword fallback (sin LLM, sin red)
  2. Clasificación LLM completa con snippets representativos (requiere API key)

Corre desde backEnd/:
    python test_industry_classification.py
"""
import sys
sys.path.insert(0, r'c:\Repos\WhatsappScraper\backEnd')

from bs4 import BeautifulSoup
from app.scraper import WebsiteScraper

s = WebsiteScraper()

OK   = "OK  "
FAIL = "FAIL"
all_ok = True

def check(label, got, expected):
    global all_ok
    ok = got == expected
    status = OK if ok else FAIL
    print(f"  {status} {label}")
    if not ok:
        print(f"         got={got!r}  expected={expected!r}")
    if not ok: all_ok = False
    return ok

def soup_from(text):
    return BeautifulSoup(f"<html><body>{text}</body></html>", "html.parser")


# ─────────────────────────────────────────────────────────────────────────────
# 1. Pre-clasificación por nombre de empresa (sin LLM)
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 1. Pre-clasificación por nombre (regla Gas LP, sin LLM) ===")

# Mockear LLM para que no se llame
s._classify_industry_deepseek = lambda text, company_name="": ""

names_gas = [
    "Distribuidora de Gas Zeta",
    "Gasera del Bajío",
    "Gas LP del Centro",
    "Energía y Gas GLP Querétaro",
    "Pipas de Gas Monterrey",
]
for name in names_gas:
    result = s._detect_industry("Servicio de distribución de gas", soup_from(""), company_name=name)
    check(f"nombre '{name}' → Gas LP / Energía", result, "Gas LP / Energía")

names_other = [
    ("Clínica San Martín", "Salud"),
    ("Restaurante El Mesón", "Alimentos y Bebidas"),
    ("Hotel Hidalgo", "Hospedaje"),
]
for name, expected_kw in names_other:
    result = s._detect_industry("", soup_from(""), company_name=name)
    # El gas pre-check no corto-circuita, pero el keyword fallback sí encuentra
    # industria usando el propio nombre como texto de búsqueda.
    check(f"nombre '{name}' → {expected_kw} (keyword fallback desde nombre)", result, expected_kw)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Keyword fallback (LLM mockeado, texto representativo)
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 2. Keyword fallback (sin LLM) ===")

KEYWORD_CASES = [
    # (texto del sitio, nombre empresa, industria esperada)
    (
        "dentista ortodoncia brackets implantes dentales consultorio odontología blanqueamiento dental",
        "Dental Sonríe",
        "Salud",
    ),
    (
        "restaurante tacos birria mariscos menú platillos chef cocina catering comida bebidas",
        "Tacos El Pata",
        "Alimentos y Bebidas",
    ),
    (
        "hotel habitaciones suite reservaciones hospedaje desayuno incluido alberca",
        "Hotel Plaza",
        "Hospedaje",
    ),
    (
        "gym gimnasio entrenamiento personal crossfit clases spinning pesas cardio fitness membresía",
        "FitZone Gym",
        "Deportes / Fitness",
    ),
    (
        "distribución gas lp cilindros tanque estacionario servicio a domicilio",
        "Servicio Mafer",
        "Gas LP / Energía",
    ),
    (
        "refacciones autos taller mecánico diagnóstico motor aceite frenos suspensión",
        "Taller Mecánico Express",
        "Automotriz",
    ),
    (
        "abogados despacho jurídico amparo derecho penal civil mercantil asesoría legal",
        "Lic. García Abogados",
        "Legal",
    ),
    (
        "ropa vestidos blusas pantalones tallas moda temporada colección accesorios",
        "Boutique Moderna",
        "Ropa / Moda",
    ),
    (
        "plomería electricidad pintura impermeabilización remodelación hogar servicio domicilio",
        "Servicios del Hogar",
        "Servicios del Hogar",
    ),
    (
        "contabilidad fiscal declaraciones SAT nómina auditoría contador público",
        "Contadores Asociados",
        "Contabilidad / Finanzas",
    ),
    (
        "guardería kinder preescolar primaria educación maestros materias clases extracurriculares",
        "Colegio Montessori",
        "Educación",
    ),
    (
        "transporte carga logística fletes envíos paquetería camiones rutas distribución",
        "Transportes del Norte",
        "Transporte / Logística",
    ),
    (
        "muebles sala comedor recámara colchones decoración hogar sofás sillas mesas",
        "Mueblería Central",
        "Muebles / Decoración",
    ),
    (
        "construcción obra civil contratista albañil cemento concreto edificios proyectos arquitectura",
        "Construcciones García",
        "Construcción",
    ),
    (
        "software desarrollo web aplicaciones móviles sistemas tecnología programación",
        "TechSolutions MX",
        "Tecnología",
    ),
]

for text, name, expected in KEYWORD_CASES:
    sp = soup_from(text)
    result = s._detect_industry(text, sp, company_name=name)
    check(f"'{name}' → {expected}", result, expected)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Keyword fallback — falsos positivos que NO deben clasificarse
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 3. Páginas que NO deben tener industria clara ===")

# Texto genérico sin palabras de industria específica
result_vague = s._detect_industry(
    "bienvenido a nuestro sitio web contáctenos para más información",
    soup_from(""),
    company_name="Empresa MX"
)
# No esperamos "No detectada" necesariamente — pero sí que no sea un falso positivo fuerte
print(f"  INFO texto vago → clasificó como: {result_vague!r}")

# Directorio (debería ser filtrado antes de llegar aquí, pero si no...)
result_dir = s._detect_industry(
    "directorio de empresas lista de negocios búsqueda categorías resultados",
    soup_from(""),
    company_name="Directorio México"
)
print(f"  INFO directorio → clasificó como: {result_dir!r}")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Clasificación LLM completa (requiere API key activa)
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== 4. Clasificación LLM (llamada real al LLM) ===")

# Restaurar LLM real
del s._classify_industry_deepseek

LLM_CASES = [
    (
        "Ofrecemos los mejores cortes de carne a la parrilla, ambiente familiar, "
        "reservaciones disponibles, menú variado con entradas, sopas y postres. "
        "Abrimos de lunes a domingo. Síguenos en redes sociales.",
        "Restaurante La Parrilla",
        "Alimentos y Bebidas",
    ),
    (
        "Especialistas en implantes dentales, ortodoncia, blanqueamiento y rehabilitación oral. "
        "Contamos con tecnología de vanguardia y atención personalizada. Agenda tu cita.",
        "Dental Estética Zafiro",
        "Salud",
    ),
    (
        "Distribuimos gas LP a domicilio en cilindros y a granel para hogares, comercios e industria. "
        "Cobertura en toda la zona metropolitana. Servicio 24 horas.",
        "Grupo Zeta Gas",
        "Gas LP / Energía",
    ),
    (
        "Clases de CrossFit, yoga, spinning y entrenamiento funcional. Equipos de última generación, "
        "entrenadores certificados, membresías flexibles mensuales y anuales.",
        "FitBox Gym",
        "Deportes / Fitness",
    ),
    (
        "Habitaciones estándar, superiores y suites. Incluye desayuno buffet, alberca, "
        "salón de eventos, estacionamiento gratuito. Reserva directamente en nuestro sitio.",
        "Hotel Gran Plaza",
        "Hospedaje",
    ),
    (
        "Diseño y desarrollo de aplicaciones web y móviles. Implementamos soluciones ERP, CRM "
        "y software a medida para empresas. Soporte técnico 24/7.",
        "DevSoft Solutions",
        "Tecnología",
    ),
    (
        "Venta de refacciones para todo tipo de vehículos. Taller mecánico con diagnóstico "
        "computarizado, cambio de aceite, frenos, suspensión y transmisión.",
        "Refacciones y Taller El Pit",
        "Automotriz",
    ),
    (
        "Asesoría jurídica en derecho familiar, penal, civil y mercantil. "
        "Abogados con más de 15 años de experiencia. Primera consulta gratuita.",
        "Despacho Jurídico Ramírez",
        "Legal",
    ),
]

llm_passed = 0
for text, name, expected in LLM_CASES:
    sp = soup_from(text)
    try:
        result = s._detect_industry(text, sp, company_name=name)
        ok = result == expected
        status = OK if ok else FAIL
        print(f"  {status} '{name}' → {result!r}  (esperado: {expected!r})")
        if ok: llm_passed += 1
        else: all_ok = False
    except Exception as e:
        print(f"  ERRO '{name}' → excepción: {e}")
        all_ok = False

print(f"\n  LLM: {llm_passed}/{len(LLM_CASES)} correctos")


# ─────────────────────────────────────────────────────────────────────────────
print(f"\n{'='*56}")
print(f"  {'TODOS OK' if all_ok else 'HAY FALLOS — revisar arriba'}")
print(f"{'='*56}\n")
