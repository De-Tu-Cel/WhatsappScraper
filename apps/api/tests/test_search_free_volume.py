from unittest.mock import Mock

import pytest

from app import searcher


@pytest.fixture
def no_ai_expansion(monkeypatch):
    monkeypatch.setattr(searcher, '_ai_expand_synonyms', lambda *args: [])
    searcher._DDG_PAGE_CACHE.clear()


def test_large_city_search_adds_contact_queries_and_rotates_them(no_ai_expansion):
    first = searcher._build_variations('dentistas', 'Monterrey', 'México', 600)
    second = searcher._build_variations('dentistas', 'Monterrey', 'México', 600, offset=10)
    assert 'dentista Monterrey contacto' in first
    assert 'consultorio dental Monterrey contacto' in first
    assert 'consultorio dental Monterrey sitio oficial' in second
    assert all('Monterrey' in query for query in first + second)
    assert len(first) == len(set(first))
    # Each search remains bounded; this must not grow with a huge target.
    assert len(first) <= 25


@pytest.mark.parametrize('country,city,industry,intent', [
    ('United States', 'Boston', 'dentist', 'contact'),
    ('Brasil', 'Curitiba', 'padaria', 'contato'),
])
def test_contact_queries_follow_country_language(no_ai_expansion, country, city, industry, intent):
    queries = searcher._build_variations(industry, city, country, 600)
    assert f'{industry} {city} {intent}' in queries


def test_large_load_more_starts_fresh_queries_on_page_one(no_ai_expansion, monkeypatch):
    fetch = Mock(return_value=[])
    monkeypatch.setattr(searcher, '_fetch_ddg', fetch)
    searcher._search_via_duckduckgo('dentistas', 'Monterrey', country='México', num_results=600, offset=10)
    fresh = [call for call in fetch.call_args_list if call.args[0].endswith(' sitio oficial')]
    repeated = [call for call in fetch.call_args_list if not call.args[0].endswith(' sitio oficial')]
    assert fresh and repeated
    assert {call.kwargs['page'] for call in fresh} == {1}
    assert {call.kwargs['page'] for call in repeated} == {2, 3, 4, 5}
    assert len(fetch.call_args_list) <= 34


def test_small_shortfall_expands_contact_queries(no_ai_expansion, monkeypatch):
    fetch = Mock(return_value=[])
    monkeypatch.setattr(searcher, '_fetch_ddg', fetch)
    searcher._search_via_duckduckgo('dentistas', 'Monterrey', country='México', num_results=20)
    assert any(call.args[0] == 'consultorio dental Monterrey contacto' for call in fetch.call_args_list)


def test_load_more_reuses_pages_and_does_not_skip_secondary_queries(no_ai_expansion, monkeypatch):
    monkeypatch.setattr(searcher, '_build_variations', lambda *args, **kwargs: ['primary', 'second', 'third', 'secondary'])
    fetch = Mock(side_effect=lambda query, page: [{'href': f'https://{query}{page}.example'}])
    monkeypatch.setattr(searcher, '_fetch_ddg', fetch)
    first, _ = searcher._search_via_duckduckgo('trade', 'city', num_results=1)
    second, _ = searcher._search_via_duckduckgo('trade', 'city', num_results=1, offset=10)
    calls = [(call.args[0], call.kwargs['page']) for call in fetch.call_args_list]
    assert ('secondary', 2) in calls
    assert len(calls) == len(set(calls))
    assert set(second) - set(first)


def test_each_query_continues_after_its_own_known_pages(no_ai_expansion, monkeypatch):
    monkeypatch.setattr(searcher, '_build_variations', lambda *args, **kwargs: ['primary', 'second', 'third', 'secondary'])
    fetch = Mock(side_effect=lambda query, page: [{'href': f'https://{query}{page}.example'}])
    monkeypatch.setattr(searcher, '_fetch_ddg', fetch)
    first, _ = searcher._search_via_duckduckgo('trade', 'city', num_results=1)
    known = {searcher._get_domain(url) for url in first}
    fetch.reset_mock()
    second, _ = searcher._search_via_duckduckgo('trade', 'city', exclude_domains=known, num_results=1, offset=10)
    calls = [(call.args[0], call.kwargs['page']) for call in fetch.call_args_list]
    assert ('primary', 5) in calls
    assert ('secondary', 2) in calls
    assert not any(query == 'primary' and page < 5 for query, page in calls)
    assert set(second) - set(first)
