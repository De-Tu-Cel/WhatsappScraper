'use client'
import { useState, useEffect } from 'react'
import { useUser } from '../context/UserContext'

const POLL_DISCONNECTED = 10_000  // 10s when disconnected
const POLL_CONNECTED    = 45_000  // 45s when connected

// ─── Module-level singleton ───────────────────────────────────────────────────
// One timer for all subscribers — polls aggregate status across ALL user instances.

let _status           = 'unknown'
let _disconnectReason = null  // { key, label, code } | null
let _connectedCount   = 0
let _totalCount       = 0
let _timerId          = null
let _userToken        = null
const _subscribers    = new Set()

function _notify() {
  _subscribers.forEach(fn => fn(_status, _disconnectReason, _connectedCount, _totalCount))
}

function _startPolling(token) {
  if (_timerId) { clearTimeout(_timerId); _timerId = null }
  _userToken = token

  async function _tick() {
    try {
      const res = await fetch('/api/evolution/instances/user-status', {
        headers: { 'x-user-token': _userToken },
      })
      if (!res.ok) {
        _status = 'disconnected'
        _disconnectReason = null
      } else {
        const d = await res.json()
        _connectedCount = d.connected_count ?? 0
        _totalCount     = d.total ?? 0
        _status = d.connected ? 'connected' : 'disconnected'
        _disconnectReason = (!d.connected && d.disconnect_reason)
          ? { key: d.disconnect_reason, label: d.disconnect_reason_label || 'Desconectada', code: d.disconnect_code ?? null }
          : null
      }
    } catch {
      _status = 'disconnected'
      _disconnectReason = null
    }
    _notify()
    if (_subscribers.size > 0) {
      const delay = _status === 'connected' ? POLL_CONNECTED : POLL_DISCONNECTED
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
