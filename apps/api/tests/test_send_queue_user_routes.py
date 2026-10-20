"""The request body cannot select another user's queue."""
from unittest.mock import MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api import routes


def test_status_cancel_and_enqueue_use_authenticated_owner():
    app = FastAPI()
    app.include_router(routes.router, prefix='/api')
    db = MagicMock()
    def user(token):
        return {'id': token, 'username': token, 'role': 'agent'}
    with (TestClient(app) as client,
          patch('app.auth.get_user_by_token', side_effect=user),
          patch.object(routes, 'MongoDBManager', return_value=db),
          patch('app.send_now_worker.get_status', return_value={'phase': 'idle'}) as status,
          patch('app.send_now_worker.cancel_pending_send_items', return_value=0) as cancel,
          patch('app.send_now_worker.enqueue_send_items', return_value=1) as enqueue):
        for owner in ('alice', 'bob'):
            headers = {'x-user-token': owner}
            assert client.get('/api/send-queue/status', headers=headers).status_code == 200
            assert status.call_args.args[1] == owner
            assert client.post('/api/send-queue/cancel', headers=headers).status_code == 200
            assert cancel.call_args.args[1] == owner
            response = client.post('/api/send-queue', headers=headers, json={
                'request_id': 'same-request-id', 'user_id': 'someone-else',
                'jobs': [{'numbers': ['+525500000001'], 'messages': ['Synthetic QA']}]})
            assert response.status_code == 200
            assert enqueue.call_args.kwargs['user_id'] == owner
        assert status.call_count == cancel.call_count == enqueue.call_count == 2
        assert enqueue.call_args_list[0].args[2] != enqueue.call_args_list[1].args[2]
