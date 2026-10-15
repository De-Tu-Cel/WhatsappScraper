from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes
from app import auth, classification_compare as cc
from app.classifier import LLMQuotaExceeded


@pytest.fixture
def client(monkeypatch):
    # Usuarios simulados: nunca leer ni rotar tokens de producción.
    monkeypatch.setattr(auth, 'get_user_by_token', lambda token: {'role': token, 'username': 'demo'} if token in ('admin', 'agent') else None)
    app = FastAPI()
    app.include_router(routes.router, prefix='/api')
    return TestClient(app)


@pytest.mark.parametrize('role', ['admin', 'agent'])
def test_both_roles_can_review_filtered_analytics_and_execution_mode(client, monkeypatch, role):
    manager = Mock()
    manager.get_analytics.return_value = {'items': [], 'total': 0}
    monkeypatch.setattr(routes, 'MongoDBManager', lambda: manager)
    headers = {'x-user-token': role}
    response = client.get('/api/analytics?review=new_messages&page=2', headers=headers)
    assert response.status_code == 200
    assert manager.get_analytics.call_args.kwargs['review_filter'] == 'new_messages'
    assert manager.get_analytics.call_args.kwargs['page'] == 2
    assert client.get('/api/classification/mode', headers=headers).status_code == 200


@pytest.mark.parametrize('path', ['/api/analytics', '/api/classification/mode'])
def test_anonymous_requests_cannot_read_analysis(client, monkeypatch, path):
    manager = Mock(); monkeypatch.setattr(routes, 'MongoDBManager', manager)
    assert client.get(path).status_code == 401
    manager.assert_not_called()


@pytest.mark.parametrize('role', ['admin', 'agent'])
def test_reanalysis_retains_selected_number_through_route(client, monkeypatch, role):
    run = Mock(return_value={}); monkeypatch.setattr(cc, 'run_comparison', run)
    response = client.post('/api/classification/comparisons/company/run?number=%2B525512345678', headers={'x-user-token': role})
    assert response.status_code == 200
    run.assert_called_once_with('company', number='+525512345678')


def test_missing_session_cannot_start_reanalysis(client, monkeypatch):
    run = Mock(); monkeypatch.setattr(cc, 'run_comparison', run)
    assert client.post('/api/classification/comparisons/company/run?number=5512345678').status_code == 401
    run.assert_not_called()


def test_quota_failure_is_actionable_without_a_success_response(client, monkeypatch):
    monkeypatch.setattr(cc, 'run_comparison', Mock(side_effect=LLMQuotaExceeded('no credits')))
    response = client.post('/api/classification/comparisons/company/run?number=5512345678', headers={'x-user-token': 'agent'})
    assert response.status_code == 503
    assert 'Se conserva' in response.json()['detail']
