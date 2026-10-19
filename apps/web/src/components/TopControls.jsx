'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Badge from '@mui/material/Badge'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import PaletteIcon from '@mui/icons-material/Palette'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'
import { LANGS } from './Settings'
import FlagIcon from './FlagIcon'
import { useUser } from '@/context/UserContext'
import { notificationSince } from '@/lib/notificationState'

const ICON_BTN_SX = (active) => ({
  width: 28, height: 28, borderRadius: '50%', p: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: active ? 'var(--accent, #3b82f6)' : 'var(--text-muted, rgba(255,255,255,0.55))',
  bgcolor: active ? 'var(--item-hover, rgba(255,255,255,0.08))' : 'transparent',
  transition: 'background-color 0.12s, color 0.12s',
  '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.08))', color: 'var(--text, #f1f5f9)' },
})

// Global controls that live above the active nav tab, independent of which
// page is open: language switch (flag menu), notification bell (recent inbound
// replies), and appearance toggle (opens AppearancePanel, a right-side
// slide-in — mirrored from the left Sidebar). Wrapped in its own bordered/
// blurred pill (mirrors the Sidebar's panel treatment) instead of floating
// bare over the content background. Icons themselves stay borderless/
// transparent at rest — a plain filled circle only shows up on hover (or
// while its panel/menu is open).
export default function TopControls({ appearanceOpen, onToggleAppearance, notifOpen, onToggleNotifications, helpOpen, onToggleHelp }) {
  const { lang, setLang, t } = useLang()
  const [anchorEl, setAnchorEl] = useState(null)
  const [notifCount, setNotifCount] = useState(0)
  const { user } = useUser()
  const userId = user?.id || user?._id || user?.username || ''
  const countRequest = useRef(null)
  const current = LANGS.find(l => l.value === lang) || LANGS[0]

  const fetchNotifCount = useCallback(() => {
    if (typeof window === 'undefined' || !userId || notifOpen || !localStorage.getItem('user_token')) return
    countRequest.current?.abort()
    const request = new AbortController(); countRequest.current = request
    const since = notificationSince(localStorage, userId)
    const url = since ? `/api/notifications/count?since=${encodeURIComponent(since)}` : '/api/notifications/count'
    authFetch(url, { signal: request.signal, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('load'); return r.json() })
      .then(d => { if (!request.signal.aborted) setNotifCount(Number(d?.count) || 0) })
      .catch(() => {})
  }, [userId, notifOpen])

  useEffect(() => {
    fetchNotifCount()
    const id = setInterval(() => { if (!document.hidden) fetchNotifCount() }, 30_000)
    window.addEventListener('service-health-refresh', fetchNotifCount)
    return () => { countRequest.current?.abort(); clearInterval(id); window.removeEventListener('service-health-refresh', fetchNotifCount) }
  }, [fetchNotifCount])

  useEffect(() => {
    function onRead(event) {
      if (event.detail?.userId !== userId) return
      countRequest.current?.abort()
      setNotifCount(0)
    }
    window.addEventListener('notifications-read', onRead)
    return () => window.removeEventListener('notifications-read', onRead)
  }, [userId])

  return (
    <Box id="tour-top-controls" sx={{
      display: 'flex', alignItems: 'center', gap: 0.5,
      px: 0.5, py: 0.5, borderRadius: 2.5,
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.04))',
      border: '1px solid var(--border, rgba(255,255,255,0.1))',
      backdropFilter: 'blur(12px)',
      boxShadow: 'none',
    }}>
      <Tooltip title={t.settings.language}>
        <IconButton size="small" onClick={e => setAnchorEl(e.currentTarget)}
          sx={{ ...ICON_BTN_SX(!!anchorEl), fontSize: '1.15rem' }}>
          <FlagIcon code={current.flagCode} size={18} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}
        slotProps={{
          list: { sx: { p: 1 } },
          paper: { sx: {
            bgcolor: 'var(--card-bg, #1e293b)', color: 'var(--text, #f1f5f9)',
            backgroundImage: 'none', backdropFilter: 'blur(16px)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            borderRadius: 3, mt: 1, minWidth: 168,
            boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          } },
        }}>
        {LANGS.map(l => (
          <MenuItem key={l.value} selected={l.value === lang}
            onClick={() => { setLang(l.value); setAnchorEl(null) }}
            sx={{
              gap: 0.9, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text, #f1f5f9)',
              borderRadius: 2, py: 0.9, px: 1.2, mb: 0.3,
              justifyContent: 'center', textAlign: 'center',
              '&:last-of-type': { mb: 0 },
              '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.07))' },
              '&.Mui-selected': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.1))' },
              '&.Mui-selected:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.13))' },
            }}>
            <FlagIcon code={l.flagCode} size={20} />
            {l.labels[lang]}
          </MenuItem>
        ))}
      </Menu>

      <Tooltip title={t.notifications.title}>
        <IconButton size="small" aria-label={t.notifications.title} onClick={onToggleNotifications} sx={ICON_BTN_SX(notifOpen)}>
          <Badge
            badgeContent={notifCount}
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                bgcolor: '#ef4444', color: '#fff', fontSize: '0.52rem', fontWeight: 700,
                minWidth: 13, height: 13, top: 4, right: 4,
              },
            }}>
            <NotificationsNoneIcon sx={{ fontSize: 17 }} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Tooltip title={lang === 'en' ? 'Help & FAQ' : 'Ayuda y FAQ'}>
        <IconButton size="small" onClick={onToggleHelp} sx={ICON_BTN_SX(helpOpen)}>
          <HelpOutlineIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>

      <Tooltip title={t.settings.tabAppearance || 'Apariencia'}>
        <IconButton size="small" onClick={onToggleAppearance} sx={ICON_BTN_SX(appearanceOpen)}>
          <PaletteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
