"""Tests for app/auth.py login lockout — added 2026-09-24 after finding
/auth/login had zero rate limiting on top of a 4-character minimum PIN
(10,000 possible combinations), making any account brute-forceable in
minutes. login() now locks an account out after MAX_LOGIN_ATTEMPTS
consecutive wrong PINs for LOCKOUT_MINUTES.
"""
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app import auth


class FakeUsersCollection:
    def __init__(self, user: dict):
        self._user = dict(user)

    def find_one(self, query):
        if query.get("username") == self._user.get("username") and query.get("active", True):
            return dict(self._user)
        if "session_token" in query and query["session_token"] == self._user.get("session_token"):
            return dict(self._user)
        return None

    def update_one(self, query, update):
        self._user.update(update.get("$set", {}))


class FakeMgr:
    def __init__(self, user: dict):
        self.db = type("_DB", (), {"users": FakeUsersCollection(user)})()


def _base_user(pin="1234"):
    return {
        "_id": "fake-user-id",
        "username": "testuser",
        "active": True,
        "pin_hash": auth.hash_pin(pin),
        "failed_login_attempts": 0,
        "login_locked_until": None,
    }


class TestLoginLockout:
    def test_correct_pin_logs_in(self):
        mgr = FakeMgr(_base_user("1234"))
        with patch("app.auth.MongoDBManager", return_value=mgr):
            user = auth.login("testuser", "1234")
        assert user is not None
        assert user["session_token"]

    def test_wrong_pin_returns_none(self):
        mgr = FakeMgr(_base_user("1234"))
        with patch("app.auth.MongoDBManager", return_value=mgr):
            assert auth.login("testuser", "0000") is None

    def test_locks_after_max_attempts(self):
        mgr = FakeMgr(_base_user("1234"))
        with patch("app.auth.MongoDBManager", return_value=mgr):
            for _ in range(auth.MAX_LOGIN_ATTEMPTS):
                auth.login("testuser", "wrong")
            # One more attempt, even with the CORRECT pin, must now raise AccountLocked
            with pytest.raises(auth.AccountLocked):
                auth.login("testuser", "1234")

    def test_locked_account_rejects_correct_pin_too(self):
        user = _base_user("1234")
        user["login_locked_until"] = datetime.now() + timedelta(minutes=5)
        mgr = FakeMgr(user)
        with patch("app.auth.MongoDBManager", return_value=mgr):
            with pytest.raises(auth.AccountLocked):
                auth.login("testuser", "1234")

    def test_lock_expires_and_correct_pin_works_again(self):
        user = _base_user("1234")
        user["login_locked_until"] = datetime.now() - timedelta(seconds=1)  # already expired
        mgr = FakeMgr(user)
        with patch("app.auth.MongoDBManager", return_value=mgr):
            result = auth.login("testuser", "1234")
        assert result is not None

    def test_successful_login_resets_attempt_counter(self):
        user = _base_user("1234")
        user["failed_login_attempts"] = auth.MAX_LOGIN_ATTEMPTS - 1
        mgr = FakeMgr(user)
        with patch("app.auth.MongoDBManager", return_value=mgr):
            auth.login("testuser", "1234")
        assert mgr.db.users._user["failed_login_attempts"] == 0
