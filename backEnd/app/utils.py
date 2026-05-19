import json
from bson import ObjectId
from datetime import datetime

class MongoEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId): return str(o)
        if isinstance(o, datetime): return o.isoformat()
        return super().default(o)

def serialize(obj):
    return json.loads(json.dumps(obj, cls=MongoEncoder))