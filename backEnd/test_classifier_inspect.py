import sys, os
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
from app.database import MongoDBManager
from datetime import datetime, timedelta, timezone
db = MongoDBManager()
now = datetime.now(timezone.utc)

total = db.db.message_logs.count_documents({})
with_analysis = db.db.message_logs.count_documents({"analysis": {"$exists": True}})
outbound = db.db.message_logs.count_documents({"direction": "outbound"})
inbound = db.db.message_logs.count_documents({"direction": "inbound"})
print(f"Total message_logs: {total}")
print(f"  outbound: {outbound}  inbound: {inbound}")
print(f"  with analysis: {with_analysis}")

sample = db.db.message_logs.find_one({"analysis": {"$exists": True}})
if sample:
    a = sample.get("analysis", {})
    print(f"\nSample analysis keys: {list(a.keys())}")
    print(f"  category:  {a.get('category')}")
    print(f"  direction: {sample.get('direction')}")
    print(f"  created_at:{sample.get('created_at')}")
    print(f"  body:      {str(sample.get('message_body',''))[:80]}")

pipeline = [
    {"$match": {"analysis": {"$exists": True}}},
    {"$group": {"_id": "$analysis.category", "count": {"$sum": 1}}},
    {"$sort": {"count": -1}},
]
cats = list(db.db.message_logs.aggregate(pipeline))
print(f"\nAll-time category distribution ({with_analysis} docs with analysis):")
for c in cats:
    print(f"  {c['_id']}: {c['count']}")

# Most recent 5 outbounds with analysis
print("\nMost recent 5 outbounds with analysis:")
for doc in db.db.message_logs.find(
    {"direction": "outbound", "analysis": {"$exists": True}},
    sort=[("created_at", -1)], limit=5
):
    a = doc.get("analysis", {})
    dt = doc.get("created_at")
    if dt and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    mx = dt.astimezone(timezone(timedelta(hours=-6))) if dt else None
    ts = mx.strftime("%m-%d %H:%M") if mx else "?"
    body = str(doc.get("message_body", ""))[:60]
    print(f"  [{ts}] cat={a.get('category')}  body={body!r}")
