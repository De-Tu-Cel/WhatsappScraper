'use client'
import { useState, useEffect, useLayoutEffect } from 'react'
import { useUser } from '../context/UserContext'
import LoginScreen from '../components/LoginScreen'
import CircularProgress from '@mui/material/CircularProgress'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
import Box from '@mui/material/Box'
import LinkIcon from '@mui/icons-material/Link'
import SearchIcon from '@mui/icons-material/Search'
import ListAltIcon from '@mui/icons-material/ListAlt'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import StorageIcon from '@mui/icons-material/Storage'
import ForumIcon from '@mui/icons-material/Forum'
import AnalyticsIcon from '@mui/icons-material/Analytics'
import Sidebar from '../components/Sidebar'
import dynamic from 'next/dynamic'
const SingleUrlProcessor = dynamic(() => import('../components/singleUrlProcessor'), { ssr: false })
import SearchProspects from '../components/searchProspects'
import BatchProcessor from '../components/batchProcessor'
import CsvImporter from '../components/csvImporter'
import DatabaseViewer from '../components/databaseViewer'
import Conversations from '../components/conversations'
import Analytics from '../components/analytics'
import AdminPanel from '../components/AdminPanel'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import Settings, { loadSettings, applySettings } from '../components/Settings'
import { useLang } from '../context/LangContext'

const NAV_KEYS = [
  { key: 'single',   icon: <LinkIcon />,              component: <SingleUrlProcessor /> },
  { key: 'batch',    icon: <ListAltIcon />,            component: <BatchProcessor /> },
  { key: 'csv',      icon: <UploadFileIcon />,         component: <CsvImporter /> },
  { key: 'database', icon: <StorageIcon />,            component: <DatabaseViewer /> },
  { key: 'search',   icon: <SearchIcon />,             component: <SearchProspects /> },
  { key: 'convs',    icon: <ForumIcon />,              component: <Conversations /> },
  { key: 'analytics',icon: <AnalyticsIcon />,          component: <Analytics /> },
  { key: 'admin',    icon: <AdminPanelSettingsIcon />, component: <AdminPanel />, adminOnly: true },
]

export default function DashboardPage() {
  const { user, loading: authLoading, showWarning, countdown, stayLoggedIn, logout } = useUser()
  const [hasUsers, setHasUsers]   = useState(true)
  const [active,       setActive]       = useState(0)
  const [open,         setOpen]         = useState(true)
  const [mounted,      setMounted]      = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { t } = useLang()
  const NAV_ITEMS = NAV_KEYS.map(item => ({ ...item, label: t.nav[item.key] || item.key }))

  // Verificar si hay usuarios registrados (para mostrar form de registro)
  useEffect(() => {
    fetch('/api/auth/users', { headers: { 'x-user-token': 'check' } })
      .then(r => {
        if (r.status === 401 || r.status === 403) return setHasUsers(true)
        if (!r.ok) return setHasUsers(false)
        return r.json().then(d => setHasUsers(Array.isArray(d) ? d.length > 0 : true))
      })
      .catch(() => setHasUsers(false))
  }, [])

  useIsomorphicLayoutEffect(() => {
    const saved = Number(localStorage.getItem('activeTab') ?? 0)
    setActive(saved)
    applySettings(loadSettings())
    setMounted(true)
  }, [])

  // Todos los hooks deben ir ANTES de cualquier return condicional
  useEffect(() => {
    if (mounted) localStorage.setItem('activeTab', active)
  }, [active, mounted])

  const visibleNavItems = NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin')

  // ── Returns condicionales al final, tras todos los hooks ──
  if (authLoading) return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'var(--bg,#080c14)' }}>
      <CircularProgress sx={{ color: 'var(--accent,#3b82f6)' }} />
    </Box>
  )

  if (!user) return <LoginScreen hasUsers={hasUsers} />

  function handleNavClick(i) {
    setActive(i)
    setSettingsOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'var(--bg, #080c14)', p: 1.5, gap: 1.5, boxSizing: 'border-box', position: 'relative' }}>

      {/* ── Inactivity warning banner ── */}
      {showWarning && (
        <Box sx={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 2,
          px: 3, py: 1.5, borderRadius: 3,
          bgcolor: 'rgba(15,20,35,0.97)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(251,191,36,0.4)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(251,191,36,0.15)',
          animation: 'fadeUp 0.3s ease',
        }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#facc15', boxShadow: '0 0 8px #facc1599', flexShrink: 0 }} />
          <Box>
            <Box sx={{ color: 'white', fontWeight: 700, fontSize: '0.88rem' }}>
              ¿Sigues ahí?
            </Box>
            <Box sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem' }}>
              Sesión cerrará en {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')} min
            </Box>
          </Box>
          <Box onClick={stayLoggedIn} sx={{
            px: 1.8, py: 0.6, borderRadius: 2, cursor: 'pointer', flexShrink: 0,
            bgcolor: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)',
            '&:hover': { bgcolor: 'rgba(251,191,36,0.28)' }, transition: 'all 0.15s',
          }}>
            <Box sx={{ color: '#facc15', fontWeight: 700, fontSize: '0.8rem' }}>Continuar</Box>
          </Box>
          <Box onClick={logout} sx={{
            px: 1.5, py: 0.6, borderRadius: 2, cursor: 'pointer', flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.1)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' }, transition: 'all 0.15s',
          }}>
            <Box sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>Cerrar sesión</Box>
          </Box>
        </Box>
      )}
      <Sidebar
        open={open} setOpen={setOpen}
        active={mounted ? active : -1} setActive={handleNavClick}
        navItems={visibleNavItems}
        settingsOpen={settingsOpen}
        onSettingsClick={() => setSettingsOpen(s => !s)}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Box sx={{
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          border: '1px solid var(--border, rgba(255,255,255,0.06))',
          p: 4,
          display: 'flex', flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          color: 'var(--text, #f1f5f9)',
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb, 59,130,246), 0.08) 0%, rgba(var(--accent-rgb, 59,130,246), 0.04) 35%, var(--card-bg, #161d2e) 65%)',
        }}>
          <Box sx={{
            position: 'absolute', top: -60, left: -60,
            width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(var(--accent-rgb, 99,102,241), 0.07) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }} />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Settings panel */}
            <Box sx={{ display: settingsOpen ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <Settings />
            </Box>
            {/* Nav items */}
            {visibleNavItems.map((item, i) => (
              <Box key={i} sx={{ display: mounted && !settingsOpen && active === i ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {item.component}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
