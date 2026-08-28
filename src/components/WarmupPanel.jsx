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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { useUser } from '../context/UserContext'

const API = (path) => `/api${path}`
function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'x-user-token': token || '' }
}

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
function SessionDetail({ sessionId, onBack, token }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(API(`/warmup/sessions/${sessionId}/messages`), { headers: authHeaders(token) })
      .then(r => r.json()).then(setSession).catch(() => {}).finally(() => setLoading(false))
  }, [sessionId, token])

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={28} /></Box>
  if (!session) return <Alert severity="error">No se pudo cargar la sesión.</Alert>

  const msgs = session.messages || []
  return (
    <Box sx={{
      flex: 1, overflow: 'auto',
      bgcolor: 'action.hover',
      backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.06) 1px, transparent 1px)',
      backgroundSize: '20px 20px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Subtítulo: instancias */}
      <Box sx={{ textAlign: 'center', pt: 1.5, pb: 0.5 }}>
        <Chip
          label={`${session.instance_a} ↔ ${session.instance_b}`}
          size="small"
          sx={{ fontSize: 11, bgcolor: 'background.paper', color: 'text.secondary' }}
        />
      </Box>

      {msgs.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">Sin mensajes aún hoy.</Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, px: 2, pt: 1, pb: 2 }}>
          {msgs.map((msg, i) => {
            const isA = msg.speaker === 'a'
            return (
              <Box key={i} sx={{ display: 'flex', justifyContent: isA ? 'flex-start' : 'flex-end' }}>
                <Box sx={{
                  maxWidth: '78%', px: 1.25, pt: 0.5, pb: 0.25,
                  bgcolor: isA ? 'background.paper' : 'primary.main',
                  color: isA ? 'text.primary' : 'primary.contrastText',
                  borderRadius: isA ? '2px 12px 12px 12px' : '12px 2px 12px 12px',
                  boxShadow: 1,
                }}>
                  <Typography variant="caption" sx={{
                    fontWeight: 700, display: 'block', mb: 0.25,
                    color: isA ? 'primary.main' : 'rgba(255,255,255,0.8)',
                  }}>
                    {isA ? session.instance_a : session.instance_b}
                  </Typography>
                  <Typography variant="body2" sx={{ lineHeight: 1.4 }}>{msg.content}</Typography>
                  {msg.ts && (
                    <Typography variant="caption" sx={{
                      display: 'block', textAlign: 'right', mt: 0.25,
                      color: isA ? 'text.disabled' : 'rgba(255,255,255,0.65)',
                      fontSize: 10,
                    }}>
                      {new Date(msg.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

// ── Chats dialog ──────────────────────────────────────────────────────────────
function InstanceChatsDialog({ open, onClose, instanceName, token }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!open) return
    setSelected(null); setLoading(true)
    fetch(API(`/warmup/chats/${instanceName}`), { headers: authHeaders(token) })
      .then(r => r.json()).then(setSessions).catch(() => {}).finally(() => setLoading(false))
  }, [open, instanceName, token])

  const peer = s => s.instance_a === instanceName ? s.instance_b : s.instance_a

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2.5, overflow: 'hidden', height: '70vh', maxHeight: 560, display: 'flex', flexDirection: 'column' } } }}>

      {/* Header estilo WhatsApp — Box evita el h2 de DialogTitle */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2, py: 1.5, flexShrink: 0,
        bgcolor: 'primary.main', color: 'primary.contrastText',
      }}>
        {selected ? (
          <IconButton size="small" onClick={() => setSelected(null)} sx={{ color: 'inherit' }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        ) : (
          <ChatBubbleOutlinedIcon fontSize="small" />
        )}
        <Typography variant="subtitle1" fontWeight={700} component="span" sx={{ flex: 1, lineHeight: 1 }}>
          {selected ? 'Conversación' : `Chats — ${instanceName}`}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: 'inherit', opacity: 0.8 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Lista de sesiones / chat */}
      <DialogContent sx={{ p: 0, overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : selected ? (
          <SessionDetail sessionId={selected} onBack={() => setSelected(null)} token={token} />
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <ChatBubbleOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">Sin chats de calentamiento aún.</Typography>
          </Box>
        ) : (
          <List disablePadding>
            {sessions.map((s, i) => {
              const peerName = peer(s)
              const initials = peerName.slice(0, 2).toUpperCase()
              const lastMsg = s.messages?.[s.messages.length - 1]?.content
              return (
                <React.Fragment key={s._id}>
                  {i > 0 && <Divider component="li" />}
                  <ListItemButton onClick={() => setSelected(s._id)} sx={{ px: 2, py: 1.5, gap: 1.5 }}>
                    {/* Avatar */}
                    <Box sx={{
                      width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                      bgcolor: 'primary.main', color: 'primary.contrastText',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 15,
                    }}>
                      {initials}
                    </Box>
                    {/* Texto */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, mr: 1 }}>
                          {peerName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {s.date}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, mr: 1 }}>
                          {lastMsg || `${s.total_messages_today} mensajes hoy`}
                        </Typography>
                        {s.total_messages_today > 0 && (
                          <Box sx={{
                            minWidth: 20, height: 20, px: 0.75, borderRadius: 10, flexShrink: 0,
                            bgcolor: 'success.main', color: 'white',
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

        {/* Actions */}
        <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 1, alignItems: 'center' }}>
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

          {/* Pause / Resume */}
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
        </Box>
      </Box>

      <InstanceChatsDialog open={chatsOpen} onClose={() => setChatsOpen(false)} instanceName={inst.name} token={token} />
    </>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function WarmupPanel() {
  const { user } = useUser()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [toggling, setToggling] = useState(false)
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
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>Warmup</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">Calentamiento automático entre instancias activas</Typography>
        </Box>

        {/* Stats + controls */}
        {!loading && data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {activeCount > 0 && (
              <Chip
                size="small" label={`${activeCount} activa${activeCount !== 1 ? 's' : ''}`}
                icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', ml: '6px !important' }} />}
                sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#22c55e', fontWeight: 600, fontSize: 11, border: '1px solid rgba(34,197,94,0.2)' }}
              />
            )}
            {discCount > 0 && (
              <Chip
                size="small" label={`${discCount} desconectada${discCount !== 1 ? 's' : ''}`}
                icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ef4444', ml: '6px !important' }} />}
                sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600, fontSize: 11, border: '1px solid rgba(239,68,68,0.2)' }}
              />
            )}
            {(sentTotal > 0 || recvTotal > 0) && (
              <Chip
                size="small"
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ArrowUpwardIcon sx={{ fontSize: 11 }} />{sentTotal}
                    <ArrowDownwardIcon sx={{ fontSize: 11, ml: 0.5 }} />{recvTotal}
                    <Box component="span" sx={{ ml: 0.25, color: 'text.disabled' }}>hoy</Box>
                  </Box>
                }
                sx={{ bgcolor: 'rgba(255,255,255,0.05)', fontWeight: 600, fontSize: 11, border: '1px solid rgba(255,255,255,0.1)' }}
              />
            )}
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
                  <>{' · '}{discNames.join(', ')} entrará{discNames.length > 1 ? 'n' : ''} en rotación cuando recupere{discNames.length > 1 ? 'n' : ''} conexión.</>
                )}
              </Typography>
            </Box>
          )}

          {/* ── Instances grid ── */}
          {instances.length === 0 ? (
            <Alert severity="info">No hay instancias wwebjs registradas.</Alert>
          ) : (
            <>
              <Typography variant="caption" color="text.disabled" sx={{ letterSpacing: '0.08em', fontSize: 10, fontWeight: 700, mb: 1.5, display: 'block' }}>
                INSTANCIAS
              </Typography>
              {instances.filter(i => i.enabled).length < 2 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Se necesitan al menos 2 instancias activas para que el calentamiento funcione.
                </Alert>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
                {instances.map(inst => (
                  <InstanceCard key={inst.name} inst={inst} token={user?.token} onRefresh={load} />
                ))}
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  )
}
