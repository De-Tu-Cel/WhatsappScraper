'use client'

import { useEffect } from 'react'
import { useUser } from '../context/UserContext'

// Pings /auth/heartbeat every 45s while this tab is actually visible, so the
// admin's "Connected" column in AdminPanel.jsx can show who's genuinely using
// the app right now — separate from (and previously confused with) whether a
// user's WhatsApp instance happens to be connected. Only pings while the
// document is visible, not from a background/minimized tab, so it reflects
// active use rather than just "a tab is open somewhere".
const INTERVAL_MS = 45 * 1000

export default function PresenceHeartbeat() {
  const { user } = useUser()
  const token = user?.token

  useEffect(() => {
    if (!token) return

    const ping = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/auth/heartbeat', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
    }

    ping() // immediate, so "just opened the app" doesn't wait a full interval
    const interval = setInterval(ping, INTERVAL_MS)
    document.addEventListener('visibilitychange', ping)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', ping)
    }
  }, [token])

  return null
}
