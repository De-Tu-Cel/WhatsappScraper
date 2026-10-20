"""Proxies por número de WhatsApp (wwebjs): pool en Mongo y asignación estable por número.

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
import ipaddress
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from urllib.parse import quote

import requests
from bson import ObjectId

log = logging.getLogger(__name__)

SETTINGS_ID = "proxies"
# migrate_paused: el número que no volvió a conectarse al pasarlo a su proxy (ver migrate_all).
DEFAULT_SETTINGS = {"country": "US", "auto_assign": False, "migrate_paused": None, "failover_paused": None}
CHECK_URL = "https://ipinfo.io/json"
CHECK_FALLBACK_URL = "https://api.ipify.org?format=json"
HEALTH_EVERY = timedelta(minutes=30)
ALERT_AFTER_FAILS = 2       # 1 h sin responder (revisión cada 30 min): correo
FAILOVER_AFTER_FAILS = 4    # 2 h sin responder: con asignación automática, sus números se mueven
# Números que ya existían sin proxy: pasan todos en seguida, uno tras otro (ver migrate_all).
MIGRATE_READY_TIMEOUT = 180  # segundos que se espera a que cada uno vuelva a conectarse
MIGRATE_POLL = 5

# "user:pass@host:port" (con o sin esquema) y "host:port:user:pass". Los separadores pueden
# ser ":" o espacios/saltos de línea, para aceptar también la tabla copiada del panel de
# Webshare (IP, puerto, usuario y contraseña en renglones seguidos).
_URL_FORM = re.compile(
    r"(?:(?:https?|socks5?)://)?(?P<user>[^\s:@/]+):(?P<pwd>[^\s@]+)@(?P<host>[A-Za-z0-9.-]+):(?P<port>\d{2,5})\b")
_PLAIN_FORM = re.compile(
    r"(?<![\d.])(?P<host>\d{1,3}(?:\.\d{1,3}){3})[\s:]+(?P<port>\d{2,5})[\s:]+(?P<user>[^\s:@]+)[\s:]+(?P<pwd>[^\s:@]+)")


def parse_proxy_text(text: str) -> list[dict]:
    """Proxies que vienen en un texto pegado, sin repetidos (host + puerto)."""
    if re.search(r'\b(?:https|socks\d*)://', text or '', re.I):
        raise ValueError('Solo se admiten proxies HTTP; HTTPS y SOCKS no están implementados.')
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
    url = proxy_url(p)
    for endpoint in (CHECK_URL, CHECK_FALLBACK_URL):
        try:
            r = requests.get(endpoint, proxies={"http": url, "https": url}, timeout=timeout)
            r.raise_for_status()
            j = r.json()
            ip = str(ipaddress.ip_address(j.get("ip", "")))
            metadata = j if endpoint == CHECK_URL else (p if p.get('exit_ip') == ip else {})
            return {"ok": True, "ip": ip, "country": metadata.get("country"), "city": metadata.get("city"),
                    "region": metadata.get("region"), "org": metadata.get("org"), "error": None,
                    "check_source": endpoint, "geo_verified": endpoint == CHECK_URL}
        except Exception:
            continue
    return {"ok": False, "error": "El proxy no pudo completar ninguna de las dos comprobaciones de salida."}


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
        "proxy_required": proxy is not None,
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
        if clean["auto_assign"]:
            clean["migrate_paused"] = None  # volver a prenderla reanuda los que faltan
            clean["failover_paused"] = None
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
        "exit_ip_changed_at": p.get("exit_ip_changed_at"), "exit_ip_change_count": p.get("exit_ip_change_count", 0),
        "fail_streak": p.get("fail_streak", 0), "instances": (usage or {}).get(pid, []),
    }


def record_check(db, proxy: dict, res: dict) -> dict:
    now = datetime.utcnow()
    if res["ok"]:
        upd = {"$set": {"status": "ok", "exit_ip": res["ip"], "country": res["country"], "city": res["city"],
                        "region": res.get("region"), "org": res.get("org"), "last_error": None,
                        "fail_streak": 0, "last_checked_at": now}}
        upd['$set']['geo_verified'] = bool(res.get('geo_verified'))
        previous = proxy.get('exit_ip')
        if previous and previous != res['ip']:
            upd['$set'].update(previous_exit_ip=previous, exit_ip_changed_at=now)
            upd['$inc'] = {'exit_ip_change_count': 1}
            upd['$push'] = {'exit_ip_history': {'$each': [{'from': previous, 'to': res['ip'], 'at': now}], '$slice': -30}}
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


def _push_payload(name: str, body: dict) -> dict:
    from app import whatsapp_wwebjs as ww
    r = requests.put(f"{ww.WWEBJS_URL}/session/{name}/settings", json=body, headers=ww._headers(), timeout=45)
    r.raise_for_status()
    result = r.json()
    if result.get('success') is not True or result.get('stored') is not True or result.get('proxy_required') != body['proxy_required']:
        raise RuntimeError('El servicio no confirmó la configuración del proxy.')
    return result


def _sync_fields(result: dict, proxy_id) -> dict:
    state = 'applied' if result.get('applied') else ('pending_restart' if result.get('pending_restart') else 'stored')
    fields = {'proxy_sync_status': state, 'proxy_synced_at': datetime.utcnow()}
    if result.get('applied'):
        fields['proxy_applied_id'] = proxy_id
    return fields


def _claim_proxy_change(db, inst):
    token, now = uuid.uuid4().hex, datetime.utcnow()
    owner = {'_id': inst['_id'], 'proxy_change_token': token}
    claimed = db.instances.find_one_and_update({'_id': inst['_id'], 'proxy_id': inst.get('proxy_id'), '$or': [
        {'proxy_change_token': {'$exists': False}}, {'proxy_change_until': {'$lt': now}},
    ]}, {'$set': {'proxy_change_token': token, 'proxy_change_until': now + timedelta(minutes=2)}})
    if not claimed:
        raise RuntimeError('Ya hay un cambio de proxy en curso o la asignacion cambio; vuelve a intentarlo.')
    return owner


def push_instance_settings(db, name: str, restart: bool = False) -> dict:
    """Persist desired settings; synchronization never restarts an active browser."""
    inst = db.instances.find_one({'name': name}) or {}
    if not inst:
        raise LookupError('No existe la instancia')
    owner = _claim_proxy_change(db, inst)
    try:
        proxy = _proxy_doc(db, inst.get('proxy_id'))
        if inst.get('proxy_id') and not proxy:
            raise RuntimeError('Falta el proxy asignado; no se iniciara sin el.')
        result = _push_payload(name, launch_payload(proxy, inst.get('lean_mode', False), restart))
        db.instances.update_one(owner, {'$set': _sync_fields(result, inst.get('proxy_id'))})
        return result
    except Exception:
        db.instances.update_one(owner, {'$set': {'proxy_sync_status': 'unknown'}})
        raise
    finally:
        db.instances.update_one(owner, {'$unset': {'proxy_change_token': '', 'proxy_change_until': ''}})


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
        candidate = _proxy_doc(db, proxy_id)
        if not candidate:
            raise LookupError("Ese proxy no existe")
        if candidate.get('enabled') is False or candidate.get('status') != 'ok':
            raise ValueError('Comprueba que el proxy esté habilitado y funcionando antes de aplicarlo.')
        new_id = proxy_id
    else:
        new_id = None
    owner = _claim_proxy_change(db, inst)
    now = datetime.utcnow()
    try:
        result = {'proxy_id': new_id}
        fields = {'proxy_id': new_id, 'proxy_assigned_at': now, 'proxy_sync_status': 'pending_sync'}
        if push:
            proxy = _proxy_doc(db, new_id) if new_id else None
            if new_id and not proxy:
                raise RuntimeError('El proxy seleccionado dejó de estar disponible.')
            if proxy and (proxy.get('enabled') is False or proxy.get('status') != 'ok'):
                raise ValueError('El proxy ya no está disponible; la sesión actual se conserva.')
            result['wwebjs'] = _push_payload(name, launch_payload(proxy, inst.get('lean_mode', False)))
            fields.update(_sync_fields(result['wwebjs'], new_id))
        db.instances.update_one(owner, {'$set': fields})
        return result
    except Exception:
        # A lost response cannot prove the service kept the old configuration.
        db.instances.update_one(owner, {'$set': {'proxy_sync_status': 'unknown', 'proxy_requested_id': new_id}})
        raise
    finally:
        db.instances.update_one(owner, {'$unset': {'proxy_change_token': '', 'proxy_change_until': ''}})


def set_lean(db, name: str, enabled: bool, push: bool = True) -> dict:
    res = db.instances.update_one({"name": name, "provider": "wwebjs"}, {"$set": {"lean_mode": bool(enabled)}})
    if not res.matched_count:
        raise LookupError(f"No existe la instancia {name}")
    return {"lean": bool(enabled), **({"wwebjs": push_instance_settings(db, name, restart=True)} if push else {})}


def prepare_new_instance(db, name: str) -> dict:
    """Al crear un número: si está activada la asignación automática, le toca un proxy ANTES
    de que su Chrome arranque por primera vez. Regresa los campos para el documento nuevo."""
    if not get_settings(db)["auto_assign"]:
        return {}
    chosen = pick_proxy(db)
    if not chosen:
        raise RuntimeError('No hay proxy disponible; la sesión no se iniciará sin el proxy requerido.')
    result = _push_payload(name, launch_payload(chosen, False, restart=False))
    return {"proxy_id": str(chosen["_id"]), "proxy_assigned_at": datetime.utcnow(),
            **_sync_fields(result, str(chosen['_id']))}


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
    """Sincroniza sin reiniciar: los cambios de una sesión activa quedan pendientes."""
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
    settings = get_settings(db)
    auto = settings["auto_assign"] and not settings.get('failover_paused')
    failover_attempted = False
    for p in check_many(db, proxies):
        names = usage.get(str(p["_id"]), [])
        if p.get("status") != "failing" or not names:
            continue
        label = f"{p['host']}:{p['port']}"
        streak = p.get("fail_streak", 0)
        moved = {}
        failover_failed = False
        if auto and streak >= FAILOVER_AFTER_FAILS and not failover_attempted:
            for name in names:
                try:
                    # A failed IP-check service is not proof that a working WA
                    # connection needs to be interrupted. Uncertain status is
                    # also insufficient authorization for an automatic restart.
                    if _live_status(name) not in {'disconnected', 'error', 'not_found'}:
                        continue
                    failover_attempted = True
                    new_id = assign(db, name, "auto")["proxy_id"]
                    np = _proxy_doc(db, new_id)
                    status = _wait_connected(name)
                    if status == 'connected':
                        moved[name] = f"{np['host']}:{np['port']}" if np else "?"
                    else:
                        failover_failed = True
                        db.settings.update_one({'_id': SETTINGS_ID}, {'$set': {'failover_paused': {
                            'name': name, 'status': status, 'at': datetime.utcnow(),
                        }}})
                        log.warning('[Proxies] failover not confirmed for %s; stopping this round', name)
                except Exception as e:
                    failover_failed = True
                    db.settings.update_one({'_id': SETTINGS_ID}, {'$set': {'failover_paused': {
                        'name': name, 'status': 'unconfirmed', 'at': datetime.utcnow(),
                    }}})
                    log.warning("[Proxies] no se pudo confirmar el cambio de %s", name)
                if failover_attempted:
                    break
        if streak == ALERT_AFTER_FAILS or moved or failover_failed:
            from app.email_service import send_proxy_failing_email
            for to in alert_emails:
                send_proxy_failing_email(to, label, names, p.get("last_error") or "", moved_to=moved or None)
            log.warning("[Proxies] %s sin respuesta %d veces — números: %s — movidos: %s", label, streak, names, moved)


def _live_status(name: str):
    from app.whatsapp_wwebjs import get_status
    try:
        return get_status(name).get('status')
    except Exception:
        return None


def _wait_connected(name: str, timeout: int = MIGRATE_READY_TIMEOUT) -> str:
    """Espera a que la sesión vuelva a quedar conectada después de reiniciarse por su proxy.
    Regresa "connected", "need_scan" (WhatsApp pidió volver a escanear) o el último estado visto."""
    from app import whatsapp_wwebjs as ww
    deadline = time.time() + timeout
    status = "sin respuesta"
    while time.time() < deadline:
        time.sleep(MIGRATE_POLL)
        try:
            status = ww.get_status(name).get("status") or status
        except Exception as e:
            status = f"error: {e}"
        if status in ("connected", "need_scan"):
            break
    return status


def migrate_all(db, alert_emails: list[str] | None = None, wait=_wait_connected) -> dict:
    """Asignación automática para los números que ya existían sin proxy: todos en seguida, pero
    uno tras otro — cada uno espera a que el anterior vuelva a conectarse por su proxy (con su
    login guardado, sin QR: marco-wa, 2026-10-06). Si alguno no regresa, se pausa ahí para no
    tirar a los demás y llega un correo; volver a prender la asignación automática lo reanuda.
    Antes era uno cada 6 h; el usuario lo pidió al instante (2026-10-06)."""
    settings = get_settings(db)
    if not settings["auto_assign"] or settings.get("migrate_paused"):
        return {"moved": [], "stopped": None}
    if not _claim(db, "migrating_since", timedelta(minutes=30)):  # ya hay una corriendo
        return {"moved": [], "stopped": None, "busy": True}
    moved, stopped = [], None
    try:
        pending = list(db.instances.find({"provider": "wwebjs", "status": "connected",
                                          "proxy_id": {"$in": [None, ""]}}, {"name": 1}, sort=[("name", 1)]))
        for inst in pending:
            name = inst["name"]
            try:
                assign(db, name, "auto")
                status = wait(name)
            except Exception as e:
                status = f"error: {e}"
            if status != "connected":
                stopped = {"name": name, "status": status, "at": datetime.utcnow()}
                break
            moved.append(name)
            log.info("[Proxies] %s pasó a salir por su proxy y volvió a conectarse", name)
    finally:
        db.settings.update_one({"_id": SETTINGS_ID}, {"$unset": {"migrating_since": ""}})
    if stopped:
        db.settings.update_one({"_id": SETTINGS_ID}, {"$set": {"migrate_paused": stopped}})
        log.warning("[Proxies] %s no volvió a conectarse por su proxy (%s): asignación automática en pausa",
                    stopped["name"], stopped["status"])
        try:
            from app.email_service import send_proxy_failing_email
            for to in alert_emails or []:
                send_proxy_failing_email(
                    to, "asignación automática", [stopped["name"]],
                    f"{stopped['name']} no volvió a conectarse después de pasarla a su proxy ({stopped['status']}). "
                    "Se pausó la asignación de los demás números: revisa si pide QR y vuelve a prender la "
                    "asignación automática para seguir.")
        except Exception:
            log.exception("[Proxies] no se pudo mandar el aviso de la pausa")
    return {"moved": moved, "stopped": stopped}


def start_migration(db_factory, alert_emails: list[str] | None = None) -> None:
    """Al prender la asignación automática: pasa en seguida los números que ya existían."""
    threading.Thread(target=lambda: migrate_all(db_factory().db, alert_emails), daemon=True,
                     name="proxy-migrate").start()


def start_health_worker(db_factory, alert_emails: list[str]) -> None:
    def _loop():
        db = db_factory().db
        while True:
            try:
                if _claim(db, "last_health_at", HEALTH_EVERY):
                    health_round(db, alert_emails)
                # Cada 5 min: algún número que volvió a conectarse sin proxy, o uno nuevo.
                migrate_all(db, alert_emails)
            except Exception:
                log.exception("[Proxies] la revisión periódica falló")
            time.sleep(300)
    threading.Thread(target=_loop, daemon=True, name="proxy-health").start()
