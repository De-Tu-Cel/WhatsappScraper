"""Balance/spend checks for the external paid services still in active use
(OpenAI, DataForSEO) — added 2026-09-24 so the team can keep an eye on money
without leaving the app. BrightData was deliberately left out: confirmed by
the user as no longer in use, despite BRIGHTDATA_SERP_KEY still being set.
"""
import os
import base64
import requests
from datetime import datetime, timezone

OPENAI_ADMIN_API_KEY = os.getenv("OPENAI_ADMIN_API_KEY", "")
# The Admin key's /costs endpoint is organization-wide by default — this
# account's org has several unrelated projects sharing it (FEMSA, OwnWA,
# etc.), so an unfiltered total silently included their spend too (confirmed
# live 2026-09-25: unfiltered $1.16 vs this project's real $0.87). This is
# this project's own project_id ("MysteryBox" in the OpenAI dashboard,
# matches the "Mystery Shopper" branding in the app sidebar) — set via env so
# it isn't a hardcoded assumption if the project ever gets recreated.
OPENAI_PROJECT_ID = os.getenv("OPENAI_PROJECT_ID", "proj_i2ae697uaN9JVQ5kNIgROAeY")


def get_openai_spend() -> dict:
    """Current-month USD spend via OpenAI's Costs API, scoped to this
    project only (see OPENAI_PROJECT_ID above).

    Requires a separate Admin API key (created by an org owner) — the
    regular inference OPENAI_API_KEY is rejected by this endpoint, OpenAI
    keeps the two strictly separate.
    """
    if not OPENAI_ADMIN_API_KEY:
        return {"configured": False}
    if not OPENAI_PROJECT_ID:
        # No consultar toda la organización cuando falta el proyecto.
        return {"configured": False, "reason": "missing_project"}
    now = datetime.now(timezone.utc)
    month_start = int(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())
    try:
        r = requests.get(
            "https://api.openai.com/v1/organization/costs",
            headers={"Authorization": f"Bearer {OPENAI_ADMIN_API_KEY}"},
            params={"start_time": month_start, "limit": 31, "bucket_width": "1d", "project_ids": [OPENAI_PROJECT_ID]},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        total = 0.0
        for bucket in data.get("data", []):
            for result in bucket.get("results", []):
                total += (result.get("amount") or {}).get("value", 0) or 0
        from app.balance_alerts import record_balance, limits
        value = {"configured": True, "ok": True, "spend_this_month": round(total, 2), "currency": "usd",
                 "monthly_budget_usd": limits()['openai_monthly_budget_usd']}
        record_balance('ai', value)
        return value
    except Exception as e:
        return {"configured": True, "ok": False, "error": str(e)}


def get_dataforseo_balance(*, clear_block=False) -> dict:
    """Current account balance via DataForSEO's free user_data endpoint."""
    login = os.getenv("DATAFORSEO_LOGIN", "")
    password = os.getenv("DATAFORSEO_PASSWORD", "")
    if not login or not password:
        return {"configured": False}
    try:
        auth = base64.b64encode(f"{login}:{password}".encode()).decode()
        r = requests.get(
            "https://api.dataforseo.com/v3/appendix/user_data",
            headers={"Authorization": f"Basic {auth}"},
            timeout=10,
        )
        from app.service_health import inspect_response, record, state
        data = inspect_response('dataforseo', f'{login}:{password}', r, mark_success=False)
        result = ((data.get("tasks") or [{}])[0].get("result") or [{}])[0] or {}
        money = result.get("money") or {}
        if money.get('balance') is None:
            return {'configured': True, 'ok': False, 'error': 'No se pudo obtener el saldo de DataForSEO.'}
        if float(money['balance']) <= 0:
            record('dataforseo', f'{login}:{password}', 'billing')
        elif clear_block or state('dataforseo', f'{login}:{password}').get('status') != 'blocked':
            # A positive balance does not prove an endpoint's daily cost limit was raised.
            record('dataforseo', f'{login}:{password}')
        from app.balance_alerts import record_balance
        value = {"configured": True, "ok": True, "balance": money.get("balance"), "currency": "usd"}
        record_balance('dataforseo', value)
        return value
    except Exception as e:
        return {"configured": True, "ok": False, "error": str(e)}
