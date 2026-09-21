'use client'

import { useEffect, useRef } from 'react'

// After a deploy, a tab left open kept running the OLD bundle indefinitely —
// nothing ever told it a new version existed, so a user could sit on stale
// JS/API-calling code until they happened to hit refresh themselves. Polls
// the running server's actual Next.js build id (a fresh random value on
// every `next build`, read server-side in /api/build-id) against the one
// this page loaded with; a mismatch means a new version is live, so this
// reloads automatically instead of leaving the user on the old one.
const POLL_MS = 3 * 60 * 1000

export default function VersionWatcher() {
  const initialBuildId = useRef(null)

  useEffect(() => {
    initialBuildId.current = window.__NEXT_DATA__?.buildId || null
    if (!initialBuildId.current) return // dev mode / buildId unavailable — nothing to compare against

    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/build-id', { cache: 'no-store' })
        const { buildId } = await res.json()
        if (!cancelled && buildId && buildId !== initialBuildId.current) {
          window.location.reload()
        }
      } catch {
        // Network blip / server mid-redeploy — try again on the next tick.
      }
    }

    const interval = setInterval(check, POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return null
}
