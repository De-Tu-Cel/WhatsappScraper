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
_STALE_AFTER_SEC    = 600  # A single slow URL (JS/SPA with 25 route probes) can take
                          # 3-5 min. 10-min threshold avoids false-stale reclaims that
                          # spawn a duplicate worker and cause double-scraping.
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

    # Heartbeat thread: keeps last_progress_at fresh even when a single slow URL
    # (e.g. a JS/SPA with 25 route probes) stalls the as_completed loop for minutes.
    # Without this, _sweep_stale_jobs would see a stale timestamp and spawn a second
    # worker for the same job, causing duplicate scraping and progress-bar oscillation.
    _hb_stop = threading.Event()
    def _heartbeat():
        while not _hb_stop.is_set():
            try:
                db.db.scrape_jobs.update_one(
                    {"_id": oid, "status": "running"},
                    {"$set": {"last_progress_at": datetime.now()}},
                )
            except Exception:
                pass
            _hb_stop.wait(timeout=30)
    _hb_thread = threading.Thread(target=_heartbeat, daemon=True, name=f"scrape-hb-{job_id}")
    _hb_thread.start()

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

            # Pause breaks immediately after the first URL that completes post-pause.
            # Remaining futures run to completion in the background but results are
            # discarded; next_index advances only by len(chunk_results), so those
            # 1-3 URLs are re-scraped on resume (idempotent — upsert). This keeps
            # the progress bar/counter truly frozen at the pause point.
            in_flight = list(chunk)
            chunk_results = []
            ex = ThreadPoolExecutor(max_workers=len(chunk))
            try:
                future_map = {ex.submit(_process_one_url, url): url for url in chunk}
                for future in as_completed(future_map):
                    url = future_map[future]
                    result = future.result()
                    chunk_results.append(result)
                    in_flight = [u for u in in_flight if u != url]
                    db.db.scrape_jobs.update_one(
                        {"_id": oid},
                        {
                            "$push": {"results": result},  # visible en tabla inmediatamente
                            "$inc": {"processed_count": 1},
                            "$set": {"current_urls": in_flight, "last_progress_at": datetime.now()},
                        },
                    )
                    # Break on cancel OR pause. Remaining futures keep running in the
                    # background (ThreadPoolExecutor can't cancel submitted futures)
                    # but their results are discarded — next_index advances only by
                    # len(chunk_results), so those URLs are re-scraped on resume.
                    # Re-scraping is idempotent (upsert), so no data is lost.
                    _st = db.db.scrape_jobs.find_one({"_id": oid}, {"status": 1, "paused": 1})
                    if _st and _st.get("status") == "cancelled":
                        break
                    if _st and _st.get("paused"):
                        break
            finally:
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
            # Dedup by URL — $push during the chunk loop and re-processing on resume
            # can add the same URL twice. Keep the LAST occurrence (most up-to-date).
            seen_urls: dict = {}
            for r in results:
                seen_urls[r.get("url", "")] = r
            results = list(seen_urls.values())
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
    finally:
        _hb_stop.set()
        _hb_thread.join(timeout=2)


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


_PAUSED_ABANDON_SEC = 6 * 3600  # 6 h without any heartbeat on a paused job → treat as abandoned


def _sweep_stale_jobs():
    """Jobs stuck in 'running' with no progress in _STALE_AFTER_SEC are assumed to
    belong to a dead worker thread (backend crash/restart) and get reset to
    'pending' so the next tick re-claims and resumes them from next_index — safe
    because re-scraping a URL has no irreversible side effect.

    Also catches paused jobs that were never resumed — if the backend restarted
    while a job was paused the heartbeat stops, but paused=True keeps the stale
    sweep from reclaiming it into a duplicate worker. After _PAUSED_ABANDON_SEC
    of silence we treat them as abandoned: cancel them and stamp pending_urls_count
    so the user can resume explicitly via the 'reanudar' action."""
    from app.database import MongoDBManager

    try:
        db = MongoDBManager()
        cutoff_stale    = datetime.now() - timedelta(seconds=_STALE_AFTER_SEC)
        cutoff_abandoned = datetime.now() - timedelta(seconds=_PAUSED_ABANDON_SEC)

        # 1) Crashed non-paused workers → reset to pending
        result = db.db.scrape_jobs.update_many(
            {"status": "running", "paused": {"$ne": True}, "last_progress_at": {"$lt": cutoff_stale}},
            {"$set": {"status": "pending"}, "$inc": {"recovered_count": 1}},
        )
        if result.modified_count:
            log.warning("[ScrapeJobs] recovered %d stale job(s)", result.modified_count)

        # 2) Paused jobs with no heartbeat for _PAUSED_ABANDON_SEC → cancel + mark pending
        abandoned = list(db.db.scrape_jobs.find(
            {"status": "running", "paused": True, "last_progress_at": {"$lt": cutoff_abandoned}},
        ))
        for job in abandoned:
            db.db.scrape_jobs.update_one(
                {"_id": job["_id"]},
                {"$set": {"status": "cancelled", "finished_at": datetime.now()}},
            )
            _mark_pending_urls(db, job)
            log.warning("[ScrapeJobs] abandoned paused job %s → cancelled with %d pending URLs",
                        str(job["_id"]), len((job.get("urls") or [])[job.get("next_index", 0):]))
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


def _mark_pending_urls(db, job: dict):
    """For a cancelled/abandoned job, record how many URLs were not yet processed.
    We only store the count — the full list is already in job['urls'][next_index:].
    Also stamps pending_urls_count on the job document so the frontend can display it."""
    oid = job["_id"]
    urls      = job.get("urls") or []
    next_idx  = job.get("next_index", 0)
    pending   = urls[next_idx:]
    if not pending:
        return
    db.db.scrape_jobs.update_one(
        {"_id": oid},
        {"$set": {"pending_urls_count": len(pending)}},
    )


def set_job_action(db, job_id: str, action: str) -> dict:
    from bson import ObjectId
    oid = ObjectId(job_id)
    if action == "pause":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"paused": True}})
    elif action == "resume":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"paused": False, "last_progress_at": datetime.now()}})
    elif action == "cancel":
        db.db.scrape_jobs.update_one({"_id": oid}, {"$set": {"status": "cancelled", "finished_at": datetime.now()}})
        # Re-fetch AFTER cancelling to get the latest next_index — the worker may
        # have advanced it between our fetch and the status write.
        job = db.db.scrape_jobs.find_one({"_id": oid})
        if job:
            _mark_pending_urls(db, job)
    elif action == "reanudar":
        # Resume a cancelled or paused-and-abandoned job from where it left off.
        # The worker picks it up on the next _claim_and_dispatch tick.
        result = db.db.scrape_jobs.update_one(
            {"_id": oid, "status": {"$in": ["cancelled", "error"]}},
            {"$set": {
                "status": "pending",
                "paused": False,
                "finished_at": None,
                "pending_urls_count": 0,
                "last_progress_at": datetime.now(),
            }},
        )
        if result.modified_count:
            _claim_and_dispatch()
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
