'use client'
import { createContext, useContext, useState, useRef, useCallback, useEffect, startTransition } from 'react'
import { authFetch } from '@/lib/api'
import { loadSendConfig } from '@/lib/sendConfig'

const SendQueueCtx = createContext(null)
export const useSendQueue = () => useContext(SendQueueCtx)

// The actual sending now runs entirely server-side (backEnd/app/send_now_worker.py)
// as a single global FIFO worker — this context just submits jobs and polls the
// shared queue's status, so a page refresh never drops what's mid-send. The
// public API (addJob/addBatch/cancel/active/queueLen/completedCount/queueError)
// is kept byte-identical to the old in-browser-loop version so none of the 6
// call sites (searchProspects/batchProcessor/csvImporter/sendCampaign/
// singleUrlProcessor/databaseViewer) or SendBubble.jsx need to change at all.
const POLL_ACTIVE = 1000
const POLL_IDLE   = 4000
const POLL_ERROR  = 30_000  // slow down when backend is unreachable

export function SendQueueProvider({ children }) {
  const [active,         setActive]         = useState(null)
  const [queueLen,       setQueueLen]       = useState(0)
  const [completedCount, setCompletedCount] = useState(null)
  const [queueError,     setQueueError]     = useState(null)

  const timerRef            = useRef(null)
  const lastCompletedAtRef   = useRef(null)
  const lastErrorAtRef       = useRef(null)
  const dismissedErrorAtRef  = useRef(null)
  const debugActiveRef       = useRef(false)  // true while the Shift+B fake preview is running

  const clearCompleted  = useCallback(() => setCompletedCount(null), [])
  const clearQueueError = useCallback(() => {
    dismissedErrorAtRef.current = lastErrorAtRef.current
    setQueueError(null)
  }, [])

  const poll = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    let fast = false
    let error = false
    if (!debugActiveRef.current) {
      try {
        const res = await authFetch('/api/send-queue/status')
        if (res.ok) {
          const s = await res.json()
          fast = s.phase !== 'idle'
          if (fast) {
            const countdown = s.next_action_at
              ? Math.max(0, Math.ceil((new Date(s.next_action_at) - Date.now()) / 1000))
              : null
            startTransition(() => {
              setActive({ total: s.active_total ?? 1, sent: s.active_sent ?? 0, phase: s.phase, countdown, batch: !!s.active_batch })
            })
          } else {
            setActive(null)
          }
          setQueueLen(s.queue_len || 0)

          if (s.last_completed?.at && s.last_completed.at !== lastCompletedAtRef.current) {
            lastCompletedAtRef.current = s.last_completed.at
            setCompletedCount(s.last_completed.sent)
          }
          if (s.last_error?.at && s.last_error.at !== dismissedErrorAtRef.current) {
            lastErrorAtRef.current = s.last_error.at
            setQueueError(s.last_error.message)
          } else if (!s.last_error) {
            setQueueError(null)
          }
        } else {
          error = true
        }
      } catch { error = true }
    }
    const delay = document.hidden ? POLL_IDLE : (fast ? POLL_ACTIVE : error ? POLL_ERROR : POLL_IDLE)
    timerRef.current = setTimeout(poll, delay)
  }, [])

  useEffect(() => {
    poll()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [poll])

  // Single job (e.g. "Enviar" a una sola empresa/URL, posiblemente a varios números).
  const addJob = useCallback(async (job, label = '') => {
    try {
      await authFetch('/api/send-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: [job], label, send_config: loadSendConfig() }),
      })
    } catch {}
    poll()  // refresh right away instead of waiting for the next tick
  }, [poll])

  // Groups several jobs (e.g. every company in one "Enviar todos" click) under a
  // single batch_id so the completion notification fires once for the whole group.
  const addBatch = useCallback(async (jobs, label = '') => {
    if (!jobs?.length) return
    try {
      await authFetch('/api/send-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs, label, send_config: loadSendConfig() }),
      })
    } catch {}
    poll()
  }, [poll])

  const cancel = useCallback(async () => {
    try { await authFetch('/api/send-queue/cancel', { method: 'POST' }) } catch {}
    poll()
  }, [poll])

  // Shift+B local preview — never touches the real queue, so it's guarded against
  // the poll loop overwriting it mid-animation (debugActiveRef).
  const debugBubble = useCallback(async () => {
    if (debugActiveRef.current) return
    debugActiveRef.current = true
    setQueueLen(2)
    const total = 5
    let allSent = 0
    for (let i = 0; i < total; i++) {
      setActive({ total, sent: i, phase: 'sending', countdown: null })
      await new Promise(r => setTimeout(r, 700))
      allSent++
      if (i < total - 1) {
        const end = Date.now() + 12000
        await new Promise(resolve => {
          const tick = () => {
            const rem = end - Date.now()
            if (rem <= 0) { resolve(); return }
            startTransition(() => {
              setActive({ total, sent: i + 1, phase: 'waiting', countdown: Math.ceil(rem / 1000) })
            })
            setTimeout(tick, 200)
          }
          tick()
        })
      }
    }
    setActive({ phase: 'success', sent: allSent, total: allSent })
    setTimeout(() => {
      setActive(null)
      setQueueLen(0)
      setCompletedCount(allSent)
      debugActiveRef.current = false
    }, 1800)
  }, [])

  return (
    <SendQueueCtx.Provider value={{ addJob, addBatch, cancel, active, queueLen, debugBubble, completedCount, clearCompleted, queueError, clearQueueError }}>
      {children}
    </SendQueueCtx.Provider>
  )
}
