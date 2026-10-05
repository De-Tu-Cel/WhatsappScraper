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
  const timerRef    = useRef(null)
  const mountedRef  = useRef(true)

  // Named function expression so the recursive self-reference below resolves
  // to this function's own binding instead of the outer `const poll` (still
  // in its temporal dead zone from the closure's point of view).
  const poll = useCallback(async function poll(id) {
    if (!id) return
    try {
      const res = await authFetch(`/api/scrape-jobs/${id}`)
      if (!res.ok) {
        // Only forget the job on 404 (truly gone). 5xx/other transient errors
        // (e.g. MongoDB briefly down) should not erase localStorage — the job
        // still exists on the server and will be recoverable once it's back.
        if (res.status === 404 && mountedRef.current) {
          setJob(null); setJobId(null)
          localStorage.removeItem(storageKey)
        }
        return
      }
      const data = await res.json()
      if (!mountedRef.current) return
      // Guard: job belongs to a different surface (e.g. a stale search job ID
      // stored under scrape_job_batch). Clear and show empty state.
      if (data.surface && data.surface !== surface) {
        localStorage.removeItem(storageKey)
        setJob(null); setJobId(null)
        return
      }
      // Stale terminal job (>24h old) → show clean state instead of old results
      if (TERMINAL.includes(data.status) && data.finished_at) {
        const age = Date.now() - new Date(data.finished_at).getTime()
        if (age > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(storageKey)
          setJob(null); setJobId(null)
          return
        }
      }
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
    if (saved) {
      setJobId(saved); poll(saved)
    } else {
      // localStorage was cleared (e.g. by a transient 500 while MongoDB was down).
      // Ask the backend for the most recent non-terminal job for this surface so
      // the user sees their in-progress scrape again after a reconnect/refresh.
      authFetch(`/api/scrape-jobs/latest?surface=${surface}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?._id || !mountedRef.current) return
          localStorage.setItem(storageKey, data._id)
          setJobId(data._id)
          poll(data._id)
        })
        .catch(() => {})
    }
    return () => { mountedRef.current = false; if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // mapsLeads: Google Maps businesses with no website (their url is a Maps
  // link) — the backend builds them from this data instead of scraping.
  // query: the search that produced these URLs, shown above the results.
  const start = useCallback(async (urls, mapsLeads = [], query = '') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setJob(null)
    const res = await authFetch('/api/scrape-jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface, urls, ...(mapsLeads.length ? { maps_leads: mapsLeads } : {}), ...(query ? { query } : {}) }),
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
      // Poll right away instead of waiting out the 3s tick, so "Pausando… / Pausado"
      // shows up as soon as the click lands.
      if (!TERMINAL.includes(data.status)) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => poll(jobId), 800)
      }
      // On cancel: keep the job in localStorage so the "N pending URLs / Reanudar"
      // banner survives a page refresh. reset() (the X button) is the explicit clear.
      if (action === 'reanudar') {
        // Job went back to 'pending' — ensure it's in localStorage and restart poll.
        localStorage.setItem(storageKey, jobId)
        if (timerRef.current) clearTimeout(timerRef.current)
        poll(jobId)
      }
    }
  }, [jobId, storageKey, poll])

  // The user is done with these results. Also tells the backend, otherwise the
  // /latest fallback above handed the same job back on the next refresh.
  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (jobId) {
      authFetch(`/api/scrape-jobs/${jobId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      }).catch(() => {})
    }
    setJob(null); setJobId(null)
    localStorage.removeItem(storageKey)
  }, [storageKey, jobId])

  const total      = job?.total_count || 0
  const status     = job?.status || null
  const inFlight   = job?.current_urls?.length || 0
  // Pausing = paused, but the URLs already running (≤ 4) are still finishing.
  // The backend records them (graceful pause, see scrape_jobs.py), so the count
  // only ever goes up to where the job actually stops — shown live, no freeze:
  // freezing it at the click and releasing it later is what made it jump.
  const isPausing  = !!job?.paused && inFlight > 0
  const processed  = Math.min(job?.processed_count || 0, total)

  return {
    job,
    results:    job?.results || EMPTY_RESULTS,
    total, processed,
    progress:   total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0,
    currentUrl: job?.current_urls?.[0] || '',
    inFlight,
    status,
    processing: status === 'pending' || status === 'running',
    pausing:    isPausing,
    paused:     !!job?.paused && !(job?.current_urls?.length > 0),
    done:       TERMINAL.includes(status),
    pendingCount: job?.pending_urls_count || 0,
    start,
    pause:    () => act('pause'),
    resume:   () => act('resume'),
    cancel:   () => act('cancel'),
    reanudar: () => act('reanudar'),
    reset,
  }
}
