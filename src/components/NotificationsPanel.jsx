'use client'
import { useState, useEffect, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import CloseIcon from '@mui/icons-material/Close'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'

function timeAgo(iso, lang) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
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
export default function NotificationsPanel({ open, onClose }) {
  const { t, lang } = useLang()
  const [items, setItems] = useState(null)

  const load = useCallback(() => {
    authFetch('/api/notifications')
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

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
            <IconButton size="small" onClick={onClose}
              sx={{ color: 'var(--text-muted, rgba(255,255,255,0.3))', '&:hover': { color: 'var(--text, #f1f5f9)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 1.4, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {items === null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={20} sx={{ color: 'var(--accent, #3b82f6)' }} />
              </Box>
            ) : items.length === 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 6, opacity: 0.5 }}>
                <NotificationsNoneIcon sx={{ fontSize: 30, color: 'var(--text-muted)' }} />
                <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {lang === 'en' ? 'No recent notifications' : 'Sin notificaciones recientes'}
                </Typography>
              </Box>
            ) : items.map(n => (
              <Box key={n._id} sx={{
                display: 'flex', gap: 1.2, p: 1.2, borderRadius: 2,
                border: '1px solid var(--border, rgba(255,255,255,0.06))',
                '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.04))' },
              }}>
                <Box sx={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <WhatsAppIcon sx={{ fontSize: 16, color: '#4ade80' }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
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
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}
