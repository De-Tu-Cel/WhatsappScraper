'use client'
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/api'

// Nombre del evento que InstancesPanel.jsx dispara al prender/apagar warmup en
// un número — sin esto, un badge de cupo ya montado en otra pestaña (search/
// batch/csv/campaña/programados/URL individual, que se quedan montadas en
// segundo plano al cambiar de pestaña) se queda con el cupo viejo hasta que
// algo más (un envío) lo refresque por su cuenta.
export const INSTANCES_CHANGED_EVENT = 'wa-instances-changed'

// Extraído del patrón que ya usaba sendCampaign.jsx (fetchDailyStats/dailyStats) —
// GET /api/instances/daily-stats ya devuelve todo lo necesario para mostrar cupo
// diario por instancia (warmup o no) y el total combinado, sin tocar el backend.
export function useDailyCapStats() {
  const [stats, setStats] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const r = await authFetch('/api/instances/daily-stats')
      if (r.ok) setStats(await r.json())
    } catch {}
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    window.addEventListener(INSTANCES_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(INSTANCES_CHANGED_EVENT, refresh)
  }, [refresh])
  // Poll every 5 min so the banner disappears automatically after midnight reset
  // or when a new session is added outside this browser tab.
  useEffect(() => {
    const id = setInterval(refresh, 5 * 60 * 1000)
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
