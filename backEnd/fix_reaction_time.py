"""
Repair script: recalculates reaction_time_min for inbound messages where it's null.
Run once against prod: python fix_reaction_time.py
"""
import os, sys
from datetime import datetime, timezone
from pymongo import MongoClient, UpdateOne
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

MONGO_URI   = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME     = os.getenv("DATABASE_NAME", "commercial")

client = MongoClient(MONGO_URI)
db     = client[DB_NAME]
logs   = db.message_logs

def _norm_number(n):
    if not n:
        return None
    return "".join(filter(str.isdigit, str(n)))[-10:]

def _find_last_outbound(company_id, before_dt, to_number=None):
    q = {"company_id": company_id, "direction": "outbound", "created_at": {"$lte": before_dt}}
    if to_number:
        norm = _norm_number(to_number)
        if norm:
            q["$or"] = [
                {"to_number": {"$regex": norm}},
                {"number":    {"$regex": norm}},
            ]
    doc = logs.find_one(q, sort=[("created_at", -1)])
    if doc:
        return doc
    # fallback: any outbound to this company
    if to_number:
        q2 = {"company_id": company_id, "direction": "outbound", "created_at": {"$lte": before_dt}}
        return logs.find_one(q2, sort=[("created_at", -1)])
    return None

def main():
    # All classified inbound messages with no reaction_time_min
    cursor = logs.find(
        {
            "direction": "inbound",
            "analysis": {"$exists": True},
            "$or": [
                {"analysis.reaction_time_min": None},
                {"analysis.reaction_time_min": {"$exists": False}},
            ],
        },
        {"_id": 1, "company_id": 1, "created_at": 1, "from_number": 1, "number": 1},
    )

    total = logs.count_documents({
        "direction": "inbound",
        "analysis": {"$exists": True},
        "$or": [
            {"analysis.reaction_time_min": None},
            {"analysis.reaction_time_min": {"$exists": False}},
        ],
    })
    print(f"Found {total} records to repair")

    ops    = []
    fixed  = 0
    no_out = 0
    neg    = 0

    for doc in cursor:
        received_at = doc.get("created_at")
        if not received_at or not isinstance(received_at, datetime):
            no_out += 1
            continue

        company_id  = doc.get("company_id")
        from_number = doc.get("from_number") or doc.get("number")

        outbound = _find_last_outbound(company_id, received_at, from_number)
        if not outbound:
            no_out += 1
            continue

        sent_at = outbound.get("created_at")
        if not sent_at or not isinstance(sent_at, datetime):
            no_out += 1
            continue

        # Make both timezone-aware for safe subtraction
        if received_at.tzinfo is None:
            received_at = received_at.replace(tzinfo=timezone.utc)
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)

        raw_seconds = (received_at - sent_at).total_seconds()
        if raw_seconds < 0:
            neg += 1
            continue

        minutes = round(raw_seconds / 60, 1)
        ops.append(UpdateOne(
            {"_id": doc["_id"]},
            {"$set": {
                "analysis.reaction_time_min":     minutes,
                "analysis.reaction_time_seconds": round(raw_seconds, 1),
            }},
        ))
        fixed += 1

        if len(ops) >= 500:
            db.message_logs.bulk_write(ops, ordered=False)
            print(f"  flushed 500 ops (fixed so far: {fixed})")
            ops = []

    if ops:
        db.message_logs.bulk_write(ops, ordered=False)

    print(f"\nDone — fixed: {fixed}  |  no outbound found: {no_out}  |  negative delta: {neg}")

if __name__ == "__main__":
    main()
