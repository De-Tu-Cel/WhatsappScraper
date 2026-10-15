"""Horario de Chat IA: contrato de entrega, sin red ni WhatsApp."""
from unittest.mock import MagicMock, patch
import pytest
from app.whatsapp_wwebjs import WWebjsClient, SendWindowClosed


def test_ai_deadline_is_forwarded_to_delivery_service():
    response = MagicMock(ok=True, status_code=200)
    response.json.return_value = {'success': True}
    with patch('app.whatsapp_wwebjs._req.post', return_value=response) as post:
        WWebjsClient('qa').send('525500000001', 'información?', send_before='2026-10-15T01:00:00+00:00')
    assert post.call_args.kwargs['json']['sendBefore'] == '2026-10-15T01:00:00+00:00'


def test_closed_window_has_a_distinct_exception_for_persistent_retry():
    response = MagicMock(ok=False, status_code=409)
    response.json.return_value = {'code': 'SEND_WINDOW_CLOSED'}
    with patch('app.whatsapp_wwebjs._req.post', return_value=response):
        with pytest.raises(SendWindowClosed):
            WWebjsClient('qa').send('525500000001', 'información?', send_before='2026-10-15T01:00:00+00:00')
