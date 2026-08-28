from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Header, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import Optional
import asyncio, json as _json, re, os, logging
_log = logging.getLogger(__name__)
from app.schemas.company import (
    ProcessUrlRequest, SearchRequest, BatchRequest,
    CheckUrlsRequest, DeleteCompaniesRequest, UpdateCompanyRequest, CreateCompanyRequest,
    N8nMessageSentRequest, N8nMessageReceivedRequest,
    EvolutionWebhookRequest, SendMessageRequest, ReportRequest,
    UpdateContactsRequest,
)
from app.utils import serialize
from app.pipeline import process_url, run_pipeline_batch, _check_blacklist   # ← app.pipeline
from app.searcher import search_prospects, pages_per_query_for  # ← app.searcher
from app.database import MongoDBManager
from app.daily_cap import DAILY_CAP, WARMUP_CAP, get_daily_count, increment_daily_count, get_scheduled_count_today, get_instance_cap, get_capacity_for_date
from app.phone_utils import clean_digits

router = APIRouter()

# ── Auth helpers ──────────────────────────────────────────────────────────────

def _require_user(x_user_token: Optional[str] = Header(None)):
    from app.auth import get_user_by_token
    user = get_user_by_token(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")
    return user

# ── Auth endpoints ────────────────────────────────────────────────────────────

@router.post("/auth/register")
def api_register(body: dict):
    try:
        from app.auth import create_user, list_users, ADMIN_EMAILS
        existing = list_users()
        email = body.get("email", "").strip().lower()
        role = "admin" if (not existing or email in ADMIN_EMAILS) else "agent"
        user = create_user(
            username     = body.get("username", ""),
            display_name = body.get("display_name", body.get("username", "")),
            pin          = body.get("pin", ""),
            email        = email,
            role         = role,
        )
        return user
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth/login")
def api_login(body: dict):
    from app.auth import login
    user = login(body.get("username", ""), body.get("pin", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario o PIN incorrecto")
    return user

@router.get("/auth/me")
def api_me(x_user_token: Optional[str] = Header(None)):
    from app.auth import get_user_by_token
    user = get_user_by_token(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado")
    return user

@router.post("/auth/logout")
def api_logout(x_user_token: Optional[str] = Header(None)):
    from app.auth import logout
    if x_user_token:
        logout(x_user_token)
    return {"ok": True}

@router.get("/auth/users")
def api_list_users(x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo admins")
    from app.auth import list_users
    return list_users()

@router.get("/auth/recovery-code")
def api_get_recovery_code(x_user_token: Optional[str] = Header(None)):
    """Returns the recovery code for the authenticated user."""
    from app.auth import get_user_by_token
    user = get_user_by_token(x_user_token)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado")
    from app.database import MongoDBManager
    from bson import ObjectId
    db = MongoDBManager()
    doc = db.db.users.find_one({"_id": ObjectId(user["id"])}, {"recovery_code": 1})
    return {"recovery_code": doc.get("recovery_code", "") if doc else ""}

@router.post("/auth/recover")
def api_recover_pin(body: dict):
    from app.auth import recover_pin
    ok = recover_pin(
        body.get("username", ""),
        body.get("recovery_code", ""),
        body.get("new_pin", ""),
    )
    if not ok:
        raise HTTPException(status_code=400, detail="Código de recuperación incorrecto")
    return {"ok": True}

@router.post("/auth/forgot-pin")
def api_forgot_pin(body: dict):
    from app.auth import request_pin_reset
    request_pin_reset(body.get("email", ""))
    return {"ok": True}  # always succeed — no email enumeration

@router.post("/auth/reset-pin")
def api_reset_pin(body: dict):
    from app.auth import confirm_pin_reset
    new_pin = body.get("new_pin", "")
    if len(new_pin) < 4:
        raise HTTPException(status_code=400, detail="PIN mínimo 4 dígitos")
    ok = confirm_pin_reset(body.get("token", ""), new_pin)
    if not ok:
        raise HTTPException(status_code=400, detail="Código inválido o expirado")
    return {"ok": True}

@router.post("/auth/admin/reset-pin")
def api_admin_reset_pin(body: dict, x_user_token: Optional[str] = Header(None)):
    admin = _require_user(x_user_token)
    if admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo admins")
    from app.auth import hash_pin
    from bson import ObjectId
    db = MongoDBManager()
    new_pin = body.get("new_pin", "")
    if len(new_pin) < 4:
        raise HTTPException(status_code=400, detail="PIN mínimo 4 dígitos")
    db.db.users.update_one(
        {"_id": ObjectId(body.get("user_id", ""))},
        {"$set": {"pin_hash": hash_pin(new_pin), "session_token": None}}
    )
    return {"ok": True}

@router.post("/auth/admin/role")
def api_admin_change_role(body: dict, x_user_token: Optional[str] = Header(None)):
    admin = _require_user(x_user_token)
    if admin.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Solo admins")
    if body.get("user_id") == admin.get("id"):
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol")
    from bson import ObjectId
    db = MongoDBManager()
    db.db.users.update_one(
        {"_id": ObjectId(body.get("user_id", ""))},
        {"$set": {"role": body.get("role", "agent")}}
    )
    return {"ok": True}

@router.patch("/auth/evolution")
def api_update_evolution(body: dict, x_user_token: Optional[str] = Header(None)):
    from app.auth import update_evolution
    _require_user(x_user_token)
    update_evolution(x_user_token, body.get("instance", ""), body.get("number", ""))
    return {"ok": True}

@router.post("/process-url")
def api_process_url(req: ProcessUrlRequest, x_user_token: Optional[str] = Header(None)):
    try:
        return serialize(process_url(
            req.url, message_template=req.message_template, skip_send=req.skip_send,
            user_token=x_user_token, country=req.country, force=req.force,
        ))
    except Exception as e:
        import traceback
        print(f"[process-url] {req.url} → {type(e).__name__}: {e}")
        traceback.print_exc()
        msg = str(e)
        status = 422 if any(k in msg.lower() for k in ("no response", "http error", "timeout", "connection", "name or service")) else 500
        raise HTTPException(status_code=status, detail=msg)

# ── Scrape jobs (backend-persisted bulk scraping — survives a page refresh) ──
# Used by searchProspects.jsx / batchProcessor.jsx / csvImporter.jsx instead of
# each looping /process-url calls in the browser. See app/scrape_jobs.py.

@router.post("/scrape-jobs")
def api_create_scrape_job(body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    try:
        from app.scrape_jobs import create_scrape_job
        surface = body.get("surface", "search")
        urls = [u for u in (body.get("urls") or []) if isinstance(u, str) and u.strip()]
        if not urls:
            raise HTTPException(status_code=400, detail="Sin URLs para procesar")
        db = MongoDBManager()
        doc = create_scrape_job(db, surface, urls, user)
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/scrape-jobs/{job_id}")
def api_get_scrape_job(job_id: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    try:
        from bson import ObjectId
        db = MongoDBManager()
        doc = db.db.scrape_jobs.find_one({"_id": ObjectId(job_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Job no encontrado")
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/scrape-jobs/{job_id}")
def api_update_scrape_job(job_id: str, body: dict, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    try:
        from app.scrape_jobs import set_job_action
        action = body.get("action", "")
        if action not in ("pause", "resume", "cancel"):
            raise HTTPException(status_code=400, detail="action debe ser pause, resume o cancel")
        db = MongoDBManager()
        doc = set_job_action(db, job_id, action)
        if not doc:
            raise HTTPException(status_code=404, detail="Job no encontrado")
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/send-message")
def api_send_message(req: SendMessageRequest, x_user_token: Optional[str] = Header(None)):
    try:
        from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE, WAHA_API_KEY, WASENDER_PAT, WASENDER_BASE_URL
        from app.whatsapp_evolution import EvolutionClient
        from app.auth import get_user_by_token
        from app.database import MongoDBManager
        db = MongoDBManager()
        if not EVOLUTION_API_KEY and not WAHA_API_KEY and not WASENDER_PAT:
            raise HTTPException(status_code=400, detail="Sin proveedor de WhatsApp configurado")
        if not (req.message or "").strip() and not req.image_url and not req.document_url:
            raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

        # ── Bloqueo por blacklist / chat bloqueado ──────────────────────────────────
        from bson import ObjectId
        if req.company_id and len(req.company_id) == 24:
            company = db.db.companies.find_one(
                {"_id": ObjectId(req.company_id)},
                {"domain": 1, "industry": 1, "blocked": 1},
            )
            if company:
                if company.get("blocked"):
                    raise HTTPException(status_code=403, detail="No se puede enviar: este chat está bloqueado")
                domain = company.get("domain") or ""
                industry = company.get("industry") or ""
                bl = _check_blacklist(domain, industry) if domain else None
                if bl:
                    raise HTTPException(
                        status_code=403,
                        detail=f"No se puede enviar: dominio en lista negra ({bl['matched']})",
                    )

        # ── Rotación de instancias: round-robin + routing preferencial por compañía ──
        import requests as _req
        from concurrent.futures import ThreadPoolExecutor
        from bson import ObjectId

        instance = EVOLUTION_INSTANCE
        _all_disconnected = False

        # If caller provides an explicit instance (e.g. conversation reply), use it directly
        if req.instance:
            instance = req.instance
            _log.info("[SendMsg] instance=explicit:%s", instance)
        elif x_user_token:
            user = get_user_by_token(x_user_token)
            if user:
                user_id = user.get("id") or str(user.get("_id", ""))
                all_assigned = list(db.db.instances.find(
                    {"assigned_to": user_id}, {"_id": 0, "name": 1, "number": 1, "provider": 1}
                )) if user_id else []
                # Only route through instances that have a number registered
                assigned = [i for i in all_assigned if i.get("number")]
                _log.debug("[Rotation] user_id=%r all=%s with_number=%s", user_id, [i['name'] for i in all_assigned], [i['name'] for i in assigned])
                if all_assigned and not assigned:
                    raise HTTPException(
                        status_code=503,
                        detail="Ninguna de tus instancias tiene número asignado. Ve a Instancias y edita el número.",
                    )

                if assigned:
                    names = [i["name"] for i in assigned]
                    _inst_providers = {i["name"]: i.get("provider", "evolution") for i in assigned}
                    from app.config import WAHA_API_URL, WAHA_API_KEY

                    def _check_state(name):
                        try:
                            prov = _inst_providers.get(name, "evolution")
                            if prov == "waha":
                                r = _req.get(f"{WAHA_API_URL}/api/sessions/{name}",
                                    headers={"X-Api-Key": WAHA_API_KEY}, timeout=2)
                                st = r.json().get("status", "") if r.ok else ""
                                return name if st == "WORKING" else None
                            elif prov == "wasender":
                                _inst_ws = db.db.instances.find_one({"name": name}, {"wasender_id": 1})
                                _wid = (_inst_ws or {}).get("wasender_id")
                                if not _wid:
                                    return None
                                r = _req.get(
                                    f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{_wid}",
                                    headers={"Authorization": f"Bearer {WASENDER_PAT}"},
                                    timeout=3,
                                )
                                _st = ((r.json().get("data") or {}) if r.ok else {}).get("status", "")
                                return name if _st == "connected" else None
                            elif prov == "wwebjs":
                                from app.config import WWEBJS_URL as _WW_URL
                                r = _req.get(f"{_WW_URL}/session/{name}/status", timeout=2)
                                st = r.json().get("status", "") if r.ok else ""
                                return name if st == "connected" else None
                            else:
                                r = _req.get(
                                    f"{EVOLUTION_API_URL}/instance/connectionState/{name}",
                                    headers={"apikey": EVOLUTION_API_KEY}, timeout=2,
                                )
                                state = (r.json().get("instance") or {}).get("state") or r.json().get("state", "")
                                return name if state == "open" else None
                        except Exception:
                            return None

                    with ThreadPoolExecutor(max_workers=len(names)) as ex:
                        connected = sorted([n for n in ex.map(_check_state, names) if n])

                    if connected:
                        # Routing preferencial: usar instancia asignada a esta compañía si sigue conectada
                        preferred = None
                        if req.company_id:
                            co = db.db.companies.find_one(
                                {"_id": ObjectId(req.company_id)},
                                {"assigned_instance": 1}
                            ) if len(req.company_id) == 24 else None
                            if co and co.get("assigned_instance") in connected:
                                preferred = co["assigned_instance"]

                        # If preferred exists but is at its daily cap OR NC limit, drop it
                        # so the NC-aware picker below can find a better instance.
                        # _nc_cap_fallback=True means preferred was set but temporarily saturated —
                        # the fallback instance must NOT overwrite assigned_instance permanently.
                        _nc_cap_fallback = False
                        if preferred and req.company_id:
                            from app.daily_cap import check_new_contact_cap as _check_nc_pref
                            _daily_ok_p = get_daily_count(db, preferred) < get_instance_cap(db, preferred)
                            _nc_ok_p, _, _ = _check_nc_pref(db, preferred, req.company_id)
                            if not _daily_ok_p or not _nc_ok_p:
                                _log.info("[SendMsg] preferred=%s at %s limit — falling back to nc-aware pick (no reassign)",
                                          preferred, "daily" if not _daily_ok_p else "NC")
                                preferred = None
                                _nc_cap_fallback = True

                        if preferred:
                            instance = preferred
                            _log.info("[SendMsg] instance=preferred:%s company=%s", instance, req.company_id)
                        else:
                            # For new contacts: pick the instance with most NC capacity left so the
                            # warmup/NC cap is shared evenly. For existing contacts: round-robin.
                            from app.daily_cap import is_new_contact as _is_new
                            if req.company_id and _is_new(db, req.company_id):
                                from app.scheduler import _nc_aware_pick as _ncp
                                instance = _ncp(db, connected, req.company_id) or connected[0]
                                _log.info("[SendMsg] instance=nc-aware:%s company=%s", instance, req.company_id)
                            else:
                                # Round-robin: incrementa contador atómico por usuario
                                result = db.db.users.find_one_and_update(
                                    {"_id": ObjectId(user_id)},
                                    {"$inc": {"rr_index": 1}},
                                    return_document=True,
                                    projection={"rr_index": 1},
                                )
                                idx = (result.get("rr_index", 0)) % len(connected)
                                instance = connected[idx]
                                _log.info("[SendMsg] instance=round-robin:%s idx=%d/%d company=%s", instance, idx, len(connected), req.company_id)
                            # Guardar asignación permanente solo cuando NO es fallback temporal por NC cap.
                            # Si es fallback, la empresa ya tiene assigned_instance válido — no sobreescribir.
                            if not _nc_cap_fallback and req.company_id and len(req.company_id) == 24:
                                try:
                                    db.db.companies.update_one(
                                        {"_id": ObjectId(req.company_id)},
                                        {"$set": {"assigned_instance": instance}},
                                    )
                                except Exception:
                                    pass
                    else:
                        _all_disconnected = True
                elif user.get("evolution_instance"):
                    instance = user["evolution_instance"]

        if _all_disconnected:
            raise HTTPException(
                status_code=503,
                detail=f"Ninguna de tus instancias está conectada. Ve a Instancias para reconectar.",
            )
        if not instance:
            raise HTTPException(status_code=400, detail="Sin instancia de WhatsApp configurada")

        # Determine provider for the selected instance
        from datetime import datetime as _dt
        _inst_doc_send = db.db.instances.find_one({"name": instance}, {"number": 1, "provider": 1}) or {}
        _inst_provider_send = _inst_doc_send.get("provider", "evolution")
        _inst_number = _inst_doc_send.get("number") or "?"

        # Daily send cap — block early before any API call
        if get_daily_count(db, instance) >= get_instance_cap(db, instance):
            raise HTTPException(
                status_code=429,
                detail=f"Límite diario alcanzado ({DAILY_CAP} mensajes). Reinicia a las 00:00 hora local.",
            )

        # Per-instance new-contact warmup cap (5 for warmup, 12 for normal)
        from app.daily_cap import check_new_contact_cap
        _nc_ok, _nc_count, _nc_limit = check_new_contact_cap(db, instance, req.company_id)
        if not _nc_ok:
            raise HTTPException(
                status_code=429,
                detail=f"new_contact_limit:{_nc_limit}",
            )

        if _inst_provider_send == "waha":
            from app.whatsapp_waha import WAHAClient, _clean_digits as _waha_clean
            from app.config import WAHA_API_URL, WAHA_API_KEY
            _waha = WAHAClient(WAHA_API_URL, WAHA_API_KEY, instance)
            real_jid_num = _waha.get_jid(req.to_number)
            _phone_digits = _waha_clean(req.to_number)
            # Always store phone digits — inbound webhook delivers @c.us format, not @lid.
            # Without this, if get_jid returned a @lid the reply would map to "unknown".
            db.db.jid_map.update_one({"jid": _phone_digits},
                {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)
            if real_jid_num and real_jid_num != _phone_digits:
                db.db.jid_map.update_one({"jid": real_jid_num},
                    {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)
            _log.debug("[SendMsg/WAHA] jid_learned phone=%s lid=%s company=%s", _phone_digits, real_jid_num or '-', req.company_id)
            # Always send to phone-number format; LID stored in jid_map for inbound routing only.
            # Sending to a LID-numeric chatId causes "No LID for user" in WEBJS.
            send_to = _phone_digits
            # Save as contact before sending — reduces spam signals significantly
            try:
                from bson import ObjectId as _OId
                _co = db.db.companies.find_one({"_id": _OId(req.company_id)}, {"name": 1}) if req.company_id and len(req.company_id) == 24 else None
                _co_name = (_co or {}).get("name", "")
                if _co_name:
                    _waha.label_contact(_phone_digits, _co_name)
            except Exception:
                pass
            import random as _rnd
            _typing_ms = _rnd.randint(800, 1800)
            send_result = _waha.send_text(send_to, req.message, delay_ms=_typing_ms)
            resp_json = send_result.get("response_json", {})
            message_id = resp_json.get("id") or resp_json.get("key", {}).get("id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"
            _platform = "waha"
            # 463 Reachout Timelock: session stays WORKING, do NOT restart.
            # Flag the instance in DB so the dashboard can show the warning.
            if send_result.get("reachout_timelock"):
                db.db.instances.update_one(
                    {"name": instance},
                    {"$set": {"reachout_timelock": True, "reachout_timelock_at": _dt.now()}},
                )
                status = "timelock"
        elif _inst_provider_send == "wwebjs":
            from app.whatsapp_wwebjs import WWebjsClient, send_media as _ww_send_media
            import random as _rnd3
            ww_client = WWebjsClient(session_id=instance, instance_name=instance)
            _typing_ms = _rnd3.randint(800, 1800)
            _phone_digits_ww = "".join(filter(str.isdigit, req.to_number))
            try:
                from bson import ObjectId as _OId_ww
                _co_ww = db.db.companies.find_one({"_id": _OId_ww(req.company_id)}, {"name": 1}) if req.company_id and len(req.company_id) == 24 else None
                _co_name_ww = (_co_ww or {}).get("name", "")
            except Exception:
                _co_name_ww = ""
            if req.image_url:
                _ww_result = _ww_send_media(instance, req.to_number, req.image_url,
                                            caption=req.message or "", typing_ms=_typing_ms)
                _msg_type = "image"
            elif req.document_url:
                _ww_result = _ww_send_media(instance, req.to_number, req.document_url,
                                            caption=req.message or "", filename=req.file_name or "",
                                            typing_ms=_typing_ms)
                _msg_type = "document"
            else:
                _ww_result = ww_client.send(req.to_number, req.message, delay_ms=_typing_ms,
                                            save_contact=bool(_co_name_ww), contact_name=_co_name_ww)
                _msg_type = "text"
            db.db.jid_map.update_one({"jid": _phone_digits_ww},
                {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)
            message_id = _ww_result.get("messageId")
            status = "sent" if _ww_result.get("success") else "failed"
            send_to = _phone_digits_ww
            send_result = {"status_code": 200 if status == "sent" else 400}
            resp_json = _ww_result
            _platform = "wwebjs"
        elif _inst_provider_send == "wasender":
            from app.whatsapp_wasender import WasenderClient, _clean_digits as _ws_clean
            _inst_doc_ws = db.db.instances.find_one({"name": instance}, {"wasender_api_key": 1, "number": 1}) or {}
            _ws_api_key = _inst_doc_ws.get("wasender_api_key", "")
            ws_client = WasenderClient(WASENDER_BASE_URL, _ws_api_key, instance,
                                       own_number=_inst_doc_ws.get("number", ""))
            _phone_digits = _ws_clean(req.to_number)
            db.db.jid_map.update_one({"jid": _phone_digits},
                {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)
            try:
                from bson import ObjectId as _OId
                _co = db.db.companies.find_one({"_id": _OId(req.company_id)}, {"name": 1}) if req.company_id and len(req.company_id) == 24 else None
                _co_name = (_co or {}).get("name", "") or _phone_digits
                ws_client.label_contact(_phone_digits, _co_name)
            except Exception:
                pass
            import random as _rnd2
            send_to = req.to_number
            if req.image_url:
                send_result = ws_client.send_image(req.to_number, req.image_url, caption=req.message or "")
                _msg_type = "image"
            elif req.document_url:
                send_result = ws_client.send_document(
                    req.to_number, req.document_url,
                    caption=req.message or "", file_name=req.file_name or "",
                )
                _msg_type = "document"
            else:
                _typing_ms = _rnd2.randint(800, 1800)
                send_result = ws_client.send_text(req.to_number, req.message, delay_ms=_typing_ms)
                _msg_type = "text"
            resp_json = send_result.get("response_json", {})
            message_id = (resp_json.get("data") or {}).get("message_id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"
            _platform = "wasender"
        else:
            evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, instance)
            # Resolve the real WhatsApp JID before sending so the mapping is ready
            # when the bot replies instantly.
            real_jid_num = evo.get_jid(req.to_number)
            if real_jid_num:
                db.db.jid_map.update_one({"jid": real_jid_num},
                    {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)
                _log.debug("[SendMsg] jid_learned=%s company=%s", real_jid_num, req.company_id)
            send_to = real_jid_num if real_jid_num else req.to_number
            send_result = evo.send_text(send_to, req.message)
            resp_json = send_result.get("response_json", {})
            message_id = resp_json.get("key", {}).get("id") or resp_json.get("id")
            status = "sent" if send_result.get("status_code") in (200, 201) else "failed"
            _platform = "evolution"
            # Learn JID from send response as fallback
            if not real_jid_num and status == "sent":
                remote_jid = resp_json.get("key", {}).get("remoteJid", "")
                jid_num = remote_jid.split("@")[0] if remote_jid else ""
                if jid_num:
                    db.db.jid_map.update_one({"jid": jid_num},
                        {"$set": {"company_id": req.company_id, "updated_at": _dt.now()}}, upsert=True)

        _log.info("[SendMsg/%s] from=%s(%s) to=%s status=%s", _platform, instance, _inst_number, send_to, status)

        sender_instance = db.db.instances.find_one({"name": instance}, {"_id": 0, "number": 1})

        _msg_body = req.message or ""
        _media_url = req.image_url or req.document_url or ""
        log_doc = {
            "channel": "whatsapp", "platform": _platform, "direction": "outbound",
            "company_id": req.company_id, "to_number": req.to_number,
            "message_body": _msg_body or _media_url,
            "message_text": _msg_body or _media_url,
            "message_type": locals().get("_msg_type", "text"),
            "media_url": _media_url or None,
            "message_id": message_id,
            "status_code": send_result.get("status_code"),
            "api_response": resp_json, "status": status,
            "sent_at": send_result.get("sent_at"),
            "instance_name": instance,
            "instance_number": (sender_instance or {}).get("number") or "",
        }
        if x_user_token:
            sender = get_user_by_token(x_user_token)
            if sender:
                log_doc["sent_by_username"] = sender.get("username", "")
                log_doc["sent_by_name"]     = sender.get("display_name", "")
        log_id = db.insert_message_log(log_doc)
        if status == "sent":
            increment_daily_count(db, instance, clean_digits(req.to_number))

        return {"ok": True, "status": status, "log_id": log_id, "message_id": message_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Send queue (backend-persisted immediate bulk sending — survives a page
# refresh). Used by SendQueueContext.jsx instead of processing its queue with
# an in-browser loop. See app/send_now_worker.py. ───────────────────────────

@router.post("/send-queue")
def api_enqueue_send(body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    try:
        from app.send_now_worker import enqueue_send_items
        from datetime import datetime
        import uuid as _uuid
        jobs = body.get("jobs") or []
        if not jobs:
            raise HTTPException(status_code=400, detail="Sin destinatarios para encolar")
        batch_id = f"b{int(datetime.now().timestamp()*1000)}{_uuid.uuid4().hex[:6]}"
        db = MongoDBManager()
        count = enqueue_send_items(
            db, jobs, batch_id, body.get("label", ""), body.get("send_config") or {},
            sent_by_username=user.get("username", ""), sent_by_name=user.get("display_name", ""),
        )
        return {"ok": True, "batch_id": batch_id, "queued": count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/send-queue/status")
def api_send_queue_status(x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    try:
        from app.send_now_worker import get_status
        db = MongoDBManager()
        return serialize(get_status(db))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/send-queue/cancel")
def api_send_queue_cancel(x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    try:
        from app.send_now_worker import cancel_pending_send_items
        db = MongoDBManager()
        cancelled = cancel_pending_send_items(db)
        return {"ok": True, "cancelled": cancelled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/instances/daily-stats")
def api_instances_daily_stats(x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    instances = list(db.db.instances.find(
        {"assigned_to": user_id},
        {"_id": 0, "name": 1, "label": 1, "number": 1, "warmup_mode": 1},
    )) if user_id else []

    from app.daily_cap import count_new_contacts_today_for_instance, get_new_contacts_limit

    rows = []
    for inst in instances:
        name    = inst["name"]
        warmup  = bool(inst.get("warmup_mode"))
        sent    = get_daily_count(db, name)
        cap     = WARMUP_CAP if warmup else DAILY_CAP
        nc_today = count_new_contacts_today_for_instance(db, name)
        nc_limit = get_new_contacts_limit(warmup)
        rows.append({
            "instance":           name,
            "label":              inst.get("label") or name,
            "number":             inst.get("number"),
            "sent_today":         sent,
            "cap":                cap,
            "available":          max(0, cap - sent),
            "warmup_mode":        warmup,
            "new_contacts_today": nc_today,
            "new_contacts_limit": nc_limit,
            "new_contacts_left":  max(0, nc_limit - nc_today),
        })

    total_sent            = sum(r["sent_today"] for r in rows)
    scheduled_today       = get_scheduled_count_today(db)
    total_cap             = sum(r["cap"] for r in rows) if rows else 0
    total_available       = max(0, total_cap - total_sent - scheduled_today)
    new_contacts_today    = sum(r["new_contacts_today"] for r in rows)
    new_contacts_capacity = sum(r["new_contacts_left"] for r in rows)

    return {
        "instances":             rows,
        "total_sent":            total_sent,
        "scheduled_today":       scheduled_today,
        "total_cap":             total_cap,
        "total_available":       total_available,
        "cap_per_instance":      DAILY_CAP,
        "reset_hour":            "00:00 local",
        "new_contacts_today":    new_contacts_today,
        "new_contacts_capacity": new_contacts_capacity,
    }


@router.get("/instances/capacity-for-date")
def api_instances_capacity_for_date(date: str = Query(...), exclude_id: Optional[str] = Query(None), x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    try:
        from datetime import datetime
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return get_capacity_for_date(db, user_id, target_date, exclude_id)


@router.post("/instances/{instance_name}/warmup")
def api_toggle_warmup(instance_name: str, body: dict = {}, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    db = MongoDBManager()
    inst = db.db.instances.find_one({"name": instance_name}, {"warmup_mode": 1})
    if not inst:
        raise HTTPException(status_code=404, detail="Instancia no encontrada")
    new_val = not bool(inst.get("warmup_mode"))
    if "enabled" in body:
        new_val = bool(body["enabled"])
    db.db.instances.update_one({"name": instance_name}, {"$set": {"warmup_mode": new_val}})
    return {"instance": instance_name, "warmup_mode": new_val, "cap": WARMUP_CAP if new_val else DAILY_CAP}


@router.post("/search")
def api_search(req: SearchRequest):
    try:
        from urllib.parse import urlparse
        from app.pipeline import _check_blacklist

        db = MongoDBManager()
        known = db.get_all_scraped_domains() | set(req.already_shown_domains or [])
        target = req.num_results or 10
        # Fetch 3× the target so that after filtering out already-known domains
        # we still have enough fresh results. Cap at 90 to limit API spend.
        fetch_count = min(target * 3, 90)
        urls = search_prospects(
            req.industry, req.city or "", req.keywords or "",
            fetch_count, req.offset or 0,
            exclude_domains=known,
            country=req.country,
        )
        # All returned URLs are already "new" (exclude_domains filtered inside
        # search_prospects), so just trim to what the user asked for.
        urls = urls[:target]

        # Flag domain-blacklisted results here (industry isn't known until the
        # site is actually scraped, so only the domain rule can apply pre-scrape)
        # instead of letting the user pick one and have it silently fail later.
        results = []
        for url in urls:
            domain = urlparse(url).netloc.lower().replace("www.", "")
            hit = _check_blacklist(domain, "")
            results.append({
                "url": url,
                "domain": domain,
                "blocked": bool(hit),
                "block_reason": hit["matched"] if hit else None,
            })

        # El frontend usa esto para saber desde dónde continuar la próxima vez
        # que pida "cargar más" (paginación real de Bright Data, ver searcher.py).
        # Use fetch_count (not target) so the offset reflects actual BD pages consumed.
        next_offset = (req.offset or 0) + pages_per_query_for(fetch_count) * 10

        return {"urls": urls, "results": results, "next_offset": next_offset}  # "urls" kept for now, not read by the frontend anymore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/companies/check-contacted")
def api_check_contacted(body: dict):
    """Returns contact history for a list of company_ids or domains."""
    try:
        db = MongoDBManager()
        return db.check_contacted(body.get("company_ids", []))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/companies/check-urls")
def api_check_urls(req: CheckUrlsRequest):
    try:
        db = MongoDBManager()
        return db.check_urls_scraped(req.urls)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/batch")
def api_batch(req: BatchRequest):
    try:
        return serialize(run_pipeline_batch(req.urls))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/companies/meta")
def api_companies_meta():
    try:
        db = MongoDBManager()
        return {
            "industries": db.get_distinct_values("industry"),
            "cities": db.get_distinct_values("city"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/companies")
def api_list_companies(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    search: Optional[str] = None,
    industry: Optional[str] = None,
    city: Optional[str] = None,
    has_whatsapp: Optional[bool] = None,
):
    try:
        db = MongoDBManager()
        result = db.list_companies(
            page=page,
            page_size=page_size,
            search=search or None,
            industry=industry or None,
            city=city or None,
            has_whatsapp=has_whatsapp,
        )
        return serialize(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/companies")
def api_create_company(req: CreateCompanyRequest):
    """Alta manual de una empresa desde la vista de Base de Datos — sin pasar
    por el scraper, para cuando ya se conoce a un prospecto por otro medio."""
    try:
        from urllib.parse import urlparse as _urlparse
        db = MongoDBManager()

        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre es requerido")

        website = (req.website or "").strip()
        domain = ""
        if website:
            if not website.startswith("http"):
                website = f"https://{website}"
            domain = _urlparse(website).netloc.lower().replace("www.", "")

        whatsapp = (req.whatsapp_number or "").strip()
        has_whatsapp = bool(whatsapp)

        company_id = db.insert_company({
            "name": name,
            "industry": (req.industry or "").strip(),
            "city": (req.city or "").strip(),
            "state": (req.state or "").strip(),
            "website": website,
            "domain": domain,
            "description": (req.description or "").strip(),
            "has_whatsapp": has_whatsapp,
            "status": "manual",
        })

        if whatsapp:
            db.insert_contact({
                "company_id": company_id,
                "type": "whatsapp",
                "value": whatsapp,
                "source": "manual",
                "is_primary": True,
            })

        created = db.get_company_full_data(company_id)
        return serialize(created)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/companies")
def api_delete_companies(req: DeleteCompaniesRequest):
    try:
        db = MongoDBManager()
        deleted = db.delete_companies(req.ids)
        return {"deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/companies/{company_id}")
def api_get_company(company_id: str):
    try:
        db = MongoDBManager()
        data = db.get_company_full_data(company_id)
        if not data:
            raise HTTPException(status_code=404, detail="Company not found")
        result = serialize(data)
        contacted_map = db.check_contacted([company_id])
        result["already_contacted"] = contacted_map.get(company_id, {"contacted": False})
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/companies/{company_id}")
def api_update_company(company_id: str, req: UpdateCompanyRequest):
    try:
        db = MongoDBManager()
        fields = {k: v for k, v in req.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        updated = db.update_company_fields(company_id, fields)
        return {"updated": updated}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Conversations ─────────────────────────────────────────────────────────────

@router.post("/conversations/{company_id}/sync")
def api_sync_conversation(company_id: str, background_tasks: BackgroundTasks):
    """Fetch missing messages from Evolution or WAHA and save them to message_logs."""
    try:
        from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE
        from app.config import WAHA_API_KEY, WAHA_API_URL
        from datetime import datetime, timezone
        from bson import ObjectId

        db = MongoDBManager()

        # Detect provider from the company's assigned instance
        _provider = "evolution"
        _waha_session = None
        try:
            if len(company_id) == 24:
                co = db.db.companies.find_one({"_id": ObjectId(company_id)}, {"assigned_instance": 1})
                inst_name = (co or {}).get("assigned_instance")
                if inst_name:
                    inst_doc = db.db.instances.find_one({"name": inst_name}, {"provider": 1})
                    if inst_doc and inst_doc.get("provider") == "waha":
                        _provider = "waha"
                        _waha_session = inst_name
                    elif inst_doc and inst_doc.get("provider") == "wasender":
                        _provider = "wasender"
                    elif inst_doc and inst_doc.get("provider") == "wwebjs":
                        _provider = "wwebjs"
        except Exception:
            pass

        if _provider == "wasender":
            return {"synced": 0, "message": "WasenderAPI no expone historial — los mensajes se registran en tiempo real desde el webhook"}
        elif _provider == "wwebjs":
            return {"synced": 0, "message": "WhatsApp Web no expone historial — los mensajes se registran en tiempo real desde el webhook"}
        elif _provider == "waha":
            if not WAHA_API_KEY:
                raise HTTPException(400, "WAHA no configurado")
            from app.whatsapp_waha import WAHAClient, pick_connected_instance as _waha_pick
            session = _waha_session or _waha_pick(db, WAHA_API_URL, WAHA_API_KEY)
            if not session:
                raise HTTPException(400, "Sin sesión WAHA conectada")
            client = WAHAClient(WAHA_API_URL, WAHA_API_KEY, session)
        else:
            if not EVOLUTION_API_KEY:
                raise HTTPException(400, "Evolution API no configurada")
            from app.config import EVOLUTION_INSTANCE as _EVO_INST_DEFAULT
            _evo_inst = inst_name or _EVO_INST_DEFAULT
            if not _evo_inst:
                raise HTTPException(400, "Sin instancia Evolution configurada para esta empresa")
            from app.whatsapp_evolution import EvolutionClient
            client = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, _evo_inst)

        contacts = list(db.db.contacts.find({"company_id": company_id, "type": "whatsapp"}))
        if not contacts:
            return {"synced": 0, "message": "Sin números WhatsApp registrados"}

        synced = 0
        for contact in contacts:
            number = contact.get("value", "")
            if not number:
                continue

            first_outbound = db.db.message_logs.find_one(
                {"company_id": company_id, "direction": "outbound",
                 "$or": [{"to_number": number}, {"number": number}]},
                sort=[("created_at", 1)]
            )
            cutoff = first_outbound["created_at"] if first_outbound else None

            raw_messages = client.fetch_messages(number, limit=100)

            # For Evolution: also fetch by @lid JID if known
            if _provider == "evolution":
                lid_entry = db.db.jid_map.find_one({"company_id": company_id})
                if lid_entry:
                    lid_jid = f"{lid_entry['jid']}@lid"
                    lid_msgs = client.fetch_messages_by_jid(lid_jid, limit=100)
                    seen_ids = {m.get("key", {}).get("id") for m in raw_messages}
                    for lm in lid_msgs:
                        if lm.get("key", {}).get("id") not in seen_ids:
                            raw_messages.append(lm)

            for m in raw_messages:
                # Normalize to a common shape regardless of provider
                if _provider == "waha":
                    msg_id  = m.get("id", "")
                    from_me = m.get("fromMe", False)
                    body    = m.get("body") or ("[media]" if m.get("hasMedia") else "")
                    ts      = m.get("timestamp", 0)
                    msg_type = "conversation"
                else:
                    key     = m.get("key", {})
                    msg_id  = key.get("id", "")
                    from_me = key.get("fromMe", False)
                    ts      = m.get("messageTimestamp", 0)
                    msg_obj = m.get("message", {})
                    body    = (msg_obj.get("conversation")
                               or msg_obj.get("extendedTextMessage", {}).get("text")
                               or msg_obj.get("imageMessage", {}).get("caption")
                               or ("" if not msg_obj else "[media]"))
                    msg_type = m.get("messageType", "conversation")
                    actual_jid = key.get("remoteJid", "").split("@")[0]
                    if actual_jid and actual_jid != number:
                        db.db.jid_map.update_one({"jid": actual_jid},
                            {"$set": {"company_id": company_id, "updated_at": datetime.now()}}, upsert=True)

                if not msg_id:
                    continue
                # messageTimestamp es epoch UTC — fromtimestamp() sin tz lo interpretaría en
                # la hora local del servidor, y is_business_hours() luego le resta México (-6h)
                # OTRA VEZ asumiendo que ya era UTC, desfasando el horario real del mensaje.
                # Se guarda naive-pero-UTC (sin tzinfo) para seguir comparando sin fricción
                # contra otros datetimes de Mongo, que pymongo siempre devuelve naive.
                created = (
                    datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
                    if ts else datetime.now(timezone.utc).replace(tzinfo=None)
                )
                if cutoff and created < cutoff:
                    continue
                if db.db.message_logs.find_one({"message_id": msg_id}):
                    continue

                log_id = db.save_evolution_log(
                    direction    = "outbound" if from_me else "inbound",
                    company_id   = company_id,
                    number       = number,
                    message_body = body,
                    message_id   = msg_id,
                    message_type = msg_type,
                    status       = "synced",
                    raw_data     = m,
                    # Momento REAL en que se envió/recibió el mensaje en WhatsApp —
                    # sin esto, todos los mensajes de una misma corrida de sync quedan
                    # con created_at casi idéntico (el momento del sync), y el tiempo
                    # de reacción calculado después sale falso (ej. "0 seg" en vez de
                    # los minutos reales que tardó en contestar).
                    created_at   = created,
                )
                if not from_me and body and body != "[media]":
                    from app.llm import active_provider as _sync_cls_provider
                    if _sync_cls_provider() != "none":
                        from app.classifier import classify_and_save
                        background_tasks.add_task(classify_and_save, log_id, company_id, body, created)
                synced += 1

        return {"synced": synced, "message": f"{synced} mensajes nuevos sincronizados"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations")
def api_get_conversations():
    try:
        db = MongoDBManager()
        return serialize(db.get_conversations())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/ai-health")
def api_get_ai_health():
    try:
        import os
        from app.llm_guard import circuit_is_open
        from app.ai_followup import _is_business_hours
        from app.llm import active_provider
        return {
            "circuit_open": circuit_is_open(),
            "business_hours_active": _is_business_hours(),
            "active_provider": active_provider(),
            "openai_key_set": bool(os.getenv("OPENAI_API_KEY")),
            "deepseek_key_set": bool(os.getenv("DEEPSEEK_API_KEY")),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/ai-global-config")
def api_get_ai_global_config():
    try:
        from app.ai_followup import _DEFAULT_SYSTEM_PROMPT
        db = MongoDBManager()
        cfg = db.db.ai_global_config.find_one({"_id": "global"}) or {}
        return {
            "system_prompt":         cfg.get("system_prompt") or "",
            "default_system_prompt": _DEFAULT_SYSTEM_PROMPT,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/conversations/ai-global-config")
def api_put_ai_global_config(body: dict):
    try:
        from datetime import datetime as _dt
        db = MongoDBManager()
        system_prompt = str(body.get("system_prompt") or "").strip()
        db.db.ai_global_config.update_one(
            {"_id": "global"},
            {"$set": {"system_prompt": system_prompt, "updated_at": _dt.now()}},
            upsert=True,
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/{company_id}")
def api_get_conversation_thread(company_id: str, number: Optional[str] = None):
    try:
        db = MongoDBManager()
        return serialize(db.get_conversation_thread(company_id, number=number))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/conversations/{company_id}/read")
def api_mark_read(company_id: str):
    try:
        db = MongoDBManager()
        db.mark_conversation_read(company_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/{company_id}/ai-status")
def api_get_ai_status(company_id: str):
    try:
        db = MongoDBManager()
        prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}
        ai_enabled = bool(prefs.get("ai_enabled", False))
        session = db.db.ai_followup_sessions.find_one(
            {"company_id": company_id, "status": {"$in": ["active", "waiting"]}},
            sort=[("created_at", -1)],
        )
        pref_max = int(prefs.get("max_turns", 3))
        return {
            "ai_enabled": ai_enabled,
            "ai_active": bool(session),
            "ai_typing": bool(session.get("ai_typing")) if session else False,
            "turn_count": session.get("turn_count", 0) if session else 0,
            "max_turns": session.get("max_turns", pref_max) if session else pref_max,
        }
    except Exception:
        return {"ai_enabled": False, "ai_active": False, "ai_typing": False, "turn_count": 0, "max_turns": 3}

@router.post("/conversations/{company_id}/ai-toggle")
def api_ai_toggle(company_id: str, body: dict):
    try:
        from datetime import datetime as _dt
        db = MongoDBManager()
        enabled = bool(body.get("enabled", False))
        update = {"ai_enabled": enabled, "updated_at": _dt.now()}
        if "max_turns" in body:
            update["max_turns"] = max(1, int(body["max_turns"]))
        db.db.conversation_ai_prefs.update_one(
            {"company_id": company_id},
            {"$set": update},
            upsert=True,
        )
        # When enabling: if there's a recent unanswered inbound, kick off Chat IA immediately.
        # This lets the user activate AI mid-conversation without waiting for a new message.
        # When disabling: close any active/waiting sessions so the icon clears immediately.
        kicked = False
        from app.llm import active_provider as _llm_ap
        if enabled and _llm_ap() != "none":
            try:
                last_in = db.db.message_logs.find_one(
                    {"company_id": company_id, "direction": "inbound",
                     "message_body": {"$exists": True, "$ne": ""}},
                    sort=[("created_at", -1)],
                )
                if last_in:
                    number  = last_in.get("from_number") or last_in.get("number", "")
                    body_   = last_in.get("message_body", "")
                    log_id_ = str(last_in["_id"])
                    if number and body_:
                        # Ensure a session exists — create one now so the outbound-required
                        # check in _get_or_create_session is bypassed for manual activations.
                        from app.ai_followup import _get_or_create_session, _build_context, MAX_TURNS
                        existing = db.db.ai_followup_sessions.find_one(
                            {"company_id": company_id, "status": {"$in": ["active", "waiting"]}},
                        )
                        if not existing:
                            # Build context from the last outbound (or any outbound)
                            any_out = db.db.message_logs.find_one(
                                {"company_id": company_id, "direction": "outbound"},
                                sort=[("created_at", -1)],
                            )
                            ctx = _build_context(db, company_id, any_out or last_in)
                            if ctx:
                                pref_max = int(update.get("max_turns", MAX_TURNS))
                                db.db.ai_followup_sessions.insert_one({
                                    "phone_number": number,
                                    "company_id": company_id,
                                    "status": "waiting",
                                    "turns": [],
                                    "turn_count": 0,
                                    "max_turns": pref_max,
                                    "context": ctx,
                                    "ai_typing": False,
                                    "created_at": _dt.utcnow(),
                                    "last_activity": _dt.utcnow(),
                                })
                                print(f"[AIToggle] session pre-created for {number} (company={company_id})")
                        from app.followup_queue import enqueue as _ai_enqueue
                        _ai_enqueue(number, company_id, body_, log_id_, manual_activation=True)
                        kicked = True
            except Exception as _ke:
                print(f"[AIToggle] kick-off error: {_ke}")
        else:
            # Close any lingering sessions so the UI icon clears right away
            try:
                db.db.ai_followup_sessions.update_many(
                    {"company_id": company_id, "status": {"$in": ["active", "waiting"]}},
                    {"$set": {"status": "ended", "end_reason": "user_disabled",
                              "last_activity": _dt.utcnow()}},
                )
            except Exception as _ce:
                print(f"[AIToggle] session close error: {_ce}")
        return {"ok": True, "ai_enabled": enabled, "kicked": kicked}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/conversations/{company_id}/ai-config")
def api_get_ai_config(company_id: str):
    try:
        db = MongoDBManager()
        prefs = db.db.conversation_ai_prefs.find_one({"company_id": company_id}) or {}
        return {
            "max_turns":          int(prefs.get("max_turns", 3)),
            "extra_instructions": prefs.get("extra_instructions", ""),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/conversations/{company_id}/ai-config")
def api_put_ai_config(company_id: str, body: dict):
    try:
        from datetime import datetime as _dt
        db = MongoDBManager()
        update = {"updated_at": _dt.now()}
        if "max_turns" in body:
            update["max_turns"] = max(1, min(20, int(body["max_turns"])))
        if "extra_instructions" in body:
            update["extra_instructions"] = str(body["extra_instructions"])[:600]
        db.db.conversation_ai_prefs.update_one(
            {"company_id": company_id},
            {"$set": update},
            upsert=True,
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── N8N callbacks ─────────────────────────────────────────────────────────────

@router.post("/n8n/message-sent")
def api_n8n_message_sent(req: N8nMessageSentRequest):
    """N8N llama este endpoint después de enviar el mensaje por Twilio."""
    try:
        db = MongoDBManager()
        log_id = db.save_twilio_log(
            direction="outbound",
            company_id=req.company_id,
            number=req.to_number,
            message_body=req.message_body,
            twilio_sid=req.twilio_sid,
            status=req.status,
        )
        return {"ok": True, "log_id": log_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/n8n/message-received")
def api_n8n_message_received(req: N8nMessageReceivedRequest):
    """N8N llama este endpoint cuando Twilio recibe una respuesta del cliente."""
    try:
        db = MongoDBManager()
        company_id = db.find_company_id_by_phone(req.from_number) or "unknown"
        log_id = db.save_twilio_log(
            direction="inbound",
            company_id=company_id,
            number=req.from_number,
            message_body=req.message_body,
            twilio_sid=req.twilio_sid,
            status="received",
        )
        return {"ok": True, "log_id": log_id, "company_id": company_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Evolution API webhooks ────────────────────────────────────────────────────

STATUS_MAP = {
    "PENDING": "pending",
    "SERVER_ACK": "sent",
    "DELIVERY_ACK": "delivered",
    "READ": "read",
    "PLAYED": "read",
    "ERROR": "failed",
}

def _extract_body(message_obj: dict) -> str:
    """Extract readable text from any WhatsApp message type."""
    text, _ = _extract_body_and_interactive(message_obj)
    return text

def _extract_body_and_interactive(message_obj: dict) -> tuple:
    """Returns (text, interactive_data). interactive_data is None for plain text."""
    if message_obj.get("conversation"):
        return message_obj["conversation"], None
    if message_obj.get("extendedTextMessage", {}).get("text"):
        return message_obj["extendedTextMessage"]["text"], None
    for media in ("imageMessage", "videoMessage", "documentMessage"):
        cap = message_obj.get(media, {}).get("caption")
        if cap:
            return cap, None

    # Botones (buttonsMessage)
    bm = message_obj.get("buttonsMessage", {})
    if bm:
        text    = bm.get("contentText") or bm.get("text") or ""
        buttons = [b.get("buttonText", {}).get("displayText","") for b in bm.get("buttons", []) if b.get("buttonText", {}).get("displayText")]
        interactive = {"type": "buttons", "text": text, "options": buttons}
        opts = " | ".join(buttons)
        return f"{text}\n[Opciones: {opts}]" if opts else text, interactive

    # Listas (listMessage)
    lm = message_obj.get("listMessage", {})
    if lm:
        text = lm.get("title") or lm.get("description") or ""
        rows = [{"title": r.get("title",""), "desc": r.get("description","")}
                for s in lm.get("sections",[]) for r in s.get("rows",[])]
        interactive = {"type": "list", "text": text, "options": [r["title"] for r in rows], "rows": rows}
        opts = " | ".join(r["title"] for r in rows)
        return f"{text}\n[Lista: {opts}]" if opts else text, interactive

    # Interactivo genérico
    im = message_obj.get("interactiveMessage", {})
    if im:
        body = im.get("body", {}).get("text") or im.get("header", {}).get("text") or ""
        btns = [b.get("title","") or b.get("displayText","") for b in
                im.get("nativeFlowMessage", {}).get("buttons", []) +
                im.get("footer", {}).get("buttons", [])]
        btns = [b for b in btns if b]
        interactive = {"type": "buttons", "text": body, "options": btns} if btns else None
        opts = " | ".join(btns)
        return (f"{body}\n[Opciones: {opts}]" if opts else body), interactive

    # Templates
    tm = message_obj.get("templateMessage", {})
    if tm:
        hydrated = tm.get("hydratedTemplate", {})
        text = hydrated.get("hydratedContentText") or hydrated.get("hydratedTitleText") or "[template]"
        btns = [b.get("hydratedButton", {}).get("quickReplyButton", {}).get("displayText","")
                or b.get("hydratedButton", {}).get("callToActionButton", {}).get("displayText","")
                for b in hydrated.get("hydratedButtons", [])]
        btns = [b for b in btns if b]
        interactive = {"type": "buttons", "text": text, "options": btns} if btns else None
        opts = " | ".join(btns)
        return (f"{text}\n[Opciones: {opts}]" if opts else text), interactive

    # Encuestas
    pm = message_obj.get("pollCreationMessage", {})
    if pm:
        options = [o.get("optionName","") for o in pm.get("pollOptions",[]) if o.get("optionName")]
        interactive = {"type": "poll", "text": pm.get("name",""), "options": options}
        opts = " | ".join(options)
        return f"[Encuesta: {pm.get('name','')}] {opts}", interactive

    if message_obj.get("audioMessage"):    return "[audio]",    None
    if message_obj.get("stickerMessage"): return "[sticker]",  None
    if message_obj.get("locationMessage"): return "[location]", None
    if message_obj.get("contactMessage"): return "[contact]",  None
    return "", None

@router.post("/evolution/webhook")
def api_evolution_webhook(req: EvolutionWebhookRequest, background_tasks: BackgroundTasks):
    try:
        from app.config import DEEPSEEK_API_KEY
        from datetime import datetime, timezone
        db = MongoDBManager()
        event = req.event
        data = req.data
        print(f"[Webhook] event={event} data_type={type(data).__name__}")

        if event == "messages.upsert":
            # data can be a single message dict or a list of messages
            messages_list = data if isinstance(data, list) else [data] if data else []
            results = []
            for msg in messages_list:
                if not isinstance(msg, dict):
                    continue
                key = msg.get("key", {})
                from_me = key.get("fromMe", False)
                remote_jid = key.get("remoteJid", "")
                message_id = key.get("id", "")
                number = remote_jid.split("@")[0]
                message_obj = msg.get("message", {})
                message_body, interactive_data = _extract_body_and_interactive(message_obj)
                message_type = msg.get("messageType", "conversation")
                status_raw = msg.get("status", "PENDING")
                status = STATUS_MAP.get(status_raw, status_raw.lower())
                print(f"[Webhook] msg from_me={from_me} number={number} body={str(message_body)[:80]}")

                if from_me:
                    updated = db.update_evolution_message_status(message_id, status) if message_id else False
                    if not updated and message_body:
                        # Only create a new outbound log if there is actual message content.
                        # Evolution API fires from_me=True delivery/sync events with empty body
                        # for incoming Business API messages — those must not create phantom logs.
                        auto_company_id = db.find_company_id_by_phone(number) or "manual"
                        db.save_evolution_log(
                            direction="outbound", company_id=auto_company_id,
                            number=number, message_body=message_body,
                            message_id=message_id, status=status, raw_data=msg,
                        )
                    results.append("outbound_logged")
                else:
                    company_id = db.find_company_id_by_phone(number) or "unknown"
                    log_id = db.save_evolution_log(
                        direction="inbound", company_id=company_id,
                        number=number, message_body=message_body,
                        message_id=message_id, message_type=message_type,
                        status="received", raw_data=msg, interactive=interactive_data,
                        instance_name=req.instance,
                    )
                    # Skip analysis mid-AI-session and throttle: only classify if the last
                    # classification for this company is >10 min old (or doesn't exist yet).
                    _ai_session_active = bool(db.db.ai_followup_sessions.find_one(
                        {"company_id": company_id, "status": {"$in": ["active", "waiting"]}}
                    )) if company_id != "unknown" else False
                    if message_body and company_id != "unknown" and not _ai_session_active:
                        from app.llm import active_provider as _cls_provider
                        if _cls_provider() != "none":
                            from app.classifier import classify_or_copy_recent
                            # Naive-pero-UTC — is_business_hours() asume UTC cuando no hay tzinfo.
                            classify_or_copy_recent(db, background_tasks, log_id, company_id, message_body, datetime.now(timezone.utc).replace(tzinfo=None))
                    # AI follow-up: enqueue when ai_enabled is ON, or auto-activate on first reply.
                    # message_body can be a literal placeholder ("[audio]", "[sticker]", etc. —
                    # see _extract_body_and_interactive) when the reply has no real text — Andy
                    # must never be asked to "respond" to that marker as if it were the prospect's
                    # actual words, so it's excluded here the same way classifier.py excludes it
                    # from content-sensitive decisions (menu/is_ai detection).
                    from app.classifier import NON_TEXT_PLACEHOLDERS
                    if message_body and message_body not in NON_TEXT_PLACEHOLDERS and company_id != "unknown":
                        try:
                            from app.llm import active_provider as _llm_provider
                            if _llm_provider() != "none":
                                _prefs_doc = db.db.conversation_ai_prefs.find_one({"company_id": company_id})
                                _prefs = _prefs_doc or {}
                                _should_enqueue = _prefs.get("ai_enabled", False)
                                # Auto-activate ONLY when the user has NEVER explicitly set a preference
                                # (no prefs document = virgin conversation, first reply to a batch send).
                                # If the user manually disabled AI (_prefs_doc exists with ai_enabled=False),
                                # respect that decision — never override it automatically.
                                _user_explicitly_disabled = _prefs_doc is not None and not _prefs.get("ai_enabled", True)
                                if not _should_enqueue and not _ai_session_active and not _user_explicitly_disabled:
                                    from datetime import timedelta
                                    _recent_ended = db.db.ai_followup_sessions.find_one({
                                        "company_id": company_id,
                                        "status": "ended",
                                        "last_activity": {"$gte": datetime.now() - timedelta(hours=2)},
                                    }, projection={"_id": 1})
                                    if not _recent_ended:
                                        _cutoff = datetime.now() - timedelta(days=7)
                                        _had_outbound = db.db.message_logs.find_one(
                                            {"company_id": company_id, "direction": "outbound",
                                             "created_at": {"$gte": _cutoff}},
                                            projection={"_id": 1},
                                        )
                                        if _had_outbound:
                                            _should_enqueue = True
                                if _should_enqueue:
                                    from app.followup_queue import enqueue as _ai_enqueue
                                    _ai_enqueue(number, company_id, message_body, log_id)
                        except Exception as _fe:
                            print(f"[Webhook] followup_queue error: {_fe}")
                    results.append(f"inbound_saved:{company_id}")
            return {"ok": True, "action": results}

        elif event == "messages.update":
            updates = data if isinstance(data, list) else [data]
            for upd in updates:
                key = upd.get("key", {})
                # Delivery ACK uses flat structure {remoteJid, id, status}
                # Other updates use nested {key: {remoteJid, id}, update: {status}}
                message_id = key.get("id") or upd.get("id", "")
                remote_jid = key.get("remoteJid") or upd.get("remoteJid", "")
                status_raw = upd.get("update", {}).get("status") or upd.get("status", "")
                status = STATUS_MAP.get(status_raw, status_raw.lower() if status_raw else "")
                # Learn @lid mapping from delivery ACK
                if remote_jid.endswith("@lid") and message_id:
                    jid_num = remote_jid.split("@")[0]
                    if not db.db.jid_map.find_one({"jid": jid_num}):
                        log = db.db.message_logs.find_one(
                            {"message_id": message_id, "direction": "outbound"}
                        )
                        if log and log.get("company_id") and log["company_id"] not in ("manual", "unknown"):
                            from datetime import datetime as _dt
                            db.db.jid_map.update_one(
                                {"jid": jid_num},
                                {"$set": {"company_id": log["company_id"], "updated_at": _dt.now()}},
                                upsert=True,
                            )
                            print(f"[JID] learned from delivery ACK: {jid_num} → {log['company_id']}")
                if message_id and status:
                    db.update_evolution_message_status(message_id, status)
            return {"ok": True, "action": "status_updated"}

        elif event == "send.message":
            # Log full data to understand what's available; also try to learn @lid
            print(f"[Webhook] send.message data={str(data)[:500]}")
            if isinstance(data, dict):
                key = data.get("key", {})
                remote_jid = key.get("remoteJid", "")
                message_id = key.get("id", "")
                if remote_jid.endswith("@lid") and message_id:
                    jid_num = remote_jid.split("@")[0]
                    log = db.db.message_logs.find_one(
                        {"message_id": message_id, "direction": "outbound"}
                    )
                    if log and log.get("company_id") and log["company_id"] not in ("manual", "unknown"):
                        from datetime import datetime as _dt
                        db.db.jid_map.update_one(
                            {"jid": jid_num},
                            {"$set": {"company_id": log["company_id"], "updated_at": _dt.now()}},
                            upsert=True,
                        )
                        print(f"[JID] learned from send.message: {jid_num} → {log['company_id']}")
            return {"ok": True, "action": "send_logged"}

        elif event == "connection.update":
            # Fired on every connection state change (qr shown, connecting, open, close).
            # We only write the phone number when state is "open" (QR actually scanned).
            # Other states must NEVER overwrite an existing number — opening the QR dialog
            # without scanning it should leave the stored number untouched.
            _DISCONNECT_REASONS = {
                401: ("logged_out",    "Cerró sesión"),
                403: ("banned",        "Baneado por WhatsApp"),
                405: ("conflict",      "Conflicto de dispositivo"),
                408: ("timeout",       "Timeout de conexión"),
                411: ("multidevice",   "Conflicto multi-dispositivo"),
                428: ("closed",        "Conexión cerrada"),
                440: ("replaced",      "Sesión reemplazada"),
                500: ("server_error",  "Error interno"),
                515: ("restart",       "Requiere reinicio"),
            }
            instance_name = (req.instance or "").strip()
            owner = ""
            conn_state = ""
            status_reason = None
            if isinstance(data, dict):
                owner = (
                    data.get("ownerJid") or
                    data.get("instance", {}).get("ownerJid") or
                    data.get("me", {}).get("id") or ""
                )
                conn_state = (
                    data.get("state") or
                    data.get("instance", {}).get("state") or ""
                ).lower()
                # Baileys statusReason code — present on disconnects
                status_reason = (
                    data.get("statusReason") or
                    data.get("lastDisconnect", {}).get("error", {}).get("output", {}).get("statusCode")
                )
                if isinstance(status_reason, str) and status_reason.isdigit():
                    status_reason = int(status_reason)
            _connected_states = {"open", "connected"}
            if owner and instance_name and conn_state in _connected_states:
                number = owner.split("@")[0] if "@" in owner else owner
                if number:
                    db.db.instances.update_one(
                        {"name": instance_name},
                        {"$set": {"number": number}, "$unset": {"disconnect_reason": "", "disconnect_reason_label": "", "disconnect_code": ""}},
                    )
                    db.save_instance_health_log(instance_name, "connected")
                    print(f"[Webhook] connection.update: instance={instance_name} number={number} state={conn_state}")
            elif instance_name and conn_state in {"close", "disconnected"}:
                reason_key, reason_label = _DISCONNECT_REASONS.get(status_reason, ("disconnected", "Desconectada"))
                db.db.instances.update_one(
                    {"name": instance_name},
                    {"$set": {
                        "disconnect_reason":       reason_key,
                        "disconnect_reason_label": reason_label,
                        "disconnect_code":         status_reason,
                        "last_disconnect_at":      datetime.now(),
                    }},
                )
                db.save_instance_health_log(instance_name, "disconnected",
                                            reason=reason_key, reason_label=reason_label,
                                            reason_code=status_reason)
                print(f"[Webhook] connection.update: instance={instance_name} state={conn_state} reason={reason_key}({status_reason}) → {reason_label}")
            else:
                print(f"[Webhook] connection.update ignored (state={conn_state!r}, owner={'yes' if owner else 'no'}) — no changes")
            return {"ok": True, "action": "connection_updated"}

        return {"ok": True, "action": "ignored", "event": event}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/companies/{company_id}/rescrape")
def api_rescrape_company(company_id: str):
    try:
        from app.scraper import WebsiteScraper
        from bson import ObjectId
        from datetime import datetime
        db = MongoDBManager()
        company = db.get_company_full_data(company_id)
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")
        website = company.get("website") or company.get("domain")
        if not website:
            raise HTTPException(status_code=400, detail="La empresa no tiene URL registrada")
        if not website.startswith("http"):
            website = f"https://{website}"
        # Blacklist check before re-scraping
        from urllib.parse import urlparse as _urlparse
        from app.pipeline import _check_blacklist
        _domain = _urlparse(website).netloc.lower().replace("www.", "")
        _bl = _check_blacklist(_domain, "")
        if _bl:
            raise HTTPException(status_code=403, detail=f"Domain is blacklisted: {_bl['matched']}")
        scraper = WebsiteScraper()
        result  = scraper.scrape_site(website, force=True)
        # Industry check after scraping
        _industry = result.get("industry", "") or ""
        _bl_ind = _check_blacklist("", _industry)
        if _bl_ind:
            raise HTTPException(status_code=403, detail=f"Industry is blacklisted: {_bl_ind['matched']}")

        # Update the correct DB (scraper uses 'comercial', app uses 'commercial').
        # last_scraped_at/next_allowed_scrape_at must be copied too — scrape_site()
        # computes fresh values for both on every real scrape, but they were missing
        # from this list, so "última fecha de scraping" never advanced here even
        # when the rescrape actually ran and updated everything else.
        update_fields = {"updated_at": datetime.now()}
        for field in ("name", "industry", "description", "city", "state", "country",
                      "address", "phone_numbers", "whatsapp_numbers", "all_whatsapp_numbers",
                      "has_whatsapp", "business_hours", "services", "products",
                      "last_scraped_at", "next_allowed_scrape_at"):
            if result.get(field) is not None:
                update_fields[field] = result[field]

        db.db.companies.update_one(
            {"_id": ObjectId(company_id)},
            {"$set": update_fields}
        )

        return serialize({
            "ok": True,
            "industry": result.get("industry"),
            "city": result.get("city"),
            "has_whatsapp": result.get("has_whatsapp"),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Blacklist ─────────────────────────────────────────────────────────────────

def _normalize_blacklist_value(t: str, value: str) -> str:
    value = value.strip().lower()
    if t == "domain":
        import re as _re
        value = _re.sub(r'^https?://', '', value)
        value = _re.sub(r'^www\.', '', value)
        value = value.rstrip('/')
    return value


@router.get("/blacklist/system")
def api_get_system_blacklist():
    from app.searcher import EXCLUDED_DOMAINS
    domains = sorted(list(EXCLUDED_DOMAINS))
    return {"domains": domains, "total": len(domains)}


@router.get("/blacklist")
def api_get_blacklist(
    type: Optional[str] = None,
    search: str = "",
    page: int = 1,
    limit: int = 10,
    x_user_token: Optional[str] = Header(None),
):
    _require_user(x_user_token)
    db = MongoDBManager()
    query: dict = {}
    if type in ("domain", "industry"):
        query["type"] = type
    search = search.strip()
    if search:
        import re as _re
        query["value"] = {"$regex": _re.escape(search), "$options": "i"}

    page = max(1, page)
    limit = max(1, min(limit, 100))
    total = db.db.blacklist.count_documents(query)
    entries = list(db.db.blacklist.find(
        query, {"_id": 1, "type": 1, "value": 1, "created_at": 1},
        sort=[("created_at", -1)],
        skip=(page - 1) * limit,
        limit=limit,
    ))
    return {"items": serialize(entries), "total": total, "page": page, "limit": limit}


@router.post("/blacklist")
def api_add_blacklist(body: dict, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    t = body.get("type", "").strip()
    if t not in ("domain", "industry") or not body.get("value", "").strip():
        raise HTTPException(status_code=400, detail="type must be 'domain' or 'industry', value required")
    value = _normalize_blacklist_value(t, body.get("value", ""))
    if not value:
        raise HTTPException(status_code=400, detail="value required")
    db = MongoDBManager()
    # Prevent duplicates
    existing = db.db.blacklist.find_one({"type": t, "value": value})
    if existing:
        raise HTTPException(status_code=409, detail="Entry already exists")
    from datetime import datetime
    result = db.db.blacklist.insert_one({"type": t, "value": value, "created_at": datetime.now()})
    return serialize({"_id": result.inserted_id, "type": t, "value": value})


@router.put("/blacklist/{entry_id}")
def api_update_blacklist(entry_id: str, body: dict, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    from bson import ObjectId
    db = MongoDBManager()
    existing = db.db.blacklist.find_one({"_id": ObjectId(entry_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Entry not found")

    value = _normalize_blacklist_value(existing["type"], body.get("value", ""))
    if not value:
        raise HTTPException(status_code=400, detail="value required")

    duplicate = db.db.blacklist.find_one({
        "type": existing["type"], "value": value, "_id": {"$ne": ObjectId(entry_id)},
    })
    if duplicate:
        raise HTTPException(status_code=409, detail="Entry already exists")

    db.db.blacklist.update_one({"_id": ObjectId(entry_id)}, {"$set": {"value": value}})
    updated = db.db.blacklist.find_one({"_id": ObjectId(entry_id)})
    return serialize(updated)


@router.delete("/blacklist/{entry_id}")
def api_delete_blacklist(entry_id: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    from bson import ObjectId
    db = MongoDBManager()
    result = db.db.blacklist.delete_one({"_id": ObjectId(entry_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}

@router.put("/companies/{company_id}/contacts")
def api_update_contacts(company_id: str, req: UpdateContactsRequest):
    try:
        db = MongoDBManager()
        db.replace_whatsapp_contacts(company_id, req.whatsapp_numbers)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Reports ───────────────────────────────────────────────────────────────────

@router.post("/reports/{company_id}")
def api_generate_report(company_id: str, req: ReportRequest):
    try:
        from fastapi.responses import StreamingResponse
        from app.report_generator import generate_report

        db = MongoDBManager()
        company = db.get_company_full_data(company_id)
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        if not req.force:
            open_probe = db.db.message_logs.find_one(
                {"company_id": company_id, "analysis_status": "awaiting_t2"},
                sort=[("created_at", -1)],
                projection={"probe.deadline": 1},
            )
            if open_probe:
                deadline = (open_probe.get("probe") or {}).get("deadline")
                raise HTTPException(status_code=409, detail={
                    "code": "analysis_pending",
                    "message": "Todavía no se confirma si la última respuesta es de un bot o una persona — el análisis sigue en progreso.",
                    "resolves_by": deadline.isoformat() if deadline else None,
                })

        analytics_raw  = db.get_analytics(company_id=company_id)
        analytics_list = analytics_raw.get("items", []) if isinstance(analytics_raw, dict) else analytics_raw
        analytics = analytics_list[0] if analytics_list else {}

        thread = db.get_conversation_thread(company_id)

        if req.filter_number:
            norm = lambda n: re.sub(r'\D', '', n or '')[-10:]
            fn   = norm(req.filter_number)
            thread = [
                m for m in thread
                if norm(m.get('to_number') or m.get('from_number') or m.get('number') or '') == fn
            ]

        pdf_buf = generate_report(
            company=serialize(company),
            analytics=analytics,
            thread=thread,
            screenshot_b64=req.screenshot_b64,
        )

        raw_name = company.get("name") or company.get("domain") or "empresa"
        # Remove non-ASCII chars for safe filename and HTTP header
        safe_name = (raw_name
            .replace("—", "-").replace("–", "-")
            .encode("ascii", errors="ignore").decode("ascii")
            .replace(" ", "_").strip("_") or "empresa")
        filename = f"reporte-{safe_name}.pdf"

        return StreamingResponse(
            pdf_buf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Evolution config ──────────────────────────────────────────────────────────

@router.get("/config/evolution")
def api_get_evo_config():
    from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE
    return {
        "url":      EVOLUTION_API_URL,
        "apiKey":   "***" if EVOLUTION_API_KEY else "",
        "instance": EVOLUTION_INSTANCE,
        "configured": bool(EVOLUTION_API_KEY and EVOLUTION_INSTANCE),
    }

@router.post("/config/evolution")
def api_save_evo_config(body: dict):
    try:
        from pathlib import Path
        import app.config as cfg
        env_path = Path(__file__).parent.parent / ".env"
        text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""

        def _set(text, key, value):
            import re
            pattern = rf"^{key}=.*$"
            line    = f"{key}={value}"
            if re.search(pattern, text, re.MULTILINE):
                return re.sub(pattern, line, text, flags=re.MULTILINE)
            return text + f"\n{line}"

        if body.get("url"):
            text = _set(text, "EVOLUTION_API_URL", body["url"])
            cfg.EVOLUTION_API_URL = body["url"]
        if body.get("apiKey"):
            text = _set(text, "EVOLUTION_API_KEY", body["apiKey"])
            cfg.EVOLUTION_API_KEY = body["apiKey"]
        if body.get("instance"):
            text = _set(text, "EVOLUTION_INSTANCE", body["instance"])
            cfg.EVOLUTION_INSTANCE = body["instance"]

        env_path.write_text(text, encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Evolution instance management ────────────────────────────────────────────

@router.post("/evolution/instance/create")
def api_evo_create_instance(body: dict):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        name = (body.get("name") or body.get("instanceName") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name requerido")
        r = _req.post(f"{EVOLUTION_API_URL}/instance/create",
            headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
            json={"instanceName": name, "integration": "WHATSAPP-BAILEYS", "qrcode": True},
            timeout=15)
        print(f"[DEBUG] evo create {name!r} → {r.status_code} {r.text[:300]}")
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"Evolution error: {r.text[:200]}")
        evo_data = r.json()
        instance_token = evo_data.get("hash") or ""
        if instance_token:
            db = MongoDBManager()
            db.db.instances.update_one({"name": name}, {"$set": {"name": name, "instance_token": instance_token}}, upsert=True)
        return evo_data
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.get("/evolution/instance/qr/{name}")
def api_evo_get_qr(name: str):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        db = MongoDBManager()
        inst_doc = db.db.instances.find_one({"name": name}) or {}
        instance_token = inst_doc.get("instance_token") or EVOLUTION_API_KEY
        # GET /instance/connect/{name} returns QR code for Evolution API
        r = _req.get(f"{EVOLUTION_API_URL}/instance/connect/{name}",
            headers={"apikey": instance_token}, timeout=10)
        print(f"[DEBUG] evo qr {name!r} → {r.status_code} {r.text[:300]}")
        resp = r.json()
        # Normalize QR field for frontend
        qr_b64 = resp.get("base64") or resp.get("qrcode", {}).get("base64") or resp.get("qr", {}).get("base64")
        if qr_b64:
            return {"base64": qr_b64}
        return resp
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/evolution/instance/pairing-code/{name}")
def api_evo_pairing_code(name: str, body: dict):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        phone = str(body.get("phone", "")).strip().replace("+", "").replace(" ", "")
        if not phone:
            raise HTTPException(status_code=400, detail="phone requerido")

        # Lookup instance token from DB for instance-specific auth
        db = MongoDBManager()
        inst_doc = db.db.instances.find_one({"name": name}) or {}
        instance_token = inst_doc.get("instance_token") or EVOLUTION_API_KEY
        api_key = instance_token or EVOLUTION_API_KEY

        print(f"[DEBUG] pairing-code name={name!r} phone={phone!r} token={api_key!r}")

        # GET /instance/connect/{name}?number={phone} returns pairingCode when number provided
        r = _req.get(
            f"{EVOLUTION_API_URL}/instance/connect/{name}",
            headers={"apikey": api_key, "Content-Type": "application/json"},
            params={"number": phone},
            timeout=15,
        )
        print(f"[DEBUG] connect response: {r.status_code} {r.text[:400]}")

        data = r.json()
        code = data.get("pairingCode") or data.get("code") \
            or (data.get("data") or {}).get("PairingCode") or data.get("pairing_code")
        if code:
            return {"code": code}
        if not r.ok:
            raise HTTPException(r.status_code, f"Evolution connect error: {r.text[:200]}")
        return data
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/evolution/instance/request-otp/{name}")
def api_evo_request_otp(name: str, body: dict):
    """Evolution API v2: request OTP SMS for new number registration (primary device)."""
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        from fastapi.responses import JSONResponse as _JSONResponse
        phone = str(body.get("phone", "")).strip().replace("+", "").replace(" ", "")
        if not phone:
            raise HTTPException(status_code=400, detail="phone requerido")
        r = _req.post(
            f"{EVOLUTION_API_URL}/instance/requestRegistrationCode/{name}",
            headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
            json={"phoneNumber": phone, "method": "sms"},
            timeout=15,
        )
        try:
            data = r.json()
        except Exception:
            data = {"detail": r.text or "Evolution API error"}
        if not r.ok:
            return _JSONResponse(content=data, status_code=r.status_code)
        return data
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/evolution/instance/verify-otp/{name}")
def api_evo_verify_otp(name: str, body: dict):
    """Evolution API v2: submit OTP code to complete number registration."""
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        from fastapi.responses import JSONResponse as _JSONResponse
        code = str(body.get("code", "")).strip()
        if not code:
            raise HTTPException(status_code=400, detail="code requerido")
        r = _req.post(
            f"{EVOLUTION_API_URL}/instance/confirmRegistrationCode/{name}",
            headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
            json={"code": code},
            timeout=15,
        )
        try:
            data = r.json()
        except Exception:
            data = {"detail": r.text or "Evolution API error"}
        if not r.ok:
            return _JSONResponse(content=data, status_code=r.status_code)
        return data
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

ADB_AGENT_URL = os.environ.get("ADB_AGENT_URL", "http://10.0.0.1:9876")

@router.get("/register/emulator-stream")
async def register_emulator_stream(phone: str, instance: str = "wa-01", country: int = 54):
    """Proxy SSE from ADB agent on host to the UI."""
    import httpx
    from fastapi.responses import StreamingResponse

    async def event_gen():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST", f"{ADB_AGENT_URL}/register",
                    json={"phone": phone, "instance": instance, "country": country},
                    timeout=httpx.Timeout(connect=10, read=180, write=10, pool=10),
                ) as r:
                    async for chunk in r.aiter_bytes():
                        yield chunk
        except Exception as e:
            yield f"data: {json.dumps({'msg': f'Error de conexión al agente ADB: {e}', 'step': 'error'})}\n\n".encode()

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/register/preview")
async def register_preview(body: dict = {}):
    """Get SMSFast balance and session info before starting registration."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{ADB_AGENT_URL}/register/preview", json=body)
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ADB agent not reachable: {e}")

@router.get("/register/agent-health")
def register_agent_health():
    """Check if ADB agent is running on the host."""
    import requests as _req
    try:
        r = _req.get(f"{ADB_AGENT_URL}/health", timeout=5)
        return r.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ADB agent not reachable: {e}")

SMSFAST_BASE = "https://api.smsfast.com/stubs/handler_api.php"

@router.get("/smsfast/info")
def api_smsfast_info(country: int = 54):
    """Return SMSFast account balance and price for WhatsApp number in a country."""
    import requests as _req
    from app.config import SMSFAST_API_KEY, SMSFAST_SERVICE
    if not SMSFAST_API_KEY:
        raise HTTPException(400, "SMSFAST_API_KEY no configurada")
    try:
        bal_r = _req.get(SMSFAST_BASE, params={"api_key": SMSFAST_API_KEY, "action": "getBalance"}, timeout=10)
        bal_text = bal_r.text.strip()
        balance = float(bal_text.split(":")[-1]) if ":" in bal_text else None

        pr_r = _req.get(SMSFAST_BASE, params={
            "api_key": SMSFAST_API_KEY, "action": "getPrices",
            "service": SMSFAST_SERVICE, "country": country,
        }, timeout=10)
        price = None
        qty   = None
        try:
            pr_data = pr_r.json()
            # Format: {"country_id": {"service_id": {"cost": price, "count": qty}}}
            for country_val in pr_data.values():
                if not isinstance(country_val, dict): continue
                for service_val in country_val.values():
                    if isinstance(service_val, dict):
                        price = float(service_val["cost"]) if "cost" in service_val else None
                        qty   = int(service_val["count"]) if "count" in service_val else None
                    elif isinstance(service_val, (int, float)):
                        price = float(service_val)
                    if price is not None: break
                if price is not None: break
        except Exception as pe:
            print(f"[SMSFast] price parse error: {pe} raw={pr_r.text[:200]}")

        return {"balance": balance, "price": price, "qty": qty or 0}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/smsfast/buy")
def api_smsfast_buy(body: dict):
    """Buy a WhatsApp virtual number from SMSFast. Returns {ok, id, number}."""
    import requests as _req
    from app.config import SMSFAST_API_KEY, SMSFAST_SERVICE
    if not SMSFAST_API_KEY:
        raise HTTPException(400, "SMSFAST_API_KEY no configurada")
    country = body.get("country", 54)
    try:
        print(f"[SMSFast] buy country={country} service={SMSFAST_SERVICE}")
        params = {
            "api_key": SMSFAST_API_KEY, "action": "getNumber",
            "service": SMSFAST_SERVICE, "country": country,
        }
        # Optional price ceiling sent from frontend (prevents surprise charges)
        max_price = body.get("maxPrice")
        if max_price:
            params["maxprice"] = max_price
        r = _req.get(SMSFAST_BASE, params=params, timeout=20)
        text = r.text.strip()
        print(f"[SMSFast] buy response={text[:120]}")
        if text.startswith("ACCESS_NUMBER:"):
            parts = text.split(":")
            return {"ok": True, "id": parts[1], "number": parts[2]}
        # Map known error codes to human-readable messages
        errs = {
            "NO_NUMBERS": "Sin números disponibles para ese país. Intenta más tarde o cambia el país.",
            "NO_BALANCE": "Saldo insuficiente en SMSFast.",
            "BAD_KEY": "API key de SMSFast inválida.",
        }
        raise HTTPException(400, errs.get(text, f"SMSFast: {text}"))
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/smsfast/cancel")
def api_smsfast_cancel(body: dict):
    """Cancel a SMSFast activation (status=8 = cancel + refund)."""
    import requests as _req
    from app.config import SMSFAST_API_KEY
    if not SMSFAST_API_KEY:
        raise HTTPException(400, "SMSFAST_API_KEY no configurada")
    activation_id = body.get("id")
    if not activation_id:
        raise HTTPException(400, "id requerido")
    try:
        r = _req.get(SMSFAST_BASE, params={
            "api_key": SMSFAST_API_KEY, "action": "setStatus",
            "status": 8, "id": activation_id,
        }, timeout=10)
        text = r.text.strip()
        return {"ok": text == "ACCESS_CANCEL", "response": text}
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/evolution/instances/user-status")
def api_evo_user_status(x_user_token: Optional[str] = Header(None)):
    """Returns aggregate connection status for all instances assigned to the current user.
    connected=true if ANY instance is state=open AND has a phone number registered."""
    from app.auth import get_user_by_token
    from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
    import requests as _req
    from concurrent.futures import ThreadPoolExecutor
    from bson import ObjectId

    if not x_user_token:
        return {"connected": False, "connected_count": 0, "total": 0}

    user = get_user_by_token(x_user_token)
    if not user:
        return {"connected": False, "connected_count": 0, "total": 0}

    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    # Only include Evolution instances (or legacy docs with no provider field).
    # WAHA → /waha/instances/user-status  |  Wasender → /wasender/instances/user-status
    all_instances = list(db.db.instances.find(
        {"assigned_to": user_id, "provider": {"$nin": ["waha", "wasender"]}},
        {"_id": 0, "name": 1, "number": 1, "disconnect_reason": 1, "disconnect_reason_label": 1, "disconnect_code": 1},
    )) if user_id else []

    if not all_instances:
        # Fallback: check user's personal instance (legacy field may point to WAHA)
        inst_name = user.get("evolution_instance", "")
        if not inst_name:
            return {"connected": False, "connected_count": 0, "total": 0}
        # Don't check WAHA instances against Evolution API
        _inst_doc = db.db.instances.find_one({"name": inst_name}, {"provider": 1}) or {}
        if _inst_doc.get("provider") == "waha":
            return {"connected": False, "connected_count": 0, "total": 0}
        all_instances = [{"name": inst_name, "number": user.get("connected_number", "")}]

    def _check(inst):
        try:
            r = _req.get(
                f"{EVOLUTION_API_URL}/instance/connectionState/{inst['name']}",
                headers={"apikey": EVOLUTION_API_KEY}, timeout=3,
            )
            state = (r.json().get("instance") or {}).get("state") or r.json().get("state", "")
            return state == "open" and bool(inst.get("number"))
        except Exception:
            return False

    with ThreadPoolExecutor(max_workers=max(1, len(all_instances))) as ex:
        results = list(ex.map(_check, all_instances))

    connected_count = sum(results)
    # Also return disconnect_reason of the first disconnected instance (for UI hint)
    first_disconnected = next(
        (i for i, ok in zip(all_instances, results) if not ok and i.get("disconnect_reason")), None
    )
    resp = {
        "connected": connected_count > 0,
        "connected_count": connected_count,
        "total": len(all_instances),
    }
    if first_disconnected:
        resp["disconnect_reason"]       = first_disconnected["disconnect_reason"]
        resp["disconnect_reason_label"] = first_disconnected.get("disconnect_reason_label", "")
        resp["disconnect_code"]         = first_disconnected.get("disconnect_code")
    return resp


@router.get("/evolution/instance/status/{name}")
def api_evo_get_status(name: str):
    """GET /instance/connectionState/{name} → {"instance": {"instanceName": "...", "state": "open"|"close"}, "number": "..."}"""
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        r = _req.get(
            f"{EVOLUTION_API_URL}/instance/connectionState/{name}",
            headers={"apikey": EVOLUTION_API_KEY},
            timeout=10,
        )
        data = r.json()
        # Enrich with number + disconnect_reason from MongoDB
        db = MongoDBManager()
        inst_doc = db.db.instances.find_one(
            {"name": name},
            {"_id": 0, "number": 1, "disconnect_reason": 1, "disconnect_reason_label": 1, "disconnect_code": 1},
        ) or {}
        if inst_doc.get("number"):
            data["number"] = inst_doc["number"]
        if inst_doc.get("disconnect_reason"):
            data["disconnect_reason"]       = inst_doc["disconnect_reason"]
            data["disconnect_reason_label"] = inst_doc.get("disconnect_reason_label", "Desconectada")
            data["disconnect_code"]         = inst_doc.get("disconnect_code")
        return data
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/evolution/instance/webhook")
def api_evo_register_webhook(body: dict):
    """Register the app webhook on a new Evolution instance."""
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        name = body.get("instanceName", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="instanceName requerido")
        from app.config import APP_PUBLIC_URL
        webhook_url = f"{APP_PUBLIC_URL}/api/evolution/webhook"
        payload = {"url": webhook_url, "enabled": True,
            "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_SET"],
            "webhookByEvents": False, "webhookBase64": False}
        r = _req.post(f"{EVOLUTION_API_URL}/webhook/set/{name}",
            headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
            json=payload, timeout=10)
        return {"ok": r.status_code in (200, 201), "status": r.status_code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/evolution/instance/{name}")
def api_evo_delete_instance(name: str):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        r = _req.delete(f"{EVOLUTION_API_URL}/instance/delete/{name}",
            headers={"apikey": EVOLUTION_API_KEY}, timeout=10)
        return r.json()
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/evolution/instance/logout/{name}")
def api_evo_logout_instance(name: str):
    """Clear stored session credentials so the instance generates a fresh QR on next connect.
    Use when the instance is stuck in 'connecting' with expired auth (statusReason 428)."""
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        r = _req.delete(f"{EVOLUTION_API_URL}/instance/logout/{name}",
            headers={"apikey": EVOLUTION_API_KEY}, timeout=10)
        return {"ok": r.status_code in (200, 201), "status": r.status_code, "data": r.json()}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ── WAHA (WhatsApp HTTP API) ──────────────────────────────────────────────────

def _waha_auto_register_inbound(db, number: str, session_name: str = "") -> str:
    """Create a minimal company + contact record for an unknown inbound WhatsApp number.

    Called the first time an unrecognised number messages one of our sessions.
    The company gets status='inbound' so it's visually distinct from scraped leads.
    """
    from datetime import datetime as _dt
    clean = "".join(filter(str.isdigit, number))
    # Guard: another concurrent request may have just created this contact
    existing = db.find_company_id_by_phone(clean)
    if existing:
        return existing
    display = f"+{clean}"
    company_id = db.insert_company({
        "name": display,
        "status": "inbound",
        "has_whatsapp": True,
        "source": "inbound_whatsapp",
        "via_instance": session_name,
    })
    db.insert_contact({
        "company_id": company_id,
        "type": "whatsapp",
        "value": clean,
        "source": "inbound_whatsapp",
        "is_primary": True,
    })
    db.db.jid_map.update_one(
        {"jid": clean},
        {"$set": {"company_id": company_id, "updated_at": _dt.now()}},
        upsert=True,
    )
    print(f"[WAHA Webhook] Auto-registered inbound contact {display} → {company_id} (via {session_name})")
    return company_id


def _waha_auto_restart(session_name: str, delay_s: int):
    """Background: wait delay_s, then restart session if still FAILED."""
    import time as _time
    import requests as _req
    from app.config import WAHA_API_URL, WAHA_API_KEY
    _time.sleep(delay_s)
    try:
        r = _req.get(f"{WAHA_API_URL}/api/sessions/{session_name}",
            headers={"X-Api-Key": WAHA_API_KEY}, timeout=5)
        if r.ok and r.json().get("status") == "FAILED":
            _req.post(f"{WAHA_API_URL}/api/sessions/{session_name}/restart",
                headers={"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"},
                json={}, timeout=10)
            print(f"[WAHA AutoRestart] {session_name} restarted after {delay_s}s backoff")
        else:
            print(f"[WAHA AutoRestart] {session_name} recovered on its own — skip restart")
    except Exception as e:
        print(f"[WAHA AutoRestart] {session_name} error: {e}")


def _waha_force_reset(session_name: str):
    """Delete and recreate a stuck session to clear corrupted state → SCAN_QR_CODE.

    Called after 3 failed auto-restarts. Uses a 90s DELETE timeout because
    WAHA's async-lock queue can hold operations for 60+ s during busy periods,
    causing a short timeout to abort before WAHA finishes — leaving the session
    deleted but not recreated.
    """
    import time as _time
    import requests as _req
    from app.config import WAHA_API_URL, WAHA_API_KEY
    from app.database import MongoDBManager

    headers = {"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"}
    base = WAHA_API_URL.rstrip("/")
    try:
        # Abort if session already recovered
        r = _req.get(f"{base}/api/sessions/{session_name}", headers=headers, timeout=5)
        if r.ok and r.json().get("status") not in ("FAILED", "STOPPED"):
            print(f"[WAHA ForceReset] {session_name} already recovered — skipping")
            return

        # Preserve webhook config before deleting
        config = r.json().get("config", {}) if r.ok else {}

        print(f"[WAHA ForceReset] {session_name} — deleting (90s timeout; WAHA may be busy)")
        try:
            _req.delete(f"{base}/api/sessions/{session_name}", headers=headers, timeout=90)
        except (_req.exceptions.Timeout, _req.exceptions.ConnectionError) as _del_err:
            print(f"[WAHA ForceReset] {session_name} — DELETE timed out ({_del_err}), waiting for WAHA to settle…")
            _time.sleep(15)

        _time.sleep(3)

        # Verify deletion before recreating: if session recovered on its own, skip;
        # if it still exists as FAILED/STOPPED try one more short delete.
        chk = _req.get(f"{base}/api/sessions/{session_name}", headers=headers, timeout=5)
        if chk.ok:
            chk_status = chk.json().get("status", "")
            if chk_status not in ("FAILED", "STOPPED", ""):
                print(f"[WAHA ForceReset] {session_name} — recovered to {chk_status}, skipping recreate")
                return
            if chk_status in ("FAILED", "STOPPED"):
                print(f"[WAHA ForceReset] {session_name} — still {chk_status}, retrying delete")
                try:
                    _req.delete(f"{base}/api/sessions/{session_name}", headers=headers, timeout=30)
                    _time.sleep(3)
                except Exception:
                    pass

        print(f"[WAHA ForceReset] {session_name} — recreating session")
        _req.post(f"{base}/api/sessions", json={"name": session_name, "config": config},
                  headers=headers, timeout=15)
        _time.sleep(2)

        _req.post(f"{base}/api/sessions/{session_name}/start", json={},
                  headers=headers, timeout=15)

        # Reset failure counter so next disconnect gets fresh auto-restart attempts
        db = MongoDBManager()
        db.db.instances.update_one(
            {"name": session_name},
            {"$set": {"failed_restart_count": 0,
                      "disconnect_reason": "scan_qr",
                      "disconnect_reason_label": "Esperando QR"},
             "$unset": {"last_failed_at": ""}},
        )
        print(f"[WAHA ForceReset] {session_name} — done, waiting for QR scan")
    except Exception as exc:
        print(f"[WAHA ForceReset] {session_name} — error: {exc}")


WAHA_ACK_MAP = {
    "ERROR":   "failed",
    "PENDING": "pending",
    "SERVER":  "sent",
    "DEVICE":  "delivered",
    "READ":    "read",
    "PLAYED":  "read",
}

@router.post("/waha/webhook")
def api_waha_webhook(body: dict, background_tasks: BackgroundTasks):
    """Receive events from WAHA (replaces /evolution/webhook for WAHA sessions)."""
    try:
        from datetime import datetime, timezone
        db = MongoDBManager()
        event = body.get("event", "")
        session_name = body.get("session", "")
        payload = body.get("payload") or {}
        me = body.get("me") or {}
        print(f"[WAHA Webhook] event={event} session={session_name}")

        if event in ("message", "message.any"):
            # NOWEB sends both "message" and "message.any" for every inbound message.
            # Only process via "message.any" (fires exactly once per direction).
            # Ignore bare "message" events to prevent duplicate sendSeen / AI calls.
            if event == "message":
                return {"ok": True, "action": "ignored_duplicate"}
            from_me = payload.get("fromMe", False)
            from_jid = payload.get("from", "").replace("@s.whatsapp.net", "@c.us")
            to_jid   = payload.get("to",   "").replace("@s.whatsapp.net", "@c.us")
            # NOWEB uses @lid JIDs; the real phone is in _data.key.remoteJidAlt
            _raw_key = (payload.get("_data") or {}).get("key") or {}
            _jid_alt = (_raw_key.get("remoteJidAlt") or "").replace("@s.whatsapp.net", "@c.us").split("@")[0]
            if "@lid" in from_jid and _jid_alt:
                from_jid = f"{_jid_alt}@c.us"
            if "@lid" in to_jid and _jid_alt:
                to_jid = f"{_jid_alt}@c.us"
            message_id   = payload.get("id", "")
            message_body = payload.get("body") or ""
            ack_name     = payload.get("ackName", "")
            # NOWEB outbound: recipient is in `from` field when fromMe=True, `to` may be absent
            number = (from_jid if not from_me else (to_jid or from_jid)).split("@")[0]
            status = WAHA_ACK_MAP.get(ack_name, "received")
            print(f"[WAHA Webhook] msg from_me={from_me} number={number} body={str(message_body)[:80]}")

            if from_me:
                updated = db.update_evolution_message_status(message_id, status) if message_id else False
                if not updated and message_body:
                    auto_company_id = db.find_company_id_by_phone(number) or "manual"
                    db.save_evolution_log(
                        direction="outbound", company_id=auto_company_id,
                        number=number, message_body=message_body,
                        message_id=message_id, status=status, raw_data=payload,
                    )
            elif event == "message.any" and not from_me:
                # Drop messages sent from another internal WAHA instance — avoids
                # mis-attributing test messages to a real company via jid_map.
                _sender_is_internal = bool(db.db.instances.find_one({"number": number}))
                if _sender_is_internal:
                    print(f"[WAHA Webhook] skipping internal-to-internal message from {number}")
                    return {"ok": True, "action": "ignored_internal"}
                company_id = db.find_company_id_by_phone(number)
                if not company_id:
                    company_id = _waha_auto_register_inbound(db, number, session_name)
                # Mark as seen + read (reduces spam-detection signals)
                try:
                    import requests as _wreq
                    from app.config import WAHA_API_URL, WAHA_API_KEY
                    _waha_hdrs = {"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"}
                    chat_id = payload.get("from", "")
                    if chat_id and session_name:
                        # Blue-tick read receipt to sender
                        _sr = _wreq.post(f"{WAHA_API_URL}/api/sendSeen",
                            json={"chatId": chat_id, "session": session_name},
                            headers=_waha_hdrs, timeout=4)
                        print(f"[WAHA Webhook] sendSeen → chat={chat_id} session={session_name} status={_sr.status_code}")
                        # Mark all unread messages in chat as read (clears unread badge)
                        _rr = _wreq.post(
                            f"{WAHA_API_URL}/api/{session_name}/chats/{chat_id}/messages/read",
                            json={},
                            headers=_waha_hdrs, timeout=4)
                        print(f"[WAHA Webhook] markRead → chat={chat_id} session={session_name} status={_rr.status_code}")
                except Exception as _se:
                    print(f"[WAHA Webhook] sendSeen/read failed: {_se}")
                # Trigger maintainPresenceOnline inside WAHA (PR #1586) — keeps session
                # warm so WhatsApp doesn't disconnect it due to inactivity.
                try:
                    from app.whatsapp_waha import WAHAClient as _WAHAClient
                    from app.config import WAHA_API_URL as _W_URL, WAHA_API_KEY as _W_KEY
                    _WAHAClient(_W_URL, _W_KEY, session_name).set_presence("available")
                except Exception:
                    pass
                log_id = db.save_evolution_log(
                    direction="inbound", company_id=company_id,
                    number=number, message_body=message_body,
                    message_id=message_id, message_type="conversation",
                    status="received", raw_data=payload, interactive=None,
                    instance_name=session_name,
                )
                # "manual" = contacto/grupo personal sin vincular a una empresa (ver
                # _waha_auto_register_inbound) — igual que "unknown", nunca debe entrar
                # a clasificación ni a seguimiento de IA. Sin esta exclusión, contenido
                # personal/de grupo terminaba mandándose al LLM real (confirmado en
                # producción: 326 mensajes analizados así antes de este fix).
                _ai_session_active = bool(db.db.ai_followup_sessions.find_one(
                    {"company_id": company_id, "status": {"$in": ["active", "waiting"]}}
                )) if company_id not in ("unknown", "manual") else False
                # Block classifier + AI for contacts auto-registered from inbound
                # (external numbers that wrote to us first) with no outbound history.
                _is_pure_inbound = False
                if company_id not in ("unknown", "manual"):
                    try:
                        from bson import ObjectId as _OId
                        _cmp_src = db.db.companies.find_one(
                            {"_id": _OId(company_id)}, {"source": 1}
                        )
                        if _cmp_src and _cmp_src.get("source") == "inbound_whatsapp":
                            _is_pure_inbound = not bool(db.db.message_logs.find_one(
                                {"company_id": company_id, "direction": "outbound"},
                                projection={"_id": 1},
                            ))
                    except Exception:
                        pass
                if message_body and company_id not in ("unknown", "manual") and not _ai_session_active and not _is_pure_inbound:
                    from app.llm import active_provider as _cls_provider
                    if _cls_provider() != "none":
                        from app.classifier import classify_or_copy_recent
                        # Naive-pero-UTC — is_business_hours() asume UTC cuando no hay tzinfo.
                        classify_or_copy_recent(db, background_tasks, log_id, company_id, message_body, datetime.now(timezone.utc).replace(tzinfo=None))
                from app.classifier import NON_TEXT_PLACEHOLDERS
                if message_body and message_body not in NON_TEXT_PLACEHOLDERS and company_id not in ("unknown", "manual") and not _is_pure_inbound:
                    try:
                        from app.llm import active_provider as _llm_provider
                        if _llm_provider() != "none":
                            _prefs_doc = db.db.conversation_ai_prefs.find_one({"company_id": company_id})
                            _prefs = _prefs_doc or {}
                            _should_enqueue = _prefs.get("ai_enabled", False)
                            _user_explicitly_disabled = _prefs_doc is not None and not _prefs.get("ai_enabled", True)
                            if not _should_enqueue and not _ai_session_active and not _user_explicitly_disabled:
                                from datetime import timedelta
                                _recent_ended = db.db.ai_followup_sessions.find_one({
                                    "company_id": company_id, "status": "ended",
                                    "last_activity": {"$gte": datetime.now() - timedelta(hours=2)},
                                }, projection={"_id": 1})
                                if not _recent_ended:
                                    _had_outbound = db.db.message_logs.find_one(
                                        {"company_id": company_id, "direction": "outbound",
                                         "created_at": {"$gte": datetime.now() - timedelta(days=7)}},
                                        projection={"_id": 1},
                                    )
                                    if _had_outbound:
                                        _should_enqueue = True
                            if _should_enqueue:
                                from app.followup_queue import enqueue as _ai_enqueue
                                _ai_enqueue(number, company_id, message_body, log_id)
                    except Exception as _fe:
                        print(f"[WAHA Webhook] followup_queue error: {_fe}")
            return {"ok": True, "action": "message_handled"}

        elif event == "message.ack":
            message_id = payload.get("id", "")
            ack_name   = payload.get("ackName", "")
            status = WAHA_ACK_MAP.get(ack_name, ack_name.lower() if ack_name else "")
            if message_id and status:
                db.update_evolution_message_status(message_id, status)
            return {"ok": True, "action": "ack_updated"}

        elif event == "session.status":
            status   = payload.get("status", "")
            me_id    = (me.get("id") or "").split("@")[0]
            _WAHA_STATUS_LABELS = {
                "STOPPED":      ("disconnected", "Detenida"),
                "STARTING":     ("starting",     "Iniciando"),
                "SCAN_QR_CODE": ("scan_qr",      "Esperando QR"),
                "WORKING":      ("connected",    "Conectada"),
                "FAILED":       ("failed",       "Error de conexión"),
            }
            reason_key, reason_label = _WAHA_STATUS_LABELS.get(status, (status.lower(), status))
            if status == "WORKING" and session_name:
                reachout = (payload.get("data") or {}).get("reachoutTimelock", {})
                timelock_active = reachout.get("isActive", False)
                timelock_ends   = reachout.get("timeEnforcementEnds")
                set_fields = {"number": me_id} if me_id else {}
                set_fields["reachout_timelock"] = timelock_active
                if timelock_ends:
                    set_fields["reachout_timelock_ends"] = timelock_ends
                unset_fields = {"disconnect_reason": "", "disconnect_reason_label": "",
                                "disconnect_code": "", "failed_restart_count": "", "last_failed_at": "",
                                "reachout_timelock_at": ""}
                if not timelock_active:
                    unset_fields["reachout_timelock_ends"] = ""
                db.db.instances.update_one(
                    {"name": session_name},
                    {"$set": set_fields, "$unset": unset_fields},
                )
                db.save_instance_health_log(session_name, "connected")
                if timelock_active:
                    print(f"[WAHA Webhook] session={session_name} WORKING ⛔ Reachout Timelock activo hasta {timelock_ends}")
                else:
                    print(f"[WAHA Webhook] session={session_name} WORKING number={me_id}")
            elif status in ("STOPPED", "FAILED") and session_name:
                inst_doc = db.db.instances.find_one(
                    {"name": session_name},
                    {"failed_restart_count": 1, "last_failed_at": 1, "reachout_timelock": 1}
                )
                if not inst_doc:
                    # Session exists in WAHA but not in our DB (orphaned / manually deleted).
                    # Do NOT restart it — that would perpetuate the loop forever.
                    print(f"[WAHA Webhook] {session_name} not in MongoDB — skipping restart (orphaned session, delete it from WAHA)")
                    return {"ok": True, "action": "ignored_orphan"}
                inst_doc = inst_doc or {}
                fail_count  = inst_doc.get("failed_restart_count", 0)
                last_fail   = inst_doc.get("last_failed_at")
                min_since   = ((datetime.now() - last_fail).total_seconds() / 60) if last_fail else 999
                db.db.instances.update_one(
                    {"name": session_name},
                    {"$set": {"disconnect_reason": reason_key, "disconnect_reason_label": reason_label,
                              "last_disconnect_at": datetime.now(), "last_failed_at": datetime.now()},
                     "$inc": {"failed_restart_count": 1}},
                )
                db.save_instance_health_log(session_name, "disconnected", reason=reason_key, reason_label=reason_label)
                print(f"[WAHA Webhook] session={session_name} {status} → {reason_label} (fail #{fail_count+1})")
                # Auto-restart with exponential backoff — max 3 attempts, min 5 min between restarts.
                # Skip if Reachout Timelock is active: session stays WORKING, FAILED here means
                # something else — restarting would break the timelock recovery.
                if inst_doc.get("reachout_timelock"):
                    print(f"[WAHA Webhook] {session_name} has Reachout Timelock — skipping auto-restart")
                elif status == "FAILED" and fail_count < 3 and min_since >= 5:
                    backoff_s = min(30 * (2 ** fail_count), 300)  # 30s → 60s → 120s
                    print(f"[WAHA Webhook] Auto-restart {session_name} in {backoff_s}s (attempt {fail_count+1}/3)")
                    background_tasks.add_task(_waha_auto_restart, session_name, backoff_s)
                elif status == "FAILED" and fail_count >= 3:
                    print(f"[WAHA Webhook] {session_name} failed 3+ times — force resetting session")
                    background_tasks.add_task(_waha_force_reset, session_name)
            return {"ok": True, "action": "session_status_updated"}

        return {"ok": True, "action": "ignored", "event": event}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/waha/session/create")
def api_waha_create_session(body: dict):
    """Create a WAHA session with webhook pre-configured. Mirrors /evolution/instance/create."""
    try:
        import requests as _req
        from app.config import WAHA_API_URL, WAHA_API_KEY, APP_PUBLIC_URL
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "name requerido")
        webhook_url = f"{APP_PUBLIC_URL}/api/waha/webhook"
        _hdrs = {"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"}
        _session_config = {
            "webhooks": [{"url": webhook_url,
                "events": ["message", "message.any", "message.ack", "session.status"]}],
            "noweb": {"store": {"enabled": True, "fullSync": False}},
        }
        r = _req.post(
            f"{WAHA_API_URL}/api/sessions",
            headers=_hdrs,
            json={"name": name, "config": _session_config},
            timeout=15,
        )
        if r.status_code == 422:
            # Session already exists — update webhook config then start
            _req.put(
                f"{WAHA_API_URL}/api/sessions/{name}",
                headers=_hdrs,
                json={"config": _session_config},
                timeout=15,
            )
        elif r.status_code not in (200, 201):
            raise HTTPException(500, f"WAHA error: {r.text[:200]}")
        # Start the session so it transitions to SCAN_QR_CODE (required before pairing-code)
        _req.post(f"{WAHA_API_URL}/api/sessions/{name}/start",
            headers=_hdrs, json={}, timeout=15)
        from datetime import datetime
        db = MongoDBManager()
        db.db.instances.update_one(
            {"name": name},
            {"$set": {"name": name, "provider": "waha"},
             "$setOnInsert": {"assigned_to": None, "assigned_name": None, "created_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
        return r.json()
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/waha/session/qr/{name}")
def api_waha_get_qr(name: str):
    """Get QR code for a WAHA session. Mirrors /evolution/instance/qr/{name}."""
    try:
        import requests as _req, base64
        from app.config import WAHA_API_URL, WAHA_API_KEY
        r = _req.get(f"{WAHA_API_URL}/api/{name}/auth/qr",
            headers={"X-Api-Key": WAHA_API_KEY}, params={"format": "image"}, timeout=15)
        if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image"):
            return {"base64": f"data:image/png;base64,{base64.b64encode(r.content).decode()}"}
        try:
            return r.json()
        except Exception:
            raise HTTPException(500, f"WAHA QR error: {r.text[:200]}")
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/waha/session/pairing-code/{name}")
def api_waha_pairing_code(name: str, body: dict):
    """Request phone-link pairing code. Mirrors /evolution/instance/pairing-code/{name}."""
    try:
        import requests as _req, time as _time
        from app.config import WAHA_API_URL, WAHA_API_KEY
        phone = str(body.get("phone", "")).strip().replace("+", "").replace(" ", "")
        if not phone:
            raise HTTPException(400, "phone requerido")
        _hdrs = {"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"}
        # Retry up to 6 times (12 s) while session is still STARTING / not yet SCAN_QR_CODE
        r = None
        for attempt in range(6):
            r = _req.post(f"{WAHA_API_URL}/api/{name}/auth/request-code",
                headers=_hdrs,
                json={"phoneNumber": phone, "method": None}, timeout=15)
            if r.ok:
                break
            if r.status_code == 404 and attempt < 5:
                print(f"[pairing-code] session {name} not ready (attempt {attempt+1}), retrying in 2s…")
                _time.sleep(2)
                continue
            raise HTTPException(r.status_code, f"WAHA error: {r.text[:200]}")
        data = r.json() if r.content else {}
        code = data if isinstance(data, str) else data.get("code") or data.get("pairingCode")
        return {"code": code} if code else data
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/waha/session/status/{name}")
def api_waha_get_status(name: str):
    """Get WAHA session status. Mirrors /evolution/instance/status/{name}."""
    try:
        import requests as _req
        from app.config import WAHA_API_URL, WAHA_API_KEY
        r = _req.get(f"{WAHA_API_URL}/api/sessions/{name}",
            headers={"X-Api-Key": WAHA_API_KEY}, timeout=10)
        data = r.json() if r.ok else {}
        waha_status = data.get("status", "unknown")
        data["state"] = "open" if waha_status == "WORKING" else "close"
        data["instance"] = {"instanceName": name, "state": data["state"]}
        db = MongoDBManager()
        # If WORKING, persist number from WAHA's `me` field (covers webhook-missing case in local dev)
        if waha_status == "WORKING":
            me = data.get("me") or {}
            me_number = (me.get("id") or "").split("@")[0]
            if me_number:
                db.db.instances.update_one({"name": name}, {"$set": {"number": me_number}})
                data["number"] = me_number
        inst_doc = db.db.instances.find_one({"name": name},
            {"_id": 0, "number": 1, "disconnect_reason": 1, "disconnect_reason_label": 1}) or {}
        if not data.get("number") and inst_doc.get("number"):
            data["number"] = inst_doc["number"]
        if inst_doc.get("disconnect_reason"):
            data["disconnect_reason"]       = inst_doc["disconnect_reason"]
            data["disconnect_reason_label"] = inst_doc.get("disconnect_reason_label", "Desconectada")
        return data
    except Exception as e: raise HTTPException(500, str(e))


@router.delete("/waha/session/{name}")
def api_waha_delete_session(name: str):
    """Delete a WAHA session. Mirrors /evolution/instance/{name} DELETE."""
    try:
        import requests as _req
        from app.config import WAHA_API_URL, WAHA_API_KEY
        r = _req.delete(f"{WAHA_API_URL}/api/sessions/{name}",
            headers={"X-Api-Key": WAHA_API_KEY}, timeout=10)
        db = MongoDBManager()
        db.db.instances.delete_one({"name": name})
        return {"ok": True, "status": r.status_code}
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/waha/session/logout/{name}")
def api_waha_logout_session(name: str):
    """Logout a WAHA session (clears auth, forces new QR). Mirrors /evolution/instance/logout/{name}."""
    try:
        import requests as _req
        from app.config import WAHA_API_URL, WAHA_API_KEY
        r = _req.post(f"{WAHA_API_URL}/api/sessions/{name}/logout",
            headers={"X-Api-Key": WAHA_API_KEY}, timeout=10)
        return {"ok": r.status_code in (200, 201), "status": r.status_code}
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/waha/session/restart/{name}")
def api_waha_restart_session(name: str):
    """Restart a WAHA session — moves it from FAILED/STOPPED back to STARTING → SCAN_QR_CODE."""
    try:
        import requests as _req
        from app.config import WAHA_API_URL, WAHA_API_KEY
        r = _req.post(f"{WAHA_API_URL}/api/sessions/{name}/restart",
            headers={"X-Api-Key": WAHA_API_KEY, "Content-Type": "application/json"},
            json={}, timeout=10)
        print(f"[WAHA] manual restart {name} → {r.status_code}")
        return {"ok": r.status_code in (200, 201), "status": r.status_code}
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/waha/instances/user-status")
def api_waha_user_status(x_user_token: Optional[str] = Header(None)):
    """Check WAHA connection status for instances assigned to the current user."""
    from app.auth import get_user_by_token
    from app.config import WAHA_API_URL, WAHA_API_KEY
    import requests as _req
    if not x_user_token:
        return {"connected": False, "connected_count": 0, "total": 0}
    user = get_user_by_token(x_user_token)
    if not user:
        return {"connected": False, "connected_count": 0, "total": 0}
    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    all_instances = list(db.db.instances.find(
        {"assigned_to": user_id, "provider": "waha"},
        {"_id": 0, "name": 1, "number": 1, "disconnect_reason": 1, "disconnect_reason_label": 1},
    )) if user_id else []
    if not all_instances:
        return {"connected": False, "connected_count": 0, "total": 0}
    try:
        r = _req.get(f"{WAHA_API_URL}/api/sessions",
            headers={"X-Api-Key": WAHA_API_KEY}, params={"all": "false"}, timeout=5)
        working_names = {s["name"] for s in (r.json() if r.ok else []) if s.get("status") == "WORKING"}
    except Exception:
        working_names = set()
    results = [i["name"] in working_names and bool(i.get("number")) for i in all_instances]
    connected_count = sum(results)
    first_disconnected = next(
        (i for i, ok in zip(all_instances, results) if not ok and i.get("disconnect_reason")), None
    )
    resp = {"connected": connected_count > 0, "connected_count": connected_count, "total": len(all_instances)}
    if first_disconnected:
        resp["disconnect_reason"]       = first_disconnected["disconnect_reason"]
        resp["disconnect_reason_label"] = first_disconnected.get("disconnect_reason_label", "")
    return resp


@router.post("/admin/instances/sync-waha")
def api_sync_waha_instances(x_user_token: Optional[str] = Header(None)):
    """Import all existing WAHA sessions into MongoDB. Mirrors /admin/instances/sync for Evolution."""
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    from app.config import WAHA_API_URL, WAHA_API_KEY
    from datetime import datetime
    r = _req.get(f"{WAHA_API_URL}/api/sessions",
        headers={"X-Api-Key": WAHA_API_KEY}, params={"all": "true"}, timeout=10)
    if not r.ok:
        raise HTTPException(500, f"WAHA error: {r.text[:200]}")
    db = MongoDBManager()
    imported = 0
    for sess in r.json():
        name = sess.get("name")
        if not name:
            continue
        me = sess.get("me") or {}
        number = (me.get("id") or "").split("@")[0]
        db.db.instances.update_one(
            {"name": name},
            {"$set": {"name": name, "provider": "waha", **({"number": number} if number else {})},
             "$setOnInsert": {"assigned_to": None, "assigned_name": None, "created_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
        imported += 1
    return {"ok": True, "imported": imported}

# ── WasenderAPI (SaaS WhatsApp provider) ─────────────────────────────────────

WASENDER_ACK_MAP = {
    0: "failed",
    1: "pending",
    2: "sent",
    3: "delivered",
    4: "read",
    5: "read",  # PLAYED
}

WASENDER_STATUS_MAP = {
    "connected":    ("connected",     "Conectada"),
    "connecting":   ("starting",      "Conectando"),
    "need_scan":    ("scan_qr",       "Esperando QR"),
    "need_passkey": ("scan_qr",       "Esperando clave"),
    "disconnected": ("disconnected",  "Desconectada"),
    "logged_out":   ("logged_out",    "Sesión cerrada"),
    "expired":      ("expired",       "Expirada"),
}


def _wasender_auto_register_inbound(db, number: str, instance_name: str = "") -> str:
    """Create a minimal company + contact record for an unknown inbound WasenderAPI number."""
    from datetime import datetime as _dt
    clean = "".join(filter(str.isdigit, number))
    existing = db.find_company_id_by_phone(clean)
    if existing:
        return existing
    display = f"+{clean}"
    company_id = db.insert_company({
        "name": display,
        "status": "inbound",
        "has_whatsapp": True,
        "source": "inbound_whatsapp",
        "via_instance": instance_name,
    })
    db.insert_contact({
        "company_id": company_id,
        "type": "whatsapp",
        "value": clean,
        "source": "inbound_whatsapp",
        "is_primary": True,
    })
    db.db.jid_map.update_one(
        {"jid": clean},
        {"$set": {"company_id": company_id, "updated_at": _dt.now()}},
        upsert=True,
    )
    print(f"[Wasender Webhook] Auto-registered inbound {display} → {company_id} (via {instance_name})")
    return company_id


@router.post("/wasender/webhook")
async def api_wasender_webhook(request: Request, background_tasks: BackgroundTasks):
    """Receive events from WasenderAPI. Verifies X-Wasender-Signature when secret is configured."""
    import json as _json
    from wasenderapi.webhook import WasenderWebhookEventType as _WE
    try:
        raw_body = await request.body()
        try:
            body = _json.loads(raw_body)
        except Exception:
            raise HTTPException(400, "invalid JSON")
        from datetime import datetime, timezone
        db = MongoDBManager()
        event = body.get("event", "")
        # sessionId in WasenderAPI webhooks = the session's api_key (hex string)
        session_api_key = body.get("sessionId", "")
        data = body.get("data") or {}
        if event not in ("messages-personal.received",):
            print(f"[Wasender Webhook] event={event} sessionId={session_api_key[:12]}…")

        # Resolve instance name and webhook secret from the api_key stored in MongoDB
        inst_doc = db.db.instances.find_one(
            {"wasender_api_key": session_api_key, "provider": "wasender"},
            {"name": 1, "wasender_webhook_secret": 1},
        ) if session_api_key else None
        instance_name = (inst_doc or {}).get("name", "")

        # WasenderAPI does not sign webhook requests — no signature verification needed

        if event == _WE.PERSONAL_MESSAGE_RECEIVED.value:
            msg = data.get("messages") or {}
            key = msg.get("key") or {}
            from_me = key.get("fromMe", False)
            remote_jid = key.get("remoteJid", "")
            message_id = key.get("id", "")
            message_body = msg.get("messageBody") or ""
            # Resolve @lid JIDs to phone numbers via WasenderAPI
            if "@lid" in remote_jid and session_api_key:
                try:
                    from app.config import WASENDER_BASE_URL
                    from app.whatsapp_wasender import WasenderClient as _WSC
                    _resolved = _WSC(WASENDER_BASE_URL, session_api_key, instance_name).resolve_lid(remote_jid)
                    if _resolved:
                        remote_jid = f"{_resolved}@s.whatsapp.net"
                except Exception:
                    pass
            # Strip @s.whatsapp.net / @c.us to get just digits
            number = remote_jid.replace("@s.whatsapp.net", "").replace("@c.us", "").split("@")[0]
            if event not in ("messages-personal.received",):
                print(f"[Wasender Webhook] msg from_me={from_me} number={number} body={str(message_body)[:80]}")

            if from_me:
                if message_id:
                    db.update_evolution_message_status(message_id, "sent")
                return {"ok": True, "action": "outbound_echo"}

            # Drop messages from other internal Wasender instances
            _sender_is_internal = bool(db.db.instances.find_one({"number": number}))
            if _sender_is_internal:
                print(f"[Wasender Webhook] skipping internal-to-internal message from {number}")
                return {"ok": True, "action": "ignored_internal"}

            company_id = db.find_company_id_by_phone(number)
            if not company_id:
                # Only auto-register if we previously contacted this number (prospect replying).
                # Personal contacts on the phone that we never messaged should be ignored.
                _clean10 = "".join(filter(str.isdigit, number))[-10:]
                _was_contacted = bool(db.db.message_logs.find_one({
                    "direction": "outbound",
                    "to_number": {"$regex": _clean10},
                }))
                if _was_contacted:
                    company_id = _wasender_auto_register_inbound(db, number, instance_name)
                else:
                    return {"ok": True, "action": "ignored_personal"}

            # Send read receipt
            if session_api_key and message_id and remote_jid:
                try:
                    from app.config import WASENDER_BASE_URL
                    from app.whatsapp_wasender import WasenderClient as _WSClient
                    _WSClient(WASENDER_BASE_URL, session_api_key, instance_name).mark_read(
                        message_id, remote_jid, from_me=False
                    )
                except Exception as _re:
                    print(f"[Wasender Webhook] mark_read failed: {_re}")

            log_id = db.save_evolution_log(
                direction="inbound", company_id=company_id,
                number=number, message_body=message_body,
                message_id=message_id, message_type="conversation",
                status="received", raw_data=data, interactive=None,
                instance_name=instance_name,
            )

            _ai_session_active = bool(db.db.ai_followup_sessions.find_one(
                {"company_id": company_id, "status": {"$in": ["active", "waiting"]}}
            )) if company_id not in ("unknown", "manual") else False
            if message_body and company_id not in ("unknown", "manual") and not _ai_session_active:
                from app.llm import active_provider as _cls_provider
                if _cls_provider() != "none":
                    from app.classifier import classify_or_copy_recent
                    classify_or_copy_recent(db, background_tasks, log_id, company_id, message_body, datetime.now(timezone.utc).replace(tzinfo=None))
            from app.classifier import NON_TEXT_PLACEHOLDERS
            if message_body and message_body not in NON_TEXT_PLACEHOLDERS and company_id not in ("unknown", "manual"):
                try:
                    from app.llm import active_provider as _llm_provider
                    if _llm_provider() != "none":
                        _prefs_doc = db.db.conversation_ai_prefs.find_one({"company_id": company_id})
                        _prefs = _prefs_doc or {}
                        _should_enqueue = _prefs.get("ai_enabled", False)
                        _user_explicitly_disabled = _prefs_doc is not None and not _prefs.get("ai_enabled", True)
                        if not _should_enqueue and not _ai_session_active and not _user_explicitly_disabled:
                            from datetime import timedelta
                            _recent_ended = db.db.ai_followup_sessions.find_one({
                                "company_id": company_id, "status": "ended",
                                "last_activity": {"$gte": datetime.now() - timedelta(hours=2)},
                            }, projection={"_id": 1})
                            if not _recent_ended:
                                _had_outbound = db.db.message_logs.find_one(
                                    {"company_id": company_id, "direction": "outbound",
                                     "created_at": {"$gte": datetime.now() - timedelta(days=7)}},
                                    projection={"_id": 1},
                                )
                                if _had_outbound:
                                    _should_enqueue = True
                        if _should_enqueue:
                            from app.followup_queue import enqueue as _ai_enqueue
                            _ai_enqueue(number, company_id, message_body, log_id)
                except Exception as _fe:
                    print(f"[Wasender Webhook] followup_queue error: {_fe}")
            return {"ok": True, "action": "message_handled"}

        elif event == _WE.MESSAGES_UPDATE.value:
            key = data.get("key") or {}
            message_id = key.get("id", "")
            ack_int = (data.get("update") or {}).get("status")
            if message_id and ack_int is not None:
                status = WASENDER_ACK_MAP.get(ack_int, "")
                if status:
                    db.update_evolution_message_status(message_id, status)
            return {"ok": True, "action": "ack_updated"}

        elif event == _WE.SESSION_STATUS.value:
            ws_status = (data.get("status") or "").lower()
            reason_key, reason_label = WASENDER_STATUS_MAP.get(ws_status, (ws_status, ws_status))
            if ws_status == "connected" and instance_name:
                db.db.instances.update_one(
                    {"name": instance_name},
                    {"$set": {"disconnect_reason": None, "disconnect_reason_label": None},
                     "$unset": {"last_disconnect_at": ""}},
                )
                db.save_instance_health_log(instance_name, "connected")
                print(f"[Wasender Webhook] session={instance_name} connected")
            elif ws_status in ("disconnected", "logged_out", "expired") and instance_name:
                db.db.instances.update_one(
                    {"name": instance_name},
                    {"$set": {"disconnect_reason": reason_key, "disconnect_reason_label": reason_label,
                              "last_disconnect_at": datetime.now()}},
                )
                db.save_instance_health_log(instance_name, "disconnected", reason=reason_key, reason_label=reason_label)
                print(f"[Wasender Webhook] session={instance_name} {ws_status} → {reason_label}")
            return {"ok": True, "action": "session_status_updated"}

        return {"ok": True, "action": "ignored", "event": event}
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wasender/session/create")
def api_wasender_create_session(body: dict):
    """Create a WasenderAPI session. Returns session details including api_key."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL, APP_PUBLIC_URL
        name = (body.get("name") or "").strip()
        phone_number = (body.get("phone_number") or "").strip()
        if not name:
            raise HTTPException(400, "name requerido")
        if not phone_number:
            raise HTTPException(400, "phone_number requerido")
        if not WASENDER_PAT:
            raise HTTPException(500, "WASENDER_PAT no configurado")
        webhook_url = f"{APP_PUBLIC_URL}/api/wasender/webhook"
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}", "Content-Type": "application/json"}
        r = _req.post(
            f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions",
            headers=_hdrs,
            json={
                "name": name,
                "phone_number": phone_number,
                "webhook_url": webhook_url,
                "webhook_enabled": True,
                "webhook_events": ["messages-personal.received", "messages.update", "session.status"],
                "always_online": True,
                "account_protection": True,
                "read_incoming_messages": False,
            },
            timeout=15,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(500, f"Wasender error: {r.text[:300]}")
        resp_data = r.json()
        session_info = resp_data.get("data") or resp_data
        wasender_id = session_info.get("id")
        api_key = session_info.get("api_key", "")
        webhook_secret = session_info.get("webhook_secret", "")
        from datetime import datetime
        db = MongoDBManager()
        db.db.instances.update_one(
            {"name": name},
            {"$set": {"name": name, "provider": "wasender",
                      "wasender_id": wasender_id,
                      "wasender_api_key": api_key,
                      "wasender_webhook_secret": webhook_secret},
             "$setOnInsert": {"assigned_to": None, "assigned_name": None,
                              "created_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
        # Auto-connect to trigger QR generation
        try:
            conn_r = _req.post(
                f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}/connect",
                headers=_hdrs, timeout=15,
            )
            if conn_r.ok:
                conn_data = (conn_r.json().get("data") or {})
                if conn_data.get("qrCode"):
                    session_info["qrCode"] = conn_data["qrCode"]
        except Exception:
            pass
        return session_info
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/wasender/session/qr/{wasender_id}")
def api_wasender_get_qr(wasender_id: int):
    """Get QR code for a WasenderAPI session. Returns base64 PNG."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}"}
        r = _req.get(f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}/qrcode",
            headers=_hdrs, timeout=15)
        if not r.ok:
            raise HTTPException(r.status_code, f"Wasender QR error: {r.text[:200]}")
        resp = r.json()
        qr_string = (resp.get("data") or resp).get("qrCode") or (resp.get("data") or resp).get("qr") or ""
        if not qr_string:
            return resp.get("data") or resp
        try:
            import qrcode, io, base64 as _b64
            img = qrcode.make(qr_string)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return {"base64": f"data:image/png;base64,{_b64.b64encode(buf.getvalue()).decode()}"}
        except ImportError:
            return {"qrString": qr_string}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/wasender/session/status/{wasender_id}")
def api_wasender_get_status(wasender_id: int):
    """Get WasenderAPI session status."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}"}
        r = _req.get(f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}",
            headers=_hdrs, timeout=10)
        data = r.json() if r.ok else {}
        session_info = data.get("data") or data
        ws_status = (session_info.get("status") or "").lower()
        session_info["state"] = "open" if ws_status == "connected" else "close"
        # Enrich with MongoDB data (phone number, disconnect reason)
        db = MongoDBManager()
        inst_doc = db.db.instances.find_one(
            {"wasender_id": wasender_id},
            {"_id": 0, "name": 1, "number": 1, "disconnect_reason": 1, "disconnect_reason_label": 1},
        ) or {}
        if ws_status == "connected":
            phone = session_info.get("phone_number", "")
            if phone:
                clean = "".join(filter(str.isdigit, phone))
                db.db.instances.update_one({"wasender_id": wasender_id}, {"$set": {"number": clean}})
                session_info["number"] = clean
        if not session_info.get("number") and inst_doc.get("number"):
            session_info["number"] = inst_doc["number"]
        if inst_doc.get("disconnect_reason"):
            session_info["disconnect_reason"] = inst_doc["disconnect_reason"]
            session_info["disconnect_reason_label"] = inst_doc.get("disconnect_reason_label", "Desconectada")
        return session_info
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.delete("/wasender/session/{wasender_id}")
def api_wasender_delete_session(wasender_id: int):
    """Delete a WasenderAPI session and remove from MongoDB."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}"}
        r = _req.delete(f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}",
            headers=_hdrs, timeout=15)
        db = MongoDBManager()
        db.db.instances.delete_one({"wasender_id": wasender_id})
        return {"ok": True, "status": r.status_code}
    except Exception as e: raise HTTPException(500, str(e))


@router.put("/wasender/session/{wasender_id}")
def api_wasender_update_session(wasender_id: int, body: dict):
    """Update WasenderAPI session settings (webhook, always_online, account_protection, etc.)."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}", "Content-Type": "application/json"}
        r = _req.put(
            f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}",
            headers=_hdrs,
            json=body,
            timeout=15,
        )
        if not r.ok:
            raise HTTPException(r.status_code, f"Wasender error: {r.text[:200]}")
        return r.json() if r.content else {"ok": True}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/wasender/session/{wasender_id}/connect")
def api_wasender_connect_session(wasender_id: int):
    """Initiate connection for a logged_out/disconnected session — removes proxy temporarily,
    calls /connect, then re-applies proxy so the QR scan goes through cleanly."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}", "Content-Type": "application/json"}
        _base = f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}"

        # Save current proxy_url so we can restore it after connect
        _sess_r = _req.get(_base, headers={"Authorization": f"Bearer {WASENDER_PAT}"}, timeout=5)
        _current_proxy = (_sess_r.json().get("data") or {}).get("proxy_url") if _sess_r.ok else None

        # Remove proxy temporarily (proxy blocks connect when bore tunnel is down)
        if _current_proxy:
            _req.put(_base, json={"proxy_url": None}, headers=_hdrs, timeout=5)

        # Initiate connection (generates QR)
        r = _req.post(f"{_base}/connect", json={"method": "qr"}, headers=_hdrs, timeout=15)

        # Restore proxy regardless of connect result
        if _current_proxy:
            _req.put(_base, json={"proxy_url": _current_proxy}, headers=_hdrs, timeout=5)

        if not r.ok:
            raise HTTPException(r.status_code, f"Wasender error: {r.text[:200]}")
        return r.json() if r.content else {"ok": True}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.post("/wasender/session/{wasender_id}/restart")
def api_wasender_restart_session(wasender_id: int):
    """Restart a connected WasenderAPI session (soft refresh, no QR re-scan needed)."""
    try:
        import requests as _req
        from app.config import WASENDER_PAT, WASENDER_BASE_URL
        _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}"}
        r = _req.post(
            f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{wasender_id}/restart",
            headers=_hdrs,
            timeout=15,
        )
        if not r.ok:
            raise HTTPException(r.status_code, f"Wasender error: {r.text[:200]}")
        return r.json() if r.content else {"ok": True}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))


@router.get("/wasender/instances/user-status")
def api_wasender_user_status(x_user_token: Optional[str] = Header(None)):
    """Check WasenderAPI connection status for instances assigned to the current user."""
    from app.auth import get_user_by_token
    from app.config import WASENDER_PAT, WASENDER_BASE_URL
    if not x_user_token:
        return {"connected": False, "connected_count": 0, "total": 0}
    user = get_user_by_token(x_user_token)
    if not user:
        return {"connected": False, "connected_count": 0, "total": 0}
    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    all_instances = list(db.db.instances.find(
        {"assigned_to": user_id, "provider": "wasender"},
        {"_id": 0, "name": 1, "number": 1, "wasender_id": 1, "disconnect_reason": 1, "disconnect_reason_label": 1},
    )) if user_id else []
    if not all_instances:
        return {"connected": False, "connected_count": 0, "total": 0}
    try:
        import requests as _req
        r = _req.get(f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions",
            headers={"Authorization": f"Bearer {WASENDER_PAT}"}, timeout=5)
        body = r.json() if r.ok else {}
        sessions = body.get("data", []) if isinstance(body, dict) else []
        connected_ids = {s["id"] for s in sessions if s.get("status") == "connected"}
    except Exception:
        connected_ids = set()
    results = [i.get("wasender_id") in connected_ids and bool(i.get("number")) for i in all_instances]
    connected_count = sum(results)
    first_disconnected = next(
        (i for i, ok in zip(all_instances, results) if not ok and i.get("disconnect_reason")), None
    )
    resp = {"connected": connected_count > 0, "connected_count": connected_count, "total": len(all_instances)}
    if first_disconnected:
        resp["disconnect_reason"] = first_disconnected["disconnect_reason"]
        resp["disconnect_reason_label"] = first_disconnected.get("disconnect_reason_label", "")
    return resp


@router.post("/admin/instances/sync-wasender")
def api_sync_wasender_instances(x_user_token: Optional[str] = Header(None)):
    """Import all existing WasenderAPI sessions into MongoDB."""
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    from app.config import WASENDER_PAT, WASENDER_BASE_URL
    from datetime import datetime
    _hdrs = {"Authorization": f"Bearer {WASENDER_PAT}"}
    r = _req.get(f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions", headers=_hdrs, timeout=10)
    if not r.ok:
        raise HTTPException(500, f"Wasender error: {r.text[:200]}")
    body = r.json()
    sessions = body.get("data", []) if isinstance(body, dict) else (body if isinstance(body, list) else [])
    db = MongoDBManager()
    imported = 0
    for sess in sessions:
        wasender_id = sess.get("id")
        name = sess.get("name") or f"wasender-{wasender_id}"
        api_key = sess.get("api_key", "")
        phone = sess.get("phone_number", "")
        clean_phone = "".join(filter(str.isdigit, phone)) if phone else ""
        db.db.instances.update_one(
            {"wasender_id": wasender_id},
            {"$set": {"name": name, "provider": "wasender",
                      "wasender_id": wasender_id, "wasender_api_key": api_key,
                      **({"number": clean_phone} if clean_phone else {})},
             "$setOnInsert": {"assigned_to": None, "assigned_name": None,
                              "created_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
        imported += 1
    return {"ok": True, "imported": imported}


@router.post("/admin/instances/sync-wwebjs")
def api_sync_wwebjs_instances(x_user_token: Optional[str] = Header(None)):
    """Sync all active wwebjs sessions from the Node service into MongoDB and update their status."""
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    from app.config import WWEBJS_URL as _ww_url
    from datetime import datetime
    r = _req.get(f"{_ww_url}/sessions", timeout=10)
    if not r.ok:
        raise HTTPException(500, f"wwebjs-service error: {r.text[:200]}")
    sessions = r.json()  # {sessionId: {status, phone}}
    db = MongoDBManager()
    synced = 0
    for session_id, info in sessions.items():
        status = info.get("status", "unknown")
        phone = info.get("phone") or ""
        update = {
            "name": session_id,
            "provider": "wwebjs",
            "disconnect_reason": None if status == "connected" else status,
            "updated_at": datetime.utcnow(),
        }
        if phone:
            update["number"] = phone
        db.db.instances.update_one(
            {"name": session_id},
            {"$set": update, "$setOnInsert": {"assigned_to": None, "assigned_name": None,
                                               "created_at": datetime.utcnow().isoformat()}},
            upsert=True,
        )
        synced += 1
    return {"ok": True, "synced": synced, "sessions": sessions}


# ── File upload / serve (GridFS) ──────────────────────────────────────────────

# ─── wwebjs endpoints ──────────────────────────────────────────────────────────

@router.post("/wwebjs/session/{session_id}/start")
def api_wwebjs_start(session_id: str):
    from app.whatsapp_wwebjs import start_session
    try:
        return start_session(session_id)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/wwebjs/session/{session_id}/status")
def api_wwebjs_status(session_id: str):
    from app.whatsapp_wwebjs import get_status
    try:
        return get_status(session_id)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/wwebjs/session/{session_id}/qr")
def api_wwebjs_qr(session_id: str):
    from app.whatsapp_wwebjs import get_qr
    try:
        return get_qr(session_id)
    except Exception as e:
        raise HTTPException(400, str(e))

@router.post("/wwebjs/bulk-verify")
def api_wwebjs_bulk_verify(body: dict, x_user_token: Optional[str] = Header(None)):
    """Verify a list of phone numbers against WhatsApp. Returns per-number result + caches in jid_map."""
    from app.auth import get_user_by_token
    from app.whatsapp_wwebjs import verify_number
    from app.config import WWEBJS_URL as _ww_url
    from datetime import datetime as _dt
    import concurrent.futures as _cf

    if not x_user_token or not get_user_by_token(x_user_token):
        raise HTTPException(status_code=401, detail="No autorizado")

    numbers: list = body.get("numbers") or []
    session: str = body.get("session") or ""
    if not numbers or not session:
        raise HTTPException(status_code=400, detail="numbers y session requeridos")
    if len(numbers) > 500:
        raise HTTPException(status_code=400, detail="Máximo 500 números por solicitud")

    _db = MongoDBManager()
    digits_map = {n: "".join(filter(str.isdigit, str(n))) for n in numbers}

    # Load cache
    cached_docs = {d["jid"]: d for d in _db.db.jid_map.find(
        {"jid": {"$in": list(digits_map.values())}, "wa_valid": {"$exists": True}},
        {"jid": 1, "wa_valid": 1},
    )}

    results = {}
    to_check = []
    for original, digits in digits_map.items():
        if digits in cached_docs:
            results[original] = {"valid": cached_docs[digits]["wa_valid"], "cached": True}
        else:
            to_check.append((original, digits))

    def _check(item):
        original, digits = item
        try:
            r = verify_number(session, digits)
            valid = bool(r.get("exists", False))
        except Exception:
            valid = None  # unknown
        return original, digits, valid

    with _cf.ThreadPoolExecutor(max_workers=8) as pool:
        for original, digits, valid in pool.map(_check, to_check):
            results[original] = {"valid": valid, "cached": False}
            if valid is not None:
                _db.db.jid_map.update_one(
                    {"jid": digits},
                    {"$set": {"wa_valid": valid, "wa_checked_at": _dt.utcnow()}},
                    upsert=True,
                )

    valid_count   = sum(1 for v in results.values() if v["valid"] is True)
    invalid_count = sum(1 for v in results.values() if v["valid"] is False)
    unknown_count = sum(1 for v in results.values() if v["valid"] is None)
    return {
        "total": len(numbers),
        "valid": valid_count,
        "invalid": invalid_count,
        "unknown": unknown_count,
        "results": results,
    }


@router.post("/wwebjs/session/create")
def api_wwebjs_create_session(body: dict):
    """Create a new wwebjs session in the service and register it in MongoDB."""
    import re as _re, requests as _req
    from app.config import WWEBJS_URL as _ww_url
    from datetime import datetime as _dt

    name = (body.get("name") or "").strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if not _re.match(r'^[a-z0-9][a-z0-9\-]{0,30}$', name):
        raise HTTPException(status_code=400, detail="Nombre inválido: solo minúsculas, números y guiones")

    _db = MongoDBManager()
    if _db.db.instances.find_one({"name": name}):
        raise HTTPException(status_code=409, detail=f"Ya existe una instancia con el nombre '{name}'")

    try:
        r = _req.post(f"{_ww_url}/session/{name}/start", timeout=15)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No se pudo contactar wwebjs-service: {e}")
    if not r.ok:
        raise HTTPException(status_code=500, detail=r.json().get("error", "Error en wwebjs-service"))

    _db.db.instances.insert_one({
        "name": name,
        "provider": "wwebjs",
        "status": "disconnected",
        "number": "",
        "assigned_to": None,
        "created_at": _dt.utcnow(),
    })
    return {"name": name, "status": r.json().get("status", "initializing")}


@router.delete("/wwebjs/session/{session_id}")
def api_wwebjs_delete(session_id: str):
    from app.whatsapp_wwebjs import delete_session
    try:
        delete_session(session_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/wwebjs/sessions")
def api_wwebjs_list():
    from app.whatsapp_wwebjs import list_sessions
    try:
        return list_sessions()
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/wwebjs/session/{session_id}/info")
def api_wwebjs_info(session_id: str):
    from app.whatsapp_wwebjs import get_info
    try:
        return get_info(session_id)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/wwebjs/session/{session_id}/verify")
def api_wwebjs_verify(session_id: str, body: dict):
    from app.whatsapp_wwebjs import verify_number
    phone = body.get("phone", "")
    if not phone:
        raise HTTPException(400, "phone required")
    try:
        return verify_number(session_id, phone)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/wwebjs/session/{session_id}/contact/save")
def api_wwebjs_save_contact(session_id: str, body: dict):
    from app.whatsapp_wwebjs import save_contact
    phone = body.get("phone", "")
    first_name = body.get("firstName") or body.get("first_name", "")
    last_name = body.get("lastName") or body.get("last_name", "")
    if not phone or not first_name:
        raise HTTPException(400, "phone and firstName required")
    try:
        return save_contact(session_id, phone, first_name, last_name)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/wwebjs/session/{session_id}/profile/status")
def api_wwebjs_profile_status(session_id: str, body: dict):
    from app.whatsapp_wwebjs import set_profile_status
    status_text = body.get("status", "")
    if not isinstance(status_text, str):
        raise HTTPException(400, "status string required")
    try:
        return set_profile_status(session_id, status_text)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/wwebjs/session/{session_id}/react")
def api_wwebjs_react(session_id: str, body: dict):
    from app.whatsapp_wwebjs import send_reaction
    message_id = body.get("messageId", "")
    emoji = body.get("emoji", "")
    if not message_id or not emoji:
        raise HTTPException(400, "messageId and emoji required")
    try:
        return send_reaction(session_id, message_id, emoji)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.get("/wwebjs/instances/user-status")
def api_wwebjs_user_status(x_user_token: Optional[str] = Header(None)):
    """Returns aggregate wwebjs connection status for all instances assigned to the user."""
    from app.auth import get_user_by_token
    from app.config import WWEBJS_URL as _ww_url
    import requests as _req
    from concurrent.futures import ThreadPoolExecutor

    if not x_user_token:
        return {"connected": False, "connected_count": 0, "total": 0}
    user = get_user_by_token(x_user_token)
    if not user:
        return {"connected": False, "connected_count": 0, "total": 0}

    db = MongoDBManager()
    user_id = user.get("id") or str(user.get("_id", ""))
    instances = list(db.db.instances.find(
        {"assigned_to": user_id, "provider": "wwebjs"},
        {"_id": 0, "name": 1, "number": 1, "disconnect_reason": 1},
    )) if user_id else []

    if not instances:
        return {"connected": False, "connected_count": 0, "total": 0}

    def _check(inst):
        try:
            r = _req.get(f"{_ww_url}/session/{inst['name']}/status", timeout=2)
            return r.ok and r.json().get("status") == "connected" and bool(inst.get("number"))
        except Exception:
            return False

    with ThreadPoolExecutor(max_workers=len(instances)) as ex:
        results = list(ex.map(_check, instances))

    connected_count = sum(1 for r in results if r)
    return {
        "connected": connected_count > 0,
        "connected_count": connected_count,
        "total": len(instances),
    }




@router.post("/wwebjs/webhook")
async def api_wwebjs_webhook(request: Request):
    body = await request.json()
    event = body.get("event", "")
    session_id = body.get("sessionId", "")
    data = body.get("data") or {}
    db = MongoDBManager()

    inst_doc = db.db.instances.find_one({"name": session_id, "provider": "wwebjs"})
    if not inst_doc:
        return {"ok": True, "action": "ignored_unknown_session"}
    instance_name = inst_doc["name"]

    if event == "session.status":
        status = data.get("status", "")
        label_map = {
            "connected": "Sesión activa",
            "disconnected": "Sesión desconectada",
            "auth_failure": "Fallo de autenticación",
        }
        print(f"[wwebjs Webhook] session={instance_name} {status} → {label_map.get(status, status)}")
        db.db.instances.update_one(
            {"name": instance_name},
            {"$set": {
                "status": status,
                "disconnect_reason": status if status != "connected" else None,
                "disconnect_reason_label": label_map.get(status, status),
            }},
        )
        if data.get("phone"):
            db.db.instances.update_one({"name": instance_name}, {"$set": {"number": data["phone"]}})
        return {"ok": True}

    if event == "message_ack":
        ack = data.get("ack") or 0
        if ack >= 2:
            # Delivered or read — clear degraded flag
            db.db.instances.update_one(
                {"name": instance_name},
                {"$set": {"ack_degraded": False}, "$unset": {"ack_degraded_since": ""}},
            )
            # Update delivery/read status in message_logs so the chat thread shows ticks
            if data.get("messageId"):
                status = "read" if ack >= 3 else "delivered"
                db.update_evolution_message_status(data["messageId"], status)
        elif ack == 1:
            # Only sent to server, not delivered — wwebjs-service tracks streak,
            # it fires session.degraded when threshold is hit
            pass
        return {"ok": True}

    if event == "session.degraded":
        from datetime import datetime as _dt
        db.db.instances.update_one(
            {"name": instance_name},
            {"$set": {"ack_degraded": True, "ack_degraded_since": _dt.utcnow()}},
        )
        _log.warning("[ACK Monitor] instance=%s degraded — consecutive undelivered messages", instance_name)
        return {"ok": True}

    if event == "messages.received":
        from_me = data.get("fromMe", False)
        number = data.get("number") or data.get("from", "").replace("@s.whatsapp.net", "").replace("@c.us", "")
        message_body = data.get("body", "")
        message_id = data.get("messageId", "")

        if from_me:
            if message_id:
                db.update_evolution_message_status(message_id, "sent")
            return {"ok": True, "action": "outbound_echo"}

        # Filter out WhatsApp status updates (stories)
        if data.get("isStatus") or "@broadcast" in data.get("from", "") or "@broadcast" in data.get("chatId", ""):
            return {"ok": True, "action": "ignored_status"}

        _sender_is_internal = bool(db.db.instances.find_one({"number": number}))
        if _sender_is_internal:
            return {"ok": True, "action": "ignored_internal"}

        company_id = db.find_company_id_by_phone(number)
        if not company_id:
            # Only auto-register if the system previously contacted this number.
            # Unknown external contacts that messaged us first are silently ignored.
            _clean10 = "".join(filter(str.isdigit, number))[-10:]
            _was_contacted = bool(db.db.message_logs.find_one(
                {"direction": "outbound", "to_number": {"$regex": _clean10}},
                projection={"_id": 1},
            ))
            if _was_contacted:
                company_id = _waha_auto_register_inbound(db, number, instance_name)
            else:
                return {"ok": True, "action": "ignored_personal"}

        # Fire-and-forget: mark chat as read after brief human delay (non-blocking)
        import threading as _threading
        def _do_mark_read():
            try:
                from app.whatsapp_wwebjs import mark_read
                mark_read(session_id, data.get("from", number))
            except Exception:
                pass
        _threading.Thread(target=_do_mark_read, daemon=True).start()

        log_id = db.save_evolution_log(
            direction="inbound",
            company_id=str(company_id),
            number=number,
            message_body=message_body,
            message_id=data.get("messageId"),
            message_type="conversation",
            status="received",
            instance_name=instance_name,
        )
        print(f"[wwebjs Webhook] inbound saved log_id={log_id} company={company_id} from={number}")

        if message_body and log_id and company_id not in ("unknown", "manual"):
            from datetime import datetime, timedelta, timezone
            from app.llm import active_provider as _wwebjs_cls_provider
            if _wwebjs_cls_provider() != "none":
                import threading as _wwebjs_t
                from app.classifier import classify_and_save as _wwebjs_classify
                _ts = data.get("timestamp")
                _received_at = (
                    datetime.fromtimestamp(int(_ts), tz=timezone.utc).replace(tzinfo=None)
                    if _ts else datetime.now(timezone.utc).replace(tzinfo=None)
                )
                _wwebjs_t.Thread(
                    target=_wwebjs_classify,
                    args=(log_id, str(company_id), message_body, _received_at),
                    daemon=True,
                ).start()

        # Block AI for contacts auto-registered from inbound with no outbound history
        _is_pure_inbound = False
        if company_id not in ("unknown", "manual"):
            try:
                from bson import ObjectId as _OId
                _cmp_src = db.db.companies.find_one({"_id": _OId(company_id)}, {"source": 1})
                if _cmp_src and _cmp_src.get("source") == "inbound_whatsapp":
                    _is_pure_inbound = not bool(db.db.message_logs.find_one(
                        {"company_id": company_id, "direction": "outbound"}, projection={"_id": 1}
                    ))
            except Exception:
                pass

        if message_body and company_id not in ("unknown", "manual") and log_id and not _is_pure_inbound:
            try:
                from app.llm import active_provider as _llm_provider
                if _llm_provider() != "none":
                    _ai_session_active = bool(db.db.ai_followup_sessions.find_one(
                        {"company_id": company_id, "status": {"$in": ["active", "waiting"]}}
                    ))
                    _prefs_doc = db.db.conversation_ai_prefs.find_one({"company_id": company_id})
                    _prefs = _prefs_doc or {}
                    _should_enqueue = _prefs.get("ai_enabled", False)
                    _user_explicitly_disabled = _prefs_doc is not None and not _prefs.get("ai_enabled", True)
                    if not _should_enqueue and not _ai_session_active and not _user_explicitly_disabled:
                        _had_outbound = db.db.message_logs.find_one(
                            {"company_id": company_id, "direction": "outbound",
                             "created_at": {"$gte": datetime.now() - timedelta(days=7)}},
                            projection={"_id": 1},
                        )
                        if _had_outbound:
                            _should_enqueue = True
                    if _should_enqueue:
                        from app.followup_queue import enqueue as _ai_enqueue
                        _ai_enqueue(number, company_id, message_body, log_id)
            except Exception as _fe:
                print(f"[wwebjs Webhook] followup_queue error: {_fe}")

        return {"ok": True, "action": "processed"}

    return {"ok": True, "action": "ignored"}


# ── Warmup endpoints ──────────────────────────────────────────────────────────

@router.get("/warmup/instances")
def warmup_get_instances(x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    from datetime import datetime as _dt
    db = MongoDBManager()
    # All wwebjs instances
    raw = list(db.db.instances.find(
        {"provider": "wwebjs"},
        {"name": 1, "number": 1, "label": 1, "peer_warmup_enabled": 1, "peer_warmup_paused": 1, "status": 1},
    ))

    # Live session statuses
    try:
        import requests as _r
        from app.whatsapp_wwebjs import _headers as _ww_headers
        _st = _r.get(f"{WWEBJS_URL}/sessions", headers=_ww_headers(), timeout=5).json()
    except Exception:
        _st = {}

    today = _dt.utcnow().strftime("%Y-%m-%d")

    result = []
    for inst in raw:
        name = inst["name"]
        live = _st.get(name, {})
        enabled = inst.get("peer_warmup_enabled") is not False
        paused  = bool(inst.get("peer_warmup_paused", False))
        connected = live.get("status") == "connected"

        if connected and enabled and not paused:
            warmup_status = "active"
        elif connected and enabled and paused:
            warmup_status = "paused"
        else:
            warmup_status = "disconnected"

        # Today's message count across sessions involving this instance
        msgs_today = 0
        sessions = list(db.db.warmup_sessions.find(
            {"date": today, "$or": [{"instance_a": name}, {"instance_b": name}]},
            {"total_messages_today": 1},
        ))
        for s in sessions:
            msgs_today += s.get("total_messages_today", 0)

        result.append({
            "name":    name,
            "label":   inst.get("label", name),
            "number":  inst.get("number", live.get("phone", "")),
            "enabled": enabled,
            "paused":  paused,
            "warmup_status": warmup_status,
            "msgs_today": msgs_today,
        })

    return result


@router.post("/warmup/instances/{name}/enable")
def warmup_enable_instance(name: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    db = MongoDBManager()
    db.db.instances.update_one(
        {"name": name, "provider": "wwebjs"},
        {"$set": {"peer_warmup_enabled": True, "peer_warmup_paused": False}},
    )
    return {"ok": True}


@router.post("/warmup/instances/{name}/disable")
def warmup_disable_instance(name: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    db = MongoDBManager()
    db.db.instances.update_one(
        {"name": name, "provider": "wwebjs"},
        {"$set": {"peer_warmup_enabled": False, "peer_warmup_paused": False}},
    )
    return {"ok": True}


@router.post("/warmup/instances/{name}/pause")
def warmup_pause_instance(name: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    db = MongoDBManager()
    db.db.instances.update_one(
        {"name": name, "provider": "wwebjs"},
        {"$set": {"peer_warmup_paused": True}},
    )
    return {"ok": True}


@router.post("/warmup/instances/{name}/resume")
def warmup_resume_instance(name: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    db = MongoDBManager()
    db.db.instances.update_one(
        {"name": name, "provider": "wwebjs"},
        {"$set": {"peer_warmup_paused": False}},
    )
    return {"ok": True}


@router.get("/warmup/sessions")
def warmup_get_sessions(x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    from datetime import datetime as _dt
    db = MongoDBManager()
    today = _dt.utcnow().strftime("%Y-%m-%d")
    sessions = list(db.db.warmup_sessions.find(
        {"date": today},
        {"instance_a": 1, "instance_b": 1, "total_messages_today": 1,
         "next_speaker": 1, "next_send_at": 1, "messages": {"$slice": -1}},
    ))
    for s in sessions:
        s["_id"] = str(s["_id"])
        if s.get("next_send_at"):
            s["next_send_at"] = s["next_send_at"].isoformat()
    return sessions


@router.get("/warmup/sessions/{session_id}/messages")
def warmup_get_messages(session_id: str, x_user_token: Optional[str] = Header(None)):
    _require_user(x_user_token)
    from bson import ObjectId
    db = MongoDBManager()
    session = db.db.warmup_sessions.find_one({"_id": ObjectId(session_id)})
    if not session:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Session not found")
    session["_id"] = str(session["_id"])
    if session.get("next_send_at"):
        session["next_send_at"] = session["next_send_at"].isoformat()
    if session.get("created_at"):
        session["created_at"] = session["created_at"].isoformat()
    for m in session.get("messages", []):
        if m.get("ts"):
            m["ts"] = m["ts"].isoformat()
    return session


@router.get("/warmup/chats/{instance_name}")
def warmup_get_instance_chats(instance_name: str, x_user_token: Optional[str] = Header(None)):
    """All warmup sessions involving an instance, newest first."""
    _require_user(x_user_token)
    db = MongoDBManager()
    sessions = list(db.db.warmup_sessions.find(
        {"$or": [{"instance_a": instance_name}, {"instance_b": instance_name}]},
        {"instance_a": 1, "instance_b": 1, "date": 1, "total_messages_today": 1,
         "messages": {"$slice": -1}},
        sort=[("date", -1)],
        limit=30,
    ))
    for s in sessions:
        s["_id"] = str(s["_id"])
    return sessions


_ALLOWED_MIME = {
    "image/jpeg", "image/png",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024    # 5 MB (WasenderAPI image limit)
_MAX_DOC_BYTES   = 100 * 1024 * 1024  # 100 MB (WasenderAPI document limit)


@router.post("/files/upload")
async def api_upload_file(file: UploadFile = File(...)):
    """Store an uploaded file in MongoDB GridFS and return its public URL.

    The URL (APP_PUBLIC_URL/api/files/{id}) is what you pass as imageUrl or
    documentUrl when calling /send-message — WasenderAPI fetches it directly.
    """
    from app.config import APP_PUBLIC_URL
    content_type = (file.content_type or "").split(";")[0].strip()
    if content_type not in _ALLOWED_MIME:
        raise HTTPException(400, f"Tipo de archivo no soportado: {content_type or 'desconocido'}")
    data = await file.read()
    is_image = content_type.startswith("image/")
    max_bytes = _MAX_IMAGE_BYTES if is_image else _MAX_DOC_BYTES
    if len(data) > max_bytes:
        limit_label = "5 MB" if is_image else "100 MB"
        raise HTTPException(413, f"Archivo demasiado grande — máximo {limit_label}")
    db = MongoDBManager()
    file_id = db.fs.put(data, filename=file.filename or "upload", content_type=content_type)
    url = f"{APP_PUBLIC_URL.rstrip('/')}/api/files/{file_id}"
    return {
        "file_id": str(file_id),
        "url": url,
        "filename": file.filename,
        "content_type": content_type,
        "size_bytes": len(data),
    }


@router.get("/files/{file_id}")
def api_serve_file(file_id: str):
    """Serve a GridFS file by ID. Called by WasenderAPI to download uploaded media."""
    import io
    from bson import ObjectId
    db = MongoDBManager()
    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(400, "file_id inválido")
    try:
        grid_out = db.fs.get(oid)
    except Exception:
        raise HTTPException(404, "Archivo no encontrado")
    data = grid_out.read()
    return StreamingResponse(
        io.BytesIO(data),
        media_type=grid_out.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{grid_out.filename}"',
            "Content-Length": str(len(data)),
            "Cache-Control": "public, max-age=86400",
        },
    )


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/stream")
async def api_analytics_stream():
    """SSE stream that pushes pending-analysis count every second.
    Frontend subscribes once and gets notified immediately when analysis finishes."""
    async def _generator():
        db = MongoDBManager()
        prev = -1
        for _ in range(600):  # max 10 minutes
            try:
                count = db.db.message_logs.count_documents({"analysis_status": "pending"})
            except Exception:
                count = 0
            if count != prev:
                prev = count
                yield f"data: {_json.dumps({'pending': count})}\n\n"
            if count == 0:
                break
            await asyncio.sleep(1)
        yield f"data: {_json.dumps({'pending': 0, 'closed': True})}\n\n"

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/analytics")
def api_get_analytics(
    page:      int = Query(1,  ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category:  str | None = Query(None),
):
    try:
        db = MongoDBManager()
        return serialize(db.get_analytics(page=page, page_size=page_size, category=category))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── One-time data cleanup ──────────────────────────────────────────────────────

@router.post("/admin/cleanup-contacts")
def api_cleanup_contacts():
    """
    One-time cleanup:
    1. Remove +521XXXXXXXXXX contacts when +52XXXXXXXXXX duplicate exists.
    2. Delete phantom outbound message_logs (empty body, to numbers not in contacts).
    """
    try:
        db = MongoDBManager()

        def _norm10(n):
            return (n or "").replace("+", "").replace(" ", "").replace("-", "")[-10:]

        # ── 1. Deduplicate +521 contacts ──────────────────────────────────────
        contacts_removed = 0
        all_wa = list(db.db.contacts.find({"type": "whatsapp"}, {"_id": 1, "company_id": 1, "value": 1}))

        # Group by (company_id, last-10-digits)
        from collections import defaultdict
        groups = defaultdict(list)
        for c in all_wa:
            key = (c["company_id"], _norm10(c["value"]))
            groups[key].append(c)

        ids_to_delete = []
        for (cid, n10), contacts in groups.items():
            if len(contacts) <= 1:
                continue
            digits_list = [(c, (c["value"] or "").replace("+","").replace(" ","").replace("-","")) for c in contacts]
            # Keep +52XXXXXXXXXX (12 digits); remove +521XXXXXXXXXX (13 digits)
            to_keep   = [c for c, d in digits_list if len(d) == 12]
            to_remove = [c for c, d in digits_list if len(d) == 13]
            if to_keep and to_remove:
                ids_to_delete.extend([c["_id"] for c in to_remove])

        if ids_to_delete:
            from bson import ObjectId
            db.db.contacts.delete_many({"_id": {"$in": ids_to_delete}})
            contacts_removed = len(ids_to_delete)

        # ── 2. Delete phantom outbound logs (empty body, number not in contacts) ──
        phantom_deleted = 0
        registered_nums = set(
            _norm10(c["value"])
            for c in db.db.contacts.find({"type": "whatsapp"}, {"value": 1})
        )
        phantoms = list(db.db.message_logs.find(
            {"direction": "outbound", "platform": "evolution",
             "$or": [{"message_body": ""}, {"message_body": {"$exists": False}}]},
            {"_id": 1, "to_number": 1}
        ))
        phantom_ids = [
            p["_id"] for p in phantoms
            if _norm10(p.get("to_number", "")) not in registered_nums
        ]
        if phantom_ids:
            db.db.message_logs.delete_many({"_id": {"$in": phantom_ids}})
            phantom_deleted = len(phantom_ids)

        return {
            "ok": True,
            "contacts_removed": contacts_removed,
            "phantom_logs_deleted": phantom_deleted,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Message Templates ─────────────────────────────────────────────────────────
# User-authored, reusable message variants. When a campaign selects 2+ of
# these, the scheduler sends a random variant per recipient instead of the
# same literal text to everyone — this is what keeps bulk sends from looking
# like a bot to WhatsApp (identical text to many numbers is a common ban
# trigger).

_DEFAULT_TEMPLATES = {
    "es": [
        # — Primer contacto —
        {
            "name": "Primer contacto — industria + ciudad",
            "text": "Hola 👋 vi su negocio de {{industria}} en {{ciudad}} y quería preguntar si tienen disponibilidad esta semana. ¿Me pueden compartir información?",
        },
        {
            "name": "Primer contacto — giro del negocio",
            "text": "Buenas, encontré su página de {{industria}} y me interesa cotizar el servicio. ¿Podrían darme más información?",
        },
        {
            "name": "Primer contacto — recomendación",
            "text": "Hola, me recomendaron su negocio de {{industria}} en {{ciudad}} 🙌 ¿Siguen atendiendo? Quisiera saber precios.",
        },
        {
            "name": "Primer contacto — directo al precio",
            "text": "Hola, ¿cuánto cobran por el servicio de {{industria}}? Estoy en {{ciudad}} y me interesa cotizar.",
        },
        {
            "name": "Primer contacto — tono formal",
            "text": "Buenos días, me comunico con ustedes para solicitar información sobre sus servicios de {{industria}}. Quedamos en espera de su respuesta. Saludos.",
        },
        # — Seguimiento —
        {
            "name": "Seguimiento — sin respuesta",
            "text": "Hola, le escribí hace unos días sobre {{industria}} en {{ciudad}}. ¿Tuvieron oportunidad de revisar mi mensaje? 😊",
        },
        {
            "name": "Seguimiento — segundo intento",
            "text": "Buenas tardes, intento contactarlos nuevamente. ¿Siguen ofreciendo el servicio de {{industria}}? Quedo pendiente.",
        },
        # — Interés específico —
        {
            "name": "Solicitud de catálogo",
            "text": "Hola 👋 ¿Podrían compartirme su catálogo o lista de precios de {{industria}}? Estoy comparando opciones en {{ciudad}}. Gracias.",
        },
        {
            "name": "Horario y disponibilidad",
            "text": "Hola, ¿cuál es su horario de atención? Quiero pasar a {{ciudad}} a conocer sus servicios de {{industria}}.",
        },
        {
            "name": "Pedido urgente",
            "text": "Buenas, necesito con urgencia el servicio de {{industria}} en {{ciudad}}. ¿Tienen disponibilidad hoy o mañana?",
        },
    ],
    "en": [
        {
            "name": "First contact — industry + city",
            "text": "Hi 👋 I saw your {{industria}} business in {{ciudad}} — do you have availability this week? Could you share more info?",
        },
        {
            "name": "First contact — business type",
            "text": "Hello, I found your {{industria}} page and I'm interested in a quote. Could you send me more details?",
        },
        {
            "name": "First contact — referral",
            "text": "Hi, someone recommended your {{industria}} business in {{ciudad}} 🙌 Are you still taking clients? I'd like to know pricing.",
        },
        {
            "name": "Follow-up — no reply",
            "text": "Hi, I reached out a few days ago about your {{industria}} services in {{ciudad}}. Did you get a chance to see my message? 😊",
        },
        {
            "name": "Price inquiry",
            "text": "Hello, could you share your pricing for {{industria}}? I'm based in {{ciudad}} and comparing options.",
        },
    ],
}


def _seed_default_message_templates(db, username: str, display_name: str = "", lang: str = "es"):
    from datetime import datetime
    now = datetime.now()
    templates = _DEFAULT_TEMPLATES.get(lang, _DEFAULT_TEMPLATES["es"])
    db.db.message_templates.insert_many([
        {**tpl, "created_at": now, "created_by_username": username, "created_by_name": display_name}
        for tpl in templates
    ])


@router.get("/admin/message-templates")
def api_list_message_templates(lang: str = "es", x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    username = user.get("username", "")
    try:
        db = MongoDBManager()
        docs = list(db.db.message_templates.find(
            {"created_by_username": username}, sort=[("created_at", -1)]
        ))
        if not docs:
            _seed_default_message_templates(db, username, user.get("display_name", ""), lang)
            docs = list(db.db.message_templates.find(
                {"created_by_username": username}, sort=[("created_at", -1)]
            ))
        return serialize(docs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/message-templates")
def api_create_message_template(body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    try:
        from datetime import datetime
        db = MongoDBManager()

        name = (body.get("name") or "").strip()
        text = (body.get("text") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El campo 'name' es requerido")
        if not text:
            raise HTTPException(status_code=400, detail="El campo 'text' es requerido")

        doc = {
            "name": name,
            "text": text,
            "created_at": datetime.now(),
            "created_by_username": user.get("username", ""),
            "created_by_name": user.get("display_name", ""),
        }
        result = db.db.message_templates.insert_one(doc)
        doc["_id"] = str(result.inserted_id)
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/admin/message-templates/{template_id}")
def api_update_message_template(template_id: str, body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    try:
        from bson import ObjectId
        from datetime import datetime
        db = MongoDBManager()

        doc = db.db.message_templates.find_one({"_id": ObjectId(template_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Plantilla no encontrada")
        if doc.get("created_by_username") != user.get("username", ""):
            raise HTTPException(status_code=403, detail="No tienes permiso para editar esta plantilla")

        update: dict = {}
        if "name" in body:
            name = str(body["name"]).strip()
            if not name:
                raise HTTPException(status_code=400, detail="El campo 'name' es requerido")
            update["name"] = name
        if "text" in body:
            text = str(body["text"]).strip()
            if not text:
                raise HTTPException(status_code=400, detail="El campo 'text' es requerido")
            update["text"] = text
        if not update:
            raise HTTPException(status_code=400, detail="No hay campos para actualizar")
        update["updated_at"] = datetime.now()

        db.db.message_templates.update_one({"_id": ObjectId(template_id)}, {"$set": update})
        updated = db.db.message_templates.find_one({"_id": ObjectId(template_id)})
        return serialize(updated)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/admin/message-templates/{template_id}")
def api_delete_message_template(template_id: str, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    try:
        from bson import ObjectId
        db = MongoDBManager()
        doc = db.db.message_templates.find_one({"_id": ObjectId(template_id)}, {"created_by_username": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Plantilla no encontrada")
        if doc.get("created_by_username") != user.get("username", ""):
            raise HTTPException(status_code=403, detail="No tienes permiso para eliminar esta plantilla")
        db.db.message_templates.delete_one({"_id": ObjectId(template_id)})
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Classifier settings (umbrales T1/T2 configurables — Settings > Clasificación) ──

@router.get("/admin/classifier-settings")
def api_get_classifier_settings(x_user_token: Optional[str] = Header(None)):
    """Cualquier usuario logueado puede VER los umbrales vigentes (útil para entender
    por qué se clasificó algo así); solo un admin puede cambiarlos (ver POST abajo)."""
    _require_user(x_user_token)
    try:
        return MongoDBManager().get_classifier_settings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/classifier-settings")
def api_save_classifier_settings(body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    try:
        # Clamp server-side — nunca confiar solo en los límites del slider del frontend,
        # ya que estos números deciden si algo se clasifica como humano o bot.
        values = {
            "t1_threshold_seconds":  max(3, min(60, int(body.get("t1_threshold_seconds", 10)))),
            "t2_threshold_seconds":  max(3, min(30, int(body.get("t2_threshold_seconds", 5)))),
            "probe_wait_hours":      max(0.5, min(24, float(body.get("probe_wait_hours", 1)))),
            "no_reply_wait_minutes": max(15, min(1440, int(body.get("no_reply_wait_minutes", 60)))),
        }
        db = MongoDBManager()
        db.save_classifier_settings(values)
        return values
    except HTTPException:
        raise
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Valor inválido: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Notifications ─────────────────────────────────────────────────────────────
# Simple count of recent inbound replies for the notification bell — companies
# that responded after we reached out. No read/unread persistence yet; this is
# a first pass (recent-activity count) ahead of building the full panel.

_NOTIFICATIONS_WINDOW_HOURS = 24


@router.get("/notifications/count")
def api_notifications_count(
    x_user_token: Optional[str] = Header(None),
    since: Optional[str] = None,
):
    _require_user(x_user_token)
    try:
        from datetime import datetime, timedelta
        db = MongoDBManager()
        window_cutoff = datetime.utcnow() - timedelta(hours=_NOTIFICATIONS_WINDOW_HOURS)
        cutoff = window_cutoff
        if since:
            try:
                since_dt = datetime.fromisoformat(since.rstrip("Z"))
                if since_dt > window_cutoff:
                    cutoff = since_dt
            except Exception:
                pass
        reply_count = db.db.message_logs.count_documents({
            "direction": "inbound",
            "created_at": {"$gte": cutoff},
            # Excluir remitentes no reconocidos (company_id="unknown") — no aparecen
            # en Chats (ver get_conversations) porque no hay empresa a la cual
            # asociarlos, así que tampoco deberían generar ruido en la campanita.
            "company_id": {"$nin": [None, "", "unknown", "undefined", "manual"]},
        })
        event_count = db.db.app_notifications.count_documents({
            "created_at": {"$gte": cutoff},
        })
        return {"count": reply_count + event_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/notifications")
def api_notifications_list(x_user_token: Optional[str] = Header(None)):
    """List recent inbound replies + synthetic events (batch-complete, schedule
    reminders) from the last _NOTIFICATIONS_WINDOW_HOURS, newest first."""
    _require_user(x_user_token)
    try:
        from datetime import datetime, timedelta
        from bson import ObjectId
        db = MongoDBManager()
        cutoff = datetime.utcnow() - timedelta(hours=_NOTIFICATIONS_WINDOW_HOURS)
        msgs = list(db.db.message_logs.find(
            {
                "direction": "inbound", "created_at": {"$gte": cutoff},
                "company_id": {"$nin": [None, "", "unknown", "undefined", "manual"]},
            },
            {"company_id": 1, "message_body": 1, "message_text": 1, "from_number": 1, "created_at": 1},
            sort=[("created_at", -1)],
            limit=50,
        ))

        safe_ids = []
        for m in msgs:
            try:
                safe_ids.append(ObjectId(m.get("company_id", "")))
            except Exception:
                pass
        companies = {
            str(c["_id"]): (c.get("name") or c.get("business_name") or "")
            for c in db.db.companies.find({"_id": {"$in": safe_ids}}, {"name": 1, "business_name": 1})
        }

        result = []
        for m in msgs:
            cid = str(m.get("company_id", ""))
            created_at = m.get("created_at")
            result.append({
                "_id": str(m["_id"]),
                "type": "reply",
                "company_id": cid,
                "company_name": companies.get(cid) or "Contacto",
                "message": (m.get("message_body") or m.get("message_text") or "")[:200],
                "from_number": m.get("from_number", ""),
                "created_at": created_at.isoformat() if created_at else None,
            })

        events = list(db.db.app_notifications.find(
            {"created_at": {"$gte": cutoff}},
            sort=[("created_at", -1)],
            limit=50,
        ))
        for e in events:
            created_at = e.get("created_at")
            scheduled_at = e.get("scheduled_at")
            result.append({
                "_id": str(e["_id"]),
                "type": e.get("type", "event"),
                "sent": e.get("sent", 0),
                "failed": e.get("failed", 0),
                "label": e.get("label", ""),
                "name": e.get("name", ""),
                "scheduled_send_id": e.get("scheduled_send_id", ""),
                "scheduled_at": scheduled_at.isoformat() if scheduled_at else None,
                "created_at": created_at.isoformat() if created_at else None,
                "instance": e.get("instance", ""),
                "cap": e.get("cap", 0),
            })

        result.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return result[:50]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notifications/batch-complete")
def api_notifications_batch_complete(body: dict, x_user_token: Optional[str] = Header(None)):
    """Called by the frontend send queue once every job in a bulk-send batch
    (Lote de URLs / Importar CSV / Buscar prospectos) has finished."""
    _require_user(x_user_token)
    try:
        from datetime import datetime
        db = MongoDBManager()
        db.db.app_notifications.insert_one({
            "type": "batch_complete",
            "sent": int(body.get("sent") or 0),
            "failed": int(body.get("failed") or 0),
            "label": (body.get("label") or "")[:80],
            "created_at": datetime.utcnow(),
        })
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Scheduled Sends ───────────────────────────────────────────────────────────

@router.get("/admin/companies-with-numbers")
def api_companies_with_numbers(x_user_token: Optional[str] = Header(None)):
    """Return all companies that have at least one WhatsApp contact.
    Each number is flagged if it already belongs to an active (pending/running) send."""
    _require_user(x_user_token)
    try:
        db = MongoDBManager()

        # Collect numbers currently in active campaigns
        active_numbers: set = set()
        active_sends = db.db.scheduled_sends.find(
            {"status": {"$in": ["pending", "running"]}},
            {"selected_numbers": 1},
        )
        for s in active_sends:
            for n in s.get("selected_numbers") or []:
                num = n.get("number", "")
                if num:
                    active_numbers.add(num)

        # Step 1: fetch all WA contacts (uses index on type)
        from collections import defaultdict
        from bson import ObjectId
        wa_contacts_raw = list(db.db.contacts.find(
            {"type": "whatsapp"},
            {"company_id": 1, "value": 1, "label": 1},
        ))
        contacts_by_company: dict = defaultdict(list)
        for ct in wa_contacts_raw:
            cid = ct.get("company_id", "")
            if cid:
                contacts_by_company[cid].append(ct)

        # Step 2: fetch only companies that have WA contacts (uses _id index)
        valid_oids = [ObjectId(cid) for cid in contacts_by_company if ObjectId.is_valid(cid)]
        companies_raw = list(db.db.companies.find(
            {"_id": {"$in": valid_oids}},
            {"name": 1, "business_name": 1, "industry": 1, "domain": 1, "website": 1, "city": 1},
            sort=[("name", 1)],
        ))

        result = []
        for c in companies_raw:
            cid_str = str(c["_id"])
            numbers = []
            for contact in contacts_by_company.get(cid_str, []):
                num = contact.get("value", "")
                numbers.append({
                    "contact_id": str(contact.get("_id", "")),
                    "number": num,
                    "label": contact.get("label", ""),
                    "active": num in active_numbers,
                })
            result.append({
                "_id": cid_str,
                "name": c.get("name") or c.get("business_name") or "",
                "industry": c.get("industry", ""),
                "domain": c.get("domain", ""),
                "website": c.get("website") or c.get("domain") or "",
                "city": c.get("city", ""),
                "numbers": numbers,
            })
        return result
    except Exception as e:
        import logging as _log2
        _log2.getLogger(__name__).exception("[companies-with-numbers] error")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin/scheduled-sends")
def api_list_scheduled_sends(x_user_token: Optional[str] = Header(None)):
    """List scheduled send campaigns belonging to the current user."""
    user = _require_user(x_user_token)
    try:
        db = MongoDBManager()
        username = user.get("username", "")
        docs = list(db.db.scheduled_sends.find(
            {"created_by_username": username},
            sort=[("scheduled_at", -1)],
        ))
        return serialize(docs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/scheduled-sends")
def api_create_scheduled_send(body: dict, x_user_token: Optional[str] = Header(None)):
    """Create a new scheduled send campaign."""
    user = _require_user(x_user_token)
    try:
        from datetime import datetime, timezone
        db = MongoDBManager()

        name = body.get("name", "").strip()
        industry = body.get("industry", "").strip()
        scheduled_at_str = body.get("scheduled_at", "")
        company_ids = body.get("company_ids") or []
        selected_numbers = body.get("selected_numbers") or []
        send_config = body.get("send_config") or {}

        # `messages`: one or more text variants. When 2+, the scheduler
        # rotates between them at random so not every recipient gets the
        # exact same text. `message` (singular) is kept accepted for
        # backwards compatibility with older frontend builds.
        raw_messages = body.get("messages")
        if raw_messages is None:
            single = (body.get("message") or "").strip()
            raw_messages = [single] if single else []
        messages = [m.strip() for m in raw_messages if isinstance(m, str) and m.strip()]

        if not name:
            raise HTTPException(status_code=400, detail="El campo 'name' es requerido")
        if not messages:
            raise HTTPException(status_code=400, detail="Agrega al menos un mensaje")
        if not scheduled_at_str:
            raise HTTPException(status_code=400, detail="El campo 'scheduled_at' es requerido")

        # Parse ISO datetime — support trailing Z and +offset
        scheduled_at_str_clean = scheduled_at_str.replace("Z", "+00:00")
        try:
            scheduled_at = datetime.fromisoformat(scheduled_at_str_clean)
            # Convert to naive UTC for consistent storage
            if scheduled_at.tzinfo is not None:
                scheduled_at = scheduled_at.astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de scheduled_at inválido (usa ISO 8601)")

        doc = {
            "name": name,
            "industry": industry,
            "company_ids": company_ids,
            "selected_numbers": selected_numbers,
            "messages": messages,
            "message": messages[0],  # kept for older UI/reporting code that reads a single preview text
            "scheduled_at": scheduled_at,
            "status": "pending",
            "sent_count": 0,
            "error_count": 0,
            "total_count": 0,
            "created_at": datetime.now(),
            "user_id": user.get("id") or str(user.get("_id", "")),
            "created_by_username": user.get("username", ""),
            "created_by_name": user.get("display_name", ""),
            "send_config": send_config,
        }
        result = db.db.scheduled_sends.insert_one(doc)
        doc["_id"] = str(result.inserted_id)
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/admin/scheduled-sends/{job_id}")
def api_get_scheduled_send(job_id: str, x_user_token: Optional[str] = Header(None)):
    """Get a single scheduled send job (used for live progress polling)."""
    _require_user(x_user_token)
    try:
        from bson import ObjectId
        db = MongoDBManager()
        doc = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Envio programado no encontrado")
        return serialize(doc)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/admin/scheduled-sends/{job_id}")
def api_update_scheduled_send(job_id: str, body: dict, x_user_token: Optional[str] = Header(None)):
    """Update a pending scheduled send (name, message, scheduled_at, selected_numbers)."""
    _require_user(x_user_token)
    try:
        from bson import ObjectId
        from datetime import datetime, timezone
        db = MongoDBManager()

        doc = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)}, {"status": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Envio programado no encontrado")
        if doc.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Solo se pueden editar envios pendientes")

        update: dict = {}
        if "name" in body:
            update["name"] = str(body["name"]).strip()
        if "messages" in body:
            messages = [m.strip() for m in (body["messages"] or []) if isinstance(m, str) and m.strip()]
            if not messages:
                raise HTTPException(status_code=400, detail="Agrega al menos un mensaje")
            update["messages"] = messages
            update["message"] = messages[0]
        elif "message" in body:
            single = str(body["message"]).strip()
            if not single:
                raise HTTPException(status_code=400, detail="Agrega al menos un mensaje")
            update["messages"] = [single]
            update["message"] = single
        if "selected_numbers" in body:
            update["selected_numbers"] = body["selected_numbers"]
        if "scheduled_at" in body:
            sat_str = str(body["scheduled_at"]).replace("Z", "+00:00")
            try:
                sat = datetime.fromisoformat(sat_str)
                if sat.tzinfo is not None:
                    sat = sat.astimezone(timezone.utc).replace(tzinfo=None)
            except ValueError:
                raise HTTPException(status_code=400, detail="Formato de scheduled_at inválido")
            update["scheduled_at"] = sat

        if not update:
            raise HTTPException(status_code=400, detail="No hay campos para actualizar")

        db.db.scheduled_sends.update_one(
            {"_id": ObjectId(job_id), "status": "pending"},
            {"$set": update},
        )
        updated = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)})
        return serialize(updated)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/admin/scheduled-sends/{job_id}")
def api_cancel_scheduled_send(job_id: str, x_user_token: Optional[str] = Header(None)):
    """Cancel pending/running sends; permanently delete finished ones."""
    _require_user(x_user_token)
    try:
        from bson import ObjectId
        from datetime import datetime
        db = MongoDBManager()

        doc = db.db.scheduled_sends.find_one({"_id": ObjectId(job_id)}, {"status": 1})
        if not doc:
            raise HTTPException(status_code=404, detail="Envio programado no encontrado")

        status = doc.get("status", "")
        if status in ("pending", "running"):
            db.db.scheduled_sends.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"status": "cancelled", "cancelled_at": datetime.now()}},
            )
            return {"ok": True, "action": "cancelled"}
        else:
            db.db.scheduled_sends.delete_one({"_id": ObjectId(job_id)})
            return {"ok": True, "action": "deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Analytics backfill ───────────────────────────────────────────────────────

_REQUEUE_BASE = {
    "direction": "inbound",
    "company_id": {"$exists": True, "$nin": [None, "unknown", "undefined", "manual"]},
    "message_body": {"$exists": True, "$ne": "[media]"},
}

def _build_requeue_filter():
    from datetime import datetime, timedelta
    stuck_threshold = datetime.utcnow() - timedelta(hours=1)
    return {
        **_REQUEUE_BASE,
        "$or": [
            # A: never touched
            {"analysis": {"$exists": False}, "analysis_status": {"$exists": False}},
            # B: stuck pending — queued but server died before processing (>1h ago)
            {"analysis_status": "pending", "analysis": {"$exists": False},
             "created_at": {"$lt": stuck_threshold}},
            # C: classify_and_save threw an exception
            {"analysis_status": "error"},
            # D: LLM returned an error payload that was saved
            {"analysis.error": True},
        ],
    }

@router.post("/admin/requeue-unanalyzed")
def api_requeue_unanalyzed(background_tasks: BackgroundTasks, limit: int = 20):
    """Find inbound messages with no valid analysis and re-run the classifier.
    Covers: never processed, stuck pending, classifier exception, LLM error payload.
    Processes at most `limit` per call; use `remaining` to know if another call is needed."""
    from app.classifier import classify_and_save, all_quota_exhausted
    from datetime import datetime, timezone
    if all_quota_exhausted():
        return {"ok": True, "queued": 0, "remaining": 0, "paused": True,
                "reason": "Todos los proveedores LLM sin cuota — reintenta en unos minutos."}
    db = MongoDBManager()
    requeue_filter = _build_requeue_filter()
    # Claim messages atomically one-by-one to prevent duplicate processing
    # from concurrent calls (e.g. React StrictMode double-mount).
    claimed = []
    for _ in range(limit):
        doc = db.db.message_logs.find_one_and_update(
            requeue_filter,
            {"$set": {"analysis_status": "pending", "pending_since": datetime.utcnow()}, "$unset": {"analysis": ""}},
            projection={"_id": 1, "company_id": 1, "message_body": 1, "created_at": 1},
            sort=[("created_at", -1)],
        )
        if not doc:
            break
        claimed.append(doc)
    for doc in claimed:
        log_id     = str(doc["_id"])
        company_id = str(doc["company_id"])
        body       = doc.get("message_body") or ""
        created    = doc.get("created_at") or datetime.now(timezone.utc).replace(tzinfo=None)
        background_tasks.add_task(classify_and_save, log_id, company_id, body, created)
    remaining = db.db.message_logs.count_documents(requeue_filter)
    return {"ok": True, "queued": len(claimed), "remaining": remaining}


@router.get("/admin/all-pending")
def api_all_pending():
    """DEV — list all message_logs with analysis_status pending."""
    db = MongoDBManager()
    docs = list(db.db.message_logs.find({"analysis_status": "pending"}, {"_id": 1, "company_id": 1, "message_body": 1}))
    for d in docs:
        d["_id"] = str(d["_id"])
    return {"count": len(docs), "docs": docs}


@router.post("/admin/reset-quota-circuit")
def api_reset_quota_circuit():
    """Reset the LLM circuit breaker so classification resumes immediately.
    Call this after adding credits or when the daily quota resets."""
    from app.classifier import reset_quota_circuit
    reset_quota_circuit()
    return {"ok": True, "message": "Circuit breaker reiniciado — clasificación reanudada."}


@router.post("/admin/reset-quota-exceeded")
def api_reset_quota_exceeded():
    """Reset quota_exceeded messages back to unanalyzed so requeue picks them up.
    Call this once the daily LLM quota resets (midnight UTC)."""
    db = MongoDBManager()
    result = db.db.message_logs.update_many(
        {"analysis_status": "quota_exceeded"},
        {"$unset": {"analysis_status": "", "analysis": ""}},
    )
    return {"ok": True, "reset": result.modified_count}


@router.post("/admin/cancel-pending")
def api_cancel_pending():
    """Mark all stuck 'pending' messages as 'quota_exceeded' to stop the analytics spinner.
    Use when background tasks are frozen (e.g. LLM quota hit) without a server restart."""
    from datetime import datetime, timedelta
    db = MongoDBManager()
    result = db.db.message_logs.update_many(
        {"analysis_status": "pending"},
        {"$set": {"analysis_status": "quota_exceeded"}, "$unset": {"analysis": "", "pending_since": ""}},
    )
    return {"ok": True, "cancelled": result.modified_count}


@router.delete("/admin/all-pending")
def api_delete_all_pending():
    """DEV ONLY — delete test docs and reset ALL orphaned pending to done."""
    db = MongoDBManager()
    deleted = db.db.message_logs.delete_many({"_test": True}).deleted_count
    reset   = db.db.message_logs.update_many(
        {"analysis_status": "pending"},
        {"$set": {"analysis_status": "done"}}
    ).modified_count
    return {"ok": True, "deleted_test": deleted, "reset_pending": reset}


# ── Instance Management ───────────────────────────────────────────────────────

@router.get("/admin/instances/health")
def api_instances_health(x_user_token: Optional[str] = Header(None),
                         hours: int = 24):
    """Returns uptime % and last event for each instance over the last N hours."""
    _require_user(x_user_token)
    db = MongoDBManager()
    names = [i["name"] for i in db.db.instances.find({}, {"_id": 0, "name": 1})]
    return db.get_instance_uptime(names, hours=hours)


@router.get("/admin/instances")
def api_list_instances(x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
    from app.config import WAHA_API_URL, WAHA_API_KEY
    from app.config import WASENDER_PAT, WASENDER_BASE_URL
    from app.config import WWEBJS_URL as _ww_url
    db = MongoDBManager()
    instances = list(db.db.instances.find({}, {"_id": 0}))

    def _get_live_status(inst):
        try:
            prov = inst.get("provider")
            if prov == "waha":
                r = _req.get(f"{WAHA_API_URL}/api/sessions/{inst['name']}",
                    headers={"X-Api-Key": WAHA_API_KEY}, timeout=3)
                waha_data = r.json() if r.ok else {}
                waha_st = waha_data.get("status", "unknown")
                inst["last_activity_at"] = waha_data.get("lastActivityTimestamp")
                return "open" if waha_st == "WORKING" else ("connecting" if waha_st in ("STARTING", "SCAN_QR_CODE") else "disconnected")
            elif prov == "wasender":
                _wid = inst.get("wasender_id")
                if _wid and WASENDER_PAT:
                    r = _req.get(
                        f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{_wid}",
                        headers={"Authorization": f"Bearer {WASENDER_PAT}"}, timeout=3)
                    ws_data = (r.json().get("data") or {}) if r.ok else {}
                    ws_st = ws_data.get("status", "unknown")
                    return "open" if ws_st == "connected" else (
                        "connecting" if ws_st in ("connecting", "need_scan") else "disconnected")
                return "unknown"
            elif prov == "wwebjs":
                r = _req.get(f"{_ww_url}/session/{inst['name']}/status", timeout=3)
                ww_data = r.json() if r.ok else {}
                ww_st = ww_data.get("status", "unknown")
                if ww_st in ("need_scan", "initializing", "authenticated"):
                    inst["live_status_detail"] = ww_st
                if ww_data.get("phone"):
                    inst["number"] = inst.get("number") or ww_data["phone"]
                return "connected" if ww_st == "connected" else (
                    "connecting" if ww_st in ("initializing", "authenticated", "need_scan") else "disconnected")
            else:
                r = _req.get(
                    f"{EVOLUTION_API_URL}/instance/connectionState/{inst['name']}",
                    headers={"apikey": EVOLUTION_API_KEY}, timeout=3)
                return r.json().get("instance", {}).get("state", "unknown") if r.ok else "unknown"
        except Exception:
            return "unknown"

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_get_live_status, inst): inst for inst in instances}
        for fut in as_completed(futures):
            futures[fut]["live_status"] = fut.result()

    return instances


@router.post("/admin/instances")
def api_create_instance(body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    name     = (body.get("name") or "").strip()
    number   = (body.get("number") or "").strip()
    provider = (body.get("provider") or "evolution").strip()
    if not name:
        raise HTTPException(400, "name requerido")
    import requests as _req
    from datetime import datetime
    db = MongoDBManager()

    if provider == "wwebjs":
        from app.config import WWEBJS_URL as _ww_url
        r = _req.post(f"{_ww_url}/session/{name}/start", timeout=10)
        if not r.ok:
            raise HTTPException(500, f"Error wwebjs-service: {r.text[:200]}")
        doc = {
            "name": name,
            "number": number,
            "provider": "wwebjs",
            "assigned_to": None,
            "assigned_name": None,
            "created_at": datetime.utcnow().isoformat(),
        }
        db.db.instances.update_one({"name": name}, {"$set": doc}, upsert=True)
        return {"ok": True, "instance": doc}

    from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
    r = _req.post(
        f"{EVOLUTION_API_URL}/instance/create",
        headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
        json={"instanceName": name, "integration": "WHATSAPP-BAILEYS", "qrcode": False},
        timeout=15,
    )
    if r.status_code not in (200, 201):
        raise HTTPException(500, f"Error Evolution API: {r.text[:200]}")
    evo_data = r.json()
    instance_token = (evo_data.get("instance", {}) or {}).get("token") or evo_data.get("hash") or ""
    doc = {
        "name": name,
        "number": number,
        "provider": "evolution",
        "instance_token": instance_token,
        "assigned_to": None,
        "assigned_name": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    db.db.instances.update_one({"name": name}, {"$set": doc}, upsert=True)
    return {"ok": True, "instance": doc, "instance_token": instance_token}


@router.delete("/admin/instances/{name}")
def api_delete_instance(name: str, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    db = MongoDBManager()
    inst_doc = db.db.instances.find_one({"name": name}, {"provider": 1, "wasender_id": 1}) or {}
    if inst_doc.get("provider") == "waha":
        from app.config import WAHA_API_URL, WAHA_API_KEY
        try:
            _req.delete(f"{WAHA_API_URL}/api/sessions/{name}",
                headers={"X-Api-Key": WAHA_API_KEY}, timeout=10)
        except Exception:
            pass
    elif inst_doc.get("provider") == "wasender":
        _wid = inst_doc.get("wasender_id")
        if _wid:
            from app.config import WASENDER_PAT, WASENDER_BASE_URL
            try:
                _req.delete(
                    f"{WASENDER_BASE_URL.rstrip('/')}/api/whatsapp-sessions/{_wid}",
                    headers={"Authorization": f"Bearer {WASENDER_PAT}"},
                    timeout=10,
                )
            except Exception:
                pass
    elif inst_doc.get("provider") == "wwebjs":
        from app.config import WWEBJS_URL as _ww_url
        try:
            _req.delete(f"{_ww_url}/session/{name}", timeout=10)
        except Exception:
            pass
    else:
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        try:
            _req.delete(f"{EVOLUTION_API_URL}/instance/delete/{name}",
                headers={"apikey": EVOLUTION_API_KEY}, timeout=10)
        except Exception:
            pass
    db.db.instances.delete_one({"name": name})
    return {"ok": True}


@router.patch("/admin/instances/{name}")
def api_patch_instance(name: str, body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    update = {}
    if "number" in body:
        update["number"] = str(body["number"]).strip().replace("+", "").replace(" ", "")
    if "label" in body:
        update["label"] = str(body["label"]).strip()
    if "provider" in body and body["provider"] in ("wwebjs", "wasender", "waha", "evolution"):
        update["provider"] = body["provider"]
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    db = MongoDBManager()
    db.db.instances.update_one({"name": name}, {"$set": update})
    return {"ok": True}


@router.post("/admin/instances/{name}/assign")
def api_assign_instance(name: str, body: dict, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    from bson import ObjectId
    db = MongoDBManager()
    user_id = body.get("user_id")
    if user_id:
        # Guard: max 5 instances per user
        already = db.db.instances.count_documents(
            {"assigned_to": user_id, "name": {"$ne": name}}
        )
        if already >= 5:
            raise HTTPException(
                status_code=409,
                detail="Este usuario ya tiene 5 instancias asignadas (máximo permitido).",
            )
        # Keep user.evolution_instance pointing to their first assigned instance (any provider)
        try:
            primary = db.db.instances.find_one(
                {"assigned_to": user_id}, {"name": 1}, sort=[("created_at", 1)]
            )
            if not primary:
                db.db.users.update_one(
                    {"_id": ObjectId(user_id)},
                    {"$set": {"evolution_instance": name}},
                )
        except Exception:
            pass
    else:
        # Removing assignment — clear primary instance ref on whoever had this instance
        old = db.db.instances.find_one({"name": name}, {"assigned_to": 1})
        if old and old.get("assigned_to"):
            try:
                remaining = db.db.instances.find_one(
                    {"assigned_to": old["assigned_to"], "name": {"$ne": name}},
                    {"name": 1}, sort=[("created_at", 1)]
                )
                db.db.users.update_one(
                    {"_id": ObjectId(old["assigned_to"])},
                    {"$set": {"evolution_instance": remaining["name"] if remaining else ""}},
                )
            except Exception:
                pass
    db.db.instances.update_one(
        {"name": name},
        {"$set": {"assigned_to": user_id, "assigned_name": body.get("user_name", "")}},
    )
    return {"ok": True}


@router.post("/admin/instances/{name}/unassign")
def api_unassign_instance(name: str, x_user_token: Optional[str] = Header(None)):
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    from bson import ObjectId
    db = MongoDBManager()
    old = db.db.instances.find_one({"name": name}, {"assigned_to": 1})
    if old and old.get("assigned_to"):
        try:
            remaining = db.db.instances.find_one(
                {"assigned_to": old["assigned_to"], "name": {"$ne": name}},
                {"name": 1}, sort=[("created_at", 1)]
            )
            db.db.users.update_one(
                {"_id": ObjectId(old["assigned_to"])},
                {"$set": {"evolution_instance": remaining["name"] if remaining else ""}},
            )
        except Exception:
            pass
    db.db.instances.update_one({"name": name}, {"$set": {"assigned_to": None, "assigned_name": None}})
    return {"ok": True}


@router.post("/otp/webhook")
def otp_webhook(body: dict):
    """
    Telcel (or any carrier) calls this endpoint when an SMS arrives.
    Expected body: { "to": "+521234567890", "text": "Your WhatsApp code is 123456" }
    """
    from app.otp_manager import handle_incoming_sms
    phone = body.get("to", "").replace("+", "").strip()
    text  = body.get("text", "")
    if not phone or not text:
        raise HTTPException(400, "to and text required")
    result = handle_incoming_sms(phone, text)
    return result


@router.post("/otp/start")
def otp_start(body: dict, x_user_token: Optional[str] = Header(None)):
    """
    Called from InstancesPanel when user wants to register a number via SMS.
    body: { "phone_number": "521234567890", "adb_port": 5554, "container_name": "android-1" }
    """
    _require_user(x_user_token)
    from app.otp_manager import start_registration
    phone     = body.get("phone_number", "").strip()
    adb_port  = int(body.get("adb_port", 5554))
    container = body.get("container_name", f"android-{adb_port}")
    if not phone:
        raise HTTPException(400, "phone_number required")
    start_registration(phone, adb_port, container)
    return {"ok": True, "phone_number": phone, "adb_port": adb_port}


@router.get("/otp/status/{phone_number}")
def otp_status(phone_number: str, x_user_token: Optional[str] = Header(None)):
    """Poll registration status for a phone number."""
    _require_user(x_user_token)
    from app.otp_manager import get_status
    status = get_status(phone_number)
    if not status:
        raise HTTPException(404, "No pending registration for this number")
    return status


@router.post("/admin/instances/sync")
def api_sync_instances(x_user_token: Optional[str] = Header(None)):
    """Import all existing Evolution instances into MongoDB (upsert — preserves assigned_to)."""
    user = _require_user(x_user_token)
    if user.get("role") != "admin":
        raise HTTPException(403, "Solo admins")
    import requests as _req
    from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
    from datetime import datetime
    r = _req.get(
        f"{EVOLUTION_API_URL}/instance/fetchInstances",
        headers={"apikey": EVOLUTION_API_KEY}, timeout=10,
    )
    if not r.ok:
        raise HTTPException(500, f"Evolution API error: {r.text[:200]}")
    raw = r.json()
    # Evolution returns either a list or {"instances": [...]}
    evo_list = raw if isinstance(raw, list) else raw.get("instances", [])
    db = MongoDBManager()
    imported = 0
    for item in evo_list:
        inst_obj = item.get("instance", item)
        name = inst_obj.get("instanceName") or item.get("instanceName") or item.get("name")
        if not name:
            continue
        # Extract phone number from owner JID (e.g. "5214428000000@s.whatsapp.net")
        owner = item.get("ownerJid") or item.get("owner") or inst_obj.get("ownerJid") or inst_obj.get("owner") or ""
        number = owner.split("@")[0] if "@" in owner else owner
        db.db.instances.update_one(
            {"name": name},
            {
                "$set": {"name": name, **({"number": number} if number else {})},
                "$setOnInsert": {
                    "assigned_to": None,
                    "assigned_name": None,
                    "created_at": datetime.utcnow().isoformat(),
                },
            },
            upsert=True,
        )
        imported += 1
    return {"ok": True, "imported": imported}


# ─── Telnyx OTP webhook (temporal — registro WhatsApp) ────────────────────────
# Guarda en memoria el último OTP recibido de Telnyx para que el script de
# registro en Hostinger pueda leerlo sin necesitar acceso SSH directo.
_telnyx_otp_store: dict = {}  # {"otp": "123456", "ts": "..."}

@router.post("/telnyx/inbound")
async def telnyx_inbound_webhook(request: Request):
    """Recibe el webhook de Telnyx con el SMS entrante y extrae el OTP."""
    import re as _re, datetime as _dt
    try:
        body = await request.json()
        # Telnyx envuelve el payload en data.payload
        payload = body.get("data", {}).get("payload", body)
        text = payload.get("text", "") or ""
        match = _re.search(r"\b(\d{6})\b", text)
        if match:
            _telnyx_otp_store["otp"] = match.group(1)
            _telnyx_otp_store["ts"]  = _dt.datetime.utcnow().isoformat()
    except Exception:
        pass
    return {"ok": True}

@router.get("/telnyx/otp")
def telnyx_get_otp():
    """Devuelve el último OTP recibido (el script de registro lo pollea)."""
    return _telnyx_otp_store or {"otp": None}
