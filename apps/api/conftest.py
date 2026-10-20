"""Pytest root conftest — mirrors the sys.path setup app/main.py does at runtime
(sys.path.insert(0, backEnd/app)) so modules like database.py that do bare
`from config import ...` (instead of `from app.config import ...`) resolve the
same way under pytest as they do under uvicorn."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))


# ── Ningún test puede tocar la Mongo real ────────────────────────────────────
# apps/api/.env apunta MONGODB_URI al túnel de PRODUCCIÓN (la única Mongo que
# existe) y config.py lo carga con override=True. WebsiteScraper() sin `db`
# abre su propia conexión, y test_scraper / test_location / test_maps_leads
# llamaban scrape_site() → leían y escribían companies/contacts de producción
# cada vez que alguien corría pytest con el túnel arriba (descubierto
# 2026-10-19). Esto corre antes de importar cualquier módulo de app/, así que
# todo `MongoClient(...)` recibe una base en memoria (mongomock) que se tira al
# terminar. Única excepción: la Mongo de pruebas dedicada de
# tests/test_mongo_send_integration.py (127.0.0.1:27029, opt-in).
import pymongo
import pymongo.mongo_client

_REAL_MONGO_CLIENT = pymongo.MongoClient
_DEDICATED_TEST_MONGO = ("127.0.0.1:27029", "localhost:27029")


def _test_mongo_client(host=None, *args, **kwargs):
    if isinstance(host, str) and any(target in host for target in _DEDICATED_TEST_MONGO):
        return _REAL_MONGO_CLIENT(host, *args, **kwargs)
    try:
        import mongomock
        import mongomock.gridfs
    except ImportError as exc:  # sin mongomock: bloquear, nunca caer en la real
        raise RuntimeError(
            "Los tests no pueden abrir una conexión real a Mongo (la única es producción). "
            "Instala las dependencias de pruebas: pip install -r requirements-dev.txt"
        ) from exc
    mongomock.gridfs.enable_gridfs_integration()
    return mongomock.MongoClient(tz_aware=kwargs.get("tz_aware", False))


pymongo.MongoClient = _test_mongo_client
pymongo.mongo_client.MongoClient = _test_mongo_client


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


def pytest_sessionfinish(session, exitstatus):
    """En PGMIRROR_SUITE_MODE: cuánto tráfico pasó por la capa y si hubo errores de copia."""
    if not _PGMIRROR_SUITE_MODE:
        return
    from app.pgmirror import routing
    rt = routing._runtime
    if rt is None:
        print("\n[pgmirror] la capa nunca se activó en esta corrida")
        return
    rt.worker.flush(60)
    print(f"\n[pgmirror] modo={_PGMIRROR_SUITE_MODE} copia={dict(rt.worker.stats)} "
          f"por_conciliar={sorted(rt.worker.dirty)} lecturas={rt.stats}")


def pytest_collection_modifyitems(config, items):
    import pytest
    if _PGMIRROR_SUITE_MODE:
        # Esas pruebas manejan sus propios modos; en la corrida "toda la suite en modo X" estorban.
        skip_own = pytest.mark.skip(reason="PGMIRROR_SUITE_MODE: se prueban por separado")
        for item in items:
            if item.nodeid.startswith("tests/test_pgmirror.py"):
                item.add_marker(skip_own)
    if config.getoption("--run-llm-eval"):
        return
    skip_llm = pytest.mark.skip(reason="needs --run-llm-eval (calls the real LLM, costs tokens)")
    for item in items:
        if "llm_eval" in item.keywords:
            item.add_marker(skip_llm)


# PGMIRROR_SUITE_MODE=dual|shadow|postgres corre TODA la suite con la capa de
# migración activa para todas las colecciones, contra el Postgres desechable de
# TEST_POSTGRES_URL. OJO: casi toda la suite simula la base con MagicMock, así
# que esto solo prueba que activar la capa no rompe importaciones ni cableado
# (el reporte final dice cuánto tráfico pasó por ella). La prueba fuerte de que
# la capa es invisible para la app es tests/test_pgmirror_contract.py.
_PGMIRROR_SUITE_MODE = os.environ.get("PGMIRROR_SUITE_MODE", "").strip().lower()


@pytest.fixture(autouse=True)
def no_real_postgres_in_tests(monkeypatch):
    """Igual que con Mongo: si algún día apps/api/.env trae POSTGRES_URL o modos de
    migración, ningún test los hereda. tests/test_pgmirror.py pone su propio
    Postgres desechable (TEST_POSTGRES_URL) dentro de cada prueba."""
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    for key in [k for k in os.environ if k.startswith(("DB_MODE_", "PGMIRROR_WAIT", "PGMIRROR_RECONCILE")) or k == "DB_MODES"]:
        monkeypatch.delenv(key, raising=False)
    if _PGMIRROR_SUITE_MODE:
        url = os.environ.get("TEST_POSTGRES_URL")
        if not url:
            raise RuntimeError("PGMIRROR_SUITE_MODE necesita TEST_POSTGRES_URL (un Postgres desechable)")
        monkeypatch.setenv("POSTGRES_URL", url)
        from app.pgmirror import config as pg_config
        monkeypatch.setattr(pg_config, "collection_mode", lambda _name: _PGMIRROR_SUITE_MODE)


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
