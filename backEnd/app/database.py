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
        return list(self.db.contacts.find({"company_id": company_id}))

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

        # Agregar contactos
        company["contacts"] = list(self.db.contacts.find({"company_id": company_id}))
        company["person_contacts"] = list(self.db.person_contacts.find({"company_id": company_id}))
        company["social_media"] = self.db.social_media.find_one({"company_id": company_id})

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