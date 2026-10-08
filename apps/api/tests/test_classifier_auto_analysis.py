"""Regresión del autoanálisis de conversaciones con respuesta (2026-10-08)."""
from datetime import datetime
from unittest.mock import MagicMock, patch

from pymongo.errors import DuplicateKeyError

from app import classifier
from app.database import MongoDBManager


class _ImmediateThread:
    def __init__(self, target, **_kwargs):
        self.target = target

    def start(self):
        self.target()


def test_queue_runs_the_four_analysis_path_once():
    db = MagicMock()
    last = {"_id": "507f1f77bcf86cd799439011", "created_at": datetime(2026, 10, 8, 15, 0)}
    with patch("app.llm.active_provider", return_value="openai"), \
         patch.object(classifier, "MongoDBManager", return_value=db), \
         patch.object(classifier, "_reply_analysis_gap_for_company",
                      side_effect=[("missing", last), ("missing", last)]), \
         patch.object(classifier, "_claim_reply_analysis", return_value="lease"), \
         patch.object(classifier, "classify_conversation_and_save") as run_four, \
         patch.object(classifier.threading, "Thread", _ImmediateThread):
        classifier.queue_reply_analysis("507f1f77bcf86cd799439012")

    run_four.assert_called_once_with(
        "507f1f77bcf86cd799439012",
        "507f1f77bcf86cd799439011",
    )
    # El lease se libera solo por quien lo adquirió.
    claims = db.db.__getitem__.return_value
    claims.delete_one.assert_called_once_with({
        "_id": "507f1f77bcf86cd799439012",
        "holder": "lease",
    })


def test_queue_does_nothing_when_the_four_results_are_current():
    db = MagicMock()
    with patch("app.llm.active_provider", return_value="openai"), \
         patch.object(classifier, "MongoDBManager", return_value=db), \
         patch.object(classifier, "_reply_analysis_gap_for_company", return_value=(None, None)), \
         patch.object(classifier, "classify_conversation_and_save") as run_four, \
         patch.object(classifier.threading, "Thread", _ImmediateThread):
        classifier.queue_reply_analysis("507f1f77bcf86cd799439012")

    run_four.assert_not_called()


def test_second_backend_process_cannot_take_an_active_company_lease():
    db = MagicMock()
    claims = db.db.__getitem__.return_value
    claims.find_one_and_update.side_effect = DuplicateKeyError("active lease")
    assert classifier._claim_reply_analysis(db, "507f1f77bcf86cd799439012") is None


def test_save_message_analysis_writes_the_timestamp_used_by_the_throttle():
    mgr = MongoDBManager.__new__(MongoDBManager)
    mgr.db = MagicMock()
    before = datetime.utcnow()
    mgr.save_message_analysis(
        "507f1f77bcf86cd799439011",
        {"category": "humano"},
    )
    saved = mgr.db.message_logs.update_one.call_args.args[1]["$set"]
    assert saved["analysis_status"] == "done"
    assert saved["analysis"]["category"] == "humano"
    assert saved["updated_at"] >= before


def test_recent_full_analysis_is_copied_instead_of_paying_the_llm_again():
    db = MagicMock()
    db.db.message_logs.find_one.side_effect = [
        {"analysis": {"category": "humano", "notes": "persona"}},
        {"analysis": {}},
    ]
    background = MagicMock()

    classifier.classify_or_copy_recent(
        db,
        background,
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439012",
        "otra respuesta",
        datetime.utcnow(),
    )

    background.add_task.assert_not_called()
    copied = db.save_message_analysis.call_args.args[1]
    assert copied["category"] == "humano"
    assert copied["copied_from_throttle"] is True

