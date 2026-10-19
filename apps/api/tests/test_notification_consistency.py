from datetime import datetime, timezone, timedelta
from unittest.mock import Mock

import pytest
from bson import ObjectId
from app.api import routes


@pytest.fixture
def manager(monkeypatch):
    db = Mock()
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: db)
    monkeypatch.setattr(routes, '_require_user', lambda token: {'id': 'qa-user', 'role': 'agent'})
    now = datetime.now(timezone.utc)
    prospect, personal = ObjectId(), ObjectId()
    db.db.companies.find.return_value = [
        {'_id': prospect, 'name': 'Prospect'},
        {'_id': personal, 'source': 'inbound_whatsapp', 'domain': 'phone.local'},
    ]
    db.db.message_logs.find.return_value = [
        {'_id': ObjectId(), 'company_id': str(personal), 'created_at': now, 'message_body': 'personal'},
        {'_id': ObjectId(), 'company_id': str(prospect), 'created_at': now - timedelta(minutes=2), 'message_body': 'reply'},
    ]
    db.db.app_notifications.find.return_value = []
    return db


def test_badge_uses_the_same_personal_contact_exclusion_as_panel(manager):
    items = routes.api_notifications_list('qa')
    assert len(items) == 1
    assert items[0]['company_name'] == 'Prospect'
    assert routes.api_notifications_count('qa')['count'] == len(items)
    manager.db.message_logs.count_documents.assert_not_called()


def test_offset_and_utc_read_marks_filter_exactly_the_visible_items(manager):
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert routes.api_notifications_count('qa', since.isoformat())['count'] == 0
    assert routes.api_notifications_count('qa', since.astimezone(timezone(timedelta(hours=-6))).isoformat())['count'] == 0
    assert routes.api_notifications_count('qa', 'bad-date')['count'] == 1


def test_badge_applies_panel_limit_and_personal_event_scope(manager):
    now = datetime.now(timezone.utc)
    manager.db.message_logs.find.return_value = []
    manager.db.app_notifications.find.return_value = [
        {'_id': ObjectId(), 'created_at': now, 'type': 'batch_complete'} for _ in range(55)
    ]
    assert len(routes.api_notifications_list('qa')) == 50
    assert routes.api_notifications_count('qa')['count'] == 50
    assert manager.db.app_notifications.find.call_args.args[0]['user_id'] == 'qa-user'
