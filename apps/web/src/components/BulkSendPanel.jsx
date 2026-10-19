'use client'
import { useMemo, useRef, useState } from 'react'
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
  const submissionLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState(null)
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
  const disabled = isSending || submitting || allSent || !!blockReason
  async function handleQueueClick() {
    if (disabled || submissionLock.current) return
    submissionLock.current = true
    setSubmitting(true)
    setSubmissionError(null)
    try {
      if (await onSend() === false) throw new Error('queue_not_confirmed')
    } catch {
      setSubmissionError(en ? 'The request could not be confirmed. Check the queue before retrying.' : 'No se pudo confirmar la solicitud. Revisa la cola antes de volver a enviarla.')
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }
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
    <Box data-post-scrape-send sx={{ borderRadius: '16px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <Box sx={{ px: 2.5, py: 1.8, bgcolor: 'rgba(var(--accent-rgb),.045)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: 'rgba(var(--accent-rgb),.1)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MessageIcon sx={{ fontSize: 18, color: 'var(--accent)' }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '.95rem', lineHeight: 1.2 }}>{title}</Typography>
          {waRows.length > 0 && (
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '.75rem', mt: .35 }}>{waRows.length} {en ? 'with WhatsApp' : 'con WhatsApp'}</Typography>
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
                sx={{ height: 28, fontSize: '.74rem', borderRadius: '8px', cursor: 'pointer', bgcolor: filterContacted === f.key ? 'rgba(var(--accent-rgb),.1)' : 'var(--surface)', color: filterContacted === f.key ? 'var(--accent)' : 'var(--text-muted)', border: `1px solid ${filterContacted === f.key ? 'rgba(var(--accent-rgb),.35)' : 'var(--border)'}`, transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(var(--accent-rgb),.1)', color: 'var(--accent)' } }} />
            ))}
          </Box>
        )}

        {/* alignItems flex-start: the recipients list has its own scroll, so it
            shouldn't stretch to the height of the templates column next to it. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'minmax(280px,.8fr) minmax(0,1.6fr)', xl: 'minmax(320px,1fr) minmax(0,2fr)' }, gap: 2.5, alignItems: 'start', mt: 2 }}>
          <RecipientsBox rows={filteredRows}
            effectiveSelected={selected}
            expandedCo={expandedCo}
            extraSelected={extraSelected}
            setSelected={setSelected}
            setExpandedCo={setExpandedCo}
            setExtraSelected={setExtraSelected}
            title={t.search.recipients}
            maxHeight={400}
            sx={{ width: '100%', minWidth: 0, p: 1.5, border: '1px solid var(--border)', borderRadius: '12px', bgcolor: 'var(--surface)' }} />

          <Box sx={{ minWidth: 0, opacity: filteredRows.length === 0 ? 0.35 : 1, pointerEvents: filteredRows.length === 0 ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
            <Box sx={{ mb: 1.5, p: { xs: 1.5, md: 2 }, borderRadius: '12px', border: '1px solid var(--border)', bgcolor: 'var(--surface)' }}>
              <TemplateLibraryPicker postScrape onChange={onVariantsChange} recipientCount={guards.totalContactPoints} baseCount={0}
                singleSelect={guards.totalContactPoints === 1}
                hasName={varFlags.hasName} hasCity={varFlags.hasCity}
                hasIndustry={varFlags.hasIndustry} hasWeb={varFlags.hasWeb}
                varCounts={varCounts} totalSelected={guards.selectedRows.length} />
            </Box>
            <Box sx={{ mb: 1.5 }}>
              <SendConfigPanel config={sendCfg} onChange={onSendCfgChange} disabled={isSending} />
            </Box>
            <SendErrorBanner error={submissionError || sendError} onDismiss={() => { setSubmissionError(null); onDismissError?.() }} sx={{ mb: 1 }} />
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
                variant="contained"
                onClick={handleQueueClick}
                disabled={disabled}
                startIcon={isSending || submitting ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 15 }} />}
                sx={{
                  flex: 1, minWidth: 220, fontSize: '0.84rem', fontWeight: 700,
                  py: 1.1, borderRadius: 1.8, textTransform: 'none', transition: 'all 0.2s',
                  bgcolor: 'var(--accent)', color: 'var(--accent-contrast)', border: '1px solid transparent',
                  '&:hover': { bgcolor: 'var(--accent)', filter: 'brightness(1.08)', boxShadow: '0 3px 12px rgba(var(--accent-rgb),.18)' },
                  '&.Mui-disabled': { color: 'var(--text-muted)', bgcolor: 'var(--item-hover)', border: '1px solid var(--border)' },
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
