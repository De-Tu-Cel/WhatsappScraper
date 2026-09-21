"""Tests for app/scheduler.py's _send_message() instance-routing/scoping —
specifically the user_id vs. user_instances distinction.

Real bug found auditing the sending system (2026-09-20): the function used
`if user_instances:` (the RESOLVED list of instances this user owns) as a
proxy for "was a user_id given at all". Those aren't the same thing — a real
user_id whose owner has ZERO assigned instances produces an empty
user_instances list, identical to "no user context". That let a scheduled
campaign whose owner has no WhatsApp instance fall through to the unscoped
"claimed instances" pool (or WASENDER_PAT/WAHA/Evolution fallback) and
silently send through a completely unrelated user's WhatsApp number.

These tests exercise scheduler._send_message directly with mocked
dependencies (no real Mongo, no real WhatsApp API calls).
"""
from unittest.mock import MagicMock, patch

from app import scheduler as sched


def _fake_db(user_instances_docs=None, company_doc=None):
    """Minimal db stand-in exposing only what _send_message touches on this path."""
    db = MagicMock()
    db.db.instances.find.return_value = user_instances_docs or []
    db.db.instances.find_one.return_value = None
    db.db.companies.find_one.return_value = company_doc
    return db


class TestSendMessageUserScoping:
    def test_user_with_zero_instances_never_falls_through_to_unscoped_pool(self):
        """The exact bug: user_id is real, but this user owns no instances.
        Some OTHER, unrelated instance is connected. Must return None, never
        send through that unrelated instance or through Wasender/WAHA/Evolution."""
        db = _fake_db(user_instances_docs=[])  # this user owns nothing
        with (
            patch("app.config.WWEBJS_URL", "http://fake-wwebjs:3001"),
            patch("app.config.WASENDER_PAT", ""),
            patch("app.config.WAHA_API_KEY", ""),
            patch("app.config.EVOLUTION_API_KEY", ""),
            patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["someone-elses-instance"]),
        ):
            result = sched._send_message(db, "", "5210000000", "hola", "job1", user_id="user-with-no-instance")
        assert result is None

    def test_user_with_zero_instances_does_not_fall_through_to_wasender(self):
        """Same setup, but WASENDER_PAT IS configured — must still return None,
        not silently route the user-scoped send through the global Wasender pool."""
        db = _fake_db(user_instances_docs=[])
        with (
            patch("app.config.WWEBJS_URL", "http://fake-wwebjs:3001"),
            patch("app.config.WASENDER_PAT", "fake-pat"),
            patch("app.config.WAHA_API_KEY", ""),
            patch("app.config.EVOLUTION_API_KEY", ""),
            patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["someone-elses-instance"]),
            patch.object(sched, "_send_via_wasender") as mock_wasender,
        ):
            result = sched._send_message(db, "", "5210000000", "hola", "job1", user_id="user-with-no-instance")
        assert result is None
        mock_wasender.assert_not_called()

    def test_user_with_own_connected_instance_sends_through_it(self):
        """Sanity check the fix didn't break the normal, working case: a user
        who DOES own a connected instance still sends through it."""
        db = _fake_db(user_instances_docs=[{"name": "my-instance"}])
        with (
            patch("app.config.WWEBJS_URL", "http://fake-wwebjs:3001"),
            patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["my-instance", "someone-elses-instance"]),
            patch.object(sched, "_nc_aware_pick", return_value="my-instance"),
            patch.object(sched, "_send_via_wwebjs", return_value=True) as mock_send,
        ):
            result = sched._send_message(db, "", "5210000000", "hola", "job1", user_id="user-with-instance")
        assert result is True
        mock_send.assert_called_once()
        assert mock_send.call_args.kwargs["session"] == "my-instance"

    def test_no_user_id_falls_back_to_claimed_instance_pool(self):
        """Sanity check the other normal case: no user context at all (legacy/
        system-attributed sends) still uses the claimed-instances fallback."""
        db = _fake_db(user_instances_docs=[])
        db.db.instances.find_one.return_value = {"name": "claimed-instance", "assigned_to": "someone"}
        with (
            patch("app.config.WWEBJS_URL", "http://fake-wwebjs:3001"),
            patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["claimed-instance"]),
            patch.object(sched, "_nc_aware_pick", return_value="claimed-instance"),
            patch.object(sched, "_send_via_wwebjs", return_value=True) as mock_send,
        ):
            result = sched._send_message(db, "", "5210000000", "hola", "job1", user_id="")
        assert result is True
        mock_send.assert_called_once()
