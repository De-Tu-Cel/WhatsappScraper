'use client'
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, startTransition } from 'react'
import { useUser } from '../context/UserContext'
import LoginScreen from '../components/LoginScreen'
import LoadingScreen from '../components/LoadingScreen'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
import Box from '@mui/material/Box'
import LinkIcon from '@mui/icons-material/Link'
import SearchIcon from '@mui/icons-material/Search'
import ListAltIcon from '@mui/icons-material/ListAlt'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import StorageIcon from '@mui/icons-material/Storage'
import ForumIcon from '@mui/icons-material/Forum'
import AnalyticsIcon from '@mui/icons-material/Analytics'
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend'
import Sidebar from '../components/Sidebar'
import dynamic from 'next/dynamic'
const SingleUrlProcessor = dynamic(() => import('../components/singleUrlProcessor'), { ssr: false })
const SearchProspects    = dynamic(() => import('../components/searchProspects'),    { ssr: false })
const BatchProcessor     = dynamic(() => import('../components/batchProcessor'),     { ssr: false })
const CsvImporter        = dynamic(() => import('../components/csvImporter'),        { ssr: false })
const DatabaseViewer     = dynamic(() => import('../components/databaseViewer'),     { ssr: false })
const Conversations      = dynamic(() => import('../components/conversations'),      { ssr: false })
const Analytics          = dynamic(() => import('../components/analytics'),          { ssr: false })
const ScheduledSends     = dynamic(() => import('../components/scheduledSends'),     { ssr: false })
const SendCampaign       = dynamic(() => import('../components/sendCampaign'),       { ssr: false })
const AdminPanel         = dynamic(() => import('../components/AdminPanel'),         { ssr: false })
const InstancesPanel     = dynamic(() => import('../components/InstancesPanel'),     { ssr: false })
const WarmupPanel        = dynamic(() => import('../components/WarmupPanel'),         { ssr: false })
import CampaignIcon from '@mui/icons-material/Campaign'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import RouterIcon from '@mui/icons-material/Router'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import Settings, { loadSettings, applySettings } from '../components/Settings'
import { useLang } from '../context/LangContext'
import AppTour from '../components/AppTour'
import TopControls from '../components/TopControls'
import AppearancePanel from '../components/AppearancePanel'
import NotificationsPanel from '../components/NotificationsPanel'
import HelpPanel from '../components/HelpPanel'
import BlacklistPanel from '../components/BlacklistPanel'
import BlockIcon from '@mui/icons-material/Block'
import { SendQueueProvider } from '../context/SendQueueContext'
import SendBubble from '../components/SendBubble'
import { NavigationProvider, useNavigation } from '../context/NavigationContext'

// Lazy-mount + memo: each tab mounts only on first visit, then stays mounted
// (hidden via display:none) so returning to it is instant. This prevents all
// 11 nav components from mounting simultaneously on page load.
// After 2s, remaining sections preload one-by-one (350ms apart) so their data
// fetches run in the background before the user ever clicks them.
const NavContent = React.memo(function NavContent({ items, active, settingsOpen, mounted }) {
  const visitedRef = useRef(new Set())
  const [, forceUpdate] = useState(0)
  if (mounted && !settingsOpen) visitedRef.current.add(active)

  useEffect(() => {
    if (!mounted) return
    const timers = items.map((_, i) => {
      if (visitedRef.current.has(i)) return null
      return setTimeout(() => {
        visitedRef.current.add(i)
        forceUpdate(c => c + 1)
      }, 2000 + i * 350)
    })
    return () => timers.forEach(t => t && clearTimeout(t))
  }, [mounted, items])

  return (
    <>
      {items.map((item, i) => {
        if (!visitedRef.current.has(i)) return null
        const isActive = mounted && !settingsOpen && active === i
        return (
          <Box key={i} sx={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {React.cloneElement(item.component, { isActive })}
          </Box>
        )
      })}
    </>
  )
})

const NAV_KEYS = [
  { key: 'single',    icon: <LinkIcon />,              component: <SingleUrlProcessor /> },
  { key: 'batch',     icon: <ListAltIcon />,            component: <BatchProcessor /> },
  { key: 'csv',       icon: <UploadFileIcon />,         component: <CsvImporter /> },
  { key: 'database',  icon: <StorageIcon />,            component: <DatabaseViewer /> },
  { key: 'search',    icon: <SearchIcon />,             component: <SearchProspects /> },
  { key: 'blacklist', icon: <BlockIcon />,              component: <BlacklistPanel /> },
  { key: 'convs',     icon: <ForumIcon />,              component: <Conversations /> },
  { key: 'analytics', icon: <AnalyticsIcon />,          component: <Analytics /> },
  { key: 'schedule',  icon: <ScheduleSendIcon />,       component: <ScheduledSends /> },
  { key: 'campaign',  icon: <CampaignIcon />,           component: <SendCampaign /> },
  { key: 'admin',     icon: <AdminPanelSettingsIcon />, component: <AdminPanel />,     adminOnly: true },
  { key: 'instances', icon: <RouterIcon />,                   component: <InstancesPanel />, adminOnly: true },
  { key: 'warmup',    icon: <LocalFireDepartmentIcon />,      component: <WarmupPanel />,    adminOnly: true },
]

export default function DashboardPage() {
  return (
    <NavigationProvider>
      <SendQueueProvider>
        <DashboardInner />
      </SendQueueProvider>
    </NavigationProvider>
  )
}

function DashboardInner() {
  const { user, loading: authLoading, showWarning, countdown, stayLoggedIn, logout } = useUser()
  const [hasUsers, setHasUsers]   = useState(true)
  const [active,       setActive]       = useState(0)
  const [open,         setOpen]         = useState(true)
  const [mounted,      setMounted]      = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Appearance, notifications, and help share the right-side dock — only one open at a time.
  const [rightPanel, setRightPanel] = useState(null) // 'appearance' | 'notifications' | 'help' | null
  const appearanceOpen = rightPanel === 'appearance'
  const notifOpen = rightPanel === 'notifications'
  const helpOpen = rightPanel === 'help'

  const { t } = useLang()
  const NAV_ITEMS = useMemo(
    () => NAV_KEYS.map(item => ({ ...item, label: t.nav[item.key] || item.key })),
    [t]
  )

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

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter(item => !item.adminOnly || user?.role === 'admin'),
    [NAV_ITEMS, user?.role]
  )

  const { setPendingConvId, setPendingConvNumber } = useNavigation()

  const handleNavClick      = useCallback((i) => { startTransition(() => { setActive(i); setSettingsOpen(false) }) }, [])
  const handleSettingsClick = useCallback(() => setSettingsOpen(s => !s), [])
  const toggleAppearance    = useCallback(() => setRightPanel(p => p === 'appearance' ? null : 'appearance'), [])
  const toggleNotifications = useCallback(() => setRightPanel(p => p === 'notifications' ? null : 'notifications'), [])
  const toggleHelp          = useCallback(() => setRightPanel(p => p === 'help' ? null : 'help'), [])
  const closeRightPanel     = useCallback(() => setRightPanel(null), [])

  const handleNavigateToConv = useCallback((companyId, number) => {
    const convIdx = visibleNavItems.findIndex(i => i.key === 'convs')
    if (convIdx === -1) return
    setPendingConvId(companyId)
    setPendingConvNumber(number || null)
    setRightPanel(null)
    startTransition(() => { setActive(convIdx); setSettingsOpen(false) })
  }, [visibleNavItems, setPendingConvId, setPendingConvNumber])

  const handleNavigateToSchedule = useCallback(() => {
    const schedIdx = visibleNavItems.findIndex(i => i.key === 'schedule')
    if (schedIdx === -1) return
    setRightPanel(null)
    startTransition(() => { setActive(schedIdx); setSettingsOpen(false) })
  }, [visibleNavItems])

  // ── Returns condicionales al final, tras todos los hooks ──
  if (authLoading) return <LoadingScreen />


  if (!user) return <LoginScreen hasUsers={hasUsers} />

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'var(--bg, #080c14)', backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.055) 1px, transparent 1px)', backgroundSize: '24px 24px', p: 1.5, gap: 1.5, boxSizing: 'border-box', position: 'relative' }}>

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
      <AppTour
        username={user?.username}
        navigate={handleNavClick}
        navKeys={visibleNavItems.map(i => i.key)}
      />
      <Sidebar
        open={open} setOpen={setOpen}
        active={mounted ? active : -1} setActive={handleNavClick}
        navItems={visibleNavItems}
        settingsOpen={settingsOpen}
        onSettingsClick={handleSettingsClick}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Box sx={{
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          border: '1px solid var(--border, rgba(255,255,255,0.06))',
          p: 4,
          // TopControls es un pill absoluto que flota sobre esta tarjeta (top: 3.2,
          // ver más abajo) — su borde/padding lo hace más alto que el simple ícono
          // suelto de antes, así que el padding superior normal (p:4) ya no alcanza
          // para que el contenido de cada panel (ej. el botón "Nuevo" de Admin) no
          // quede debajo de él. pt más grande reserva ese espacio para todos los paneles.
          pt: 9,
          display: 'flex', flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          color: 'var(--text, #f1f5f9)',
          background: `
            radial-gradient(circle, rgba(148,163,184,0.045) 1px, transparent 1px),
            linear-gradient(160deg, rgba(var(--accent-rgb, 59,130,246), 0.08) 0%, rgba(var(--accent-rgb, 59,130,246), 0.04) 35%, var(--card-bg, #161d2e) 65%)
          `,
          backgroundSize: '24px 24px, 100% 100%',
        }}>
          <Box sx={{
            position: 'absolute', top: -60, left: -60,
            width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(var(--accent-rgb, 99,102,241), 0.04) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }} />
          {/* TopControls: se desliza a la izquierda cuando un panel derecho está abierto */}
          <Box sx={{
            position: 'absolute', top: 3.2, zIndex: 6,
            // Panels have different widths (Appearance 340px, Notifications 360px) —
            // offset per panel so there's a consistent ~16px gap to its left edge
            // instead of reusing one value that left the icons pressed against
            // (or overlapping into) the wider Notifications panel.
            right: notifOpen ? 376 : appearanceOpen ? 356 : helpOpen ? 436 : 16,
            transition: 'right 0.25s cubic-bezier(0.4,0,0.2,1)',
            whiteSpace: 'nowrap',
          }}>
            <TopControls
              appearanceOpen={appearanceOpen} onToggleAppearance={toggleAppearance}
              notifOpen={notifOpen} onToggleNotifications={toggleNotifications}
              helpOpen={helpOpen} onToggleHelp={toggleHelp}
            />
          </Box>
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Settings panel */}
            <Box sx={{ display: settingsOpen ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <Settings />
            </Box>
            {/* Nav items — memo-wrapped so rightPanel state changes don't re-render the stack */}
            <NavContent items={visibleNavItems} active={active} settingsOpen={settingsOpen} mounted={mounted} />
          </Box>
          {/* Invisible click-catcher — closes whichever right panel is open when
              clicking anywhere outside it. Nothing inside those panels is lost on
              close: appearance saves per-click, and there's nothing else to persist. */}
          {rightPanel && (
            <Box onClick={() => setRightPanel(null)}
              sx={{ position: 'absolute', inset: 0, zIndex: 4 }} />
          )}
          <AppearancePanel open={appearanceOpen} onClose={closeRightPanel} />
          <NotificationsPanel open={notifOpen} onClose={closeRightPanel} onNavigateToConv={handleNavigateToConv} onNavigateToSchedule={handleNavigateToSchedule} />
          <HelpPanel open={helpOpen} onClose={closeRightPanel} />
        </Box>
      </Box>
      <SendBubble />
    </Box>
  )
}
