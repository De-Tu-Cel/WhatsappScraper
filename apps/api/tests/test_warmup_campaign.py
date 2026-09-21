"""
Test 1 — Campaña warmup para gely-test2
========================================
Verifica:
  • warmup_mode activado y cap = 20
  • new_contacts_cap = 5
  • Delay entre mensajes correcto
  • Typing indicator funciona (log del microservicio)

Uso:
    # Solo verificar config, sin enviar nada:
    python test_warmup_campaign.py --dry-run

    # Enviar a números de prueba reales:
    python test_warmup_campaign.py --numbers +521234567890 +529876543210

    # Enviar y monitorear delays en tiempo real:
    python test_warmup_campaign.py --numbers +521234567890 --watch
"""
import sys, os, time, argparse
_tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_tests_dir, '..', 'app'))  # direct imports: config, database, ...
sys.path.insert(0, os.path.join(_tests_dir, '..'))          # package imports: app.config, app.whatsapp_wwebjs, ...

from config import MONGODB_URI, DATABASE_NAME
from database import MongoDBManager
from daily_cap import (
    get_instance_cap, get_daily_count, get_new_contacts_limit,
    WARMUP_CAP, WARMUP_NEW_CONTACTS_CAP, NORMAL_NEW_CONTACTS_CAP, _today,
)

INSTANCE = "gely-test2"
GREEN, YELLOW, RED, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[0m"

def ok(msg):  print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET} {msg}")
def fail(msg): print(f"  {RED}✗{RESET} {msg}")


# ─── Sección 1: verificar config en DB ───────────────────────────────────────

def check_warmup_config(db):
    print(f"\n{'='*55}")
    print(f"  VERIFICACIÓN CONFIG — {INSTANCE}")
    print(f"{'='*55}")

    inst = db.db.instances.find_one({"name": INSTANCE})
    if not inst:
        fail(f"Instancia '{INSTANCE}' no encontrada en MongoDB")
        sys.exit(1)

    warmup = inst.get("warmup_mode", False)
    provider = inst.get("provider", "?")
    status = inst.get("status", "?")
    cap = get_instance_cap(db, INSTANCE)
    sent_today = get_daily_count(db, INSTANCE)
    new_contacts_cap = get_new_contacts_limit(warmup)

    print(f"\n  Proveedor  : {provider}")
    print(f"  Estado     : {status}")
    print(f"  Warmup     : {'SÍ' if warmup else 'NO'}")
    print(f"  Cap diario : {cap}  (esperado: {WARMUP_CAP if warmup else 150})")
    print(f"  New contac.: {new_contacts_cap}  (esperado: {WARMUP_NEW_CONTACTS_CAP if warmup else NORMAL_NEW_CONTACTS_CAP})")
    print(f"  Enviados hoy: {sent_today}/{cap}")
    print()

    if warmup:
        ok("warmup_mode = True")
    else:
        warn("warmup_mode = False — considera activarlo desde el panel Instancias")

    if cap == WARMUP_CAP and warmup:
        ok(f"Cap warmup correcto: {cap}")
    elif not warmup and cap == 150:
        ok(f"Cap normal correcto: {cap}")
    else:
        fail(f"Cap inesperado: {cap}")

    if new_contacts_cap == (WARMUP_NEW_CONTACTS_CAP if warmup else NORMAL_NEW_CONTACTS_CAP):
        ok(f"New contacts cap correcto: {new_contacts_cap}")
    else:
        fail(f"New contacts cap inesperado: {new_contacts_cap}")

    remaining = max(0, cap - sent_today)
    if remaining == 0:
        warn(f"Cap agotado hoy — no se pueden enviar más mensajes hasta mañana")
    else:
        ok(f"Cupo restante hoy: {remaining} mensajes")

    return {"warmup": warmup, "cap": cap, "sent_today": sent_today, "remaining": remaining, "provider": provider}


# ─── Sección 2: verificar microservicio wwebjs ───────────────────────────────

def check_wwebjs_connection():
    print(f"\n{'='*55}")
    print(f"  VERIFICACIÓN WWEBJS MICROSERVICIO")
    print(f"{'='*55}\n")
    try:
        from whatsapp_wwebjs import list_sessions  # noqa: sys.path already set
        sessions = list_sessions()
        if INSTANCE in sessions:
            info = sessions[INSTANCE]
            st = info.get("status", "?")
            if st == "connected":
                ok(f"Sesión '{INSTANCE}' conectada en wwebjs")
                return True
            else:
                fail(f"Sesión '{INSTANCE}' estado: {st} (esperado: connected)")
                return False
        else:
            fail(f"Sesión '{INSTANCE}' no encontrada en wwebjs (sessions disponibles: {list(sessions.keys())})")
            return False
    except Exception as e:
        fail(f"No se pudo conectar al microservicio wwebjs: {e}")
        return False


# ─── Sección 3: enviar mensajes de prueba ────────────────────────────────────

def send_test_campaign(db, numbers: list[str], dry_run: bool, watch: bool):
    print(f"\n{'='*55}")
    print(f"  {'DRY RUN — ' if dry_run else ''}ENVÍO DE PRUEBA ({len(numbers)} números)")
    print(f"{'='*55}\n")

    from whatsapp_wwebjs import WWebjsClient
    import random

    messages = [
        "Hola, vi que tienen un negocio interesante — ¿siguen en operación?",
        "oye buen día, quería saber si aún ofrecen sus servicios",
        "Hola! me recomendaron contactarlos, ¿tienen disponibilidad?",
        "buenas, alguien me pasó su contacto — ¿me pueden dar más info?",
        "Hola que tal, vi info de su empresa y quería saber más",
    ]

    client = WWebjsClient(INSTANCE) if not dry_run else None
    results = []

    for i, number in enumerate(numbers):
        msg = messages[i % len(messages)]
        delay_ms = random.randint(800, 1800)
        between_delay = random.uniform(25, 55)

        print(f"  [{i+1}/{len(numbers)}] → {number}")
        print(f"         Mensaje   : {msg[:60]}...")
        print(f"         Typing    : {delay_ms}ms")
        print(f"         Next delay: {between_delay:.0f}s")

        if not dry_run:
            try:
                t0 = time.time()
                result = client.send(number, msg, delay_ms=delay_ms)
                elapsed = time.time() - t0
                if result.get("success"):
                    mid = result.get("messageId") or "?"
                    ok(f"Enviado en {elapsed:.1f}s — messageId: {mid}")
                    from daily_cap import increment_daily_count
                    from phone_utils import clean_digits
                    increment_daily_count(db, INSTANCE, clean_digits(number))
                    results.append({"number": number, "status": "sent", "elapsed": elapsed})
                else:
                    fail(f"Error: {result}")
                    results.append({"number": number, "status": "failed", "error": str(result)})
            except Exception as e:
                fail(f"Excepción: {e}")
                results.append({"number": number, "status": "error", "error": str(e)})

            if watch:
                print(f"         [watch] Sent count ahora: {get_daily_count(db, INSTANCE)}")

            if i < len(numbers) - 1:
                print(f"         Esperando {between_delay:.0f}s antes del siguiente...")
                time.sleep(between_delay)
        else:
            ok(f"DRY RUN — se habría enviado correctamente")
            results.append({"number": number, "status": "dry_run"})

        print()

    return results


# ─── Resumen final ───────────────────────────────────────────────────────────

def print_summary(cfg, conn_ok, results, dry_run):
    print(f"\n{'='*55}")
    print(f"  RESUMEN")
    print(f"{'='*55}")
    print(f"  Instancia  : {INSTANCE}")
    print(f"  Fecha      : {_today()}")
    print(f"  Warmup     : {'✓' if cfg['warmup'] else '✗'}")
    print(f"  Conexión   : {'✓' if conn_ok else '✗'}")
    if results:
        sent = sum(1 for r in results if r["status"] == "sent")
        failed = sum(1 for r in results if r["status"] in ("failed", "error"))
        print(f"  Enviados   : {sent}/{len(results)} {'(dry run)' if dry_run else ''}")
        if failed:
            warn(f"  Fallidos   : {failed}")
    print()


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test campaña warmup gely-test2")
    parser.add_argument("--dry-run", action="store_true", help="Verificar sin enviar mensajes reales")
    parser.add_argument("--numbers", nargs="+", default=[], metavar="PHONE",
                        help="Números destino en formato +52XXXXXXXXXX")
    parser.add_argument("--watch", action="store_true", help="Mostrar sent count después de cada envío")
    args = parser.parse_args()

    db = MongoDBManager()
    cfg = check_warmup_config(db)
    conn_ok = check_wwebjs_connection()

    results = []
    if args.numbers:
        if cfg["remaining"] == 0:
            fail("Cap agotado — no se enviarán mensajes hoy")
        elif not conn_ok and not args.dry_run:
            fail("Microservicio wwebjs no disponible — usa --dry-run para verificar sin enviar")
        else:
            to_send = args.numbers[:cfg["remaining"]]
            if len(to_send) < len(args.numbers):
                warn(f"Solo {len(to_send)} de {len(args.numbers)} entran en el cupo restante")
            results = send_test_campaign(db, to_send, dry_run=args.dry_run, watch=args.watch)
    else:
        print(f"\n  {YELLOW}Sin --numbers especificados — solo verificación de config.{RESET}")
        print(f"  Ejemplo: python test_warmup_campaign.py --numbers +521234567890\n")

    print_summary(cfg, conn_ok, results, dry_run=args.dry_run)
