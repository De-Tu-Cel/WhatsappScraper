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
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'

function timeAgo(iso, lang) {
  if (!iso) return ''
  // Python isoformat() omits timezone — treat bare strings as UTC
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

  // Group replies by company_id (latest message + unread count); batch-complete
  // and schedule-reminder events aren't tied to one company, so they pass
  // through as their own individual cards.
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
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.8,
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
            bgcolor: 'var(--surface, rgba(255,255,255,0.02))', flexShrink: 0,
          }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: 1.5, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)',
              border: '1px solid var(--accent, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <NotificationsNoneIcon sx={{ fontSize: 15, color: 'var(--accent, #3b82f6)' }} />
            </Box>
            <Typography sx={{ color: 'var(--text, #f1f5f9)', fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>
              {t.notifications?.title || (lang === 'en' ? 'Notifications' : 'Notificaciones')}
            </Typography>
            {/* Clear all — double-checkmark style like WhatsApp */}
            {visibleItems?.length > 0 && (
              <IconButton size="small" onClick={clearAll} title={lang === 'en' ? 'Clear all' : 'Limpiar todo'}
                sx={{ color: 'var(--text-muted, rgba(255,255,255,0.3))', '&:hover': { color: '#4ade80' }, mr: 0.5 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 12 5 16 11 8" />
                  <polyline points="9 12 13 16 23 8" />
                </svg>
              </IconButton>
            )}
            <IconButton size="small" onClick={onClose}
              sx={{ color: 'var(--text-muted, rgba(255,255,255,0.3))', '&:hover': { color: 'var(--text, #f1f5f9)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 1.6, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {grouped === null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={20} sx={{ color: 'var(--accent, #3b82f6)' }} />
              </Box>
            ) : grouped.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 6, opacity: 0.5 }}>
                <NotificationsNoneIcon sx={{ fontSize: 30, color: 'var(--text-muted)' }} />
                <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {lang === 'en' ? 'No recent notifications' : 'Sin notificaciones recientes'}
                </Typography>
              </Box>
            ) : grouped.map(n => {
              const isBatch    = n.type === 'batch_complete'
              const isReminder = n.type === 'schedule_reminder'

              const onClick = isBatch ? undefined
                : isReminder ? (onNavigateToSchedule ? () => onNavigateToSchedule() : undefined)
                : (onNavigateToConv ? () => onNavigateToConv(n.company_id, n.from_number) : undefined)
              const clickable = !!onClick

              const iconBg     = isReminder ? 'rgba(251,191,36,0.12)' : 'rgba(34,197,94,0.12)'
              const iconBorder = isReminder ? 'rgba(251,191,36,0.3)'  : 'rgba(34,197,94,0.3)'

              return (
                <Box key={n._id} onClick={onClick} sx={{
                  display: 'flex', gap: 1.5, p: 1.5, borderRadius: 2.5,
                  border: '1px solid var(--border, rgba(255,255,255,0.06))',
                  cursor: clickable ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                  '&:hover': clickable ? { bgcolor: 'var(--item-hover, rgba(255,255,255,0.04))' } : {},
                }}>
                  <Box sx={{ position: 'relative', flexShrink: 0 }}>
                    <Box sx={{
                      width: 38, height: 38, borderRadius: '50%',
                      bgcolor: iconBg, border: `1px solid ${iconBorder}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isBatch
                        ? <CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />
                        : isReminder
                          ? <ScheduleSendIcon sx={{ fontSize: 16, color: '#fbbf24' }} />
                          : <WhatsAppIcon sx={{ fontSize: 16, color: '#4ade80' }} />}
                    </Box>
                    {!isBatch && !isReminder && n.count > 1 && (
                      <Box sx={{
                        position: 'absolute', top: -4, right: -4,
                        minWidth: 16, height: 16, borderRadius: 8, px: 0.4,
                        bgcolor: 'var(--accent, #3b82f6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                          {n.count > 99 ? '99+' : n.count}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    {isBatch ? (
                      <>
                        <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.label || (lang === 'en' ? 'Batch' : 'Lote')}</Box>
                          {' '}{lang === 'en' ? 'finished sending' : 'terminó de enviarse'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', mb: 0.5 }}>
                          {timeAgo(n.created_at, lang)}
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {lang === 'en'
                            ? `${n.sent} sent${n.failed > 0 ? `, ${n.failed} failed` : ''}`
                            : `${n.sent} enviados${n.failed > 0 ? `, ${n.failed} fallidos` : ''}`}
                        </Typography>
                      </>
                    ) : isReminder ? (
                      <>
                        <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.name || (lang === 'en' ? 'Scheduled campaign' : 'Campaña programada')}</Box>
                        </Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', mb: 0.5 }}>
                          {timeAgo(n.created_at, lang)}
                        </Typography>
                        <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {lang === 'en' ? 'Sends in about 1 hour' : 'Se envía en aproximadamente 1 hora'}
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, #f1f5f9)', lineHeight: 1.35 }}>
                          <Box component="span" sx={{ fontWeight: 700 }}>{n.company_name}</Box>
                          {' '}{lang === 'en' ? 'replied to your message' : 'te respondió'}
                        </Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', mb: 0.5 }}>
                          {timeAgo(n.created_at, lang)}
                        </Typography>
                        {n.message && (
                          <Box sx={{ bgcolor: 'var(--surface, rgba(255,255,255,0.03))', borderRadius: 1.5, p: 1, border: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
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
