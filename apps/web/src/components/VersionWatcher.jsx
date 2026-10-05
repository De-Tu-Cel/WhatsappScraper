'use client'

import { useEffect } from 'react'

// After a deploy, a tab left open kept running the OLD bundle until the user
// happened to refresh. This polls the running server's build id (/api/build-id)
// and reloads the page as soon as it differs from the one the page was built
// with — a forced update, on purpose: sends and scrape jobs run on the server
// and the page reattaches to them after the reload.
//
// buildId comes from the root layout (read on the server when the page was
// rendered). It used to be read from window.__NEXT_DATA__, which only exists
// in the Pages Router — under the App Router it was always undefined, so the
// watcher switched itself off on every load and never reloaded anything.
const POLL_MS = 2 * 60 * 1000
const RELOADED_KEY = 'version_reloaded_for'

export default function VersionWatcher({ buildId }) {
  useEffect(() => {
    // No id rendered (dev without a build) — take the server's first answer as
    // the baseline instead.
    let current = buildId || null
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/build-id', { cache: 'no-store' })
        const { buildId: live } = await res.json()
        if (cancelled || !live) return
        if (!current) { current = live; return }
        if (live === current) return
        // Loop guard: if a reload for this same new version already happened in
        // this tab and the page still came back old, don't keep reloading.
        let already = null
        try { already = sessionStorage.getItem(RELOADED_KEY) } catch {}
        if (already === live) return
        try { sessionStorage.setItem(RELOADED_KEY, live) } catch {}
        window.location.reload()
      } catch {
        // Network blip / server mid-redeploy — try again on the next tick.
      }
    }

    check()
    const interval = setInterval(check, POLL_MS)
    // Coming back to the tab is when a stale page is most likely to be used.
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [buildId])

  return null
}
