'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useLang } from '../context/LangContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { useSendQueue } from '../context/SendQueueContext'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import { CompanyPicker, extractPhoneDigits } from './scheduledSends'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { SendConfigPanel } from './SendConfigPanel'
import CampaignAvailability from './CampaignAvailability'
import { InstanceDisconnectedBanner } from './InstanceStatusBanner'
import { getOverBy, capOverflowKind } from '../lib/dailyCap'
import { sendBlockReason } from './BulkSendPanel'
import { isPhoneBlacklisted } from '@/lib/phoneBlacklist'
import { loadSendConfig } from '@/lib/sendConfig'
import { getMinTemplatesRequired, pickMessageVariant } from '@/lib/messageVariants'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import SendIcon from '@mui/icons-material/Send'
import CampaignIcon from '@mui/icons-material/Campaign'
import GroupsIcon from '@mui/icons-material/Groups'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import DescriptionIcon from '@mui/icons-material/Description'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'

// Per-recipient variable check — TemplateLibraryPicker only blocks a template
// when NONE of the selection has the data it needs, so a mixed selection (some
// with city, some without) still leaves city-templates selectable. Without this,
// pickMessageVariant() could hand a {{ciudad}} template to the one recipient
// with no city and send them a message with a blank gap in it.
const TARGET_VARS = [
  { re: /\{\{nombre\}\}/,    get: info => info.company_name },
  { re: /\{\{ciudad\}\}/,    get: info => info.city },
  { re: /\{\{industria\}\}/, get: info => info.industry },
  { re: /\{\{web\}\}/,       get: info => info.web },
]
function templateFitsTarget(text, info) {
  return TARGET_VARS.every(v => !v.re.test(text) || !!String(v.get(info) || '').trim())
}

function StepHint({ hint }) {
  if (!hint) return null
  return (
    <Tooltip title={hint} placement="top" arrow>
      <InfoOutlinedIcon sx={{ fontSize: 14, color: 'var(--text-muted)', cursor: 'help', opacity: 0.55, '&:hover': { opacity: 1 } }} />
    </Tooltip>
  )
}

// Ícono en caja degradada + número pequeño superpuesto en la esquina — mismo
// lenguaje visual que Warmup/Instances/Performance en vez del círculo con
// solo un número que se veía plano al lado de esos paneles ya renovados. El
// número se conserva (superpuesto, no adentro) porque aquí sí es una
// secuencia real de pasos, no solo decoración.
function StepBadge({ n, icon }) {
  return (
    <Box data-step-badge sx={{ position: 'relative', flexShrink: 0, width: 38, height: 36 }}>
      <Box sx={{
        position: 'absolute', left: 0, bottom: 0, width: 30, height: 30, borderRadius: '9px', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.28) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
        border: '1px solid rgba(var(--accent-rgb,59,130,246),0.4)',
        boxShadow: '0 0 10px rgba(var(--accent-rgb,59,130,246),0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Box data-step-marker sx={{
        position: 'absolute', top: 0, right: 0,
        width: 15, height: 15, borderRadius: '50%',
        bgcolor: 'var(--accent, #3b82f6)', border: '1.5px solid var(--card-bg, #161d2e)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>{n}</Typography>
      </Box>
    </Box>
  )
}

function StepHeader({ n, title, hint, icon }) {
  return (
    <Box data-campaign-step={n} sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexShrink: 0 }}>
      <StepBadge n={n} icon={icon} />
      <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </Typography>
      <StepHint hint={hint} />
    </Box>
  )
}

function SectionCard({ children, sx }) {
  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid var(--border)', bgcolor: 'var(--surface)',
      p: 1.8, display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 1.2, ...sx,
    }}>
      {children}
    </Box>
  )
}

function CampaignMetric({ value, label, accent = false, icon }) {
  return <Box data-campaign-metric={label} sx={{ minWidth: 0, textAlign: 'center', ...(icon ? { p: 1.2, border: '1px solid var(--border)', borderRadius: 2, bgcolor: 'var(--card-bg)', '@container campaign (max-width: 550px)': { p: .7 } } : {}) }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: .8 }}>
      {icon && <Box sx={{ color: 'var(--accent)', display: 'flex', '& svg': { fontSize: 17 } }}>{icon}</Box>}
      <Typography sx={{ fontSize: '1.45rem', fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', color: accent || (icon && value > 0) ? 'var(--accent)' : value === 0 ? 'var(--text-muted)' : 'var(--text)', '@container campaign (max-width: 550px)': { fontSize: '1.15rem' } }}>{value}</Typography>
    </Box>
    <Typography sx={{ fontSize: '.8rem', color: 'var(--text-muted)', mt: .45, lineHeight: 1.3 }}>{label}</Typography>
  </Box>
}

export default function SendCampaign() {
  const { t, lang } = useLang()
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const { addBatch, active, queueLen, completedCount } = useSendQueue()

  // ── Recipients (per-number selection, same shape CompanyPicker/CampaignForm use) ──
  const [selectedNums, setSelectedNums] = useState(() => new Set())
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map())
  // Selected numbers never messaged before — only those use the daily
  // new-contacts quota (reported by CompanyPicker, which has the contacted data).
  const [newSelCount,  setNewSelCount]  = useState(0)

  // ── Message + timing ──
  const [templateTexts, setTemplateTexts] = useState([])
  const [sendCfg,       setSendCfg]       = useState(() => loadSendConfig())
  const [reviewOpen, setReviewOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sendError, setSendError] = useState('')
  const sendLock = useRef(false)
  const workspaceRef = useRef(null)
  const messageSectionRef = useRef(null)
  const recipientSectionRef = useRef(null)

  // ── Done state: captured from context on success phase ──
  const [done,                setDone]                = useState(false)
  const [doneCount,           setDoneCount]           = useState(0)
  const [contactedRefreshKey, setContactedRefreshKey] = useState(0)
  const { stats: capStats, refresh: refreshCapStats } = useDailyCapStats()

  // active.phase never actually reaches 'success' for a real send — the backend
  // queue reports 'sending'/'waiting' and then just goes back to 'idle' (active
  // becomes null); 'success' only ever came from the local Shift+B debug preview.
  // completedCount is the real "a send just finished" signal (same one SendBubble's
  // toast uses) — watching active here meant contactedRefreshKey never bumped for
  // a genuine campaign, so "already contacted" only updated on a manual page reload.
  useEffect(() => {
    if (completedCount !== null) {
      setDoneCount(completedCount)
      setDone(true)
      refreshCapStats()
      setContactedRefreshKey(k => k + 1)
    }
  }, [completedCount, refreshCapStats])

  // isSending is true while the global queue is processing this campaign
  const isSending = active !== null || queueLen > 0
  const progress  = active && active.total > 0 ? Math.round(active.sent / active.total * 100) : 0

  const targets = useMemo(() => [...numInfoMap.values()], [numInfoMap])
  // Which {{variable}} placeholders can actually be filled for the current
  // selection — passed to TemplateLibraryPicker so it disables templates that
  // would render with a blank gap (e.g. {{ciudad}} when nobody selected has a city).
  const hasNameData     = targets.some(n => n.company_name)
  const hasCityData     = targets.some(n => n.city)
  const hasIndustryData = targets.some(n => n.industry)
  const hasWebData      = targets.some(n => n.web)
  // Per company, not per number — the picker's tooltips read "N/M empresas", and
  // with nobody selected yet it leaves variable templates usable.
  const targetCompanies = useMemo(() => [...new Map(targets.map(n => [n.company_id, n])).values()], [targets])
  const tplVarCounts = useMemo(() => ({
    nombre:    targetCompanies.filter(n => n.company_name).length,
    ciudad:    targetCompanies.filter(n => n.city).length,
    industria: targetCompanies.filter(n => n.industry).length,
    web:       targetCompanies.filter(n => n.web).length,
  }), [targetCompanies])
  const cleanMessages = useMemo(() => templateTexts.map(m => m.trim()).filter(Boolean), [templateTexts])
  const minTemplatesRequired = getMinTemplatesRequired(targets.length)
  const belowMinTemplates = targets.length > 1 && cleanMessages.length < minTemplatesRequired
  // Already-contacted numbers don't use the new-contacts quota — counting every
  // selected number as new blocked follow-ups that actually fit.
  // Sin el cupo cargado no se manda: un vacío se leía como sin tope y
  // Antonio (2026-10-07) encoló 6 contactos nuevos con gely-wa en warmup (tope 5).
  const capPending  = !capStats && targets.length > 0
  const overBy      = getOverBy(capStats, targets.length, newSelCount, { requireStats: true })
  const overKind    = capOverflowKind(capStats, targets.length, newSelCount)
  const capBlocked  = capPending || overBy > 0
  const unmatchedTargets = targets.filter(n => cleanMessages.length && !cleanMessages.some(m => templateFitsTarget(m, n)))
  const canSend = targets.length > 0 && cleanMessages.length > 0 && !belowMinTemplates && !capBlocked && !isSending && instanceStatus === 'connected' && !unmatchedTargets.length
  const blockReason = unmatchedTargets.length
    ? (lang === 'en' ? `${unmatchedTargets.length} ${unmatchedTargets.length === 1 ? 'recipient needs' : 'recipients need'} a template with available variables.` : `${unmatchedTargets.length} ${unmatchedTargets.length === 1 ? 'destinatario necesita' : 'destinatarios necesitan'} una plantilla con datos disponibles.`)
    : sendBlockReason({
    lang, isSending, allSent: false, isDisconnected: isDisconnected || instanceStatus !== 'connected',
    selectedCount: targets.length,
    templateCount: cleanMessages.length,
    minTemplates: targets.length > 1 ? minTemplatesRequired : 1,
    overBy, capPending, overKind,
  })

  async function handleSend() {
    if (!canSend || sendLock.current) return
    sendLock.current = true
    setConfirming(true)
    setSendError('')
    try {
      const fresh = await refreshCapStats()
      if (!fresh || getOverBy(fresh, targets.length, newSelCount, { requireStats: true }) > 0) {
        setSendError(lang === 'en' ? 'Available capacity changed or could not be checked. Review your selection.' : 'El cupo disponible cambió o no pudo comprobarse. Revisa tu selección.')
        return
      }
      setDone(false)
      // Pre-compute per-recipient messages (variant selection + variable substitution)
      // before enqueuing so all randomization happens at click time, not during send.
      let lastVariant = null
      // A number blocked a moment ago may still be in the selection — never send it
      // (the backend re-checks every message too).
      const jobs = targets.filter(info => !isPhoneBlacklisted(info.number)).map(info => {
        const eligible = cleanMessages.filter(m => templateFitsTarget(m, info))
        const variant = pickMessageVariant(eligible, lastVariant)
        lastVariant = variant
        const message = variant
          .replace(/\{\{nombre\}\}/g,    info.company_name || '')
          .replace(/\{\{ciudad\}\}/g,    info.city || '')
          .replace(/\{\{industria\}\}/g, info.industry || '')
          .replace(/\{\{web\}\}/g,       info.web || '')
        const cleanNumber = extractPhoneDigits(info.number) || info.number
        return { numbers: [cleanNumber], messages: [message], companyId: info.company_id, website: info.web }
      })
      if (!jobs.length) {
        setSendError(lang === 'en' ? 'The selected numbers are no longer available.' : 'Los números seleccionados ya no están disponibles.')
        return
      }
      const accepted = await addBatch(jobs, t.campaign.title)
      if (accepted === false) {
        setSendError(lang === 'en' ? 'The campaign could not be queued. Try again later.' : 'No se pudo iniciar la campaña. Vuelve a intentarlo más tarde.')
        return
      }
      setReviewOpen(false)
    } finally {
      sendLock.current = false
      setConfirming(false)
    }
  }

  // Countdown label derived from global queue state
  const isWaiting    = active?.phase === 'waiting' && active.countdown > 0
  const isBatchBreak = isWaiting && active.batch

  const en = lang === 'en'
  const counts = en
    ? `${targetCompanies.length} ${targetCompanies.length === 1 ? 'company' : 'companies'} · ${targets.length} ${targets.length === 1 ? 'number' : 'numbers'} · ${cleanMessages.length} ${cleanMessages.length === 1 ? 'template' : 'templates'}`
    : `${targetCompanies.length} ${targetCompanies.length === 1 ? 'empresa' : 'empresas'} · ${targets.length} ${targets.length === 1 ? 'número' : 'números'} · ${cleanMessages.length} ${cleanMessages.length === 1 ? 'plantilla' : 'plantillas'}`
  const scrollColumn = { minWidth: 0, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, px: .5, pt: .5,
    '@container campaign (max-width: 850px)': { overflowY: 'visible', flexShrink: 0 } }
  function jumpTo(section) {
    const workspace = workspaceRef.current
    if (!workspace || !section.current) return
    workspace.scrollTo({ top: workspace.scrollTop + section.current.getBoundingClientRect().top - workspace.getBoundingClientRect().top, behavior: 'smooth' })
  }

  return (
    <Box data-ui-section="campaign" data-campaign sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, containerType: 'inline-size', containerName: 'campaign', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
        <Box sx={{ width: 42, height: 42, borderRadius: 3, bgcolor: 'rgba(var(--accent-rgb,59,130,246),.12)', border: '1px solid rgba(var(--accent-rgb,59,130,246),.25)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><CampaignIcon sx={{ color: 'var(--accent)', fontSize: 23 }} /></Box>
        <Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 800, fontSize: '1.25rem' }}>{t.campaign.title}</Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>{en ? 'Prepare your message, choose recipients and review before sending.' : 'Prepara tu mensaje, elige destinatarios y revisa antes de enviar.'}</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'none', flexShrink: 0, gap: 1, '@container campaign (max-width: 850px)': { display: 'flex' } }}>
        <Button onClick={() => jumpTo(messageSectionRef)} size="small" startIcon={<DescriptionIcon />} sx={{ color: 'var(--text-muted)', textTransform: 'none' }}>{en ? 'Message' : 'Mensaje'}</Button>
        <Button onClick={() => jumpTo(recipientSectionRef)} size="small" startIcon={<GroupsIcon />} sx={{ color: 'var(--accent)', textTransform: 'none' }}>{en ? 'Recipients' : 'Destinatarios'}</Button>
      </Box>
      <Box ref={workspaceRef} data-campaign-workspace sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: 2.5, overflow: 'hidden', '@container campaign (max-width: 850px)': { display: 'flex', flexDirection: 'column', overflowY: 'auto' } }}>
        <Box ref={messageSectionRef} sx={scrollColumn}>
          <StepHeader n={1} title={t.campaign.stepTemplates} hint={t.campaign.hintTemplates} icon={<DescriptionIcon sx={{ fontSize: 15, color: 'var(--accent)' }} />} />
          <SectionCard sx={{ p: 2 }}>
            <TemplateLibraryPicker campaignCards onChange={setTemplateTexts} recipientCount={targets.length} baseCount={0} singleSelect={targets.length === 1}
              hasName={hasNameData} hasCity={hasCityData} hasIndustry={hasIndustryData} hasWeb={hasWebData} varCounts={tplVarCounts} totalSelected={targetCompanies.length} />
          </SectionCard>

          <SectionCard sx={{ gap: 1, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><AccessTimeIcon sx={{ fontSize: 18, color: 'var(--accent)' }} /><Typography sx={{ color: 'var(--text)', fontSize: '.88rem', fontWeight: 700 }}>{en ? 'Sending pace' : 'Ritmo de envío'}</Typography></Box>
            <Typography sx={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>{en ? `${sendCfg.msgDelay[0]}–${sendCfg.msgDelay[1]} s between messages · pauses between batches` : `${sendCfg.msgDelay[0]}–${sendCfg.msgDelay[1]} s entre mensajes · pausas entre lotes`}</Typography>
            <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={isSending || confirming} />
          </SectionCard>

          <InstanceDisconnectedBanner status={instanceStatus} />
        </Box>

        <Box ref={recipientSectionRef} sx={scrollColumn}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <StepHeader n={2} title={t.campaign.stepRecipients} hint={t.campaign.hintRecipients} icon={<GroupsIcon sx={{ fontSize: 15, color: 'var(--accent)' }} />} />
            <Chip label={en ? `${targets.length} selected numbers` : `${targets.length} números seleccionados`} size="small" sx={{ bgcolor: 'var(--item-hover)', color: 'var(--accent)', border: '1px solid var(--border)', fontSize: '0.76rem' }} />
          </Box>
          <CompanyPicker campaignStyle selectedNums={selectedNums} numInfoMap={numInfoMap} onChange={(ns, nm) => { setSelectedNums(ns); setNumInfoMap(nm) }}
            listMaxHeight="min(64vh, 680px)" contactedRefreshKey={contactedRefreshKey} newContactsCap={capStats ? (capStats.new_contacts_capacity ?? 0) : 0} onNewCountChange={setNewSelCount} showTitle={false} />
        </Box>
      </Box>

      <Box data-campaign-send-bar sx={{ flexShrink: 0, borderRadius: 3, border: '1px solid var(--border)', bgcolor: 'var(--surface)', overflow: 'hidden' }}>
        {isSending && active && <Box sx={{ px: 2, pt: 1.5 }}><Typography sx={{ color: 'var(--text-muted)', fontSize: '.84rem', mb: .5 }}>{t.campaign.sendingProgress(active.sent, active.total)}{isWaiting ? ` · ${en ? 'pause' : 'pausa'} ${active.countdown}s${isBatchBreak ? ` (${en ? 'batch' : 'lote'})` : ''}` : ''}</Typography><LinearProgress variant="determinate" value={progress} sx={{ height: 4, borderRadius: 2, bgcolor: 'var(--item-hover)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' } }} /></Box>}
        {done && !isSending && <Typography sx={{ color: 'var(--accent)', fontSize: '.84rem', px: 2, pt: 1.5 }}>{doneCount} {en ? 'messages sent' : 'mensajes enviados'}</Typography>}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 1.2fr) minmax(230px, 1fr) minmax(200px, .85fr)', gap: 2.5, alignItems: 'center', p: 2,
          '@container campaign (max-width: 1000px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 1.5 },
          '@container campaign (max-width: 550px)': { gridTemplateColumns: 'minmax(0, 1fr)', gap: 1, p: 1.5 } }}>
          <Box>
            <Typography sx={{ fontSize: '.78rem', color: 'var(--text-muted)', mb: .8, textAlign: 'center' }}>{en ? 'Your selection' : 'Tu selección'}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }} aria-live="polite">
              <CampaignMetric value={targetCompanies.length} label={en ? 'Companies' : 'Empresas'} icon={<GroupsIcon />} />
              <CampaignMetric value={targets.length} label={en ? 'Numbers' : 'Números'} icon={<SendIcon />} />
              <CampaignMetric value={cleanMessages.length} label={en ? 'Templates' : 'Plantillas'} icon={<DescriptionIcon />} />
            </Box>
          </Box>
          <CampaignAvailability stats={capStats} selectedCount={targets.length} newSelectedCount={newSelCount} en={en} />
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: .75, minWidth: 0,
            '@container campaign (max-width: 1000px)': { gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
            '@container campaign (max-width: 550px)': { flexDirection: 'column', alignItems: 'stretch' } }}>
            <Button data-campaign-review onClick={() => { setSendError(''); setReviewOpen(true) }} disabled={!canSend || confirming} variant="contained" startIcon={isSending ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />} sx={{ order: 1, textTransform: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-contrast, #071c23)', fontWeight: 700, borderRadius: 2, px: 2.5, py: 1.3, boxShadow: 'none', fontSize: '.88rem', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'var(--accent)', filter: 'brightness(.95)' }, '&.Mui-disabled': { bgcolor: 'var(--item-hover)', color: 'var(--text-muted)' } }}>
              {isSending ? t.campaign.sending : en ? 'Review campaign' : 'Revisar campaña'}
            </Button>
            {!canSend && !isSending && (targets.length > 0 || cleanMessages.length > 0) && <Typography sx={{ order: 2, fontSize: '.78rem', lineHeight: 1.4, color: 'var(--text-muted)', '@container campaign (max-width: 1000px)': { order: 0 }, '@container campaign (max-width: 550px)': { order: 2 } }}>
              {!targets.length && !cleanMessages.length ? (en ? 'Choose recipients and templates to continue.' : 'Selecciona destinatarios y plantillas para continuar.') : blockReason}
            </Typography>}
          </Box>
        </Box>
      </Box>

      <Dialog open={reviewOpen} onClose={() => { if (!confirming) setReviewOpen(false) }} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg)', color: 'var(--text)', backgroundImage: 'none', borderRadius: 3, border: '1px solid var(--border)', m: 2 } } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>{en ? 'Review your campaign' : 'Revisa tu campaña'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '.95rem' }}>{counts}</Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '.84rem' }}>{en ? 'Sending starts immediately after confirmation. Each number receives one personalized message.' : 'El envío empieza inmediatamente después de confirmar. Cada número recibe un mensaje personalizado.'}</Typography>
          <Box sx={{ maxHeight: 170, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 2, p: 1.5 }}>{targets.map(n => <Box key={n.number} sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', flexWrap: 'wrap', py: .6 }}><Typography sx={{ fontSize: '.84rem' }}>{n.company_name || (en ? 'Recipient' : 'Destinatario')}</Typography><Typography sx={{ fontSize: '.78rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{n.number}</Typography></Box>)}</Box>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>{en ? 'Intervals' : 'Intervalos'}: {sendCfg.msgDelay[0]}–{sendCfg.msgDelay[1]} s · {en ? 'Batches' : 'Lotes'}: {sendCfg.batchSize[0]}–{sendCfg.batchSize[1]} · {en ? 'Pauses' : 'Pausas'}: {sendCfg.batchDelay[0]}–{sendCfg.batchDelay[1]} min</Typography>
          {sendError && <Alert severity="warning">{sendError}</Alert>}
          {!canSend && blockReason && <Alert severity="warning">{blockReason}</Alert>}
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap' }}>
          <Button onClick={() => setReviewOpen(false)} disabled={confirming} sx={{ textTransform: 'none', color: 'var(--text-muted)' }}>{en ? 'Keep editing' : 'Seguir editando'}</Button>
          <Button onClick={handleSend} disabled={!canSend || confirming} variant="contained" startIcon={confirming ? <CircularProgress size={15} color="inherit" /> : <SendIcon />} sx={{ textTransform: 'none', bgcolor: 'var(--accent)', color: 'var(--accent-contrast, #071c23)', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent)', filter: 'brightness(.95)' } }}>{confirming ? (en ? 'Checking…' : 'Verificando…') : en ? 'Start campaign' : 'Iniciar campaña'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
