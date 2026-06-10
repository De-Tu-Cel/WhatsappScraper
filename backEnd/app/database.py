# database.py
from pymongo import MongoClient
from datetime import datetime
from gridfs import GridFS
from config import MONGODB_URI, DATABASE_NAME


class MongoDBManager:
    def __init__(self):
        self.client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        self.client.admin.command("ping")
        self.db = self.client[DATABASE_NAME]
        self.fs = GridFS(self.db)
        try:
            self.db.companies.create_index("domain", unique=True, sparse=True)
        except Exception:
            pass  # duplicates exist — index will be created after cleanup

    def insert_company(self, company_data):
        company_data["created_at"] = company_data.get("created_at", datetime.now())
        result = self.db.companies.insert_one(company_data)
        return str(result.inserted_id)

    def insert_contact(self, contact_data):
        contact_data["created_at"] = contact_data.get("created_at", datetime.now())
        result = self.db.contacts.insert_one(contact_data)
        return str(result.inserted_id)

    def insert_message_log(self, log_data):
        log_data["created_at"] = log_data.get("created_at", datetime.now())
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
        result = self.db.person_contacts.insert_one(contact_data)
        return str(result.inserted_id)

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
                {"name": 1, "domain": 1, "website": 1, "industry": 1, "city": 1, "state": 1, "has_whatsapp": 1, "status": 1, "created_at": 1}
            )
            .sort("created_at", -1)
            .skip((page - 1) * page_size)
            .limit(page_size)
        )
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

    def find_company_id_by_phone(self, phone_number):
        clean = "".join(filter(str.isdigit, phone_number))
        contact = self.db.contacts.find_one({
            "type": "whatsapp",
            "value": {"$regex": clean[-10:], "$options": "i"},
        })
        if contact:
            return contact["company_id"]
        # Fallback: last company we sent a message to in the past hour
        from datetime import datetime, timedelta
        recent = self.db.message_logs.find_one(
            {"direction": "outbound", "status": {"$ne": "failed"},
             "created_at": {"$gte": datetime.now() - timedelta(hours=1)}},
            sort=[("created_at", -1)],
        )
        return recent["company_id"] if recent else None

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
                           interactive: dict = None):
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
            "created_at": datetime.now(),
        }
        if interactive:
            doc["interactive"] = interactive
        if direction == "outbound":
            doc["to_number"] = number
        else:
            doc["from_number"] = number
        result = self.db.message_logs.insert_one(doc)
        return str(result.inserted_id)

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
            }},
            {"$sort": {"last_at": -1}},
        ]
        groups = list(self.db.message_logs.aggregate(pipeline))
        results = []
        for g in groups:
            company_id = g["_id"]
            company = None
            try:
                company = self.db.companies.find_one(
                    {"_id": ObjectId(company_id)},
                    {"name": 1, "domain": 1, "website": 1, "industry": 1}
                ) if company_id and company_id != "manual" and company_id != "unknown" else None
            except Exception:
                pass
            if not company:
                continue  # skip personal chats and unknown contacts
            has_wa = self.db.contacts.find_one({"company_id": company_id, "type": "whatsapp"})
            if not has_wa:
                continue  # skip companies with no WhatsApp number
            last_inbound_analyzed = self.db.message_logs.find_one(
                {"company_id": company_id, "direction": "inbound", "analysis": {"$exists": True}},
                sort=[("created_at", -1)],
                projection={"analysis": 1}
            )
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
                "last_analysis":      last_inbound_analyzed.get("analysis") if last_inbound_analyzed else None,
            })
        # Deduplicate by company_name — keep the entry with the most recent message
        seen_names = {}
        deduped = []
        for r in results:
            name = r["company_name"]
            if name not in seen_names:
                seen_names[name] = len(deduped)
                deduped.append(r)
            else:
                # keep the one with more unread or more recent last_at
                idx = seen_names[name]
                if (r["unread"] > deduped[idx]["unread"] or
                        (r["last_at"] or "") > (deduped[idx]["last_at"] or "")):
                    deduped[idx] = r
        return deduped

    def get_conversation_thread(self, company_id: str):
        """Returns all messages for a company sorted by time, deduplicated."""
        messages = list(self.db.message_logs.find(
            {
                "company_id": company_id,
                "direction": {"$in": ["outbound", "inbound"]},  # exclude entries with no direction (e.g. failed Meta API logs)
                "status": {"$ne": "failed"},                    # exclude failed sends
            },
            {"_id": 1, "direction": 1, "message_body": 1, "message_text": 1,
             "status": 1, "created_at": 1, "sent_at": 1, "platform": 1,
             "to_number": 1, "from_number": 1, "message_id": 1, "interactive": 1}
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
            {"$set": {"analysis": analysis}}
        )

    def get_analytics(self, page: int = 1, page_size: int = 20):
        """Aggregate response analysis data per company for the dashboard."""
        pipeline = [
            {"$match": {"direction": "inbound", "analysis": {"$exists": True}}},
            {"$sort": {"created_at": -1}},
            {"$group": {
                "_id": "$company_id",
                "last_at": {"$first": "$created_at"},
                "category": {"$first": "$analysis.category"},
                "response_quality": {"$avg": "$analysis.response_quality"},
                "reaction_time_min": {"$avg": "$analysis.reaction_time_min"},
                "business_hours": {"$first": "$analysis.business_hours"},
                "notes": {"$first": "$analysis.notes"},
                "total_responses": {"$sum": 1},
            }},
            {"$sort": {"last_at": -1}},
        ]
        groups = list(self.db.message_logs.aggregate(pipeline))
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
                    num_map[n] = {"sent": 0, "inbound": []}
                    num_raw[n] = raw  # keep first seen raw value for display
                if direction == "outbound":
                    num_map[n]["sent"] += 1
                else:
                    num_map[n]["inbound"].append(m)

            numbers = []
            for n, data in num_map.items():
                analyzed = [m for m in data["inbound"] if m.get("analysis")]
                entry = {
                    "number": num_raw[n],  # use original format for display
                    "sent": data["sent"],
                    "responses": len(data["inbound"]),
                    "category": None, "response_quality": None,
                    "reaction_time_min": None, "business_hours": None,
                }
                if analyzed:
                    first = analyzed[0]
                    entry["category"]        = first["analysis"].get("category")
                    entry["notes"]           = first["analysis"].get("notes") or ""
                    entry["business_hours"]  = first["analysis"].get("business_hours")
                    qualities = [m["analysis"].get("response_quality") or 0 for m in analyzed]
                    reactions = [m["analysis"].get("reaction_time_min") or 0 for m in analyzed]
                    entry["response_quality"]   = round(sum(qualities) / len(qualities), 1)
                    entry["reaction_time_min"]  = round(sum(reactions) / len(reactions), 1)
                # last inbound timestamp for this number
                inbound_dates = [m.get("created_at") for m in data["inbound"] if m.get("created_at")]
                entry["last_at"] = max(inbound_dates).isoformat() if inbound_dates else None
                numbers.append(entry)

            results.append({
                "company_id": company_id,
                "company_name": company["name"],
                "industry": company.get("industry", ""),
                "domain": company.get("domain", ""),
                "category": g["category"] or "humano",
                "response_quality": round(g["response_quality"] or 0, 1),
                "reaction_time_min": round(g["reaction_time_min"] or 0, 1),
                "business_hours": g.get("business_hours"),
                "notes": g["notes"] or "",
                "total_responses": g["total_responses"],
                "last_at": g["last_at"].isoformat() if g["last_at"] else None,
                "numbers": numbers,
            })
        total = len(results)
        start = (page - 1) * page_size
        return {
            "total":     total,
            "page":      page,
            "page_size": page_size,
            "pages":     (total + page_size - 1) // page_size,
            "items":     results[start: start + page_size],
        }