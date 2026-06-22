'use client'
import { useState, useEffect } from 'react'
import { useUser } from '../context/UserContext'

/**
 * Polls Evolution API instance connection status every 30s.
 * Returns { status: 'connected' | 'disconnected' | 'unknown' }
 */
export function useInstanceStatus() {
  const { user } = useUser()
  const [status, setStatus] = useState('unknown')

  useEffect(() => {
    const instanceName = user?.evolution_instance
    if (!instanceName) { setStatus('disconnected'); return }

    async function check() {
      try {
        const res = await fetch(`/api/evolution/instance/${instanceName}?type=status`)
        if (!res.ok) { setStatus('disconnected'); return }
        const d = await res.json()
        const state = d.instance?.state || d.state || ''
        setStatus(state === 'open' ? 'connected' : 'disconnected')
      } catch {
        setStatus('disconnected')
      }
    }

    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [user?.evolution_instance])

  return {
    status,
    isConnected:    status === 'connected',
    isDisconnected: status === 'disconnected',
  }
}
