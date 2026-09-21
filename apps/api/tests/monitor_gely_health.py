"""
Test 3 — Monitor de resiliencia gely-test2
==========================================
Registra el estado del número a lo largo del tiempo y alerta si
WhatsApp emite señales de restricción (ban warnings, desconexión forzada,
mensajes no entregados en masa, cap agotado antes del horario esperado).

Modos:
  • snapshot  — imprime estado actual y sale (ideal para cron o check manual)
  • watch     — polling continuo cada N segundos, muestra cambios
  • report    — genera reporte de los últimos N días desde MongoDB

Uso:
    python monitor_gely_health.py snapshot
    python monitor_gely_health.py watch --interval 300
    python monitor_gely_health.py report --days 7
"""
import sys, os, time, argparse
from datetime import datetime, timedelta
_tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_tests_dir, '..', 'app'))
sys.path.insert(0, os.path.join(_tests_dir, '..'))

from config import MONGODB_URI, DATABASE_NAME
from database import MongoDBManager
from daily_cap import get_instance_cap, get_daily_count, _today, WARMUP_CAP

INSTANCE = "gely-test2"
GREEN, YELLOW, RED, CYAN, BOLD, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[96m", "\033[1m", "\033[0m"


# ─── Señales de riesgo que WA suele emitir antes de un ban ───────────────────

BAN_SIGNALS = {
    "qr_required_again":    "Sesión forzada a cerrar — WA puede haber pedido re-auth (señal de suspicion)",
    "disconnected_suddenly": "Desconexión repentina sin reinicio manual",
    "cap_hit_before_noon":  "Cap diario agotado antes del mediodía — ritmo demasiado agresivo",
    "many_failures_in_row": "Alta tasa de mensajes fallidos consecutivos — posible shadow-block",
    "ai_sessions_killed":   "Sesiones Andy terminadas por bot-loop — contactos detectando comportamiento anómalo",
}


# ─── Snapshot de estado actual ───────────────────────────────────────────────

def snapshot(db) -> dict:
    now = datetime.now()
    today = _today()

    inst = db.db.instances.find_one({"name": INSTANCE}) or {}
    warmup   = inst.get("warmup_mode", False)
    status   = inst.get("status", "unknown")
    provider = inst.get("provider", "?")
    cap      = get_instance_cap(db, INSTANCE)
    sent     = get_daily_count(db, INSTANCE)
    cap_pct  = (sent / cap * 100) if cap else 0

    # Mensajes fallidos hoy (message_logs)
    today_start = datetime(now.year, now.month, now.day)
    total_today = db.db.message_logs.count_documents({
        "instance_name": INSTANCE,
        "direction": "outbound",
        "created_at": {"$gte": today_start},
    })
    failed_today = db.db.message_logs.count_documents({
        "instance_name": INSTANCE,
        "direction": "outbound",
        "status": {"$in": ["failed", "error"]},
        "created_at": {"$gte": today_start},
    })
    fail_rate = (failed_today / total_today * 100) if total_today else 0

    # Sesiones Andy activas/terminadas hoy
    andy_active = db.db.ai_followup_sessions.count_documents({
        "instance": INSTANCE, "status": "active",
    })
    andy_bot_kills = db.db.ai_followup_sessions.count_documents({
        "instance": INSTANCE, "end_reason": "repeated_message",
        "last_activity": {"$gte": today_start},
    })

    # Notificaciones de cap_reached hoy
    cap_notifications = db.db.app_notifications.count_documents({
        "instance": INSTANCE, "type": "cap_reached",
        "created_at": {"$gte": today_start},
    })

    return {
        "timestamp":       now.strftime("%Y-%m-%d %H:%M:%S"),
        "date":            today,
        "status":          status,
        "provider":        provider,
        "warmup":          warmup,
        "cap":             cap,
        "sent":            sent,
        "cap_pct":         cap_pct,
        "total_today":     total_today,
        "failed_today":    failed_today,
        "fail_rate":       fail_rate,
        "andy_active":     andy_active,
        "andy_bot_kills":  andy_bot_kills,
        "cap_notifications": cap_notifications,
        "hour":            now.hour,
    }


def print_snapshot(s: dict):
    print(f"\n{'='*58}")
    print(f"  {BOLD}HEALTH SNAPSHOT — {INSTANCE}{RESET}   [{s['timestamp']}]")
    print(f"{'='*58}")

    # Estado de conexión
    st_color = GREEN if s["status"] == "connected" else (YELLOW if s["status"] == "connecting" else RED)
    print(f"\n  Conexión  : {st_color}{s['status']}{RESET} ({s['provider']})")
    print(f"  Warmup    : {'SÍ (cap=20)' if s['warmup'] else 'NO (cap=150)'}")

    # Cap diario
    bar_filled = int(s["cap_pct"] / 5)
    bar = "█" * bar_filled + "░" * (20 - bar_filled)
    cap_color = GREEN if s["cap_pct"] < 60 else (YELLOW if s["cap_pct"] < 85 else RED)
    print(f"\n  Cap diario: {cap_color}[{bar}] {s['sent']}/{s['cap']} ({s['cap_pct']:.0f}%){RESET}")

    # Mensajes fallidos
    fail_color = GREEN if s["fail_rate"] < 5 else (YELLOW if s["fail_rate"] < 20 else RED)
    print(f"  Fallidos  : {fail_color}{s['failed_today']}/{s['total_today']} ({s['fail_rate']:.1f}%){RESET}")

    # Andy
    print(f"  Andy      : {s['andy_active']} sesiones activas  |  {s['andy_bot_kills']} kills por bot-loop hoy")

    # Señales de riesgo
    risks = detect_risks(s)
    if risks:
        print(f"\n  {RED}{BOLD}⚠ SEÑALES DE RIESGO:{RESET}")
        for r in risks:
            print(f"    {RED}•{RESET} {r}")
    else:
        print(f"\n  {GREEN}✓ Sin señales de riesgo detectadas{RESET}")
    print()


def detect_risks(s: dict) -> list[str]:
    risks = []
    if s["status"] not in ("connected", "connecting", "initialized"):
        risks.append(f"Instancia desconectada: status='{s['status']}'")
    if s["cap_pct"] >= 100 and s["hour"] < 12:
        risks.append(f"Cap agotado ({s['sent']}/{s['cap']}) antes del mediodía — ritmo muy agresivo")
    if s["fail_rate"] > 20 and s["total_today"] >= 5:
        risks.append(f"Tasa de fallo alta: {s['fail_rate']:.0f}% — posible shadow-block")
    if s["andy_bot_kills"] >= 3:
        risks.append(f"{s['andy_bot_kills']} sesiones Andy terminadas por bot-loop — contactos detectando bot")
    if s["cap_notifications"] > 0 and s["hour"] < 10:
        risks.append("Cap notificado muy temprano — considera reducir velocidad de envío")
    return risks


# ─── Reporte histórico ───────────────────────────────────────────────────────

def historical_report(db, days: int):
    print(f"\n{'='*58}")
    print(f"  {BOLD}REPORTE HISTÓRICO — {INSTANCE} (últimos {days} días){RESET}")
    print(f"{'='*58}\n")

    for i in range(days - 1, -1, -1):
        d = (datetime.now() - timedelta(days=i)).date()
        date_str = d.strftime("%Y-%m-%d")

        doc = db.db.instance_daily_sends.find_one({"instance": INSTANCE, "date": date_str})
        sent = len(doc.get("companies", [])) if doc else 0
        cap = WARMUP_CAP  # asumimos warmup; ajustar si cambia

        day_start = datetime(d.year, d.month, d.day)
        day_end = day_start + timedelta(days=1)
        failed = db.db.message_logs.count_documents({
            "instance_name": INSTANCE,
            "status": {"$in": ["failed", "error"]},
            "created_at": {"$gte": day_start, "$lt": day_end},
        })

        bar = "█" * min(sent, 20) + "░" * max(0, 20 - sent)
        pct = sent / cap * 100 if cap else 0
        day_color = GREEN if pct < 70 else (YELLOW if pct < 90 else RED)
        fail_str = f"  {RED}{failed} fallidos{RESET}" if failed else ""
        is_today = date_str == _today()

        print(f"  {CYAN if is_today else ''}{date_str}{RESET}  {day_color}[{bar}]{RESET} {sent:>2}/{cap}  ({pct:>5.1f}%){fail_str}")

    print()


# ─── Watch continuo ──────────────────────────────────────────────────────────

def watch_loop(db, interval: int):
    print(f"  Modo WATCH — polling cada {interval}s. Ctrl+C para salir.\n")
    prev_status = None
    while True:
        try:
            s = snapshot(db)
            print_snapshot(s)

            if prev_status and prev_status != s["status"]:
                print(f"  {RED}⚡ CAMBIO DE ESTADO: {prev_status} → {s['status']}{RESET}\n")
            prev_status = s["status"]

            time.sleep(interval)
        except KeyboardInterrupt:
            print("\n  Watch terminado.\n")
            break


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"Monitor de resiliencia {INSTANCE}")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("snapshot", help="Estado actual (una sola vez)")

    p_watch = sub.add_parser("watch", help="Polling continuo")
    p_watch.add_argument("--interval", type=int, default=300, help="Segundos entre checks (default: 300)")

    p_report = sub.add_parser("report", help="Reporte histórico")
    p_report.add_argument("--days", type=int, default=7, help="Días hacia atrás (default: 7)")

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        sys.exit(0)

    db = MongoDBManager()

    if args.cmd == "snapshot":
        print_snapshot(snapshot(db))
    elif args.cmd == "watch":
        watch_loop(db, args.interval)
    elif args.cmd == "report":
        historical_report(db, args.days)
