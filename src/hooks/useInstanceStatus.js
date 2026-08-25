'use client'
import { useState, useEffect } from 'react'
import { useUser } from '../context/UserContext'

const POLL_DISCONNECTED = 10_000  // 10s when disconnected but reachable
const POLL_CONNECTED    = 45_000  // 45s when connected
const POLL_UNREACHABLE  = 30_000  // 30s when backend times out / all fail

// ─── Module-level singleton ───────────────────────────────────────────────────
// One timer for all subscribers — polls aggregate status across ALL user instances.

let _status           = 'unknown'
let _disconnectReason = null  // { key, label, code } | null
let _connectedCount   = 0
let _totalCount       = 0
let _timerId          = null
let _userToken        = null
const _subscribers    = new Set()

// Skip polling providers that returned total:0 — avoids pointless HTTP calls/tick
// when the user only has instances on one provider.
let _skipEvo    = false
let _skipWaha   = false
let _skipWwebjs = false

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
      const [evoRes, wahaRes, wsRes, wwRes] = await Promise.allSettled([
        _skipEvo    ? _empty : fetch('/api/evolution/instances/user-status', { headers }),
        _skipWaha   ? _empty : fetch('/api/waha/instances/user-status',      { headers }),
        fetch('/api/wasender/instances/user-status', { headers }),
        _skipWwebjs ? _empty : fetch('/api/wwebjs/instances/user-status',    { headers }),
      ])
      const evo  = evoRes.status  === 'fulfilled' && evoRes.value.ok  ? await evoRes.value.json()  : null
      const waha = wahaRes.status === 'fulfilled' && wahaRes.value.ok ? await wahaRes.value.json() : null
      const ws   = wsRes.status   === 'fulfilled' && wsRes.value.ok   ? await wsRes.value.json()   : null
      const ww   = wwRes.status   === 'fulfilled' && wwRes.value.ok   ? await wwRes.value.json()   : null

      // If every non-skipped provider failed to respond, treat as unreachable
      allFailed = evo === null && waha === null && ws === null && ww === null

      // Remember which providers have no instances — skip until user comes back with instances
      if (evo  !== null) _skipEvo    = evo.total  === 0
      if (waha !== null) _skipWaha   = waha.total === 0
      if (ww   !== null) _skipWwebjs = ww.total   === 0

      const evoConnected  = evo?.connected  ?? false
      const wahaConnected = waha?.connected ?? false
      const wsConnected   = ws?.connected   ?? false
      const wwConnected   = ww?.connected   ?? false
      _connectedCount = (evo?.connected_count ?? 0) + (waha?.connected_count ?? 0) + (ws?.connected_count ?? 0) + (ww?.connected_count ?? 0)
      _totalCount     = (evo?.total ?? 0)           + (waha?.total ?? 0)           + (ws?.total ?? 0)           + (ww?.total ?? 0)
      _status = (evoConnected || wahaConnected || wsConnected || wwConnected) ? 'connected' : 'disconnected'

      // Prefer WAHA disconnect reason if multiple are down (WAHA errors are more specific)
      const reasonSource = (!wahaConnected && waha?.disconnect_reason) ? waha
                         : (!wsConnected   && ws?.disconnect_reason)   ? ws
                         : (!evoConnected  && evo?.disconnect_reason)  ? evo
                         : null
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
  _skipEvo    = false
  _skipWaha   = false
  _skipWwebjs = false
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
