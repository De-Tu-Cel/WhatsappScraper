'use client'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useLang } from '../context/LangContext'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import { authFetch } from '@/lib/api'
import { keyframes } from '@mui/system'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import SearchIcon from '@mui/icons-material/Search'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import DownloadIcon from '@mui/icons-material/Download'
import ReplayIcon from '@mui/icons-material/Replay'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox'
import HistoryIcon from '@mui/icons-material/History'
import MessageIcon from '@mui/icons-material/Message'
import SendIcon from '@mui/icons-material/Send'
import { TEMPLATES } from './singleUrlProcessor'

// INDUSTRY_GROUPS and INDUSTRY_EXAMPLES are built inside the component from translations

const fadeSlideIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '') }
  catch { return url }
}

function useTypewriter(strings, active) {
  const [display, setDisplay] = useState('')
  const ref = useRef({ wordIdx: 0, charIdx: 0, deleting: false })
  useEffect(() => {
    if (!active) { setDisplay(''); return }
    let timer
    function tick() {
      const s = ref.current
      const word = strings[s.wordIdx]
      if (!s.deleting) {
        if (s.charIdx < word.length) {
          const next = s.charIdx + 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 75)
        } else {
          ref.current = { ...s, deleting: true }
          timer = setTimeout(tick, 1600)
        }
      } else {
        if (s.charIdx > 0) {
          const next = s.charIdx - 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 40)
        } else {
          ref.current = { wordIdx: (s.wordIdx + 1) % strings.length, charIdx: 0, deleting: false }
          timer = setTimeout(tick, 350)
        }
      }
    }
    timer = setTimeout(tick, 500)
    return () => clearTimeout(timer)
  }, [active, strings])
  return display
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

export default function SearchProspects() {
  const pauseRef       = useRef(false)
  const cancelRef      = useRef(false)
  const abortSearchRef = useRef(null)

  const [industry,    setIndustry]    = useState('')
  const [numResults,  setNumResults]  = useState(10)
  const [searching,    setSearching]    = useState(false)
  const [visibleCount, setVisibleCount] = useState(10)
  const [found,         setFound]         = useState([])
  const [processing,  setProcessing]  = useState(false)
  const [paused,      setPaused]      = useState(false)
  const [results,     setResults]     = useState([])
  const [progress,    setProgress]    = useState(0)
  const [currentUrl,  setCurrentUrl]  = useState('')
  const [done,        setDone]        = useState(false)
  const [filterScraped, setFilterScraped] = useState('all')
  const [history,     setHistory]     = useState([])
  const [acOpen,      setAcOpen]      = useState(false)
  const [acIdx,       setAcIdx]       = useState(0)
  const [selectedTpl, setSelectedTpl] = useState(TEMPLATES[0].id)
  const [msgText,     setMsgText]     = useState(TEMPLATES[0].text)
  const [sendingAll,  setSendingAll]  = useState(false)
  const [waDeselected, setWaDeselected] = useState(new Set())
  const [confirmDialog, setConfirmDialog] = useState({ open: false, names: '', resolve: null }) // números que el usuario quitó manualmente
  const msgRef = useRef(null)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('searchHistory') || '[]')) } catch {}
  }, [])

  // Reset deselected when new results arrive
  useEffect(() => { setWaDeselected(new Set()) }, [results])

  // waRows y waRowsUnique deben ir ANTES de effectiveWaSelected
  const waRowsAll    = results.filter(r => r.ok && (r.all_whatsapp?.length > 0 || r.whatsapp) && r.company_id)
  const waRowsUnique = useMemo(() => {
    const seen = new Set()
    return waRowsAll.filter(r => seen.has(r.company_id) ? false : seen.add(r.company_id))
  }, [waRowsAll])

  // Siempre sincronizado — sin delay de un render
  const effectiveWaSelected = useMemo(() =>
    new Set(waRowsUnique.map(r => r.company_id).filter(id => !waDeselected.has(id))),
  [waRowsUnique, waDeselected])

  const { t } = useLang()

  const INDUSTRY_GROUPS = useMemo(() => {
    const i = t.search.industries
    return [
      { label: i.groupAlimentos,     color: '#f97316', items: [i.restaurantes, i.taqueria,    i.panaderia,  i.cafeteria,  i.catering] },
      { label: i.groupSalud,         color: '#22c55e', items: [i.dentistas,    i.clinicas,     i.farmacias,  i.veterinarias, i.gimnasios] },
      { label: i.groupBelleza,       color: '#ec4899', items: [i.esteticas,    i.spas,         i.peluquerias, i.salonesUnas] },
      { label: i.groupServicios,     color: '#60a5fa', items: [i.plomeros,     i.electricistas, i.talleresAuto, i.lavanderia, i.mudanzas] },
      { label: i.groupComercio,      color: '#a78bfa', items: [i.ferreteria,   i.tiendasRopa,  i.electronica, i.muebles,    i.abarrotes] },
      { label: i.groupProfesionales, color: '#fbbf24', items: [i.abogados,     i.contadores,   i.arquitectos, i.agenciasInmob] },
      { label: i.groupEducacion,     color: '#34d399', items: [i.academias,    i.guarderias,   i.tutores,    i.escuelasIdiomas] },
      { label: i.groupHospedaje,     color: '#f87171', items: [i.hoteles,      i.hostales,     i.cabanas,    i.salonesEventos] },
    ]
  }, [t])

  const INDUSTRY_EXAMPLES = useMemo(() => {
    const i = t.search.industries
    return [i.ex1, i.ex2, i.ex3, i.ex4, i.ex5, i.ex6]
  }, [t])

  const placeholder = useTypewriter(INDUSTRY_EXAMPLES, !industry && found.length === 0 && !processing && !searching)
  const ALL_INDUSTRIES = INDUSTRY_GROUPS.flatMap(g => g.items.map(item => ({ item, color: g.color })))
  const acMatches = industry.trim().length > 0
    ? ALL_INDUSTRIES.filter(({ item }) =>
        item.toLowerCase().startsWith(industry.toLowerCase()) &&
        item.toLowerCase() !== industry.toLowerCase()
      )
    : []

  const visibleFound = found
    .slice(0, visibleCount)
    .filter(r => filterScraped === 'all' ? true : filterScraped === 'new' ? !r.scraped : r.scraped)
  const selectedCount    = found.filter(r => r.selected).length
  const processableCount = found.filter(r => r.selected && !r.scraped).length
  const skippedCount     = found.filter(r => r.selected && r.scraped).length
  const allSelected      = found.length > 0 && found.filter(r => !r.scraped).every(r => r.selected) && found.some(r => !r.scraped)
  const newCount      = found.filter(r => !r.scraped).length
  const scrapedCount  = found.filter(r => r.scraped).length
  const okCount       = results.filter(r => r.ok).length
  const errCount      = results.filter(r => !r.ok).length
  const waCount       = results.filter(r => r.whatsapp).length
  const hasResults    = found.length > 0 || processing || done || searching

  function saveHistory(query) {
    const next = [query, ...history.filter(h => h !== query)].slice(0, 6)
    setHistory(next)
    localStorage.setItem('searchHistory', JSON.stringify(next))
  }

  async function fetchAndMark(urls) {
    try {
      const r = await fetch('/api/companies/check-urls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      if (!r.ok) return urls.map(url => ({ url, selected: false, scraped: false }))
      const map = await r.json()
      return urls.map(url => ({ url, selected: false, scraped: !!map[url] }))
    } catch {
      return urls.map(url => ({ url, selected: false, scraped: false }))
    }
  }

  async function handleSearch(overrideIndustry) {
    const query = (typeof overrideIndustry === 'string' ? overrideIndustry : industry).trim()
    if (!query) return
    abortSearchRef.current?.abort()
    const ctrl = new AbortController()
    abortSearchRef.current = ctrl
    setSearching(true); setFound([]); setResults([]); setDone(false); setVisibleCount(numResults); setFilterScraped('all')
    try {
      const res = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: query, city: '', num_results: numResults, offset: 0 }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error()
      const { urls } = await res.json()
      const marked = await fetchAndMark(urls)
      setFound(marked)
      saveHistory(query)
    } catch (err) {
      if (err?.name !== 'AbortError') setFound([])
    } finally {
      setSearching(false)
    }
  }

  function handleLoadMore() {
    setVisibleCount(c => Math.min(c + numResults, found.length))
  }

  // "Select all" only selects new ones — scraped ones are never auto-selected
  function toggleAll(val) {
    setFound(f => f.map(r => ({ ...r, selected: val ? !r.scraped : false })))
  }
  function toggleOne(i)   { setFound(f => f.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r)) }
  function selectOnlyNew()   { setFound(f => f.map(r => ({ ...r, selected: !r.scraped }))) }
  function deselectScraped() { setFound(f => f.map(r => ({ ...r, selected: r.scraped ? false : r.selected }))) }

  async function runProcessLoop(urls, baseResults) {
    const res = [...baseResults]
    const CONCURRENCY = 4
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 200))
      if (cancelRef.current) break
      const chunk = urls.slice(i, i + CONCURRENCY)
      setCurrentUrl(chunk[0])
      setProgress(Math.round(((baseResults.length + i) / (baseResults.length + urls.length)) * 100))
      const chunkResults = await Promise.all(chunk.map(async (url) => {
        try {
          const r = await fetch('/api/process-url', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, skip_send: true }),
          })
          if (!r.ok) throw new Error()
          const d = await r.json()
          return {
            url, empresa: d.scraped?.name || '—', industria: d.scraped?.industry || '—',
            whatsapp: d.primary_whatsapp_number || '',
            all_whatsapp: d.all_whatsapp_numbers || (d.primary_whatsapp_number ? [d.primary_whatsapp_number] : []),
            company_id: d.company_id || '',
            scraped_data: d.scraped,
            status_wa: d.send_result?.status_code || '—',
            msg_status: null, ok: true,
          }
        } catch {
          return { url, empresa: '—', industria: '—', whatsapp: '', all_whatsapp: [], company_id: '', scraped_data: null, status_wa: '—', msg_status: null, ok: false }
        }
      }))
      res.push(...chunkResults)
      setResults([...res])
    }

    // Check which companies were already contacted and by whom
    const ids = res.filter(r => r.company_id).map(r => r.company_id)
    if (ids.length > 0) {
      try {
        const cr = await fetch('/api/companies/check-contacted', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_ids: ids }),
        })
        if (cr.ok) {
          const contactMap = await cr.json()
          setResults(prev => prev.map(r => r.company_id && contactMap[r.company_id]
            ? { ...r, already_contacted: contactMap[r.company_id] }
            : r
          ))
        }
      } catch {}
    }
    return res
  }

  async function handleProcess() {
    // Always skip already-scraped URLs regardless of selection state
    const toProcess = found.filter(r => r.selected && !r.scraped)
    const skipped   = found.filter(r => r.selected && r.scraped).length
    if (!toProcess.length) return
    const urls = toProcess.map(r => r.url)
    pauseRef.current = false; cancelRef.current = false
    setResults([]); setProgress(0); setProcessing(true); setDone(false); setPaused(false)
    if (skipped > 0) console.info(`⏭️ Saltando ${skipped} URL(s) ya scrapeadas`)
    await runProcessLoop(urls, [])
    setProgress(100); setCurrentUrl(''); setProcessing(false); setPaused(false); setDone(true)
  }

  async function handleRetryFailed() {
    const failedUrls = results.filter(r => !r.ok).map(r => r.url)
    if (!failedUrls.length) return
    const successful = results.filter(r => r.ok)
    pauseRef.current = false; cancelRef.current = false
    setProcessing(true); setDone(false); setPaused(false)
    setProgress(Math.round((successful.length / results.length) * 100))
    await runProcessLoop(failedUrls, successful)
    setProgress(100); setCurrentUrl(''); setProcessing(false); setPaused(false); setDone(true)
  }

  function handlePause()  { pauseRef.current = !pauseRef.current; setPaused(pauseRef.current) }
  function handleCancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
    abortSearchRef.current?.abort()
    setSearching(false)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'estado']
    const csv = [headers.join(','), ...results.map(r => headers.map(h => h === 'estado' ? (r.ok ? 'ok' : 'error') : (r[h] || '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prospectos.csv'; a.click()
  }

  const alreadySent  = results.some(r => r.msg_status === 'sent' || r.msg_status === 'failed')
  const sentCount    = results.filter(r => r.msg_status === 'sent').length

  async function handleSendAll() {
    const targets = waRowsUnique.filter(r => effectiveWaSelected.has(r.company_id))
    if (!targets.length) return

    // Warn about already-contacted companies — MUI dialog
    const alreadyContacted = targets.filter(r => r.already_contacted?.contacted)
    if (alreadyContacted.length > 0) {
      const names = alreadyContacted.map(r => `${r.empresa} (${r.already_contacted.by_name || t.search.byAgent})`).join(', ')
      const confirmed = await new Promise(resolve =>
        setConfirmDialog({ open: true, names, resolve })
      )
      if (!confirmed) return
    }

    cancelRef.current = false
    setSendingAll(true)
    const updated = [...results]
    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current) break
      const row = targets[i]
      const idx = results.findIndex(r => r.url === row.url)
      try {
        const message = renderTemplate(msgText, row.scraped_data)
        const numbers = row.all_whatsapp?.length > 0 ? row.all_whatsapp : (row.whatsapp ? [row.whatsapp] : [])
        let lastStatus = 'failed'
        for (const num of numbers) {
          const res = await authFetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_id: row.company_id, to_number: num, message: message || msgText, website: row.url }),
          })
          const json = await res.json()
          if (json.status === 'sent') lastStatus = 'sent'
        }
        updated[idx] = { ...updated[idx], msg_status: lastStatus }
      } catch {
        updated[idx] = { ...updated[idx], msg_status: 'failed' }
      }
      setResults([...updated])
    }
    setSendingAll(false)
  }

  function exportUrlsTxt() {
    const text = found.filter(r => r.selected).map(r => r.url).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `urls-${industry || 'prospectos'}.txt`; a.click()
  }

  /* ── Selector de cantidad (reutilizable) ── */
  const CountSelector = ({ size = 'md' }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {size === 'md' && <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{t.search.showCount}</Typography>}
      {size === 'sm' && <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{t.search.show}</Typography>}
      <Box sx={{ display: 'flex', gap: size === 'md' ? 0.6 : 0.5 }}>
        {[5, 10, 20, 30].map(n => (
          <Box key={n} onClick={() => setNumResults(n)} sx={{
            px: size === 'md' ? 1.5 : 1.2, py: size === 'md' ? 0.4 : 0.3,
            borderRadius: 10, cursor: 'pointer', fontSize: size === 'md' ? '0.75rem' : '0.72rem', fontWeight: 700,
            bgcolor: numResults === n ? 'rgba(var(--accent-rgb, 59,130,246), 0.2)' : 'rgba(255,255,255,0.04)',
            color: numResults === n ? 'var(--accent, #60a5fa)' : 'rgba(255,255,255,0.28)',
            border: `1px solid ${numResults === n ? 'rgba(var(--accent-rgb, 59,130,246), 0.4)' : 'rgba(255,255,255,0.07)'}`,
            transition: 'all 0.15s',
            '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)', color: 'var(--accent, #93c5fd)' },
          }}>{n}</Box>
        ))}
      </Box>
    </Box>
  )

  /* ── Barra de búsqueda pill ── */
  const SearchBar = ({ compact }) => (
    <Box sx={{ position: 'relative', width: compact ? '100%' : { xs: '100%', sm: '580px' } }}>
      <Box sx={{
        display: 'flex', alignItems: 'center',
        bgcolor: 'var(--sidebar-bg, #0d1117)', borderRadius: '50px',
        boxShadow: compact ? '0 2px 8px rgba(0,0,0,0.3)' : '0 4px 28px rgba(0,0,0,0.55)',
        border: '1.5px solid rgba(var(--accent-rgb, 59,130,246), 0.22)',
        px: 2.5, py: 0.4,
        transition: 'box-shadow 0.2s, border-color 0.2s',
        '&:focus-within': { boxShadow: '0 6px 30px rgba(var(--accent-rgb, 59,130,246), 0.25)', borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.5)' },
        '&:hover': { borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.38)' },
      }}>
        <TravelExploreIcon sx={{ color: 'rgba(255,255,255,0.2)', fontSize: 18, mr: 1, flexShrink: 0 }} />
        <TextField
          fullWidth variant="standard"
          value={industry}
          onChange={e => { setIndustry(e.target.value); setAcOpen(true); setAcIdx(0) }}
          onBlur={() => setTimeout(() => setAcOpen(false), 150)}
          onFocus={() => acMatches.length > 0 && setAcOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Tab' && acMatches.length > 0) {
              e.preventDefault()
              const chosen = acMatches[acIdx]?.item
              if (chosen) { setIndustry(chosen); setAcOpen(false) }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault(); setAcIdx(i => Math.min(i + 1, acMatches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault(); setAcIdx(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              if (acOpen && acMatches.length > 0) {
                const chosen = acMatches[acIdx]?.item
                if (chosen) { setIndustry(chosen); setAcOpen(false); handleSearch(chosen); return }
              }
              setAcOpen(false); handleSearch()
            } else if (e.key === 'Escape') {
              setAcOpen(false)
            }
          }}
          placeholder={placeholder || 'Ej: Restaurantes, Ferreterías…'}
          slotProps={{ input: { disableUnderline: true } }}
          sx={{ '& input': { fontSize: compact ? '0.92rem' : '1rem', py: 0.9, color: '#f1f5f9', '&::placeholder': { color: 'rgba(255,255,255,0.28)', opacity: 1 } } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: -1, flexShrink: 0 }}>
          <IconButton onClick={handleSearch} disabled={searching || !industry.trim()} sx={{ bgcolor: 'var(--accent, #3b82f6)', color: 'white', width: 38, height: 38, '&:hover': { bgcolor: 'var(--accent, #2563eb)' }, '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.25)', color: 'rgba(255,255,255,0.3)' } }}>
            {searching ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SearchIcon fontSize="small" />}
          </IconButton>
          {searching && (
            <Tooltip title="Cancelar búsqueda">
              <IconButton onClick={handleCancel} sx={{
                bgcolor: 'rgba(239,68,68,0.12)', color: 'rgba(248,113,113,0.8)', width: 38, height: 38,
                border: '1px solid rgba(239,68,68,0.2)',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.25)', color: '#f87171' },
              }}>
                <HighlightOffIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      {acOpen && acMatches.length > 0 && (
        <Box sx={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, bgcolor: 'var(--sidebar-bg, #0d1117)', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.28)', borderRadius: 2, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,0.6)' }}>
          {acMatches.slice(0, 6).map(({ item, color }, i) => (
            <Box key={item} onMouseDown={() => { setIndustry(item); setAcOpen(false); handleSearch(item) }} onMouseEnter={() => setAcIdx(i)}
              sx={{ px: 2, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, bgcolor: i === acIdx ? 'rgba(var(--accent-rgb, 59,130,246), 0.1)' : 'transparent', transition: 'all 0.1s' }}>
              <Box component="span" sx={{ fontSize: '0.85rem' }}>
                <Box component="span" sx={{ color: 'rgba(255,255,255,0.35)' }}>{industry}</Box>
                <Box component="span" sx={{ color: i === acIdx ? color : 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{item.slice(industry.length)}</Box>
              </Box>
              {i === 0 && <Box sx={{ ml: 'auto', px: 0.8, py: 0.2, borderRadius: 0.8, bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', fontSize: '0.65rem', fontFamily: 'monospace', flexShrink: 0 }}>Tab</Box>}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>

      {/* Modal de confirmación — empresas ya contactadas */}
      <Dialog open={confirmDialog.open} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#161d2e)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3 } } }}>
        <DialogContent sx={{ pt: 3, bgcolor: 'var(--card-bg,#161d2e)' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
            <Box sx={{ width: 38, height: 38, borderRadius: '50%', bgcolor: 'rgba(251,191,36,0.15)', border: '1.5px solid rgba(251,191,36,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ fontSize: '1.1rem' }}>⚠️</Typography>
            </Box>
            <Box>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', mb: 0.5 }}>
                {t.search.alreadyWarning}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                {confirmDialog.names}
              </Typography>
            </Box>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem' }}>
            {t.search.askSendAnyway}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2.5, gap: 1, bgcolor: 'var(--card-bg,#161d2e)' }}>
          <Box onClick={() => { setConfirmDialog(d => ({ ...d, open: false })); confirmDialog.resolve?.(false) }}
            sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem' }}>{t.common.cancel}</Typography>
          </Box>
          <Box onClick={() => { setConfirmDialog(d => ({ ...d, open: false })); confirmDialog.resolve?.(true) }}
            sx={{ px: 2, py: 0.7, borderRadius: 2, cursor: 'pointer', bgcolor: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', '&:hover': { bgcolor: 'rgba(251,191,36,0.2)' } }}>
            <Typography sx={{ color: '#facc15', fontWeight: 700, fontSize: '0.82rem' }}>{t.search.sendAnyway}</Typography>
          </Box>
        </DialogActions>
      </Dialog>

      {/* ── Estado inicial: centrado ── */}
      {!hasResults && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 2.5, pb: 4 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.35rem', mb: 0.5 }}>{t.search.heading}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem' }}>{t.search.headingSub}</Typography>
          </Box>

          {SearchBar({ compact: false })}
          {CountSelector({ size: 'md' })}

          {/* Historial reciente */}
          {history.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: '580px' } }}>
              <HistoryIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.68rem' }}>Recientes:</Typography>
              {history.map(h => (
                <Box key={h} onClick={() => { setIndustry(h); handleSearch(h) }}
                  sx={{ px: 1.2, py: 0.3, borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', transition: 'all 0.15s', '&:hover': { color: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.1)', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)' } }}>
                  {h}
                </Box>
              ))}
            </Box>
          )}

          {/* Grid de industrias */}
          <Box sx={{ width: { xs: '100%', sm: '580px' }, overflowY: 'auto', maxHeight: 320 }}>
            {INDUSTRY_GROUPS.map(group => (
              <Box key={group.label} sx={{ mb: 1.8 }}>
                <Typography sx={{ color: group.color, fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', mb: 0.7, opacity: 0.7 }}>{group.label}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                  {group.items.map(item => (
                    <Box key={item} onClick={() => { setIndustry(item); handleSearch(item) }}
                      sx={{ px: 1.6, py: 0.55, borderRadius: '20px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 500, bgcolor: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.08)', transition: 'all 0.15s', '&:hover': { bgcolor: `${group.color}18`, color: group.color, border: `1px solid ${group.color}44` } }}>
                      {item}
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Barra compacta cuando hay resultados ── */}
      {hasResults && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.07)', bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
          {SearchBar({ compact: true })}
          {CountSelector({ size: 'sm' })}
        </Box>
      )}

      {/* ── Skeleton de carga ── */}
      {searching && (
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5 }}>
            <Skeleton variant="circular" width={18} height={18} sx={{ bgcolor: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
            <Skeleton variant="text" width={160} height={14} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />
          </Box>
          <Box sx={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', flexGrow: 1 }}>
            {[72, 58, 83, 65, 77, 54, 69, 80, 61, 75].slice(0, Math.min(numResults, 8)).map((w, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.3, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <Skeleton variant="circular" width={16} height={16} sx={{ bgcolor: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
                <Skeleton variant="circular" width={16} height={16} sx={{ bgcolor: 'rgba(255,255,255,0.05)', flexShrink: 0 }} />
                <Skeleton variant="text" width={`${w}%`} height={14} sx={{ bgcolor: 'rgba(255,255,255,0.05)', flexGrow: 1 }} />
                <Skeleton variant="rounded" width={54} height={16} sx={{ bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 10, flexShrink: 0 }} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Lista de URLs encontradas ── */}
      {found.length > 0 && !processing && !done && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, minHeight: 0 }}>

          {/* Banner resumen */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>
              <Box component="span" sx={{ color: '#f1f5f9', fontWeight: 700 }}>{found.length}</Box> encontradas
            </Typography>
            <Box sx={{ width: 1, height: 12, bgcolor: 'rgba(255,255,255,0.08)' }} />
            <Typography sx={{ fontSize: '0.75rem', color: '#4ade80' }}>
              <Box component="span" sx={{ fontWeight: 700 }}>{newCount}</Box> nuevas
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: '#fbbf24' }}>
              <Box component="span" sx={{ fontWeight: 700 }}>{scrapedCount}</Box> ya en BD
            </Typography>
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
              <Tooltip title={selectedCount === 0 ? 'Selecciona al menos una empresa para exportar' : 'Exportar URLs seleccionadas como .txt'} placement="top">
                <span>
                  <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 13 }} />} onClick={exportUrlsTxt} disabled={selectedCount === 0}
                    sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1.5, px: 1.2, py: 0.3, textTransform: 'none', minWidth: 0, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' }, '&.Mui-disabled': { opacity: 0.35 } }}>
                    Exportar URLs
                  </Button>
                </span>
              </Tooltip>
              {results.length > 0 && (
                <Tooltip title="Exportar empresa, teléfono y datos extraídos como .csv" placement="top">
                  <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 13 }} />} onClick={downloadCsv}
                    sx={{ color: '#4ade80', fontSize: '0.7rem', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 1.5, px: 1.2, py: 0.3, textTransform: 'none', minWidth: 0, bgcolor: 'rgba(34,197,94,0.08)', '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                    Exportar resultados
                  </Button>
                </Tooltip>
              )}
            </Box>
          </Box>

          {/* Barra de acciones */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Tooltip title={newCount === 0 ? 'No hay empresas nuevas para seleccionar' : 'Seleccionar / deseleccionar todas las nuevas'} placement="top">
                <span>
                  <Checkbox size="small" checked={allSelected} indeterminate={processableCount > 0 && !allSelected}
                    disabled={newCount === 0}
                    onChange={e => toggleAll(e.target.checked)}
                    sx={{ color: 'rgba(255,255,255,0.3)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' }, p: 0.5 }} />
                </span>
              </Tooltip>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>
                {processableCount > 0 ? `${processableCount} nuevas` : '0'} de {found.length}
                {skippedCount > 0 && (
                  <Box component="span" sx={{ color: '#fbbf24', ml: 0.8 }}>· {skippedCount} ya en BD</Box>
                )}
              </Typography>

              {/* Selección rápida */}
              <Tooltip title="Marcar solo las empresas que aún no has visitado" placement="top">
                <Box onClick={selectOnlyNew} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#4ade80', bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                  <CheckBoxIcon sx={{ fontSize: 12 }} /> Sel. nuevas
                </Box>
              </Tooltip>
              <Tooltip title="Desmarcar empresas que ya están en la base de datos" placement="top">
                <Box onClick={deselectScraped} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
                  <IndeterminateCheckBoxIcon sx={{ fontSize: 12 }} /> Desel. en BD
                </Box>
              </Tooltip>

              {/* Filtros */}
              {[
                { key: 'all',     label: `Todas (${found.length})`,        color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' },
                { key: 'new',     label: `Nuevas (${newCount})`,            color: '#4ade80', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)'  },
                { key: 'scraped', label: `Ya en BD (${scrapedCount})`,      color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
              ].map(f => (
                <Chip key={f.key} label={f.label} size="small" onClick={() => setFilterScraped(f.key)}
                  sx={{ height: 22, fontSize: '0.68rem', cursor: 'pointer', bgcolor: filterScraped === f.key ? f.bg : 'rgba(255,255,255,0.04)', color: filterScraped === f.key ? f.color : 'rgba(255,255,255,0.35)', border: `1px solid ${filterScraped === f.key ? f.border : 'rgba(255,255,255,0.08)'}`, transition: 'all 0.15s', '&:hover': { bgcolor: f.bg, color: f.color } }} />
              ))}
            </Box>

            <Tooltip title={skippedCount > 0 ? `${skippedCount} ya en BD se saltarán automáticamente` : ''} placement="top">
              <span>
                <Button variant="contained" onClick={handleProcess} disabled={processableCount === 0} startIcon={<PlayArrowIcon />}
                  sx={{ bgcolor: 'var(--accent, #3b82f6)', fontWeight: 600, textTransform: 'none', px: 2, py: 0.8, borderRadius: 1.5, fontSize: '0.85rem', '&:hover': { bgcolor: 'var(--accent, #2563eb)' }, '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.15)', color: 'rgba(255,255,255,0.3)' } }}>
                  Procesar {processableCount > 0 ? processableCount : ''} nueva{processableCount !== 1 ? 's' : ''}
                  {skippedCount > 0 && ` (omitiendo ${skippedCount})`}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {/* Lista URL con favicon + dominio */}
          <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2 }}>
            {visibleFound.map((item) => {
              const realIdx = found.indexOf(item)
              const domain = getDomain(item.url)
              return (
                <Box key={realIdx} onClick={() => toggleOne(realIdx)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.1, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', bgcolor: item.selected ? 'rgba(var(--accent-rgb, 59,130,246), 0.05)' : 'transparent', '&:hover': { bgcolor: item.selected ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)' : 'rgba(255,255,255,0.02)' }, '&:last-of-type': { borderBottom: 'none' }, transition: 'background-color 0.15s', animation: `${fadeSlideIn} 0.22s ease both`, animationDelay: `${realIdx * 0.025}s` }}>
                  <Checkbox size="small" checked={item.selected} onChange={() => toggleOne(realIdx)} onClick={e => e.stopPropagation()}
                    sx={{ color: 'rgba(255,255,255,0.25)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' }, p: 0.5, flexShrink: 0 }} />
                  {/* Favicon */}
                  <Box component="img"
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    width={16} height={16}
                    sx={{ borderRadius: 0.5, flexShrink: 0, opacity: item.scraped ? 0.4 : 0.8 }}
                    onError={e => { e.target.style.display = 'none' }}
                  />
                  {/* Dominio + URL completa al hover */}
                  <Tooltip title={item.url} placement="top" arrow>
                    <Typography component="a" href={item.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                      sx={{ fontSize: '0.82rem', fontWeight: item.scraped ? 400 : 500, color: item.scraped ? 'rgba(255,255,255,0.28)' : item.selected ? 'var(--accent, #60a5fa)' : 'rgba(255,255,255,0.55)', textDecoration: 'none', flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
                      {domain}
                    </Typography>
                  </Tooltip>
                  {item.scraped
                    ? <Chip label="Visitada" size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', flexShrink: 0 }} />
                    : <Chip label="Nuevo"    size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(34,197,94,0.1)',  color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)',  flexShrink: 0 }} />
                  }
                </Box>
              )
            })}
            {visibleCount < found.length && (
              <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <Button size="small" onClick={handleLoadMore}
                  sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.78rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.2)', borderRadius: 1.5, px: 2, textTransform: 'none', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)' } }}>
                  Mostrar {Math.min(numResults, found.length - visibleCount)} más ({found.length - visibleCount} restantes)
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Progress (fase 2) ── */}
      {processing && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ px: 2.5, py: 2, bgcolor: paused ? 'rgba(251,191,36,0.05)' : 'rgba(var(--accent-rgb, 59,130,246), 0.05)', border: `1px solid ${paused ? 'rgba(251,191,36,0.2)' : 'rgba(var(--accent-rgb, 59,130,246), 0.15)'}`, borderRadius: 2, transition: 'all 0.3s' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {paused ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} /> : <CircularProgress size={14} sx={{ color: 'var(--accent, #3b82f6)' }} />}
                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                  {paused ? 'Pausado —' : 'Procesando'} {results.length} de {found.filter(r => r.selected).length}
                </Typography>
              </Box>
              <Typography sx={{ color: paused ? '#fbbf24' : 'var(--accent, #60a5fa)', fontWeight: 700, fontSize: '0.82rem' }}>{progress}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={progress}
              sx={{ borderRadius: 4, height: 6, bgcolor: paused ? 'rgba(251,191,36,0.1)' : 'rgba(var(--accent-rgb, 59,130,246), 0.1)', '& .MuiLinearProgress-bar': { background: paused ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg, var(--accent, #3b82f6), var(--accent, #60a5fa))', borderRadius: 4 } }} />
            {currentUrl && !paused && (
              <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUrl}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button fullWidth onClick={handlePause} startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
              sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
              {paused ? 'Reanudar' : 'Pausar'}
            </Button>
            <Button fullWidth onClick={handleCancel} startIcon={<HighlightOffIcon />}
              sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' } }}>
              Cancelar
            </Button>
          </Box>
        </Box>
      )}

      {/* ── Stat cards ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {[
            { icon: <CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />, label: 'Procesadas',    value: okCount,  color: '#4ade80', bg: 'rgba(34,197,94,0.06)',   border: 'rgba(34,197,94,0.18)'  },
            { icon: <WhatsAppIcon    sx={{ fontSize: 16, color: '#60a5fa' }} />, label: 'Con WhatsApp', value: waCount,  color: '#60a5fa', bg: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.18)' },
            { icon: <ErrorIcon       sx={{ fontSize: 16, color: '#f87171' }} />, label: 'Errores',      value: errCount, color: '#f87171', bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.18)'  },
          ].map(c => (
            <Box key={c.label} sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, bgcolor: c.bg, border: `1px solid ${c.border}`, borderRadius: 2 }}>
              <Box sx={{ width: 32, height: 32, flexShrink: 0, bgcolor: `${c.color}22`, border: `1px solid ${c.color}44`, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.icon}</Box>
              <Box>
                <Typography sx={{ color: c.color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>{c.value}</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>{c.label}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Panel de envío masivo ── */}
      {done && results.length > 0 && (
        <Box sx={{ p: 2, borderRadius: 2, border: '1px solid rgba(34,197,94,0.15)', bgcolor: 'rgba(34,197,94,0.03)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MessageIcon sx={{ fontSize: 16, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>Enviar mensajes</Typography>
            </Box>
            {waRowsUnique.length > 0 && (
              <Chip icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />} label={`${waRowsUnique.length} con WhatsApp`} size="small"
                sx={{ fontSize: '0.7rem', height: 22, bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', '& .MuiChip-icon': { color: '#4ade80' } }} />
            )}
          </Box>
          {/* Selector de destinatarios WhatsApp */}
          {waRowsUnique.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.8 }}>
                <Checkbox size="small"
                  checked={waRowsUnique.every(r => effectiveWaSelected.has(r.company_id))}
                  indeterminate={waRowsUnique.some(r => effectiveWaSelected.has(r.company_id)) && !waRowsUnique.every(r => effectiveWaSelected.has(r.company_id))}
                  onChange={e => setWaDeselected(e.target.checked ? new Set() : new Set(waRowsUnique.map(r => r.company_id)))}
                  sx={{ color: 'rgba(255,255,255,0.25)', '&.Mui-checked': { color: '#4ade80' }, '&.MuiCheckbox-indeterminate': { color: '#4ade80' }, p: 0.5 }} />
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  {t.search.recipients} — {effectiveWaSelected.size} {t.search.of} {waRowsUnique.length} {t.search.selectedLabel}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, maxHeight: 90, overflowY: 'auto',
                scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
                {waRowsUnique.map(r => {
                  const on = effectiveWaSelected.has(r.company_id)
                  return (
                    <Chip key={r.company_id} size="small"
                      icon={<WhatsAppIcon sx={{ fontSize: '12px !important', color: on ? '#4ade80 !important' : 'rgba(255,255,255,0.25) !important' }} />}
                      label={r.empresa || r.url}
                      onClick={() => setWaDeselected(prev => {
                        const next = new Set(prev)
                        on ? next.add(r.company_id) : next.delete(r.company_id)
                        return next
                      })}
                      sx={{
                        height: 22, fontSize: '0.7rem', cursor: 'pointer',
                        bgcolor: on ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
                        color:   on ? '#4ade80'              : 'rgba(255,255,255,0.3)',
                        border: `1px solid ${on ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                        textDecoration: on ? 'none' : 'line-through',
                        '& .MuiChip-label': { px: 0.8 },
                        transition: 'all 0.15s',
                      }} />
                  )
                })}
              </Box>
            </Box>
          )}

          <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Plantilla base</Typography>
          <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 1.5 }}>
            {TEMPLATES.map(t => (
              <Chip key={t.id} label={t.label} size="small" onClick={() => {
                setSelectedTpl(t.id)
                const el = msgRef.current
                if (el) { el.value = t.text; el.dispatchEvent(new Event('input', { bubbles: true })) }
              }} sx={{
                fontSize: '0.7rem', height: 24, cursor: 'pointer',
                bgcolor: selectedTpl === t.id ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.04)',
                color:   selectedTpl === t.id ? '#4ade80' : 'rgba(255,255,255,0.45)',
                border:  `1px solid ${selectedTpl === t.id ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
              }} />
            ))}
          </Box>
          {/* Variable chips */}
          <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 1 }}>
            {[['{{nombre}}','#818cf8'],['{{ciudad}}','#38bdf8'],['{{industria}}','#fb923c'],['{{web}}','#a78bfa']].map(([v, color]) => (
              <Box key={v} onClick={() => {
                const el = msgRef.current; if (!el) return
                el.setRangeText(v, el.selectionStart, el.selectionEnd, 'end')
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.focus()
              }} sx={{
                px: 1, py: 0.25, borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
                cursor: 'pointer', userSelect: 'none', fontFamily: 'monospace',
                bgcolor: `${color}18`, color, border: `1px solid ${color}40`,
                '&:hover': { bgcolor: `${color}30` },
              }}>{v}</Box>
            ))}
            <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', alignSelf: 'center', ml: 0.5 }}>
              clic para insertar
            </Typography>
          </Box>
          {/* Textarea editable — uncontrolled so native Ctrl+Z works */}
          <Box component="textarea" ref={msgRef} defaultValue={msgText} onInput={e => setMsgText(e.target.value)}
            sx={{
              width: '100%', minHeight: 100, maxHeight: 200, resize: 'vertical',
              bgcolor: 'var(--sidebar-bg, #0d1117)', color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1.5,
              p: 1.5, fontSize: '0.8rem', lineHeight: 1.6, fontFamily: 'inherit',
              outline: 'none', mb: 0.5,
              '&:focus': { borderColor: 'rgba(34,197,94,0.4)' },
            }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', color: msgText.length > 4000 ? '#f87171' : 'rgba(255,255,255,0.2)' }}>
              {msgText.length} / 4096
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}>
            {sendingAll && (
              <Tooltip title="Cancelar envío">
                <IconButton size="small" onClick={handleCancel}
                  sx={{ color: 'rgba(248,113,113,0.7)', '&:hover': { color: '#f87171' } }}>
                  <HighlightOffIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <Button
              onClick={handleSendAll}
              disabled={effectiveWaSelected.size === 0 || alreadySent || sendingAll}
              startIcon={sendingAll ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 14 }} />}
              size="small"
              sx={{
                fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
                bgcolor: waRowsUnique.length > 0 && !alreadySent && !sendingAll ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                color:   waRowsUnique.length > 0 && !alreadySent && !sendingAll ? '#4ade80' : 'rgba(255,255,255,0.3)',
                border:  `1px solid ${waRowsUnique.length > 0 && !alreadySent && !sendingAll ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 1.5, px: 2, py: 0.6,
                '&:hover': { bgcolor: waRowsUnique.length > 0 && !alreadySent && !sendingAll ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.04)' },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
              }}
            >
              {alreadySent ? `${sentCount} ${t.search.sentCount}` : sendingAll ? t.single.sending : `${t.search.sendButton} ${effectiveWaSelected.size} ${t.search.companies}`}
            </Button>
          </Box>
        </Box>
      )}

      {/* ── Tarjetas de resultados ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, minHeight: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: 0.5 }}>RESULTADOS</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {done && errCount > 0 && (
                <Button size="small" startIcon={<ReplayIcon sx={{ fontSize: 14 }} />} onClick={handleRetryFailed}
                  sx={{ color: '#f87171', fontSize: '0.75rem', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}>
                  Reintentar {errCount} fallidas
                </Button>
              )}
              {done && (
                <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 14 }} />} onClick={downloadCsv}
                  sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.75rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)' } }}>
                  Descargar CSV
                </Button>
              )}
            </Box>
          </Box>

          <Box sx={{ overflowY: 'auto', flexGrow: 1, minHeight: 0 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5, pb: 1 }}>
              {results.map((r, i) => {
                const domain = getDomain(r.url)
                return (
                  <Box key={i}
                    sx={{ p: 1.8, borderRadius: 2, border: `1px solid ${r.ok ? 'rgba(255,255,255,0.07)' : 'rgba(239,68,68,0.2)'}`, bgcolor: r.ok ? 'rgba(255,255,255,0.02)' : 'rgba(239,68,68,0.04)', display: 'flex', flexDirection: 'column', gap: 1, animation: `${fadeSlideIn} 0.25s ease both`, animationDelay: `${i * 0.03}s` }}>
                    {/* Header */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Box component="img"
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                        width={18} height={18}
                        sx={{ borderRadius: 0.5, flexShrink: 0, mt: 0.2 }}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ color: r.ok ? 'rgba(255,255,255,0.9)' : '#f87171', fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                          {r.empresa !== '—' ? r.empresa : domain}
                        </Typography>
                        <Typography component="a" href={r.url} target="_blank" rel="noopener"
                          sx={{ fontSize: '0.7rem', color: '#60a5fa', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                          {domain}
                        </Typography>
                      </Box>
                      <Chip label={r.ok ? 'OK' : 'Error'} size="small"
                        icon={r.ok ? <CheckCircleIcon sx={{ fontSize: '11px !important' }} /> : <ErrorIcon sx={{ fontSize: '11px !important' }} />}
                        sx={{ height: 20, fontSize: '0.62rem', flexShrink: 0, bgcolor: r.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: r.ok ? '#4ade80' : '#f87171', border: `1px solid ${r.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, '& .MuiChip-icon': { color: 'inherit' } }} />
                    </Box>
                    {/* Info */}
                    <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                      {r.industria !== '—' && (
                        <Chip label={r.industria} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }} />
                      )}
                      {r.whatsapp && (
                        <Chip icon={<WhatsAppIcon sx={{ fontSize: '11px !important' }} />} label={r.whatsapp} size="small"
                          sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: '#4ade80' } }} />
                      )}
                      {!r.whatsapp && r.ok && (
                        <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', alignSelf: 'center' }}>Sin WhatsApp</Typography>
                      )}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
