import sys, os
sys.path.insert(0, os.path.dirname(__file__))  # ← añade backEnd/app/ al path

# En Windows, stdout/stderr por default usan el codepage legacy de la consola
# (cp1252/"charmap"), no UTF-8 — cualquier print() con acentos, emojis o
# flechas (→) tumba la request con UnicodeEncodeError. Esto rompía sends
# reales (whatsapp_wwebjs.py logueaba "composing →" antes de mandar el
# mensaje) de forma silenciosa: el error solo se veía como un 500 genérico,
# nunca como lo que realmente era.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.classifier import start_classifier_background
from app.scheduler import start_scheduler
from app.scrape_jobs import start_scrape_worker
from app.send_now_worker import start_send_now_worker
from app.warmup_queue import start_warmup_worker
from app.followup_queue import start_followup_workers


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup cleanup: fix sessions left in bad state from previous crashes
    try:
        from app.database import MongoDBManager
        from datetime import datetime as _dt, timezone
        import logging as _log
        _logger = _log.getLogger(__name__)
        db = MongoDBManager()
        from app.service_health import configure_store
        configure_store(db.db.service_health)

        # 1. Reset any stuck ai_typing flags
        r1 = db.db.ai_followup_sessions.update_many(
            {"ai_typing": True},
            {"$set": {"ai_typing": False}},
        )
        if r1.modified_count:
            _logger.info("[Startup] reset %d stuck ai_typing sessions", r1.modified_count)

        # 2. Close active/waiting sessions for companies where user explicitly disabled AI
        disabled_cids = [
            p["company_id"]
            for p in db.db.conversation_ai_prefs.find(
                {"ai_enabled": False}, {"company_id": 1}
            )
        ]
        if disabled_cids:
            r2 = db.db.ai_followup_sessions.update_many(
                {"company_id": {"$in": disabled_cids},
                 "status": {"$in": ["active", "waiting"]}},
                {"$set": {"status": "ended", "end_reason": "user_disabled",
                          "ai_typing": False, "last_activity": _dt.now(timezone.utc)}},
            )
            if r2.modified_count:
                _logger.info("[Startup] closed %d orphan sessions for disabled companies", r2.modified_count)
    except Exception:
        pass

    # 3. Auto-start wwebjs sessions registered in MongoDB
    try:
        import requests as _req
        from app.config import WWEBJS_URL as _ww_url
        _ww_insts = list(db.db.instances.find({"provider": "wwebjs"}, {"name": 1}))
        for _inst in _ww_insts:
            _name = _inst.get("name", "")
            if not _name:
                continue
            try:
                _st = _req.get(f"{_ww_url}/session/{_name}/status", timeout=2).json()
                if _st.get("status") == "not_found":
                    _req.post(f"{_ww_url}/session/{_name}/start", timeout=10)
                    _logger.info("[Startup] wwebjs session started: %s", _name)
                else:
                    _logger.info("[Startup] wwebjs session already running: %s (%s)", _name, _st.get("status"))
            except Exception as _e:
                _logger.warning("[Startup] wwebjs session %s failed to start: %s", _name, _e)
    except Exception:
        pass

    start_classifier_background()
    start_scheduler()
    start_scrape_worker()
    start_send_now_worker()
    start_followup_workers()
    # Migración a Postgres: con colecciones activas en DB_MODES, arranca la vigilancia y la
    # conciliación automática (app/pgmirror/health.py). Sin POSTGRES_URL no hace nada.
    try:
        from app.pgmirror import config as _pg_config
        if _pg_config.enabled():
            from app.database import MongoDBManager as _PgDB
            from app.pgmirror import routing as _pg_routing
            _pg_routing.start(_PgDB().raw_db)
    except Exception:
        import logging as _pg_log
        _pg_log.getLogger(__name__).exception("pgmirror start failed")
    if os.getenv("WARMUP_ENABLED", "false").lower() == "true":
        start_warmup_worker()
    # Proxies por número: re-sincroniza los ajustes con wwebjs (se despliegan juntos) y
    # revisa cada 30 min que respondan (ver app/proxies.py).
    from app import proxies as _proxies
    from app.api.routes import SESSION_DISCONNECT_ALERT_EMAILS
    from app.database import MongoDBManager as _ProxyDB
    _proxies.start_sync_on_boot(_ProxyDB)
    _proxies.start_health_worker(_ProxyDB, SESSION_DISCONNECT_ALERT_EMAILS)
    from app.service_health import start_balance_monitor
    _balance_stop = start_balance_monitor()
    from app.phone_verification import start_phone_verification_worker
    _phone_verification_stop = start_phone_verification_worker()
    try:
        yield
    finally:
        _balance_stop.set()
        _phone_verification_stop.set()


app = FastAPI(title="Lector Comercial API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

from app.api.evaluaciones import router as evaluaciones_router  # noqa: E402

app.include_router(evaluaciones_router, prefix="/api")
