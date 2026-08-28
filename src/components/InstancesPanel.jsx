'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { INSTANCES_CHANGED_EVENT } from '../hooks/useDailyCapStats'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Divider from '@mui/material/Divider'
import Switch from '@mui/material/Switch'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import QrCodeIcon from '@mui/icons-material/QrCode'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import SmartphoneIcon from '@mui/icons-material/Smartphone'
import EditIcon from '@mui/icons-material/Edit'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import { useLang } from '../context/LangContext'

const token = () => typeof window !== 'undefined' ? localStorage.getItem('user_token') : ''

const STATUS_COLOR = {
  // Evolution API / generic
  open:          '#22c55e',
  connected:     '#22c55e',
  connecting:    '#f59e0b',
  close:         '#ef4444',
  disconnected:  '#ef4444',
  // WAHA statuses (uppercase)
  WORKING:       '#22c55e',
  SCAN_QR_CODE:  '#f59e0b',
  STARTING:      '#f59e0b',
  STOPPED:       '#ef4444',
  FAILED:        '#ef4444',
  // wwebjs statuses
  initializing:  '#f59e0b',
  authenticated: '#f59e0b',
  need_scan:     '#f59e0b',
  auth_failure:  '#ef4444',
  error:         '#ef4444',
  not_found:     '#64748b',
  unknown:       '#64748b',
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'var(--card-bg, rgba(255,255,255,0.04))',
    fontSize: '0.88rem',
    borderRadius: 2,
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& input': { color: 'var(--text, #f1f5f9)' },
  '& label': { color: 'var(--text-muted, rgba(255,255,255,0.4))' },
  '& label.Mui-focused': { color: 'var(--accent,#3b82f6)' },
}

const DIALOG_SX = {
  '& .MuiDialog-paper': {
    bgcolor: 'var(--card-bg, #0d1117)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    minWidth: 360,
  },
}

const STAT_CHIP_SX = {
  bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))',
  color: 'var(--text-muted, rgba(255,255,255,0.5))',
  border: '1px solid var(--border, rgba(255,255,255,0.1))',
  fontSize: '0.68rem', fontWeight: 600, height: 22,
}

const STATUS_LABEL_ES = { open: 'Conectada', connected: 'Conectada', connecting: 'Conectando', close: 'Desconectada', disconnected: 'Desconectada', WORKING: 'Conectada', SCAN_QR_CODE: 'Escanear QR', STARTING: 'Iniciando', STOPPED: 'Detenida', FAILED: 'Error', unknown: 'Desconocida', initializing: 'Iniciando', authenticated: 'Autenticando', need_scan: 'Escanear QR', auth_failure: 'Error auth', error: 'Error', not_found: 'No iniciada' }
const STATUS_LABEL_EN = { open: 'Connected', connected: 'Connected', connecting: 'Connecting', close: 'Disconnected', disconnected: 'Disconnected', WORKING: 'Connected', SCAN_QR_CODE: 'Scan QR', STARTING: 'Starting', STOPPED: 'Stopped', FAILED: 'Failed', unknown: 'Unknown', initializing: 'Starting', authenticated: 'Authenticating', need_scan: 'Scan QR', auth_failure: 'Auth error', error: 'Error', not_found: 'Not started' }

const DISCONNECT_LABEL_ES = { banned: 'Baneado por WhatsApp', logged_out: 'Cerró sesión', conflict: 'Conflicto de dispositivo', multidevice: 'Conflicto multi-dispositivo', server_error: 'Error interno', restart: 'Requiere reinicio', replaced: 'Sesión reemplazada', timeout: 'Timeout de conexión', closed: 'Conexión cerrada', disconnected: 'Desconectada', failed: 'Error de conexión' }
const DISCONNECT_LABEL_EN = { banned: 'Banned by WhatsApp', logged_out: 'Logged out', conflict: 'Device conflict', multidevice: 'Multi-device conflict', server_error: 'Internal error', restart: 'Restart required', replaced: 'Session replaced', timeout: 'Connection timeout', closed: 'Connection closed', disconnected: 'Disconnected', failed: 'Connection error' }

// ── InstanceRow ──────────────────────────────────────────────────────────────
function InstanceRow({ inst, onQr, onEditNumber, onRemove, onWarmup }) {
  const { t, lang } = useLang()
  const [hover, setHover] = useState(false)
  const status = inst.live_status || 'unknown'
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
  const isConnected = ['open', 'connected'].includes(status)
  const statusLabel = (lang === 'en' ? STATUS_LABEL_EN : STATUS_LABEL_ES)[status] ?? (lang === 'en' ? 'Unknown' : 'Desconocida')
  const REASON_COLOR = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c', disconnected: '#f87171', failed: '#f87171' }
  const disconnectColor = inst.disconnect_reason ? (REASON_COLOR[inst.disconnect_reason] ?? '#f87171') : color
  // While actively reconnecting (connecting) show the connecting color, not the stale disconnect reason
  const displayColor = (isConnected || status === 'connecting') ? color : disconnectColor
  const reasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
  const displayLabel = (!isConnected && status !== 'connecting' && reasonLabel) ? reasonLabel : statusLabel
  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1.2, py: 0.9, borderRadius: 1.5,
        bgcolor: hover ? 'var(--item-hover, rgba(255,255,255,0.04))' : 'transparent',
        border: '1px solid transparent',
        transition: 'all 0.15s',
        ...(hover && { borderColor: 'var(--border, rgba(255,255,255,0.08))' }),
      }}
    >
      {/* Status dot */}
      <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: displayColor,
          boxShadow: isConnected ? `0 0 6px ${displayColor}aa` : 'none',
          position: 'relative', zIndex: 1 }} />
        {isConnected && (
          <Box sx={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: displayColor, opacity: 0.4,
            '@keyframes ping': {
              '0%':   { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.4 },
              '75%':  { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
              '100%': { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
            },
            animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
          }} />
        )}
      </Box>
      {/* Name + number */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.label || inst.name}</Typography>
          {inst.provider === 'waha' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#60a5fa',
              bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)',
              px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0, letterSpacing: '0.03em' }}>
              WAHA
            </Typography>
          )}
          {inst.provider === 'wwebjs' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#34d399',
              bgcolor: 'rgba(52,211,153,0.12)', px: 0.6, py: 0.1, borderRadius: 0.5 }}>WWEBJS</Typography>
          )}
          {inst.provider === 'wasender' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#a78bfa',
              bgcolor: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)',
              px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0, letterSpacing: '0.03em' }}>
              WS
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1.2 }}>
          {inst.number ? `+${inst.number}` : t.inst.noNumber}
        </Typography>
      </Box>
      {/* Right side: status label (resting) or action icons (hover) */}
      {hover ? (
        <Box sx={{ display: 'flex', gap: 0.2, flexShrink: 0, alignItems: 'center' }}>
          <Tooltip title={inst.warmup_mode ? (lang === 'en' ? 'Warmup ON — 20 msg/day' : 'Calentamiento ON — 20 msg/día') : (lang === 'en' ? 'Warmup OFF — 150 msg/day' : 'Calentamiento OFF — 150 msg/día')} placement="top">
            <Switch
              size="small"
              checked={!!inst.warmup_mode}
              onChange={() => onWarmup(inst)}
              onClick={e => e.stopPropagation()}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#fbbf24' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#fbbf24' },
              }}
            />
          </Tooltip>
          <Tooltip title={t.inst.connectQr} placement="top">
            <IconButton size="small" onClick={() => onQr(inst)}
              sx={{ color: 'var(--accent,#60a5fa)', p: 0.4, '&:hover': { bgcolor: 'rgba(59,130,246,0.15)' } }}>
              <QrCodeIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={lang === 'en' ? 'Edit phone number' : 'Editar número'} placement="top">
            <IconButton size="small" onClick={() => onEditNumber(inst)}
              sx={{ color: '#a78bfa', p: 0.4, '&:hover': { bgcolor: 'rgba(167,139,250,0.15)' } }}>
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={lang === 'en' ? 'Remove from user' : 'Quitar de este usuario'} placement="top">
            <IconButton size="small" onClick={() => onRemove(inst)}
              sx={{ color: 'var(--text-muted)', p: 0.4, '&:hover': { color: '#f87171', bgcolor: 'rgba(248,113,113,0.1)' } }}>
              <LinkOffIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {inst.ack_degraded && (
            <Tooltip title={lang === 'en' ? 'Delivery degraded — messages not reaching recipients' : 'Entrega degradada — mensajes no llegan a destinatarios'} placement="top">
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171',
                bgcolor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                px: 0.5, borderRadius: 0.8, lineHeight: 1.6, cursor: 'default' }}>⚠ ACK</Typography>
            </Tooltip>
          )}
          {inst.warmup_mode && (
            <Tooltip title={lang === 'en' ? 'Warmup mode — 20 msg/day' : 'Modo calentamiento — 20 msg/día'} placement="top">
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#fbbf24',
                bgcolor: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                px: 0.5, borderRadius: 0.8, lineHeight: 1.6, cursor: 'default' }}>20/d</Typography>
            </Tooltip>
          )}
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: displayColor, letterSpacing: '0.01em', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ── UserCard ─────────────────────────────────────────────────────────────────
function UserCard({ user, instances, onAddSlot, onQr, onEditNumber, onRemove, onWarmup, cardIndex = 0 }) {
  const { t, lang } = useLang()
  const connectedCount = instances.filter(i => ['open', 'connected'].includes(i.live_status)).length
  const isAdmin = user.role === 'admin'
  const roleColor   = isAdmin ? '#a78bfa' : '#60a5fa'
  const avatarBg    = isAdmin ? 'rgba(167,139,250,0.18)' : 'rgba(59,130,246,0.18)'
  const avatarBorder= isAdmin ? 'rgba(167,139,250,0.55)' : 'rgba(59,130,246,0.5)'
  const initials = (user.display_name || user.username || '?').slice(0, 2).toUpperCase()
  const slots = 5
  const emptySlots = Math.max(0, slots - instances.length)
  const hasRotation = connectedCount >= 2
  const roleLabel = isAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')
  const connectedWord = connectedCount === 1 ? t.inst.connectedSingular : t.inst.connectedPlural
  const glowColor = isAdmin ? 'rgba(167,139,250,0.22)' : 'rgba(59,130,246,0.22)'
  return (
    <Box sx={{
      bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
      display: 'flex', flexDirection: 'column', gap: 0,
      border: '1px solid var(--border)',
      transition: 'border-color 0.25s, box-shadow 0.25s',
      '&:hover': { borderColor: roleColor, boxShadow: `0 0 0 1px ${roleColor}28, 0 8px 28px ${glowColor}` },
      '@keyframes fadeUp': {
        '0%':   { opacity: 0, transform: 'translateY(14px)' },
        '100%': { opacity: 1, transform: 'translateY(0)' },
      },
      animation: 'fadeUp 0.38s ease both',
      animationDelay: `${cardIndex * 0.06}s`,
    }}>
      {/* User header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 2, flexShrink: 0,
          bgcolor: avatarBg, border: `1.5px solid ${avatarBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: roleColor }}>{initials}</Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.display_name || user.username}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: roleColor, fontWeight: 600, mt: 0.1 }}>
            {roleLabel}
          </Typography>
        </Box>
        <Chip
          label={`${instances.length}/${slots}`}
          size="small"
          sx={{ fontSize: '0.65rem', fontWeight: 700, height: 20,
            bgcolor: 'var(--item-hover)',
            color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        />
      </Box>

      <Divider sx={{ borderColor: 'var(--border)', mb: instances.length === 0 ? 0 : 1.2 }} />

      {instances.length === 0 ? (
        /* ── Empty state ── */
        <Box onClick={onAddSlot} sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          py: 2, gap: 1, cursor: 'pointer', borderRadius: 2, mt: 1,
          border: `1px dashed ${roleColor}30`,
          bgcolor: avatarBg.replace('0.18)', '0.05)'),
          transition: 'all 0.18s',
          '&:hover': { bgcolor: avatarBg.replace('0.18)', '0.12)'), borderColor: `${roleColor}60` },
        }}>
          <Box sx={{ display: 'flex', gap: 0.7 }}>
            {Array(5).fill(null).map((_, i) => (
              <Box key={i} sx={{ width: 9, height: 9, borderRadius: '50%',
                border: `1.5px dashed ${roleColor}45`, transition: 'all 0.18s' }} />
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: roleColor, fontWeight: 600, opacity: 0.75 }}>
            {lang === 'en' ? 'No instances assigned' : 'Sin instancias asignadas'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1.4, py: 0.45, borderRadius: 1.5, fontSize: '0.63rem', fontWeight: 700,
            bgcolor: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}28` }}>
            <AddIcon sx={{ fontSize: 12 }} />
            {lang === 'en' ? 'Assign from sidebar' : 'Asignar del sidebar'}
          </Box>
        </Box>
      ) : (
        <>
          {/* Instance rows */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, mb: 1.2 }}>
            {instances.map(inst => (
              <InstanceRow key={inst.name} inst={inst} onQr={onQr} onEditNumber={onEditNumber} onRemove={onRemove} onWarmup={onWarmup} />
            ))}
          </Box>
          {/* Capacity bar — 5 slot dots + add button */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 1, borderTop: '1px solid var(--border)' }}>
            <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flex: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => {
                const inst = instances[i]
                if (inst) {
                  const status = inst.live_status || 'unknown'
                  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                  const isConn = ['open', 'connected'].includes(status)
                  return (
                    <Tooltip key={i} title={inst.name} placement="top">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0,
                        boxShadow: isConn ? `0 0 5px ${color}99` : 'none', cursor: 'default' }} />
                    </Tooltip>
                  )
                }
                return (
                  <Tooltip key={i} title={t.inst.addSlot} placement="top">
                    <Box onClick={onAddSlot} sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      border: '1.5px dashed var(--text-muted)', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                      '&:hover': { borderColor: roleColor, bgcolor: avatarBg } }} />
                  </Tooltip>
                )
              })}
            </Box>
            {hasRotation ? (
              <Chip label={t.inst.rotationActive} size="small"
                sx={{ fontSize: '0.58rem', height: 17, bgcolor: 'rgba(34,197,94,0.1)',
                  color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', fontWeight: 600 }} />
            ) : emptySlots > 0 ? (
              <Box onClick={onAddSlot}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0,
                  transition: 'color 0.15s', '&:hover': { color: roleColor } }}>
                <AddIcon sx={{ fontSize: 12 }} />
                {t.inst.addSlot}
              </Box>
            ) : null}
          </Box>
        </>
      )}

      {/* Stats line (only when instances exist) */}
      {instances.length > 0 && (
        <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', mt: 1 }}>
          {connectedCount} {t.inst.connectedOf} {instances.length} {connectedWord}
        </Typography>
      )}
    </Box>
  )
}

// ── InlineUserPicker ─────────────────────────────────────────────────────────
function InlineUserPicker({ instanceName, users, instances, onAssign, t, lang }) {
  const [search, setSearch] = useState('')
  const filtered = users.filter(u =>
    (u.display_name || u.username || '').toLowerCase().includes(search.toLowerCase())
  )
  const allFull = filtered.length > 0 && filtered.every(u => {
    const uid = u._id || u.id || u.username
    return instances.filter(i => i.assigned_to === uid).length >= 5
  })
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1,
        borderBottom: '1px solid var(--border)', bgcolor: 'rgba(59,130,246,0.04)' }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#60a5fa',
          textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          {lang === 'en' ? 'Assign to' : 'Asignar a'}
        </Typography>
        {allFull && (
          <Typography sx={{ fontSize: '0.58rem', color: '#fbbf24', fontWeight: 600 }}>
            {lang === 'en' ? 'All full' : 'Todos llenos'}
          </Typography>
        )}
      </Box>

      {/* Search — only when > 4 users */}
      {users.length > 4 && (
        <Box sx={{ px: 1.2, pt: 0.8, pb: 0.2 }}>
          <Box component="input"
            placeholder={t.inst.searchUser}
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ display: 'block', width: '100%', boxSizing: 'border-box',
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              borderRadius: 1.5, py: 0.5, px: 1.2, color: 'var(--text)', fontSize: '0.75rem',
              outline: 'none', fontFamily: 'inherit',
              '&:focus': { borderColor: 'rgba(59,130,246,0.5)' } }}
          />
        </Box>
      )}

      {/* User list rows */}
      <Box sx={{ maxHeight: 220, overflowY: 'auto',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-button': { display: 'none' },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 4 },
      }}>
        {filtered.map((u, idx) => {
          const uid      = u._id || u.id || u.username
          const uAdmin   = u.role === 'admin'
          const uColor   = uAdmin ? '#a78bfa' : '#60a5fa'
          const uBg      = uAdmin ? 'rgba(167,139,250,0.18)' : 'rgba(59,130,246,0.18)'
          const uBorder  = uAdmin ? 'rgba(167,139,250,0.45)' : 'rgba(59,130,246,0.4)'
          const uInitials = (u.display_name || u.username || '?').slice(0, 2).toUpperCase()
          const uSlots   = instances.filter(i => i.assigned_to === uid).length
          const isFull   = uSlots >= 5
          const roleLabel = uAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')
          return (
            <Box key={uid}
              onClick={() => !isFull && onAssign(instanceName, u)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.4,
                px: 1.5, py: 1,
                borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: isFull ? 'not-allowed' : 'pointer',
                opacity: isFull ? 0.45 : 1,
                transition: 'background 0.12s',
                '&:hover': isFull ? {} : { bgcolor: 'rgba(59,130,246,0.07)' },
              }}>
              {/* Avatar */}
              <Box sx={{ width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
                bgcolor: uBg, border: `1.5px solid ${uBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: uColor }}>
                  {uInitials}
                </Typography>
              </Box>
              {/* Name + role */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                  {u.display_name || u.username}
                </Typography>
                <Typography sx={{ fontSize: '0.6rem', color: uColor, fontWeight: 600, lineHeight: 1.2 }}>
                  {roleLabel}
                </Typography>
              </Box>
              {/* Slot counter / Full badge */}
              <Box sx={{ flexShrink: 0, px: 0.9, py: 0.35, borderRadius: 1.2,
                bgcolor: isFull ? 'rgba(239,68,68,0.12)' : `${uBg}`,
                border: `1px solid ${isFull ? 'rgba(239,68,68,0.3)' : uBorder}` }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700,
                  color: isFull ? '#f87171' : uColor, lineHeight: 1 }}>
                  {uSlots}/5
                </Typography>
              </Box>
            </Box>
          )
        })}
        {filtered.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t.inst.noResults}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Bulk assign picker dialog ─────────────────────────────────────────────────
function BulkPickDialog({ open, onClose, selectedNames, users, instances, onAssign, lang }) {
  const [search, setSearch] = useState('')
  const count = selectedNames.size
  const filtered = users.filter(u =>
    (u.display_name || u.username || '').toLowerCase().includes(search.toLowerCase())
  )
  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: {
      bgcolor: 'var(--card-bg)', border: '1px solid rgba(59,130,246,0.3)',
      borderRadius: 3, minWidth: 320, maxWidth: 400,
      backgroundImage: 'none',
    } }}}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
          {lang === 'en' ? `Assign ${count} instance${count !== 1 ? 's' : ''}` : `Asignar ${count} instancia${count !== 1 ? 's' : ''}`}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', mt: 0.3 }}>
          {lang === 'en' ? 'Select the target user' : 'Elige el usuario destino'}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 1, pb: 0, px: 2 }}>
        {users.length > 4 && (
          <Box component="input"
            placeholder={lang === 'en' ? 'Search user…' : 'Buscar usuario…'}
            value={search} onChange={e => setSearch(e.target.value)}
            sx={{ display: 'block', width: '100%', boxSizing: 'border-box', mb: 1.5,
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              borderRadius: 1.5, py: 0.6, px: 1.2, color: 'var(--text)', fontSize: '0.78rem',
              outline: 'none', fontFamily: 'inherit',
              '&:focus': { borderColor: 'rgba(59,130,246,0.5)' } }}
          />
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, pb: 1.5 }}>
          {filtered.map(u => {
            const uid       = u._id || u.id || u.username
            const uAdmin    = u.role === 'admin'
            const uColor    = uAdmin ? '#a78bfa' : '#60a5fa'
            const uBg       = uAdmin ? 'rgba(167,139,250,0.14)' : 'rgba(59,130,246,0.12)'
            const uBorder   = uAdmin ? 'rgba(167,139,250,0.35)' : 'rgba(59,130,246,0.35)'
            const uInitials = (u.display_name || u.username || '?').slice(0, 2).toUpperCase()
            const curSlots  = instances.filter(i => i.assigned_to === uid).length
            const canAssign = Math.max(0, 5 - curSlots)
            const willAssign = Math.min(count, canAssign)
            const isFull    = canAssign === 0
            return (
              <Box key={uid}
                onClick={() => !isFull && onAssign(u)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.2, p: 1.2,
                  borderRadius: 2, border: '1px solid var(--border)',
                  bgcolor: 'rgba(255,255,255,0.025)',
                  cursor: isFull ? 'not-allowed' : 'pointer',
                  opacity: isFull ? 0.45 : 1,
                  transition: 'background 0.12s, border-color 0.12s',
                  '&:hover': isFull ? {} : { bgcolor: 'rgba(59,130,246,0.07)', borderColor: 'rgba(59,130,246,0.25)' },
                }}>
                <Box sx={{ width: 34, height: 34, borderRadius: 1.5, flexShrink: 0,
                  bgcolor: uBg, border: `1.5px solid ${uBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: uColor }}>
                    {uInitials}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.display_name || u.username}
                  </Typography>
                  {willAssign < count && !isFull ? (
                    <Typography sx={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 500 }}>
                      {lang === 'en' ? `${willAssign}/${count} fit` : `${willAssign}/${count} caben`}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: '0.65rem', color: uColor }}>
                      {uAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ flexShrink: 0, px: 0.9, py: 0.35, borderRadius: 1.2,
                  bgcolor: isFull ? 'rgba(239,68,68,0.12)' : uBg,
                  border: `1px solid ${isFull ? 'rgba(239,68,68,0.3)' : uBorder}` }}>
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700,
                    color: isFull ? '#f87171' : uColor, lineHeight: 1 }}>
                    {curSlots}/5
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, pt: 0 }}>
        <Button onClick={onClose} size="small"
          sx={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.8rem' }}>
          {lang === 'en' ? 'Cancel' : 'Cancelar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function InstancesPanel() {
  const { t, lang } = useLang()
  const [instances,    setInstances]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [users,        setUsers]        = useState([])
  const skeletonCounts = useRef({ users: [], unassigned: 3 })

  // ── Create dialog ──
  const [createOpen,   setCreateOpen]   = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newNumber,    setNewNumber]    = useState('')
  const [creating,     setCreating]     = useState(false)
  const [createErr,    setCreateErr]    = useState('')

  // ── Pairing code dialog ──
  const [pairOpen,     setPairOpen]     = useState(false)
  const [pairPhone,    setPairPhone]    = useState('')
  const [pairCode,     setPairCode]     = useState(null)
  const [pairLoading,  setPairLoading]  = useState(false)
  const [pairErr,      setPairErr]      = useState('')

  // ── Add number wizard ──
  const [wizardOpen,    setWizardOpen]    = useState(false)
  const [wizardStep,    setWizardStep]    = useState(1)
  const [wizardPhone,   setWizardPhone]   = useState('')
  const [wizardName,    setWizardName]    = useState('')
  const [wizardCode,      setWizardCode]      = useState(null)
  const [wizardLoading,   setWizardLoading]   = useState(false)
  const [wizardErr,       setWizardErr]       = useState('')
  const [wizardConnected, setWizardConnected] = useState(false)
  const [wizardInstName,  setWizardInstName]  = useState('')
  const [wizardCountdown, setWizardCountdown] = useState(null)
  const wizardPollRef    = useRef(null)
  const wizardCountRef   = useRef(null)

  // ── SMSFast inside wizard ──
  const [wizardPhoneMode,  setWizardPhoneMode]  = useState('manual') // 'manual' | 'smsfast'
  const [sfCountry,        setSfCountry]        = useState(54)
  const [sfInfo,           setSfInfo]           = useState(null)
  const [sfInfoLoading,    setSfInfoLoading]    = useState(false)
  const [sfBuying,         setSfBuying]         = useState(false)
  const [sfActivationId,   setSfActivationId]   = useState(null)
  const [sfBoughtNumber,   setSfBoughtNumber]   = useState(null)
  const [sfCancelSecs,     setSfCancelSecs]     = useState(120)
  const [sfCancelling,     setSfCancelling]     = useState(false)
  const sfCancelRef        = useRef(null)

  // ── QR dialog ──
  const [qrOpen,       setQrOpen]       = useState(false)
  const [qrTarget,     setQrTarget]     = useState(null)
  const [qrImage,      setQrImage]      = useState(null)
  const qrPollRef   = useRef(null)
  const connPollRef = useRef(null)

  // ── Assign dialog ──
  const [assignOpen,     setAssignOpen]     = useState(false)
  const [assignTarget,   setAssignTarget]   = useState(null)
  const [assignUserId,   setAssignUserId]   = useState('')
  const [assignUserName, setAssignUserName] = useState('')
  const [assignSearch,   setAssignSearch]   = useState('')
  const [assigning,      setAssigning]      = useState(false)

  // ── Delete dialog ──
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)
  const [syncing,      setSyncing]      = useState(false)
  const [snack,        setSnack]        = useState({ open: false, msg: '' })

  // ── WAHA session dialog ──
  const [wahaOpen,      setWahaOpen]      = useState(false)
  const [wahaName,      setWahaName]      = useState('')
  const [wahaLoading,   setWahaLoading]   = useState(false)
  const [wahaErr,       setWahaErr]       = useState('')
  const [wahaQr,        setWahaQr]        = useState(null)   // base64 QR image
  const [wahaConnected, setWahaConnected] = useState(false)
  const [wahaScanned,   setWahaScanned]   = useState(false)  // phone scanned QR, now authenticating
  const [wahaSyncing,   setWahaSyncing]   = useState(false)
  const [wahaStatus,    setWahaStatus]    = useState('')     // STOPPED | STARTING | SCAN_QR_CODE | WORKING
  const wahaQrPollRef    = useRef(null)
  const wahaQrShownRef   = useRef(false)   // tracks if QR was ever displayed (avoids stale closure)

  // ── Wasender create dialog ──
  const [wsOpen,      setWsOpen]      = useState(false)
  const [wsName,      setWsName]      = useState('')
  const [wsPhone,     setWsPhone]     = useState('')
  const [wsLoading,   setWsLoading]   = useState(false)
  const [wsErr,       setWsErr]       = useState('')
  const [wsQr,        setWsQr]        = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [wsScanned,   setWsScanned]   = useState(false)
  const [wsId,        setWsId]        = useState(null)
  const wsQrPollRef  = useRef(null)
  const wsQrShownRef = useRef(false)

  // ── Card menu (kept for assign dialog compatibility) ──
  const [menuAnchor,   setMenuAnchor]   = useState(null)
  const [menuInst,     setMenuInst]     = useState(null)

  // ── Pick instance dialog ──
  const [pickOpen,        setPickOpen]        = useState(false)
  const [pickTargetUser,  setPickTargetUser]  = useState(null)
  const [pickSelected,    setPickSelected]    = useState(new Set())
  const [unassignedOpen,  setUnassignedOpen]  = useState(true)
  const [expandedAssign,  setExpandedAssign]  = useState(null)
  const [sidebarAnchor,   setSidebarAnchor]   = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userSearch,       setUserSearch]       = useState('')
  const sidebarRowRefs = useRef({})

  // ── Multi-select assign ──
  const [selectedInsts, setSelectedInsts] = useState(new Set())
  const [bulkPickOpen,  setBulkPickOpen]  = useState(false)

  const fetchInstances = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/instances', { headers: { 'x-user-token': token() }, cache: 'no-store' })
      if (r.ok) setInstances(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/instances?action=sync', { method: 'POST', headers: { 'x-user-token': token() } })
      await fetchInstances()
    } catch {}
    finally { setSyncing(false) }
  }, [fetchInstances])

  const handleSyncWaha = useCallback(async () => {
    setWahaSyncing(true)
    try {
      await Promise.allSettled([
        fetch('/api/admin/instances/sync-waha',    { method: 'POST', headers: { 'x-user-token': token() } }),
        fetch('/api/admin/instances/sync-wasender',{ method: 'POST', headers: { 'x-user-token': token() } }),
        fetch('/api/admin/instances/sync-wwebjs',  { method: 'POST', headers: { 'x-user-token': token() } }),
      ])
      await fetchInstances()
      setSnack({ open: true, msg: lang === 'en' ? 'Sessions synced' : 'Sesiones sincronizadas' })
    } catch {}
    finally { setWahaSyncing(false) }
  }, [fetchInstances, lang])

  function wahaClose() {
    if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current)
    setWahaOpen(false); setWahaName(''); setWahaQr(null)
    setWahaConnected(false); setWahaScanned(false); setWahaErr(''); setWahaLoading(false); setWahaStatus('')
    wahaQrShownRef.current = false
  }

  async function handleWahaCreate() {
    const name = wahaName.trim()
    if (!name) { setWahaErr(lang === 'en' ? 'Name required' : 'El nombre es requerido'); return }
    setWahaLoading(true); setWahaErr(''); setWahaQr(null); setWahaConnected(false); setWahaScanned(false)
    try {
      const r = await fetch('/api/wwebjs/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name }),
      })
      const d = await r.json()
      if (!r.ok) { setWahaErr(d.detail || 'Error al crear sesión'); setWahaLoading(false); return }

      // Keep wahaLoading=true until QR arrives
      if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current)
      wahaQrPollRef.current = setInterval(async () => {
        try {
          const [qrRes, stRes] = await Promise.all([
            fetch(`/api/wwebjs/session/${name}/qr`),
            fetch(`/api/wwebjs/session/${name}/status`),
          ])
          if (stRes.ok) {
            const sd = await stRes.json()
            const rawStatus = sd.status || ''
            setWahaStatus(rawStatus)
            if (rawStatus === 'connected') {
              clearInterval(wahaQrPollRef.current)
              wahaQrShownRef.current = false
              setWahaQr(null); setWahaScanned(false); setWahaConnected(true); setWahaLoading(false)
              fetchInstances()
              return
            }
            // QR scanned → authenticated state → show "autenticando…"
            if (wahaQrShownRef.current && rawStatus === 'authenticated') {
              setWahaQr(null)
              setWahaScanned(true)
            }
          }
          if (qrRes.ok) {
            const qd = await qrRes.json()
            if (qd.qr) {
              wahaQrShownRef.current = true
              setWahaQr(qd.qr)   // already a full data: URL
              setWahaScanned(false)
              setWahaLoading(false)
            }
          }
        } catch {}
      }, 2500)
      // intentionally no finally — wahaLoading stays true until QR arrives
    } catch (e) { setWahaErr(e.message); setWahaLoading(false) }
  }

  function wsClose() {
    if (wsQrPollRef.current) clearInterval(wsQrPollRef.current)
    setWsOpen(false); setWsName(''); setWsPhone(''); setWsQr(null)
    setWsConnected(false); setWsScanned(false); setWsErr(''); setWsLoading(false)
    wsQrShownRef.current = false; setWsId(null)
  }

  async function handleWsCreate() {
    const name = wsName.trim()
    const phone = wsPhone.trim()
    if (!name) { setWsErr(lang === 'en' ? 'Name required' : 'El nombre es requerido'); return }
    if (!phone) { setWsErr(lang === 'en' ? 'Phone number required (e.g. +521234567890)' : 'Número requerido (ej. +521234567890)'); return }
    setWsLoading(true); setWsErr(''); setWsQr(null); setWsConnected(false)
    try {
      const r = await fetch('/api/wasender/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name, phone_number: phone }),
      })
      const d = await r.json()
      if (!r.ok) { setWsErr(d.detail || d.error || 'Error al crear sesión'); setWsLoading(false); return }
      const wid = d.id
      if (!wid) { setWsErr('No se obtuvo wasender_id'); setWsLoading(false); return }
      setWsId(wid)
      // If create already returned a QR (from auto-connect), show it immediately
      if (d.qrCode) {
        try {
          const qrRes = await fetch(`/api/wasender/session/qr/${wid}`)
          if (qrRes.ok) {
            const qd = await qrRes.json()
            if (qd.base64) { wsQrShownRef.current = true; setWsQr(qd.base64); setWsLoading(false) }
          }
        } catch {}
      }
      if (wsQrPollRef.current) clearInterval(wsQrPollRef.current)
      wsQrPollRef.current = setInterval(async () => {
        try {
          const [qrRes, stRes] = await Promise.all([
            fetch(`/api/wasender/session/qr/${wid}`),
            fetch(`/api/wasender/session/status/${wid}`),
          ])
          if (stRes.ok) {
            const sd = await stRes.json()
            const stState = sd.state || ''
            const stStatus = (sd.status || '').toLowerCase()
            if (stState === 'open' || stStatus === 'connected') {
              clearInterval(wsQrPollRef.current)
              wsQrShownRef.current = false
              setWsQr(null); setWsScanned(false); setWsConnected(true); setWsLoading(false)
              fetchInstances()
              return
            }
            if (wsQrShownRef.current && stState && stState !== 'close') {
              setWsQr(null); setWsScanned(true)
            }
          }
          if (qrRes.ok) {
            const qd = await qrRes.json()
            if (qd.base64) {
              wsQrShownRef.current = true
              setWsQr(qd.base64)
              setWsScanned(false)
              setWsLoading(false)
            }
          }
        } catch {}
      }, 2500)
    } catch (e) { setWsErr(e.message); setWsLoading(false) }
  }

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
  }, [])

  useEffect(() => { fetchInstances(); fetchUsers() }, [fetchInstances, fetchUsers])
  // Cleanup QR polls on unmount / hot reload
  useEffect(() => () => { if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current) }, [])
  useEffect(() => () => { if (wsQrPollRef.current) clearInterval(wsQrPollRef.current) }, [])

  // Actualizar conteos para skeleton cada vez que llegan datos reales
  useEffect(() => {
    if (loading || (!users.length && !instances.length)) return
    skeletonCounts.current = {
      users: users.map(u => {
        const uid = u._id || u.id || u.username
        return instances.filter(i => i.assigned_to === uid).length
      }),
      unassigned: instances.filter(i => !i.assigned_to).length,
    }
  }, [loading, users, instances])

  // Auto-refresh pairing code when countdown expires
  const wizardInstNameRef = useRef('')
  const wizardPhoneRef    = useRef('')
  useEffect(() => { wizardInstNameRef.current = wizardInstName }, [wizardInstName])
  useEffect(() => { wizardPhoneRef.current    = wizardPhone    }, [wizardPhone])
  useEffect(() => {
    if (wizardCountdown !== 0 || !wizardInstNameRef.current) return
    ;(async () => {
      try {
        const phone = wizardPhoneRef.current.replace(/\D/g, '')
        const r = await fetch(`/api/evolution/instance/${wizardInstNameRef.current}?action=pairing-code`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        })
        const d = await r.json()
        const code = d.code || d.pairingCode || d.pairing_code
        if (code) { setWizardCode(code); startWizardCountdown() }
      } catch {}
    })()
  }, [wizardCountdown])

  const [qrStatus, setQrStatus] = useState('loading') // loading | retrying | ready | error

  // ── QR polling ──────────────────────────────────────────────────────────────
  const fetchQrOnce = useCallback(async (name, provider, wasenderId) => {
    try {
      const resolvedProvider = provider ?? qrTarget?.provider
      const isWaha     = resolvedProvider === 'waha'
      const isWasender = resolvedProvider === 'wasender'
      const isWwebjs   = resolvedProvider === 'wwebjs'
      const wid        = wasenderId ?? qrTarget?.wasender_id
      const url = isWasender
        ? `/api/wasender/session/qr/${wid}`
        : isWaha
        ? `/api/waha/session/qr/${name}`
        : isWwebjs
        ? `/api/wwebjs/session/${name}/qr`
        : `/api/evolution/instance/${name}?type=qr`
      const r = await fetch(url)
      if (!r.ok) {
        if (isWwebjs) {
          // wwebjs returns 400 with status when no QR yet — check if already connected
          const d = await r.json().catch(() => ({}))
          if (d?.status === 'connected') return 'scanned'
        }
        return false
      }
      const d = await r.json()
      // wwebjs returns { qr: 'data:image/png;base64,...', status }
      if (isWwebjs) {
        if (d?.status === 'connected') return 'scanned'
        if (d?.qr) {
          setQrImage(d.qr)
          setQrStatus('ready')
          return true
        }
        return false
      }
      const b64 = d.base64 || d.qrcode?.base64 || d.qr?.base64
      if (b64) {
        setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
        setQrStatus('ready')
        return true
      }
      // WAHA returns status=WORKING / wasender returns state=open when already connected
      if (d?.status === 'WORKING' || d?.state === 'open') return 'scanned'
    } catch {}
    return false
  }, [qrTarget])

  const startQrPoll = useCallback(async (name, withLogout = false, provider, wasenderId) => {
    if (qrPollRef.current) clearTimeout(qrPollRef.current)
    setQrImage(null); setQrStatus(withLogout ? 'retrying' : 'loading')

    if (withLogout) {
      try {
        const resolvedProvider = provider ?? qrTarget?.provider
        const isWasender = resolvedProvider === 'wasender'
        const wid        = wasenderId ?? qrTarget?.wasender_id
        if (isWasender) {
          await fetch(`/api/wasender/session/${wid}/restart`, { method: 'POST' })
        } else if (resolvedProvider === 'waha') {
          await fetch(`/api/waha/session/logout/${name}`, { method: 'POST' })
        } else if (resolvedProvider === 'wwebjs') {
          // Re-start the session so it generates a fresh QR
          await fetch(`/api/wwebjs/session/${name}/start`, { method: 'POST' }).catch(() => {})
        } else {
          await fetch(`/api/evolution/instance/${name}?action=logout`, { method: 'POST' })
        }
      } catch {}
      await new Promise(r => setTimeout(r, 700))
      setQrStatus('loading')
    }

    let attempts = 0
    const poll = async () => {
      attempts++
      const ok = await fetchQrOnce(name, provider, wasenderId)
      if (ok === 'scanned') {
        // User scanned QR — show connecting state and stop; connPoll closes dialog on WORKING/open
        setQrStatus('connecting')
        return
      } else if (ok) {
        // QR shown — re-poll to catch rotation (~60s for WAHA, shorter for wasender)
        attempts = 0
        qrPollRef.current = setTimeout(poll, 300)
      } else {
        if (attempts >= 10) { setQrStatus('error'); return }
        qrPollRef.current = setTimeout(poll, 1500)
      }
    }
    poll()
  }, [fetchQrOnce, qrTarget])

  function closeQr() {
    if (qrPollRef.current)   clearTimeout(qrPollRef.current)
    if (connPollRef.current) clearInterval(connPollRef.current)
    setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
  }

  const startConnPoll = useCallback((name, provider, wasenderId) => {
    if (connPollRef.current) clearInterval(connPollRef.current)
    let firstPoll = true
    let prevState = ''
    const resolvedProvider = provider ?? qrTarget?.provider
    const isWaha     = resolvedProvider === 'waha'
    const isWasender = resolvedProvider === 'wasender'
    const isWwebjs   = resolvedProvider === 'wwebjs'
    const wid        = wasenderId ?? qrTarget?.wasender_id
    connPollRef.current = setInterval(async () => {
      try {
        const url = isWasender
          ? `/api/wasender/session/status/${wid}`
          : isWaha
          ? `/api/waha/session/status/${name}`
          : isWwebjs
          ? `/api/wwebjs/session/${name}/status`
          : `/api/evolution/instance/${name}`
        const r = await fetch(url)
        if (!r.ok) return
        const d = await r.json()
        // wwebjs: { status: 'connected' | 'need_scan' | ... }
        const state = isWwebjs
          ? d?.status || ''
          : (d?.instance?.state || d?.state || '')
        if (firstPoll) {
          firstPoll = false
          prevState = state
          return
        }
        const isConnected = isWwebjs
          ? state === 'connected'
          : ['open', 'connected'].includes(state)
        const wasConnected = isWwebjs
          ? prevState === 'connected'
          : ['open', 'connected'].includes(prevState)
        prevState = state
        if (isConnected && !wasConnected) {
          if (connPollRef.current) clearInterval(connPollRef.current)
          if (qrPollRef.current)   clearTimeout(qrPollRef.current)
          setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
          fetchInstances()
        }
      } catch {}
    }, 2000)
  }, [fetchInstances, qrTarget])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function closeMenu() { setMenuAnchor(null); setMenuInst(null) }

  async function handleQrClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setQrTarget(inst); setQrOpen(true); setQrStatus('loading')

    if (inst.provider === 'wasender') {
      const wid = inst.wasender_id
      if (!wid) { setQrStatus('error'); return }
      try {
        const stRes = await fetch(`/api/wasender/session/status/${wid}`)
        const stData = stRes.ok ? await stRes.json() : {}
        const wsState  = stData.state  || ''
        const wsStatus = (stData.status || '').toLowerCase()
        const isLoggedOut = wsStatus === 'logged_out' || stData.status === 'logged_out'
        if (wsState !== 'open' && wsStatus !== 'connected') {
          setQrStatus('retrying')
          if (isLoggedOut) {
            // logged_out: use /connect which clears proxy, generates QR, restores proxy
            await fetch(`/api/wasender/session/${wid}/connect`, { method: 'POST' }).catch(() => {})
          } else {
            await fetch(`/api/wasender/session/${wid}/restart`, { method: 'POST' }).catch(() => {})
            for (let i = 0; i < 13; i++) {
              await new Promise(r => setTimeout(r, 1500))
              const sRes = await fetch(`/api/wasender/session/status/${wid}`).catch(() => null)
              if (sRes?.ok) {
                const sd = await sRes.json()
                if (sd.state === 'open' || (sd.status || '').toLowerCase() === 'connected') break
              }
            }
          }
          setQrStatus('loading')
        }
      } catch {}
      startQrPoll(inst.name, false, 'wasender', wid)
      startConnPoll(inst.name, 'wasender', wid)
      return
    }

    if (inst.provider === 'wwebjs') {
      // Ensure session is started in wwebjs-service
      try {
        const stRes = await fetch(`/api/wwebjs/session/${inst.name}/status`)
        const stData = stRes.ok ? await stRes.json() : {}
        const st = stData.status || ''
        if (st === 'connected') {
          // Already connected — nothing to do, just close
          setQrOpen(false); setQrTarget(null); setQrStatus('loading')
          return
        }
        if (st === 'not_found') {
          setQrStatus('retrying')
          await fetch(`/api/wwebjs/session/${inst.name}/start`, { method: 'POST' }).catch(() => {})
          setQrStatus('loading')
        }
        // For need_scan/disconnected/initializing just show QR
      } catch {}
      startQrPoll(inst.name, false, 'wwebjs', null)
      startConnPoll(inst.name, 'wwebjs', null)
      return
    }

    if (inst.provider === 'waha') {
      try {
        const stRes = await fetch(`/api/waha/session/status/${inst.name}`)
        const stData = stRes.ok ? await stRes.json() : {}
        const wahaStatus = stData.status || ''

        if (['FAILED', 'STOPPED'].includes(wahaStatus)) {
          setQrStatus('retrying')
          // 1. Logout to clear stored auth — forces a fresh QR instead of reconnect attempt
          await fetch(`/api/waha/session/logout/${inst.name}`, { method: 'POST' }).catch(() => {})
          await new Promise(r => setTimeout(r, 1500))
          // 2. Restart the session
          await fetch(`/api/waha/session/restart/${inst.name}`, { method: 'POST' }).catch(() => {})
          // 3. Poll until SCAN_QR_CODE (max 20s)
          for (let i = 0; i < 13; i++) {
            await new Promise(r => setTimeout(r, 1500))
            const sRes = await fetch(`/api/waha/session/status/${inst.name}`).catch(() => null)
            if (sRes?.ok) {
              const sd = await sRes.json()
              if (sd.status === 'SCAN_QR_CODE' || sd.status === 'WORKING') break
            }
          }
          setQrStatus('loading')
        }
      } catch {}
    }

    startQrPoll(inst.name, false, inst.provider, null)
    startConnPoll(inst.name, inst.provider, null)
  }

  function handleAssignClick(directInst) {
    const inst = directInst || menuInst; closeMenu()
    setAssignTarget(inst)
    setAssignUserId(inst.assigned_to ?? '')
    const storedName = inst.assigned_name ?? ''
    setAssignUserName(/^[a-f0-9]{24}$/.test(storedName) ? '' : storedName)
    setAssignSearch('')
    setAssignOpen(true)
  }

  function handleDeleteClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setDeleteTarget(inst)
  }

  const [pairTarget, setPairTarget] = useState(null)

  // ── Edit number dialog ──
  const [editNumberOpen,  setEditNumberOpen]  = useState(false)
  const [editNumberInst,   setEditNumberInst]   = useState(null)
  const [editNumberValue,  setEditNumberValue]  = useState('')
  const [editLabelValue,   setEditLabelValue]   = useState('')
  const [editNumberSaving, setEditNumberSaving] = useState(false)
  const [editNumberErr,    setEditNumberErr]    = useState('')

  function handleEditNumberClick(inst) {
    setEditNumberInst(inst)
    setEditNumberValue(inst?.number || '')
    setEditLabelValue(inst?.label || '')
    setEditNumberErr('')
    setEditNumberOpen(true)
  }

  async function handleEditNumberSave() {
    if (!editNumberInst) return
    const num = editNumberValue.replace(/\D/g, '')
    if (num && num.length < 8) {
      setEditNumberErr(lang === 'en' ? 'Number too short' : 'Número demasiado corto')
      return
    }
    setEditNumberSaving(true); setEditNumberErr('')
    const payload = {}
    if (num) payload.number = num
    if (editLabelValue.trim() !== (editNumberInst?.label || '')) payload.label = editLabelValue.trim()
    if (!Object.keys(payload).length) { setEditNumberOpen(false); setEditNumberSaving(false); return }
    try {
      const res = await fetch(`/api/instances?name=${encodeURIComponent(editNumberInst.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setEditNumberErr(lang === 'en' ? 'Error saving' : 'Error al guardar'); setEditNumberSaving(false); return }
      setInstances(prev => prev.map(i => i.name === editNumberInst.name ? { ...i, ...payload } : i))
      setEditNumberOpen(false)
    } catch { setEditNumberErr(lang === 'en' ? 'Network error' : 'Error de red') }
    setEditNumberSaving(false)
  }

  // ── Emulator registration dialog ──
  const [emuOpen,    setEmuOpen]    = useState(false)
  const [emuInst,    setEmuInst]    = useState('telnyx-01')
  const [emuCountry, setEmuCountry] = useState(54)
  const [emuLogs,    setEmuLogs]    = useState([])
  const [emuStep,    setEmuStep]    = useState('idle') // idle | confirming | running | success | error | done
  const [emuPreview, setEmuPreview] = useState(null)
  const [emuPreviewLoading, setEmuPreviewLoading] = useState(false)
  const emuEsRef = useRef(null)

  const SMSFAST_COUNTRIES = [
    { value: 54,  label: '🇲🇽 México' },
    { value: 36,  label: '🇨🇦 Canadá' },
    { value: 12,  label: '🇺🇸 USA (virtual)' },
    { value: 0,   label: '🌐 Cualquier país' },
  ]

  function handleEmuClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setEmuInst(inst?.name || 'wa-01')
    setEmuLogs([]); setEmuStep('idle')
    setEmuOpen(true)
  }

  async function handleEmuPreview() {
    setEmuPreviewLoading(true)
    try {
      const r = await fetch('/api/register/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: emuInst, country: emuCountry }),
      })
      const data = await r.json()
      setEmuPreview(data)
      setEmuStep('confirming')
    } catch (e) {
      setEmuPreview({ error: e.message, can_proceed: false, warnings: [e.message] })
      setEmuStep('confirming')
    } finally {
      setEmuPreviewLoading(false)
    }
  }

  function startEmuRegistration() {
    if (emuEsRef.current) emuEsRef.current.close()
    setEmuLogs([]); setEmuStep('running')
    const url = `/api/register/emulator-stream?phone=&instance=${encodeURIComponent(emuInst)}&country=${emuCountry}`
    const es = new EventSource(url)
    emuEsRef.current = es
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        setEmuLogs(prev => [...prev, d])
        if (d.step === 'success' || d.step === 'done') { setEmuStep('success'); es.close() }
        if (d.step === 'error') { setEmuStep('error'); es.close() }
      } catch {}
    }
    es.onerror = () => {
      setEmuLogs(prev => [...prev, { msg: 'Conexión SSE cerrada', step: 'done' }])
      setEmuStep(prev => prev === 'running' ? 'done' : prev)
      es.close()
    }
  }

  function handlePairClick() {
    const inst = menuInst; closeMenu()
    setPairPhone(''); setPairCode(null); setPairErr('')
    setPairTarget(inst)
    setPairOpen(true)
  }

  function stopWizardPoll() {
    if (wizardPollRef.current) { clearInterval(wizardPollRef.current); wizardPollRef.current = null }
  }

  function startWizardCountdown() {
    if (wizardCountRef.current) clearInterval(wizardCountRef.current)
    setWizardCountdown(60)
    wizardCountRef.current = setInterval(() => {
      setWizardCountdown(prev => {
        if (prev <= 1) { clearInterval(wizardCountRef.current); wizardCountRef.current = null; return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleRefreshCode() {
    setWizardLoading(true); setWizardErr('')
    try {
      const phone = wizardPhone.replace(/\D/g, '')
      const r = await fetch(`/api/evolution/instance/${wizardInstName}?action=pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const d = await r.json()
      const code = d.code || d.pairingCode || d.pairing_code
      if (!r.ok || !code) { setWizardErr(d.detail || d.error || t.inst.wizardErrCode) }
      else { setWizardCode(code); startWizardCountdown() }
    } catch (e) { setWizardErr(e.message) }
    finally { setWizardLoading(false) }
  }

  function startWizardPoll(instName) {
    stopWizardPoll()
    wizardPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/evolution/instance/${instName}?type=status`)
        if (!r.ok) return
        const d = await r.json()
        const state = (d.instance?.state || d.state || '').toLowerCase()
        if (state === 'open' || state === 'connected') {
          stopWizardPoll()
          setWizardConnected(true)
          fetchInstances()
        }
      } catch {}
    }, 3000)
  }

  function resetSfState() {
    if (sfCancelRef.current) { clearInterval(sfCancelRef.current); sfCancelRef.current = null }
    setWizardPhoneMode('manual')
    setSfInfo(null); setSfBuying(false); setSfActivationId(null)
    setSfBoughtNumber(null); setSfCancelSecs(120); setSfCancelling(false)
  }

  function openWizard() {
    stopWizardPoll()
    if (wizardCountRef.current) { clearInterval(wizardCountRef.current); wizardCountRef.current = null }
    resetSfState()
    setWizardStep(2); setWizardPhone(''); setWizardName(''); setWizardCode(null)
    setWizardErr(''); setWizardConnected(false); setWizardInstName(''); setWizardCountdown(null)
    setSfCountry(54)
    setWizardOpen(true)
  }

  async function fetchSfInfo(country) {
    setSfInfoLoading(true); setSfInfo(null)
    try {
      const r = await fetch(`/api/smsfast/info?country=${country}`, { cache: 'no-store' })
      const d = await r.json()
      setSfInfo(d)
    } catch {}
    finally { setSfInfoLoading(false) }
  }

  function startSfCancelCountdown() {
    if (sfCancelRef.current) clearInterval(sfCancelRef.current)
    setSfCancelSecs(120)
    sfCancelRef.current = setInterval(() => {
      setSfCancelSecs(prev => {
        if (prev <= 1) { clearInterval(sfCancelRef.current); sfCancelRef.current = null; return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSfBuy() {
    setSfBuying(true); setWizardErr('')
    try {
      const r = await fetch('/api/smsfast/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: sfCountry, maxPrice: sfInfo?.price }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d.detail || d.error || 'Error al comprar número')
      setSfActivationId(d.id)
      setSfBoughtNumber(d.number)
      setWizardPhone(d.number)
      if (!wizardName) setWizardName('wa-' + String(d.number).slice(-8))
      startSfCancelCountdown()
    } catch (e) {
      setWizardErr(e.message)
    } finally {
      setSfBuying(false)
    }
  }

  async function handleSfCancel() {
    if (!sfActivationId) return
    setSfCancelling(true)
    try {
      await fetch('/api/smsfast/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sfActivationId }),
      })
    } catch {}
    if (sfCancelRef.current) { clearInterval(sfCancelRef.current); sfCancelRef.current = null }
    setSfActivationId(null); setSfBoughtNumber(null); setWizardPhone(''); setSfCancelSecs(120)
    setSfCancelling(false)
  }

  async function handleWizardCreate() {
    if (!wizardName.trim()) { setWizardErr(t.inst.errRequired); return }
    const phone = wizardPhone.replace(/\D/g, '')
    if (!phone) { setWizardErr(lang === 'en' ? 'Phone number is required' : 'El número de teléfono es requerido'); return }
    const instName = wizardName.trim()
    setWizardLoading(true); setWizardErr('')
    try {
      const r = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name: instName, number: phone || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { setWizardErr(d.detail || t.inst.createGenErr); setWizardLoading(false); return }

      // If no phone provided — just create and close
      if (!phone) { fetchInstances(); setWizardOpen(false); setWizardLoading(false); return }

      // With phone — request pairing code
      const r2 = await fetch(`/api/evolution/instance/${instName}?action=pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const d2 = await r2.json()
      const code = d2.code || d2.pairingCode || d2.pairing_code
      if (!r2.ok || !code) { setWizardErr(d2.detail || d2.error || t.inst.wizardErrCode); setWizardLoading(false); return }
      setWizardInstName(instName)
      setWizardCode(code)
      setWizardStep(3)
      setWizardConnected(false)
      startWizardPoll(instName)
      startWizardCountdown()
      fetchInstances()
    } catch (e) {
      setWizardErr(e.message)
    } finally {
      setWizardLoading(false)
    }
  }

  async function handleRequestPairCode() {
    if (!pairPhone.trim()) { setPairErr('Ingresa el número de teléfono'); return }
    if (pairTarget?.provider === 'wasender') {
      setPairErr('WasenderAPI no soporta código de vinculación. Usa el botón QR para reconectar.')
      return
    }
    setPairLoading(true); setPairErr(''); setPairCode(null)
    try {
      const isWaha     = pairTarget?.provider === 'waha'
      const pairUrl = isWaha
        ? `/api/waha/session/pairing-code/${pairTarget?.name}`
        : `/api/evolution/instance/${pairTarget?.name}?action=pairing-code`
      const r = await fetch(pairUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pairPhone.replace(/\D/g, '') }),
      })
      const d = await r.json()
      const code = d.code || d.pairingCode || d.pairing_code
      if (!r.ok || !code) { setPairErr(d.detail || d.error || 'No se pudo generar el código'); return }
      setPairCode(code)
    } catch (e) {
      setPairErr(e.message)
    } finally {
      setPairLoading(false)
    }
  }

  async function handleCreate() {
    if (!newName.trim()) { setCreateErr(t.inst.errRequired); return }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(newName.trim()) && newName.trim().length > 1) {
      setCreateErr(t.inst.errInvalidName); return
    }
    setCreating(true); setCreateErr('')
    try {
      const r = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name: newName.trim(), number: newNumber.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { setCreateErr(d.detail || t.inst.createGenErr); return }
      setCreateOpen(false); setNewName(''); setNewNumber('')
      fetchInstances()
    } catch { setCreateErr(t.inst.createNetErr) }
    finally { setCreating(false) }
  }

  async function handleAssign() {
    setAssigning(true)
    const action = assignUserId ? 'assign' : 'unassign'
    const found  = users.find(u => (u._id || u.id || u.username) === assignUserId)
    const resolvedName = found
      ? (found.display_name || found.username || '')
      : (assignUserName && !/^[a-f0-9]{24}$/.test(assignUserName) ? assignUserName : '')
    const body = assignUserId
      ? { user_id: assignUserId, user_name: resolvedName }
      : {}
    try {
      await fetch(`/api/instances/${assignTarget.name}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify(body),
      })
      const msg = assignUserId
        ? `${t.inst.assignSuccess} ${resolvedName}`
        : t.inst.unassignSuccess
      setAssignOpen(false)
      fetchInstances()
      window.dispatchEvent(new Event(INSTANCES_CHANGED_EVENT))
      setSnack({ open: true, msg })
    } catch {}
    finally { setAssigning(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/instances/${deleteTarget.name}`, {
        method: 'DELETE', headers: { 'x-user-token': token() },
      })
      setDeleteTarget(null); fetchInstances()
    } catch {}
    finally { setDeleting(false) }
  }

  // ── New helpers ──────────────────────────────────────────────────────────────
  function openPickForUser(user) {
    setPickTargetUser(user)
    setPickOpen(true)
  }

  function closePick() {
    setPickOpen(false)
    setPickSelected(new Set())
  }

  async function handlePickAssign(instanceName) {
    if (!pickTargetUser) return
    const userId = pickTargetUser._id || pickTargetUser.id || pickTargetUser.username
    const userName = pickTargetUser.display_name || pickTargetUser.username || ''
    await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    closePick()
    fetchInstances()
  }

  async function handlePickAssignMulti() {
    if (!pickTargetUser || pickSelected.size === 0) return
    const uid      = pickTargetUser._id || pickTargetUser.id || pickTargetUser.username
    const userName = pickTargetUser.display_name || pickTargetUser.username || ''
    const names    = [...pickSelected]
    setInstances(prev => prev.map(i => names.includes(i.name) ? { ...i, assigned_to: uid, assigned_name: userName } : i))
    closePick()
    const results = await Promise.all(names.map(name =>
      fetch(`/api/instances/${name}?action=assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: uid, user_name: userName }),
      }).then(r => r.ok)
    ))
    const ok = results.filter(Boolean).length
    const failed = names.filter((_, i) => !results[i])
    if (failed.length) setInstances(prev => prev.map(i => failed.includes(i.name) ? { ...i, assigned_to: null, assigned_name: null } : i))
    setSnack({ open: true, msg: `${ok} instancia${ok !== 1 ? 's' : ''} → ${userName}` })
  }

  async function handleInlineAssign(instanceName, user) {
    const userId   = user._id || user.id || user.username
    const userName = user.display_name || user.username || ''
    setInstances(prev => prev.map(i => i.name === instanceName ? { ...i, assigned_to: userId, assigned_name: userName } : i))
    setExpandedAssign(null)
    const r = await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    if (!r.ok) {
      setInstances(prev => prev.map(i => i.name === instanceName ? { ...i, assigned_to: null, assigned_name: null } : i))
      const d = await r.json().catch(() => ({}))
      setSnack({ open: true, msg: d.detail || (lang === 'en' ? 'Could not assign instance' : 'No se pudo asignar la instancia') })
      return
    }
    setSnack({ open: true, msg: `${instanceName} → ${userName}` })
  }

  async function handleQuickUnassign(inst) {
    setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, assigned_to: null, assigned_name: null } : i))
    const r = await fetch(`/api/instances/${inst.name}?action=unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({}),
    })
    if (!r.ok) fetchInstances()
    else setSnack({ open: true, msg: `${inst.name} ${t.inst.quickUnassignDone}` })
  }

  function toggleSelectInst(name) {
    setSelectedInsts(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  async function handleBulkAssign(user) {
    const uid       = user._id || user.id || user.username
    const userName  = user.display_name || user.username || ''
    const curSlots  = instances.filter(i => i.assigned_to === uid).length
    const canAssign = Math.max(0, 5 - curSlots)
    const toAssign  = [...selectedInsts].slice(0, canAssign)
    const skipped   = selectedInsts.size - toAssign.length
    setInstances(prev => prev.map(i => toAssign.includes(i.name) ? { ...i, assigned_to: uid, assigned_name: userName } : i))
    setBulkPickOpen(false)
    setSelectedInsts(new Set())
    const results = await Promise.all(toAssign.map(name =>
      fetch(`/api/instances/${name}?action=assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: uid, user_name: userName }),
      }).then(r => ({ name, ok: r.ok }))
    ))
    const failed = results.filter(r => !r.ok).map(r => r.name)
    const ok     = results.length - failed.length
    if (failed.length) setInstances(prev => prev.map(i => failed.includes(i.name) ? { ...i, assigned_to: null, assigned_name: null } : i))
    const pfx = lang === 'en'
      ? `${ok} instance${ok !== 1 ? 's' : ''} → ${userName}`
      : `${ok} instancia${ok !== 1 ? 's' : ''} → ${userName}`
    setSnack({ open: true, msg: skipped > 0
      ? `${pfx} (${skipped} ${lang === 'en' ? 'skipped, cap' : 'omitidas, límite'})`
      : pfx })
  }

  async function handleWarmupToggle(inst) {
    const optimisticVal = !inst.warmup_mode
    setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: optimisticVal } : i))
    const res = await fetch(`/api/instances/${inst.name}?action=warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const data = await res.json()
      setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: data.warmup_mode } : i))
      const label = data.warmup_mode
        ? `🌱 ${inst.name}: calentamiento ON (${data.cap} msg/día)`
        : `${inst.name}: calentamiento OFF (${data.cap} msg/día)`
      setSnack({ open: true, msg: label })
      // Los badges de cupo de las demás pestañas (search/batch/csv/campaña/
      // programados/URL individual) se quedan montados en segundo plano y no
      // saben que el cupo de este número acaba de cambiar — este evento los
      // hace refrescar de inmediato en vez de quedarse con el dato viejo.
      window.dispatchEvent(new Event(INSTANCES_CHANGED_EVENT))
    } else {
      setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: inst.warmup_mode } : i))
    }
  }

  const connected = instances.filter(i => ['open', 'connected'].includes(i.live_status)).length
  const disconnected = instances.filter(i => !['open','connected','connecting'].includes(i.live_status) && i.live_status).length
  const warmupCount  = instances.filter(i => i.warmup_mode).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 800, fontSize: '1.3rem', lineHeight: 1.2 }}>
            {t.inst.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Chip label={`${instances.length} ${t.inst.statInstances}`} size="small" sx={STAT_CHIP_SX} />
            <Chip label={`${connected} ${t.inst.statConnected}`} size="small"
              sx={{ ...STAT_CHIP_SX, bgcolor: connected > 0 ? 'rgba(34,197,94,0.1)' : 'var(--item-hover)',
                color: connected > 0 ? '#4ade80' : 'var(--text-muted)',
                border: `1px solid ${connected > 0 ? 'rgba(34,197,94,0.25)' : 'var(--border)'}` }} />
            {disconnected > 0 && (
              <Chip label={`${disconnected} desconectadas`} size="small"
                sx={{ ...STAT_CHIP_SX, bgcolor: 'rgba(248,113,113,0.1)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.25)' }} />
            )}
            {warmupCount > 0 && (
              <Chip label={`${warmupCount} calentamiento`} size="small"
                sx={{ ...STAT_CHIP_SX, bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.25)' }} />
            )}
            <Chip label={`${users.length} ${t.inst.statUsers}`} size="small" sx={STAT_CHIP_SX} />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <Tooltip title={lang === 'en' ? 'Refresh session status' : 'Actualizar estado de sesiones'}>
            <IconButton size="small" onClick={handleSyncWaha} disabled={wahaSyncing}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: '#60a5fa' } }}>
              {wahaSyncing ? <CircularProgress size={16} sx={{ color: '#60a5fa' }} />
                : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={lang === 'en' ? 'Connect a new WhatsApp number via QR code' : 'Conectar un nuevo número de WhatsApp con código QR'} placement="bottom">
            <Button variant="outlined" startIcon={<AddIcon sx={{ fontSize: 15 }} />}
              onClick={() => { setWahaOpen(true); setWahaName(''); setWahaErr(''); setWahaQr(null); setWahaConnected(false); setWahaScanned(false); setWahaStatus('') }}
              sx={{ color: '#60a5fa', borderColor: 'rgba(59,130,246,0.4)', fontWeight: 700,
                fontSize: '0.82rem', borderRadius: 2, textTransform: 'none', px: 2,
                '&:hover': { borderColor: '#60a5fa', bgcolor: 'rgba(59,130,246,0.08)' } }}>
              {lang === 'en' ? 'Connect number' : 'Conectar número'}
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* ── System health bar ── */}
      {!loading && instances.length > 0 && (() => {
        const total = instances.length
        const connPct  = Math.round((connected / total) * 100)
        const warmPct  = Math.round((warmupCount / total) * 100)
        const discPct  = Math.round((disconnected / total) * 100)
        const restPct  = Math.max(0, 100 - connPct - warmPct - discPct)
        return (
          <Box sx={{ mb: 0.5 }}>
            {/* Segmented bar */}
            <Box sx={{ height: 5, borderRadius: 4, overflow: 'hidden', display: 'flex',
              bgcolor: 'rgba(255,255,255,0.06)', gap: '1px' }}>
              {connPct  > 0 && <Box sx={{ width: `${connPct}%`,  bgcolor: '#4ade80', transition: 'width 0.6s ease' }} />}
              {warmPct  > 0 && <Box sx={{ width: `${warmPct}%`,  bgcolor: '#fbbf24', transition: 'width 0.6s ease' }} />}
              {discPct  > 0 && <Box sx={{ width: `${discPct}%`,  bgcolor: '#f87171', transition: 'width 0.6s ease' }} />}
              {restPct  > 0 && <Box sx={{ width: `${restPct}%`,  bgcolor: 'rgba(148,163,184,0.3)' }} />}
            </Box>
            {/* Legend */}
            <Box sx={{ display: 'flex', gap: 2, mt: 0.8, flexWrap: 'wrap' }}>
              {[
                { color: '#4ade80', label: lang === 'en' ? `${connected} connected` : `${connected} conectadas`, show: connected > 0 },
                { color: '#fbbf24', label: lang === 'en' ? `${warmupCount} warmup` : `${warmupCount} calentamiento`, show: warmupCount > 0 },
                { color: '#f87171', label: lang === 'en' ? `${disconnected} disconnected` : `${disconnected} desconectadas`, show: disconnected > 0 },
              ].filter(i => i.show).map(({ color, label }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</Typography>
                </Box>
              ))}
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(148,163,184,0.5)', ml: 'auto' }}>
                {connPct}% {lang === 'en' ? 'online' : 'en línea'}
              </Typography>
            </Box>
          </Box>
        )
      })()}

      {/* User cards grid + unassigned sidebar */}
      <Box sx={{ flex: 1, display: 'flex', gap: 2, minHeight: 0, overflow: 'hidden' }}>
        {/* Left: scrollable content */}
        <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pr: 0.5,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-button': { display: 'none' },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
          '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
        }}>
          {/* User search filter */}
          {!loading && users.length > 0 && (
            <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1,
              px: 1.2, py: 0.7, borderRadius: 2,
              bgcolor: 'var(--card-bg)', border: '1px solid var(--border)',
              '&:focus-within': { borderColor: 'rgba(100,116,139,0.5)' }, transition: 'border-color 0.15s',
            }}>
              <Box component="svg" viewBox="0 0 20 20" fill="none"
                sx={{ width: 14, height: 14, flexShrink: 0, color: 'var(--text-muted)' }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </Box>
              <Box component="input"
                placeholder={lang === 'en' ? 'Search users…' : 'Buscar usuarios…'}
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                sx={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text)', fontSize: '0.78rem',
                  '&::placeholder': { color: 'var(--text-muted)', opacity: 0.7 },
                }}
              />
              {userSearch && (
                <Box onClick={() => setUserSearch('')} component="span"
                  sx={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1,
                    '&:hover': { color: 'var(--text)' }, userSelect: 'none' }}>
                  ×
                </Box>
              )}
            </Box>
          )}
        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 2 }}>
            {(skeletonCounts.current.users.length ? skeletonCounts.current.users : [2, 3, 1, 2, 0, 1]).map((rowCount, i) => (
              <Box key={i} sx={{
                bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', gap: 0,
                '@keyframes skCardIn': { '0%': { opacity: 0, transform: 'translateY(12px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
                animation: 'skCardIn 0.35s ease both',
                animationDelay: `${i * 0.08}s`,
              }}>
                {/* Header: avatar + name/role + slot counter */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
                  <Skeleton variant="rounded" width={38} height={38} sx={{ borderRadius: 2, flexShrink: 0,
                    bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)',
                    border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.22)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.15), transparent)' } }} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="56%" height={14} sx={{ mb: 0.3,
                      bgcolor: 'rgba(255,255,255,0.1)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.11), transparent)' } }} />
                    <Skeleton variant="text" width="30%" height={10} sx={{
                      bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.13)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.10), transparent)' } }} />
                  </Box>
                  <Skeleton variant="rounded" width={34} height={20} sx={{ borderRadius: 10,
                    bgcolor: 'rgba(255,255,255,0.07)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)' } }} />
                </Box>

                <Divider sx={{ borderColor: 'var(--border)', mb: rowCount === 0 ? 0 : 1.2 }} />

                {/* Instance rows */}
                {rowCount > 0 ? [...Array(rowCount)].map((_, r) => (
                  <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.9,
                    borderRadius: 1.5, mb: 0.5,
                    bgcolor: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)',
                    '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
                    animation: 'skRowIn 0.25s ease both',
                    animationDelay: `${i * 0.08 + r * 0.05 + 0.12}s`,
                  }}>
                    {/* status dot */}
                    <Skeleton variant="circular" width={8} height={8} sx={{ flexShrink: 0,
                      bgcolor: r === 0 ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.12)' }} />
                    {/* name + provider badge + phone */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.25 }}>
                        <Skeleton variant="text" width={`${34 + (i * 13 + r * 11) % 22}%`} height={12} sx={{
                          bgcolor: 'rgba(255,255,255,0.09)',
                          '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.08), transparent)' } }} />
                        <Skeleton variant="rounded" width={30} height={13} sx={{ borderRadius: 0.7, flexShrink: 0,
                          bgcolor: 'rgba(52,211,153,0.14)',
                          '&::after': { background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.1), transparent)' } }} />
                      </Box>
                      <Skeleton variant="text" width={`${48 + (i * 7 + r * 9) % 22}%`} height={10} sx={{
                        bgcolor: 'rgba(255,255,255,0.06)',
                        '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.06), transparent)' } }} />
                    </Box>
                    {/* status label */}
                    <Skeleton variant="text" width={r === 0 ? 52 : 70} height={12} sx={{ flexShrink: 0,
                      bgcolor: r === 0 ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.07)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' } }} />
                  </Box>
                )) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    py: 2.5, gap: 1, borderRadius: 1.5, mt: 1,
                    border: '1px dashed rgba(var(--accent-rgb,59,130,246),0.16)',
                    bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.025)' }}>
                    <Box sx={{ display: 'flex', gap: 0.7 }}>
                      {[...Array(5)].map((_, d) => (
                        <Skeleton key={d} variant="circular" width={9} height={9}
                          sx={{ bgcolor: 'rgba(255,255,255,0.07)' }} />
                      ))}
                    </Box>
                    <Skeleton variant="text" width="50%" height={10} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />
                    <Skeleton variant="rounded" width={100} height={20} sx={{ borderRadius: 1.5, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)' }} />
                  </Box>
                )}

                {/* Capacity bar — 5 slot dots + chip/button */}
                <Box sx={{ display: 'flex', gap: 0.7, mt: 1.5, pt: 1, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                  {[...Array(5)].map((_, d) => (
                    <Skeleton key={d} variant="circular" width={10} height={10}
                      sx={{ bgcolor: d < rowCount ? 'rgba(34,197,94,0.32)' : 'rgba(255,255,255,0.07)' }} />
                  ))}
                  {rowCount >= 2 ? (
                    <Skeleton variant="rounded" width={80} height={17} sx={{ ml: 'auto', borderRadius: 10,
                      bgcolor: 'rgba(34,197,94,0.1)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.1), transparent)' } }} />
                  ) : (
                    <Skeleton variant="text" width={58} height={12} sx={{ ml: 'auto', bgcolor: 'rgba(255,255,255,0.05)' }} />
                  )}
                </Box>

                {/* Stats line */}
                {rowCount > 0 && (
                  <Skeleton variant="text" width="44%" height={10} sx={{ mt: 0.8, bgcolor: 'rgba(255,255,255,0.04)' }} />
                )}
              </Box>
            ))}
          </Box>

        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 2 }}>
            {users
              .filter(u => {
                if (!userSearch.trim()) return true
                const q = userSearch.toLowerCase()
                return (u.display_name || u.username || '').toLowerCase().includes(q) ||
                  (u.email || '').toLowerCase().includes(q)
              })
              .map((user, cardIndex) => {
                const uid = user._id || user.id || user.username
                const userInsts = instances.filter(i => i.assigned_to === uid)
                return (
                  <UserCard key={uid} user={user} instances={userInsts} cardIndex={cardIndex}
                    onAddSlot={() => openPickForUser(user)}
                    onQr={inst => handleQrClick(inst)}
                    onEditNumber={inst => handleEditNumberClick(inst)}
                    onRemove={handleQuickUnassign}
                    onWarmup={handleWarmupToggle}
                  />
                )
              })}
          </Box>
        )}
        </Box>{/* end left panel */}

        {/* Right sidebar: unassigned instances */}
        {loading ? (
          <Box sx={{
            width: 240, flexShrink: 0,
            border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2.5,
            bgcolor: 'var(--card-bg)', alignSelf: 'flex-start', overflow: 'hidden',
            '@keyframes skCardIn': { '0%': { opacity: 0, transform: 'translateY(12px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
            animation: 'skCardIn 0.35s ease both', animationDelay: '0.3s',
          }}>
            {/* Header: amber dot + "Sin asignar" + count + arrow */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.2,
              borderBottom: '1px solid rgba(245,158,11,0.12)' }}>
              <Skeleton variant="circular" width={7} height={7} sx={{ bgcolor: 'rgba(245,158,11,0.45)', flexShrink: 0 }} />
              <Skeleton variant="text" width="52%" height={14} sx={{ flex: 1,
                bgcolor: 'rgba(255,255,255,0.1)',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.12), transparent)' } }} />
              <Skeleton variant="rounded" width={22} height={16} sx={{ borderRadius: 10, bgcolor: 'rgba(245,158,11,0.12)' }} />
              <Skeleton variant="circular" width={12} height={12} sx={{ bgcolor: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
            </Box>
            {/* Group label row — mirrors the "SIN CONEXIÓN" section header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.55,
              bgcolor: 'rgba(255,255,255,0.025)',
              borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
              '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
              animation: 'skRowIn 0.2s ease both', animationDelay: '0.32s' }}>
              <Skeleton variant="circular" width={5} height={5} sx={{ bgcolor: 'rgba(148,163,184,0.35)', flexShrink: 0 }} />
              <Skeleton variant="text" width="44%" height={10} sx={{ bgcolor: 'rgba(148,163,184,0.15)',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.12), transparent)' } }} />
              <Skeleton variant="rounded" width={16} height={12} sx={{ borderRadius: 10, ml: 'auto', bgcolor: 'rgba(255,255,255,0.06)' }} />
            </Box>
            {/* Instance rows */}
            {[...Array(skeletonCounts.current.unassigned || 4)].map((_, r) => (
              <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.65,
                borderBottom: '1px solid var(--border)',
                '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
                animation: 'skRowIn 0.25s ease both', animationDelay: `${r * 0.06 + 0.38}s` }}>
                <Skeleton variant="circular" width={8} height={8} sx={{ flexShrink: 0,
                  bgcolor: 'rgba(255,255,255,0.12)' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Skeleton variant="text" width={`${42 + (r * 13) % 28}%`} height={11} sx={{ mb: 0.2,
                    bgcolor: 'rgba(255,255,255,0.09)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.08), transparent)' } }} />
                  <Skeleton variant="text" width={`${52 + (r * 9) % 24}%`} height={9} sx={{ bgcolor: 'rgba(255,255,255,0.06)' }} />
                </Box>
                {/* Action buttons: QR, assign, edit, delete */}
                <Box sx={{ display: 'flex', gap: 0.3, flexShrink: 0 }}>
                  {[
                    'rgba(96,165,250,0.25)',
                    'rgba(96,165,250,0.2)',
                    'rgba(167,139,250,0.2)',
                    'rgba(248,113,113,0.2)',
                  ].map((bg, b) => (
                    <Skeleton key={b} variant="circular" width={20} height={20} sx={{ bgcolor: bg }} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (() => {
          const unassigned = instances.filter(i => !i.assigned_to)
          if (unassigned.length === 0) return null
          const connGroup   = unassigned.filter(i => ['open','connected'].includes(i.live_status))
          const pendGroup   = unassigned.filter(i => i.live_status === 'connecting')
          const restGroup   = unassigned.filter(i => !['open','connected','connecting'].includes(i.live_status))
          const grouped = [
            ...(connGroup.length   ? [{ _group: lang === 'en' ? 'Connected' : 'Conectadas',   color: '#4ade80', items: connGroup }] : []),
            ...(pendGroup.length   ? [{ _group: lang === 'en' ? 'Connecting' : 'Conectando',  color: '#fbbf24', items: pendGroup }] : []),
            ...(restGroup.length   ? [{ _group: lang === 'en' ? 'Disconnected' : 'Sin conexión', color: '#94a3b8', items: restGroup }] : []),
          ]
          return (
            <Box sx={{
              width: 240, flexShrink: 0,
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2.5,
              bgcolor: 'var(--card-bg)', alignSelf: 'flex-start',
              display: 'flex', flexDirection: 'column',
              maxHeight: 'calc(100vh - 200px)',
              overflow: 'hidden',
            }}>
              {/* Sidebar header — fixed, click to collapse/expand (lives outside the scroll area) */}
              <Box onClick={() => setSidebarCollapsed(c => !c)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.2,
                  borderBottom: sidebarCollapsed ? 'none' : '1px solid rgba(245,158,11,0.12)',
                  cursor: 'pointer', userSelect: 'none',
                  flexShrink: 0,
                  bgcolor: 'var(--card-bg)', borderRadius: '10px 10px 0 0',
                  '&:hover': { bgcolor: 'rgba(245,158,11,0.04)' }, transition: 'background 0.12s',
                }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b', flexShrink: 0, boxShadow: '0 0 6px #f59e0b88' }} />
                <Typography sx={{ color: 'var(--text)', fontSize: '0.82rem', fontWeight: 700, flex: 1 }}>
                  {lang === 'en' ? 'Unassigned' : 'Sin asignar'}
                </Typography>
                <Typography sx={{ fontSize: '0.67rem', color: 'rgba(245,158,11,0.7)',
                  bgcolor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                  px: 1, py: 0.2, borderRadius: 10, fontWeight: 600, mr: 0.5 }}>
                  {unassigned.length}
                </Typography>
                <KeyboardArrowDownIcon sx={{ fontSize: 15, color: 'rgba(245,158,11,0.6)',
                  transition: 'transform 0.2s', transform: sidebarCollapsed ? 'rotate(-90deg)' : 'none' }} />
              </Box>

              {/* Compact list — grouped by status; this is the ONLY scrollable region now */}
              {!sidebarCollapsed && (
              <Box sx={{
                flex: 1, minHeight: 0, overflowY: 'auto',
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-button': { display: 'none' },
                '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(245,158,11,0.25)', borderRadius: 4 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
              }}>
              {grouped.map(({ _group, color: gColor, items }) => (
                <Box key={_group}>
                  {/* Group label */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.55,
                    bgcolor: 'rgba(255,255,255,0.025)', borderBottom: '1px solid var(--border)',
                    borderTop: '1px solid var(--border)' }}>
                    <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: gColor, flexShrink: 0,
                      boxShadow: `0 0 4px ${gColor}99` }} />
                    <Typography sx={{ fontSize: '0.57rem', fontWeight: 700, color: gColor,
                      textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>
                      {_group}
                    </Typography>
                    <Typography sx={{ fontSize: '0.57rem', color: gColor, opacity: 0.6, fontWeight: 600 }}>
                      {items.length}
                    </Typography>
                  </Box>
                  {/* Rows */}
                  {items.map((inst, idx) => {
                    const isExp = expandedAssign === inst.name
                    const status = inst.live_status || 'unknown'
                    const icolor = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                    const isConn = ['open','connected'].includes(status)
                    const _RC = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c', disconnected: '#f87171', failed: '#f87171' }
                    const dotColor = (!isConn && status !== 'connecting' && inst.disconnect_reason) ? (_RC[inst.disconnect_reason] ?? '#f87171') : icolor
                    const reasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
                    return (
                      <Box key={inst.name}
                        ref={el => { sidebarRowRefs.current[inst.name] = el }}
                        sx={{ position: 'relative', ...(isExp && { zIndex: 201 }) }}>
                        <Box sx={{
                          display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.65,
                          borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none',
                          '&:hover': { bgcolor: 'var(--item-hover)' }, transition: 'background 0.12s',
                          '&:hover .inst-check': { opacity: 1 },
                          ...(isExp && { bgcolor: 'rgba(59,130,246,0.04)' }),
                        }}>
                          {/* Multi-select checkbox */}
                          <Box className="inst-check"
                            onClick={e => { e.stopPropagation(); toggleSelectInst(inst.name) }}
                            sx={{
                              width: 13, height: 13, flexShrink: 0, borderRadius: 0.4,
                              border: selectedInsts.has(inst.name) ? '1.5px solid #60a5fa' : '1.5px solid rgba(255,255,255,0.22)',
                              bgcolor: selectedInsts.has(inst.name) ? 'rgba(59,130,246,0.85)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', transition: 'all 0.1s',
                              opacity: selectedInsts.size > 0 ? 1 : 0,
                              zIndex: 1,
                            }}>
                            {selectedInsts.has(inst.name) && (
                              <Typography sx={{ fontSize: '9px', lineHeight: 1, color: 'white', fontWeight: 700, userSelect: 'none', mt: '1px' }}>✓</Typography>
                            )}
                          </Box>
                          <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor,
                              boxShadow: isConn ? `0 0 6px ${dotColor}aa` : 'none', position: 'relative', zIndex: 1 }} />
                            {isConn && (
                              <Box sx={{
                                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                                width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor, opacity: 0.4,
                                '@keyframes ping': {
                                  '0%':   { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.4 },
                                  '75%':  { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
                                  '100%': { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
                                },
                                animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                              }} />
                            )}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {inst.label || inst.name}
                            </Typography>
                            <Typography sx={{ fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.2,
                              color: reasonLabel && !isConn ? dotColor : 'var(--text-muted)' }}>
                              {reasonLabel && !isConn ? reasonLabel : (inst.number ? `+${inst.number}` : t.inst.noNumber)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.2, alignItems: 'center', flexShrink: 0 }}>
                            <Tooltip title={t.inst.connectQr}>
                              <IconButton size="small" onClick={() => handleQrClick(inst)}
                                sx={{ color: '#60a5fa', p: 0.4, '&:hover': { bgcolor: 'rgba(59,130,246,0.1)' } }}>
                                <QrCodeIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={isExp ? (lang === 'en' ? 'Close' : 'Cerrar') : t.inst.assignUser}>
                              <IconButton size="small"
                                onClick={e => {
                                  e.stopPropagation()
                                  if (isExp) {
                                    setExpandedAssign(null); setSidebarAnchor(null)
                                  } else {
                                    const el = sidebarRowRefs.current[inst.name]
                                    const rect = el ? el.getBoundingClientRect() : null
                                    setExpandedAssign(inst.name)
                                    setSidebarAnchor(rect ? { top: rect.bottom + 2, left: rect.left, width: rect.width } : null)
                                  }
                                }}
                                sx={{ color: '#60a5fa', p: 0.4, ...(isExp && { bgcolor: 'rgba(59,130,246,0.08)' }),
                                  '&:hover': { bgcolor: 'rgba(59,130,246,0.1)' } }}>
                                <KeyboardArrowDownIcon sx={{ fontSize: 14, transition: 'transform 0.2s',
                                  transform: isExp ? 'rotate(180deg)' : 'none' }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={lang === 'en' ? 'Edit number' : 'Editar número'}>
                              <IconButton size="small" onClick={() => handleEditNumberClick(inst)}
                                sx={{ color: '#a78bfa', p: 0.4, '&:hover': { bgcolor: 'rgba(167,139,250,0.1)' } }}>
                                <EditIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t.inst.delete}>
                              <IconButton size="small" onClick={() => handleDeleteClick(inst)}
                                sx={{ color: '#f87171', p: 0.4, '&:hover': { bgcolor: 'rgba(248,113,133,0.1)' } }}>
                                <DeleteForeverIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              ))}
              </Box>
              )}

              {/* Multi-select footer bar — fixed, lives outside the scroll area */}
              {selectedInsts.size > 0 && (
                <Box sx={{
                  flexShrink: 0,
                  px: 1.5, py: 1,
                  borderTop: '1px solid rgba(59,130,246,0.25)',
                  bgcolor: 'var(--card-bg)',
                  display: 'flex', alignItems: 'center', gap: 1,
                }}>
                  <Box sx={{
                    width: 20, height: 20, borderRadius: 1, flexShrink: 0,
                    bgcolor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#60a5fa' }}>
                      {selectedInsts.size}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', flex: 1 }}>
                    {lang === 'en' ? `selected` : `seleccionada${selectedInsts.size !== 1 ? 's' : ''}`}
                  </Typography>
                  <Box onClick={() => setSelectedInsts(new Set())}
                    sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', px: 0.5,
                      '&:hover': { color: 'rgba(255,255,255,0.6)' }, userSelect: 'none' }}>
                    ✕
                  </Box>
                  <Box onClick={() => setBulkPickOpen(true)}
                    sx={{
                      px: 1.2, py: 0.45, borderRadius: 1.5, cursor: 'pointer',
                      bgcolor: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.45)',
                      transition: 'background 0.12s',
                      '&:hover': { bgcolor: 'rgba(59,130,246,0.28)' },
                    }}>
                    <Typography sx={{ fontSize: '0.72rem', color: '#60a5fa', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {lang === 'en' ? 'Assign' : 'Asignar'}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          )
        })()}
      </Box>

      {/* Bulk assign dialog */}
      <BulkPickDialog
        open={bulkPickOpen}
        onClose={() => setBulkPickOpen(false)}
        selectedNames={selectedInsts}
        users={users}
        instances={instances}
        onAssign={handleBulkAssign}
        lang={lang}
      />

      {/* Sidebar assign dropdown — portal to body so overflow:auto never clips it */}
      {typeof window !== 'undefined' && expandedAssign && sidebarAnchor && createPortal(
        <>
          <Box onClick={() => { setExpandedAssign(null); setSidebarAnchor(null) }}
            sx={{ position: 'fixed', inset: 0, zIndex: 1200 }} />
          <Box sx={{
            position: 'fixed',
            top: sidebarAnchor.top,
            left: sidebarAnchor.left,
            width: Math.max(sidebarAnchor.width, 240),
            zIndex: 1201,
            border: '1px solid rgba(59,130,246,0.35)', borderRadius: 2,
            bgcolor: 'var(--card-bg)', boxShadow: '0 12px 40px rgba(0,0,0,0.55)', overflow: 'hidden',
          }}>
            <InlineUserPicker instanceName={expandedAssign} users={users} instances={instances}
              onAssign={(...args) => { handleInlineAssign(...args); setSidebarAnchor(null) }}
              t={t} lang={lang} />
          </Box>
        </>,
        document.body
      )}

      {/* ── Edit number dialog ── */}
      <Dialog open={editNumberOpen} onClose={() => setEditNumberOpen(false)} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)',
          border: '1px solid rgba(167,139,250,0.3)',
          borderRadius: 3, minWidth: 360, maxWidth: 420,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(167,139,250,0.15)',
              border: '1px solid rgba(167,139,250,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <EditIcon sx={{ fontSize: 17, color: '#a78bfa' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'Edit phone number' : 'Editar número'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.38))', fontSize: '0.7rem', fontFamily: 'monospace', mt: 0.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {editNumberInst?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setEditNumberOpen(false)}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.25))', '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.06)' }, flexShrink: 0 }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '8px !important', pb: 0, display: 'flex', flexDirection: 'column', gap: 1.8 }}>
          {/* Label / display name */}
          <TextField
            label={lang === 'en' ? 'Display name' : 'Nombre visible'}
            placeholder={lang === 'en' ? 'e.g. Mexico 1' : 'ej. México 1'}
            size="small" fullWidth autoFocus
            value={editLabelValue}
            onChange={e => setEditLabelValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !editNumberSaving && handleEditNumberSave()}
            sx={FIELD_SX}
            helperText={
              <span style={{ color: 'var(--text-muted,rgba(255,255,255,0.28))', fontSize: '0.67rem' }}>
                {lang === 'en' ? 'Friendly name shown in the UI' : 'Nombre amigable que se muestra en la UI'}
              </span>
            }
          />

          {/* Phone number */}
          <TextField
            label={lang === 'en' ? 'Phone number (with country code)' : 'Número de teléfono (con código de país)'}
            placeholder="5214428079840"
            size="small" fullWidth
            value={editNumberValue}
            onChange={e => setEditNumberValue(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={e => e.key === 'Enter' && !editNumberSaving && handleEditNumberSave()}
            sx={FIELD_SX}
            slotProps={{ input: { startAdornment: (
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.88rem', mr: 0.5, userSelect: 'none' }}>+</Typography>
            ) } }}
            helperText={editNumberErr
              ? <span style={{ color: '#f87171' }}>{editNumberErr}</span>
              : <span style={{ color: 'var(--text-muted,rgba(255,255,255,0.28))', fontSize: '0.67rem' }}>
                  {lang === 'en' ? 'Digits only, no spaces or +' : 'Solo dígitos, sin espacios ni +'}
                </span>}
          />
        </DialogContent>

        <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.05)', mt: 1 }}>
          <Button size="small" onClick={() => setEditNumberOpen(false)}
            sx={{ textTransform: 'none', color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.82rem',
              '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button size="small" variant="contained" onClick={handleEditNumberSave}
            disabled={editNumberSaving || !editNumberValue.trim()}
            startIcon={editNumberSaving ? null : <CheckCircleIcon sx={{ fontSize: '15px !important' }} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2,
              bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' },
              '&.Mui-disabled': { bgcolor: 'rgba(124,58,237,0.25)', color: 'rgba(255,255,255,0.3)' } }}>
            {editNumberSaving
              ? <><CircularProgress size={13} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Saving…' : 'Guardando…'}</>
              : lang === 'en' ? 'Save' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Pick instance dialog ── */}
      <Dialog open={pickOpen} onClose={closePick} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)',
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.09) 0%, var(--card-bg,#161d2e) 55%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)',
          borderRadius: 3, minWidth: 390, maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
        },
      }}>
        <DialogTitle sx={{ pb: 1.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.3 }}>
            <Box sx={{
              width: 38, height: 38, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PersonAddIcon sx={{ fontSize: 20, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.assignTitle}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.3 }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'var(--accent,#60a5fa)', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.72rem', color: 'var(--accent,#60a5fa)', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pickTargetUser?.display_name || pickTargetUser?.username}
                </Typography>
                {(() => {
                  const uid = pickTargetUser?._id || pickTargetUser?.id || pickTargetUser?.username
                  const cur = instances.filter(i => i.assigned_to === uid).length
                  return (
                    <Box sx={{ px: 0.8, py: 0.2, borderRadius: 1, flexShrink: 0,
                      bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)',
                      border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)' }}>
                      <Typography sx={{ fontSize: '0.58rem', color: 'var(--accent,#60a5fa)', fontWeight: 700 }}>
                        {cur}/5 slots
                      </Typography>
                    </Box>
                  )
                })()}
              </Box>
            </Box>
            <IconButton size="small" onClick={closePick}
              sx={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0,
                '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 0 }}>
          {(() => {
            const unassigned = instances.filter(i => !i.assigned_to)
            const uid = pickTargetUser?._id || pickTargetUser?.id || pickTargetUser?.username
            const curSlots = instances.filter(i => i.assigned_to === uid).length
            const maxPick = Math.max(0, 5 - curSlots)
            if (unassigned.length === 0)
              return (
                <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', py: 3, textAlign: 'center' }}>
                  {t.inst.noUnassigned}
                </Typography>
              )
            return (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2 }}>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--border)' }} />
                  <Typography sx={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    {maxPick === 0
                      ? (lang === 'en' ? 'Slots full' : 'Slots llenos')
                      : (lang === 'en' ? `Up to ${maxPick} more` : `Hasta ${maxPick} más`)}
                  </Typography>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--border)' }} />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 280, overflowY: 'auto',
                  pr: 0.5,
                  '&::-webkit-scrollbar': { width: 3 },
                  '&::-webkit-scrollbar-button': { display: 'none' },
                  '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.25)', borderRadius: 4 },
                }}>
                  {unassigned.map(inst => {
                    const status  = inst.live_status || 'unknown'
                    const color   = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                    const isConn  = ['open','connected','WORKING'].includes(status)
                    const isDisco = ['close','disconnected','STOPPED','FAILED','auth_failure','error'].includes(status)
                    const isSel   = pickSelected.has(inst.name)
                    const atMax   = !isSel && pickSelected.size >= maxPick
                    const disabled = maxPick === 0 || atMax
                    return (
                      <Box key={inst.name}
                        onClick={() => {
                          if (disabled) return
                          setPickSelected(prev => {
                            const next = new Set(prev)
                            next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name)
                            return next
                          })
                        }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1.2, px: 1.4, py: 0.9,
                          borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer',
                          border: isSel ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)' : '1px solid transparent',
                          bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.09)' : 'rgba(255,255,255,0.025)',
                          opacity: disabled ? 0.38 : 1,
                          transition: 'all 0.12s',
                          '&:hover': disabled ? {} : {
                            bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.12)' : 'rgba(var(--accent-rgb,59,130,246),0.06)',
                            borderColor: 'rgba(var(--accent-rgb,59,130,246),0.28)',
                          },
                        }}>
                        {/* Checkbox */}
                        <Box sx={{
                          width: 15, height: 15, borderRadius: 0.5, flexShrink: 0,
                          border: isSel ? '1.5px solid var(--accent,#60a5fa)' : '1.5px solid rgba(255,255,255,0.2)',
                          bgcolor: isSel ? 'var(--accent,#60a5fa)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}>
                          {isSel && <Typography sx={{ fontSize: '9px', color: 'white', fontWeight: 800, userSelect: 'none', mt: '1px' }}>✓</Typography>}
                        </Box>
                        {/* Status dot */}
                        <Box sx={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
                          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color,
                            boxShadow: isConn ? `0 0 6px ${color}bb` : 'none' }} />
                        </Box>
                        {/* Name + number */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ color: 'var(--text)', fontSize: '0.82rem', fontWeight: 600,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inst.label || inst.name}
                          </Typography>
                          <Typography sx={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.64rem', fontFamily: 'monospace' }}>
                            {inst.number ? `+${inst.number}` : (lang === 'en' ? 'No number' : 'Sin número')}
                          </Typography>
                        </Box>
                        {/* Status chip */}
                        <Box sx={{ px: 0.8, py: 0.25, borderRadius: 1, flexShrink: 0,
                          bgcolor: `${color}18`, border: `1px solid ${color}44` }}>
                          <Typography sx={{ fontSize: '0.6rem', color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {isConn ? t.inst.statusConnected : isDisco ? t.inst.statusDisconnected : t.inst.statusUnknown}
                          </Typography>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            )
          })()}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, pb: 2, pt: 1.5, mt: 1,
          borderTop: '1px solid rgba(255,255,255,0.06)', gap: 1 }}>
          <Typography sx={{ flex: 1, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {pickSelected.size > 0 ? `${pickSelected.size} seleccionada${pickSelected.size !== 1 ? 's' : ''}` : ''}
          </Typography>
          <Button onClick={closePick}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem',
              '&:hover': { color: 'var(--text)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button onClick={handlePickAssignMulti} disabled={pickSelected.size === 0}
            variant="contained"
            sx={{
              bgcolor: 'var(--accent,#3b82f6)', color: 'white', textTransform: 'none',
              borderRadius: 1.5, px: 2, fontSize: '0.82rem', fontWeight: 600,
              boxShadow: 'none',
              '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.82)', boxShadow: 'none' },
              '&:disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
            }}>
            {lang === 'en'
              ? `Assign${pickSelected.size > 0 ? ` (${pickSelected.size})` : ''}`
              : `Asignar${pickSelected.size > 0 ? ` (${pickSelected.size})` : ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.1) 0%, var(--card-bg,#161d2e) 55%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PhoneAndroidIcon sx={{ fontSize: 18, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.createTitle}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {t.inst.createSubtitle}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '4px !important', px: 3 }}>
          <TextField
            label={t.inst.nameLabel}
            placeholder={t.inst.namePlaceholder}
            size="small"
            value={newName}
            onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            sx={FIELD_SX}
            onKeyDown={e => e.key === 'Enter' && !newNumber && handleCreate()}
            autoFocus
            helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>{t.inst.nameHint}</span>}
          />
          <TextField
            label={t.inst.numberLabel}
            placeholder={t.inst.numberPlaceholder}
            size="small"
            value={newNumber}
            onChange={e => setNewNumber(e.target.value.replace(/\D/g, ''))}
            sx={FIELD_SX}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>{t.inst.numberHint}</span>}
            slotProps={{ input: {
              startAdornment: <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.85rem', mr: 0.5, fontFamily: 'monospace' }}>+</Typography>
            }}}
          />
          {createErr && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{createErr}</Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}
            sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
            {t.inst.cancel}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            variant="contained"
            sx={{
              bgcolor: 'var(--accent,#3b82f6)', textTransform: 'none', fontWeight: 700,
              fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
              '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
            }}
          >
            {creating
              ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{t.inst.creating}</>
              : t.inst.create}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add number wizard ── */}
      <Dialog open={wizardOpen} onClose={() => { if (!wizardLoading) { stopWizardPoll(); setWizardOpen(false) } }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(34,197,94,0.08) 0%, transparent 55%)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 3, minWidth: 420, maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AddIcon sx={{ fontSize: 18, color: '#4ade80' }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.wizardTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {wizardStep === 2
                ? (lang === 'en' ? 'New instance' : 'Nueva instancia')
                : (lang === 'en' ? 'Linking code' : 'Código de vinculación')}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 1, px: 3 }}>
          {wizardStep === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', lineHeight: 1.6, mb: 0.5 }}>
                {t.inst.wizardStep1Intro}
              </Typography>
              {[
                [t.inst.wizardStep1a, t.inst.wizardStep1aSub],
                [t.inst.wizardStep1b, t.inst.wizardStep1bSub],
                [t.inst.wizardStep1c, t.inst.wizardStep1cSub],
                [t.inst.wizardStep1d, t.inst.wizardStep1dSub],
              ].map(([title, sub], i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.3 }}>
                    <Typography sx={{ color: '#4ade80', fontSize: '0.65rem', fontWeight: 800 }}>{i + 1}</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem', lineHeight: 1.4 }}>{title}</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', mt: 0.2 }}>{sub}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {wizardStep === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t.inst.nameLabel}
                placeholder={t.inst.namePlaceholder}
                size="small"
                value={wizardName}
                onChange={e => setWizardName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{t.inst.nameHint}</span>}
                autoFocus
                sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wizardLoading && handleWizardCreate()}
              />

              {/* ── Phone field ── */}
              <TextField
                label={t.inst.wizardPhoneLabel}
                placeholder={t.inst.wizardPhonePlaceholder}
                size="small"
                value={wizardPhone}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '')
                  setWizardPhone(v)
                  if (!wizardName) setWizardName('wa-' + v.slice(-8))
                }}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{t.inst.wizardPhoneHint}</span>}
                sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wizardLoading && handleWizardCreate()}
              />


              {wizardErr && (
                <Box sx={{ px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wizardErr}</Typography>
                </Box>
              )}
            </Box>
          )}

          {wizardStep === 3 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {wizardConnected ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
                  <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
                  <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                    {t.inst.wizardConnectedTitle}
                  </Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', textAlign: 'center' }}>
                    {t.inst.wizardConnectedDesc.replace('{name}', wizardInstName)}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    {t.inst.wizardStep3Intro}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 1 }}>
                    <Box sx={{ px: 3, py: 2, borderRadius: 2, bgcolor: wizardCountdown === 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.1)', border: `1px solid ${wizardCountdown === 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, transition: 'all 0.3s' }}>
                      <Typography sx={{ color: wizardCountdown === 0 ? '#f87171' : '#4ade80', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.25em', fontFamily: 'monospace', transition: 'color 0.3s' }}>
                        {wizardCode ? wizardCode.slice(0,4) + '-' + wizardCode.slice(4) : ''}
                      </Typography>
                    </Box>
                    {wizardCountdown !== null && (
                      <Typography sx={{ color: wizardCountdown <= 10 ? '#f87171' : 'rgba(255,255,255,0.3)', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                        {wizardCountdown === 0
                          ? (lang === 'en' ? 'Refreshing…' : 'Actualizando…')
                          : (lang === 'en' ? `Expires in ${wizardCountdown}s` : `Expira en ${wizardCountdown}s`)}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', fontWeight: 600, mb: 0.5 }}>
                      {t.inst.wizardWaLabel}
                    </Typography>
                    {[t.inst.wizardWaStep1, t.inst.wizardWaStep2, t.inst.wizardWaStep3, t.inst.wizardWaStep4].map((s, i) => (
                      <Typography key={i} sx={{ color: i === 3 ? '#4ade80' : 'rgba(255,255,255,0.45)', fontSize: '0.78rem', lineHeight: 1.8, pl: i > 0 ? 1 : 0 }}>
                        {s}
                      </Typography>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
                    <CircularProgress size={12} sx={{ color: 'rgba(255,255,255,0.3)' }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem' }}>
                      {t.inst.wizardWaiting}
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          {wizardStep === 3 && !wizardConnected && (
            <Button onClick={async () => {
              stopWizardPoll()
              try { await fetch(`/api/evolution/instance/${wizardInstName}`, { method: 'DELETE' }) } catch {}
              fetchInstances()
              setWizardOpen(false)
            }}
              sx={{ color: '#f87171', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
              {t.inst.wizardCancelReg}
            </Button>
          )}
          <Button onClick={() => { stopWizardPoll(); setWizardOpen(false) }} disabled={wizardLoading}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
            {wizardStep === 3 ? t.inst.wizardClose : t.inst.wizardCancel}
          </Button>
          {wizardStep === 1 && (
            <Button onClick={() => setWizardStep(2)} variant="contained"
              sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
              {t.inst.wizardNextBtn}
            </Button>
          )}
          {wizardStep === 2 && (
            <Button onClick={handleWizardCreate} disabled={wizardLoading || !wizardName.trim()} variant="contained"
              startIcon={wizardLoading ? null : (wizardPhone.trim() ? <PhoneAndroidIcon sx={{ fontSize: '17px !important' }} /> : <AddIcon sx={{ fontSize: '17px !important' }} />)}
              sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' } }}>
              {wizardLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{t.inst.wizardCreating}</>
                : wizardPhone.trim() ? t.inst.wizardCreateBtn : t.inst.create}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Pairing code dialog ── */}
      <Dialog open={pairOpen} onClose={() => { setPairOpen(false); setPairCode(null); setPairErr('') }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(34,197,94,0.08) 0%, transparent 55%)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 3, minWidth: 360,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PhoneAndroidIcon sx={{ fontSize: 18, color: '#4ade80' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                Conectar por número de teléfono
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {pairTarget?.name}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '4px !important', pb: 1 }}>
          {!pairCode ? (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Ingresa el número que quieres registrar. WhatsApp generará un código de 8 caracteres que deberás ingresar en la app.
              </Typography>
              <TextField
                label="Número de teléfono"
                placeholder="525595054461"
                size="small"
                value={pairPhone}
                onChange={e => setPairPhone(e.target.value)}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>Con código de país, sin + ni espacios</span>}
                onKeyDown={e => e.key === 'Enter' && handleRequestPairCode()}
                autoFocus
                sx={FIELD_SX}
              />
              {pairErr && (
                <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{pairErr}</Typography>
              )}
            </>
          ) : (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Ingresa este código en WhatsApp → Dispositivos vinculados → Vincular con número de teléfono:
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <Box sx={{
                  px: 3, py: 2, borderRadius: 2,
                  bgcolor: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.3)',
                }}>
                  <Typography sx={{ color: '#4ade80', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '0.18em', fontFamily: 'monospace' }}>
                    {pairCode}
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', textAlign: 'center' }}>
                El código expira en pocos minutos
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          <Button onClick={() => { setPairOpen(false); setPairCode(null) }} sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
            Cerrar
          </Button>
          {!pairCode && (
            <Button onClick={handleRequestPairCode} disabled={pairLoading} variant="contained"
              startIcon={pairLoading ? null : <PhoneAndroidIcon sx={{ fontSize: '17px !important' }} />}
              sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
              {pairLoading ? <CircularProgress size={15} sx={{ color: 'white' }} /> : 'Generar código'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Emulator registration dialog ── */}
      <Dialog open={emuOpen} onClose={() => { if (emuStep !== 'running') { emuEsRef.current?.close(); setEmuOpen(false) } }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)', backgroundImage: 'none',
          border: '1px solid rgba(167,139,250,0.2)', borderRadius: 3, minWidth: 420, maxWidth: 520,
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,#e2e8f0)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.emuMenuLabel}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.35))', fontSize: '0.72rem' }}>
                {t.inst.emuSubtitle}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '4px !important', pb: 1 }}>
          {emuStep === 'idle' && (
            <>
              <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: '0.8rem', lineHeight: 1.5 }}>
                {t.inst.emuIdleDesc}
              </Typography>
              <TextField label={t.inst.emuInstanceNameLabel} size="small" value={emuInst}
                onChange={e => setEmuInst(e.target.value)} sx={{ ...FIELD_SX, mt: 0.5 }} />
              <TextField
                select
                label={t.inst.emuCountryLabel}
                size="small"
                value={emuCountry}
                onChange={e => setEmuCountry(Number(e.target.value))}
                sx={{ ...FIELD_SX, mt: 0.5 }}
                helperText={<span style={{ color: 'var(--text-muted, rgba(255,255,255,0.4))', fontSize: '0.68rem' }}>{t.inst.emuCountryHelper}</span>}
              >
                {SMSFAST_COUNTRIES.map(c => (
                  <MenuItem key={c.value} value={c.value} sx={{ fontSize: '0.85rem' }}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          {emuStep === 'confirming' && emuPreview && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {/* Session activa */}
              {emuPreview.has_active_session && (
                <Box sx={{ bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 1.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <Typography sx={{ fontSize: '0.78rem', color: '#60a5fa', lineHeight: 1.5 }}>
                    <strong>Sesión activa detectada</strong> — se retomará el número {emuPreview.session_phone} desde el paso "{emuPreview.session_step}" sin comprar uno nuevo.
                  </Typography>
                </Box>
              )}

              {/* País seleccionado */}
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 1.5, px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>País</Typography>
                <Typography sx={{ fontSize: '0.85rem', color: 'var(--text,#e2e8f0)', fontWeight: 600, ml: 'auto' }}>
                  {SMSFAST_COUNTRIES.find(c => c.value === emuCountry)?.label || `Código ${emuCountry}`}
                </Typography>
              </Box>

              {/* Balance y costo */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5 }}>Saldo SMSFast</Typography>
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: emuPreview.balance < 0.50 ? '#f87171' : '#34d399' }}>
                    ${emuPreview.balance?.toFixed(2)} USD
                  </Typography>
                </Box>
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5 }}>Costo estimado</Typography>
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
                    ~${emuPreview.estimated_cost?.toFixed(2)} USD
                  </Typography>
                </Box>
              </Box>

              {/* Warnings */}
              {emuPreview.warnings?.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                  {emuPreview.warnings.map((w, i) => (
                    <Box key={i} sx={{ bgcolor: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)', borderRadius: 1.2, px: 1.5, py: 0.8, display: 'flex', gap: 0.8, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '0.75rem', color: '#fb7185' }}>⚠ {w}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Posibles resultados */}
              {!emuPreview.has_active_session && (
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.8 }}>A tener en cuenta</Typography>
                  {[
                    'El número es virtual — Meta puede rechazarlo (~30% de probabilidad)',
                    'Si no llega el OTP en 10 min, se cancela y reembolsa automáticamente',
                    'Si WhatsApp registra pero el número ya tiene cuenta, no hay reembolso',
                  ].map((item, i) => (
                    <Typography key={i} sx={{ fontSize: '0.73rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, display: 'flex', gap: 0.8 }}>
                      · {item}
                    </Typography>
                  ))}
                </Box>
              )}

              {emuPreview.error && (
                <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>Error: {emuPreview.error}</Typography>
              )}
            </Box>
          )}

          {(emuStep === 'running' || emuStep === 'success' || emuStep === 'error' || emuStep === 'done') && (
            <Box sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1.5, p: 1.2, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              {emuLogs.map((log, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
                  <Typography sx={{ fontSize: '0.7rem', color:
                    log.step === 'error'   ? '#f87171' :
                    log.step === 'success' ? '#4ade80' :
                    log.step === 'warn'    ? '#fbbf24' :
                    log.msg?.startsWith('✅') ? '#4ade80' :
                    log.msg?.startsWith('❌') ? '#f87171' :
                    log.msg?.startsWith('⚠️') ? '#fbbf24' :
                    'rgba(255,255,255,0.65)',
                    lineHeight: 1.5, fontFamily: 'monospace',
                  }}>
                    {log.msg}
                  </Typography>
                </Box>
              ))}
              {emuStep === 'running' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.5 }}>
                  <CircularProgress size={11} sx={{ color: '#a78bfa' }} />
                  <Typography sx={{ fontSize: '0.7rem', color: '#a78bfa', fontFamily: 'monospace' }}>en progreso...</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          {emuStep !== 'running' && (
            <Button onClick={() => { emuEsRef.current?.close(); setEmuOpen(false) }}
              sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
              Cerrar
            </Button>
          )}
          {emuStep === 'idle' && (
            <Button variant="contained" onClick={handleEmuPreview} disabled={!emuInst.trim() || emuPreviewLoading}
              sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              {emuPreviewLoading ? t.inst.emuVerifying : t.inst.emuContinue}
            </Button>
          )}
          {emuStep === 'confirming' && (
            <>
              <Button onClick={() => setEmuStep('idle')}
                sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
                Cancelar
              </Button>
              <Button variant="contained" onClick={startEmuRegistration} disabled={!emuPreview?.can_proceed}
                sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
                {emuPreview?.has_active_session ? 'Retomar registro' : 'Confirmar y registrar'}
              </Button>
            </>
          )}
          {(emuStep === 'success' || emuStep === 'done') && (
            <Button variant="contained" onClick={() => { setEmuOpen(false); fetchInstances() }}
              sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Listo ✓
            </Button>
          )}
          {emuStep === 'error' && (
            <Button variant="contained" onClick={() => setEmuStep('idle')}
              sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Reintentar
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── QR dialog ── */}
      <Dialog open={qrOpen} onClose={closeQr} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.09) 0%, transparent 55%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)',
          borderRadius: 3, minWidth: 340,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
      }}>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
                {t.inst.connectTitle}
              </Typography>
              <Typography sx={{ color: 'var(--accent,#60a5fa)', fontSize: '0.73rem', mt: 0.2, fontWeight: 600 }}>
                {qrTarget?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={closeQr} sx={{ color: 'rgba(255,255,255,0.25)', mt: -0.5, mr: -1, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pt: '8px !important', pb: 1 }}>
          {/* Steps */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[t.inst.qrStep1, t.inst.qrStep2, t.inst.qrStep3].map((step, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
                  border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>{i + 1}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)' }}>{step}</Typography>
                {i < 2 && <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem', mx: 0.2 }}>›</Typography>}
              </Box>
            ))}
          </Box>

          {/* QR box */}
          <Box sx={{
            width: 230, height: 230,
            borderRadius: 2.5,
            bgcolor: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: '0 0 0 6px rgba(var(--accent-rgb,59,130,246),0.12), 0 8px 32px rgba(0,0,0,0.4)',
            position: 'relative',
          }}>
            {qrStatus === 'ready' && qrImage
              ? <img src={qrImage} alt="QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, p: 2 }}>
                  <CircularProgress size={32} sx={{ color: qrStatus === 'connecting' ? '#22c55e' : '#3b82f6' }} />
                  <Typography sx={{ color: '#666', fontSize: '0.72rem', textAlign: 'center', lineHeight: 1.4 }}>
                    {qrStatus === 'retrying'
                      ? t.inst.qrRetrying
                      : qrStatus === 'error'
                        ? t.inst.qrError
                        : qrStatus === 'connecting'
                          ? t.inst.qrConnecting
                          : t.inst.qrGenerating}
                  </Typography>
                </Box>
              )
            }
          </Box>

          {/* Retry button — hidden while connecting */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            {qrStatus !== 'connecting' && (
            <Button size="small" startIcon={<RefreshIcon sx={{ fontSize: '14px !important' }} />}
              onClick={() => { if (qrTarget) startQrPoll(qrTarget.name, qrStatus === 'error', qrTarget.provider) }}
              sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', fontSize: '0.72rem',
                '&:hover': { color: 'rgba(255,255,255,0.7)' } }}>
              {qrStatus === 'error' ? t.inst.qrForce : t.inst.qrRetryBtn}
            </Button>
            )}
            {qrStatus === 'error' && (
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,100,100,0.6)', textAlign: 'center', maxWidth: 220 }}>
                {t.inst.qrForceWarn}
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3, pt: 2, justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => { closeQr(); fetchInstances() }} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' },
              textTransform: 'none', fontWeight: 700, fontSize: '0.85rem', borderRadius: 2, px: 5 }}>
            {t.inst.done}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Assign dialog ── */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.07) 0%, var(--card-bg,#161d2e) 60%)',
          border: '1px solid var(--border,rgba(255,255,255,0.08))',
          borderRadius: 3, minWidth: 400, maxWidth: 440,
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
                {t.inst.assignTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.73rem', mt: 0.2 }}>
                {assignTarget?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setAssignOpen(false)} sx={{ color: 'rgba(255,255,255,0.25)', mt: -0.5, mr: -1, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 1 }}>
          {/* Autocomplete search */}
          <TextField
            size="small"
            placeholder={t.inst.searchUser}
            value={assignSearch}
            onChange={e => setAssignSearch(e.target.value)}
            autoFocus
            sx={{
              mb: 1.5, width: '100%',
              '& .MuiOutlinedInput-root': {
                bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, color: 'white', fontSize: '0.85rem',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.22)' },
                '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
              },
              '& input::placeholder': { color: 'rgba(255,255,255,0.3)', opacity: 1 },
            }}
            slotProps={{ input: { startAdornment: <SearchIcon sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 17, mr: 0.8 }} /> } }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, maxHeight: 300, overflowY: 'auto',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 2 },
          }}>
            {/* Sin asignar */}
            {!t.inst.unassigned.toLowerCase().includes(assignSearch.toLowerCase()) ? null : (
              <Box onClick={() => { setAssignUserId(''); setAssignUserName('') }} sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 1.5, py: 1.1, borderRadius: 2, cursor: 'pointer',
                border: assignUserId === ''
                  ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)'
                  : '1px solid transparent',
                bgcolor: assignUserId === ''
                  ? 'rgba(var(--accent-rgb,59,130,246),0.1)'
                  : 'rgba(255,255,255,0.03)',
                transition: 'all 0.15s',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
              }}>
                <Box sx={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  bgcolor: 'rgba(255,255,255,0.05)',
                  border: '1.5px dashed rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <LinkOffIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.25)' }} />
                </Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', fontStyle: 'italic', flex: 1 }}>
                  {t.inst.unassigned}
                </Typography>
                {assignUserId === '' && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'var(--accent,#3b82f6)', boxShadow: '0 0 5px var(--accent,#3b82f6)' }} />}
              </Box>
            )}

            {/* Filtered users */}
            {users
              .filter(u => {
                const name = (u.display_name || u.username || '').toLowerCase()
                return name.includes(assignSearch.toLowerCase())
              })
              .map(u => {
                const uid      = u._id || u.id || u.username
                const selected = assignUserId === uid
                const name     = u.display_name || u.username || ''
                const initials = name[0]?.toUpperCase() || '?'
                const roleColor = u.role === 'admin' ? '#a78bfa' : 'var(--accent,#60a5fa)'
                return (
                  <Box
                    key={uid}
                    onClick={() => { setAssignUserId(uid); setAssignUserName(name) }}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      px: 1.5, py: 1.1, borderRadius: 2, cursor: 'pointer',
                      border: selected
                        ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)'
                        : '1px solid transparent',
                      bgcolor: selected
                        ? 'rgba(var(--accent-rgb,59,130,246),0.1)'
                        : 'rgba(255,255,255,0.03)',
                      transition: 'all 0.15s',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
                    }}
                  >
                    <Box sx={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      bgcolor: `${roleColor === '#a78bfa' ? '#a78bfa' : 'var(--accent,#3b82f6)'}18`,
                      border: `1.5px solid ${roleColor === '#a78bfa' ? '#a78bfa' : 'var(--accent,#3b82f6)'}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography sx={{ fontSize: '0.73rem', fontWeight: 800, color: roleColor }}>
                        {initials}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.83rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </Typography>
                      <Typography sx={{ fontSize: '0.63rem', color: roleColor, opacity: 0.75 }}>
                        {u.role === 'admin' ? t.admin?.admin || 'Admin' : t.admin?.user || 'Agente'}
                      </Typography>
                    </Box>
                    {selected && <Box sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: 'var(--accent,#3b82f6)', boxShadow: '0 0 5px var(--accent,#3b82f6)' }} />}
                  </Box>
                )
              })}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => setAssignOpen(false)}
            sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', fontSize: '0.82rem' }}>
            {t.inst.cancel}
          </Button>
          <Button onClick={handleAssign} disabled={assigning} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
            {assigning ? <CircularProgress size={15} sx={{ color: 'white' }} /> : t.inst.save}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar feedback ── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ content: { sx: {
          bgcolor: 'rgba(22,24,30,0.97)',
          color: 'rgba(255,255,255,0.9)',
          fontWeight: 500,
          fontSize: '0.82rem',
          borderRadius: 2.5,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(12px)',
          px: 2.5, py: 1.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 1, minWidth: 220, textAlign: 'center',
        }}}}
        message={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', width: '100%' }}>
            <CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80', flexShrink: 0 }} />
            <span>{snack.msg}</span>
          </Box>
        }
      />

      {/* ── Delete confirm ── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)}
        slotProps={{ paper: { sx: {
          width: 360, maxWidth: '90vw', borderRadius: 3,
          background: 'var(--card-bg, #161d2e)',
          border: '1px solid rgba(239,68,68,0.22)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}}}>
        <Box sx={{ p: 2.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <WarningAmberIcon sx={{ fontSize: 18, color: '#ef4444' }} />
              </Box>
              <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>
                {t.inst.deleteTitle}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setDeleteTarget(null)} disabled={deleting}
              sx={{ color: 'rgba(255,255,255,0.2)', '&:hover': { color: 'rgba(255,255,255,0.5)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          {/* Instance row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.2, mb: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <SmartphoneIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: '0.88rem', flex: 1 }}>
              {deleteTarget?.name}
            </Typography>
            {deleteTarget?.number && (
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                +{deleteTarget.number}
              </Typography>
            )}
          </Box>

          {/* Warning */}
          <Typography sx={{ color: 'rgba(239,68,68,0.65)', fontSize: '0.75rem', mb: 2.5 }}>
            {t.inst.deleteWarnInst}
          </Typography>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button fullWidth onClick={() => setDeleteTarget(null)} disabled={deleting}
              sx={{ textTransform: 'none', fontSize: '0.82rem', fontWeight: 500, color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, py: 0.9, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.18)' } }}>
              {t.inst.cancel}
            </Button>
            <Button fullWidth onClick={handleDelete} disabled={deleting}
              sx={{ textTransform: 'none', fontSize: '0.82rem', fontWeight: 700, color: '#fff', bgcolor: '#ef4444', borderRadius: 2, py: 0.9, gap: 0.5, '&:hover': { bgcolor: '#dc2626' }, '&:disabled': { bgcolor: 'rgba(239,68,68,0.4)', color: 'rgba(255,255,255,0.5)' } }}>
              {deleting ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <><DeleteForeverIcon sx={{ fontSize: 15 }} />{t.inst.delete}</>}
            </Button>
          </Box>
        </Box>
      </Dialog>

      {/* ── wwebjs session dialog ── */}
      <Dialog open={wahaOpen} onClose={() => !wahaLoading && setWahaOpen(false)} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(96,165,250,0.1) 0%, var(--card-bg,#161d2e) 55%)',
          border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'Connect WhatsApp Number' : 'Conectar Número WhatsApp'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {lang === 'en' ? 'Link a number via QR code (whatsapp-web.js)' : 'Vincula un número vía código QR'}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '4px !important', px: 3 }}>
          {wahaScanned && !wahaConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={40} thickness={3} sx={{ color: '#25d366' }} />
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem' }}>
                {lang === 'en' ? 'QR scanned — authenticating…' : 'QR escaneado — autenticando…'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'WhatsApp is verifying the session on your phone'
                  : 'WhatsApp está verificando la sesión en tu teléfono'}
              </Typography>
            </Box>
          ) : wahaConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                {lang === 'en' ? 'Session connected!' : '¡Sesión conectada!'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                {lang === 'en' ? 'Assign it to a user from the panel.' : 'Asígnala a un usuario desde el panel.'}
              </Typography>
            </Box>
          ) : wahaQr ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 0.5 }}>
              <Box component="img" src={wahaQr} alt="QR"
                sx={{ width: 220, height: 220, borderRadius: 2, border: '2px solid #334155', bgcolor: '#fff', p: 1 }} />
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'Scan with WhatsApp → Settings → Linked Devices → Link a Device'
                  : 'Escanea con WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 2, bgcolor: '#1e3a5f', border: '1px solid #3b82f6' }}>
                <CircularProgress size={12} sx={{ color: '#60a5fa' }} />
                <Typography sx={{ color: '#60a5fa', fontSize: '0.72rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Waiting for scan…' : 'Esperando escaneo…'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField label={lang === 'en' ? 'Session name' : 'Nombre de sesión'} value={wahaName}
                onChange={e => setWahaName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="mi-sesion-1" size="small" fullWidth autoFocus sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wahaLoading && wahaName.trim() && handleWahaCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'Lowercase letters, numbers and dashes only' : 'Solo minúsculas, números y guiones'}
                </span>} />
              {wahaErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: '#450a0a', border: '1px solid #ef4444' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wahaErr}</Typography>
                </Box>
              )}
              {wahaLoading && !wahaErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, p: 1.5, borderRadius: 1.5, bgcolor: '#1c2333', border: '1px solid #334155' }}>
                  <CircularProgress size={14} sx={{ color: '#60a5fa' }} />
                  <Typography sx={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600 }}>
                    {lang === 'en' ? 'Starting session, generating QR…' : 'Iniciando sesión, generando QR…'}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          {!(wahaScanned && !wahaConnected) && (
            <Button onClick={wahaClose}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
              {wahaConnected ? (lang === 'en' ? 'Close' : 'Cerrar') : (lang === 'en' ? 'Cancel' : 'Cancelar')}
            </Button>
          )}
          {!wahaQr && !wahaConnected && !wahaScanned && (
            <Button
              onClick={handleWahaCreate}
              disabled={wahaLoading || !wahaName.trim()}
              variant="contained"
              sx={{
                bgcolor: '#3b82f6', textTransform: 'none', fontWeight: 700,
                fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
                '&:hover': { bgcolor: '#2563eb' },
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
              }}
            >
              {wahaLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Creating…' : 'Creando…'}</>
                : (lang === 'en' ? 'Create' : 'Crear')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Wasender create session dialog ── */}
      <Dialog open={wsOpen} onClose={() => !wsLoading && wsClose()} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(167,139,250,0.1) 0%, var(--card-bg,#161d2e) 55%)',
          border: '1px solid rgba(167,139,250,0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(167,139,250,0.18)',
              border: '1px solid rgba(167,139,250,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: '#a78bfa' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'New Wasender Session' : 'Nueva Sesión Wasender'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {lang === 'en' ? 'Link a WhatsApp number via WasenderAPI' : 'Vincula un número de WhatsApp vía WasenderAPI'}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '4px !important', px: 3 }}>
          {wsScanned && !wsConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={40} thickness={3} sx={{ color: '#25d366' }} />
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem' }}>
                {lang === 'en' ? 'QR scanned — authenticating…' : 'QR escaneado — autenticando…'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'WhatsApp is verifying the session on your phone'
                  : 'WhatsApp está verificando la sesión en tu teléfono'}
              </Typography>
            </Box>
          ) : wsConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                {lang === 'en' ? 'Session connected!' : '¡Sesión conectada!'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                {lang === 'en' ? 'Assign it to a user from the panel.' : 'Asígnala a un usuario desde el panel.'}
              </Typography>
            </Box>
          ) : wsQr ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 0.5 }}>
              <Box component="img" src={wsQr} alt="QR"
                sx={{ width: 220, height: 220, borderRadius: 2, border: '2px solid #334155', bgcolor: '#fff', p: 1 }} />
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'Scan with WhatsApp → Settings → Linked Devices → Link a Device'
                  : 'Escanea con WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 2,
                bgcolor: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }}>
                <CircularProgress size={12} sx={{ color: '#a78bfa' }} />
                <Typography sx={{ color: '#a78bfa', fontSize: '0.72rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Waiting for scan…' : 'Esperando escaneo…'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField label={lang === 'en' ? 'Session name' : 'Nombre de sesión'} value={wsName}
                onChange={e => setWsName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="ws-mexico-1" size="small" fullWidth autoFocus sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wsLoading && wsName.trim() && wsPhone.trim() && handleWsCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'Lowercase letters, numbers and dashes only' : 'Solo minúsculas, números y guiones'}
                </span>} />
              <TextField label={lang === 'en' ? 'WhatsApp phone number' : 'Número de WhatsApp'} value={wsPhone}
                onChange={e => setWsPhone(e.target.value.replace(/[^+\d]/g, ''))}
                placeholder="+521234567890" size="small" fullWidth sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wsLoading && wsName.trim() && wsPhone.trim() && handleWsCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'International format with country code' : 'Formato internacional con código de país'}
                </span>} />
              {wsErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1,
                  borderRadius: 1.5, bgcolor: '#450a0a', border: '1px solid #ef4444' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wsErr}</Typography>
                </Box>
              )}
              {wsLoading && !wsErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, p: 1.5,
                  borderRadius: 1.5, bgcolor: '#1c2333', border: '1px solid #334155' }}>
                  <CircularProgress size={14} sx={{ color: '#a78bfa' }} />
                  <Typography sx={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600 }}>
                    {lang === 'en' ? 'Creating session…' : 'Creando sesión…'}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          {!(wsScanned && !wsConnected) && (
            <Button onClick={wsClose}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
              {wsConnected ? (lang === 'en' ? 'Close' : 'Cerrar') : (lang === 'en' ? 'Cancel' : 'Cancelar')}
            </Button>
          )}
          {!wsQr && !wsConnected && !wsScanned && (
            <Button onClick={handleWsCreate} disabled={wsLoading || !wsName.trim() || !wsPhone.trim()} variant="contained"
              sx={{
                bgcolor: '#7c3aed', textTransform: 'none', fontWeight: 700,
                fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
                '&:hover': { bgcolor: '#6d28d9' },
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
              }}>
              {wsLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Creating…' : 'Creando…'}</>
                : (lang === 'en' ? 'Create' : 'Crear')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

    </Box>
  )
}
