"""Process-local scraping resources. No WhatsApp clients or profiles are used."""
import asyncio
import atexit
from concurrent.futures import Future
from contextlib import contextmanager
from copy import deepcopy
import threading
import logging


class SharedFetches:
    """Share only overlapping public downloads, never retain stale responses.

    Callers must include all request-affecting options in the key. Each caller
    receives a separate response object; errors always release the key.
    """
    def __init__(self):
        self._lock = threading.Lock()
        self._pending = {}

    def run(self, key, fetch):
        with self._lock:
            pending = self._pending.get(key)
            owner = pending is None
            if owner:
                pending = self._pending[key] = Future()
        if not owner:
            return deepcopy(pending.result())
        try:
            response = fetch()
            pending.set_result(response)
            return deepcopy(response)
        except BaseException as exc:
            pending.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._pending.pop(key, None)


public_downloads = SharedFetches()


class RenderedPages:
    """One lazy Chromium per API process, isolated context per extraction.

    Playwright objects stay on ONE asyncio loop in their owning thread. Scraper
    threads exchange only HTML strings and context IDs, never browser objects.
    No URL or user concurrency quota is imposed here.
    """
    def __init__(self, launch_args, factory=None):
        self._args = launch_args
        self._factory = factory
        self._start_lock = threading.Lock()
        self._loop = None
        self._thread = None
        self._pw = None
        self._browser = None
        self._contexts = {}
        self._uses = 0
        self._idle_close = None
        self._closed = False

    def _start(self):
        with self._start_lock:
            if self._closed:
                raise RuntimeError('Scraping renderer is closed')
            if self._loop is not None:
                return
            loop = asyncio.new_event_loop()
            self._loop = loop
            self._thread = threading.Thread(target=loop.run_forever, daemon=True, name='scrape-browser')
            self._thread.start()
            self._browser_lock = asyncio.Lock()

    def _call(self, coroutine, timeout=35):
        try:
            self._start()
        except BaseException:
            coroutine.close()
            raise
        future = asyncio.run_coroutine_threadsafe(coroutine, self._loop)
        try:
            return future.result(timeout=timeout)
        except BaseException:
            future.cancel()
            raise

    async def _open(self, options):
        async with self._browser_lock:
            if self._idle_close is not None:
                self._idle_close.cancel()
                self._idle_close = None
            if self._pw is None:
                if self._factory is None:
                    from playwright.async_api import async_playwright
                    self._factory = async_playwright
                self._pw = await self._factory().start()
            if self._browser is None or not self._browser.is_connected():
                self._browser = await self._pw.chromium.launch(headless=True, args=self._args)
                self._uses = 0
            context = None
            try:
                context = await self._browser.new_context(**options)

                async def resources(route):
                    if route.request.resource_type in ('image', 'font', 'media'):
                        await route.abort()
                    else:
                        await route.continue_()

                await context.route('**/*', resources)
                page = await context.new_page()
                key = id(context)
                self._contexts[key] = (context, page)
                self._uses += 1
                return key
            except BaseException:
                if context is not None:
                    await context.close()
                raise

    async def _render(self, key, url, timeout):
        _, page = self._contexts[key]
        try:
            await page.goto(url, wait_until='load', timeout=timeout * 1000)
        except Exception:
            # Preserve the previous behavior: a widget may already be present
            # even when other resources prevent reaching the load event.
            pass
        await page.wait_for_timeout(2000)
        return await page.content()

    async def _close_context(self, key):
        async with self._browser_lock:
            pair = self._contexts.pop(key, None)
            if pair is not None:
                try:
                    await pair[0].close()
                finally:
                    # Recycle only when NO extraction is using the browser.
                    if not self._contexts and self._uses >= 64:
                        browser, self._browser = self._browser, None
                        await browser.close()
                    elif not self._contexts:
                        self._idle_close = self._loop.call_later(
                            30, lambda: self._loop.create_task(self._close_idle_browser()))

    async def _close_idle_browser(self):
        async with self._browser_lock:
            if not self._contexts and self._browser is not None:
                browser, self._browser = self._browser, None
                try:
                    await browser.close()
                except Exception:
                    logging.getLogger(__name__).exception('Closing idle scraping browser failed')

    @contextmanager
    def session(self, **options):
        try:
            key = self._call(self._open(options))
        except Exception:
            logging.getLogger(__name__).warning('JavaScript fallback unavailable', exc_info=True)

            class Unavailable:
                def render(self, url, timeout=20):
                    return None

            yield Unavailable()
            return
        manager = self

        class Session:
            def render(self, url, timeout=20):
                return manager._call(manager._render(key, url, timeout), timeout=timeout + 10)

        try:
            yield Session()
        finally:
            self._call(self._close_context(key))

    async def _shutdown(self):
        if self._idle_close is not None:
            self._idle_close.cancel()
        for key in list(self._contexts):
            await self._close_context(key)
        if self._browser is not None:
            await self._browser.close()
            self._browser = None
        if self._pw is not None:
            await self._pw.stop()
            self._pw = None

    def close(self):
        if self._closed or self._loop is None:
            return
        try:
            # Chromium/driver teardown can take several seconds under CPU load.
            # Do not stop its event loop midway through a normal shutdown.
            self._call(self._shutdown(), timeout=30)
        finally:
            self._closed = True
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=5)
            if not self._thread.is_alive():
                self._loop.close()


_renderers = None
_renderers_lock = threading.Lock()


def rendered_pages(launch_args):
    global _renderers
    with _renderers_lock:
        if _renderers is None:
            _renderers = RenderedPages(launch_args)
            atexit.register(_renderers.close)
        return _renderers
