'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import WhatsAppNumberPicker, { makeWaToggleHandlers } from './WhatsAppNumberPicker'

// Recuadro compacto de destinatarios, para vivir junto a Plantillas de mensaje
// en el mismo panel — antes había que bajar hasta la tabla/tarjetas de
// resultados para saber a quién se le iba a enviar; ahora está al lado.
// Mismo estado que la tabla (effectiveSelected/expandedCo/extraSelected), así
// que marcar aquí o allá es exactamente lo mismo — una sola fuente de verdad.
export default function RecipientsBox({
  rows, effectiveSelected, expandedCo, extraSelected,
  setDeselected, setExpandedCo, setExtraSelected,
  title, maxHeight = 260, sx,
}) {
  if (!rows.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, mb: 0.8 }}>
        {title} — {effectiveSelected.size} de {rows.length}
      </Typography>
      <Box sx={{
        display: 'flex', flexDirection: 'column', maxHeight, overflowY: 'auto', pr: 0.5,
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 0.5,
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        {rows.map(r => {
          const handlers = makeWaToggleHandlers(r.company_id, { effectiveSelected, setDeselected, setExpandedCo, setExtraSelected })
          return (
            <Box key={r.company_id} sx={{
              borderRadius: 1, px: 0.5, py: 0.2,
              transition: 'background-color 0.15s',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
            }}>
              <WhatsAppNumberPicker row={r}
                label={r.empresa || r.url}
                selected={effectiveSelected.has(r.company_id)}
                expanded={expandedCo.has(r.company_id)}
                extraSelected={extraSelected}
                {...handlers} />
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
