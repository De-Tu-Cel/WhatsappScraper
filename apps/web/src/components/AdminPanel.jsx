'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import LockResetIcon from '@mui/icons-material/LockReset'
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

// Misma tarjeta unificada (anillo de progreso + label/valor) que ya usan
// Prospects y Analytics — reemplaza las 3 cajitas planas de antes, que se
// veían apagadas comparadas con el resto de la app.
function StatCard({ icon, color, value, label, percent }) {
  const pct = percent == null ? 100 : Math.max(0, Math.min(100, percent))
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
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
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

function StatsBarSkeleton() {
  return (
    <Box sx={{
      display: 'flex', overflow: 'hidden',
      borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
    }}>
      {[1, 2, 3].map(i => (
        <Fragment key={i}>
          {i > 1 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.6 }} />}
          <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
            <Skeleton variant="circular" width={40} height={40} sx={SKEL_SX} />
            <Box sx={{ minWidth: 0 }}>
              <Skeleton variant="text" width={30} sx={{ ...SKEL_SX, fontSize: '1.15rem' }} />
              <Skeleton variant="text" width={50} sx={{ ...SKEL_SX, fontSize: '0.66rem' }} />
            </Box>
          </Box>
        </Fragment>
      ))}
    </Box>
  )
}

const SKEL_SX = {
  bgcolor: 'var(--border)',
  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.04), transparent)' },
}

function UserCardSkeleton() {
  return (
    <Box sx={{
      borderRadius: 3, overflow: 'hidden',
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.025))',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column',
    }}>
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <Skeleton variant="rectangular" height={130} sx={SKEL_SX} />
        <Box component="svg" viewBox="0 0 144 62" preserveAspectRatio="none"
          sx={{ position: 'absolute', bottom: -1, left: 0, width: '100%', height: 60, color: 'var(--card-bg, #161d2e)' }}>
          <path
            d="m111.34 23.88c-10.62-10.46-18.5-23.88-38.74-23.88h-1.2c-20.24 0-28.12 13.42-38.74 23.88-7.72 9.64-19.44 11.74-32.66 12.12v26h144v-26c-13.22-.38-24.94-2.48-32.66-12.12z"
            fill="currentColor" fillRule="evenodd" />
        </Box>
        <Skeleton variant="circular" width={88} height={88} sx={{
          ...SKEL_SX, border: '4px solid rgba(226,232,240,0.9)',
          position: 'absolute', bottom: -44, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
        }} />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 6.5, pb: 2, px: 2, gap: 1 }}>
        <Skeleton variant="text" width={120} sx={{ ...SKEL_SX, fontSize: '1.05rem' }} />
        <Skeleton variant="text" width={60} sx={{ ...SKEL_SX, fontSize: '0.85rem' }} />
        <Skeleton variant="text" width={80} sx={{ ...SKEL_SX, fontSize: '0.78rem' }} />
        <Box sx={{ display: 'flex', gap: 1.5, mt: 0.5 }}>
          <Skeleton variant="circular" width={26} height={26} sx={SKEL_SX} />
          <Skeleton variant="circular" width={26} height={26} sx={SKEL_SX} />
        </Box>
      </Box>
      <Divider sx={{ borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)', mx: 2.5 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.8 }}>
        {[1, 2, 3].map(i => (
          <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Skeleton variant="text" width={44} sx={{ ...SKEL_SX, fontSize: '0.7rem' }} />
            <Skeleton variant="text" width={38} sx={{ ...SKEL_SX, fontSize: '1.02rem' }} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default function AdminPanel() {
  const { user } = useUser()
  const { t, lang } = useLang()
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexShrink: 0, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: 2, flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,99,102,241),0.22) 0%, rgba(var(--accent-rgb,99,102,241),0.08) 100%)',
            border: '1px solid rgba(var(--accent-rgb,99,102,241),0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AdminPanelSettingsIcon sx={{ color: 'var(--accent,#a5b4fc)', fontSize: 20 }} />
          </Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '1rem' }}>
            {t.admin.title}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Tooltip title={t.admin.newUserTip}>
            <Box onClick={() => { setCreateOpen(true); setCreateMsg('') }}
              sx={{
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.6,
                px: 1.4, py: 0.55, borderRadius: 2,
                bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)',
                border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
                color: 'var(--accent,#60a5fa)', transition: 'all 0.15s',
                '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.2)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
              }}>
              <PersonAddIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: '0.73rem', fontWeight: 600, color: 'inherit' }}>{t.admin.newUserBtn}</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={t.admin.refreshTip}>
            <IconButton size="small" onClick={fetchUsers}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--item-hover)' } }}>
              <RefreshIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Stats bar ── */}
      <Box sx={{ mb: 2, flexShrink: 0 }}>
        {loading ? (
          <StatsBarSkeleton />
        ) : (
          <Box sx={{
            display: 'flex', overflow: 'hidden',
            borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
            bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          }}>
            {[
              { key: 'total',  icon: <GroupIcon sx={{ fontSize: 18, color: '#60a5fa' }} />,  color: '#60a5fa', value: users.length, label: t.admin.statTotal,  percent: 100 },
              { key: 'admins', icon: <ShieldIcon sx={{ fontSize: 18, color: '#a78bfa' }} />, color: '#a78bfa', value: adminsCount,  label: t.admin.statAdmins, percent: users.length ? (adminsCount / users.length) * 100 : 0 },
              { key: 'agents', icon: <PersonIcon sx={{ fontSize: 18, color: '#34d399' }} />, color: '#34d399', value: agentsCount,  label: t.admin.statAgents, percent: users.length ? (agentsCount / users.length) * 100 : 0 },
            ].map(({ key, ...c }, i) => (
              <Fragment key={key}>
                {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.6 }} />}
                <StatCard {...c} />
              </Fragment>
            ))}
          </Box>
        )}
      </Box>

      {/* ── Búsqueda ── */}
      <Box sx={{ flexShrink: 0, mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1,
          px: 1.2, py: 0.7, borderRadius: 2,
          bgcolor: 'var(--card-bg)', border: '1px solid var(--border)',
          '&:focus-within': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, transition: 'border-color 0.15s',
        }}>
          <SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }} />
          <Box component="input"
            placeholder={t.admin.searchUsers || 'Buscar usuario…'}
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            sx={{ flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: '0.78rem',
              '&::placeholder': { color: 'var(--text-muted)', opacity: 0.7 } }}
          />
          {userSearch && (
            <Box onClick={() => setUserSearch('')}
              sx={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1,
                '&:hover': { color: 'var(--text)' }, userSelect: 'none' }}>×</Box>
          )}
        </Box>
      </Box>

      {/* ── Lista de usuarios ── */}
      <Box sx={{ flex: 1, overflowY: 'auto',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-button': { display: 'none' },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
      }}>
        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 2.5 }}>
            {Array.from({ length: 8 }).map((_, i) => <UserCardSkeleton key={i} />)}
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
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 2.5 }}>
            {visibleUsers.map(u => {
              const isMe    = u.id === user?.id
              const isAdmin = u.role === 'admin'
              const isConnected = !!u.is_connected
              const initial = (u.display_name || u.username || '?')[0].toUpperCase()
              // Derivados del acento elegido en Ajustes (var(--accent)/--accent-rgb)
              // en vez de colores sueltos (morado/cian/verde) que no cambiaban con
              // el theme — Admin usa el acento tal cual, User una versión mezclada
              // con gris (misma familia, pero distinguible), así los dos se
              // actualizan solos si cambia el color base elegido en Ajustes.
              // "isMe" ya se distingue aparte con el chip "You".
              const roleSolid = isAdmin ? 'var(--accent, #3b82f6)' : 'color-mix(in srgb, var(--accent, #3b82f6) 55%, #94a3b8 45%)'
              const roleColor = (alpha) => isAdmin
                ? `rgba(var(--accent-rgb, 59,130,246), ${alpha})`
                : `color-mix(in srgb, ${roleSolid} ${Math.round(alpha * 100)}%, transparent)`
              const since = u.created_at
                ? new Date(u.created_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { month: 'short', year: 'numeric' })
                : '—'
              return (
                <Box key={u.id} sx={{
                  borderRadius: 3, overflow: 'hidden',
                  bgcolor: 'var(--card-bg, rgba(255,255,255,0.025))',
                  border: `1px solid ${roleColor(0.27)}`,
                  boxShadow: `0 0 18px ${roleColor(0.09)}, 0 2px 10px rgba(0,0,0,0.15)`,
                  display: 'flex', flexDirection: 'column',
                  transition: 'box-shadow 0.2s, border-color 0.2s',
                  '&:hover': {
                    borderColor: roleColor(0.47),
                    boxShadow: `0 0 28px ${roleColor(0.19)}, 0 6px 20px rgba(0,0,0,0.2)`,
                  },
                }}>
                  {/* Cover + avatar viven en el mismo contenedor relative, con el
                     avatar posicionado absolute (no con margin negativo) y un
                     z-index explícito — así queda garantizado que el avatar se
                     dibuja completo y por encima del cover, sin depender de que
                     el orden de flujo/overflow lo recorte a la mitad. */}
                  <Box sx={{ position: 'relative', flexShrink: 0 }}>
                    <Box sx={{
                      height: 130, overflow: 'hidden',
                      background: `linear-gradient(160deg, ${roleColor(0.27)} 0%, rgba(10,14,22,0.95) 80%)`,
                    }}>
                      {/* "Ola" (mismo path que el template de referencia) — pinta
                         de var(--card-bg) la franja donde se asienta el avatar,
                         así no importa qué tan brillante sea el degradado de
                         arriba, esa franja siempre da el mismo color que el
                         contenido de la tarjeta. */}
                      <Box component="svg" viewBox="0 0 144 62" preserveAspectRatio="none"
                        sx={{ position: 'absolute', bottom: -1, left: 0, width: '100%', height: 60, color: 'var(--card-bg, #161d2e)' }}>
                        <path
                          d="m111.34 23.88c-10.62-10.46-18.5-23.88-38.74-23.88h-1.2c-20.24 0-28.12 13.42-38.74 23.88-7.72 9.64-19.44 11.74-32.66 12.12v26h144v-26c-13.22-.38-24.94-2.48-32.66-12.12z"
                          fill="currentColor" fillRule="evenodd" />
                      </Box>
                    </Box>

                    <Box sx={{
                      position: 'absolute', bottom: -44, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
                      width: 88, height: 88, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${roleColor(0.21)} 0%, ${roleColor(0.07)} 100%)`,
                      border: '4px solid rgba(226,232,240,0.9)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                    }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '1.8rem', color: roleSolid, textTransform: 'uppercase' }}>
                        {initial}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Info — con suficiente padding arriba para dejar libre el
                     espacio que ocupa el avatar sobresaliendo del cover. */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 6.5, pb: 2, px: 2, gap: 0.4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '1.05rem', textAlign: 'center', lineHeight: 1.3 }}>
                        {u.display_name}
                      </Typography>
                      {isMe && (
                        <Chip label={t.admin.you} size="small" sx={{ height: 18, fontSize: '0.62rem', fontWeight: 700, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', color: 'var(--accent,#60a5fa)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', '& .MuiChip-label': { px: 0.7 } }} />
                      )}
                    </Box>

                    {/* Rol — clickeable, funciona como el subtítulo tipo "CEO"/"CTO" */}
                    <Tooltip title={isMe ? t.admin.unchangeable : `${t.admin.changeTo} ${isAdmin ? t.admin.user : t.admin.admin}`}>
                      <Typography onClick={() => !isMe && toggleRole(u)} sx={{
                        fontSize: '0.85rem', fontWeight: 600, color: roleSolid,
                        cursor: isMe ? 'default' : 'pointer', opacity: isMe ? 0.75 : 1,
                        '&:hover': !isMe ? { textDecoration: 'underline' } : {},
                      }}>
                        {isAdmin ? t.admin.admin : t.admin.user}
                      </Typography>
                    </Tooltip>

                    <Tooltip title={u.email || ''} placement="top" disableHoverListener={!u.email}>
                      <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.45))', fontSize: '0.78rem', textAlign: 'center' }}>
                        @{u.username}
                      </Typography>
                    </Tooltip>

                    {/* Acciones — fila de íconos, mismo lugar que ocuparían los íconos sociales */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.2 }}>
                      <Tooltip title={t.admin.resetPinBtn}>
                        <IconButton onClick={() => { setResetTarget(u); setNewPin(''); setMsg('') }}
                          sx={{ color: 'rgba(251,191,36,0.55)', borderRadius: 1.5, '&:hover': { color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.12)' } }}>
                          <LockResetIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                      {!isMe && (
                        <Tooltip title={t.admin.deleteTitle}>
                          <IconButton onClick={() => { setDeleteTarget(u); setDeleteMsg('') }}
                            sx={{ color: 'rgba(239,68,68,0.5)', borderRadius: 1.5, '&:hover': { color: '#f87171', bgcolor: 'rgba(239,68,68,0.12)' } }}>
                            <DeleteForeverIcon sx={{ fontSize: 20 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>

                  <Divider sx={{ borderStyle: 'dashed', borderColor: roleColor(0.15), mx: 2.5 }} />

                  {/* Footer — datos reales del usuario en vez de métricas inventadas */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.8, mt: 'auto' }}>
                    <Box sx={{ textAlign: 'center', flex: 1 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.4))' }}>{t.admin.role}</Typography>
                      <Typography sx={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text)' }}>{isAdmin ? t.admin.admin : t.admin.user}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', flex: 1 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.4))' }}>{t.admin.connected}</Typography>
                      <Typography sx={{ fontSize: '1.02rem', fontWeight: 700, color: isConnected ? '#4ade80' : 'var(--text-muted, rgba(255,255,255,0.35))' }}>
                        {isConnected ? t.common.yes : t.common.no}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'center', flex: 1 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.4))' }}>{t.admin.since}</Typography>
                      <Typography sx={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text)' }}>{since}</Typography>
                    </Box>
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
        slotProps={{ paper: { sx: {
          background: 'var(--sidebar-bg, #0d1117)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.85)', overflow: 'hidden',
        } } }}>
        <DialogTitle sx={{ p: 0, bgcolor: 'var(--surface, #111827)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <Box sx={{ px: 3, pt: 3, pb: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PersonAddIcon sx={{ color: 'var(--accent, #60a5fa)', fontSize: 22 }} />
            </Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', flex: 1 }}>{t.admin.createTitle}</Typography>
            <IconButton size="small" onClick={handleCloseCreate} sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ px: 3, pt: 3.5, pb: 1, bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
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
          <Typography sx={{ fontSize: '0.68rem', color: pin2Touched && !pinsMatch ? '#f87171' : 'rgba(255,255,255,0.25)', mb: 1 }}>
            {pin2Touched && !pinsMatch ? t.admin.pinMismatch : t.admin.pinHint}
          </Typography>

          {createMsg && (
            <Box sx={{ mb: 1.5, px: 1.2, py: 0.8, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{createMsg}</Typography>
            </Box>
          )}
        </DialogContent>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }} />

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, gap: 1 }}>
          <Button onClick={handleCloseCreate} disabled={creating} sx={{ color: 'rgba(255,255,255,0.5)', borderRadius: 2, textTransform: 'none' }}>
            {t.admin.cancelBtn}
          </Button>
          <Button onClick={handleCreateUser} disabled={creating || !canSubmit} variant="contained"
            startIcon={creating ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <PersonAddIcon sx={{ fontSize: '16px !important' }} />}
            sx={{ bgcolor: 'var(--accent,#3b82f6)', borderRadius: 2, fontWeight: 700, textTransform: 'none', '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.9)' } }}>
            {t.admin.createBtn}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
