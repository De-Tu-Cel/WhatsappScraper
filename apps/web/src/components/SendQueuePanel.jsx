'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSendQueue } from '../context/SendQueueContext'
import {
  countQueue, formatBatchWhen, formatCountdown, groupQueueItems, itemClockLine,
  newestCreatedAt, secondsUntil, shouldReopenOnNewSend, summaryTitle,
} from '../lib/sendQueuePanel'

const WIDTH = 400
const BAR_HEIGHT = 110
const STORAGE_POS = 'send_queue_panel_pos'
const STORAGE_DISMISSED = 'send_queue_panel_dismissed_at'

const STATUS = {
  pending:     { label: 'En cola', color: '#94a3b8' },
  waiting:     { label: 'Esperando', color: '#fbbf24' },
  paused:      { label: 'Pausado', color: '#fbbf24' },
  sending:     { label: 'Enviando', color: '#60a5fa' },
  sent:        { label: 'Enviado', color: '#4ade80' },
  failed:      { label: 'Falló', color: '#f87171' },
  interrupted: { label: 'Revisar', color: '#fb923c' },
  cancelled:   { label: 'Cancelado', color: '#64748b' },
  skipped_blocked:     { label: 'Bloqueado', color: '#64748b' },
  skipped_blacklisted: { label: 'Blacklist', color: '#64748b' },
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function savedPosition() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_POS) || 'null')
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value
  } catch {}
  return null
}

export default function SendQueuePanel() {
  const { queueItems, queueStatus, queueLen, queueError, cancel, debugBubble } = useSendQueue()
  const dragRef = useRef(null)
  const boxRef = useRef(null)
  const posRef = useRef({ x: 16, y: 16 })
  const previousNewestRef = useRef('')
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [pos, setPos] = useState({ x: 16, y: 16 })

  const paintPos = (next) => {
    posRef.current = next
    const node = boxRef.current
    if (node) {
      node.style.left = `${next.x}px`
      node.style.top = `${next.y}px`
    }
  }

  const items = queueItems || []
  const groups = useMemo(() => groupQueueItems(items), [items])
  const counts = useMemo(() => countQueue(items), [items])
  const newestCreated = newestCreatedAt(items)
  const countdown = secondsUntil(queueStatus.next_action_at, nowMs)

  useEffect(() => {
    const width = Math.min(WIDTH, window.innerWidth - 24)
    const fallback = { x: 16, y: window.innerHeight - BAR_HEIGHT - 20 }
    const saved = savedPosition() || fallback
    const next = {
      x: clamp(saved.x, 8, Math.max(8, window.innerWidth - width - 8)),
      y: clamp(saved.y, 8, Math.max(8, window.innerHeight - BAR_HEIGHT - 8)),
    }
    posRef.current = next
    setPos(next)
    setDismissed(Boolean(localStorage.getItem(STORAGE_DISMISSED)))
    setReady(true)
  }, [])

  useEffect(() => {
    if (!newestCreated) return
    const dismissedAt = localStorage.getItem(STORAGE_DISMISSED) || ''
    if (shouldReopenOnNewSend(dismissedAt, newestCreated) && dismissedAt) {
      localStorage.removeItem(STORAGE_DISMISSED)
      setDismissed(false)
      setOpen(true)
    } else if (dismissedAt && !shouldReopenOnNewSend(dismissedAt, newestCreated)) {
      setDismissed(true)
    } else if (previousNewestRef.current && newestCreated > previousNewestRef.current) {
      setOpen(true)
    }
    previousNewestRef.current = newestCreated
  }, [newestCreated])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const move = (event) => {
      if (!dragRef.current) return
      const point = event.touches?.[0] || event
      const width = Math.min(WIDTH, window.innerWidth - 24)
      paintPos({
        x: clamp(point.clientX - dragRef.current.dx, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(point.clientY - dragRef.current.dy, 8, Math.max(8, window.innerHeight - BAR_HEIGHT - 8)),
      })
      event.preventDefault?.()
    }
    const up = () => {
      if (!dragRef.current) return
      dragRef.current = null
      const current = posRef.current
      setPos(current)
      localStorage.setItem(STORAGE_POS, JSON.stringify(current))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return undefined
    const onKey = (event) => {
      if (event.shiftKey && event.key.toLowerCase() === 'b') {
        localStorage.removeItem(STORAGE_DISMISSED)
        setDismissed(false)
        setOpen(true)
        debugBubble()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [debugBubble])

  if (!ready || !items.length) return null

  const beginDrag = (event) => {
    if (event.target.closest('button')) return
    const point = event.touches?.[0] || event
    dragRef.current = { dx: point.clientX - posRef.current.x, dy: point.clientY - posRef.current.y }
  }

  const dismiss = () => {
    localStorage.setItem(STORAGE_DISMISSED, newestCreated || new Date().toISOString())
    setDismissed(true)
  }

  const restore = () => {
    localStorage.removeItem(STORAGE_DISMISSED)
    setDismissed(false)
    setOpen(true)
  }

  const title = summaryTitle({
    phase: queueStatus.phase,
    waitReason: queueStatus.wait_reason,
    waitMessage: queueStatus.wait_message,
    countdown,
    activeCount: counts.active,
  })

  if (dismissed) {
    return (
      <button type="button" ref={boxRef} className="sqp-launcher" onClick={restore} title="Abrir cola de envíos"
        style={{ position: 'fixed', left: pos.x, top: pos.y + 36, zIndex: 9998 }}>
        <SendIcon />
        {counts.active > 0 && <span>{counts.active}</span>}
        <PanelStyles />
      </button>
    )
  }

  return (
    <div ref={boxRef} style={{
      position: 'fixed', left: pos.x, top: pos.y, zIndex: 9998,
      width: `min(${WIDTH}px, calc(100vw - 24px))`, height: BAR_HEIGHT,
    }}>
      <PanelStyles />

      {open && (
        <section className="sqp-details" aria-label="Detalle de la cola de envíos">
          <div className="sqp-list">
            {queueError && (
              <div className="sqp-alert">
                <strong>WhatsApp se detuvo</strong>
                <span>{queueError}</span>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.key} className="sqp-group">
                <div className="sqp-group-title">
                  <span>{group.label}</span>
                  <time>{formatBatchWhen(group.created_at)}</time>
                </div>
                {group.items.map((item) => {
                  const state = item.display_status || item.status
                  const meta = STATUS[state] || STATUS.pending
                  const itemLeft = secondsUntil(item.next_action_at, nowMs)
                  return (
                    <div key={item.id} className={`sqp-item sqp-${state}`}>
                      <StateIcon state={state} color={meta.color} />
                      <div className="sqp-copy">
                        <strong>{item.company_name}</strong>
                        <em>{item.phone_masked}</em>
                        <span>{itemClockLine(item, item.next_action_at ? itemLeft : countdown)}</span>
                      </div>
                      <span className="sqp-state" style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <footer className="sqp-footer">
            <span>Se quedan los envíos de las últimas 24 h. El tiempo total de la cola es estimado.</span>
            {counts.pendingCancel > 0 && (
              confirmCancel
                ? <span className="sqp-confirm">
                    ¿Cancelar {counts.pendingCancel} pendientes?
                    <button type="button" onClick={async () => { await cancel(); setConfirmCancel(false) }}>Sí</button>
                    <button type="button" onClick={() => setConfirmCancel(false)}>No</button>
                  </span>
                : <button type="button" className="sqp-cancel" onClick={() => setConfirmCancel(true)}>Cancelar pendientes</button>
            )}
          </footer>
        </section>
      )}

      <section className="sqp-summary" onMouseDown={beginDrag} onTouchStart={beginDrag}>
        <div className="sqp-topline">
          <span className="sqp-grip" title="Arrastra para mover">
            <GripIcon />
            Mover
          </span>
          <strong>Cola de envíos</strong>
          {counts.active > 0 && <span className="sqp-live">EN CURSO</span>}
          <div className="sqp-actions">
            <button type="button" className="sqp-toggle" onClick={() => setOpen((value) => !value)}
              title={open ? 'Ocultar lista' : 'Ver lista'} aria-label={open ? 'Ocultar lista' : 'Ver lista'}>
              <Chevron open={open} />
            </button>
            <button type="button" className="sqp-close" onClick={dismiss}
              title="Cerrar monitor" aria-label="Cerrar monitor">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="sqp-main">
          {(queueStatus.phase === 'sending' || queueStatus.phase === 'waiting' || queueStatus.phase === 'paused') && (
            <StateIcon state={queueStatus.phase === 'paused' ? 'waiting' : queueStatus.phase} color={queueStatus.phase === 'paused' ? '#fbbf24' : '#60a5fa'} large />
          )}
          <div className="sqp-copyblock">
            <div className="sqp-title">{title}</div>
            <div className="sqp-counts">
              {counts.sent} enviado{counts.sent === 1 ? '' : 's'} · {counts.active} pendiente{counts.active === 1 ? '' : 's'}
              {countdown != null && queueStatus.phase === 'waiting' ? ` · ${formatCountdown(countdown)}` : ''}
              {queueLen > 0 ? ` · ${queueLen} lote${queueLen === 1 ? '' : 's'} en espera` : ''}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function StateIcon({ state, color, large = false }) {
  if (state === 'sending' || state === 'waiting') {
    return <span className={`sqp-spinner ${state === 'waiting' ? 'sqp-pulse' : ''}`} style={{
      width: large ? 18 : 14, height: large ? 18 : 14, borderColor: `${color}35`, borderTopColor: color,
    }} />
  }
  if (state === 'sent') return <span className="sqp-check" style={{ color }}>✓</span>
  if (state === 'failed' || state === 'interrupted') return <span className="sqp-check" style={{ color }}>!</span>
  return <span className="sqp-dot" style={{ background: color }} />
}

function Chevron({ open }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d={open ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} /></svg>
}

function CloseIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6 6 18" /></svg>
}

function GripIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="3" cy="3" r="1.15" /><circle cx="9" cy="3" r="1.15" /><circle cx="3" cy="6" r="1.15" /><circle cx="9" cy="6" r="1.15" /><circle cx="3" cy="9" r="1.15" /><circle cx="9" cy="9" r="1.15" /></svg>
}

function SendIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
}

function PanelStyles() {
  return <style>{`
    @keyframes sqp-spin { to { transform: rotate(360deg); } }
    @keyframes sqp-pulse { 50% { opacity: .45; } }
    @keyframes sqp-rise { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
    .sqp-summary,.sqp-details{background:var(--card-bg,#111d2e);border:1px solid var(--border,rgba(255,255,255,.1));box-shadow:0 14px 45px rgba(0,0,0,.45)}
    .sqp-summary{height:110px;border-radius:16px;padding:12px 14px 18px;display:flex;flex-direction:column;cursor:grab;user-select:none;touch-action:none}
    .sqp-summary:active{cursor:grabbing}
    .sqp-details{position:absolute;left:0;right:0;bottom:122px;border-radius:16px;overflow:hidden;animation:sqp-rise .2s ease}
    .sqp-topline{display:flex;align-items:center;gap:8px;color:var(--text,#f1f5f9);font-size:12px}
    .sqp-grip{display:inline-flex;align-items:center;gap:5px;color:var(--text-muted,#94a3b8);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    .sqp-live{font-size:9px;font-weight:800;color:#60a5fa;background:rgba(59,130,246,.13);padding:2px 7px;border-radius:999px;letter-spacing:.06em}
    .sqp-actions{margin-left:auto;display:flex;align-items:center;gap:10px}
    .sqp-actions button{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;cursor:pointer;transition:.15s}
    .sqp-toggle{border:1px solid rgba(96,165,250,.22);background:rgba(59,130,246,.08);color:#93c5fd}
    .sqp-toggle:hover{color:#fff;background:rgba(59,130,246,.28);border-color:rgba(96,165,250,.7);box-shadow:0 0 16px rgba(59,130,246,.25)}
    .sqp-close{border:1px solid rgba(248,113,113,.2);background:rgba(239,68,68,.08);color:#fca5a5}
    .sqp-close:hover{color:#fff;background:rgba(239,68,68,.28);border-color:rgba(248,113,113,.7);box-shadow:0 0 16px rgba(239,68,68,.22)}
    .sqp-main{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:8px;min-width:0}
    .sqp-copyblock{min-width:0;flex:1;text-align:center}
    .sqp-title{font-size:15px;font-weight:800;color:var(--text,#f1f5f9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sqp-counts{font-size:11px;color:var(--text-muted,#94a3b8);margin-top:2px;text-align:center}
    .sqp-list{max-height:min(475px,calc(100vh - 220px));overflow:auto;overscroll-behavior:contain}
    .sqp-list::-webkit-scrollbar{width:7px}.sqp-list::-webkit-scrollbar-thumb{background:rgba(148,163,184,.28);border-radius:8px}
    .sqp-group-title{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;gap:10px;padding:8px 12px;background:color-mix(in srgb,var(--card-bg,#111d2e) 93%,#fff 7%);border-bottom:1px solid var(--border,rgba(255,255,255,.08));font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#94a3b8)}
    .sqp-group-title span{font-weight:800}.sqp-group-title time{text-transform:none;letter-spacing:0;white-space:nowrap}
    .sqp-item{display:flex;align-items:flex-start;gap:10px;min-height:68px;padding:10px 12px;border-bottom:1px solid var(--border,rgba(255,255,255,.07))}
    .sqp-item:last-child{border-bottom:0}.sqp-sending,.sqp-waiting{background:rgba(59,130,246,.05)}
    .sqp-copy{min-width:0;flex:1}.sqp-copy strong{display:block;color:var(--text,#f1f5f9);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sqp-copy em{display:block;font-style:normal;color:var(--text-muted,#94a3b8);font-size:11px;margin-top:1px}
    .sqp-copy span{display:block;color:#cbd5e1;font-size:11px;line-height:1.35;margin-top:3px}
    .sqp-state{font-size:10.5px;font-weight:800;flex-shrink:0;padding-top:2px}
    .sqp-spinner{display:inline-block;flex:none;margin-top:3px;border:2px solid;border-radius:50%;animation:sqp-spin .75s linear infinite}
    .sqp-pulse{animation:sqp-spin .75s linear infinite,sqp-pulse 1.2s ease-in-out infinite}
    .sqp-dot{width:8px;height:8px;border-radius:50%;margin:6px 3px 0;flex:none}.sqp-check{width:14px;margin-top:2px;text-align:center;font-weight:900;flex:none}
    .sqp-alert{margin:10px;padding:9px 10px;border:1px solid rgba(248,113,113,.32);background:rgba(239,68,68,.08);border-radius:9px;color:#fca5a5;font-size:11px;display:flex;flex-direction:column;gap:2px}
    .sqp-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;border-top:1px solid var(--border,rgba(255,255,255,.08));font-size:10px;color:var(--text-muted,#94a3b8)}
    .sqp-footer button{font:inherit;font-weight:700;border-radius:6px;padding:4px 7px;cursor:pointer}
    .sqp-cancel{margin-left:auto;color:#fca5a5;border:1px solid rgba(248,113,113,.25);background:rgba(239,68,68,.08)}
    .sqp-cancel:hover{background:rgba(239,68,68,.16)}
    .sqp-confirm{margin-left:auto;display:flex;align-items:center;gap:5px}
    .sqp-confirm button{color:var(--text,#fff);border:1px solid var(--border);background:rgba(255,255,255,.06)}
    .sqp-confirm button:hover{background:rgba(255,255,255,.12)}
    .sqp-launcher{width:48px;height:48px;border-radius:50%;border:1px solid rgba(96,165,250,.35);background:var(--card-bg,#111d2e);color:#60a5fa;box-shadow:0 8px 28px rgba(0,0,0,.45);display:grid;place-items:center;cursor:pointer}
    .sqp-launcher:hover{transform:scale(1.05);box-shadow:0 0 22px rgba(59,130,246,.25)}
    .sqp-launcher span{position:absolute;right:-4px;top:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#3b82f6;color:white;font-size:10px;font-weight:800;display:grid;place-items:center}
    @media(max-width:520px){.sqp-title{max-width:250px}.sqp-details{bottom:120px}.sqp-list{max-height:52vh}}
  `}</style>
}
