"""Tests for app/daily_cap.py — the per-instance daily message cap, deduped by
the actual phone number contacted (not by company — a deliberate multi-number
send to one company now costs its own slots per number), plus the future-day
capacity estimate and the once-per-instance-per-day cap_reached notification.
Follows the fake-object convention already used in test_classifier_rules.py: no
real Mongo, just minimal collection stand-ins that implement whatever
find_one/update_one/find calls the code under test makes."""
from datetime import date, datetime

from app.daily_cap import (
    get_instance_cap,
    get_daily_count,
    increment_daily_count,
    notify_cap_reached_once,
    get_scheduled_count_today,
    get_scheduled_count_for_date,
    get_capacity_for_date,
    DAILY_CAP,
    WARMUP_CAP,
)


def _matches(doc, query):
    for k, v in query.items():
        if isinstance(v, dict) and any(op in v for op in ("$gte", "$lt", "$ne")):
            dv = doc.get(k)
            if "$gte" in v and not (dv is not None and dv >= v["$gte"]):
                return False
            if "$lt" in v and not (dv is not None and dv < v["$lt"]):
                return False
            if "$ne" in v and dv == v["$ne"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


class _UpdateResult:
    def __init__(self, modified_count=0, upserted_id=None):
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class _FakeCollection:
    """In-memory stand-in for a pymongo Collection — only the operators the
    daily_cap module actually uses ($addToSet upsert, $gte/$lt/$ne, plain equality)."""
    def __init__(self, docs=None):
        self.docs = docs or []

    def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _matches(d, query):
                return d
        return None

    def find(self, query=None, projection=None):
        query = query or {}
        return [d for d in self.docs if _matches(d, query)]

    def insert_one(self, doc):
        self.docs.append(doc)

    def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if _matches(d, query):
                self._apply(d, update)
                return _UpdateResult(modified_count=1)
        if upsert:
            new_doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            self._apply(new_doc, update)
            self.docs.append(new_doc)
            return _UpdateResult(modified_count=0, upserted_id="fake_id")
        return _UpdateResult(modified_count=0)

    def _apply(self, doc, update):
        for op, fields in update.items():
            if op == "$set":
                doc.update(fields)
            elif op == "$addToSet":
                for k, v in fields.items():
                    bucket = doc.setdefault(k, [])
                    if v not in bucket:
                        bucket.append(v)
            else:
                raise NotImplementedError(f"fake collection doesn't support {op}")


class _FakeDb:
    def __init__(self, instances=None, instance_daily_sends=None, scheduled_sends=None, app_notifications=None):
        self.instances = _FakeCollection(instances)
        self.instance_daily_sends = _FakeCollection(instance_daily_sends)
        self.scheduled_sends = _FakeCollection(scheduled_sends)
        self.app_notifications = _FakeCollection(app_notifications)


class FakeMongoDBManager:
    def __init__(self, instances=None, instance_daily_sends=None, scheduled_sends=None, app_notifications=None):
        self.db = _FakeDb(instances, instance_daily_sends, scheduled_sends, app_notifications)


# ── get_instance_cap ─────────────────────────────────────────────────────────

def test_get_instance_cap_warmup_vs_normal():
    db = FakeMongoDBManager(instances=[
        {"name": "wa-warmup", "warmup_mode": True},
        {"name": "wa-normal", "warmup_mode": False},
        {"name": "wa-unset"},
    ])
    assert get_instance_cap(db, "wa-warmup") == WARMUP_CAP
    assert get_instance_cap(db, "wa-normal") == DAILY_CAP
    assert get_instance_cap(db, "wa-unset") == DAILY_CAP


# ── get_daily_count / increment_daily_count dedup ───────────────────────────

def test_increment_daily_count_dedups_by_phone_number():
    db = FakeMongoDBManager(instance_daily_sends=[])
    increment_daily_count(db, "wa-1", phone_digits="5214421316847")
    increment_daily_count(db, "wa-1", phone_digits="5214421316847")
    increment_daily_count(db, "wa-1", phone_digits="5214421316847")
    assert get_daily_count(db, "wa-1") == 1

    increment_daily_count(db, "wa-1", phone_digits="5219988776655")
    assert get_daily_count(db, "wa-1") == 2


def test_increment_daily_count_charges_one_slot_per_distinct_number_same_company():
    # A deliberate multi-number send to ONE company (3 different lines) now costs
    # 3 real slots — each is a genuinely new WhatsApp contact regardless of
    # whether they belong to the same business.
    db = FakeMongoDBManager(instance_daily_sends=[])
    for number in ("5211111111111", "5212222222222", "5213333333333"):
        increment_daily_count(db, "wa-1", phone_digits=number)
    assert get_daily_count(db, "wa-1") == 3


def test_get_daily_count_is_per_instance():
    db = FakeMongoDBManager(instance_daily_sends=[])
    increment_daily_count(db, "wa-1", phone_digits="5214421316847")
    increment_daily_count(db, "wa-2", phone_digits="5214421316847")
    # Same number messaged via two different instances — each instance's own
    # cap is charged independently, this module doesn't merge across instances.
    assert get_daily_count(db, "wa-1") == 1
    assert get_daily_count(db, "wa-2") == 1


def test_increment_daily_count_without_phone_digits_still_counts():
    db = FakeMongoDBManager(instance_daily_sends=[])
    increment_daily_count(db, "wa-1", phone_digits=None)
    increment_daily_count(db, "wa-1", phone_digits=None)
    assert get_daily_count(db, "wa-1") == 2


# ── notify_cap_reached_once ─────────────────────────────────────────────────

def test_notify_cap_reached_once_fires_once_per_instance_per_day():
    db = FakeMongoDBManager(instances=[{"name": "wa-1", "label": "Marco WA", "warmup_mode": True}])
    notify_cap_reached_once(db, "wa-1")
    notify_cap_reached_once(db, "wa-1")
    notify_cap_reached_once(db, "wa-1")
    notifications = db.db.app_notifications.find({"type": "cap_reached"})
    assert len(notifications) == 1
    assert notifications[0]["instance"] == "wa-1"
    assert notifications[0]["label"] == "Marco WA"
    assert notifications[0]["cap"] == WARMUP_CAP


def test_notify_cap_reached_once_is_independent_per_instance():
    db = FakeMongoDBManager(instances=[
        {"name": "wa-1", "warmup_mode": True},
        {"name": "wa-2", "warmup_mode": False},
    ])
    notify_cap_reached_once(db, "wa-1")
    notify_cap_reached_once(db, "wa-2")
    assert len(db.db.app_notifications.find({"type": "cap_reached"})) == 2


# ── get_scheduled_count_for_date / get_scheduled_count_today ────────────────

def _pending(scheduled_at, total_count=None, selected_numbers=None, _id="job"):
    doc = {"_id": _id, "status": "pending", "scheduled_at": scheduled_at}
    if total_count is not None:
        doc["total_count"] = total_count
    if selected_numbers is not None:
        doc["selected_numbers"] = selected_numbers
    return doc


def test_get_scheduled_count_for_date_only_counts_that_day():
    day1 = date(2026, 3, 10)
    day2 = date(2026, 3, 11)
    db = FakeMongoDBManager(scheduled_sends=[
        _pending(datetime(2026, 3, 10, 9, 0), total_count=5, _id="a"),
        _pending(datetime(2026, 3, 10, 23, 59), total_count=3, _id="b"),
        _pending(datetime(2026, 3, 11, 0, 0), total_count=7, _id="c"),
    ])
    assert get_scheduled_count_for_date(db, day1) == 8
    assert get_scheduled_count_for_date(db, day2) == 7


def test_get_scheduled_count_for_date_falls_back_to_selected_numbers_length():
    day1 = date(2026, 3, 10)
    db = FakeMongoDBManager(scheduled_sends=[
        _pending(datetime(2026, 3, 10, 9, 0), selected_numbers=[{"number": "1"}, {"number": "2"}], _id="a"),
    ])
    assert get_scheduled_count_for_date(db, day1) == 2


def test_get_scheduled_count_for_date_excludes_own_job_when_editing():
    day1 = date(2026, 3, 10)
    from bson import ObjectId
    own_id = ObjectId()
    db = FakeMongoDBManager(scheduled_sends=[
        _pending(datetime(2026, 3, 10, 9, 0), total_count=5, _id=own_id),
        _pending(datetime(2026, 3, 10, 10, 0), total_count=3, _id="other"),
    ])
    assert get_scheduled_count_for_date(db, day1) == 8
    assert get_scheduled_count_for_date(db, day1, exclude_id=str(own_id)) == 3


def test_get_scheduled_count_today_wraps_for_date():
    today = datetime.now().date()
    db = FakeMongoDBManager(scheduled_sends=[
        _pending(datetime(today.year, today.month, today.day, 8, 0), total_count=4, _id="a"),
    ])
    assert get_scheduled_count_today(db) == 4


# ── get_capacity_for_date ────────────────────────────────────────────────────

def test_get_capacity_for_date_combines_instances_and_subtracts_scheduled():
    day = date(2026, 3, 10)
    db = FakeMongoDBManager(
        instances=[
            {"name": "wa-warmup", "warmup_mode": True, "assigned_to": "u1"},
            {"name": "wa-normal", "warmup_mode": False, "assigned_to": "u1"},
        ],
        scheduled_sends=[
            _pending(datetime(2026, 3, 10, 9, 0), total_count=15, _id="a"),
        ],
    )
    result = get_capacity_for_date(db, "u1", day)
    assert result["total_cap"] == WARMUP_CAP + DAILY_CAP
    assert result["scheduled_that_day"] == 15
    assert result["total_available"] == WARMUP_CAP + DAILY_CAP - 15


def test_get_capacity_for_date_never_goes_negative():
    day = date(2026, 3, 10)
    db = FakeMongoDBManager(
        instances=[{"name": "wa-warmup", "warmup_mode": True, "assigned_to": "u1"}],
        scheduled_sends=[_pending(datetime(2026, 3, 10, 9, 0), total_count=999, _id="a")],
    )
    result = get_capacity_for_date(db, "u1", day)
    assert result["total_available"] == 0


def test_get_capacity_for_date_ignores_other_users_instances():
    day = date(2026, 3, 10)
    db = FakeMongoDBManager(instances=[
        {"name": "wa-mine", "warmup_mode": False, "assigned_to": "u1"},
        {"name": "wa-other", "warmup_mode": False, "assigned_to": "u2"},
    ])
    result = get_capacity_for_date(db, "u1", day)
    assert result["total_cap"] == DAILY_CAP
