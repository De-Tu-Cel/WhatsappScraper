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
import Snackbar from '@mui/material/Snackbar'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import QrCodeIcon from '@mui/icons-material/QrCode'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import CallIcon from '@mui/icons-material/Call'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import SmartphoneIcon from '@mui/icons-material/Smartphone'
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

function InstanceCard({ inst, onMenu }) {
  const { t } = useLang()
  const status      = inst.live_status || 'unknown'
  const color       = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
  const isConnected = ['open', 'connected'].includes(status)
  const isConnecting = status === 'connecting'
  const STATUS_LABEL_T = {
    open:         t.inst.statusConnected,
    connected:    t.inst.statusConnected,
    connecting:   t.inst.statusConnecting,
    close:        t.inst.statusDisconnected,
    disconnected: t.inst.statusDisconnected,
    unknown:      t.inst.statusUnknown,
  }

  return (
    <Box sx={{
      bgcolor: 'var(--card-bg)',
      border: `1px solid ${color}33`,
      borderRadius: 3,
      p: 2.5,
      display: 'flex', flexDirection: 'column', gap: 1.5,
      position: 'relative',
      overflow: 'hidden',
      transition: 'border-color 0.25s, box-shadow 0.25s',
      boxShadow: isConnected
        ? `0 0 22px ${color}22, 0 4px 16px rgba(0,0,0,0.18)`
        : isConnecting
          ? `0 0 18px ${color}1a, 0 4px 12px rgba(0,0,0,0.15)`
          : '0 2px 10px rgba(0,0,0,0.12)',
      '&:hover': {
        borderColor: `${color}66`,
        boxShadow: `0 0 32px ${color}30, 0 8px 24px rgba(0,0,0,0.22)`,
      },
    }}>
      {/* Glow radial de fondo según status */}
      <Box sx={{
        position: 'absolute', top: -30, right: -30,
        width: 120, height: 120, borderRadius: '50%', pointerEvents: 'none',
        background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
      }} />

      {/* Top row: avatar-con-badge + nombre + menú */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, position: 'relative' }}>

        {/* Avatar + badge de status */}
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Box sx={{
            width: 56, height: 56, borderRadius: 2.5,
            bgcolor: `${color}18`,
            border: `1.5px solid ${color}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <PhoneAndroidIcon sx={{ color, fontSize: 26 }} />
          </Box>
          {/* Badge de status sobre el avatar */}
          <Box sx={{
            position: 'absolute', bottom: -3, right: -3,
            width: 14, height: 14, borderRadius: '50%',
            bgcolor: color,
            border: '2.5px solid var(--card-bg, #161d2e)',
            boxShadow: `0 0 8px ${color}cc`,
          }}>
            {isConnecting && (
              <CircularProgress size={14} thickness={6}
                sx={{ color, position: 'absolute', top: -2.5, left: -2.5, opacity: 0.7 }} />
            )}
          </Box>
        </Box>

        {/* Nombre + número + status text */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            color: 'var(--text)', fontWeight: 700,
            fontSize: '0.95rem', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {inst.name}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', mt: 0.2, fontFamily: 'monospace' }}>
            {inst.number || t.inst.noNumber}
          </Typography>
          <Typography sx={{ color, fontSize: '0.68rem', fontWeight: 600, mt: 0.4, letterSpacing: '0.03em' }}>
            {STATUS_LABEL_T[status] ?? t.inst.statusUnknown}
          </Typography>
        </Box>

        {/* ⋮ menu */}
        <IconButton
          size="small"
          onClick={e => onMenu(e, inst)}
          sx={{ color: 'var(--text-muted)', flexShrink: 0, alignSelf: 'flex-start', mt: -0.5, mr: -0.5,
            '&:hover': { color: 'var(--text)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)' } }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Divider con tinte de color */}
      <Box sx={{ borderTop: `1px solid ${color}22` }} />

      {/* Footer: usuario asignado + fecha */}
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
            {t.inst.unassigned}
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

  // ── Pairing code dialog ──
  const [pairOpen,     setPairOpen]     = useState(false)
  const [pairPhone,    setPairPhone]    = useState('')
  const [pairCode,     setPairCode]     = useState(null)
  const [pairLoading,  setPairLoading]  = useState(false)
  const [pairErr,      setPairErr]      = useState('')

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

  const [pairTarget, setPairTarget] = useState(null)

  // ── OTP registration dialog ──
  const [otpOpen,       setOtpOpen]       = useState(false)
  const [otpTarget,     setOtpTarget]     = useState(null)
  const [otpPhone,      setOtpPhone]      = useState('')
  const [otpStep,       setOtpStep]       = useState('phone') // 'phone' | 'code' | 'success'
  const [otpCode,       setOtpCode]       = useState('')
  const [otpLoading,    setOtpLoading]    = useState(false)
  const [otpErr,        setOtpErr]        = useState('')
  const [otpAutoWait,   setOtpAutoWait]   = useState(false)
  const otpPollRef      = useRef(null)
  const otpRequestedAt  = useRef(null)

  function stopOtpPolling() {
    if (otpPollRef.current) { clearInterval(otpPollRef.current); otpPollRef.current = null }
  }

  function startOtpPolling(verifyFn) {
    stopOtpPolling()
    setOtpAutoWait(true)
    otpPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/telnyx/otp')
        if (!r.ok) return
        const d = await r.json()
        if (!d.otp || !d.ts) return
        // Solo aceptar OTPs que llegaron DESPUÉS de que enviamos el request
        if (otpRequestedAt.current && new Date(d.ts) < otpRequestedAt.current) return
        stopOtpPolling()
        setOtpAutoWait(false)
        setOtpCode(d.otp)
        verifyFn(d.otp)
      } catch { /* silencioso, reintenta en el próximo tick */ }
    }, 3000)
  }

  // ── Emulator registration dialog ──
  const [emuOpen,   setEmuOpen]   = useState(false)
  const [emuPhone,  setEmuPhone]  = useState('+14794000127')
  const [emuInst,   setEmuInst]   = useState('telnyx-01')
  const [emuLogs,   setEmuLogs]   = useState([])
  const [emuStep,   setEmuStep]   = useState('idle') // idle | running | success | error
  const emuEsRef = useRef(null)

  function handleEmuClick() {
    const inst = menuInst; closeMenu()
    setEmuInst(inst?.name || 'telnyx-01')
    setEmuLogs([]); setEmuStep('idle')
    setEmuOpen(true)
  }

  function startEmuRegistration() {
    if (emuEsRef.current) emuEsRef.current.close()
    setEmuLogs([]); setEmuStep('running')
    const url = `/api/register/emulator-stream?phone=${encodeURIComponent(emuPhone)}&instance=${encodeURIComponent(emuInst)}`
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

  function handleOtpClick() {
    const inst = menuInst; closeMenu()
    stopOtpPolling()
    setOtpPhone(''); setOtpCode(''); setOtpStep('phone'); setOtpErr(''); setOtpAutoWait(false)
    setOtpTarget(inst)
    setOtpOpen(true)
  }

  async function handleRequestOtpCall() {
    if (!otpPhone.trim()) { setOtpErr(t.inst.otpErrPhone); return }
    setOtpLoading(true); setOtpErr('')
    try {
      const r = await fetch(`/api/evolution/instance/${otpTarget?.name}?action=request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: otpPhone.replace(/\D/g, '') }),
      })
      const d = await r.json()
      if (!r.ok) { setOtpErr(d.detail || d.error || t.inst.otpErrRequest); return }
      otpRequestedAt.current = new Date()
      setOtpStep('code')
      startOtpPolling((code) => handleVerifyOtp(code))
    } catch (e) {
      setOtpErr(e.message)
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleVerifyOtp(autoCode) {
    const clean = (autoCode || otpCode).replace(/\D/g, '')
    if (clean.length < 6) { setOtpErr(t.inst.otpErrCode); return }
    setOtpLoading(true); setOtpErr('')
    try {
      const r = await fetch(`/api/evolution/instance/${otpTarget?.name}?action=verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      })
      const d = await r.json()
      if (!r.ok) { setOtpErr(d.detail || d.error || t.inst.otpErrVerify); return }
      setOtpStep('success')
      setTimeout(() => { setOtpOpen(false); fetchInstances() }, 2000)
    } catch (e) {
      setOtpErr(e.message)
    } finally {
      setOtpLoading(false)
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
        <MenuItem onClick={handlePairClick}>
          <PhoneAndroidIcon sx={{ fontSize: 17, color: '#4ade80' }} />
          Conectar por número
        </MenuItem>
        <MenuItem onClick={handleOtpClick}>
          <CallIcon sx={{ fontSize: 17, color: '#fb923c' }} />
          {t.inst.otpMenuLabel}
        </MenuItem>
        <MenuItem onClick={handleEmuClick}>
          <SmartphoneIcon sx={{ fontSize: 17, color: '#a78bfa' }} />
          Registrar vía emulador
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

      {/* ── OTP registration dialog ── */}
      <Dialog open={otpOpen} onClose={() => { if (otpStep !== 'success') { stopOtpPolling(); setOtpOpen(false) } }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(251,146,60,0.08) 0%, transparent 55%)',
          border: '1px solid rgba(251,146,60,0.2)',
          borderRadius: 3, minWidth: 360,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {otpStep === 'success'
                ? <CheckCircleIcon sx={{ fontSize: 18, color: '#4ade80' }} />
                : <CallIcon sx={{ fontSize: 18, color: '#fb923c' }} />}
            </Box>
            <Box>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {otpStep === 'success' ? t.inst.otpSuccessTitle : t.inst.otpTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {otpTarget?.name}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '4px !important', pb: 1 }}>
          {otpStep === 'phone' && (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                {t.inst.otpPhoneDesc}
              </Typography>
              <TextField
                label={t.inst.otpPhoneLabel}
                placeholder={t.inst.otpPhonePlaceholder}
                size="small"
                value={otpPhone}
                onChange={e => setOtpPhone(e.target.value)}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{t.inst.otpPhoneHint}</span>}
                onKeyDown={e => e.key === 'Enter' && handleRequestOtpCall()}
                autoFocus
                sx={FIELD_SX}
              />
              {otpErr && <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{otpErr}</Typography>}
            </>
          )}
          {otpStep === 'code' && (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                {t.inst.otpCodeDesc.replace('{phone}', `+${otpPhone.replace(/\D/g, '')}`)}
              </Typography>
              {otpAutoWait && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: 1.5, px: 1.5, py: 1 }}>
                  <CircularProgress size={13} sx={{ color: '#fb923c', flexShrink: 0 }} />
                  <Typography sx={{ color: '#fb923c', fontSize: '0.76rem' }}>
                    Esperando SMS de WhatsApp… se ingresará automáticamente
                  </Typography>
                </Box>
              )}
              <TextField
                label={t.inst.otpCodeLabel}
                placeholder={t.inst.otpCodePlaceholder}
                size="small"
                value={otpCode}
                onChange={e => { stopOtpPolling(); setOtpAutoWait(false); setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)) }}
                onKeyDown={e => e.key === 'Enter' && handleVerifyOtp()}
                autoFocus
                slotProps={{ htmlInput: { maxLength: 6, style: { textAlign: 'center', fontSize: '1.5rem', fontFamily: 'monospace', letterSpacing: '0.3em', color: '#fb923c', fontWeight: 800 } } }}
                sx={{
                  ...FIELD_SX,
                  '& .MuiOutlinedInput-root': {
                    ...FIELD_SX['& .MuiOutlinedInput-root'],
                    '&.Mui-focused fieldset': { borderColor: '#fb923c' },
                  },
                  '& .MuiInputLabel-root.Mui-focused': { color: '#fb923c' },
                }}
              />
              {otpErr && <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{otpErr}</Typography>}
            </>
          )}
          {otpStep === 'success' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2, gap: 1.5 }}>
              <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', textAlign: 'center' }}>
                {t.inst.otpSuccessMsg}
              </Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          {otpStep !== 'success' && (
            <Button onClick={() => { stopOtpPolling(); setOtpOpen(false) }} sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
              {t.inst.otpClose}
            </Button>
          )}
          {otpStep === 'phone' && (
            <Button onClick={handleRequestOtpCall} disabled={otpLoading} variant="contained"
              startIcon={otpLoading ? null : <CallIcon sx={{ fontSize: '17px !important' }} />}
              sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
              {otpLoading ? <CircularProgress size={15} sx={{ color: 'white' }} /> : t.inst.otpRequestBtn}
            </Button>
          )}
          {otpStep === 'code' && (
            <Button onClick={handleVerifyOtp} disabled={otpLoading || otpCode.replace(/\D/g,'').length < 6} variant="contained"
              sx={{ bgcolor: '#ea580c', '&:hover': { bgcolor: '#c2410c' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5,
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' } }}>
              {otpLoading ? <CircularProgress size={15} sx={{ color: 'white' }} /> : t.inst.otpVerifyBtn}
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
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: '#a78bfa' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,#e2e8f0)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                Registrar vía emulador
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                Redroid + Telnyx OTP automático
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '4px !important', pb: 1 }}>
          {emuStep === 'idle' && (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Registra el número en WhatsApp dentro del emulador Redroid. El OTP se captura automáticamente vía Telnyx y se ingresa solo.
              </Typography>
              <TextField label="Número Telnyx" size="small" value={emuPhone}
                onChange={e => setEmuPhone(e.target.value)} sx={FIELD_SX} />
              <TextField label="Nombre de instancia (Evolution API)" size="small" value={emuInst}
                onChange={e => setEmuInst(e.target.value)} sx={FIELD_SX} />
            </>
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
            <Button variant="contained" onClick={startEmuRegistration} disabled={!emuPhone.trim()}
              sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Iniciar registro automático
            </Button>
          )}
          {(emuStep === 'success' || emuStep === 'done') && (
            <Button variant="contained" onClick={() => { setEmuOpen(false); fetchInstances() }}
              sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Listo ✓
            </Button>
          )}
          {emuStep === 'error' && (
            <Button variant="contained" onClick={() => setEmuStep('idle')}
              sx={{ bgcolor: '#7c3aed', '&:hover': { bgcolor: '#6d28d9' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
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
        message={snack.msg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ content: { sx: {
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.92)',
          color: 'white', fontWeight: 600, fontSize: '0.82rem',
          borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(8px)',
        }}}}
      />

      {/* ── Delete confirm ── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} sx={DIALOG_SX}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>
              {t.inst.deleteTitle}
            </Typography>
            <IconButton size="small" onClick={() => setDeleteTarget(null)} sx={{ color: 'rgba(255,255,255,0.25)', mr: -1, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', mb: 0.5 }}>
            {t.inst.deleteConfirm} <strong style={{ color: 'white' }}>{deleteTarget?.name}</strong>?
          </Typography>
          <Typography sx={{ color: 'rgba(239,68,68,0.65)', fontSize: '0.75rem' }}>
            {t.inst.deleteWarnInst}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem' }}>
            {t.inst.cancel}
          </Button>
          <Button onClick={handleDelete} disabled={deleting} variant="contained"
            sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2 }}>
            {deleting ? <CircularProgress size={16} sx={{ color: 'white' }} /> : t.inst.delete}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
