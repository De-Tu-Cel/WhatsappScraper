'use client'
import React, { useState, useEffect, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'
import Alert from '@mui/material/Alert'
import Badge from '@mui/material/Badge'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import SignalWifiOffIcon from '@mui/icons-material/SignalWifiOff'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone'
import { useUser } from '../context/UserContext'

const API = (path) => `/api${path}`
function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'x-user-token': token || '' }
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }) {
  const cfg = {
    active:       { label: 'Activo',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    paused:       { label: 'Pausado',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    disconnected: { label: 'Desconectado', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  }
  const { label, color, bg } = cfg[status] || cfg.disconnected
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: bg, color, fontWeight: 600, fontSize: 11, height: 22, border: `1px solid ${color}33` }}
    />
  )
}

// ── Chat history view (per session) ──────────────────────────────────────────
function SessionDetail({ sessionId, onBack }) {
  const { user } = useUser()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(API(`/warmup/sessions/${sessionId}/messages`), { headers: authHeaders(user?.token) })
      .then(r => r.json())
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId, user?.token])

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={28} /></Box>
  if (!session) return <Alert severity="error">No se pudo cargar la sesión.</Alert>

  const messages = session.messages || []

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={onBack}><ArrowBackIcon fontSize="small" /></IconButton>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {session.instance_a} ↔ {session.instance_b}
        </Typography>
        <Chip label={`${session.total_messages_today} msgs`} size="small" sx={{ ml: 'auto', fontSize: 11 }} />
      </Box>

      {messages.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          Sin mensajes aún hoy.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {messages.map((msg, i) => {
            const isA = msg.speaker === 'a'
            return (
              <Box key={i} sx={{ display: 'flex', justifyContent: isA ? 'flex-start' : 'flex-end' }}>
                <Box sx={{
                  maxWidth: '75%',
                  bgcolor: isA ? 'rgba(59,130,246,0.12)' : 'rgba(34,197,94,0.10)',
                  border: `1px solid ${isA ? 'rgba(59,130,246,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  borderRadius: isA ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                  px: 1.5, py: 0.75,
                }}>
                  <Typography variant="caption" sx={{ color: isA ? '#60a5fa' : '#4ade80', fontWeight: 600, display: 'block', mb: 0.25 }}>
                    {isA ? session.instance_a : session.instance_b}
                  </Typography>
                  <Typography variant="body2">{msg.content}</Typography>
                  {msg.ts && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.25 }}>
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

// ── Chat list for one instance ────────────────────────────────────────────────
function InstanceChatsDialog({ open, onClose, instanceName, token }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setLoading(true)
    fetch(API(`/warmup/chats/${instanceName}`), { headers: authHeaders(token) })
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, instanceName, token])

  const peer = (s) => s.instance_a === instanceName ? s.instance_b : s.instance_a

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        {selected ? (
          <IconButton size="small" onClick={() => setSelected(null)}><ArrowBackIcon fontSize="small" /></IconButton>
        ) : null}
        <ChatBubbleOutlineIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" fontWeight={700}>
          {selected ? 'Conversación' : `Chats — ${instanceName}`}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ minHeight: 260 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}><CircularProgress size={28} /></Box>
        ) : selected ? (
          <SessionDetail sessionId={selected} onBack={() => setSelected(null)} />
        ) : sessions.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            Sin chats de calentamiento aún.
          </Typography>
        ) : (
          <List disablePadding>
            {sessions.map((s, i) => (
              <React.Fragment key={s._id}>
                {i > 0 && <Divider />}
                <ListItemButton onClick={() => setSelected(s._id)} sx={{ borderRadius: 1 }}>
                  <ListItemText
                    primary={peer(s)}
                    secondary={`${s.date} · ${s.total_messages_today} mensajes`}
                    primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <Chip label={`${s.total_messages_today} msgs`} size="small" sx={{ ml: 1, fontSize: 11 }} />
                </ListItemButton>
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Instance card ─────────────────────────────────────────────────────────────
function InstanceCard({ inst, token, onRefresh }) {
  const [busy, setBusy]   = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)

  async function action(endpoint) {
    setBusy(true)
    try {
      await fetch(API(`/warmup/instances/${inst.name}/${endpoint}`), {
        method: 'POST', headers: authHeaders(token),
      })
      onRefresh()
    } finally {
      setBusy(false)
    }
  }

  const isDisconnected = inst.warmup_status === 'disconnected'
  const isActive  = inst.warmup_status === 'active'
  const isPaused  = inst.warmup_status === 'paused'
  const isEnabled = inst.enabled

  return (
    <>
      <Card variant="outlined" sx={{
        borderRadius: 2.5,
        borderColor: isDisconnected ? 'divider'
          : isActive ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)',
        bgcolor: 'background.paper',
        transition: 'border-color 0.2s',
      }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5 }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: '50%',
              bgcolor: isDisconnected ? 'rgba(107,114,128,0.12)' : 'rgba(59,130,246,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <PhoneIphoneIcon fontSize="small" sx={{ color: isDisconnected ? 'text.disabled' : 'primary.main' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700} noWrap>{inst.label || inst.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {inst.number ? `+${inst.number}` : inst.name}
              </Typography>
            </Box>
            <StatusChip status={inst.warmup_status} />
          </Box>

          {/* Stats */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Chip
              icon={<ChatBubbleOutlineIcon sx={{ fontSize: '13px !important' }} />}
              label={`${inst.msgs_today} msgs hoy`}
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
            {isDisconnected && (
              <Chip icon={<SignalWifiOffIcon sx={{ fontSize: '13px !important' }} />}
                label="Sin conexión" size="small" variant="outlined"
                sx={{ fontSize: 11, height: 22, color: 'text.disabled', borderColor: 'divider' }}
              />
            )}
          </Box>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            {/* Ver chats */}
            <Tooltip title="Ver chats">
              <span>
                <IconButton size="small" onClick={() => setChatsOpen(true)} disabled={busy}>
                  <Badge badgeContent={inst.msgs_today || 0} color="primary" max={99}
                    sx={{ '& .MuiBadge-badge': { fontSize: 9, minWidth: 14, height: 14 } }}>
                    <ChatBubbleOutlineIcon fontSize="small" />
                  </Badge>
                </IconButton>
              </span>
            </Tooltip>

            {/* Pause / Resume */}
            {isEnabled && !isDisconnected && (
              isPaused ? (
                <Tooltip title="Reanudar (permitir que otros te escriban)">
                  <span>
                    <IconButton size="small" onClick={() => action('resume')} disabled={busy} color="success">
                      <PlayCircleIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : (
                <Tooltip title="Pausar (otros dejan de escribirte)">
                  <span>
                    <IconButton size="small" onClick={() => action('pause')} disabled={busy} color="warning">
                      <PauseCircleIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )
            )}

            {/* Enable / Disable */}
            <Tooltip title={isEnabled ? 'Desactivar calentamiento' : 'Activar calentamiento'}>
              <span>
                <IconButton size="small" onClick={() => action(isEnabled ? 'disable' : 'enable')}
                  disabled={busy} color={isEnabled ? 'error' : 'default'} sx={{ ml: 'auto' }}>
                  {busy ? <CircularProgress size={16} /> : <PowerSettingsNewIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </CardContent>
      </Card>

      <InstanceChatsDialog
        open={chatsOpen}
        onClose={() => setChatsOpen(false)}
        instanceName={inst.name}
        token={token}
      />
    </>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function WarmupPanel() {
  const { user } = useUser()
  const [instances, setInstances] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(API('/warmup/instances'), { headers: authHeaders(user?.token) })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setInstances)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [user?.token])

  useEffect(() => { load() }, [load])

  const active = instances.filter(i => i.warmup_status === 'active').length
  const total  = instances.filter(i => i.enabled).length

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto', width: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <LocalFireDepartmentIcon sx={{ color: '#f97316', fontSize: 28 }} />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            Calentamiento de números
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Las sesiones activas se envían mensajes entre sí para mantener la salud de los números
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {!loading && (
            <Chip
              label={`${active} / ${total} activas`}
              size="small"
              icon={<LocalFireDepartmentIcon sx={{ fontSize: '14px !important', color: '#f97316 !important' }} />}
              sx={{ bgcolor: 'rgba(249,115,22,0.10)', color: '#f97316', fontWeight: 600, border: '1px solid rgba(249,115,22,0.2)' }}
            />
          )}
          <Tooltip title="Actualizar">
            <IconButton size="small" onClick={load} disabled={loading}>
              {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && instances.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress />
        </Box>
      ) : instances.length === 0 ? (
        <Alert severity="info">No hay instancias wwebjs registradas.</Alert>
      ) : (
        <>
          {/* Info banner when < 2 enabled */}
          {instances.filter(i => i.enabled).length < 2 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Se necesitan al menos 2 instancias activas para que el calentamiento funcione.
            </Alert>
          )}

          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
            gap: 2,
          }}>
            {instances.map(inst => (
              <InstanceCard key={inst.name} inst={inst} token={user?.token} onRefresh={load} />
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}
