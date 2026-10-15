"""Pytest root conftest — mirrors the sys.path setup app/main.py does at runtime
(sys.path.insert(0, backEnd/app)) so modules like database.py that do bare
`from config import ...` (instead of `from app.config import ...`) resolve the
same way under pytest as they do under uvicorn."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "llm_eval: makes real calls to the configured LLM provider (costs tokens); "
        "skipped unless run with --run-llm-eval",
    )


def pytest_addoption(parser):
    parser.addoption(
        "--run-llm-eval",
        action="store_true",
        default=False,
        help=(
            "Also run the classifier LLM accuracy evaluation (tests/test_classifier_llm_eval.py). "
            "Skipped by default because it makes real calls to the configured LLM provider "
            "(OPENAI_API_KEY / DEEPSEEK_API_KEY) and spends real tokens."
        ),
    )


def pytest_collection_modifyitems(config, items):
    if config.getoption("--run-llm-eval"):
        return
    import pytest
    skip_llm = pytest.mark.skip(reason="needs --run-llm-eval (calls the real LLM, costs tokens)")
    for item in items:
        if "llm_eval" in item.keywords:
            item.add_marker(skip_llm)


@pytest.fixture(autouse=True)
def no_live_anthropic_key_in_unit_tests(monkeypatch, request):
    """La clave local de la prueba real nunca debe utilizarse en unit tests."""
    if 'llm_eval' in request.keywords:
        return
    from app import llm
    monkeypatch.setenv('LLM_PROVIDER', 'auto')
    monkeypatch.setattr(llm, 'ANTHROPIC_API_KEY', '')
    monkeypatch.setenv('ANTHROPIC_API_KEY', '')


@pytest.fixture(autouse=True)
def deterministic_activity_clock(monkeypatch):
    """Sending tests must not depend on the wall-clock time of the CI runner."""
    from datetime import datetime, timezone
    from app import activity_hours

    class Daytime(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 10, 15, 18, tzinfo=timezone.utc)
            return value.astimezone(tz) if tz else value.replace(tzinfo=None)

    monkeypatch.setattr(activity_hours, 'datetime', Daytime)
