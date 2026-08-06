'use client'
import { useState, useRef } from 'react'
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
import { useLang } from '../context/LangContext'
import { isValidUrl } from '@/lib/validators'

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
  const pauseRef   = useRef(false)
  const cancelRef  = useRef(false)

  const [dragging,   setDragging]   = useState(false)
  const [fileName,   setFileName]   = useState('')
  const [fileError,  setFileError]  = useState('')
  const [urlCol,     setUrlCol]     = useState('')
  const [allUrls,    setAllUrls]    = useState([])
  const [preview,    setPreview]    = useState([])
  const [loading,    setLoading]    = useState(false)
  const [paused,     setPaused]     = useState(false)
  const [results,    setResults]    = useState([])
  const [progress,        setProgress]        = useState(0)
  const [completedCount,  setCompletedCount]  = useState(0)
  const [currentUrl, setCurrentUrl] = useState('')
  const [done,       setDone]       = useState(false)
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
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const msgRef       = useRef(null)
  const highlightRef = useRef(null)
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
      setResults([])
      setDone(false)
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
    setResults([]); setDone(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleProcess() {
    if (!allUrls.length) return
    pauseRef.current  = false
    cancelRef.current = false
    setResults([]); setProgress(0); setCompletedCount(0); setLoading(true); setDone(false); setPaused(false); setPage(0)

    const res = []
    const CONCURRENCY = 4
    const total = allUrls.length
    let completed = 0
    for (let i = 0; i < total; i += CONCURRENCY) {
      while (pauseRef.current && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      if (cancelRef.current) break

      const chunk = allUrls.slice(i, i + CONCURRENCY)
      setCurrentUrl(chunk[0])

      const chunkResults = await Promise.all(chunk.map(async (url) => {
        try {
          const r = await fetch('/api/process-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, skip_send: true }),
          })
          if (!r.ok) {
            const body = await r.json().catch(() => null)
            throw new Error(body?.detail || `HTTP ${r.status}`)
          }
          const d = await r.json()
          if (d.blacklisted) {
            completed++
            setProgress(Math.round(completed / total * 100))
            setCompletedCount(completed)
            setCurrentUrl(url)
            return { url, empresa: '—', industria: '—', whatsapp: '', all_whatsapp: [], company_id: '', scraped_data: null, status_wa: '—', msg_status: null, ok: false, blacklisted: true, blockReason: d.matched, duplicate: false }
          }
          const duplicate = d.duplicate === true
          const row = {
            url,
            empresa:     d.scraped?.name || '—',
            industria:   d.scraped?.industry || '—',
            whatsapp:    d.primary_whatsapp_number || '',
            all_whatsapp: d.all_whatsapp_numbers || (d.primary_whatsapp_number ? [d.primary_whatsapp_number] : []),
            company_id:  d.company_id || '',
            scraped_data: d.scraped,
            status_wa:   d.send_result?.status_code || '—',
            msg_status:  null,
            ok:          true,
            blacklisted: false,
            blockReason: null,
            duplicate,
          }
          completed++
          setProgress(Math.round(completed / total * 100))
          setCompletedCount(completed)
          setCurrentUrl(url)
          return row
        } catch (e) {
          completed++
          setProgress(Math.round(completed / total * 100))
          setCompletedCount(completed)
          return { url, empresa: '—', industria: '—', whatsapp: '', all_whatsapp: [], company_id: '', scraped_data: null, status_wa: '—', msg_status: null, ok: false, duplicate: false, errorReason: e.message }
        }
      }))
      res.push(...chunkResults)
      setResults([...res])
    }

    setProgress(100)
    setCurrentUrl('')
    setLoading(false)
    setPaused(false)
    setDone(true)
  }

  function handlePause() {
    pauseRef.current = !pauseRef.current
    setPaused(pauseRef.current)
  }

  function handleCancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
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


  const waRows      = results.filter(r => r.ok && (r.all_whatsapp?.length > 0 || r.whatsapp) && r.company_id)
  const alreadySent = results.some(r => r.msg_status === 'sent' || r.msg_status === 'failed' || r.msg_status === 'queued')
  const isSending   = queueActive !== null && alreadySent
  const sentCount   = results.filter(r => r.msg_status === 'sent' || r.msg_status === 'queued').length
  const totalNumbers = waRows.reduce((sum, r) => sum + (r.all_whatsapp?.length > 0 ? r.all_whatsapp.length : (r.whatsapp ? 1 : 0)), 0)
  // Sending to 2+ numbers needs varied text (see MIN_TEMPLATES_FOR_BULK) — editing
  // one base message stops making sense there, so it switches to picking 3+ saved templates.
  const isBulk = totalNumbers > 1
  const allVariants = (isBulk ? extraVariants : [msgText]).map(v => v.trim()).filter(Boolean)
  const belowMinTemplates = isBulk && allVariants.length < MIN_TEMPLATES_FOR_BULK

  function handleSendAll() {
    const targets = waRows
    if (!targets.length || belowMinTemplates) return
    let lastVariant = null
    const updated = results.map(r => ({ ...r }))
    const jobs = []
    for (const row of targets) {
      const numbers = row.all_whatsapp?.length > 0 ? row.all_whatsapp : (row.whatsapp ? [row.whatsapp] : [])
      if (!numbers.length) continue
      const messages = numbers.map(() => {
        const v = pickMessageVariant(allVariants, lastVariant)
        lastVariant = v
        return renderTemplate(v, row.scraped_data)
      })
      jobs.push({ numbers, messages, companyId: row.company_id, website: row.url })
      const idx = updated.findIndex(r => r.url === row.url)
      if (idx >= 0) updated[idx] = { ...updated[idx], msg_status: 'queued' }
    }
    addBatch(jobs, lang === 'en' ? 'CSV import' : 'Importación CSV')
    setResults(updated)
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
                startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
                sx={{
                  flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem',
                  color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(251,191,36,0.15)', borderColor: 'rgba(251,191,36,0.45)' },
                }}
              >
                {paused ? t.csv.resume : t.csv.pause}
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
                : <CircularProgress size={14} sx={{ color: 'var(--accent, #3b82f6)' }} />
              }
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                {paused ? t.csv.paused : t.csv.processing} {completedCount} {t.csv.of} {allUrls.length}
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

      {/* ── Toggle de envío masivo ── */}
      {done && results.length > 0 && waRows.length > 0 && (
        <Box sx={{ borderRadius: 2, border: `1px solid ${showSend ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.12)'}`, bgcolor: showSend ? 'rgba(34,197,94,0.04)' : 'transparent', transition: 'all 0.2s' }}>
          {/* Header toggle */}
          <Box onClick={() => setShowSend(o => !o)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.2, cursor: 'pointer', borderRadius: showSend ? '8px 8px 0 0' : 2, '&:hover': { bgcolor: 'rgba(34,197,94,0.06)' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MessageIcon sx={{ fontSize: 15, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{t.csv.sendMessages}</Typography>
              <Chip icon={<WhatsAppIcon sx={{ fontSize: '11px !important' }} />} label={`${waRows.length} ${t.csv.withWhatsApp}`} size="small"
                sx={{ fontSize: '0.68rem', height: 20, bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: '#4ade80' } }} />
            </Box>
            <Box sx={{ fontSize: 15, color: 'rgba(34,197,94,0.5)', transform: showSend ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'flex' }}>▾</Box>
          </Box>

          {/* Panel colapsable */}
          <Collapse in={showSend}>
            <Box sx={{ px: 2, pb: 2, borderTop: '1px solid rgba(34,197,94,0.1)' }}>
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

              <Button fullWidth onClick={handleSendAll}
                disabled={waRows.length === 0 || alreadySent || isDisconnected || belowMinTemplates}
                startIcon={isSending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '0.82rem', fontWeight: 700, py: 1, textTransform: 'none', borderRadius: 1.5,
                  bgcolor: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.35)',
                  '&:hover': { bgcolor: 'rgba(34,197,94,0.25)' },
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
                }}>
                {alreadySent ? `${sentCount} ${t.csv.msgSent}` : `${t.csv.sendTo} ${waRows.length} ${waRows.length !== 1 ? t.csv.companies : t.csv.company} ${t.csv.withWhatsApp}`}
              </Button>
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
                        {r.whatsapp ? (
                          <Chip icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />} label={r.whatsapp} size="small"
                            sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
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
    </Box>
  )
}
