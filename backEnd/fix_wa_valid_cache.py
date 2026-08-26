"""One-off: clear jid_map entries where wa_valid=False, which were cached
incorrectly because the wwebjs verify response uses 'registered' but the code
was reading 'exists' (always missing → always False).

Run once after deploying the scheduler.py fix:
  cd /home/ubuntu && python backEnd/fix_wa_valid_cache.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
from database import MongoDBManager

db = MongoDBManager()
result = db.db.jid_map.update_many(
    {"wa_valid": False},
    {"$unset": {"wa_valid": "", "wa_checked_at": ""}},
)
print(f"Cleared wa_valid cache from {result.modified_count} jid_map entries.")
print("Numbers will be re-verified correctly on the next send attempt.")
