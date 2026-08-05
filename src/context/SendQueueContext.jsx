'use client'
import { createContext, useContext, useState, useRef, useCallback, startTransition } from 'react'
import { authFetch } from '@/lib/api'
import { loadSendConfig, randMsgDelayMs, randBatchBreakMs, randBatchSize } from '@/lib/sendConfig'

const SendQueueCtx = createContext(null)
export const useSendQueue = () => useContext(SendQueueCtx)

export function SendQueueProvider({ children }) {
  const queueRef      = useRef([])
  const processingRef = useRef(false)
  const cancelRef     = useRef(false)
  const batchMetaRef  = useRef(new Map()) // batchId -> { remaining, sent, failed, label }
  const [active,         setActive]         = useState(null)
  const [queueLen,       setQueueLen]       = useState(0)
  const [completedCount, setCompletedCount] = useState(null) // null = no toast
  const [queueError,     setQueueError]     = useState(null) // null = no error

  const clearCompleted  = useCallback(() => setCompletedCount(null), [])
  const clearQueueError = useCallback(() => setQueueError(null), [])

  const reportBatchComplete = useCallback((sent, failed, label) => {
    authFetch('/api/notifications/batch-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent, failed, label }),
    }).catch(() => {})
  }, [])

  const processNext = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    cancelRef.current = false

    // Request browser notification permission once
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    let allSent = 0
    // Batch-break tracking spans the whole queue (not just one job/company) so
    // a long anti-detection pause lands every N messages regardless of how
    // they're grouped into jobs — mirrors databaseViewer.jsx's send loop.
    let msgsInBatch = 0
    let nextBreakAt = randBatchSize(loadSendConfig())

    async function waitBetweenMessages(total, sentSoFar) {
      if (cancelRef.current) return
      const cfg = loadSendConfig()
      const isBatchBreak = msgsInBatch >= nextBreakAt
      if (isBatchBreak) {
        msgsInBatch = 0
        nextBreakAt = randBatchSize(cfg)
      }
      const delayMs = isBatchBreak ? randBatchBreakMs(cfg) : randMsgDelayMs(cfg)
      const end = Date.now() + delayMs
      await new Promise(resolve => {
        const tick = () => {
          if (cancelRef.current) { resolve(); return }
          const rem = end - Date.now()
          if (rem <= 0) { resolve(); return }
          startTransition(() => {
            setActive({ total, sent: sentSoFar, phase: 'waiting', countdown: Math.ceil(rem / 1000), batch: isBatchBreak })
          })
          setTimeout(tick, 200)
        }
        tick()
      })
    }

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()
      setQueueLen(queueRef.current.length)
      const { numbers, messages, companyId, website, batchId } = job
      const total = numbers.length
      let jobSent = 0
      let jobFailed = 0

      for (let i = 0; i < total; i++) {
        if (cancelRef.current) break
        setActive({ total, sent: i, phase: 'sending', countdown: null })

        try {
          const res = await authFetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: companyId,
              to_number: numbers[i],
              message: Array.isArray(messages) ? messages[i] : messages,
              website,
            }),
          })
          if (res.ok) {
            allSent++
            jobSent++
          } else {
            jobFailed++
            if (res.status === 503 || res.status === 400) {
              // Fatal: all instances disconnected or no instance configured — stop queue
              const errData = await res.json().catch(() => ({}))
              setQueueError(errData.detail || (res.status === 503 ? 'Instancias desconectadas' : 'Sin instancia configurada'))
              cancelRef.current = true
              break
            }
          }
        } catch {}

        msgsInBatch++
        const isLastMessageOverall = i === total - 1 && queueRef.current.length === 0
        if (!isLastMessageOverall && !cancelRef.current) {
          await waitBetweenMessages(total, i + 1)
        }
      }

      if (batchId && !cancelRef.current) {
        const meta = batchMetaRef.current.get(batchId)
        if (meta) {
          meta.sent   += jobSent
          meta.failed += jobFailed + (total - jobSent - jobFailed) // unprocessed due to cancel
          meta.remaining -= 1
          if (meta.remaining <= 0) {
            batchMetaRef.current.delete(batchId)
            reportBatchComplete(meta.sent, meta.failed, meta.label)
          }
        }
      }

      if (cancelRef.current) break
    }

    // Success flash — bubble shows green checkmark
    setActive({ phase: 'success', sent: allSent, total: allSent })

    // Browser notification if tab is hidden
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      typeof document !== 'undefined' &&
      document.hidden
    ) {
      new Notification('Envíos completados', {
        body: `${allSent} mensaje${allSent !== 1 ? 's' : ''} enviado${allSent !== 1 ? 's' : ''} correctamente`,
        icon: '/favicon.ico',
      })
    }

    // After success animation: hide bubble, show toast
    setTimeout(() => {
      setActive(null)
      setQueueLen(0)
      processingRef.current = false
      setCompletedCount(allSent)
    }, 1800)
  }, [])

  // Single job (e.g. "Enviar" a una sola empresa/URL, posiblemente a varios
  // números). Se le asigna su propio batchId para que también dispare
  // reportBatchComplete al terminar — antes solo los jobs de addBatch
  // generaban notificación, dejando sin aviso los envíos individuales que
  // pasan por la burbuja de timing con varios números/pausas.
  const addJob = useCallback((job, label = '') => {
    const batchId = `j${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    batchMetaRef.current.set(batchId, { remaining: 1, sent: 0, failed: 0, label })
    queueRef.current.push({ ...job, batchId })
    setQueueLen(queueRef.current.length)
    processNext()
  }, [processNext])

  // Groups several jobs (e.g. every company in one "Enviar todos" click) under
  // a single batchId so the notification fires once — when the whole group is
  // done — instead of once per company.
  const addBatch = useCallback((jobs, label = '') => {
    if (!jobs?.length) return
    const batchId = `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    batchMetaRef.current.set(batchId, { remaining: jobs.length, sent: 0, failed: 0, label })
    jobs.forEach(job => queueRef.current.push({ ...job, batchId }))
    setQueueLen(queueRef.current.length)
    processNext()
  }, [processNext])

  const cancel = useCallback(() => {
    cancelRef.current = true
    queueRef.current = []
    batchMetaRef.current.clear()
    setQueueLen(0)
  }, [])

  const debugBubble = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
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
      processingRef.current = false
      setCompletedCount(allSent)
    }, 1800)
  }, [])

  return (
    <SendQueueCtx.Provider value={{ addJob, addBatch, cancel, active, queueLen, debugBubble, completedCount, clearCompleted, queueError, clearQueueError }}>
      {children}
    </SendQueueCtx.Provider>
  )
}
