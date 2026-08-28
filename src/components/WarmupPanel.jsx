'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import Divider from '@mui/material/Divider'
import Alert from '@mui/material/Alert'
import Switch from '@mui/material/Switch'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import LinearProgress from '@mui/material/LinearProgress'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import ChatBubbleOutlinedIcon from '@mui/icons-material/ChatBubbleOutlined'
import SignalWifiOffIcon from '@mui/icons-material/SignalWifiOff'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import SyncIcon from '@mui/icons-material/Sync'
import MovieIcon from '@mui/icons-material/Movie'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import SearchIcon from '@mui/icons-material/Search'
import TuneIcon from '@mui/icons-material/Tune'
import CheckCircleOutlineIcon from '@mui/icons-material/TaskAlt'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ErrorOutlineIcon from '@mui/icons-material/ReportProblem'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import TextsmsOutlinedIcon from '@mui/icons-material/TextsmsOutlined'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import TopicIcon from '@mui/icons-material/Topic'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import { useUser } from '../context/UserContext'

const API = (path) => `/api${path}`
function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'x-user-token': token || '' }
}

// Mismo patrón de fondo WA que usa conversations.jsx
const _WA_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">',
  '<g transform="translate(5,3) scale(0.9)">',
  '<path d="M25 5C13.9 5 5 13.9 5 25c0 3.8 1.1 7.4 2.9 10.4L5 45l9.9-2.9C17.8 43.6 21.3 45 25 45c11.1 0 20-8.9 20-20S36.1 5 25 5z" fill="none" stroke="rgba(37,211,102,0.15)" stroke-width="2" stroke-linejoin="round"/>',
  '<path d="M17 19c0-.8.7-1.5 1.5-1.5H22l2 5-2.5 2c1.5 2.5 3.5 4.5 6 6l2-2.5 5 2v3.5c0 .8-.7 1.5-1.5 1.5C24 34.5 17 27 17 19z" fill="none" stroke="rgba(37,211,102,0.15)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  '</g>',
  '<g transform="translate(60,58) rotate(-12) scale(0.52)">',
  '<path d="M25 5C13.9 5 5 13.9 5 25c0 3.8 1.1 7.4 2.9 10.4L5 45l9.9-2.9C17.8 43.6 21.3 45 25 45c11.1 0 20-8.9 20-20S36.1 5 25 5z" fill="none" stroke="rgba(37,211,102,0.09)" stroke-width="2" stroke-linejoin="round"/>',
  '</g>',
  '</svg>',
].join('')
const WA_BG_PATTERN = `url("data:image/svg+xml,${encodeURIComponent(_WA_SVG)}")`

// ── helpers ───────────────────────────────────────────────────────────────────
function relativeTime(isoString) {
  if (!isoString) return null
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 60)   return 'ahora mismo'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return m > 0 ? `hace ${h}h ${m}min` : `hace ${h}h`
}

function formatTime(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

function formatDaySeparator(isoString) {
  if (!isoString) return 'Hoy'
  const d = new Date(isoString)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

function formatNextRotation(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(0,0,0,0)
  const isToday    = d.toDateString() === now.toDateString()
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const time = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  if (isToday)    return `hoy a las ${time}`
  if (isTomorrow) return `mañana a las ${time}`
  return d.toLocaleDateString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
}

const STATUS_CFG = {
  active:       { label: 'Activo',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#e11d68' },
  paused:       { label: 'Pausado',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b' },
  disconnected: { label: 'Desconectado', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: '#ef4444' },
}

// ── Session detail dialog ─────────────────────────────────────────────────────
function SessionDetail({ sessionId, token }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    fetch(API(`/warmup/sessions/${sessionId}/messages`), { headers: authHeaders(token) })
      .then(r => r.json()).then(setSession).catch(() => {}).finally(() => setLoading(false))
  }, [sessionId, token])

  useEffect(() => {
    if (session && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [session])

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={28} /></Box>
  if (!session) return <Alert severity="error">No se pudo cargar la sesión.</Alert>

  const msgs = session.messages || []

  // Agrupar con detección de mensajes consecutivos del mismo speaker
  const grouped = []
  let lastDay = null, lastSpeaker = null
  for (let idx = 0; idx < msgs.length; idx++) {
    const msg = msgs[idx]
    const dayKey = msg.ts ? new Date(msg.ts).toDateString() : 'unknown'
    if (dayKey !== lastDay) {
      grouped.push({ type: 'separator', ts: msg.ts, key: dayKey })
      lastDay = dayKey; lastSpeaker = null
    }
    grouped.push({ type: 'msg', msg, showSender: msg.speaker !== lastSpeaker })
    lastSpeaker = msg.speaker
  }

  return (
    <Box sx={{
      flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column',
      bgcolor: '#080c14',
      backgroundImage: WA_BG_PATTERN, backgroundSize: '100px 100px',
      scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent',
      '&::-webkit-scrollbar': { width: 3 },
      '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: 2 },
    }}>
      {msgs.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
          <ChatBubbleOutlinedIcon sx={{ fontSize: 44, color: 'rgba(255,255,255,0.07)' }} />
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.28)' }}>Sin mensajes aún.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', px: 1.5, pt: 1.5, pb: 2 }}>
          {grouped.map((item, i) => {
            if (item.type === 'separator') {
              return (
                <Box key={`sep-${item.key}`} sx={{ textAlign: 'center', my: 1.25 }}>
                  <Chip label={formatDaySeparator(item.ts)} size="small" sx={{
                    fontSize: 11, height: 22,
                    bgcolor: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(6px)',
                    color: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(255,255,255,0.09)',
                  }} />
                </Box>
              )
            }
            const { msg, showSender } = item
            const isA = msg.speaker === 'a'
            const nextItem = grouped[i + 1]
            const isLastInGroup = !nextItem || nextItem.type === 'separator' || nextItem.msg?.speaker !== msg.speaker
            return (
              <Box key={i} sx={{
                display: 'flex', justifyContent: isA ? 'flex-start' : 'flex-end',
                mb: isLastInGroup ? 0.75 : 0.15,
                '@keyframes popIn': {
                  from: { opacity: 0, transform: 'scale(0.94) translateY(4px)' },
                  to:   { opacity: 1, transform: 'scale(1) translateY(0)' },
                },
                animation: 'popIn 0.16s ease both',
                animationDelay: `${Math.min(i * 0.025, 0.4)}s`,
              }}>
                <Box sx={{
                  maxWidth: '80%',
                  px: 1.25, pt: showSender ? 0.5 : 0.35, pb: 0.4,
                  background: isA ? '#1a2743' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
                  borderRadius: isA
                    ? (showSender ? '2px 14px 14px 14px' : '14px 14px 14px 2px')
                    : (showSender ? '14px 2px 14px 14px' : '14px 14px 2px 14px'),
                  boxShadow: isA
                    ? '0 1px 4px rgba(0,0,0,0.35)'
                    : '0 2px 10px rgba(79,70,229,0.35)',
                  border: isA ? '1px solid rgba(255,255,255,0.05)' : 'none',
                }}>
                  {showSender && (
                    <Typography variant="caption" sx={{
                      fontWeight: 700, display: 'block', mb: 0.2,
                      color: isA ? '#60a5fa' : 'rgba(255,255,255,0.6)',
                      fontSize: 10.5, letterSpacing: '0.01em',
                    }}>
                      {isA ? session.instance_a : session.instance_b}
                    </Typography>
                  )}
                  <Typography variant="body2" sx={{ lineHeight: 1.5, color: '#f1f5f9', fontSize: 13 }}>
                    {msg.content}
                  </Typography>
                  {msg.ts && (
                    <Typography sx={{
                      display: 'block', textAlign: 'right', mt: 0.15,
                      color: isA ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.5)',
                      fontSize: 9.5, letterSpacing: '0.02em',
                    }}>
                      {new Date(msg.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      {!isA && ' ✓✓'}
                    </Typography>
                  )}
                </Box>
              </Box>
            )
          })}
          <div ref={bottomRef} />
        </Box>
      )}
    </Box>
  )
}

// ── Chats dialog ──────────────────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#60a5fa,#2563eb)',
  'linear-gradient(135deg,#a78bfa,#6d28d9)',
  'linear-gradient(135deg,#f472b6,#be185d)',
  'linear-gradient(135deg,#fbbf24,#b45309)',
  'linear-gradient(135deg,#34d399,#047857)',
  'linear-gradient(135deg,#22d3ee,#0369a1)',
  'linear-gradient(135deg,#fb923c,#b91c1c)',
  'linear-gradient(135deg,#2dd4bf,#0f766e)',
]

function avatarGradientFor(str) {
  const hash = String(str).split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7)
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function formatItemDate(dateStr) {
  if (!dateStr) return ''
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return 'Hoy'
  if (dateStr === yesterday) return 'Ayer'
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function InstanceChatsDialog({ open, onClose, instanceName, token }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const [viewedIds, setViewedIds] = useState(() => new Set())

  useEffect(() => {
    if (!open) return
    setSelected(null); setLoading(true)
    fetch(API(`/warmup/chats/${instanceName}`), { headers: authHeaders(token) })
      .then(r => r.json()).then(setSessions).catch(() => {}).finally(() => setLoading(false))
  }, [open, instanceName, token])

  const peer = s => s.instance_a === instanceName ? s.instance_b : s.instance_a

  const selectedSession = selected ? sessions.find(s => s._id === selected) : null
  const selectedPeer = selectedSession ? peer(selectedSession) : null

  const handleSelect = (id) => {
    setViewedIds(prev => { const next = new Set(prev); next.add(id); return next })
    setSelected(id)
  }

  const instGradient = avatarGradientFor(instanceName)
  const instInitials = instanceName.slice(0, 2).toUpperCase()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: {
        borderRadius: 2.5, overflow: 'hidden', height: '70vh', maxHeight: 560,
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(160deg, #161d2e 0%, #0d1421 100%)',
      } } }}>

      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 1.5, py: 1, flexShrink: 0,
        background: 'rgba(13,20,33,0.6)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(4px)',
      }}>
        {selected ? (
          <IconButton size="small" onClick={() => setSelected(null)} sx={{ color: 'rgba(255,255,255,0.65)', ml: -0.5 }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        ) : null}
        <Box sx={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: selected ? avatarGradientFor(selected) : instGradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 13, color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {selected ? (selectedPeer?.slice(0, 2).toUpperCase() ?? '??') : instInitials}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" fontWeight={700} noWrap
            sx={{ color: '#f1f5f9', lineHeight: 1.25, letterSpacing: '-0.01em' }}>
            {selectedPeer || instanceName}
          </Typography>
          {selected && selectedSession ? (
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, lineHeight: 1 }}>
              {selectedSession.total_messages_today} mensajes hoy · {selectedSession.instance_a} ↔ {selectedSession.instance_b}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.1 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.38)', fontSize: 10, lineHeight: 1 }}>
                Calentamiento activo
              </Typography>
            </Box>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.45)' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Lista de sesiones / chat */}
      <DialogContent sx={{
        p: 0, overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column',
        bgcolor: 'transparent',
        ...(!loading && !selected ? { backgroundImage: WA_BG_PATTERN, backgroundSize: '100px 100px' } : {}),
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'rgba(255,255,255,0.08)' },
      }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : selected ? (
          <SessionDetail sessionId={selected} onBack={() => setSelected(null)} token={token} />
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
            <ChatBubbleOutlinedIcon sx={{ fontSize: 52, color: 'rgba(255,255,255,0.1)', mb: 1.5 }} />
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.35)' }}>Sin chats de calentamiento aún.</Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ bgcolor: 'transparent' }}>
            {sessions.map((s, i) => {
              const peerName = peer(s)
              const initials = peerName.slice(0, 2).toUpperCase()
              const lastMsg = s.messages?.[s.messages.length - 1]?.content
              const hasUnread = s.total_messages_today > 0 && !viewedIds.has(s._id)
              const avatarGrad = avatarGradientFor(s._id || peerName + i)
              return (
                <React.Fragment key={s._id}>
                  {i > 0 && <Divider component="li" sx={{ borderColor: 'rgba(255,255,255,0.05)', ml: 9 }} />}
                  <ListItemButton
                    onClick={() => handleSelect(s._id)}
                    sx={{
                      px: 2, py: 1.25, gap: 1.5,
                      borderLeft: hasUnread ? '3px solid #22c55e' : '3px solid transparent',
                      bgcolor: 'rgba(13,20,33,0.55)',
                      backdropFilter: 'blur(2px)',
                      '&:hover': { bgcolor: 'rgba(30,40,64,0.75)' },
                      '@keyframes fadeSlide': {
                        from: { opacity: 0, transform: 'translateY(-6px)' },
                        to:   { opacity: 1, transform: 'translateY(0)' },
                      },
                      animation: 'fadeSlide 0.18s ease both',
                      animationDelay: `${i * 0.045}s`,
                    }}
                  >
                    <Box sx={{
                      width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                      background: avatarGrad,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 16, color: '#fff',
                      boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
                    }}>
                      {initials}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.35 }}>
                        <Typography variant="body2" fontWeight={hasUnread ? 700 : 500} noWrap
                          sx={{ flex: 1, mr: 1, color: hasUnread ? '#f1f5f9' : 'rgba(255,255,255,0.72)' }}>
                          {peerName}
                        </Typography>
                        <Typography variant="caption"
                          sx={{ flexShrink: 0, fontSize: 11, color: hasUnread ? '#22c55e' : 'rgba(255,255,255,0.28)' }}>
                          {formatItemDate(s.date)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" noWrap sx={{
                          flex: 1, fontSize: 12,
                          color: hasUnread ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.28)',
                          fontStyle: lastMsg ? 'normal' : 'italic',
                        }}>
                          {lastMsg || 'Sin mensajes aún'}
                        </Typography>
                        {s.total_messages_today > 0 && !hasUnread && (
                          <Typography variant="caption" sx={{ flexShrink: 0, fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>
                            {s.total_messages_today} msgs
                          </Typography>
                        )}
                        {hasUnread && (
                          <Box sx={{
                            minWidth: 20, height: 20, px: 0.75, borderRadius: 10, flexShrink: 0,
                            bgcolor: '#22c55e', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700,
                          }}>
                            {s.total_messages_today}
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </ListItemButton>
                </React.Fragment>
              )
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Instance card ─────────────────────────────────────────────────────────────
function InstanceCard({ inst, token, onRefresh }) {
  const [busy, setBusy]       = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  const cfg = STATUS_CFG[inst.warmup_status] || STATUS_CFG.disconnected

  async function action(endpoint) {
    setBusy(true)
    try {
      await fetch(API(`/warmup/instances/${inst.name}/${endpoint}`), {
        method: 'POST', headers: authHeaders(token),
      })
      onRefresh()
    } finally { setBusy(false) }
  }

  const isActive       = inst.warmup_status === 'active'
  const isPaused       = inst.warmup_status === 'paused'
  const isDisconnected = inst.warmup_status === 'disconnected'
  const progress       = inst.daily_limit > 0 ? Math.min((inst.msgs_today / inst.daily_limit) * 100, 100) : 0
  const lastRel        = relativeTime(inst.last_msg_at)

  return (
    <>
      <Box sx={{
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: `${cfg.border}33`,
        borderTop: `3px solid ${cfg.border}`,
        bgcolor: 'rgba(255,255,255,0.025)',
        display: 'flex', flexDirection: 'column', gap: 0,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}>
        {/* Header */}
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="body1" fontWeight={700} sx={{ lineHeight: 1.3 }}>{inst.label || inst.name}</Typography>
            <Chip
              label={cfg.label} size="small"
              sx={{ bgcolor: cfg.bg, color: cfg.color, fontWeight: 600, fontSize: 11, height: 20, border: `1px solid ${cfg.color}33` }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">{inst.number ? `+${inst.number}` : inst.name}</Typography>

          {/* Topic */}
          {inst.topic && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
              <MovieIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
              <Typography variant="caption" color="text.disabled" noWrap>{inst.topic}</Typography>
            </Box>
          )}
        </Box>

        {/* Stats row */}
        {!isDisconnected ? (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 2.5, alignItems: 'flex-end' }}>
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1} color={isActive ? '#22c55e' : 'text.primary'}>
                {inst.sent_today}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>ENVIADOS</Typography>
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1}>{inst.received_today}</Typography>
              <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>RECIBIDOS</Typography>
            </Box>
            {lastRel && (
              <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                <Typography variant="body2" fontWeight={600} lineHeight={1}>{lastRel}</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>ÚLTIMO</Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="error.main" fontWeight={500}>
              Sin conexión de WhatsApp. Esta instancia no participará en warmup hasta que vuelva a conectarse — entrará al siguiente ciclo de rotación de forma automática.
            </Typography>
          </Box>
        )}

        {/* Progress bar */}
        {!isDisconnected && (
          <Box sx={{ px: 2, pb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, letterSpacing: '0.04em' }}>
                Progreso del día
              </Typography>
              <Typography variant="caption" fontWeight={700} sx={{ fontSize: 11 }}>
                {inst.msgs_today} / {inst.daily_limit}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                height: 5, borderRadius: 3,
                bgcolor: 'rgba(255,255,255,0.08)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 3,
                  bgcolor: isActive ? '#e11d68' : '#f59e0b',
                },
              }}
            />
            {isPaused && inst.paused_at && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block', fontSize: 10 }}>
                Pausado a las {formatTime(inst.paused_at)}
              </Typography>
            )}
          </Box>
        )}

        {/* Disabled overlay notice */}
        {!inst.enabled && (
          <Box sx={{ mx: 2, mb: 1, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Typography variant="caption" sx={{ color: '#f87171', fontSize: 11 }}>
              Excluida del warmup. Habilítala para que participe en el ciclo de calentamiento.
            </Typography>
          </Box>
        )}

        {/* Actions */}
        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Ver chats */}
          <Box
            component="button"
            onClick={() => setChatsOpen(true)}
            disabled={busy}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 1.5, py: 0.6, borderRadius: 1.5, cursor: 'pointer',
              bgcolor: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
              color: 'text.primary', fontSize: 12, fontWeight: 600,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' }, transition: 'background 0.15s',
            }}
          >
            <ChatBubbleOutlinedIcon sx={{ fontSize: 14 }} />
            Ver chats
            {inst.msgs_today > 0 && (
              <Box sx={{ bgcolor: '#e11d68', color: '#fff', borderRadius: '50%', minWidth: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.5 }}>
                {inst.msgs_today}
              </Box>
            )}
          </Box>

          {/* Pause / Resume — solo si habilitada y conectada */}
          {inst.enabled && !isDisconnected && (
            isPaused ? (
              <Box
                component="button"
                onClick={() => action('resume')}
                disabled={busy}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.5, py: 0.6, borderRadius: 1.5, cursor: 'pointer',
                  bgcolor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                  color: '#22c55e', fontSize: 12, fontWeight: 600,
                  '&:hover': { bgcolor: 'rgba(34,197,94,0.18)' }, transition: 'background 0.15s',
                }}
              >
                {busy ? <CircularProgress size={12} /> : <PlayCircleIcon sx={{ fontSize: 14 }} />}
                Reanudar
              </Box>
            ) : (
              <Box
                component="button"
                onClick={() => action('pause')}
                disabled={busy}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75,
                  px: 1.5, py: 0.6, borderRadius: 1.5, cursor: 'pointer',
                  bgcolor: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'text.secondary', fontSize: 12, fontWeight: 600,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' }, transition: 'background 0.15s',
                }}
              >
                {busy ? <CircularProgress size={12} /> : <PauseCircleIcon sx={{ fontSize: 14 }} />}
                Pausar
              </Box>
            )
          )}

          {/* Enable / Disable warmup participation */}
          <Tooltip title={inst.enabled ? 'Excluir del warmup' : 'Incluir en warmup'} placement="top">
            <Box
              component="button"
              onClick={() => action(inst.enabled ? 'disable' : 'enable')}
              disabled={busy}
              sx={{
                ml: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 1.5, cursor: 'pointer',
                bgcolor: inst.enabled ? 'transparent' : 'rgba(34,197,94,0.1)',
                border: inst.enabled ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(34,197,94,0.3)',
                color: inst.enabled ? 'rgba(255,255,255,0.3)' : '#22c55e',
                '&:hover': {
                  bgcolor: inst.enabled ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.18)',
                  color: inst.enabled ? '#f87171' : '#22c55e',
                  borderColor: inst.enabled ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.5)',
                },
                transition: 'all 0.15s',
              }}
            >
              {busy ? <CircularProgress size={12} /> : <PowerSettingsNewIcon sx={{ fontSize: 15 }} />}
            </Box>
          </Tooltip>
        </Box>
      </Box>

      <InstanceChatsDialog open={chatsOpen} onClose={() => setChatsOpen(false)} instanceName={inst.name} token={token} />
    </>
  )
}

// ── WarmupConfigDialog ────────────────────────────────────────────────────────

const WARMUP_TOPICS = [
  { value: 'auto', label: 'Auto-rotation (8 topics)' },
  { value: '0', label: 'Classic 80s–90s films' },
  { value: '1', label: 'Streaming series' },
  { value: '2', label: 'Weekend plans' },
  { value: '3', label: 'Food & restaurants' },
  { value: '4', label: 'Soccer & sports' },
  { value: '5', label: 'Music & artists' },
  { value: '6', label: 'Work & week highlights' },
  { value: '7', label: 'Travel & destinations' },
]

function safetyLevel(maxMsgs, minDelay) {
  if (maxMsgs <= 8 && minDelay >= 12) return 'safe'
  if (maxMsgs <= 12 && minDelay >= 7) return 'moderate'
  return 'risky'
}

const SAFETY = {
  safe:     { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.18)',  Icon: CheckCircleOutlineIcon, label: 'Safe',      desc: 'Low detection risk — ideal for new numbers' },
  moderate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.18)', Icon: WarningAmberIcon,       label: 'Moderate',  desc: 'Acceptable — monitor number health regularly' },
  risky:    { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.18)',  Icon: ErrorOutlineIcon,       label: 'High Risk', desc: 'WhatsApp may flag unusual activity' },
}

// Stepper control: styled −/value/+ replacing native browser arrows
function NumStepper({ value, onChange, min = 0, max = 99, step = 1 }) {
  const btnSx = {
    border: 'none', bgcolor: 'transparent', cursor: 'pointer',
    color: 'rgba(255,255,255,0.35)', px: 1.25, py: 0,
    display: 'flex', alignItems: 'center', flexShrink: 0, alignSelf: 'stretch',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)' },
    transition: 'all 0.12s',
  }
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', width: '100%',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', overflow: 'hidden',
    }}>
      <Box component="button" onClick={() => onChange(Math.max(min, value - step))} sx={{ ...btnSx, borderRight: '1px solid rgba(255,255,255,0.07)' }}>
        <RemoveIcon sx={{ fontSize: 13 }} />
      </Box>
      <Box
        component="input"
        type="number"
        value={value}
        onChange={e => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n))) }}
        min={min} max={max}
        sx={{
          flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
          textAlign: 'center', color: 'text.primary', fontSize: 13, fontWeight: 700,
          fontFamily: 'inherit', py: 0.9, width: 0,
          '&::-webkit-inner-spin-button,&::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
          MozAppearance: 'textfield',
        }}
      />
      <Box component="button" onClick={() => onChange(Math.min(max, value + step))} sx={{ ...btnSx, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
        <AddIcon sx={{ fontSize: 13 }} />
      </Box>
    </Box>
  )
}

// Preset chip — neutral style matching app chip language
const presetChipSx = {
  border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.45)', borderRadius: 1.5,
  cursor: 'pointer', px: 1.25, py: 0.4, fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
  '&:hover': { bgcolor: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.3)', color: '#93bbfd' },
  transition: 'all 0.15s',
}

// Row label with icon
function SectionLabel({ icon: Icon, children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
      <Icon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }} />
      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
        {children}
      </Typography>
    </Box>
  )
}

function WarmupConfigDialog({ open, onClose, token }) {
  const DEFAULT_CFG = { business_hour_start: 9, business_hour_end: 21, min_msgs_per_pair: 6, max_msgs_per_pair: 10, min_delay_min: 8, max_delay_min: 25, topic: 'auto' }
  const [cfg, setCfg]         = useState(DEFAULT_CFG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true); setErr(null); setSaved(false)
    fetch(API('/warmup/config'), { headers: authHeaders(token) })
      .then(r => r.json())
      .then(d => { setCfg(d); setLoading(false) })
      .catch(() => { setCfg(DEFAULT_CFG); setLoading(false) })
  }, [open, token])

  const set = (key) => (val) => setCfg(prev => ({ ...prev, [key]: val }))

  async function handleSave() {
    setSaving(true); setErr(null)
    try {
      const r = await fetch(API('/warmup/config'), {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          business_hour_start: cfg.business_hour_start,
          business_hour_end:   cfg.business_hour_end,
          min_msgs_per_pair:   cfg.min_msgs_per_pair,
          max_msgs_per_pair:   cfg.max_msgs_per_pair,
          min_delay_min:       cfg.min_delay_min,
          max_delay_min:       cfg.max_delay_min,
          topic:               cfg.topic,
        }),
      })
      if (!r.ok) throw new Error(r.status)
      setSaved(true)
      setTimeout(onClose, 800)
    } catch (e) { setErr('Save error: ' + e.message) }
    finally { setSaving(false) }
  }

  const level  = safetyLevel(cfg.max_msgs_per_pair, cfg.min_delay_min)
  const safety = SAFETY[level]
  const SafetyIcon = safety.Icon

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { bgcolor: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, backgroundImage: 'none' } } }}
    >
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, pt: 2.5, pb: 2, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', flexShrink: 0 }}>
          <TuneIcon sx={{ fontSize: 17, color: '#fff' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize={14} color="text.primary" sx={{ lineHeight: 1.3 }}>Warmup Settings</Typography>
          <Typography fontSize={11} color="text.disabled">Automated conversation behavior</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'text.primary' } }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      <DialogContent sx={{ px: 2.5, py: 2.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={26} /></Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            {/* ── Safety badge ── */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1.25,
              px: 1.5, py: 1.25, mb: 2.5, borderRadius: 2,
              bgcolor: safety.bg, border: `1px solid ${safety.border}`,
            }}>
              <SafetyIcon sx={{ fontSize: 18, color: safety.color, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontSize={12} fontWeight={700} sx={{ color: safety.color, lineHeight: 1.2 }}>{safety.label}</Typography>
                <Typography fontSize={11} color="text.disabled" sx={{ lineHeight: 1.4 }}>{safety.desc}</Typography>
              </Box>
            </Box>

            {/* ── Business hours ── */}
            <SectionLabel icon={AccessTimeIcon}>Business Hours</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2.5 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>Start</Typography>
                <NumStepper value={cfg.business_hour_start} onChange={set('business_hour_start')} min={0} max={23} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>End</Typography>
                <NumStepper value={cfg.business_hour_end} onChange={set('business_hour_end')} min={1} max={24} />
              </Box>
            </Box>

            {/* ── Messages per pair ── */}
            <SectionLabel icon={TextsmsOutlinedIcon}>Messages per pair / day</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>Min</Typography>
                <NumStepper value={cfg.min_msgs_per_pair} onChange={set('min_msgs_per_pair')} min={1} max={30} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>Max</Typography>
                <NumStepper value={cfg.max_msgs_per_pair} onChange={set('max_msgs_per_pair')} min={1} max={30} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2.5 }}>
              {[
                { label: 'Conservative', min: 4,  max: 6  },
                { label: 'Standard',     min: 7,  max: 10 },
                { label: 'Aggressive',   min: 12, max: 16 },
              ].map(p => (
                <Box key={p.label} component="button"
                  onClick={() => setCfg(prev => ({ ...prev, min_msgs_per_pair: p.min, max_msgs_per_pair: p.max }))}
                  sx={presetChipSx}
                >{p.label}</Box>
              ))}
            </Box>

            {/* ── Delay between turns ── */}
            <SectionLabel icon={HourglassEmptyIcon}>Delay between turns (min)</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>Min</Typography>
                <NumStepper value={cfg.min_delay_min} onChange={set('min_delay_min')} min={1} max={120} step={5} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>Max</Typography>
                <NumStepper value={cfg.max_delay_min} onChange={set('max_delay_min')} min={1} max={240} step={5} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2.5 }}>
              {[
                { label: 'Natural', min: 15, max: 40 },
                { label: 'Fast',    min: 8,  max: 20 },
                { label: 'Quick',   min: 3,  max: 10 },
              ].map(p => (
                <Box key={p.label} component="button"
                  onClick={() => setCfg(prev => ({ ...prev, min_delay_min: p.min, max_delay_min: p.max }))}
                  sx={presetChipSx}
                >{p.label}</Box>
              ))}
            </Box>

            {/* ── Topic ── */}
            <SectionLabel icon={TopicIcon}>Conversation topic</SectionLabel>
            <Select
              value={cfg.topic}
              onChange={e => set('topic')(e.target.value)}
              size="small"
              fullWidth
              MenuProps={{
                PaperProps: {
                  sx: {
                    bgcolor: '#1a2234',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 2,
                    mt: 0.5,
                    '& .MuiMenuItem-root': {
                      fontSize: 13,
                      py: 1,
                      '&:hover':    { bgcolor: 'rgba(59,130,246,0.12)' },
                      '&.Mui-selected': { bgcolor: 'rgba(59,130,246,0.18)', color: '#93bbfd', '&:hover': { bgcolor: 'rgba(59,130,246,0.24)' } },
                    },
                  },
                },
              }}
              sx={{
                fontSize: 13,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(59,130,246,0.5)', borderWidth: 1 },
                '& .MuiSelect-select': { py: 0.9, color: 'rgba(255,255,255,0.75)' },
                '& .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.3)' },
                bgcolor: 'rgba(255,255,255,0.03)',
                borderRadius: 1.5,
              }}
            >
              {WARMUP_TOPICS.map(t => (
                <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>{t.label}</MenuItem>
              ))}
            </Select>

            {err && <Alert severity="error" sx={{ mt: 2 }}>{err}</Alert>}
          </Box>
        )}
      </DialogContent>

      {/* ── Footer ── */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 2.5, py: 2, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Box component="button" onClick={onClose} sx={{
          border: '1px solid rgba(255,255,255,0.09)', bgcolor: 'transparent',
          color: 'rgba(255,255,255,0.5)', borderRadius: 1.5, cursor: 'pointer',
          px: 2, py: 0.7, fontSize: 13, fontFamily: 'inherit',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.8)' },
          transition: 'all 0.15s',
        }}>Cancel</Box>
        <Box component="button" onClick={handleSave} disabled={saving || saved} sx={{
          border: 'none',
          bgcolor: saved ? 'rgba(34,197,94,0.15)' : '#3b82f6',
          color: saved ? '#22c55e' : '#fff',
          borderRadius: 1.5, cursor: saving || saved ? 'default' : 'pointer',
          px: 2.5, py: 0.7, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
          opacity: saving ? 0.65 : 1,
          '&:hover': { bgcolor: saved ? 'rgba(34,197,94,0.15)' : '#2563eb' },
          transition: 'all 0.15s',
        }}>
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
        </Box>
      </Box>
    </Dialog>
  )
}


// ── Main panel ────────────────────────────────────────────────────────────────
export default function WarmupPanel() {
  const { user } = useUser()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toggling, setToggling]     = useState(false)
  const [search, setSearch]         = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const tickRef = useRef(null)

  const load = useCallback(() => {
    setError(null)
    fetch(API('/warmup/instances'), { headers: authHeaders(user?.token) })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [user?.token])

  useEffect(() => { load() }, [load])

  // Re-calculate relative times every 30s
  useEffect(() => {
    tickRef.current = setInterval(() => setData(d => d ? { ...d } : d), 30_000)
    return () => clearInterval(tickRef.current)
  }, [])

  async function handleToggle() {
    if (toggling) return
    setToggling(true)
    try {
      const r = await fetch(API('/warmup/toggle'), { method: 'POST', headers: authHeaders(user?.token) })
      const { enabled } = await r.json()
      setData(d => ({ ...d, global_enabled: enabled }))
    } finally { setToggling(false) }
  }

  const instances   = data?.instances || []
  const activeCount = data?.active_count ?? 0
  const discCount   = data?.disconnected_count ?? 0
  const discNames   = data?.disconnected_names || []
  const sentTotal   = data?.total_sent_today ?? 0
  const recvTotal   = data?.total_received_today ?? 0
  const globalOn    = data?.global_enabled ?? true
  const nextRot     = data?.next_rotation_at

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 960, mx: 'auto', width: '100%' }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalFireDepartmentIcon sx={{ color: '#e11d68', fontSize: 26 }} />
            <Typography id="tour-nav-warmup" variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>Warmup</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">Calentamiento automático entre instancias activas</Typography>
        </Box>

        {/* Stats + controls */}
        {!loading && data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {activeCount > 0 && (
              <Tooltip title="Instancias participando en el ciclo de calentamiento hoy" placement="bottom">
                <Chip
                  size="small" label={`${activeCount} activa${activeCount !== 1 ? 's' : ''}`}
                  icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', ml: '6px !important' }} />}
                  sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#22c55e', fontWeight: 600, fontSize: 11, border: '1px solid rgba(34,197,94,0.2)', cursor: 'default' }}
                />
              </Tooltip>
            )}
            {discCount > 0 && (
              <Tooltip title="Sin conexión activa de WhatsApp. Vuelven al ciclo automáticamente al reconectarse." placement="bottom">
                <Chip
                  size="small" label={`${discCount} desconectada${discCount !== 1 ? 's' : ''}`}
                  icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ef4444', ml: '6px !important' }} />}
                  sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600, fontSize: 11, border: '1px solid rgba(239,68,68,0.2)', cursor: 'default' }}
                />
              </Tooltip>
            )}
            {(sentTotal > 0 || recvTotal > 0) && (
              <Tooltip title={`Mensajes de calentamiento hoy: ${sentTotal} enviados · ${recvTotal} recibidos entre todas las instancias`} placement="bottom">
                <Chip
                  size="small"
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <ArrowUpwardIcon sx={{ fontSize: 11 }} />{sentTotal}
                      <ArrowDownwardIcon sx={{ fontSize: 11, ml: 0.5 }} />{recvTotal}
                      <Box component="span" sx={{ ml: 0.25, color: 'text.disabled' }}>hoy</Box>
                    </Box>
                  }
                  sx={{ bgcolor: 'rgba(255,255,255,0.05)', fontWeight: 600, fontSize: 11, border: '1px solid rgba(255,255,255,0.1)', cursor: 'default' }}
                />
              </Tooltip>
            )}
            <Tooltip title={globalOn ? 'El sistema de warmup está activo. Tócalo para pausar todos los envíos.' : 'El sistema está pausado. Tócalo para reactivar el calentamiento.'} placement="bottom">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color={globalOn ? 'text.primary' : 'text.disabled'} fontWeight={600}>
                  {globalOn ? 'Activo' : 'Pausado'}
                </Typography>
                <Switch
                  checked={globalOn}
                  onChange={handleToggle}
                  disabled={toggling}
                  size="small"
                  sx={{
                    '& .MuiSwitch-thumb': { bgcolor: globalOn ? '#e11d68' : undefined },
                    '& .MuiSwitch-track': { bgcolor: globalOn ? 'rgba(225,29,104,0.4) !important' : undefined },
                  }}
                />
              </Box>
            </Tooltip>
            <Tooltip title="Warmup Settings">
              <IconButton size="small" onClick={() => setConfigOpen(true)}>
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Actualizar">
              <IconButton size="small" onClick={load} disabled={loading}>
                {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}><CircularProgress /></Box>
      ) : (
        <>
          {/* ── Rotation banner ── */}
          {nextRot && (
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 3,
              px: 2, py: 1.5, borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <SyncIcon sx={{ fontSize: 16, color: 'text.disabled', mt: 0.25, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">
                Próxima rotación de pares:{' '}
                <Box component="span" fontWeight={700} color="text.primary">{formatNextRotation(nextRot)}</Box>
                {discNames.length > 0 && (
                  <>{' · '}<Box component="span" sx={{ color: '#f87171' }}>{discNames.length} instancia{discNames.length !== 1 ? 's' : ''} desconectada{discNames.length !== 1 ? 's' : ''}</Box> entrará{discNames.length !== 1 ? 'n' : ''} en rotación cuando recupere{discNames.length !== 1 ? 'n' : ''} conexión.</>
                )}
              </Typography>
            </Box>
          )}

          {/* ── Instances grid ── */}
          {instances.length === 0 ? (
            <Alert severity="info">No hay instancias wwebjs registradas.</Alert>
          ) : (
            <>
              {/* Buscador */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box sx={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 1,
                  px: 1.5, py: 0.75, borderRadius: 2,
                  bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
                  '&:focus-within': { borderColor: 'rgba(255,255,255,0.2)' }, transition: 'border-color 0.15s',
                }}>
                  <SearchIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
                  <Box
                    component="input"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar instancia..."
                    sx={{
                      flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                      color: 'text.primary', fontSize: 13,
                      '&::placeholder': { color: 'rgba(255,255,255,0.25)' },
                    }}
                  />
                  {search && (
                    <Box
                      component="button"
                      onClick={() => setSearch('')}
                      sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', p: 0, lineHeight: 1, fontSize: 14, '&:hover': { color: 'text.secondary' } }}
                    ><CloseIcon sx={{ fontSize: 14 }} /></Box>
                  )}
                </Box>
                <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.08em', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {instances.length} INSTANCIA{instances.length !== 1 ? 'S' : ''}
                </Typography>
              </Box>

              {instances.filter(i => i.enabled).length < 2 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Se necesitan al menos 2 instancias activas para que el calentamiento funcione.
                </Alert>
              )}

              {(() => {
                const q = search.toLowerCase()
                const filtered = q
                  ? instances.filter(i =>
                      (i.name || '').toLowerCase().includes(q) ||
                      (i.label || '').toLowerCase().includes(q) ||
                      (i.number || '').includes(q)
                    )
                  : instances
                return filtered.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">Sin resultados para «{search}»</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                    {filtered.map(inst => (
                      <InstanceCard key={inst.name} inst={inst} token={user?.token} onRefresh={load} />
                    ))}
                  </Box>
                )
              })()}
            </>
          )}
        </>
      )}

      <WarmupConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} token={user?.token} />
    </Box>
  )
}
