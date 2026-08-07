'use client'
import { useState, useEffect, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import LockResetIcon from '@mui/icons-material/LockReset'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import RefreshIcon from '@mui/icons-material/Refresh'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import ShieldIcon from '@mui/icons-material/Shield'
import PersonIcon from '@mui/icons-material/Person'
import GroupIcon from '@mui/icons-material/Group'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

const token = () => typeof window !== 'undefined' ? localStorage.getItem('user_token') : ''
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'var(--item-hover)',
    fontSize: '0.88rem',
    borderRadius: 2,
    '& fieldset': { borderColor: 'var(--border)' },
    '&:hover fieldset': { borderColor: 'var(--text-muted)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& input': { color: 'var(--text)' },
}

const SECTION_LABEL_SX = {
  fontSize: '0.63rem', color: 'rgba(255,255,255,0.3)', mb: 1, mt: 0.5,
  textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600,
}

function FieldIcon({ children }) {
  return <Box sx={{ display: 'flex', mr: 0.8, color: 'rgba(255,255,255,0.3)' }}>{children}</Box>
}

function StatChip({ icon, label, value, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, px: 1.2, py: 0.5, borderRadius: 2, bgcolor: `${color}12`, border: `1px solid ${color}30` }}>
      <Box sx={{ color, display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.68rem', color: `${color}99` }}>{label}</Typography>
    </Box>
  )
}

export default function AdminPanel() {
  const { user } = useUser()
  const { t } = useLang()
  const [users,        setUsers]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [resetTarget,  setResetTarget]  = useState(null)
  const [newPin,       setNewPin]       = useState('')
  const [saving,       setSaving]       = useState(false)
  const [msg,          setMsg]          = useState('')
  const [createOpen,   setCreateOpen]   = useState(false)
  const [newUser,      setNewUser]      = useState({ display_name: '', username: '', email: '', pin: '', pin2: '' })
  const [createMsg,    setCreateMsg]    = useState('')
  const [creating,     setCreating]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)
  const [deleteMsg,    setDeleteMsg]    = useState('')
  const [userSearch,   setUserSearch]   = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const emailTouched = newUser.email.length > 0
  const emailValid   = !emailTouched || EMAIL_RE.test(newUser.email)
  const pin2Touched  = newUser.pin2.length > 0
  const pinsMatch    = !pin2Touched || newUser.pin === newUser.pin2
  const canSubmit    = newUser.display_name.trim() && newUser.username.trim() &&
    EMAIL_RE.test(newUser.email) && newUser.pin.length >= 4 && newUser.pin === newUser.pin2

  function handleCloseCreate() {
    setCreateOpen(false)
    setCreateMsg('')
    setNewUser({ display_name: '', username: '', email: '', pin: '', pin2: '' })
  }

  async function handleCreateUser() {
    if (!canSubmit) { setCreateMsg(t.admin.fillAll); return }
    setCreating(true); setCreateMsg('')
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ display_name: newUser.display_name, username: newUser.username, email: newUser.email, pin: newUser.pin }),
      })
      const d = await r.json()
      if (!r.ok) { setCreateMsg(d.detail || t.common.error); return }
      setCreateOpen(false)
      setNewUser({ display_name: '', username: '', email: '', pin: '', pin2: '' })
      fetchUsers()
    } catch { setCreateMsg(t.admin.netError) }
    finally { setCreating(false) }
  }

  async function handleResetPin() {
    if (newPin.length < 4) { setMsg(t.admin.pinMin); return }
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/auth/admin/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: resetTarget.id, new_pin: newPin }),
      })
      if (r.ok) { setMsg(t.admin.pinUpdated); setResetTarget(null); setNewPin('') }
      else setMsg((await r.json()).detail || t.common.error)
    } catch { setMsg(t.admin.netError) }
    finally { setSaving(false) }
  }

  async function handleDeleteUser() {
    setDeleting(true); setDeleteMsg('')
    try {
      const r = await fetch(`/api/auth/admin/user/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-user-token': token() },
      })
      if (r.ok) { setDeleteTarget(null); fetchUsers() }
      else setDeleteMsg((await r.json()).detail || t.admin.deleteError)
    } catch { setDeleteMsg(t.admin.netError) }
    finally { setDeleting(false) }
  }

  async function toggleRole(u) {
    try {
      await fetch('/api/auth/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: u.id, role: u.role === 'admin' ? 'agent' : 'admin' }),
      })
      fetchUsers()
    } catch {}
  }

  if (user?.role !== 'admin') return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography sx={{ color: 'rgba(255,255,255,0.3)' }}>{t.admin.noAccess}</Typography>
    </Box>
  )

  const adminsCount = users.filter(u => u.role === 'admin').length
  const agentsCount = users.filter(u => u.role !== 'admin').length

  const visibleUsers = userSearch.trim()
    ? users.filter(u => [u.display_name, u.username, u.email].some(s => s?.toLowerCase().includes(userSearch.toLowerCase())))
    : users

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2.5 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2.5, flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,99,102,241),0.25) 0%, rgba(var(--accent-rgb,99,102,241),0.1) 100%)',
            border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AdminPanelSettingsIcon sx={{ color: 'var(--accent,#a5b4fc)', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              {t.admin.title}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.8, mt: 0.6, flexWrap: 'wrap' }}>
              <StatChip icon={<GroupIcon sx={{ fontSize: 13 }} />}  label={t.admin.statTotal}  value={users.length} color="#60a5fa" />
              <StatChip icon={<ShieldIcon sx={{ fontSize: 13 }} />} label={t.admin.statAdmins} value={adminsCount}  color="#a78bfa" />
              <StatChip icon={<PersonIcon sx={{ fontSize: 13 }} />} label={t.admin.statAgents} value={agentsCount}  color="#34d399" />
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
          <Tooltip title={t.admin.newUserTip}>
            <Box onClick={() => { setCreateOpen(true); setCreateMsg('') }}
              sx={{
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.6,
                px: 1.4, py: 0.6, borderRadius: 2,
                bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)',
                border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
                color: 'var(--accent,#60a5fa)',
                transition: 'all 0.15s',
                '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.22)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
              }}>
              <PersonAddIcon sx={{ fontSize: 15 }} />
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'inherit' }}>{t.admin.newUserBtn}</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={t.admin.refreshTip}>
            <IconButton size="small" onClick={fetchUsers}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--item-hover)' } }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Búsqueda ── */}
      <Box sx={{ flexShrink: 0 }}>
        <TextField
          size="small"
          placeholder={t.admin.searchUsers || 'Buscar usuario…'}
          value={userSearch}
          onChange={e => setUserSearch(e.target.value)}
          slotProps={{ input: { startAdornment: (
            <Box sx={{ display: 'flex', mr: 0.5, color: 'rgba(255,255,255,0.3)' }}>
              <SearchIcon sx={{ fontSize: 16 }} />
            </Box>
          ) } }}
          fullWidth
          sx={FIELD_SX}
        />
      </Box>

      {/* ── Grid de usuarios ── */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={28} sx={{ color: 'var(--accent,#6366f1)' }} />
          </Box>
        ) : users.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1.5, opacity: 0.4 }}>
            <GroupIcon sx={{ fontSize: 40, color: 'rgba(255,255,255,0.2)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>{t.admin.noUsers}</Typography>
          </Box>
        ) : visibleUsers.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 1.5, opacity: 0.4 }}>
            <SearchIcon sx={{ fontSize: 36, color: 'rgba(255,255,255,0.2)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>{t.admin.noSearchResults || 'Sin resultados'}</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 210px))', gap: 1.5 }}>
            {visibleUsers.map(u => {
              const isMe    = u.id === user?.id
              const isAdmin = u.role === 'admin'
              const initial = (u.display_name || u.username || '?')[0].toUpperCase()
              const glowColor = isAdmin ? '#a78bfa' : isMe ? '#22d3ee' : '#64748b'
              return (
                <Box key={u.id} sx={{
                  borderRadius: 3, overflow: 'hidden',
                  bgcolor: 'var(--card-bg, rgba(255,255,255,0.025))',
                  border: `1px solid ${glowColor}44`,
                  boxShadow: `0 0 18px ${glowColor}18, 0 2px 10px rgba(0,0,0,0.15)`,
                  display: 'flex', flexDirection: 'column',
                  position: 'relative',
                  transition: 'box-shadow 0.2s, border-color 0.2s',
                  '&:hover': {
                    borderColor: `${glowColor}77`,
                    boxShadow: `0 0 28px ${glowColor}30, 0 6px 20px rgba(0,0,0,0.2)`,
                  },
                }}>
                  {/* Radial glow de fondo */}
                  <Box sx={{
                    position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)',
                    width: 140, height: 100, pointerEvents: 'none',
                    background: `radial-gradient(ellipse, ${glowColor}18 0%, transparent 70%)`,
                  }} />

                  {/* Avatar + info */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 2.5, pb: 1.5, px: 1.5, gap: 0.3, position: 'relative' }}>
                    <Box sx={{
                      width: 56, height: 56, borderRadius: '50%', mb: 0.8,
                      background: `linear-gradient(135deg, ${glowColor}30 0%, ${glowColor}10 100%)`,
                      border: `2px solid ${glowColor}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 12px ${glowColor}33`,
                    }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '1.2rem', color: glowColor, textTransform: 'uppercase' }}>
                        {initial}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '0.87rem', textAlign: 'center', lineHeight: 1.3 }}>
                        {u.display_name}
                      </Typography>
                      {isMe && (
                        <Chip label={t.admin.you} size="small" sx={{ height: 15, fontSize: '0.57rem', fontWeight: 700, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', color: 'var(--accent,#60a5fa)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', '& .MuiChip-label': { px: 0.6 } }} />
                      )}
                    </Box>

                    <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.45))', fontSize: '0.68rem', textAlign: 'center' }}>
                      @{u.username}
                    </Typography>
                    {u.email && (
                      <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.3))', fontSize: '0.63rem', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                        {u.email}
                      </Typography>
                    )}

                    {/* Role badge — clickeable */}
                    <Tooltip title={isMe ? t.admin.unchangeable : `${t.admin.changeTo} ${isAdmin ? t.admin.user : t.admin.admin}`}>
                      <Box onClick={() => !isMe && toggleRole(u)} sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5, mt: 1,
                        px: 1, py: 0.35, borderRadius: 2,
                        cursor: isMe ? 'default' : 'pointer',
                        bgcolor: `${glowColor}10`,
                        border: `1px solid ${glowColor}35`,
                        opacity: isMe ? 0.7 : 1,
                        transition: 'background 0.15s',
                        '&:hover': !isMe ? { bgcolor: `${glowColor}20` } : {},
                      }}>
                        {isAdmin
                          ? <ShieldIcon sx={{ fontSize: 12, color: glowColor }} />
                          : <PersonIcon sx={{ fontSize: 12, color: glowColor }} />}
                        <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: glowColor }}>
                          {isAdmin ? t.admin.admin : t.admin.user}
                        </Typography>
                      </Box>
                    </Tooltip>

                    {/* Número conectado */}
                    {u.connected_number && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.7, px: 0.8, py: 0.25, borderRadius: 1, bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.18)' }}>
                        <PhoneAndroidIcon sx={{ fontSize: 11, color: '#4ade80' }} />
                        <Typography sx={{ color: '#4ade80', fontSize: '0.66rem', fontFamily: 'monospace', fontWeight: 600 }}>{u.connected_number}</Typography>
                      </Box>
                    )}
                  </Box>

                  {/* Footer de acciones */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, px: 1, py: 0.8, borderTop: `1px solid ${glowColor}18`, mt: 'auto' }}>
                    <Tooltip title={t.admin.resetPinBtn}>
                      <IconButton size="small" onClick={() => { setResetTarget(u); setNewPin(''); setMsg('') }}
                        sx={{ color: 'rgba(251,191,36,0.5)', borderRadius: 1.5, '&:hover': { color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.12)' } }}>
                        <LockResetIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    {!isMe && (
                      <Tooltip title={t.admin.deleteTitle}>
                        <IconButton size="small" onClick={() => { setDeleteTarget(u); setDeleteMsg('') }}
                          sx={{ color: 'rgba(239,68,68,0.45)', borderRadius: 1.5, '&:hover': { color: '#f87171', bgcolor: 'rgba(239,68,68,0.12)' } }}>
                          <DeleteForeverIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>

      {/* ── Modal reset PIN ── */}
      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 3 } } }}>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LockResetIcon sx={{ color: '#fbbf24', fontSize: 18 }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>{t.admin.resetPin}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>@{resetTarget?.username}</Typography>
            </Box>
            <IconButton size="small" onClick={() => setResetTarget(null)} sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.78rem', mb: 2 }}>{t.admin.pinInfo}</Typography>
          <TextField fullWidth size="small" type="password" placeholder={t.admin.newPin}
            value={newPin} onChange={e => setNewPin(e.target.value)} autoFocus
            slotProps={{ htmlInput: { maxLength: 8, inputMode: 'numeric' } }}
            sx={{ mb: 1.5, ...FIELD_SX, '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#fbbf24' } }} />
          {msg && <Typography sx={{ fontSize: '0.75rem', color: msg.startsWith('✓') ? '#4ade80' : '#f87171', mb: 1.5 }}>{msg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Box onClick={() => setResetTarget(null)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>{t.admin.cancelBtn}</Typography>
            </Box>
            <Box onClick={handleResetPin} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', '&:hover': { bgcolor: 'rgba(251,191,36,0.22)' } }}>
              {saving ? <CircularProgress size={14} sx={{ color: '#fbbf24' }} /> : <Typography sx={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.82rem' }}>{t.admin.resetPinBtn}</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── Modal eliminar usuario ── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 3 } } }}>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DeleteForeverIcon sx={{ color: '#f87171', fontSize: 18 }} />
            </Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>{t.admin.deleteTitle}</Typography>
            <IconButton size="small" onClick={() => setDeleteTarget(null)} sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.83rem', mb: 0.5 }}>
            {t.admin.deleteConfirm} <strong style={{ color: 'white' }}>{deleteTarget?.display_name}</strong> (@{deleteTarget?.username})?
          </Typography>
          <Typography sx={{ color: 'rgba(239,68,68,0.6)', fontSize: '0.75rem' }}>
            {t.admin.deleteWarn}
          </Typography>
          {deleteTarget?.connected_number && (
            <Typography sx={{ color: 'rgba(239,68,68,0.5)', fontSize: '0.72rem', mb: 2 }}>
              {t.admin.deleteWarnInst}
            </Typography>
          )}
          {!deleteTarget?.connected_number && <Box sx={{ mb: 2 }} />}
          {deleteMsg && <Typography sx={{ fontSize: '0.75rem', color: '#f87171', mb: 1.5 }}>{deleteMsg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Box onClick={() => setDeleteTarget(null)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>{t.admin.cancelBtn}</Typography>
            </Box>
            <Box onClick={handleDeleteUser} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', '&:hover': { bgcolor: 'rgba(239,68,68,0.22)' } }}>
              {deleting ? <CircularProgress size={14} sx={{ color: '#f87171' }} /> : <Typography sx={{ color: '#f87171', fontWeight: 700, fontSize: '0.82rem' }}>{t.admin.deleteBtn}</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── Modal crear usuario ── */}
      <Dialog open={createOpen} onClose={handleCloseCreate} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.15)', borderRadius: 3 } } }}>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PersonAddIcon sx={{ color: 'var(--accent,#60a5fa)', fontSize: 18 }} />
            </Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>{t.admin.createTitle}</Typography>
            <IconButton size="small" onClick={handleCloseCreate} sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* Sección: datos personales */}
          <Typography sx={SECTION_LABEL_SX}>{t.admin.sectionPersonal}</Typography>
          <Box sx={{ mb: 1.2 }}>
            <TextField fullWidth size="small" autoFocus placeholder={t.admin.fullName}
              value={newUser.display_name} onChange={e => setNewUser(p => ({ ...p, display_name: e.target.value }))}
              slotProps={{ input: { startAdornment: <FieldIcon><PersonIcon sx={{ fontSize: 16 }} /></FieldIcon> } }}
              sx={FIELD_SX} />
          </Box>
          <Box sx={{ mb: 1.2 }}>
            <TextField fullWidth size="small" placeholder={t.admin.usernameLabel}
              value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
              slotProps={{ input: { startAdornment: <FieldIcon><AlternateEmailIcon sx={{ fontSize: 16 }} /></FieldIcon> } }}
              sx={FIELD_SX} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <TextField fullWidth size="small" type="email" placeholder={t.admin.emailLabel}
              value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
              error={!emailValid}
              helperText={!emailValid ? t.admin.emailInvalid : ' '}
              slotProps={{ input: { startAdornment: <FieldIcon><MailOutlineIcon sx={{ fontSize: 16 }} /></FieldIcon> } }}
              sx={{ ...FIELD_SX, '& .MuiFormHelperText-root': { fontSize: '0.68rem', ml: 0.5, mt: 0.2, color: '#f87171' } }} />
          </Box>

          {/* Sección: seguridad */}
          <Typography sx={SECTION_LABEL_SX}>{t.admin.sectionSecurity}</Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 0.6 }}>
            <TextField fullWidth size="small" type="password" placeholder={t.admin.pinLabel}
              value={newUser.pin} onChange={e => setNewUser(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
              slotProps={{
                input: { startAdornment: <FieldIcon><LockOutlinedIcon sx={{ fontSize: 16 }} /></FieldIcon> },
                htmlInput: { inputMode: 'numeric', maxLength: 8 },
              }}
              sx={FIELD_SX} />
            <TextField fullWidth size="small" type="password" placeholder={t.admin.pinConfirm}
              value={newUser.pin2} onChange={e => setNewUser(p => ({ ...p, pin2: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
              error={!pinsMatch}
              slotProps={{
                input: {
                  startAdornment: <FieldIcon><LockOutlinedIcon sx={{ fontSize: 16 }} /></FieldIcon>,
                  endAdornment: pin2Touched ? (
                    pinsMatch
                      ? <CheckCircleIcon sx={{ fontSize: 15, color: '#4ade80' }} />
                      : <HighlightOffIcon sx={{ fontSize: 15, color: '#f87171' }} />
                  ) : null,
                },
                htmlInput: { inputMode: 'numeric', maxLength: 8 },
              }}
              sx={FIELD_SX} />
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: pin2Touched && !pinsMatch ? '#f87171' : 'rgba(255,255,255,0.25)', mb: 2 }}>
            {pin2Touched && !pinsMatch ? t.admin.pinMismatch : t.admin.pinHint}
          </Typography>

          {createMsg && (
            <Box sx={{ mb: 1.5, px: 1.2, py: 0.8, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{createMsg}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
            <Box onClick={handleCloseCreate} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>{t.admin.cancelBtn}</Typography>
            </Box>
            <Box onClick={creating || !canSubmit ? undefined : handleCreateUser} sx={{
              px: 2, py: 0.7, borderRadius: 2,
              cursor: canSubmit && !creating ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.4,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
              transition: 'opacity 0.15s',
              '&:hover': canSubmit && !creating ? { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.25)' } : undefined,
            }}>
              {creating ? <CircularProgress size={14} sx={{ color: 'var(--accent,#60a5fa)' }} /> : <Typography sx={{ color: 'var(--accent,#60a5fa)', fontWeight: 700, fontSize: '0.82rem' }}>{t.admin.createBtn}</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
