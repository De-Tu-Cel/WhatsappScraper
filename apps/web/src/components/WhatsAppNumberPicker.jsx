'use client'
import { useEffect, useState } from 'react'
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
import { authFetch } from '@/lib/api'

// Shared across every picker instance on screen — one fetch instead of one
// per row/card. Map of normalized phone -> blacklist entry _id (needed to
// DELETE). Any instance can mutate it (add/remove) and the change is visible
// to every other instance immediately since they all read the same Map.
let _blacklistCache = null
let _blacklistPromise = null

export const digitsOnly = n => (n ? String(n).replace(/\D/g, '') : '')

// A disabled MUI Checkbox alone doesn't explain WHY — wrap it with the
// reason so a hover actually tells the user this number is blocked instead
// of just looking greyed out for no visible reason.
function MaybeBlockedCheckbox({ blocked, lang, ...props }) {
  const cb = <Checkbox size="small" {...props} />
  if (!blocked) return cb
  const reason = lang === 'en' ? 'Blocked number — unblock it to select it' : 'Número bloqueado — desbloquéalo para poder seleccionarlo'
  return <Tooltip title={reason}><span>{cb}</span></Tooltip>
}

export function useBlacklistedPhones() {
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (_blacklistCache) return
    if (!_blacklistPromise) {
      _blacklistPromise = fetch('/api/blacklist?type=phone&limit=1000')
        .then(r => r.json())
        .then(data => {
          _blacklistCache = new Map((data.items || []).map(e => [e.value, e.id || e._id]))
          return _blacklistCache
        })
        .catch(() => { _blacklistCache = new Map(); return _blacklistCache })
    }
    _blacklistPromise.then(() => forceRender(n => n + 1))
  }, [])
  return _blacklistCache || new Map()
}

export async function toggleBlacklistedPhone(normalized, entryId) {
  if (entryId) {
    await authFetch(`/api/blacklist/${entryId}`, { method: 'DELETE' })
    _blacklistCache?.delete(normalized)
  } else {
    const res = await authFetch('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'phone', value: normalized }),
    })
    if (res.ok) {
      const entry = await res.json()
      _blacklistCache?.set(normalized, entry.id || entry._id)
    }
  }
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
  row, selected, expanded, extraSelected, label,
  onToggleCompany, onToggleExpand, onToggleExtra,
}) {
  const { lang } = useLang()
  // Must run before any early return — React hooks can't be conditional.
  const blacklistMap = useBlacklistedPhones()
  const primary = row.all_whatsapp?.length > 0 ? row.all_whatsapp[0] : row.whatsapp
  if (!primary) return null
  const extras = row.all_whatsapp?.slice(1) || []
  const key = n => `${row.company_id}::${n}`
  // Normalize phone numbers: strip leading +, collapse 521XXXXXXXXXX → 52XXXXXXXXXX
  const normNum = n => { if (!n) return ''; let s = String(n).replace(/^\+/, ''); return s.replace(/^521(\d{10})$/, '52$1') }
  const contactedNormed = new Set((row.already_contacted?.contacted_numbers || []).map(normNum))
  const isContacted = n => contactedNormed.has(normNum(n))
  // Blacklisted = digits-only, matching _normalize_blacklist_value("phone", ...) server-side.
  const blacklistEntryId = n => blacklistMap.get(digitsOnly(n))
  const isBlacklisted = n => blacklistMap.has(digitsOnly(n))
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
          onClick={(e) => { e.stopPropagation(); toggleBlacklistedPhone(digitsOnly(n), blacklistEntryId(n)) }}
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1 }}>
        <MaybeBlockedCheckbox lang={lang} blocked={isBlacklisted(primary)} checked={selected && !isBlacklisted(primary)} disabled={isBlacklisted(primary)} onChange={onToggleCompany}
          sx={{ p: 0.3, color: numberStyle(primary, selected).checkboxColor, '&.Mui-checked': { color: numberStyle(primary, selected).checkedColor } }} />
        {label && (
          <Typography sx={{
            flex: 1, minWidth: 0, fontSize: '0.75rem', mr: 0.6,
            color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</Typography>
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
        </>
      )}
    </Box>
  )
}
