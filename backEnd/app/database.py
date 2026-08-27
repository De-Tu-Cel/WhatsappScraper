# database.py
import re
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timedelta, timezone
from gridfs import GridFS
from config import MONGODB_URI, DATABASE_NAME

# Single MongoClient shared across all requests — pymongo manages the connection pool internally.
# Creating a new MongoClient per request exhausts TCP sockets on Windows (WinError 10055).
_mongo_client: MongoClient | None = None

# Umbrales de tiempo que decide el flujo determinista de classifier.py — configurables
# desde Settings > Clasificación (admin). Estos valores son los defaults cuando nunca
# se ha guardado nada en la colección `settings`.
CLASSIFIER_DEFAULTS = {
    "t1_threshold_seconds": 10,
    "t2_threshold_seconds": 5,
    "probe_wait_hours": 1,
    "no_reply_wait_minutes": 60,
}

def _get_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            # Sin esto, un socket ya establecido que se queda mudo (túnel SSH
            # colgado, NAT que tira la conexión) bloquea el hilo de FastAPI
            # indefinidamente sin levantar ninguna excepción — el request nunca
            # falla del lado de Python, solo expira 20s después en el proxy de
            # Next.js (backendFetch) sin dejar rastro en el log del backend.
            socketTimeoutMS=8000,
            maxPoolSize=50,
            minPoolSize=2,
        )
        _mongo_client.admin.command("ping")
        db = _mongo_client[DATABASE_NAME]
        try:
            db.companies.create_index("domain", unique=True, sparse=True)
        except Exception:
            pass  # duplicates exist — index will be created after cleanup
        try:
            # Partial (not sparse) porque casi todos los mensajes tienen message_id=None
            # explícito (no ausente) — un índice sparse+unique seguiría exigiendo
            # unicidad entre todos los None y fallaría de inmediato. Solo exige
            # unicidad cuando message_id es un string real. Sin este índice, dos
            # entregas casi simultáneas del webhook (retry de Evolution/WhatsApp,
            # visto en producción con 187ms de diferencia) pueden pasar el chequeo
            # find-then-insert de save_evolution_log() antes de que la primera
            # termine de guardarse — duplicando el mensaje con clasificaciones
            # distintas y pudiendo encolar el seguimiento de IA dos veces.
            db.message_logs.create_index(
                "message_id", unique=True,
                partialFilterExpression={"message_id": {"$type": "string"}},
            )
        except Exception:
            pass  # ya existen duplicados — el índice se creará tras limpiarlos
    return _mongo_client


class MongoDBManager:
    def __init__(self):
        self.client = _get_client()
        self.db = self.client[DATABASE_NAME]
        self.fs = GridFS(self.db)

    def get_classifier_settings(self) -> dict:
        """Umbrales configurables del flujo T1/T2 (Settings > Clasificación). Sin
        caché: es una lectura liviana, se llama una vez por mensaje entrante — así un
        cambio en la UI aplica al siguiente mensaje sin necesitar redeploy."""
        doc = self.db.settings.find_one({"_id": "classifier"}) or {}
        return {**CLASSIFIER_DEFAULTS, **{k: v for k, v in doc.items() if k in CLASSIFIER_DEFAULTS}}

    def save_classifier_settings(self, values: dict) -> None:
        self.db.settings.update_one({"_id": "classifier"}, {"$set": values}, upsert=True)

    def insert_company(self, company_data):
        company_data["created_at"] = company_data.get("created_at", datetime.now())
        result = self.db.companies.insert_one(company_data)
        return str(result.inserted_id)

    def insert_contact(self, contact_data):
        contact_data["created_at"] = contact_data.get("created_at", datetime.now())
        ctype = contact_data.get("type")
        cid   = contact_data["company_id"]

        if ctype == "whatsapp":
            value   = contact_data.get("value", "")
            clean10 = "".join(filter(str.isdigit, value))[-10:]
            existing = self.db.contacts.find_one({
                "company_id": cid, "type": "whatsapp",
                "value": {"$regex": clean10, "$options": "i"},
            })
            if existing:
                new_label = contact_data.get("label", "")
                if new_label and not existing.get("label"):
                    self.db.contacts.update_one({"_id": existing["_id"]}, {"$set": {"label": new_label}})
                return str(existing["_id"])

        elif ctype == "phone":
            value   = contact_data.get("value", "")
            clean10 = "".join(filter(str.isdigit, value))[-10:]
            if clean10:
                existing = self.db.contacts.find_one({
                    "company_id": cid, "type": "phone",
                    "value": {"$regex": clean10, "$options": "i"},
                })
                if existing:
                    return str(existing["_id"])

        elif ctype == "email":
            norm = contact_data.get("value", "").strip().lower()
            if norm:
                existing = self.db.contacts.find_one({
                    "company_id": cid, "type": "email",
                    "value": {"$regex": f"^{re.escape(norm)}$", "$options": "i"},
                })
                if existing:
                    return str(existing["_id"])

        result = self.db.contacts.insert_one(contact_data)
        return str(result.inserted_id)

    def insert_message_log(self, log_data):
        # Naive-pero-UTC: is_business_hours() asume UTC cuando el datetime no
        # tiene tzinfo. datetime.now() (hora local del servidor) rompía eso.
        log_data["created_at"] = log_data.get("created_at", datetime.now(timezone.utc).replace(tzinfo=None))
        result = self.db.message_logs.insert_one(log_data)
        return str(result.inserted_id)

    def insert_evidence(self, evidence_data):
        evidence_data["created_at"] = evidence_data.get("created_at", datetime.now())
        result = self.db.evidence.insert_one(evidence_data)
        return str(result.inserted_id)
    
    def save_screenshot_file(self, image_bytes, filename, metadata=None):
        file_id = self.fs.put(
            image_bytes,
            filename=filename,
            content_type="image/png",
            metadata=metadata or {}
        )
        return str(file_id)

    def get_screenshot_file(self, file_id):
        return self.fs.get(file_id)

    def get_companies_with_websites(self):
        return list(self.db.companies.find(
            {"website": {"$exists": True, "$ne": ""}},
            {"name": 1, "website": 1, "industry": 1, "main_activity": 1}
        ))

    def get_contacts_by_company(self, company_id):
        return list(
            self.db.contacts.find({"company_id": company_id}).sort([
                ("updated_at", -1),
                ("is_primary", -1),
                ("created_at", -1),
                ("_id", -1),
            ])
        )

    def update_evidence(self, evidence_id, update_data):
        update_data["updated_at"] = datetime.now()
        result = self.db.evidence.update_one(
            {"_id": evidence_id},
            {"$set": update_data}
        )
        return result.modified_count > 0
    
    def insert_person_contact(self, contact_data):
        contact_data["created_at"] = contact_data.get("created_at", datetime.now())
        contact_data["updated_at"] = datetime.now()
        key = {
            "company_id": contact_data.get("company_id"),
            "name":       contact_data.get("name", ""),
        }
        result = self.db.person_contacts.update_one(
            key,
            {"$set": {k: v for k, v in contact_data.items() if k != "created_at"},
             "$setOnInsert": {"created_at": contact_data["created_at"]}},
            upsert=True,
        )
        if result.upserted_id:
            return str(result.upserted_id)
        doc = self.db.person_contacts.find_one(key, {"_id": 1})
        return str(doc["_id"]) if doc else None

    def insert_social_media(self, social_data):
        """Inserta redes sociales de la empresa"""
        social_data["created_at"] = social_data.get("created_at", datetime.now())
        result = self.db.social_media.insert_one(social_data)
        return str(result.inserted_id)

    def update_company(self, company_id, update_data):
        """Actualiza datos de empresa"""
        from bson import ObjectId
        update_data["updated_at"] = datetime.now()
        result = self.db.companies.update_one(
            {"_id": ObjectId(company_id)},
            {"$set": update_data}
        )
        return result.modified_count > 0

    def get_company_full_data(self, company_id):
        """Obtiene todos los datos de una empresa incluyendo contactos"""
        from bson import ObjectId

        company = self.db.companies.find_one({"_id": ObjectId(company_id)})
        if not company:
            return None

        # Agregar contactos ordenados para que el número más reciente quede primero
        company["contacts"] = list(
            self.db.contacts.find({"company_id": company_id}).sort([
                ("updated_at", -1),
                ("is_primary", -1),
                ("created_at", -1),
                ("_id", -1),
            ])
        )
        company["person_contacts"] = list(self.db.person_contacts.find({"company_id": company_id}))
        company["social_media"] = self.db.social_media.find_one({"company_id": company_id})

        last_log = self.db.message_logs.find_one(
            {"company_id": company_id, "direction": "outbound"},
            sort=[("created_at", -1)],
            projection={"_id": 1},
        )
        company["last_message_log_id"] = str(last_log["_id"]) if last_log else None

        return company

    def get_distinct_values(self, field):
        return sorted([v for v in self.db.companies.distinct(field) if v])

    def list_companies(self, page=1, page_size=10, search=None, industry=None, city=None, has_whatsapp=None):
        query = {}
        if search:
            query["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"website": {"$regex": search, "$options": "i"}},
                {"domain": {"$regex": search, "$options": "i"}},
            ]
        if industry:
            query["industry"] = {"$regex": industry, "$options": "i"}
        if city:
            query["city"] = {"$regex": city, "$options": "i"}
        if has_whatsapp is not None:
            query["has_whatsapp"] = has_whatsapp

        total = self.db.companies.count_documents(query)
        companies = list(
            self.db.companies.find(
                query,
                {"name": 1, "domain": 1, "website": 1, "industry": 1, "city": 1, "state": 1, "has_whatsapp": 1, "status": 1, "created_at": 1, "last_scraped_at": 1}
            )
            .sort("created_at", -1)
            .skip((page - 1) * page_size)
            .limit(page_size)
        )
        # Mark which companies have been contacted (any outbound message)
        if companies:
            ids = [str(c["_id"]) for c in companies]
            contacted_set = {
                doc["company_id"] for doc in self.db.message_logs.find(
                    {"company_id": {"$in": ids}, "direction": "outbound"},
                    {"company_id": 1},
                )
            }
            for c in companies:
                c["contacted"] = str(c["_id"]) in contacted_set
        return {"total": total, "companies": companies}

    def delete_companies(self, company_ids):
        from bson import ObjectId
        result = self.db.companies.delete_many({"_id": {"$in": [ObjectId(cid) for cid in company_ids]}})
        return result.deleted_count

    def update_company_fields(self, company_id, fields):
        from bson import ObjectId
        fields["updated_at"] = datetime.now()
        result = self.db.companies.update_one(
            {"_id": ObjectId(company_id)},
            {"$set": fields}
        )
        return result.modified_count > 0

    def save_twilio_log(self, direction, company_id, number, message_body, twilio_sid, status, platform="twilio"):
        doc = {
            "platform": platform,
            "direction": direction,
            "channel": "whatsapp",
            "company_id": company_id,
            "message_body": message_body,
            "twilio_sid": twilio_sid,
            "status": status,
            "created_at": datetime.now(),
        }
        if direction == "outbound":
            doc["to_number"] = number
        else:
            doc["from_number"] = number
        result = self.db.message_logs.insert_one(doc)
        return str(result.inserted_id)

    def get_all_scraped_domains(self) -> set:
        """Return the set of all domain strings already in the companies collection."""
        from urllib.parse import urlparse

        def clean(u):
            try:
                return urlparse(u).netloc.lower().replace("www.", "")
            except Exception:
                return ""

        docs = self.db.companies.find({}, {"domain": 1, "website": 1})
        out = set()
        for d in docs:
            if d.get("domain"):
                out.add(d["domain"].lower().replace("www.", ""))
            if d.get("website"):
                c = clean(d["website"])
                if c:
                    out.add(c)
        return out

    def check_contacted(self, company_ids: list) -> dict:
        """Returns contact history for a list of company_ids — who first messaged each
        one and when. Extracted from routes.py's /companies/check-contacted so the
        scrape-jobs background worker can call it directly instead of doing an HTTP
        self-call from inside the same process."""
        result = {}
        for cid in company_ids:
            first = self.db.message_logs.find_one(
                {"company_id": cid, "direction": "outbound"},
                sort=[("created_at", 1)],
                projection={"sent_by_name": 1, "sent_by_username": 1, "created_at": 1}
            )
            if first:
                contacted_nums = self.db.message_logs.distinct(
                    "to_number",
                    {"company_id": cid, "direction": "outbound"},
                )
                result[cid] = {
                    "contacted": True,
                    "by_name":     first.get("sent_by_name", ""),
                    "by_username": first.get("sent_by_username", ""),
                    "at":          first["created_at"].isoformat() if first.get("created_at") else None,
                    "contacted_numbers": [n for n in contacted_nums if n],
                }
            else:
                result[cid] = {"contacted": False}
        return result

    def check_urls_scraped(self, urls: list) -> dict:
        from urllib.parse import urlparse

        def clean_domain(u):
            return urlparse(u).netloc.lower().replace("www.", "")

        domain_map = {clean_domain(u): u for u in urls if u}
        domains = list(domain_map.keys())

        # Match against both `domain` field (new) and `website` field (existing records)
        existing = self.db.companies.find(
            {"$or": [
                {"domain": {"$in": domains}},
                {"website": {"$in": urls}},
            ]},
            {"domain": 1, "website": 1}
        )
        scraped_domains = set()
        for doc in existing:
            if doc.get("domain"):
                scraped_domains.add(doc["domain"].lower().replace("www.", ""))
            if doc.get("website"):
                scraped_domains.add(clean_domain(doc["website"]))

        return {url: (clean_domain(url) in scraped_domains) for url in urls}

    def find_company_id_by_phone(self, phone_number, allow_fallback=False):
        clean = "".join(filter(str.isdigit, phone_number))
        clean_norm = ("52" + clean[3:]) if (len(clean) == 13 and clean.startswith("521")) else clean
        # 1. JID map — most authoritative: records which company we SENT to this number.
        # Checked first because the same number can be a contact of multiple companies
        # (e.g. Oh Express scraped both as individual branches and as parent company).
        # jid_map is populated at send-time so it always points to the right conversation.
        jid_doc = self.db.jid_map.find_one({"jid": {"$in": [clean, clean_norm]}})
        if jid_doc:
            return jid_doc["company_id"]
        # 2. Registered contact fallback (exact last-10-digit match)
        contact = self.db.contacts.find_one({
            "type": "whatsapp",
            "value": {"$regex": clean[-10:], "$options": "i"},
        })
        if contact:
            return contact["company_id"]
        # 3. Fallback only for delivery ACKs (messages.update), never for real
        # inbound messages — otherwise personal contacts get mis-attributed.
        if not allow_fallback:
            return None
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now() - timedelta(hours=1)
        recent = list(self.db.message_logs.find(
            {"direction": "outbound", "status": {"$ne": "failed"},
             "created_at": {"$gte": cutoff}},
            {"company_id": 1},
        ))
        unique = {r["company_id"] for r in recent if r.get("company_id")}
        if len(unique) == 1:
            company_id = unique.pop()
            self.db.jid_map.update_one(
                {"jid": clean},
                {"$set": {"company_id": company_id, "updated_at": datetime.now()}},
                upsert=True,
            )
            return company_id
        return None

    def replace_whatsapp_contacts(self, company_id: str, numbers: list):
        """Replace all WhatsApp contacts for a company with the given list."""
        self.db.contacts.delete_many({"company_id": company_id, "type": "whatsapp"})
        now = datetime.now()
        for i, num in enumerate(numbers):
            if num.strip():
                self.db.contacts.insert_one({
                    "company_id": company_id,
                    "type": "whatsapp",
                    "value": num.strip(),
                    "is_primary": i == 0,
                    "created_at": now,
                    "updated_at": now,
                })
        has_whatsapp = len(numbers) > 0
        self.db.companies.update_one(
            {"_id": __import__('bson').ObjectId(company_id)},
            {"$set": {"has_whatsapp": has_whatsapp, "updated_at": now}}
        )

    def save_evolution_log(self, direction: str, company_id: str, number: str,
                           message_body: str, message_id: str = None,
                           message_type: str = "conversation",
                           status: str = "received", raw_data: dict = None,
                           interactive: dict = None,
                           related_to_number: str = None,
                           instance_name: str = None,
                           created_at: datetime = None):
        # Dedup: if this message_id already exists, avoid duplicate entries.
        # If the existing record has company_id="unknown" and we now know the real
        # company, upgrade it in place (handles the race: inbound before JID learned).
        if message_id:
            existing = self.db.message_logs.find_one({"message_id": message_id})
            if existing:
                if existing.get("company_id") == "unknown" and company_id and company_id != "unknown":
                    self.db.message_logs.update_one(
                        {"_id": existing["_id"]},
                        {"$set": {"company_id": company_id}},
                    )
                return str(existing["_id"])
        doc = {
            "platform": "evolution",
            "direction": direction,
            "channel": "whatsapp",
            "company_id": company_id,
            "message_body": message_body,
            "message_id": message_id,
            "message_type": message_type,
            "status": status,
            "raw_data": raw_data or {},
            # Cuando se conoce el momento REAL del mensaje (ej. messageTimestamp al
            # sincronizar historial), se usa ese — no el momento en que se procesó/
            # sincronizó. Si no se pasa (webhook en vivo), "ahora" sigue siendo
            # correcto porque el mensaje se procesa casi al instante de llegar.
            "created_at": created_at or datetime.utcnow(),
        }
        if interactive:
            doc["interactive"] = interactive
        if direction == "outbound":
            doc["to_number"] = number
        else:
            doc["from_number"] = number
            if related_to_number:
                doc["related_to_number"] = related_to_number
            if instance_name:
                doc["received_on_instance"] = instance_name
            # Mark for analysis so the analytics panel can show a loading indicator.
            # Skip unknown/manual company_id — classifier won't run for them anyway, and
            # "manual" es lo que usa el webhook de WAHA (número personal) para contactos y
            # GRUPOS de WhatsApp sin vincular a una empresa — sin esta exclusión, contenido
            # personal/de grupo terminaba en analysis_status=pending y era elegible para
            # que classify_and_save lo mandara al LLM real a "calificar calidad de
            # servicio" (confirmado en producción: 326 mensajes personales analizados así
            # entre el 23-jun y 6-jul de 2026, antes de este fix).
            # Skip personal-contact companies (.local domain) — they flood inbound messages
            # from personal WhatsApp chats and would keep the spinner permanently active.
            if message_body and message_body != "[media]" and company_id not in (None, "unknown", "manual"):
                _skip_analysis = False
                try:
                    from bson import ObjectId
                    _co = self.db.companies.find_one({"_id": ObjectId(company_id)}, {"domain": 1})
                    _skip_analysis = bool(_co and str(_co.get("domain", "")).endswith(".local"))
                except Exception:
                    pass
                if not _skip_analysis:
                    doc["analysis_status"] = "pending"
                    doc["pending_since"] = datetime.utcnow()
        try:
            result = self.db.message_logs.insert_one(doc)
            return str(result.inserted_id)
        except DuplicateKeyError:
            # El find_one de arriba no vio nada, pero otra entrega casi simultánea
            # del mismo webhook (visto en producción: reintento de Evolution/WhatsApp
            # con ~187ms de diferencia) ganó la carrera e insertó primero — el índice
            # único de message_id evita el duplicado real; aquí solo se recupera su
            # _id para devolver la misma referencia que un caller normal esperaría.
            existing = self.db.message_logs.find_one({"message_id": message_id})
            return str(existing["_id"]) if existing else None

    def save_instance_health_log(self, instance_name: str, event: str,
                                  reason: str = None, reason_label: str = None,
                                  reason_code: int = None):
        """Record a state-change event (connected/disconnected) for an instance.
        Only called on actual transitions — not on every poll — to keep the collection small."""
        self.db.instance_health_logs.insert_one({
            "instance_name": instance_name,
            "event":         event,           # "connected" | "disconnected"
            "reason":        reason,          # disconnect_reason key or None
            "reason_label":  reason_label,
            "reason_code":   reason_code,
            "ts":            datetime.utcnow(),
        })

    def get_instance_uptime(self, instance_names: list, hours: int = 24) -> dict:
        """Calculate uptime % per instance over the last N hours.
        Returns {instance_name: {"uptime_pct": float, "last_event": str, "last_ts": datetime, "last_reason": str}}"""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        result = {}

        for name in instance_names:
            logs = list(self.db.instance_health_logs.find(
                {"instance_name": name, "ts": {"$gte": cutoff}},
                {"_id": 0, "event": 1, "ts": 1, "reason": 1, "reason_label": 1},
            ).sort("ts", 1))

            # Get the state just BEFORE the window to know the starting state
            before = self.db.instance_health_logs.find_one(
                {"instance_name": name, "ts": {"$lt": cutoff}},
                {"_id": 0, "event": 1},
                sort=[("ts", -1)],
            )
            current_state = (before["event"] if before else "unknown")

            window_secs = hours * 3600
            connected_secs = 0.0
            prev_ts = cutoff

            for log in logs:
                seg = (log["ts"] - prev_ts).total_seconds()
                if current_state == "connected":
                    connected_secs += seg
                current_state = log["event"]
                prev_ts = log["ts"]

            # Remaining time up to now
            now = datetime.utcnow()
            seg = (now - prev_ts).total_seconds()
            if current_state == "connected":
                connected_secs += seg

            uptime_pct = round((connected_secs / window_secs) * 100, 1) if window_secs > 0 else 0.0

            last_log = logs[-1] if logs else before
            result[name] = {
                "uptime_pct":  uptime_pct,
                "last_event":  last_log["event"] if last_log else None,
                "last_ts":     last_log["ts"].isoformat() if last_log else None,
                "last_reason": last_log.get("reason_label") if last_log else None,
            }

        return result

    def update_evolution_message_status(self, message_id: str, status: str):
        result = self.db.message_logs.update_one(
            {"message_id": message_id, "platform": "evolution"},
            {"$set": {"status": status, "updated_at": datetime.now()}},
        )
        return result.modified_count > 0

    def get_conversations(self):
        """Returns one entry per company that has message activity, sorted by last message."""
        from bson import ObjectId
        pipeline = [
            {"$sort": {"created_at": -1}},
            {"$group": {
                "_id": "$company_id",
                "last_message":       {"$first": "$message_body"},
                "last_direction":     {"$first": "$direction"},
                "last_at":            {"$first": "$created_at"},
                "last_status":        {"$first": "$status"},
                "total":              {"$sum": 1},
                "unread":             {"$sum": {"$cond": [
                    {"$and": [
                        {"$eq": ["$direction", "inbound"]},
                        {"$ne": ["$status", "read"]},
                    ]}, 1, 0
                ]}},
                # Who first contacted this company
                "first_sent_by_name": {"$last": {"$cond": [
                    {"$eq": ["$direction", "outbound"]}, "$sent_by_name", None
                ]}},
                "first_sent_by_user": {"$last": {"$cond": [
                    {"$eq": ["$direction", "outbound"]}, "$sent_by_username", None
                ]}},
                "has_outbound": {"$sum": {"$cond": [{"$eq": ["$direction", "outbound"]}, 1, 0]}},
            }},
            {"$sort": {"last_at": -1}},
        ]
        groups = list(self.db.message_logs.aggregate(pipeline))
        if not groups:
            return []

        # ── Batch lookups — 4 queries total instead of N×4 ───────────────────
        all_cids = [
            g["_id"] for g in groups
            if g["_id"] and g["_id"] not in ("manual", "unknown")
        ]
        valid_oids = []
        for cid in all_cids:
            try:
                valid_oids.append(ObjectId(cid))
            except Exception:
                pass

        companies_map = {
            str(c["_id"]): c
            for c in self.db.companies.find(
                {"_id": {"$in": valid_oids}},
                {"name": 1, "domain": 1, "website": 1, "industry": 1, "source": 1},
            )
        }
        wa_contact_cids = {
            c["company_id"]
            for c in self.db.contacts.find(
                {"company_id": {"$in": all_cids}, "type": "whatsapp"},
                {"company_id": 1},
            )
        }
        jid_map_cids = {
            j["company_id"]
            for j in self.db.jid_map.find(
                {"company_id": {"$in": all_cids}},
                {"company_id": 1},
            )
        }
        has_wa_cids = wa_contact_cids | jid_map_cids

        # Last analyzed inbound per company — one aggregation instead of N find_ones
        analyzed_map = {
            doc["_id"]: doc.get("analysis")
            for doc in self.db.message_logs.aggregate([
                {"$match": {
                    "company_id": {"$in": all_cids},
                    "direction": "inbound",
                    "analysis": {"$exists": True},
                }},
                {"$sort": {"created_at": -1}},
                {"$group": {"_id": "$company_id", "analysis": {"$first": "$analysis"}}},
            ])
        }

        results = []
        for g in groups:
            company_id = g["_id"]
            if not company_id or company_id in ("manual", "unknown"):
                continue
            company = companies_map.get(company_id)
            if company is None:
                continue
            # Skip contacts auto-registered from an inbound message (external numbers
            # that messaged the connected WA account) if the system never sent them anything.
            if company.get("source") == "inbound_whatsapp" and g.get("has_outbound", 0) == 0:
                continue
            if company_id not in has_wa_cids:
                continue
            results.append({
                "company_id": company_id,
                "company_name": company["name"],
                "domain": company.get("domain", ""),
                "website": company.get("website", ""),
                "industry": company.get("industry", ""),
                "last_message":       g["last_message"] or "",
                "last_direction":     g["last_direction"],
                "last_at":            g["last_at"].isoformat() if g["last_at"] else None,
                "last_status":        g["last_status"],
                "total":              g["total"],
                "unread":             g["unread"],
                "sent_by_name":       g.get("first_sent_by_name") or "",
                "sent_by_username":   g.get("first_sent_by_user") or "",
                "last_analysis":      analyzed_map.get(company_id),
            })
        # Deduplicate: same domain+name scraped multiple times → keep the one with
        # the most recent activity. Companies with no domain are deduped by name alone.
        _seen_key: dict = {}
        deduped = []
        for r in results:
            domain = (r.get("domain") or "").strip().lower()
            key = (r["company_name"].strip().lower(), domain)
            existing = _seen_key.get(key)
            if existing is None:
                _seen_key[key] = r
                deduped.append(r)
            else:
                # Replace if this entry has a more recent message
                if (r.get("last_at") or "") > (existing.get("last_at") or ""):
                    existing.update(r)

        # Annotate with AI follow-up session status
        if deduped:
            active_cids = [r["company_id"] for r in deduped]
            ai_sessions = {
                s["company_id"]: s
                for s in self.db.ai_followup_sessions.find(
                    {"company_id": {"$in": active_cids}, "status": {"$in": ["active", "waiting"]}},
                    {"company_id": 1, "ai_typing": 1},
                )
            }
            # Cross-reference with prefs: if user explicitly disabled AI, hide the icon
            # even if a stale session still exists in the DB.
            ai_prefs = {
                p["company_id"]: p.get("ai_enabled", True)
                for p in self.db.conversation_ai_prefs.find(
                    {"company_id": {"$in": active_cids}},
                    {"company_id": 1, "ai_enabled": 1},
                )
            }
            for r in deduped:
                cid = r["company_id"]
                sess = ai_sessions.get(cid)
                pref_enabled = ai_prefs.get(cid, True)  # no pref = never explicitly disabled
                r["ai_active"] = bool(sess) and pref_enabled
                r["ai_typing"] = bool(sess.get("ai_typing")) if (sess and pref_enabled) else False

        return deduped

    def get_conversation_thread(self, company_id: str, number: str = None):
        """Returns messages for a company sorted by time, deduplicated.
        If `number` is given, only returns messages relevant to that specific number.
        """
        query = {
            "company_id": company_id,
            "direction": {"$in": ["outbound", "inbound"]},
            "status": {"$ne": "failed"},
        }
        if number:
            clean10 = "".join(filter(str.isdigit, number))[-10:]
            query["$or"] = [
                {"direction": "outbound", "to_number": {"$regex": clean10}},
                {"direction": "inbound",  "related_to_number": {"$regex": clean10}},
                {"direction": "inbound",  "from_number": {"$regex": clean10}},
            ]
        messages = list(self.db.message_logs.find(
            query,
            {"_id": 1, "direction": 1, "message_body": 1, "message_text": 1,
             "status": 1, "created_at": 1, "sent_at": 1, "platform": 1,
             "to_number": 1, "from_number": 1, "message_id": 1, "interactive": 1,
             "related_to_number": 1, "ai_generated": 1, "sent_by_name": 1,
             "instance_name": 1, "instance_number": 1, "received_on_instance": 1}
        ).sort("created_at", 1))

        # Deduplicate: if same message_id exists as both outbound and inbound, keep outbound only
        seen_ids = {}  # message_id -> index in result
        result = []
        for m in messages:
            m["_id"] = str(m["_id"])
            if m.get("created_at"): m["created_at"] = m["created_at"].isoformat()
            if m.get("sent_at") and hasattr(m["sent_at"], "isoformat"): m["sent_at"] = m["sent_at"].isoformat()
            m["body"] = m.get("message_body") or m.get("message_text") or ""
            mid = m.get("message_id")
            if mid and not isinstance(mid, (str, int, float)):
                mid = str(mid)  # some legacy docs stored message_id as a dict
            if mid:
                if mid in seen_ids:
                    # prefer outbound over inbound for same message_id
                    if m["direction"] == "outbound":
                        result[seen_ids[mid]] = m
                    continue
                seen_ids[mid] = len(result)
            result.append(m)
        return result

    def mark_conversation_read(self, company_id: str):
        self.db.message_logs.update_many(
            {"company_id": company_id, "direction": "inbound", "status": {"$ne": "read"}},
            {"$set": {"status": "read", "updated_at": datetime.now()}}
        )

    def get_last_outbound_for_company(self, company_id: str, before_dt=None, to_number: str = None):
        """Returns the most recent outbound message before before_dt (and optionally matching to_number)."""
        query = {"company_id": company_id, "direction": "outbound"}
        if before_dt:
            query["created_at"] = {"$lte": before_dt}
        if to_number:
            norm = to_number.replace("+","").replace(" ","")[-10:]
            query["$or"] = [
                {"to_number": {"$regex": norm}},
                {"number":    {"$regex": norm}},
            ]
        return self.db.message_logs.find_one(query, sort=[("created_at", -1)])

    def save_message_analysis(self, log_id: str, analysis: dict):
        from bson import ObjectId
        self.db.message_logs.update_one(
            {"_id": ObjectId(log_id)},
            {"$set": {"analysis": analysis, "analysis_status": "done"}},
        )

    def get_analytics(self, page: int = 1, page_size: int = 20, category: str | None = None, company_id: str | None = None):
        """Aggregate response analysis data per company for the dashboard.
        Pass company_id to fetch analytics for a single company (e.g. for report generation)
        — drastically faster than loading all companies and filtering in Python."""
        _cid_filter = {"company_id": company_id} if company_id else {}
        # Companies with at least one analyzed inbound
        inbound_groups = {
            g["_id"]: g
            for g in self.db.message_logs.aggregate([
                {"$match": {"direction": "inbound", "analysis": {"$exists": True}, **_cid_filter}},
                # Conversation-level analyses (conversation_analysis=true) go first — they
                # have the most complete view of category/quality/notes. Within each tier,
                # most recent message wins. last_at uses $max to always reflect the actual
                # latest activity, not the analysis document's timestamp.
                {"$sort": {"analysis.conversation_analysis": -1, "created_at": -1}},
                {"$group": {
                    "_id": "$company_id",
                    "last_at": {"$max": "$created_at"},
                    "category":          {"$first": "$analysis.category"},
                    "is_ai":             {"$first": "$analysis.is_ai"},
                    "response_quality":  {"$first": "$analysis.response_quality"},
                    "business_hours":    {"$first": "$analysis.business_hours"},
                    "notes":             {"$first": "$analysis.notes"},
                    "total_responses":   {"$sum": 1},
                }},
            ])
        }
        # "Tiempo de primera respuesta" = reaction_time_min/seconds of the chronologically
        # FIRST analyzed inbound per company — NOT an average across the whole
        # conversation, which would blend later (possibly much slower/faster) replies
        # into the number. reaction_time_seconds es el valor exacto sin redondear a
        # bloques de 6s (0.1 min) — se muestra en el reporte para dar precisión real.
        first_response_groups = {
            g["_id"]: g
            for g in self.db.message_logs.aggregate([
                {"$match": {
                    "direction": "inbound",
                    "analysis.reaction_time_min": {"$ne": None},
                    **_cid_filter,
                }},
                {"$sort": {"created_at": 1}},
                {"$group": {
                    "_id": "$company_id",
                    "reaction_time_min": {"$first": "$analysis.reaction_time_min"},
                    "reaction_time_seconds": {"$first": "$analysis.reaction_time_seconds"},
                }},
            ])
        }
        for cid, g in inbound_groups.items():
            first = first_response_groups.get(cid, {})
            g["reaction_time_min"] = first.get("reaction_time_min")
            g["reaction_time_seconds"] = first.get("reaction_time_seconds")
        # Companies with outbound messages only (no analyzed inbound yet)
        outbound_groups = {
            g["_id"]: g
            for g in self.db.message_logs.aggregate([
                {"$match": {"direction": "outbound", **_cid_filter}},
                {"$sort": {"created_at": -1}},
                {"$group": {"_id": "$company_id", "last_at": {"$first": "$created_at"}}},
            ])
        }
        # El sweep en background (_sweep_pending) ya confirma y guarda "sin_respuesta"
        # (definitivo: se esperó el tiempo configurado y nunca llegó respuesta) en el
        # OUTBOUND — pero esta compañía no tiene inbound analizado, así que sin esto
        # el bloque de abajo la dejaba en category=None ("sin clasificar"/pendiente),
        # indistinguible de un caso que de verdad sigue esperando análisis.
        sin_respuesta_groups = {
            g["_id"]
            for g in self.db.message_logs.aggregate([
                {"$match": {"direction": "outbound", "analysis.category": "sin_respuesta", **_cid_filter}},
                {"$group": {"_id": "$company_id"}},
            ])
        }
        # Merge: prioritize inbound_groups, add outbound-only companies
        merged = dict(inbound_groups)
        for cid, og in outbound_groups.items():
            if cid not in merged:
                confirmed_no_reply = cid in sin_respuesta_groups
                merged[cid] = {
                    "_id": cid,
                    "last_at": og["last_at"],
                    "category": "sin_respuesta" if confirmed_no_reply else None,
                    "is_ai": None, "response_quality": None,
                    "reaction_time_min": None, "reaction_time_seconds": None, "business_hours": None,
                    "notes": "El canal no respondió al contacto realizado." if confirmed_no_reply else None,
                    "total_responses": 0,
                }
        groups = sorted(merged.values(), key=lambda g: g.get("last_at") or "", reverse=True)
        results = []
        for g in groups:
            company_id = g["_id"]
            company = None
            try:
                from bson import ObjectId
                company = self.db.companies.find_one(
                    {"_id": ObjectId(company_id)},
                    {"name": 1, "industry": 1, "domain": 1}
                ) if company_id and company_id not in ("unknown", "manual") else None
            except Exception:
                pass
            if not company:
                continue

            # Per-number breakdown — normalize to last 10 digits to avoid format mismatches
            def _norm(n):
                return (n or "").replace("+", "").replace(" ", "").replace("-", "")[-10:]

            msgs = list(self.db.message_logs.find(
                {"company_id": company_id},
                {"direction": 1, "to_number": 1, "from_number": 1, "number": 1, "analysis": 1, "created_at": 1}
            ))
            num_map = {}  # key = normalized 10-digit number
            num_raw  = {}  # key = normalized → raw display number
            for m in msgs:
                direction = m.get("direction", "outbound")
                raw = (m.get("to_number") if direction == "outbound"
                       else m.get("from_number") or m.get("number"))
                n = _norm(raw)
                if not n:
                    continue
                if n not in num_map:
                    num_map[n] = {"sent": 0, "inbound": [], "outbound_sin_respuesta": False}
                    num_raw[n] = raw  # keep first seen raw value for display
                if direction == "outbound":
                    num_map[n]["sent"] += 1
                    if (m.get("analysis") or {}).get("category") == "sin_respuesta":
                        num_map[n]["outbound_sin_respuesta"] = True
                else:
                    num_map[n]["inbound"].append(m)

            # Merge bot/unknown inbound-only numbers into the primary registered contact.
            # Bot numbers (e.g. WhatsApp Business senders) have no outbound and are not
            # in the contacts collection — they pollute the per-number breakdown.
            registered_contacts = list(self.db.contacts.find(
                {"company_id": company_id, "type": "whatsapp"}, {"value": 1, "label": 1, "source": 1}
            ))
            registered_norms = {_norm(c["value"]) for c in registered_contacts}
            contact_meta = {_norm(c["value"]): c for c in registered_contacts}

            # Build name map from person_contacts: normalized phone → first name found
            _person_name_map = {}
            for pc in self.db.person_contacts.find(
                {"company_id": company_id}, {"name": 1, "phone": 1, "whatsapp": 1}
            ):
                for _field in ("whatsapp", "phone"):
                    _pnum = _norm(pc.get(_field, "") or "")
                    if _pnum and _pnum not in _person_name_map and pc.get("name"):
                        _person_name_map[_pnum] = pc["name"]

            def _primary_num():
                for rn in registered_norms:
                    if rn in num_map and num_map[rn]["sent"] > 0:
                        return rn
                for rn in registered_norms:
                    if rn in num_map:
                        return rn
                # fallback: number with most outbound
                return max(num_map, key=lambda k: num_map[k]["sent"], default=None)

            primary = _primary_num()
            if primary:
                for n in list(num_map.keys()):
                    if n == primary:
                        continue
                    # Only merge pure inbound-only noise (bot/central numbers we never sent to).
                    # Numbers we explicitly sent outbound to (sent > 0) stay as separate rows
                    # even if they're not in the registered contacts — e.g. multiple WA numbers
                    # scraped from the same company.
                    if n not in registered_norms and num_map[n]["sent"] == 0:
                        num_map[primary]["inbound"].extend(num_map[n]["inbound"])
                        del num_map[n]
                        num_raw.pop(n, None)

            # Company-level fallback analysis — used for numbers we sent to but
            # whose response came from a central WA Business number (different from_number).
            company_analyzed = []
            for data in num_map.values():
                company_analyzed.extend([m for m in data["inbound"] if m.get("analysis")])

            # Skip companies where we never actually sent a message
            total_sent = sum(d["sent"] for d in num_map.values())
            if total_sent == 0:
                continue

            numbers = []
            for n, data in num_map.items():
                # Only include numbers we explicitly sent to
                if data["sent"] == 0:
                    continue
                analyzed = [m for m in data["inbound"] if m.get("analysis")]
                _meta = contact_meta.get(n, {})
                _src = _meta.get("source", "") or ""
                _raw_label = (_meta.get("label", "") or "").strip()
                _GENERIC_LABELS = {"whatsapp", "wa", "contacto", "chat", "mensaje", "escríbenos",
                                   "escribenos", "comunícate", "comunicate", "envíanos", "envianos"}
                _label = "" if _raw_label.lower() in _GENERIC_LABELS else _raw_label
                # Fallback: usar nombre de persona/sucursal si el contacto no tiene label
                if not _label:
                    _label = _person_name_map.get(n, "")
                entry = {
                    "number": num_raw[n],
                    "label": _label,
                    "source": re.sub(r"^https?://(www\.)?", "", _src).rstrip("/") if _src else "",
                    "sent": data["sent"],
                    "responses": len(data["inbound"]),
                    "category": None, "is_ai": None, "response_quality": None,
                    "reaction_time_min": None, "business_hours": None,
                    "notes": "Sin respuesta",
                    "inherited_analysis": False,
                }
                if analyzed:
                    # Prefer conversation-level analysis for category/notes/quality;
                    # fall back to most recent individual message if none exists. Debe
                    # ser explícitamente el más reciente por created_at — analyzed[0]
                    # (orden natural de Mongo, sin sort) no lo garantiza, y causaba que
                    # esta fila mostrara la clasificación del PRIMER mensaje histórico
                    # (p. ej. un saludo automático clasificado "bot") mientras el reporte
                    # PDF, que sí ordena por fecha, mostraba correctamente el estado
                    # actual de la conversación ("humano") — mismo número, dos respuestas
                    # distintas para la misma pregunta.
                    _conv = next((m for m in analyzed
                                  if m["analysis"].get("conversation_analysis")), None)
                    most_recent = max(analyzed, key=lambda m: m.get("created_at") or datetime.min)
                    best = _conv or most_recent
                    entry["category"]       = best["analysis"].get("category")
                    entry["is_ai"]          = best["analysis"].get("is_ai")
                    entry["notes"]          = best["analysis"].get("notes") or ""
                    entry["business_hours"] = best["analysis"].get("business_hours")
                    if _conv:
                        # Use holistic quality from conversation analysis
                        entry["response_quality"] = best["analysis"].get("response_quality")
                    else:
                        qualities = [m["analysis"].get("response_quality") or 0 for m in analyzed]
                        entry["response_quality"] = round(sum(qualities) / len(qualities), 1)
                    # "Tiempo de reacción" = reaction_time_min del mensaje analizado
                    # cronológicamente PRIMERO, no un promedio — mismo criterio que el
                    # nivel de compañía (ver first_response_groups arriba). Promediar
                    # mezclaría la velocidad de la primera respuesta con la de réplicas
                    # posteriores, que pueden ser mucho más lentas o rápidas y no dicen
                    # nada sobre qué tan rápido contestaron la primera vez.
                    with_reaction = [m for m in analyzed if m["analysis"].get("reaction_time_min") is not None]
                    first_analyzed = min(with_reaction, key=lambda m: m.get("created_at") or datetime.max) if with_reaction else None
                    entry["reaction_time_min"] = first_analyzed["analysis"]["reaction_time_min"] if first_analyzed else None
                elif company_analyzed:
                    # No direct match — inherit company-level analysis (central WA Business number).
                    _conv = next((m for m in company_analyzed
                                  if m["analysis"].get("conversation_analysis")), None)
                    most_recent = max(company_analyzed, key=lambda m: m.get("created_at") or datetime.min)
                    best = _conv or most_recent
                    entry["category"]          = best["analysis"].get("category")
                    entry["is_ai"]             = best["analysis"].get("is_ai")
                    entry["notes"]             = best["analysis"].get("notes") or ""
                    entry["business_hours"]    = best["analysis"].get("business_hours")
                    entry["response_quality"]  = best["analysis"].get("response_quality")
                    # Mismo criterio que arriba: primera respuesta cronológica, no la
                    # que haya quedado primera en el orden natural de Mongo.
                    with_reaction = [m for m in company_analyzed if m["analysis"].get("reaction_time_min") is not None]
                    first_analyzed = min(with_reaction, key=lambda m: m.get("created_at") or datetime.max) if with_reaction else None
                    entry["reaction_time_min"] = first_analyzed["analysis"]["reaction_time_min"] if first_analyzed else None
                    entry["inherited_analysis"] = True
                elif data.get("outbound_sin_respuesta"):
                    # Ni respuesta directa a este número ni análisis heredado de la
                    # compañía — pero el sweep ya confirmó (tras esperar el timeout
                    # configurado) que este número nunca contestó. Sin este chequeo,
                    # entry["category"] se quedaba en None, igual que un caso todavía
                    # pendiente de analizar — aquí ya sabemos la respuesta definitiva.
                    entry["category"] = "sin_respuesta"
                inbound_dates = [m.get("created_at") for m in data["inbound"] if m.get("created_at")]
                entry["last_at"] = max(inbound_dates).isoformat() if inbound_dates else None
                numbers.append(entry)

            # Check if any inbound for this company is still awaiting classification.
            # Search both string and ObjectId forms — old docs may store company_id as ObjectId.
            from bson import ObjectId as _ObjId
            cid_str = str(company_id)
            try:
                cid_variants = [cid_str, _ObjId(cid_str)]
            except Exception:
                cid_variants = [cid_str]
            _fresh_threshold = datetime.utcnow() - timedelta(minutes=10)
            _cnt = self.db.message_logs.count_documents({
                "company_id": {"$in": cid_variants},
                "direction": "inbound",
                "analysis_status": "pending",
                "pending_since": {"$gte": _fresh_threshold},
            })
            analyzing = _cnt > 0

            # Company-level analysis: use real data from inbound_groups, or null if no responses.
            # "sin_respuesta" es la excepción: por definición tiene total_responses=0 (esa
            # es la confirmación en sí — el sweep esperó y nunca llegó nada) pero SÍ es un
            # análisis real, no un "todavía no sabemos" — sin este OR, la línea de abajo lo
            # volvía a pisar con None pese al fix en el merge de outbound_groups arriba.
            has_real_analysis = (g["total_responses"] > 0 and g["category"]) or g["category"] == "sin_respuesta"
            results.append({
                "company_id": company_id,
                "company_name": company["name"],
                "industry": company.get("industry", ""),
                "domain": company.get("domain", ""),
                "category": g["category"] if has_real_analysis else None,
                "is_ai": g.get("is_ai") if has_real_analysis else None,
                "response_quality": round(g["response_quality"] or 0, 1) if has_real_analysis else None,
                "reaction_time_min": round(g["reaction_time_min"], 1) if (has_real_analysis and g.get("reaction_time_min") is not None) else None,
                "reaction_time_seconds": round(g["reaction_time_seconds"], 1) if (has_real_analysis and g.get("reaction_time_seconds") is not None) else None,
                "business_hours": g.get("business_hours") if has_real_analysis else None,
                "notes": g["notes"] or "" if has_real_analysis else "",
                "total_responses": g["total_responses"],
                "last_at": g["last_at"].isoformat() if g["last_at"] else None,
                "numbers": numbers,
                "analyzing": analyzing,
            })
        # Compute global category distribution from ALL results before any filtering.
        # Replicates frontend matchesCategory: "menu" normalizes to "bot", and
        # bot/bot_ia split is determined by the is_ai flag (not the category field).
        from collections import Counter
        def _eff_cat(r):
            rc = r.get("category")
            nc = "bot" if rc == "menu" else rc
            if nc == "bot":
                return "bot_ia" if r.get("is_ai") else "bot"
            return nc if nc is not None else "sin_clasificar"
        cat_counts = Counter(_eff_cat(r) for r in results)
        category_counts = {
            "humano":         cat_counts.get("humano", 0),
            "automatico":     cat_counts.get("automatico", 0),
            "hibrido":        cat_counts.get("hibrido", 0),
            "bot":            cat_counts.get("bot", 0),
            "bot_ia":         cat_counts.get("bot_ia", 0),
            "sin_respuesta":  cat_counts.get("sin_respuesta", 0),
            "sin_clasificar": cat_counts.get("sin_clasificar", 0),
            "total":          len(results),
        }
        # Apply server-side category filter after computing global counts
        if category and category != "all":
            results = [r for r in results if _eff_cat(r) == category]
        total = len(results)
        start = (page - 1) * page_size
        return {
            "total":           total,
            "page":            page,
            "page_size":       page_size,
            "pages":           (total + page_size - 1) // page_size,
            "items":           results[start: start + page_size],
            "category_counts": category_counts,
        }