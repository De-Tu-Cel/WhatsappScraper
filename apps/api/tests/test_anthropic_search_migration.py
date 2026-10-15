"""Cambiar a Claude no debe apagar filtros ni extracción (2026-10-14)."""
from unittest.mock import Mock

import pytest
from app import llm, searcher
from app.scraper import WebsiteScraper


@pytest.fixture
def claude_only(monkeypatch):
    monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
    for module in (llm, searcher):
        monkeypatch.setattr(module, 'OPENAI_API_KEY', '')
        monkeypatch.setattr(module, 'DEEPSEEK_API_KEY', '')
    monkeypatch.setattr(llm, 'ANTHROPIC_API_KEY', 'fake-claude-only')


def test_search_normalization_runs_with_only_claude_key(claude_only, monkeypatch):
    monkeypatch.setattr(searcher, '_NORMALIZE_CACHE', {})
    call = Mock(return_value='{"industry":"dentistas","city":"Bogotá","country":"Colombia","state":null}')
    monkeypatch.setattr(llm, 'call_llm', call)
    result = searcher._normalize_query_with_llm('dentistas bogota')
    assert result['city'] == 'Bogotá'
    call.assert_called_once()


def test_geographic_filter_runs_with_only_claude_key(claude_only, monkeypatch):
    call = Mock(return_value='[1]')
    monkeypatch.setattr(llm, 'call_llm', call)
    urls = ['https://example.invalid']
    assert searcher._reject_wrong_country(urls, {}, 'Colombia', city='Bogotá') == []
    call.assert_called_once()


def test_contact_person_filter_runs_with_only_claude_key(claude_only, monkeypatch):
    call = Mock(return_value='[{"is_person":true,"role":"Ventas"},{"is_person":false,"role":""}]')
    monkeypatch.setattr(llm, 'call_llm', call)
    scraper = object.__new__(WebsiteScraper)
    result = scraper._llm_filter_persons([{'name': 'Ana Pérez'}, {'name': 'Inicio'}])
    assert result == [{'name': 'Ana Pérez', 'role': 'Ventas'}]
    call.assert_called_once()
