'use client'
import { useState, useMemo, useEffect } from 'react'
import { useLang } from '../context/LangContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { useSendQueue } from '../context/SendQueueContext'
import { CompanyPicker, extractPhoneDigits } from './scheduledSends'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { SendConfigPanel } from './SendConfigPanel'
import { InstanceDisconnectedBanner } from './InstanceStatusBanner'
import { loadSendConfig } from '@/lib/sendConfig'
import { MIN_TEMPLATES_FOR_BULK, pickMessageVariant } from '@/lib/messageVariants'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
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
  const { addBatch, active, queueLen } = useSendQueue()

  // ── Recipients (per-number selection, same shape CompanyPicker/CampaignForm use) ──
  const [selectedNums, setSelectedNums] = useState(() => new Set())
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map())

  // ── Message + timing ──
  const [templateTexts, setTemplateTexts] = useState([])
  const [sendCfg,       setSendCfg]       = useState(() => loadSendConfig())

  // ── Done state: captured from context on success phase ──
  const [done,      setDone]      = useState(false)
  const [doneCount, setDoneCount] = useState(0)

  useEffect(() => {
    if (active?.phase === 'success') {
      setDoneCount(active.sent)
      setDone(true)
    }
  }, [active])

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
  const cleanMessages = useMemo(() => templateTexts.map(m => m.trim()).filter(Boolean), [templateTexts])
  const belowMinTemplates = targets.length > 1 && cleanMessages.length < MIN_TEMPLATES_FOR_BULK
  const canSend = targets.length > 0 && cleanMessages.length > 0 && !belowMinTemplates && !isSending

  function handleSend() {
    if (!canSend) return
    setDone(false)
    // Pre-compute per-recipient messages (variant selection + variable substitution)
    // before enqueuing so all randomization happens at click time, not during send.
    let lastVariant = null
    const jobs = targets.map(info => {
      const eligible = cleanMessages.filter(m => templateFitsTarget(m, info))
      const pool = eligible.length ? eligible : cleanMessages
      const variant = pickMessageVariant(pool, lastVariant)
      lastVariant = variant
      const message = variant
        .replace(/\{\{nombre\}\}/g,    info.company_name || '')
        .replace(/\{\{ciudad\}\}/g,    info.city || '')
        .replace(/\{\{industria\}\}/g, info.industry || '')
        .replace(/\{\{web\}\}/g,       info.web || '')
      const cleanNumber = extractPhoneDigits(info.number) || info.number
      return { numbers: [cleanNumber], messages: [message], companyId: info.company_id, website: info.web }
    })
    addBatch(jobs, t.campaign.title)
  }

  // Countdown label derived from global queue state
  const isWaiting    = active?.phase === 'waiting' && active.countdown > 0
  const isBatchBreak = isWaiting && active.batch

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
              <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={isSending} />
            </Box>

            <InstanceDisconnectedBanner status={instanceStatus} />

            {/* Progress — driven by global queue state so it persists across navigation */}
            {(isSending || done) && (
              <Box>
                {isSending && active && (
                  <Box sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        {isWaiting
                          ? (isBatchBreak
                              ? `${t.campaign.sendingProgress(active.sent, active.total)} — pausa ${active.countdown}s`
                              : `${t.campaign.sendingProgress(active.sent, active.total)} — ${active.countdown}s`)
                          : t.campaign.sendingProgress(active.sent, active.total)
                        }
                      </Typography>
                      <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{progress}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={progress}
                      sx={{ borderRadius: 4, height: 5, bgcolor: 'rgba(34,197,94,0.1)', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg,#22c55e,#4ade80)', borderRadius: 4 } }} />
                  </Box>
                )}
                {done && !isSending && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip label={`${doneCount} enviado${doneCount !== 1 ? 's' : ''}`} size="small"
                      sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', fontSize: '0.72rem', height: 24 }} />
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
                startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 16 }} />}
                sx={{
                  bgcolor: canSend ? 'rgba(34,197,94,0.85)' : 'rgba(255,255,255,0.05)',
                  color:   canSend ? '#fff' : 'rgba(255,255,255,0.3)',
                  border:  `1px solid ${canSend ? 'rgba(34,197,94,0.9)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 2, px: 3, py: 1.1, fontWeight: 700, textTransform: 'none', fontSize: '0.9rem',
                  '&:hover': { bgcolor: canSend ? '#22c55e' : 'rgba(255,255,255,0.05)' },
                }}
              >
                {isSending ? t.campaign.sending : `${t.campaign.sendBtn}${targets.length ? ` (${targets.length})` : ''}`}
              </Button>
              {!canSend && !isSending && (
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
    </Box>
  )
}
