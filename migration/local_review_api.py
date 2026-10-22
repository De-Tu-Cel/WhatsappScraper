"""Isolated UI API. Run: python migration/local_review_api.py.

Uses dedicated local databases; never loads the repository's production .env.
No application lifespan: no sender, scheduler, classifier or session workers.
"""
import os
import secrets
import sys
from pathlib import Path


def configure_environment():
    # Start from an allowlist, so inherited provider keys and DB_MODE_* cannot
    # reconnect this process to production, including through a local tunnel.
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT",
               "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA"}
    inherited = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    os.environ.clear()
    os.environ.update(inherited)
    os.environ.update({
        "PYTHON_DOTENV_DISABLED": "1",
        "MONGODB_URI": "mongodb://127.0.0.1:27030/?directConnection=true",
        "DATABASE_NAME": "ui_review",
        "POSTGRES_URL": "postgresql://app:app_local_only@127.0.0.1:55432/ui_review",
        "PGMIRROR_AGGREGATE": "postgres",
        "PGMIRROR_POSTGRES_ONLY": "1",
        "APP_PUBLIC_URL": "http://localhost:3000",
        "WWEBJS_URL": "http://127.0.0.1:9",
        "EVOLUTION_API_URL": "http://127.0.0.1:9",
        "WAHA_API_URL": "http://127.0.0.1:9",
        "WASENDER_BASE_URL": "http://127.0.0.1:9",
    })
    collections = """settings message_templates warmup_config ai_global_config
        app_notifications security_counters social_media person_contacts blacklist
        instance_health_logs phone_verification_attempts phone_verification_control
        search_ideas classification_comparisons classification_logs
        qa_classification_comparisons qa_classification_logs classification_analysis_claims
        qa_classification_compare_job service_health instance_daily_verifications
        evaluaciones archivos proxies instances jid_map companies contacts contact_permissions
        users message_logs scheduled_sends send_queue_items send_queue_state send_queue_batches
        send_queue_requests scrape_jobs ai_followup_sessions conversation_ai_prefs ai_reply_pending
        instance_daily_sends instance_new_contacts_today send_worker_lease warmup_worker_lease
        warmup_sessions delivery_receipts stickers evidence""".split()
    os.environ["DB_MODES"] = ",".join(f"{name}=primary" for name in collections)


def build_app():
    configure_environment()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    api = Path(__file__).resolve().parents[1] / "apps" / "api"
    sys.path[:0] = [str(api), str(api / "app")]
    import psycopg
    with psycopg.connect("postgresql://app:app_local_only@127.0.0.1:55432/postgres", autocommit=True) as conn:
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname='ui_review'").fetchone():
            conn.execute('CREATE DATABASE ui_review')

    from app.database import MongoDBManager
    from app.auth import create_user, hash_pin
    db = MongoDBManager().db
    # New per-launch PINs; no fixed credentials or auth bypass, normal login.
    for username, role in (("local-admin", "admin"), ("local-alice", "agent"), ("local-bob", "agent")):
        pin = str(secrets.randbelow(900000) + 100000)
        if db.users.find_one({"username": username}):
            db.users.update_one({"username": username}, {"$set": {
                "pin_hash": hash_pin(pin), "session_token": None, "failed_login_attempts": 0,
                "locked_until": None}})
        else:
            create_user(username, username, pin, role=role)
        print(f"LOCAL ONLY login: {username} PIN {pin}", flush=True)

    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from app.api.routes import router
    app = FastAPI(title="Isolated local review API (no messaging workers)")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"],
                       allow_methods=["*"], allow_headers=["*"])
    app.include_router(router, prefix="/api")
    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(build_app(), host="127.0.0.1", port=8000)
