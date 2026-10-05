'use client'
import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/api'

// Blocked phone numbers, shared by every screen (recipient lists, Enviar
// Campaña, Conversaciones). One store, one fetch, every subscriber re-renders
// when it changes — blocking a number anywhere shows up everywhere at once.
//
// Audit 2026-10-04: this used to be fetched with a plain fetch() (no session
// token), the backend answered 401 and the list was silently empty — no number
// ever showed as blocked. It was also capped at 100 entries and never refreshed.

export const digitsOnly = n => (n ? String(n).replace(/\D/g, '') : '')

// Same rule as the backend (app/send_guard.py): the last 10 digits, so +52…,
// 52… and 521… (how WhatsApp delivers inbound messages) are the same number.
export const phoneKey = n => {
  const d = digitsOnly(n)
  return d.length >= 10 ? d.slice(-10) : d
}

const REFRESH_MS = 60_000   // other tabs / other users' blocks show up within a minute
const EMPTY = new Map()
let _map = null             // phoneKey -> blacklist entry id (needed to DELETE)
let _loadedAt = 0
let _loading = null
let _timer = null
const _listeners = new Set()

function _set(next) {
  _map = next             // always a new Map — memoized consumers see the change
  _listeners.forEach(fn => fn())
}

export function refreshBlacklistedPhones() {
  if (_loading) return _loading
  _loading = authFetch('/api/blacklist?type=phone&all=1')
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (data && Array.isArray(data.items)) {
        _loadedAt = Date.now()
        _set(new Map(data.items.map(e => [phoneKey(e.value), e.id || e._id])))
      }
    })
    .catch(() => {})
    .finally(() => { _loading = null })
  return _loading
}

function _onFocus() {
  if (Date.now() - _loadedAt > 5_000) refreshBlacklistedPhones()
}

function _start() {
  _timer = setInterval(refreshBlacklistedPhones, REFRESH_MS)
  window.addEventListener('focus', _onFocus)
}

function _stop() {
  clearInterval(_timer)
  _timer = null
  window.removeEventListener('focus', _onFocus)
}

/** Non-hook check, for send handlers: is this number blocked right now? */
export const isPhoneBlacklisted = n => !!_map && _map.has(phoneKey(n))

/** Map of phoneKey -> entry id. Re-renders the caller whenever the list changes. */
export function useBlacklistedPhones() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick(t => t + 1)
    _listeners.add(fn)
    if (_listeners.size === 1) _start()
    if (!_map || Date.now() - _loadedAt > REFRESH_MS) refreshBlacklistedPhones()
    return () => {
      _listeners.delete(fn)
      if (_listeners.size === 0) _stop()
    }
  }, [])
  return _map || EMPTY
}

/** Block / unblock one number. entryId present = it's blocked → unblock. */
export async function toggleBlacklistedPhone(number, entryId) {
  const key = phoneKey(number)
  if (entryId) {
    const r = await authFetch(`/api/blacklist/${entryId}`, { method: 'DELETE' })
    if (r.ok || r.status === 404) {
      const next = new Map(_map || EMPTY)
      next.delete(key)
      _set(next)
    }
    return false
  }
  const res = await authFetch('/api/blacklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'phone', value: digitsOnly(number) }),
  })
  if (res.ok) {
    const entry = await res.json()
    const next = new Map(_map || EMPTY)
    next.set(key, entry.id || entry._id)
    _set(next)
  } else if (res.status === 409) {
    await refreshBlacklistedPhones()   // already blocked (another format / another tab)
  }
  return true
}
