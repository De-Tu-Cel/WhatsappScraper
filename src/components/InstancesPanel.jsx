'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
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
  open:         '#22c55e',
  connected:    '#22c55e',
  connecting:   '#f59e0b',
  close:        '#ef4444',
  disconnected: '#ef4444',
  unknown:      'rgba(255,255,255,0.2)',
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

const STATUS_LABEL_ES = { open: 'Conectada', connected: 'Conectada', connecting: 'Conectando', close: 'Desconectada', disconnected: 'Desconectada', unknown: 'Desconocida' }
const STATUS_LABEL_EN = { open: 'Connected', connected: 'Connected', connecting: 'Connecting', close: 'Disconnected', disconnected: 'Disconnected', unknown: 'Unknown' }

const DISCONNECT_LABEL_ES = { banned: 'Baneado por WhatsApp', logged_out: 'Cerró sesión', conflict: 'Conflicto de dispositivo', multidevice: 'Conflicto multi-dispositivo', server_error: 'Error interno', restart: 'Requiere reinicio', replaced: 'Sesión reemplazada', timeout: 'Timeout de conexión', closed: 'Conexión cerrada', disconnected: 'Desconectada' }
const DISCONNECT_LABEL_EN = { banned: 'Banned by WhatsApp', logged_out: 'Logged out', conflict: 'Device conflict', multidevice: 'Multi-device conflict', server_error: 'Internal error', restart: 'Restart required', replaced: 'Session replaced', timeout: 'Connection timeout', closed: 'Connection closed', disconnected: 'Disconnected' }

// ── InstanceRow ──────────────────────────────────────────────────────────────
function InstanceRow({ inst, health, onQr, onEditNumber, onRemove }) {
  const { t, lang } = useLang()
  const [hover, setHover] = useState(false)
  const status = inst.live_status || 'unknown'
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
  const isConnected = ['open', 'connected'].includes(status)
  const statusLabel = (lang === 'en' ? STATUS_LABEL_EN : STATUS_LABEL_ES)[status] ?? (lang === 'en' ? 'Unknown' : 'Desconocida')
  const REASON_COLOR = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c' }
  const disconnectColor = inst.disconnect_reason ? (REASON_COLOR[inst.disconnect_reason] ?? '#94a3b8') : color
  const displayColor = isConnected ? color : disconnectColor
  const reasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
  const displayLabel = !isConnected && reasonLabel ? reasonLabel : statusLabel
  const uptime = health?.uptime_pct ?? null
  const uptimeColor = uptime === null ? '#64748b' : uptime >= 90 ? '#4ade80' : uptime >= 60 ? '#fbbf24' : '#f87171'
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
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: displayColor, flexShrink: 0,
        boxShadow: isConnected ? `0 0 6px ${displayColor}aa` : 'none' }} />
      {/* Name + number */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.label || inst.name}</Typography>
          {uptime !== null && (
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: uptimeColor,
              bgcolor: `${uptimeColor}18`, px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0 }}>
              {uptime}%
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1.2 }}>
          {inst.number ? `+${inst.number}` : t.inst.noNumber}
        </Typography>
      </Box>
      {/* Right side: status label (resting) or action icons (hover) */}
      {hover ? (
        <Box sx={{ display: 'flex', gap: 0.2, flexShrink: 0 }}>
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
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: displayColor, flexShrink: 0, letterSpacing: '0.01em', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel}
        </Typography>
      )}
    </Box>
  )
}

// ── UserCard ─────────────────────────────────────────────────────────────────
function UserCard({ user, instances, health, onAddSlot, onQr, onEditNumber, onRemove }) {
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
  return (
    <Box sx={{
      bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
      display: 'flex', flexDirection: 'column', gap: 0,
      border: '1px solid var(--border)',
      transition: 'border-color 0.2s',
      '&:hover': { borderColor: 'var(--text-muted)' },
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

      <Divider sx={{ borderColor: 'var(--border)', mb: 1.2 }} />

      {/* Instance rows (only when populated) */}
      {instances.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, mb: 1.2 }}>
          {instances.map(inst => (
            <InstanceRow key={inst.name} inst={inst} health={health[inst.name]} onQr={onQr} onEditNumber={onEditNumber} onRemove={onRemove} />
          ))}
        </Box>
      )}

      {/* Capacity bar — 5 slot dots + add button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1,
        pt: instances.length > 0 ? 1 : 0,
        borderTop: instances.length > 0 ? '1px solid var(--border)' : 'none',
        mt: instances.length === 0 ? 0.5 : 0,
      }}>
        {/* 5 dots: filled = instance status color, empty = dashed circle */}
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
                    boxShadow: isConn ? `0 0 5px ${color}99` : 'none',
                    cursor: 'default',
                  }} />
                </Tooltip>
              )
            }
            return (
              <Tooltip key={i} title={t.inst.addSlot} placement="top">
                <Box onClick={onAddSlot} sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  border: '1.5px dashed var(--text-muted)', cursor: 'pointer',
                  transition: 'border-color 0.15s',
                  '&:hover': { borderColor: roleColor, bgcolor: avatarBg },
                }} />
              </Tooltip>
            )
          })}
        </Box>

        {/* Right side: rotation chip OR add button */}
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
  return (
    <Box sx={{ px: 1.5, pb: 1.5, pt: 1.5,
      borderTop: '1px solid rgba(59,130,246,0.15)',
      bgcolor: 'rgba(59,130,246,0.04)' }}>

      <Typography sx={{ fontSize: '0.63rem', color: 'var(--text-muted)',
        mb: 1.2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {lang === 'en' ? 'Assign to' : 'Asignar a'}
      </Typography>

      {/* Search — only shown when > 4 users */}
      {users.length > 4 && (
        <Box component="input"
          placeholder={t.inst.searchUser}
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ display: 'block', width: '100%', boxSizing: 'border-box', mb: 1.2,
            bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
            borderRadius: 1.5, py: 0.5, px: 1.2, color: 'var(--text)', fontSize: '0.75rem',
            outline: 'none', fontFamily: 'inherit',
            '&:focus': { borderColor: 'rgba(59,130,246,0.5)' },
          }}
        />
      )}

      {/* User avatars — scrollable if tall */}
      <Box sx={{ display: 'flex', gap: 1.2, flexWrap: 'wrap',
        maxHeight: 154, overflowY: 'auto', pt: '4px',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 4 },
      }}>
        {filtered.map(u => {
          const uid    = u._id || u.id || u.username
          const uAdmin = u.role === 'admin'
          const uColor  = uAdmin ? '#a78bfa' : '#60a5fa'
          const uBg     = uAdmin ? 'rgba(167,139,250,0.18)' : 'rgba(59,130,246,0.18)'
          const uBorder = uAdmin ? 'rgba(167,139,250,0.55)' : 'rgba(59,130,246,0.5)'
          const uInitials = (u.display_name || u.username || '?').slice(0, 2).toUpperCase()
          const uSlots = instances.filter(i => i.assigned_to === uid).length
          const isFull = uSlots >= 5
          return (
            <Tooltip key={uid}
              title={isFull
                ? (lang === 'en' ? 'Full — 5/5 slots used' : 'Lleno — 5/5 slots usados')
                : `${u.display_name || u.username} · ${uSlots}/5`}
              placement="top">
              <Box onClick={() => !isFull && onAssign(instanceName, u)}
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
                  cursor: isFull ? 'not-allowed' : 'pointer',
                  opacity: isFull ? 0.4 : 1, transition: 'transform 0.15s',
                  '&:hover': isFull ? {} : { transform: 'translateY(-2px)' } }}>
                <Box sx={{ position: 'relative' }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 1.5,
                    bgcolor: uBg, border: `1.5px solid ${uBorder}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'border-color 0.15s',
                    '&:hover': isFull ? {} : { borderColor: uColor, boxShadow: `0 0 0 2px ${uBg}` } }}>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: uColor }}>
                      {uInitials}
                    </Typography>
                  </Box>
                  {/* "Full" badge */}
                  {isFull && (
                    <Box sx={{ position: 'absolute', top: -5, right: -5, borderRadius: 1,
                      bgcolor: '#ef4444', px: 0.4, py: 0.1,
                      border: '1.5px solid var(--card-bg,#0d1117)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ fontSize: '0.42rem', fontWeight: 900, color: 'white', lineHeight: 1 }}>
                        5/5
                      </Typography>
                    </Box>
                  )}
                </Box>
                <Typography sx={{ fontSize: '0.6rem', color: 'var(--text-muted)',
                  maxWidth: 52, textAlign: 'center', lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.display_name || u.username}
                </Typography>
              </Box>
            </Tooltip>
          )
        })}
        {filtered.length === 0 && (
          <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', py: 0.5 }}>
            {t.inst.noResults}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function InstancesPanel() {
  const { t, lang } = useLang()
  const [instances,    setInstances]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [users,        setUsers]        = useState([])
  const [health,       setHealth]       = useState({})  // { [instanceName]: { uptime_pct, last_event, last_ts, last_reason } }
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

  // ── Card menu (kept for assign dialog compatibility) ──
  const [menuAnchor,   setMenuAnchor]   = useState(null)
  const [menuInst,     setMenuInst]     = useState(null)

  // ── Pick instance dialog ──
  const [pickOpen,        setPickOpen]        = useState(false)
  const [pickTargetUser,  setPickTargetUser]  = useState(null)
  const [unassignedOpen,  setUnassignedOpen]  = useState(true)
  const [expandedAssign,  setExpandedAssign]  = useState(null)

  const fetchInstances = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/instances', { headers: { 'x-user-token': token() }, cache: 'no-store' })
      if (r.ok) setInstances(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/evolution/instances/health', { headers: { 'x-user-token': token() } })
      if (r.ok) setHealth(await r.json())
    } catch {}
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/instances?action=sync', { method: 'POST', headers: { 'x-user-token': token() } })
      await fetchInstances()
    } catch {}
    finally { setSyncing(false) }
  }, [fetchInstances])

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
  }, [])

  useEffect(() => { fetchInstances(); fetchUsers(); fetchHealth() }, [fetchInstances, fetchUsers, fetchHealth])

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
  const fetchQrOnce = useCallback(async (name) => {
    try {
      const r = await fetch(`/api/evolution/instance/${name}?type=qr`)
      if (!r.ok) return false
      const d = await r.json()
      const b64 = d.base64 || d.qrcode?.base64 || d.qr?.base64
      if (b64) {
        setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
        setQrStatus('ready')
        return true
      }
    } catch {}
    return false
  }, [])

  const startQrPoll = useCallback(async (name, withLogout = false) => {
    if (qrPollRef.current) clearTimeout(qrPollRef.current)
    setQrImage(null); setQrStatus(withLogout ? 'retrying' : 'loading')

    if (withLogout) {
      try {
        await fetch(`/api/evolution/instance/${name}?action=logout`, { method: 'POST' })
      } catch {}
      await new Promise(r => setTimeout(r, 700))
      setQrStatus('loading')
    }

    let attempts = 0
    const poll = async () => {
      attempts++
      const ok = await fetchQrOnce(name)
      if (ok) return
      if (attempts >= 10) { setQrStatus('error'); return }
      qrPollRef.current = setTimeout(poll, 1500)
    }
    poll()
  }, [fetchQrOnce])

  function closeQr() {
    if (qrPollRef.current)   clearTimeout(qrPollRef.current)
    if (connPollRef.current) clearInterval(connPollRef.current)
    setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
  }

  const startConnPoll = useCallback((name) => {
    if (connPollRef.current) clearInterval(connPollRef.current)
    let firstPoll = true
    let prevState = ''
    connPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/evolution/instance/${name}`)
        if (!r.ok) return
        const d = await r.json()
        const state = d?.instance?.state || d?.state || ''
        if (firstPoll) {
          firstPoll = false
          prevState = state
          return
        }
        const isConnected = ['open', 'connected'].includes(state)
        const wasConnected = ['open', 'connected'].includes(prevState)
        prevState = state
        if (isConnected && !wasConnected) {
          if (connPollRef.current) clearInterval(connPollRef.current)
          if (qrPollRef.current)   clearTimeout(qrPollRef.current)
          setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
          fetchInstances()
        }
      } catch {}
    }, 3000)
  }, [fetchInstances])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function closeMenu() { setMenuAnchor(null); setMenuInst(null) }

  function handleQrClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setQrTarget(inst); setQrOpen(true)
    startQrPoll(inst.name)
    startConnPoll(inst.name)
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
    setPairLoading(true); setPairErr(''); setPairCode(null)
    try {
      const r = await fetch(`/api/evolution/instance/${pairTarget?.name}?action=pairing-code`, {
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

  async function handlePickAssign(instanceName) {
    if (!pickTargetUser) return
    const userId = pickTargetUser._id || pickTargetUser.id || pickTargetUser.username
    const userName = pickTargetUser.display_name || pickTargetUser.username || ''
    await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    setPickOpen(false)
    fetchInstances()
  }

  async function handleInlineAssign(instanceName, user) {
    const userId   = user._id || user.id || user.username
    const userName = user.display_name || user.username || ''
    const r = await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setSnack({ open: true, msg: d.detail || (lang === 'en' ? 'Could not assign instance' : 'No se pudo asignar la instancia') })
      return
    }
    setExpandedAssign(null)
    fetchInstances()
    setSnack({ open: true, msg: `${instanceName} → ${userName}` })
  }

  async function handleQuickUnassign(inst) {
    await fetch(`/api/instances/${inst.name}?action=unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({}),
    })
    fetchInstances()
    setSnack({ open: true, msg: `${inst.name} ${t.inst.quickUnassignDone}` })
  }

  const connected = instances.filter(i => ['open', 'connected'].includes(i.live_status)).length

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
            <Chip label={`${users.length} ${t.inst.statUsers}`} size="small" sx={STAT_CHIP_SX} />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <Tooltip title={t.inst.refresh}>
            <IconButton size="small" onClick={handleSync} disabled={syncing}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text)' } }}>
              {syncing ? <CircularProgress size={16} sx={{ color: 'var(--text-muted)' }} />
                : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={openWizard}
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' },
              fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, textTransform: 'none', px: 2 }}>
            {t.inst.newBtn}
          </Button>
        </Box>
      </Box>

      {/* User cards grid + unassigned accordion */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pr: 0.5 }}>
        {loading ? (
          <Box>
            {/* ── User cards grid ── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2, mb: 3 }}>
              {(skeletonCounts.current.users.length ? skeletonCounts.current.users : [2, 0, 0]).map((rowCount, i) => (
                <Box key={i} sx={{
                  bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
                  border: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', gap: 0,
                }}>
                  {/* Header: avatar + name/role + slot counter */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                    <Skeleton variant="rounded" width={38} height={38} sx={{ borderRadius: 2, bgcolor: 'var(--border)', flexShrink: 0 }} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="50%" height={15} sx={{ bgcolor: 'var(--border)', mb: 0.4 }} />
                      <Skeleton variant="text" width="30%" height={12} sx={{ bgcolor: 'var(--border)' }} />
                    </Box>
                    <Skeleton variant="rounded" width={28} height={18} sx={{ borderRadius: 1, bgcolor: 'var(--border)' }} />
                  </Box>
                  {/* Instance rows */}
                  {rowCount > 0 ? [...Array(rowCount)].map((_, r) => (
                    <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.85,
                      borderRadius: 1.5, mb: 0.5,
                      bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid transparent' }}>
                      <Skeleton variant="circular" width={8} height={8} sx={{ bgcolor: 'var(--border)', flexShrink: 0 }} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width="45%" height={13} sx={{ bgcolor: 'var(--border)', mb: 0.2 }} />
                        <Skeleton variant="text" width="60%" height={11} sx={{ bgcolor: 'var(--border)' }} />
                      </Box>
                      <Skeleton variant="rounded" width={70} height={20} sx={{ borderRadius: 1, bgcolor: 'var(--border)' }} />
                    </Box>
                  )) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2 }}>
                      <Skeleton variant="text" width="40%" height={13} sx={{ bgcolor: 'var(--border)' }} />
                    </Box>
                  )}
                  {/* Slot dots footer */}
                  <Box sx={{ display: 'flex', gap: 0.6, mt: 1.5, pt: 1, borderTop: '1px solid var(--border)' }}>
                    {[...Array(5)].map((_, d) => (
                      <Skeleton key={d} variant="circular" width={10} height={10}
                        sx={{ bgcolor: d < rowCount ? 'rgba(34,197,94,0.25)' : 'var(--border)' }} />
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>

            {/* ── Unassigned accordion ── */}
            <Box sx={{
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: 3,
              bgcolor: 'rgba(245,158,11,0.03)', overflow: 'hidden',
            }}>
              {/* Accordion header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.4 }}>
                <Skeleton variant="circular" width={10} height={10} sx={{ bgcolor: 'rgba(245,158,11,0.3)' }} />
                <Skeleton variant="text" width={90} height={16} sx={{ bgcolor: 'var(--border)' }} />
                <Box sx={{ flex: 1 }} />
                <Skeleton variant="rounded" width={140} height={20} sx={{ borderRadius: 1, bgcolor: 'var(--border)' }} />
                <Skeleton variant="circular" width={18} height={18} sx={{ bgcolor: 'var(--border)' }} />
              </Box>
              {/* Unassigned cards grid */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5, p: 2, pt: 0.5 }}>
                {[...Array(skeletonCounts.current.unassigned || 6)].map((_, i) => (
                  <Box key={i} sx={{
                    display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.9,
                    borderRadius: 1.5, bgcolor: 'var(--card-bg)',
                    border: '1px solid var(--border)',
                  }}>
                    <Skeleton variant="circular" width={8} height={8} sx={{ bgcolor: 'var(--border)', flexShrink: 0 }} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="70%" height={12} sx={{ bgcolor: 'var(--border)', mb: 0.2 }} />
                      <Skeleton variant="text" width="55%" height={10} sx={{ bgcolor: 'var(--border)' }} />
                    </Box>
                    <Skeleton variant="rounded" width={72} height={22} sx={{ borderRadius: 1, bgcolor: 'var(--border)' }} />
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        ) : (
          <>
            {/* User grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 2, mb: 3 }}>
              {users.map(user => {
                const uid = user._id || user.id || user.username
                const userInsts = instances.filter(i => i.assigned_to === uid)
                return (
                  <UserCard
                    key={uid}
                    user={user}
                    instances={userInsts}
                    health={health}
                    onAddSlot={() => openPickForUser(user)}
                    onQr={inst => handleQrClick(inst)}
                    onEditNumber={inst => handleEditNumberClick(inst)}
                    onRemove={handleQuickUnassign}
                  />
                )
              })}
            </Box>

            {/* Unassigned section */}
            {(() => {
              const unassigned = instances.filter(i => !i.assigned_to)
              if (unassigned.length === 0) return null
              return (
                <Box sx={{ border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2.5, overflow: 'hidden',
                  bgcolor: 'rgba(245,158,11,0.03)' }}>
                  {/* Header */}
                  <Box onClick={() => setUnassignedOpen(p => !p)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.4, cursor: 'pointer',
                      '&:hover': { bgcolor: 'var(--item-hover)' } }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b', flexShrink: 0,
                      boxShadow: '0 0 6px #f59e0b88' }} />
                    <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 600, flex: 1 }}>
                      {t.inst.unassigned}
                    </Typography>
                    <Typography sx={{ fontSize: '0.67rem', color: 'rgba(245,158,11,0.6)', mr: 0.5 }}>
                      {unassigned.length === 1
                        ? (lang === 'en' ? '1 instance needs a user' : '1 instancia sin usuario')
                        : (lang === 'en' ? `${unassigned.length} instances need a user` : `${unassigned.length} instancias sin usuario`)}
                    </Typography>
                    <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'var(--text-muted)',
                      transform: unassignedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </Box>

                  {/* Instance list */}
                  {unassignedOpen && (
                    <Box sx={{ px: 1.5, pt: 1.5, pb: 1.5,
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 0.8,
                      borderTop: '1px solid rgba(245,158,11,0.12)' }}>
                      {unassigned.map(inst => {
                        const isExp = expandedAssign === inst.name
                        const status = inst.live_status || 'unknown'
                        const color  = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                        const isConn = ['open','connected'].includes(status)
                        const _REASON_COLOR = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c' }
                        const instDotColor = !isConn && inst.disconnect_reason ? (_REASON_COLOR[inst.disconnect_reason] ?? '#94a3b8') : color
                        const instReasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
                        const instHealth = health[inst.name]
                        const instUptime = instHealth?.uptime_pct ?? null
                        const instUptimeColor = instUptime === null ? '#64748b' : instUptime >= 90 ? '#4ade80' : instUptime >= 60 ? '#fbbf24' : '#f87171'
                        return (
                          <Box key={inst.name} sx={{ border: '1px solid var(--border)',
                            borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--card-bg)',
                            transition: 'border-color 0.15s',
                            ...(isExp && { borderColor: 'rgba(59,130,246,0.3)' }) }}>

                            {/* Instance row */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 1.5, py: 1.1 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: instDotColor, flexShrink: 0,
                                boxShadow: isConn ? `0 0 5px ${instDotColor}88` : 'none' }} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {inst.label || inst.name}
                                  </Typography>
                                  {instUptime !== null && (
                                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: instUptimeColor,
                                      bgcolor: `${instUptimeColor}18`, px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0 }}>
                                      {instUptime}%
                                    </Typography>
                                  )}
                                </Box>
                                <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                  {inst.number ? `+${inst.number}` : t.inst.noNumber}
                                </Typography>
                                {!isConn && instReasonLabel && (
                                  <Typography sx={{ fontSize: '0.62rem', color: instDotColor, lineHeight: 1.2, mt: 0.2 }}>
                                    {instReasonLabel}
                                  </Typography>
                                )}
                              </Box>
                              {/* Actions */}
                              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                                {!isExp ? (
                                  <Button size="small" onClick={e => { e.stopPropagation(); setExpandedAssign(inst.name) }}
                                    endIcon={<KeyboardArrowDownIcon sx={{ fontSize: '14px !important' }} />}
                                    sx={{ fontSize: '0.72rem', textTransform: 'none', py: 0.35, px: 1, borderRadius: 1.5,
                                      color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)',
                                      '&:hover': { bgcolor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.5)' } }}>
                                    {t.inst.assignUser}
                                  </Button>
                                ) : (
                                  <IconButton size="small" onClick={e => { e.stopPropagation(); setExpandedAssign(null) }}
                                    sx={{ color: 'var(--text-muted)', p: 0.4, '&:hover': { color: 'var(--text)' } }}>
                                    <CloseIcon sx={{ fontSize: 14 }} />
                                  </IconButton>
                                )}
                                <Tooltip title={lang === 'en' ? 'Edit phone number' : 'Editar número'}>
                                  <IconButton size="small" onClick={() => handleEditNumberClick(inst)}
                                    sx={{ color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 1.5, p: 0.5,
                                      '&:hover': { bgcolor: 'rgba(167,139,250,0.1)' } }}>
                                    <EditIcon sx={{ fontSize: 13 }} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title={t.inst.delete}>
                                  <IconButton size="small" onClick={() => handleDeleteClick(inst)}
                                    sx={{ color: '#f87171', border: '1px solid rgba(248,113,133,0.2)', borderRadius: 1.5, p: 0.5,
                                      '&:hover': { bgcolor: 'rgba(248,113,133,0.1)' } }}>
                                    <DeleteForeverIcon sx={{ fontSize: 13 }} />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            </Box>

                            {/* Inline user picker */}
                            {isExp && (
                              <InlineUserPicker
                                instanceName={inst.name}
                                users={users}
                                instances={instances}
                                onAssign={handleInlineAssign}
                                t={t}
                                lang={lang}
                              />
                            )}
                          </Box>
                        )
                      })}
                    </Box>
                  )}
                </Box>
              )
            })()}
          </>
        )}
      </Box>

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
            InputProps={{
              startAdornment: (
                <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.88rem', mr: 0.5, userSelect: 'none' }}>+</Typography>
              ),
            }}
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
      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)',
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.08) 0%, var(--card-bg,#161d2e) 55%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
          borderRadius: 3, minWidth: 360, maxWidth: 440,
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.97rem' }}>
                {t.inst.assignTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', mt: 0.2 }}>
                {pickTargetUser?.display_name || pickTargetUser?.username}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setPickOpen(false)}
              sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: 'white' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '4px !important', pb: 1 }}>
          {(() => {
            const unassigned = instances.filter(i => !i.assigned_to)
            if (unassigned.length === 0)
              return (
                <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', py: 2, textAlign: 'center' }}>
                  {t.inst.noUnassigned}
                </Typography>
              )
            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, maxHeight: 320, overflowY: 'auto' }}>
                {unassigned.map(inst => {
                  const status = inst.live_status || 'unknown'
                  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                  return (
                    <Box key={inst.name} onClick={() => handlePickAssign(inst.name)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.1,
                        borderRadius: 2, cursor: 'pointer', border: '1px solid transparent',
                        bgcolor: 'rgba(255,255,255,0.03)',
                        '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)',
                          borderColor: 'rgba(var(--accent-rgb,59,130,246),0.25)' } }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: 'var(--text)', fontSize: '0.83rem', fontWeight: 600 }}>{inst.label || inst.name}</Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.67rem', fontFamily: 'monospace' }}>
                          {inst.number ? `+${inst.number}` : 'Sin número'}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.65rem', color, fontWeight: 600, flexShrink: 0 }}>
                        {['open', 'connected'].includes(status) ? t.inst.statusConnected : status === 'close' ? t.inst.statusDisconnected : t.inst.statusUnknown}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            )
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => setPickOpen(false)}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem' }}>
            Cancelar
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
                  <CircularProgress size={32} sx={{ color: '#3b82f6' }} />
                  <Typography sx={{ color: '#666', fontSize: '0.72rem', textAlign: 'center', lineHeight: 1.4 }}>
                    {qrStatus === 'retrying'
                      ? t.inst.qrRetrying
                      : qrStatus === 'error'
                        ? t.inst.qrError
                        : t.inst.qrGenerating}
                  </Typography>
                </Box>
              )
            }
          </Box>

          {/* Retry button */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<RefreshIcon sx={{ fontSize: '14px !important' }} />}
              onClick={() => { if (qrTarget) startQrPoll(qrTarget.name, qrStatus === 'error') }}
              sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', fontSize: '0.72rem',
                '&:hover': { color: 'rgba(255,255,255,0.7)' } }}>
              {qrStatus === 'error' ? t.inst.qrForce : t.inst.qrRetryBtn}
            </Button>
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

    </Box>
  )
}
