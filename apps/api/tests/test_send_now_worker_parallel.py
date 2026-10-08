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
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

_REAL_SLEEP = time.sleep  # captured before any fixture patches time.sleep

import pytest
from bson import ObjectId

from app import send_now_worker as sw
from app import scheduler as sched

_REAL_ANTISPAM_WAIT = sw._antispam_wait


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
            "blacklist":          FakeCollection(),
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

    def test_queue_items_are_only_the_calling_users_sends(self, mgr):
        sw.enqueue_send_items(
            mgr, [{"numbers": ["521111111111"], "messages": ["hola a"]}],
            "batch-a", "Lote de A", {}, user_id="user-a",
        )
        sw.enqueue_send_items(
            mgr, [{"numbers": ["522222222222"], "messages": ["hola b"]}],
            "batch-b", "Lote de B", {}, user_id="user-b",
        )
        status_a = sw.get_status(mgr, "user-a")
        status_b = sw.get_status(mgr, "user-b")
        assert [item["batch_id"] for item in status_a["items"]] == ["batch-a"]
        assert [item["batch_id"] for item in status_b["items"]] == ["batch-b"]
        assert all(item["phone_masked"] != "521111111111" for item in status_a["items"] + status_b["items"])

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

    def test_status_returns_safe_recent_item_details_without_message_body(self, mgr):
        cid = ObjectId()
        mgr.db.companies.insert_one({"_id": cid, "name": "Empresa de prueba"})
        sw.enqueue_send_items(
            mgr,
            [{"numbers": ["+52 1 664 123 9876"], "messages": ["texto secreto"],
              "companyId": str(cid), "website": "https://example.com"}],
            "batch-detail", "Campaña", {}, user_id="user-a",
        )

        status = sw.get_status(mgr, "user-a")

        assert len(status["items"]) == 1
        item = status["items"][0]
        assert item["company_name"] == "Empresa de prueba"
        assert item["phone_masked"] == "••• ••• 9876"
        assert "message" not in item
        assert "to_number" not in item

    def test_waiting_state_is_attached_only_to_the_next_pending_item(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-wait", 2))
        next_at = datetime.now(timezone.utc) + timedelta(seconds=30)
        sw._set_state(
            mgr, "user-a", phase="waiting", next_action_at=next_at,
            wait_reason="message_delay", wait_message="Espera de seguridad",
        )

        status = sw.get_status(mgr, "user-a")

        assert status["items"][0]["display_status"] == "waiting"
        assert status["items"][0]["next_action_at"] == next_at
        assert status["items"][1]["display_status"] == "pending"

    def test_todays_sent_rows_stay_when_a_later_batch_is_queued(self, mgr):
        older = _make_items("user-a", "batch-old", 1)[0]
        older["status"] = "sent"
        older["finished_at"] = datetime.now(timezone.utc) - timedelta(hours=2)
        older["label"] = "Primera tanda"
        newer = _make_items("user-a", "batch-new", 1)[0]
        newer["label"] = "Segunda tanda"
        mgr.db.send_queue_items.insert_many([older, newer])

        status = sw.get_status(mgr, "user-a")
        names = {item["batch_id"]: item["status"] for item in status["items"]}
        assert names["batch-old"] == "sent"
        assert names["batch-new"] == "pending"
        assert status["items"][0]["finished_at"] == older["finished_at"]

    def test_yesterday_sent_rows_drop_out_but_a_stuck_pending_stays(self, mgr):
        stale = _make_items("user-a", "batch-stale", 1)[0]
        stale["status"] = "sent"
        stale["created_at"] = datetime.now(timezone.utc) - timedelta(hours=30)
        stale["finished_at"] = stale["created_at"]
        stuck = _make_items("user-a", "batch-stuck", 1)[0]
        stuck["created_at"] = datetime.now(timezone.utc) - timedelta(hours=30)
        mgr.db.send_queue_items.insert_many([stale, stuck])

        status = sw.get_status(mgr, "user-a")
        ids = {item["batch_id"] for item in status["items"]}
        assert "batch-stale" not in ids
        assert "batch-stuck" in ids

    def test_disconnected_pause_is_visible_on_the_next_item(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("user-a", "batch-dc-ui", 1))
        next_at = datetime.now(timezone.utc) + timedelta(seconds=120)
        sw._set_state(
            mgr, "user-a", phase="paused", next_action_at=next_at,
            wait_reason="disconnected",
            wait_message="WhatsApp se desconectó durante el envío",
            last_error={"message": "Instancia desconectada durante el envío — cola pausada, reintentará al reconectar", "at": next_at},
        )

        status = sw.get_status(mgr, "user-a")
        assert status["phase"] == "paused"
        assert status["wait_reason"] == "disconnected"
        assert "desconect" in status["last_error"]["message"]
        assert status["items"][0]["display_status"] == "paused"
        assert status["items"][0]["wait_message"] == "WhatsApp se desconectó durante el envío"


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

        # capped-user's partition retries forever by design. It used to be left
        # spinning after this test — still running once the patches below were
        # undone, it called the real send/DB code and made later tests flaky
        # (~1 in 3 full runs). Now it parks on its 5-minute cap pause (item
        # already reset to pending) until the checks are done, then exits.
        parked, stop = threading.Event(), threading.Event()

        class _Stop(Exception):
            pass

        def fake_pause(*args, **kwargs):
            parked.set()
            stop.wait(5)
            raise _Stop()   # _partition_worker logs it and exits

        with (
            patch("app.database.MongoDBManager", return_value=mgr),
            patch.object(sched, "_send_message", side_effect=fake_send),
            patch.object(sw, "_user_has_connected_instance", return_value=True),
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
            patch.object(sw, "_paused_wait", side_effect=fake_pause),
        ):
            ta = threading.Thread(target=sw._partition_worker, args=("capped-user", "capped-user"), daemon=True)
            ta.start()
            tb = _run_partition(mgr, "free-user", "free-user")
            # The whole point: free-user finished while capped-user is paused.
            assert not tb.is_alive()
            assert mgr.db.send_queue_items.count_documents({"batch_id": "batch-free", "status": "sent"}) == 1
            # capped item is reset to pending before every retry (for tomorrow's
            # cap reset) — never lost, never marked failed.
            assert parked.wait(5)
            assert mgr.db.send_queue_items.find_one({"batch_id": "batch-cap"})["status"] == "pending"
            stop.set()
            ta.join(5)
        assert not ta.is_alive()


class TestVisiblePauseTiming:
    @staticmethod
    def _clock():
        ticks = iter([1000.0, 1000.0, 1015.0, 1030.0])
        wall = iter([
            datetime(2026, 10, 8, 17, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 10, 8, 17, 0, 15, tzinfo=timezone.utc),
        ])

        class _Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return next(wall)

        return ticks, _Clock

    def test_pause_keeps_one_stable_deadline_and_renews_the_worker_lease(self, mgr):
        sw._ensure_lease_doc(mgr)
        sw._try_acquire_lease(mgr)
        ticks, clock = self._clock()

        with (
            patch.object(sw.time, "time", side_effect=lambda: next(ticks)),
            patch.object(sw.time, "sleep"),
            patch.object(sw, "datetime", clock),
            patch.object(sw, "_renew_lease", return_value=True) as renew,
            patch.object(sw, "_set_state") as set_state,
        ):
            assert sw._paused_wait(mgr, "user-a", "disconnected", "WhatsApp desconectado", 30) is True

        first_state = set_state.call_args_list[0].kwargs
        last_state = set_state.call_args_list[-1].kwargs
        assert first_state["phase"] == "paused"
        assert first_state["wait_reason"] == "disconnected"
        assert first_state["wait_message"] == "WhatsApp desconectado"
        # Recalculated from one fixed end time: polling does not push the
        # displayed retry deadline farther into the future.
        assert abs((first_state["next_action_at"] - last_state["next_action_at"]).total_seconds()) < 0.1
        assert renew.call_count == 2

    def test_batch_delay_exposes_exact_deadline_without_drifting(self, mgr):
        ticks, clock = self._clock()
        with (
            patch.object(sw.time, "time", side_effect=lambda: next(ticks)),
            patch.object(sw.time, "sleep"),
            patch.object(sw, "datetime", clock),
            patch.object(sw, "_renew_lease", return_value=True),
            patch.object(sw, "_set_state") as set_state,
        ):
            assert _REAL_ANTISPAM_WAIT(mgr, "user-a", True, 30, 5, 3) is True

        first_state = set_state.call_args_list[0].kwargs
        last_state = set_state.call_args_list[-1].kwargs
        assert first_state["phase"] == "waiting"
        assert first_state["active_batch"] is True
        assert first_state["wait_reason"] == "batch_break"
        assert abs((first_state["next_action_at"] - last_state["next_action_at"]).total_seconds()) < 0.1


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


# ══════════════════════════════════════════════════════════════════════════
# _check_send_allowed — the blocked/blacklisted safety gate. Every test above
# mocks this out entirely, so its own real logic (not just its call sites)
# had zero direct coverage.
# ══════════════════════════════════════════════════════════════════════════

class TestCheckSendAllowed:
    def test_no_company_id_is_allowed(self, mgr):
        assert sw._check_send_allowed(mgr, "") == (True, "")

    def test_blacklisted_number_is_not_allowed_in_any_format(self, mgr):
        """The queue used to check only the company — a blocked number inside a
        non-blocked company still got the message (audit 2026-10-04)."""
        mgr.db.blacklist.insert_one({"type": "phone", "value": "526642857783"})
        assert sw._check_send_allowed(mgr, "", "+52 1 664 285 7783") == (False, "skipped_blacklisted")
        assert sw._check_send_allowed(mgr, "", "526642857784") == (True, "")

    def test_malformed_company_id_is_allowed(self, mgr):
        # Length check only (`len(company_id) != 24`) — anything else short-
        # circuits to fail-open rather than crashing on a bad ObjectId().
        assert sw._check_send_allowed(mgr, "not-a-real-id") == (True, "")

    def test_blocked_company_is_not_allowed(self, mgr):
        cid = ObjectId()
        mgr.db.companies.insert_one({"_id": cid, "domain": "blocked.com", "industry": "gas", "blocked": True})
        with patch("app.pipeline._check_blacklist", return_value=None):
            assert sw._check_send_allowed(mgr, str(cid)) == (False, "skipped_blocked")

    def test_blacklisted_company_is_not_allowed(self, mgr):
        cid = ObjectId()
        mgr.db.companies.insert_one({"_id": cid, "domain": "spammy.com", "industry": "gas", "blocked": False})
        with patch("app.pipeline._check_blacklist", return_value={"reason": "domain", "matched": "spammy.com"}):
            assert sw._check_send_allowed(mgr, str(cid)) == (False, "skipped_blacklisted")

    def test_normal_company_is_allowed(self, mgr):
        cid = ObjectId()
        mgr.db.companies.insert_one({"_id": cid, "domain": "normal.com", "industry": "gas", "blocked": False})
        with patch("app.pipeline._check_blacklist", return_value=None):
            assert sw._check_send_allowed(mgr, str(cid)) == (True, "")

    def test_company_not_found_is_allowed(self, mgr):
        # Deleted/moved company between enqueue and send — fail open rather
        # than silently dropping an otherwise-valid queued item.
        assert sw._check_send_allowed(mgr, str(ObjectId())) == (True, "")


# ══════════════════════════════════════════════════════════════════════════
# _sweep_interrupted_items — a backend crash mid-send must never auto-retry
# (a WhatsApp message can't be un-sent), but must not touch items that are
# genuinely still in flight.
# ══════════════════════════════════════════════════════════════════════════

class TestSweepInterruptedItems:
    def test_stale_sending_item_is_marked_interrupted(self, mgr):
        stale_start = datetime.now(timezone.utc) - timedelta(seconds=sw._SENDING_STALE_AFTER_SEC + 30)
        mgr.db.send_queue_items.insert_one({"status": "sending", "started_at": stale_start})
        sw._sweep_interrupted_items(mgr)
        item = mgr.db.send_queue_items.find_one({})
        assert item["status"] == "interrupted"
        assert item["finished_at"] is not None

    def test_recently_started_item_is_left_alone(self, mgr):
        fresh_start = datetime.now(timezone.utc) - timedelta(seconds=5)
        mgr.db.send_queue_items.insert_one({"status": "sending", "started_at": fresh_start})
        sw._sweep_interrupted_items(mgr)
        item = mgr.db.send_queue_items.find_one({})
        assert item["status"] == "sending"

    def test_non_sending_items_are_untouched(self, mgr):
        stale_start = datetime.now(timezone.utc) - timedelta(seconds=sw._SENDING_STALE_AFTER_SEC + 30)
        mgr.db.send_queue_items.insert_one({"status": "sent", "started_at": stale_start})
        sw._sweep_interrupted_items(mgr)
        item = mgr.db.send_queue_items.find_one({})
        assert item["status"] == "sent"


# ══════════════════════════════════════════════════════════════════════════
# Instance disconnects mid-send (as opposed to never having one at all) —
# distinct code path from TestNoInstanceBacksOff, exercised via _process_item
# directly to control the before/after connection state precisely.
# ══════════════════════════════════════════════════════════════════════════

class TestDisconnectedMidSendPause:
    def test_resets_item_and_pauses_when_instance_drops_during_send(self, mgr):
        mgr.db.send_queue_items.insert_many(_make_items("dc-user", "batch-dc", 1))
        item = mgr.db.send_queue_items.find_one({"batch_id": "batch-dc"})
        with (
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
            # True at entry (allowed to start sending), False right after —
            # simulates the session dying mid-send rather than never existing.
            patch.object(sw, "_user_has_connected_instance", side_effect=[True, False]),
            patch.object(sched, "_send_message", return_value=False),
        ):
            result, _, _ = sw._process_item(mgr, "dc-user", item, 0, 0)
        assert result == "disconnected_pause"
        refreshed = mgr.db.send_queue_items.find_one({"batch_id": "batch-dc"})
        assert refreshed["status"] == "pending"
        assert refreshed["started_at"] is None

    def test_genuine_send_failure_with_instance_still_up_is_just_failed(self, mgr):
        # Same False/None return from _send_message, but the instance is still
        # connected on the follow-up check — a real failure (bad payload,
        # blocked number), not a dropped session. Must NOT get the retry
        # treatment reserved for a disconnect.
        mgr.db.send_queue_items.insert_many(_make_items("dc-user2", "batch-dc2", 1))
        item = mgr.db.send_queue_items.find_one({"batch_id": "batch-dc2"})
        with (
            patch.object(sw, "_check_send_allowed", return_value=(True, "")),
            patch.object(sw, "_user_has_connected_instance", side_effect=[True, True]),
            patch.object(sched, "_send_message", return_value=False),
        ):
            result, _, _ = sw._process_item(mgr, "dc-user2", item, 0, 0)
        assert result is True
        refreshed = mgr.db.send_queue_items.find_one({"batch_id": "batch-dc2"})
        assert refreshed["status"] == "failed"
