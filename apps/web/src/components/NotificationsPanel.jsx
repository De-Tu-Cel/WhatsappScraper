'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import CloseIcon from '@mui/icons-material/Close'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ErrorIcon from '@mui/icons-material/Error'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'

function timeAgo(iso, lang) {
  if (!iso) return ''
  const normalized = /[Z+]|[-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z'
  const diffMs = Date.now() - new Date(normalized).getTime()
  const min = Math.floor(diffMs / 60000)
  const es = lang !== 'en'
  if (min < 1) return es ? 'ahora' : 'just now'
  if (min < 60) return es ? `hace ${min} min` : `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return es ? `hace ${hr} h` : `${hr}h ago`
  const days = Math.floor(hr / 24)
  return es ? `hace ${days} d` : `${days}d ago`
}

// Same right-side slide-in pattern as AppearancePanel — the two share the
// dock (only one open at a time, coordinated by the parent) since they'd
// otherwise fight for the same edge of the screen.
export default function NotificationsPanel({ open, onClose, onNavigateToConv, onNavigateToSchedule }) {
  const { t, lang } = useLang()
  const [items,     setItems]     = useState(null)
  const [clearedAt, setClearedAt] = useState(() => {
    try { return localStorage.getItem('notif_cleared_at') || '' } catch { return '' }
  })

  const load = useCallback(() => {
    authFetch('/api/notifications')
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  const clearAll = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem('notif_cleared_at', now)
    localStorage.setItem('notif_last_read',  now)
    setClearedAt(now)
  }, [])

  const visibleItems = items === null ? null : items.filter(n => {
    if (!clearedAt || !n.created_at) return true
    const normalized = /[Z+]|[-]\d{2}:\d{2}$/.test(n.created_at) ? n.created_at : n.created_at + 'Z'
    return new Date(normalized) > new Date(clearedAt)
  })

  const grouped = useMemo(() => {
    if (!visibleItems) return null
    const map = new Map()
    const passthrough = []
    for (const n of visibleItems) {
      if (n.type && n.type !== 'reply') { passthrough.push({ ...n, count: 1 }); continue }
      const id = n.company_id || n._id
      if (!map.has(id)) {
        map.set(id, { ...n, count: 1 })
      } else {
        map.get(id).count++
      }
    }
    return [...map.values(), ...passthrough].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [visibleItems])

  return (
    <Box sx={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: open ? 'min(360px, 60%)' : 0,
      overflow: 'hidden',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      borderLeft: open ? '1px solid var(--border, rgba(255,255,255,0.08))' : 'none',
      display: 'flex', flexDirection: 'column',
      bgcolor: 'var(--sidebar-bg, #0d1117)',
      zIndex: 5,
    }}>
      {open && (
        <Box sx={{ width: 'min(360px, 60vw)', display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* ── Header ── */}
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.2, py: 1.6,
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.13) 0%, rgba(var(--accent-rgb,59,130,246),0.04) 60%, transparent 100%)',
            flexShrink: 0,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 2, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.4), rgba(var(--accent-rgb,59,130,246),0.15))',
                border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 12px rgba(var(--accent-rgb,59,130,246),0.2)',
              }}>
                <NotificationsNoneIcon sx={{ fontSize: 17, color: 'var(--accent, #60a5fa)' }} />
              </Box>
              <Box>
                <Typography sx={{ color: 'var(--text, #f1f5f9)', fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.2 }}>
                  {t.notifications.title}
                </Typography>
                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.32)', mt: 0.1 }}>
                  {grouped && grouped.length > 0
                    ? `${grouped.length} ${lang === 'en' ? 'recent' : 'recientes'}`
                    : lang === 'en' ? 'Replies & alerts' : 'Respuestas y alertas'}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              {visibleItems?.length > 0 && (
                <IconButton size="small" onClick={clearAll} title={lang === 'en' ? 'Clear all' : 'Limpiar todo'}
                  sx={{ color: 'rgba(255,255,255,0.25)', width: 26, height: 26, '&:hover': { color: '#4ade80', bgcolor: 'rgba(255,255,255,0.07)' }, transition: 'color 0.15s' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 12 5 16 11 8" />
                    <polyline points="9 12 13 16 23 8" />
                  </svg>
                </IconButton>
              )}
              <IconButton size="small" onClick={onClose} sx={{
                color: 'rgba(255,255,255,0.3)', width: 26, height: 26,
                '&:hover': { color: 'var(--text,#f1f5f9)', bgcolor: 'rgba(255,255,255,0.07)' },
              }}>
                <CloseIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          </Box>

          {/* ── List ── */}
          <Box sx={{ flex: 1, overflowY: 'auto', p: 1.4, display: 'flex', flexDirection: 'column', gap: 0.7,
            scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent',
            '&::-webkit-scrollbar': { width: 3 },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: 2 },
          }}>
            {grouped === null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress size={20} sx={{ color: 'var(--accent, #60a5fa)' }} />
              </Box>
            ) : grouped.length === 0 ? (
              <Box sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.2, py: 6,
                background: 'radial-gradient(ellipse at 50% 40%, rgba(59,130,246,0.04) 0%, transparent 70%)',
                borderRadius: 3,
              }}>
                <Box sx={{
                  width: 44, height: 44, borderRadius: '50%',
                  bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <NotificationsNoneIcon sx={{ fontSize: 22, color: 'rgba(255,255,255,0.18)' }} />
                </Box>
                <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.28)', fontWeight: 500 }}>
                  {lang === 'en' ? 'No recent notifications' : 'Sin notificaciones recientes'}
                </Typography>
              </Box>
            ) : grouped.map((n, idx) => {
              const isBatch    = n.type === 'batch_complete'
              const isReminder = n.type === 'schedule_reminder'
              const isCap      = n.type === 'cap_reached'

              // Un lote con 0 enviados y algo fallido no es un éxito — no debe
              // verse igual (verde) que uno que sí mandó todo. Parcial = ámbar,
              // todo fallido = rojo, todo bien = verde (como ya era).
              const batchNcSkip     = isBatch && (n.skipped_nc_cap > 0)
              const batchAllFailed  = isBatch && !(n.sent > 0) && n.failed > 0
              const batchPartial    = isBatch && n.sent > 0 && (n.failed > 0 || batchNcSkip)

              const onClick = (isBatch || isCap) ? undefined
                : isReminder ? (onNavigateToSchedule ? () => onNavigateToSchedule() : undefined)
                : (onNavigateToConv ? () => onNavigateToConv(n.company_id, n.from_number) : undefined)
              const clickable = !!onClick

              // Ámbar para cupo/parcial (se resuelve solo o ya mandó algo), rojo
              // solo para lo que de verdad no funcionó de principio a fin.
              const accentColor  = batchAllFailed ? '#f87171' : (isCap || batchPartial) ? '#fbbf24' : isReminder ? '#fbbf24' : '#4ade80'
              const accentAlpha  = batchAllFailed ? 'rgba(248,113,113,' : (isCap || batchPartial) ? 'rgba(251,191,36,' : isReminder ? 'rgba(251,191,36,' : 'rgba(34,197,94,'
              const typeLabel    = isBatch
                ? (lang === 'en' ? 'Batch' : 'Lote')
                : isReminder
                  ? (lang === 'en' ? 'Reminder' : 'Recordatorio')
                  : isCap
                    ? (lang === 'en' ? 'Daily cap' : 'Cupo diario')
                    : (lang === 'en' ? 'Reply' : 'Respuesta')

              return (
                <Box key={n._id} onClick={onClick} sx={{
                  display: 'flex', gap: 1.3, p: 1.35, borderRadius: 2,
                  bgcolor: 'rgba(255,255,255,0.022)',
                  border: '1px solid rgba(255,255,255,0.065)',
                  borderLeft: `3px solid ${accentAlpha}0.35)`,
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                  animation: 'notifIn 0.2s ease both',
                  animationDelay: `${idx * 0.04}s`,
                  '@keyframes notifIn': {
                    from: { opacity: 0, transform: 'translateX(10px)' },
                    to:   { opacity: 1, transform: 'none' },
                  },
                  '&:hover': clickable ? {
                    bgcolor: 'rgba(255,255,255,0.045)',
                    borderLeftColor: accentColor,
                    transform: 'translateX(-1px)',
                  } : {},
                }}>
                  {/* Icon */}
                  <Box sx={{ position: 'relative', flexShrink: 0 }}>
                    <Box sx={{
                      width: 36, height: 36, borderRadius: '50%',
                      bgcolor: `${accentAlpha}0.1)`,
                      border: `1px solid ${accentAlpha}0.28)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 10px ${accentAlpha}0.12)`,
                    }}>
                      {isBatch
                        ? (batchAllFailed
                            ? <ErrorIcon sx={{ fontSize: 15, color: accentColor }} />
                            : <CheckCircleIcon sx={{ fontSize: 15, color: accentColor }} />)
                        : isReminder
                          ? <ScheduleSendIcon sx={{ fontSize: 15, color: accentColor }} />
                          : isCap
                            ? <WarningAmberIcon sx={{ fontSize: 15, color: accentColor }} />
                            : <WhatsAppIcon    sx={{ fontSize: 15, color: accentColor }} />}
                    </Box>
                    {!isBatch && !isReminder && !isCap && n.count > 1 && (
                      <Box sx={{
                        position: 'absolute', top: -4, right: -4,
                        minWidth: 16, height: 16, borderRadius: 8, px: 0.4,
                        bgcolor: 'var(--accent, #3b82f6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 6px rgba(59,130,246,0.5)',
                      }}>
                        <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                          {n.count > 99 ? '99+' : n.count}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  {/* Content */}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    {/* Type pill + time */}
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.35 }}>
                      <Box sx={{
                        px: 0.7, py: 0.1, borderRadius: '4px',
                        bgcolor: `${accentAlpha}0.1)`, border: `1px solid ${accentAlpha}0.22)`,
                        display: 'inline-flex',
                      }}>
                        <Typography sx={{ fontSize: '0.58rem', color: accentColor, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          {typeLabel}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)' }}>
                        {timeAgo(n.created_at, lang)}
                      </Typography>
                    </Box>

                    {isBatch ? (
                      <>
                        <Typography sx={{ fontSize: '0.79rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.label || (lang === 'en' ? 'Batch' : 'Lote')}</Box>
                          {' '}{lang === 'en' ? 'finished sending' : 'terminó de enviarse'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)', mt: 0.4 }}>
                          {lang === 'en'
                            ? `${n.sent} sent${n.failed > 0 ? `, ${n.failed} failed` : ''}${n.skipped_nc_cap > 0 ? `, ${n.skipped_nc_cap} skipped (new-contact limit)` : ''}`
                            : `${n.sent} enviados${n.failed > 0 ? `, ${n.failed} fallidos` : ''}${n.skipped_nc_cap > 0 ? `, ${n.skipped_nc_cap} omitidos (límite nuevos)` : ''}`}
                        </Typography>
                      </>
                    ) : isReminder ? (
                      <>
                        <Typography sx={{ fontSize: '0.79rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.name || (lang === 'en' ? 'Scheduled campaign' : 'Campaña programada')}</Box>
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)', mt: 0.4 }}>
                          {lang === 'en' ? 'Sends in about 1 hour' : 'Se envía en aproximadamente 1 hora'}
                        </Typography>
                      </>
                    ) : isCap ? (
                      <>
                        <Typography sx={{ fontSize: '0.79rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.label || n.instance}</Box>
                          {' '}{lang === 'en' ? 'reached its daily quota' : 'llegó a su cupo de hoy'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.38)', mt: 0.4 }}>
                          {lang === 'en'
                            ? `Quota of ${n.cap} — new sends resume at midnight`
                            : `Cupo de ${n.cap} — los envíos nuevos se reanudan a medianoche`}
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: '0.79rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.company_name}</Box>
                          {' '}{lang === 'en' ? 'replied to your message' : 'te respondió'}
                        </Typography>
                        {n.message && (
                          <Box sx={{
                            mt: 0.6,
                            bgcolor: 'rgba(0,0,0,0.22)',
                            borderRadius: '0 6px 6px 6px',
                            p: '6px 10px',
                            borderLeft: `2px solid ${accentAlpha}0.32)`,
                          }}>
                            <Typography sx={{
                              fontSize: '0.73rem', color: 'rgba(255,255,255,0.5)',
                              whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            }}>
                              {n.message}
                            </Typography>
                          </Box>
                        )}
                      </>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
    </Box>
  )
}
