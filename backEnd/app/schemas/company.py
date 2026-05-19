from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ProcessUrlRequest(BaseModel):
    url: str

class SearchRequest(BaseModel):
    industry: str
    city: str
    keywords: Optional[str] = ""
    num_results: Optional[int] = 10

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