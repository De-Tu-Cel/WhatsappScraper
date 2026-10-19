from datetime import datetime, timezone, timedelta
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.activity_notices import automation_notifications
from app.api import routes


def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def test_single_notice_for_the_same_rest_window_and_read_cutoff():
    evening = utc('2026-10-16T01:00:00')
    first = automation_notifications(now=evening)[0]
    later = automation_notifications(now=evening + timedelta(hours=6))[0]
    assert first['_id'] == later['_id']
    assert first['resumes_at'] == '2026-10-16T14:00:00+00:00'
    assert automation_notifications(since=evening, now=evening + timedelta(hours=6)) == []
    assert automation_notifications(since=evening.replace(tzinfo=None), now=evening) == []


@pytest.mark.parametrize('hour', [14, 18, 23, 0])
def test_no_rest_notice_during_working_hours(hour):
    assert automation_notifications(now=utc(f'2026-10-16T{hour:02d}:00:00')) == []


def test_next_night_has_a_new_identifier():
    first = automation_notifications(now=utc('2026-10-16T01:00:00'))[0]
    next_night = automation_notifications(now=utc('2026-10-17T01:00:00'))[0]
    assert next_night['_id'] != first['_id']


@pytest.mark.parametrize('role,count', [('admin', 1), ('agent', 0)])
def test_list_and_badge_expose_rest_notice_only_to_admins(monkeypatch, role, count):
    monkeypatch.setattr(routes, '_require_user', lambda token: {'id': 'qa', 'role': token})
    db = Mock()
    for collection in ('message_logs', 'companies', 'app_notifications'):
        getattr(db.db, collection).find.return_value = []
        getattr(db.db, collection).count_documents.return_value = 0
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: db)
    monkeypatch.setattr('app.service_health.admin_notifications', lambda *args: [])
    notice = automation_notifications(now=utc('2026-10-16T01:00:00'))
    monkeypatch.setattr('app.activity_notices.automation_notifications', lambda *args: notice)
    app = FastAPI()
    app.include_router(routes.router, prefix='/api')
    client = TestClient(app)
    headers = {'x-user-token': role}
    assert len(client.get('/api/notifications', headers=headers).json()) == count
    assert client.get('/api/notifications/count', headers=headers).json()['count'] == count
