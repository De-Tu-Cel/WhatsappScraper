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
    def test_equal_capacity_lines_share_twelve_new_contacts_equally(self):
        from collections import Counter
        from app import daily_cap
        counts = Counter()
        db = _fake_db()
        db.db.instances.find_one.return_value = {'warmup_mode': False}
        db.db.instance_new_contacts_today.find_one.return_value = {'companies': []}
        with (patch.object(sched, 'get_daily_count', side_effect=lambda db, name: counts[name]),
              patch.object(sched, 'get_instance_cap', return_value=150),
              patch.object(daily_cap, 'is_new_contact', return_value=True),
              patch.object(daily_cap, 'count_new_contacts_today_for_instance', side_effect=lambda db, name: counts[name])):
            for i in range(12):
                chosen = sched._nc_aware_pick(db, ['a', 'b'], f'company-{i}')
                counts[chosen] += 1
        assert counts == {'a': 6, 'b': 6}

    def test_picker_counts_inflight_reservations_before_messages_are_logged(self):
        from app import daily_cap
        db = _fake_db()
        db.db.instances.find_one.return_value = {'warmup_mode': True}
        db.db.instance_new_contacts_today.find_one.side_effect = lambda q, *args: {
            'companies': ['other-' + str(i) for i in range(5)] if q['instance'] == 'busy' else [],
        }
        with (patch.object(sched, 'get_daily_count', return_value=0),
              patch.object(sched, 'get_instance_cap', return_value=20),
              patch.object(daily_cap, 'is_new_contact', return_value=True),
              patch.object(daily_cap, 'count_new_contacts_today_for_instance', return_value=0)):
            assert sched._nc_aware_pick(db, ['busy', 'free'], 'new-company') == 'free'
            assert sched._nc_aware_pick(db, ['busy', 'free'], 'other-0') == 'busy'

    def test_campaign_moves_to_own_online_line_and_returns_when_preferred_recovers(self):
        from app import daily_cap
        db = _fake_db([{'name': 'preferred'}, {'name': 'backup'}], {'assigned_instance': 'preferred'})
        db.db.instances.find_one.return_value = {'provider': 'wwebjs'}
        live = ['preferred', 'backup', 'foreign']
        with (patch('app.config.WWEBJS_URL', 'http://fake'),
              patch('app.whatsapp_wwebjs.get_all_connected_instances', side_effect=lambda db: list(live)),
              patch.object(sched, 'get_daily_count', return_value=0),
              patch.object(sched, 'get_instance_cap', return_value=20),
              patch.object(daily_cap, 'check_new_contact_cap', return_value=(True, 0, 5)),
              patch.object(sched, '_nc_aware_pick', side_effect=lambda db, names, cid: names[0]),
              patch.object(sched, '_send_via_wwebjs', return_value=True) as send):
            assert sched._send_message(db, '6a7633cbecf84e0f0e0336e1', '525500000001', 'test', 'job', user_id='owner') is True
            live[:] = ['backup', 'foreign']
            assert sched._send_message(db, '6a7633cbecf84e0f0e0336e1', '525500000002', 'test', 'job', user_id='owner') is True
            live[:] = ['preferred', 'backup', 'foreign']
            assert sched._send_message(db, '6a7633cbecf84e0f0e0336e1', '525500000003', 'test', 'job', user_id='owner') is True
        assert [call.kwargs['session'] for call in send.call_args_list] == ['preferred', 'backup', 'preferred']
        db.db.companies.update_one.assert_not_called()

    def test_preferred_offline_does_not_escape_to_another_users_line(self):
        from app import daily_cap
        db = _fake_db([{'name': 'preferred'}], {'assigned_instance': 'preferred'})
        db.db.instances.find_one.return_value = {'provider': 'wwebjs'}
        with (patch('app.config.WWEBJS_URL', 'http://fake'),
              patch('app.whatsapp_wwebjs.get_all_connected_instances', return_value=['foreign']),
              patch.object(sched, 'get_daily_count', return_value=0),
              patch.object(sched, 'get_instance_cap', return_value=20),
              patch.object(daily_cap, 'check_new_contact_cap', return_value=(True, 0, 5)),
              patch.object(sched, '_send_via_wwebjs') as send):
            assert sched._send_message(db, '6a7633cbecf84e0f0e0336e1', '525500000001', 'test', 'job', user_id='owner') is None
        send.assert_not_called()

    def test_capacity_weighted_distribution_respects_both_line_limits(self):
        from collections import Counter
        from app import daily_cap
        counts = Counter()
        db = _fake_db()
        db.db.instances.find_one.side_effect = lambda q, *args: {'warmup_mode': q['name'] == 'warmup'}
        with (patch.object(sched, 'get_daily_count', side_effect=lambda db, name: counts[name]),
              patch.object(sched, 'get_instance_cap', side_effect=lambda db, name: 20 if name == 'warmup' else 150),
              patch.object(daily_cap, 'is_new_contact', return_value=True),
              patch.object(daily_cap, 'get_new_contacts_limit', side_effect=lambda warmup: 5 if warmup else 12),
              patch.object(daily_cap, 'count_new_contacts_today_for_instance', side_effect=lambda db, name: counts[name])):
            for i in range(17):
                chosen = sched._nc_aware_pick(db, ['normal', 'warmup'], f'company-{i}')
                assert chosen is not None
                counts[chosen] += 1
            assert sched._nc_aware_pick(db, ['normal', 'warmup'], 'company-18') is None
        assert counts == {'normal': 12, 'warmup': 5}

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

    def test_new_contact_cap_full_is_a_skip_not_a_failed_send(self):
        """gely-wa de Antonio (2026-10-07): el sexto y el séptimo contacto nuevo
        se marcaron failed sin message_logs porque _nc_aware_pick devolvía None
        y la cola lo leía como que WhatsApp no recibió. No salieron; no cabían."""
        db = _fake_db(user_instances_docs=[{"name": "gely-wa"}])
        with (
            patch("app.config.WWEBJS_URL", "http://fake-wwebjs:3001"),
            patch("app.whatsapp_wwebjs.get_all_connected_instances", return_value=["gely-wa"]),
            patch.object(sched, "_nc_aware_pick", return_value=None),
            patch.object(sched, "_send_via_wwebjs") as mock_send,
        ):
            result = sched._send_message(
                db, "co-nuevo", "5210000000", "hola", "job1", user_id="tono",
            )
        assert result == "skipped_nc_cap"
        mock_send.assert_not_called()

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
