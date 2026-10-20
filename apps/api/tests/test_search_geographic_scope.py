"""Mock discovery sources: requesting a city must not silently widen its scope."""
from unittest.mock import Mock

import pytest

from app import searcher


@pytest.fixture
def discovery(monkeypatch):
    monkeypatch.setattr(searcher, "_dataforseo_auth", lambda: None)
    monkeypatch.setattr(searcher, "SERPAPI_KEY", "")
    monkeypatch.setattr(searcher, "OPENAI_API_KEY", "")
    monkeypatch.setattr(searcher, "DEEPSEEK_API_KEY", "")
    ddg = Mock(return_value=([], {}))
    osm = Mock(return_value=([], {}))
    country_filter = Mock(side_effect=lambda urls, *args, **kwargs: urls)
    monkeypatch.setattr(searcher, "_search_via_duckduckgo", ddg)
    monkeypatch.setattr(searcher, "_search_via_openstreetmap", osm)
    monkeypatch.setattr(searcher, "_reject_wrong_country", country_filter)
    return ddg, osm, country_filter


def test_city_shortfall_does_not_search_neighbors_by_default(discovery):
    ddg, osm, _ = discovery
    urls, state, _ = searcher.search_prospects("dentistas", city="Monterrey", country="México")
    assert urls == []
    assert state == "nuevo leon"
    assert ddg.call_count == osm.call_count == 1
    assert ddg.call_args.args[1] == osm.call_args.args[1] == "Monterrey"


def test_nearby_search_requires_explicit_opt_in(discovery):
    ddg, osm, _ = discovery
    searcher.search_prospects("dentistas", city="Monterrey", country="México", allow_nearby=True)
    assert ddg.call_count > 1
    assert osm.call_count > 1


@pytest.mark.parametrize("country", ["Nicaragua", "Spain", "United States"])
def test_foreign_leon_does_not_get_mexican_state_rules(discovery, country):
    ddg, osm, country_filter = discovery
    _, state, _ = searcher.search_prospects("dentistas", city="León", country=country, allow_nearby=True)
    assert state is None
    assert ddg.call_count == osm.call_count == 1
    country_filter.assert_called_once()
    assert country_filter.call_args.args[2] == country


@pytest.mark.parametrize("builder", [searcher._build_variations, searcher._bd_build_queries])
def test_large_city_queries_do_not_widen_to_other_cities(monkeypatch, builder):
    monkeypatch.setattr(searcher, "OPENAI_API_KEY", "")
    monkeypatch.setattr(searcher, "DEEPSEEK_API_KEY", "")
    if builder is searcher._build_variations:
        queries = builder("dentistas", city="Monterrey", country="México", num_results=600)
    else:
        queries = builder("dentistas", "Monterrey", "México", "", 600)
    assert queries
    assert all("Monterrey" in query for query in queries)


def test_city_load_more_fetches_new_ddg_pages(monkeypatch):
    searcher._DDG_PAGE_CACHE.clear()
    monkeypatch.setattr(searcher, "_build_variations", lambda *args, **kwargs: ["dentists Boston"])
    fetch = Mock(side_effect=lambda query, page: [{"href": f"https://dentist{page}.example", "title": "Dentist"}])
    monkeypatch.setattr(searcher, "_fetch_ddg", fetch)
    first, _ = searcher._search_via_duckduckgo("dentists", city="Boston", country="United States", offset=0)
    second, _ = searcher._search_via_duckduckgo("dentists", city="Boston", country="United States", offset=10)
    assert set(second) - set(first)
    assert {call.kwargs["page"] for call in fetch.call_args_list} == set(range(1, 6))


def test_country_batch_starts_new_city_queries_on_first_page(monkeypatch):
    monkeypatch.setattr(searcher, "_build_variations", lambda *args, **kwargs: ["dentists new city"])
    fetch = Mock(return_value=[])
    monkeypatch.setattr(searcher, "_fetch_ddg", fetch)
    searcher._search_via_duckduckgo("dentists", country="Canada", offset=10)
    assert {call.kwargs["page"] for call in fetch.call_args_list} == {1, 2, 3, 4}


def test_maps_foreign_city_fallback_never_uses_a_mexican_state(monkeypatch):
    monkeypatch.setattr(searcher, "_dataforseo_auth", lambda: "test")
    monkeypatch.setattr(searcher, "_resolve_dfs_location", lambda *args: None)
    response = Mock()
    response.json.return_value = {"tasks": [{"status_code": 20000, "result": [{"items": []}]}]}
    post = Mock(return_value=response)
    monkeypatch.setattr(searcher.requests, "post", post)
    searcher._search_via_dataforseo_maps("dentists", city="León", country="Nicaragua")
    assert post.call_args.kwargs["json"][0]["location_name"] == "Leon,Nicaragua"


def test_geographic_filter_asks_for_city_evidence_and_keeps_local_branch(monkeypatch):
    monkeypatch.setattr(searcher, "OPENAI_API_KEY", "test")
    reject = Mock(return_value=[2])
    monkeypatch.setattr(searcher, "_llm_reject_indices", reject)
    urls = ["https://local.example", "https://other.example"]
    assert searcher._reject_wrong_country(urls, {}, "Colombia", city="Bogotá") == urls[:1]
    prompt = reject.call_args.args[0]
    assert "OTRA ciudad" in prompt
    assert "sucursal o servicio en Bogotá" in prompt
    assert "no excluyas por falta de datos" in prompt


@pytest.mark.parametrize("explicit,expected", [(None, "Brasil"), ("Canada", "Canada")])
def test_processing_preserves_country_from_saved_search(monkeypatch, explicit, expected):
    from app import pipeline
    manager = Mock()
    manager.db.search_ideas.find_one_and_delete.return_value = {"target_country": "Brasil", "target_city": "Curitiba"}
    scraper = Mock()
    scraper.scrape_site.side_effect = RuntimeError("stop after observing scraper arguments")
    monkeypatch.setattr(pipeline, "MongoDBManager", lambda: manager)
    def make_scraper(db):
        assert db is manager.db
        return scraper
    monkeypatch.setattr(pipeline, "WebsiteScraper", make_scraper)
    monkeypatch.setattr(pipeline, "WhatAppClient", Mock())
    monkeypatch.setattr(pipeline, "_check_blacklist", lambda *args: None)
    with pytest.raises(RuntimeError, match="stop after observing"):
        pipeline.process_url("https://business.example", country=explicit)
    assert scraper.scrape_site.call_args.kwargs["country"] == expected
    assert scraper.scrape_site.call_args.kwargs["target_city"] == "Curitiba"


@pytest.mark.parametrize("target", [50, 200])
def test_large_api_batch_advances_one_city_block_and_saves_country(monkeypatch, target):
    from app.api import routes
    from app import pipeline
    manager = Mock()
    manager.get_all_scraped_domains.return_value = set()
    manager.known_maps_lead_urls.return_value = set()
    manager.db.blacklist.find.return_value = []
    monkeypatch.setattr(routes, "MongoDBManager", lambda: manager)
    monkeypatch.setattr(pipeline, "_check_blacklist", lambda *args: None)

    def discover(*args, **kwargs):
        kwargs["meta_out"].update(industry="padarias", city="Curitiba", country="Brasil")
        return [f"https://bakery{i}.example" for i in range(target * 3)], None, []

    monkeypatch.setattr(routes, "search_prospects", discover)
    out = routes.api_search(routes.SearchRequest(industry="padarias Curitiba", num_results=target, offset=10), x_user_token=None)
    assert len(out["results"]) == target
    assert out["next_offset"] == 20
    updates = manager.db.search_ideas.update_one.call_args_list
    assert len(updates) == target
    assert all(call.args[1]["$setOnInsert"]["target_country"] == "Brasil" for call in updates)
