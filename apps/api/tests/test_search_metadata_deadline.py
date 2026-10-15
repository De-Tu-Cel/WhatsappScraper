"""A slow website must not discard the metadata of completed lead candidates."""
from concurrent.futures import Future, TimeoutError
from unittest.mock import MagicMock, patch

import pytest
from app import searcher


def test_metadata_deadline_keeps_completed_sites_and_does_not_wait_for_slow_sites():
    completed = Future()
    completed.set_result(("https://fast.example", {"title": "Local business"}))
    pending = Future()
    pool = MagicMock()
    pool.submit.side_effect = [completed, pending]
    # Support the old context manager to demonstrate its lost partial results.
    pool.__enter__.return_value = pool

    def partial_then_timeout(*args, **kwargs):
        yield completed
        raise TimeoutError("one slow website")

    with patch.object(searcher.concurrent.futures, "ThreadPoolExecutor", return_value=pool), \
         patch.object(searcher.concurrent.futures, "as_completed", side_effect=partial_then_timeout):
        result = searcher._shallow_fetch_meta(["https://fast.example", "https://slow.example"])
    assert result == {"https://fast.example": {"title": "Local business"}}
    pool.shutdown.assert_called_once_with(wait=False, cancel_futures=True)


@pytest.mark.parametrize("fails", [False, True])
def test_metadata_response_is_closed_on_success_or_read_error(fails):
    response = MagicMock()
    if fails:
        response.iter_content.side_effect = OSError("interrupted read")
    else:
        response.iter_content.return_value = [b'<title>Business</title><meta name="description" content="Contact us">']
    with patch.object(searcher.requests, "get", return_value=response):
        result = searcher._shallow_fetch_meta(["https://business.example"])
    assert result == ({} if fails else {"https://business.example": {"title": "Business", "body": "Contact us"}})
    response.close.assert_called_once()


def test_empty_metadata_batch_needs_no_workers():
    with patch.object(searcher.concurrent.futures, "ThreadPoolExecutor") as pool:
        assert searcher._shallow_fetch_meta([]) == {}
    pool.assert_not_called()
