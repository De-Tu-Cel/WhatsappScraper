'use client'
import { useEffect, useRef, useState } from 'react'
import { useSendQueue } from '../context/SendQueueContext'
import { useLang } from '../context/LangContext'

const SIZE   = 92
const STROKE = 5
const RADIUS = SIZE / 2 - STROKE / 2 - 2
const CIRC   = 2 * Math.PI * RADIUS
const CX     = SIZE / 2
const CY     = SIZE / 2

const KEYFRAMES = `
  @keyframes sb-in {
    from { opacity: 0; transform: scale(0.45); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes sb-out {
    from { opacity: 1; transform: scale(1); }
    to   { opacity: 0; transform: scale(0.45); }
  }
  @keyframes sb-success {
    0%   { transform: scale(1); }
    40%  { transform: scale(1.14); }
    100% { transform: scale(1); }
  }
  @keyframes sb-pulse {
    0%   { r: ${RADIUS}; opacity: 1; }
    50%  { r: ${RADIUS + 4}; opacity: 0.5; }
    100% { r: ${RADIUS}; opacity: 1; }
  }
  @keyframes sb-toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  @keyframes sb-toast-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
`

function getSavedPos() {
  try {
    const s = JSON.parse(localStorage.getItem('send_bubble_pos') || 'null')
    if (s && typeof s.x === 'number') return s
  } catch {}
  return null
}

// 'hidden' | 'entering' | 'visible' | 'success' | 'exiting'
export default function SendBubble() {
  const { active, queueLen, cancel, debugBubble, completedCount, clearCompleted, queueError, clearQueueError } = useSendQueue()
  const { lang } = useLang()

  const bubbleRef  = useRef(null)
  const posRef     = useRef({ x: 0, y: 0 })
  const offsetRef  = useRef({ x: 0, y: 0 })
  const dragging   = useRef(false)
  const prevSent   = useRef(0)

  const [ready,       setReady]       = useState(false)
  const [bubblePhase, setBubblePhase] = useState('hidden')
  const [pulsing,     setPulsing]     = useState(false)
  const [toastOut,    setToastOut]    = useState(false)
  const [hovered,     setHovered]     = useState(false)

  // Display data kept alive during exit animation
  const displayRef = useRef(null)
  if (active) displayRef.current = active

  // Position init — once on mount
  useEffect(() => {
    const p = getSavedPos() ?? {
      x: window.innerWidth  - SIZE - 20,
      y: window.innerHeight - SIZE - 60,
    }
    posRef.current = p
    if (bubbleRef.current) {
      bubbleRef.current.style.transform = `translate(${p.x}px, ${p.y}px)`
    }
    setReady(true)
  }, [])

  // State machine: track active transitions
  useEffect(() => {
    if (active && bubblePhase === 'hidden') {
      setBubblePhase('entering')
      setTimeout(() => setBubblePhase('visible'), 300)
    }
    if (active?.phase === 'success' && bubblePhase === 'visible') {
      setBubblePhase('success')
    }
    if (!active && (bubblePhase === 'success' || bubblePhase === 'visible')) {
      setBubblePhase('exiting')
      setTimeout(() => { setBubblePhase('hidden'); displayRef.current = null }, 350)
    }
  }, [active, bubblePhase])

  // Pulse when a message is sent (sent increments)
  useEffect(() => {
    if (!active) { prevSent.current = 0; return }
    if (active.sent > prevSent.current) {
      prevSent.current = active.sent
      setPulsing(true)
      setTimeout(() => setPulsing(false), 450)
    }
  }, [active?.sent])

  const [errorToastOut, setErrorToastOut] = useState(false)

  // Success toast auto-dismiss
  useEffect(() => {
    if (completedCount === null) { setToastOut(false); return }
    const t1 = setTimeout(() => setToastOut(true),  3200)
    const t2 = setTimeout(() => { clearCompleted(); setToastOut(false) }, 3700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [completedCount, clearCompleted])

  // Error toast auto-dismiss
  useEffect(() => {
    if (!queueError) { setErrorToastOut(false); return }
    const t1 = setTimeout(() => setErrorToastOut(true),  6000)
    const t2 = setTimeout(() => { clearQueueError(); setErrorToastOut(false) }, 6500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [queueError, clearQueueError])

  // Drag — GPU-composited transform, no layout reflow
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !bubbleRef.current) return
      const cx = e.touches ? e.touches[0].clientX : e.clientX
      const cy = e.touches ? e.touches[0].clientY : e.clientY
      const x = Math.max(0, Math.min(window.innerWidth  - SIZE, cx - offsetRef.current.x))
      const y = Math.max(0, Math.min(window.innerHeight - SIZE, cy - offsetRef.current.y))
      posRef.current = { x, y }
      bubbleRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      if (bubbleRef.current) bubbleRef.current.style.cursor = 'grab'
      localStorage.setItem('send_bubble_pos', JSON.stringify(posRef.current))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend',  onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend',  onUp)
    }
  }, [])

  // Shift+B preview
  useEffect(() => {
    const onKey = (e) => { if (e.shiftKey && e.key === 'B') debugBubble() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [debugBubble])

  const onMouseDown = (e) => {
    if (bubblePhase === 'hidden') return
    dragging.current = true
    if (bubbleRef.current) bubbleRef.current.style.cursor = 'grabbing'
    offsetRef.current = {
      x: e.clientX - posRef.current.x,
      y: e.clientY - posRef.current.y,
    }
    e.preventDefault()
  }

  const d = displayRef.current || { total: 1, sent: 0, phase: 'sending', countdown: null }
  const isSuccess     = bubblePhase === 'success' || d.phase === 'success'
  const isWaiting      = d.phase === 'waiting' && d.countdown > 0
  const isBatchWaiting = isWaiting && d.batch
  const progress   = d.total > 0 ? d.sent / d.total : 0
  const dashOffset = CIRC * (1 - progress)
  const ringColor  = isSuccess ? '#22c55e' : isBatchWaiting ? '#fbbf24' : 'var(--accent, #3b82f6)'

  const animStyle = {
    entering: { animation: 'sb-in 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' },
    visible:  {},
    success:  { animation: 'sb-success 0.4s ease forwards' },
    exiting:  { animation: 'sb-out 0.35s ease forwards' },
    hidden:   {},
  }[bubblePhase] || {}

  const toastMsg = completedCount !== null
    ? lang === 'en'
      ? `${completedCount} message${completedCount !== 1 ? 's' : ''} sent ✓`
      : `${completedCount} mensaje${completedCount !== 1 ? 's' : ''} enviado${completedCount !== 1 ? 's' : ''} ✓`
    : null

  const inQueue = lang === 'en' ? 'in queue' : 'en cola'

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Drag wrapper — transform handles position, never re-rendered by countdown */}
      <div
        ref={bubbleRef}
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'fixed',
          left: 0, top: 0,
          transform: 'translate(0px, 0px)',
          willChange: 'transform',
          width: SIZE, height: SIZE,
          zIndex: 9999,
          cursor: 'grab',
          userSelect: 'none',
          visibility: (ready && bubblePhase !== 'hidden') ? 'visible' : 'hidden',
          pointerEvents: bubblePhase !== 'hidden' ? 'all' : 'none',
        }}
      >
        {/* Cancel button — top-right corner, visible on hover */}
        {hovered && !isSuccess && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); cancel() }}
            style={{
              position: 'absolute', top: -5, right: -5,
              width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(239,68,68,0.92)',
              border: '1.5px solid rgba(239,68,68,0.4)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', zIndex: 1,
            }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"
              stroke="white" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1.5" y1="1.5" x2="7.5" y2="7.5" />
              <line x1="7.5" y1="1.5" x2="1.5" y2="7.5" />
            </svg>
          </div>
        )}

        {/* Animation wrapper — scale/fade independent of position */}
        <div style={{ width: SIZE, height: SIZE, ...animStyle }}>

          {/* Solid background */}
          <div style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            background: 'var(--card-bg, #161d2e)',
            border: `1.5px solid ${isSuccess ? 'rgba(34,197,94,0.3)' : 'var(--border, rgba(255,255,255,0.09))'}`,
            boxShadow: isSuccess
              ? '0 4px 20px rgba(34,197,94,0.25)'
              : '0 4px 20px rgba(0,0,0,0.6)',
            transition: 'border-color 0.4s, box-shadow 0.4s',
          }} />

          {/* Progress ring */}
          <svg width={SIZE} height={SIZE}
            style={{ position: 'absolute', inset: 0, display: 'block' }}>
            {/* Track */}
            <circle cx={CX} cy={CY} r={RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={STROKE}
            />
            {/* Progress arc — pulse via key reset */}
            <circle
              key={pulsing ? 'pulse' : 'idle'}
              cx={CX} cy={CY} r={RADIUS}
              fill="none"
              stroke={ringColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${CX} ${CY})`}
              style={{
                transition: 'stroke-dashoffset 0.3s ease, stroke 0.5s ease',
                animation: pulsing ? 'sb-pulse 0.45s ease' : undefined,
              }}
            />
          </svg>

          {/* Content — clear of the ring */}
          <div style={{
            position: 'absolute',
            inset: STROKE + 6,
            borderRadius: '50%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 3, pointerEvents: 'none',
          }}>
            {isSuccess ? (
              /* Success state */
              <>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none"
                  stroke="#22c55e" strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', lineHeight: 1 }}>
                  {d.sent}/{d.total}
                </span>
              </>
            ) : (
              /* Active send state */
              <>
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.12em',
                  color: isBatchWaiting ? '#fbbf24' : 'var(--accent, #3b82f6)', lineHeight: 1, textTransform: 'uppercase',
                }}>
                  {isBatchWaiting ? (lang === 'en' ? 'BREAK' : 'PAUSA') : 'MSG'}
                </span>

                {isWaiting ? (
                  <span style={{
                    color: 'var(--text, #f1f5f9)',
                    fontSize: 22, fontWeight: 700,
                    lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {d.countdown}s
                  </span>
                ) : (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none"
                    stroke="var(--accent, #3b82f6)"
                    strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2"
                      fill="var(--accent, #3b82f6)" stroke="none" />
                  </svg>
                )}

                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: 'var(--text-muted, rgba(255,255,255,0.35))',
                  lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                }}>
                  {d.sent}/{d.total}
                </span>

                {queueLen > 0 && (
                  <span style={{
                    fontSize: 8, fontWeight: 700,
                    color: 'var(--accent, #3b82f6)',
                    lineHeight: 1, opacity: 0.75,
                  }}>
                    +{queueLen} {inQueue}
                  </span>
                )}
              </>
            )}
          </div>

        </div>
      </div>

      {/* Success toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 18px',
          borderRadius: 10,
          background: 'var(--card-bg, #161d2e)',
          border: '1px solid rgba(34,197,94,0.35)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(34,197,94,0.1)',
          color: '#f1f5f9',
          fontSize: '0.82rem', fontWeight: 600,
          whiteSpace: 'nowrap',
          animation: toastOut
            ? 'sb-toast-out 0.45s ease forwards'
            : 'sb-toast-in 0.3s ease forwards',
          pointerEvents: 'none',
        }}>
          <span style={{ color: '#22c55e', fontSize: 15 }}>✓</span>
          {toastMsg}
        </div>
      )}

      {/* Error toast — shown when queue stops due to disconnected/no-number instances */}
      {queueError && (
        <div style={{
          position: 'fixed', bottom: toastMsg ? 72 : 28, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 18px',
          borderRadius: 10,
          background: 'var(--card-bg, #161d2e)',
          border: '1px solid rgba(239,68,68,0.4)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(239,68,68,0.1)',
          color: '#f1f5f9',
          fontSize: '0.82rem', fontWeight: 600,
          maxWidth: 380,
          animation: errorToastOut
            ? 'sb-toast-out 0.45s ease forwards'
            : 'sb-toast-in 0.3s ease forwards',
          pointerEvents: 'none',
        }}>
          <span style={{ color: '#f87171', fontSize: 15, flexShrink: 0 }}>⚠</span>
          {queueError}
        </div>
      )}
    </>
  )
}
