"""A known schedule ID must never grant access to another user's campaign."""
from types import SimpleNamespace
from unittest.mock import patch

import mongomock
import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes


@pytest.mark.parametrize('method', ['GET', 'PUT', 'DELETE'])
@pytest.mark.parametrize('status', ['pending', 'done'])
def test_cross_owner_schedule_is_not_visible_or_mutable(method, status):
    db = SimpleNamespace(db=mongomock.MongoClient().db)
    oid = db.db.scheduled_sends.insert_one({'user_id': 'bob', 'created_by_username': 'alice',
                                         'status': status, 'name': 'original'}).inserted_id
    app = FastAPI(); app.include_router(routes.router, prefix='/api')
    with (patch.object(routes, 'MongoDBManager', return_value=db),
          patch.object(routes, '_require_user', return_value={'id': 'alice', 'username': 'alice'}),
          TestClient(app) as client):
        response = client.request(method, f'/api/admin/scheduled-sends/{oid}',
                                  json={'name': 'stolen'} if method == 'PUT' else None)
    assert response.status_code == 404
    assert db.db.scheduled_sends.find_one({'_id': oid})['name'] == 'original'
    assert db.db.scheduled_sends.find_one({'_id': oid})['status'] == status


@pytest.mark.parametrize('legacy', [False, True])
def test_owner_can_read_edit_cancel_and_delete_own_schedule(legacy):
    db = SimpleNamespace(db=mongomock.MongoClient().db)
    doc = {'created_by_username': 'alice', 'status': 'pending', 'name': 'original'}
    if not legacy:
        doc['user_id'] = 'alice-id'
        doc['created_by_username'] = 'old-username'
    oid = db.db.scheduled_sends.insert_one(doc).inserted_id
    db.db.scheduled_sends.insert_one({'user_id': 'bob-id', 'status': 'pending'})
    app = FastAPI(); app.include_router(routes.router, prefix='/api')
    with (patch.object(routes, 'MongoDBManager', return_value=db),
          patch.object(routes, '_require_user', return_value={'id': 'alice-id', 'username': 'alice'}),
          TestClient(app) as client):
        assert len(client.get('/api/admin/scheduled-sends').json()) == 1
        url = f'/api/admin/scheduled-sends/{oid}'
        assert client.get(url).status_code == 200
        assert client.put(url, json={'name': 'edited'}).json()['name'] == 'edited'
        assert client.delete(url).json()['action'] == 'cancelled'
        assert client.delete(url).json()['action'] == 'deleted'
        assert client.get(url).status_code == 404


def test_missing_identity_matches_no_ownerless_schedule():
    db = mongomock.MongoClient().db
    db.jobs.insert_one({'_id': ObjectId(), 'status': 'pending'})
    assert db.jobs.find_one(routes._scheduled_owner_filter({})) is None
