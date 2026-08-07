'use client'
import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import useSWR from 'swr'
import { useLang } from '../context/LangContext'
import { useUser } from '../context/UserContext'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TablePagination from '@mui/material/TablePagination'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import BarChartIcon from '@mui/icons-material/BarChart'
import SearchIcon from '@mui/icons-material/Search'
import PersonIcon from '@mui/icons-material/Person'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import StarIcon from '@mui/icons-material/Star'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import SendIcon from '@mui/icons-material/Send'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import AndyBotBuilder from './AndyBotBuilder'
import GasBotModal from './GasBotModal'
import ClassificationSettingsModal from './ClassificationSettingsModal'

const GAS_INDUSTRY_KEYWORDS = ['gas', 'lp', 'gasera', 'gaseras', 'energia']

function isGasIndustry(industry) {
  const norm = (industry || '')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '') // strip accents
  if (!norm) return false
  return GAS_INDUSTRY_KEYWORDS.some(kw => new RegExp(`\\b${kw}\\b`).test(norm))
}

const CATEGORY_CONFIG = {
  humano:     { tKey: 'human',     color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   icon: '👤' },
  automatico: { tKey: 'automatic', color: '#facc15', bg: 'rgba(250,204,21,0.12)',  icon: '⚡' },
  hibrido:    { tKey: 'hybrid',    color: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  icon: '🔀' },
  bot:        { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🤖' },
  // "menu" ya no la produce el clasificador (se fusionó con "bot") — se mantiene aquí
  // solo para que análisis viejos guardados con esa categoría se muestren igual que "bot".
  menu:       { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: '🤖' },
  bot_ia:     { tKey: 'botAi',     color: '#c084fc', bg: 'rgba(192,132,252,0.15)', icon: '🧠' },
}

// Normaliza la categoría legado "menu" a la vigente "bot" para filtros/conteos — la
// Categoría mostrada en la tabla ya se resuelve vía CATEGORY_CONFIG.
const normCategory = cat => (cat === 'menu' ? 'bot' : cat)

// Mismo criterio que getCategoryConfig: "bot" y "bot_ia" son mutuamente excluyentes
// según el flag is_ai, no dos categorías independientes — se usa para que los stats
// y filtros cuenten igual que lo que se ve en la columna Categoría de la tabla.
const matchesCategory = (row, cat) => {
  const nc = normCategory(row.category)
  if (nc !== 'bot') return nc === cat
  return cat === 'bot_ia' ? !!row.is_ai : cat === 'bot' ? !row.is_ai : false
}

function getCategoryConfig(row) {
  if (row.category === 'bot' && row.is_ai) return CATEGORY_CONFIG.bot_ia
  return CATEGORY_CONFIG[row.category] || { tKey: 'noClass', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: '⏳' }
}

function QualityDots({ score, color }) {
  const filled = Math.round(score || 0)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Box key={i} sx={{
          fontSize: '0.75rem',
          color: i <= filled ? color : 'var(--border, rgba(255,255,255,0.15))',
          lineHeight: 1,
        }}>
          ●
        </Box>
      ))}
    </Box>
  )
}

function formatReactionTime(minutes) {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 0) return '—'
  if (minutes < 1) return `${Math.round(minutes * 60)}s`
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function BusinessHoursChip({ value }) {
  if (value === null || value === undefined) {
    return <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem' }}>—</Typography>
  }
  return value ? (
    <Chip label="Hábil" size="small" sx={{
      height: 18, fontSize: '0.65rem',
      bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80',
      border: '1px solid rgba(34,197,94,0.25)',
    }} />
  ) : (
    <Chip label="Fuera" size="small" sx={{
      height: 18, fontSize: '0.65rem',
      bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
      border: '1px solid rgba(255,255,255,0.1)',
    }} />
  )
}

const _TZ = 'America/Mexico_City'

function formatLastAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diff = now - d
  if (diff < 0) return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
  if (diff < 60000) return 'ahora'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: _TZ })
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
}

const CELL_SX = {
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.8)',
  fontSize: '0.8rem',
  py: 1.2,
  px: 1.5,
}

const SORT_LABEL_CENTER_SX = {
  width: '100%',
  position: 'relative',
  justifyContent: 'center',
  color: 'rgba(255,255,255,0.5) !important',
  '& .MuiTableSortLabel-icon': {
    position: 'absolute',
    right: 0,
    margin: 0,
    color: 'rgba(255,255,255,0.3) !important',
  },
  '&.Mui-active': { color: 'white !important' },
}

const HEADER_CELL_SX = {
  bgcolor: 'var(--card-bg, #161d2e)',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '0.72rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  py: 1.2,
  px: 1.5,
}

// Hidden conversation renderer for html2canvas
// Must be in the viewport (not left:-9999) so html2canvas can read it
function ConversationCapture({ thread, captureRef, visible }) {
  if (!visible) return null
  return (
    <Box sx={{
      position: 'fixed', top: '-9999px', left: '0',
      pointerEvents: 'none', width: 520,
    }}>
      <Box
        ref={captureRef}
        sx={{
          width: 500,
          bgcolor: '#f8fafc',
          p: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {thread.map((msg, i) => {
          const isOut = msg.direction === 'outbound'
          return (
            <Box key={i} sx={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
              <Box sx={{
                maxWidth: '78%',
                px: '12px', py: '7px',
                borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                bgcolor: isOut ? '#dbeafe' : '#ffffff',
                border: `1px solid ${isOut ? 'rgba(37,99,235,0.25)' : 'rgba(0,0,0,0.1)'}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              }}>
                <Box sx={{ color: isOut ? '#1e40af' : '#1e293b', fontSize: '13px', lineHeight: 1.45,
                           fontFamily: 'system-ui, sans-serif', whiteSpace: 'pre-wrap' }}>
                  {msg.body || msg.message_body || ''}
                </Box>
                <Box sx={{ color: '#94a3b8', fontSize: '10px', mt: '3px',
                           textAlign: 'right', fontFamily: 'system-ui, sans-serif' }}>
                  {msg.created_at ? new Date(msg.created_at.endsWith('Z') ? msg.created_at : msg.created_at + 'Z').toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export default function Analytics() {
  const [analyzeAttempts, setAnalyzeAttempts] = useState(0)
  const requeueSessionRef  = useRef(false)
  const requeueInFlight    = useRef(false)
  const remainingRef       = useRef(0)
  const prevAnalyzingRef   = useRef(false)
  const esRef              = useRef(null)  // active EventSource for SSE

  // ── SWR: caching + background revalidation ────────────────────────────────
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const _swrFetcher = url => fetch(url).then(r => r.json())
  const { data: _analyticsData, isLoading: loading, mutate: mutateAnalytics } = useSWR(
    `/api/analytics?page=${page}&page_size=${PAGE_SIZE}`,
    _swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true }
  )
  const data      = _analyticsData?.items      || []
  const totalPages = _analyticsData?.pages     || 1
  const totalItems = _analyticsData?.total     || 0
  const [generating, setGenerating]         = useState(null)
  const [reportThread, setReportThread]     = useState([])
  const [captureVisible, setCaptureVisible] = useState(false)
  const [expandedRows, setExpandedRows]     = useState(new Set())

  function toggleExpand(company_id) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(company_id) ? next.delete(company_id) : next.add(company_id)
      return next
    })
  }
  const captureRef = useRef(null)
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'error' })
  const notify = (message, severity = 'error') => setSnack({ open: true, message, severity })
  const [sortField, setSortField] = useState('last_at')
  const [filterCat, setFilterCat] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [sortDir, setSortDir]     = useState('desc')
  const [botBuilderOpen,  setBotBuilderOpen]  = useState(false)
  const [botBuilderRow,   setBotBuilderRow]   = useState(null)
  const [gasBotOpen,      setGasBotOpen]      = useState(false)
  const [gasBotRow,       setGasBotRow]       = useState(null)
  const [classificationSettingsOpen, setClassificationSettingsOpen] = useState(false)
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }


  // Queue the next batch of unanalyzed messages; returns the API response
  const triggerRequeue = useCallback(async () => {
    if (requeueInFlight.current) return { queued: 0, remaining: remainingRef.current }
    requeueInFlight.current = true
    try {
      const res  = await fetch('/api/admin/requeue-unanalyzed', { method: 'POST' })
      const json = await res.json()
      remainingRef.current = json.remaining ?? 0
      return json
    } catch { return { queued: 0, remaining: 0 } }
    finally { requeueInFlight.current = false }
  }, [])

  // On mount: silently start auto-requeue if there are rezagados
  useEffect(() => {
    triggerRequeue().then(result => {
      if ((result.queued || 0) > 0) {
        requeueSessionRef.current = true
        setPage(1)  // SWR auto-fetches page 1 when key changes
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // SSE: replace 8s polling — server pushes when pending count changes
  const MAX_ANALYZE_ATTEMPTS = 20
  useEffect(() => {
    const hasAnalyzing = data.some(r => r.analyzing)

    // analyzing → false transition: queue next batch
    if (!hasAnalyzing && prevAnalyzingRef.current && requeueSessionRef.current) {
      if (remainingRef.current > 0) {
        triggerRequeue().then(result => {
          if ((result.queued || 0) > 0) {
            setAnalyzeAttempts(0)
            mutateAnalytics()
          } else {
            requeueSessionRef.current = false
          }
        })
      } else {
        requeueSessionRef.current = false
      }
    }
    prevAnalyzingRef.current = hasAnalyzing

    if (!hasAnalyzing) {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      if (analyzeAttempts > 0) setAnalyzeAttempts(0)
      return
    }
    if (analyzeAttempts >= MAX_ANALYZE_ATTEMPTS) return
    if (esRef.current) return  // already listening

    // Open SSE connection — server pushes when pending count drops to 0
    const es = new EventSource('/api/analytics/stream')
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const { pending } = JSON.parse(e.data)
        if (pending === 0) {
          setAnalyzeAttempts(a => a + 1)
          mutateAnalytics()
          es.close(); esRef.current = null
        }
      } catch {}
    }
    es.onerror = () => {
      es.close(); esRef.current = null
      // Fallback: 8s timeout if SSE fails
      setTimeout(() => { setAnalyzeAttempts(a => a + 1); mutateAnalytics() }, 8000)
    }
    return () => { if (esRef.current === es) { es.close(); esRef.current = null } }
  }, [data, mutateAnalytics, analyzeAttempts, triggerRequeue])

  const handleGenerateReport = useCallback(async (row, filterNum = null) => {
    const genKey = filterNum ? `${row.company_id}_${filterNum}` : row.company_id
    setGenerating(genKey)
    try {
      // 1. Parallel: load html2canvas module + fetch thread simultaneously
      const [html2canvasModule, threadRes] = await Promise.all([
        import('html2canvas'),
        fetch(`/api/conversations/${row.company_id}`),
      ])
      const thread = threadRes.ok ? await threadRes.json() : []
      const normFn = n => (n || '').replace(/\D/g,'').slice(-10)
      const rawThread = Array.isArray(thread) ? thread : []
      const threadArr = filterNum
        ? rawThread.filter(m => normFn(m.to_number || m.from_number || m.number) === normFn(filterNum))
        : rawThread
      setReportThread(threadArr)
      setCaptureVisible(true)

      // 3. Wait for React to render the messages into the DOM
      await new Promise(r => setTimeout(r, 800))

      // 4. Capture with html2canvas
      let screenshotB64 = null
      try {
        const html2canvas = html2canvasModule.default
        if (captureRef.current) {
          const canvas = await html2canvas(captureRef.current, {
            backgroundColor: '#f8fafc',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            foreignObjectRendering: false,
            windowWidth: 520,
            windowHeight: captureRef.current.scrollHeight || 600,
          })
          if (canvas.width > 0 && canvas.height > 0) {
            screenshotB64 = canvas.toDataURL('image/png')
          }
        } else {
          console.warn('captureRef.current is null — component may not have mounted')
        }
      } catch (e) {
        console.warn('html2canvas failed:', e)
        notify('No se pudo capturar el screenshot; el reporte se generará sin imagen.', 'warning')
      }

      // 4. POST to report endpoint
      const reportRes = await fetch(`/api/reports/${row.company_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot_b64: screenshotB64, filter_number: filterNum || null }),
      })

      if (!reportRes.ok) {
        const errText = await reportRes.text()
        notify(`Error al generar el reporte: ${errText || reportRes.statusText}`)
        return
      }

      // 5. Download
      const blob = await reportRes.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const name = (row.company_name || row.company_id || 'empresa').replace(/\s+/g, '_')
      const suffix = filterNum ? `_${filterNum.replace(/\D/g,'').slice(-4)}` : ''
      a.href = url
      a.download = `reporte-${name}${suffix}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      notify('Reporte generado correctamente.', 'success')
    } catch (e) {
      notify(`Error inesperado: ${e?.message || 'intenta de nuevo'}`)
    } finally {
      setGenerating(null)  // genKey cleared
      setReportThread([])
      setCaptureVisible(false)
    }
  }, [])

  // filterNum: si se pasa, filtra thread y contacto a ese número específico
  function openBotBuilder(row) {
    setBotBuilderRow({
      company_id:    row.company_id    || '',
      company_name:  row.company_name  || '',
      industry:      row.industry      || '',
      website:       row.domain        || '',
      emails:        row.emails        || '',
    })
    setBotBuilderOpen(true)
  }

  function openGasBot(row, number) {
    const validNumbers = (row.numbers || []).filter(n => (n.number || '').replace(/\D/g,'').length >= 10)
    setGasBotRow({
      company_name: row.company_name || '',
      phone:        number || validNumbers[0]?.number || '',
    })
    setGasBotOpen(true)
  }

  const filteredData = data.filter(row => {
    if (filterCat !== 'all') {
      if (filterCat === 'sin_clasificar') {
        if (row.category && row.category !== 'sin_clasificar') return false
      } else if (!matchesCategory(row, filterCat)) return false
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      if (!(row.company_name || '').toLowerCase().includes(q) &&
          !(row.industry    || '').toLowerCase().includes(q) &&
          !(row.domain      || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const sortedData = [...filteredData].sort((a, b) => {
    let av = a[sortField] ?? '', bv = b[sortField] ?? ''
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const total       = data.length
  const pct = cat  => total ? Math.round((data.filter(d => matchesCategory(d, cat)).length / total) * 100) : 0
  const humanPct   = pct('humano')
  const autoPct    = pct('automatico')
  const hibridoPct = pct('hibrido')
  const botPct     = pct('bot')
  const botIaPct   = pct('bot_ia')
  const avgQuality = total
    ? (data.reduce((acc, d) => acc + (d.response_quality || 0), 0) / total).toFixed(1)
    : '—'

  const { t } = useLang()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 2, position: 'relative' }}>

      <ConversationCapture thread={reportThread} captureRef={captureRef} visible={captureVisible} />

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 2,
            bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.15)', border: '1px solid rgba(var(--accent-rgb, 99,102,241), 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChartIcon sx={{ color: 'var(--accent, #a5b4fc)', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
              {t.analytics.title}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
              {t.analytics.subtitle}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>

          {data.some(r => r.analyzing) && (
            <Tooltip title={t.analytics.cancelPending || 'Detener análisis pendientes'}>
              <IconButton size="small" onClick={async () => {
                requeueSessionRef.current = false
                remainingRef.current = 0
                setAnalyzeAttempts(0)
                await fetch('/api/admin/cancel-pending', { method: 'POST' })
                mutateAnalytics()
              }}
                sx={{ color: '#f87171', '&:hover': { color: '#fca5a5' } }}>
                <ErrorOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t.common.refresh}>
            <IconButton size="small" onClick={() => {
              setAnalyzeAttempts(0)
              requeueSessionRef.current = false
              remainingRef.current = 0
              mutateAnalytics()
              triggerRequeue().then(result => {
                if ((result.queued || 0) > 0) {
                  requeueSessionRef.current = true
                }
              })
            }}
              sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title={t.classification.tab}>
              <IconButton size="small" onClick={() => setClassificationSettingsOpen(true)}
                sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'var(--accent, #818cf8)' } }}>
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', flexShrink: 0 }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
          bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid var(--border)', borderRadius: 2,
        }}>
          <StarIcon sx={{ fontSize: 15, color: 'var(--text-muted)' }} />
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.analytics.total}:</Typography>
          <Typography sx={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 700 }}>{total}</Typography>
        </Box>

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
          bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid var(--border)', borderRadius: 2,
        }}>
          <PersonIcon sx={{ fontSize: 15, color: '#4ade80' }} />
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.analytics.pctHuman}:</Typography>
          <Typography sx={{ fontSize: '0.85rem', color: '#4ade80', fontWeight: 700 }}>{humanPct}%</Typography>
        </Box>

        {[
          { icon: '⚡', color: '#facc15', label: t.analytics.automatic, value: autoPct    },
          { icon: '🔀', color: '#38bdf8', label: t.analytics.hybrid,    value: hibridoPct },
          { icon: '🤖', color: '#a78bfa', label: t.analytics.bot,       value: botPct     },
          { icon: '🧠', color: '#c084fc', label: t.analytics.botAi,     value: botIaPct   },
        ].map(({ icon, color, label, value }) => (
          <Box key={label} sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
            bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2,
          }}>
            <Typography sx={{ fontSize: '0.9rem', lineHeight: 1 }}>{icon}</Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' }}>{label}:</Typography>
            <Typography sx={{ fontSize: '0.85rem', color, fontWeight: 700 }}>{value}%</Typography>
          </Box>
        ))}

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
          bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2,
        }}>
          <StarIcon sx={{ fontSize: 15, color: '#facc15' }} />
          <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' }}>{t.analytics.avgQuality}:</Typography>
          <Typography sx={{ fontSize: '0.85rem', color: '#facc15', fontWeight: 700 }}>{avgQuality}</Typography>
        </Box>
      </Box>

      {/* ── Filtros ── */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        {/* Buscador */}
        <TextField size="small" placeholder={t.analytics.searchPh} value={searchText}
          onChange={e => setSearchText(e.target.value)}
          slotProps={{ input: { startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.3)' }} />
            </InputAdornment>
          )}}}
          sx={{ width: 220, '& .MuiOutlinedInput-root': { fontSize: '0.8rem', bgcolor: 'var(--card-bg,#161d2e)', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }, '& input': { color: 'white', py: 0.7 } }} />

        {/* Chips de categoría */}
        {[
          { value: 'all',           label: t.analytics.all,                          color: 'rgba(255,255,255,0.6)',  bg: 'rgba(255,255,255,0.06)'  },
          { value: 'humano',        label: `👤 ${t.analytics.human}`,                color: '#4ade80',                bg: 'rgba(74,222,128,0.1)'    },
          { value: 'automatico',    label: `⚡ ${t.analytics.automatic}`,            color: '#facc15',                bg: 'rgba(250,204,21,0.1)'    },
          { value: 'hibrido',       label: `🔀 ${t.analytics.hybrid}`,              color: '#38bdf8',                bg: 'rgba(56,189,248,0.1)'    },
          { value: 'bot',           label: `🤖 ${t.analytics.bot}`,                 color: '#a78bfa',                bg: 'rgba(167,139,250,0.1)'   },
          { value: 'bot_ia',        label: `🧠 ${t.analytics.botAi}`,               color: '#c084fc',                bg: 'rgba(192,132,252,0.1)'   },
          { value: 'sin_clasificar',label: `⏳ ${t.analytics.noClass}`,             color: '#94a3b8',                bg: 'rgba(148,163,184,0.08)'  },
        ].map(f => {
          const isActive = filterCat === f.value
          const count    = f.value === 'all' ? data.length
                         : f.value === 'sin_clasificar' ? data.filter(d => !d.category || d.category === 'sin_clasificar').length
                         : data.filter(d => matchesCategory(d, f.value)).length
          return (
            <Box key={f.value} onClick={() => { setFilterCat(f.value); setPage(1) }} sx={{
              display: 'flex', alignItems: 'center', gap: 0.5,
              px: 1.2, py: 0.45, borderRadius: 99, cursor: 'pointer',
              bgcolor: isActive ? f.bg : 'transparent',
              border: `1px solid ${isActive ? f.color + '66' : 'rgba(255,255,255,0.08)'}`,
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
              WebkitTapHighlightColor: 'transparent',
              '&:hover': { bgcolor: f.bg, borderColor: f.color + '44' },
            }}>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: isActive ? 700 : 400, color: isActive ? f.color : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                {f.label}
              </Typography>
              {count > 0 && (
                <Box sx={{ bgcolor: isActive ? f.color + '33' : 'rgba(255,255,255,0.06)', borderRadius: 99, px: 0.6, minWidth: 18, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.6rem', color: isActive ? f.color : 'rgba(255,255,255,0.3)', fontWeight: 700, lineHeight: 1.6 }}>{count}</Typography>
                </Box>
              )}
            </Box>
          )
        })}

        {/* Limpiar filtros */}
        {(filterCat !== 'all' || searchText) && (
          <Box onClick={() => { setFilterCat('all'); setSearchText(''); setPage(1) }} sx={{
            px: 1, py: 0.45, borderRadius: 99, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)',
            fontSize: '0.72rem', transition: 'all 0.15s',
            '&:hover': { color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' },
          }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'inherit' }}>✕ Limpiar</Typography>
          </Box>
        )}

        {/* Contador de resultados cuando hay filtro activo */}
        {(filterCat !== 'all' || searchText) && (
          <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', ml: 'auto' }}>
            {sortedData.length} {t.analytics.of} {data.length} {t.analytics.companies}
          </Typography>
        )}
      </Box>

      {/* Table / states */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Table size="small" stickyHeader sx={{ minWidth: 800 }}>
              <TableHead>
                <TableRow>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <TableCell key={i} sx={HEADER_CELL_SX}>
                      <Skeleton variant="text" width={i === 0 ? 16 : '70%'} sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 8 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 12 }).map((_, col) => (
                      <TableCell key={col} sx={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <Skeleton variant="text" width={col === 0 ? 16 : '80%'} sx={{ bgcolor: 'rgba(255,255,255,0.06)' }} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : data.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, pt: 6, gap: 1.5 }}>
            <BarChartIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.08)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', textAlign: 'center', maxWidth: 360 }}>
              {t.analytics.noData}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem', textAlign: 'center', maxWidth: 360 }}>
              {t.analytics.noDataSub}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{
            flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto',
            scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
          }}>
            <Table size="small" stickyHeader sx={{ minWidth: 800 }}>
              <TableHead>
                <TableRow>
                  {/* Columna expand — sin label */}
                  <TableCell sx={{ ...HEADER_CELL_SX, width: 32, px: 0.5 }} />
                  {/* Empresa */}
                  <TableCell sx={HEADER_CELL_SX}>
                    <TableSortLabel active={sortField === 'company_name'} direction={sortField === 'company_name' ? sortDir : 'asc'}
                      onClick={() => handleSort('company_name')}
                      sx={{ color: 'rgba(255,255,255,0.5) !important', '& .MuiTableSortLabel-icon': { color: 'rgba(255,255,255,0.3) !important' }, '&.Mui-active': { color: 'white !important' } }}>
                      {t.analytics.company}
                    </TableSortLabel>
                  </TableCell>
                  {/* Número */}
                  <TableCell sx={{ ...HEADER_CELL_SX, whiteSpace: 'nowrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <WhatsAppIcon sx={{ fontSize: 12 }} /> {t.analytics.phoneNum}
                    </Box>
                  </TableCell>
                  {/* Industria + Categoría */}
                  {[
                    { field: 'industry', label: t.analytics.industry },
                    { field: 'category', label: t.analytics.category },
                  ].map(({ field, label }) => (
                    <TableCell key={field} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                      <TableSortLabel active={sortField === field} direction={sortField === field ? sortDir : 'asc'}
                        onClick={() => handleSort(field)}
                        sx={SORT_LABEL_CENTER_SX}>
                        {label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'response_quality'} direction={sortField === 'response_quality' ? sortDir : 'asc'}
                      onClick={() => handleSort('response_quality')}
                      sx={SORT_LABEL_CENTER_SX}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <StarIcon sx={{ fontSize: 12 }} /> {t.analytics.quality}
                      </Box>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'reaction_time_min'} direction={sortField === 'reaction_time_min' ? sortDir : 'asc'}
                      onClick={() => handleSort('reaction_time_min')}
                      sx={SORT_LABEL_CENTER_SX}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <AccessTimeIcon sx={{ fontSize: 12 }} /> {t.analytics.reaction}
                      </Box>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'last_at'} direction={sortField === 'last_at' ? sortDir : 'asc'}
                      onClick={() => handleSort('last_at')}
                      sx={{ color: 'rgba(255,255,255,0.5) !important', '& .MuiTableSortLabel-icon': { color: 'rgba(255,255,255,0.3) !important' }, '&.Mui-active': { color: 'white !important' } }}>
                      {t.analytics.lastResp}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>{t.analytics.notes}</TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                      Chat IA
                      <Tooltip title={t.analytics.chatIaHelp}>
                        <HelpOutlineIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', cursor: 'help', position: 'relative', top: -1 }} />
                      </Tooltip>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                      {t.analytics.modifyBot}
                      <Tooltip title={t.analytics.modifyBotHelp}>
                        <HelpOutlineIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', cursor: 'help', position: 'relative', top: -1 }} />
                      </Tooltip>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>{t.analytics.report}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedData.map((row) => {
                  const cat = getCategoryConfig(row)
                  const notesText = row.notes || ''
                  const notesTruncated = notesText.length > 60 ? notesText.slice(0, 60) + '…' : notesText
                  const isGenerating = generating === row.company_id
                  const validNumbers = (row.numbers || []).filter(n => (n.number || '').replace(/\D/g,'').length >= 10)
                  const hasMultiple = validNumbers.length > 1
                  const isExpanded = expandedRows.has(row.company_id)
                  return (
                    <Fragment key={row.company_id}>
                    <TableRow sx={{
                      '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.05))' },
                      '[data-theme-mode="light"] &:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
                      transition: 'background 0.15s',
                    }}>
                      {/* Expand button */}
                      <TableCell sx={{ ...CELL_SX, px: 0.5, width: 32 }}>
                        {hasMultiple && (
                          <IconButton size="small" onClick={() => toggleExpand(row.company_id)}
                            sx={{ color: 'rgba(255,255,255,0.3)', p: 0.3, '&:hover': { color: 'var(--accent,#a5b4fc)' } }}>
                            {isExpanded
                              ? <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                              : <KeyboardArrowRightIcon sx={{ fontSize: 16 }} />}
                          </IconButton>
                        )}
                      </TableCell>

                      {/* Empresa */}
                      <TableCell sx={CELL_SX}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                          <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: '0.8rem' }}>
                            {row.company_name || row.company_id}
                          </Typography>
                          {row.analyzing && (
                            <Tooltip title={t.analytics.analyzingTooltip}>
                              <CircularProgress size={11} thickness={5} sx={{ color: 'var(--accent,#a5b4fc)', opacity: 0.8, flexShrink: 0 }} />
                            </Tooltip>
                          )}
                          {hasMultiple && (
                            <Chip label={`${validNumbers.length} ${t.analytics.numsChip}`} size="small" sx={{
                              height: 16, fontSize: '0.6rem',
                              bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.15)',
                              color: 'var(--accent,#a5b4fc)',
                              border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
                            }} />
                          )}
                        </Box>
                        {row.domain && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem' }}>
                            {row.domain}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Número */}
                      <TableCell sx={CELL_SX}>
                        {!hasMultiple && validNumbers[0] && (() => {
                          const n0 = validNumbers[0]
                          const sn = (n0.number || '').replace(/\D/g,'').slice(-10).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
                          const replied0 = n0.responses > 0
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <WhatsAppIcon sx={{ fontSize: 12, color: replied0 ? '#4ade80' : 'rgba(255,255,255,0.18)', filter: replied0 ? 'drop-shadow(0 0 3px #4ade8066)' : 'grayscale(1)', flexShrink: 0 }} />
                              <Typography sx={{ fontSize: '0.72rem', fontFamily: 'monospace', color: replied0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }}>{sn}</Typography>
                            </Box>
                          )
                        })()}
                      </TableCell>

                      {/* Industria */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', textAlign: 'center' }}>
                          {row.industry || '—'}
                        </Typography>
                      </TableCell>

                      {/* Categoría */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (row.category
                          ? <Chip label={`${cat.icon} ${t.analytics[cat.tKey]}`} size="small" sx={{ height: 20, fontSize: '0.7rem', bgcolor: cat.bg, color: cat.color, border: `1px solid ${cat.color}44` }} />
                          : <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>{t.analytics.noCategory}</Typography>)}
                      </TableCell>

                      {/* Calidad */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (row.response_quality != null
                          ? <QualityDots score={row.response_quality} color={cat.color} />
                          : <QualityDots score={0} color="rgba(255,255,255,0.1)" />)}
                      </TableCell>

                      {/* T. Reacción */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem', textAlign: 'center' }}>
                            {formatReactionTime(row.reaction_time_min)}
                          </Typography>
                        )}
                      </TableCell>


                      {/* Última respuesta */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', textAlign: 'center' }}>
                            {formatLastAt(row.last_at)}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Notas */}
                      <TableCell sx={{ ...CELL_SX, maxWidth: 200, textAlign: 'center' }}>
                        {!hasMultiple && (notesText
                          ? <Tooltip title={notesText} placement="top"><Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', cursor: 'default' }}>{notesTruncated}</Typography></Tooltip>
                          : <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>—</Typography>)}
                      </TableCell>

                      {/* Andy */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {(() => {
                          const noAnalysis = !row.category
                          const andyTip = noAnalysis ? t.analytics.noAnalysis : hasMultiple ? t.analytics.sendAllToAndy : t.analytics.sendToAndy
                          return (
                            <Tooltip title={andyTip}>
                              <span>
                                <IconButton size="small" disabled={noAnalysis} onClick={() => openBotBuilder(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <SendIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>

                      {/* Modificar Bot — solo industrias de gas */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {(() => {
                          const isGas = isGasIndustry(row.industry)
                          return (
                            <Tooltip title={!isGas ? t.analytics.notGasIndustry : t.analytics.modifyBotTooltip}>
                              <span>
                                <IconButton size="small" disabled={!isGas} onClick={() => openGasBot(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: '#fb923c', bgcolor: 'rgba(251,146,60,0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <LocalGasStationIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>

                      {/* Reporte */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (() => {
                          const noContact = !row.total_responses || !row.category || row.category === 'sin_respuesta'
                          const tip = isGenerating ? t.analytics.generating : generating ? t.analytics.pleaseWait : (!row.category || row.category === 'sin_respuesta') ? t.analytics.noReply : !row.total_responses ? t.analytics.noConvRecord : t.analytics.reportPdf
                          return (
                            <Tooltip title={tip}>
                              <span>
                                <IconButton size="small" disabled={!!generating || noContact} onClick={() => handleGenerateReport(row)}
                                  sx={{ color: isGenerating ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  {isGenerating ? <CircularProgress size={14} sx={{ color: 'var(--accent,#6366f1)' }} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>
                    </TableRow>

                    {/* Filas expandibles — una por número, alineadas con columnas */}
                    {hasMultiple && isExpanded && row.numbers.filter(n => (n.number || '').replace(/\D/g,'').length >= 10).map(n => {
                      const nCat     = getCategoryConfig({ category: n.category, is_ai: n.is_ai })
                      const replied  = n.responses > 0
                      const inherited = n.inherited_analysis === true
                      const hasAnalysis = !!n.category
                      const shortNum = (n.number || '').replace(/\D/g,'').slice(-10)
                        .replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
                      const numKey  = `${row.company_id}_${n.number}`
                      const genKey  = numKey
                      const isGenNum = generating === genKey
                      const NSUB = { ...CELL_SX, bgcolor: 'rgba(0,0,0,0.15)', borderBottom: '1px solid rgba(255,255,255,0.04)' }
                      return (
                        <TableRow key={numKey} sx={{ opacity: replied ? 1 : 0.45 }}>
                          <TableCell sx={{ ...NSUB, px: 0.5, width: 32 }} />
                          {/* Empresa — nombre de sucursal o número como fallback */}
                          <TableCell sx={{ ...NSUB, pl: 3 }}>
                            <Box>
                              <Typography sx={{ fontSize: '0.75rem', fontWeight: n.label ? 600 : 400, color: replied ? (n.label ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)') : 'rgba(255,255,255,0.3)', lineHeight: 1.3, fontFamily: n.label ? 'inherit' : 'monospace' }}>
                                {n.label || shortNum}
                              </Typography>
                              {n.source && (
                                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.22)', lineHeight: 1.2 }}>
                                  {n.source}
                                </Typography>
                              )}
                            </Box>
                          </TableCell>
                          {/* Número */}
                          <TableCell sx={NSUB}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <WhatsAppIcon sx={{
                                fontSize: 12,
                                color: replied ? '#4ade80' : 'rgba(255,255,255,0.18)',
                                filter: replied ? 'drop-shadow(0 0 3px #4ade8066)' : 'grayscale(1)',
                                flexShrink: 0,
                              }} />
                              <Typography sx={{ fontSize: '0.72rem', fontFamily: 'monospace', color: replied ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.28)' }}>
                                {shortNum}
                              </Typography>
                            </Box>
                          </TableCell>
                          {/* Industria — vacía */}
                          <TableCell sx={NSUB} />
                          {/* Categoría */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            {!replied
                              ? <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Sin definir</Typography>
                              : hasAnalysis
                                ? <Chip
                                    label={`${nCat.icon} ${t.analytics[nCat.tKey]}`}
                                    size="small"
                                    sx={{ height: 18, fontSize: '0.65rem', bgcolor: nCat.bg, color: nCat.color,
                                          border: `1px solid ${nCat.color}44`,
                                          opacity: inherited ? 0.65 : 1 }}
                                  />
                                : <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Sin definir</Typography>}
                          </TableCell>
                          {/* Calidad */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            {replied && n.response_quality != null
                              ? <QualityDots score={n.response_quality} color={nCat.color} />
                              : <QualityDots score={0} color="rgba(255,255,255,0.1)" />}
                          </TableCell>
                          {/* T. Reacción */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', textAlign: 'center' }}>
                              {n.reaction_time_min != null ? formatReactionTime(n.reaction_time_min) : '—'}
                            </Typography>
                          </TableCell>
                          {/* Última respuesta */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: replied ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)', textAlign: 'center' }}>
                              {n.last_at ? formatLastAt(n.last_at) : '—'}
                            </Typography>
                          </TableCell>
                          {/* Notas */}
                          <TableCell sx={{ ...NSUB, maxWidth: 200 }}>
                            {!replied
                              ? <Typography sx={{ color: 'rgba(248,113,113,0.5)', fontSize: '0.72rem', fontStyle: 'italic' }}>{t.analytics.noReply}</Typography>
                              : n.notes
                                ? <Tooltip title={n.notes} placement="top">
                                    <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                                      {n.notes.length > 55 ? n.notes.slice(0, 55) + '…' : n.notes}
                                    </Typography>
                                  </Tooltip>
                                : <Typography sx={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.72rem' }}>—</Typography>}
                          </TableCell>
                          {/* Andy por número — deshabilitado si no respondió o sin análisis */}
                          <TableCell sx={NSUB}>
                            <Tooltip title={!replied ? t.analytics.noReply : !hasAnalysis ? t.analytics.noAnalysis : t.analytics.sendToAndy}>
                              <span>
                                <IconButton size="small" disabled={!replied || !hasAnalysis} onClick={() => openBotBuilder(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <SendIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                          {/* Modificar Bot por número — solo industrias de gas */}
                          <TableCell sx={NSUB}>
                            {(() => {
                              const isGas = isGasIndustry(row.industry)
                              return (
                                <Tooltip title={!isGas ? t.analytics.notGasIndustry : t.analytics.modifyBotTooltip}>
                                  <span>
                                    <IconButton size="small" disabled={!isGas} onClick={() => openGasBot(row, n.number)}
                                      sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: '#fb923c', bgcolor: 'rgba(251,146,60,0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                      <LocalGasStationIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )
                            })()}
                          </TableCell>
                          {/* PDF por número */}
                          <TableCell sx={NSUB}>
                            <Tooltip title={isGenNum ? t.analytics.generating : generating ? t.analytics.pleaseWait : !replied ? t.analytics.noReply : `${t.analytics.reportPdf} ${shortNum}`}>
                              <span>
                                <IconButton size="small" disabled={!!generating || !replied} onClick={() => handleGenerateReport(row, n.number)}
                                  sx={{ color: isGenNum ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  {isGenNum ? <CircularProgress size={14} sx={{ color: 'var(--accent,#6366f1)' }} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* Paginación */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {totalItems} {t.analytics.companies} · {t.analytics.page} {page} {t.analytics.of} {totalPages}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Box onClick={() => setPage(p => Math.max(1, p - 1))} sx={{
              width: 30, height: 30, borderRadius: 1.5, cursor: page > 1 ? 'pointer' : 'default',
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              color: page > 1 ? 'var(--text-muted)' : 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              '&:hover': page > 1 ? { bgcolor: 'var(--border)' } : {},
            }}>
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            </Box>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pg = totalPages <= 7 ? i + 1
                : page <= 4 ? i + 1
                : page >= totalPages - 3 ? totalPages - 6 + i
                : page - 3 + i
              return (
                <Box key={pg} onClick={() => setPage(pg)} sx={{
                  width: 32, height: 30, borderRadius: 1.5, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: pg === page ? 'var(--accent,#3b82f6)' : 'var(--item-hover)',
                  border: `1px solid ${pg === page ? 'var(--accent,#3b82f6)' : 'var(--border)'}`,
                  color: pg === page ? '#ffffff' : 'var(--text-muted)',
                  fontSize: '0.78rem', fontWeight: pg === page ? 700 : 400,
                  transition: 'all 0.15s',
                  '&:hover': pg !== page ? { bgcolor: 'var(--border)' } : {},
                }}>{pg}</Box>
              )
            })}
            <Box onClick={() => setPage(p => Math.min(totalPages, p + 1))} sx={{
              width: 30, height: 30, borderRadius: 1.5, cursor: page < totalPages ? 'pointer' : 'default',
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              color: page < totalPages ? 'var(--text-muted)' : 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              '&:hover': page < totalPages ? { bgcolor: 'var(--border)' } : {},
            }}>
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            </Box>
          </Box>
        </Box>
      )}

      <AndyBotBuilder open={botBuilderOpen} initialData={botBuilderRow} onClose={() => { setBotBuilderOpen(false); setBotBuilderRow(null) }} />

      <GasBotModal open={gasBotOpen} initialData={gasBotRow} onClose={() => { setGasBotOpen(false); setGasBotRow(null) }} />

      {isAdmin && (
        <ClassificationSettingsModal open={classificationSettingsOpen} onClose={() => setClassificationSettingsOpen(false)} />
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
