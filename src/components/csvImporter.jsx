'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { InstanceDisconnectedBanner, SendErrorBanner } from './InstanceStatusBanner'
import * as XLSX from 'xlsx'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TableContainer from '@mui/material/TableContainer'
import TablePagination from '@mui/material/TablePagination'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import HighlightOffIcon from '@mui/icons-material/Stop'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import TableChartIcon from '@mui/icons-material/TableChart'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import MessageIcon from '@mui/icons-material/Message'
import SendIcon from '@mui/icons-material/Send'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Collapse from '@mui/material/Collapse'
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
import { useLang } from '../context/LangContext'
import { isValidUrl } from '@/lib/validators'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'

const URL_REGEX = /^https?:\/\//i
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  // 5 MB — plenty for a text/xlsx list of URLs
const MAX_CSV_URLS = 50  // same cap batchProcessor.jsx already enforces, kept consistent across bulk-import surfaces

const VAR_COLORS = { nombre: '#818cf8', ciudad: '#38bdf8', industria: '#fb923c', web: '#a78bfa' }
function highlightVars(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\{\{(nombre|ciudad|industria|web)\}\}/g, (_, k) =>
      `<span style="background:${VAR_COLORS[k]}28;color:${VAR_COLORS[k]};border-radius:4px;padding:0 3px;font-weight:700;">${k}</span>`
    )
}

const TABLE_HEAD_CELL = {
  bgcolor: 'var(--card-bg)',
  color: 'var(--text-muted)',
  fontWeight: 700,
  fontSize: '0.7rem',
  letterSpacing: 0.5,
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color, bgColor, borderColor, iconBg, iconBorder }) {
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
        bgcolor: iconBg || `${color}22`,
        border: `1px solid ${iconBorder || `${color}44`}`,
        borderRadius: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>{value}</Typography>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{label}</Typography>
      </Box>
    </Box>
  )
}

function renderTemplate(text, scraped) {
  if (!text) return ''
  const extra = scraped?._extra || {}
  return text
    .replace(/\{\{nombre\}\}/g,    scraped?.name || '')
    .replace(/\{\{ciudad\}\}/g,    extra.city || '')
    .replace(/\{\{industria\}\}/g, scraped?.industry || '')
    .replace(/\{\{web\}\}/g,       scraped?.website || '')
}

function downloadTemplate() {
  const csv = [
    'url',
    'https://restaurante-ejemplo.com.mx',
    'https://ferreteria-sur.mx',
    'https://clinica-dental-garcia.com',
    'https://hotel-boutique-oaxaca.mx',
    'https://taller-mecanico-express.com',
  ].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'plantilla_importacion.csv'
  a.click()
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CsvImporter() {
  const { t, lang } = useLang()
  const TEMPLATES = getTemplates(t)
  const inputRef   = useRef(null)
  const scrapeJob = useScrapeJob('csv')
  // El scraping en sí corre en el backend (useScrapeJob) — esto solo cubre el
  // estado optimista de envío por url, que el job no conoce.
  const [sentOverlay, setSentOverlay] = useState({})

  const [dragging,   setDragging]   = useState(false)
  const [fileName,   setFileName]   = useState('')
  const [fileError,  setFileError]  = useState('')
  const [urlCol,     setUrlCol]     = useState('')
  const [allUrls,    setAllUrls]    = useState([])
  const [preview,    setPreview]    = useState([])
  const loading    = scrapeJob.processing
  const paused     = scrapeJob.paused
  const pausing    = scrapeJob.pausing
  const done       = scrapeJob.done
  const progress   = scrapeJob.progress
  const completedCount = scrapeJob.processed
  const currentUrl = scrapeJob.currentUrl
  const results = useMemo(() => {
    const r = scrapeJob.results
    return Object.keys(sentOverlay).length
      ? r.map(row => sentOverlay[row.url] ? { ...row, msg_status: sentOverlay[row.url] } : row)
      : r
  }, [scrapeJob.results, sentOverlay])
  const [page,       setPage]       = useState(0)
  const [rowsPerPage,setRowsPerPage]= useState(25)
  const [selectedTpl,setSelectedTpl]= useState(TEMPLATES[0].id)
  const [msgText,    setMsgText]    = useState(TEMPLATES[0].text)
  const [extraVariants, setExtraVariants] = useState([])
  const [sendError,  setSendError]  = useState('')
  const [showSend,   setShowSend]   = useState(false)
  const [showTiming, setShowTiming] = useState(false)
  const [sendCfg,    setSendCfg]    = useState(() => loadSendConfig())
  const { addBatch, cancel: cancelQueue, active: queueActive } = useSendQueue()
  const { stats: capStats, refresh: refreshCapStats } = useDailyCapStats()
  const [confirmDialog, setConfirmDialog] = useState({ open: false, names: '', resolve: null })
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  // Qué empresas (de las que tienen WhatsApp) quedan destildadas del envío
  // masivo — mismo patrón que ya usa searchProspects.jsx.
  const [waDeselected, setWaDeselected] = useState(new Set())
  // Números EXTRA (además del principal) prendidos a mano al expandir el chip
  // de una empresa — clave `${company_id}::${number}`.
  const [extraSelected, setExtraSelected] = useState(new Set())
  const [expandedCo, setExpandedCo] = useState(new Set())
  const [filterContacted,  setFilterContacted]  = useState('all') // 'all' | 'new' | 'contacted'
  const [localContactedIds, setLocalContactedIds] = useState(new Set())
  const msgRef       = useRef(null)
  const highlightRef = useRef(null)
  const wasActiveRef = useRef(false)
  function syncScroll() {
    if (highlightRef.current && msgRef.current)
      highlightRef.current.scrollTop = msgRef.current.scrollTop
  }

  function parseFile(file) {
    if (!file) return
    setFileError('')
    const name = file.name.toLowerCase()
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls')
    const isCsv   = name.endsWith('.csv')
    if (!isExcel && !isCsv) { setFileError(t.csv.invalidFileType); return }
    if (file.size > MAX_FILE_SIZE_BYTES) { setFileError(t.csv.fileTooLarge); return }

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      let headers, rows
      // XLSX.read parses well-formed CSV too (quoted fields, escaped commas) —
      // reusing it for both formats avoids the naive/broken manual comma-split
      // that used to run for .csv files.
      const wb = isExcel
        ? XLSX.read(ev.target.result, { type: 'array' })
        : XLSX.read(ev.target.result, { type: 'string' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (!data.length) { setUrlCol(''); setAllUrls([]); setPreview([]); return }
      headers = data[0].map(h => String(h).trim())
      rows = data.slice(1).map(row =>
        Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()]))
      )

      const detected = headers.find(h => rows.some(r => URL_REGEX.test(r[h]))) || ''
      const rawUrls = detected ? rows.map(r => r[detected]).filter(u => URL_REGEX.test(u)) : []
      // URL_REGEX above only picks the right COLUMN (cheap heuristic); the values that
      // actually get sent to the scraper are validated for real with isValidUrl, same
      // rule single/batch already enforce, and deduped so the same URL isn't scraped twice.
      const urls = [...new Set(rawUrls.filter(isValidUrl))]

      if (urls.length > MAX_CSV_URLS) {
        setFileError(t.csv.tooManyUrls(MAX_CSV_URLS))
        setFileName(''); setUrlCol(''); setAllUrls([]); setPreview([])
        if (inputRef.current) inputRef.current.value = ''
        return
      }

      const cols = headers.slice(0, 4).map(h => ({ col: h, sample: rows.slice(0, 1).map(r => r[h]).join('') }))
      setUrlCol(detected)
      setAllUrls(urls)
      setPreview(cols)
      setSentOverlay({})
      scrapeJob.reset()
      setPage(0)
    }
    reader.onerror = () => setFileError(t.csv.readError)
    if (isExcel) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  }

  function handleDrop(e) { e.preventDefault(); setDragging(false); parseFile(e.dataTransfer.files?.[0]) }
  function handleInputChange(e) { parseFile(e.target.files?.[0]) }
  function handleReset() {
    setFileName(''); setFileError(''); setUrlCol(''); setAllUrls([]); setPreview([])
    setSentOverlay({}); scrapeJob.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  // El loop de scraping ahora corre en el backend (backEnd/app/scrape_jobs.py) —
  // esto solo crea el job y lo deja al hook useScrapeJob hacer polling.
  async function handleProcess() {
    if (!allUrls.length) return
    setSentOverlay({}); setPage(0)
    await scrapeJob.start(allUrls)
  }

  useEffect(() => {
    if (queueActive !== null) {
      wasActiveRef.current = true
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false
      setSentOverlay(prev => {
        const next = { ...prev }
        for (const k in next) if (next[k] === 'queued') next[k] = 'sent'
        return next
      })
      refreshCapStats()
    }
  }, [queueActive, refreshCapStats])

  function handlePause() {
    if (pausing) return
    paused ? scrapeJob.resume() : scrapeJob.pause()
  }

  function handleCancel() {
    scrapeJob.cancel()
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'estado']
    const csv = [
      headers.join(','),
      ...results.map(r => headers.map(h => {
        if (h === 'estado') return r.duplicate ? 'duplicado' : r.ok ? 'ok' : 'error'
        return r[h] || ''
      }).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_csv.csv'
    a.click()
  }


  // waRowsUnique deduplicado por company_id — dos filas de CSV distintas pueden
  // resolver a la misma empresa ya existente en la BD.
  const waRowsAll    = results.filter(r => r.ok && (r.all_whatsapp?.length > 0 || r.whatsapp) && r.company_id)
  const waRowsUnique = useMemo(() =>
    dedupeByCompany(waRowsAll).map(r => ({
      ...r,
      already_contacted: r.already_contacted
        || (localContactedIds.has(r.company_id) ? { contacted: true } : null),
    })),
  [waRowsAll, localContactedIds])
  // Los setState devuelven la MISMA referencia si ya estaban vacíos — evita que
  // este efecto re-dispare un render indefinidamente si `results` llega a ser
  // referencialmente inestable entre renders (ver useScrapeJob.js EMPTY_RESULTS).
  useEffect(() => {
    setWaDeselected(prev => prev.size ? new Set() : prev)
    setExtraSelected(prev => prev.size ? new Set() : prev)
    setExpandedCo(prev => prev.size ? new Set() : prev)
  }, [results])
  useEffect(() => {
    setLocalContactedIds(new Set())
    setFilterContacted('all')
  }, [scrapeJob.job?._id])
  const filteredWaRows = useMemo(() => {
    if (filterContacted === 'new') return waRowsUnique.filter(r => !r.already_contacted?.contacted)
    if (filterContacted === 'contacted') return waRowsUnique.filter(r => r.already_contacted?.contacted)
    return waRowsUnique
  }, [waRowsUnique, filterContacted])
  const effectiveWaSelected = useMemo(() =>
    new Set(filteredWaRows.map(r => r.company_id).filter(id => !waDeselected.has(id))),
  [filteredWaRows, waDeselected])
  const alreadySent = results.some(r => r.msg_status === 'sent' || r.msg_status === 'failed' || r.msg_status === 'queued')
  const isSending   = queueActive !== null && alreadySent
  const sentCount   = results.filter(r => r.msg_status === 'sent').length
  // Un envío masivo manda por default 1 número por empresa (el principal) — evita
  // que una empresa con muchos números se coma el cupo diario de warmup de varias
  // empresas nuevas de golpe. Expandir el chip de una empresa permite agregar sus
  // otros números a propósito — cada uno cuenta su propio slot de cupo (el
  // backend deduplica por número real, no por empresa).
  const totalNumbers = effectiveWaSelected.size
  const totalContactPoints = totalNumbers +
    [...extraSelected].filter(key => effectiveWaSelected.has(key.split('::')[0])).length
  const _contactedCids = new Set(waRowsUnique.filter(r => r.already_contacted?.contacted).map(r => r.company_id))
  const newContactPoints =
    waRowsUnique.filter(r => effectiveWaSelected.has(r.company_id) && !_contactedCids.has(r.company_id)).length +
    [...extraSelected].filter(key => { const cid = key.split('::')[0]; return effectiveWaSelected.has(cid) && !_contactedCids.has(cid) }).length
  const overBy     = getOverBy(capStats, totalContactPoints, newContactPoints)
  const capBlocked = overBy > 0
  // Sending to 2+ contact points needs varied text (see MIN_TEMPLATES_FOR_BULK).
  // Uses totalContactPoints so selecting multiple numbers of a single company
  // also triggers the template-library mode.
  const isBulk = totalContactPoints > 1
  const allVariants = (isBulk ? extraVariants : [msgText]).map(v => v.trim()).filter(Boolean)
  const belowMinTemplates = isBulk && allVariants.length < MIN_TEMPLATES_FOR_BULK

  async function handleSendAll() {
    const targets = filteredWaRows.filter(r => effectiveWaSelected.has(r.company_id))
    if (!targets.length || belowMinTemplates || capBlocked) return
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
    addBatch(jobs, lang === 'en' ? 'CSV import' : 'Importación CSV')
    setSentOverlay(prev => ({ ...prev, ...queuedUrls }))
    setLocalContactedIds(prev => {
      const next = new Set(prev)
      jobs.forEach(j => j.companyId && next.add(j.companyId))
      return next
    })
  }

  const hasFile    = allUrls.length > 0
  const okCount    = results.filter(r => r.ok && !r.duplicate).length
  const errCount   = results.filter(r => !r.ok).length
  const dupCount   = results.filter(r => r.duplicate).length
  const waCount    = results.filter(r => r.whatsapp).length
  const totalPages = Math.ceil(results.length / rowsPerPage)
  const pageRows   = results.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  function rowBg(r) {
    if (!r.ok) return 'rgba(239,68,68,0.07)'
    if (r.duplicate) return 'rgba(251,191,36,0.05)'
    return 'transparent'
  }
  function rowBorder(r) {
    if (!r.ok) return '1px solid rgba(239,68,68,0.15)'
    if (r.duplicate) return '1px solid rgba(251,191,36,0.12)'
    return '1px solid rgba(255,255,255,0.04)'
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%', overflowY: 'auto', pb: 2, pr: 0.5 }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)',
          border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)',
          borderRadius: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <TableChartIcon sx={{ color: 'var(--accent, #60a5fa)', fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
            {t.csv.title}
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
            {t.csv.subtitle}
          </Typography>
        </Box>
      </Box>

      {/* ── File-level error (wrong type, too large, too many URLs) ── */}
      {fileError && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, mb: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5 }}>
          <ErrorIcon sx={{ fontSize: 15, color: '#f87171', flexShrink: 0 }} />
          <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{fileError}</Typography>
        </Box>
      )}

      {/* ── Drop zone / File pill ── */}
      {!hasFile ? (
        <Box
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          sx={{
            width: '100%', flexGrow: 1, minHeight: 220,
            border: `1.5px dashed ${dragging ? 'rgba(var(--accent-rgb, 59,130,246), 0.7)' : 'var(--border)'}`,
            borderRadius: 3,
            bgcolor: dragging ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)' : 'rgba(var(--accent-rgb, 59,130,246), 0.03)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, cursor: 'pointer',
            transition: 'border-color 0.2s, background-color 0.2s, transform 0.15s',
            transform: dragging ? 'scale(1.01)' : 'scale(1)',
            '&:hover': { borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.5)', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.06)' },
          }}
        >
          <Box sx={{
            width: 56, height: 56,
            bgcolor: dragging ? 'rgba(var(--accent-rgb, 59,130,246), 0.2)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)',
            border: `1px solid ${dragging ? 'rgba(var(--accent-rgb, 59,130,246), 0.5)' : 'rgba(var(--accent-rgb, 59,130,246), 0.2)'}`,
            borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}>
            <UploadFileIcon sx={{ color: dragging ? 'var(--accent, #60a5fa)' : 'rgba(var(--accent-rgb, 59,130,246), 0.6)', fontSize: 28, transition: 'color 0.2s' }} />
          </Box>
          <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.9rem' }}>
              {dragging ? t.csv.dropHere : t.csv.drag}
            </Typography>
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              {t.csv.or}{' '}
              <Box component="span" sx={{ color: 'var(--accent, #60a5fa)', fontWeight: 500 }}>{t.csv.select}</Box>
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {['.csv', '.xlsx', '.xls'].map(ext => (
              <Chip key={ext} label={ext} size="small" sx={{ bgcolor: 'var(--item-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: '0.7rem', height: 20 }} />
            ))}
          </Box>
          <Button
            size="small"
            startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
            onClick={e => { e.stopPropagation(); downloadTemplate() }}
            sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.72rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.06)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.14)' } }}
          >
            {t.csv.template}
          </Button>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={handleInputChange} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* File pill */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderRadius: 2, border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.2)', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.06)' }}>
            <Box sx={{ width: 36, height: 36, flexShrink: 0, bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.2)', borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <InsertDriveFileOutlinedIcon sx={{ color: 'var(--accent, #60a5fa)', fontSize: 18 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                {allUrls.length} {t.csv.urlsDetected}
              </Typography>
            </Box>
            <Tooltip title={t.csv.removeFile}>
              <IconButton size="small" onClick={handleReset} sx={{ color: 'var(--border)', '&:hover': { color: 'var(--text-muted)' } }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* No URL column warning */}
          {!urlCol && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 1.5 }}>
              <WarningAmberIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
              <Typography sx={{ color: '#fbbf24', fontSize: '0.75rem' }}>
                {t.csv.noUrlCol}
              </Typography>
            </Box>
          )}

          {/* Controls row */}
          {!loading ? (
            <Button
              fullWidth
              variant="contained"
              onClick={handleProcess}
              disabled={!urlCol || !allUrls.length}
              startIcon={<PlayArrowIcon sx={{ fontSize: 38 }} />}
              sx={{
                bgcolor: 'var(--accent, #3b82f6)', fontWeight: 600, fontSize: '0.95rem',
                py: 1.2, textTransform: 'none', borderRadius: 1.5,
                '&:hover': { bgcolor: 'var(--accent, #2563eb)', filter: 'brightness(0.9)' },
                '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.2)', color: 'rgba(255,255,255,0.3)' },
              }}
            >
              {t.csv.process} {allUrls.length} URLs
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button
                fullWidth
                onClick={handlePause}
                disabled={pausing}
                startIcon={pausing ? <CircularProgress size={14} sx={{ color: '#fbbf24' }} /> : paused ? <PlayArrowIcon /> : <PauseIcon />}
                sx={{
                  flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem',
                  color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(251,191,36,0.15)', borderColor: 'rgba(251,191,36,0.45)' },
                  '&.Mui-disabled': { color: 'rgba(251,191,36,0.4)', bgcolor: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)' },
                }}
              >
                {paused ? t.csv.resume : pausing ? (lang === 'en' ? 'Pausing…' : 'Pausando…') : t.csv.pause}
              </Button>
              <Button
                fullWidth
                onClick={handleCancel}
                startIcon={<HighlightOffIcon />}
                sx={{
                  flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem',
                  color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' },
                }}
              >
                {t.csv.cancel}
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* ── Progress card ── */}
      {loading && (
        <Box sx={{ px: 2.5, py: 2, bgcolor: paused ? 'rgba(251,191,36,0.05)' : 'rgba(var(--accent-rgb, 59,130,246), 0.05)', border: `1px solid ${paused ? 'rgba(251,191,36,0.2)' : 'rgba(var(--accent-rgb, 59,130,246), 0.15)'}`, borderRadius: 2, transition: 'all 0.3s' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {paused
                ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
                : <CircularProgress size={14} sx={{ color: pausing ? '#fbbf24' : 'var(--accent, #3b82f6)' }} />
              }
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                {paused ? t.csv.paused : pausing ? (lang === 'en' ? 'Pausing…' : 'Pausando…') : t.csv.processing} {completedCount} {t.csv.of} {allUrls.length}
              </Typography>
            </Box>
            <Typography sx={{ color: paused ? '#fbbf24' : 'var(--accent, #60a5fa)', fontWeight: 700, fontSize: '0.82rem' }}>
              {progress}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              borderRadius: 4, height: 6,
              bgcolor: paused ? 'rgba(251,191,36,0.1)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)',
              '& .MuiLinearProgress-bar': {
                background: paused
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : 'linear-gradient(90deg, var(--accent, #3b82f6), var(--accent, #60a5fa))',
                borderRadius: 4,
              },
            }}
          />
          {currentUrl && !paused && (
            <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentUrl}
            </Typography>
          )}
        </Box>
      )}

      {/* ── Stat cards ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <StatCard icon={<CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />} label={t.csv.processed} value={okCount} color="#4ade80" bgColor="rgba(34,197,94,0.06)" borderColor="rgba(34,197,94,0.18)" />
          <StatCard icon={<WhatsAppIcon sx={{ fontSize: 16, color: 'var(--accent, #60a5fa)' }} />} label={t.csv.withWa} value={waCount} color="var(--accent, #60a5fa)" bgColor="rgba(var(--accent-rgb, 59,130,246), 0.06)" borderColor="rgba(var(--accent-rgb, 59,130,246), 0.18)" iconBg="rgba(var(--accent-rgb, 59,130,246), 0.13)" iconBorder="rgba(var(--accent-rgb, 59,130,246), 0.27)" />
          <StatCard icon={<WarningAmberIcon sx={{ fontSize: 16, color: '#fbbf24' }} />} label={t.csv.duplicates} value={dupCount} color="#fbbf24" bgColor="rgba(251,191,36,0.06)" borderColor="rgba(251,191,36,0.18)" />
          <StatCard icon={<ErrorIcon sx={{ fontSize: 16, color: '#f87171' }} />} label={t.csv.errors} value={errCount} color="#f87171" bgColor="rgba(239,68,68,0.06)" borderColor="rgba(239,68,68,0.18)" />
        </Box>
      )}

      {/* ── Toggle de envío masivo — visible cuando done o pausado (no durante pausing,
           ya que los datos siguen cargando y el usuario no debe adelantarse) ── */}
      {(done || (loading && !pausing)) && results.length > 0 && waRowsUnique.length > 0 && (
        <Box sx={{ borderRadius: 2, border: `1px solid ${showSend ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.12)'}`, bgcolor: showSend ? 'rgba(34,197,94,0.04)' : 'transparent', transition: 'all 0.2s' }}>
          {/* Header toggle */}
          <Box onClick={() => setShowSend(o => !o)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.2, cursor: 'pointer', borderRadius: showSend ? '8px 8px 0 0' : 2, '&:hover': { bgcolor: 'rgba(34,197,94,0.06)' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MessageIcon sx={{ fontSize: 15, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{t.csv.sendMessages}</Typography>
              <Chip icon={<WhatsAppIcon sx={{ fontSize: '11px !important' }} />} label={`${effectiveWaSelected.size} ${t.search.of} ${waRowsUnique.length} ${t.csv.withWhatsApp}`} size="small"
                sx={{ fontSize: '0.68rem', height: 20, bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: '#4ade80' } }} />
            </Box>
            <Box sx={{ fontSize: 15, color: 'rgba(34,197,94,0.5)', transform: showSend ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'flex' }}>▾</Box>
          </Box>

          {/* Panel colapsable */}
          <Collapse in={showSend}>
            <Box sx={{ px: 2, pb: 2, borderTop: '1px solid rgba(34,197,94,0.1)', maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Timing config toggle */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.2, mb: 1 }}>
                <Tooltip title={t.sendConfig?.title || 'Timing de envío'} placement="left" arrow>
                  <IconButton size="small" onClick={() => setShowTiming(o => !o)}
                    sx={{ color: showTiming ? 'var(--accent,#3b82f6)' : 'var(--text-muted)', border: `1px solid ${showTiming ? 'rgba(var(--accent-rgb,59,130,246),0.35)' : 'var(--border)'}`, borderRadius: 1.5, p: 0.6, bgcolor: showTiming ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', color: 'var(--accent,#3b82f6)' } }}>
                    <AccessTimeIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Collapse in={showTiming}>
                <Box sx={{ mb: 1.5 }}>
                  <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={isSending} />
                </Box>
              </Collapse>

              {/* Countdown + cancel during send */}
              {isSending && (
                <Button
                  fullWidth
                  onClick={cancelQueue}
                  startIcon={<HighlightOffIcon />}
                  sx={{
                    mb: 1.5, py: 0.8, textTransform: 'none', fontWeight: 600, fontSize: '0.82rem',
                    color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5,
                    '&:hover': { bgcolor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' },
                  }}
                >
                  {t.csv.cancel}
                </Button>
              )}

              {capStats && (
                <CapacityBanner stats={capStats} selectionCount={totalContactPoints} sx={{ mb: 1.5 }} />
              )}

              {/* Filter tabs */}
              <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5 }}>
                {[
                  { key: 'all',       label: lang === 'en' ? 'All'             : 'Todos' },
                  { key: 'new',       label: lang === 'en' ? 'Not contacted'   : 'Sin contactar' },
                  { key: 'contacted', label: lang === 'en' ? 'Already contacted': 'Ya contactados' },
                ].map(tab => (
                  <Chip key={tab.key} label={tab.label} size="small"
                    onClick={() => setFilterContacted(tab.key)}
                    sx={{
                      cursor: 'pointer',
                      fontSize: '0.7rem', height: 22,
                      bgcolor: filterContacted === tab.key ? 'rgba(34,197,94,0.18)' : 'var(--item-hover)',
                      color:  filterContacted === tab.key ? '#4ade80' : 'var(--text-muted)',
                      border: `1px solid ${filterContacted === tab.key ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
                    }} />
                ))}
              </Box>

              <Box sx={{ display: 'flex', gap: 2.5 }}>
                <RecipientsBox rows={filteredWaRows}
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
              <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{t.csv.baseTemplate}</Typography>
              <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 1.5 }}>
                {TEMPLATES.map(tpl => (
                  <Chip key={tpl.id} label={tpl.label} size="small" onClick={() => {
                    setSelectedTpl(tpl.id)
                    const el = msgRef.current
                    if (el) { el.value = tpl.text; el.dispatchEvent(new Event('input', { bubbles: true })) }
                  }} sx={{
                    fontSize: '0.7rem', height: 24, cursor: 'pointer',
                    bgcolor: selectedTpl === tpl.id ? 'rgba(34,197,94,0.18)' : 'var(--item-hover)',
                    color:   selectedTpl === tpl.id ? '#4ade80' : 'var(--text-muted)',
                    border:  `1px solid ${selectedTpl === tpl.id ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
                  }} />
                ))}
              </Box>
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
                    }} sx={{ px: 1, py: 0.25, borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', userSelect: 'none', fontFamily: 'monospace', bgcolor: `${color}22`, color, border: `1px solid ${color}40`, '&:hover': { bgcolor: `${color}38` } }}>{display}</Box>
                  </Tooltip>
                ))}
              </Box>
              <Box sx={{ position: 'relative', mb: 0.5, borderRadius: 1.5, border: '1px solid var(--border)', bgcolor: 'var(--sidebar-bg)', '&:focus-within': { borderColor: 'rgba(34,197,94,0.4)' } }}>
                <Box ref={highlightRef} dangerouslySetInnerHTML={{ __html: highlightVars(msgText) + ' ' }}
                  sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, p: 1.5, fontSize: '0.8rem', lineHeight: 1.6, fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'hidden', pointerEvents: 'none', color: 'var(--text)', borderRadius: 1.5 }} />
                <Box component="textarea" ref={msgRef} defaultValue={msgText}
                  onInput={e => { setMsgText(e.target.value); syncScroll() }}
                  onScroll={syncScroll}
                  sx={{ position: 'relative', zIndex: 1, display: 'block', width: '100%', minHeight: 100, maxHeight: 200, resize: 'vertical', bgcolor: 'transparent', color: 'transparent', caretColor: 'var(--text)', border: 'none', outline: 'none', borderRadius: 1.5, p: 1.5, fontSize: '0.8rem', lineHeight: 1.6, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Typography sx={{ fontSize: '0.65rem', color: msgText.length > 4000 ? '#f87171' : 'var(--text-muted)' }}>
                  {msgText.length} / 4096
                </Typography>
              </Box>
              </>}

              {isBulk && (
                <Box sx={{ mt: 1.5, mb: 0.5, p: 1.2, borderRadius: 2, border: '1px solid var(--border)', bgcolor: 'var(--item-hover)' }}>
                  <TemplateLibraryPicker onChange={setExtraVariants} recipientCount={totalNumbers} baseCount={0} />
                </Box>
              )}

              <InstanceDisconnectedBanner status={instanceStatus} sx={{ mb: 1 }} />
              <SendErrorBanner error={sendError} onDismiss={() => setSendError('')} sx={{ mb: 1 }} />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.6 }}>
                <DailyCapBadge stats={capStats} selectionCount={totalContactPoints} newSelectionCount={newContactPoints} />
              </Box>
              <Button fullWidth onClick={handleSendAll}
                disabled={effectiveWaSelected.size === 0 || alreadySent || isDisconnected || belowMinTemplates || capBlocked}
                startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '0.82rem', fontWeight: 700, py: 1, textTransform: 'none', borderRadius: 1.5,
                  bgcolor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.35)',
                  '&:hover': { bgcolor: 'rgba(34,197,94,0.25)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
                }}>
                {alreadySent ? `${sentCount} ${t.csv.msgSent}` : `${t.csv.sendTo} ${effectiveWaSelected.size} ${effectiveWaSelected.size !== 1 ? t.csv.companies : t.csv.company} ${t.csv.withWhatsApp}`}
              </Button>
              {capBlocked && !isSending && (
                <Typography sx={{ color: '#f59e0b', fontSize: '0.7rem', textAlign: 'right', mt: 0.5 }}>
                  {lang === 'en' ? `Deselect ${overBy} to fit today's quota` : `Desmarca ${overBy} para caber en tu cupo de hoy`}
                </Typography>
              )}
              </Box>
              </Box>
            </Box>
          </Collapse>
        </Box>
      )}

      {/* ── Results table ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: 0.5 }}>
              {t.csv.results}
            </Typography>
            {!loading && (
              <Button
                size="small"
                startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                onClick={downloadCsv}
                sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.75rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)' } }}
              >
                {t.csv.download}
              </Button>
            )}
          </Box>

          <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <TableContainer sx={{
              maxHeight: 'clamp(220px, 42vh, 520px)',
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
                    {[t.csv.colUrl, t.csv.colEmpresa, t.csv.colIndustria, t.csv.colWhatsApp, t.csv.colWaStatus, t.csv.colStatus].map(h => (
                      <TableCell key={h} sx={TABLE_HEAD_CELL}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((r, i) => (
                    <TableRow key={i} sx={{ bgcolor: rowBg(r), '& td': { borderBottom: rowBorder(r) } }}>
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography component="a" href={r.url} target="_blank" rel="noopener"
                          sx={{ fontSize: '0.78rem', color: r.ok ? 'var(--accent, #60a5fa)' : '#f87171', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                          {r.url.length > 32 ? r.url.slice(0, 32) + '…' : r.url}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ color: 'var(--text)', fontWeight: 500, fontSize: '0.8rem' }}>{r.empresa}</TableCell>
                      <TableCell sx={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.industria}</TableCell>
                      <TableCell>
                        {(r.all_whatsapp?.length > 0 || r.whatsapp) ? (
                          <WhatsAppNumberSummary row={r} />
                        ) : (
                          <Typography sx={{ color: 'var(--border)', fontSize: '0.78rem' }}>—</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.status_wa}</TableCell>
                      <TableCell>
                        {r.blacklisted ? (
                          <Tooltip title={`🚫 Blacklist · "${r.blockReason}"`} placement="top" arrow>
                            <Chip label={t.csv.statusBlocked} size="small" icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
                              sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#f87171' }, cursor: 'help' }} />
                          </Tooltip>
                        ) : r.duplicate ? (
                          <Chip label={t.csv.statusDup} size="small" icon={<WarningAmberIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#fbbf24' } }} />
                        ) : r.ok && !r.whatsapp ? (
                          <Chip label={t.csv.statusEmpty} size="small" icon={<HighlightOffIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.12)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: 'rgba(255,255,255,0.4)' } }} />
                        ) : r.ok ? (
                          <Chip label={t.csv.statusOk} size="small" icon={<CheckCircleIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
                        ) : (
                          <Tooltip title={r.errorReason || 'Error desconocido'} placement="top" arrow>
                            <Chip label={t.csv.statusError} size="small" icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
                              sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#f87171' }, cursor: 'help' }} />
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              rowsPerPageOptions={[25, 50, 100]}
              component="div"
              count={results.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
              labelRowsPerPage={t.csv.rowsPerPage}
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} ${t.csv.rowsOf} ${count}`}
              sx={{
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
                '& .MuiTablePagination-toolbar': { minHeight: 48 },
                '& .MuiTablePagination-selectIcon': { color: 'var(--text-muted)' },
                '& .MuiTablePagination-displayedRows': { color: 'var(--text-muted)' },
                '& .MuiTablePagination-select': { color: 'var(--text-muted)' },
                '& .MuiIconButton-root': { color: 'var(--text-muted)' },
                '& .Mui-disabled': { opacity: 0.3 },
              }}
            />
          </Box>
        </Box>
      )}

      <Dialog
        open={confirmDialog.open}
        onClose={() => { confirmDialog.resolve?.(false); setConfirmDialog({ open: false, names: '', resolve: null }) }}
        slotProps={{ paper: { sx: { bgcolor: 'var(--bg-card, #1e293b)', border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2, minWidth: 340 } } }}
      >
        <DialogTitle sx={{ color: 'var(--text, white)', fontSize: '0.95rem', fontWeight: 700, pb: 1 }}>
          {t.search?.confirmContactedTitle || (lang === 'en' ? 'Already contacted' : 'Contactos ya enviados')}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: '0.85rem' }}>
            {t.search?.confirmContactedDesc || (lang === 'en' ? 'These contacts already received a message:' : 'Los siguientes contactos ya recibieron un mensaje:')}
          </Typography>
          <Typography sx={{ color: 'var(--text, white)', fontSize: '0.85rem', fontWeight: 600, mt: 0.5, wordBreak: 'break-word' }}>
            {confirmDialog.names}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.6))', fontSize: '0.85rem', mt: 1.5 }}>
            {t.search?.confirmContactedAsk || (lang === 'en' ? 'Send them a message anyway?' : '¿Enviarles mensaje de todas formas?')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
          <Button size="small" onClick={() => { confirmDialog.resolve?.(false); setConfirmDialog({ open: false, names: '', resolve: null }) }}
            sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', textTransform: 'none' }}>
            {t.csv.cancel || (lang === 'en' ? 'Cancel' : 'Cancelar')}
          </Button>
          <Button size="small" variant="contained" onClick={() => { confirmDialog.resolve?.(true); setConfirmDialog({ open: false, names: '', resolve: null }) }}
            sx={{ bgcolor: 'var(--accent, #3b82f6)', '&:hover': { bgcolor: 'var(--accent-hover, #2563eb)' }, textTransform: 'none', fontWeight: 600 }}>
            {t.search?.confirmContactedConfirm || (lang === 'en' ? 'Send anyway' : 'Enviar de todas formas')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
