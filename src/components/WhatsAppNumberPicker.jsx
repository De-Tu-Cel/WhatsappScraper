'use client'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import Checkbox from '@mui/material/Checkbox'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useLang } from '../context/LangContext'

// Construye los 3 handlers que WhatsAppNumberPicker espera, a partir del estado
// que ya vive en cada componente (Sets de React) — evita repetir esta misma
// lógica de toggle cada vez que se renderiza un picker (tabla, tarjeta, y ahora
// también el recuadro compacto de RecipientsBox).
export function makeWaToggleHandlers(companyId, { effectiveSelected, setDeselected, setExpandedCo, setExtraSelected }) {
  return {
    onToggleCompany: () => setDeselected(prev => {
      const next = new Set(prev)
      effectiveSelected.has(companyId) ? next.add(companyId) : next.delete(companyId)
      return next
    }),
    onToggleExpand: () => setExpandedCo(prev => {
      const next = new Set(prev)
      next.has(companyId) ? next.delete(companyId) : next.add(companyId)
      return next
    }),
    onToggleExtra: key => setExtraSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    }),
  }
}

// Selector interactivo de números por empresa — checkbox para el principal +
// flecha para desplegar los demás números de esa empresa (cada uno con su
// propio checkbox). Un solo componente reusado dentro de una <TableCell>, una
// tarjeta, o el recuadro compacto de RecipientsBox, para no repetir este
// bloque una vez por archivo.
export default function WhatsAppNumberPicker({
  row, selected, expanded, extraSelected, label,
  onToggleCompany, onToggleExpand, onToggleExtra,
}) {
  const { lang } = useLang()
  const primary = row.all_whatsapp?.length > 0 ? row.all_whatsapp[0] : row.whatsapp
  if (!primary) return null
  const extras = row.all_whatsapp?.slice(1) || []
  const key = n => `${row.company_id}::${n}`
  // Con `label` (uso en RecipientsBox), el número principal se esconde detrás
  // del contador de la flecha si hay más de uno — así el nombre de la empresa
  // se queda con todo el ancho en vez de competir con el chip del número.
  const collapseNumber = !!label && extras.length > 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1 }}>
        <Checkbox size="small" checked={selected} onChange={onToggleCompany}
          sx={{ p: 0.3, color: 'rgba(255,255,255,0.25)', '&.Mui-checked': { color: '#4ade80' } }} />
        {label && (
          <Typography sx={{
            flex: 1, minWidth: 0, fontSize: '0.75rem', mr: 0.6,
            color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</Typography>
        )}
        {!collapseNumber && (
          <Chip
            icon={<WhatsAppIcon sx={{ fontSize: '11px !important', color: selected ? '#4ade80 !important' : 'rgba(255,255,255,0.25) !important' }} />}
            label={primary} size="small"
            sx={{
              height: 20, fontSize: '0.68rem',
              bgcolor: selected ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
              color:   selected ? '#4ade80'              : 'rgba(255,255,255,0.3)',
              border: `1px solid ${selected ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`,
              '& .MuiChip-label': { px: 0.7 },
            }} />
        )}
        {extras.length > 0 && (
          <Chip onClick={onToggleExpand} size="small"
            label={collapseNumber ? `${extras.length + 1}` : `+${extras.length}`}
            title={lang === 'en' ? `View all ${extras.length + 1} numbers for this company` : `Ver los ${extras.length + 1} números de esta empresa`}
            icon={<ExpandMoreIcon sx={{ fontSize: '14px !important', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
            sx={{
              height: 20, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
              bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(255,255,255,0.15)',
              '& .MuiChip-icon': { color: 'rgba(255,255,255,0.5)', ml: 0.4 },
              '& .MuiChip-label': { px: 0.5 },
              '&:hover': { bgcolor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' },
            }} />
        )}
      </Box>
      {expanded && (
        <>
          {collapseNumber && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1, pl: 2.6 }}>
              <Checkbox size="small" checked={selected} onChange={onToggleCompany}
                sx={{ p: 0.2, color: 'rgba(255,255,255,0.2)', '&.Mui-checked': { color: '#4ade80' } }} />
              <Chip label={primary} size="small"
                sx={{
                  height: 18, fontSize: '0.62rem',
                  bgcolor: selected ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
                  color:   selected ? '#4ade80'              : 'rgba(255,255,255,0.25)',
                  border: `1px solid ${selected ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  '& .MuiChip-label': { px: 0.6 },
                }} />
            </Box>
          )}
          {extras.map(n => {
            const on = extraSelected.has(key(n))
            return (
              <Box key={n} sx={{ display: 'flex', alignItems: 'center', gap: 0.1, pl: 2.6 }}>
                <Checkbox size="small" checked={on} onChange={() => onToggleExtra(key(n))}
                  sx={{ p: 0.2, color: 'rgba(255,255,255,0.2)', '&.Mui-checked': { color: '#4ade80' } }} />
                <Chip label={n} size="small"
                  sx={{
                    height: 18, fontSize: '0.62rem',
                    bgcolor: on ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
                    color:   on ? '#4ade80'             : 'rgba(255,255,255,0.25)',
                    border: `1px solid ${on ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)'}`,
                    '& .MuiChip-label': { px: 0.6 },
                  }} />
              </Box>
            )
          })}
        </>
      )}
    </Box>
  )
}
