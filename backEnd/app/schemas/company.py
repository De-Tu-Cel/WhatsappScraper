from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Union

class ProcessUrlRequest(BaseModel):
    url: str
    message_template: Optional[str] = None
    skip_send: Optional[bool] = False

class SendMessageRequest(BaseModel):
    company_id: str
    to_number: str
    message: str
    website: Optional[str] = ""
    instance: Optional[str] = None  # explicit instance bypass (e.g. for conversation replies)

class SearchRequest(BaseModel):
    industry: str
    city: Optional[str] = ""
    keywords: Optional[str] = ""
    num_results: Optional[int] = 10
    offset: Optional[int] = 0

class CheckUrlsRequest(BaseModel):
    urls: List[str]

class BatchRequest(BaseModel):
    urls: List[str]

class ContactsRaw(BaseModel):
    whatsapp_numbers: Optional[List[str]] = []
    all_whatsapp_numbers: Optional[List[str]] = []
    phone_numbers: Optional[List[str]] = []
    emails: Optional[List[str]] = []
    persons: Optional[List[Dict[str, Any]]] = []

class CompanyExtra(BaseModel):
    main_activity: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    country: Optional[str] = ""
    postal_code: Optional[str] = ""
    social_media: Optional[Dict[str, str]] = {}
    business_hours: Optional[str] = ""
    services: Optional[List[str]] = []
    products: Optional[List[str]] = []

class ProcessUrlResponse(BaseModel):
    website: str
    company_id: Optional[str] = None
    primary_whatsapp_number: Optional[str] = None
    to_number: Optional[str] = None
    send_result: Optional[Dict[str, Any]] = None
    message_log_id: Optional[str] = None
    social_media_id: Optional[str] = None
    person_contact_ids: Optional[List[str]] = []
    scraped: Optional[Dict[str, Any]] = {}

class SearchResponse(BaseModel):
    urls: List[str]

class DeleteCompaniesRequest(BaseModel):
    ids: List[str]

class UpdateCompanyRequest(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    has_whatsapp: Optional[bool] = None
    status: Optional[str] = None

class N8nMessageSentRequest(BaseModel):
    company_id: str
    to_number: str
    twilio_sid: str
    message_body: str
    status: Optional[str] = "sent"

class N8nMessageReceivedRequest(BaseModel):
    from_number: str
    to_number: str
    twilio_sid: str
    message_body: str
    received_at: Optional[str] = None

# ── Evolution API webhook payloads ────────────────────────────────────────────

class EvolutionMessageKey(BaseModel):
    remoteJid: Optional[str] = None
    fromMe: Optional[bool] = None
    id: Optional[str] = None

class EvolutionMessageData(BaseModel):
    key: Optional[EvolutionMessageKey] = None
    pushName: Optional[str] = None
    message: Optional[Dict[str, Any]] = None
    messageType: Optional[str] = None
    messageTimestamp: Optional[int] = None
    instanceId: Optional[str] = None
    source: Optional[str] = None

class EvolutionWebhookRequest(BaseModel):
    """Generic Evolution API webhook envelope."""
    event: str
    instance: Optional[str] = None
    data: Optional[Union[Dict[str, Any], List[Any]]] = None
    destination: Optional[str] = None
    date_time: Optional[str] = None
    sender: Optional[str] = None
    server_url: Optional[str] = None
    apikey: Optional[str] = None

class EvolutionStatusUpdate(BaseModel):
    """Payload for messages.update event."""
    keyId: Optional[str] = None
    remoteJid: Optional[str] = None
    fromMe: Optional[bool] = None
    status: Optional[str] = None  # PENDING, SENT, DELIVERED, READ, FAILED

class ReportRequest(BaseModel):
    screenshot_b64: Optional[str] = None
    filter_number:  Optional[str] = None

class UpdateContactsRequest(BaseModel):
    whatsapp_numbers: List[str] = []