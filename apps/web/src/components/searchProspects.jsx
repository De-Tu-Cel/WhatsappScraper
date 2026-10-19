'use client'
import React from 'react'
import { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react'
import { useLang } from '../context/LangContext'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import { authFetch } from '@/lib/api'
import { useSendQueue } from '../context/SendQueueContext'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import WhatsAppNumberSummary from './WhatsAppNumberSummary'
import BulkSendPanel, { useBulkSendGuards, sendableNumbers } from './BulkSendPanel'
import { fitNewContacts } from '../lib/dailyCap'
import { dedupeByCompany } from '../lib/companyDedupe'
import { useScrapeJob } from '../hooks/useScrapeJob'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { keyframes } from '@mui/system'
import Box from '@mui/material/Box'
import ScrapeProgress from './ScrapeProgress'
import ScrapeSummary from './ScrapeSummary'
import Typography from '@mui/material/Typography'
import TablePagination from '@mui/material/TablePagination'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Divider from '@mui/material/Divider'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import LocalHospitalIcon from '@mui/icons-material/LocalHospital'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import BuildIcon from '@mui/icons-material/Build'
import StorefrontIcon from '@mui/icons-material/Storefront'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import SchoolIcon from '@mui/icons-material/School'
import HotelIcon from '@mui/icons-material/Hotel'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import ClearIcon from '@mui/icons-material/Clear'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import DownloadIcon from '@mui/icons-material/Download'
import ReplayIcon from '@mui/icons-material/Replay'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox'
import HistoryIcon from '@mui/icons-material/History'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import BlockIcon from '@mui/icons-material/Block'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TableContainer from '@mui/material/TableContainer'
import { pickMessageVariant } from '@/lib/messageVariants'
import { loadSendConfig } from '@/lib/sendConfig'
import CompanyAvatar from './CompanyAvatar'
import { ProspectSearchSkeleton, ScrapingPlaceholders } from './ProspectLoading'

// INDUSTRY_GROUPS and INDUSTRY_EXAMPLES are built inside the component from translations

const fadeSlideIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`

function CountSelector({ numResults, setNumResults, showCount, show, size = 'md', disabled = false }) {
  const { lang } = useLang()
  const [draft, setDraft] = useState(String(numResults))
  useEffect(() => { setDraft(String(numResults)) }, [numResults])
  function apply(raw) {
    const n = Number(raw)
    const value = String(raw).trim() && Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : numResults
    setNumResults(value)
    setDraft(String(value))
  }
  function step(delta) { apply((draft.trim() ? Number(draft) : numResults) + delta) }
  const value = draft.trim() ? Number(draft) : numResults
  return <Box data-prospect-quantity sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: '100%' }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
      <Box component="span" sx={{ fontWeight: 600, color: 'var(--text)' }}>{size === 'md' ? showCount : show}</Box>
      {size !== 'sm' && <Box component="span">1–200</Box>}
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
      <Box sx={{ display: size === 'sm' ? 'none' : 'flex', p: 0.4, gap: 0.4, bgcolor: 'var(--sidebar-bg)', border: '1px solid var(--border)', borderRadius: '11px' }}>
        {[25, 50, 100].map(preset => <Button key={preset} type="button" disabled={disabled} aria-pressed={preset === numResults}
          onClick={() => apply(preset)} sx={{ minWidth: 44, height: 34, px: 1.2, borderRadius: '8px', fontSize: '0.82rem',
            fontWeight: preset === numResults ? 800 : 500, color: 'var(--text)',
            border: '1px solid', borderColor: preset === numResults ? 'rgba(var(--accent-rgb),0.45)' : 'transparent',
            bgcolor: preset === numResults ? 'rgba(var(--accent-rgb),0.15)' : 'transparent' }}>{preset}</Button>)}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, p: 0.4, border: '1px solid var(--border)', borderRadius: '11px', bgcolor: 'var(--sidebar-bg)', '&:focus-within': { borderColor: 'var(--accent)' } }}>
        <IconButton type="button" aria-label={lang === 'en' ? 'Decrease quantity' : 'Disminuir cantidad'} disabled={disabled || value <= 1}
          onClick={() => step(-1)} sx={{ width: 34, height: 34, borderRadius: '8px', color: 'var(--text)', bgcolor: 'var(--item-hover)' }}><RemoveIcon sx={{ fontSize: 19 }} /></IconButton>
        <Box component="input" type="text" inputMode="numeric" role="spinbutton" aria-label={lang === 'en' ? 'Quantity' : 'Cantidad'}
          aria-valuemin={1} aria-valuemax={200} aria-valuenow={numResults} disabled={disabled} value={draft}
          onChange={e => setDraft(e.target.value.replace(/\D/g, ''))} onBlur={() => apply(draft)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); apply(draft) }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1) }
          }} sx={{ width: 52, minWidth: 0, p: 0, textAlign: 'center', border: 0, outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} />
        <IconButton type="button" aria-label={lang === 'en' ? 'Increase quantity' : 'Aumentar cantidad'} disabled={disabled || value >= 200}
          onClick={() => step(1)} sx={{ width: 34, height: 34, borderRadius: '8px', color: 'var(--text)', bgcolor: 'var(--item-hover)' }}><AddIcon sx={{ fontSize: 19 }} /></IconButton>
      </Box>
    </Box>
  </Box>
}

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', '') }
  catch { return url }
}

const MAPS_LEAD_URL = /^https:\/\/www\.google\.com\/maps\?cid=\d+$/

// Google Maps businesses with no website all share google.com as host — their
// own Maps link is what identifies them.
function resultKey(url) {
  return MAPS_LEAD_URL.test(url || '') ? url : getDomain(url)
}

// Estado de una fila ya procesada, en términos de lo que le importa a quien
// va a escribir: hay WhatsApp, solo teléfono, o nada. Reemplaza el "OK/Vacío"
// anterior, que miraba solo el WhatsApp "principal" y marcaba "Vacío" a
// empresas cuyo WhatsApp se confirmó verificando un teléfono.
function rowStatus(r, hasWa, en) {
  if (r.blacklisted) {
    const isDirectory = (r.blockReason || '').startsWith('directorio')
    return isDirectory
      ? { label: en ? 'Directory' : 'Directorio', color: '#f59e0b',
          tip: en ? `Looks like a listing of many businesses — ${r.blockReason}` : `Parece un listado de muchos negocios — ${r.blockReason}` }
      : { label: en ? 'Blocked' : 'Bloqueado', color: '#f59e0b',
          tip: r.blockKind === 'industry'
            ? (en ? `Blacklisted industry "${r.blockReason}" — not saved` : `Industria en blacklist «${r.blockReason}» — no se guardó`)
            : r.blockKind === 'domain'
              ? (en ? `Blacklisted domain "${r.blockReason}"` : `Dominio en blacklist «${r.blockReason}»`)
              : `Blacklist · "${r.blockReason || ''}"` }
  }
  if (!r.ok) return { label: 'Error', color: '#f87171', tip: r.errorReason || (en ? 'Scrape error' : 'Error al scrapear') }
  if (hasWa) return { label: en ? 'WhatsApp' : 'Con WhatsApp', color: '#4ade80' }
  if (r.no_website && r.wa_verified == null) {
    return { label: en ? 'To verify' : 'Por verificar', color: '#fbbf24',
      tip: en ? 'No connected WhatsApp session could check this phone yet' : 'Ninguna sesión de WhatsApp conectada pudo verificar este teléfono todavía' }
  }
  const phones = r.phones_count || (r.phone ? 1 : 0)
  if (phones > 0) {
    return { label: en ? 'Phone only' : 'Solo teléfono', color: '#60a5fa',
      tip: en ? `${phones} phone number(s), no WhatsApp detected` : `${phones} teléfono(s), sin WhatsApp detectado` }
  }
  return { label: en ? 'No contact' : 'Sin contacto', color: '#94a3b8',
    tip: en ? 'No phone or WhatsApp found' : 'No se encontró teléfono ni WhatsApp' }
}

// Job timestamps are naive UTC on the server; without a zone the browser would
// read them as local time and be off by the UTC offset.
function agoLabel(iso, lang) {
  if (!iso) return ''
  const s = String(iso)
  const t = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).getTime()
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000))
  const en = lang === 'en'
  if (mins < 1) return en ? 'just now' : 'justo ahora'
  if (mins < 60) return en ? `${mins} min ago` : `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return en ? `${hrs} h ago` : `hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  return en ? `${days} d ago` : `hace ${days} d`
}

function listedSiteLabel(url) {
  const host = getDomain(url || '').replace(/^m\./, '')
  if (host.endsWith('facebook.com') || host === 'fb.com') return 'Facebook'
  if (host.endsWith('instagram.com')) return 'Instagram'
  return null
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

const SearchBarForm = React.memo(function SearchBarForm({ allIndustries, searching, labels, onSearch, onCancel, compact, draft, onDraftChange, quantityControl }) {
  const { lang } = useLang()
  const industry = draft.industry
  const [acOpen, setAcOpen] = useState(false)
  const [acIdx, setAcIdx] = useState(0)
  const deferredIndustry = useDeferredValue(industry)
  const acMatches = useMemo(() => deferredIndustry.trim()
    ? allIndustries.filter(({ item }) => item.toLowerCase().startsWith(deferredIndustry.trim().toLowerCase()) && item.toLowerCase() !== deferredIndustry.trim().toLowerCase()).slice(0, 6)
    : [], [deferredIndustry, allIndustries])
  const setIndustry = value => onDraftChange(prev => ({ ...prev, industry: value }))
  function choose(value) { setIndustry(value); setAcOpen(false) }
  function submit(e) {
    e.preventDefault()
    if (searching || !industry.trim()) return
    setAcOpen(false)
    const city = draft.location.trim()
    onSearch(city ? `${industry.trim()} ${lang === 'en' ? 'in' : 'en'} ${city}` : industry.trim())
  }
  return <Box component="form" onSubmit={submit} aria-label={lang === 'en' ? 'Prospect search' : 'Buscar prospectos'}
    sx={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1.1fr) minmax(0, 0.8fr) auto auto' : { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.2fr) minmax(0, 0.85fr) auto' }, alignItems: 'end', gap: 1.5, width: '100%', ...(compact ? { '@container prospect-controls (max-width: 850px)': { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }, '@container prospect-controls (max-width: 480px)': { gridTemplateColumns: 'minmax(0, 1fr)' } } : {}) }}>
    <Box sx={{ position: 'relative', minWidth: 0 }}>
      <TextField id={compact ? 'prospect-industry-compact' : 'prospect-industry'} fullWidth size="small" disabled={searching}
        label={lang === 'en' ? 'Business or industry' : 'Negocio o industria'} placeholder={lang === 'en' ? 'E.g. gas suppliers, restaurants' : 'Ej. gaseras, restaurantes'}
        value={industry} onChange={e => { setIndustry(e.target.value); setAcOpen(true); setAcIdx(0) }}
        onBlur={() => setAcOpen(false)} onFocus={() => setAcOpen(true)}
        onKeyDown={e => {
          if ((e.key === 'Tab' || e.key === 'Enter') && acOpen && acMatches.length) {
            e.preventDefault(); choose(acMatches[acIdx]?.item || acMatches[0].item)
          } else if (e.key === 'ArrowDown' && acMatches.length) {
            e.preventDefault(); setAcOpen(true); setAcIdx(i => Math.min(i + 1, acMatches.length - 1))
          } else if (e.key === 'ArrowUp' && acMatches.length) {
            e.preventDefault(); setAcIdx(i => Math.max(0, i - 1))
          } else if (e.key === 'Escape') setAcOpen(false)
        }}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': acOpen && !!acMatches.length, 'aria-controls': acOpen && acMatches.length ? 'prospect-suggestions' : undefined, autoComplete: 'off' } }}
        sx={{ '& .MuiInputBase-root': { height: 48, borderRadius: '10px' } }} />
      {acOpen && acMatches.length > 0 && <Box id="prospect-suggestions" role="listbox" sx={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30, p: 0.5, bgcolor: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
        {acMatches.map(({ item }, i) => <Box component="button" type="button" role="option" aria-selected={i === acIdx} key={item}
          onMouseDown={e => e.preventDefault()} onClick={() => choose(item)} onMouseEnter={() => setAcIdx(i)}
          sx={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: '6px', p: 1.2, cursor: 'pointer', font: 'inherit', fontSize: '0.85rem', color: 'var(--text)', bgcolor: i === acIdx ? 'var(--item-hover)' : 'transparent' }}>{item}</Box>)}
      </Box>}
    </Box>
    <TextField id={compact ? 'prospect-location-compact' : 'prospect-location'} fullWidth size="small" disabled={searching}
      label={lang === 'en' ? 'City or area (optional)' : 'Ciudad o zona (opcional)'} placeholder={lang === 'en' ? 'E.g. Hermosillo, Sonora' : 'Ej. Hermosillo, Sonora'}
      value={draft.location} onChange={e => onDraftChange(prev => ({ ...prev, location: e.target.value }))}
      slotProps={{ inputLabel: { shrink: true } }} sx={{ '& .MuiInputBase-root': { height: 48, borderRadius: '10px' } }} />
    {quantityControl}
    <Button data-prospect-primary type={searching ? 'button' : 'submit'} variant="contained" disabled={!searching && !industry.trim()}
      onClick={searching ? onCancel : undefined} startIcon={searching ? <HighlightOffIcon /> : <SearchIcon />}
      sx={{ height: 48, px: 2.2, borderRadius: '10px', whiteSpace: 'nowrap' }}>
      {searching ? (lang === 'en' ? 'Searching… · Cancel' : 'Buscando… · Cancelar') : lang === 'en' ? 'Find prospects' : 'Buscar prospectos'}
    </Button>
  </Box>
})

// Preserve unchanged rows when appending another batch or updating search status.
const ProspectResultRow = React.memo(function ProspectResultRow({ item, realIdx, toggleOne, t, lang }) {
  const domain = getDomain(item.url)
  return (
    <Box key={realIdx} onClick={() => !item.blocked && toggleOne(realIdx)}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 1.5, pr: 2, py: 1.1, cursor: item.blocked ? 'not-allowed' : 'pointer', borderBottom: '1px solid var(--border)', borderLeft: item.blocked ? '3px solid rgba(239,68,68,0.4)' : item.scraped ? '3px solid rgba(251,191,36,0.35)' : '3px solid rgba(34,197,94,0.35)', opacity: item.blocked ? 0.6 : 1, bgcolor: item.selected ? 'rgba(var(--accent-rgb, 59,130,246), 0.05)' : 'transparent', '&:hover': { bgcolor: item.blocked ? 'transparent' : item.selected ? 'rgba(var(--accent-rgb, 59,130,246), 0.08)' : 'var(--item-hover)' }, '&:last-of-type': { borderBottom: 'none' }, transition: 'background-color 0.15s', animation: `${fadeSlideIn} 0.22s ease both`, animationDelay: `${Math.min(realIdx, 7) * 0.025}s` }}>
      <Checkbox size="small" checked={item.selected} disabled={item.blocked} onChange={() => toggleOne(realIdx)} onClick={e => e.stopPropagation()}
        sx={{ color: 'var(--text-muted)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' }, p: 0.5, flexShrink: 0 }} />
      {item.kind === 'maps' ? (() => {
        const l = item.lead
        const social = listedSiteLabel(l.listed_url)
        const meta = [l.category, l.rating ? `★ ${l.rating}${l.reviews ? ` (${l.reviews})` : ''}` : null, l.city].filter(Boolean).join(' · ')
        return (
          <>
            <CompanyAvatar key={item.url} photoUrl={l.photo_url} name={l.name} size={30} dimmed={item.scraped} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Tooltip title={l.address || item.url} placement="top" arrow>
                <Typography component="a" href={item.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                  sx={{ display: 'block', fontSize: '0.82rem', fontWeight: item.scraped ? 400 : 500, color: item.scraped ? 'var(--text-muted)' : item.selected ? 'var(--accent, #60a5fa)' : 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
                  {l.name}
                </Typography>
              </Tooltip>
              <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta}
              </Typography>
            </Box>
            <Tooltip placement="top" arrow title={social
              ? (lang === 'en' ? `Only has a ${social} page: ${l.listed_url}` : `Solo tiene página de ${social}: ${l.listed_url}`)
              : (lang === 'en' ? 'No website — data from Google Maps' : 'Sin sitio web — datos de Google Maps')}>
              <Chip label={social || (lang === 'en' ? 'No website' : 'Sin web')} size="small"
                sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(45,212,191,0.1)', color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.25)', flexShrink: 0 }} />
            </Tooltip>
          </>
        )
      })() : (<>
      {/* Favicon */}
      <Box component="img"
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        width={16} height={16}
        sx={{ borderRadius: 0.5, flexShrink: 0, opacity: item.scraped || item.blocked ? 0.4 : 0.8 }}
        onError={e => { e.target.style.display = 'none' }}
      />
      {/* Dominio + URL completa al hover */}
      <Tooltip title={item.blocked ? `🚫 ${t.search.tagBlockedTip} "${item.blockReason}" · ${item.url}` : item.url} placement="top" arrow>
        <Typography component="a" href={item.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
          sx={{ fontSize: '0.82rem', fontWeight: item.scraped ? 400 : 500, color: item.blocked ? 'var(--text-muted)' : item.scraped ? 'var(--text-muted)' : item.selected ? 'var(--accent, #60a5fa)' : 'var(--text)', textDecoration: 'none', flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
          {domain}
        </Typography>
      </Tooltip>
      </>)}
      {item.blocked
        ? <Chip label={t.search.tagBlocked} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', flexShrink: 0 }} />
        : item.scraped
        ? <Chip label={t.search.tagVisited} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', flexShrink: 0 }} />
        : <Chip label={t.search.tagNew}     size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: 'rgba(34,197,94,0.1)',  color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)',  flexShrink: 0 }} />
      }
    </Box>
  )
})


export default function SearchProspects() {
  const { t, lang } = useLang()
  const abortSearchRef = useRef(null)
  const scrapeJob = useScrapeJob('search')

  const [lastIndustry, setLastIndustry] = useState('')
  const [searchDraft, setSearchDraft] = useState({ industry: '', location: '' })
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [numResults,  setNumResults]  = useState(50)
  const [searching,    setSearching]    = useState(false)
  // false = no error. 'empty' = request succeeded, genuinely found nothing
  // (the "add a location" hint is useful here). 'failed' = the request itself
  // errored/timed out (seen live, 2026-10-02: a country-wide no-city search
  // can take 40-70s+ fanning out across many cities and sometimes fails
  // outright) — showing the SAME "add a location" hint for this case is
  // actively misleading, since the problem has nothing to do with the query.
  const [searchError,  setSearchError]  = useState(false)
  const [serviceWarnings, setServiceWarnings] = useState([])
  // The searched trade is on the industry blacklist (backend: blocked_industry) —
  // every result of that trade is discarded when processed, so say it up front.
  const [blockedIndustry, setBlockedIndustry] = useState(null)
  const [visibleCount, setVisibleCount] = useState(10)
  // Se fija una sola vez por búsqueda (a diferencia de visibleCount, que crece con
  // "Cargar más") — permite avisar cuando lo encontrado se queda corto de lo pedido,
  // ya que num_results no es un tope exacto en el backend (ver searcher.py).
  const [requestedCount, setRequestedCount] = useState(10)
  const [nextOffset,   setNextOffset]   = useState(0)
  const [serverExhausted, setServerExhausted] = useState(false)
  const [emptyBatches, setEmptyBatches] = useState(0)
  const [fetchingMore, setFetchingMore] = useState(false)
  const [found,         setFound]         = useState([])
  // El scraping en sí corre en el backend (useScrapeJob) — estos dos solo cubren
  // lo que el job no sabe: el estado optimista de envío por url (msg_status) y,
  // en "reintentar fallidas", las filas exitosas de la corrida anterior que un
  // job nuevo (solo con las fallidas) no traería de vuelta.
  const [sentOverlay, setSentOverlay] = useState({})
  const [retryBase,   setRetryBase]   = useState([])
  const [resultPage, setResultPage] = useState(0)
  const [resultPageSize, setResultPageSize] = useState(25)
  const [filterScraped,    setFilterScraped]    = useState('all')
  const [filterContacted,  setFilterContacted]  = useState('all') // 'all' | 'new' | 'contacted'
  const [history,     setHistory]     = useState([])
  const [extraVariants, setExtraVariants] = useState([])
  const [sendCfg,     setSendCfg]     = useState(() => loadSendConfig())
  const [sendError,   setSendError]   = useState('')
  const { addBatch, cancel: _cancelQueueRaw, active: queueActive, completedCount } = useSendQueue()
  const cancelledRef = useRef(false)
  const cancelQueue = useCallback(() => {
    cancelledRef.current = true
    _cancelQueueRaw()
  }, [_cancelQueueRaw])
  const { stats: capStats, refresh: refreshCapStats } = useDailyCapStats()
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const [waSelected, setWaSelected] = useState(new Set())
  // Números EXTRA (además del principal) que el usuario prendió a mano al
  // expandir el chip de una empresa — clave `${company_id}::${number}`.
  const [extraSelected, setExtraSelected] = useState(new Set())
  const [expandedCo, setExpandedCo] = useState(new Set())
  // Companies sent to in this session — augments already_contacted so a second
  // "Send All" from the same scrape warns about them even before the backend
  // scrape-result data is re-fetched (which only happens on a new job).
  // Numbers sent in this session: company_id → Set<number> — for real-time amber coloring
  // Fresh already_contacted data from the API — overrides stale scrape-job stamps
  // so "Ya contactados" count is accurate even after a page refresh.
  const [freshContactedMap, setFreshContactedMap] = useState({})
  const [confirmDialog, setConfirmDialog] = useState({ open: false, names: '', resolve: null }) // números que el usuario quitó manualmente
  const [newContactsDialog, setNewContactsDialog] = useState({ open: false, trimCount: 0, newRemaining: 0, resolve: null })
  const wasActiveRef = useRef(false)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('searchHistory') || '[]')) } catch {}
  }, [])

  // results = filas del job (backend) + base de un reintento previo (si aplica),
  // con el estado optimista de envío superpuesto por url.
  // Dedup by URL — the backend can push a URL twice on pause/resume; keep the last.
  const results = useMemo(() => {
    const merged = [...retryBase, ...scrapeJob.results]
    const seenUrl = new Map()
    for (const r of merged) seenUrl.set(r.url, r)  // last-wins per URL
    const deduped = Array.from(seenUrl.values())
    return sentOverlay && Object.keys(sentOverlay).length
      ? deduped.map(r => sentOverlay[r.url] ? { ...r, msg_status: sentOverlay[r.url] } : r)
      : deduped
  }, [retryBase, scrapeJob.results, sentOverlay])

  // Paginate only the rendered table. Counts, exports and sending use all results.
  const safeResultPage = Math.min(resultPage, Math.max(0, Math.ceil(results.length / resultPageSize) - 1))
  const pageResults = results.slice(safeResultPage * resultPageSize, (safeResultPage + 1) * resultPageSize)

  // Reset selection state only when a new scrape job starts — NOT on every
  // results update (polling/retry during a paused send would re-select everything).
  useEffect(() => {
    setResultPage(0)
    setWaSelected(new Set())
    setExtraSelected(new Set())
    setExpandedCo(new Set())
    setFreshContactedMap({})
  }, [scrapeJob.job?._id])

  useEffect(() => {
    if (queueActive !== null) {
      wasActiveRef.current = true
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false
      const wasCancelled = cancelledRef.current
      cancelledRef.current = false
      setSentOverlay(prev => {
        const next = { ...prev }
        for (const k in next) {
          if (next[k] === 'queued') {
            // On cancel: remove queued entries so those companies can be re-sent.
            // On natural completion: promote to 'sent'.
            if (wasCancelled) delete next[k]
            else next[k] = 'sent'
          }
        }
        return next
      })
      refreshCapStats()
    }
  }, [queueActive, refreshCapStats])

  // waRows y waRowsUnique deben ir ANTES de effectiveWaSelected
  const waRowsAll    = results.filter(r => r.ok && (r.all_whatsapp?.length > 0 || r.whatsapp) && r.company_id)
  // Queue acceptance is not delivery. Refresh confirmed contact state after completion.
  const waRowsUnique = useMemo(() =>
    dedupeByCompany(waRowsAll).map(r => ({
      ...r,
      already_contacted: freshContactedMap[r.company_id] ?? r.already_contacted ?? null,
    })),
  [waRowsAll, freshContactedMap])

  // ids como string estable — evita releer check-contacted en cada render solo
  // porque waRowsAll cambió de referencia (misma lista de companies, objeto nuevo).
  const waCompanyIdsKey = useMemo(() => waRowsAll.map(r => r.company_id).filter(Boolean).join(','), [waRowsAll])

  // Refresh already_contacted from the API so the count is fresh after
  // companies were contacted in a prior session (scrape-job stamps are stale).
  useEffect(() => {
    const ids = waRowsAll.map(r => r.company_id).filter(Boolean)
    if (!ids.length) return
    let cancelled = false
    authFetch('/api/companies/check-contacted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_ids: ids }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setFreshContactedMap(data) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waCompanyIdsKey])

  // Igual que arriba, pero disparado por completedCount (la señal real de "un
  // envío acaba de terminar", compartida por TODOS los flujos de envío de la
  // app) en vez de por cambios en la lista de company_id. Sin esto, contactar
  // un número desde OTRA pantalla (Send Campaign, Conversaciones) dejaba esta
  // tabla mostrando "no contactado" hasta que llegaba un scrape nuevo — el
  // mismo hueco que ya se corrigió en el picker de Send Campaign.
  useEffect(() => {
    if (completedCount === null) return
    const ids = waRowsAll.map(r => r.company_id).filter(Boolean)
    if (!ids.length) return
    let cancelled = false
    authFetch('/api/companies/check-contacted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_ids: ids }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setFreshContactedMap(data) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedCount])

  // Filtro de "ya contactados": se aplica sobre waRowsUnique antes de calcular la selección
  const filteredWaRows = useMemo(() => {
    if (filterContacted === 'all') return waRowsUnique
    if (filterContacted === 'contacted') return waRowsUnique.filter(r => r.already_contacted?.contacted)
    return waRowsUnique.filter(r => !r.already_contacted?.contacted)
  }, [waRowsUnique, filterContacted])

  // Siempre sincronizado — sin delay de un render
  const effectiveWaSelected = useMemo(() =>
    new Set(filteredWaRows.map(r => r.company_id).filter(id => waSelected.has(id))),
  [filteredWaRows, waSelected])

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

  const allIndustries = useMemo(
    () => INDUSTRY_GROUPS.flatMap(g => g.items.map(item => ({ item, color: g.color }))),
    [INDUSTRY_GROUPS]
  )

  const searchLabels = useMemo(() => ({
    cancelSearch: t.search.cancelSearch,
    examplePh: t.search.examplePhLocation,
    examples: INDUSTRY_EXAMPLES,
  }), [t, INDUSTRY_EXAMPLES])

  const visibleFound = found
    .filter(r => filterScraped === 'all' ? true : filterScraped === 'new' ? !r.scraped : filterScraped === 'maps' ? r.kind === 'maps' : r.scraped)
    .slice(0, visibleCount)
  const mapsCount = found.filter(r => r.kind === 'maps').length
  const selectedCount    = found.filter(r => r.selected).length
  const processableCount = found.filter(r => r.selected && !r.scraped && !r.blocked).length
  const skippedCount     = found.filter(r => r.selected && r.scraped).length
  const allSelected      = found.length > 0 && found.filter(r => !r.scraped && !r.blocked).every(r => r.selected) && found.some(r => !r.scraped && !r.blocked)
  const newCount      = found.filter(r => !r.scraped && !r.blocked).length
  const scrapedCount  = found.filter(r => r.scraped).length
  const blockedCount  = found.filter(r => r.blocked).length
  const okCount       = results.filter(r => r.ok).length
  const errCount      = results.filter(r => !r.ok).length
  const waCount       = results.filter(r => r.all_whatsapp?.length > 0 || !!r.whatsapp).length
  const hasResults    = found.length > 0 || scrapeJob.processing || scrapeJob.done || searching || searchError

  function saveHistory(query) {
    const next = [query, ...history.filter(h => h !== query)].slice(0, 6)
    setHistory(next)
    localStorage.setItem('searchHistory', JSON.stringify(next))
  }

  // mapsLeads: Google Maps businesses with no website — listed after the sites,
  // with the Maps data the backend needs to build them on "Procesar".
  async function fetchAndMark(siteUrls, blockedMap, mapsLeads = []) {
    const urls = [...siteUrls, ...mapsLeads.map(l => l.url)]
    const leadByUrl = Object.fromEntries(mapsLeads.map(l => [l.url, l]))
    const row = (url, scraped) => ({
      url, selected: false, scraped,
      blocked: !!blockedMap[url]?.blocked, blockReason: blockedMap[url]?.block_reason || null,
      ...(leadByUrl[url] ? { kind: 'maps', lead: leadByUrl[url] } : {}),
    })
    try {
      const r = await authFetch('/api/companies/check-urls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      const map = r.ok ? await r.json() : {}
      return urls.map(url => row(url, !!map[url]))
    } catch {
      return urls.map(url => row(url, false))
    }
  }

  async function handleSearch(industry) {
    const query = industry.trim()
    if (!query) return
    setLastIndustry(query)
    saveHistory(query)
    abortSearchRef.current?.abort()
    const ctrl = new AbortController()
    abortSearchRef.current = ctrl
    setSearching(true); setFound([]); setVisibleCount(numResults); setRequestedCount(numResults); setFilterScraped('all'); setFilterContacted('all'); setSearchError(false)
    setServerExhausted(false); setEmptyBatches(0); setNextOffset(0); setBlockedIndustry(null)
    setSentOverlay({}); setRetryBase([]); scrapeJob.reset()
    try {
      const res = await authFetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: query, num_results: numResults, offset: 0 }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error()
      const { urls, results: searchResults, next_offset, maps_leads = [], blocked_industry = null, service_warnings = [] } = await res.json()
      setServiceWarnings(service_warnings)
      window.dispatchEvent(new Event('service-health-refresh'))
      setBlockedIndustry(blocked_industry)
      const blockedMap = Object.fromEntries((searchResults || []).map(r => [r.url, r]))
      const marked = await fetchAndMark(urls, blockedMap, maps_leads)
      setFound(marked)
      setVisibleCount(Math.max(numResults, marked.length))
      setNextOffset(next_offset || 0)
      if (marked.length === 0) setSearchError(service_warnings.length ? 'partial' : 'empty')
    } catch (err) {
      if (err?.name !== 'AbortError') setSearchError('failed')
    } finally {
      setSearching(false)
    }
  }

  // "Cargar más": si ya hay resultados sin mostrar del lote traído, solo revela
  // más localmente (gratis, sin llamada al servidor). Cuando ya se mostró todo
  // el lote, sí vuelve a pedirle al backend la siguiente tanda (paginación real
  // sobre Bright Data — ver next_offset en /search), en vez de quedarse ahí.
  async function handleLoadMore() {
    if (visibleCount < found.length) {
      setVisibleCount(c => Math.min(c + numResults, found.length))
      return
    }
    if (fetchingMore || serverExhausted || !lastIndustry) return
    setFetchingMore(true)
    try {
      const alreadyShown = found.map(r => resultKey(r.url))
      const res = await authFetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: lastIndustry, num_results: numResults,
          offset: nextOffset, already_shown_domains: alreadyShown,
        }),
      })
      if (!res.ok) throw new Error()
      const { urls, results: searchResults, next_offset, maps_leads = [], service_warnings = [] } = await res.json()
      setServiceWarnings(service_warnings)
      window.dispatchEvent(new Event('service-health-refresh'))
      setNextOffset(next_offset || nextOffset)
      const blockedMap = Object.fromEntries((searchResults || []).map(r => [r.url, r]))
      const marked = await fetchAndMark(urls, blockedMap, maps_leads)
      const seen = new Set(alreadyShown)
      const fresh = marked.filter(m => !seen.has(resultKey(m.url)))
      if (fresh.length === 0) {
        // One empty batch may be all duplicates or one failed source.
        // Keep manual pagination available for up to three empty batches.
        setEmptyBatches(emptyBatches + 1)
        setServerExhausted(emptyBatches + 1 >= 3)
      } else {
        setEmptyBatches(0)
        setFound(prev => [...prev, ...fresh])
        setVisibleCount(vc => vc + fresh.length)
      }
    } catch {
      // silencioso — el botón sigue disponible para reintentar
    } finally {
      setFetchingMore(false)
    }
  }

  // "Select all" only selects new ones — scraped/blocked ones are never auto-selected
  function toggleAll(val) {
    setFound(f => f.map(r => ({ ...r, selected: val ? (!r.scraped && !r.blocked) : false })))
  }
  const toggleOne = useCallback(i => { setFound(f => f.map((r, idx) => idx === i && !r.blocked ? { ...r, selected: !r.selected } : r)) }, [])
  function selectOnlyNew()   { setFound(f => f.map(r => ({ ...r, selected: !r.scraped && !r.blocked }))) }
  function deselectScraped() { setFound(f => f.map(r => ({ ...r, selected: r.scraped ? false : r.selected }))) }

  // El loop de scraping ahora corre en el backend (backEnd/app/scrape_jobs.py) —
  // esto solo crea el job y lo deja al hook useScrapeJob hacer polling.
  async function handleProcess() {
    // Always skip already-scraped URLs regardless of selection state
    const toProcess = found.filter(r => r.selected && !r.scraped)
    const skipped   = found.filter(r => r.selected && r.scraped).length
    if (!toProcess.length) return
    const urls = toProcess.map(r => r.url)
    setSentOverlay({}); setRetryBase([])
    if (skipped > 0) console.info(`⏭️ Saltando ${skipped} URL(s) ya scrapeadas`)
    await scrapeJob.start(urls, toProcess.filter(r => r.lead).map(r => r.lead), lastIndustry)
  }

  async function handleRetryFailed() {
    const failedUrls = results.filter(r => !r.ok).map(r => r.url)
    if (!failedUrls.length) return
    setRetryBase(results.filter(r => r.ok))
    const failed = new Set(failedUrls)
    await scrapeJob.start(failedUrls, found.filter(r => r.lead && failed.has(r.url)).map(r => r.lead), scrapeJob.job?.query || lastIndustry)
  }

  // Clears the recovered results so the screen is ready for another search.
  function handleNewSearch() {
    scrapeJob.reset()
    setFound([]); setSentOverlay({}); setRetryBase([])
    setSearchError(false); setServerExhausted(false); setEmptyBatches(0); setNextOffset(0); setBlockedIndustry(null)
  }

  function handleCancelSearch() {
    abortSearchRef.current?.abort()
    setSearching(false)
    setSearchError(false)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'phone', 'status_wa', 'estado']
    const csv = [headers.join(','), ...results.map(r => headers.map(h => h === 'estado' ? (r.ok ? 'ok' : 'error') : (r[h] || '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prospectos.csv'; a.click()
  }

  // sentCids: companies whose messages are already processed in this session
  const sentCids = useMemo(
    () => new Set(results.filter(r => ['sent','queued','failed'].includes(r.msg_status)).map(r => r.company_id).filter(Boolean)),
    [results]
  )
  const sentCount = results.filter(r => r.msg_status === 'sent').length
  const isSending = queueActive !== null && results.some(r => r.msg_status === 'queued')
  // True only when every currently-selected company has already been sent — disables button
  const allSelectedSent = effectiveWaSelected.size > 0 && [...effectiveWaSelected].every(cid => sentCids.has(cid))
  // Count of selected companies NOT yet sent (what the send button will actually process)
  const unsentSelectedCount = useMemo(
    () => [...effectiveWaSelected].filter(cid => !sentCids.has(cid)).length,
    [effectiveWaSelected, sentCids]
  )

  // Selection math (contact points, new contacts, quota, minimum templates) —
  // shared with the other post-scrape screens, see BulkSendPanel.jsx.
  const guards = useBulkSendGuards({ waRows: waRowsUnique, selected: effectiveWaSelected, extraSelected, variants: extraVariants, capStats })
  const { totalContactPoints, capBlocked, allVariants, belowMinTemplates, noMessageSelected, selectedRows: _selectedRows } = guards
  const _contactedCids = new Set(waRowsUnique.filter(r => r.already_contacted?.contacted).map(r => r.company_id))

  // Variable availability: does at least one selected company have each field?
  const tplVarFlags = useMemo(() => ({
    hasName:     _selectedRows.some(r => r.name     || r.empresa),
    hasCity:     _selectedRows.some(r => r._extra?.city || r.city || r.ciudad),
    hasIndustry: _selectedRows.some(r => r.industry || r.industria),
    hasWeb:      _selectedRows.some(r => !r.no_website && (r.url || r.website)),
  }), [_selectedRows])

  // How many selected companies have each variable — shown in chip tooltip
  const tplVarCounts = useMemo(() => ({
    nombre:    _selectedRows.filter(r => r.name     || r.empresa).length,
    ciudad:    _selectedRows.filter(r => r._extra?.city || r.city || r.ciudad).length,
    industria: _selectedRows.filter(r => r.industry || r.industria).length,
    web:       _selectedRows.filter(r => !r.no_website && (r.url || r.website)).length,
  }), [_selectedRows])

  async function handleSendAll() {
    if (isSending || capBlocked) return
    let targets = waRowsUnique.filter(r => effectiveWaSelected.has(r.company_id) && !sentCids.has(r.company_id))
    if (!targets.length || belowMinTemplates || noMessageSelected) return

    // Tope de contactos nuevos, con el cupo recién leído. Sin número cargado
    // no cabe ninguno: gely-wa de Antonio (2026-10-07) encoló 2 de más porque
    // un cupo vacío se trataba como infinito.
    const newInBatch = targets.filter(r => !r.already_contacted?.contacted)
    if (newInBatch.length > 0) {
      const fresh = await refreshCapStats()
      const { kept, trimmed } = fitNewContacts(newInBatch, fresh || capStats)
      if (trimmed > 0) {
        const confirmed = await new Promise(resolve =>
          setNewContactsDialog({ open: true, trimCount: trimmed, newRemaining: kept.length, resolve })
        )
        if (!confirmed) return
        const existing = targets.filter(r => r.already_contacted?.contacted)
        targets = [...existing, ...kept]
      }
    }
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

    let lastVariant = null
    const jobs = []
    const queuedUrls = {}
    for (const row of targets) {
      // Principal + números extra que el usuario haya prendido a mano para esta
      // empresa (expandiendo su chip) — ver nota junto a totalContactPoints.
      // First number + extras ticked by hand, minus any blocked number.
      const numbers = sendableNumbers(row, extraSelected)
      if (!numbers.length) continue
      // Mismo texto para todos los números de UNA empresa — no son destinatarios
      // distintos a variar, son la misma empresa por otra línea.
      const v = pickMessageVariant(allVariants, lastVariant)
      lastVariant = v
      const message = renderTemplate(v, row.scraped_data) || v
      const messages = numbers.map(() => message)
      jobs.push({ numbers, messages, companyId: row.company_id, website: row.url })
      queuedUrls[row.url] = 'queued'
    }
    if (!jobs.length) return   // every selected number was blocked
    const accepted = await addBatch(jobs, lang === 'en' ? 'Prospect search' : 'Búsqueda de prospectos')
    if (!accepted) return false
    setSentOverlay(prev => ({ ...prev, ...queuedUrls }))
  }

  function exportUrlsTxt() {
    const text = found.filter(r => r.selected).map(r => r.url).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `urls-${lastIndustry || 'prospectos'}.txt`; a.click()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0, overflowY: 'auto' }}>

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
              ? `Today's new-contact cap allows ${newContactsDialog.newRemaining}. ${newContactsDialog.trimCount} will be removed from the batch.`
              : `El tope de contactos nuevos de hoy permite ${newContactsDialog.newRemaining}. Se quitan ${newContactsDialog.trimCount} del lote.`}
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

      {/* ── Estado inicial: centrado ── */}
      {!hasResults && (
        <Box data-prospect-start sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2.5, py: { xs: 1, md: 2.5 }, px: { xs: 0, md: 1 }, width: '100%', maxWidth: 1080, mx: 'auto' }}>
          <Box sx={{ textAlign: 'left', maxWidth: 680 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.8, color: 'var(--accent)', mb: 1.5, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}><TravelExploreIcon sx={{ fontSize: 17 }} />{lang === 'en' ? 'Discover opportunities' : 'Descubre oportunidades'}</Box>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.6rem', md: '2.25rem' }, letterSpacing: '-0.035em', lineHeight: 1.2, mb: 1, background: 'linear-gradient(135deg, var(--text,#f1f5f9) 20%, var(--accent,#60a5fa) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {t.search.heading}
            </Typography>
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t.search.headingSub}</Typography>
          </Box>

          <Box sx={{ p: { xs: 2, md: 3 }, borderRadius: '20px', background: 'linear-gradient(rgba(var(--accent-rgb),0.045), rgba(var(--accent-rgb),0.045)), var(--card-bg)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.08)' }}>
            <Box sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', mb: 1.5 }}>{lang === 'en' ? 'What business are you looking for?' : 'Qué negocio quieres encontrar?'}</Box>
            <SearchBarForm compact={false} allIndustries={allIndustries} searching={searching} draft={searchDraft} onDraftChange={setSearchDraft} labels={searchLabels} onSearch={handleSearch} onCancel={handleCancelSearch} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mt: 2, pt: 2, borderTop: '1px solid var(--border)' }}>
              <Box sx={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{lang === 'en' ? 'Include a city for more relevant results' : 'Agrega una ciudad para encontrar resultados más relevantes'}</Box>
              <CountSelector size="md" numResults={numResults} setNumResults={setNumResults} showCount={t.search.showCount} show={t.search.show} disabled={searching || scrapeJob.processing} />
            </Box>
          </Box>

          {/* Historial reciente */}
          {history.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: '100%' }}>
              <HistoryIcon sx={{ fontSize: 13, color: 'var(--text-muted)' }} />
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{t.search.recent}</Typography>
              {(showAllHistory ? history : history.slice(0, 4)).map(h => (
                <Box component="button" type="button" disabled={searching} key={h} onClick={() => { setSearchDraft({ industry: h, location: '' }); document.getElementById('prospect-industry')?.focus() }}
                  sx={{ px: 1.2, py: 0.3, borderRadius: 10, cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text)', fontFamily: 'inherit', minHeight: 32, bgcolor: 'var(--item-hover)', border: '1px solid var(--border)', transition: 'all 0.15s', '&:hover': { color: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.1)', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)' } }}>
                  {h}
                </Box>
              ))}
              {history.length > 4 && <Button size="small" onClick={() => setShowAllHistory(v => !v)} sx={{ color: 'var(--accent)', fontSize: '0.75rem' }}>{showAllHistory ? (lang === 'en' ? 'Show less' : 'Ver menos') : (lang === 'en' ? 'View history' : 'Ver historial')}</Button>}
            </Box>
          )}

          {/* Grid de industrias */}
          <Box sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            {INDUSTRY_GROUPS.map((group, groupIndex) => (
              <Box key={group.label} sx={{ p: 2, borderRadius: '16px', background: 'linear-gradient(rgba(var(--accent-rgb),0.025), rgba(var(--accent-rgb),0.025)), var(--card-bg)', border: '1px solid var(--border)', borderTop: `2px solid ${group.color}66` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.5 }}>
                  <Box sx={{ display: 'flex', p: 0.75, borderRadius: '8px', bgcolor: `${group.color}14`, color: 'var(--text)', '& svg': { fontSize: 18 } }}>{[<RestaurantIcon key="food" />, <LocalHospitalIcon key="health" />, <ContentCutIcon key="beauty" />, <BuildIcon key="service" />, <StorefrontIcon key="retail" />, <BusinessCenterIcon key="work" />, <SchoolIcon key="education" />, <HotelIcon key="hotel" />][groupIndex]}</Box>
                  <Typography sx={{ color: group.color, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{group.label}</Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                  {group.items.map(item => (
                    <Box component="button" type="button" key={item} disabled={searching} onClick={() => { setSearchDraft(prev => ({ ...prev, industry: item })); document.getElementById('prospect-location')?.focus() }}
                      sx={{ px: 1.5, py: 0.5, borderRadius: '8px', cursor: 'pointer', fontSize: '0.83rem', fontFamily: 'inherit', minHeight: 34, fontWeight: 500, bgcolor: 'var(--item-hover)', color: 'var(--text)', border: `1px solid ${group.color}25`, transition: 'all 0.15s', '&:hover': { bgcolor: `${group.color}22`, color: group.color, border: `1px solid ${group.color}55`, transform: 'translateY(-1px)', boxShadow: `0 3px 10px ${group.color}1a` } }}>
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
        <Box data-search-controls sx={{ p: 2, borderRadius: '16px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', flexShrink: 0, containerType: 'inline-size', containerName: 'prospect-controls' }}>
          <SearchBarForm compact={true} allIndustries={allIndustries} searching={searching} draft={searchDraft} onDraftChange={setSearchDraft} labels={searchLabels} onSearch={handleSearch} onCancel={handleCancelSearch}
            quantityControl={<CountSelector size="sm" numResults={numResults} setNumResults={setNumResults} showCount={t.search.showCount} show={t.search.show} disabled={searching || scrapeJob.processing} />} />
        </Box>
      )}

      {blockedIndustry && !searching && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: 2, flexShrink: 0,
          bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <BlockIcon sx={{ fontSize: 16, color: '#f87171' }} />
          <Typography sx={{ fontSize: '0.78rem', color: '#fca5a5' }}>
            {lang === 'en'
              ? <>The industry <strong>{blockedIndustry}</strong> is on your blacklist — companies of that trade are discarded when processed and are never messaged.</>
              : <>La industria <strong>{blockedIndustry}</strong> está en tu blacklist: las empresas de ese giro se descartan al procesarlas y no se les envía nada.</>}
          </Typography>
        </Box>
      )}

      {serviceWarnings.length > 0 && <Box role="status" sx={{ p: 1.5, border: '1px solid var(--border)', borderRadius: 2, mb: 1, bgcolor: 'var(--card-bg)' }}>
        <Typography sx={{ color: 'var(--text)', fontSize: '.8rem' }}>
          {lang === 'en' ? 'Search incomplete. The available results are shown.' : 'Búsqueda incompleta. Se muestran los resultados disponibles.'}
        </Typography>
      </Box>}
      {/* ── Sin resultados / error ── */}
      {searchError && !searching && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5, py: 4, px: 2 }}>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.45))', fontSize: '0.9rem', textAlign: 'center' }}>
            {searchError === 'partial' ? (lang === 'en' ? 'Search incomplete for' : 'Búsqueda incompleta para') : searchError === 'failed' ? t.search.searchFailedFor : t.search.noResultsFor} <strong style={{ color: 'var(--text, #f1f5f9)' }}>{lastIndustry}</strong>
          </Typography>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.28))', fontSize: '0.78rem', textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
            {searchError === 'partial' ? (lang === 'en' ? 'You can retry later.' : 'Puedes reintentar más tarde.') : searchError === 'failed' ? t.search.searchFailedHint : t.search.tryOther}
          </Typography>
          {searchError === 'empty' && (
            <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.18))', fontSize: '0.72rem', textAlign: 'center', maxWidth: 460, lineHeight: 1.6, mt: 0.5 }}>
              {t.search.noResultsHint}
            </Typography>
          )}
        </Box>
      )}

      {searching && <ProspectSearchSkeleton query={lastIndustry} count={numResults} lang={lang} />}

      {/* ── Lista de URLs encontradas ── */}
      {found.length > 0 && !scrapeJob.processing && !scrapeJob.done && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, minHeight: 0 }}>

          <Box data-search-result-heading sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: '1.08rem', fontWeight: 800, color: 'var(--text)', m: 0 }}>{lang === 'en' ? 'Results for' : 'Resultados de'} {lastIndustry}</Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '.78rem', mt: .3 }}>{lang === 'en' ? 'Choose the businesses you want to process.' : 'Selecciona los negocios que quieres procesar.'}</Typography>
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
              <Tooltip title={selectedCount === 0 ? t.search.exportUrlsTip : t.search.exportUrlsTip2} placement="top">
                <span>
                  <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 13 }} />} onClick={exportUrlsTxt} disabled={selectedCount === 0}
                    sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', border: '1px solid var(--border)', borderRadius: 1.5, px: 1.2, py: 0.3, textTransform: 'none', minWidth: 0, '&:hover': { bgcolor: 'var(--item-hover)', color: 'var(--text)' }, '&.Mui-disabled': { opacity: 0.35 } }}>
                    {t.search.exportUrls}
                  </Button>
                </span>
              </Tooltip>
              {results.length > 0 && (
                <Tooltip title={t.search.exportCsvTip} placement="top">
                  <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 13 }} />} onClick={downloadCsv}
                    sx={{ color: '#4ade80', fontSize: '0.7rem', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 1.5, px: 1.2, py: 0.3, textTransform: 'none', minWidth: 0, bgcolor: 'rgba(34,197,94,0.08)', '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                    {t.search.exportResults}
                  </Button>
                </Tooltip>
              )}
            </Box>
          </Box>

          <Box data-search-summary sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.25 }}>
            {[
              { value: found.length, label: lang === 'en' ? 'Found' : 'Encontradas', icon: <SearchIcon /> },
              { value: newCount, label: lang === 'en' ? 'New' : 'Nuevas', icon: <AddIcon /> },
              { value: scrapedCount, label: lang === 'en' ? 'Already registered' : 'Ya registradas', icon: <CheckCircleIcon /> },
              { value: mapsCount, label: lang === 'en' ? 'Without website' : 'Sin sitio web', icon: <TravelExploreIcon /> },
            ].map(metric => <Box key={metric.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, borderRadius: '12px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)' }}>
              <Box sx={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: '9px', bgcolor: 'var(--item-hover)', color: 'var(--accent)', '& svg': { fontSize: 18 } }}>{metric.icon}</Box>
              <Box><Typography sx={{ fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.2, color: 'var(--text)' }}>{metric.value}</Typography><Typography sx={{ fontSize: '.76rem', color: 'var(--text-muted)', mt: .3 }}>{metric.label}</Typography></Box>
            </Box>)}
          </Box>
          {(found.length < requestedCount || blockedCount > 0) && <Typography sx={{ color: 'var(--text-muted)', fontSize: '.76rem' }}>
            {found.length < requestedCount && (lang === 'en' ? `Showing ${found.length} of ${requestedCount} requested.` : `Se muestran ${found.length} de ${requestedCount} solicitadas.`)}
            {blockedCount > 0 && ` · ${blockedCount} ${t.search.blockedCount}`}
          </Typography>}

          <Box data-search-filters sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Filtros */}
              {[
                { key: 'all',     label: `${t.search.filterAll} (${found.length})`,        color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.25)' },
                { key: 'new',     label: `${t.search.filterNew} (${newCount})`,            color: '#4ade80', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)'  },
                { key: 'scraped', label: `${t.search.filterInDB} (${scrapedCount})`,      color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' },
                ...(mapsCount > 0 ? [{ key: 'maps', label: `${lang === 'en' ? 'No website' : 'Sin sitio web'} (${mapsCount})`, color: '#2dd4bf', bg: 'rgba(45,212,191,0.1)', border: 'rgba(45,212,191,0.25)' }] : []),
              ].map(f => (
                <Chip key={f.key} label={f.label} size="small" onClick={() => setFilterScraped(f.key)}
                  sx={{ height: 30, borderRadius: '8px', fontSize: '0.76rem', cursor: 'pointer', bgcolor: filterScraped === f.key ? f.bg : 'var(--item-hover)', color: filterScraped === f.key ? f.color : 'var(--text-muted)', border: `1px solid ${filterScraped === f.key ? f.border : 'var(--border)'}`, transition: 'all 0.15s', '&:hover': { bgcolor: f.bg, color: f.color } }} />
              ))}          </Box>
          {/* Barra de acciones */}
          <Box data-search-selection sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, p: 1.5, borderRadius: '12px', border: '1px solid var(--border)', bgcolor: 'var(--sidebar-bg)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Tooltip title={newCount === 0 ? t.search.noNewTip : t.search.toggleNewTip} placement="top">
                <span>
                  <Checkbox size="small" checked={allSelected} indeterminate={processableCount > 0 && !allSelected}
                    disabled={newCount === 0}
                    onChange={e => toggleAll(e.target.checked)}
                    sx={{ color: 'var(--text-muted)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' }, p: 0.5 }} />
                </span>
              </Tooltip>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {selectedCount} {lang === 'en' ? 'selected' : selectedCount === 1 ? 'seleccionada' : 'seleccionadas'}
                {skippedCount > 0 && (
                  <Box component="span" sx={{ color: '#fbbf24', ml: 0.8 }}>· {skippedCount} {t.search.inDbCount}</Box>
                )}
              </Typography>

              {/* Selección rápida */}
              <Tooltip title={t.search.selectNewTip} placement="top">
                <Box onClick={selectOnlyNew} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#4ade80', bgcolor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(34,197,94,0.15)' } }}>
                  <CheckBoxIcon sx={{ fontSize: 12 }} /> {t.search.selectNew}
                </Box>
              </Tooltip>
              <Tooltip title={t.search.deselectDBTip} placement="top">
                <Box onClick={deselectScraped} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.35, borderRadius: 1.2, cursor: 'pointer', fontSize: '0.7rem', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', transition: 'all 0.15s', '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' } }}>
                  <IndeterminateCheckBoxIcon sx={{ fontSize: 12 }} /> {t.search.deselectInDB}
                </Box>
              </Tooltip>


            </Box>

            <Tooltip title={skippedCount > 0 ? t.search.skippingTip.replace('{n}', skippedCount) : ''} placement="top">
              <span>
                <Button data-prospect-primary variant="contained" onClick={handleProcess} disabled={processableCount === 0} startIcon={<PlayArrowIcon />}
                  sx={{ bgcolor: 'var(--accent, #3b82f6)', fontWeight: 600, textTransform: 'none', px: 2, py: 0.8, borderRadius: 1.5, fontSize: '0.85rem', '&:hover': { bgcolor: 'var(--accent, #2563eb)' }, '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.15)', color: 'rgba(255,255,255,0.3)' } }}>
                  {lang === 'en' ? `Process ${processableCount} ${processableCount === 1 ? 'prospect' : 'prospects'}` : `Procesar ${processableCount} ${processableCount === 1 ? 'prospecto' : 'prospectos'}`}
                  {skippedCount > 0 && ` (${t.search.omitting} ${skippedCount})`}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {/* Lista URL con favicon + dominio */}
          <Box data-search-result-list sx={{ flexGrow: 1, minHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '14px', bgcolor: 'var(--card-bg)' }}>
            {visibleFound.map(item => (
              <ProspectResultRow key={item.url} item={item} realIdx={found.indexOf(item)}
                toggleOne={toggleOne} t={t} lang={lang} />
            ))}
            {(visibleCount < found.length || (!serverExhausted && found.length > 0 && !searching)) && (
              <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.7, borderTop: '1px solid var(--border)' }}>
                {emptyBatches > 0 && <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {lang === 'en' ? 'This attempt found no new businesses. You can try the next batch.' : 'Este intento no encontró nuevos negocios. Puedes probar el siguiente lote.'}
                </Typography>}
                <Button size="small" onClick={handleLoadMore} disabled={fetchingMore}
                  sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.78rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.2)', borderRadius: 1.5, px: 2, textTransform: 'none', gap: 0.8, '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)' }, '&.Mui-disabled': { color: 'rgba(96,165,250,0.4)', borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.1)' } }}>
                  {fetchingMore
                    ? <><CircularProgress size={13} sx={{ color: 'inherit' }} />{lang === 'en' ? 'Searching for more…' : 'Buscando más…'}</>
                    : visibleCount < found.length
                      ? `${t.search.showMoreBtn} ${Math.min(numResults, found.length - visibleCount)} ${t.search.showMore} (${found.length - visibleCount} ${t.search.remaining})`
                      : (lang === 'en' ? 'Search for more results' : 'Buscar más resultados')}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Shared scraping progress; each surface keeps its own inputs and actions. */}
      {scrapeJob.processing && <ScrapeProgress
        processed={scrapeJob.processed ?? results.length} total={scrapeJob.total || found.filter(r => r.selected).length} progress={scrapeJob.progress}
        paused={scrapeJob.paused} pausing={scrapeJob.pausing} inFlight={scrapeJob.inFlight} currentUrl={scrapeJob.currentUrl}
        onPause={() => scrapeJob.paused ? scrapeJob.resume() : scrapeJob.pause()} onCancel={scrapeJob.cancel} lang={lang}
      ></ScrapeProgress>}
      {scrapeJob.processing && results.length === 0 && <ScrapingPlaceholders lang={lang} paused={scrapeJob.paused} />}



      {/* ── Cancelled + pending URLs banner ── */}
      {scrapeJob.done && scrapeJob.job?.status === 'cancelled' && scrapeJob.pendingCount > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
          px: 2, py: 1.5, borderRadius: 2, flexShrink: 0,
          bgcolor: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.22)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PauseIcon sx={{ fontSize: 15, color: '#fbbf24', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)' }}>
              {lang === 'en'
                ? <><span style={{ color: '#fbbf24', fontWeight: 700 }}>{scrapeJob.pendingCount} URL{scrapeJob.pendingCount !== 1 ? 's' : ''}</span> were not scraped — resume to continue</>
                : <><span style={{ color: '#fbbf24', fontWeight: 700 }}>{scrapeJob.pendingCount} URL{scrapeJob.pendingCount !== 1 ? 's' : ''}</span> quedaron sin scrapear — reanuda para continuar</>}
            </Typography>
          </Box>
          <Button onClick={scrapeJob.reanudar} startIcon={<ReplayIcon sx={{ fontSize: 15 }} />} size="small"
            sx={{ flexShrink: 0, fontSize: '0.78rem', fontWeight: 700, textTransform: 'none', color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 1.5, px: 1.5, py: 0.5, '&:hover': { bgcolor: 'rgba(251,191,36,0.18)' } }}>
            {lang === 'en' ? 'Resume' : 'Reanudar'}
          </Button>
        </Box>
      )}

      {/* ── De qué búsqueda son estos resultados — la pantalla recupera el último
           job al volver, y sin esto se veían, por ejemplo, cerrajeros de Saltillo
           debajo de una caja que decía "Gyms". ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexShrink: 0, px: 0.5 }}>
          <Typography sx={{ fontSize: '0.82rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', minWidth: 0 }}>
            {scrapeJob.job?.query ? (
              <>
                {lang === 'en' ? 'Results for ' : 'Resultados de '}
                <Box component="span" sx={{ color: 'var(--text, white)', fontWeight: 700 }}>«{scrapeJob.job.query}»</Box>
              </>
            ) : (lang === 'en' ? 'Results of the last processing' : 'Resultados del último procesamiento')}
            {scrapeJob.job?.created_at && <> · {agoLabel(scrapeJob.job.created_at, lang)}</>}
          </Typography>
          {!scrapeJob.processing && (
            <Button size="small" startIcon={<ClearIcon sx={{ fontSize: 14 }} />} onClick={handleNewSearch}
              sx={{ flexShrink: 0, fontSize: '0.74rem', textTransform: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 1.5, px: 1.3, py: 0.3, '&:hover': { color: 'var(--text)', bgcolor: 'var(--item-hover)' } }}>
              {lang === 'en' ? 'New search' : 'Nueva búsqueda'}
            </Button>
          )}
        </Box>
      )}

      {results.length > 0 && <ScrapeSummary
        processed={results.length} total={scrapeJob.total || found.filter(r => r.selected).length} ok={okCount} errors={errCount} withWa={waCount}
        selected={totalContactPoints} available={waRowsUnique.reduce((sum, r) => sum + (r.all_whatsapp?.length || (r.whatsapp ? 1 : 0)), 0)}
        sent={sentCids.size} lang={lang}
      />}

      {/* ── Panel de envío masivo ── */}
      {(scrapeJob.done || scrapeJob.processing) && results.length > 0 && (
        <BulkSendPanel
          title={t.batch.sendMessages}
          waRows={waRowsUnique} filteredRows={filteredWaRows}
          filterContacted={filterContacted} onFilterContacted={setFilterContacted}
          selected={effectiveWaSelected} setSelected={setWaSelected}
          expandedCo={expandedCo} setExpandedCo={setExpandedCo}
          extraSelected={extraSelected} setExtraSelected={setExtraSelected}
          guards={guards} varFlags={tplVarFlags} varCounts={tplVarCounts} onVariantsChange={setExtraVariants}
          capStats={capStats} instanceStatus={instanceStatus} isDisconnected={isDisconnected}
          sendCfg={sendCfg} onSendCfgChange={setSendCfg}
          sendError={sendError} onDismissError={() => setSendError('')}
          isSending={isSending} onCancel={cancelQueue} onSend={handleSendAll}
          allSent={allSelectedSent} sentLabel={`${sentCount} ${t.search.sentCount}`} unsentCount={unsentSelectedCount} />
      )}

      {/* ── Tarjetas de resultados ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>{t.search.results}<Box component="span" sx={{ px: 1, py: .3, borderRadius: '7px', bgcolor: 'rgba(var(--accent-rgb),.1)', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{results.length}</Box></Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {scrapeJob.done && errCount > 0 && (
                <Button size="small" startIcon={<ReplayIcon sx={{ fontSize: 14 }} />} onClick={handleRetryFailed}
                  sx={{ color: '#f87171', fontSize: '0.75rem', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}>
                  {t.search.retryFailed} {errCount} {t.search.failedLabel}
                </Button>
              )}
              {scrapeJob.done && (
                <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 14 }} />} onClick={downloadCsv}
                  sx={{ color: 'var(--accent, #60a5fa)', fontSize: '0.75rem', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.08)' } }}>
                  {t.search.download}
                </Button>
              )}
            </Box>
          </Box>

          <Box data-scrape-results-table sx={{ border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden', bgcolor: 'var(--card-bg)', '& .MuiTableContainer-root': { border: 0, borderRadius: 0 } }}>
          <TableContainer sx={{
            maxHeight: 'clamp(240px, 45vh, 560px)',
            overflow: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent', marginBlock: '40px' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}>
            <Table size="small" stickyHeader sx={{ minWidth: 780, '& th:first-of-type': { width: '44%' }, '& th:nth-of-type(2)': { width: '19%' }, '& th:last-of-type': { width: '17%' }, '& td, & th': { px: 2.25 }, '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
              <TableHead>
                <TableRow>
                  {[t.batch.colCompany, t.batch.colIndustry, 'WhatsApp', sentCids.size > 0 ? t.batch.colMessage : null, t.batch.colStatus].filter(Boolean).map(h => (
                    <TableCell key={h} sx={{
                      bgcolor: 'var(--sidebar-bg)',
                      color: 'var(--text-muted)',
                      fontWeight: 700,
                      fontSize: '.72rem',
                      letterSpacing: '.055em',
                      py: 1.6,
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {pageResults.map((r, i) => {
                  const en          = lang === 'en'
                  const domain      = getDomain(r.url)
                  const hasWa       = r.all_whatsapp?.length > 0 || !!r.whatsapp
                  const isContacted = r.company_id && _contactedCids.has(r.company_id)
                  const name        = r.empresa && r.empresa !== '—' ? r.empresa : (r.no_website ? '—' : domain)
                  const place       = r.city || r.state || ''
                  const st          = rowStatus(r, hasWa, en)
                  const lm          = r.location_mismatch
                  const im          = r.industry_mismatch

                  return (
                    <TableRow key={r.url || i} sx={{
                      bgcolor: isContacted ? 'rgba(251,191,36,0.03)' : i % 2 ? 'rgba(var(--accent-rgb),.018)' : 'transparent',
                      '&:hover': { bgcolor: 'rgba(var(--accent-rgb),.07)' },
                      '& td': { borderBottom: '1px solid var(--border)', fontSize: '.84rem', py: 1.5 },
                      animation: `${fadeSlideIn} 0.22s ease both`,
                      animationDelay: `${i * 0.025}s`,
                      transition: 'background-color 0.15s',
                    }}>
                      <TableCell sx={{ minWidth: 280, maxWidth: 460 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
                          <CompanyAvatar key={r.url} photoUrl={r.no_website ? r.photo_url : null}
                            domain={r.no_website ? null : domain} name={name} size={32} dimmed={!r.ok} />
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                              <Tooltip title={name} placement="top" arrow disableHoverListener={name.length < 40}>
                                <Typography noWrap sx={{ fontSize: '0.84rem', color: 'var(--text, rgba(255,255,255,0.88))', fontWeight: 600 }}>
                                  {name}
                                </Typography>
                              </Tooltip>
                              {isContacted && (
                                <Tooltip title={en ? 'Already messaged' : 'Ya contactada'} placement="top" arrow>
                                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#fbbf24', flexShrink: 0, boxShadow: '0 0 4px #fbbf2480' }} />
                                </Tooltip>
                              )}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                              <Typography component="a" href={r.url} target="_blank" rel="noopener" noWrap
                                sx={{ fontSize: '.75rem', color: 'var(--accent)', textDecoration: 'none', flexShrink: 1, minWidth: 0, '&:hover': { textDecoration: 'underline' } }}>
                                {r.no_website ? (en ? 'Google Maps · no website' : 'Google Maps · sin web') : domain}
                              </Typography>
                              {place && (
                                // Where the location came from (scraper._finalize_location):
                                // only "sitio" is the page itself — area code / search are inferred.
                                <Tooltip placement="top" arrow title={
                                  r.location_source === 'lada'
                                    ? (en ? "From its phones' area code — the site shows no address" : 'Según la lada de sus teléfonos — el sitio no muestra dirección')
                                    : r.location_source === 'busqueda'
                                      ? (en ? 'Assumed from the search — neither the site nor its phones say where it is' : 'Supuesta por la búsqueda — ni el sitio ni sus teléfonos dicen dónde está')
                                      : (en ? 'From the website' : 'Según el sitio web')}>
                                  <Typography noWrap sx={{ fontSize: '0.72rem', color: 'var(--text-muted, rgba(255,255,255,0.45))', flexShrink: 0,
                                    fontStyle: ['lada', 'busqueda'].includes(r.location_source) ? 'italic' : 'normal', cursor: 'help' }}>
                                    · {place}
                                  </Typography>
                                </Tooltip>
                              )}
                            </Box>
                            {(lm || im) && (
                              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                                {lm && (
                                  <Tooltip placement="top" arrow title={en
                                    ? `You searched in ${lm.searched_state}; this business is in ${[lm.detected_city, lm.detected_state].filter(Boolean).join(', ')}`
                                    : `Buscaste en ${lm.searched_state}; este negocio está en ${[lm.detected_city, lm.detected_state].filter(Boolean).join(', ')}`}>
                                    <Chip size="small" icon={<WarningAmberIcon sx={{ fontSize: '12px !important' }} />}
                                      label={`${en ? 'Outside area' : 'Fuera de zona'}: ${lm.detected_city || lm.detected_state}`}
                                      sx={{ height: 18, fontSize: '0.62rem', cursor: 'help', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', '& .MuiChip-icon': { color: '#fbbf24' } }} />
                                  </Tooltip>
                                )}
                                {im && (
                                  <Tooltip placement="top" arrow title={en
                                    ? `You searched "${im.searched_industry}"${im.searched_category ? ` (${im.searched_category})` : ''}; the site looks like ${im.detected_industry}`
                                    : `Buscaste "${im.searched_industry}"${im.searched_category ? ` (${im.searched_category})` : ''}; el sitio parece de ${im.detected_industry}`}>
                                    <Chip size="small" icon={<WarningAmberIcon sx={{ fontSize: '12px !important' }} />}
                                      label={`${en ? 'Other trade' : 'Otro giro'}: ${im.detected_industry}`}
                                      sx={{ height: 18, fontSize: '0.62rem', cursor: 'help', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', '& .MuiChip-icon': { color: '#fbbf24' } }} />
                                  </Tooltip>
                                )}
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.55)' }}>
                        {r.industria && r.industria !== '—'
                          ? <Chip label={r.industria} size="small" sx={{ height: 25, fontSize: '.72rem', borderRadius: '7px', bgcolor: 'rgba(var(--accent-rgb),.07)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                          : <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                        }
                      </TableCell>
                      <TableCell>
                        {hasWa ? (
                          <WhatsAppNumberSummary row={r} />
                        ) : r.blacklisted ? (
                          // Never checked — it was blocked before scraping/verifying.
                          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.75rem' }}>—</Typography>
                        ) : r.no_website && r.wa_verified == null && r.ok ? (
                          <Tooltip placement="top" arrow title={lang === 'en'
                            ? `Phone ${r.phone} — no connected WhatsApp session could check it. Saved as a phone, pending verification.`
                            : `Teléfono ${r.phone} — ninguna sesión de WhatsApp conectada pudo verificarlo. Quedó guardado como teléfono, pendiente de verificar.`}>
                            <Chip label={lang === 'en' ? 'Not verified' : 'Sin verificar'} size="small"
                              sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', cursor: 'help' }} />
                          </Tooltip>
                        ) : (
                          <Tooltip placement="top" arrow title={r.no_website && r.phone ? (lang === 'en' ? `Phone ${r.phone} has no WhatsApp` : `El teléfono ${r.phone} no tiene WhatsApp`) : ''}>
                            <Chip label={lang === 'en' ? 'No WA' : 'Sin WA'} size="small"
                              sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)', letterSpacing: '0.02em' }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      {sentCids.size > 0 && (
                        <TableCell>
                          {r.msg_status === 'sent'    && <Chip label={t.batch.chipSent}   size="small" sx={{ bgcolor: 'rgba(167,139,250,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)', height: 20, fontSize: '0.68rem' }} />}
                          {r.msg_status === 'failed'  && <Chip label={t.batch.chipFailed} size="small" sx={{ bgcolor: 'rgba(239,68,68,0.1)',   color: '#f87171', border: '1px solid rgba(239,68,68,0.25)',   height: 20, fontSize: '0.68rem' }} />}
                          {r.msg_status === 'queued'  && <Chip label={lang === 'en' ? 'Queued' : 'En cola'} size="small" sx={{ bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)', height: 20, fontSize: '0.68rem' }} />}
                          {!r.msg_status && <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>}
                        </TableCell>
                      )}
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={st.tip || ''} placement="top" arrow disableHoverListener={!st.tip}>
                          <Chip label={st.label} size="small"
                            sx={{ height: 26, fontSize: '.72rem', borderRadius: '7px', fontWeight: 600, cursor: st.tip ? 'help' : 'default',
                              bgcolor: `${st.color}1a`, color: st.color, border: `1px solid ${st.color}40` }} />
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div" data-scrape-pagination
            count={results.length} page={safeResultPage} rowsPerPage={resultPageSize}
            rowsPerPageOptions={[25, 50, 100]}
            onPageChange={(_, page) => setResultPage(page)}
            onRowsPerPageChange={event => { setResultPageSize(Number(event.target.value)); setResultPage(0) }}
            labelRowsPerPage={lang === 'en' ? 'Rows per page:' : 'Filas por página:'}
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} ${lang === 'en' ? 'of' : 'de'} ${count}`}
            slotProps={{ select: { variant: 'outlined', size: 'small', MenuProps: { slotProps: { paper: { sx: { bgcolor: 'var(--card-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '10px', backgroundImage: 'none', '& .MuiMenuItem-root': { fontSize: '.82rem', borderRadius: '6px', mx: .5, '&.Mui-selected': { bgcolor: 'rgba(var(--accent-rgb),.12)', color: 'var(--accent)' } } } } } }, sx: { width: 78, ml: 1, mr: 1.5, bgcolor: 'var(--surface)', borderRadius: '9px', color: 'var(--text)', '& .MuiSelect-select': { minWidth: '0 !important', width: '100%', boxSizing: 'border-box', padding: '8px 30px 8px 12px !important', fontWeight: 600 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' }, '&:hover .MuiOutlinedInput-notchedOutline, &.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' }, '& .MuiSelect-icon': { right: 8, pointerEvents: 'none' } } } }}
            sx={{
              color: 'var(--text-muted)', borderTop: '1px solid var(--border)', bgcolor: 'rgba(var(--accent-rgb),.035)',
              '& .MuiTablePagination-toolbar': { px: { xs: 1.5, sm: 2 }, py: .75, minHeight: 58, gap: .75, flexWrap: 'wrap' },
              '& .MuiTablePagination-spacer': { display: { xs: 'none', sm: 'block' } },
              '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '.78rem', my: .5 },
              '& .MuiSelect-icon': { color: 'var(--text-muted)' },
              '& .MuiTablePagination-actions': { display: 'flex', gap: .75, ml: { xs: 'auto', sm: 1.5 } },
              '& .MuiIconButton-root': { width: 32, height: 32, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '9px', bgcolor: 'var(--surface)', '&:hover': { color: 'var(--accent)', bgcolor: 'rgba(var(--accent-rgb),.12)' }, '&.Mui-disabled': { color: 'var(--text-muted)', opacity: .35 } },
            }}
          />
          </Box>
        </Box>
      )}
    </Box>
  )
}
