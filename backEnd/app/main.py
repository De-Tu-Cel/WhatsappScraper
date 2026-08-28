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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup cleanup: fix sessions left in bad state from previous crashes
    try:
        from app.database import MongoDBManager
        from datetime import datetime as _dt, timezone
        import logging as _log
        _logger = _log.getLogger(__name__)
        db = MongoDBManager()

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
    start_warmup_worker()
    yield


app = FastAPI(title="Lector Comercial API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")