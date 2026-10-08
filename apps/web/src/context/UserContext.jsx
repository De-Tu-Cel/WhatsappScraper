'use client'
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  INACTIVITY_MS, WARNING_MS, buildIdRequestUrl, clockJumped,
  inactivityLeft, readLastActivity, writeLastActivity,
} from '../lib/sessionGuard'

const UserContext = createContext(null)

const INACTIVITY_TIMEOUT = INACTIVITY_MS   // 30 min → logout
const WARNING_BEFORE     = WARNING_MS      // show warning 3 min before

// A session belongs to the version of the app it signed in with: after a
// deploy, everyone signs in again instead of carrying on with whatever the old
// version left in the browser (asked for on 2026-10-05). VersionWatcher reloads
// open tabs on a new version; fetchMe below then sees the mismatch.
const BUILD_KEY = 'user_token_build'
export const LOGOUT_REASON_KEY = 'logout_reason'

async function liveBuildId() {
  try {
    // Misma query con hora que VersionWatcher: Safari guardaba el build viejo.
    const res = await fetch(buildIdRequestUrl(), {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    })
    return res.ok ? (await res.json()).buildId || null : null
  } catch {
    return null
  }
}

export function UserProvider({ children }) {
  const [user,        setUser]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [showWarning, setShowWarning] = useState(false)
  const [countdown,   setCountdown]   = useState(0)  // seconds remaining

  const logoutTimerRef  = useRef(null)
  const warnTimerRef    = useRef(null)
  const countdownRef    = useRef(null)
  const showWarningRef  = useRef(false)

  const fetchMe = useCallback(async () => {
    const token = localStorage.getItem('user_token')
    if (!token) { setLoading(false); return }
    // Pestaña descartada y vuelta a abrir horas después (Safari, 2026-10-07):
    // el temporizador no sobrevivió, pero la marca de actividad sí.
    const idleFor = inactivityLeft(readLastActivity(localStorage), Date.now())
    if (idleFor <= 0) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
      localStorage.removeItem('user_token')
      localStorage.removeItem(BUILD_KEY)
      setLoading(false)
      return
    }
    // No build id (dev server, or the request failed) → can't tell, keep the session.
    const live = await liveBuildId()
    if (live && localStorage.getItem(BUILD_KEY) !== live) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
      localStorage.removeItem('user_token')
      localStorage.removeItem(BUILD_KEY)
      try { sessionStorage.setItem(LOGOUT_REASON_KEY, 'update') } catch {}
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/auth/me', { headers: { 'x-user-token': token } })
      if (res.ok) {
        const data = await res.json()
        setUser({ ...data, token })
      } else {
        localStorage.removeItem('user_token')
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchMe() }, [fetchMe])

  // ── Inactivity timer ────────────────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (logoutTimerRef.current)  clearTimeout(logoutTimerRef.current)
    if (warnTimerRef.current)    clearTimeout(warnTimerRef.current)
    if (countdownRef.current)    clearInterval(countdownRef.current)
    setShowWarning(false)
    setCountdown(0)
  }, [])

  const doLogout = useCallback(async () => {
    clearTimers()
    const token = localStorage.getItem('user_token')
    if (token) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
      localStorage.removeItem('user_token')
      localStorage.removeItem(BUILD_KEY)
    }
    setUser(null)
  }, [clearTimers])

  // left es el tiempo que de verdad falta, no otros 30 min. Si la página estuvo
  // congelada, el setTimeout no corrió pero la marca en localStorage sí envejeció.
  const armTimers = useCallback((left) => {
    clearTimers()
    if (left <= 0) return
    const startWarning = () => {
      setShowWarning(true)
      let secs = Math.max(1, Math.round(Math.min(left, WARNING_BEFORE) / 1000))
      setCountdown(secs)
      countdownRef.current = setInterval(() => {
        secs -= 1
        setCountdown(Math.max(0, secs))
        if (secs <= 0 && countdownRef.current) clearInterval(countdownRef.current)
      }, 1000)
    }
    if (left <= WARNING_BEFORE) startWarning()
    else warnTimerRef.current = setTimeout(startWarning, left - WARNING_BEFORE)
    logoutTimerRef.current = setTimeout(() => {
      const still = inactivityLeft(readLastActivity(localStorage), Date.now())
      if (still <= 0) doLogout()
      else armTimers(still)
    }, left)
  }, [clearTimers, doLogout])

  const resetTimers = useCallback(() => {
    if (!localStorage.getItem('user_token')) return
    writeLastActivity(localStorage)
    armTimers(INACTIVITY_TIMEOUT)
  }, [armTimers])

  useEffect(() => { showWarningRef.current = showWarning }, [showWarning])

  // La advertencia NO puede ser dependencia de este efecto: al mostrarla el
  // efecto se re-ejecutaba, clearTimers cancelaba el cierre y volvía a contar
  // 30 min. La sesión no se cerraba nunca (2026-10-07).
  useEffect(() => {
    if (!user) { clearTimers(); return }
    if (!readLastActivity(localStorage)) writeLastActivity(localStorage)
    const left = inactivityLeft(readLastActivity(localStorage), Date.now())
    if (left <= 0) { doLogout(); return }
    armTimers(left)

    let lastArm = 0
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    const onActivity = () => {
      const now = Date.now()
      if (!showWarningRef.current && now - lastArm < 5000) return
      lastArm = now
      resetTimers()
    }

    let lastTick = Date.now()
    const catchUp = () => {
      const remain = inactivityLeft(readLastActivity(localStorage), Date.now())
      if (remain <= 0) doLogout()
      else armTimers(remain)
    }
    const onWake = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      const jumped = clockJumped(lastTick, now)
      lastTick = now
      if (jumped) catchUp()
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      lastTick = Date.now()
      catchUp()
    }
    const heartbeat = setInterval(() => {
      const now = Date.now()
      if (!clockJumped(lastTick, now)) { lastTick = now; return }
      lastTick = now
      catchUp()
    }, 5000)

    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onWake)
    window.addEventListener('pageshow', onWake)
    document.addEventListener('resume', onWake)
    return () => {
      clearInterval(heartbeat)
      clearTimers()
      events.forEach(e => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onWake)
      window.removeEventListener('pageshow', onWake)
      document.removeEventListener('resume', onWake)
    }
  }, [user, armTimers, clearTimers, doLogout, resetTimers])

  // ── Auth functions ───────────────────────────────────────────────────────────
  async function login(username, pin) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    })
    if (!res.ok) throw new Error((await res.json()).detail || 'Error de autenticación')
    const data = await res.json()
    const live = await liveBuildId()
    if (live) localStorage.setItem(BUILD_KEY, live)
    writeLastActivity(localStorage)
    localStorage.setItem('user_token', data.session_token)
    setUser({ ...data, token: data.session_token })
    return data
  }

  async function register(username, display_name, pin) {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, display_name, pin }),
    })
    if (!res.ok) throw new Error((await res.json()).detail || 'Error al registrar')
    return login(username, pin)
  }

  async function logout() {
    clearTimers()
    const token = user?.token
    if (token) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
      localStorage.removeItem('user_token')
      localStorage.removeItem(BUILD_KEY)
    }
    setUser(null)
  }

  return (
    <UserContext.Provider value={{
      user, loading, login, register, logout, fetchMe,
      showWarning, countdown, stayLoggedIn: resetTimers,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
