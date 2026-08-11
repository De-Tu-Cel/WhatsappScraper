'use client'
import { useState, useMemo, useRef } from 'react'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { CompanyPicker, extractPhoneDigits } from './scheduledSends'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { SendConfigPanel, CountdownBar } from './SendConfigPanel'
import { InstanceDisconnectedBanner, SendErrorBanner } from './InstanceStatusBanner'
import { loadSendConfig, randMsgDelayMs, randBatchBreakMs, randBatchSize } from '@/lib/sendConfig'
import { MIN_TEMPLATES_FOR_BULK, pickMessageVariant } from '@/lib/messageVariants'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import SendIcon from '@mui/icons-material/Send'
import CampaignIcon from '@mui/icons-material/Campaign'
import GroupsIcon from '@mui/icons-material/Groups'

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
  return TARGET_VARS.every(v => !v.re.test(text) || !!v.get(info))
}

function StepHeader({ n, title }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{
        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
        bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.18)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>{n}</Typography>
      </Box>
      <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {title}
      </Typography>
    </Box>
  )
}

function SectionCard({ children, sx }) {
  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid var(--border)', bgcolor: 'var(--surface)',
      p: 1.8, display: 'flex', flexDirection: 'column', gap: 1.2, ...sx,
    }}>
      {children}
    </Box>
  )
}

export default function SendCampaign() {
  const { t } = useLang()
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()

  // ── Recipients (per-number selection, same shape CompanyPicker/CampaignForm use) ──
  const [selectedNums, setSelectedNums] = useState(() => new Set())
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map())

  // ── Message + timing ──
  const [templateTexts, setTemplateTexts] = useState([])
  const [sendCfg,       setSendCfg]       = useState(() => loadSendConfig())

  // ── Send state ──
  const [sending,   setSending]   = useState(false)
  const [sendError, setSendError] = useState('')
  const [progress,  setProgress]  = useState(0)
  const [results,   setResults]   = useState([])
  const [done,      setDone]      = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [cdTotal,   setCdTotal]   = useState(null)
  const [cdLabel,   setCdLabel]   = useState('msg')
  const [batchNum,  setBatchNum]  = useState(1)
  const sendingRef = useRef(false)
  const cancelRef  = useRef(false)
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' })

  const notify = (msg, severity = 'success') => setSnack({ open: true, msg, severity })

  const targets = useMemo(() => [...numInfoMap.values()], [numInfoMap])
  // Which {{variable}} placeholders can actually be filled for the current
  // selection — passed to TemplateLibraryPicker so it disables templates that
  // would render with a blank gap (e.g. {{ciudad}} when nobody selected has a city).
  const hasNameData     = targets.some(n => n.company_name)
  const hasCityData     = targets.some(n => n.city)
  const hasIndustryData = targets.some(n => n.industry)
  const hasWebData      = targets.some(n => n.web)
  const cleanMessages = useMemo(() => templateTexts.map(m => m.trim()).filter(Boolean), [templateTexts])
  const belowMinTemplates = targets.length > 1 && cleanMessages.length < MIN_TEMPLATES_FOR_BULK
  const canSend = targets.length > 0 && cleanMessages.length > 0 && !belowMinTemplates && !sending

  async function waitWithTimer(ms, label) {
    const totalSecs = Math.ceil(ms / 1000)
    setCdTotal(totalSecs); setCountdown(totalSecs); setCdLabel(label)
    const end = Date.now() + ms
    await new Promise(resolve => {
      const tick = () => {
        if (cancelRef.current) { resolve(); return }
        const remaining = end - Date.now()
        if (remaining <= 0) { setCountdown(0); resolve(); return }
        setCountdown(Math.ceil(remaining / 1000))
        setTimeout(tick, 200)
      }
      tick()
    })
    setCountdown(null); setCdTotal(null)
  }

  async function handleSend() {
    if (!canSend || sendingRef.current) return
    cancelRef.current = false
    sendingRef.current = true
    setSending(true); setProgress(0); setResults([]); setDone(false)
    const res = []
    let lastVariant = null
    let msgsInBatch = 0
    let nextBreakAt = randBatchSize(sendCfg)
    let currentBatch = 1
    setBatchNum(1)

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break
      const info = targets[i]
      setProgress(Math.round(((i + 1) / targets.length) * 100))
      // Only pick among templates that actually fit THIS recipient's data —
      // falls back to the full pool only if none of the selected templates fit
      // (better to send something than to skip the recipient entirely).
      const eligible = cleanMessages.filter(m => templateFitsTarget(m, info))
      const pool = eligible.length ? eligible : cleanMessages
      const variant = pickMessageVariant(pool, lastVariant)
      lastVariant = variant
      const message = variant
        .replace(/\{\{nombre\}\}/g,    info.company_name || '')
        .replace(/\{\{ciudad\}\}/g,    info.city || '')
        .replace(/\{\{industria\}\}/g, info.industry || '')
        .replace(/\{\{web\}\}/g,       info.web || '')
      // Defensive: some scraped WhatsApp contacts got saved with page text glued
      // onto the number (e.g. a click-to-chat button's label + pre-filled message
      // concatenated in). Sending that raw string as to_number would just fail —
      // pull out the actual digits before it ever reaches the API.
      const cleanNumber = extractPhoneDigits(info.number) || info.number
      try {
        const r = await authFetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: info.company_id, to_number: cleanNumber, message, website: info.web }),
        })
        if (!r.ok) {
          const errJson = await r.json().catch(() => ({}))
          const detail = errJson.detail || `Error ${r.status}`
          setSendError(detail)
          setTimeout(() => setSendError(''), 10_000)
          throw new Error(detail)
        }
        const json = await r.json()
        res.push({ name: info.company_name, number: info.number, status: json.status === 'sent' ? 'sent' : 'failed' })
      } catch {
        res.push({ name: info.company_name, number: info.number, status: 'failed' })
      }
      setResults([...res])
      msgsInBatch++
      if (i < targets.length - 1) {
        if (msgsInBatch >= nextBreakAt) {
          msgsInBatch = 0
          nextBreakAt = randBatchSize(sendCfg)
          currentBatch++
          setBatchNum(currentBatch)
          await waitWithTimer(randBatchBreakMs(sendCfg), 'batch')
        } else {
          await waitWithTimer(randMsgDelayMs(sendCfg), 'msg')
        }
      }
    }

    setSending(false); setDone(true); sendingRef.current = false
    setCountdown(null); setBatchNum(1)
    const sent = res.filter(r => r.status === 'sent').length
    notify(
      `${sent} mensaje${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''}`,
      sent > 0 ? 'success' : 'warning'
    )
  }

  const sentCount   = results.filter(r => r.status === 'sent').length
  const failedCount = results.filter(r => r.status === 'failed').length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <Box sx={{ flexShrink: 0, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.4 }}>
          <Box sx={{ width: 34, height: 34, borderRadius: 2, bgcolor: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CampaignIcon sx={{ color: '#4ade80', fontSize: 18 }} />
          </Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '1.05rem' }}>{t.campaign.title}</Typography>
        </Box>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.campaign.subtitle}</Typography>
      </Box>

      {/* Two columns: message+timing / recipients table.
          overflow:hidden + no flex-wrap is deliberate — with wrap enabled, expanding
          the Send Timing panel made this row's height content-driven, which pushed
          the sticky send button (and the recipients column) further down the page
          instead of staying put while the LEFT column scrolls internally. */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2.5, overflow: 'hidden' }}>
        {/* Left — templates, timing, send */}
        <Box sx={{ flex: '1 1 420px', minWidth: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.8, pr: 0.5 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <StepHeader n={1} title={t.campaign.stepTemplates} />
              <SectionCard>
                <TemplateLibraryPicker
                  onChange={setTemplateTexts}
                  recipientCount={targets.length}
                  baseCount={0}
                  hasName={hasNameData}
                  hasCity={hasCityData}
                  hasIndustry={hasIndustryData}
                  hasWeb={hasWebData}
                />
              </SectionCard>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <StepHeader n={2} title={t.campaign.stepTiming} />
              <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={sending} />
            </Box>

            {sending && countdown !== null && (
              <CountdownBar countdown={countdown} total={cdTotal} label={cdLabel} batchNum={batchNum} msgNum={results.length} msgTotal={targets.length} />
            )}

            <InstanceDisconnectedBanner status={instanceStatus} />
            <SendErrorBanner error={sendError} onDismiss={() => setSendError('')} />

            {(sending || done) && (
              <Box>
                {sending && (
                  <Box sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.6 }}>
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Enviando… {results.length} de {targets.length}
                      </Typography>
                      <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{progress}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={progress}
                      sx={{ borderRadius: 4, height: 5, bgcolor: 'rgba(34,197,94,0.1)', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg,#22c55e,#4ade80)', borderRadius: 4 } }} />
                  </Box>
                )}
                {done && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label={`${sentCount} enviado${sentCount !== 1 ? 's' : ''}`} size="small"
                      sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', fontSize: '0.72rem', height: 24 }} />
                    {failedCount > 0 && (
                      <Chip label={`${failedCount} fallido${failedCount !== 1 ? 's' : ''}`} size="small"
                        sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.72rem', height: 24 }} />
                    )}
                  </Box>
                )}
              </Box>
            )}

            {/* Sticky send bar — lives INSIDE the scrollable area with position:sticky
                instead of relying on a flexShrink:0 sibling + a perfectly-bounded
                ancestor flex chain (that kept breaking as content above grew). Sticky
                only needs this box's own scrolling ancestor, which is much more
                resilient. mt:'auto' pins it to the bottom when content is short. */}
            <Box sx={{
              position: 'sticky', bottom: -1, mt: 'auto', pt: 1.5, pb: 0.5,
              borderTop: '1px solid var(--border)',
              bgcolor: 'var(--card-bg, #161d2e)',
              display: 'flex', flexDirection: 'column', gap: 0.6,
            }}>
              <Button
                fullWidth
                onClick={handleSend}
                disabled={!canSend || isDisconnected}
                startIcon={sending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 16 }} />}
                sx={{
                  bgcolor: canSend ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.05)',
                  color:   canSend ? '#fff' : 'rgba(255,255,255,0.3)',
                  border:  `1px solid ${canSend ? 'rgba(34,197,94,0.9)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 2, px: 3, py: 1.1, fontWeight: 700, textTransform: 'none', fontSize: '0.9rem',
                  '&:hover': { bgcolor: canSend ? '#22c55e' : 'rgba(255,255,255,0.05)' },
                }}
              >
                {sending ? 'Enviando…' : `${t.campaign.sendBtn}${targets.length ? ` (${targets.length})` : ''}`}
              </Button>
              {!canSend && !sending && (
                <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', textAlign: 'center' }}>
                  {targets.length === 0 ? t.campaign.blockedNoRecipients
                    : cleanMessages.length === 0 ? t.campaign.blockedNoTemplate
                    : belowMinTemplates ? t.tplLib.minRequiredBlock(MIN_TEMPLATES_FOR_BULK, cleanMessages.length)
                    : ''}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        {/* Right — recipients table, ~half the screen */}
        <Box sx={{ flex: '1 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StepHeader n={3} title={t.campaign.stepRecipients} />
            {targets.length > 0 && (
              <Chip icon={<GroupsIcon sx={{ fontSize: '13px !important' }} />} label={t.campaign.selectedCount(targets.length)} size="small"
                sx={{ bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', color: 'var(--accent,#60a5fa)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)', fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }} />
            )}
          </Box>
          <CompanyPicker
            selectedNums={selectedNums}
            numInfoMap={numInfoMap}
            onChange={(ns, nm) => { setSelectedNums(ns); setNumInfoMap(nm) }}
            listMaxHeight="60vh"
          />
        </Box>
      </Box>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  )
}
