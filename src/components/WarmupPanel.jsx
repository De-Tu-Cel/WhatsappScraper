'use client'
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Skeleton from '@mui/material/Skeleton'
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
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

const API = (path) => `/api${path}`
function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'x-user-token': token || '' }
}

// WA bubble background pattern
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
function relativeTime(isoString, lang, w) {
  if (!isoString) return null
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 60)   return w.relativeNow
  if (diff < 3600) return w.relativeMin.replace('{m}', Math.floor(diff / 60))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return m > 0
    ? w.relativeHourMin.replace('{h}', h).replace('{m}', m)
    : w.relativeHour.replace('{h}', h)
}

function formatTime(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDaySeparator(isoString, lang, w) {
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (!isoString) return w.today
  const d = new Date(isoString)
  if (d.toDateString() === today.toDateString()) return w.today
  if (d.toDateString() === yesterday.toDateString()) return w.yesterday
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

function formatNextRotation(isoString, lang, w) {
  if (!isoString) return ''
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const d = new Date(isoString)
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(0,0,0,0)
  const isToday    = d.toDateString() === now.toDateString()
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (isToday)    return w.rotToday.replace('{time}', time)
  if (isTomorrow) return w.rotTomorrow.replace('{time}', time)
  return d.toLocaleDateString(locale, { weekday: 'long', hour: '2-digit', minute: '2-digit' })
}

function getStatusCfg(w) {
  return {
    active:       { label: w.statusActive,       color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#e11d68' },
    paused:       { label: w.statusPaused,       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: '#f59e0b' },
    disconnected: { label: w.statusDisconnected, color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: '#ef4444' },
  }
}

// Colores para identificar visualmente qué pareja está hablando con quién —
// deliberadamente evita verde/ámbar/rojo (ya usados para el estado activo/pausado/
// desconectado) para que el color del borde no se confunda con el chip de estado.
const PAIR_COLORS = [
  '#3b82f6', '#a855f7', '#ec4899', '#06b6d4',
  '#6366f1', '#14b8a6', '#f97316', '#8b5cf6',
  '#d946ef', '#0ea5e9', '#f43f5e', '#84cc16',
]

// Stable reference for "no instances yet" — data?.instances || [] would otherwise
// construct a brand new array every render, making the useMemo below think its
// dependency changed on every single render even when nothing did.
const EMPTY_INSTANCES = []

// Una entrada por pareja (par de nombres ordenado, no por instancia) para que ambas
// instancias de la misma pareja siempre reciban el mismo color.
//
// El índice de color no es solo "posición alfabética" — se desplaza por un offset
// que cambia cada día (días desde epoch). Sin esto, si el orden alfabético de las
// parejas de hoy coincide por casualidad con el de ayer para alguna instancia
// (probado: pasa seguido con pocas instancias), esa instancia se quedaría con el
// MISMO color aunque su pareja real haya cambiado — justo lo que la rotación debe
// evitar. Con el offset diario, la asignación siempre rota aunque el orden
// alfabético no cambie, y las parejas visibles el mismo día siguen garantizadas
// sin colisión entre sí (asignación secuencial, no hash).
function buildPairColorMap(instances) {
  const dayOffset = Math.floor(Date.now() / 86_400_000)
  const pairKeys = new Set()
  for (const inst of instances) {
    if (!inst.partner) continue
    pairKeys.add([inst.name, inst.partner].sort().join('|'))
  }
  const sortedKeys = [...pairKeys].sort()
  const colorByKey = new Map(
    sortedKeys.map((k, i) => [k, PAIR_COLORS[(i + dayOffset) % PAIR_COLORS.length]])
  )
  const colorByName = new Map()
  const pairKeyByName = new Map()
  for (const inst of instances) {
    if (!inst.partner) continue
    const key = [inst.name, inst.partner].sort().join('|')
    colorByName.set(inst.name, colorByKey.get(key))
    pairKeyByName.set(inst.name, key)
  }
  return { colorByName, pairKeyByName }
}

// ── Session detail dialog ─────────────────────────────────────────────────────
function SessionDetail({ sessionId, token }) {
  const { t, lang } = useLang()
  const w = t.warmup
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef(null)

  useEffect(() => {
    setLoading(true); setSession(null)
    // A failed request (401, etc.) still resolves r.json() fine — its error
    // body ({"detail": "..."}) would pass the `!session` null-check below and
    // render as a session with an empty message list instead of the error
    // state, since fetch() doesn't reject on a non-2xx status.
    fetch(API(`/warmup/sessions/${sessionId}/messages`), { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setSession).catch(() => setSession(null)).finally(() => setLoading(false))
  }, [sessionId, token])

  useEffect(() => {
    if (session && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' })
    }
  }, [session])

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={28} /></Box>
  if (!session) return <Alert severity="error">{w.sessionLoadError}</Alert>

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
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.28)' }}>{w.noMessagesYet}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', px: 1.5, pt: 1.5, pb: 2 }}>
          {grouped.map((item, i) => {
            if (item.type === 'separator') {
              return (
                <Box key={`sep-${item.key}`} sx={{ textAlign: 'center', my: 1.25 }}>
                  <Chip label={formatDaySeparator(item.ts, lang, w)} size="small" sx={{
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
                      {new Date(msg.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
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

function formatItemDate(dateStr, w) {
  if (!dateStr) return ''
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return w.today
  if (dateStr === yesterday) return w.yesterday
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function InstanceChatsDialog({ open, onClose, instanceName, token }) {
  const { t, lang } = useLang()
  const w = t.warmup
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selected, setSelected] = useState(null)
  const [viewedIds, setViewedIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`wmup_viewed_${instanceName}`)) || []) } catch { return new Set() }
  })

  useEffect(() => {
    if (!open) return
    setSelected(null); setLoading(true); setLoadError(false)
    // fetch() only rejects on a network failure, never on a non-2xx status —
    // an unchecked r.json() on a 401 ({"detail": "..."}) was setting sessions
    // to that error OBJECT instead of an array, crashing sessions.map() below.
    fetch(API(`/warmup/chats/${instanceName}`), { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(() => { setSessions([]); setLoadError(true) })
      .finally(() => setLoading(false))
  }, [open, instanceName, token])

  const peer = s => s.instance_a === instanceName ? s.instance_b : s.instance_a

  const selectedSession = selected ? sessions.find(s => s._id === selected) : null
  const selectedPeer = selectedSession ? peer(selectedSession) : null

  const handleSelect = (id) => {
    setViewedIds(prev => {
      const next = new Set(prev); next.add(id)
      try { localStorage.setItem(`wmup_viewed_${instanceName}`, JSON.stringify([...next])) } catch {}
      return next
    })
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
              {selectedSession.total_messages_today} {w.msgsTodaySuffix} · {selectedSession.instance_a} ↔ {selectedSession.instance_b}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.1 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.38)', fontSize: 10, lineHeight: 1 }}>
                {w.activeLabel}
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
            <ChatBubbleOutlinedIcon sx={{ fontSize: 52, color: loadError ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.1)', mb: 1.5 }} />
            <Typography variant="body2" sx={{ color: loadError ? '#f87171' : 'rgba(255,255,255,0.35)' }}>
              {loadError ? (lang === 'en' ? 'Could not load conversations — try again.' : 'No se pudieron cargar las conversaciones — intenta de nuevo.') : w.noConvsYet}
            </Typography>
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
                          {formatItemDate(s.date, w)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" noWrap sx={{
                          flex: 1, fontSize: 12,
                          color: hasUnread ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.28)',
                          fontStyle: lastMsg ? 'normal' : 'italic',
                        }}>
                          {lastMsg || w.noMessagesFallback}
                        </Typography>
                        {s.total_messages_today > 0 && !hasUnread && (
                          <Typography variant="caption" sx={{ flexShrink: 0, fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>
                            {s.total_messages_today} {w.msgsAbbrev}
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
function InstanceCard({ inst, token, onRefresh, pairColor }) {
  const { t, lang } = useLang()
  const w = t.warmup
  const [busy, setBusy]       = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [lastViewed, setLastViewed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`wmup_seen_${inst.name}`)) || null } catch { return null }
  })
  const statusCfg = getStatusCfg(w)
  const cfg = statusCfg[inst.warmup_status] || statusCfg.disconnected
  // El color de pareja reemplaza al color de estado en el borde — el estado ya se
  // ve en el chip de la esquina, así que el borde queda libre para identificar
  // con quién está hablando cada instancia. Sin pareja (recién conectada o
  // desconectada) se usa el color de estado de siempre.
  const borderAccent = pairColor || cfg.border

  const newMsgCount = (() => {
    if (!inst.last_msg_at) return 0
    if (!lastViewed) return inst.msgs_today > 0 ? inst.msgs_today : 0
    if (new Date(inst.last_msg_at) <= new Date(lastViewed.at)) return 0
    return Math.max(0, inst.msgs_today - (lastViewed.msgs || 0))
  })()

  function openChats() {
    const rec = { at: Date.now(), msgs: inst.msgs_today }
    try { localStorage.setItem(`wmup_seen_${inst.name}`, JSON.stringify(rec)) } catch {}
    setLastViewed(rec)
    setChatsOpen(true)
  }

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
  const lastRel        = relativeTime(inst.last_msg_at, lang, w)

  return (
    <>
      <Box sx={{
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: `${borderAccent}33`,
        borderTop: `3px solid ${borderAccent}`,
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
          {/* Divider corto (no de ancho completo) + número como tag, en vez
             del texto plano de antes que se veía muy simple al lado del
             nombre en negritas. */}
          <Box sx={{ width: 26, height: '1px', bgcolor: 'rgba(255,255,255,0.12)', my: 0.7 }} />
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', px: 0.9, py: 0.3, borderRadius: 1,
            bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <Typography sx={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.02em', color: 'var(--text-muted, rgba(255,255,255,0.5))' }}>
              {inst.number ? `+${inst.number}` : inst.name}
            </Typography>
          </Box>

          {/* Partner indicator */}
          {!isDisconnected && (
            inst.partner ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.5 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: borderAccent, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: borderAccent, fontSize: 11, fontWeight: 600 }}>
                  ↔ {inst.partner}
                </Typography>
              </Box>
            ) : (
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.75,
                px: 1, py: 0.35, borderRadius: 1,
                bgcolor: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.22)',
              }}>
                <HourglassEmptyIcon sx={{ fontSize: 10, color: '#fb923c' }} />
                <Typography variant="caption" sx={{ color: '#fb923c', fontSize: 10, fontWeight: 600, letterSpacing: '0.01em' }}>
                  {w.noPartnerToday}
                </Typography>
              </Box>
            )
          )}
        </Box>

        {/* Stats row */}
        {!isDisconnected ? (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 0, alignItems: 'stretch' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1, color: isActive ? '#22c55e' : 'text.primary' }}>
                {inst.sent_today}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>{w.statSent}</Typography>
            </Box>
            <Box sx={{ width: '1px', bgcolor: 'rgba(255,255,255,0.07)', mx: 2, my: 0.25, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1 }}>{inst.received_today}</Typography>
              <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>{w.statReceived}</Typography>
            </Box>
            {lastRel && (
              <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1 }}>{lastRel}</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.05em', fontSize: 10 }}>{w.statLast}</Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="error.main" fontWeight={500}>
              {w.disconnectedNotice}
            </Typography>
          </Box>
        )}

        {/* Progress bar */}
        {!isDisconnected && (
          <Box sx={{ px: 2, pb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, letterSpacing: '0.04em' }}>
                {w.progressToday}
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
                  bgcolor: isActive ? borderAccent : '#f59e0b',
                },
              }}
            />
            {isPaused && inst.paused_at && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block', fontSize: 10 }}>
                {w.pausedAt.replace('{time}', formatTime(inst.paused_at))}
              </Typography>
            )}
          </Box>
        )}

        {/* Disabled overlay notice */}
        {!inst.enabled && (
          <Box sx={{ mx: 2, mb: 1, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Typography variant="caption" sx={{ color: '#f87171', fontSize: 11 }}>
              {w.excludedNotice}
            </Typography>
          </Box>
        )}

        {/* Actions */}
        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Ver chats */}
          <Box
            component="button"
            onClick={() => openChats()}
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
            {w.viewChats}
            {newMsgCount > 0 && (
              <Box sx={{ bgcolor: borderAccent, color: '#fff', borderRadius: '50%', minWidth: 16, height: 16, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.5 }}>
                {newMsgCount}
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
                {w.resume}
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
                {w.pause}
              </Box>
            )
          )}

          {/* Enable / Disable warmup participation */}
          <Tooltip title={inst.enabled ? w.excludeTooltip : w.includeTooltip} placement="top">
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

// Los value numéricos ('0'-'13') deben coincidir uno a uno con el orden de
// _TOPICS en backEnd/app/warmup_queue.py — ahí vive el prompt real que usa
// la IA para generar la conversación de cada tema, esto solo es la etiqueta.
function getWarmupTopics(w) {
  const fixedTopics = [
    { value: '0',  label: w.topicVideogames },
    { value: '1',  label: w.topicClassicMovies },
    { value: '2',  label: w.topicConspiracy },
    { value: '3',  label: w.topicAnime },
    { value: '4',  label: w.topicGeekCulture },
    { value: '5',  label: w.topicHorrorMovies },
    { value: '6',  label: w.topicTech },
    { value: '7',  label: w.topicMusic },
    { value: '8',  label: w.topicFootball },
    { value: '9',  label: w.topicFood },
    { value: '10', label: w.topicTravel },
    { value: '11', label: w.topicWorkSchool },
    { value: '12', label: w.topicSeries },
    { value: '13', label: w.topicCars },
  ]
  return [
    { value: 'auto', label: w.topicAuto.replace('{n}', fixedTopics.length) },
    ...fixedTopics,
  ]
}

function safetyLevel(maxMsgs, minDelay) {
  if (maxMsgs <= 8 && minDelay >= 12) return 'safe'
  if (maxMsgs <= 12 && minDelay >= 7) return 'moderate'
  return 'risky'
}

function getSafety(w) {
  return {
    safe:     { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.18)',  Icon: CheckCircleOutlineIcon, label: w.safetyLabelSafe,     desc: w.safetyDescSafe },
    moderate: { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.18)', Icon: WarningAmberIcon,       label: w.safetyLabelModerate, desc: w.safetyDescModerate },
    risky:    { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.18)',  Icon: ErrorOutlineIcon,       label: w.safetyLabelRisky,    desc: w.safetyDescRisky },
  }
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
      transition: 'border-color 0.15s',
      // No daba ninguna señal visual al enfocar el campo — un detalle extra
      // ya que estamos afinando esta ventana.
      '&:focus-within': { borderColor: 'rgba(225,29,104,0.4)' },
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
  '&:hover': { bgcolor: 'rgba(225,29,104,0.1)', borderColor: 'rgba(225,29,104,0.3)', color: '#f472b6' },
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
  const { t } = useLang()
  const w = t.warmup
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
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
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
    } catch (e) { setErr(w.saveErrorPrefix + e.message) }
    finally { setSaving(false) }
  }

  const level  = safetyLevel(cfg.max_msgs_per_pair, cfg.min_delay_min)
  const safety = getSafety(w)[level]
  const SafetyIcon = safety.Icon
  const warmupTopics = getWarmupTopics(w)

  // bgcolor fijo (#111827) no seguía el color de fondo dinámico
  // (var(--card-bg)) que usa el resto de la UI — se veía como un panel
  // de otro color al lado de todo lo de alrededor.
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, backgroundImage: 'none' } } }}
    >
      {/* ── Header — mismo rosa/rojo (#e11d68) que ya usan el título de
         Warmup, el switch y la barra de rotación, en vez del azul que no
         tenía relación con el resto de la página. ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, pt: 2.5, pb: 2, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(225,29,104,0.28) 0%, rgba(225,29,104,0.1) 100%)',
          border: '1px solid rgba(225,29,104,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <TuneIcon sx={{ fontSize: 17, color: '#e11d68' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} fontSize={14} color="text.primary" sx={{ lineHeight: 1.3 }}>{w.configTitle}</Typography>
          <Typography fontSize={11} color="text.disabled">{w.configSubtitle}</Typography>
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
            <SectionLabel icon={AccessTimeIcon}>{w.sectionHours}</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2.5 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.hourStart}</Typography>
                <NumStepper value={cfg.business_hour_start} onChange={set('business_hour_start')} min={0} max={23} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.hourEnd}</Typography>
                <NumStepper value={cfg.business_hour_end} onChange={set('business_hour_end')} min={1} max={24} />
              </Box>
            </Box>

            {/* Dividers cortos (con margen lateral, no de borde a borde) entre
               cada sección, en vez de solo el espaciado en blanco de antes. */}
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mx: 1.5, mb: 2 }} />

            {/* ── Messages per pair ── */}
            <SectionLabel icon={TextsmsOutlinedIcon}>{w.sectionMsgsPerPair}</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.msgsMin}</Typography>
                <NumStepper value={cfg.min_msgs_per_pair} onChange={set('min_msgs_per_pair')} min={1} max={30} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.msgsMax}</Typography>
                <NumStepper value={cfg.max_msgs_per_pair} onChange={set('max_msgs_per_pair')} min={1} max={30} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2.5 }}>
              {[
                { label: w.presetConservative, min: 4,  max: 6  },
                { label: w.presetStandard,     min: 7,  max: 10 },
                { label: w.presetAggressive,   min: 12, max: 16 },
              ].map(p => (
                <Box key={p.label} component="button"
                  onClick={() => setCfg(prev => ({ ...prev, min_msgs_per_pair: p.min, max_msgs_per_pair: p.max }))}
                  sx={presetChipSx}
                >{p.label}</Box>
              ))}
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mx: 1.5, mb: 2 }} />

            {/* ── Delay between turns ── */}
            <SectionLabel icon={HourglassEmptyIcon}>{w.sectionDelay}</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.delayMin}</Typography>
                <NumStepper value={cfg.min_delay_min} onChange={set('min_delay_min')} min={1} max={120} step={5} />
              </Box>
              <Box>
                <Typography fontSize={11} color="rgba(255,255,255,0.35)" sx={{ mb: 0.5 }}>{w.delayMax}</Typography>
                <NumStepper value={cfg.max_delay_min} onChange={set('max_delay_min')} min={1} max={240} step={5} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2.5 }}>
              {[
                { label: w.presetNatural,   min: 15, max: 40 },
                { label: w.presetFast,      min: 8,  max: 20 },
                { label: w.presetVeryFast,  min: 3,  max: 10 },
              ].map(p => (
                <Box key={p.label} component="button"
                  onClick={() => setCfg(prev => ({ ...prev, min_delay_min: p.min, max_delay_min: p.max }))}
                  sx={presetChipSx}
                >{p.label}</Box>
              ))}
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mx: 1.5, mb: 2 }} />

            {/* ── Topic ── */}
            <SectionLabel icon={TopicIcon}>{w.sectionTopic}</SectionLabel>
            <Select
              value={cfg.topic}
              onChange={e => set('topic')(e.target.value)}
              size="small"
              fullWidth
              MenuProps={{
                slotProps: {
                  paper: {
                    sx: {
                      bgcolor: 'var(--card-bg, #161d2e)',
                      backgroundImage: 'none',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 2,
                      mt: 0.5,
                      '& .MuiMenuItem-root': {
                        fontSize: 13,
                        py: 1,
                        '&:hover':    { bgcolor: 'rgba(225,29,104,0.12)' },
                        '&.Mui-selected': { bgcolor: 'rgba(225,29,104,0.18)', color: '#f472b6', '&:hover': { bgcolor: 'rgba(225,29,104,0.24)' } },
                      },
                    },
                  },
                },
              }}
              sx={{
                fontSize: 13,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(225,29,104,0.5)', borderWidth: 1 },
                '& .MuiSelect-select': { py: 0.9, color: 'rgba(255,255,255,0.75)' },
                '& .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.3)' },
                bgcolor: 'rgba(255,255,255,0.03)',
                borderRadius: 1.5,
              }}
            >
              {warmupTopics.map(topic => (
                <MenuItem key={topic.value} value={topic.value} sx={{ fontSize: 13 }}>{topic.label}</MenuItem>
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
        }}>{w.cancel}</Box>
        <Box component="button" onClick={handleSave} disabled={saving || saved} sx={{
          border: 'none',
          // Antes iba en azul (#3b82f6) sin relación con el resto de Warmup
          // — ahora usa el mismo rosa/rojo (#e11d68) del ícono de arriba.
          bgcolor: saved ? 'rgba(34,197,94,0.15)' : '#e11d68',
          color: saved ? '#22c55e' : '#fff',
          borderRadius: 1.5, cursor: saving || saved ? 'default' : 'pointer',
          px: 2.5, py: 0.7, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
          opacity: saving ? 0.65 : 1,
          '&:hover': { bgcolor: saved ? 'rgba(34,197,94,0.15)' : '#c81760' },
          transition: 'all 0.15s',
        }}>
          {saved ? w.savedCheck : saving ? w.saving : w.save}
        </Box>
      </Box>
    </Dialog>
  )
}


// ── Loading skeletons ────────────────────────────────────────────────────────
// Mismo shimmer que ya usa ResultSkeleton (resultDisplay.jsx) — antes esta
// pantalla solo mostraba un CircularProgress centrado sin ninguna forma real,
// mientras que el resto de la app ya usa recuadros con la silueta real del
// contenido que está por llegar.
const WSKEL = { bgcolor: 'var(--skeleton-base,rgba(255,255,255,0.06))', '[data-theme-mode="light"] &': { bgcolor: 'rgba(0,0,0,0.08)' }, '&::after': { background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)', '[data-theme-mode="light"] &': { background: 'linear-gradient(90deg,transparent,rgba(0,0,0,0.04),transparent)' } } }

function WarmupStatsRowSkeleton() {
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
        borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
        bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
      }}>
        {[1, 2, 3, 4].map(i => (
          <React.Fragment key={i}>
            {i > 1 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
            <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
              <Skeleton variant="circular" width={40} height={40} sx={WSKEL} />
              <Box sx={{ minWidth: 0 }}>
                <Skeleton variant="text" width={60} height={18} sx={WSKEL} />
                <Skeleton variant="text" width={40} height={24} sx={WSKEL} />
              </Box>
            </Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  )
}

function WarmupCardsSkeleton() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <Box key={i} sx={{
          borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderTop: '3px solid var(--border, rgba(255,255,255,0.15))',
          bgcolor: 'rgba(255,255,255,0.025)', p: 2, display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Skeleton variant="text" width={110} height={22} sx={WSKEL} />
            <Skeleton variant="rounded" width={64} height={20} sx={{ ...WSKEL, borderRadius: 10 }} />
          </Box>
          <Skeleton variant="rounded" width={90} height={20} sx={{ ...WSKEL, borderRadius: 1 }} />
          <Skeleton variant="text" width={100} height={16} sx={WSKEL} />
          <Skeleton variant="rounded" height={6} sx={{ ...WSKEL, borderRadius: 3, mt: 0.5 }} />
        </Box>
      ))}
    </Box>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
// Mismo patrón de ícono + anillo conic-gradient + label + valor que ya usan
// Prospects/Analytics/Instances, para que los indicadores de arriba (antes
// chips sueltos flotando en el banner) vivan en su propio recuadro con
// Dividers verticales en vez de ir pegados al título.
function WarmupStatCard({ icon, color, value, label, subtitle, percent }) {
  const pct = percent == null ? 100 : Math.max(0, Math.min(100, percent))
  return (
    <Box sx={{
      flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4,
      px: 2, py: 1.6,
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0, p: '3px',
        background: `conic-gradient(${color} ${pct}%, var(--border, rgba(255,255,255,0.12)) ${pct}% 100%)`,
      }}>
        <Box sx={{
          width: '100%', height: '100%', borderRadius: '50%',
          bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.76rem', color: 'var(--text)', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
            {subtitle}
          </Typography>
        )}
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {value}
        </Typography>
      </Box>
    </Box>
  )
}

export default function WarmupPanel() {
  const { user } = useUser()
  const { t, lang } = useLang()
  const w = t.warmup
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toggling, setToggling]     = useState(false)
  const [search, setSearch]         = useState('')
  const [groupByPair, setGroupByPair] = useState(false)
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

  const instances   = data?.instances || EMPTY_INSTANCES
  const { colorByName: pairColorByName, pairKeyByName } = useMemo(
    () => buildPairColorMap(instances), [instances]
  )
  const activeCount = data?.active_count ?? 0
  const discCount   = data?.disconnected_count ?? 0
  const discNames   = data?.disconnected_names || []
  const sentTotal   = data?.total_sent_today ?? 0
  const recvTotal   = data?.total_received_today ?? 0
  const globalOn    = data?.global_enabled ?? true
  const nextRot     = data?.next_rotation_at

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 960, mx: 'auto', width: '100%' }}>

      {/* ── Header — mismo lenguaje de banner (ícono en caja degradada +
         línea de brillo inferior) que ya usan Performance e Instances, en el
         rosa/rojo que ya era el acento propio de Warmup, en vez del ícono +
         texto plano de antes que se veía apagado al lado de esas otras
         secciones ya renovadas. ── */}
      <Box sx={{
        borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))',
        bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', mb: 2.5,
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
          px: 2, py: 1.6, position: 'relative',
          background: 'linear-gradient(135deg, rgba(225,29,104,0.14) 0%, rgba(225,29,104,0.04) 60%, transparent 100%)',
          borderBottom: '1px solid rgba(225,29,104,0.15)',
          '&::after': {
            content: '""', position: 'absolute', bottom: 0, left: 16, right: 16, height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(225,29,104,0.4) 40%, rgba(225,29,104,0.4) 60%, transparent)',
          },
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(225,29,104,0.28) 0%, rgba(225,29,104,0.1) 100%)',
              border: '1px solid rgba(225,29,104,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <LocalFireDepartmentIcon sx={{ color: '#e11d68', fontSize: 17 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography id="tour-nav-warmup" sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
                {w.title}
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
                {w.subtitle}
              </Typography>
            </Box>
          </Box>

          {/* Controles — el estado on/off, config y refresh se quedan en el
             banner; los conteos (antes chips sueltos aquí mismo) ahora viven
             en su propio recuadro con anillos abajo. */}
          {!loading && data && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Tooltip title={globalOn ? w.systemOnTooltip : w.systemOffTooltip} placement="bottom">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" color={globalOn ? 'text.primary' : 'text.disabled'} fontWeight={600}>
                    {globalOn ? w.systemOn : w.systemOff}
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
              <Tooltip title={w.configTooltip}>
                <IconButton size="small" onClick={() => setConfigOpen(true)} sx={{ color: 'var(--text-muted)', '&:hover': { color: '#e11d68' } }}>
                  <TuneIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={w.refreshTooltip}>
                <IconButton size="small" onClick={load} disabled={loading} sx={{ color: 'var(--text-muted)', '&:hover': { color: '#e11d68' } }}>
                  {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>

        {/* Conteos — mismo patrón de ícono + anillo + label + valor que
           Prospects/Analytics/Instances, en vez de los 3 chips sueltos que
           antes flotaban dentro del banner junto al título. */}
        {loading && <WarmupStatsRowSkeleton />}
        {!loading && data && instances.length > 0 && (
          <Box sx={{ p: 2 }}>
            <Box sx={{
              display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
              borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
              bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
            }}>
              {[
                {
                  key: 'active', color: '#4ade80',
                  icon: <PlayCircleIcon sx={{ fontSize: 18, color: '#4ade80' }} />,
                  value: activeCount.toLocaleString(), label: w.activeChip.replace('{n}', '').trim() || (lang === 'en' ? 'active' : 'activas'),
                  subtitle: instances.length > 0 ? `${Math.round((activeCount / instances.length) * 100)}%` : null,
                  percent: instances.length > 0 ? Math.round((activeCount / instances.length) * 100) : 0,
                },
                discCount > 0 && {
                  key: 'offline', color: '#ef4444',
                  icon: <SignalWifiOffIcon sx={{ fontSize: 18, color: '#ef4444' }} />,
                  value: discCount.toLocaleString(), label: w.offlineChip.replace('{n}', '').trim() || (lang === 'en' ? 'offline' : 'sin conexión'),
                  subtitle: instances.length > 0 ? `${Math.round((discCount / instances.length) * 100)}%` : null,
                  percent: instances.length > 0 ? Math.round((discCount / instances.length) * 100) : 0,
                },
                {
                  key: 'sent', color: '#60a5fa',
                  icon: <ArrowUpwardIcon sx={{ fontSize: 18, color: '#60a5fa' }} />,
                  value: sentTotal.toLocaleString(), label: lang === 'en' ? 'Sent today' : 'Enviados hoy',
                },
                {
                  key: 'received', color: '#a78bfa',
                  icon: <ArrowDownwardIcon sx={{ fontSize: 18, color: '#a78bfa' }} />,
                  value: recvTotal.toLocaleString(), label: lang === 'en' ? 'Received today' : 'Recibidos hoy',
                },
              ].filter(Boolean).map(({ key, ...c }, i) => (
                <React.Fragment key={key}>
                  {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
                  <WarmupStatCard {...c} />
                </React.Fragment>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <WarmupCardsSkeleton />
      ) : (
        <>
          {/* ── Rotation banner — mismo acento rosa/rojo del resto de la
             página (ícono en caja degradada) en vez del recuadro gris plano
             de antes, que no tenía ninguna relación visual con el resto. ── */}
          {nextRot && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1.5, mb: 3,
              px: 2, py: 1.4, borderRadius: 2,
              bgcolor: 'rgba(225,29,104,0.05)', border: '1px solid rgba(225,29,104,0.15)',
            }}>
              <Box sx={{
                width: 26, height: 26, borderRadius: '8px', flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(225,29,104,0.25) 0%, rgba(225,29,104,0.08) 100%)',
                border: '1px solid rgba(225,29,104,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <SyncIcon sx={{ fontSize: 14, color: '#e11d68' }} />
              </Box>
              <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                {w.nextRotationLabel}{' '}
                <Box component="span" fontWeight={700} sx={{ color: 'var(--text)' }}>{formatNextRotation(nextRot, lang, w)}</Box>
                {discNames.length > 0 && (
                  <>{' · '}<Box component="span" sx={{ color: '#f87171' }}>{(discNames.length !== 1 ? w.disconnectedCountPlural : w.disconnectedCountSingular).replace('{n}', discNames.length)}</Box> {w.willReconnect}</>
                )}
              </Typography>
            </Box>
          )}

          {/* ── Instances grid ── */}
          {instances.length === 0 ? (
            <Alert severity="info">{w.noInstancesRegistered}</Alert>
          ) : (
            <>
              {/* Buscador — mismo lenguaje de input (var(--surface)/var(--border)
                 con foco en el acento propio de la página) que ya usan
                 Instances/Prospects, en vez de los grises fijos de antes. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <Box sx={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 1,
                  px: 1.5, py: 0.75, borderRadius: 2,
                  bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.1))',
                  '&:focus-within': { borderColor: 'rgba(225,29,104,0.4)' }, transition: 'border-color 0.15s',
                }}>
                  <SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }} />
                  <Box
                    component="input"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={w.searchPlaceholder}
                    sx={{
                      flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent',
                      color: 'var(--text)', fontSize: 13,
                      '&::placeholder': { color: 'var(--text-muted)', opacity: 0.7 },
                    }}
                  />
                  {search && (
                    <Box
                      component="button"
                      onClick={() => setSearch('')}
                      sx={{ border: 'none', bgcolor: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', p: 0, lineHeight: 1, fontSize: 14, '&:hover': { color: 'var(--text)' } }}
                    ><CloseIcon sx={{ fontSize: 14 }} /></Box>
                  )}
                </Box>
                <Tooltip title={groupByPair ? w.pairsFilterOnTooltip : w.pairsFilterOffTooltip}>
                  <Chip
                    size="small"
                    clickable
                    onClick={() => setGroupByPair(g => !g)}
                    icon={<SwapHorizIcon sx={{ fontSize: '14px !important' }} />}
                    label={w.pairsFilterLabel}
                    sx={{
                      flexShrink: 0, fontSize: 11, fontWeight: 600,
                      bgcolor: groupByPair ? 'rgba(225,29,104,0.15)' : 'var(--item-hover, rgba(255,255,255,0.05))',
                      color: groupByPair ? '#e11d68' : 'var(--text-muted)',
                      border: `1px solid ${groupByPair ? 'rgba(225,29,104,0.4)' : 'var(--border, rgba(255,255,255,0.1))'}`,
                      '&:hover': { bgcolor: groupByPair ? 'rgba(225,29,104,0.22)' : 'var(--item-hover, rgba(255,255,255,0.08))' },
                    }}
                  />
                </Tooltip>
                <Typography variant="caption" sx={{ color: 'var(--text-muted)', letterSpacing: '0.08em', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {(instances.length !== 1 ? w.instanceCountPlural : w.instanceCountSingular).replace('{n}', instances.length)}
                </Typography>
              </Box>

              {instances.filter(i => i.enabled).length < 2 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {w.needTwoActive}
                </Alert>
              )}

              {(() => {
                const q = search.toLowerCase()
                let filtered = q
                  ? instances.filter(i =>
                      (i.name || '').toLowerCase().includes(q) ||
                      (i.label || '').toLowerCase().includes(q) ||
                      (i.number || '').includes(q)
                    )
                  : instances
                if (groupByPair) {
                  // Solo instancias con pareja hoy, ordenadas para que ambos lados
                  // de cada pareja queden adyacentes en la grilla.
                  filtered = filtered
                    .filter(i => i.partner)
                    .sort((a, b) => {
                      const ka = pairKeyByName.get(a.name) || ''
                      const kb = pairKeyByName.get(b.name) || ''
                      return ka === kb ? a.name.localeCompare(b.name) : ka.localeCompare(kb)
                    })
                }
                return filtered.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      {groupByPair ? w.noPairsToday : w.noSearchResults.replace('{search}', search)}
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                    {filtered.map(inst => (
                      <InstanceCard
                        key={inst.name} inst={inst} token={user?.token} onRefresh={load}
                        pairColor={pairColorByName.get(inst.name)}
                      />
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
