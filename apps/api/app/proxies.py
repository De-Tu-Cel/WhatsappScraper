"""Proxies por número de WhatsApp (wwebjs): un pool en Mongo y una IP fija por número.

- La lista se pega una vez en Instancias → Proxies; cada proxy se revisa saliendo por él
  (ipinfo.io), que dice si funciona y de qué país es la IP. No hace falta capturar el país.
- A cada número se le asigna uno al azar entre los del país elegido que funcionan, empezando
  por los menos usados: mientras alcancen, cada número tiene su propia IP; si hay más números
  que proxies, se comparten (pedido explícito, 2026-10-05).
- Una vez asignado no rota: para WhatsApp, un número que cambia de IP seguido es señal de
  riesgo. Solo cambia a mano, o solo si su proxy lleva 2 h caído (con asignación automática).
- Mongo es la fuente de verdad. El servicio de wwebjs guarda su copia junto a los logins
  (PUT /session/:id/settings) y el backend se la vuelve a mandar al arrancar, así que
  sobrevive deploys sin variables de entorno en Coolify.
- Asignación automática (switch en Instancias → Proxies, apagada por defecto): números nuevos
  reciben proxy al crearse; los que ya existían, uno cada 6 h y solo si están conectados; y si
  un proxy con números lleva 2 h sin responder, sus números se mueven a otro.
- Una revisión cada 30 min avisa por correo si un proxy con números lleva 1 h sin responder.
"""
import logging
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import quote

import requests
from bson import ObjectId

log = logging.getLogger(__name__)

SETTINGS_ID = "proxies"
DEFAULT_SETTINGS = {"country": "US", "auto_assign": False}
CHECK_URL = "https://ipinfo.io/json"
HEALTH_EVERY = timedelta(minutes=30)
ALERT_AFTER_FAILS = 2       # 1 h sin responder (revisión cada 30 min): correo
FAILOVER_AFTER_FAILS = 4    # 2 h sin responder: con asignación automática, sus números se mueven
MIGRATE_EVERY = timedelta(hours=6)  # números sin proxy: uno a la vez, nunca todos juntos

# "user:pass@host:port" (con o sin esquema) y "host:port:user:pass". Los separadores pueden
# ser ":" o espacios/saltos de línea, para aceptar también la tabla copiada del panel de
# Webshare (IP, puerto, usuario y contraseña en renglones seguidos).
_URL_FORM = re.compile(
    r"(?:(?:https?|socks5?)://)?(?P<user>[^\s:@/]+):(?P<pwd>[^\s@]+)@(?P<host>[A-Za-z0-9.-]+):(?P<port>\d{2,5})\b")
_PLAIN_FORM = re.compile(
    r"(?<![\d.])(?P<host>\d{1,3}(?:\.\d{1,3}){3})[\s:]+(?P<port>\d{2,5})[\s:]+(?P<user>[^\s:@]+)[\s:]+(?P<pwd>[^\s:@]+)")


def parse_proxy_text(text: str) -> list[dict]:
    """Proxies que vienen en un texto pegado, sin repetidos (host + puerto)."""
    found, seen = [], set()
    for rx in (_URL_FORM, _PLAIN_FORM):
        for m in rx.finditer(text or ""):
            port = int(m.group("port"))
            key = (m.group("host"), port)
            if key in seen or not 0 < port < 65536:
                continue
            seen.add(key)
            found.append({"host": m.group("host"), "port": port,
                          "username": m.group("user"), "password": m.group("pwd")})
    return found


def proxy_url(p: dict) -> str:
    auth = f"{quote(p['username'], safe='')}:{quote(p.get('password') or '', safe='')}@" if p.get("username") else ""
    return f"http://{auth}{p['host']}:{p['port']}"


def check_proxy(p: dict, timeout: int = 15) -> dict:
    """Sale por el proxy y pregunta la IP y el país. Nunca regresa la contraseña, ni en el error."""
    try:
        url = proxy_url(p)
        r = requests.get(CHECK_URL, proxies={"http": url, "https": url}, timeout=timeout)
        r.raise_for_status()
        j = r.json()
        return {"ok": True, "ip": j.get("ip"), "country": j.get("country"), "city": j.get("city"),
                "region": j.get("region"), "org": j.get("org"), "error": None}
    except Exception as e:
        msg = str(e)
        for secret in {p.get("password"), quote(p.get("password") or "", safe="")} - {None, ""}:
            msg = msg.replace(secret, "***")
        return {"ok": False, "error": msg[:300]}


def choose_least_used(pool: list[dict], usage: dict, rng=random) -> dict | None:
    """Al azar entre los proxies del pool con menos números asignados."""
    if not pool:
        return None
    count = lambda p: len(usage.get(str(p["_id"]), []))
    least = min(count(p) for p in pool)
    return rng.choice([p for p in pool if count(p) == least])


def launch_payload(proxy: dict | None, lean: bool, restart: bool = True) -> dict:
    """Lo que se le manda a wwebjs (PUT /session/:id/settings)."""
    return {
        "proxy": ({"server": f"{proxy['host']}:{proxy['port']}", "username": proxy.get("username") or "",
                   "password": proxy.get("password") or ""} if proxy else None),
        "lean": bool(lean),
        "restart": restart,
    }


# ── Mongo ────────────────────────────────────────────────────────────────────

def get_settings(db) -> dict:
    doc = db.settings.find_one({"_id": SETTINGS_ID}) or {}
    return {k: doc.get(k, v) for k, v in DEFAULT_SETTINGS.items()}


def save_settings(db, values: dict) -> dict:
    clean = {}
    if "country" in values:
        clean["country"] = str(values["country"] or "").strip().upper()[:2] or DEFAULT_SETTINGS["country"]
    if "auto_assign" in values:
        clean["auto_assign"] = bool(values["auto_assign"])
    if clean:
        db.settings.update_one({"_id": SETTINGS_ID}, {"$set": clean}, upsert=True)
    return get_settings(db)


def usage_by_proxy(db) -> dict:
    """proxy_id → [nombres de instancia]."""
    used = {}
    for inst in db.instances.find({"provider": "wwebjs", "proxy_id": {"$nin": [None, ""]}}, {"name": 1, "proxy_id": 1}):
        used.setdefault(inst["proxy_id"], []).append(inst["name"])
    return used


def public_proxy(p: dict, usage: dict | None = None) -> dict:
    """Para el navegador: sin contraseña."""
    pid = str(p["_id"])
    return {
        "id": pid, "host": p["host"], "port": p["port"], "username": p.get("username") or "",
        "has_password": bool(p.get("password")), "enabled": p.get("enabled", True),
        "status": p.get("status", "unchecked"), "exit_ip": p.get("exit_ip"), "country": p.get("country"),
        "city": p.get("city"), "region": p.get("region"), "org": p.get("org"),
        "last_checked_at": p.get("last_checked_at"), "last_error": p.get("last_error"),
        "fail_streak": p.get("fail_streak", 0), "instances": (usage or {}).get(pid, []),
    }


def record_check(db, proxy: dict, res: dict) -> dict:
    now = datetime.utcnow()
    if res["ok"]:
        upd = {"$set": {"status": "ok", "exit_ip": res["ip"], "country": res["country"], "city": res["city"],
                        "region": res.get("region"), "org": res.get("org"), "last_error": None,
                        "fail_streak": 0, "last_checked_at": now}}
    else:
        upd = {"$set": {"status": "failing", "last_error": res["error"], "last_checked_at": now},
               "$inc": {"fail_streak": 1}}
    db.proxies.update_one({"_id": proxy["_id"]}, upd)
    return db.proxies.find_one({"_id": proxy["_id"]})


def check_many(db, proxies: list[dict]) -> list[dict]:
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(check_proxy, proxies))
    return [record_check(db, p, r) for p, r in zip(proxies, results)]


def import_text(db, text: str) -> dict:
    """Agrega o actualiza los proxies del texto y los revisa."""
    parsed = parse_proxy_text(text)
    added = updated = 0
    touched, changed_ids = [], []
    for p in parsed:
        existing = db.proxies.find_one({"host": p["host"], "port": p["port"]})
        if existing:
            if (existing.get("username"), existing.get("password")) != (p["username"], p["password"]):
                db.proxies.update_one({"_id": existing["_id"]},
                                      {"$set": {"username": p["username"], "password": p["password"]}})
                updated += 1
                changed_ids.append(str(existing["_id"]))
            touched.append(db.proxies.find_one({"_id": existing["_id"]}))
        else:
            doc = {**p, "enabled": True, "status": "unchecked", "fail_streak": 0, "created_at": datetime.utcnow()}
            doc["_id"] = db.proxies.insert_one(doc).inserted_id
            touched.append(doc)
            added += 1
    checked = check_many(db, touched)
    # Contraseña nueva (p. ej. tras cambiarla en Webshare): los números que ya salen por esos
    # proxies se quedarían con la vieja hasta su próximo reinicio. Se les vuelve a mandar ya.
    reapplied = 0
    if changed_ids:
        usage = usage_by_proxy(db)
        for pid in changed_ids:
            for name in usage.get(pid, []):
                try:
                    push_instance_settings(db, name)
                    reapplied += 1
                except Exception:
                    log.exception("[Proxies] no se pudo re-aplicar el proxy a %s", name)
    return {"parsed": len(parsed), "added": added, "updated": updated, "reapplied": reapplied,
            "ok": sum(1 for p in checked if p.get("status") == "ok"),
            "failing": sum(1 for p in checked if p.get("status") == "failing")}


def pick_proxy(db, exclude_id: str | None = None) -> dict | None:
    country = get_settings(db)["country"]
    pool = list(db.proxies.find({"enabled": {"$ne": False}, "status": "ok", "country": country}))
    if exclude_id and len(pool) > 1:
        pool = [p for p in pool if str(p["_id"]) != exclude_id]
    return choose_least_used(pool, usage_by_proxy(db))


def _proxy_doc(db, proxy_id: str | None) -> dict | None:
    if not proxy_id or not ObjectId.is_valid(proxy_id):
        return None
    return db.proxies.find_one({"_id": ObjectId(proxy_id)})


def push_instance_settings(db, name: str, restart: bool = True) -> dict:
    """Le manda a wwebjs el proxy y el modo ligero de una instancia. wwebjs solo reinicia la
    sesión si algo cambió de verdad."""
    from app import whatsapp_wwebjs as ww
    inst = db.instances.find_one({"name": name}, {"proxy_id": 1, "lean_mode": 1}) or {}
    body = launch_payload(_proxy_doc(db, inst.get("proxy_id")), inst.get("lean_mode", False), restart)
    r = requests.put(f"{ww.WWEBJS_URL}/session/{name}/settings", json=body, headers=ww._headers(), timeout=45)
    r.raise_for_status()
    return r.json()


def assign(db, name: str, proxy_id: str | None, push: bool = True) -> dict:
    """proxy_id: "auto" (al azar entre los menos usados), un id del pool, o None para quitarlo."""
    inst = db.instances.find_one({"name": name, "provider": "wwebjs"})
    if not inst:
        raise LookupError(f"No existe la instancia {name}")
    if proxy_id == "auto":
        chosen = pick_proxy(db, exclude_id=inst.get("proxy_id"))
        if not chosen:
            raise ValueError(f"No hay proxies de {get_settings(db)['country']} que funcionen")
        new_id = str(chosen["_id"])
    elif proxy_id:
        if not _proxy_doc(db, proxy_id):
            raise LookupError("Ese proxy no existe")
        new_id = proxy_id
    else:
        new_id = None
    db.instances.update_one({"_id": inst["_id"]}, {"$set": {"proxy_id": new_id, "proxy_assigned_at": datetime.utcnow()}})
    result = {"proxy_id": new_id}
    if push:
        result["wwebjs"] = push_instance_settings(db, name)
    return result


def set_lean(db, name: str, enabled: bool, push: bool = True) -> dict:
    res = db.instances.update_one({"name": name, "provider": "wwebjs"}, {"$set": {"lean_mode": bool(enabled)}})
    if not res.matched_count:
        raise LookupError(f"No existe la instancia {name}")
    return {"lean": bool(enabled), **({"wwebjs": push_instance_settings(db, name)} if push else {})}


def prepare_new_instance(db, name: str) -> dict:
    """Al crear un número: si está activada la asignación automática, le toca un proxy ANTES
    de que su Chrome arranque por primera vez. Regresa los campos para el documento nuevo."""
    try:
        if not get_settings(db)["auto_assign"]:
            return {}
        chosen = pick_proxy(db)
        if not chosen:
            log.warning("[Proxies] %s se crea sin proxy: no hay proxies disponibles del país elegido", name)
            return {}
        from app import whatsapp_wwebjs as ww
        requests.put(f"{ww.WWEBJS_URL}/session/{name}/settings", headers=ww._headers(), timeout=15,
                     json=launch_payload(chosen, False, restart=False)).raise_for_status()
        return {"proxy_id": str(chosen["_id"]), "proxy_assigned_at": datetime.utcnow()}
    except Exception:
        log.exception("[Proxies] no se pudo asignar proxy a %s", name)
        return {}


def forget_instance(name: str) -> None:
    """Al borrar una instancia: wwebjs olvida su proxy (sin reiniciar nada)."""
    try:
        from app import whatsapp_wwebjs as ww
        requests.put(f"{ww.WWEBJS_URL}/session/{name}/settings", headers=ww._headers(), timeout=10,
                     json={"proxy": None, "lean": False, "restart": False})
    except Exception:
        log.warning("[Proxies] wwebjs no confirmó el olvido de %s", name)


def session_exit_check(db, name: str) -> dict:
    """Por qué IP sale de verdad el Chrome de la sesión, y si es la de su proxy."""
    from app import whatsapp_wwebjs as ww
    r = requests.get(f"{ww.WWEBJS_URL}/proxy-check", params={"sessionId": name}, headers=ww._headers(), timeout=30)
    data = r.json() if r.content else {}
    if not r.ok:
        return {"ok": False, "error": data.get("error") or f"HTTP {r.status_code}"}
    inst = db.instances.find_one({"name": name}, {"proxy_id": 1}) or {}
    p = _proxy_doc(db, inst.get("proxy_id"))
    expected = {p.get("exit_ip"), p.get("host")} - {None} if p else set()
    return {"ok": True, "outbound_ip": data.get("outbound_ip"), "country": data.get("country"),
            "city": data.get("city"), "proxy_configured": data.get("proxy_configured"),
            "matches": (data.get("outbound_ip") in expected) if p else None}


# ── Arranque y revisión periódica ─────────────────────────────────────────────

def sync_all(db) -> int:
    """Le vuelve a mandar a wwebjs los ajustes de todas las instancias. wwebjs solo reinicia
    las que de verdad cambiaron (p. ej. si su volumen se perdió)."""
    n = 0
    for inst in db.instances.find({"provider": "wwebjs"}, {"name": 1}):
        push_instance_settings(db, inst["name"])
        n += 1
    return n


def start_sync_on_boot(db_factory) -> None:
    """Hilo de arranque: espera a que wwebjs responda (se despliegan juntos) y sincroniza."""
    def _run():
        from app import whatsapp_wwebjs as ww
        for _ in range(40):
            try:
                if requests.get(f"{ww.WWEBJS_URL}/health", headers=ww._headers(), timeout=5).ok:
                    log.info("[Proxies] ajustes sincronizados con wwebjs: %d instancias", sync_all(db_factory().db))
                    return
            except Exception as e:
                log.info("[Proxies] wwebjs aún no responde (%s)", e)
            time.sleep(15)
        log.warning("[Proxies] no se pudo sincronizar con wwebjs al arrancar")
    threading.Thread(target=_run, daemon=True, name="proxy-sync-boot").start()


def _claim(db, field: str, every: timedelta) -> bool:
    """Con 2 workers de uvicorn cada uno tiene este hilo; solo el que gane en Mongo corre."""
    now = datetime.utcnow()
    won = db.settings.find_one_and_update(
        {"_id": SETTINGS_ID, "$or": [{field: {"$exists": False}}, {field: {"$lt": now - every}}]},
        {"$set": {field: now}})
    if won is None and not db.settings.find_one({"_id": SETTINGS_ID}):
        db.settings.update_one({"_id": SETTINGS_ID}, {"$setOnInsert": {**DEFAULT_SETTINGS, field: now}}, upsert=True)
        return True
    return won is not None


def health_round(db, alert_emails: list[str]) -> None:
    """Revisa los proxies. Si uno con números lleva 1 h sin responder, avisa; si lleva 2 h y la
    asignación automática está prendida, mueve sus números a otro que funcione (un número sin
    salida está desconectado de todos modos: ahí cambiar de IP es el mal menor)."""
    proxies = list(db.proxies.find({"enabled": {"$ne": False}}))
    if not proxies:
        return
    usage = usage_by_proxy(db)
    auto = get_settings(db)["auto_assign"]
    for p in check_many(db, proxies):
        names = usage.get(str(p["_id"]), [])
        if p.get("status") != "failing" or not names:
            continue
        label = f"{p['host']}:{p['port']}"
        streak = p.get("fail_streak", 0)
        moved = {}
        if auto and streak == FAILOVER_AFTER_FAILS:
            for name in names:
                try:
                    new_id = assign(db, name, "auto")["proxy_id"]
                    np = _proxy_doc(db, new_id)
                    moved[name] = f"{np['host']}:{np['port']}" if np else "?"
                except Exception as e:
                    log.warning("[Proxies] no se pudo mover %s fuera de %s: %s", name, label, e)
        if streak == ALERT_AFTER_FAILS or moved:
            from app.email_service import send_proxy_failing_email
            for to in alert_emails:
                send_proxy_failing_email(to, label, names, p.get("last_error") or "", moved_to=moved or None)
            log.warning("[Proxies] %s sin respuesta %d veces — números: %s — movidos: %s", label, streak, names, moved)


def migrate_one(db) -> str | None:
    """Asignación automática para los números que ya existían sin proxy: uno a la vez (cada
    6 h) y solo si está conectado, para que se reconecte por su proxy sin volver a escanear."""
    if not get_settings(db)["auto_assign"]:
        return None
    inst = db.instances.find_one({"provider": "wwebjs", "status": "connected",
                                  "proxy_id": {"$in": [None, ""]}}, sort=[("name", 1)])
    if not inst:
        return None
    try:
        assign(db, inst["name"], "auto")
        log.info("[Proxies] %s pasó a salir por un proxy (asignación automática)", inst["name"])
        return inst["name"]
    except Exception as e:
        log.warning("[Proxies] no se pudo asignar proxy a %s: %s", inst["name"], e)
        return None


def start_health_worker(db_factory, alert_emails: list[str]) -> None:
    def _loop():
        db = db_factory().db
        while True:
            try:
                if _claim(db, "last_health_at", HEALTH_EVERY):
                    health_round(db, alert_emails)
                if _claim(db, "last_migrate_at", MIGRATE_EVERY):
                    migrate_one(db)
            except Exception:
                log.exception("[Proxies] la revisión periódica falló")
            time.sleep(300)
    threading.Thread(target=_loop, daemon=True, name="proxy-health").start()
