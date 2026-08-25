'use client'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'

// Vista de SOLO LECTURA de los números de una empresa, para la tabla/tarjetas
// de resultados — la selección real vive en RecipientsBox (panel de envío), así
// que esto ya no necesita checkbox ni ser clicable, solo informar de un vistazo
// cuántos números tiene esa empresa. Al pasar el mouse, se ven todos.
export default function WhatsAppNumberSummary({ row }) {
  const allNumbers = row.all_whatsapp?.length > 0 ? row.all_whatsapp : (row.whatsapp ? [row.whatsapp] : [])
  const primary = allNumbers[0]
  if (!primary) return null
  const extrasCount = allNumbers.length - 1

  const tooltip = (
    <Box sx={{ minWidth: 190, maxWidth: 240 }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.04em', px: 1, pt: 0.8, pb: 0.6 }}>
        {allNumbers.length} número{allNumbers.length !== 1 ? 's' : ''} encontrado{allNumbers.length !== 1 ? 's' : ''}
      </Typography>
      <Box sx={{
        display: 'flex', flexDirection: 'column', gap: 0.2,
        maxHeight: 160, overflowY: 'auto', px: 1, pb: 0.8,
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
      }}>
        {allNumbers.map(n => (
          <Typography key={n} sx={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.85)', py: 0.2 }}>
            {n}
          </Typography>
        ))}
      </Box>
    </Box>
  )

  return (
    <Tooltip title={tooltip} placement="right-start" arrow enterDelay={200}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', borderRadius: 1.5, p: 0, maxWidth: 'none',
          },
        },
        arrow: { sx: { color: 'var(--card-bg, #161d2e)', '&::before': { border: '1px solid rgba(255,255,255,0.1)' } } },
      }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'default' }}>
        <Chip
          icon={<WhatsAppIcon sx={{ fontSize: '11px !important', color: '#4ade80 !important' }} />}
          label={primary} size="small"
          sx={{
            height: 20, fontSize: '0.68rem',
            bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80',
            border: '1px solid rgba(34,197,94,0.2)',
            '& .MuiChip-label': { px: 0.7 },
          }} />
        {extrasCount > 0 && (
          <Chip label={`+${extrasCount}`} size="small"
            sx={{
              height: 20, fontSize: '0.65rem', fontWeight: 700,
              bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
              border: '1px solid rgba(255,255,255,0.1)',
              '& .MuiChip-label': { px: 0.5 },
            }} />
        )}
      </Box>
    </Tooltip>
  )
}
