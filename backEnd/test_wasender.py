"""
Test manual de WasenderClient.
Ejecutar: python test_wasender.py

Edita las 4 variables de la sección CONFIG antes de correr.
"""

# ── CONFIG ────────────────────────────────────────────────────────────────────
WASENDER_API_KEY  = ""       # api_key de la sesión (hex string de MongoDB)
WASENDER_BASE_URL = "https://www.wasenderapi.com"
OWN_NUMBER        = ""       # número propio de la sesión, solo dígitos: "521234567890"
TEST_NUMBER       = ""       # número al que enviar la prueba: "521234567890"
# ─────────────────────────────────────────────────────────────────────────────

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

def require(val, name):
    if not val:
        print(f"ERROR: {name} no configurado en el script")
        sys.exit(1)

require(WASENDER_API_KEY, "WASENDER_API_KEY")
require(OWN_NUMBER,       "OWN_NUMBER")
require(TEST_NUMBER,      "TEST_NUMBER")

from app.whatsapp_wasender import WasenderClient

client = WasenderClient(
    base_url=WASENDER_BASE_URL,
    api_key=WASENDER_API_KEY,
    instance_name="test",
    own_number=OWN_NUMBER,
)

# ── 1. label_contact ──────────────────────────────────────────────────────────
print("\n[1] label_contact...")
ok = client.label_contact(TEST_NUMBER, "Test", "Wasender")
print(f"    resultado: {'OK' if ok else 'FALLO'}")

# ── 2. check_number ───────────────────────────────────────────────────────────
print("\n[2] check_number (verifica que el numero tiene WhatsApp)...")
exists = client.check_number(TEST_NUMBER)
print(f"    {TEST_NUMBER} en WhatsApp: {exists}")
if not exists:
    print("    AVISO: el numero no tiene WhatsApp, el envio fallara")

# ── 3. send_text con delay (prueba presencia completa) ────────────────────────
print("\n[3] send_text con delay=1500ms (deberia ver: available → composing → mensaje)...")
print("    Mira el telefono destino ahora...")
result = client.send_text(
    number=TEST_NUMBER,
    text="Hola, este es un mensaje de prueba del sistema WasenderAPI.",
    delay_ms=1500,
)
sc = result.get("status_code")
mid = (result.get("response_json") or {}).get("data", {}).get("message_id")
print(f"    status_code: {sc}")
print(f"    message_id:  {mid}")
print(f"    error:       {result.get('error', 'ninguno')}")
print(f"    resultado: {'OK' if sc == 200 else 'FALLO'}")

# ── 4. send_text sin delay (sin presencia, envio directo) ─────────────────────
print("\n[4] send_text SIN delay (sin presencia, debe llegar inmediato)...")
result2 = client.send_text(
    number=TEST_NUMBER,
    text="Segundo mensaje - sin indicador de escritura.",
    delay_ms=0,
)
sc2 = result2.get("status_code")
print(f"    status_code: {sc2}")
print(f"    resultado: {'OK' if sc2 == 200 else 'FALLO'}")

# ── 5. send_image ─────────────────────────────────────────────────────────────
print("\n[5] send_image (imagen publica con caption)...")
result3 = client.send_image(
    number=TEST_NUMBER,
    image_url="https://www.wasenderapi.com/logo.png",
    caption="Prueba de imagen desde el sistema.",
)
sc3 = result3.get("status_code")
print(f"    status_code: {sc3}")
print(f"    resultado: {'OK' if sc3 in (200, 201) else 'FALLO'}")

# ── 6. send_document ──────────────────────────────────────────────────────────
print("\n[6] send_document (PDF publico)...")
result4 = client.send_document(
    number=TEST_NUMBER,
    doc_url="https://www.w3.org/WAI/WCAG21/wcag-2.1.pdf",
    caption="Prueba de documento PDF.",
    file_name="documento-prueba.pdf",
)
sc4 = result4.get("status_code")
print(f"    status_code: {sc4}")
print(f"    resultado: {'OK' if sc4 in (200, 201) else 'FALLO'}")

# ── Resumen ───────────────────────────────────────────────────────────────────
print("\n" + "="*50)
print("RESUMEN:")
print(f"  label_contact : {'OK' if ok else 'FALLO'}")
print(f"  check_number  : {'OK' if exists else 'FALLO/sin WA'}")
print(f"  send con delay: {'OK' if sc == 200 else 'FALLO'}")
print(f"  send sin delay: {'OK' if sc2 == 200 else 'FALLO'}")
print(f"  send_image    : {'OK' if sc3 in (200,201) else 'FALLO'}")
print(f"  send_document : {'OK' if sc4 in (200,201) else 'FALLO'}")
print("="*50)
print("\nQue verificar en el telefono destino:")
print("  - Prueba 3: aparece 'online' -> 'escribiendo...' -> llega mensaje")
print("  - Prueba 4: llega inmediato sin indicador")
print("  - Prueba 5: llega imagen con caption")
print("  - Prueba 6: llega PDF descargable")
print("  - Todos deben tener doble tilde (enviado/entregado)")
