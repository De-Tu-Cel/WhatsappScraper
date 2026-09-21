'use client'
import { useState, useEffect } from 'react'
import { useUser } from '../context/UserContext'

const POLL_DISCONNECTED = 10_000   // 10s when disconnected but reachable
const POLL_CONNECTED    = 45_000   // 45s when connected
const POLL_UNREACHABLE  = 30_000   // 30s when backend times out / all fail
const SKIP_TTL          = 180_000  // 3 min — re-check providers that returned total:0
                                   // so a newly assigned instance is detected without refresh

// ─── Module-level singleton ───────────────────────────────────────────────────
// One timer for all subscribers — polls aggregate status across ALL user instances.

let _status           = 'unknown'
let _disconnectReason = null  // { key, label, code } | null
let _connectedCount   = 0
let _totalCount       = 0
let _timerId          = null
let _userToken        = null
const _subscribers    = new Set()

let _skipWwebjs = 0

function _notify() {
  _subscribers.forEach(fn => fn(_status, _disconnectReason, _connectedCount, _totalCount))
}

function _startPolling(token) {
  if (_timerId) { clearTimeout(_timerId); _timerId = null }
  _userToken = token

  async function _tick() {
    let allFailed = false
    try {
      const headers = { 'x-user-token': _userToken }
      const _empty = Promise.resolve({ ok: false })
      const now = Date.now()
      const [wwRes] = await Promise.allSettled([
        (_skipWwebjs && now - _skipWwebjs < SKIP_TTL) ? _empty : fetch('/api/wwebjs/instances/user-status', { headers }),
      ])
      const ww = wwRes.status === 'fulfilled' && wwRes.value.ok ? await wwRes.value.json() : null

      allFailed = ww === null

      if (ww !== null) _skipWwebjs = ww.total === 0 ? now : 0

      _connectedCount = ww?.connected_count ?? 0
      _totalCount     = ww?.total ?? 0
      _status = ww?.connected ? 'connected' : 'disconnected'

      const reasonSource = (!ww?.connected && ww?.disconnect_reason) ? ww : null
      _disconnectReason = (_status === 'disconnected' && reasonSource)
        ? { key: reasonSource.disconnect_reason, label: reasonSource.disconnect_reason_label || 'Desconectada', code: reasonSource.disconnect_code ?? null }
        : null
    } catch {
      _status = 'disconnected'
      _disconnectReason = null
      allFailed = true
    }
    _notify()
    if (_subscribers.size > 0) {
      const delay = _status === 'connected' ? POLL_CONNECTED : allFailed ? POLL_UNREACHABLE : POLL_DISCONNECTED
      _timerId = setTimeout(_tick, delay)
    }
  }

  _tick()
}

function _stopPolling() {
  if (_timerId) { clearTimeout(_timerId); _timerId = null }
  _userToken = null
  _status = 'unknown'
  _disconnectReason = null
  _connectedCount = 0
  _totalCount = 0
  _skipWwebjs = 0
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInstanceStatus() {
  const { user } = useUser()
  const [status,           setStatus]           = useState(_status)
  const [disconnectReason, setDisconnectReason] = useState(_disconnectReason)
  const [connectedCount,   setConnectedCount]   = useState(_connectedCount)
  const [totalCount,       setTotalCount]       = useState(_totalCount)

  useEffect(() => {
    const token = user?.session_token
    if (!token) {
      setStatus('disconnected')
      setDisconnectReason(null)
      return
    }

    const notify = (s, r, cc, tc) => {
      setStatus(s)
      setDisconnectReason(r)
      setConnectedCount(cc)
      setTotalCount(tc)
    }
    _subscribers.add(notify)

    if (token !== _userToken) {
      _startPolling(token)
    } else {
      setStatus(_status)
      setDisconnectReason(_disconnectReason)
      setConnectedCount(_connectedCount)
      setTotalCount(_totalCount)
    }

    return () => {
      _subscribers.delete(notify)
      if (_subscribers.size === 0) _stopPolling()
    }
  }, [user?.session_token])

  return {
    status,
    isConnected:      status === 'connected',
    isDisconnected:   status === 'disconnected',
    disconnectReason,
    connectedCount,
    totalCount,
  }
}
