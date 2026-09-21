'use client'
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const UserContext = createContext(null)

const INACTIVITY_TIMEOUT = 30 * 60 * 1000   // 30 min → logout
const WARNING_BEFORE     =  3 * 60 * 1000   // show warning 3 min before

export function UserProvider({ children }) {
  const [user,        setUser]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [showWarning, setShowWarning] = useState(false)
  const [countdown,   setCountdown]   = useState(0)  // seconds remaining

  const logoutTimerRef  = useRef(null)
  const warnTimerRef    = useRef(null)
  const countdownRef    = useRef(null)

  const fetchMe = useCallback(async () => {
    const token = localStorage.getItem('user_token')
    if (!token) { setLoading(false); return }
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
    }
    setUser(null)
  }, [clearTimers])

  const resetTimers = useCallback(() => {
    if (!localStorage.getItem('user_token')) return
    clearTimers()

    // Warning timer
    warnTimerRef.current = setTimeout(() => {
      setShowWarning(true)
      let secs = Math.round(WARNING_BEFORE / 1000)
      setCountdown(secs)
      countdownRef.current = setInterval(() => {
        secs -= 1
        setCountdown(secs)
        if (secs <= 0) clearInterval(countdownRef.current)
      }, 1000)
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE)

    // Logout timer
    logoutTimerRef.current = setTimeout(() => {
      doLogout()
    }, INACTIVITY_TIMEOUT)
  }, [clearTimers, doLogout])

  // Listen for activity events
  useEffect(() => {
    if (!user) { clearTimers(); return }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    const onActivity = () => {
      if (showWarning) setShowWarning(false)
      resetTimers()
    }

    resetTimers()
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    return () => {
      clearTimers()
      events.forEach(e => window.removeEventListener(e, onActivity))
    }
  }, [user, resetTimers, clearTimers, showWarning])

  // ── Auth functions ───────────────────────────────────────────────────────────
  async function login(username, pin) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin }),
    })
    if (!res.ok) throw new Error((await res.json()).detail || 'Error de autenticación')
    const data = await res.json()
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
