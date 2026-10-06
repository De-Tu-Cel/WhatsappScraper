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

    def find_one(self, query, projection=None):
        import re
        want = query.get("value")
        for e in self._entries:
            if e.get("type") != query.get("type"):
                continue
            if isinstance(want, dict) and "$regex" in want:
                if re.search(want["$regex"], e.get("value", "")):
                    return e
            elif e.get("value") == want:
                return e
        return None

    def find(self, query, projection=None):
        return [e for e in self._entries if e.get("type") == query.get("type")]


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


# ── Any phone format, every send path (2026-10-04) ────────────────────────────
#
# Inbound numbers arrive as 521…, numbers blocked from a recipient list are
# stored as 52… and scraped contacts as +52…: the old exact-digits match let a
# blocked number through depending on where it came from.

class TestPhoneMatchesAcrossFormats:
    def test_blocked_as_52_catches_inbound_521(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "526642857783"}])
        assert _is_blocked_or_blacklisted(mgr, None, "5216642857783") is True

    def test_blocked_as_521_catches_scraped_plus_52(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "5216642857783"}])
        assert _is_blocked_or_blacklisted(mgr, None, "+52 664 285 7783") is True

    def test_ten_digit_entry_matches(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "6642857783"}])
        assert _is_blocked_or_blacklisted(mgr, None, "526642857783") is True

    def test_different_number_same_prefix_not_blocked(self):
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "526642857783"}])
        assert _is_blocked_or_blacklisted(mgr, None, "526642857784") is False


class TestSendGuard:
    def test_phone_reason_wins_over_company(self):
        from app.send_guard import send_block_reason
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "526642857783"}])
        assert send_block_reason(mgr, "", "5216642857783")["reason"] == "phone"

    def test_keys(self):
        from app.send_guard import phone_key, blacklisted_phone_keys
        assert phone_key("+52 1 664 285 7783") == "6642857783"
        mgr = FakeMgr(blacklist=[{"type": "phone", "value": "5216642857783"}])
        assert blacklisted_phone_keys(mgr) == {"6642857783"}


class TestIndustryMatchesWholeWords:
    def test_gas_does_not_block_gastronomia(self):
        from app.pipeline import _industry_matches
        assert _industry_matches("Gastronomía", "gas") is False
        assert _industry_matches("Gas LP", "gas") is True

    def test_accents_and_plurals(self):
        from app.pipeline import _industry_matches
        assert _industry_matches("Médico general", "medico") is True
        assert _industry_matches("Restaurantes", "restaurante") is True
        assert _industry_matches("Abarrotes / Minisuper", "abarrote") is True


class TestScheduledCampaignSkipsBlocked:
    """Scheduled campaigns checked no blacklist at all — a number blocked after
    the campaign was scheduled still got the message (audit 2026-10-04)."""

    def test_blocked_number_skipped_rest_sent(self):
        from unittest.mock import MagicMock, patch
        from bson import ObjectId
        from app import scheduler

        job_id = ObjectId()
        job = {"_id": job_id, "messages": ["hola"], "selected_numbers": [
            {"company_id": "", "number": "5216642857783", "company_name": "A"},
            {"company_id": "", "number": "5215511112222", "company_name": "B"},
        ]}
        sched = MagicMock()
        sched.find_one.return_value = job
        db = FakeMgr(blacklist=[{"type": "phone", "value": "526642857783"}])
        db.db.scheduled_sends = sched
        db.db.app_notifications = MagicMock()
        with patch("app.database.MongoDBManager", return_value=db),              patch.object(scheduler, "_any_instance_connected", return_value=True),              patch.object(scheduler, "_send_message", return_value=True) as send,              patch.object(scheduler.time, "sleep"):
            scheduler._execute_send_job(str(job_id))
        assert [c.args[2] for c in send.call_args_list] == ["5215511112222"]
        sets = [c.args[1]["$set"] for c in sched.update_one.call_args_list]
        assert any(st.get("skipped_blocked_count") == 1 for st in sets)
        assert sets[-1]["status"] == "done"


class TestScheduledCampaignAttribution:
    """Los mensajes de una campaña programada se atribuyen a quien la creó, no a
    "Envio programado" (real ask, 2026-10-05)."""

    def _run(self, job_extra):
        from unittest.mock import MagicMock, patch
        from bson import ObjectId
        from app import scheduler
        job_id = ObjectId()
        job = {"_id": job_id, "messages": ["hola"], **job_extra,
               "selected_numbers": [{"company_id": "", "number": "5215511112222", "company_name": "B"}]}
        sched = MagicMock()
        sched.find_one.return_value = job
        db = FakeMgr(blacklist=[])
        db.db.scheduled_sends = sched
        db.db.app_notifications = MagicMock()
        with patch("app.database.MongoDBManager", return_value=db),              patch.object(scheduler, "_any_instance_connected", return_value=True),              patch.object(scheduler, "_send_message", return_value=True) as send,              patch.object(scheduler.time, "sleep"):
            scheduler._execute_send_job(str(job_id))
        return send.call_args.kwargs

    def test_sent_as_the_campaign_creator(self):
        kw = self._run({"created_by_username": "tono", "created_by_name": "Antonio Dominguez"})
        assert (kw["sent_by_username"], kw["sent_by_name"]) == ("tono", "Antonio Dominguez")

    def test_old_jobs_without_creator_keep_the_generic_name(self):
        kw = self._run({})
        assert (kw["sent_by_username"], kw["sent_by_name"]) == ("scheduler", "Envio programado")


class TestIndustryWordStart:
    """Longer entries match the beginning of a word, so the user doesn't have to
    guess the app's exact category name ("Cerrajero" vs "cerrajería")."""

    def test_prefix_for_longer_entries(self):
        from app.pipeline import _industry_matches
        assert _industry_matches("Farmacia", "farmac") is True
        assert _industry_matches("Cerrajero", "cerrajer") is True
        assert _industry_matches("Automotriz", "auto") is True

    def test_short_entries_stay_whole_word(self):
        from app.pipeline import _industry_matches
        assert _industry_matches("Gastronomía", "gas") is False
        assert _industry_matches("Gas LP / Energía", "gas") is True

    def test_free_text_that_is_not_a_category_does_not_match(self):
        from app.pipeline import _industry_matches
        assert _industry_matches("Gas LP / Energía", "gaseras") is False


class TestIndustryEntryAlsoMatchesName:
    """Industry detection is coarse for small businesses — "Cerrajería en
    Saltillo" came out as "Servicios" and blocking "cerrajer" let it through
    (end-to-end test 2026-10-04). The entry also applies to the business name."""

    def test_named_business_with_generic_industry_is_blocked(self):
        from unittest.mock import MagicMock, patch
        from app import pipeline
        fake = MagicMock()
        fake.db.blacklist.find.return_value = [{"type": "industry", "value": "cerrajer"}]
        with patch.object(pipeline, "MongoDBManager", return_value=fake):
            assert pipeline._check_blacklist("", "Servicios", "Cerrajería en Saltillo")["reason"] == "industry"
            assert pipeline._check_blacklist("", "Servicio de duplicación de llaves", "Cerrajería Abrego's") is not None
            assert pipeline._check_blacklist("", "Servicios", "Plomería Pérez") is None
