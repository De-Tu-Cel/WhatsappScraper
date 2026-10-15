from datetime import datetime, timedelta
import importlib.util
from pathlib import Path


def test_audit_separates_unique_companies_detected_numbers_and_failed_results():
    spec = importlib.util.spec_from_file_location("search_quality_audit", Path(__file__).parents[1] / "scripts" / "search_quality_audit.py")
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    start = datetime(2026, 10, 9)
    report = audit.summarize_jobs([{
        "status": "done", "started_at": start, "finished_at": start + timedelta(seconds=60),
        "results": [{"ok": True, "company_id": "same", "url": "https://business.example", "all_whatsapp": ["+525512340000"]},
                    {"ok": True, "company_id": "same", "url": "https://www.google.com/maps?cid=1", "location_mismatch": True},
                    {"ok": False, "company_id": "", "url": "https://broken.example", "errorReason": "No response"}],
    }])
    assert report["processed_results"] == 3
    assert report["saved_results"] == 2
    assert report["unique_saved_companies"] == 1
    assert report["saved_with_whatsapp_detected"] == 1
    assert report["saved_without_whatsapp_detected"] == 1
    assert report["failed_results"] == 1
    assert report["location_mismatches"] == 1
    assert report["processing_seconds"]["median"] == 60
    assert report["by_source"]["maps_without_website"]["saved"] == 1
