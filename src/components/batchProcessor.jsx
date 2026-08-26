'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { isValidUrl } from '@/lib/validators'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { InstanceDisconnectedBanner, SendErrorBanner } from './InstanceStatusBanner'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TableContainer from '@mui/material/TableContainer'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import SendIcon from '@mui/icons-material/Send'
import DownloadIcon from '@mui/icons-material/Download'
import ListAltIcon from '@mui/icons-material/ListAlt'
import CloseIcon from '@mui/icons-material/Close'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import LinkIcon from '@mui/icons-material/Link'
import InboxIcon from '@mui/icons-material/Inbox'
import MessageIcon from '@mui/icons-material/Message'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { getTemplates } from './singleUrlProcessor'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { MIN_TEMPLATES_FOR_BULK, pickMessageVariant } from '@/lib/messageVariants'
import { SendConfigPanel } from './SendConfigPanel'
import { loadSendConfig } from '@/lib/sendConfig'
import { useSendQueue } from '../context/SendQueueContext'
import { useScrapeJob } from '../hooks/useScrapeJob'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import DailyCapBadge, { getOverBy } from './DailyCapBadge'
import WhatsAppNumberSummary from './WhatsAppNumberSummary'
import RecipientsBox from './RecipientsBox'
import CapacityBanner from './CapacityBanner'
import { dedupeByCompany } from '../lib/companyDedupe'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'

const EXAMPLES = [
  'https://pizzeria-mario.com.mx/\nhttps://ferreteria-sanchez.mx/\nhttps://spa-belleza-queretaro.com/\nhttps://taller-mecanico-hdz.mx/\nhttps://restaurante-oaxaca.com.mx/\nhttps://constructora-garcia.mx/',
  'https://hotel-sierra-madre.com/\nhttps://farmacia-central-gdl.mx/\nhttps://veterinaria-lopez.com.mx/\nhttps://gym-fitness-monterrey.mx/\nhttps://dentista-perez-qro.com/',
  'https://panaderia-flor-de-lis.mx/\nhttps://mecanico-express-cdmx.com/\nhttps://estetica-canina-gdl.mx/\nhttps://plomero-24hrs-mty.com/\nhttps://abogados-garcia-y-soc.mx/',
]

function useTypewriter(strings, active) {
  const [display, setDisplay] = useState('')
  const ref = useRef({ wordIdx: 0, charIdx: 0, deleting: false })

  useEffect(() => {
    if (!active) { setDisplay(''); return }
    let timer
    function tick() {
      const s    = ref.current
      const word = strings[s.wordIdx]
      if (!s.deleting) {
        if (s.charIdx < word.length) {
          const next = s.charIdx + 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 38)
        } else {
          ref.current = { ...s, deleting: true }
          timer = setTimeout(tick, 1600)
        }
      } else {
        if (s.charIdx > 0) {
          const next = s.charIdx - 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 22)
        } else {
          ref.current = { wordIdx: (s.wordIdx + 1) % strings.length, charIdx: 0, deleting: false }
          timer = setTimeout(tick, 400)
        }
      }
    }
    timer = setTimeout(tick, 700)
    return () => clearTimeout(timer)
  }, [active, strings])

  return display
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color, bgColor, borderColor }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0,
      display: 'flex', alignItems: 'center', gap: 1.5,
      px: 2, py: 1.5,
      bgcolor: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 2,
    }}>
      <Box sx={{
        width: 32, height: 32, flexShrink: 0,
        bgcolor: `${color}22`,
        border: `1px solid ${color}44`,
        borderRadius: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ t }) {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      py: 5, gap: 1.5,
      borderRadius: 3,
      border: '1px dashed rgba(255,255,255,0.07)',
      background: 'radial-gradient(ellipse at 50% 60%, rgba(59,130,246,0.04) 0%, transparent 70%)',
    }}>
      <Box sx={{
        width: 48, height: 48,
        bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.07)',
        border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.15)',
        borderRadius: '14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 24px rgba(59,130,246,0.08)',
      }}>
        <InboxIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 22, opacity: 0.55 }} />
      </Box>
      <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.83rem', fontWeight: 600 }}>
          {t.batch.emptyTitle}
        </Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.73rem' }}>
          {t.batch.emptyHint}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── URL preview list (live, pre-scrape) ──────────────────────────────────────
function UrlPreviewList({ urlList }) {
  const validCount = urlList.filter(u => isValidUrl(u)).length
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.1 }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
          URLs detectadas
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'rgba(255,255,255,0.18)', fontVariantNumeric: 'tabular-nums' }}>
          {validCount} / {urlList.length} válidas
        </Typography>
      </Box>
      <Box sx={{
        display: 'flex', flexDirection: 'column', gap: 0.3,
        maxHeight: 230, overflowY: 'auto',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: 2 },
        pr: 0.25,
      }}>
        {urlList.map((url, i) => {
          const valid = isValidUrl(url)
          const isDup = urlList.indexOf(url) !== i
          let domain = null
          try {
            domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
          } catch {}

          const borderColor = isDup ? 'rgba(251,191,36,0.18)' : valid ? 'rgba(255,255,255,0.055)' : 'rgba(239,68,68,0.22)'
          const bgColor     = isDup ? 'rgba(251,191,36,0.035)' : valid ? 'rgba(255,255,255,0.02)' : 'rgba(239,68,68,0.055)'
          const dotColor    = isDup ? '#fbbf24' : valid ? '#4ade80' : '#f87171'
          const textColor   = isDup ? '#fbbf24' : valid ? 'rgba(255,255,255,0.72)' : '#f87171'

          return (
            <Box key={i} sx={{
              display: 'flex', alignItems: 'center', gap: 0.9,
              px: 1.1, py: 0.5, borderRadius: 1.5,
              bgcolor: bgColor, border: `1px solid ${borderColor}`,
            }}>
              <Typography sx={{ fontSize: '0.59rem', color: 'rgba(255,255,255,0.18)', fontVariantNumeric: 'tabular-nums', minWidth: 16, textAlign: 'right', flexShrink: 0 }}>
                {i + 1}
              </Typography>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: dotColor, boxShadow: `0 0 5px ${dotColor}88` }} />
              {domain && valid && (
                <Box component="img"
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                  width={13} height={13}
                  sx={{ borderRadius: '2px', flexShrink: 0 }}
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <Typography sx={{ flex: 1, fontSize: '0.75rem', color: textColor, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {domain || url}
              </Typography>
              {isDup && (
                <Box sx={{ px: 0.65, py: 0.1, borderRadius: '4px', bgcolor: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.22)', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '0.57rem', color: '#fbbf24', fontWeight: 700, letterSpacing: '0.04em' }}>DUP</Typography>
                </Box>
              )}
              {!valid && (
                <Box sx={{ px: 0.65, py: 0.1, borderRadius: '4px', bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '0.57rem', color: '#f87171', fontWeight: 700, letterSpacing: '0.04em' }}>INV</Typography>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

const VAR_COLORS = { nombre: '#818cf8', ciudad: '#38bdf8', industria: '#fb923c', web: '#a78bfa' }
function highlightVars(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\{\{(nombre|ciudad|industria|web)\}\}/g, (_, k) =>
      `<span style="background:${VAR_COLORS[k]}28;color:${VAR_COLORS[k]};border-radius:4px;padding:0 3px;font-weight:700;">${k}</span>`
    )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function renderTemplate(text, scraped) {
  if (!text) return ''
  const extra = scraped?._extra || {}
  return text
    .replace(/\{\{nombre\}\}/g,    scraped?.name || '')
    .replace(/\{\{ciudad\}\}/g,    extra.city || '')
    .replace(/\{\{industria\}\}/g, scraped?.industry || '')
    .replace(/\{\{web\}\}/g,       scraped?.website || '')
}

export default function BatchProcessor() {
  const { t, lang } = useLang()
  const TEMPLATES = getTemplates(t)
  const [rawUrls,     setRawUrls]     = useState('')
  const scrapeJob = useScrapeJob('batch')
  // El scraping en sí corre en el backend (useScrapeJob) — esto solo cubre el
  // estado optimista de envío por url, que el job no conoce.
  const [sentOverlay, setSentOverlay] = useState({})
  const [selectedTpl, setSelectedTpl] = useState(TEMPLATES[0].id)
  const [msgText,     setMsgText]     = useState(TEMPLATES[0].text)
  const [extraVariants, setExtraVariants] = useState([])
  const [sendError,   setSendError]   = useState('')
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const [sendCfg,     setSendCfg]     = useState(() => loadSendConfig())
  const { addBatch, cancel: cancelQueue, active: queueActive } = useSendQueue()
  const { stats: capStats, refresh: refreshCapStats } = useDailyCapStats()
  const [confirmDialog,     setConfirmDialog]     = useState({ open: false, names: '', resolve: null })
  const [newContactsDialog, setNewContactsDialog] = useState({ open: false, trimCount: 0, newRemaining: 0, resolve: null })
  // Qué empresas (de las que tienen WhatsApp) quedan destildadas del envío masivo —
  // mismo patrón que ya usa searchProspects.jsx, portado aquí porque antes esto
  // era todo-o-nada.
  const [waDeselected, setWaDeselected] = useState(new Set())
  // Números EXTRA (además del principal) prendidos a mano al expandir el chip
  // de una empresa — clave `${company_id}::${number}`.
  const [extraSelected, setExtraSelected] = useState(new Set())
  const [expandedCo, setExpandedCo] = useState(new Set())
  const msgRef       = useRef(null)
  const highlightRef = useRef(null)
  function syncScroll() {
    if (highlightRef.current && msgRef.current)
      highlightRef.current.scrollTop = msgRef.current.scrollTop
  }
  const urlsRef     = useRef(null)

  const loading      = scrapeJob.processing
  const pausing      = scrapeJob.pausing
  const paused       = scrapeJob.paused
  const scrapeActive = loading && !paused && !pausing   // running and not stopped
  const done       = scrapeJob.done
  const progress   = scrapeJob.progress
  const doneCount  = scrapeJob.processed
  const totalCount = scrapeJob.total
  const currentUrl = scrapeJob.currentUrl
  const rows = useMemo(() => {
    const results = scrapeJob.results
    return Object.keys(sentOverlay).length
      ? results.map(r => sentOverlay[r.url] ? { ...r, msg_status: sentOverlay[r.url] } : r)
      : results
  }, [scrapeJob.results, sentOverlay])

  useEffect(() => {
    if (queueActive?.phase === 'success') {
      setSentOverlay(prev => {
        const next = { ...prev }
        for (const k in next) if (next[k] === 'queued') next[k] = 'sent'
        return next
      })
      refreshCapStats()
    }
  }, [queueActive?.phase, refreshCapStats])

  const placeholder = useTypewriter(EXAMPLES, !rawUrls && !loading)

  const urlList = useMemo(
    () => rawUrls.split('\n').map(u => u.trim()).filter(Boolean),
    [rawUrls]
  )
  const invalidUrls   = useMemo(() => urlList.filter(u => !isValidUrl(u)), [urlList])
  const duplicateUrls = useMemo(() => urlList.filter((u, i) => urlList.indexOf(u) !== i), [urlList])
  const overLimit     = urlList.length > 50
  const canBatch      = urlList.length > 0 && !overLimit && invalidUrls.length === 0 && duplicateUrls.length === 0


  // waRowsUnique deduplicado por company_id — dos URLs distintas del lote pueden
  // resolver a la misma empresa ya existente en la BD.
  const waRowsAll    = rows.filter(r => r.ok && (r.all_whatsapp?.length > 0 || r.whatsapp) && r.company_id)
  const waRowsUnique = useMemo(() => dedupeByCompany(waRowsAll), [waRowsAll])
  // Los setState devuelven la MISMA referencia si ya estaban vacíos — evita que
  // este efecto re-dispare un render indefinidamente si `rows` llega a ser
  // referencialmente inestable entre renders (ver useScrapeJob.js EMPTY_RESULTS).
  // Reset selections only when a NEW scrape job starts (job _id changes),
  // not on every poll update — otherwise deselections get wiped every 3s.
  useEffect(() => {
    setWaDeselected(prev => prev.size ? new Set() : prev)
    setExtraSelected(prev => prev.size ? new Set() : prev)
    setExpandedCo(prev => prev.size ? new Set() : prev)
  }, [scrapeJob.job?._id])
  // Sent/failed rows auto-deselect so the user can send to new rows from resumed
  // scraping without having to manually uncheck the ones already processed.
  const effectiveWaSelected = useMemo(() =>
    new Set(waRowsUnique
      .filter(r => !waDeselected.has(r.company_id) && r.msg_status !== 'sent' && r.msg_status !== 'failed')
      .map(r => r.company_id)),
  [waRowsUnique, waDeselected])
  // Only block if the CURRENT selection has already-sent rows (prevents in-flight
  // double-sends without blocking newly-scraped rows after a send completes).
  const alreadySent = rows.some(r =>
    effectiveWaSelected.has(r.company_id) &&
    (r.msg_status === 'sent' || r.msg_status === 'failed' || r.msg_status === 'queued')
  )
  const isSending   = queueActive !== null && alreadySent
  // Un envío masivo manda por default 1 número por empresa (el principal) — evita
  // que una empresa con muchos números se coma el cupo diario de warmup de varias
  // empresas nuevas de golpe. Expandir el chip de una empresa permite agregar sus
  // otros números a propósito — cada uno cuenta su propio slot de cupo (el
  // backend deduplica por número real, no por empresa).
  const totalNumbers = effectiveWaSelected.size
  const totalContactPoints = totalNumbers +
    [...extraSelected].filter(key => effectiveWaSelected.has(key.split('::')[0])).length
  const overBy      = getOverBy(capStats, totalContactPoints)
  const capBlocked  = overBy > 0
  // Sending to 2+ numbers needs varied text (see MIN_TEMPLATES_FOR_BULK) — editing
  // one base message stops making sense there, so it switches to picking 3+ saved templates.
  const isBulk = totalNumbers > 1
  const allVariants = useMemo(
    () => (extraVariants.length > 0 ? extraVariants : [msgText]).map(v => v.trim()).filter(Boolean),
    [msgText, extraVariants]
  )
  const belowMinTemplates = isBulk && allVariants.length < MIN_TEMPLATES_FOR_BULK

  function handlePause() {
    if (pausing) return   // chunk still draining, button is disabled but guard anyway
    paused ? scrapeJob.resume() : scrapeJob.pause()
  }

  function handleCancelBatch() {
    scrapeJob.cancel()
  }

  // El loop de scraping ahora corre en el backend (backEnd/app/scrape_jobs.py) —
  // esto solo crea el job y lo deja al hook useScrapeJob hacer polling.
  async function handleBatch() {
    if (!urlList.length) return
    setSentOverlay({})
    await scrapeJob.start(urlList)
  }

  async function handleSendAll() {
    let targets = waRowsUnique.filter(r => effectiveWaSelected.has(r.company_id))
    if (!targets.length || belowMinTemplates || capBlocked) return

    // New-contacts daily cap — per-instance aware pre-flight.
    // Backend enforces 5/day per warmup instance and 12/day per normal instance.
    // Companies with an assigned_instance are checked against THAT instance's remaining cap.
    // Unassigned companies (new, not yet sent to) use the global pool.
    {
      const newInBatch = targets.filter(r => !r.already_contacted?.contacted)
      if (newInBatch.length > 0) {
        // Build per-instance remaining capacity map from capStats
        const instCapMap = Object.fromEntries(
          (capStats?.instances ?? []).map(inst => [inst.instance, inst.new_contacts_left ?? 0])
        )
        const globalPool = capStats?.new_contacts_capacity ?? Infinity

        // Split new contacts into "assigned to a known instance" vs "unassigned"
        const byInstance = {}
        const unassigned  = []
        for (const r of newInBatch) {
          if (r.assigned_instance && instCapMap[r.assigned_instance] !== undefined) {
            ;(byInstance[r.assigned_instance] ??= []).push(r)
          } else {
            unassigned.push(r)
          }
        }

        // Trim per-instance group to that instance's remaining cap
        const kept = []
        let totalTrimmed = 0
        for (const [inst, companies] of Object.entries(byInstance)) {
          const cap = instCapMap[inst] ?? 0
          kept.push(...companies.slice(0, cap))
          totalTrimmed += Math.max(0, companies.length - cap)
        }
        // Unassigned new contacts share the global remaining pool
        const unassignedCap = Math.min(globalPool, unassigned.length)
        kept.push(...unassigned.slice(0, unassignedCap))
        totalTrimmed += Math.max(0, unassigned.length - unassignedCap)

        if (totalTrimmed > 0) {
          const newRemaining = newInBatch.length - totalTrimmed
          const confirmed = await new Promise(resolve =>
            setNewContactsDialog({ open: true, trimCount: totalTrimmed, newRemaining, resolve })
          )
          if (!confirmed) return
          const existing = targets.filter(r => r.already_contacted?.contacted)
          targets = [...existing, ...kept]
        }
      }
    }

    const alreadyContacted = targets.filter(r => r.already_contacted?.contacted)
    if (alreadyContacted.length) {
      const names = alreadyContacted.map(r => r.empresa || r.url).join(', ')
      const confirmed = await new Promise(resolve => setConfirmDialog({ open: true, names, resolve }))
      if (!confirmed) return
    }
    let lastVariant = null
    const jobs = []
    const queuedUrls = {}
    for (const row of targets) {
      // Principal + números extra prendidos a mano para esta empresa — ver
      // nota junto a totalContactPoints.
      const primary = row.all_whatsapp?.length > 0 ? row.all_whatsapp[0] : row.whatsapp
      if (!primary) continue
      const extras = row.all_whatsapp?.slice(1).filter(n => extraSelected.has(`${row.company_id}::${n}`)) || []
      const numbers = [primary, ...extras]
      // Mismo texto para todos los números de UNA empresa.
      const v = pickMessageVariant(allVariants, lastVariant)
      lastVariant = v
      const message = renderTemplate(v, row.scraped_data)
      const messages = numbers.map(() => message)
      jobs.push({ numbers, messages, companyId: row.company_id, website: row.url })
      queuedUrls[row.url] = 'queued'
    }
    addBatch(jobs, lang === 'en' ? 'URL batch' : 'Lote de URLs')
    setSentOverlay(prev => ({ ...prev, ...queuedUrls }))
  }

  const sentCount  = rows.filter(r => r.msg_status === 'sent').length
  const noWaCount  = rows.filter(r => r.msg_status === 'no_wa' || (!r.whatsapp && r.ok)).length

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'status']
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => h === 'status' ? (r.ok ? 'ok' : 'error') : (r[h] || '')).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_lote.csv'
    a.click()
  }

  const okCount  = rows.filter(r => r.ok).length
  const errCount = rows.filter(r => !r.ok).length
  const waCount  = rows.filter(r => r.all_whatsapp?.length > 0 || r.whatsapp).length


  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%', overflowY: 'auto', pb: 2, pr: 0.5 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)',
            border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)',
            borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ListAltIcon sx={{ color: 'var(--accent, #60a5fa)', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              {t.batch.heading}
            </Typography>
            <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.35))', fontSize: '0.75rem' }}>
              {t.batch.subtitle}
            </Typography>
          </Box>
        </Box>

        {/* Contador de URLs detectadas */}
        {urlList.length > 0 && !loading && (
          <Chip
            icon={<LinkIcon sx={{ fontSize: '14px !important' }} />}
            label={`${urlList.length} URL${urlList.length !== 1 ? 's' : ''}`}
            size="small"
            sx={{
              bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)',
              color: 'var(--accent, #60a5fa)',
              border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)',
              fontWeight: 600,
              fontSize: '0.72rem',
              height: 24,
              '& .MuiChip-icon': { color: 'var(--accent, #60a5fa)' },
            }}
          />
        )}
      </Box>

      {/* ── Textarea ── */}
      <Box sx={{ position: 'relative' }}>
        {/* Contador + limpiar — esquina superior derecha */}
        {rawUrls && (
          <Box sx={{
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}>
            <Typography sx={{ color: overLimit ? '#f87171' : 'rgba(255,255,255,0.2)', fontSize: '0.7rem', fontWeight: overLimit ? 700 : 400, userSelect: 'none' }}>
              {urlList.length} / 50
            </Typography>
            {!loading && (
              <Tooltip title={t.batch.clear}>
                <IconButton
                  size="small"
                  onClick={() => { if (urlsRef.current) { urlsRef.current.value = ''; urlsRef.current.dispatchEvent(new Event('input', { bubbles: true })) } setSentOverlay({}); scrapeJob.reset() }}
                  sx={{ color: 'rgba(255,255,255,0.2)', p: 0.3, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}

        <Box
          component="textarea"
          ref={urlsRef}
          defaultValue=""
          onInput={e => setRawUrls(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleBatch()}
          placeholder={placeholder || ''}
          rows={9}
          disabled={loading}
          sx={{
            width: '100%',
            resize: 'vertical',
            boxSizing: 'border-box',
            bgcolor: 'var(--sidebar-bg, #0d1117)',
            color: 'var(--text, #f1f5f9)',
            border: '1.5px solid rgba(var(--accent-rgb, 59,130,246), 0.2)',
            borderRadius: '12px',
            p: 2,
            pt: rawUrls ? 3.5 : 2,
            pb: 6,
            pr: 6,
            fontSize: '0.9rem',
            lineHeight: 1.7,
            fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&::placeholder': { color: 'var(--text-muted, rgba(255,255,255,0.22))' },
            '&:hover': {
              borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.55)',
              boxShadow: '0 0 0 3px rgba(var(--accent-rgb, 59,130,246), 0.08)',
            },
            '&:focus': {
              borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.7)',
              boxShadow: '0 0 0 3px rgba(var(--accent-rgb, 59,130,246), 0.12)',
            },
            '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.13) transparent',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.13)', borderRadius: 2 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}
        />

        {/* Hint Ctrl+Enter */}
        {!loading && (
          <Typography variant="caption" sx={{
            position: 'absolute', bottom: 25, right: 54,
            color: 'rgba(255,255,255,0.18)', userSelect: 'none',
          }}>
            Ctrl+Enter
          </Typography>
        )}

        {/* Mensajes de error de validación */}
        {!loading && urlList.length > 0 && (overLimit || invalidUrls.length > 0 || duplicateUrls.length > 0) && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            {overLimit && (
              <Typography sx={{ color: '#f87171', fontSize: '0.72rem' }}>
                ⚠ {lang === 'en'
                  ? `Maximum 50 URLs. You are pasting ${urlList.length} — remove ${urlList.length - 50}.`
                  : `Máximo 50 URLs. Estás pegando ${urlList.length} — elimina ${urlList.length - 50}.`}
              </Typography>
            )}
            {invalidUrls.length > 0 && (
              <Typography sx={{ color: '#f87171', fontSize: '0.72rem' }}>
                ⚠ {lang === 'en'
                  ? `${invalidUrls.length} invalid URL${invalidUrls.length > 1 ? 's' : ''} (must start with https:// or http://): ${invalidUrls.slice(0, 2).join(', ')}${invalidUrls.length > 2 ? `… and ${invalidUrls.length - 2} more` : ''}`
                  : `${invalidUrls.length} URL${invalidUrls.length > 1 ? 's inválidas' : ' inválida'} (deben empezar con https:// o http://): ${invalidUrls.slice(0, 2).join(', ')}${invalidUrls.length > 2 ? `… y ${invalidUrls.length - 2} más` : ''}`}
              </Typography>
            )}
            {duplicateUrls.length > 0 && (
              <Typography sx={{ color: '#fbbf24', fontSize: '0.72rem' }}>
                ⚠ {lang === 'en'
                  ? `${duplicateUrls.length} duplicate URL${duplicateUrls.length > 1 ? 's' : ''}: ${[...new Set(duplicateUrls)].slice(0, 2).join(', ')}${duplicateUrls.length > 2 ? '…' : ''}`
                  : `${duplicateUrls.length} URL${duplicateUrls.length > 1 ? 's duplicadas' : ' duplicada'}: ${[...new Set(duplicateUrls)].slice(0, 2).join(', ')}${duplicateUrls.length > 2 ? '…' : ''}`}
              </Typography>
            )}
          </Box>
        )}

        {/* Botón enviar */}
        <IconButton
          onClick={handleBatch}
          disabled={loading || !canBatch}
          size="small"
          sx={{
            position: 'absolute', bottom: 20, right: 10,
            bgcolor: canBatch && !loading ? 'var(--accent, #3b82f6)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)',
            color: canBatch && !loading ? 'white' : 'rgba(255,255,255,0.25)',
            width: 36, height: 36,
            transition: 'all 0.2s',
            '&:hover': { bgcolor: canBatch && !loading ? 'var(--accent, #2563eb)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)' },
            '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)', color: 'rgba(255,255,255,0.15)' },
          }}
        >
          {loading
            ? <CircularProgress size={16} sx={{ color: 'inherit' }} />
            : <SendIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>

      {/* ── Progress ── */}
      {loading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{
            px: 2.5, py: 2,
            bgcolor: (paused || pausing) ? 'rgba(251,191,36,0.05)' : 'rgba(var(--accent-rgb, 59,130,246), 0.05)',
            border: `1px solid ${(paused || pausing) ? 'rgba(251,191,36,0.2)' : 'rgba(var(--accent-rgb, 59,130,246), 0.15)'}`,
            borderRadius: 2, transition: 'all 0.3s',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {paused ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} /> : <CircularProgress size={14} sx={{ color: pausing ? '#fbbf24' : 'var(--accent, #3b82f6)' }} />}
                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                  {paused
                    ? (lang === 'en' ? `Paused — ${doneCount} of ${totalCount}` : `Pausado — ${doneCount} de ${totalCount}`)
                    : pausing
                      ? (lang === 'en' ? `Pausing… — ${doneCount} of ${totalCount}` : `Pausando… — ${doneCount} de ${totalCount}`)
                      : (lang === 'en' ? `Scraping — ${doneCount} of ${totalCount}` : `Scrapeando — ${doneCount} de ${totalCount}`)}
                </Typography>
              </Box>
              <Typography sx={{ color: (paused || pausing) ? '#fbbf24' : 'var(--accent, #60a5fa)', fontWeight: 700, fontSize: '0.82rem' }}>
                {progress}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                borderRadius: 4, height: 6,
                bgcolor: (paused || pausing) ? 'rgba(251,191,36,0.1)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)',
                '& .MuiLinearProgress-bar': {
                  background: (paused || pausing)
                    ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                    : 'linear-gradient(90deg, var(--accent, #3b82f6), var(--accent, #60a5fa))',
                  borderRadius: 4,
                },
              }}
            />
            {currentUrl && !paused && (
              <Typography sx={{
                mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {currentUrl}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button fullWidth onClick={handlePause} disabled={pausing} startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
              sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
              {paused ? t.batch.resume : pausing ? (lang === 'en' ? 'Pausing…' : 'Pausando…') : t.batch.pause}
            </Button>
            <Button fullWidth onClick={handleCancelBatch} startIcon={<HighlightOffIcon />}
              sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' } }}>
              {t.batch.cancel}
            </Button>
            {rows.some(r => r.ok) && (
              <Tooltip title={t.batch.stopAndSendTip}>
                <Button fullWidth onClick={handleCancelBatch} startIcon={<SendIcon />}
                  sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#4ade80', bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                  {t.batch.stopAndSend}
                </Button>
              </Tooltip>
            )}
          </Box>
        </Box>
      )}

      {/* ── Post-scraping: template + send — visible también durante el
           scraping, para poder empezar a enviar a lo ya encontrado ── */}
      {(done || loading) && rows.length > 0 && (
        <Box sx={{ p: 2, borderRadius: 2, border: '1px solid rgba(34,197,94,0.15)', bgcolor: 'rgba(34,197,94,0.03)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MessageIcon sx={{ fontSize: 16, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{t.batch.sendMessages}</Typography>
            </Box>
            {waRowsUnique.length > 0 && (
              <Chip
                icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />}
                label={`${effectiveWaSelected.size} ${t.search.of} ${waRowsUnique.length} ${t.batch.withWa}`}
                size="small"
                sx={{
                  fontSize: '0.7rem', height: 22,
                  bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80',
                  border: '1px solid rgba(34,197,94,0.25)',
                  '& .MuiChip-icon': { color: '#4ade80' },
                }}
              />
            )}
          </Box>
          {capStats && (
            <CapacityBanner stats={capStats} selectionCount={totalContactPoints} sx={{ mb: 1.5 }} />
          )}

          <Box sx={{ display: 'flex', gap: 2.5 }}>
            <RecipientsBox rows={waRowsUnique}
              effectiveSelected={effectiveWaSelected}
              expandedCo={expandedCo}
              extraSelected={extraSelected}
              setDeselected={setWaDeselected}
              setExpandedCo={setExpandedCo}
              setExtraSelected={setExtraSelected}
              title={t.search.recipients}
              sx={{ width: 260, flexShrink: 0 }} />

          <Box sx={{ flex: 1, minWidth: 0 }}>
          {!isBulk && <>
          <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            {t.batch.baseTemplate}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 1.5 }}>
            {TEMPLATES.map(tpl => (
              <Chip key={tpl.id} label={tpl.label} size="small" onClick={() => {
                setSelectedTpl(tpl.id)
                const el = msgRef.current
                if (el) { el.value = tpl.text; el.dispatchEvent(new Event('input', { bubbles: true })) }
              }} sx={{
                fontSize: '0.7rem', height: 24, cursor: 'pointer',
                bgcolor: selectedTpl === tpl.id ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.04)',
                color:   selectedTpl === tpl.id ? '#4ade80' : 'rgba(255,255,255,0.45)',
                border:  `1px solid ${selectedTpl === tpl.id ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
              }} />
            ))}
          </Box>
          {/* Variable chips */}
          <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 1 }}>
            {[
              ['{{nombre}}',   'nombre',    '#818cf8', t.single.varNombre],
              ['{{ciudad}}',   'ciudad',    '#38bdf8', t.single.varCiudad],
              ['{{industria}}','industria', '#fb923c', t.single.varIndustria],
              ['{{web}}',      'web',       '#a78bfa', t.single.varWeb],
            ].map(([v, display, color, tooltip]) => (
              <Tooltip key={v} title={tooltip} placement="top" arrow>
                <Box onClick={() => {
                  const el = msgRef.current; if (!el) return
                  el.setRangeText(v, el.selectionStart, el.selectionEnd, 'end')
                  el.dispatchEvent(new Event('input', { bubbles: true }))
                  el.focus()
                }} sx={{
                  px: 1, py: 0.25, borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
                  cursor: 'pointer', userSelect: 'none', fontFamily: 'monospace',
                  bgcolor: `${color}22`, color, border: `1px solid ${color}40`,
                  '&:hover': { bgcolor: `${color}38` },
                }}>{display}</Box>
              </Tooltip>
            ))}
            <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', alignSelf: 'center', ml: 0.5 }}>
              {t.batch.clickInsert}
            </Typography>
          </Box>
          {/* Textarea con highlight de variables */}
          <Box sx={{
            position: 'relative', mb: 0.5, borderRadius: 1.5,
            border: '1px solid rgba(255,255,255,0.1)',
            bgcolor: 'var(--sidebar-bg, #0d1117)',
            '&:focus-within': { borderColor: 'rgba(34,197,94,0.4)' },
          }}>
            <Box
              ref={highlightRef}
              dangerouslySetInnerHTML={{ __html: highlightVars(msgText) + ' ' }}
              sx={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                p: 1.5, fontSize: '0.8rem', lineHeight: 1.6, fontFamily: 'inherit',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                overflowY: 'hidden', pointerEvents: 'none',
                color: 'var(--text, #e2e8f0)', borderRadius: 1.5,
              }}
            />
            <Box component="textarea" ref={msgRef} defaultValue={msgText}
              onInput={e => { setMsgText(e.target.value); syncScroll() }}
              onScroll={syncScroll}
              sx={{
                position: 'relative', zIndex: 1, display: 'block',
                width: '100%', minHeight: 100, maxHeight: 200, resize: 'vertical',
                bgcolor: 'transparent', color: 'transparent', caretColor: 'var(--text, #e2e8f0)',
                border: 'none', outline: 'none', borderRadius: 1.5,
                p: 1.5, fontSize: '0.8rem', lineHeight: 1.6, fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', color: msgText.length > 4000 ? '#f87171' : 'rgba(255,255,255,0.2)' }}>
              {msgText.length} / 4096
            </Typography>
          </Box>
          </>}
          <Box sx={{ mt: 1.5, mb: 0.5, p: 1.2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(255,255,255,0.02)' }}>
            <TemplateLibraryPicker onChange={setExtraVariants} recipientCount={totalNumbers} baseCount={0} />
          </Box>
          {/* Send config */}
          <Box sx={{ mb: 1 }}>
            <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={isSending} />
          </Box>
          <InstanceDisconnectedBanner status={instanceStatus} sx={{ mb: 1 }} />
          <SendErrorBanner error={sendError} onDismiss={() => setSendError('')} sx={{ mb: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
            <DailyCapBadge stats={capStats} selectionCount={totalContactPoints} />
            {isSending && (
              <Tooltip title={t.search.cancelSend}>
                <IconButton size="small" onClick={cancelQueue}
                  sx={{ color: 'rgba(248,113,113,0.7)', '&:hover': { color: '#f87171' } }}>
                  <HighlightOffIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <Button
              onClick={handleSendAll}
              disabled={effectiveWaSelected.size === 0 || alreadySent || scrapeActive || isDisconnected || belowMinTemplates || capBlocked}
              startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 14 }} />}
              size="small"
              sx={{
                fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
                bgcolor: effectiveWaSelected.size > 0 && !alreadySent && !scrapeActive ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                color:   effectiveWaSelected.size > 0 && !alreadySent && !scrapeActive ? '#4ade80' : 'rgba(255,255,255,0.3)',
                border:  `1px solid ${effectiveWaSelected.size > 0 && !alreadySent && !scrapeActive ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 1.5, px: 2, py: 0.6,
                '&:hover': { bgcolor: effectiveWaSelected.size > 0 && !alreadySent && !scrapeActive ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.04)' },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
              }}
            >
              {alreadySent
                ? t.batch.msgSent
                : lang === 'en'
                  ? `Send to ${effectiveWaSelected.size} ${effectiveWaSelected.size !== 1 ? 'companies' : 'company'} with WhatsApp`
                  : `Enviar a ${effectiveWaSelected.size} empresa${effectiveWaSelected.size !== 1 ? 's' : ''} con WhatsApp`}
            </Button>
          </Box>
          {capBlocked && !isSending && (
            <Typography sx={{ color: '#f59e0b', fontSize: '0.7rem', textAlign: 'right', mt: 0.5 }}>
              {lang === 'en'
                ? `Deselect ${overBy} to fit today's quota`
                : `Desmarca ${overBy} para caber en tu cupo de hoy`}
            </Typography>
          )}
          </Box>
          </Box>
        </Box>
      )}

      {/* ── Stat cards ── */}
      {rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <StatCard
            icon={<CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />}
            label={t.batch.processed}
            value={okCount}
            color="#4ade80"
            bgColor="rgba(34,197,94,0.06)"
            borderColor="rgba(34,197,94,0.18)"
          />
          <StatCard
            icon={<WhatsAppIcon sx={{ fontSize: 16, color: '#60a5fa' }} />}
            label={t.batch.withWa}
            value={waCount}
            color="#60a5fa"
            bgColor="rgba(59,130,246,0.06)"
            borderColor="rgba(59,130,246,0.18)"
          />
          {alreadySent && (
            <StatCard
              icon={<SendIcon sx={{ fontSize: 16, color: '#a78bfa' }} />}
              label={t.batch.msgSent}
              value={sentCount}
              color="#a78bfa"
              bgColor="rgba(167,139,250,0.06)"
              borderColor="rgba(167,139,250,0.18)"
            />
          )}
          <StatCard
            icon={<ErrorIcon sx={{ fontSize: 16, color: '#f87171' }} />}
            label={t.batch.errors}
            value={errCount}
            color="#f87171"
            bgColor="rgba(239,68,68,0.06)"
            borderColor="rgba(239,68,68,0.18)"
          />
        </Box>
      )}

      {/* ── Results ── */}
      {done && rows.length === 0 ? (
        <EmptyState t={t} />
      ) : rows.length === 0 && !loading && urlList.length > 0 ? (
        <UrlPreviewList urlList={urlList} />
      ) : rows.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: 0.5 }}>
              {t.batch.results}
            </Typography>
            {!loading && (
              <Button variant="contained"
                size="small"
                startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                onClick={downloadCsv}
                sx={{
                  bgcolor: 'var(--accent,#3b82f6)', color: '#fff', fontSize: '0.75rem',
                  borderRadius: 1.5, px: 1.5, py: 0.4, boxShadow: 'none', textTransform: 'none',
                  '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.88)', boxShadow: 'none' },
                }}
              >
                {t.batch.download}
              </Button>
            )}
          </Box>

          <TableContainer sx={{
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.07)',
            maxHeight: 'clamp(220px, 45vh, 560px)',
            overflow: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent', marginBlock: '40px' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['URL', t.batch.colCompany, t.batch.colIndustry, 'WhatsApp', alreadySent ? t.batch.colMessage : null, alreadySent ? t.batch.colTemplate : null, t.batch.colStatus].filter(Boolean).map(h => (
                    <TableCell key={h} sx={{
                      bgcolor: 'var(--card-bg, #161d2e)',
                      color: 'rgba(255,255,255,0.5)',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      letterSpacing: 0.5,
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i} sx={{
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.025)' },
                    '& td': { borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.8rem' },
                  }}>
                    <TableCell sx={{ maxWidth: 200 }}>
                      {(() => {
                        let domain = null
                        try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch {}
                        return (
                          <Box component="a" href={r.url} target="_blank" rel="noopener"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, textDecoration: 'none', '&:hover .bt': { textDecoration: 'underline' } }}>
                            {domain && (
                              <Box component="img"
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                                width={13} height={13}
                                sx={{ borderRadius: '2px', flexShrink: 0 }}
                                onError={e => { e.target.style.display = 'none' }}
                              />
                            )}
                            <Typography component="span" className="bt"
                              sx={{ fontSize: '0.78rem', color: '#60a5fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                              {domain || (r.url.length > 28 ? r.url.slice(0, 28) + '…' : r.url)}
                            </Typography>
                          </Box>
                        )
                      })()}
                    </TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{r.empresa}</TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.55)' }}>{r.industria}</TableCell>
                    <TableCell>
                      {(r.all_whatsapp?.length > 0 || r.whatsapp) ? (
                        <WhatsAppNumberSummary row={r} />
                      ) : (
                        <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                      )}
                    </TableCell>
                    {alreadySent && (
                      <TableCell>
                        {r.msg_status === 'sent'    && <Chip label={t.batch.chipSent}   size="small" sx={{ bgcolor: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)', height: 20, fontSize: '0.68rem' }} />}
                        {r.msg_status === 'failed'  && <Chip label={t.batch.chipFailed} size="small" sx={{ bgcolor: 'rgba(239,68,68,0.1)',   color: '#f87171', border: '1px solid rgba(239,68,68,0.25)',   height: 20, fontSize: '0.68rem' }} />}
                        {r.msg_status === 'no_wa'   && <Chip label={t.batch.chipNoWa}   size="small" sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)', height: 20, fontSize: '0.68rem' }} />}
                        {r.msg_status === 'skipped' && <Chip label={lang === 'en' ? 'Skipped' : 'Saltado'} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)', height: 20, fontSize: '0.68rem' }} />}
                        {!r.msg_status && <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>}
                      </TableCell>
                    )}
                    {alreadySent && (
                      <TableCell sx={{ maxWidth: 200 }}>
                        {r.msgSent ? (
                          <Tooltip title={r.msgSent} placement="top" arrow componentsProps={{ tooltip: { sx: { maxWidth: 320, fontSize: '0.72rem', whiteSpace: 'pre-wrap' } } }}>
                            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', cursor: 'help', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                              {r.msgSent.length > 45 ? r.msgSent.slice(0, 45) + '…' : r.msgSent}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {r.blacklisted ? (
                        <Tooltip title={`🚫 Blacklist · "${r.blockReason}"`} placement="top" arrow>
                            <Chip label={t.batch.chipBlocked} size="small" icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#f87171' }, cursor: 'help' }} />
                        </Tooltip>
                      ) : r.ok && !r.whatsapp ? (
                        <Chip label={t.batch.chipEmpty} size="small" icon={<HighlightOffIcon sx={{ fontSize: '12px !important' }} />}
                          sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.12)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: 'rgba(255,255,255,0.4)' } }} />
                      ) : r.ok ? (
                        <Chip label="OK" size="small" icon={<CheckCircleIcon sx={{ fontSize: '12px !important' }} />}
                          sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
                      ) : (
                        <Tooltip title={r.errorReason || (lang === 'en' ? 'Unknown error' : 'Error desconocido')} placement="top" arrow>
                          <Chip label="Error" size="small" icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#f87171' }, cursor: 'help' }} />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : !loading && (
        <EmptyState t={t} />
      )}

      <Dialog
        open={confirmDialog.open}
        onClose={() => { confirmDialog.resolve?.(false); setConfirmDialog({ open: false, names: '', resolve: null }) }}
        slotProps={{ paper: { sx: { bgcolor: 'var(--bg-card, #1e293b)', border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2, minWidth: 340 } } }}
      >
        <DialogTitle sx={{ color: 'var(--text, white)', fontSize: '0.95rem', fontWeight: 700, pb: 1 }}>
          {lang === 'en' ? 'Already sent contacts' : 'Contactos ya enviados'}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: '0.85rem' }}>
            {lang === 'en' ? 'The following contacts have already received a message:' : 'Los siguientes contactos ya recibieron un mensaje:'}
          </Typography>
          <Typography sx={{ color: 'var(--text, white)', fontSize: '0.85rem', fontWeight: 600, mt: 0.5, wordBreak: 'break-word' }}>
            {confirmDialog.names}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: '0.85rem', mt: 1.5 }}>
            {lang === 'en' ? 'Send them a message anyway?' : '¿Enviarles mensaje de todas formas?'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
          <Button size="small" onClick={() => { confirmDialog.resolve?.(false); setConfirmDialog({ open: false, names: '', resolve: null }) }}
            sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', textTransform: 'none' }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button size="small" variant="contained" onClick={() => { confirmDialog.resolve?.(true); setConfirmDialog({ open: false, names: '', resolve: null }) }}
            sx={{ bgcolor: 'var(--accent, #3b82f6)', '&:hover': { bgcolor: 'var(--accent-hover, #2563eb)' }, textTransform: 'none', fontWeight: 600 }}>
            {lang === 'en' ? 'Send anyway' : 'Enviar de todas formas'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── New-contacts daily-cap trim dialog ── */}
      <Dialog
        open={newContactsDialog.open}
        onClose={() => { newContactsDialog.resolve?.(false); setNewContactsDialog({ open: false, trimCount: 0, newRemaining: 0, resolve: null }) }}
        slotProps={{ paper: { sx: { bgcolor: 'var(--bg-card, #1e293b)', border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2, minWidth: 340 } } }}
      >
        <DialogTitle sx={{ color: '#fbbf24', fontSize: '0.95rem', fontWeight: 700, pb: 1 }}>
          {lang === 'en' ? 'New-contact limit reached' : 'Límite de contactos nuevos'}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: '0.85rem', lineHeight: 1.6 }}>
            {lang === 'en'
              ? `Your warmup limit allows ${newContactsDialog.newRemaining} new contacts today. ${newContactsDialog.trimCount} will be removed from the batch.`
              : `Tu límite de calentamiento permite ${newContactsDialog.newRemaining} contactos nuevos hoy. Se eliminarán ${newContactsDialog.trimCount} del lote.`}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: '0.78rem', mt: 1.2 }}>
            {lang === 'en'
              ? 'Existing contacts (already messaged before) are not affected.'
              : 'Los contactos existentes (ya enviados antes) no se ven afectados.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
          <Button size="small" onClick={() => { newContactsDialog.resolve?.(false); setNewContactsDialog({ open: false, trimCount: 0, newRemaining: 0, resolve: null }) }}
            sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', textTransform: 'none' }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button size="small" variant="contained" onClick={() => { newContactsDialog.resolve?.(true); setNewContactsDialog({ open: false, trimCount: 0, newRemaining: 0, resolve: null }) }}
            sx={{ bgcolor: '#d97706', '&:hover': { bgcolor: '#b45309' }, textTransform: 'none', fontWeight: 600 }}>
            {lang === 'en' ? 'Send trimmed batch' : 'Enviar lote reducido'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
