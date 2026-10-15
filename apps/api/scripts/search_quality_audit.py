"""Read-only audit of saved prospect searches; no providers or WhatsApp lookups.

Usage: python apps/api/scripts/search_quality_audit.py --limit 1000 --output report.json
Durations cover processing jobs, not the discovery/search-provider phase.
Detected WhatsApp numbers are not necessarily verified registrations.
"""
import argparse
import json
import math
import statistics
import sys
from collections import Counter
from pathlib import Path


def summarize_jobs(jobs):
    rows = [row for job in jobs for row in job.get("results", [])]
    saved = [row for row in rows if row.get("ok") and row.get("company_id")]
    has_wa = lambda row: bool(row.get("whatsapp") or row.get("all_whatsapp"))
    durations = sorted(
        (job["finished_at"] - job["started_at"]).total_seconds()
        for job in jobs if job.get("status") == "done" and job.get("started_at") and job.get("finished_at")
    )
    invalid_durations = sum(value < 0 for value in durations)
    durations = [value for value in durations if value >= 0]

    def source_report(items):
        return {"processed": len(items), "saved": sum(bool(r.get("ok") and r.get("company_id")) for r in items),
                "with_whatsapp_detected": sum(has_wa(r) for r in items)}

    return {
        "jobs": len(jobs), "job_statuses": dict(Counter(j.get("status") for j in jobs)),
        "processed_results": len(rows), "saved_results": len(saved),
        "unique_saved_companies": len({row["company_id"] for row in saved}),
        "saved_with_whatsapp_detected": sum(has_wa(row) for row in saved),
        "saved_without_whatsapp_detected": sum(not has_wa(row) for row in saved),
        "failed_results": sum(not bool(row.get("ok")) for row in rows),
        "duplicates": sum(bool(row.get("duplicate")) for row in rows),
        "blacklisted": sum(bool(row.get("blacklisted")) for row in rows),
        "location_mismatches": sum(bool(row.get("location_mismatch")) for row in rows),
        "industry_mismatches": sum(bool(row.get("industry_mismatch")) for row in rows),
        "processing_seconds": {
            "samples": len(durations), "invalid_samples": invalid_durations,
            "median": statistics.median(durations) if durations else None,
            "p90": durations[math.ceil(len(durations) * 0.9) - 1] if durations else None,
            "maximum": max(durations) if durations else None,
        },
        "by_source": {label: source_report([r for r in rows if ("google.com/maps?cid=" in r.get("url", "")) == maps])
                      for label, maps in [("maps_without_website", True), ("websites", False)]},
        "limitations": ["Processing duration excludes discovery and provider latency.",
                        "Detected WhatsApp is not proof of an active WhatsApp registration.",
                        "Saved results can repeat a company; use unique_saved_companies for deduplication.",
                        "Jobs only cover results selected for processing, not every search candidate."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.limit <= 10000:
        parser.error("--limit must be between 1 and 10000")
    api = Path(__file__).resolve().parents[1]
    sys.path[:0] = [str(api / "app"), str(api)]
    from config import MONGODB_URI, DATABASE_NAME
    from pymongo import MongoClient
    # No MongoDBManager initializer: it creates indexes and can change the DB.
    with MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10000) as client:
        db = client[DATABASE_NAME]
        jobs = list(db.scrape_jobs.find({"surface": "search"}, {
            "_id": 0, "status": 1, "started_at": 1, "finished_at": 1, "results": 1,
        }).sort("created_at", -1).limit(args.limit))
        report = summarize_jobs(jobs)
        report["ideas_by_status"] = {str(row["_id"]): row["count"] for row in db.search_ideas.aggregate([
            {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        ])}
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
