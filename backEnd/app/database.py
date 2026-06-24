# database.py
import re
from pymongo import MongoClient
from datetime import datetime, timedelta
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
        if contact_data.get("type") == "whatsapp":
            value = contact_data.get("value", "")
            clean10 = "".join(filter(str.isdigit, value))[-10:]
            existing = self.db.contacts.find_one({
                "company_id": contact_data["company_id"],
                "type": "whatsapp",
                "value": {"$regex": clean10, "$options": "i"},
            })
            if existing:
                new_label = contact_data.get("label", "")
                if new_label and not existing.get("label"):
                    self.db.contacts.update_one(
                        {"_id": existing["_id"]},
                        {"$set": {"label": new_label}},
                    )
                return str(existing["_id"])
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
                {"name": 1, "domain": 1, "website": 1, "industry": 1, "city": 1, "state": 1, "has_whatsapp": 1, "status": 1, "created_at": 1}
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
        from datetime import datetime, timedelta
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
                           related_to_number: str = None):
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
            "created_at": datetime.now(),
        }
        if interactive:
            doc["interactive"] = interactive
        if direction == "outbound":
            doc["to_number"] = number
        else:
            doc["from_number"] = number
            if related_to_number:
                doc["related_to_number"] = related_to_number
            # Mark for analysis so the analytics panel can show a loading indicator.
            # Skip unknown company_id — classifier won't run for them anyway.
            if message_body and message_body != "[media]" and company_id not in (None, "unknown"):
                doc["analysis_status"] = "pending"
                doc["pending_since"] = datetime.utcnow()
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
             "related_to_number": 1}
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
            {"$set": {"analysis": analysis, "analysis_status": "done"}},
        )

    def get_analytics(self, page: int = 1, page_size: int = 20):
        """Aggregate response analysis data per company for the dashboard."""
        # Companies with at least one analyzed inbound
        inbound_groups = {
            g["_id"]: g
            for g in self.db.message_logs.aggregate([
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
            ])
        }
        # Companies with outbound messages only (no analyzed inbound yet)
        outbound_groups = {
            g["_id"]: g
            for g in self.db.message_logs.aggregate([
                {"$match": {"direction": "outbound"}},
                {"$sort": {"created_at": -1}},
                {"$group": {"_id": "$company_id", "last_at": {"$first": "$created_at"}}},
            ])
        }
        # Merge: prioritize inbound_groups, add outbound-only companies
        merged = dict(inbound_groups)
        for cid, og in outbound_groups.items():
            if cid not in merged:
                merged[cid] = {
                    "_id": cid,
                    "last_at": og["last_at"],
                    "category": None, "response_quality": None,
                    "reaction_time_min": None, "business_hours": None,
                    "notes": None, "total_responses": 0,
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
                    num_map[n] = {"sent": 0, "inbound": []}
                    num_raw[n] = raw  # keep first seen raw value for display
                if direction == "outbound":
                    num_map[n]["sent"] += 1
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
                    "category": None, "response_quality": None,
                    "reaction_time_min": None, "business_hours": None,
                    "notes": "Sin respuesta",
                    "inherited_analysis": False,
                }
                if analyzed:
                    first = analyzed[0]
                    entry["category"]          = first["analysis"].get("category")
                    entry["notes"]             = first["analysis"].get("notes") or ""
                    entry["business_hours"]    = first["analysis"].get("business_hours")
                    qualities = [m["analysis"].get("response_quality") or 0 for m in analyzed]
                    reactions = [m["analysis"].get("reaction_time_min") or 0 for m in analyzed]
                    entry["response_quality"]  = round(sum(qualities) / len(qualities), 1)
                    entry["reaction_time_min"] = round(sum(reactions) / len(reactions), 1)
                elif company_analyzed:
                    # No direct match — inherit company-level analysis (central WA Business number).
                    best = company_analyzed[0]
                    entry["category"]          = best["analysis"].get("category")
                    entry["notes"]             = best["analysis"].get("notes") or ""
                    entry["business_hours"]    = best["analysis"].get("business_hours")
                    entry["response_quality"]  = best["analysis"].get("response_quality")
                    entry["reaction_time_min"] = best["analysis"].get("reaction_time_min")
                    entry["inherited_analysis"] = True
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

            # Company-level analysis: use real data from inbound_groups, or null if no responses
            has_real_analysis = g["total_responses"] > 0 and g["category"]
            results.append({
                "company_id": company_id,
                "company_name": company["name"],
                "industry": company.get("industry", ""),
                "domain": company.get("domain", ""),
                "category": g["category"] if has_real_analysis else None,
                "response_quality": round(g["response_quality"] or 0, 1) if has_real_analysis else None,
                "reaction_time_min": round(g["reaction_time_min"] or 0, 1) if has_real_analysis else None,
                "business_hours": g.get("business_hours") if has_real_analysis else None,
                "notes": g["notes"] or "" if has_real_analysis else "",
                "total_responses": g["total_responses"],
                "last_at": g["last_at"].isoformat() if g["last_at"] else None,
                "numbers": numbers,
                "analyzing": analyzing,
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