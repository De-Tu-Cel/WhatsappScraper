import sys, os
sys.path.insert(0, os.path.dirname(__file__))  # ← añade backEnd/app/ al path

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.classifier import start_classifier_background
from app.scheduler import start_scheduler


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

    start_classifier_background()
    start_scheduler()
    yield


app = FastAPI(title="Lector Comercial API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")