'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '@/lib/api'

// Nombre del evento que InstancesPanel.jsx dispara al prender/apagar warmup en
// un número — sin esto, un badge de cupo ya montado en otra pestaña (search/
// batch/csv/campaña/programados/URL individual, que se quedan montadas en
// segundo plano al cambiar de pestaña) se queda con el cupo viejo hasta que
// algo más (un envío) lo refresque por su cuenta.
export const INSTANCES_CHANGED_EVENT = 'wa-instances-changed'

// Extraído del patrón que ya usaba sendCampaign.jsx (fetchDailyStats/dailyStats) —
// GET /api/instances/daily-stats ya devuelve todo lo necesario para mostrar cupo
// diario por instancia conectada (warmup o no) y el total combinado disponible.
export function useDailyCapStats() {
  const [stats, setStats] = useState(null)
  const requestSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined' || !localStorage.getItem('user_token')) return null
    const seq = ++requestSeq.current
    try {
      const r = await authFetch('/api/instances/daily-stats')
      if (r.ok) {
        const data = await r.json()
        if (seq === requestSeq.current) setStats(data)
        return data
      }
    } catch {}
    if (seq === requestSeq.current) setStats(null)
    return null
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    window.addEventListener(INSTANCES_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.removeEventListener(INSTANCES_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])
  // 2026-10-14: detectar también la caída de una de varias sesiones conectadas.
  useEffect(() => {
    const id = setInterval(refresh, 30 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  return { stats, refresh }
}

// Cupo combinado ESTIMADO para un día futuro (usado al programar un envío) — a
// diferencia de useDailyCapStats, no hay desglose por instancia posible aquí: qué
// instancia atenderá una empresa aún no contactada solo se resuelve al momento de
// enviar, no al programar.
export function useDailyCapForDate(dateStr, excludeId) {
  const [stats, setStats] = useState(null)

  const fetchStats = useCallback(() => {
    if (!dateStr) { setStats(null); return }
    authFetch(`/api/instances/capacity-for-date?date=${dateStr}${excludeId ? `&exclude_id=${excludeId}` : ''}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setStats(data))
      .catch(() => setStats(null))
  }, [dateStr, excludeId])

  useEffect(() => { fetchStats() }, [fetchStats])
  useEffect(() => {
    window.addEventListener(INSTANCES_CHANGED_EVENT, fetchStats)
    return () => window.removeEventListener(INSTANCES_CHANGED_EVENT, fetchStats)
  }, [fetchStats])

  return stats
}
