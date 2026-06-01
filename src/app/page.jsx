'use client'
import { useState, useEffect, useLayoutEffect } from 'react'

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
import Settings, { loadSettings, applySettings } from '../components/Settings'

const NAV_ITEMS = [
  { label: 'URL Individual',    icon: <LinkIcon />,       component: <SingleUrlProcessor /> },
  { label: 'Lote (URLs)',       icon: <ListAltIcon />,    component: <BatchProcessor /> },
  { label: 'Importar CSV',      icon: <UploadFileIcon />, component: <CsvImporter /> },
  { label: 'Base de datos',     icon: <StorageIcon />,    component: <DatabaseViewer /> },
  { label: 'Buscar Prospectos', icon: <SearchIcon />,     component: <SearchProspects /> },
  { label: 'Conversaciones',    icon: <ForumIcon />,      component: <Conversations /> },
  { label: 'Análisis',          icon: <AnalyticsIcon />,  component: <Analytics /> },
]

export default function DashboardPage() {
  const [active,       setActive]       = useState(0)
  const [open,         setOpen]         = useState(true)
  const [mounted,      setMounted]      = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const saved = Number(localStorage.getItem('activeTab') ?? 0)
    setActive(saved)
    applySettings(loadSettings())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) localStorage.setItem('activeTab', active)
  }, [active, mounted])

  function handleNavClick(i) {
    setActive(i)
    setSettingsOpen(false)
  }

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'var(--bg, #080c14)', p: 1.5, gap: 1.5, boxSizing: 'border-box' }}>
      <Sidebar
        open={open} setOpen={setOpen}
        active={mounted ? active : -1} setActive={handleNavClick}
        navItems={NAV_ITEMS}
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
            {NAV_ITEMS.map((item, i) => (
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
