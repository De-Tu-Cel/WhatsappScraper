"""Tests for app/scrape_jobs.py — pause / resume / cancel lifecycle.

All tests run entirely in-memory:
  - MongoDBManager replaced with FakeMgr (no real Mongo)
  - _process_one_url replaced with _fake_result (no HTTP, no BrightData)
  - time.sleep patched to a no-op (pause loops complete instantly)

Coverage:
  - _mark_pending_urls: correct pending count at various next_index positions
  - set_job_action: pause / resume / cancel / reanudar flag semantics
  - _run_scrape_job baseline: empty job, single URL, multi-chunk, resume from mid-point
  - _run_scrape_job pause: mid-chunk pause, boundary pause, multiple cycles
  - _run_scrape_job invariant: processed_count == len(results) at every chunk-end $set
  - _run_scrape_job cancel: early exit on status=cancelled
  - edge cases: job-not-found, job already complete, no result duplication on resume
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
import pytest
from bson import ObjectId

from app.scrape_jobs import (
    _mark_pending_urls,
    _run_scrape_job,
    set_job_action,
)


# ── helpers ────────────────────────────────────────────────────────────────

class _R:
    """Minimal update result."""
    def __init__(self, modified: int = 1):
        self.modified_count = modified


def _apply_update(doc: dict, update: dict) -> None:
    if "$set" in update:
        for k, v in update["$set"].items():
            # Store a copy for lists so that subsequent $push calls on the fake
            # collection do not mutate the worker's own local Python list object
            # (which shares the same reference when stored by the $set handler).
            doc[k] = list(v) if isinstance(v, list) else v
    if "$inc" in update:
        for k, v in update["$inc"].items():
            doc[k] = doc.get(k, 0) + v
    if "$push" in update:
        for k, v in update["$push"].items():
            doc.setdefault(k, []).append(v)
    if "$unset" in update:
        for k in update["$unset"]:
            doc.pop(k, None)


def _query_matches(doc: dict, query: dict) -> bool:
    """Minimal query matcher for {field: value} and {field: {$in: [...]}} forms."""
    for k, v in query.items():
        if k == "_id":
            continue  # always match in fake — tests don't mix multiple docs
        if isinstance(v, dict):
            dv = doc.get(k)
            if "$in" in v and dv not in v["$in"]:
                return False
            if "$ne" in v and dv == v["$ne"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


def _fake_result(url: str) -> dict:
    return {
        "url": url,
        "empresa": "Acme SA",
        "industria": "Tech",
        "whatsapp": "+521234567890",
        "all_whatsapp": ["+521234567890"],
        "company_id": "aabbcc112233445566778899",
        "scraped_data": {"name": "Acme SA"},
        "status_wa": "—",
        "ok": True,
        "blacklisted": False,
        "blockReason": None,
        "duplicate": False,
        "errorReason": None,
    }


def _make_job(urls: list, next_index: int = 0, extra: dict | None = None) -> dict:
    doc: dict = {
        "_id": ObjectId(),
        "status": "running",
        "paused": False,
        "urls": urls,
        "next_index": next_index,
        "results": [],
        "processed_count": 0,
        "total_count": len(urls),
        "current_urls": [],
        "last_progress_at": datetime.now(),
    }
    if extra:
        doc.update(extra)
    return doc


# ── fake in-memory scrape_jobs collection ─────────────────────────────────

class FakeJobsCollection:
    """In-memory replacement for db.db.scrape_jobs.

    pause_schedule — list of ints; each entry N means "after the Nth result
    is $push'd, set paused=True".  The worker auto-resumes on the first
    pause-heartbeat update_one (the sole-key $set:{last_progress_at} inside
    the pause loop).  Multiple entries model multiple pause/resume cycles.

    sets_at_chunk_end — list of (processed_count, len_results, next_index)
    snapshots recorded each time a chunk-end $set (the one containing
    next_index) fires; used to verify the processed_count invariant.
    """

    def __init__(self, doc: dict, pause_schedule: list[int] | None = None):
        self._doc = dict(doc)
        self._push_count = 0
        self._schedule = list(pause_schedule or [])
        self._next_pause_at = self._schedule.pop(0) if self._schedule else None
        self._paused_iters = 0
        self.sets_at_chunk_end: list[tuple[int, int, int]] = []

    # ── pymongo interface ──────────────────────────────────────────────────

    def find_one(self, query=None, projection=None):
        doc = dict(self._doc)
        if projection:
            return {k: doc.get(k) for k in projection}
        return doc

    def update_one(self, query, update):
        # ── detect pause heartbeat: only key is last_progress_at, and paused ──
        is_pause_hb = (
            "$set" in update
            and list(update["$set"].keys()) == ["last_progress_at"]
            and self._doc.get("paused")
        )

        _apply_update(self._doc, update)

        # ── track $push results → trigger pause ──
        if "$push" in update and "results" in update["$push"]:
            self._push_count += 1
            if (
                self._next_pause_at is not None
                and self._push_count >= self._next_pause_at
            ):
                self._doc["paused"] = True
                self._paused_iters = 0

        # ── auto-resume after first pause heartbeat ──
        if is_pause_hb:
            self._paused_iters += 1
            if self._paused_iters >= 1:
                self._doc["paused"] = False
                self._next_pause_at = (
                    self._schedule.pop(0) if self._schedule else None
                )

        # ── record chunk-end snapshot ──
        if "$set" in update and "next_index" in update["$set"]:
            self.sets_at_chunk_end.append((
                self._doc.get("processed_count", 0),
                len(self._doc.get("results", [])),
                self._doc["next_index"],
            ))

        return _R()

    def update_many(self, query, update):
        return _R(0)

    def find(self, query=None, projection=None):
        return []

    def insert_one(self, doc):
        oid = ObjectId()
        self._doc = {**doc, "_id": oid}
        class _Ins:
            inserted_id = oid
        return _Ins()


class FakeCompaniesCollection:
    def find(self, query=None, projection=None):
        return []


class FakeMgr:
    """Minimal MongoDBManager stand-in."""

    def __init__(self, jobs_col):
        self.db = type("_DB", (), {
            "scrape_jobs": jobs_col,
            "companies":   FakeCompaniesCollection(),
        })()

    def check_contacted(self, company_ids):
        return {}


def _run(job_doc: dict, pause_schedule=None) -> FakeJobsCollection:
    """Run _run_scrape_job in-process and return the collection for inspection."""
    col = FakeJobsCollection(job_doc, pause_schedule=pause_schedule)
    mgr = FakeMgr(col)
    with (
        patch("app.database.MongoDBManager", return_value=mgr),
        patch("app.scrape_jobs._process_one_url", side_effect=_fake_result),
        patch("time.sleep"),
    ):
        _run_scrape_job(str(job_doc["_id"]))
    return col


# ── fake collection for set_job_action (query-matching aware) ─────────────

class FakeActionCollection:
    """Tracks $set calls; respects $in queries so modified_count is realistic."""

    def __init__(self, **doc_kwargs):
        self._doc = {"_id": ObjectId(), **doc_kwargs}
        self.sets_recorded: list[dict] = []

    def find_one(self, query=None, projection=None):
        return dict(self._doc)

    def update_one(self, query, update):
        matched = _query_matches(self._doc, query)
        if not matched:
            return _R(modified=0)
        _apply_update(self._doc, update)
        if "$set" in update:
            self.sets_recorded.append(dict(update["$set"]))
        return _R(modified=1)

    def update_many(self, query, update):
        return _R(0)

    def find(self, query=None, projection=None):
        return []


class FakeActionMgr:
    def __init__(self, col: FakeActionCollection):
        self.db = type("_DB", (), {"scrape_jobs": col})()


# ══════════════════════════════════════════════════════════════════════════
# _mark_pending_urls
# ══════════════════════════════════════════════════════════════════════════

class TestMarkPendingUrls:
    def _setup(self, urls, next_index):
        col = FakeActionCollection(
            urls=urls, next_index=next_index,
            results=[], status="cancelled",
        )
        mgr = FakeActionMgr(col)
        job = col.find_one()
        return mgr, job, col

    def test_counts_remaining_urls(self):
        urls = [f"https://site{i}.com" for i in range(5)]
        mgr, job, col = self._setup(urls, next_index=2)
        _mark_pending_urls(mgr, job)
        assert col.sets_recorded[-1]["pending_urls_count"] == 3

    def test_all_done_no_write(self):
        urls = ["https://a.com", "https://b.com"]
        mgr, job, col = self._setup(urls, next_index=2)
        _mark_pending_urls(mgr, job)
        assert col.sets_recorded == []

    def test_none_done_counts_all(self):
        urls = [f"https://site{i}.com" for i in range(4)]
        mgr, job, col = self._setup(urls, next_index=0)
        _mark_pending_urls(mgr, job)
        assert col.sets_recorded[-1]["pending_urls_count"] == 4

    def test_single_url_remaining(self):
        urls = ["https://a.com", "https://b.com", "https://c.com"]
        mgr, job, col = self._setup(urls, next_index=2)
        _mark_pending_urls(mgr, job)
        assert col.sets_recorded[-1]["pending_urls_count"] == 1

    def test_single_url_job_all_done(self):
        mgr, job, col = self._setup(["https://a.com"], next_index=1)
        _mark_pending_urls(mgr, job)
        assert col.sets_recorded == []


# ══════════════════════════════════════════════════════════════════════════
# set_job_action
# ══════════════════════════════════════════════════════════════════════════

class TestSetJobAction:
    def _mgr_col(self, **doc_kwargs):
        # Build defaults dict first, then override with caller-supplied kwargs,
        # to avoid "got multiple values for keyword argument" TypeErrors.
        defaults = dict(status="running", paused=False,
                        urls=["https://a.com", "https://b.com"], next_index=1)
        defaults.update(doc_kwargs)
        col = FakeActionCollection(**defaults)
        mgr = FakeActionMgr(col)
        return mgr, col, str(col._doc["_id"])

    # ── pause ──

    def test_pause_sets_only_paused_flag(self):
        mgr, col, jid = self._mgr_col()
        set_job_action(mgr, jid, "pause")
        assert col.sets_recorded[-1] == {"paused": True}

    def test_pause_does_not_touch_status(self):
        mgr, col, jid = self._mgr_col()
        set_job_action(mgr, jid, "pause")
        assert all("status" not in s for s in col.sets_recorded)

    # ── resume ──

    def test_resume_clears_paused(self):
        mgr, col, jid = self._mgr_col(paused=True)
        set_job_action(mgr, jid, "resume")
        assert col._doc["paused"] is False

    def test_resume_stamps_heartbeat(self):
        mgr, col, jid = self._mgr_col(paused=True)
        set_job_action(mgr, jid, "resume")
        assert "last_progress_at" in col.sets_recorded[-1]

    def test_resume_does_not_change_status(self):
        mgr, col, jid = self._mgr_col(paused=True)
        set_job_action(mgr, jid, "resume")
        assert col._doc["status"] == "running"

    # ── cancel ──

    def test_cancel_sets_status_cancelled(self):
        mgr, col, jid = self._mgr_col()
        set_job_action(mgr, jid, "cancel")
        assert col._doc["status"] == "cancelled"

    def test_cancel_stamps_finished_at(self):
        mgr, col, jid = self._mgr_col()
        set_job_action(mgr, jid, "cancel")
        assert any("finished_at" in s for s in col.sets_recorded)

    def test_cancel_marks_pending_urls(self):
        mgr, col, jid = self._mgr_col()
        set_job_action(mgr, jid, "cancel")
        # next_index=1, 2 urls → 1 pending
        pending_counts = [s["pending_urls_count"] for s in col.sets_recorded if "pending_urls_count" in s]
        assert pending_counts == [1]

    # ── reanudar ──

    def test_reanudar_on_running_job_does_nothing(self):
        mgr, col, jid = self._mgr_col(status="running")
        with patch("app.scrape_jobs._claim_and_dispatch"):
            set_job_action(mgr, jid, "reanudar")
        statuses = [s.get("status") for s in col.sets_recorded]
        assert "pending" not in statuses

    def test_reanudar_on_cancelled_sets_pending(self):
        mgr, col, jid = self._mgr_col(status="cancelled")
        with patch("app.scrape_jobs._claim_and_dispatch"):
            set_job_action(mgr, jid, "reanudar")
        assert col._doc["status"] == "pending"

    def test_reanudar_on_error_sets_pending(self):
        mgr, col, jid = self._mgr_col(status="error")
        with patch("app.scrape_jobs._claim_and_dispatch"):
            set_job_action(mgr, jid, "reanudar")
        assert col._doc["status"] == "pending"

    def test_reanudar_triggers_dispatch(self):
        mgr, col, jid = self._mgr_col(status="cancelled")
        with patch("app.scrape_jobs._claim_and_dispatch") as mock_dispatch:
            set_job_action(mgr, jid, "reanudar")
        mock_dispatch.assert_called_once()

    def test_reanudar_clears_paused(self):
        mgr, col, jid = self._mgr_col(status="cancelled", paused=True)
        with patch("app.scrape_jobs._claim_and_dispatch"):
            set_job_action(mgr, jid, "reanudar")
        assert col._doc.get("paused") is False

    def test_reanudar_does_not_dispatch_on_no_match(self):
        mgr, col, jid = self._mgr_col(status="running")
        with patch("app.scrape_jobs._claim_and_dispatch") as mock_dispatch:
            set_job_action(mgr, jid, "reanudar")
        mock_dispatch.assert_not_called()


# ══════════════════════════════════════════════════════════════════════════
# _run_scrape_job — baseline (no pause)
# ══════════════════════════════════════════════════════════════════════════

class TestRunScrapeJobBaseline:
    def test_empty_job_ends_done(self):
        col = _run(_make_job([]))
        assert col._doc["status"] == "done"

    def test_single_url_ends_done(self):
        col = _run(_make_job(["https://a.com"]))
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 1
        assert len(col._doc["results"]) == 1

    def test_four_urls_one_chunk(self):
        urls = [f"https://s{i}.com" for i in range(4)]
        col = _run(_make_job(urls))
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 4
        assert col._doc["next_index"] == 4

    def test_nine_urls_three_chunks(self):
        """3 chunks: 4 + 4 + 1."""
        urls = [f"https://s{i}.com" for i in range(9)]
        col = _run(_make_job(urls))
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 9
        assert col._doc["next_index"] == 9
        assert len(col._doc["results"]) == 9

    def test_current_urls_cleared_after_each_chunk(self):
        urls = [f"https://s{i}.com" for i in range(5)]
        col = _run(_make_job(urls))
        assert col._doc["current_urls"] == []

    def test_resume_from_mid_point(self):
        """Job with next_index=2 already; worker processes remaining 3."""
        urls = [f"https://s{i}.com" for i in range(5)]
        existing = [_fake_result(u) for u in urls[:2]]
        doc = _make_job(urls, next_index=2,
                        extra={"results": existing, "processed_count": 2})
        col = _run(doc)
        assert col._doc["status"] == "done"
        assert col._doc["next_index"] == 5
        assert len(col._doc["results"]) == 5

    def test_results_not_duplicated_on_resume(self):
        """Existing results must not appear twice after a resume."""
        urls = [f"https://s{i}.com" for i in range(6)]
        existing = [_fake_result(u) for u in urls[:3]]
        doc = _make_job(urls, next_index=3,
                        extra={"results": existing, "processed_count": 3})
        col = _run(doc)
        seen_urls = [r["url"] for r in col._doc["results"]]
        assert len(seen_urls) == len(set(seen_urls)), "Duplicate URLs in results"
        assert len(col._doc["results"]) == 6


# ══════════════════════════════════════════════════════════════════════════
# _run_scrape_job — pause / resume
# ══════════════════════════════════════════════════════════════════════════

class TestRunScrapeJobPause:
    def test_pause_mid_chunk_finishes_all_after_resume(self):
        """Pause after 2nd push of a 4-URL chunk; auto-resume; all 8 processed."""
        urls = [f"https://s{i}.com" for i in range(8)]
        col = _run(_make_job(urls), pause_schedule=[2])
        assert col._doc["status"] == "done"
        assert len(col._doc["results"]) == 8

    def test_pause_between_chunks_finishes_all(self):
        """Pause fires right after the 4th push (end of chunk 1)."""
        urls = [f"https://s{i}.com" for i in range(8)]
        col = _run(_make_job(urls), pause_schedule=[4])
        assert col._doc["status"] == "done"
        assert len(col._doc["results"]) == 8

    def test_single_pause_resume_ends_done(self):
        urls = [f"https://s{i}.com" for i in range(6)]
        col = _run(_make_job(urls), pause_schedule=[3])
        assert col._doc["status"] == "done"
        assert col._doc["next_index"] == 6
        assert col._doc["processed_count"] == 6

    def test_pause_on_first_result_recovers(self):
        """Extreme case: pause on the very first URL."""
        urls = [f"https://s{i}.com" for i in range(5)]
        col = _run(_make_job(urls), pause_schedule=[1])
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 5

    def test_three_pause_resume_cycles_complete(self):
        """Three interruptions across 12 URLs."""
        urls = [f"https://s{i}.com" for i in range(12)]
        col = _run(_make_job(urls), pause_schedule=[2, 6, 10])
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 12
        assert len(col._doc["results"]) == 12

    # ── processed_count invariant ──────────────────────────────────────────

    def test_processed_count_never_exceeds_total(self):
        """processed_count must always be ≤ total after every chunk-end $set."""
        urls = [f"https://s{i}.com" for i in range(10)]
        col = _run(_make_job(urls), pause_schedule=[2, 6])
        total = len(urls)
        assert col._doc["processed_count"] <= total
        for pc, rc, ni in col.sets_at_chunk_end:
            assert pc <= total, f"processed_count={pc} exceeded total={total} at next_index={ni}"

    def test_processed_count_equals_results_at_every_chunk_end(self):
        """Path B ($set processed_count=min(len(results), total)) must reconcile
        any transient overcount from Path A ($inc per URL) at every chunk end."""
        urls = [f"https://s{i}.com" for i in range(12)]
        col = _run(_make_job(urls), pause_schedule=[2, 7])
        violations = [
            (pc, rc, ni)
            for pc, rc, ni in col.sets_at_chunk_end
            if pc != rc
        ]
        assert violations == [], (
            "processed_count != len(results) at chunk-end: "
            + str(violations)
        )

    def test_next_index_is_monotonically_increasing(self):
        """next_index must never go backwards across pause/resume cycles."""
        urls = [f"https://s{i}.com" for i in range(8)]
        col = _run(_make_job(urls), pause_schedule=[2, 5])
        indices = [ni for _, _, ni in col.sets_at_chunk_end]
        for a, b in zip(indices, indices[1:]):
            assert b >= a, f"next_index went backwards: {a} → {b}"

    def test_three_cycles_count_invariant(self):
        urls = [f"https://s{i}.com" for i in range(12)]
        col = _run(_make_job(urls), pause_schedule=[3, 7, 10])
        for pc, rc, ni in col.sets_at_chunk_end:
            assert pc == rc, (
                f"processed_count={pc} != len(results)={rc} at next_index={ni}"
            )

    def test_final_processed_count_equals_url_count(self):
        """After all pause/resume cycles the final count must equal the URL list length."""
        urls = [f"https://s{i}.com" for i in range(11)]
        col = _run(_make_job(urls), pause_schedule=[1, 5, 9])
        assert col._doc["processed_count"] == len(urls)

    def test_no_extra_results_after_multiple_pauses(self):
        """Total results must equal total URLs — no double-counting on re-scrape."""
        urls = [f"https://s{i}.com" for i in range(8)]
        col = _run(_make_job(urls), pause_schedule=[2, 6])
        assert len(col._doc["results"]) == 8


# ══════════════════════════════════════════════════════════════════════════
# _run_scrape_job — cancel
# ══════════════════════════════════════════════════════════════════════════

class _CancelCol(FakeJobsCollection):
    """Variant: sets status=cancelled (not paused) after N pushes."""
    def __init__(self, doc, cancel_after: int):
        super().__init__(doc)
        self._cancel_after = cancel_after

    def update_one(self, query, update):
        r = super().update_one(query, update)
        if (
            "$push" in update and "results" in update["$push"]
            and self._push_count >= self._cancel_after
        ):
            self._doc["status"] = "cancelled"
        return r


class _CancelAfterChunkCol(FakeJobsCollection):
    """Variant: sets status=cancelled after the first chunk-end $set (next_index write)."""
    def __init__(self, doc):
        super().__init__(doc)
        self._chunk_ends = 0

    def update_one(self, query, update):
        r = super().update_one(query, update)
        if "$set" in update and "next_index" in update["$set"]:
            self._chunk_ends += 1
            if self._chunk_ends >= 1:
                self._doc["status"] = "cancelled"
        return r


class TestRunScrapeJobCancel:
    def _cancel_run(self, col: FakeJobsCollection) -> FakeJobsCollection:
        mgr = FakeMgr(col)
        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch("app.scrape_jobs._process_one_url", side_effect=_fake_result),
            patch("time.sleep"),
        ):
            _run_scrape_job(str(col._doc["_id"]))
        return col

    def test_cancel_mid_chunk_does_not_set_done(self):
        doc = _make_job([f"https://s{i}.com" for i in range(8)])
        col = self._cancel_run(_CancelCol(doc, cancel_after=2))
        assert col._doc["status"] != "done"

    def test_cancel_mid_chunk_processes_fewer_than_total(self):
        doc = _make_job([f"https://s{i}.com" for i in range(8)])
        col = self._cancel_run(_CancelCol(doc, cancel_after=2))
        assert col._doc["processed_count"] < 8

    def test_cancel_at_chunk_boundary_does_not_set_done(self):
        doc = _make_job([f"https://s{i}.com" for i in range(8)])
        col = self._cancel_run(_CancelAfterChunkCol(doc))
        assert col._doc["status"] != "done"

    def test_cancel_at_chunk_boundary_next_index_not_full(self):
        doc = _make_job([f"https://s{i}.com" for i in range(8)])
        col = self._cancel_run(_CancelAfterChunkCol(doc))
        assert col._doc["next_index"] < 8


# ══════════════════════════════════════════════════════════════════════════
# edge cases
# ══════════════════════════════════════════════════════════════════════════

class TestEdgeCases:
    class _NullCol:
        """Simulates a job that was deleted between dispatch and worker startup."""
        def find_one(self, *a, **kw): return None
        def update_one(self, *a, **kw): return _R()
        def update_many(self, *a, **kw): return _R(0)
        def find(self, *a, **kw): return []

    class _NullMgr:
        def __init__(self, col):
            self.db = type("_DB", (), {
                "scrape_jobs": col,
                "companies":   FakeCompaniesCollection(),
            })()
        def check_contacted(self, ids): return {}

    def test_job_not_found_returns_cleanly(self):
        """Worker must return without exception when the job document is missing."""
        col = self._NullCol()
        mgr = self._NullMgr(col)
        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch("app.scrape_jobs._process_one_url", side_effect=_fake_result),
            patch("time.sleep"),
        ):
            _run_scrape_job(str(ObjectId()))  # must not raise

    def test_already_complete_job_skips_to_done(self):
        """If next_index == total at startup the worker must set done immediately."""
        urls = ["https://a.com", "https://b.com"]
        existing = [_fake_result(u) for u in urls]
        doc = _make_job(urls, next_index=2,
                        extra={"results": existing, "processed_count": 2})
        col = _run(doc)
        assert col._doc["status"] == "done"
        assert col._doc["processed_count"] == 2

    def test_processed_count_capped_at_total(self):
        """min(len(results), total) must prevent processed_count > total_count."""
        urls = [f"https://s{i}.com" for i in range(5)]
        col = _run(_make_job(urls))
        assert col._doc["processed_count"] <= col._doc["total_count"]
