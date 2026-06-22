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
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

const token = () => typeof window !== 'undefined' ? localStorage.getItem('user_token') : ''

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'rgba(255,255,255,0.04)',
    fontSize: '0.88rem',
    borderRadius: 2,
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& input': { color: 'white' },
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

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function handleCreateUser() {
    if (!newUser.display_name.trim() || !newUser.username.trim() || !newUser.email.includes('@') || newUser.pin.length < 4) {
      setCreateMsg('Completa todos los campos'); return
    }
    if (newUser.pin !== newUser.pin2) { setCreateMsg('Los PINs no coinciden'); return }
    setCreating(true); setCreateMsg('')
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ display_name: newUser.display_name, username: newUser.username, email: newUser.email, pin: newUser.pin }),
      })
      const d = await r.json()
      if (!r.ok) { setCreateMsg(d.detail || 'Error'); return }
      setCreateOpen(false)
      setNewUser({ display_name: '', username: '', email: '', pin: '', pin2: '' })
      fetchUsers()
    } catch { setCreateMsg('Error de red') }
    finally { setCreating(false) }
  }

  async function handleResetPin() {
    if (newPin.length < 4) { setMsg('PIN mínimo 4 dígitos'); return }
    setSaving(true); setMsg('')
    try {
      const r = await fetch('/api/auth/admin/reset-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: resetTarget.id, new_pin: newPin }),
      })
      if (r.ok) { setMsg('✓ PIN actualizado'); setResetTarget(null); setNewPin('') }
      else setMsg((await r.json()).detail || 'Error')
    } catch { setMsg('Error de red') }
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
      else setDeleteMsg((await r.json()).detail || 'Error al eliminar')
    } catch { setDeleteMsg('Error de red') }
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
              <StatChip icon={<GroupIcon sx={{ fontSize: 13 }} />}  label="total"   value={users.length} color="#60a5fa" />
              <StatChip icon={<ShieldIcon sx={{ fontSize: 13 }} />} label="admins"  value={adminsCount}  color="#a78bfa" />
              <StatChip icon={<PersonIcon sx={{ fontSize: 13 }} />} label="agentes" value={agentsCount}  color="#34d399" />
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
          <Tooltip title="Nuevo usuario">
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
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'inherit' }}>Nuevo</Typography>
            </Box>
          </Tooltip>
          <Tooltip title="Actualizar lista">
            <IconButton size="small" onClick={fetchUsers}
              sx={{ color: 'rgba(255,255,255,0.3)', '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Lista de usuarios ── */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress size={28} sx={{ color: 'var(--accent,#6366f1)' }} />
          </Box>
        ) : users.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5, opacity: 0.4 }}>
            <GroupIcon sx={{ fontSize: 40, color: 'rgba(255,255,255,0.2)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>Sin usuarios registrados</Typography>
          </Box>
        ) : users.map(u => {
          const isMe = u.id === user?.id
          const isAdmin = u.role === 'admin'
          return (
            <Box key={u.id} sx={{
              display: 'flex', alignItems: 'center', gap: 2,
              p: 1.5, pl: 0, borderRadius: 2.5,
              bgcolor: isMe ? 'rgba(var(--accent-rgb,59,130,246),0.05)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isMe ? 'rgba(var(--accent-rgb,59,130,246),0.2)' : 'rgba(255,255,255,0.06)'}`,
              overflow: 'hidden', position: 'relative',
              transition: 'border-color 0.2s',
              '&:hover': { borderColor: isMe ? 'rgba(var(--accent-rgb,59,130,246),0.35)' : 'rgba(255,255,255,0.12)' },
            }}>
              {/* Borde izquierdo de acento */}
              <Box sx={{
                width: 3, alignSelf: 'stretch', flexShrink: 0, borderRadius: '0 2px 2px 0',
                bgcolor: isAdmin ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.1)',
              }} />

              {/* Avatar */}
              <Box sx={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                bgcolor: isAdmin ? 'rgba(var(--accent-rgb,99,102,241),0.18)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${isAdmin ? 'rgba(var(--accent-rgb,99,102,241),0.35)' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: isAdmin ? 'var(--accent,#a5b4fc)' : 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
                  {(u.display_name || u.username || '?')[0]}
                </Typography>
              </Box>

              {/* Info */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                  <Typography sx={{ color: 'white', fontWeight: 600, fontSize: '0.87rem' }}>{u.display_name}</Typography>
                  {isMe && (
                    <Chip label={t.admin.you} size="small" sx={{ height: 17, fontSize: '0.6rem', fontWeight: 700, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', color: 'var(--accent,#60a5fa)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', '& .MuiChip-label': { px: 0.8 } }} />
                  )}
                </Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.72rem', mt: 0.1 }}>
                  @{u.username}{u.email ? ` · ${u.email}` : ''}
                </Typography>
                {u.connected_number && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.4, px: 0.8, py: 0.2, borderRadius: 1, bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.18)', width: 'fit-content' }}>
                    <PhoneAndroidIcon sx={{ fontSize: 11, color: '#4ade80' }} />
                    <Typography sx={{ color: '#4ade80', fontSize: '0.67rem', fontFamily: 'monospace', fontWeight: 600 }}>{u.connected_number}</Typography>
                  </Box>
                )}
              </Box>

              {/* Acciones */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexShrink: 0, pr: 1 }}>
                {/* Chip de rol — clickeable para cambiar */}
                <Tooltip title={isMe ? 'No puedes cambiar tu propio rol' : `Cambiar a ${isAdmin ? 'Agente' : 'Admin'}`}>
                  <Box onClick={() => !isMe && toggleRole(u)} sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    px: 1, py: 0.35, borderRadius: 1.5,
                    cursor: isMe ? 'default' : 'pointer',
                    bgcolor: isAdmin ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isAdmin ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    opacity: isMe ? 0.55 : 1,
                    transition: 'all 0.15s',
                    '&:hover': !isMe ? { opacity: 0.75 } : {},
                  }}>
                    {isAdmin
                      ? <ShieldIcon sx={{ fontSize: 12, color: '#a78bfa' }} />
                      : <PersonIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }} />
                    }
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: isAdmin ? '#a78bfa' : 'rgba(255,255,255,0.4)' }}>
                      {isAdmin ? t.admin.admin : t.admin.user}
                    </Typography>
                  </Box>
                </Tooltip>

                {/* Reset PIN */}
                <Tooltip title="Resetear PIN">
                  <IconButton size="small" onClick={() => { setResetTarget(u); setNewPin(''); setMsg('') }}
                    sx={{ color: 'rgba(255,255,255,0.25)', borderRadius: 1.5, '&:hover': { color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.1)' } }}>
                    <LockResetIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>

                {/* Eliminar */}
                {!isMe && (
                  <Tooltip title="Eliminar usuario">
                    <IconButton size="small" onClick={() => { setDeleteTarget(u); setDeleteMsg('') }}
                      sx={{ color: 'rgba(255,255,255,0.25)', borderRadius: 1.5, '&:hover': { color: '#f87171', bgcolor: 'rgba(239,68,68,0.1)' } }}>
                      <DeleteForeverIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* ── Modal reset PIN ── */}
      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 3 } } }}>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LockResetIcon sx={{ color: '#fbbf24', fontSize: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>{t.admin.resetPin}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>@{resetTarget?.username}</Typography>
            </Box>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.78rem', mb: 2 }}>{t.admin.pinInfo}</Typography>
          <TextField fullWidth size="small" type="password" placeholder={t.admin.newPin}
            value={newPin} onChange={e => setNewPin(e.target.value)} autoFocus
            slotProps={{ htmlInput: { maxLength: 8, inputMode: 'numeric' } }}
            sx={{ mb: 1.5, ...FIELD_SX, '& .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: '#fbbf24' } }} />
          {msg && <Typography sx={{ fontSize: '0.75rem', color: msg.startsWith('✓') ? '#4ade80' : '#f87171', mb: 1.5 }}>{msg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Box onClick={() => setResetTarget(null)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>Cancelar</Typography>
            </Box>
            <Box onClick={handleResetPin} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', '&:hover': { bgcolor: 'rgba(251,191,36,0.22)' } }}>
              {saving ? <CircularProgress size={14} sx={{ color: '#fbbf24' }} /> : <Typography sx={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.82rem' }}>Resetear PIN</Typography>}
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
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>Eliminar usuario</Typography>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.83rem', mb: 0.5 }}>
            ¿Eliminar a <strong style={{ color: 'white' }}>{deleteTarget?.display_name}</strong> (@{deleteTarget?.username})?
          </Typography>
          <Typography sx={{ color: 'rgba(239,68,68,0.6)', fontSize: '0.75rem', mb: 2 }}>
            Esta acción no se puede deshacer.
          </Typography>
          {deleteMsg && <Typography sx={{ fontSize: '0.75rem', color: '#f87171', mb: 1.5 }}>{deleteMsg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Box onClick={() => setDeleteTarget(null)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>Cancelar</Typography>
            </Box>
            <Box onClick={handleDeleteUser} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', '&:hover': { bgcolor: 'rgba(239,68,68,0.22)' } }}>
              {deleting ? <CircularProgress size={14} sx={{ color: '#f87171' }} /> : <Typography sx={{ color: '#f87171', fontWeight: 700, fontSize: '0.82rem' }}>Eliminar</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── Modal crear usuario ── */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.15)', borderRadius: 3 } } }}>
        <DialogContent sx={{ py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 2.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PersonAddIcon sx={{ color: 'var(--accent,#60a5fa)', fontSize: 18 }} />
            </Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>Crear nuevo usuario</Typography>
          </Box>
          {[
            { label: 'Nombre completo', key: 'display_name', ph: 'Ana García' },
            { label: 'Usuario',         key: 'username',     ph: 'ana.garcia' },
            { label: 'Correo',          key: 'email',        ph: 'ana@detucel.mx' },
          ].map(f => (
            <Box key={f.key} sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.3)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{f.label}</Typography>
              <TextField fullWidth size="small" placeholder={f.ph}
                value={newUser[f.key]} onChange={e => setNewUser(p => ({ ...p, [f.key]: e.target.value }))}
                sx={FIELD_SX} />
            </Box>
          ))}
          {[
            { label: 'PIN (mínimo 4 dígitos)', key: 'pin' },
            { label: 'Confirmar PIN',          key: 'pin2' },
          ].map(f => (
            <Box key={f.key} sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.3)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{f.label}</Typography>
              <TextField fullWidth size="small" type="password" placeholder="••••••"
                value={newUser[f.key]} onChange={e => setNewUser(p => ({ ...p, [f.key]: e.target.value }))}
                inputProps={{ maxLength: 8 }}
                sx={FIELD_SX} />
            </Box>
          ))}
          {createMsg && <Typography sx={{ fontSize: '0.75rem', color: '#f87171', mb: 1.5 }}>{createMsg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
            <Box onClick={() => setCreateOpen(false)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>Cancelar</Typography>
            </Box>
            <Box onClick={handleCreateUser} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.25)' } }}>
              {creating ? <CircularProgress size={14} sx={{ color: 'var(--accent,#60a5fa)' }} /> : <Typography sx={{ color: 'var(--accent,#60a5fa)', fontWeight: 700, fontSize: '0.82rem' }}>Crear usuario</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
