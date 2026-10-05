'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import BlockIcon from '@mui/icons-material/Block'
import { useLang } from '../context/LangContext'
import { useBlacklistedPhones, toggleBlacklistedPhone, phoneKey, digitsOnly } from '../lib/phoneBlacklist'
import MarqueeText from './MarqueeText'

// Blocked numbers live in a shared store (lib/phoneBlacklist.js) — re-exported
// here because several screens import them from this file.
export { useBlacklistedPhones, toggleBlacklistedPhone, digitsOnly } from '../lib/phoneBlacklist'

// A disabled MUI Checkbox alone doesn't explain WHY — wrap it with the
// reason so a hover actually tells the user this number is blocked instead
// of just looking greyed out for no visible reason.
function MaybeBlockedCheckbox({ blocked, lang, ...props }) {
  const cb = <Checkbox size="small" {...props} />
  if (!blocked) return cb
  const reason = lang === 'en' ? 'Blocked number — unblock it to select it' : 'Número bloqueado — desbloquéalo para poder seleccionarlo'
  return <Tooltip title={reason}><span>{cb}</span></Tooltip>
}

// Construye los 3 handlers que WhatsAppNumberPicker espera, a partir del estado
// que ya vive en cada componente (Sets de React) — evita repetir esta misma
// lógica de toggle cada vez que se renderiza un picker (tabla, tarjeta, y ahora
// también el recuadro compacto de RecipientsBox).
export function makeWaToggleHandlers(companyId, { effectiveSelected, setSelected, setExpandedCo, setExtraSelected }) {
  return {
    onToggleCompany: () => setSelected(prev => {
      const next = new Set(prev)
      effectiveSelected.has(companyId) ? next.delete(companyId) : next.add(companyId)
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
  row, selected, expanded, extraSelected, label, labelTitle,
  onToggleCompany, onToggleExpand, onToggleExtra,
}) {
  const { lang } = useLang()
  const en = lang === 'en'
  // Must run before any early return — React hooks can't be conditional.
  const blacklistMap = useBlacklistedPhones()
  const [confirmAll, setConfirmAll] = useState(false)
  const primary = row.all_whatsapp?.length > 0 ? row.all_whatsapp[0] : row.whatsapp
  if (!primary) return null
  const extras = row.all_whatsapp?.slice(1) || []
  const key = n => `${row.company_id}::${n}`
  // Normalize phone numbers: strip leading +, collapse 521XXXXXXXXXX → 52XXXXXXXXXX
  const normNum = n => { if (!n) return ''; let s = String(n).replace(/^\+/, ''); return s.replace(/^521(\d{10})$/, '52$1') }
  const contactedNormed = new Set((row.already_contacted?.contacted_numbers || []).map(normNum))
  const isContacted = n => contactedNormed.has(normNum(n))
  // Compared by phoneKey (last 10 digits) — same rule as the backend, so a
  // number blocked as 52… also matches 521… / +52….
  const blacklistEntryId = n => blacklistMap.get(phoneKey(n))
  const isBlacklisted = n => blacklistMap.has(phoneKey(n))
  // Blacklisted (red) always wins over contacted (yellow) — "can't interact
  // with them" is a stronger signal than "already reached out".
  const numberStyle = (n, isSelected) => {
    const blocked = isBlacklisted(n)
    const contacted = isContacted(n)
    const color  = blocked ? '#ef4444' : contacted ? '#fbbf24' : '#4ade80'
    const bg     = blocked ? 'rgba(239,68,68,0.14)' : contacted ? 'rgba(251,191,36,0.12)' : 'rgba(34,197,94,0.1)'
    const border = blocked ? 'rgba(239,68,68,0.4)'  : contacted ? 'rgba(251,191,36,0.3)'  : 'rgba(34,197,94,0.2)'
    const idleBorder = blocked ? 'rgba(239,68,68,0.3)' : contacted ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.08)'
    const idleColor  = blocked ? 'rgba(239,68,68,0.75)' : contacted ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.3)'
    return {
      color: isSelected ? color : idleColor,
      bg: isSelected ? bg : 'rgba(255,255,255,0.04)',
      borderColor: isSelected ? border : idleBorder,
      checkboxColor: blocked ? 'rgba(239,68,68,0.35)' : contacted ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.25)',
      checkedColor: color,
    }
  }
  const BlockToggle = ({ n }) => {
    const blocked = isBlacklisted(n)
    return (
      <Tooltip title={blocked
        ? (lang === 'en' ? 'Unblock this number' : 'Desbloquear este número')
        : (lang === 'en' ? 'Block this number — no outreach will be sent to it' : 'Bloquear este número — no se le enviará ningún mensaje')}>
        <IconButton size="small"
          onClick={async (e) => {
            e.stopPropagation()
            const nowBlocked = await toggleBlacklistedPhone(n, blacklistEntryId(n))
            // Blocking used to only grey the checkbox — the number stayed selected
            // and was still sent. Take it out of the selection too.
            if (nowBlocked) {
              if (n === primary && selected) onToggleCompany()
              else if (extraSelected.has(key(n))) onToggleExtra(key(n))
            }
          }}
          sx={{ p: 0.25, color: blocked ? '#ef4444' : 'rgba(255,255,255,0.2)', '&:hover': { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.1)' } }}>
          <BlockIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    )
  }
  // Con `label` (uso en RecipientsBox), el número principal se esconde detrás
  // del contador de la flecha si hay más de uno — así el nombre de la empresa
  // se queda con todo el ancho en vez de competir con el chip del número.
  const collapseNumber = !!label && extras.length > 0

  // By default only the first number is sent (each extra uses its own
  // new-contact slot, and one business messaged on 3 lines looks like spam).
  // The company checkbox therefore means "this company, first number" — the
  // counter, the checked boxes and the explicit "select all" make that visible
  // instead of it reading like a broken select-all. (A "principal" tag on that
  // number read like "the business's official number" — removed.)
  const totalNumbers = extras.length + 1
  const selectableExtras = extras.filter(n => !isBlacklisted(n))
  const extrasOn = selected ? extras.filter(n => extraSelected.has(key(n))).length : 0
  const selectedNumbers = (selected ? 1 : 0) + extrasOn
  const allOn = selected && selectableExtras.every(n => extraSelected.has(key(n)))
  // Mexican area code of a number (2 digits for CDMX/GDL/MTY, else 3) — several
  // of them on one "company" usually means a directory listing other businesses.
  const lada = n => {
    const d = digitsOnly(n)
    const nat = d.length === 12 && d.startsWith('52') ? d.slice(2) : d.length === 13 && d.startsWith('521') ? d.slice(3) : null
    if (!nat) return null
    return /^(55|56|33|81)/.test(nat) ? nat.slice(0, 2) : nat.slice(0, 3)
  }
  const ladas = new Set([primary, ...extras].map(lada).filter(Boolean))
  const multiCity = ladas.size > 1
  const selectAll = () => {
    if (multiCity && !confirmAll) { setConfirmAll(true); return }
    setConfirmAll(false)
    if (!selected) onToggleCompany()
    selectableExtras.filter(n => !extraSelected.has(key(n))).forEach(n => onToggleExtra(key(n)))
  }
  const onlyPrimary = () => {
    setConfirmAll(false)
    extras.filter(n => extraSelected.has(key(n))).forEach(n => onToggleExtra(key(n)))
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1 }}>
        <MaybeBlockedCheckbox lang={lang} blocked={isBlacklisted(primary)} checked={selected && !isBlacklisted(primary)} disabled={isBlacklisted(primary)} onChange={onToggleCompany}
          sx={{ p: 0.3, color: numberStyle(primary, selected).checkboxColor, '&.Mui-checked': { color: numberStyle(primary, selected).checkedColor } }} />
        {label && (
          <MarqueeText title={labelTitle} sx={{
            flex: 1, fontSize: '0.75rem', mr: 0.6, lineHeight: 1.5,
            color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
          }}>{label}</MarqueeText>
        )}
        {!collapseNumber && (() => {
          const s = numberStyle(primary, selected)
          return (
            <>
              <Chip
                icon={<WhatsAppIcon sx={{ fontSize: '11px !important', color: `${s.color} !important` }} />}
                label={primary} size="small"
                sx={{
                  height: 20, fontSize: '0.68rem',
                  bgcolor: selected ? s.bg : 'rgba(255,255,255,0.04)',
                  color: s.color,
                  border: `1px solid ${s.borderColor}`,
                  '& .MuiChip-label': { px: 0.7 },
                }} />
              <BlockToggle n={primary} />
            </>
          )
        })()}
        {extras.length > 0 && (
          <Chip onClick={onToggleExpand} size="small"
            label={`${selectedNumbers}/${totalNumbers}`}
            title={en
              ? `${selectedNumbers} of ${totalNumbers} numbers selected — click to see them all`
              : `${selectedNumbers} de ${totalNumbers} números seleccionados — clic para verlos todos`}
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
          {collapseNumber && (() => {
            const s = numberStyle(primary, selected)
            return (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1, pl: 2.6 }}>
                <MaybeBlockedCheckbox lang={lang} blocked={isBlacklisted(primary)} checked={selected && !isBlacklisted(primary)} disabled={isBlacklisted(primary)} onChange={onToggleCompany}
                  sx={{ p: 0.2, color: s.checkboxColor, '&.Mui-checked': { color: s.checkedColor } }} />
                <Chip label={primary} size="small"
                  sx={{
                    height: 18, fontSize: '0.62rem',
                    bgcolor: selected ? s.bg : 'rgba(255,255,255,0.03)',
                    color: s.color,
                    border: `1px solid ${s.borderColor}`,
                    '& .MuiChip-label': { px: 0.6 },
                  }} />
                <BlockToggle n={primary} />
              </Box>
            )
          })()}
          {extras.map(n => {
            const on = extraSelected.has(key(n))
            const s = numberStyle(n, on)
            return (
              <Box key={n} sx={{ display: 'flex', alignItems: 'center', gap: 0.1, pl: 2.6 }}>
                <MaybeBlockedCheckbox lang={lang} blocked={isBlacklisted(n)} checked={on && !isBlacklisted(n)} disabled={isBlacklisted(n)} onChange={() => onToggleExtra(key(n))}
                  sx={{ p: 0.2, color: s.checkboxColor, '&.Mui-checked': { color: s.checkedColor } }} />
                <Chip label={n} size="small"
                  sx={{
                    height: 18, fontSize: '0.62rem',
                    bgcolor: on ? s.bg : 'rgba(255,255,255,0.03)',
                    color: s.color,
                    border: `1px solid ${s.borderColor}`,
                    '& .MuiChip-label': { px: 0.6 },
                  }} />
                <BlockToggle n={n} />
              </Box>
            )
          })}
          <Box sx={{ pl: 3, pt: 0.3, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
            {multiCity && (
              <Typography sx={{ fontSize: '0.6rem', color: '#fbbf24', lineHeight: 1.3 }}>
                {en
                  ? `⚠ Numbers from ${ladas.size} different area codes — this may be a directory of several businesses`
                  : `⚠ Números de ${ladas.size} ladas distintas — puede ser un directorio de varios negocios`}
              </Typography>
            )}
            {selectableExtras.length > 0 && (
              <Tooltip placement="top" arrow title={allOn ? '' : (en
                ? `Each extra number uses one of today's new-contact slots (${selectableExtras.length} more)`
                : `Cada número extra usa un cupo de contacto nuevo del día (${selectableExtras.length} más)`)}>
                <Typography component="span" onClick={allOn ? onlyPrimary : selectAll}
                  sx={{
                    alignSelf: 'flex-start', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', userSelect: 'none',
                    color: confirmAll ? '#fbbf24' : 'rgba(96,165,250,0.85)',
                    '&:hover': { textDecoration: 'underline' },
                  }}>
                  {allOn
                    ? (en ? `Deselect the other ${extrasOn}` : `Desmarcar ${extrasOn === 1 ? 'el otro' : `los otros ${extrasOn}`}`)
                    : confirmAll
                      ? (en ? `Confirm: select all ${totalNumbers} (${ladas.size} area codes)` : `Confirmar: seleccionar los ${totalNumbers} (${ladas.size} ladas)`)
                      : (en ? `Select all ${totalNumbers}` : `Seleccionar los ${totalNumbers}`)}
                </Typography>
              </Tooltip>
            )}
          </Box>
        </>
      )}
    </Box>
  )
}
