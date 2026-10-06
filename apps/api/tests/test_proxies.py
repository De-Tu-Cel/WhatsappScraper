"""Proxies por número (app/proxies.py): lectura de la lista pegada, asignación al azar entre
los menos usados (compartir solo cuando ya no alcanzan) y que la contraseña nunca salga."""
import random

import requests

from app import proxies as px

_WEBSHARE_TABLE = """20 proxies available
Authentication Method
username_password

Connection Method
direct

138.226.70.167
7857
usr1
pw1
2 minutes ago

Working
🇺🇸
United States
Palo Alto
195.40.137.95
5816
usr1
pw1
1 minute ago

Working
🇬🇧
United Kingdom
London
"""


class TestParseProxyText:
    def test_colon_lines(self):
        out = px.parse_proxy_text("1.2.3.4:8080:user:pass\n5.6.7.8:9090:user:pass\n")
        assert [(p["host"], p["port"], p["username"], p["password"]) for p in out] == [
            ("1.2.3.4", 8080, "user", "pass"), ("5.6.7.8", 9090, "user", "pass")]

    def test_url_form(self):
        out = px.parse_proxy_text("http://user:p%40ss@proxy.example.com:7000")
        assert out == [{"host": "proxy.example.com", "port": 7000, "username": "user", "password": "p%40ss"}]

    def test_table_copied_from_the_webshare_panel(self):
        out = px.parse_proxy_text(_WEBSHARE_TABLE)
        assert [(p["host"], p["port"]) for p in out] == [("138.226.70.167", 7857), ("195.40.137.95", 5816)]
        assert all(p["username"] == "usr1" and p["password"] == "pw1" for p in out)

    def test_duplicates_and_noise(self):
        assert len(px.parse_proxy_text("1.2.3.4:8080:u:p\n1.2.3.4:8080:u:p")) == 1
        assert px.parse_proxy_text("hola, sin proxies aquí 2026") == []


class TestChooseLeastUsed:
    _pool = [{"_id": f"p{i}"} for i in range(3)]

    def test_each_number_gets_its_own_while_they_last(self):
        usage, rng = {}, random.Random(7)
        for n in range(3):
            chosen = px.choose_least_used(self._pool, usage, rng)
            usage.setdefault(chosen["_id"], []).append(f"num{n}")
        assert sorted(len(v) for v in usage.values()) == [1, 1, 1]

    def test_shares_only_when_there_are_more_numbers_than_proxies(self):
        usage = {"p0": ["a", "b"], "p1": ["c"], "p2": ["d"]}
        picks = {px.choose_least_used(self._pool, usage, random.Random(s))["_id"] for s in range(20)}
        assert picks == {"p1", "p2"}

    def test_empty_pool(self):
        assert px.choose_least_used([], {}) is None


class TestPickProxyFilters:
    def test_only_working_proxies_of_the_chosen_country(self, monkeypatch):
        seen = {}

        class _Coll:
            def find(self, q, *a, **kw):
                seen["q"] = q
                return [{"_id": "x1"}]

        class _DB:
            proxies = _Coll()

        monkeypatch.setattr(px, "get_settings", lambda db: {"country": "US", "auto_assign": False})
        monkeypatch.setattr(px, "usage_by_proxy", lambda db: {})
        assert px.pick_proxy(_DB())["_id"] == "x1"
        assert seen["q"] == {"enabled": {"$ne": False}, "status": "ok", "country": "US"}


class TestSecretsNeverLeak:
    def test_public_proxy_has_no_password(self):
        out = px.public_proxy({"_id": "abc", "host": "1.2.3.4", "port": 80, "username": "u", "password": "s3cr3t"})
        assert "password" not in out and out["has_password"] is True
        assert "s3cr3t" not in repr(out)

    def test_check_error_does_not_echo_the_password(self, monkeypatch):
        def boom(*a, **kw):
            raise requests.exceptions.ProxyError("Cannot connect to proxy http://u:s3cr3t@1.2.3.4:80")
        monkeypatch.setattr(px.requests, "get", boom)
        res = px.check_proxy({"host": "1.2.3.4", "port": 80, "username": "u", "password": "s3cr3t"})
        assert res["ok"] is False and "s3cr3t" not in res["error"]


class TestLaunchPayload:
    def test_with_and_without_proxy(self):
        p = {"host": "1.2.3.4", "port": 80, "username": "u", "password": "s"}
        assert px.launch_payload(p, True) == {"proxy": {"server": "1.2.3.4:80", "username": "u", "password": "s"},
                                              "lean": True, "restart": True}
        assert px.launch_payload(None, False, restart=False) == {"proxy": None, "lean": False, "restart": False}


class TestImportReappliesChangedPasswords:
    def test_numbers_on_a_proxy_whose_password_changed_get_it_pushed(self, monkeypatch):
        existing = {"_id": "p1", "host": "1.2.3.4", "port": 80, "username": "u", "password": "old"}

        class _Proxies:
            def find_one(self, q):
                return dict(existing, password="new") if q.get("_id") else existing

            def update_one(self, *a, **kw):
                pass

        class _DB:
            proxies = _Proxies()

        pushed = []
        monkeypatch.setattr(px, "check_many", lambda db, ps: [dict(p, status="ok") for p in ps])
        monkeypatch.setattr(px, "usage_by_proxy", lambda db: {"p1": ["sender666", "marco-wa"]})
        monkeypatch.setattr(px, "push_instance_settings", lambda db, name, restart=True: pushed.append(name))
        out = px.import_text(_DB(), "1.2.3.4:80:u:new")
        assert out["updated"] == 1 and out["reapplied"] == 2
        assert pushed == ["sender666", "marco-wa"]

    def test_same_password_pushes_nothing(self, monkeypatch):
        existing = {"_id": "p1", "host": "1.2.3.4", "port": 80, "username": "u", "password": "same"}

        class _Proxies:
            def find_one(self, q):
                return existing

        class _DB:
            proxies = _Proxies()

        monkeypatch.setattr(px, "check_many", lambda db, ps: ps)
        monkeypatch.setattr(px, "push_instance_settings", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("no debía empujar")))
        assert px.import_text(_DB(), "1.2.3.4:80:u:same")["reapplied"] == 0


class TestAutonomousAssignment:
    def _settings(self, monkeypatch, auto):
        monkeypatch.setattr(px, "get_settings", lambda db: {"country": "US", "auto_assign": auto})

    def test_migration_does_nothing_when_auto_is_off(self, monkeypatch):
        self._settings(monkeypatch, False)
        assert px.migrate_one(object()) is None

    def test_migration_moves_one_connected_number_without_proxy(self, monkeypatch):
        self._settings(monkeypatch, True)
        seen = {}

        class _Inst:
            def find_one(self, q, sort=None):
                seen["q"] = q
                return {"name": "tania-sesion-1"}

        class _DB:
            instances = _Inst()

        assigned = []
        monkeypatch.setattr(px, "assign", lambda db, name, pid: assigned.append((name, pid)) or {"proxy_id": "p9"})
        assert px.migrate_one(_DB()) == "tania-sesion-1"
        assert assigned == [("tania-sesion-1", "auto")]
        assert seen["q"]["status"] == "connected" and seen["q"]["proxy_id"] == {"$in": [None, ""]}

    def _health(self, monkeypatch, auto, streak):
        self._settings(monkeypatch, auto)
        failing = {"_id": "p1", "host": "1.2.3.4", "port": 80, "status": "failing", "fail_streak": streak, "last_error": "timeout"}

        class _Proxies:
            def find(self, q):
                return [failing]

        class _DB:
            proxies = _Proxies()

        monkeypatch.setattr(px, "check_many", lambda db, ps: ps)
        monkeypatch.setattr(px, "usage_by_proxy", lambda db: {"p1": ["sender666"]})
        moved, mails = [], []
        monkeypatch.setattr(px, "assign", lambda db, name, pid: moved.append(name) or {"proxy_id": "p2"})
        monkeypatch.setattr(px, "_proxy_doc", lambda db, pid: {"host": "5.6.7.8", "port": 81})
        import app.email_service as es
        monkeypatch.setattr(es, "send_proxy_failing_email", lambda *a, **kw: mails.append(kw.get("moved_to")))
        px.health_round(_DB(), ["alertas@example.com"])
        return moved, mails

    def test_one_hour_down_only_alerts(self, monkeypatch):
        moved, mails = self._health(monkeypatch, auto=True, streak=px.ALERT_AFTER_FAILS)
        assert moved == [] and mails == [None]

    def test_two_hours_down_moves_its_numbers_when_auto(self, monkeypatch):
        moved, mails = self._health(monkeypatch, auto=True, streak=px.FAILOVER_AFTER_FAILS)
        assert moved == ["sender666"] and mails == [{"sender666": "5.6.7.8:81"}]

    def test_two_hours_down_without_auto_does_not_move(self, monkeypatch):
        moved, mails = self._health(monkeypatch, auto=False, streak=px.FAILOVER_AFTER_FAILS)
        assert moved == [] and mails == []
