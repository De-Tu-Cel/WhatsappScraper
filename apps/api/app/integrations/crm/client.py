"""HTTP client for the dtc-crm ingest endpoints."""
import logging

import requests

from app.integrations.crm import config

logger = logging.getLogger("crm_sync")

_TIMEOUT = 10
_BODY_MAX = 300


class CrmRejected(Exception):
    """CRM rejected the payload (422 and other non-retryable 4xx)."""


class CrmUnavailable(Exception):
    """Transient/config failure: network, timeout, 3xx, 401, 403, 404, 405, 429, 5xx."""


def _post(path: str, payload: dict) -> dict:
    key = config.api_key()
    try:
        resp = requests.post(
            f"{config.ingest_url()}{path}",
            json=payload,
            headers={"Authorization": f"Bearer {key}"},
            timeout=_TIMEOUT,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        # Only the exception class: its text could echo request headers.
        raise CrmUnavailable(f"{path}: {type(exc).__name__}") from None
    status = resp.status_code
    if status in (200, 201):
        return resp.json()
    body = (resp.text or "").replace(key, "***")[:_BODY_MAX]
    msg = f"{path}: HTTP {status} {body}"
    # 3xx/404/405: wrong URL or http->https, a config error that needs fixing, not the payload.
    if status in (401, 403, 404, 405, 429) or 300 <= status < 400 or status >= 500:
        raise CrmUnavailable(msg)
    raise CrmRejected(msg)


def send_company(payload: dict) -> dict:
    return _post("/ingest/companies", payload)


def send_lead(payload: dict) -> dict:
    return _post("/ingest/leads", payload)
