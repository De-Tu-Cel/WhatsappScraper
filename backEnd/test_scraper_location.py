"""
Test de extracción de ubicación del scraper — sin red, sin MongoDB.
Cubre las 4 estrategias de _extract_address_structured:
  1. JSON-LD Schema.org
  2. Google Maps iframe (q= param)
  3. Regex fallback (itemprop / patrones de calle)
  4. _clean_city, _extract_city, _extract_state helpers
"""
import sys
sys.path.insert(0, r'c:\Repos\WhatsappScraper\backEnd')

from bs4 import BeautifulSoup
from app.scraper import WebsiteScraper

s = WebsiteScraper()

# Nominatim requiere red — lo mockeamos para que los tests no dependan de internet
_NOM_DISABLED = True
def _nom_mock(self, raw):
    return {}
WebsiteScraper._nominatim_structure_address = _nom_mock


OK   = "OK  "
FAIL = "FAIL"
all_ok = True

def check(label, cond):
    global all_ok
    print(f"  {OK if cond else FAIL} {label}")
    if not cond: all_ok = False
    return cond

def soup(html):
    return BeautifulSoup(html, "html.parser")


# =============================================================================
print("\n=== 1. JSON-LD Schema.org — LocalBusiness completo ===")
# =============================================================================
html_ld = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Clínica San Martín",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Av. Vallarta 1234",
    "addressLocality": "Guadalajara",
    "addressRegion": "Jalisco",
    "postalCode": "44100",
    "addressCountry": "MX"
  }
}
</script>
</head><body></body></html>
"""
r1 = s._extract_schema_address(soup(html_ld))
check("city = Guadalajara",   r1.get("city")        == "Guadalajara")
check("state = Jalisco",      r1.get("state")       == "Jalisco")
check("address tiene texto",  "Vallarta" in r1.get("address", ""))
check("postal_code = 44100",  r1.get("postal_code") == "44100")


# =============================================================================
print("\n=== 2. JSON-LD con wrapper @graph ===")
# =============================================================================
html_graph = """
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {"@type": "WebSite", "name": "Mi Sitio"},
    {
      "@type": "Restaurant",
      "name": "El Mesón",
      "address": {
        "streetAddress": "Calle 5 de Mayo 99",
        "addressLocality": "Monterrey",
        "addressRegion": "Nuevo León",
        "postalCode": "64000"
      }
    }
  ]
}
</script>
"""
r2 = s._extract_schema_address(soup(html_graph))
check("@graph → city = Monterrey",    r2.get("city")  == "Monterrey")
check("@graph → state = Nuevo León",  r2.get("state") == "Nuevo León")


# =============================================================================
print("\n=== 3. JSON-LD — address como string (sin dict) ===")
# =============================================================================
html_str_addr = """
<script type="application/ld+json">
{
  "@type": "Organization",
  "name": "Farmacia Del Valle",
  "address": "Blvd. Díaz Ordaz 500, Col. Santa Catarina, Querétaro, Qro."
}
</script>
"""
r3 = s._extract_schema_address(soup(html_str_addr))
check("address string → no vacío",    len(r3.get("address", "")) > 10)
check("city vacía en string address", r3.get("city") == "")


# =============================================================================
print("\n=== 4. JSON-LD — tipo no reconocido no extrae nada ===")
# =============================================================================
html_wrong_type = """
<script type="application/ld+json">
{
  "@type": "BreadcrumbList",
  "address": {"addressLocality": "Ciudad de México"}
}
</script>
"""
r4 = s._extract_schema_address(soup(html_wrong_type))
check("BreadcrumbList ignorado → dict vacío", r4 == {})


# =============================================================================
print("\n=== 5. JSON-LD — campo city con sufijo CDMX → limpiado ===")
# =============================================================================
html_cdmx = """
<script type="application/ld+json">
{
  "@type": "MedicalBusiness",
  "address": {
    "streetAddress": "Insurgentes Sur 1234",
    "addressLocality": "Ciudad de México, CDMX",
    "addressRegion": "Ciudad de México"
  }
}
</script>
"""
r5_raw = s._extract_schema_address(soup(html_cdmx))
r5_city = s._clean_city(r5_raw.get("city", ""))
check("CDMX limpiado → Ciudad de México", r5_city == "Ciudad de México")


# =============================================================================
print("\n=== 6. Google Maps iframe — extrae q= param ===")
# =============================================================================
html_iframe = """
<html><body>
<iframe src="https://www.google.com/maps/embed?q=Av.+Hidalgo+200%2C+Torreón%2C+Coahuila&zoom=15"></iframe>
</body></html>
"""
r6 = s._extract_map_iframe_text(soup(html_iframe))
check("iframe q= contiene dirección",   "Torreón" in r6 or "Hidalgo" in r6)


# =============================================================================
print("\n=== 7. Google Maps iframe — data-src (lazy load) ===")
# =============================================================================
html_datasrc = """
<iframe data-src="https://maps.google.com/maps?q=Calle+Morelos+45%2C+Culiacán"></iframe>
"""
r7 = s._extract_map_iframe_text(soup(html_datasrc))
check("data-src iframe → extrae q=", "Culiacán" in r7 or "Morelos" in r7)


# =============================================================================
print("\n=== 8. Google Maps iframe — sin iframe de maps → vacío ===")
# =============================================================================
html_no_iframe = """
<iframe src="https://www.youtube.com/embed/abc123"></iframe>
"""
r8 = s._extract_map_iframe_text(soup(html_no_iframe))
check("YouTube iframe ignorado → vacío", r8 == "")


# =============================================================================
print("\n=== 9. Regex — itemprop='address' microdata ===")
# =============================================================================
html_itemprop = """
<div>
  <span itemprop="address">Blvd. Kukulcán km 12.6, Cancún, Quintana Roo, 77500</span>
</div>
"""
r9 = s._extract_address_regex("", soup(html_itemprop))
check("itemprop address → extraído",    "Kukulcán" in r9 or "Cancún" in r9)
check("CP 77500 en string",             "77500" in r9)


# =============================================================================
print("\n=== 10. Regex — patrón de calle mexicana ===")
# =============================================================================
text_calle = "Visítanos en Avenida Insurgentes Norte 1602, Colonia Lindavista, Gustavo A. Madero, Ciudad de México, 07300"
r10 = s._extract_address_regex(text_calle, soup("<html></html>"))
check("Avenida Insurgentes → extraído", "Insurgentes" in r10)


# =============================================================================
print("\n=== 11. Regex — patrón 'Dirección:' ===")
# =============================================================================
text_dir = "Horario: Lun-Vie 9-18h\nDirección: Calzada del Ejército 850, Guadalajara, Jalisco, 44430\nTel: 33-1234-5678"
r11 = s._extract_address_regex(text_dir, soup("<html></html>"))
check("Dirección: etiqueta → extraída", "Guadalajara" in r11 or "Ejército" in r11)


# =============================================================================
print("\n=== 12. Regex — sin match → vacío ===")
# =============================================================================
r12 = s._extract_address_regex("Somos una empresa de tecnología.", soup("<html></html>"))
check("sin dirección → vacío", r12 == "")


# =============================================================================
print("\n=== 13. _extract_city — 'Ciudad, Estado' pattern ===")
# =============================================================================
check("Guadalajara antes de Jalisco",   s._extract_city("Guadalajara, Jalisco") == "Guadalajara")
check("Monterrey antes de Nuevo León",  s._extract_city("Monterrey, Nuevo León") == "Monterrey")
check("Puebla antes de Puebla estado",  s._extract_city("Puebla, Puebla") == "Puebla")


# =============================================================================
print("\n=== 14. _extract_city — ciudad conocida en texto libre ===")
# =============================================================================
check("Cancún en texto",    s._extract_city("Servicio disponible en Cancún zona hotelera") == "Cancún")
check("Mérida en texto",    s._extract_city("Consultorio ubicado en Mérida, Yucatán") != "")
check("sin ciudad → vacío", s._extract_city("Empresa de logística con cobertura nacional") == "")


# =============================================================================
print("\n=== 15. _extract_city — NO extrae si hay número o colonia en el candidato ===")
# =============================================================================
# "Av. 5 de Febrero 123, Querétaro" → el candidato "Av. 5 de Febrero 123" tiene dígitos
# así que debe rechazarse y caer en el fallback de lista de ciudades conocidas
r15 = s._extract_city("Av. 5 de Febrero 123, Querétaro")
check("Querétaro encontrado por fallback (no el candidato con número)", r15 == "Querétaro")


# =============================================================================
print("\n=== 16. _extract_state ===")
# =============================================================================
check("Jalisco detectado",          s._extract_state("Guadalajara, Jalisco") == "Jalisco")
check("Estado de México detectado", s._extract_state("Toluca, Estado de México, 50000") == "Estado de México")
check("Quintana Roo detectado",     s._extract_state("Cancún, Quintana Roo") == "Quintana Roo")
check("sin estado → vacío",         s._extract_state("Empresa internacional sin dirección") == "")


# =============================================================================
print("\n=== 17. _clean_city — elimina sufijos ===")
# =============================================================================
check("CDMX sufijo eliminado",    s._clean_city("Ciudad de México, CDMX") == "Ciudad de México")
check("MX sufijo eliminado",      s._clean_city("Monterrey, MX")          == "Monterrey")
check("D.F. sufijo eliminado",    s._clean_city("Ciudad de México D.F.")   == "Ciudad de México")


# =============================================================================
print("\n=== 18. _clean_city — string SEO → extrae ciudad o vacío ===")
# =============================================================================
check("SEO con Monterrey → Monterrey",
      s._clean_city("Dentista en Monterrey N.L.") == "Monterrey")
check("SEO sin ciudad conocida → vacío",
      s._clean_city("Clínica de ortodoncia zona norte zona sur") == "")
check("ciudad corta y limpia → sin cambios",
      s._clean_city("Querétaro") == "Querétaro")


# =============================================================================
print("\n=== 19. _extract_address_structured — cascade completo con JSON-LD ===")
# =============================================================================
html_full = """
<html><head>
<script type="application/ld+json">
{
  "@type": "LocalBusiness",
  "name": "Óptica Visión",
  "address": {
    "streetAddress": "Calle Independencia 200",
    "addressLocality": "Chihuahua",
    "addressRegion": "Chihuahua",
    "postalCode": "31000"
  }
}
</script>
</head><body><p>Estamos en Chihuahua, Chih.</p></body></html>
"""
sp19 = soup(html_full)
r19 = s._extract_address_structured(sp19, sp19.get_text())
check("cascade → city = Chihuahua",  r19.get("city")        == "Chihuahua")
check("cascade → state = Chihuahua", r19.get("state")       == "Chihuahua")
check("cascade → CP = 31000",        r19.get("postal_code") == "31000")


# =============================================================================
print("\n=== 20. _extract_address_structured — fallback a regex (sin JSON-LD) ===")
# =============================================================================
html_regex_only = """
<html><body>
<p>Dirección: Av. Lázaro Cárdenas 1500, Monterrey, Nuevo León, 64650</p>
<p>Tel: 81 1234 5678</p>
</body></html>
"""
sp20   = soup(html_regex_only)
text20 = sp20.get_text()
r20    = s._extract_address_structured(sp20, text20)
check("regex fallback → city = Monterrey",   r20.get("city")  == "Monterrey")
check("regex fallback → state = Nuevo León", r20.get("state") == "Nuevo León")
check("regex fallback → CP extraído",        r20.get("postal_code") == "64650")


# =============================================================================
print("\n=== 21. _extract_address_structured — sin nada → todo vacío ===")
# =============================================================================
html_empty = "<html><body><p>Empresa de tecnología. Contáctenos.</p></body></html>"
sp21 = soup(html_empty)
r21  = s._extract_address_structured(sp21, sp21.get_text())
check("sin datos → city vacía",  r21.get("city")    == "")
check("sin datos → state vacío", r21.get("state")   == "")


# =============================================================================
print(f"\n{'='*54}")
print(f"  {'TODOS OK' if all_ok else 'HAY FALLOS'}")
print(f"{'='*54}\n")
