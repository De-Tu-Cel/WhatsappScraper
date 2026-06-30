"""
Shared LLM helper — routes to Groq (local/dev) or DeepSeek (production).

Priority:
  1. GROQ_API_KEY set   → Groq  (llama-3.3-70b-versatile, free tier)
  2. DEEPSEEK_API_KEY   → DeepSeek (deepseek-chat)
  3. Neither            → raises RuntimeError

Groq rate-limit handling:
  - A threading.Semaphore(2) limits concurrent Groq requests to 2 at a time,
    preventing burst 429s when multiple classifiers/AI tasks fire simultaneously.
  - On 429, reads Retry-After header (or falls back to exponential backoff)
    and retries up to 5 times before raising.
"""
import logging
import os
import random
import threading
import time

import requests

log = logging.getLogger(__name__)

GROQ_API_KEY     = os.getenv("GROQ_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

GROQ_MODEL     = "llama-3.3-70b-versatile"
DEEPSEEK_MODEL = "deepseek-chat"

# Limit concurrent Groq calls — free tier is 30 req/min
_groq_sem = threading.Semaphore(2)

_GROQ_MAX_RETRIES  = 2
_GROQ_BASE_BACKOFF = 5

# Circuit breaker: after a 429, block ALL Groq calls for this many seconds.
# Keep short (20s) so Chat IA fails fast on daily-limit 429s instead of
# waiting 3+ minutes per retry cycle.
_GROQ_CIRCUIT_BREAK_SECS = 20
_groq_blocked_until: float = 0.0  # epoch seconds; 0 = not blocked
_groq_circuit_lock = threading.Lock()


def active_provider() -> str:
    """Return which provider is active: 'groq', 'deepseek', or 'none'."""
    if GROQ_API_KEY:
        return "groq"
    if DEEPSEEK_API_KEY:
        return "deepseek"
    return "none"


def call_llm(messages: list, max_tokens: int = 300, temperature: float = 0) -> str:
    """
    Send messages to the active LLM provider and return the response text.
    Raises RuntimeError if no API key is configured.
    """
    if GROQ_API_KEY:
        return _call_groq(messages, max_tokens, temperature)
    if DEEPSEEK_API_KEY:
        return _call_deepseek(messages, max_tokens, temperature)
    raise RuntimeError("No LLM API key configured (GROQ_API_KEY or DEEPSEEK_API_KEY)")


def _groq_is_blocked() -> float:
    """Return seconds remaining on circuit breaker, or 0 if open."""
    global _groq_blocked_until
    remaining = _groq_blocked_until - time.monotonic()
    return max(0.0, remaining)


def _groq_trip_circuit(seconds: float):
    """Trip the circuit breaker for `seconds`."""
    global _groq_blocked_until
    with _groq_circuit_lock:
        new_until = time.monotonic() + seconds
        if new_until > _groq_blocked_until:
            _groq_blocked_until = new_until
            log.warning("[LLM] groq circuit breaker tripped — pausing all Groq calls for %.0fs", seconds)


def _call_groq(messages: list, max_tokens: int, temperature: float) -> str:
    # Fast-fail if circuit breaker is open
    blocked = _groq_is_blocked()
    if blocked > 0:
        raise RuntimeError(f"Groq rate-limited — circuit breaker open for {blocked:.0f}s more")

    last_resp = None
    for attempt in range(1, _GROQ_MAX_RETRIES + 1):
        with _groq_sem:
            # Re-check after acquiring semaphore (another thread may have tripped it)
            blocked = _groq_is_blocked()
            if blocked > 0:
                raise RuntimeError(f"Groq rate-limited — circuit breaker open for {blocked:.0f}s more")

            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                         "Content-Type": "application/json"},
                json={"model": GROQ_MODEL, "messages": messages,
                      "max_tokens": max_tokens, "temperature": temperature},
                timeout=30,
            )
            if resp.status_code != 429:
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"].strip()
            last_resp = resp

        # 429 — trip circuit breaker and sleep OUTSIDE the semaphore
        retry_after = last_resp.headers.get("retry-after") or last_resp.headers.get("x-ratelimit-reset-requests")
        try:
            wait = min(float(retry_after), _GROQ_CIRCUIT_BREAK_SECS) if retry_after else _GROQ_CIRCUIT_BREAK_SECS
        except (TypeError, ValueError):
            wait = _GROQ_CIRCUIT_BREAK_SECS
        wait += random.uniform(1, 5)
        _groq_trip_circuit(wait)

        if attempt == _GROQ_MAX_RETRIES:
            last_resp.raise_for_status()
        log.warning("[LLM] groq 429 — retrying in %.0fs (attempt %d/%d)", wait, attempt, _GROQ_MAX_RETRIES)
        time.sleep(wait)
    raise RuntimeError("Groq retry loop exhausted")


def _call_deepseek(messages: list, max_tokens: int, temperature: float) -> str:
    resp = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                 "Content-Type": "application/json"},
        json={"model": DEEPSEEK_MODEL, "messages": messages,
              "max_tokens": max_tokens, "temperature": temperature},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()
