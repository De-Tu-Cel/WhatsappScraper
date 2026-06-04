'use client'
import { useState, useEffect, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import TextField from '@mui/material/TextField'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import PersonIcon from '@mui/icons-material/Person'
import LockResetIcon from '@mui/icons-material/LockReset'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useUser } from '../context/UserContext'

const token = () => typeof window !== 'undefined' ? localStorage.getItem('user_token') : ''

export default function AdminPanel() {
  const { user } = useUser()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [resetTarget, setResetTarget] = useState(null) // {id, username}
  const [newPin,  setNewPin]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

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

  async function toggleRole(u) {
    const newRole = u.role === 'admin' ? 'agent' : 'admin'
    try {
      await fetch('/api/auth/admin/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: u.id, role: newRole }),
      })
      fetchUsers()
    } catch {}
  }

  if (user?.role !== 'admin') return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography sx={{ color: 'rgba(255,255,255,0.3)' }}>Solo administradores pueden ver esta sección</Typography>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AdminPanelSettingsIcon sx={{ color: 'var(--accent,#a5b4fc)', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>Panel de administración</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>{users.length} usuario{users.length !== 1 ? 's' : ''} registrado{users.length !== 1 ? 's' : ''}</Typography>
          </Box>
        </Box>
        <Tooltip title="Actualizar">
          <Box onClick={fetchUsers} sx={{ cursor: 'pointer', color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'white' }, display: 'flex' }}>
            <RefreshIcon fontSize="small" />
          </Box>
        </Tooltip>
      </Box>

      {/* Lista de usuarios */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
            <CircularProgress size={28} sx={{ color: 'var(--accent,#6366f1)' }} />
          </Box>
        ) : users.map(u => (
          <Box key={u.id} sx={{
            display: 'flex', alignItems: 'center', gap: 2, p: 1.5,
            borderRadius: 2, bgcolor: 'var(--card-bg,#161d2e)',
            border: `1px solid ${u.id === user?.id ? 'rgba(var(--accent-rgb,59,130,246),0.25)' : 'rgba(255,255,255,0.07)'}`,
          }}>
            {/* Avatar */}
            <Box sx={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, bgcolor: u.role === 'admin' ? 'rgba(var(--accent-rgb,59,130,246),0.15)' : 'rgba(255,255,255,0.06)', border: `1.5px solid ${u.role === 'admin' ? 'rgba(var(--accent-rgb,59,130,246),0.3)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: u.role === 'admin' ? 'var(--accent,#60a5fa)' : 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{(u.display_name || u.username || '?')[0]}</Typography>
            </Box>

            {/* Info */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                <Typography sx={{ color: 'white', fontWeight: 600, fontSize: '0.85rem' }}>{u.display_name}</Typography>
                {u.id === user?.id && <Typography sx={{ fontSize: '0.6rem', color: 'var(--accent,#60a5fa)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', px: 0.8, py: 0.1, borderRadius: 1 }}>Tú</Typography>}
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>
                @{u.username} · {u.email || 'sin correo'}
              </Typography>
              {u.connected_number && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mt: 0.2 }}>
                  <PhoneAndroidIcon sx={{ fontSize: 11, color: '#4ade80' }} />
                  <Typography sx={{ color: '#4ade80', fontSize: '0.68rem', fontFamily: 'monospace' }}>{u.connected_number}</Typography>
                </Box>
              )}
            </Box>

            {/* Acciones */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
              {/* Rol */}
              <Tooltip title={u.id === user?.id ? 'No puedes cambiar tu propio rol' : `Cambiar a ${u.role === 'admin' ? 'Agente' : 'Admin'}`}>
                <Box onClick={() => u.id !== user?.id && toggleRole(u)} sx={{
                  px: 1, py: 0.3, borderRadius: 1.5,
                  cursor: u.id === user?.id ? 'default' : 'pointer',
                  bgcolor: u.role === 'admin' ? 'rgba(var(--accent-rgb,59,130,246),0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${u.role === 'admin' ? 'rgba(var(--accent-rgb,59,130,246),0.3)' : 'rgba(255,255,255,0.1)'}`,
                  opacity: u.id === user?.id ? 0.5 : 1,
                  '&:hover': u.id !== user?.id ? { opacity: 0.75 } : {},
                  transition: 'all 0.15s',
                }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: u.role === 'admin' ? 'var(--accent,#60a5fa)' : 'rgba(255,255,255,0.4)' }}>
                    {u.role === 'admin' ? '⭐ Admin' : '👤 Agente'}
                  </Typography>
                </Box>
              </Tooltip>

              {/* Reset PIN */}
              <Tooltip title="Resetear PIN">
                <Box onClick={() => { setResetTarget(u); setNewPin(''); setMsg('') }} sx={{
                  p: 0.6, borderRadius: 1.5, cursor: 'pointer',
                  bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center',
                  '&:hover': { bgcolor: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.3)', color: '#facc15' },
                  color: 'rgba(255,255,255,0.3)', transition: 'all 0.15s',
                }}>
                  <LockResetIcon sx={{ fontSize: 16 }} />
                </Box>
              </Tooltip>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Modal reset PIN */}
      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#161d2e)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 } } }}>
        <DialogContent sx={{ bgcolor: 'var(--card-bg,#161d2e)', py: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <LockResetIcon sx={{ color: '#facc15', fontSize: 20 }} />
            <Typography sx={{ color: 'white', fontWeight: 700 }}>Resetear PIN de {resetTarget?.username}</Typography>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', mb: 2 }}>
            El usuario deberá usar este PIN la próxima vez que inicie sesión.
          </Typography>
          <TextField fullWidth size="small" type="password" placeholder="Nuevo PIN (mínimo 4 dígitos)"
            value={newPin} onChange={e => setNewPin(e.target.value)} autoFocus
            inputProps={{ maxLength: 8, inputMode: 'numeric' }}
            sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', borderRadius: 2, '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&.Mui-focused fieldset': { borderColor: '#facc15' } }, '& input': { color: 'white' } }} />
          {msg && <Typography sx={{ fontSize: '0.75rem', color: msg.startsWith('✓') ? '#4ade80' : '#f87171', mb: 1 }}>{msg}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Box onClick={() => setResetTarget(null)} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' }}>Cancelar</Typography>
            </Box>
            <Box onClick={handleResetPin} sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', '&:hover': { bgcolor: 'rgba(251,191,36,0.2)' } }}>
              {saving ? <CircularProgress size={14} sx={{ color: '#facc15' }} /> : <Typography sx={{ color: '#facc15', fontWeight: 700, fontSize: '0.82rem' }}>Resetear PIN</Typography>}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
