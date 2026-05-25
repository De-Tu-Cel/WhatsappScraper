# pipeline.py
from datetime import datetime
# from pathlib import Path
import requests
from config import (
    FALLBACK_TO_NUMBER,
    N8N_WEBHOOK_URL,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_LANG,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TEMPLATE,
    EVOLUTION_API_URL,
    EVOLUTION_API_KEY,
    EVOLUTION_INSTANCE,
)
from database import MongoDBManager
from scraper import WebsiteScraper
from whatsapp_client import WhatAppClient
from whatsapp_evolution import EvolutionClient

DEFAULT_MESSAGE = "Hola, te contactamos desde Detucel."

def _render_message(template: str, scraped: dict, website: str) -> str:
    if not template:
        return DEFAULT_MESSAGE
    _extra = scraped.get("_extra", {})
    name     = scraped.get("name") or scraped.get("metadata", {}).get("title") or "estimado cliente"
    city     = _extra.get("city") or scraped.get("city") or "tu ciudad"
    industry = scraped.get("industry") or "tu sector"
    return (template
        .replace("{{nombre}}",    name)
        .replace("{{ciudad}}",    city)
        .replace("{{industria}}", industry)
        .replace("{{web}}",       website))

def process_url(website: str, message_template: str = None, skip_send: bool = False):
    """
    Pipeline completo con scraper extenso
    """
    db = MongoDBManager()
    scraper = WebsiteScraper()  # Ya usa el nuevo scraper extenso
    wa = WhatAppClient(WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN)

    # print(f"📸 Capturando screenshot de {website}...")
    # screenshot_path = capture_screenshot(website)
    screenshot_path = None

    print(f"🔍 Scrapeando datos de {website}...")
    scraped = scraper.scrape_site(website)
    _extra = scraped.get("_extra", {})
    _cr = scraped.get("_contacts_raw", {})

    print(f"💾 Guardando empresa en base de datos...")
    from urllib.parse import urlparse as _urlparse
    _domain = _urlparse(website).netloc.lower().replace("www.", "")

    has_whatsapp = bool(_cr.get("whatsapp_numbers"))

    company_id = db.insert_company({
        "name": scraped["name"],
        "industry": scraped["industry"],
        "description": scraped["description"],
        "main_activity": _extra.get("main_activity"),
        "website": website,
        "domain": _domain,
        "address": _extra.get("address"),
        "city": _extra.get("city"),
        "state": _extra.get("state"),
        "country": _extra.get("country"),
        "postal_code": _extra.get("postal_code"),
        "business_hours": _extra.get("business_hours"),
        "services": _extra.get("services"),
        "products": _extra.get("products"),
        "metadata": scraped["metadata"],
        "has_whatsapp": has_whatsapp,
    })

    print(f"✅ Empresa guardada con ID: {company_id}")

    # ========================================================================
    # GUARDAR CONTACTOS DE WHATSAPP
    # ========================================================================
    primary_whatsapp_number = None
    if _cr.get("whatsapp_numbers"):
        primary_whatsapp_number = _cr["whatsapp_numbers"][0]
        print(f"📱 WhatsApp encontrado: {primary_whatsapp_number}")

        db.insert_contact({
            "company_id": company_id,
            "type": "whatsapp",
            "value": primary_whatsapp_number,
            "source": website,
            "is_primary": True,
        })

        for wa_num in _cr.get("all_whatsapp_numbers", [])[1:]:
            db.insert_contact({
                "company_id": company_id,
                "type": "whatsapp",
                "value": wa_num,
                "source": website,
                "is_primary": False,
            })

    # ========================================================================
    # GUARDAR TELÉFONOS
    # ========================================================================
    all_wa = _cr.get("all_whatsapp_numbers", [])
    for phone in _cr.get("phone_numbers", []):
        if phone not in all_wa:
            db.insert_contact({
                "company_id": company_id,
                "type": "phone",
                "value": phone,
                "source": website,
            })

    # ========================================================================
    # GUARDAR EMAILS
    # ========================================================================
    for email in _cr.get("emails", []):
        db.insert_contact({
            "company_id": company_id,
            "type": "email",
            "value": email,
            "source": website,
        })

    # ========================================================================
    # GUARDAR CONTACTOS DE PERSONAS ESPECÍFICAS
    # ========================================================================
    person_contact_ids = []
    for contact in _cr.get("persons", []):
        person_id = db.insert_person_contact({
            "company_id": company_id,
            "name": contact["name"],
            "role": contact["role"],
            "email": contact["email"],
            "phone": contact["phone"],
            "whatsapp": contact["whatsapp"],
            "source": website,
        })
        person_contact_ids.append(person_id)
        print(f"👤 Contacto guardado: {contact['name']} - {contact['role']}")

    # ========================================================================
    # GUARDAR REDES SOCIALES
    # ========================================================================
    social_media_id = None
    social_media = _extra.get("social_media", {})
    if social_media:
        social_media_id = db.insert_social_media({
            "company_id": company_id,
            **social_media,
            "source": website,
        })
        print(f"🌐 Redes sociales guardadas: {list(social_media.keys())}")

    # ========================================================================
    # GUARDAR SCREENSHOT EN GRIDFS Y EVIDENCIA (desactivado)
    # ========================================================================
    # screenshot_bytes = Path(screenshot_path).read_bytes()
    # screenshot_file_id = db.save_screenshot_file(
    #     image_bytes=screenshot_bytes,
    #     filename=Path(screenshot_path).name,
    #     metadata={
    #         "type": "page_screenshot",
    #         "source_url": website,
    #         "company_id": company_id,
    #     },
    # )
    # screenshot_evidence_id = db.insert_evidence({
    #     "type": "page_screenshot",
    #     "source_url": website,
    #     "company_id": company_id,
    #     "screenshot_path": screenshot_path,
    #     "screenshot_file_id": screenshot_file_id,
    #     "created_at": datetime.now(),
    # })
    screenshot_file_id = None
    screenshot_evidence_id = None

    # ========================================================================
    # ENVÍO DE WHATSAPP
    # ========================================================================
    to_number = primary_whatsapp_number or FALLBACK_TO_NUMBER

    send_result = None
    message_log_id = None
    message_evidence_id = None
    whatsapp_chat_screenshot_path = None
    whatsapp_chat_screenshot_evidence_id = None

    MESSAGE_TEXT = _render_message(message_template, scraped, website)

    if to_number and not skip_send:
        print(f"📤 Enviando mensaje de WhatsApp a {to_number}...")
        send_result = wa.send_template_message(to_number, WHATSAPP_TEMPLATE, WHATSAPP_LANG)

        response_json = send_result.get("response_json", {})
        message_id = None
        if isinstance(response_json, dict):
            messages = response_json.get("messages", [])
            if messages and isinstance(messages[0], dict):
                message_id = messages[0].get("id")

        message_log_id = db.insert_message_log({
            "channel": "whatsapp",
            "company_id": company_id,
            "to_number": to_number,
            "message_text": MESSAGE_TEXT,
            "status_code": send_result.get("status_code"),
            "message_id": message_id,
            "api_response": response_json,
            "raw_text": send_result.get("raw_text"),
            "sent_at": send_result.get("sent_at"),
            "status": "accepted_by_api" if send_result.get("status_code") == 200 else "failed",
        })

        message_evidence_id = db.insert_evidence({
            "type": "api_send_response",
            "company_id": company_id,
            "message_log_id": message_log_id,
            "to_number": to_number,
            "status_code": send_result.get("status_code"),
            "message_id": message_id,
            "payload": response_json,
            "created_at": datetime.now(),
        })

        # print(f"📸 Capturando screenshot de WhatsApp Web...")
        # whatsapp_chat_screenshot_path = capture_whatsapp_chat_screenshot(to_number)
        # whatsapp_chat_screenshot_evidence_id = db.insert_evidence({
        #     "type": "whatsapp_web_screenshot",
        #     "company_id": company_id,
        #     "message_log_id": message_log_id,
        #     "chat_identifier": to_number,
        #     "screenshot_path": whatsapp_chat_screenshot_path,
        #     "created_at": datetime.now(),
        # })

    # ========================================================================
    # EVOLUTION API — envío por número personal de WhatsApp
    # ========================================================================
    evolution_log_id = None
    evolution_result = None

    if EVOLUTION_API_KEY and EVOLUTION_INSTANCE and to_number and not skip_send:
        print(f"📲 Enviando por Evolution API a {to_number}...")
        evo = EvolutionClient(EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE)
        evolution_result = evo.send_text(to_number, MESSAGE_TEXT)

        evo_json = evolution_result.get("response_json", {})
        evo_message_id = (
            evo_json.get("key", {}).get("id")
            or evo_json.get("id")
            or None
        )
        evo_status = "sent" if evolution_result.get("status_code") == 201 else "failed"

        evolution_log_id = db.insert_message_log({
            "channel": "whatsapp",
            "platform": "evolution",
            "company_id": company_id,
            "to_number": to_number,
            "message_text": MESSAGE_TEXT,
            "status_code": evolution_result.get("status_code"),
            "message_id": evo_message_id,
            "api_response": evo_json,
            "raw_text": evolution_result.get("raw_text"),
            "sent_at": evolution_result.get("sent_at"),
            "status": evo_status,
            "direction": "outbound",
        })
        print(f"✅ Evolution API: {evo_status} (id={evo_message_id})")

    print(f"✅ Pipeline completado para {website}")

    # ========================================================================
    # RETORNAR RESULTADO COMPLETO
    # ========================================================================
    return {
        "website": website,
        "company_id": company_id,
        "scraped": scraped,  # Ahora incluye TODOS los datos nuevos
        "primary_whatsapp_number": primary_whatsapp_number,
        "to_number": to_number,
        "screenshot_path": screenshot_path,
        "screenshot_file_id": screenshot_file_id,
        "screenshot_evidence_id": screenshot_evidence_id,
        "send_result": send_result,
        "message_log_id": message_log_id,
        "message_evidence_id": message_evidence_id,
        "whatsapp_chat_screenshot_path": whatsapp_chat_screenshot_path,
        "whatsapp_chat_screenshot_evidence_id": whatsapp_chat_screenshot_evidence_id,
        "person_contact_ids": person_contact_ids,
        "social_media_id": social_media_id,
        "evolution_log_id": evolution_log_id,
        "evolution_result": evolution_result,
    }
    
def run_pipeline_batch(urls: list) -> dict:
    """
    Procesa múltiples URLs en lote
    
    Args:
        urls: Lista de URLs a procesar
    
    Returns:
        {
            "summary": {
                "procesados": int,
                "con_wa": int,
                "mensajes_enviados": int,
                "errores": int
            },
            "results": [...]
        }
    """
    results = []
    summary = {
        "procesados": 0,
        "con_wa": 0,
        "mensajes_enviados": 0,
        "errores": 0
    }

    for url in urls:
        try:
            result = process_url(url)
            results.append({
                "url": url,
                "status": "ok",
                "result": result
            })
            summary["procesados"] += 1
            
            if result.get("primary_whatsapp_number"):
                summary["con_wa"] += 1
            
            if result.get("send_result") and result["send_result"].get("status_code") == 200:
                summary["mensajes_enviados"] += 1
                
        except Exception as e:
            results.append({
                "url": url,
                "status": "error",
                "error": str(e)
            })
            summary["errores"] += 1

    return {
        "summary": summary,
        "results": results
    }