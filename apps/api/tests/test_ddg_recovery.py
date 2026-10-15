from unittest.mock import MagicMock
from app import searcher


def test_failed_auto_search_changes_engine_without_changing_scope(monkeypatch):
    import ddgs
    instance = MagicMock()
    instance.__enter__.return_value = instance
    instance.text.side_effect = [RuntimeError('connection reset'), [{'href':'https://gastomzadepuebla.com/', 'title':'Gas Tomza Puebla', 'body':'Gas LP Puebla'}]]
    monkeypatch.setattr(ddgs, 'DDGS', lambda: instance)
    monkeypatch.setattr(searcher.time, 'sleep', lambda *args: None)
    rows = searcher._fetch_ddg('gas lp Puebla contacto', region='mx-es', page=2)
    assert len(rows) == 1
    assert [call.kwargs['backend'] for call in instance.text.call_args_list] == ['auto', 'bing']
    assert all(call.args == ('gas lp Puebla contacto',) and call.kwargs['region'] == 'mx-es' and call.kwargs['page'] == 2 for call in instance.text.call_args_list)


def test_empty_auto_search_also_tries_backup(monkeypatch):
    import ddgs
    instance = MagicMock()
    instance.__enter__.return_value = instance
    instance.text.side_effect = [[], [{'href':'https://gasoriente.com.mx/', 'title':'Gas Oriente'}]]
    monkeypatch.setattr(ddgs, 'DDGS', lambda: instance)
    assert searcher._fetch_ddg('gas lp Puebla')[0]['href'] == 'https://gasoriente.com.mx/'
    assert instance.text.call_count == 2


def test_successful_auto_does_not_spend_an_extra_search(monkeypatch):
    import ddgs
    instance = MagicMock()
    instance.__enter__.return_value = instance
    instance.text.return_value = [{'href':'https://gasoriente.com.mx/'}]
    monkeypatch.setattr(ddgs, 'DDGS', lambda: instance)
    searcher._fetch_ddg('gas lp Puebla')
    assert instance.text.call_count == 1


def test_backup_never_accepts_a_directory_as_business(monkeypatch):
    import ddgs
    instance = MagicMock()
    instance.__enter__.return_value = instance
    instance.text.side_effect = [[], [{'href':'https://capitalactiva.mx/gas/puebla'}]]
    monkeypatch.setattr(ddgs, 'DDGS', lambda: instance)
    assert searcher._fetch_ddg('gas lp Puebla') == []


def test_parallel_users_share_the_six_request_limit(monkeypatch):
    import ddgs
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock
    release, full, lock = Event(), Event(), Lock()
    active = peak = 0
    class Client:
        def __enter__(self):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 6:
                    full.set()
            return self
        def text(self, *args, **kwargs):
            assert release.wait(3)
            return [{'href':'https://gasoriente.com.mx/'}]
        def __exit__(self, *args):
            nonlocal active
            with lock:
                active -= 1
    monkeypatch.setattr(ddgs, 'DDGS', Client)
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(searcher._fetch_ddg, 'gas lp Puebla') for _ in range(12)]
        try:
            assert full.wait(3)
        finally:
            release.set()
        assert all(future.result() for future in futures)
    assert peak == 6
