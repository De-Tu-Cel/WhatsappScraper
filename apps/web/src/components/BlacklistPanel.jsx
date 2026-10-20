'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { refreshBlacklistedPhones } from '@/lib/phoneBlacklist'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import CircularProgress from '@mui/material/CircularProgress'
import BlockIcon from '@mui/icons-material/Block'
import LockIcon from '@mui/icons-material/Lock'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LanguageIcon from '@mui/icons-material/Language'
import CategoryIcon from '@mui/icons-material/Category'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import Divider from '@mui/material/Divider'
import Checkbox from '@mui/material/Checkbox'
import Button from '@mui/material/Button'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Alert from '@mui/material/Alert'
import Skeleton from '@mui/material/Skeleton'
import TablePagination from '@mui/material/TablePagination'

const DANGER = '#ef4444'
const DANGER_SOFT = 'rgba(239,68,68,0.1)'
const DANGER_BORDER = 'rgba(239,68,68,0.3)'
const PAGE_SIZE = 10

const SUB_LABEL_SX = {
  fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--text-muted, rgba(255,255,255,0.4))', mb: 0.8,
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    fontSize: '0.88rem', bgcolor: 'var(--surface, rgba(255,255,255,0.03))',
    '& fieldset': { borderColor: 'var(--border, rgba(255,255,255,0.1))' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent, #3b82f6)' },
  },
  '& input': { color: 'var(--text, #f1f5f9)' },
  '& .MuiFormHelperText-root': { color: DANGER, fontSize: '0.68rem', mt: 0.3 },
}

// Color e ícono por categoría — se repite en la tarjeta de arriba, en la caja
// de "Nueva exclusión" y en cada fila, para que siempre sepas dónde estás.
const TYPE_META = {
  domain:   { Icon: LanguageIcon, color: 'var(--accent, #3b82f6)', rgb: 'var(--accent-rgb,59,130,246)' },
  industry: { Icon: CategoryIcon, color: '#a855f7', rgb: '168,85,247' },
  phone:    { Icon: WhatsAppIcon, color: DANGER, rgb: '239,68,68' },
}

function TypeIcon({ type, size = 30 }) {
  const { Icon, color, rgb } = TYPE_META[type] || TYPE_META.domain
  return (
    <Box sx={{
      width: size, height: size, borderRadius: `${Math.round(size * 0.3)}px`, flexShrink: 0,
      background: `linear-gradient(135deg, rgba(${rgb},0.24) 0%, rgba(${rgb},0.08) 100%)`,
      border: `1px solid rgba(${rgb},0.32)`, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center', '& svg': { fontSize: Math.round(size * 0.55) },
    }}>
      <Icon />
    </Box>
  )
}

function AddRow({ value, onChange, onAdd, error, placeholder, label, adding }) {
  return (
    <Box component="form" onSubmit={event => { event.preventDefault(); onAdd() }} sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      <TextField
        size="small" fullWidth
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={adding}
        error={!!error}
        helperText={error || ''}
        slotProps={{ htmlInput: { 'aria-label': label } }}
        sx={{ ...FIELD_SX, '& .MuiOutlinedInput-root': { ...FIELD_SX['& .MuiOutlinedInput-root'], minHeight: 42, '& fieldset': { borderColor: error ? DANGER : 'var(--border, rgba(255,255,255,0.1))' }, '&.Mui-focused fieldset': { borderColor: error ? DANGER : 'var(--accent, #3b82f6)' } } }}
      />
      <Button type="submit" variant="contained" disableElevation fullWidth disabled={!value.trim() || adding} startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
        sx={{ textTransform: 'none', fontWeight: 700, minHeight: 40, borderRadius: '10px', '&.Mui-disabled': { bgcolor: 'var(--item-hover)', color: 'var(--text-muted)' } }}>
        {label}
      </Button>
    </Box>
  )
}

// "Agregado el 12 oct 2026" — reemplaza la columna "Estado: Excluido", que
// decía lo mismo en todas las filas.
function addedOn(iso, en) {
  if (!iso) return ''
  const d = new Date(String(iso).endsWith('Z') || String(iso).includes('+') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(en ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

// What an industry entry would actually block. The app assigns its own fixed
// industry names ("Gas LP / Energía", "Cerrajero"…), so free text like
// "farmacia" or "gaseras" silently matched nothing — this shows the real names
// (with company counts) and, while typing, exactly which ones would be hit.
function IndustryPreview({ value, onPick }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [data, setData] = useState({ industries: [], matches: [], byName: { companies: 0, examples: [] } })
  const [pending, setPending] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setPending(true); setError(false)
    const id = setTimeout(() => {
      authFetch(`/api/blacklist/industry-preview?value=${encodeURIComponent(value.trim())}`, { signal: controller.signal })
        .then(r => { if (!r.ok) throw new Error('load'); return r.json() })
        .then(d => { if (!controller.signal.aborted) setData({ industries: d.industries || [], matches: d.matches || [], byName: d.by_name || { companies: 0, examples: [] } }) })
        .catch(() => { if (!controller.signal.aborted) setError(true) })
        .finally(() => { if (!controller.signal.aborted) setPending(false) })
    }, 250)
    return () => { clearTimeout(id); controller.abort() }
  }, [value])

  const typed = value.trim()
  const byName = data.byName.companies
  const total = data.matches.reduce((n, m) => n + m.companies, 0) + byName
  const hit = data.matches.length > 0 || byName > 0
  const chip = (i, hit) => (
    <Box key={i.industry} component="button" type="button" onClick={() => onPick(i.industry)}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: .75, px: 1.25, py: .65, borderRadius: '8px', cursor: 'pointer',
        fontSize: '.78rem', fontFamily: 'inherit', border: `1px solid ${hit ? DANGER_BORDER : 'var(--border, rgba(255,255,255,0.12))'}`,
        bgcolor: hit ? DANGER_SOFT : 'transparent', color: hit ? DANGER : 'var(--text-muted, rgba(255,255,255,0.6))',
        '&:hover': { borderColor: DANGER_BORDER, color: DANGER },
      }}>
      {i.industry}<Box component="span" sx={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{i.companies}</Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {pending && <Typography sx={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>{en ? 'Updating preview…' : 'Actualizando vista previa…'}</Typography>}
      {error && <Typography sx={{ fontSize: '.78rem', color: 'error.main' }}>{en ? 'The impact preview is unavailable.' : 'No se pudo calcular la vista previa.'}</Typography>}
      {typed && !pending && !error && (
        <Typography sx={{ fontSize: '0.7rem', color: hit ? DANGER : '#f59e0b', fontWeight: 600, lineHeight: 1.5 }}>
          {hit
            ? (en ? `Would block ${total} compan${total === 1 ? 'y' : 'ies'}` : `Bloquearía ${total} empresa${total === 1 ? '' : 's'}`)
              + (data.matches.length ? (en ? ' — industry: ' : ' — industria: ') + data.matches.map(m => m.industry).join(', ') : '')
              + (byName ? (en ? ` — by name: ${byName} (e.g. ${data.byName.examples.join(', ')})` : ` — por nombre: ${byName} (ej. ${data.byName.examples.join(', ')})`) : '')
            : (en ? `"${typed}" matches no industry or business name of your companies yet.`
                  : `«${typed}» todavía no coincide con la industria ni con el nombre de ninguna de tus empresas.`)}
        </Typography>
      )}
      {data.industries.length > 0 && !pending && !error && (
        <>
          <Typography sx={{ fontSize: '0.64rem', color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>
            {en ? 'Industries of your companies (click to use):' : 'Industrias de tus empresas (clic para usarla):'}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, maxHeight: 180, overflowY: 'auto' }}>
            {data.industries.slice(0, 24).map(i => chip(i, data.matches.some(m => m.industry === i.industry)))}
          </Box>
        </>
      )}
    </Box>
  )
}

function EntryRow({ entry, onDelete, onSave, dupError, genericError }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(entry.value)
  const [err, setErr] = useState('')

  async function save() {
    const v = val.trim()
    if (!v || v === entry.value) { setEditing(false); setVal(entry.value); return }
    setErr('')
    const ok = await onSave(entry._id, v, setErr)
    if (ok) setEditing(false)
  }

  return (
    <Box data-blacklist-entry sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 1.25, md: 2 }, py: .8, minHeight: 54,
      borderBottom: '1px solid var(--border)',
      transition: 'background-color 0.15s',
      '&:hover': { bgcolor: 'var(--item-hover)' },
    }}>
      <TypeIcon type={entry.type} size={30} />
      {editing ? (
        <TextField
          size="small" autoFocus fullWidth value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setVal(entry.value) } }}
          error={!!err} helperText={err || ''}
          sx={{ ...FIELD_SX, '& .MuiOutlinedInput-input': { py: 0.5 } }}
        />
      ) : (
        <Typography title={entry.value} sx={{ fontSize: '.9rem', fontWeight: 600, color: 'var(--text)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {entry.value}
        </Typography>
      )}
      {!editing && <Box component="span" sx={{ display: { xs: 'none', sm: 'block' }, width: 120, flexShrink: 0, color: 'var(--text-muted)', fontSize: '.74rem', fontVariantNumeric: 'tabular-nums' }}>{addedOn(entry.created_at, en) || '—'}</Box>}
      <Box sx={{ display: 'flex', gap: .5, flexShrink: 0, '& .MuiIconButton-root': { width: 32, height: 32, borderRadius: '8px', border: '1px solid var(--border)', bgcolor: 'var(--surface)' } }}>
      {editing ? (
        <>
          <IconButton aria-label={en ? 'Save rule' : 'Guardar regla'} size="small" onClick={save} sx={{ p: 0.8, color: 'var(--accent)' }}>
            <CheckIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton aria-label={en ? 'Cancel editing' : 'Cancelar edición'} size="small" onClick={() => { setEditing(false); setVal(entry.value); setErr('') }}
            sx={{ p: 0.8, color: 'var(--text-muted)' }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton aria-label={en ? `Edit ${entry.value}` : `Editar ${entry.value}`} size="small" onClick={() => setEditing(true)}
            sx={{ p: 0.8, color: 'var(--text-muted)', '&:hover': { color: 'var(--accent)' } }}>
            <EditIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton aria-label={en ? `Remove ${entry.value}` : `Eliminar ${entry.value}`} size="small" onClick={() => onDelete(entry._id)}
            sx={{ p: 0.8, color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: 'rgba(239,68,68,0.12)' } }}>
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </>
      )}
      </Box>
    </Box>
  )
}

const TABLE_PAGE_SIZE = 8

function BlockedPill({ bl }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.8, py: 0.2, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>
      <BlockIcon sx={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }} />
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
        {bl.alreadyBlocked}
      </Typography>
    </Box>
  )
}

// Mismo lenguaje de "tag" de estado que ya usa el picker de Recipients
// (pill "No seleccionado"/"Seleccionado") — aquí en rojo porque el estado
// que confirma es "se va a bloquear", no "se va a mensajear".
function StatusPill({ bl, blocked, checked }) {
  if (blocked) return <BlockedPill bl={bl} />
  return (
    <Box sx={{
      flexShrink: 0, px: 1, py: 0.35, borderRadius: 999,
      bgcolor: checked ? DANGER_SOFT : 'rgba(255,255,255,0.05)',
      border: `1px solid ${checked ? DANGER_BORDER : 'rgba(255,255,255,0.1)'}`,
    }}>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: checked ? DANGER : 'var(--text-muted, rgba(255,255,255,0.4))', whiteSpace: 'nowrap' }}>
        {checked ? bl.selectedPill : bl.notSelectedPill}
      </Typography>
    </Box>
  )
}

// Tabla real (con checkboxes, tipo la de prospectos) de las empresas/números
// YA scrapeados — para bloquear varios de un jalón con un solo clic en vez de
// teclear cada número. Solo tiene sentido para type="phone" (dominios/
// industrias no viven en la colección contacts). Sin buscar nada, navega los
// más recientes; el buscador filtra por nombre de empresa o dígitos del tel.
function ContactBlockTable({ bl, onBlocked, isActive }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [term,      setTerm]      = useState('')
  const [groups,    setGroups]    = useState([])  // [{company_id, company_name, numbers:[{contact_id,number,is_blocked}]}]
  const [total,     setTotal]     = useState(0)   // total distinct companies matching, not raw numbers
  const [page,      setPage]      = useState(1)
  const [loading,   setLoading]   = useState(true)
  const [expanded,  setExpanded]  = useState(new Set())  // company_ids currently expanded
  const [selected,  setSelected]  = useState(new Set())  // contact_ids selected to block
  const contactCache = useRef(new Map())
  const [blocking,  setBlocking]  = useState(false)
  const [error, setError] = useState('')
  const [blockError, setBlockError] = useState('')
  const debounceRef = useRef(null)
  const requestRef = useRef(null)

  const load = useCallback((p, q) => {
    requestRef.current?.abort()
    const current = new AbortController(); requestRef.current = current
    setError('')
    setLoading(true)
    const qs = new URLSearchParams({ page: String(p), limit: String(TABLE_PAGE_SIZE) })
    if (q) qs.set('q', q)
    authFetch(`/api/contacts/search?${qs.toString()}`, { signal: current.signal })
      .then(r => { if (!r.ok) throw new Error('load'); return r.json() })
      .then(d => {
        if (current.signal.aborted) return
        if (!Array.isArray(d.items) || typeof d.total !== 'number') throw new Error('shape')
        // Defensive: normalize so every group always has a real numbers[]
        // regardless of anything odd the API returns (a malformed/partial
        // group here used to crash the whole panel on `.is_blocked`).
        const seenIds = new Set()
        const clean = (d.items || [])
          .filter(Boolean)
          .map(g => ({ ...g, numbers: Array.isArray(g.numbers) ? g.numbers.filter(Boolean) : [] }))
          .filter(g => g.numbers.length > 0)
          // Belt-and-suspenders: the backend now dedupes company_id before
          // grouping, but if a stale/cached response ever slips through with
          // a repeated id, drop the repeat here instead of crashing the tree.
          .filter(g => (seenIds.has(g.company_id) ? false : (seenIds.add(g.company_id), true)))
        setGroups(clean)
        clean.forEach(group => group.numbers.forEach(number => contactCache.current.set(number.contact_id, { ...number, company_id: group.company_id, company_name: group.company_name, company_domain: group.company_domain })))
        // Refresh visible contacts without discarding selections on other pages.
        const blockedIds = new Set(clean.flatMap(group => group.numbers.filter(number => number.is_blocked).map(number => number.contact_id)))
        if (blockedIds.size) setSelected(previous => new Set([...previous].filter(id => !blockedIds.has(id))))
        setTotal(d.total || 0)
      })
      .catch(() => { if (!current.signal.aborted) setError(en ? 'Could not load contacts.' : 'No se pudieron cargar los contactos.') })
      .finally(() => { if (requestRef.current === current) setLoading(false) })
  }, [en])

  useEffect(() => { load(1, ''); return () => { requestRef.current?.abort(); clearTimeout(debounceRef.current) } }, [load])
  // isActive se recibía pero nunca se usaba — cambiar de pestaña y volver no
  // refrescaba nada, a diferencia de databaseViewer.jsx que sí reacciona a
  // esto. Si otro agente bloqueaba/desbloqueaba un número mientras este panel
  // seguía montado, se quedaba desactualizado indefinidamente (audit finding,
  // 2026-09-30).
  useEffect(() => {
    if (isActive) load(page, term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  function handleSearchChange(v) {
    setTerm(v)
    setExpanded(new Set())
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setPage(1); load(1, v.trim()) }, 300)
  }

  function goPage(p) {
    setPage(p)
    setExpanded(new Set())
    load(p, term.trim())
  }

  const allNumbers = groups.flatMap(g => g.numbers)
  const selectableNumbers = allNumbers.filter(n => !n.is_blocked)
  const allSelected = selectableNumbers.length > 0 && selectableNumbers.every(n => selected.has(n.contact_id))

  function toggleAll() {
    setSelected(previous => {
      const next = new Set(previous)
      selectableNumbers.forEach(number => allSelected ? next.delete(number.contact_id) : next.add(number.contact_id))
      return next
    })
  }

  function toggleExpand(companyId) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(companyId) ? next.delete(companyId) : next.add(companyId)
      return next
    })
  }

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Selecting a company selects every one of its (non-blocked) numbers at
  // once — matches the Recipients picker's "check the whole company" pattern.
  function toggleCompany(group) {
    const ids = group.numbers.filter(n => !n.is_blocked).map(n => n.contact_id)
    const allOn = ids.length > 0 && ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      ids.forEach(id => allOn ? next.delete(id) : next.add(id))
      return next
    })
  }

  async function handleBlockSelected() {
    const toBlock = [...selected].map(id => contactCache.current.get(id)).filter(number => number && !number.is_blocked)
    if (toBlock.length === 0 || blocking) return
    setBlocking(true)
    setBlockError('')
    try {
      const outcomes = await Promise.allSettled(toBlock.map(async n => {
        const response = await authFetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'phone', value: n.number }),
        })
        return response.ok || response.status === 409
      }))
      const failed = toBlock.filter((_, i) => outcomes[i].status !== 'fulfilled' || !outcomes[i].value)
      setSelected(new Set(failed.map(n => n.contact_id)))
      if (failed.length) setBlockError(en ? `${failed.length} ${failed.length === 1 ? 'number could' : 'numbers could'} not be blocked. Your selection was kept so you can retry.` : `${failed.length === 1 ? 'No se pudo bloquear 1 número' : `No se pudieron bloquear ${failed.length} números`}. Conservamos su selección para reintentar.`)
      if (failed.length < toBlock.length) {
        load(page, term.trim()); refreshBlacklistedPhones(); onBlocked?.()
      }
    } finally {
      setBlocking(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE))
  const selectedContacts = [...selected].map(id => contactCache.current.get(id)).filter(Boolean)
  const selectedCompanies = new Map()
  selectedContacts.forEach(number => {
    // Use the company identity: two unrelated businesses may share a scraped name.
    const key = number.company_id || number.company_domain || number.contact_id
    if (!selectedCompanies.has(key)) selectedCompanies.set(key, { key, name: number.company_name, numbers: [] })
    selectedCompanies.get(key).numbers.push(number)
  })

  return (
    <Box data-blacklist-contacts>
      <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', mb: 1 }}>{en ? 'Choose numbers to block' : 'Elige números para bloquear'}</Typography>
      <Typography sx={{ fontSize: '.82rem', color: 'var(--text-muted)', mb: 2 }}>{en ? 'Select whole companies or expand them to choose individual numbers.' : 'Selecciona empresas completas o despliégalas para elegir números individuales.'}</Typography>
      {error && <Alert severity="error" sx={{ mb: 1.5 }} action={<Button color="inherit" onClick={() => load(page, term.trim())}>{en ? 'Retry' : 'Reintentar'}</Button>}>{error}</Alert>}
      {blockError && <Alert severity="error" sx={{ mb: 1.5 }}>{blockError}</Alert>}

      {/* Una sola tarjeta contenedora — buscador, tabla y barra de acción
         quedan visualmente unidos en vez de flotar como piezas sueltas. */}
      <Box sx={{
        borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
        bgcolor: 'var(--surface, rgba(255,255,255,0.018))', overflow: 'hidden',
      }}>
        <Box sx={{ p: 1.2, pb: 1, borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))' }}>
          <TextField
            size="small" fullWidth disabled={blocking} value={term} onChange={e => handleSearchChange(e.target.value)}
            placeholder={bl.contactSearchPh}
            slotProps={{ htmlInput: { 'aria-label': bl.contactSearchPh }, input: { startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted, rgba(255,255,255,0.4))' }} /></InputAdornment>
            ) } }}
            sx={FIELD_SX}
          />
        </Box>

        <Box aria-busy={loading} sx={{ minHeight: { xs: 320, md: 420 }, maxHeight: { xs: 480, md: 560 }, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, '& > [data-blacklist-contact-company]': { flexShrink: 0 } }}>
          {loading ? (
            <Box role="status" aria-label={en ? 'Loading companies and numbers' : 'Cargando empresas y números'} sx={{ display: 'grid', gap: 1, '& .MuiSkeleton-root': { bgcolor: 'var(--item-hover)' }, '@media (prefers-reduced-motion: reduce)': { '& .MuiSkeleton-root::after': { animation: 'none' } } }}>
              {[0,1,2,3,4].map(index => <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, minHeight: 68, border: '1px solid var(--border)', borderRadius: '12px' }}>
                <Skeleton animation="wave" variant="rounded" width={20} height={20} />
                <Box sx={{ flex: 1, minWidth: 0 }}><Skeleton animation="wave" variant="rounded" width={`${[58,72,46,64,52][index]}%`} height={13} /><Skeleton animation="wave" variant="rounded" width="35%" height={9} sx={{ mt: 1 }} /></Box>
                <Skeleton animation="wave" variant="rounded" width={82} height={24} sx={{ display: { xs: 'none', sm: 'block' } }} />
              </Box>)}
            </Box>
          ) : !error && groups.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, py: 3.5 }}>
              <BlockIcon sx={{ fontSize: 18, color: 'rgba(239,68,68,0.2)' }} />
              <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted, rgba(255,255,255,0.35))', fontStyle: 'italic' }}>
                {bl.noResults}
              </Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.6, pb: 0.2 }}>
                <Checkbox size="small" checked={allSelected} indeterminate={selectableNumbers.some(number => selected.has(number.contact_id)) && !allSelected}
                  onChange={toggleAll} disabled={selectableNumbers.length === 0 || blocking}
                  slotProps={{ input: { 'aria-label': en ? 'Select this page' : 'Seleccionar esta página' } }}
                  sx={{ p: 0.4, color: 'var(--text-muted)', '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: DANGER } }} />
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  {en ? 'Select this page' : 'Seleccionar esta página'}
                </Typography>
              </Box>

              {groups.map(g => {
                const single = g.numbers.length === 1
                const isExpanded = expanded.has(g.company_id)
                const companyIds = g.numbers.filter(n => !n.is_blocked).map(n => n.contact_id)
                const companyChecked = companyIds.length > 0 && companyIds.every(id => selected.has(id))
                const companyIndeterminate = !companyChecked && companyIds.some(id => selected.has(id))
                const soleChecked = single && selected.has(g.numbers[0]?.contact_id)
                return (
                  <Box key={g.company_id} data-blacklist-contact-company sx={{
                    borderRadius: 2, border: '1px solid var(--border, rgba(255,255,255,0.08))',
                    bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
                  }}>
                    <Box
                      onClick={() => !blocking && (single ? (!g.numbers[0].is_blocked && toggleOne(g.numbers[0].contact_id)) : toggleExpand(g.company_id))}
                      sx={{
                        display: 'flex', flexWrap: { xs: 'wrap', sm: 'nowrap' }, alignItems: 'center', gap: 1.1, px: 1.2, py: 1.2, cursor: 'pointer',
                        transition: 'background 0.1s',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.035)' },
                      }}>
                      <Checkbox size="small"
                        slotProps={{ input: { 'aria-label': `${en ? 'Select' : 'Seleccionar'} ${g.company_name}` } }}
                        checked={single ? soleChecked : companyChecked}
                        indeterminate={!single && companyIndeterminate}
                        disabled={blocking || (single ? g.numbers[0].is_blocked : companyIds.length === 0)}
                        onClick={e => e.stopPropagation()}
                        onChange={() => single ? toggleOne(g.numbers[0].contact_id) : toggleCompany(g)}
                        sx={{ p: 0.4, flexShrink: 0, color: 'var(--text-muted)', '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: DANGER } }} />

                      <Box sx={{ flex: { xs: '1 1 calc(100% - 40px)', sm: 1 }, minWidth: 0, py: 0.15 }}>
                        <Typography sx={{ fontSize: '0.84rem', lineHeight: 1.35, fontWeight: 700, color: 'var(--text, white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.company_name}
                        </Typography>
                        {g.company_domain && (
                          <Typography sx={{ fontSize: '0.72rem', lineHeight: 1.35, mt: 0.15, color: 'var(--text-muted, rgba(255,255,255,0.4))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {g.company_domain}
                          </Typography>
                        )}
                      </Box>

                      {single ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexShrink: 0 }}>
                          <WhatsAppIcon sx={{ fontSize: 14, color: soleChecked ? DANGER : 'rgba(255,255,255,0.3)' }} />
                          <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted, rgba(255,255,255,0.65))', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {g.numbers[0].number}
                          </Typography>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                          <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', whiteSpace: 'nowrap' }}>
                            {g.numbers.length} {bl.numbersCount}
                          </Typography>
                          <ExpandMoreIcon sx={{ fontSize: 16, color: 'var(--text-muted, rgba(255,255,255,0.4))', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                        </Box>
                      )}

                      <StatusPill bl={bl} blocked={single && g.numbers[0].is_blocked} checked={single ? soleChecked : companyChecked} />
                    </Box>

                    {!single && isExpanded && (
                      <Box sx={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.06))', bgcolor: 'rgba(255,255,255,0.012)' }}>
                        {g.numbers.map(n => (
                          <Box key={n.contact_id}
                            onClick={() => !blocking && !n.is_blocked && toggleOne(n.contact_id)}
                            sx={{
                              display: 'flex', alignItems: 'center', gap: 1.1, pl: 4, pr: 1.2, py: 0.7,
                              cursor: n.is_blocked ? 'default' : 'pointer',
                              opacity: n.is_blocked ? 0.5 : 1,
                              '&:hover': n.is_blocked ? {} : { bgcolor: 'rgba(255,255,255,0.03)' },
                            }}>
                            <Checkbox size="small" checked={selected.has(n.contact_id)} disabled={blocking || n.is_blocked}
                              slotProps={{ input: { 'aria-label': `${en ? 'Select' : 'Seleccionar'} ${n.number}` } }}
                              onClick={e => e.stopPropagation()} onChange={() => toggleOne(n.contact_id)}
                              sx={{ p: 0.3, flexShrink: 0, color: 'var(--text-muted)', '&.Mui-checked': { color: DANGER } }} />
                            <WhatsAppIcon sx={{ fontSize: 13, color: selected.has(n.contact_id) ? DANGER : 'rgba(255,255,255,0.25)' }} />
                            <Typography sx={{ flex: 1, fontSize: '0.78rem', color: 'var(--text-muted, rgba(255,255,255,0.7))', fontVariantNumeric: 'tabular-nums' }}>
                              {n.number}
                            </Typography>
                            <StatusPill bl={bl} blocked={n.is_blocked} checked={selected.has(n.contact_id)} />
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                )
              })}
            </>
          )}
        </Box>

        <Box data-blacklist-selection sx={{ px: 2, py: 1.5, borderTop: '1px solid var(--border)', bgcolor: 'rgba(var(--accent-rgb),.04)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--text)' }}>{en ? 'Your selection' : 'Tu selección'} <Box component="span" sx={{ ml: .75, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{selectedContacts.length}</Box></Typography>
            {selected.size > 0 && <Button size="small" disabled={blocking} onClick={() => setSelected(new Set())} sx={{ textTransform: 'none', color: 'var(--text-muted)' }}>{en ? 'Clear selection' : 'Limpiar selección'}</Button>}
          </Box>
          {selectedContacts.length ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2,minmax(0,1fr))', xl: 'repeat(3,minmax(0,1fr))' }, gap: 1, maxHeight: 210, overflowY: 'auto' }}>
            {[...selectedCompanies.values()].map(company => <Box key={company.key} data-selected-company sx={{ border: '1px solid var(--border)', borderRadius: '10px', bgcolor: 'var(--card-bg)', minWidth: 0, alignSelf: 'start', overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1, borderBottom: '1px solid var(--border)', bgcolor: 'rgba(var(--accent-rgb),.04)' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ color: 'var(--text)', fontSize: '.82rem', fontWeight: 700, overflowWrap: 'anywhere' }}>{company.name}</Typography><Typography sx={{ color: 'var(--text-muted)', fontSize: '.7rem', mt: .25 }}>{company.numbers.length} {en ? (company.numbers.length === 1 ? 'number' : 'numbers') : (company.numbers.length === 1 ? 'número' : 'números')}</Typography></Box>
                <IconButton size="small" disabled={blocking} aria-label={`${en ? 'Remove company from selection' : 'Quitar empresa de la selección'} ${company.name}`} onClick={() => setSelected(previous => { const next = new Set(previous); company.numbers.forEach(number => next.delete(number.contact_id)); return next })} sx={{ color: 'var(--text-muted)' }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
              </Box>
              {company.numbers.map(number => <Box key={number.contact_id} data-selected-contact sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: .7 }}>
                <WhatsAppIcon sx={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0 }} />
                <Typography sx={{ flex: 1, minWidth: 0, color: 'var(--text)', fontSize: '.8rem', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}>{number.number}</Typography>
                <IconButton size="small" disabled={blocking} aria-label={`${en ? 'Remove from selection' : 'Quitar de la selección'} ${number.number}`} onClick={() => toggleOne(number.contact_id)} sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--accent)', bgcolor: 'var(--item-hover)' } }}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
              </Box>)}
            </Box>)}
          </Box> : <Typography sx={{ color: 'var(--text-muted)', fontSize: '.78rem', py: .5 }}>{en ? 'Selected numbers will appear here before you block them.' : 'Aquí verás los números que elijas antes de bloquearlos.'}</Typography>}
        </Box>

        {/* Barra de acción — parte de la misma tarjeta, no una pieza aparte */}
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          px: 1.2, py: 0.9, borderTop: '1px solid var(--border, rgba(255,255,255,0.07))',
          bgcolor: 'rgba(255,255,255,0.015)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2 }}>
            <IconButton aria-label={en ? 'Previous contacts' : 'Contactos anteriores'} size="small" disabled={page <= 1 || blocking || loading} onClick={() => goPage(page - 1)}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.2 } }}>
              <ChevronLeftIcon sx={{ fontSize: 17 }} />
            </IconButton>
            <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, px: 0.6, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {page} / {totalPages} · {total.toLocaleString()} {en ? 'companies' : 'empresas'}
            </Typography>
            <IconButton aria-label={en ? 'Next contacts' : 'Siguientes contactos'} size="small" disabled={page >= totalPages || blocking || loading} onClick={() => goPage(page + 1)}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.2 } }}>
              <ChevronRightIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          {selected.size > 0 && <Typography role="status" sx={{ fontSize: '.82rem', color: 'var(--text)', fontWeight: 600 }}>{selected.size} {en ? (selected.size === 1 ? 'number selected' : 'numbers selected') : (selected.size === 1 ? 'número seleccionado' : 'números seleccionados')}</Typography>}
          <Button
            size="small" disabled={selected.size === 0 || blocking || loading || !!error} onClick={handleBlockSelected}
            startIcon={blocking ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <BlockIcon sx={{ fontSize: 14 }} />}
            sx={{
              textTransform: 'none', fontWeight: 700, fontSize: '0.76rem', borderRadius: 1.8, px: 1.6, py: 0.5,
              color: '#fff', bgcolor: DANGER, boxShadow: selected.size > 0 ? '0 0 12px rgba(239,68,68,0.25)' : 'none',
              '&:hover': { bgcolor: '#dc2626' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.2)' },
            }}>
            {bl.blockSelected}{selected.size > 0 ? ` · ${selected.size}` : ''}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}


const PANEL_SX = { p: { xs: 1.5, md: 2.5 }, border: '1px solid var(--border)', borderRadius: '16px', bgcolor: 'var(--card-bg)', minWidth: 0 }

function BlacklistList({ type, label, placeholder, tip, bl, isActive, onChanged, count }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [addVal, setAddVal] = useState('')
  const [addErr, setAddErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [phoneView, setPhoneView] = useState('blocked')
  const requestRef = useRef(null)
  const addLock = useRef(false)
  const addLabel = type === 'domain' ? (en ? 'Add domain' : 'Agregar dominio') : (en ? 'Add industry' : 'Agregar industria')
  const load = useCallback(async (p, term) => {
    requestRef.current?.abort()
    const current = new AbortController(); requestRef.current = current
    setLoading(true); setLoadError('')
    try {
      const qs = new URLSearchParams({ type, page: String(p + 1), limit: String(pageSize), search: term })
      const response = await authFetch(`/api/blacklist?${qs}`, { signal: current.signal })
      if (!response.ok) throw new Error('load')
      const data = await response.json()
      if (!Array.isArray(data.items) || typeof data.total !== 'number') throw new Error('shape')
      if (!current.signal.aborted) { setItems(data.items); setTotal(data.total) }
    } catch {
      if (!current.signal.aborted) setLoadError(en ? 'Could not load the rules. Try again.' : 'No se pudieron cargar las reglas. Inténtalo de nuevo.')
    } finally { if (requestRef.current === current) setLoading(false) }
  }, [type, pageSize, en])
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (isActive !== false) load(page, query)
    return () => requestRef.current?.abort()
  }, [isActive, load, page, query])

  async function handleAdd() {
    const value = addVal.trim()
    if (!value || addLock.current) return
    addLock.current = true; setAdding(true); setAddErr('')
    try {
      const response = await authFetch('/api/blacklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, value }) })
      if (!response.ok) { setAddErr(response.status === 409 ? bl.dupError : bl.addError); return }
      setAddVal(''); setPage(0); load(0, query); onChanged(); refreshBlacklistedPhones()
    } catch { setAddErr(bl.addError) }
    finally { addLock.current = false; setAdding(false) }
  }
  async function handleSave(id, value, setRowError) {
    try {
      const response = await authFetch(`/api/blacklist/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
      if (!response.ok) { setRowError(response.status === 409 ? bl.dupError : bl.addError); return false }
      load(page, query); onChanged(); refreshBlacklistedPhones(); return true
    } catch { setRowError(bl.addError); return false }
  }
  async function handleDelete(id) {
    try {
      const response = await authFetch(`/api/blacklist/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('delete')
      const nextPage = items.length === 1 && page > 0 ? page - 1 : page
      setPage(nextPage); load(nextPage, query); onChanged(); refreshBlacklistedPhones()
    } catch { setLoadError(bl.deleteError) }
  }
  const blockedList = <Box data-blacklist-list sx={{ ...PANEL_SX, p: { xs: 1.5, md: 2 } }}>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
      <Box sx={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
        <TypeIcon type={type} size={34} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '.98rem', fontWeight: 800, color: 'var(--text)' }}>{type === 'phone' ? (en ? 'Blocked numbers' : 'Números bloqueados') : (en ? 'Saved exclusions' : 'Exclusiones guardadas')}</Typography>
          <Typography sx={{ fontSize: '.74rem', color: 'var(--text-muted)', mt: .2 }}>{loading ? (en ? 'Loading…' : 'Cargando…') : `${total.toLocaleString()} ${query ? (en ? 'results' : 'resultados') : (en ? (total === 1 ? 'rule' : 'rules') : (total === 1 ? 'regla' : 'reglas'))}`}</Typography>
        </Box>
      </Box>
      <TextField size="small" placeholder={type === 'phone' ? (en ? 'Search blocked numbers' : 'Buscar números bloqueados') : (en ? 'Search saved rules' : 'Buscar reglas guardadas')} value={search} onChange={event => setSearch(event.target.value)}
        slotProps={{ htmlInput: { 'aria-label': type === 'phone' ? (en ? 'Search blocked numbers' : 'Buscar números bloqueados') : (en ? 'Search saved rules' : 'Buscar reglas guardadas') }, input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'var(--text-muted)' }} /></InputAdornment> } }} sx={{ ...FIELD_SX, flex: '1 1 240px', maxWidth: { xs: '100%', md: 340 } }} />
    </Box>
    {loadError && <Alert severity="error" action={<Button onClick={() => load(page, query)} color="inherit" size="small">{en ? 'Retry' : 'Reintentar'}</Button>} sx={{ mb: 1.5 }}>{loadError}</Alert>}
    {loading ? <Box aria-label={en ? 'Loading rules' : 'Cargando reglas'} sx={{ display: 'grid', gap: 1 }}>{[0,1,2,3].map(i => <Skeleton key={i} variant="rounded" height={58} sx={{ bgcolor: 'var(--item-hover)' }} />)}</Box>
      : !loadError && items.length === 0 ? <Box sx={{ textAlign: 'center', px: 2, py: 5, borderRadius: '12px', bgcolor: 'var(--surface)', border: '1px dashed var(--border)' }}>
        <BlockIcon sx={{ color: 'var(--text-muted)', fontSize: 28, mb: 1 }} />
        <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '.95rem' }}>{query ? bl.noResults : type === 'phone' ? (en ? 'No blocked numbers' : 'No hay números bloqueados') : type === 'industry' ? (en ? 'No blocked industries' : 'No has bloqueado industrias') : (en ? 'No blocked domains' : 'No has bloqueado dominios')}</Typography>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '.82rem', mt: .75 }}>{query ? (en ? 'Try another term or clear the search.' : 'Prueba otro término o borra la búsqueda.') : type === 'phone' ? (en ? 'Choose “Block numbers” to select saved contacts.' : 'Abre “Bloquear números” para seleccionar contactos guardados.') : (en ? 'Add a rule to exclude matching prospects.' : 'Agrega una regla para excluir los prospectos que coincidan.')}</Typography>
      </Box> : <Box sx={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', bgcolor: 'var(--surface)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.1, bgcolor: 'rgba(var(--accent-rgb),.04)', color: 'var(--text-muted)', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}><Box sx={{ flex: 1, pl: '42px' }}>{label}</Box><Box sx={{ display: { xs: 'none', sm: 'block' }, width: 120 }}>{en ? 'Added' : 'Agregado'}</Box><Box sx={{ width: 68, textAlign: 'center' }}>{en ? 'Actions' : 'Acciones'}</Box></Box>
        {items.map(entry => <EntryRow key={entry._id} entry={{ ...entry, type }} onDelete={handleDelete} onSave={handleSave} />)}
      </Box>}
    {!loadError && total > 0 && <TablePagination component="div" count={total} page={Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1))} rowsPerPage={pageSize} rowsPerPageOptions={[10,25,50]}
      onPageChange={(_, next) => setPage(next)} onRowsPerPageChange={event => { setPageSize(Number(event.target.value)); setPage(0) }}
      labelRowsPerPage={en ? 'Rows:' : 'Filas:'} labelDisplayedRows={({ from, to, count }) => `${from}–${to} ${en ? 'of' : 'de'} ${count}`}
      // !important: sectionPolish.css pinta toda paginación con --sidebar-bg y
      // dentro de esta tarjeta se veía como una franja negra.
      sx={{ mt: 1, color: 'var(--text-muted)', background: 'transparent !important', '& .MuiTablePagination-toolbar': { px: 0, flexWrap: 'wrap', minHeight: 44 }, '& .MuiSelect-icon, & .MuiIconButton-root': { color: 'var(--text-muted)' } }} />}
  </Box>

  const meta = TYPE_META[type] || TYPE_META.domain
  return <Box data-blacklist-type={type}>
    {type === 'phone' ? <>
      {/* Mismo control segmentado que Desempeño (Hoy/Semana/…): una sola
         pastilla, la vista activa con fondo sólido. */}
      <Box role="tablist" aria-label={en ? 'Phone blacklist views' : 'Vistas de teléfonos'} sx={{
        display: 'inline-flex', gap: .4, p: .5, mb: 2, borderRadius: '12px', bgcolor: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        {[
          ['blocked', <BlockIcon key="i" />, en ? 'Blocked numbers' : 'Números bloqueados', count],
          ['add', <AddIcon key="i" />, en ? 'Block numbers' : 'Bloquear números', null],
        ].map(([key, icon, text, n]) => {
          const on = phoneView === key
          return <Button key={key} role="tab" aria-selected={on} onClick={() => setPhoneView(key)} startIcon={icon} sx={{
            textTransform: 'none', px: 1.8, py: .7, fontWeight: 700, fontSize: '.8rem', borderRadius: '9px', minHeight: 36,
            color: on ? '#fff' : 'var(--text-muted)', bgcolor: on ? DANGER : 'transparent',
            boxShadow: on ? '0 2px 10px rgba(239,68,68,0.35)' : 'none',
            '&:hover': { bgcolor: on ? '#dc2626' : 'var(--item-hover)' }, '& svg': { fontSize: '17px !important' },
          }}>
            {text}{n != null && <Box component="span" sx={{ ml: .8, px: .7, borderRadius: 99, fontSize: '.7rem', lineHeight: '18px', bgcolor: on ? 'rgba(255,255,255,0.22)' : 'var(--item-hover)' }}>{n}</Box>}
          </Button>
        })}
      </Box>
      {phoneView === 'blocked' ? blockedList : <Box sx={PANEL_SX}><ContactBlockTable bl={bl} onBlocked={() => { load(page, query); onChanged() }} isActive={isActive} /></Box>}
    </> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: '360px minmax(0,1fr)' }, gap: 2, alignItems: 'start' }}>
      {/* Agregar a la izquierda (fija al hacer scroll), lo guardado a la derecha. */}
      <Box sx={{ ...PANEL_SX, p: 0, overflow: 'hidden', position: { lg: 'sticky' }, top: { lg: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 2, py: 1.6,
          background: `linear-gradient(135deg, rgba(${meta.rgb},0.14) 0%, transparent 75%)`, borderBottom: '1px solid var(--border)' }}>
          <Box sx={{ width: 34, height: 34, borderRadius: '10px', flexShrink: 0, display: 'grid', placeItems: 'center',
            bgcolor: `rgba(${meta.rgb},0.18)`, border: `1px solid rgba(${meta.rgb},0.35)`, color: meta.color }}>
            <AddIcon sx={{ fontSize: 19 }} />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 800, color: 'var(--text)', fontSize: '.95rem' }}>{en ? 'New exclusion' : 'Nueva exclusión'}</Typography>
            <Typography sx={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{type === 'domain' ? (en ? 'A website to skip' : 'Un sitio que se debe omitir') : (en ? 'A business category to exclude' : 'Una categoría de negocio a excluir')}</Typography>
          </Box>
        </Box>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.6 }}>
          <AddRow value={addVal} onChange={setAddVal} onAdd={handleAdd} error={addErr} placeholder={placeholder} label={addLabel} adding={adding} />
          <Box sx={{ display: 'flex', gap: 1, p: 1.3, borderRadius: '10px', bgcolor: 'var(--surface)', border: '1px dashed var(--border)' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: meta.color, mt: .15, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '.74rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>{tip}</Typography>
          </Box>
          {type === 'industry' && <IndustryPreview value={addVal} onPick={setAddVal} />}
        </Box>
      </Box>
      {blockedList}
    </Box>}
  </Box>
}

function SystemBlacklist({ bl }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [expanded, setExpanded] = useState(false)
  const [all, setAll] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  async function fetchSystem() {
    setLoading(true); setError(false)
    try {
      const response = await authFetch('/api/blacklist/system')
      if (!response.ok) throw new Error('load')
      const data = await response.json()
      if (!Array.isArray(data.domains)) throw new Error('shape')
      setAll(data.domains)
    } catch { setError(true) }
    finally { setLoading(false) }
  }
  const filtered = (all || []).filter(domain => domain.includes(search.toLowerCase().trim()))
  return <Box data-blacklist-system sx={PANEL_SX}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Box sx={{ width: 34, height: 34, borderRadius: '10px', flexShrink: 0, display: 'grid', placeItems: 'center', bgcolor: 'var(--item-hover)', border: '1px solid var(--border)' }}>
        <LockIcon sx={{ fontSize: 17, color: 'var(--text-muted)' }} />
      </Box>
      <Box sx={{ flex: '1 1 220px' }}><Typography sx={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--text)' }}>{en ? 'System rules' : 'Reglas del sistema'} <Box component="span" sx={{ ml: .75, fontSize: '.7rem', fontWeight: 500, color: 'var(--text-muted)' }}>{en ? 'Read only' : 'Solo lectura'}</Box></Typography><Typography sx={{ fontSize: '.8rem', color: 'var(--text-muted)', mt: .5, maxWidth: 700 }}>{bl.systemDesc}</Typography></Box>
      <Button variant="outlined" aria-expanded={expanded} onClick={() => { if (!expanded && all === null && !loading) fetchSystem(); setExpanded(!expanded) }} endIcon={<ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />} sx={{ textTransform: 'none', color: 'var(--text-muted)', borderColor: 'var(--border)', borderRadius: '10px', flexShrink: 0 }}>{expanded ? (en ? 'Hide rules' : 'Ocultar reglas') : all === null ? (en ? 'View rules' : 'Ver reglas') : `${all.length} ${bl.systemCount}`}</Button>
    </Box>
    {expanded && <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid var(--border)' }}>
      {error ? <Alert severity="error" action={<Button onClick={fetchSystem} color="inherit">{en ? 'Retry' : 'Reintentar'}</Button>}>{en ? 'Could not load the system rules.' : 'No se pudieron cargar las reglas del sistema.'}</Alert> : loading ? <Skeleton variant="rounded" height={80} sx={{ bgcolor: 'var(--item-hover)' }} /> : <>
        <TextField size="small" fullWidth label={bl.systemSearchPh} value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} sx={{ ...FIELD_SX, mb: 2 }} />
        <Box sx={{ display: 'grid', gap: .75 }}>{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(domain => <Box key={domain} sx={{ display: 'flex', gap: 1.25, alignItems: 'center', p: 1.3, border: '1px solid var(--border)', borderRadius: '10px', bgcolor: 'var(--surface)' }}><LockIcon sx={{ fontSize: 14, color: 'var(--text-muted)' }} /><Typography sx={{ fontSize: '.85rem', color: 'var(--text-muted)', overflowWrap: 'anywhere', minWidth: 0 }}>{domain}</Typography></Box>)}</Box>
        {!filtered.length && <Typography sx={{ fontSize: '.82rem', color: 'var(--text-muted)', py: 2 }}>{search ? bl.noResults : bl.systemEmpty}</Typography>}
        {filtered.length > PAGE_SIZE && <TablePagination component="div" count={filtered.length} page={page} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[]} onPageChange={(_, next) => setPage(next)} sx={{ color: 'var(--text-muted)', '& .MuiTablePagination-toolbar': { px: 0, flexWrap: 'wrap' }, '& .MuiIconButton-root': { color: 'var(--text-muted)' } }} />}
      </>}
    </Box>}
  </Box>
}

export default function BlacklistPanel({ isActive }) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const bl = t.blacklist
  const [activeTab, setActiveTab] = useState(0)
  const [counts, setCounts] = useState(null)
  const [countsError, setCountsError] = useState(false)
  const countRequest = useRef(null)
  const loadCounts = useCallback(async () => {
    countRequest.current?.abort()
    const current = new AbortController(); countRequest.current = current
    setCountsError(false)
    try {
      const response = await authFetch('/api/blacklist/stats', { signal: current.signal })
      let data
      // Existing local backends can still show counts before the new API is restarted.
      if (!response.ok && ![401, 403].includes(response.status)) {
        const pairs = await Promise.all(['domain','industry','phone'].map(async type => {
          const r = await authFetch(`/api/blacklist?type=${type}&limit=1`, { signal: current.signal })
          if (!r.ok) throw new Error('load')
          const d = await r.json(); return [type, d.total]
        }))
        data = Object.fromEntries(pairs)
      } else { if (!response.ok) throw new Error('load'); data = await response.json() }
      if (!['domain','industry','phone'].every(type => Number.isInteger(data[type]) && data[type] >= 0)) throw new Error('shape')
      if (!current.signal.aborted) setCounts(data)
    } catch { if (!current.signal.aborted) setCountsError(true) }
  }, [])
  useEffect(() => { if (isActive !== false) loadCounts(); return () => countRequest.current?.abort() }, [isActive, loadCounts])
  const changed = useCallback(() => { loadCounts() }, [loadCounts])
  const tabs = [
    { type: 'domain', icon: <LanguageIcon />, label: en ? 'Domains' : 'Dominios', full: bl.domains, placeholder: en ? 'example.com' : 'ejemplo.com', tip: en ? 'Blocks this exact domain and its subdomains. Example: example.com also covers shop.example.com.' : 'Bloquea el dominio exacto y sus subdominios. Ejemplo: ejemplo.com también cubre tienda.ejemplo.com.' },
    { type: 'industry', icon: <CategoryIcon />, label: bl.industries, full: bl.industries, placeholder: bl.industryPh, tip: en ? 'Select a category or enter a term to exclude matching businesses.' : 'Elige una categoría o escribe un término para excluir los negocios que coincidan.' },
    { type: 'phone', icon: <BlockIcon />, label: bl.phones, full: bl.phones, placeholder: bl.phonePh, tip: bl.phoneTip },
  ]
  const tab = tabs[activeTab]
  return <Box data-ui-section="blacklist" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', gap: 2, pr: .5, pb: 2 }}>
    {/* Qué es esto, en una línea, antes de las categorías. */}
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.4, px: 2, py: 1.4, flexShrink: 0, borderRadius: '14px',
      border: '1px solid rgba(239,68,68,0.22)', background: 'linear-gradient(120deg, rgba(239,68,68,0.1) 0%, transparent 60%), var(--card-bg)' }}>
      <Box sx={{ width: 36, height: 36, borderRadius: '11px', flexShrink: 0, display: 'grid', placeItems: 'center',
        bgcolor: DANGER_SOFT, border: `1px solid ${DANGER_BORDER}`, color: DANGER }}>
        <BlockIcon sx={{ fontSize: 19 }} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '.92rem', fontWeight: 800, color: 'var(--text)' }}>{en ? 'Who is never contacted' : 'A quién nunca se contacta'}</Typography>
        <Typography sx={{ fontSize: '.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {en ? 'The searcher skips these domains, businesses in these industries are excluded, and sends skip these numbers.'
              : 'El buscador omite estos dominios, se excluyen los negocios de estas industrias y los envíos se saltan estos números.'}
        </Typography>
      </Box>
    </Box>
    {/* pt/pb en el scroller: MUI Tabs recorta lo que sale de su caja, y la
       tarjeta (que sube 1px al pasar el mouse, con sombra) quedaba pegada y
       cortada contra el borde superior. */}
    <Tabs value={activeTab} onChange={(_, next) => setActiveTab(next)} variant="fullWidth" aria-label={en ? 'Blacklist categories' : 'Categorías de blacklist'} sx={{ flexShrink: 0, minHeight: 0, mt: 0.5, '& .MuiTabs-indicator': { display: 'none' }, '& .MuiTabs-scroller': { pt: '6px', pb: '10px', px: '2px' }, '& .MuiTabs-list': { gap: { xs: 1, md: 1.5 } } }}>
      {tabs.map((item, i) => {
        const m = TYPE_META[item.type]
        const on = activeTab === i
        return <Tab key={item.type} label={<Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, textAlign: 'left' }}>
          <Box sx={{ width: { xs: 32, sm: 42 }, height: { xs: 32, sm: 42 }, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: '12px', color: m.color,
            background: `linear-gradient(135deg, rgba(${m.rgb},${on ? 0.28 : 0.16}) 0%, rgba(${m.rgb},0.05) 100%)`, border: `1px solid rgba(${m.rgb},${on ? 0.45 : 0.25})`,
            '& svg': { fontSize: { xs: 17, sm: 21 } } }}>{item.icon}</Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="span" sx={{ display: 'block', fontSize: { xs: '.78rem', sm: '.92rem' }, fontWeight: 800, color: 'var(--text)', lineHeight: 1.25 }}>{item.label}</Typography>
            <Typography component="span" sx={{ display: { xs: 'none', sm: 'block' }, color: 'var(--text-muted)', fontSize: '.72rem', mt: .2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[en ? 'Websites to skip' : 'Sitios que se omiten', en ? 'Business categories' : 'Categorías de negocio', en ? 'Contacts excluded from sends' : 'Contactos excluidos de envíos'][i]}</Typography>
          </Box>
          <Box component="span" sx={{ color: 'var(--text)', fontSize: { xs: '1.15rem', md: '1.45rem' }, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.03em' }}>{countsError ? '—' : counts?.[item.type] ?? '…'}</Box>
        </Box>} sx={{ textTransform: 'none', minWidth: 0, minHeight: { xs: 64, sm: 76 }, px: { xs: 1.3, md: 2 }, py: 1.4, borderRadius: '14px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', opacity: 1, transition: 'background-color .18s, border-color .18s, transform .18s',
          '&:hover': { borderColor: `rgba(${m.rgb},.45)`, transform: 'translateY(-1px)' },
          '&.Mui-selected': { borderColor: `rgba(${m.rgb},.6)`, background: `linear-gradient(120deg, rgba(${m.rgb},.14), rgba(${m.rgb},.02)), var(--card-bg)`, boxShadow: `0 6px 22px rgba(${m.rgb},.12)` },
          '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: -3 } }} />
      })}
    </Tabs>
    {countsError && <Alert severity="warning" action={<Button color="inherit" onClick={loadCounts}>{en ? 'Retry' : 'Reintentar'}</Button>}>{en ? 'Totals could not be refreshed.' : 'No se pudieron actualizar los totales.'}</Alert>}
    <BlacklistList key={tab.type} type={tab.type} label={tab.full} placeholder={tab.placeholder} tip={tab.tip} bl={bl} isActive={isActive} onChanged={changed} count={counts?.phone} />
    {tab.type === 'domain' && <SystemBlacklist bl={bl} />}
  </Box>
}
