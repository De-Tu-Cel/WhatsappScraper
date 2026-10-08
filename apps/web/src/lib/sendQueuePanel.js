export const ACTIVE_QUEUE_STATES = new Set(['pending', 'waiting', 'paused', 'sending'])

export function secondsUntil(iso, now = Date.now()) {
  if (!iso) return null
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - now) / 1000))
}

export function formatCountdown(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return ''
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function formatSendWhen(value, now = new Date()) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((startToday - startThat) / 86400000)
  if (days === 0) return `hoy ${time}`
  if (days === 1) return `ayer ${time}`
  const day = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(date)
  return `${day} ${time}`
}

export function formatBatchWhen(value, now = new Date()) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((startToday - startThat) / 86400000)
  const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (days === 0) return `hoy ${time}`
  if (days === 1) return `ayer ${time}`
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export function itemClockLine(item, countdown) {
  const state = item.display_status || item.status
  if (state === 'sending') {
    return item.started_at ? `Enviando · empezó ${formatSendWhen(item.started_at)}` : 'Enviando ahora'
  }
  if (state === 'waiting') {
    const left = formatCountdown(countdown)
    return left ? `Sale en ${left} · ${formatSendWhen(item.next_action_at)}` : `Sale ${formatSendWhen(item.next_action_at)}`
  }
  if (state === 'paused') {
    const left = countdown != null ? ` · reintenta en ${formatCountdown(countdown)}` : ''
    return `${item.wait_message || 'Cola pausada'}${left}`
  }
  if (item.status === 'sent') return `Enviado ${formatSendWhen(item.finished_at)}`
  if (item.status === 'failed') return `${item.error || 'No se pudo enviar'} · ${formatSendWhen(item.finished_at)}`
  if (item.status === 'interrupted') return `Resultado incierto · ${formatSendWhen(item.finished_at)}`
  if (item.status === 'cancelled') return `Cancelado ${formatSendWhen(item.finished_at)}`
  return item.created_at ? `En cola desde ${formatSendWhen(item.created_at)}` : 'En cola'
}

export function groupQueueItems(items) {
  const groups = []
  for (const item of items || []) {
    const key = item.batch_id || item.job_key || item.id
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: item.batch_label || 'Envío', created_at: item.created_at, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}

export function countQueue(items) {
  const rows = items || []
  return {
    active: rows.filter(item => ACTIVE_QUEUE_STATES.has(item.display_status || item.status)).length,
    sent: rows.filter(item => item.status === 'sent').length,
    pendingCancel: rows.filter(item => item.status === 'pending').length,
  }
}

export function newestCreatedAt(items) {
  return (items || []).reduce((latest, item) => (
    String(item.created_at || '') > latest ? String(item.created_at || '') : latest
  ), '')
}

export function shouldReopenOnNewSend(dismissedAt, newestCreated) {
  if (!newestCreated) return false
  if (!dismissedAt) return true
  return newestCreated > dismissedAt
}

export function summaryTitle({ phase, waitReason, waitMessage, countdown, activeCount }) {
  if (phase === 'sending') return 'Enviando ahora'
  if (phase === 'waiting') {
    const left = formatCountdown(countdown)
    const kind = waitReason === 'batch_break' ? 'Pausa de lote' : 'Siguiente envío'
    return left ? `${kind} en ${left}` : kind
  }
  if (phase === 'paused') return waitMessage || 'Cola pausada'
  if (activeCount) return `${activeCount} pendiente${activeCount === 1 ? '' : 's'}`
  return 'Envíos de hoy'
}
