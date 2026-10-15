"""Failed attempts belong in the chat history, but not in response classification."""
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace

from app.database import MongoDBManager
from app.classification_compare import _messages


class Cursor(list):
    def sort(self, field, order):
        return Cursor(sorted(self, key=lambda row: row[field], reverse=order < 0))


class Collection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, query, projection=None, sort=None):
        def matches(row):
            for key, value in query.items():
                if isinstance(value, dict):
                    if '$in' in value and row.get(key) not in value['$in']:
                        return False
                    if '$ne' in value and row.get(key) == value['$ne']:
                        return False
                elif row.get(key) != value:
                    return False
            return True
        return Cursor(deepcopy([r for r in self.rows if matches(r)]))


def test_failed_attempt_is_visible_with_its_reason_but_not_a_classifier_message():
    row = dict(_id='attempt', company_id='company', direction='outbound',
               message_body='Hola', to_number='+525512345678', status='failed',
               error='numero_no_valido_en_whatsapp', created_at=datetime(2026, 10, 9))
    manager = object.__new__(MongoDBManager)
    manager.db = SimpleNamespace(message_logs=Collection([row]))
    history = manager.get_conversation_thread('company', include_failed=True)
    assert len(history) == 1
    assert history[0]['body'] == 'Hola'
    assert history[0]['status'] == 'failed'
    assert history[0]['error'] == 'numero_no_valido_en_whatsapp'
    assert manager.get_conversation_thread('company') == []  # Reports keep failed sends out.
    assert _messages(manager, 'company') == []
