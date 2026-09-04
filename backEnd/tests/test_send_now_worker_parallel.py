"""Tests for app/send_now_worker.py — per-user partitioned parallel sending.

Context: sends used to run through ONE global FIFO worker, so one user's large
campaign (and its anti-spam pacing) blocked every other user's sends, even
though each user has their own WhatsApp instance. This was refactored to run
one independent pacing thread per user (mirrors scheduler.py's one-thread-
per-scheduled-job model for campaigns).

All tests run entirely in-memory:
  - MongoDBManager replaced with FakeMgr (no real Mongo, no tunnel dependency)
  - scheduler._send_message replaced with a fake (no real WhatsApp send)
  - _user_has_connected_instance / _check_send_allowed patched per test
  - time.sleep patched to a no-op so pause/anti-spam waits complete instantly

Coverage:
  - Two partitions process fully independently — no cross-user blocking
  - get_status(user_id) / cancel_pending_send_items(user_id) only see/touch
    the calling user's own partition
  - A daily-cap pause on one partition never stalls another partition
  - A partition with no connected instance backs off instead of busy-polling
    Mongo forever (bug found 2026-09-03 — used to hammer at ~3 calls/sec)
  - send_worker_lease grants exactly one holder at a time across "processes"
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from unittest.mock import patch

_REAL_SLEEP = time.sleep  # captured before any fixture patches time.sleep

import pytest
from bson import ObjectId

from app import send_now_worker as sw
from app import scheduler as sched


# ── generic in-memory Mongo collection ─────────────────────────────────────
# Broad enough to cover every operation send_now_worker.py issues: update_one
# (+upsert), find_one, find, find_one_and_update, update_many,
# count_documents, distinct, insert_many/insert_one.

class _Result:
    def __init__(self, matched=0, modified=0, upserted_id=None):
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_id = upserted_id


def _naive(dt):
    """Real Mongo stores dates as tz-less UTC millis — comparing a naive and
    an aware Python datetime never raises there. Strip tzinfo so this fake
    matches that behavior instead of tripping on it."""
    return dt.replace(tzinfo=None) if hasattr(dt, "tzinfo") and dt.tzinfo else dt


def _matches(doc: dict, query: dict) -> bool:
    for k, v in (query or {}).items():
        if k == "$or":
            if not any(_matches(doc, sub) for sub in v):
                return False
            continue
        if isinstance(v, dict):
            if "$in" in v and doc.get(k) not in v["$in"]:
                return False
            if "$ne" in v and doc.get(k) == v["$ne"]:
                return False
            if "$exists" in v and (k in doc) != v["$exists"]:
                return False
            if "$lte" in v and not (doc.get(k) is not None and _naive(doc.get(k)) <= _naive(v["$lte"])):
                return False
            if "$lt" in v and not (doc.get(k) is not None and _naive(doc.get(k)) < _naive(v["$lt"])):
                return False
            if "$gte" in v and not (doc.get(k) is not None and _naive(doc.get(k)) >= _naive(v["$gte"])):
                return False
            if "$regex" in v:
                import re
                if not re.search(v["$regex"], str(doc.get(k, ""))):
                    return False
        elif doc.get(k) != v:
            return False
    return True


def _apply_update(doc: dict, update: dict) -> None:
    if "$set" in update:
        doc.update(update["$set"])
    if "$setOnInsert" in update:
        for k, v in update["$setOnInsert"].items():
            doc.setdefault(k, v)
    if "$addToSet" in update:
        for k, v in update["$addToSet"].items():
            doc.setdefault(k, [])
            if v not in doc[k]:
                doc[k].append(v)
    if "$inc" in update:
        for k, v in update["$inc"].items():
            doc[k] = doc.get(k, 0) + v


class FakeCollection:
    """In-memory stand-in for one Mongo collection. Thread-safe (a real Mongo
    lock-and-swap is atomic per-document; a plain lock around each op is
    enough here since these tests exercise real threads for parallelism)."""

    def __init__(self, docs: list[dict] | None = None):
        self._docs: list[dict] = list(docs or [])
        self._lock = threading.Lock()

    def find_one(self, query=None, projection=None, sort=None):
        with self._lock:
            candidates = [d for d in self._docs if _matches(d, query or {})]
            if sort:
                candidates = self._sorted(candidates, sort)
            return dict(candidates[0]) if candidates else None

    def find(self, query=None, projection=None, sort=None, limit=None):
        with self._lock:
            candidates = [dict(d) for d in self._docs if _matches(d, query or {})]
        if sort:
            candidates = self._sorted(candidates, sort)
        if limit:
            candidates = candidates[:limit]
        return candidates

    def find_one_and_update(self, query, update, sort=None, upsert=False):
        with self._lock:
            candidates = [d for d in self._docs if _matches(d, query or {})]
            if sort:
                candidates = self._sorted(candidates, sort)
            if not candidates:
                if upsert:
                    doc = {"_id": ObjectId()}
                    _apply_update(doc, update)
                    self._docs.append(doc)
                    return dict(doc)
                return None
            doc = candidates[0]
            _apply_update(doc, update)
            return dict(doc)

    def update_one(self, query, update, upsert=False):
        with self._lock:
            matches = [d for d in self._docs if _matches(d, query or {})]
            if matches:
                _apply_update(matches[0], update)
                return _Result(matched=1, modified=1)
            if upsert:
                doc = {}
                for k, v in (query or {}).items():
                    if not isinstance(v, dict) and k != "$or":
                        doc[k] = v
                _apply_update(doc, update)
                doc.setdefault("_id", ObjectId())
                # A real _id-unique-index upsert-insert fails with
                # DuplicateKeyError if that _id is already taken by a doc that
                # just didn't match the rest of the query (e.g. {"notified":
                # {"$ne": True}} on a doc that's already notified) — this is
                # exactly the race _maybe_finish_batch's dedup-once guard
                # depends on.
                if any(d.get("_id") == doc["_id"] for d in self._docs):
                    from pymongo.errors import DuplicateKeyError
                    raise DuplicateKeyError(f"duplicate key: {doc['_id']!r}")
                self._docs.append(doc)
                return _Result(matched=0, modified=0, upserted_id=doc["_id"])
            return _Result(matched=0, modified=0)

    def update_many(self, query, update):
        with self._lock:
            matches = [d for d in self._docs if _matches(d, query or {})]
            for d in matches:
                _apply_update(d, update)
            return _Result(matched=len(matches), modified=len(matches))

    def count_documents(self, query=None):
        with self._lock:
            return len([d for d in self._docs if _matches(d, query or {})])

    def distinct(self, field, query=None):
        with self._lock:
            return list({d.get(field) for d in self._docs if _matches(d, query or {})})

    def insert_many(self, docs):
        with self._lock:
            for d in docs:
                d.setdefault("_id", ObjectId())
                self._docs.append(dict(d))

    def insert_one(self, doc):
        with self._lock:
            doc = dict(doc)
            doc.setdefault("_id", ObjectId())
            self._docs.append(doc)
            oid = doc["_id"]
        return type("_Ins", (), {"inserted_id": oid})()

    @staticmethod
    def _sorted(docs, sort):
        for field, direction in reversed(sort):
            docs = sorted(docs, key=lambda d: d.get(field), reverse=(direction < 0))
        return docs


class FakeMgr:
    """Minimal MongoDBManager stand-in exposing exactly the collections
    send_now_worker.py touches."""

    def __init__(self):
        self.db = type("_DB", (), {
            "send_queue_items":   FakeCollection(),
            "send_queue_state":   FakeCollection(),
            "send_queue_batches": FakeCollection(),
            "send_worker_lease":  FakeCollection(),
            "app_notifications":  FakeCollection(),
            "companies":          FakeCollection(),
            "instances":          FakeCollection(),
        })()


def _make_items(user_id: str, batch_id: str, n: int = 2) -> list[dict]:
    """to_number is derived from batch_id (not just the in-batch index) so
    numbers never collide across two different tests' items — a prior bug
    here (all batches producing "5210000000" for their first item) made two
    unrelated partitions' fake sends indistinguishable by to_number alone."""
    now = datetime.now(timezone.utc)
    prefix = abs(hash(batch_id)) % 100000
    return [{
        "batch_id": batch_id, "job_key": f"{batch_id}#{i}", "label": "t",
        "company_id": "", "to_number": f"5{prefix:05d}{i:03d}", "message": "hola",
        "website": "", "job_size": n, "job_index": i, "status": "pending",
        "created_at": now, "started_at": None, "finished_at": None,
        "error": None, "result": None,
        "sent_by_username": user_id, "sent_by_name": user_id, "user_id": user_id,
    } for i in range(n)]


@pytest.fixture
def mgr():
    return FakeMgr()


@pytest.fixture(autouse=True)
def _no_real_sleep():
    """Anti-spam/pause waits complete instantly; a test that wants to prove
    real concurrency uses its own timing primitive (see test below), not
    wall-clock delay from these waits.

    Patching time.sleep alone is NOT enough: _antispam_wait loops on real
    time.time() until `seconds` (25-55s by default) of WALL-CLOCK time has
    actually elapsed, using time.sleep only to pace the polling — with sleep
    mocked to a no-op that loop just busy-spins for the full real duration
    instead of returning instantly. Patch it directly so a test that doesn't
    care about anti-spam pacing (most of them) isn't silently slow/hung."""
    with patch("time.sleep"), patch.object(sw, "_antispam_wait", return_value=True):
        yield


def _run_partition(mgr, partition, user_id, timeout=5):
    # daemon=True is a safety net: a test bug that leaves a partition looping
    # forever (e.g. a permanent cap/instance pause with time.sleep mocked to
    # a no-op) must not keep the whole pytest PROCESS alive after the suite
    # finishes — a non-daemon thread would.
    t = threading.Thread(target=sw._partition_worker, args=(partition, user_id), daemon=True)
    t.start()
    t.join(timeout=timeout)
    return t


# ══════════════════════════════════════════════════════════════════════════
# Two partitions run independently — no cross-user blocking
# ══════════════════════════════════════════════════════════════════════════

class TestPartitionsRunInParallel:
    def test_both_partitions_complete_all_items(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-a", 2))
        mgr.db.send_queue_items.insert_many(_make_items("user-b", "batch-b", 2))
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sched, "_send_message", return_value=True),
            patch.object(sw, "_user_has_connected_instance", return_value=True),
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
        ):
            ta = _run_partition(mgr, "user-a", "user-a")
            tb = _run_partition(mgr, "user-b", "user-b")

        assert not ta.is_alive() and not tb.is_alive()
        assert mgr.db.send_queue_items.count_documents({"batch_id": "batch-a", "status": "sent"}) == 2
        assert mgr.db.send_queue_items.count_documents({"batch_id": "batch-b", "status": "sent"}) == 2

    def test_one_partition_never_touches_the_others_items(self, mgr):
        """A partition's find_one_and_update filters by user_id — it must never
        claim an item belonging to a different user."""
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-a", 1))
        mgr.db.send_queue_items.insert_many(_make_items("user-b", "batch-b", 1))
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sched, "_send_message", return_value=True),
            patch.object(sw, "_user_has_connected_instance", return_value=True),
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
        ):
            _run_partition(mgr, "user-a", "user-a")

        # user-b's item must be completely untouched — still pending.
        b_item = mgr.db.send_queue_items.find_one({"batch_id": "batch-b"})
        assert b_item["status"] == "pending"

    def test_true_concurrency_not_just_sequential_success(self, mgr):
        """Prove the two partitions actually overlap in wall-clock time,
        not just that both eventually finish (which a serial fallback would
        also satisfy)."""
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-a", 1))
        mgr.db.send_queue_items.insert_many(_make_items("user-b", "batch-b", 1))
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)

        concurrent_count = {"n": 0, "max": 0}
        lock = threading.Lock()

        def fake_send(*a, **kw):
            with lock:
                concurrent_count["n"] += 1
                concurrent_count["max"] = max(concurrent_count["max"], concurrent_count["n"])
            _REAL_SLEEP(0.2)  # time.sleep is patched to a no-op by the autouse
                              # fixture by the time this runs — use the real
                              # one (captured at module import) so both
                              # threads' sends truly overlap in wall-clock time.
            with lock:
                concurrent_count["n"] -= 1
            return True

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sched, "_send_message", side_effect=fake_send),
            patch.object(sw, "_user_has_connected_instance", return_value=True),
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
        ):
            ta = threading.Thread(target=sw._partition_worker, args=("user-a", "user-a"))
            tb = threading.Thread(target=sw._partition_worker, args=("user-b", "user-b"))
            ta.start(); tb.start()
            ta.join(timeout=5); tb.join(timeout=5)

        assert concurrent_count["max"] == 2, (
            "both partitions' sends never overlapped — this is the exact "
            "regression (global serial FIFO) this refactor fixed"
        )


# ══════════════════════════════════════════════════════════════════════════
# get_status(user_id) / cancel_pending_send_items(user_id) isolation
# ══════════════════════════════════════════════════════════════════════════

class TestPerUserStatusAndCancel:
    def test_get_status_does_not_leak_another_users_progress(self, mgr):
        sw._set_state(mgr, "user-a", phase="sending", active_total=5, active_sent=2)
        status_b = sw.get_status(mgr, "user-b")
        assert status_b["phase"] == "idle"
        assert status_b["active_total"] is None

    def test_get_status_shows_own_progress(self, mgr):
        sw._set_state(mgr, "user-a", phase="sending", active_total=5, active_sent=2)
        status_a = sw.get_status(mgr, "user-a")
        assert status_a["phase"] == "sending"
        assert status_a["active_total"] == 5

    def test_queue_len_counts_only_own_pending_job_keys(self, mgr):
        # One "job" with 3 numbers shares a single job_key (queue_len counts
        # jobs, not raw send items) — use the real enqueue path so this test
        # can't drift from that semantics the way a hand-rolled fixture could.
        sw.enqueue_send_items(mgr, [{"numbers": ["1", "2", "3"], "messages": ["hi"]}],
                              "batch-1", "t", {}, user_id="user-a")
        sw.enqueue_send_items(mgr, [{"numbers": ["4", "5"], "messages": ["hi"]}],
                              "batch-2", "t", {}, user_id="user-a")
        sw.enqueue_send_items(mgr, [{"numbers": ["6"], "messages": ["hi"]}],
                              "batch-3", "t", {}, user_id="user-b")
        status_a = sw.get_status(mgr, "user-a")
        assert status_a["queue_len"] == 2

    def test_cancel_only_cancels_the_calling_users_items(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-a", 2))
        mgr.db.send_queue_items.insert_many(_make_items("user-b", "batch-b", 2))
        cancelled = sw.cancel_pending_send_items(mgr, "user-a")
        assert cancelled == 2
        assert mgr.db.send_queue_items.count_documents({"user_id": "user-b", "status": "pending"}) == 2
        assert mgr.db.send_queue_items.count_documents({"user_id": "user-a", "status": "cancelled"}) == 2

    def test_send_config_does_not_leak_between_users(self, mgr):
        sw.enqueue_send_items(mgr, [{"numbers": ["1"], "messages": ["hi"]}], "b1", "t",
                              {"msgDelay": [25, 55]}, user_id="user-a")
        sw.enqueue_send_items(mgr, [{"numbers": ["2"], "messages": ["hi"]}], "b2", "t",
                              {"msgDelay": [1, 2]}, user_id="user-b")
        assert sw._get_send_config(mgr, "user-a")["msgDelay"] == [25, 55]
        assert sw._get_send_config(mgr, "user-b")["msgDelay"] == [1, 2]


# ══════════════════════════════════════════════════════════════════════════
# A daily-cap pause on one partition must never stall another partition
# ══════════════════════════════════════════════════════════════════════════

class TestCapPauseIsolation:
    def test_other_partition_finishes_while_one_is_cap_paused(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("capped-user", "batch-cap", 1))
        mgr.db.send_queue_items.insert_many(_make_items("free-user", "batch-free", 1))
        capped_number = mgr.db.send_queue_items.find_one({"batch_id": "batch-cap"})["to_number"]
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)

        def fake_send(db_arg, company_id, to_number, message, *a, **kw):
            if to_number == capped_number:
                return "skipped_daily_cap"
            return True

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sched, "_send_message", side_effect=fake_send),
            patch.object(sw, "_user_has_connected_instance", return_value=True),
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
        ):
            # capped-user's partition retries forever by design (time.sleep is
            # mocked to a no-op, so it spins fast rather than sleeping 5 real
            # minutes) — don't join it. The whole point of this test is that
            # free-user's own thread never waits on it.
            ta = threading.Thread(target=sw._partition_worker, args=("capped-user", "capped-user"), daemon=True)
            ta.start()
            tb = _run_partition(mgr, "free-user", "free-user")

        assert not tb.is_alive()
        assert mgr.db.send_queue_items.count_documents({"batch_id": "batch-free", "status": "sent"}) == 1
        # capped item is reset to pending before every retry (for tomorrow's
        # cap reset) — never lost, never marked failed.
        assert mgr.db.send_queue_items.find_one({"batch_id": "batch-cap"})["status"] == "pending"


# ══════════════════════════════════════════════════════════════════════════
# No connected instance → back off, don't busy-poll Mongo forever
# (regression test for the bug found 2026-09-03: ~3 calls/sec with no cap)
# ══════════════════════════════════════════════════════════════════════════

class TestNoInstanceBacksOff:
    def test_process_item_signals_a_pause_not_a_bare_continue(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("nc-user", "batch-nc", 1))
        item = mgr.db.send_queue_items.find_one({"batch_id": "batch-nc"})
        with patch.object(sw, "_user_has_connected_instance", return_value=False):
            result, _, _ = sw._process_item(mgr, "nc-user", item, 0, 0)
        assert result == "no_instance_pause", (
            "must return a distinct pause sentinel — returning True here is "
            "exactly the bug that caused an unthrottled busy-loop against Mongo"
        )

    def test_partition_worker_sleeps_between_attempts(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("nc-user", "batch-nc", 1))
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sw, "_user_has_connected_instance", return_value=False),
            patch("app.send_now_worker.time.sleep") as mock_sleep,
        ):
            t = threading.Thread(target=sw._partition_worker, args=("nc-user", "nc-user"), daemon=True)
            t.start()
            time.sleep(0.05)  # let a couple of loop iterations happen
        # thread is a daemon and the loop is infinite by design (retries
        # forever until an instance connects) — we only assert it paced
        # itself via sleep(15) rather than spinning with zero delay.
        assert any(c.args and c.args[0] == 15 for c in mock_sleep.call_args_list), (
            f"expected a 15s pause between retries, got calls: {mock_sleep.call_args_list}"
        )


# ══════════════════════════════════════════════════════════════════════════
# send_worker_lease — exactly one holder at a time
# ══════════════════════════════════════════════════════════════════════════

class TestLeaseMutualExclusion:
    def test_second_process_cannot_acquire_while_first_holds_it(self, mgr):
        sw._ensure_lease_doc(mgr)
        with patch.object(sw, "_WORKER_ID", "process-A"):
            assert sw._try_acquire_lease(mgr) is True
        with patch.object(sw, "_WORKER_ID", "process-B"):
            assert sw._try_acquire_lease(mgr) is False

    def test_only_the_holder_can_renew(self, mgr):
        sw._ensure_lease_doc(mgr)
        with patch.object(sw, "_WORKER_ID", "process-A"):
            sw._try_acquire_lease(mgr)
        with patch.object(sw, "_WORKER_ID", "process-B"):
            assert sw._renew_lease(mgr) is False
        with patch.object(sw, "_WORKER_ID", "process-A"):
            assert sw._renew_lease(mgr) is True

    def test_expired_lease_can_be_taken_over(self, mgr):
        sw._ensure_lease_doc(mgr)
        with patch.object(sw, "_WORKER_ID", "process-A"):
            sw._try_acquire_lease(mgr)
        mgr.db.send_worker_lease.update_one(
            {"_id": "singleton"}, {"$set": {"expires_at": datetime(2000, 1, 1, tzinfo=timezone.utc)}}
        )
        with patch.object(sw, "_WORKER_ID", "process-B"):
            assert sw._try_acquire_lease(mgr) is True


# ══════════════════════════════════════════════════════════════════════════
# batch_complete notification — exactly once, scoped to the sending user
# ══════════════════════════════════════════════════════════════════════════

class TestBatchCompleteNotification:
    def test_fires_exactly_once_under_concurrent_calls(self, mgr):
        mgr.db.send_queue_items.insert_many([
            {"batch_id": "race", "status": "sent", "label": "t", "user_id": "u1"},
            {"batch_id": "race", "status": "sent", "label": "t", "user_id": "u1"},
        ])
        results = []
        barrier = threading.Barrier(5)

        def call():
            barrier.wait()
            results.append(sw._maybe_finish_batch(mgr, "race"))

        threads = [threading.Thread(target=call) for _ in range(5)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=5)

        assert sum(1 for r in results if r is not None) == 1
        assert mgr.db.app_notifications.count_documents({"type": "batch_complete"}) == 1

    def test_notification_carries_the_sending_users_id(self, mgr):
        mgr.db.send_queue_items.insert_many([
            {"batch_id": "b-tag", "status": "sent", "label": "t", "user_id": "u-tagged"},
        ])
        sw._maybe_finish_batch(mgr, "b-tag")
        notif = mgr.db.app_notifications.find_one({"type": "batch_complete"})
        assert notif["user_id"] == "u-tagged"
