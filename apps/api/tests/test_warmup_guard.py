"""El warmup entre líneas propias no pasa por el consentimiento de prospectos."""
from unittest.mock import MagicMock

from app.warmup_queue import _internal_guard


def _db(blacklisted=False):
    db = MagicMock()
    db.db.blacklist.find_one.return_value = {"_id": 1} if blacklisted else None
    # Una línea propia nunca tiene consentimiento registrado: no debe importar.
    db.db.contact_permissions.find_one.return_value = None
    return db


def test_own_line_without_recorded_consent_is_allowed():
    assert _internal_guard(_db(), "5214428079840")() is None


def test_blacklisted_line_is_still_blocked():
    assert _internal_guard(_db(blacklisted=True), "5214428079840")()["reason"] == "phone"


def test_a_failed_check_blocks_instead_of_sending():
    db = MagicMock()
    db.db.blacklist.find_one.side_effect = RuntimeError("db down")
    assert _internal_guard(db, "5214428079840")()["reason"] == "permission_check_failed"
