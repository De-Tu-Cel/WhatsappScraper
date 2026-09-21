"""
LLM Guard — concurrency limiting, exponential-backoff retry, and circuit breaker.

Priority levels
───────────────
  PRIORITY_LIVE  = 0   Chat IA real-time replies (ai_followup.py)
  PRIORITY_BATCH = 10  Classifier & PDF suggestions (classifier.py)

Pools are independent: batch work can never starve live replies.
The circuit breaker fires on hard failures (5xx, timeouts, network errors)
and stays open for 5 minutes. Rate-limit errors (429) do NOT open the
circuit — they are expected under load and only trigger retry + backoff.
"""

import logging
import threading
import time
from typing import Any, Callable

log = logging.getLogger(__name__)

# ── Priority constants ────────────────────────────────────────────────────────
PRIORITY_LIVE  = 0   # real-time Chat IA
PRIORITY_BATCH = 10  # background classifier / PDF

# ── Concurrency pools ─────────────────────────────────────────────────────────
_LIVE_SEMAPHORE  = threading.BoundedSemaphore(5)  # max 5 simultaneous live calls
_BATCH_SEMAPHORE = threading.BoundedSemaphore(2)  # max 2 simultaneous batch calls

_LIVE_ACQUIRE_TIMEOUT  = 30   # seconds; live requests can't wait long
_BATCH_ACQUIRE_TIMEOUT = 120  # seconds; batch can queue up to 2 min

# ── Circuit breaker ───────────────────────────────────────────────────────────
_CB_FAIL_THRESHOLD = 3     # consecutive hard failures before opening
_CB_RESET_SECS     = 300   # stay open for 5 minutes

_cb_lock        = threading.Lock()
_cb_consecutive = 0        # consecutive hard-failure counter
_cb_open_until  = 0.0      # epoch; 0.0 means closed


def circuit_is_open() -> bool:
    """
    Return True if the circuit breaker is currently tripped.

    When the open window has expired, also resets _cb_consecutive to 0 —
    otherwise a single stale failure long after the original trip re-opens
    the breaker instantly (since the old counter was already >= threshold),
    making it look permanently stuck instead of giving the LLM a fresh
    3-strikes chance once the cooldown has actually passed.
    """
    global _cb_consecutive, _cb_open_until
    with _cb_lock:
        if _cb_open_until and time.time() >= _cb_open_until:
            _cb_consecutive = 0
            _cb_open_until = 0.0
        return time.time() < _cb_open_until


def _cb_record_success() -> None:
    global _cb_consecutive
    with _cb_lock:
        if _cb_consecutive:
            log.info("[LLMGuard] LLM call succeeded — resetting failure counter.")
        _cb_consecutive = 0


def _cb_record_hard_failure() -> None:
    global _cb_consecutive, _cb_open_until
    with _cb_lock:
        _cb_consecutive += 1
        if _cb_consecutive >= _CB_FAIL_THRESHOLD:
            _cb_open_until = time.time() + _CB_RESET_SECS
            log.error(
                "[LLMGuard] ⚡ Circuit breaker ABIERTO — %d fallos duros consecutivos. "
                "LLM pausado por %.0f minutos.",
                _cb_consecutive,
                _CB_RESET_SECS / 60,
            )


def reset_circuit() -> None:
    """Manually re-close the circuit breaker (e.g. after confirming the API key works)."""
    global _cb_consecutive, _cb_open_until
    with _cb_lock:
        _cb_consecutive = 0
        _cb_open_until  = 0.0
    log.info("[LLMGuard] Circuit breaker reiniciado manualmente.")


# ── Retry config ──────────────────────────────────────────────────────────────
_RETRY_MAX    = 3
_RETRY_BASE_S = 1.0
_RETRY_CAP_S  = 30.0


def _backoff_secs(attempt: int) -> float:
    """Exponential backoff: 1s → 2s → 4s … capped at 30s."""
    return min(_RETRY_BASE_S * (2 ** attempt), _RETRY_CAP_S)


def _is_retryable(exc: Exception) -> bool:
    """429 and 5xx are worth retrying. 4xx auth/billing errors are permanent."""
    code = str(exc)
    return any(c in code for c in ("429", "500", "502", "503", "504"))


def _is_rate_limit(exc: Exception) -> bool:
    return "429" in str(exc)


# ── Public entry point ────────────────────────────────────────────────────────
def guarded_call(
    fn: Callable[..., Any],
    *args: Any,
    priority: int = PRIORITY_BATCH,
    **kwargs: Any,
) -> Any:
    """
    Call fn(*args, **kwargs) with circuit-breaker gate, semaphore, and retry.

    - Raises RuntimeError immediately if the circuit is open.
    - Acquires a semaphore slot for the given priority level.
    - Retries up to _RETRY_MAX times on retryable errors with exponential backoff.
    - Hard failures (5xx / timeout / network) advance the circuit-breaker counter.
    - 429 rate-limit errors trigger retry + backoff but do NOT advance the counter.
    - Returns fn's return value on success, or re-raises the last exception.
    """
    if circuit_is_open():
        raise RuntimeError(
            "[LLMGuard] Circuit breaker abierto — LLM pausado temporalmente. "
            "Reintenta en unos minutos."
        )

    if priority == PRIORITY_LIVE:
        sem     = _LIVE_SEMAPHORE
        timeout = _LIVE_ACQUIRE_TIMEOUT
        label   = "LIVE"
    else:
        sem     = _BATCH_SEMAPHORE
        timeout = _BATCH_ACQUIRE_TIMEOUT
        label   = "BATCH"

    acquired = sem.acquire(blocking=True, timeout=timeout)
    if not acquired:
        raise RuntimeError(
            f"[LLMGuard] Timeout adquiriendo semáforo {label} — "
            "demasiadas llamadas LLM concurrentes."
        )

    try:
        last_exc: Exception | None = None

        for attempt in range(_RETRY_MAX + 1):
            if circuit_is_open():
                raise RuntimeError(
                    "[LLMGuard] Circuit breaker se abrió durante los reintentos."
                )

            try:
                result = fn(*args, **kwargs)
                _cb_record_success()
                return result

            except Exception as exc:
                last_exc = exc

                if not _is_retryable(exc):
                    # Permanent error (401, 402, 400…) — count as hard failure and bail.
                    _cb_record_hard_failure()
                    raise

                if not _is_rate_limit(exc):
                    # Hard failure (5xx / timeout) — advance circuit breaker counter.
                    _cb_record_hard_failure()
                # 429 does NOT advance the circuit breaker counter.

                if attempt < _RETRY_MAX:
                    wait = _backoff_secs(attempt)
                    log.warning(
                        "[LLMGuard] [%s] Intento %d/%d falló (%s). Esperando %.1fs…",
                        label,
                        attempt + 1,
                        _RETRY_MAX,
                        exc,
                        wait,
                    )
                    time.sleep(wait)
                else:
                    log.error(
                        "[LLMGuard] [%s] Todos los reintentos agotados (%d intentos): %s",
                        label,
                        _RETRY_MAX + 1,
                        exc,
                    )

        raise last_exc  # type: ignore[misc]

    finally:
        sem.release()
