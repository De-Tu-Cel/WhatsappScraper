'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Checkbox from '@mui/material/Checkbox'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Popover from '@mui/material/Popover'
import Badge from '@mui/material/Badge'
import FilterListIcon from '@mui/icons-material/FilterList'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import SwapVertIcon from '@mui/icons-material/SwapVert'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import SearchIcon from '@mui/icons-material/Search'
import TablePagination from '@mui/material/TablePagination'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PauseIcon from '@mui/icons-material/Pause'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import Chip from '@mui/material/Chip'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'
import { useScrapeJob } from '../hooks/useScrapeJob'

const ACCENT = 'var(--accent, #3b82f6)'
const PAGE_SIZE = 24

// Paleta para los chips de término de búsqueda — asignación determinística por
// hash del texto, no por orden, así el mismo término siempre sale del mismo color.
const TERM_COLORS = [
  '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa',
  '#fb923c', '#4ade80', '#22d3ee', '#c084fc', '#93c5fd',
]
function colorForTerm(term) {
  let hash = 0
  for (let i = 0; i < term.length; i++) hash = (hash * 31 + term.charCodeAt(i)) >>> 0
  return TERM_COLORS[hash % TERM_COLORS.length]
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    fontSize: '0.82rem', bgcolor: 'var(--surface, rgba(255,255,255,0.03))',
    '& fieldset': { borderColor: 'var(--border, rgba(255,255,255,0.1))' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent, #3b82f6)' },
  },
  '& input': { color: 'var(--text, #f1f5f9)' },
}

function relativeTime(iso, lang) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return lang === 'en' ? 'just now' : 'justo ahora'
  if (mins < 60) return lang === 'en' ? `${mins}m ago` : `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return lang === 'en' ? `${hrs}h ago` : `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return lang === 'en' ? `${days}d ago` : `hace ${days}d`
}

// Chip pequeño y removible — muestra un término YA seleccionado, fuera del dropdown.
function SelectedChip({ value, label, onRemove }) {
  const color = colorForTerm(value)
  return (
    <Box onClick={onRemove} sx={{
      display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
      px: 0.9, py: 0.25, borderRadius: 999, flexShrink: 0,
      border: `1px solid ${color}55`, bgcolor: `${color}1a`,
      '&:hover': { bgcolor: `${color}30` },
    }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color, whiteSpace: 'nowrap' }}>{label}</Typography>
      <HighlightOffIcon sx={{ fontSize: 13, color }} />
    </Box>
  )
}

const TERMS_PAGE_SIZE = 20

// Dropdown con la lista completa (paginada) de términos disponibles para filtrar —
// separado de los chips ya seleccionados, que se muestran afuera sin necesitar
// abrir el menú. Evita llenar la pantalla de checkboxes sueltos cuando con el
// tiempo haya decenas de términos de búsqueda distintos.
const UNATTRIBUTED = '__none__'  // debe calzar con el sentinel del backend (routes.py)

// Dropdown genérico paginado — reusado tanto para "término de búsqueda" como
// para "quién la trajo". `endpoint`/`itemsKey`/`valueField` apuntan a la forma
// exacta de cada API (GET /api/ideas/terms → {terms:[{term,count}]}, GET
// /api/ideas/users → {users:[{user,count}]}), todo lo demás es idéntico.
function FilterDropdown({ selected, onToggle, label, searchPh, noItemsLabel, endpoint, itemsKey, valueField, formatValue }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const [rows,     setRows]     = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const debounceRef = useRef(null)

  const load = useCallback((p, s) => {
    setLoading(true)
    const qs = new URLSearchParams({ page: String(p), limit: String(TERMS_PAGE_SIZE) })
    if (s) qs.set('search', s)
    authFetch(`${endpoint}?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { [itemsKey]: [], total: 0 })
      .then(d => { setRows(d[itemsKey] || []); setTotal(d.total || 0) })
      .catch(() => { setRows([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [endpoint, itemsKey])

  function handleOpen(e) {
    setAnchorEl(e.currentTarget)
    setPage(1); setSearch('')
    load(1, '')
  }
  function handleClose() { setAnchorEl(null) }

  function handleSearchChange(v) {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(1, v), 300)
  }

  function goPage(p) { setPage(p); load(p, search) }

  const totalPages = Math.max(1, Math.ceil(total / TERMS_PAGE_SIZE))
  const open = Boolean(anchorEl)

  return (
    <>
      <Button onClick={handleOpen}
        startIcon={<FilterListIcon sx={{ fontSize: 15 }} />} endIcon={<ArrowDropDownIcon sx={{ fontSize: 18 }} />}
        sx={{
          textTransform: 'none', fontSize: '0.78rem', fontWeight: 600, borderRadius: 1.5,
          color: selected.size > 0 ? ACCENT : 'var(--text-muted)',
          border: '1px solid', borderColor: selected.size > 0 ? ACCENT : 'var(--border, rgba(255,255,255,0.14))',
          bgcolor: selected.size > 0 ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent',
        }}>
        {label}
      </Button>
      <Popover open={open} anchorEl={anchorEl} onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: {
          bgcolor: 'var(--card-bg,#1e293b) !important', color: 'var(--text, #f1f5f9)',
          border: '1px solid var(--border, rgba(255,255,255,0.1))',
          borderRadius: 2, width: 260, p: 1.2, mt: 0.5,
        } } }}>
        <TextField
          size="small" fullWidth autoFocus value={search} onChange={e => handleSearchChange(e.target.value)}
          placeholder={searchPh}
          slotProps={{ input: { startAdornment: (
            <InputAdornment position="start"><SearchIcon sx={{ fontSize: 14, color: 'var(--text-muted)' }} /></InputAdornment>
          ) } }}
          sx={{
            ...FIELD_SX, mb: 1,
            '& .MuiOutlinedInput-root': { ...FIELD_SX['& .MuiOutlinedInput-root'], bgcolor: 'var(--surface, rgba(255,255,255,0.03)) !important' },
          }}
        />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2.5 }}>
            <CircularProgress size={16} sx={{ color: ACCENT }} />
          </Box>
        ) : rows.length === 0 ? (
          <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', py: 2.5, fontStyle: 'italic' }}>
            {noItemsLabel}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' }}>
            {rows.map(row => {
              const value = row[valueField]
              const displayLabel = formatValue ? formatValue(value) : value
              const color = colorForTerm(value)
              const checked = selected.has(value)
              return (
                <Box key={value} onClick={() => onToggle(value)} sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', borderRadius: 1,
                  px: 0.6, py: 0.4, bgcolor: 'var(--surface, rgba(255,255,255,0.03)) !important',
                  '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.06)) !important' },
                }}>
                  <Checkbox size="small" checked={checked} onClick={e => e.stopPropagation()} onChange={() => onToggle(value)}
                    sx={{ p: 0.4, color: 'var(--text-muted)', '&.Mui-checked': { color } }} />
                  <Typography sx={{ fontSize: '0.78rem', color: checked ? color : 'var(--text)', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayLabel}
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{row.count}</Typography>
                </Box>
              )
            })}
          </Box>
        )}
        {total > TERMS_PAGE_SIZE && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1, pt: 1, borderTop: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
            <IconButton size="small" disabled={page <= 1} onClick={() => goPage(page - 1)} sx={{ color: 'var(--text-muted)', '&.Mui-disabled': { opacity: 0.25 } }}>
              <ChevronLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{page} / {totalPages}</Typography>
            <IconButton size="small" disabled={page >= totalPages} onClick={() => goPage(page + 1)} sx={{ color: 'var(--text-muted)', '&.Mui-disabled': { opacity: 0.25 } }}>
              <ChevronRightIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        )}
      </Popover>
    </>
  )
}

function IdeaRow({ idea, checked, onToggle, onDiscard, lang, it, index }) {
  const termColor = idea.industry ? colorForTerm(idea.industry) : null
  const zebra = index % 2 === 1
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 1, borderRadius: 1.5,
      bgcolor: checked ? 'rgba(var(--accent-rgb,59,130,246),0.06)' : zebra ? 'var(--surface, rgba(255,255,255,0.02))' : 'transparent',
      border: '1px solid', borderColor: checked ? 'rgba(var(--accent-rgb,59,130,246),0.25)' : 'var(--border, rgba(255,255,255,0.07))',
      transition: 'all 0.15s',
      '&:hover': { bgcolor: checked ? 'rgba(var(--accent-rgb,59,130,246),0.09)' : 'var(--item-hover, rgba(255,255,255,0.03))' },
    }}>
      <Checkbox size="small" checked={checked} onChange={() => onToggle(idea._id)}
        sx={{ p: 0.5, color: 'var(--text-muted)', '&.Mui-checked': { color: ACCENT } }} />
      <Box component="img" src={`https://www.google.com/s2/favicons?domain=${idea.domain}&sz=32`} alt=""
        sx={{ width: 18, height: 18, borderRadius: 0.5, flexShrink: 0, opacity: 0.9 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            component="a" href={idea.url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            sx={{
              fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.25,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: 'none', '&:hover': { color: ACCENT, textDecoration: 'underline' },
            }}>
            {idea.domain}
          </Typography>
          <OpenInNewIcon sx={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, opacity: 0.6 }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          {idea.industry && (
            <Box sx={{
              px: 0.6, py: 0.05, borderRadius: 0.6, flexShrink: 0,
              bgcolor: `${termColor}1a`, border: `1px solid ${termColor}44`,
            }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: termColor }}>
                {idea.industry}
              </Typography>
            </Box>
          )}
          <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.addedBy(idea.created_by || it.unknownUser)} · {relativeTime(idea.created_at, lang)}
          </Typography>
        </Box>
      </Box>
      <Tooltip title={it.discard} placement="top">
        <IconButton size="small" onClick={() => onDiscard(idea._id)}
          sx={{ p: 0.4, color: 'var(--text-muted)', '&:hover': { color: '#f87171', bgcolor: 'rgba(248,113,113,0.1)' } }}>
          <DeleteOutlineIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

const SKEL_SX = {
  bgcolor: 'var(--border)',
  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.06), transparent)' },
}

// Misma forma que IdeaRow (checkbox + favicon + dominio + chip + meta + basura)
// para que no salte el layout cuando llegan los datos reales.
function IdeaRowSkeleton({ index }) {
  const zebra = index % 2 === 1
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 1, borderRadius: 1.5,
      bgcolor: zebra ? 'var(--surface, rgba(255,255,255,0.02))' : 'transparent',
      border: '1px solid', borderColor: 'var(--border, rgba(255,255,255,0.07))',
    }}>
      <Skeleton variant="rounded" width={18} height={18} sx={SKEL_SX} />
      <Skeleton variant="rounded" width={18} height={18} sx={{ ...SKEL_SX, flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width="35%" sx={{ ...SKEL_SX, fontSize: '0.8rem' }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.2 }}>
          <Skeleton variant="rounded" width={62} height={16} sx={SKEL_SX} />
          <Skeleton variant="text" width={120} sx={{ ...SKEL_SX, fontSize: '0.68rem' }} />
        </Box>
      </Box>
      <Skeleton variant="circular" width={16} height={16} sx={{ ...SKEL_SX, flexShrink: 0 }} />
    </Box>
  )
}

// Misma forma visual que IdeaRow (favicon + dominio + línea secundaria) pero
// para un resultado YA scrapeado — así el feed en vivo durante el procesamiento
// se siente parte del mismo panel en vez de una tabla ajena pegada encima.
// A diferencia de batchProcessor.jsx no hay columnas de mensaje/plantilla —
// en Ideas todavía no se envía nada, solo se descubre la empresa.
function IdeaResultRow({ result: r, index, lang, t }) {
  const zebra = index % 2 === 1
  let domain = null
  try { domain = new URL(r.url).hostname.replace(/^www\./, '') } catch {}
  const waCount = r.all_whatsapp?.length || (r.whatsapp ? 1 : 0)
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 1, borderRadius: 1.5,
      bgcolor: zebra ? 'var(--surface, rgba(255,255,255,0.02))' : 'transparent',
      border: '1px solid var(--border, rgba(255,255,255,0.07))',
    }}>
      {domain ? (
        <Box component="img" src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt=""
          sx={{ width: 18, height: 18, borderRadius: 0.5, flexShrink: 0, opacity: 0.9 }} />
      ) : <Box sx={{ width: 18, height: 18, flexShrink: 0 }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            component="a" href={r.url} target="_blank" rel="noopener noreferrer"
            sx={{
              fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.25,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: 'none', '&:hover': { color: ACCENT, textDecoration: 'underline' },
            }}>
            {domain || r.url}
          </Typography>
          <OpenInNewIcon sx={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, opacity: 0.6 }} />
        </Box>
        {r.ok && (r.empresa !== '—' || r.industria !== '—') && (
          <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[r.empresa !== '—' && r.empresa, r.industria !== '—' && r.industria].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      {r.blacklisted ? (
        <Tooltip title={`🚫 ${r.blockReason || (lang === 'en' ? 'Blocked domain' : 'Dominio bloqueado')}`} placement="top" arrow>
          <Chip label={t.batch.chipBlocked} size="small"
            sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', height: 20, fontSize: '0.62rem', flexShrink: 0 }} />
        </Tooltip>
      ) : !r.ok ? (
        <Tooltip title={r.errorReason || (lang === 'en' ? 'Unknown error' : 'Error desconocido')} placement="top" arrow>
          <Chip label={lang === 'en' ? 'Error' : 'Error'} size="small"
            sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', height: 20, fontSize: '0.62rem', flexShrink: 0 }} />
        </Tooltip>
      ) : waCount > 0 ? (
        <Chip icon={<CheckCircleIcon sx={{ fontSize: '12px !important' }} />}
          label={lang === 'en' ? `${waCount} WhatsApp` : `${waCount} WhatsApp`} size="small"
          sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.62rem', flexShrink: 0, '& .MuiChip-icon': { color: '#4ade80' } }} />
      ) : (
        <Chip label={t.batch.chipEmpty} size="small"
          sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.12)', height: 20, fontSize: '0.62rem', flexShrink: 0 }} />
      )}
    </Box>
  )
}

export default function IdeasPanel({ isActive }) {
  const { t, lang } = useLang()
  const it = t.ideas
  const [items,    setItems]    = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)
  const [search,   setSearch]   = useState('')
  const [selectedTerms, setSelectedTerms] = useState(new Set())
  const [selectedUsers, setSelectedUsers] = useState(new Set())
  const [sortDir,  setSortDir]  = useState('desc') // 'desc' = más reciente primero
  const [loading,  setLoading]  = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'error' })
  const notify = (message, severity = 'error') => setSnack({ open: true, message, severity })
  const debounceRef = useRef(null)
  const scrapeJob = useScrapeJob('ideas')

  const load = useCallback((p, s, termSet, userSet, dir, limit) => {
    setLoading(true)
    setLoadError(null)
    const qs = new URLSearchParams({ page: String(p), limit: String(limit || PAGE_SIZE), sort: dir || 'desc' })
    if (s) qs.set('search', s)
    if (termSet && termSet.size > 0) qs.set('terms', [...termSet].join(','))
    if (userSet && userSet.size > 0) qs.set('users', [...userSet].join(','))
    authFetch(`/api/ideas?${qs.toString()}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then(d => { setItems(d.items || []); setTotal(d.total || 0) })
      .catch(e => { setItems([]); setTotal(0); setLoadError(e.message) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(1, '', new Set(), new Set(), 'desc', PAGE_SIZE) }, [load])

  // Cuando un scrape job lanzado desde aquí termina, las ideas procesadas ya se
  // borraron solas del lado del backend (ver pipeline.py) — recargar para que
  // desaparezcan de la lista sin que el usuario tenga que refrescar a mano.
  const prevDoneRef = useRef(false)
  useEffect(() => {
    if (scrapeJob.done && !prevDoneRef.current) {
      load(1, search, selectedTerms, selectedUsers, sortDir, rowsPerPage)
      setSelected(new Set())
      setPage(1)
    }
    prevDoneRef.current = scrapeJob.done
  }, [scrapeJob.done, load, search, selectedTerms, selectedUsers, sortDir, rowsPerPage])

  function handleSearchChange(v) {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(1, v, selectedTerms, selectedUsers, sortDir, rowsPerPage), 300)
  }

  function handleTermToggle(term) {
    setSelectedTerms(prev => {
      const next = new Set(prev)
      if (next.has(term)) next.delete(term); else next.add(term)
      setPage(1)
      setSelected(new Set())
      load(1, search, next, selectedUsers, sortDir, rowsPerPage)
      return next
    })
  }

  function handleUserToggle(user) {
    setSelectedUsers(prev => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user); else next.add(user)
      setPage(1)
      setSelected(new Set())
      load(1, search, selectedTerms, next, sortDir, rowsPerPage)
      return next
    })
  }

  function handleSortToggle() {
    const next = sortDir === 'desc' ? 'asc' : 'desc'
    setSortDir(next)
    setPage(1)
    load(1, search, selectedTerms, selectedUsers, next, rowsPerPage)
  }

  function goPage(p) { setPage(p); load(p, search, selectedTerms, selectedUsers, sortDir, rowsPerPage) }

  function handleRowsPerPageChange(n) {
    setRowsPerPage(n)
    setPage(1)
    load(1, search, selectedTerms, selectedUsers, sortDir, n)
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll()     { setSelected(new Set(items.map(i => i._id))) }
  function clearSelection(){ setSelected(new Set()) }

  async function handleDiscard(id) {
    try {
      const r = await authFetch(`/api/ideas/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(it.discardError)
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
      const isLastOnPage = items.length === 1 && page > 1
      load(isLastOnPage ? page - 1 : page, search, selectedTerms, selectedUsers, sortDir, rowsPerPage)
      if (isLastOnPage) setPage(page - 1)
    } catch (e) { notify(e.message || it.discardError) }
  }

  async function handleDiscardSelected() {
    const ids = [...selected]
    if (!ids.length) return
    try {
      const r = await authFetch('/api/ideas/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!r.ok) throw new Error(it.discardError)
      setSelected(new Set())
      load(1, search, selectedTerms, selectedUsers, sortDir, rowsPerPage)
      setPage(1)
      notify(it.discardedCount(ids.length), 'success')
    } catch (e) { notify(e.message || it.discardError) }
  }

  async function handleProcess() {
    const urls = items.filter(i => selected.has(i._id)).map(i => i.url)
    if (!urls.length) return
    try { await scrapeJob.start(urls) } catch (e) { notify(e.message || it.processError) }
  }

  const selectedCount = selected.size
  const allSelectedOnPage = items.length > 0 && items.every(i => selected.has(i._id))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexShrink: 0, px: 2, py: 1.5, borderRadius: 2, background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.08) 0%, transparent 60%)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.12)' }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)', border: `1px solid rgba(var(--accent-rgb,59,130,246),0.3)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px rgba(var(--accent-rgb,59,130,246),0.18)',
        }}>
          <LightbulbIcon sx={{ color: ACCENT, fontSize: 19 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>
            {it.title}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            {it.subtitle}
          </Typography>
        </Box>
      </Box>

      <TextField
        size="small" fullWidth value={search} onChange={e => handleSearchChange(e.target.value)}
        placeholder={it.searchPh}
        slotProps={{ input: { startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted)' }} />
          </InputAdornment>
        ) } }}
        sx={{ ...FIELD_SX, mb: 1.2, flexShrink: 0 }}
      />

      {/* Filtros — dropdowns paginados (término / quién la trajo) + orden por fecha + chips de lo ya seleccionado */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 1.4, flexShrink: 0, flexWrap: 'wrap' }}>
        <FilterDropdown
          selected={selectedTerms} onToggle={handleTermToggle}
          label={it.filterByTerm} searchPh={it.termsSearchPh} noItemsLabel={it.noTerms}
          endpoint="/api/ideas/terms" itemsKey="terms" valueField="term"
        />
        <FilterDropdown
          selected={selectedUsers} onToggle={handleUserToggle}
          label={it.filterByUser} searchPh={it.usersSearchPh} noItemsLabel={it.noUsers}
          endpoint="/api/ideas/users" itemsKey="users" valueField="user"
          formatValue={v => v === UNATTRIBUTED ? it.unknownUser : v}
        />
        <Tooltip title={sortDir === 'desc' ? it.sortNewestFirst : it.sortOldestFirst} placement="top">
          <Button size="small" onClick={handleSortToggle}
            startIcon={<SwapVertIcon sx={{ fontSize: 16 }} />}
            sx={{ textTransform: 'none', fontSize: '0.78rem', fontWeight: 600, borderRadius: 1.5, color: 'var(--text-muted)',
              border: '1px solid var(--border, rgba(255,255,255,0.14))' }}>
            {sortDir === 'desc' ? it.sortNewestFirst : it.sortOldestFirst}
          </Button>
        </Tooltip>
        {[...selectedTerms].map(term => (
          <SelectedChip key={`t-${term}`} value={term} label={term} onRemove={() => handleTermToggle(term)} />
        ))}
        {[...selectedUsers].map(user => (
          <SelectedChip key={`u-${user}`} value={user} label={user === UNATTRIBUTED ? it.unknownUser : user} onRemove={() => handleUserToggle(user)} />
        ))}
      </Box>

      {/* Bulk actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.4, flexShrink: 0, flexWrap: 'wrap' }}>
        <Typography onClick={allSelectedOnPage ? clearSelection : selectAll}
          sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', '&:hover': { color: 'var(--text)' } }}>
          {allSelectedOnPage ? it.clearSelection : it.selectAll}
        </Typography>
        {selectedCount > 0 && (
          <Typography sx={{ fontSize: '0.75rem', color: ACCENT, fontWeight: 600 }}>
            {it.selectedCount(selectedCount)}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {scrapeJob.processing ? (
          <>
            <Button size="small" onClick={() => scrapeJob.paused ? scrapeJob.resume() : scrapeJob.pause()} disabled={scrapeJob.pausing}
              startIcon={scrapeJob.pausing ? <CircularProgress size={13} sx={{ color: '#fbbf24' }} /> : scrapeJob.paused ? <PlayArrowIcon sx={{ fontSize: 15 }} /> : <PauseIcon sx={{ fontSize: 15 }} />}
              sx={{ textTransform: 'none', fontSize: '0.78rem', fontWeight: 600, color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(251,191,36,0.15)' }, '&.Mui-disabled': { color: 'rgba(251,191,36,0.4)', bgcolor: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)' } }}>
              {scrapeJob.paused ? t.batch.resume : scrapeJob.pausing ? (lang === 'en' ? 'Pausing…' : 'Pausando…') : t.batch.pause}
            </Button>
            <Button size="small" onClick={scrapeJob.cancel} startIcon={<HighlightOffIcon sx={{ fontSize: 15 }} />}
              sx={{ textTransform: 'none', fontSize: '0.78rem', fontWeight: 600, color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' } }}>
              {lang === 'en' ? 'Cancel' : 'Cancelar'}
            </Button>
          </>
        ) : (
          <>
            <Button size="small" disabled={selectedCount === 0} onClick={handleDiscardSelected}
              startIcon={<DeleteOutlineIcon sx={{ fontSize: 15 }} />}
              sx={{ textTransform: 'none', fontSize: '0.78rem', fontWeight: 600, color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.15)' }, '&.Mui-disabled': { opacity: 0.3, color: '#f87171' } }}>
              {it.discardSelected}
            </Button>
            <Button size="small" variant="contained" disabled={selectedCount === 0} onClick={handleProcess}
              startIcon={<PlayArrowIcon sx={{ fontSize: 16 }} />}
              sx={{ textTransform: 'none', fontSize: '0.78rem', fontWeight: 700, bgcolor: ACCENT }}>
              {it.process}
            </Button>
          </>
        )}
      </Box>

      {/* Progreso del scrape job en curso */}
      {scrapeJob.processing && (
        <Box sx={{
          px: 2, py: 1.5, mb: 1.6, flexShrink: 0,
          bgcolor: (scrapeJob.paused || scrapeJob.pausing) ? 'rgba(251,191,36,0.05)' : 'rgba(var(--accent-rgb,59,130,246),0.05)',
          border: `1px solid ${(scrapeJob.paused || scrapeJob.pausing) ? 'rgba(251,191,36,0.2)' : 'rgba(var(--accent-rgb,59,130,246),0.15)'}`,
          borderRadius: 2, transition: 'all 0.3s',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              {scrapeJob.paused
                ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
                : <CircularProgress size={13} sx={{ color: scrapeJob.pausing ? '#fbbf24' : ACCENT }} />}
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {scrapeJob.paused
                  ? (lang === 'en' ? `Paused — ${scrapeJob.processed} of ${scrapeJob.total}` : `Pausado — ${scrapeJob.processed} de ${scrapeJob.total}`)
                  : scrapeJob.pausing
                    ? (lang === 'en' ? `Pausing… — ${scrapeJob.processed} of ${scrapeJob.total}` : `Pausando… — ${scrapeJob.processed} de ${scrapeJob.total}`)
                    : (lang === 'en' ? `Processing ${scrapeJob.processed} / ${scrapeJob.total}` : `Procesando ${scrapeJob.processed} / ${scrapeJob.total}`)}
              </Typography>
            </Box>
            <Typography sx={{ color: (scrapeJob.paused || scrapeJob.pausing) ? '#fbbf24' : ACCENT, fontWeight: 700, fontSize: '0.82rem' }}>
              {scrapeJob.progress}%
            </Typography>
          </Box>
          <LinearProgress variant="determinate" value={scrapeJob.progress}
            sx={{
              borderRadius: 4, height: 6,
              bgcolor: (scrapeJob.paused || scrapeJob.pausing) ? 'rgba(251,191,36,0.1)' : 'rgba(var(--accent-rgb,59,130,246),0.1)',
              '& .MuiLinearProgress-bar': {
                background: (scrapeJob.paused || scrapeJob.pausing)
                  ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                  : `linear-gradient(90deg, ${ACCENT}, var(--accent,#60a5fa))`,
                borderRadius: 4,
              },
            }} />
          {scrapeJob.currentUrl && !scrapeJob.paused && (
            <Typography sx={{
              mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {scrapeJob.currentUrl}
            </Typography>
          )}
        </Box>
      )}

      {/* Lista — mientras corre un scrape job se reemplaza por el feed de
         resultados en vivo, porque la cola de ideas de abajo ya quedó vieja
         (el backend recién borra las procesadas cuando el job termina, ver
         efecto de arriba) y ver ese feed es justo lo que se quiere seguir. */}
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        {scrapeJob.processing ? (
          scrapeJob.results.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.8, py: 4 }}>
              <CircularProgress size={20} sx={{ color: ACCENT }} />
              <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                {lang === 'en' ? 'Waiting for the first result…' : 'Esperando el primer resultado…'}
              </Typography>
            </Box>
          ) : (
            scrapeJob.results.map((r, index) => (
              <IdeaResultRow key={`${r.url || 'row'}-${index}`} result={r} index={index} lang={lang} t={t} />
            ))
          )
        ) : loading ? (
          Array.from({ length: Math.min(rowsPerPage, 8) }).map((_, i) => <IdeaRowSkeleton key={i} index={i} />)
        ) : loadError ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, py: 4 }}>
            <Typography sx={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 600, textAlign: 'center' }}>
              {loadError}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {lang === 'en' ? 'Try logging out and back in.' : 'Intenta cerrar sesión y volver a entrar.'}
            </Typography>
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.8, py: 4 }}>
            <LightbulbIcon sx={{ fontSize: 26, color: 'rgba(var(--accent-rgb,59,130,246),0.2)' }} />
            <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>
              {search || selectedTerms.size > 0 || selectedUsers.size > 0 ? it.noResults : it.empty}
            </Typography>
          </Box>
        ) : (
          items.map((idea, index) => (
            <IdeaRow key={idea._id} idea={idea} index={index} checked={selected.has(idea._id)} onToggle={toggle} onDiscard={handleDiscard} lang={lang} it={it} />
          ))
        )}
      </Box>

      {!scrapeJob.processing && total > 0 && (
        <TablePagination
          rowsPerPageOptions={[12, 24, 50, 100]}
          component="div"
          count={total}
          rowsPerPage={rowsPerPage}
          page={page - 1}
          onPageChange={(_, p) => goPage(p + 1)}
          onRowsPerPageChange={e => handleRowsPerPageChange(parseInt(e.target.value, 10))}
          labelRowsPerPage={t.db.rowsPerPage}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} ${t.db.displayedRowsOf} ${count}`}
          sx={{
            flexShrink: 0, color: 'var(--text-muted)',
            '& .MuiTablePagination-toolbar': { minHeight: 44, px: 0 },
            '& .MuiTablePagination-selectIcon': { color: 'var(--text-muted)' },
            '& .MuiIconButton-root': { color: 'var(--text-muted)' },
            '& .Mui-disabled': { opacity: 0.3 },
            '& .MuiSelect-select': { color: 'var(--text)' },
          }}
        />
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
