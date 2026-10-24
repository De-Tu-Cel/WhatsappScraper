"""CRM sync configuration, read from the environment on every call."""
import os


def ingest_url() -> str:
    return os.environ.get("CRM_INGEST_URL", "").strip().rstrip("/")


def api_key() -> str:
    return os.environ.get("CRM_API_KEY", "").strip()


def enabled() -> bool:
    return bool(ingest_url() and api_key())
