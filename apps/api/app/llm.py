"""
Shared LLM helper — routes to OpenAI or DeepSeek.

Priority:
  1. OPENAI_API_KEY   → OpenAI  (gpt-4o-mini)
  2. DEEPSEEK_API_KEY → DeepSeek (deepseek-chat)
  3. None             → raises RuntimeError

All calls pass through llm_guard (concurrency semaphore, exponential-backoff
retry, and circuit breaker). Import PRIORITY_LIVE / PRIORITY_BATCH from here
and pass them as the `priority` keyword argument to call_llm().
"""
import logging
import os

import requests

from app.llm_guard import (  # noqa: F401 — re-exported for callers
    PRIORITY_BATCH,
    PRIORITY_LIVE,
    guarded_call,
)

log = logging.getLogger(__name__)

OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

OPENAI_MODEL   = "gpt-4o-mini"
DEEPSEEK_MODEL = "deepseek-chat"


def active_provider() -> str:
    """Return which provider is active: 'openai', 'deepseek', or 'none'."""
    if OPENAI_API_KEY:
        return "openai"
    if DEEPSEEK_API_KEY:
        return "deepseek"
    return "none"


def call_llm(
    messages: list,
    max_tokens: int = 300,
    temperature: float = 0,
    priority: int = PRIORITY_BATCH,
) -> str:
    """
    Send messages to the active LLM provider and return the response text.
    All calls are routed through llm_guard (semaphore + retry + circuit breaker).
    Pass priority=PRIORITY_LIVE for real-time Chat IA calls.
    Raises RuntimeError if no API key is configured.
    """
    if OPENAI_API_KEY:
        return guarded_call(_call_openai, messages, max_tokens, temperature, priority=priority)
    if DEEPSEEK_API_KEY:
        return guarded_call(_call_deepseek, messages, max_tokens, temperature, priority=priority)
    raise RuntimeError("No LLM API key configured (OPENAI_API_KEY or DEEPSEEK_API_KEY)")


def _call_openai(messages: list, max_tokens: int, temperature: float) -> str:
    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}",
                 "Content-Type": "application/json"},
        json={"model": OPENAI_MODEL, "messages": messages,
              "max_tokens": max_tokens, "temperature": temperature},
        timeout=30,
    )
    if not resp.ok:
        try:
            detail = resp.json().get("error", {}).get("message", resp.text[:200])
        except Exception:
            detail = resp.text[:200]
        log.error("[LLM] OpenAI %d: %s", resp.status_code, detail)
        resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


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
