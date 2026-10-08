'use client'
import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import SendIcon from '@mui/icons-material/Send'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import MessageIcon from '@mui/icons-material/Message'
import RecipientsBox from './RecipientsBox'
import DailyCapBadge from './DailyCapBadge'
import { getOverBy, capOverflowKind } from '../lib/dailyCap'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { SendConfigPanel } from './SendConfigPanel'
import { InstanceDisconnectedBanner, SendErrorBanner } from './InstanceStatusBanner'
import { getMinTemplatesRequired } from '@/lib/messageVariants'
import { useLang } from '../context/LangContext'
import { useBlacklistedPhones, isPhoneBlacklisted, phoneKey } from '../lib/phoneBlacklist'

// The "send to what was just scraped" panel shared by Buscar prospectos, Batch,
// CSV and Ideas. Each screen used to carry its own ~150-line copy, so every fix
// had to be repeated four times and the copies drifted apart.

// Selection math each screen needs both for this panel and for its own
// handleSendAll guard. A selected company counts once (its primary number) plus
// every extra number ticked under it (`cid::number` keys in extraSelected) —
// the backend dedupes by real number, so each one uses its own quota slot.
export function useBulkSendGuards({ waRows, selected, extraSelected, variants, capStats }) {
  const blocked = useBlacklistedPhones()
  return useMemo(() => {
    // Blocked numbers are never sent (sendableNumbers below, and the backend
    // re-checks each one), so they don't count toward quota or templates either.
    const isBlocked = n => blocked.has(phoneKey(n))
    const extrasBy = {}
    for (const k of extraSelected) {
      const i = k.indexOf('::')
      const cid = k.slice(0, i), n = k.slice(i + 2)
      if (selected.has(cid) && !isBlocked(n)) (extrasBy[cid] ||= []).push(n)
    }
    const selectedRows = []
    let totalContactPoints = 0, newContactPoints = 0
    for (const r of waRows) {
      if (!selected.has(r.company_id)) continue
      const primary = r.all_whatsapp?.[0] || r.whatsapp
      const n = (primary && !isBlocked(primary) ? 1 : 0) + (extrasBy[r.company_id]?.length || 0)
      if (!n) continue
      selectedRows.push(r)
      totalContactPoints += n
      if (!r.already_contacted?.contacted) newContactPoints += n
    }
    // Sin el cupo cargado el botón no manda: Antonio (2026-10-07) encoló 6
    // contactos nuevos con gely-wa en warmup (tope 5) porque un cupo vacío se
    // leía como "sin límite".
    const capPending = !capStats && totalContactPoints > 0
    const overBy = getOverBy(capStats, totalContactPoints, newContactPoints, { requireStats: true })
    const overKind = capOverflowKind(capStats, totalContactPoints, newContactPoints)
    const allVariants = variants.map(v => v.trim()).filter(Boolean)
    // Sending to 2+ contact points needs varied text (see getMinTemplatesRequired);
    // a single one still needs at least one template — never an empty message.
    const isBulk = totalContactPoints > 1
    const minTemplates = isBulk ? getMinTemplatesRequired(totalContactPoints) : 1
    return {
      selectedRows, totalContactPoints, newContactPoints, overBy, overKind,
      capPending, capBlocked: capPending || overBy > 0,
      allVariants, isBulk, minTemplates,
      belowMinTemplates: isBulk && allVariants.length < minTemplates,
      noMessageSelected: allVariants.length === 0,
    }
  }, [waRows, selected, extraSelected, variants, capStats, blocked])
}

// The numbers one selected company will actually be messaged on: its first
// number plus the extras ticked under it, minus any blocked one.
export function sendableNumbers(row, extraSelected) {
  const primary = row.all_whatsapp?.length > 0 ? row.all_whatsapp[0] : row.whatsapp
  if (!primary) return []
  const extras = row.all_whatsapp?.slice(1).filter(n => extraSelected.has(`${row.company_id}::${n}`)) || []
  return [primary, ...extras].filter(n => !isPhoneBlacklisted(n))
}

// Why the send button can't send, shown as the button's own label instead of
// greying it out with the reason (if any) in small text somewhere else.
export function sendBlockReason({ lang, isSending, allSent, isDisconnected, selectedCount, templateCount, minTemplates, overBy, capPending = false, overKind = null }) {
  if (isSending || allSent) return null
  const en = lang === 'en'
  if (isDisconnected) return en ? 'WhatsApp session disconnected — reconnect it to send' : 'Sesión de WhatsApp desconectada — reconéctala para enviar'
  if (selectedCount === 0) return en ? 'Choose who to send to' : 'Elige a quién enviar'
  if (templateCount < minTemplates) {
    return minTemplates > 1
      ? (en ? `Choose ${minTemplates} templates (you have ${templateCount})` : `Elige ${minTemplates} plantillas (llevas ${templateCount})`)
      : (en ? 'Choose a template' : 'Elige una plantilla')
  }
  if (capPending) return en ? 'Loading today\'s quota…' : 'Cargando el cupo de hoy…'
  if (overBy > 0 && overKind === 'new') {
    return en
      ? `Deselect ${overBy}: today's new-contact cap doesn't fit them`
      : `Desmarca ${overBy}: el tope de contactos nuevos de hoy no da para más`
  }
  if (overBy > 0) return en ? `Deselect ${overBy} to fit today's quota` : `Desmarca ${overBy} para caber en el cupo de hoy`
  return null
}

const SCROLL_BODY_SX = {
  maxHeight: 'clamp(420px, 70vh, 760px)', overflowY: 'auto',
  scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.12) transparent',
  '&::-webkit-scrollbar': { width: 6 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.14)', borderRadius: 3 },
  '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
}

export default function BulkSendPanel({
  title,
  waRows, filteredRows, filterContacted, onFilterContacted,
  selected, setSelected, expandedCo, setExpandedCo, extraSelected, setExtraSelected,
  guards, varFlags, varCounts, onVariantsChange,
  capStats, instanceStatus, isDisconnected,
  sendCfg, onSendCfgChange, sendError, onDismissError,
  isSending, onCancel, onSend,
  allSent = false, sentLabel = '', unsentCount,
  // false when the panel already lives inside a scrolling column (Ideas)
  scrollBody = true,
}) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const contactedCount = waRows.filter(r => r.already_contacted?.contacted).length

  const blockReason = sendBlockReason({
    lang, isSending, allSent, isDisconnected,
    selectedCount: selected.size,
    templateCount: guards.allVariants.length,
    minTemplates: guards.minTemplates,
    overBy: guards.overBy,
    capPending: guards.capPending,
    overKind: guards.overKind,
  })
  const disabled = isSending || allSent || !!blockReason
  const n = unsentCount ?? selected.size
  const readyLabel = en
    ? `Send to ${n} ${n === 1 ? 'company' : 'companies'} with WhatsApp`
    : `Enviar a ${n} ${n === 1 ? 'empresa' : 'empresas'} con WhatsApp`

  const filters = [
    { key: 'all',       label: `${en ? 'All' : 'Todos'} (${waRows.length})`,                                   color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)' },
    { key: 'new',       label: `${en ? 'Not contacted' : 'Sin contactar'} (${waRows.length - contactedCount})`, color: '#4ade80', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)' },
    { key: 'contacted', label: `${en ? 'Already contacted' : 'Ya contactados'} (${contactedCount})`,           color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)' },
  ]

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid rgba(34,197,94,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <Box sx={{ px: 2, py: 1.4, background: 'linear-gradient(180deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.02) 100%)', borderBottom: '1px solid rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(34,197,94,0.12)', flexShrink: 0 }}>
          <MessageIcon sx={{ fontSize: 14, color: '#4ade80' }} />
        </Box>
        <Box>
          <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.84rem', lineHeight: 1.2 }}>{title}</Typography>
          {waRows.length > 0 && (
            <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.62rem' }}>{waRows.length} {en ? 'with WhatsApp' : 'con WhatsApp'}</Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ p: 2, ...(scrollBody ? SCROLL_BODY_SX : {}) }}>
        {/* A disconnected session blocks the whole send — first thing in the panel. */}
        <InstanceDisconnectedBanner status={instanceStatus} sx={{
          mb: 1.5, px: 2, py: 1.3, borderRadius: 2, borderWidth: '1.5px',
          boxShadow: '0 0 0 1px rgba(239,68,68,0.15), 0 4px 16px rgba(239,68,68,0.12)',
          '& svg':  { fontSize: '19px !important' },
          '& p':    { fontSize: '0.82rem !important', fontWeight: 600 },
        }} />

        {waRows.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 1 }}>
            {filters.map(f => (
              <Chip key={f.key} label={f.label} size="small" onClick={() => onFilterContacted(f.key)}
                sx={{ height: 22, fontSize: '0.68rem', cursor: 'pointer', bgcolor: filterContacted === f.key ? f.bg : 'var(--item-hover)', color: filterContacted === f.key ? f.color : 'var(--text-muted)', border: `1px solid ${filterContacted === f.key ? f.border : 'var(--border)'}`, transition: 'all 0.15s', '&:hover': { bgcolor: f.bg, color: f.color } }} />
            ))}
          </Box>
        )}

        {/* alignItems flex-start: the recipients list has its own scroll, so it
            shouldn't stretch to the height of the templates column next to it. */}
        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <RecipientsBox rows={filteredRows}
            effectiveSelected={selected}
            expandedCo={expandedCo}
            extraSelected={extraSelected}
            setSelected={setSelected}
            setExpandedCo={setExpandedCo}
            setExtraSelected={setExtraSelected}
            title={t.search.recipients}
            maxHeight={320}
            sx={{ width: 260, flexShrink: 0 }} />

          <Box sx={{ flex: 1, minWidth: 300, opacity: filteredRows.length === 0 ? 0.35 : 1, pointerEvents: filteredRows.length === 0 ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <Box sx={{ mb: 1.5, p: 1.6, borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(255,255,255,0.02)' }}>
              <TemplateLibraryPicker onChange={onVariantsChange} recipientCount={guards.totalContactPoints} baseCount={0}
                singleSelect={guards.totalContactPoints === 1}
                hasName={varFlags.hasName} hasCity={varFlags.hasCity}
                hasIndustry={varFlags.hasIndustry} hasWeb={varFlags.hasWeb}
                varCounts={varCounts} totalSelected={guards.selectedRows.length} />
            </Box>
            <Box sx={{ mb: 1.5 }}>
              <SendConfigPanel config={sendCfg} onChange={onSendCfgChange} disabled={isSending} />
            </Box>
            <SendErrorBanner error={sendError} onDismiss={onDismissError} sx={{ mb: 1 }} />
            {isSending && (
              <Button fullWidth onClick={onCancel} startIcon={<HighlightOffIcon />}
                sx={{
                  mb: 0.8, py: 0.8, textTransform: 'none', fontWeight: 600, fontSize: '0.82rem',
                  color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' },
                }}>
                {t.search.cancelSend}
              </Button>
            )}
            {/* Today's capacity (new contacts first) next to the button, which
                says why it can't send instead of just greying out. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, flexWrap: 'wrap' }}>
              <DailyCapBadge stats={capStats} selectionCount={guards.totalContactPoints} newSelectionCount={guards.newContactPoints} oneLine sx={{ flexShrink: 0 }} />
              <Button
                onClick={onSend}
                disabled={disabled}
                startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 15 }} />}
                sx={{
                  flex: 1, minWidth: 220, fontSize: '0.84rem', fontWeight: 700,
                  py: 1.1, borderRadius: 1.8, textTransform: 'none', transition: 'all 0.2s',
                  bgcolor: 'rgba(34,197,94,0.18)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.38)',
                  '&:hover': { bgcolor: 'rgba(34,197,94,0.28)', borderColor: 'rgba(34,197,94,0.6)', boxShadow: '0 0 18px rgba(34,197,94,0.18)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' },
                }}
              >
                {allSent ? sentLabel : (blockReason || readyLabel)}
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
