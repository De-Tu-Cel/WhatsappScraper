'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { authFetch } from '@/lib/api'

// Polls a backend-persisted scrape job (see backEnd/app/scrape_jobs.py) instead
// of running the scrape loop in the browser — a page refresh no longer kills an
// in-progress batch. One hook instance per surface (search/batch/csv), each
// remembering its own active job id in localStorage so a fresh page load
// reattaches to whichever job was running instead of showing an empty state.
const POLL_RUNNING = 3000
const POLL_IDLE     = 15000
const TERMINAL      = ['done', 'cancelled', 'error']
// Stable reference for "no results yet" — `job?.results || []` would otherwise
// construct a BRAND NEW empty array on every render while job is null/results-less,
// which downstream useMemo/useEffect(..., [scrapeJob.results]) chains treat as a
// changed dependency every single render, causing an infinite render loop.
const EMPTY_RESULTS = []

export function useScrapeJob(surface) {
  const storageKey = `scrape_job_${surface}`
  const [job,   setJob]   = useState(null)
  const [jobId, setJobId] = useState(null)
  const timerRef   = useRef(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async (id) => {
    if (!id) return
    try {
      const res = await authFetch(`/api/scrape-jobs/${id}`)
      if (!res.ok) {
        if (mountedRef.current) { setJob(null); setJobId(null) }
        localStorage.removeItem(storageKey)
        return
      }
      const data = await res.json()
      if (!mountedRef.current) return
      setJob(data)
      if (!TERMINAL.includes(data.status)) {
        const delay = document.hidden ? POLL_IDLE : POLL_RUNNING
        timerRef.current = setTimeout(() => poll(id), delay)
      }
    } catch {
      timerRef.current = setTimeout(() => poll(id), POLL_IDLE)
    }
  }, [storageKey])

  useEffect(() => {
    mountedRef.current = true
    const saved = localStorage.getItem(storageKey)
    if (saved) { setJobId(saved); poll(saved) }
    return () => { mountedRef.current = false; if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async (urls) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setJob(null)
    const res = await authFetch('/api/scrape-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface, urls }),
    })
    if (!res.ok) throw new Error('No se pudo iniciar el scraping')
    const data = await res.json()
    setJobId(data._id)
    localStorage.setItem(storageKey, data._id)
    setJob(data)
    poll(data._id)
    return data
  }, [surface, storageKey, poll])

  const act = useCallback(async (action) => {
    if (!jobId) return
    const res = await authFetch(`/api/scrape-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      const data = await res.json()
      setJob(data)
      if (action === 'cancel') localStorage.removeItem(storageKey)
    }
  }, [jobId, storageKey])

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setJob(null); setJobId(null)
    localStorage.removeItem(storageKey)
  }, [storageKey])

  const total      = job?.total_count || 0
  const processed  = job?.processed_count || 0
  const status     = job?.status || null

  return {
    job,
    results:    job?.results || EMPTY_RESULTS,
    total, processed,
    progress:   total > 0 ? Math.round((processed / total) * 100) : 0,
    currentUrl: job?.current_urls?.[0] || '',
    status,
    processing: status === 'pending' || status === 'running',
    paused:     !!job?.paused,
    done:       TERMINAL.includes(status),
    start,
    pause:  () => act('pause'),
    resume: () => act('resume'),
    cancel: () => act('cancel'),
    reset,
  }
}
