'use client'
import { useState, useRef, useEffect } from 'react'
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
import StopIcon from '@mui/icons-material/Stop'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import DownloadIcon from '@mui/icons-material/Download'
import ReplayIcon from '@mui/icons-material/Replay'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox'
import HistoryIcon from '@mui/icons-material/History'

const INDUSTRY_GROUPS = [
  { label: 'Alimentos',     color: '#f97316', items: ['Restaurantes', 'Taquerías', 'Panaderías', 'Cafeterías', 'Catering'] },
  { label: 'Salud',         color: '#22c55e', items: ['Dentistas', 'Clínicas', 'Farmacias', 'Veterinarias', 'Gimnasios'] },
  { label: 'Belleza',       color: '#ec4899', items: ['Estéticas', 'Spas', 'Peluquerías', 'Salones de uñas'] },
  { label: 'Servicios',     color: '#60a5fa', items: ['Plomeros', 'Electricistas', 'Talleres mecánicos', 'Lavanderías', 'Mudanzas'] },
  { label: 'Comercio',      color: '#a78bfa', items: ['Ferreterías', 'Tiendas de ropa', 'Electrónica', 'Muebles', 'Abarrotes'] },
  { label: 'Profesionales', color: '#fbbf24', items: ['Abogados', 'Contadores', 'Arquitectos', 'Agencias inmobiliarias'] },
  { label: 'Educación',     color: '#34d399', items: ['Academias', 'Guarderías', 'Tutores', 'Escuelas de idiomas'] },
  { label: 'Hospedaje',     color: '#f87171', items: ['Hoteles', 'Hostales', 'Cabañas', 'Salones de eventos'] },
]

const INDUSTRY_EXAMPLES = ['Restaurantes en CDMX', 'Ferreterías en Guadalajara', 'Dentistas en Monterrey', 'Talleres mecánicos', 'Spas y estéticas', 'Hoteles boutique']

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

export default function SearchProspects() {
  const pauseRef  = useRef(false)
  const cancelRef = useRef(false)

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

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('searchHistory') || '[]')) } catch {}
  }, [])

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
  const selectedCount = found.filter(r => r.selected).length
  const allSelected   = found.length > 0 && found.every(r => r.selected)
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
    setSearching(true); setFound([]); setResults([]); setDone(false); setVisibleCount(numResults); setFilterScraped('all')
    try {
      const res = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: query, num_results: numResults, offset: 0 }),
      })
      if (!res.ok) throw new Error()
      const { urls } = await res.json()
      const marked = await fetchAndMark(urls)
      setFound(marked)
      saveHistory(query)
    } catch {
      setFound([])
    } finally {
      setSearching(false)
    }
  }

  function handleLoadMore() {
    setVisibleCount(c => Math.min(c + numResults, found.length))
  }

  function toggleAll(val) { setFound(f => f.map(r => ({ ...r, selected: val }))) }
  function toggleOne(i)   { setFound(f => f.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r)) }
  function selectOnlyNew()     { setFound(f => f.map(r => ({ ...r, selected: !r.scraped }))) }
  function deselectScraped()   { setFound(f => f.map(r => ({ ...r, selected: r.scraped ? false : r.selected }))) }

  async function runProcessLoop(urls, baseResults) {
    const res = [...baseResults]
    for (let i = 0; i < urls.length; i++) {
      while (pauseRef.current && !cancelRef.current) await new Promise(r => setTimeout(r, 200))
      if (cancelRef.current) break
      setCurrentUrl(urls[i])
      setProgress(Math.round(((baseResults.length + i) / (baseResults.length + urls.length)) * 100))
      try {
        const r = await fetch('/api/process-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i] }),
        })
        if (!r.ok) throw new Error()
        const d = await r.json()
        res.push({ url: urls[i], empresa: d.scraped?.name || '—', industria: d.scraped?.industry || '—', whatsapp: d.primary_whatsapp_number || '', status_wa: d.send_result?.status_code || '—', ok: true })
      } catch {
        res.push({ url: urls[i], empresa: '—', industria: '—', whatsapp: '', status_wa: '—', ok: false })
      }
      setResults([...res])
    }
    return res
  }

  async function handleProcess() {
    const urls = found.filter(r => r.selected).map(r => r.url)
    if (!urls.length) return
    pauseRef.current = false; cancelRef.current = false
    setResults([]); setProgress(0); setProcessing(true); setDone(false); setPaused(false)
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
  function handleCancel() { cancelRef.current = true; pauseRef.current = false; setPaused(false) }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'estado']
    const csv = [headers.join(','), ...results.map(r => headers.map(h => h === 'estado' ? (r.ok ? 'ok' : 'error') : (r[h] || '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prospectos.csv'; a.click()
  }

  function exportUrlsTxt() {
    const text = found.map(r => r.url).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `urls-${industry || 'prospectos'}.txt`; a.click()
  }

  /* ── Selector de cantidad (reutilizable) ── */
  const CountSelector = ({ size = 'md' }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {size === 'md' && <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>Resultados por búsqueda</Typography>}
      {size === 'sm' && <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>Resultados</Typography>}
      <Box sx={{ display: 'flex', gap: size === 'md' ? 0.6 : 0.5 }}>
        {[5, 10, 20, 30].map(n => (
          <Box key={n} onClick={() => setNumResults(n)} sx={{
            px: size === 'md' ? 1.5 : 1.2, py: size === 'md' ? 0.4 : 0.3,
            borderRadius: 10, cursor: 'pointer', fontSize: size === 'md' ? '0.75rem' : '0.72rem', fontWeight: 700,
            bgcolor: numResults === n ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.04)',
            color: numResults === n ? '#60a5fa' : 'rgba(255,255,255,0.28)',
            border: `1px solid ${numResults === n ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
            transition: 'all 0.15s',
            '&:hover': { bgcolor: 'rgba(59,130,246,0.12)', color: '#93c5fd' },
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
        bgcolor: '#0d1117', borderRadius: '50px',
        boxShadow: compact ? '0 2px 8px rgba(0,0,0,0.3)' : '0 4px 28px rgba(0,0,0,0.55)',
        border: '1.5px solid rgba(59,130,246,0.22)',
        px: 2.5, py: 0.4,
        transition: 'box-shadow 0.2s, border-color 0.2s',
        '&:focus-within': { boxShadow: '0 6px 30px rgba(59,130,246,0.25)', borderColor: 'rgba(59,130,246,0.5)' },
        '&:hover': { borderColor: 'rgba(59,130,246,0.38)' },
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
        <IconButton onClick={handleSearch} disabled={searching || !industry.trim()} sx={{ bgcolor: '#3b82f6', color: 'white', width: 38, height: 38, flexShrink: 0, mr: -1, '&:hover': { bgcolor: '#2563eb' }, '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.25)', color: 'rgba(255,255,255,0.3)' } }}>
          {searching ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SearchIcon fontSize="small" />}
        </IconButton>
      </Box>
      {acOpen && acMatches.length > 0 && (
        <Box sx={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, bgcolor: '#0d1117', border: '1px solid rgba(59,130,246,0.28)', borderRadius: 2, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,0.6)' }}>
          {acMatches.slice(0, 6).map(({ item, color }, i) => (
            <Box key={item} onMouseDown={() => { setIndustry(item); setAcOpen(false); handleSearch(item) }} onMouseEnter={() => setAcIdx(i)}
              sx={{ px: 2, py: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, bgcolor: i === acIdx ? 'rgba(59,130,246,0.1)' : 'transparent', transition: 'all 0.1s' }}>
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

      {/* ── Estado inicial: centrado ── */}
      {!hasResults && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 2.5, pb: 4 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.35rem', mb: 0.5 }}>¿Qué industria buscas hoy?</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem' }}>Busca prospectos por industria o elige una categoría</Typography>
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
                  sx={{ px: 1.2, py: 0.3, borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', transition: 'all 0.15s', '&:hover': { color: '#60a5fa', bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' } }}>
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(13,17,23,0.6)' }}>
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
              <Tooltip title="Exportar URLs como .txt" placement="top">
                <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 13 }} />} onClick={exportUrlsTxt}
                  sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1.5, px: 1.2, py: 0.3, textTransform: 'none', minWidth: 0, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' } }}>
                  Exportar lista
                </Button>
              </Tooltip>
            </Box>
          </Box>

          {/* Barra de acciones */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Checkbox size="small" checked={allSelected} indeterminate={selectedCount > 0 && !allSelected}
                onChange={e => toggleAll(e.target.checked)}
                sx={{ color: 'rgba(255,255,255,0.3)', '&.Mui-checked': { color: '#3b82f6' }, p: 0.5 }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>{selectedCount} de {found.length}</Typography>

              {/* Selección rápida */}
              <Tooltip title="Seleccionar solo nuevas" placement="top">
                <Box onClick={selectOnlyNew} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#4ade80', bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                  <CheckBoxIcon sx={{ fontSize: 12 }} /> Nuevas
                </Box>
              </Tooltip>
              <Tooltip title="Deseleccionar ya scrapeadas" placement="top">
                <Box onClick={deselectScraped} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
                  <IndeterminateCheckBoxIcon sx={{ fontSize: 12 }} /> Quitar BD
                </Box>
              </Tooltip>

              {/* Filtros */}
              {[
                { key: 'all',     label: `Todas (${found.length})`,      color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' },
                { key: 'new',     label: `Nuevas (${newCount})`,          color: '#4ade80', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)'  },
                { key: 'scraped', label: `En BD (${scrapedCount})`,       color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
              ].map(f => (
                <Chip key={f.key} label={f.label} size="small" onClick={() => setFilterScraped(f.key)}
                  sx={{ height: 22, fontSize: '0.68rem', cursor: 'pointer', bgcolor: filterScraped === f.key ? f.bg : 'rgba(255,255,255,0.04)', color: filterScraped === f.key ? f.color : 'rgba(255,255,255,0.35)', border: `1px solid ${filterScraped === f.key ? f.border : 'rgba(255,255,255,0.08)'}`, transition: 'all 0.15s', '&:hover': { bgcolor: f.bg, color: f.color } }} />
              ))}
            </Box>

            <Button variant="contained" onClick={handleProcess} disabled={selectedCount === 0} startIcon={<PlayArrowIcon />}
              sx={{ bgcolor: '#3b82f6', fontWeight: 600, textTransform: 'none', px: 2, py: 0.8, borderRadius: 1.5, fontSize: '0.85rem', '&:hover': { bgcolor: '#2563eb' }, '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.15)', color: 'rgba(255,255,255,0.3)' } }}>
              Procesar {selectedCount > 0 ? selectedCount : ''} seleccionadas
            </Button>
          </Box>

          {/* Lista URL con favicon + dominio */}
          <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2 }}>
            {visibleFound.map((item) => {
              const realIdx = found.indexOf(item)
              const domain = getDomain(item.url)
              return (
                <Box key={realIdx} onClick={() => toggleOne(realIdx)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.1, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', bgcolor: item.selected ? 'rgba(59,130,246,0.05)' : 'transparent', '&:hover': { bgcolor: item.selected ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.02)' }, '&:last-of-type': { borderBottom: 'none' }, transition: 'background-color 0.15s', animation: `${fadeSlideIn} 0.22s ease both`, animationDelay: `${realIdx * 0.025}s` }}>
                  <Checkbox size="small" checked={item.selected} onChange={() => toggleOne(realIdx)} onClick={e => e.stopPropagation()}
                    sx={{ color: 'rgba(255,255,255,0.25)', '&.Mui-checked': { color: '#3b82f6' }, p: 0.5, flexShrink: 0 }} />
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
                      sx={{ fontSize: '0.82rem', fontWeight: item.scraped ? 400 : 500, color: item.scraped ? 'rgba(255,255,255,0.28)' : item.selected ? '#60a5fa' : 'rgba(255,255,255,0.55)', textDecoration: 'none', flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
                      {domain}
                    </Typography>
                  </Tooltip>
                  {item.scraped
                    ? <Chip label="Ya en BD" size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', flexShrink: 0 }} />
                    : <Chip label="Nuevo"    size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(34,197,94,0.1)',  color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)',  flexShrink: 0 }} />
                  }
                </Box>
              )
            })}
            {visibleCount < found.length && (
              <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <Button size="small" onClick={handleLoadMore}
                  sx={{ color: '#60a5fa', fontSize: '0.78rem', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 1.5, px: 2, textTransform: 'none', '&:hover': { bgcolor: 'rgba(59,130,246,0.08)' } }}>
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
          <Box sx={{ px: 2.5, py: 2, bgcolor: paused ? 'rgba(251,191,36,0.05)' : 'rgba(59,130,246,0.05)', border: `1px solid ${paused ? 'rgba(251,191,36,0.2)' : 'rgba(59,130,246,0.15)'}`, borderRadius: 2, transition: 'all 0.3s' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {paused ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} /> : <CircularProgress size={14} sx={{ color: '#3b82f6' }} />}
                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                  {paused ? 'Pausado —' : 'Procesando'} {results.length} de {found.filter(r => r.selected).length}
                </Typography>
              </Box>
              <Typography sx={{ color: paused ? '#fbbf24' : '#60a5fa', fontWeight: 700, fontSize: '0.82rem' }}>{progress}%</Typography>
            </Box>
            <LinearProgress variant="determinate" value={progress}
              sx={{ borderRadius: 4, height: 6, bgcolor: paused ? 'rgba(251,191,36,0.1)' : 'rgba(59,130,246,0.1)', '& .MuiLinearProgress-bar': { background: paused ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#3b82f6,#60a5fa)', borderRadius: 4 } }} />
            {currentUrl && !paused && (
              <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUrl}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button fullWidth onClick={handlePause} startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
              sx={{ flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
              {paused ? 'Reanudar' : 'Pausar'}
            </Button>
            <Button fullWidth onClick={handleCancel} startIcon={<StopIcon />}
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
                  sx={{ color: '#60a5fa', fontSize: '0.75rem', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(59,130,246,0.08)' } }}>
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
