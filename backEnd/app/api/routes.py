from fastapi import APIRouter, HTTPException, Query, BackgroundTasks, Header
from typing import Optional
from app.schemas.company import (
    ProcessUrlRequest, SearchRequest, BatchRequest,
    CheckUrlsRequest, DeleteCompaniesRequest, UpdateCompanyRequest,
    N8nMessageSentRequest, N8nMessageReceivedRequest,
    EvolutionWebhookRequest, SendMessageRequest, ReportRequest,
    UpdateContactsRequest,
)
from app.utils import serialize
from app.pipeline import process_url, run_pipeline_batch   # ← app.pipeline
from app.searcher import search_prospects                   # ← app.searcher
from app.database import MongoDBManager

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
        return serialize(process_url(req.url, message_template=req.message_template, skip_send=req.skip_send, user_token=x_user_token))
    except Exception as e:
        msg = str(e)
        status = 422 if any(k in msg.lower() for k in ("no response", "http error", "timeout", "connection", "name or service")) else 500
        raise HTTPException(status_code=status, detail=msg)

@router.post("/send-message")
def api_send_message(req: SendMessageRequest, x_user_token: Optional[str] = Header(None)):
    try:
        from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE
        from app.whatsapp_evolution import EvolutionClient
        from app.auth import get_user_by_token
        from app.database import MongoDBManager
        db = MongoDBManager()
        if not EVOLUTION_API_KEY:
            raise HTTPException(status_code=400, detail="Evolution API no configurada")
        # Usar instancia del usuario logueado si existe, sino la global
        instance = EVOLUTION_INSTANCE
        if x_user_token:
            user = get_user_by_token(x_user_token)
            if user and user.get("evolution_instance"):
                instance = user["evolution_instance"]
        if not instance:
            raise HTTPException(status_code=400, detail="Sin instancia de WhatsApp configurada")
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, instance)
        evo_result = evo.send_text(req.to_number, req.message)
        print(f"[SendMsg] to={req.to_number} status_code={evo_result.get('status_code')} raw={evo_result.get('raw_text','')[:300]}")
        evo_json = evo_result.get("response_json", {})
        message_id = evo_json.get("key", {}).get("id") or evo_json.get("id")
        status = "sent" if evo_result.get("status_code") in (200, 201) else "failed"
        log_doc = {
            "channel": "whatsapp", "platform": "evolution", "direction": "outbound",
            "company_id": req.company_id, "to_number": req.to_number,
            "message_body": req.message, "message_text": req.message, "message_id": message_id,
            "status_code": evo_result.get("status_code"),
            "api_response": evo_json, "status": status,
            "sent_at": evo_result.get("sent_at"),
        }
        if x_user_token:
            sender = get_user_by_token(x_user_token)
            if sender:
                log_doc["sent_by_username"] = sender.get("username", "")
                log_doc["sent_by_name"]     = sender.get("display_name", "")
        log_id = db.insert_message_log(log_doc)
        return {"ok": True, "status": status, "log_id": log_id, "message_id": message_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search")
def api_search(req: SearchRequest):
    try:
        db = MongoDBManager()
        known = db.get_all_scraped_domains()
        urls  = search_prospects(
            req.industry, req.city or "", req.keywords or "",
            req.num_results, req.offset or 0,
            exclude_domains=known,
        )
        return {"urls": urls}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/companies/check-contacted")
def api_check_contacted(body: dict):
    """Returns contact history for a list of company_ids or domains."""
    try:
        from datetime import datetime
        db = MongoDBManager()
        company_ids = body.get("company_ids", [])
        result = {}
        for cid in company_ids:
            first = db.db.message_logs.find_one(
                {"company_id": cid, "direction": "outbound"},
                sort=[("created_at", 1)],
                projection={"sent_by_name": 1, "sent_by_username": 1, "created_at": 1}
            )
            if first:
                result[cid] = {
                    "contacted": True,
                    "by_name":     first.get("sent_by_name", ""),
                    "by_username": first.get("sent_by_username", ""),
                    "at":          first["created_at"].isoformat() if first.get("created_at") else None,
                }
            else:
                result[cid] = {"contacted": False}
        return result
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
        return serialize(data)
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
    """Fetch missing messages from Evolution API and save them to message_logs."""
    try:
        from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE, GROQ_API_KEY
        from app.whatsapp_evolution import EvolutionClient
        from datetime import datetime

        if not EVOLUTION_API_KEY or not EVOLUTION_INSTANCE:
            raise HTTPException(status_code=400, detail="Evolution API no configurada")

        db  = MongoDBManager()
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE)

        # Get company WhatsApp numbers
        contacts = list(db.db.contacts.find({"company_id": company_id, "type": "whatsapp"}))
        if not contacts:
            return {"synced": 0, "message": "Sin números WhatsApp registrados"}

        synced = 0
        for contact in contacts:
            number = contact.get("value", "")
            if not number:
                continue

            # Fecha del primer mensaje que enviamos a este número
            first_outbound = db.db.message_logs.find_one(
                {"company_id": company_id, "direction": "outbound",
                 "$or": [{"to_number": number}, {"number": number}]},
                sort=[("created_at", 1)]
            )
            cutoff = first_outbound["created_at"] if first_outbound else None

            messages = evo.fetch_messages(number, limit=100)
            for m in messages:
                key      = m.get("key", {})
                msg_id   = key.get("id", "")
                from_me  = key.get("fromMe", False)
                if not msg_id:
                    continue

                ts = m.get("messageTimestamp")
                created = datetime.fromtimestamp(int(ts)) if ts else datetime.now()

                # Ignorar mensajes anteriores al primer outbound (conversaciones personales)
                if cutoff and created < cutoff:
                    continue

                # Skip if already stored
                if db.db.message_logs.find_one({"message_id": msg_id}):
                    continue

                # Extract body
                msg_obj  = m.get("message", {})
                body     = (msg_obj.get("conversation")
                            or msg_obj.get("extendedTextMessage", {}).get("text")
                            or msg_obj.get("imageMessage", {}).get("caption")
                            or ("" if not msg_obj else "[media]"))

                log_id = db.save_evolution_log(
                    direction  = "outbound" if from_me else "inbound",
                    company_id = company_id,
                    number     = number,
                    message_body = body,
                    message_id = msg_id,
                    message_type = m.get("messageType", "conversation"),
                    status     = "synced",
                    raw_data   = m,
                )

                # Auto-classify new inbound messages
                if not from_me and body and body != "[media]" and GROQ_API_KEY:
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

@router.get("/conversations/{company_id}")
def api_get_conversation_thread(company_id: str):
    try:
        db = MongoDBManager()
        return serialize(db.get_conversation_thread(company_id))
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
        interactive = {"type": "buttons", "text": body, "options": [b for b in btns if b]} if btns else None
        return body, interactive

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
        return text, interactive

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
        from app.config import GROQ_API_KEY
        from datetime import datetime
        db = MongoDBManager()
        event = req.event
        data = req.data or {}

        if event == "messages.upsert":
            key = data.get("key", {})
            from_me = key.get("fromMe", False)
            remote_jid = key.get("remoteJid", "")
            message_id = key.get("id", "")
            number = remote_jid.split("@")[0]
            message_obj = data.get("message", {})
            message_body, interactive_data = _extract_body_and_interactive(message_obj)
            message_type = data.get("messageType", "conversation")
            status_raw = data.get("status", "PENDING")
            status = STATUS_MAP.get(status_raw, status_raw.lower())

            if from_me:
                # Outbound — try to update existing pipeline log, otherwise create new entry
                updated = db.update_evolution_message_status(message_id, status) if message_id else False
                if not updated:
                    # Try to link to a company by destination number
                    auto_company_id = db.find_company_id_by_phone(number) or "manual"
                    db.save_evolution_log(
                        direction="outbound",
                        company_id=auto_company_id,
                        number=number,
                        message_body=message_body,
                        message_id=message_id,
                        status=status,
                        raw_data=data,
                    )
                return {"ok": True, "action": "outbound_logged"}
            else:
                # Inbound reply from prospect
                company_id = db.find_company_id_by_phone(number) or "unknown"
                log_id = db.save_evolution_log(
                    direction="inbound",
                    company_id=company_id,
                    number=number,
                    message_body=message_body,
                    message_id=message_id,
                    message_type=message_type,
                    status="received",
                    raw_data=data,
                    interactive=interactive_data,
                )
                if GROQ_API_KEY and message_body and company_id != "unknown":
                    from app.classifier import classify_and_save
                    background_tasks.add_task(classify_and_save, log_id, company_id, message_body, datetime.now())
                return {"ok": True, "action": "inbound_saved", "log_id": log_id, "company_id": company_id}

        elif event == "messages.update":
            updates = data if isinstance(data, list) else [data]
            for upd in updates:
                key = upd.get("key", {})
                message_id = key.get("id", "")
                status_raw = upd.get("update", {}).get("status", "")
                status = STATUS_MAP.get(status_raw, status_raw.lower())
                if message_id and status:
                    db.update_evolution_message_status(message_id, status)
            return {"ok": True, "action": "status_updated"}

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
        scraper = WebsiteScraper()
        result  = scraper.scrape_site(website, force=True)

        # Update the correct DB (scraper uses 'comercial', app uses 'commercial')
        update_fields = {"updated_at": datetime.now()}
        for field in ("name", "industry", "description", "city", "state", "country",
                      "address", "phone_numbers", "whatsapp_numbers", "all_whatsapp_numbers",
                      "has_whatsapp", "business_hours", "services", "products"):
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

        analytics_raw  = db.get_analytics(page=1, page_size=9999)
        analytics_list = analytics_raw.get("items", analytics_raw) if isinstance(analytics_raw, dict) else analytics_raw
        analytics = next((a for a in analytics_list if a.get("company_id") == company_id), {})

        thread = db.get_conversation_thread(company_id)

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
        name = body.get("instanceName", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="instanceName requerido")
        r = _req.post(f"{EVOLUTION_API_URL}/instance/create",
            headers={"apikey": EVOLUTION_API_KEY, "Content-Type": "application/json"},
            json={"instanceName": name, "qrcode": True, "integration": "WHATSAPP-BAILEYS"},
            timeout=15)
        return r.json()
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.get("/evolution/instance/qr/{name}")
def api_evo_get_qr(name: str):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        r = _req.get(f"{EVOLUTION_API_URL}/instance/connect/{name}",
            headers={"apikey": EVOLUTION_API_KEY}, timeout=10)
        return r.json()
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.get("/evolution/instance/status/{name}")
def api_evo_get_status(name: str):
    try:
        import requests as _req
        from app.config import EVOLUTION_API_URL, EVOLUTION_API_KEY
        r = _req.get(f"{EVOLUTION_API_URL}/instance/connectionState/{name}",
            headers={"apikey": EVOLUTION_API_KEY}, timeout=10)
        return r.json()
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

# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics")
def api_get_analytics(
    page:      int = Query(1,  ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    try:
        db = MongoDBManager()
        return serialize(db.get_analytics(page=page, page_size=page_size))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))