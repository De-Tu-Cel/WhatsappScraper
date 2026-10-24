import pytest
import requests

from app.integrations.crm import client, config

KEY = "sk-secret-key-123"


class FakeResp:
    def __init__(self, status, body=None, text=""):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = text

    def json(self):
        return self._body


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com/")
    monkeypatch.setenv("CRM_API_KEY", KEY)


def test_disabled_without_both_env_vars(monkeypatch):
    monkeypatch.delenv("CRM_API_KEY", raising=False)
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com")
    assert config.enabled() is False
    monkeypatch.setenv("CRM_API_KEY", KEY)
    assert config.enabled() is True
    monkeypatch.setenv("CRM_INGEST_URL", "")
    assert config.enabled() is False
    monkeypatch.setenv("CRM_INGEST_URL", "https://crm.example.com/")
    assert config.ingest_url() == "https://crm.example.com"
    assert config.api_key() == KEY


def test_posts_with_bearer_and_returns_json(monkeypatch, env):
    calls = []

    def fake_post(url, **kw):
        calls.append((url, kw))
        return FakeResp(201, {"id": "c1"})

    monkeypatch.setattr(client.requests, "post", fake_post)
    assert client.send_company({"a": 1}) == {"id": "c1"}
    assert client.send_lead({"b": 2}) == {"id": "c1"}
    url, kw = calls[0]
    assert url == "https://crm.example.com/ingest/companies"
    assert kw["json"] == {"a": 1}
    assert kw["headers"] == {"Authorization": f"Bearer {KEY}"}
    assert kw["timeout"] == 10
    assert kw["allow_redirects"] is False
    assert calls[1][0] == "https://crm.example.com/ingest/leads"


def test_422_is_rejected_5xx_and_timeout_are_unavailable(monkeypatch, env):
    def respond(status):
        monkeypatch.setattr(client.requests, "post", lambda url, **kw: FakeResp(status, text="x" * 500))

    respond(200)
    assert client.send_lead({}) == {}
    for status in (422, 400):
        respond(status)
        with pytest.raises(client.CrmRejected) as ei:
            client.send_lead({})
        assert str(status) in str(ei.value)
        assert len(str(ei.value)) < 400
    for status in (401, 403, 404, 405, 429, 301, 302, 307, 308, 500, 503):
        respond(status)
        with pytest.raises(client.CrmUnavailable):
            client.send_lead({})

    def boom(url, **kw):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(client.requests, "post", boom)
    with pytest.raises(client.CrmUnavailable):
        client.send_company({})


def test_api_key_never_in_exception_text(monkeypatch, env):
    def boom(url, **kw):
        raise requests.ConnectionError(f"failed with header Bearer {KEY}")

    monkeypatch.setattr(client.requests, "post", boom)
    with pytest.raises(client.CrmUnavailable) as ei:
        client.send_lead({})
    assert KEY not in str(ei.value)
    monkeypatch.setattr(client.requests, "post", lambda url, **kw: FakeResp(422, text=f"bad {KEY}"))
    with pytest.raises(client.CrmRejected) as ei:
        client.send_lead({})
    assert KEY not in str(ei.value)
