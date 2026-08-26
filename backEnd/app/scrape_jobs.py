# scrape_jobs.py
"""Background worker for bulk URL scraping (Buscar Prospectos, Lote de URLs,
Importar CSV) — same reclaim/poll pattern as scheduler.py's scheduled_sends,
but for scrape jobs instead of sends. Moving this off the browser means a page
refresh no longer kills an in-progress batch: the real work runs here, and the
frontend just polls GET /api/scrape-jobs/{id} for live progress.

Unlike sending a WhatsApp message, re-scraping a URL has no irreversible side
effect — so unlike send_now_worker.py, a job stuck in "running" after a crash
is safe to auto-recover (see _sweep_stale_jobs) instead of needing a human to
look at it.
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

log = logging.getLogger(__name__)

_POLL_INTERVAL_SEC = 15   # scraping is interactive (user is watching a progress bar) —
                          # kept short; the real "feels instant" part is the direct
                          # dispatch nudge in create_scrape_job(), not this tick.
_STALE_AFTER_SEC    = 120  # no progress in 2min while "running" → assume the worker
                          # thread died and let another tick reclaim the job.
_CONCURRENCY        = 4    # matches the CONCURRENCY the frontend loops used to hardcode.


def _process_one_url(url: str) -> dict:
    """Mirrors the per-URL result shape the 3 frontend components (searchProspects,
    batchProcessor, csvImporter) used to build client-side from the /process-url
    response — a superset covering every field any of the 3 read."""
    from app.pipeline import process_url
    try:
        d = process_url(url, skip_send=True)
    except Exception as e:
        return {
            "url": url, "empresa": "—", "industria": "—", "whatsapp": "", "all_whatsapp": [],
            "company_id": "", "scraped_data": None, "status_wa": "—", "ok": False,
            "blacklisted": False, "blockReason": None, "duplicate": False, "errorReason": str(e),
        }
    if d.get("blacklisted"):
        return {
            "url": url, "empresa": "—", "industria": "—", "whatsapp": "", "all_whatsapp": [],
            "company_id": "", "scraped_data": None, "status_wa": "—", "ok": False,
            "blacklisted": True, "blockReason": d.get("matched"), "duplicate": False, "errorReason": None,
        }
    scraped = d.get("scraped") or {}
    primary = d.get("primary_whatsapp_number") or ""
    return {
        "url": url,
        "empresa": scraped.get("name") or "—",
        "industria": scraped.get("industry") or "—",
        "whatsapp": primary,
        "all_whatsapp": d.get("all_whatsapp_numbers") or ([primary] if primary else []),
        "company_id": d.get("company_id") or "",
        "scraped_data": scraped,
        "status_wa": (d.get("send_result") or {}).get("status_code") or "—",
        "ok": True,
        "blacklisted": False,
        "blockReason": None,
        "duplicate": False,
        "errorReason": None,
    }


def _run_scrape_job(job_id: str):
    from bson import ObjectId
    from app.database import MongoDBManager

    db = MongoDBManager()
    oid = ObjectId(job_id)

    try:
        job = db.db.scrape_jobs.find_one({"_id": oid})
        if not job:
            log.error("[ScrapeJobs] job %s not found", job_id)
            return

        urls        = job.get("urls") or []
        total       = len(urls)
        next_index  = job.get("next_index", 0)
        results     = list(job.get("results") or [])

        while next_index < total:
            current = db.db.scrape_jobs.find_one({"_id": oid}, {"status": 1, "paused": 1})
            if not current or current.get("status") == "cancelled":
                log.info("[ScrapeJobs] job %s cancelled/deleted at %d/%d", job_id, next_index, total)
                return
            if current.get("paused"):
                # Heartbeat while paused so the stale-job sweep doesn't mistake a
                # legitimately-paused-but-alive job for a crashed one and reclaim it
                # into a second, duplicate worker thread.
                db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"last_progress_at": datetime.now()}})
                time.sleep(1)
                continue

            chunk = urls[next_index:next_index + _CONCURRENCY]
            db.db.scrape_jobs.update_one(
                {"_id": oid},
                {"$set": {"current_urls": chunk, "last_progress_at": datetime.now()}},
            )

            # Process in parallel but update processed_count + current_urls as
            # each URL finishes (not only after all 4 complete), so the progress
            # bar advances one tick at a time instead of jumping by 4.
            in_flight = list(chunk)
            chunk_results = []
            # Don't use `with` so we can shutdown(wait=False) on early pause break.
            ex = ThreadPoolExecutor(max_workers=len(chunk))
            try:
                future_map = {ex.submit(_process_one_url, url): url for url in chunk}
                for future in as_completed(future_map):
                    url = future_map[future]
                    chunk_results.append(future.result())
                    in_flight = [u for u in in_flight if u != url]
                    db.db.scrape_jobs.update_one(
                        {"_id": oid},
                        {
                            "$inc": {"processed_count": 1},
                            "$set": {"current_urls": in_flight, "last_progress_at": datetime.now()},
                        },
                    )
                    # Check pause after EACH URL instead of after the full chunk —
                    # lets the user stop within one URL's latency instead of waiting
                    # for all _CONCURRENCY URLs to finish.
                    _st = db.db.scrape_jobs.find_one({"_id": oid}, {"paused": 1, "status": 1})
                    if _st and (_st.get("paused") or _st.get("status") == "cancelled"):
                        break
            finally:
                # Don't block waiting for the remaining in-flight futures — they
                # keep running in the background, but their results are discarded.
                ex.shutdown(wait=False)

            # Stamp already_contacted + assigned_instance for this chunk.
            company_ids = [r["company_id"] for r in chunk_results if r.get("company_id")]
            if company_ids:
                contact_map = db.check_contacted(company_ids)
                # Fetch assigned_instance so the frontend can check per-instance new-contact caps.
                try:
                    from bson import ObjectId
                    valid_oids = [ObjectId(cid) for cid in company_ids if len(cid) == 24]
                    inst_map = {
                        str(d["_id"]): d.get("assigned_instance")
                        for d in db.db.companies.find(
                            {"_id": {"$in": valid_oids}}, {"assigned_instance": 1}
                        )
                    }
                except Exception:
                    inst_map = {}
                for r in chunk_results:
                    cid = r.get("company_id")
                    if cid:
                        if contact_map.get(cid, {}).get("contacted"):
                            r["already_contacted"] = contact_map[cid]
                        ai = inst_map.get(cid)
                        if ai:
                            r["assigned_instance"] = ai

            results.extend(chunk_results)
            next_index += len(chunk_results)  # partial chunk if we broke early
            db.db.scrape_jobs.update_one(
                {"_id": oid},
                {"$set": {
                    "results": results,
                    "next_index": next_index,
                    "processed_count": min(len(results), total),
                    "current_urls": [],
                    "last_progress_at": datetime.now(),
                }},
            )

        db.db.scrape_jobs.update_one(
            {"_id": oid},
            {"$set": {"status": "done", "finished_at": datetime.now()}},
        )
        log.info("[ScrapeJobs] job %s done — %d/%d processed", job_id, len(results), total)

    except Exception:
        log.exception("[ScrapeJobs] job %s failed", job_id)
        try:
            db.db.scrape_jobs.update_one(
                {"_id": oid},
                {"$set": {"status": "error", "finished_at": datetime.now()}},
            )
        except Exception:
            pass


def _claim_and_dispatch():
    """Find pending scrape jobs and launch a worker thread per job — mirrors
    scheduler.py's _poll_and_dispatch. Jobs can run in parallel with each other
    (no anti-ban pacing concern here, unlike sending), same as scheduled_sends."""
    from app.database import MongoDBManager

    try:
        db = MongoDBManager()
        pending = list(db.db.scrape_jobs.find({"status": "pending"}, {"_id": 1}))
        for job in pending:
            job_id = str(job["_id"])
            result = db.db.scrape_jobs.update_one(
                {"_id": job["_id"], "status": "pending"},
                {"$set": {"status": "running", "started_at": datetime.now(), "last_progress_at": datetime.now()}},
            )
            if result.modified_count == 0:
                continue  # another tick/process already claimed it
            log.info("[ScrapeJobs] dispatching job %s", job_id)
            t = threading.Thread(target=_run_scrape_job, args=(job_id,), daemon=True, name=f"scrape-job-{job_id}")
            t.start()
    except Exception:
        log.exception("[ScrapeJobs] _claim_and_dispatch failed")


def _sweep_stale_jobs():
    """Jobs stuck in 'running' with no progress in _STALE_AFTER_SEC are assumed to
    belong to a dead worker thread (backend crash/restart) and get reset to
    'pending' so the next tick re-claims and resumes them from next_index — safe
    because re-scraping a URL has no irreversible side effect."""
    from app.database import MongoDBManager

    try:
        db = MongoDBManager()
        cutoff = datetime.now() - timedelta(seconds=_STALE_AFTER_SEC)
        result = db.db.scrape_jobs.update_many(
            {"status": "running", "last_progress_at": {"$lt": cutoff}},
            {"$set": {"status": "pending"}, "$inc": {"recovered_count": 1}},
        )
        if result.modified_count:
            log.warning("[ScrapeJobs] recovered %d stale job(s)", result.modified_count)
    except Exception:
        log.exception("[ScrapeJobs] _sweep_stale_jobs failed")


def create_scrape_job(db, surface: str, urls: list, user: dict) -> dict:
    """Insert a new pending job and dispatch it immediately (instead of waiting for
    the next poll tick) so it feels as instant as the old in-browser loop did."""
    now = datetime.now()
    doc = {
        "surface": surface,
        "created_by_username": (user or {}).get("username", ""),
        "created_by_name": (user or {}).get("display_name", ""),
        "created_at": now,
        "started_at": None,
        "finished_at": None,
        "status": "pending",
        "paused": False,
        "urls": urls,
        "next_index": 0,
        "total_count": len(urls),
        "processed_count": 0,
        "current_urls": [],
        "results": [],
        "last_progress_at": now,
        "recovered_count": 0,
    }
    result = db.db.scrape_jobs.insert_one(doc)
    doc["_id"] = result.inserted_id
    _claim_and_dispatch()
    return doc


def set_job_action(db, job_id: str, action: str) -> dict:
    from bson import ObjectId
    oid = ObjectId(job_id)
    if action == "pause":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"paused": True}})
    elif action == "resume":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"paused": False, "last_progress_at": datetime.now()}})
    elif action == "cancel":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"status": "cancelled", "finished_at": datetime.now()}})
    return db.db.scrape_jobs.find_one({"_id": oid})


def start_scrape_worker():
    """Launch the scrape-jobs polling loop as a daemon thread. Call once at startup."""
    def _loop():
        while True:
            _claim_and_dispatch()
            _sweep_stale_jobs()
            time.sleep(_POLL_INTERVAL_SEC)

    t = threading.Thread(target=_loop, daemon=True, name="scrape-jobs-poll")
    t.start()
    log.info("Scrape-jobs background poll started (every %ds)", _POLL_INTERVAL_SEC)
