'use client'
import { useState, useMemo, useEffect } from 'react'
import { useLang } from '../context/LangContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { useSendQueue } from '../context/SendQueueContext'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import { CompanyPicker, extractPhoneDigits } from './scheduledSends'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { SendConfigPanel } from './SendConfigPanel'
import { InstanceDisconnectedBanner } from './InstanceStatusBanner'
import DailyCapBadge, { getOverBy } from './DailyCapBadge'
import CapacityBanner from './CapacityBanner'
import { loadSendConfig } from '@/lib/sendConfig'
import { getMinTemplatesRequired, pickMessageVariant } from '@/lib/messageVariants'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import SendIcon from '@mui/icons-material/Send'
import CampaignIcon from '@mui/icons-material/Campaign'
import GroupsIcon from '@mui/icons-material/Groups'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'

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

function StepHint({ hint }) {
  if (!hint) return null
  return (
    <Tooltip title={hint} placement="top" arrow>
      <InfoOutlinedIcon sx={{ fontSize: 14, color: 'var(--text-muted)', cursor: 'help', opacity: 0.55, '&:hover': { opacity: 1 } }} />
    </Tooltip>
  )
}

function StepHeader({ n, title, hint }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.22), rgba(var(--accent-rgb,59,130,246),0.06))',
        border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.5)',
        boxShadow: '0 0 10px rgba(var(--accent-rgb,59,130,246),0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>{n}</Typography>
      </Box>
      <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </Typography>
      <StepHint hint={hint} />
    </Box>
  )
}

function StepSection({ n, title, hint, children, isLast = false }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28 }}>
        <Box sx={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.22), rgba(var(--accent-rgb,59,130,246),0.06))',
          border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.5)',
          boxShadow: '0 0 10px rgba(var(--accent-rgb,59,130,246),0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>{n}</Typography>
        </Box>
        {!isLast && (
          <Box sx={{
            flex: 1, width: 2, mt: 0.75,
            background: 'linear-gradient(180deg, rgba(var(--accent-rgb,59,130,246),0.28) 0%, transparent 100%)',
            borderRadius: 1,
          }} />
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: '2px', mb: 1 }}>
          <Typography sx={{
            color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem',
            textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1,
          }}>
            {title}
          </Typography>
          <StepHint hint={hint} />
        </Box>
        {children}
      </Box>
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
  const { t, lang } = useLang()
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const { addBatch, active, queueLen, completedCount } = useSendQueue()

  // ── Recipients (per-number selection, same shape CompanyPicker/CampaignForm use) ──
  const [selectedNums, setSelectedNums] = useState(() => new Set())
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map())

  // ── Message + timing ──
  const [templateTexts, setTemplateTexts] = useState([])
  const [sendCfg,       setSendCfg]       = useState(() => loadSendConfig())

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
  const cleanMessages = useMemo(() => templateTexts.map(m => m.trim()).filter(Boolean), [templateTexts])
  // Preview of what the first selected recipient could actually receive —
  // same eligible-template filtering + variable substitution handleSend()
  // uses at send time. Shows EVERY eligible variant, not just one: with
  // several templates selected, pickMessageVariant() picks one at random
  // per send, so previewing only the first one hid which other messages
  // could just as likely go out.
  const previewTarget = targets[0] ?? null
  const previewMessages = useMemo(() => {
    if (!previewTarget || cleanMessages.length === 0) return []
    const eligible = cleanMessages.filter(m => templateFitsTarget(m, previewTarget))
    const pool = eligible.length ? eligible : cleanMessages
    return pool.map(m => m
      .replace(/\{\{nombre\}\}/g,    previewTarget.company_name || '')
      .replace(/\{\{ciudad\}\}/g,    previewTarget.city || '')
      .replace(/\{\{industria\}\}/g, previewTarget.industry || '')
      .replace(/\{\{web\}\}/g,       previewTarget.web || ''))
  }, [previewTarget, cleanMessages])
  const minTemplatesRequired = getMinTemplatesRequired(targets.length)
  const belowMinTemplates = targets.length > 1 && cleanMessages.length < minTemplatesRequired
  const overBy      = getOverBy(capStats, targets.length)
  const capBlocked  = overBy > 0
  const canSend = targets.length > 0 && cleanMessages.length > 0 && !belowMinTemplates && !capBlocked && !isSending

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
      {/* Header — mismo detalle de ícono en caja degradada + línea de brillo
         inferior que ya usan Performance/Instances/Warmup, en vez del ícono
         de fondo plano y sin glow de antes. */}
      <Box sx={{ flexShrink: 0, mb: 2, pb: 1.4, position: 'relative' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 0.4 }}>
          <Box sx={{
            width: 34, height: 34, borderRadius: 2, flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.28) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
            border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CampaignIcon sx={{ color: 'var(--accent)', fontSize: 18 }} />
          </Box>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '1.05rem' }}>{t.campaign.title}</Typography>
        </Box>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.campaign.subtitle}</Typography>
        <Box sx={{
          position: 'absolute', bottom: 0, left: 0, right: '40%', height: '1px',
          background: 'linear-gradient(90deg, rgba(var(--accent-rgb,59,130,246),0.4), transparent)',
        }} />
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
            <StepSection n={1} title={t.campaign.stepTemplates} hint={t.campaign.hintTemplates}>
              <SectionCard>
                <TemplateLibraryPicker
                  onChange={setTemplateTexts}
                  recipientCount={targets.length}
                  baseCount={0}
                  singleSelect={targets.length <= 1}
                  hasName={hasNameData}
                  hasCity={hasCityData}
                  hasIndustry={hasIndustryData}
                  hasWeb={hasWebData}
                />
              </SectionCard>
            </StepSection>

            <StepSection n={2} title={t.campaign.stepTiming} hint={t.campaign.hintTiming} isLast>
              <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={isSending} />
            </StepSection>

            {/* Vista previa — antes este hueco entre "Send timing" y la barra
               de enviar se quedaba vacío hasta que una campaña estuviera en
               curso; ahora muestra el mensaje real (con variables ya
               sustituidas) que recibiría el primer destinatario seleccionado.
               Con varias plantillas elegidas se muestran TODAS las variantes
               elegibles, no solo una — pickMessageVariant() elige al azar
               entre ellas al enviar, así que mostrar solo la primera
               escondía cuáles otros mensajes podían salir igual de probable. */}
            <SectionCard>
              {/* Header — mismo detalle de ícono en caja degradada que el
                 resto de la app, en vez del label plano de antes. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{
                  width: 26, height: 26, borderRadius: '8px', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.26) 0%, rgba(34,197,94,0.1) 100%)',
                  border: '1px solid rgba(34,197,94,0.32)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <WhatsAppIcon sx={{ fontSize: 14, color: '#4ade80' }} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.8rem', lineHeight: 1.2 }}>
                    {lang === 'en' ? 'Preview' : 'Vista previa'}
                  </Typography>
                  <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem', lineHeight: 1.2 }}>
                    {lang === 'en' ? 'Real example, variables already filled in' : 'Ejemplo real, con variables ya sustituidas'}
                  </Typography>
                </Box>
              </Box>

              {previewMessages.length > 0 ? (
                <>
                  {/* Chip del destinatario de ejemplo — antes el texto solo
                     nombraba ese número sin dejar claro que es apenas UNO de
                     varios seleccionados, lo que sonaba como si la vista
                     previa fuera solo sobre ese contacto. */}
                  <Box sx={{
                    display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 0.7,
                    px: 1.1, py: 0.45, borderRadius: 10,
                    bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                  }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#4ade80', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600 }}>
                      {previewTarget.company_name || previewTarget.number}
                    </Typography>
                    {targets.length > 1 && (
                      <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        · {lang === 'en' ? `example 1 of ${targets.length} recipients` : `ejemplo 1 de ${targets.length} destinatarios`}
                      </Typography>
                    )}
                  </Box>
                  <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {previewMessages.length > 1
                      ? (lang === 'en' ? `Any of these ${previewMessages.length} variants could be picked at random:` : `Cualquiera de estas ${previewMessages.length} variantes puede tocarle al azar:`)
                      : (lang === 'en' ? 'Would receive:' : 'Recibiría:')}
                  </Typography>
                  {/* Con más de 3 templates elegidos esta lista escala su
                     propio scroll en vez de empujar toda la página hacia
                     abajo. Cada burbuja ahora usa la misma forma/color que
                     los mensajes salientes reales en Conversaciones
                     (esquina inferior derecha recta + var(--accent)) en vez
                     de un verde WhatsApp genérico sin relación con el resto
                     de la app — y un divider separa cada variante de la
                     siguiente. */}
                  <Box sx={{
                    display: 'flex', flexDirection: 'column', gap: 1.2,
                    maxHeight: 300, overflowY: 'auto', pr: 0.5,
                    '&::-webkit-scrollbar': { width: 4 },
                    '&::-webkit-scrollbar-button': { display: 'none' },
                    '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
                    '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                  }}>
                    {previewMessages.map((msg, i) => (
                      <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {i > 0 && <Divider sx={{ borderColor: 'var(--border)', mb: 0.7 }} />}
                        {previewMessages.length > 1 && (
                          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem', fontWeight: 700 }}>
                            {lang === 'en' ? `Variant ${i + 1}` : `Variante ${i + 1}`}
                          </Typography>
                        )}
                        <Box sx={{
                          alignSelf: 'flex-start', maxWidth: '85%', position: 'relative',
                          bgcolor: 'var(--accent, #6366f1)', color: 'rgba(255,255,255,0.9)',
                          borderRadius: '14px 14px 4px 14px', px: 1.4, py: 0.9,
                          border: '1px solid rgba(0,0,0,0.15)',
                          fontSize: '0.82rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                        }}>
                          {msg}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                  {targets.length > 1 && (
                    <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontStyle: 'italic' }}>
                      {lang === 'en'
                        ? `Each of the other ${targets.length - 1} selected recipient${targets.length - 1 !== 1 ? 's' : ''} gets their own variables substituted the same way.`
                        : `Cada uno de los otros ${targets.length - 1} destinatario${targets.length - 1 !== 1 ? 's' : ''} seleccionados recibe sus propias variables sustituidas de la misma forma.`}
                    </Typography>
                  )}
                </>
              ) : (
                <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>
                  {lang === 'en'
                    ? 'Pick a template and at least one recipient to preview the actual message.'
                    : 'Elige un template y al menos un destinatario para ver el mensaje real.'}
                </Typography>
              )}
            </SectionCard>

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
          </Box>

          {/* Send bar — antes vivía DENTRO del área con scroll usando
             position:sticky, lo que forzaba trucos de blur/degradado para
             que no se viera como un parche sobre el contenido que pasaba
             detrás. Ahora es un hermano fuera del Box con overflowY:auto:
             solo el scroll de arriba (templates/timing/vista previa) se
             mueve, esta barra se queda fija como un tope real, con fondo
             sólido normal, sin necesitar ningún truco de transparencia. */}
          <Box sx={{
            flexShrink: 0, pt: 1.5, pb: 0.5, mt: 1,
            borderTop: '1px solid var(--border)',
            // Cualquier color fijo (var(--bg), var(--card-bg), lo que sea)
            // es una adivinanza que puede desalinearse del fondo real
            // configurado dinámicamente. Ya no hay nada scrolleando detrás
            // de esta barra (vive fuera del área con scroll), así que ya no
            // necesita ningún color propio — transparent simplemente hereda
            // el fondo real de su contenedor, sea cual sea, sin adivinar.
            bgcolor: 'transparent',
            display: 'flex', flexDirection: 'column', gap: 0.6,
          }}>
            {capStats && capStats.total_available <= 0 && (
              <CapacityBanner stats={capStats} selectionCount={Math.max(targets.length, 1)} sx={{ mb: 0.5 }} />
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <DailyCapBadge stats={capStats} selectionCount={targets.length} />
            </Box>
            <Button
              fullWidth
              onClick={handleSend}
              disabled={!canSend || isDisconnected}
              startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 16 }} />}
              sx={{
                bgcolor: canSend ? 'rgba(34,197,94,0.85)' : 'var(--item-hover)',
                color:   canSend ? '#fff' : 'var(--text-muted)',
                border:  `1px solid ${canSend ? 'rgba(34,197,94,0.9)' : 'var(--border)'}`,
                borderRadius: 2, px: 3, py: 1.1, fontWeight: 700, textTransform: 'none', fontSize: '0.9rem',
                boxShadow: 'none',
                transition: 'all 0.25s ease',
                '&:hover': { bgcolor: canSend ? '#22c55e' : 'rgba(255,255,255,0.05)', boxShadow: 'none' },
                // MUI's own .Mui-disabled base style otherwise overrides the
                // custom border/background above with its generic light-gray
                // default, producing a bright outline that clashes with the
                // dark theme — force ours to actually win.
                '&.Mui-disabled': {
                  bgcolor: 'var(--item-hover) !important',
                  color: 'var(--text-muted) !important',
                  border: '1px solid var(--border) !important',
                },
              }}
            >
              {isSending ? t.campaign.sending : `${t.campaign.sendBtn}${targets.length ? ` (${targets.length})` : ''}`}
            </Button>
            {!canSend && !isSending && (
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', textAlign: 'center' }}>
                {targets.length === 0 ? t.campaign.blockedNoRecipients
                  : cleanMessages.length === 0 ? t.campaign.blockedNoTemplate
                  : belowMinTemplates ? t.tplLib.minRequiredBlock(minTemplatesRequired, cleanMessages.length)
                  : capBlocked ? (lang === 'en' ? `Deselect ${overBy} to fit today's quota` : `Desmarca ${overBy} para caber en tu cupo de hoy`)
                  : ''}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Right — recipients table, ~half the screen */}
        <Box sx={{ flex: '1 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1, overflowY: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StepHeader n={3} title={t.campaign.stepRecipients} hint={t.campaign.hintRecipients} />
            {targets.length > 0 && (
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.8,
                px: 1.2, py: 0.5, borderRadius: 2,
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.2), rgba(var(--accent-rgb,59,130,246),0.07))',
                border: '1px solid rgba(var(--accent-rgb,59,130,246),0.4)',
                boxShadow: '0 0 12px rgba(var(--accent-rgb,59,130,246),0.12)',
              }}>
                <GroupsIcon sx={{ fontSize: 14, color: 'var(--accent,#60a5fa)' }} />
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--accent,#60a5fa)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {targets.length}
                </Typography>
                <Typography sx={{ fontSize: '0.66rem', color: 'rgba(var(--accent-rgb,59,130,246),0.55)', lineHeight: 1 }}>
                  sel.
                </Typography>
              </Box>
            )}
          </Box>
          <CompanyPicker
            selectedNums={selectedNums}
            numInfoMap={numInfoMap}
            onChange={(ns, nm) => { setSelectedNums(ns); setNumInfoMap(nm) }}
            listMaxHeight="60vh"
            contactedRefreshKey={contactedRefreshKey}
            newContactsCap={capStats?.new_contacts_capacity ?? null}
          />
        </Box>
      </Box>
    </Box>
  )
}
