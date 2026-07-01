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
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import QrCodeIcon from '@mui/icons-material/QrCode'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import LinkOffIcon from '@mui/icons-material/LinkOff'
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
const STATUS_LABEL = {
  open:         'Conectado',
  connected:    'Conectado',
  connecting:   'Conectando',
  close:        'Desconectado',
  disconnected: 'Desconectado',
  unknown:      'Desconocido',
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
  '& input': { color: 'white' },
  '& label': { color: 'rgba(255,255,255,0.4)' },
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

function StatusDot({ status, size = 10 }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
  return (
    <Box sx={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      bgcolor: color,
      boxShadow: color !== STATUS_COLOR.unknown ? `0 0 6px ${color}88` : 'none',
    }} />
  )
}

function InstanceCard({ inst, onMenu }) {
  const status = inst.live_status || 'unknown'
  const color  = STATUS_COLOR[status] ?? STATUS_COLOR.unknown

  return (
    <Box sx={{
      bgcolor: 'var(--card-bg)',
      border: '1px solid var(--border)',
      borderRadius: 3,
      p: 2.5,
      display: 'flex', flexDirection: 'column', gap: 1.5,
      position: 'relative',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:hover': {
        borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      },
    }}>
      {/* Top row: icon + name + menu */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        {/* WA Avatar */}
        <Box sx={{
          width: 48, height: 48, borderRadius: 2, flexShrink: 0,
          bgcolor: `${color}18`,
          border: `1.5px solid ${color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <PhoneAndroidIcon sx={{ color, fontSize: 22 }} />
        </Box>

        {/* Name + number */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            color: 'var(--text)', fontWeight: 700,
            fontSize: '0.95rem', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {inst.name}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', mt: 0.3 }}>
            {inst.number || 'Sin número'}
          </Typography>
        </Box>

        {/* ⋮ menu */}
        <IconButton
          size="small"
          onClick={e => onMenu(e, inst)}
          sx={{ color: 'var(--text-muted)', flexShrink: 0, mt: -0.5, mr: -0.5,
            '&:hover': { color: 'var(--text)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)' } }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Status chip */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <StatusDot status={status} size={8} />
        <Typography sx={{ color, fontSize: '0.72rem', fontWeight: 600 }}>
          {STATUS_LABEL[status] ?? 'Desconocido'}
        </Typography>
      </Box>

      {/* Divider */}
      <Box sx={{ borderTop: '1px solid var(--border)' }} />

      {/* Footer: assigned user + date */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {inst.assigned_name ? (
          <Chip
            label={inst.assigned_name}
            size="small"
            sx={{
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
              color: 'var(--accent,#60a5fa)',
              fontSize: '0.68rem', fontWeight: 600, height: 22,
            }}
          />
        ) : (
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontStyle: 'italic' }}>
            Sin asignar
          </Typography>
        )}
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.64rem', flexShrink: 0 }}>
          {inst.created_at ? new Date(inst.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
        </Typography>
      </Box>
    </Box>
  )
}

export default function InstancesPanel() {
  const { t } = useLang()
  const [instances,    setInstances]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [users,        setUsers]        = useState([])

  // ── Create dialog ──
  const [createOpen,   setCreateOpen]   = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newNumber,    setNewNumber]    = useState('')
  const [creating,     setCreating]     = useState(false)
  const [createErr,    setCreateErr]    = useState('')

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

  // ── Card ⋮ menu ──
  const [menuAnchor,   setMenuAnchor]   = useState(null)
  const [menuInst,     setMenuInst]     = useState(null)

  const fetchInstances = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/instances', { headers: { 'x-user-token': token() } })
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

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
  }, [])

  useEffect(() => { fetchInstances(); fetchUsers() }, [fetchInstances, fetchUsers])

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
          // Record initial state — don't act on it.
          // If already open, we still need the QR scan to trigger the close.
          firstPoll = false
          prevState = state
          return
        }
        const isConnected = ['open', 'connected'].includes(state)
        const wasConnected = ['open', 'connected'].includes(prevState)
        prevState = state
        if (isConnected && !wasConnected) {
          // State transitioned TO connected → QR was just scanned
          if (connPollRef.current) clearInterval(connPollRef.current)
          if (qrPollRef.current)   clearTimeout(qrPollRef.current)
          setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
          fetchInstances()
        }
      } catch {}
    }, 3000)
  }, [fetchInstances])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function openMenu(e, inst) { setMenuAnchor(e.currentTarget); setMenuInst(inst) }
  function closeMenu() { setMenuAnchor(null); setMenuInst(null) }

  function handleQrClick() {
    const inst = menuInst; closeMenu()
    setQrTarget(inst); setQrOpen(true)
    startQrPoll(inst.name)
    startConnPoll(inst.name)
  }

  function handleAssignClick() {
    const inst = menuInst; closeMenu()
    setAssignTarget(inst)
    setAssignUserId(inst.assigned_to ?? '')
    const storedName = inst.assigned_name ?? ''
    setAssignUserName(/^[a-f0-9]{24}$/.test(storedName) ? '' : storedName)
    setAssignSearch('')
    setAssignOpen(true)
  }

  function handleDeleteClick() {
    const inst = menuInst; closeMenu()
    setDeleteTarget(inst)
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
      if (!r.ok) { setCreateErr(d.detail || 'Error al crear'); return }
      setCreateOpen(false); setNewName(''); setNewNumber('')
      fetchInstances()
    } catch { setCreateErr('Error de red') }
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
      setAssignOpen(false); fetchInstances()
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

  const filtered = instances.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.number || '').includes(search) ||
    (i.assigned_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const connected    = instances.filter(i => ['open','connected'].includes(i.live_status)).length
  const unassigned   = instances.filter(i => !i.assigned_to).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ color: 'var(--text,rgba(255,255,255,0.92))', fontWeight: 800, fontSize: '1.3rem', lineHeight: 1.2 }}>
            {t.inst.title}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.35))', fontSize: '0.75rem', mt: 0.3 }}>
            {instances.length} {t.inst.subtitle.replace('{connected}', connected).replace('{unassigned}', unassigned)}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
          <Tooltip title={t.inst.refresh}>
            <IconButton size="small" onClick={handleSync} disabled={syncing}
              sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
              {syncing
                ? <CircularProgress size={16} sx={{ color: 'rgba(255,255,255,0.4)' }} />
                : <RefreshIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setCreateErr(''); setNewName(''); setNewNumber(''); setCreateOpen(true) }}
            sx={{
              bgcolor: 'var(--accent,#3b82f6)',
              '&:hover': { bgcolor: 'var(--accent,#2563eb)' },
              fontWeight: 700, fontSize: '0.82rem', borderRadius: 2,
              textTransform: 'none', px: 2,
            }}
          >
            {t.inst.newBtn}
          </Button>
        </Box>
      </Box>

      {/* ── Search + filters ── */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <TextField
          placeholder={t.inst.search}
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ ...FIELD_SX, width: 260 }}
          slotProps={{ input: { startAdornment: <SearchIcon sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 18, mr: 0.5 }} /> } }}
        />
      </Box>

      {/* ── Grid ── */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', pr: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
            <CircularProgress sx={{ color: 'var(--accent,#3b82f6)' }} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', pt: 8, color: 'rgba(255,255,255,0.2)' }}>
            <PhoneAndroidIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
            <Typography sx={{ fontSize: '0.85rem' }}>
              {instances.length === 0 ? t.inst.empty : t.inst.noResults}
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 2,
          }}>
            {filtered.map(inst => (
              <InstanceCard key={inst.name} inst={inst} onMenu={openMenu} />
            ))}
          </Box>
        )}
      </Box>

      {/* ── ⋮ Context menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{
          paper: {
            sx: {
              background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.12) 0%, var(--card-bg,#161d2e) 60%)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
              borderRadius: 2, minWidth: 170,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(var(--accent-rgb,59,130,246),0.08)',
              backdropFilter: 'blur(12px)',
              '& .MuiMenuItem-root': {
                fontSize: '0.82rem', gap: 1.2, py: 1, color: 'var(--text)',
                borderRadius: 1, mx: 0.5,
                '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', color: 'var(--text)' },
              },
            },
          },
        }}
      >
        <MenuItem onClick={handleQrClick}>
          <QrCodeIcon sx={{ fontSize: 17, color: 'var(--accent,#60a5fa)' }} />
          {t.inst.connectQr}
        </MenuItem>
        <MenuItem onClick={handleAssignClick}>
          <PersonAddIcon sx={{ fontSize: 17, color: '#a78bfa' }} />
          {t.inst.assignUser}
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ color: '#f87171 !important' }}>
          <DeleteForeverIcon sx={{ fontSize: 17, color: '#f87171' }} />
          {t.inst.delete}
        </MenuItem>
      </Menu>

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
            onChange={e => setNewName(e.target.value.replace(/[^a-z0-9-]/g, '').toLowerCase())}
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
          <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
            Conectar instancia
          </Typography>
          <Typography sx={{ color: 'var(--accent,#60a5fa)', fontSize: '0.73rem', mt: 0.2, fontWeight: 600 }}>
            {qrTarget?.name}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pt: '8px !important', pb: 1 }}>
          {/* Steps */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
            {['Abre WhatsApp', 'Dispositivos vinculados', 'Escanea el QR'].map((step, i) => (
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
                      ? 'Reiniciando sesión…'
                      : qrStatus === 'error'
                        ? 'No se pudo generar el QR'
                        : 'Generando código QR…'}
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
              {qrStatus === 'error' ? 'Forzar reconexión' : 'Reintentar'}
            </Button>
            {qrStatus === 'error' && (
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,100,100,0.6)', textAlign: 'center', maxWidth: 220 }}>
                Esto desconectará la sesión actual para generar un nuevo QR
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3, pt: 2, justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => { closeQr(); fetchInstances() }} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' },
              textTransform: 'none', fontWeight: 700, fontSize: '0.85rem', borderRadius: 2, px: 5 }}>
            Listo
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
          <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
            Asignar instancia
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.73rem', mt: 0.2 }}>
            {assignTarget?.name}
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 1 }}>
          {/* Autocomplete search */}
          <TextField
            size="small"
            placeholder="Buscar usuario…"
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
            {!'sin asignar'.includes(assignSearch.toLowerCase()) ? null : (
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
                  Sin asignar
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
                        {u.role === 'admin' ? 'Admin' : 'Agente'}
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
            Cancelar
          </Button>
          <Button onClick={handleAssign} disabled={assigning} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
            {assigning ? <CircularProgress size={15} sx={{ color: 'white' }} /> : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete confirm ── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} sx={DIALOG_SX}>
        <DialogTitle sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', pb: 1 }}>
          Eliminar instancia
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>
            ¿Eliminar <strong style={{ color: 'white' }}>{deleteTarget?.name}</strong>?
            Esto desconectará y borrará la instancia permanentemente.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem' }}>
            Cancelar
          </Button>
          <Button onClick={handleDelete} disabled={deleting} variant="contained"
            sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2 }}>
            {deleting ? <CircularProgress size={16} sx={{ color: 'white' }} /> : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
