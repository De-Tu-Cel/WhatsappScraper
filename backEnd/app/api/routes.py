from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
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

@router.post("/process-url")
def api_process_url(req: ProcessUrlRequest):
    try:
        return serialize(process_url(req.url, message_template=req.message_template, skip_send=req.skip_send))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/send-message")
def api_send_message(req: SendMessageRequest):
    try:
        from app.config import EVOLUTION_API_KEY, EVOLUTION_API_URL, EVOLUTION_INSTANCE
        from app.whatsapp_evolution import EvolutionClient
        from app.database import MongoDBManager
        db = MongoDBManager()
        if not EVOLUTION_API_KEY or not EVOLUTION_INSTANCE:
            raise HTTPException(status_code=400, detail="Evolution API no configurada")
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE)
        evo_result = evo.send_text(req.to_number, req.message)
        evo_json = evo_result.get("response_json", {})
        message_id = evo_json.get("key", {}).get("id") or evo_json.get("id")
        status = "sent" if evo_result.get("status_code") == 201 else "failed"
        log_id = db.insert_message_log({
            "channel": "whatsapp", "platform": "evolution", "direction": "outbound",
            "company_id": req.company_id, "to_number": req.to_number,
            "message_text": req.message, "message_id": message_id,
            "status_code": evo_result.get("status_code"),
            "api_response": evo_json, "status": status,
            "sent_at": evo_result.get("sent_at"),
        })
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
    return (
        message_obj.get("conversation")
        or message_obj.get("extendedTextMessage", {}).get("text")
        or message_obj.get("imageMessage", {}).get("caption")
        or message_obj.get("videoMessage", {}).get("caption")
        or message_obj.get("documentMessage", {}).get("caption")
        or message_obj.get("audioMessage") and "[audio]"
        or message_obj.get("stickerMessage") and "[sticker]"
        or message_obj.get("locationMessage") and "[location]"
        or message_obj.get("contactMessage") and "[contact]"
        or ""
    )

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
            message_body = _extract_body(message_obj)
            message_type = data.get("messageType", "conversation")
            status_raw = data.get("status", "PENDING")
            status = STATUS_MAP.get(status_raw, status_raw.lower())

            if from_me:
                # Outbound — try to update existing pipeline log, otherwise create new entry
                updated = db.update_evolution_message_status(message_id, status) if message_id else False
                if not updated:
                    db.save_evolution_log(
                        direction="outbound",
                        company_id="manual",
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

        analytics_list = db.get_analytics()
        analytics = next((a for a in analytics_list if a.get("company_id") == company_id), {})

        thread = db.get_conversation_thread(company_id)

        pdf_buf = generate_report(
            company=serialize(company),
            analytics=analytics,
            thread=thread,
            screenshot_b64=req.screenshot_b64,
        )

        company_name = (company.get("name") or company.get("domain") or "empresa").replace(" ", "_")
        filename = f"reporte-{company_name}.pdf"

        return StreamingResponse(
            pdf_buf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics")
def api_get_analytics():
    try:
        db = MongoDBManager()
        return serialize(db.get_analytics())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))