'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import WhatsAppNumberPicker, { makeWaToggleHandlers } from './WhatsAppNumberPicker'
import { useLang } from '../context/LangContext'
import { useBlacklistedPhones, phoneKey } from '../lib/phoneBlacklist'

function flagReason(r, lang) {
  const lm = r.location_mismatch, im = r.industry_mismatch
  const en = lang === 'en'
  if (lm) return en ? `Outside the searched area: ${lm.detected_city || lm.detected_state}` : `Fuera de la zona buscada: ${lm.detected_city || lm.detected_state}`
  if (im) return en ? `Other trade: ${im.detected_industry}` : `Otro giro: ${im.detected_industry}`
  return ''
}

export default function RecipientsBox({
  rows, effectiveSelected, expandedCo, extraSelected,
  setSelected, setExpandedCo, setExtraSelected,
  title, emptyMsg, maxHeight = 260, sx,
}) {
  const { lang } = useLang()
  const blocked = useBlacklistedPhones()
  const selectedCount = rows.filter(r => effectiveSelected.has(r.company_id)).length
  // "todos" leaves out results flagged as outside the searched area or trade
  // — they can still be ticked one by one — and companies whose number is
  // blocked (those can't be ticked at all).
  const selectable = rows.filter(r => !flagReason(r, lang) && !blocked.has(phoneKey(r.all_whatsapp?.[0] || r.whatsapp)))
  const allSelected = selectable.length > 0 && selectable.every(r => effectiveSelected.has(r.company_id))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...sx }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
        <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
          {title}
        </Typography>
        {rows.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography sx={{ fontSize: '0.65rem', color: selectedCount > 0 ? '#4ade80' : 'rgba(255,255,255,0.25)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {selectedCount}/{rows.length}
            </Typography>
            <Typography
              onClick={() => allSelected
                ? setSelected(new Set())
                : setSelected(new Set(selectable.map(r => r.company_id)))
              }
              sx={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', userSelect: 'none',
                '&:hover': { color: '#4ade80' }, transition: 'color 0.15s' }}
            >
              {allSelected ? (lang === 'en' ? 'none' : 'ninguno') : (lang === 'en' ? 'all' : 'todos')}
            </Typography>
          </Box>
        )}
      </Box>

      {rows.length === 0 ? (
        /* Empty state */
        <Box sx={{
          border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 1.5, p: 1.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', textAlign: 'center', fontStyle: 'italic' }}>
            {emptyMsg || (lang === 'en' ? 'No companies in this filter' : 'Sin empresas en este filtro')}
          </Typography>
        </Box>
      ) : (
        /* Selection list */
        <Box sx={{
          display: 'flex', flexDirection: 'column', maxHeight, overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.13)', borderRadius: 1.5,
          bgcolor: 'rgba(255,255,255,0.015)',
          scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
          '&::-webkit-scrollbar': { width: 3 },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
        }}>
          {/* Selection hint */}
          <Box sx={{ px: 1, pt: 0.8, pb: 0.4, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Typography sx={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.03em' }}>
              {lang === 'en' ? '✓ Select the numbers to send' : '✓ Selecciona los números a enviar'}
            </Typography>
          </Box>
          <Box sx={{ p: 0.5 }}>
            {rows.map(r => {
              const handlers = makeWaToggleHandlers(r.company_id, { effectiveSelected, setSelected, setExpandedCo, setExtraSelected })
              const isSelected = effectiveSelected.has(r.company_id)
              const isContactedRow = !!r.already_contacted?.contacted
              const selBg     = isContactedRow ? 'rgba(251,191,36,0.05)' : 'rgba(34,197,94,0.05)'
              const selBgHov  = isContactedRow ? 'rgba(251,191,36,0.09)' : 'rgba(34,197,94,0.08)'
              const selBorder = isContactedRow ? 'rgba(251,191,36,0.4)'  : 'rgba(34,197,94,0.35)'
              return (
                <Box key={r.company_id} sx={{
                  borderRadius: 1, px: 0.5, py: 0.3,
                  transition: 'background-color 0.15s',
                  bgcolor: isSelected ? selBg : 'transparent',
                  borderLeft: `2px solid ${isSelected ? selBorder : 'transparent'}`,
                  '&:hover': { bgcolor: isSelected ? selBgHov : 'rgba(255,255,255,0.04)' },
                }}>
                  <WhatsAppNumberPicker row={r}
                    labelTitle={[r.empresa || r.url, r.city].filter(Boolean).join(' · ')}
                    label={flagReason(r, lang) ? (
                      <>
                        <Tooltip title={flagReason(r, lang)} placement="top" arrow>
                          <WarningAmberIcon sx={{ fontSize: 12, color: '#fbbf24', verticalAlign: '-2px', mr: 0.4 }} />
                        </Tooltip>
                        {r.empresa || r.url}
                      </>
                    ) : (r.empresa || r.url)}
                    selected={isSelected}
                    expanded={expandedCo.has(r.company_id)}
                    extraSelected={extraSelected}
                    {...handlers} />
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
    </Box>
  )
}
