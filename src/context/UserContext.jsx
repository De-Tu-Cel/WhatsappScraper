'use client'
import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

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
    const token = user?.token
    if (token) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-user-token': token } }).catch(() => {})
      localStorage.removeItem('user_token')
    }
    setUser(null)
  }

  return (
    <UserContext.Provider value={{ user, loading, login, register, logout, fetchMe }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
