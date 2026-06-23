'use client'
import { useState, useEffect } from 'react'
import { useUser } from '../context/UserContext'

const POLL_DISCONNECTED = 8_000   // 8s when disconnected
const POLL_CONNECTED    = 45_000  // 45s when connected — no need to hammer the server

// ─── Module-level singleton ───────────────────────────────────────────────────
// Only ONE fetch timer runs regardless of how many components mount this hook.
// All subscribers receive the same status update.

let _status       = 'unknown'
let _timerId      = null
let _instanceName = null
const _subscribers = new Set()

function _notify() {
  _subscribers.forEach(fn => fn(_status))
}

function _startPolling(instanceName) {
  if (_timerId) { clearTimeout(_timerId); _timerId = null }
  _instanceName = instanceName

  async function _tick() {
    try {
      const res = await fetch(`/api/evolution/instance/${_instanceName}?type=status`)
      if (!res.ok) {
        _status = 'disconnected'
      } else {
        const d = await res.json()
        const state = d.instance?.state || d.state || ''
        _status = state === 'open' ? 'connected' : 'disconnected'
      }
    } catch {
      _status = 'disconnected'
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
  _instanceName = null
  _status = 'unknown'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInstanceStatus() {
  const { user } = useUser()
  const [status, setStatus] = useState(_status)

  useEffect(() => {
    const instanceName = user?.evolution_instance
    if (!instanceName) {
      setStatus('disconnected')
      return
    }

    // Subscribe
    _subscribers.add(setStatus)

    if (instanceName !== _instanceName) {
      // New instance or first subscriber — start/restart the singleton poll
      _startPolling(instanceName)
    } else {
      // Already polling — just sync current known status
      setStatus(_status)
    }

    return () => {
      _subscribers.delete(setStatus)
      if (_subscribers.size === 0) _stopPolling()
    }
  }, [user?.evolution_instance])

  return {
    status,
    isConnected:    status === 'connected',
    isDisconnected: status === 'disconnected',
  }
}
