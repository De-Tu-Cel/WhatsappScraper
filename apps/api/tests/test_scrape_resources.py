"""Concurrent extraction resources, with no network, Mongo or real WA profiles."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from app.scrape_resources import SharedFetches, RenderedPages
from app.scrape_indexes import ensure_scrape_indexes


def test_six_simultaneous_users_share_one_download_and_get_independent_results():
    cache = SharedFetches()
    barrier = threading.Barrier(6)
    calls = []

    def fetch():
        calls.append(1)
        time.sleep(.08)
        return {'contacts': ['+525500000000']}

    def user(_):
        barrier.wait()
        return cache.run(('url', 'headers'), fetch)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(user, range(6)))
    assert len(calls) == 1
    results[0]['contacts'].clear()
    assert all(r['contacts'] == ['+525500000000'] for r in results[1:])
    cache.run(('url', 'headers'), fetch)
    assert len(calls) == 2  # No retained stale response or hidden URL quota.


def test_download_options_are_not_shared_and_failure_can_be_retried():
    cache = SharedFetches()
    with pytest.raises(ValueError):
        cache.run('a', lambda: (_ for _ in ()).throw(ValueError('failed')))
    assert cache.run('a', lambda: 'retry') == 'retry'
    assert cache.run('b', lambda: 'different') == 'different'
    assert not cache._pending


class Page:
    async def goto(self, *args, **kwargs):
        self.url = args[0]

    async def wait_for_timeout(self, delay):
        pass

    async def content(self):
        return '<a href="https://wa.me/525500000000">WhatsApp</a>'


class Context:
    def __init__(self):
        self.closed = False
        self.page = Page()

    async def route(self, pattern, handler):
        self.handler = handler

    async def new_page(self):
        return self.page

    async def close(self):
        self.closed = True


class Browser:
    def __init__(self):
        self.contexts = []
        self.closed = False

    def is_connected(self):
        return not self.closed

    async def new_context(self, **options):
        context = Context()
        self.contexts.append(context)
        return context

    async def close(self):
        self.closed = True


class Engine:
    def __init__(self):
        self.chromium = self
        self.browsers = []
        self.stopped = False

    async def start(self):
        return self

    async def launch(self, **kwargs):
        browser = Browser()
        self.browsers.append(browser)
        return browser

    async def stop(self):
        self.stopped = True


@pytest.fixture
def renderer():
    engine = Engine()
    manager = RenderedPages([], factory=lambda: engine)
    try:
        yield manager, engine
    finally:
        manager.close()


def test_browser_reused_with_separate_contexts_and_cleanup_on_failure(renderer):
    manager, engine = renderer
    with manager.session(locale='es-MX') as first:
        assert 'wa.me' in first.render('https://example.com')
    with pytest.raises(ValueError):
        with manager.session() as second:
            assert 'wa.me' in second.render('https://example.org')
            raise ValueError('extraction error')
    assert len(engine.browsers) == 1
    contexts = engine.browsers[0].contexts
    assert len(contexts) == 2
    assert all(c.closed for c in contexts)
    assert not manager._contexts


def test_six_users_can_render_in_isolated_contexts_on_one_browser(renderer):
    manager, engine = renderer
    barrier = threading.Barrier(6)

    def user(_):
        with manager.session() as session:
            barrier.wait(timeout=5)
            return session.render('https://example.com')

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert all('wa.me' in html for html in pool.map(user, range(6)))
    assert len(engine.browsers) == 1
    assert len(engine.browsers[0].contexts) == 6
    assert all(c.closed for c in engine.browsers[0].contexts)


@pytest.mark.parametrize('kind,blocked', [('image', True), ('font', True), ('media', True),
                                        ('script', False), ('xhr', False), ('stylesheet', False)])
def test_resource_filter_keeps_scripts_and_contact_requests(renderer, kind, blocked):
    manager, engine = renderer
    async def check():
        from unittest.mock import AsyncMock
        route = MagicMock()
        route.request.resource_type = kind
        route.abort = AsyncMock()
        route.continue_ = AsyncMock()
        await engine.browsers[0].contexts[0].handler(route)
        assert route.abort.await_count == int(blocked)
        assert route.continue_.await_count == int(not blocked)
    with manager.session():
        manager._call(check())


def test_idle_browser_closes_without_touching_active_contexts(renderer):
    manager, engine = renderer
    with manager.session():
        manager._call(manager._close_idle_browser())
        assert not engine.browsers[0].closed
    manager._call(manager._close_idle_browser())
    assert engine.browsers[0].closed
    with manager.session():
        assert len(engine.browsers) == 2


def test_disconnected_browser_is_replaced_for_next_extraction(renderer):
    manager, engine = renderer
    with manager.session():
        pass
    engine.browsers[0].closed = True
    with manager.session() as session:
        assert 'wa.me' in session.render('https://example.com')
    assert len(engine.browsers) == 2


def test_recycling_waits_for_last_context(renderer):
    manager, engine = renderer
    with manager.session():
        manager._uses = 64
        with manager.session():
            pass
        assert not engine.browsers[0].closed
    assert engine.browsers[0].closed


def test_missing_browser_preserves_http_results():
    def unavailable():
        raise ImportError('playwright not installed')
    manager = RenderedPages([], factory=unavailable)
    try:
        with manager.session() as session:
            assert session.render('https://example.com') is None
    finally:
        manager.close()


def test_indexes_are_non_unique_and_one_failure_does_not_skip_rest():
    db = MagicMock()
    db.__getitem__.return_value.create_index.side_effect = [RuntimeError('offline')] + [None] * 5
    ensure_scrape_indexes(db)
    assert db.__getitem__.return_value.create_index.call_count == 6
    assert all(not call.kwargs.get('unique') for call in db.__getitem__.return_value.create_index.call_args_list)


def test_scraper_can_reuse_pipeline_database_without_creating_client():
    from app.scraper import WebsiteScraper
    db = MagicMock()
    # Sin `db`, el scraper usa la conexión compartida (MongoDBManager); con `db`, no abre ninguna.
    with patch('app.database.MongoDBManager') as connect:
        scraper = WebsiteScraper(db=db)
    connect.assert_not_called()
    assert scraper.companies_col is db['companies']
