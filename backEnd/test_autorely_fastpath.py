"""
Prueba el fast-path de ACK/auto-reply en Andy AI.
Ejecutar: cd backEnd && python test_autorely_fastpath.py
"""
import sys, os, io
sys.path.insert(0, '.')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from app.classifier import _looks_like_auto_reply, _looks_like_bot_selfid, _looks_like_menu

# ─── Mensajes reales de las sesiones fallidas (idle_timeout) ─────────────────
REAL_FAILED = [
    # Sesion #1 — restaurante, mensaje de bienvenida con link de reserva
    ("barbaro_asador",
     "Hola! Gracias por comunicarte a Bárbaro Asador. Si deseas visitarnos aqui puedes reservar lugar:"),
    # Sesion #2 — restaurante, telefono de contacto
    ("brassao",
     "Hola!! Te comunicas a restaurante Brassao  Para reservacion e informes generales, comunicarse al numero"),
    # Sesion #3 — agencia Toyota, mensaje corporativo de bienvenida
    ("toyota",
     "A nombre de Dalton Toyota Lopez Mateos agradecemos su preferencia y le damos la mas cordial bienvenida"),
]

# ─── Casos que SI deben ser capturados (ya cubiertos por el classifier) ──────
SHOULD_CATCH = [
    ("folio_ticket",     "Folio: 12345 — Tu solicitud ha sido registrada. Un asesor la revisara."),
    ("estimado_cliente", "Estimado cliente, hemos recibido tu mensaje. En breve un asesor le atendera."),
    ("fuera_horario",    "Gracias por contactarnos. Estamos fuera de horario de atencion. Te responderemos pronto."),
    ("mensaje_auto",     "Este es un mensaje generado automaticamente. Por favor no responda."),
    ("apreciable",       "Apreciable cliente, sus datos han sido recibidos."),
]

# ─── Mensajes de humanos — NO deben cerrarse automaticamente ─────────────────
SHOULD_NOT_CATCH = [
    ("humano_precio",  "si claro, el cilindro de 20kg cuesta 350 pesos en tu zona"),
    ("humano_pregunta","oye y a que zona llevan el servicio?"),
    ("humano_cita",    "te podemos agendar para el jueves en la manana, que te parece?"),
    ("humano_nombre",  "hola Andres, yo soy Luis el encargado de ventas"),
]

def check(label, text):
    ar  = _looks_like_auto_reply(text)
    bot = _looks_like_bot_selfid(text)
    menu = _looks_like_menu(text)
    caught = ar or bot or menu
    reason = ("auto_reply" if ar else "") + ("bot_selfid" if bot else "") + ("menu" if menu else "")
    return caught, reason or "ninguna"

print("\n=== PASO 1: Mensajes reales de sesiones fallidas (deberian ser capturados) ===\n")
missed = []
for label, msg in REAL_FAILED:
    caught, reason = check(label, msg)
    icon = "OK" if caught else "X "
    short = msg[:75] + ("..." if len(msg) > 75 else "")
    print(f"{icon}  [{label}]")
    print(f"    \"{short}\"")
    print(f"    -> {'CAPTURADO por: ' + reason if caught else 'NO CAPTURADO — llegaria al LLM'}")
    if not caught:
        missed.append((label, msg))
    print()

print("\n=== PASO 2: Casos ya cubiertos (deben seguir funcionando) ===\n")
for label, msg in SHOULD_CATCH:
    caught, reason = check(label, msg)
    icon = "OK" if caught else "X "
    print(f"{icon}  [{label}]: {'CAPTURADO (' + reason + ')' if caught else 'FALLO — no detectado'}")

print("\n=== PASO 3: Mensajes de humanos (NO deben cerrarse) ===\n")
false_positives = []
for label, msg in SHOULD_NOT_CATCH:
    caught, reason = check(label, msg)
    icon = "OK" if not caught else "X "
    print(f"{icon}  [{label}]: {'correcto — pasa al LLM' if not caught else 'FALSO POSITIVO — cerraria sesion de humano!'}")
    if caught:
        false_positives.append(label)

print(f"\n{'='*55}")
print(f"  Mensajes reales NO capturados: {len(missed)}/{len(REAL_FAILED)}")
print(f"  Casos existentes OK:           {len(SHOULD_CATCH) - sum(1 for l,m in SHOULD_CATCH if not check(l,m)[0])}/{len(SHOULD_CATCH)}")
print(f"  Falsos positivos (humanos):    {len(false_positives)}")

if missed:
    print(f"\n  ACCION REQUERIDA: agregar patrones para los {len(missed)} mensajes no capturados")
    for label, msg in missed:
        print(f"    - {label}: \"{msg[:60]}...\"")
print(f"{'='*55}\n")
