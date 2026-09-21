import json
from bson import ObjectId
from datetime import datetime

class MongoEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId): return str(o)
        if isinstance(o, datetime):
            # MongoDBManager's client has no tz_aware=True, so pymongo hands
            # back naive datetimes that actually represent UTC (Mongo always
            # stores UTC internally). Plain .isoformat() on a naive datetime
            # omits any timezone marker, and JS's `new Date(...)` then reads
            # that string as LOCAL time instead of UTC — silently shifting
            # every serialized timestamp by the viewer's UTC offset. Most
            # places this just skews a displayed date by a few hours and
            # goes unnoticed; it's glaring on the send-queue bubble's live
            # countdown (a 45s wait rendered as ~6 hours for a UTC-6 viewer).
            return (o.isoformat() + "Z") if o.tzinfo is None else o.isoformat()
        return super().default(o)

def serialize(obj):
    return json.loads(json.dumps(obj, cls=MongoEncoder))