'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import LinkIcon from '@mui/icons-material/Link'
// import SearchIcon from '@mui/icons-material/Search'   // Prospectos — comentado temporalmente
import ListAltIcon from '@mui/icons-material/ListAlt'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import StorageIcon from '@mui/icons-material/Storage'
import Sidebar from '../components/Sidebar'
import dynamic from 'next/dynamic'
const SingleUrlProcessor = dynamic(() => import('../components/singleUrlProcessor'), { ssr: false })
// import SearchProspects from '../components/searchProspects'  // comentado temporalmente
import BatchProcessor from '../components/batchProcessor'
import CsvImporter from '../components/csvImporter'
import DatabaseViewer from '../components/databaseViewer'

const NAV_ITEMS = [
  { label: 'URL Individual', icon: <LinkIcon />,       component: <SingleUrlProcessor /> },
  { label: 'Lote (URLs)',    icon: <ListAltIcon />,    component: <BatchProcessor /> },
  { label: 'Importar CSV',  icon: <UploadFileIcon />, component: <CsvImporter /> },
  { label: 'Base de datos', icon: <StorageIcon />,    component: <DatabaseViewer /> },
  // { label: 'Buscar Prospectos', icon: <SearchIcon />, component: <SearchProspects /> },
]

export default function DashboardPage() {
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(true)

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#080c14', p: 1.5, gap: 1.5 }}>
      <Sidebar open={open} setOpen={setOpen} active={active} setActive={setActive} navItems={NAV_ITEMS} />

      <Box sx={{ flexGrow: 1, overflow: 'hidden', minWidth: 0 }}>
        <Box sx={{
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 4,
          display: 'flex', flexDirection: 'column',
          flexGrow: 1,
          minHeight: 0,
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(160deg, rgba(59,130,246,0.11) 0%, rgba(139,92,246,0.07) 35%, #161d2e 65%)',
        }}>
          {/* brillo radial esquina superior */}
          <Box sx={{
            position: 'absolute', top: -60, left: -60,
            width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }} />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {NAV_ITEMS[active].component}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
