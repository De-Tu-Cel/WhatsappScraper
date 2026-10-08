'use client'

import { useEffect } from 'react'
import {
  VERSION_RELOAD_GRACE_MS, buildIdRequestUrl, clockJumped,
  decideVersionReload, readLastActivity, stripVersionParam, versionReloadUrl,
} from '../lib/sessionGuard'

// After a deploy, a tab left open kept running the OLD bundle until the user
// happened to refresh. This polls the running server's build id (/api/build-id)
// and reloads the page as soon as it differs from the one the page was built
// with — a forced update, on purpose: sends and scrape jobs run on the server
// and the page reattaches to them after the reload. The reloaded page then
// signs the user out (UserContext: a session belongs to the version it signed
// in with) only if the mismatch is still there after the login grace.
//
// buildId comes from the root layout (read on the server when the page was
// rendered). It used to be read from window.__NEXT_DATA__, which only exists
// in the Pages Router — under the App Router it was always undefined, so the
// watcher switched itself off on every load and never reloaded anything.
//
// Safari / Mac (2026-10-07): el intervalo de 2 min y visibilitychange no
// bastan. Con la tapa cerrada la página se congela y, al abrirla, si la
// pestaña ya estaba visible, Safari no avisa. Por eso también se revisa al
// enfocar, al restaurar de memoria (pageshow), al reanudar, y en el primer
// uso si el reloj de pared saltó.
//
// Antonio (2026-10-08): el check() del montaje + un id cacheado hacía
// location.replace mientras la página aún cargaba. Chrome/Safari abortaban
// y mostraban "This page couldn't load". No se recarga en el primer pintado
// ni a los segundos de entrar; hace falta ver el id nuevo dos veces.
const POLL_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 5 * 1000
const CONFIRM_MS = 3 * 1000
const RELOADED_KEY = 'version_reloaded_for'

export default function VersionWatcher({ buildId }) {
  useEffect(() => {
    let current = buildId || null
    let pending = null
    let cancelled = false
    let checking = false
    let again = false
    let lastTick = Date.now()
    let confirmTimer = null
    let graceTimer = null

    try {
      const clean = stripVersionParam(window.location.href)
      if (clean) window.history.replaceState(null, '', clean)
    } catch {}

    function alreadyFor() {
      try { return sessionStorage.getItem(RELOADED_KEY) } catch { return null }
    }

    async function check() {
      if (checking) { again = true; return }
      checking = true
      try {
        const res = await fetch(buildIdRequestUrl(), {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
        })
        const { buildId: live } = await res.json()
        if (cancelled || !live) return
        const lastAct = readLastActivity(localStorage)
        const decision = decideVersionReload({
          pageBuildId: current,
          liveBuildId: live,
          pendingLive: pending,
          alreadyReloadedFor: alreadyFor(),
          documentComplete: document.readyState === 'complete',
          pageAgeMs: performance.now(),
          msSinceActivity: lastAct ? Date.now() - lastAct : null,
        })
        pending = decision.pending
        if (decision.action === 'adopt') current = live
        if (decision.action === 'confirm') {
          clearTimeout(confirmTimer)
          confirmTimer = setTimeout(() => { if (!cancelled) check() }, CONFIRM_MS)
          return
        }
        if (decision.action !== 'reload') return
        try { sessionStorage.setItem(RELOADED_KEY, live) } catch {}
        window.location.replace(versionReloadUrl(window.location.href, live))
      } catch {
        // Network blip / server mid-redeploy — try again on the next tick.
      } finally {
        checking = false
        if (again && !cancelled) { again = false; check() }
      }
    }

    function noteTick() {
      const now = Date.now()
      const jumped = clockJumped(lastTick, now)
      lastTick = now
      return jumped
    }

    function onWake() {
      if (document.visibilityState === 'hidden') return
      if (noteTick()) check()
    }

    // Volver a la pestaña sí debe revisar aunque el reloj no haya saltado:
    // un temporizador en segundo plano puede no haberse ejecutado.
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      lastTick = Date.now()
      check()
    }

    // La página que acaba de llegar ES esta versión. El primer check espera
    // a que termine de pintar; si no, un id cacheado aborta la carga.
    const graceLeft = Math.max(0, VERSION_RELOAD_GRACE_MS - performance.now())
    const startWhenReady = () => {
      if (cancelled) return
      graceTimer = setTimeout(check, graceLeft)
    }
    if (document.readyState === 'complete') startWhenReady()
    else window.addEventListener('load', startWhenReady, { once: true })

    const interval = setInterval(() => { lastTick = Date.now(); check() }, POLL_MS)
    const heartbeat = setInterval(() => { if (noteTick()) check() }, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    document.addEventListener('resume', onWake)
    return () => {
      cancelled = true
      clearTimeout(confirmTimer)
      clearTimeout(graceTimer)
      clearInterval(interval)
      clearInterval(heartbeat)
      window.removeEventListener('load', startWhenReady)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      document.removeEventListener('resume', onWake)
    }
  }, [buildId])

  return null
}
