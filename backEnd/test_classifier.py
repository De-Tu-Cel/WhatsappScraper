"""
Prueba del clasificador de respuestas de WhatsApp.
Ejecutar desde la carpeta backEnd/:
    cd backEnd && python test_classifier.py

Los casos marcados (LLM) requieren DEEPSEEK_API_KEY en el entorno.
Los demas se resuelven solo con reglas (rapido, sin costo).
"""
import sys, os, io
sys.path.insert(0, '.')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.classifier import _quick_classify

# Casos de prueba — basados en patrones reales de produccion
CASES = [
    # ─── Menu detectado por reglas (sin LLM) ─────────────────────────────────
    # Inline list (matches _INLINE_MENU_ITEM x2): caso real Hidrogas
    ("1.- Solicitar un servicio  2.- Conocer nuestros servicios  3.- Hablar con asesor", "bot"),
    # Multi-line list (matches _MENU_LIST_ITEM x2): caso real Rivera Gas
    ("Hola, bienvenido. Selecciona una opcion:\n1. Cotizar gas LP\n2. Soporte tecnico\n3. Otro", "bot"),
    # MENU_MARKERS keyword: "elige una opcion"
    ("Para continuar, elige una opcion: Gas domestico o Gas comercial.", "bot"),

    # ─── Auto-reply bot (sin LLM) ────────────────────────────────────────────
    # Caso real comun: "estimado cliente" + "en breve un asesor"
    ("Estimado cliente, hemos recibido tu mensaje. En breve un asesor le atendera.", "bot"),
    # Fuera de horario (caso real Nissan Vallejo, Salones de Belleza)
    ("Gracias por contactarnos. Estamos fuera de horario de atencion. Te responderemos pronto.", "bot"),
    # Folio (caso real de sistemas de tickets)
    ("Folio: 12345 — Tu solicitud ha sido registrada. Un asesor la revisara.", "bot"),

    # ─── Bot self-ID (sin LLM) ───────────────────────────────────────────────
    # "soy tu asistente virtual"
    ("Hola, soy tu asistente virtual. ¿En que puedo ayudarte hoy?", "bot"),
    # "chatbot" explicito
    ("Soy un chatbot de Gas LP. Para hablar con un humano escribe HUMANO.", "bot"),
    # "inteligencia artificial" (caso real Chopo, HSBC)
    ("Bienvenido. Estoy aqui para ayudarte gracias a inteligencia artificial. ¿Que necesitas?", "bot"),
    # Emoji robot (caso real Smart Fit)
    ("Hola! Soy Bell, tu asistente virtual. 🤖 ¿Como puedo ayudarte?", "bot"),

    # ─── Hibrido: auto-reply + oferta de humano (sin LLM) ───────────────────
    # "en breve un asesor" + "escribe ASESOR" → hibrido
    ("Gracias por su mensaje. En breve un asesor le contactara. "
     "Si prefiere atencion inmediata, escribe ASESOR.", "hibrido"),

    # ─── Ambiguo → necesita LLM ──────────────────────────────────────────────
    ("Claro, con gusto te ayudamos. ¿Cual es tu nombre?", None),
    ("Si, tenemos disponibilidad para esta semana.", None),
    ("El precio depende del modelo. Le mando la cotizacion.", None),
    ("Buenos dias, ¿en que le podemos servir?", None),
]

print("\n=== Clasificador — prueba de reglas (sin LLM) ===\n")

passed = skipped = failed = 0

for msg, expected in CASES:
    result = _quick_classify(msg)
    short  = msg.replace('\n', ' ')[:70] + ("..." if len(msg) > 70 else "")

    if result is None:
        ok = expected is None
        if ok:
            print(f"?   {short}")
            print(f"    -> Sin resolucion por reglas (OK — mensaje ambiguo, usara LLM)\n")
            skipped += 1
        else:
            print(f"X   {short}")
            print(f"    -> Sin resolucion por reglas (FALLO — esperabamos '{expected}')\n")
            failed += 1
    else:
        category = result.get('category', '?').upper()
        reason   = result.get('notes', result.get('reason', ''))[:75]
        ok       = (result.get('category') == expected)
        icon     = "OK" if ok else "X "
        print(f"{icon}  {short}")
        print(f"    -> {category}  ({reason})\n")
        if ok: passed += 1
        else:  failed += 1

total = len(CASES)
print(f"Resultado: {passed}/{total - skipped} reglas OK  |  {skipped} necesitan LLM  |  {failed} fallidos")

if failed == 0:
    print("\nClasificador de reglas funcionando correctamente.")
    if skipped:
        print("Para probar los casos LLM ejecuta con DEEPSEEK_API_KEY configurado.")
else:
    print(f"\nHay {failed} caso(s) fallido(s) — revisar las reglas.")
