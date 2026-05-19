'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import LinkIcon from '@mui/icons-material/Link'
// import SearchIcon from '@mui/icons-material/Search'   // Prospectos — comentado temporalmente
import ListAltIcon from '@mui/icons-material/ListAlt'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import Sidebar from '../components/Sidebar'
import SingleUrlProcessor from '../components/singleUrlProcessor'
// import SearchProspects from '../components/searchProspects'  // comentado temporalmente
import BatchProcessor from '../components/batchProcessor'
import CsvImporter from '../components/csvImporter'

const NAV_ITEMS = [
  { label: 'URL Individual', icon: <LinkIcon />,       component: <SingleUrlProcessor /> },
  { label: 'Lote (URLs)',    icon: <ListAltIcon />,    component: <BatchProcessor /> },
  { label: 'Importar CSV',  icon: <UploadFileIcon />, component: <CsvImporter /> },
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
          bgcolor: '#161d2e',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 4,
          display: 'flex', flexDirection: 'column',
          flexGrow: 1,          // ← agrega
          minHeight: 0,         // ← cambia
          height: '100%',       // ← agrega
        }}>
          {NAV_ITEMS[active].component}
        </Box>
      </Box>
    </Box>
  )
}
