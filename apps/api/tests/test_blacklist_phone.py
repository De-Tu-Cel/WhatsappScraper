"""Tests for the phone-number blacklist added 2026-09-25 — extends the
pre-existing domain/industry blacklist (app/pipeline.py's _check_blacklist)
with a third type that's checked directly against a destination number,
independent of company_id/domain, since a number can need blocking without
its company being flagged at all.
"""
from app.api.routes import _normalize_blacklist_value
from app.ai_followup import _is_blocked_or_blacklisted


class TestNormalizeBlacklistValue:
    def test_phone_strips_non_digits(self):
        assert _normalize_blacklist_value("phone", "+52 (551) 234-5678") == "525512345678"

    def test_phone_empty_value(self):
        assert _normalize_blacklist_value("phone", "") == ""

    def test_domain_still_strips_scheme_and_www(self):
        assert _normalize_blacklist_value("domain", "https://www.Example.com/") == "example.com"


class FakeBlacklistCollection:
    def __init__(self, entries):
        self._entries = entries

    def find_one(self, query):
        for e in self._entries:
            if e.get("type") == query.get("type") and e.get("value") == query.get("value"):
                return e
        return None


class FakeCompaniesCollection:
    def __init__(self, docs):
        self._docs = {str(d["_id"]): d for d in docs}

    def find_one(self, query, projection=None):
        from bson import ObjectId
        _id = query.get("_id")
        return self._docs.get(str(_id))


class FakeDb:
    def __init__(self, blacklist=None, companies=None):
        self.blacklist = FakeBlacklistCollection(blacklist or [])
        self.companies = FakeCompaniesCollection(companies or [])


class FakeMgr:
    def __init__(self, blacklist=None, companies=None):
        self.db = FakeDb(blacklist, companies)


class TestIsBlockedOrBlacklisted:
    def test_blacklisted_phone_blocks_with_no_company_id(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "5215512345678"}])
        assert _is_blocked_or_blacklisted(mgr, None, "+52 1 55 1234 5678") is True

    def test_unrelated_phone_not_blocked(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "5215512345678"}])
        assert _is_blocked_or_blacklisted(mgr, None, "+525199999999") is False

    def test_no_company_no_phone_hit_defaults_false(self):
        mgr = FakeMgr(blacklist=[])
        assert _is_blocked_or_blacklisted(mgr, None, None) is False

    def test_company_blocked_flag_still_works(self):
        from bson import ObjectId
        cid = ObjectId()
        mgr = FakeMgr(companies=[{"_id": cid, "blocked": True}])
        assert _is_blocked_or_blacklisted(mgr, str(cid), None) is True

    def test_phone_check_short_circuits_before_company_lookup(self):
        # Even an invalid/garbage company_id must not raise, because the
        # phone hit returns True before any company_id parsing happens.
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "5215512345678"}])
        assert _is_blocked_or_blacklisted(mgr, "not-a-real-id", "5215512345678") is True

    def test_exception_fails_safe_allowing_send(self):
        class BrokenDb:
            @property
            def blacklist(self):
                raise RuntimeError("boom")
        class BrokenMgr:
            db = BrokenDb()
        assert _is_blocked_or_blacklisted(BrokenMgr(), None, "5215512345678") is False
