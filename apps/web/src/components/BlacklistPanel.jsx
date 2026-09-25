'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import InputAdornment from '@mui/material/InputAdornment'
import CircularProgress from '@mui/material/CircularProgress'
import GppBadIcon from '@mui/icons-material/GppBad'
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

const DANGER = '#ef4444'
const DANGER_SOFT = 'rgba(239,68,68,0.1)'
const DANGER_BORDER = 'rgba(239,68,68,0.3)'
const PAGE_SIZE = 8

const SUB_LABEL_SX = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted, rgba(255,255,255,0.4))', mb: 0.8,
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    fontSize: '0.82rem', bgcolor: 'var(--surface, rgba(255,255,255,0.03))',
    '& fieldset': { borderColor: 'var(--border, rgba(255,255,255,0.1))' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent, #3b82f6)' },
  },
  '& input': { color: 'var(--text, #f1f5f9)' },
  '& .MuiFormHelperText-root': { color: DANGER, fontSize: '0.68rem', mt: 0.3 },
}

function AddRow({ value, onChange, onAdd, error, placeholder, tip }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <TextField
        size="small" fullWidth
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={e => e.key === 'Enter' && onAdd()}
        error={!!error}
        helperText={error || ''}
        slotProps={{ input: { endAdornment: (
          <InputAdornment position="end">
            <Tooltip title={tip} placement="top" arrow>
              <InfoOutlinedIcon sx={{ fontSize: 14, color: 'var(--text-muted, rgba(255,255,255,0.4))', cursor: 'help' }} />
            </Tooltip>
          </InputAdornment>
        ) } }}
        sx={{ ...FIELD_SX, '& .MuiOutlinedInput-root': { ...FIELD_SX['& .MuiOutlinedInput-root'], '& fieldset': { borderColor: error ? DANGER : 'var(--border, rgba(255,255,255,0.1))' }, '&.Mui-focused fieldset': { borderColor: error ? DANGER : 'var(--accent, #3b82f6)' } } }}
      />
      <IconButton onClick={onAdd} disabled={!value.trim()}
        sx={{
          borderRadius: 1.5, border: `1px solid ${DANGER_BORDER}`, bgcolor: DANGER_SOFT, color: DANGER, px: 1.5,
          '&:hover': { bgcolor: 'rgba(239,68,68,0.2)' }, '&.Mui-disabled': { opacity: 0.3 },
        }}>
        <AddIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
  )
}

function EntryRow({ entry, onDelete, onSave, dupError, genericError }) {
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
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.7, borderRadius: 1.5,
      bgcolor: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.12)',
      borderLeft: '3px solid rgba(239,68,68,0.32)',
      transition: 'all 0.15s',
      '&:hover': { bgcolor: 'rgba(239,68,68,0.055)', borderLeftColor: 'rgba(239,68,68,0.55)' },
    }}>
      {/* Ícono suelto reemplazado por el mismo detalle de caja con degradado
         que usa el resto de la app, en vez de un ícono flotando solo. */}
      <Box sx={{
        width: 22, height: 22, borderRadius: '7px', flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(239,68,68,0.22) 0%, rgba(239,68,68,0.08) 100%)',
        border: '1px solid rgba(239,68,68,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <BlockIcon sx={{ fontSize: 12, color: DANGER }} />
      </Box>
      {editing ? (
        <TextField
          size="small" autoFocus fullWidth value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setVal(entry.value) } }}
          error={!!err} helperText={err || ''}
          sx={{ ...FIELD_SX, '& .MuiOutlinedInput-input': { py: 0.5 } }}
        />
      ) : (
        <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, #f1f5f9)', fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.value}
        </Typography>
      )}
      {editing ? (
        <>
          <IconButton size="small" onClick={save} sx={{ p: 0.3, color: '#4ade80' }}>
            <CheckIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton size="small" onClick={() => { setEditing(false); setVal(entry.value); setErr('') }}
            sx={{ p: 0.3, color: 'var(--text-muted)' }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </>
      ) : (
        <>
          <IconButton size="small" onClick={() => setEditing(true)}
            sx={{ p: 0.3, color: 'var(--text-muted, rgba(255,255,255,0.4))', '&:hover': { color: 'var(--accent, #3b82f6)' } }}>
            <EditIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(entry._id)}
            sx={{ p: 0.3, color: 'var(--text-muted, rgba(255,255,255,0.4))', '&:hover': { color: DANGER, bgcolor: 'rgba(239,68,68,0.12)' } }}>
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </>
      )}
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
function ContactBlockTable({ bl, onBlocked }) {
  const [term,      setTerm]      = useState('')
  const [groups,    setGroups]    = useState([])  // [{company_id, company_name, numbers:[{contact_id,number,is_blocked}]}]
  const [total,     setTotal]     = useState(0)   // total distinct companies matching, not raw numbers
  const [page,      setPage]      = useState(1)
  const [loading,   setLoading]   = useState(true)
  const [expanded,  setExpanded]  = useState(new Set())  // company_ids currently expanded
  const [selected,  setSelected]  = useState(new Set())  // contact_ids selected to block
  const [blocking,  setBlocking]  = useState(false)
  const debounceRef = useRef(null)

  const load = useCallback((p, q) => {
    setLoading(true)
    const qs = new URLSearchParams({ page: String(p), limit: String(TABLE_PAGE_SIZE) })
    if (q) qs.set('q', q)
    authFetch(`/api/contacts/search?${qs.toString()}`)
      .then(r => r.json())
      .then(d => {
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
        setTotal(d.total || 0)
      })
      .catch(() => { setGroups([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(1, '') }, [load])

  function handleSearchChange(v) {
    setTerm(v)
    setSelected(new Set())
    setExpanded(new Set())
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setPage(1); load(1, v.trim()) }, 300)
  }

  function goPage(p) {
    setPage(p)
    setSelected(new Set())
    setExpanded(new Set())
    load(p, term.trim())
  }

  const allNumbers = groups.flatMap(g => g.numbers)
  const selectableNumbers = allNumbers.filter(n => !n.is_blocked)
  const allSelected = selectableNumbers.length > 0 && selectableNumbers.every(n => selected.has(n.contact_id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableNumbers.map(n => n.contact_id)))
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
    const toBlock = allNumbers.filter(n => selected.has(n.contact_id))
    if (toBlock.length === 0 || blocking) return
    setBlocking(true)
    try {
      await Promise.all(toBlock.map(n => authFetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'phone', value: n.number }),
      }).catch(() => {})))
      setSelected(new Set())
      load(page, term.trim())
      onBlocked?.()
    } finally {
      setBlocking(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE))

  return (
    <Box sx={{ mb: 2.2 }}>
      <Typography sx={SUB_LABEL_SX}>{bl.contactSearchLabel}</Typography>

      {/* Una sola tarjeta contenedora — buscador, tabla y barra de acción
         quedan visualmente unidos en vez de flotar como piezas sueltas. */}
      <Box sx={{
        borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
        bgcolor: 'var(--surface, rgba(255,255,255,0.018))', overflow: 'hidden',
      }}>
        <Box sx={{ p: 1.2, pb: 1, borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))' }}>
          <TextField
            size="small" fullWidth value={term} onChange={e => handleSearchChange(e.target.value)}
            placeholder={bl.contactSearchPh}
            slotProps={{ input: { startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted, rgba(255,255,255,0.4))' }} /></InputAdornment>
            ) } }}
            sx={FIELD_SX}
          />
        </Box>

        <Box sx={{ maxHeight: 380, overflowY: 'auto', p: 1, display: 'flex', flexDirection: 'column', gap: 0.7 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3.5 }}><CircularProgress size={16} sx={{ color: DANGER }} /></Box>
          ) : groups.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.6, py: 3.5 }}>
              <BlockIcon sx={{ fontSize: 18, color: 'rgba(239,68,68,0.2)' }} />
              <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted, rgba(255,255,255,0.35))', fontStyle: 'italic' }}>
                {bl.noResults}
              </Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.6, pb: 0.2 }}>
                <Checkbox size="small" checked={allSelected} indeterminate={selected.size > 0 && !allSelected}
                  onChange={toggleAll} disabled={selectableNumbers.length === 0}
                  sx={{ p: 0.4, color: 'var(--text-muted)', '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: DANGER } }} />
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                  {bl.selectAllLabel}
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
                  <Box key={g.company_id} sx={{
                    borderRadius: 2, border: '1px solid var(--border, rgba(255,255,255,0.08))',
                    bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
                  }}>
                    <Box
                      onClick={() => single ? (!g.numbers[0].is_blocked && toggleOne(g.numbers[0].contact_id)) : toggleExpand(g.company_id)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.1, px: 1.2, py: 0.9, cursor: 'pointer',
                        transition: 'background 0.1s',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.035)' },
                      }}>
                      <Checkbox size="small"
                        checked={single ? soleChecked : companyChecked}
                        indeterminate={!single && companyIndeterminate}
                        disabled={single ? g.numbers[0].is_blocked : companyIds.length === 0}
                        onClick={e => e.stopPropagation()}
                        onChange={() => single ? toggleOne(g.numbers[0].contact_id) : toggleCompany(g)}
                        sx={{ p: 0.4, flexShrink: 0, color: 'var(--text-muted)', '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: DANGER } }} />

                      <Box sx={{ flex: 1, minWidth: 0, py: 0.15 }}>
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
                            onClick={() => !n.is_blocked && toggleOne(n.contact_id)}
                            sx={{
                              display: 'flex', alignItems: 'center', gap: 1.1, pl: 4, pr: 1.2, py: 0.7,
                              cursor: n.is_blocked ? 'default' : 'pointer',
                              opacity: n.is_blocked ? 0.5 : 1,
                              '&:hover': n.is_blocked ? {} : { bgcolor: 'rgba(255,255,255,0.03)' },
                            }}>
                            <Checkbox size="small" checked={selected.has(n.contact_id)} disabled={n.is_blocked}
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

        {/* Barra de acción — parte de la misma tarjeta, no una pieza aparte */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          px: 1.2, py: 0.9, borderTop: '1px solid var(--border, rgba(255,255,255,0.07))',
          bgcolor: 'rgba(255,255,255,0.015)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.2 }}>
            <IconButton size="small" disabled={page <= 1} onClick={() => goPage(page - 1)}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.2 } }}>
              <ChevronLeftIcon sx={{ fontSize: 17 }} />
            </IconButton>
            <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, px: 0.6, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {page} / {totalPages} · {total.toLocaleString()}
            </Typography>
            <IconButton size="small" disabled={page >= totalPages} onClick={() => goPage(page + 1)}
              sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.2 } }}>
              <ChevronRightIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          <Button
            size="small" disabled={selected.size === 0 || blocking} onClick={handleBlockSelected}
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

function BlacklistList({ type, icon, label, placeholder, tip, bl }) {
  const [items,    setItems]    = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [addVal,   setAddVal]   = useState('')
  const [addErr,   setAddErr]   = useState('')
  const debounceRef = useRef(null)

  const load = useCallback((p, s) => {
    setLoading(true)
    const qs = new URLSearchParams({ type, page: String(p), limit: String(PAGE_SIZE) })
    if (s) qs.set('search', s)
    authFetch(`/api/blacklist?${qs.toString()}`)
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setTotal(d.total || 0) })
      .catch(() => { setItems([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [type])

  useEffect(() => { load(1, '') }, [load])

  function handleSearchChange(v) {
    setSearch(v)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(1, v), 300)
  }

  function goPage(p) {
    setPage(p)
    load(p, search)
  }

  async function handleAdd() {
    const v = addVal.trim()
    if (!v) return
    setAddErr('')
    try {
      const r = await authFetch('/api/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value: v }),
      })
      if (r.status === 409) { setAddErr(bl.dupError); return }
      if (!r.ok) { setAddErr(bl.addError); return }
      setAddVal('')
      load(1, search); setPage(1)
    } catch { setAddErr(bl.addError) }
  }

  async function handleSave(id, value, setRowErr) {
    try {
      const r = await authFetch(`/api/blacklist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (r.status === 409) { setRowErr(bl.dupError); return false }
      if (!r.ok) { setRowErr(bl.addError); return false }
      load(page, search)
      return true
    } catch { setRowErr(bl.addError); return false }
  }

  async function handleDelete(id) {
    try {
      await authFetch(`/api/blacklist/${id}`, { method: 'DELETE' })
      const isLastOnPage = items.length === 1 && page > 1
      load(isLastOnPage ? page - 1 : page, search)
      if (isLastOnPage) setPage(page - 1)
    } catch {}
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Box sx={{
      position: 'relative', mt: 1.6,
      border: '1px solid var(--border, rgba(255,255,255,0.1))',
      borderTop: `2px solid rgba(239,68,68,0.55)`,
      borderRadius: 3,
      pt: 2.4, pb: 2, px: 2, bgcolor: 'rgba(239,68,68,0.015)',
    }}>
      <Box sx={{
        position: 'absolute', top: -13, left: 14,
        display: 'inline-flex', alignItems: 'center', gap: 0.6,
        bgcolor: 'var(--card-bg, #161d2e)', border: `1px solid ${DANGER_BORDER}`,
        boxShadow: '0 0 10px rgba(239,68,68,0.1)',
        borderRadius: 999, px: 1.3, py: 0.4,
      }}>
        {icon}
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: DANGER, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </Typography>
      </Box>

      {type === 'phone' ? (
        <ContactBlockTable bl={bl} onBlocked={() => load(page, search)} />
      ) : (
        <>
          <Typography sx={SUB_LABEL_SX}>{bl.addLabel || bl.add}</Typography>
          <AddRow value={addVal} onChange={setAddVal} error={addErr} placeholder={placeholder} tip={tip} onAdd={handleAdd} />
        </>
      )}

      <Divider sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 2 }} />

      <Typography sx={SUB_LABEL_SX}>{type === 'phone' ? bl.blockedSearchLabel : (bl.searchLabel || bl.searchPh)}</Typography>
      <TextField
        size="small" fullWidth value={search} onChange={e => handleSearchChange(e.target.value)}
        placeholder={bl.searchPh || 'Buscar...'}
        slotProps={{ input: { startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted, rgba(255,255,255,0.4))' }} />
          </InputAdornment>
        ) } }}
        sx={{ ...FIELD_SX, mb: 1.6 }}
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={16} sx={{ color: 'var(--accent, #3b82f6)' }} />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.8, py: 2.5, borderRadius: 2, background: 'radial-gradient(ellipse at 50% 40%, rgba(239,68,68,0.04) 0%, transparent 70%)' }}>
          <BlockIcon sx={{ fontSize: 22, color: 'rgba(239,68,68,0.22)' }} />
          <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted, rgba(255,255,255,0.35))', fontStyle: 'italic', textAlign: 'center' }}>
            {search ? (bl.noResults || 'Sin resultados') : bl.empty}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {items.map(e => (
            <EntryRow key={e._id} entry={e} onDelete={handleDelete} onSave={handleSave} />
          ))}
        </Box>
      )}

      {total > PAGE_SIZE && (
        // Antes eran botones + texto sueltos flotando en el centro — ahora
        // es una sola "pastilla" (mismo lenguaje de segmented control que
        // ya usa Performance), con el conteo como su propio chip en vez de
        // texto plano.
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3, mt: 1.4,
          alignSelf: 'center', mx: 'auto', p: 0.3, borderRadius: 2,
          bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.1))',
          width: 'fit-content',
        }}>
          <IconButton size="small" disabled={page <= 1} onClick={() => goPage(page - 1)}
            sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.25 } }}>
            <ChevronLeftIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, px: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {page} / {totalPages} · {total}
          </Typography>
          <IconButton size="small" disabled={page >= totalPages} onClick={() => goPage(page + 1)}
            sx={{ color: 'var(--text-muted)', '&:hover': { color: DANGER, bgcolor: DANGER_SOFT }, '&.Mui-disabled': { opacity: 0.25 } }}>
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      )}
    </Box>
  )
}

const SYS_COLOR  = 'rgba(255,255,255,0.45)'
const SYS_SOFT   = 'rgba(255,255,255,0.03)'
const SYS_BORDER = 'rgba(255,255,255,0.1)'

function SystemBlacklist({ bl }) {
  const [expanded, setExpanded] = useState(false)
  const [all,      setAll]      = useState([])
  const [loading,  setLoading]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)
  const fetchedRef = useRef(false)

  // Defer the fetch until the user expands — avoids blocking initial paint (LCP)
  function handleExpand() {
    setExpanded(e => {
      if (!e && !fetchedRef.current) {
        fetchedRef.current = true
        setLoading(true)
        fetch('/api/blacklist/system')
          .then(r => r.json())
          .then(d => setAll(d.domains || []))
          .catch(() => setAll([]))
          .finally(() => setLoading(false))
      }
      return !e
    })
  }

  const filtered = search.trim()
    ? all.filter(d => d.includes(search.toLowerCase().trim()))
    : all

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSearch(v) { setSearch(v); setPage(1) }
  function goPage(p) { setPage(Math.max(1, Math.min(p, totalPages))) }

  return (
    <Box sx={{
      position: 'relative', mt: 1.6,
      border: `1px solid ${SYS_BORDER}`, borderRadius: 3,
      pt: 2.4, pb: 2, px: 2, bgcolor: SYS_SOFT,
    }}>
      {/* Floating label */}
      <Box sx={{
        position: 'absolute', top: -13, left: 14,
        display: 'inline-flex', alignItems: 'center', gap: 0.6,
        bgcolor: 'var(--card-bg, #161d2e)', border: `1px solid ${SYS_BORDER}`,
        borderRadius: 999, px: 1.3, py: 0.4,
      }}>
        <Box sx={{
          width: 18, height: 18, borderRadius: '6px', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 100%)',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LockIcon sx={{ fontSize: 11, color: SYS_COLOR }} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: SYS_COLOR, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {bl.systemLabel}
        </Typography>
      </Box>

      {/* Description + toggle */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.38)', lineHeight: 1.6, flex: 1 }}>
          {bl.systemDesc}
        </Typography>
        <Box
          onClick={handleExpand}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.7, cursor: 'pointer', flexShrink: 0,
            pl: 1.3, pr: 1, py: 0.45, borderRadius: 999, border: `1px solid ${SYS_BORDER}`,
            bgcolor: 'rgba(255,255,255,0.04)', transition: 'all 0.15s',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.18)' },
          }}
        >
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: SYS_COLOR, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {loading ? '…' : `${all.length} ${bl.systemCount}`}
          </Typography>
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 14, borderRadius: '50%',
            bgcolor: 'rgba(255,255,255,0.06)', transition: 'transform 0.2s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            <ExpandMoreIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }} />
          </Box>
        </Box>
      </Box>

      {expanded && (
        <>
          <Divider sx={{ borderColor: SYS_BORDER, my: 1.8 }} />

          <TextField
            size="small" fullWidth value={search} onChange={e => handleSearch(e.target.value)}
            placeholder={bl.systemSearchPh}
            slotProps={{ input: { startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }} />
              </InputAdornment>
            ) } }}
            sx={{ ...FIELD_SX, mb: 1.4 }}
          />

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={16} sx={{ color: 'rgba(255,255,255,0.3)' }} />
            </Box>
          ) : pageItems.length === 0 ? (
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', textAlign: 'center', py: 1 }}>
              {search ? (bl.noResults) : bl.systemEmpty}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {pageItems.map(domain => (
                <Box key={domain} sx={{
                  display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.65, borderRadius: 1.5,
                  bgcolor: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <LockIcon sx={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', flexShrink: 0 }} />
                  <Typography sx={{
                    fontSize: '0.78rem', color: 'rgba(255,255,255,0.48)', fontFamily: 'monospace',
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {domain}
                  </Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', flexShrink: 0 }}>
                    {bl.systemReadOnly}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {filtered.length > PAGE_SIZE && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1.4 }}>
              <IconButton size="small" disabled={page <= 1} onClick={() => goPage(page - 1)}
                sx={{ color: SYS_COLOR, '&.Mui-disabled': { opacity: 0.25 } }}>
                <ChevronLeftIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
                {page} / {totalPages} · {filtered.length}
              </Typography>
              <IconButton size="small" disabled={page >= totalPages} onClick={() => goPage(page + 1)}
                sx={{ color: SYS_COLOR, '&.Mui-disabled': { opacity: 0.25 } }}>
                <ChevronRightIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

export default function BlacklistPanel({ isActive }) {
  const { t } = useLang()
  const bl = t.blacklist
  const [activeTab, setActiveTab] = useState(0)

  const TABS = [
    { icon: <LanguageIcon sx={{ fontSize: 15 }} />, label: bl.domains },
    { icon: <CategoryIcon sx={{ fontSize: 15 }} />, label: bl.industries },
    { icon: <BlockIcon sx={{ fontSize: 15 }} />, label: bl.phones },
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexShrink: 0, px: 2, py: 1.5, borderRadius: 2, background: 'linear-gradient(135deg, rgba(239,68,68,0.07) 0%, transparent 60%)', border: '1px solid rgba(239,68,68,0.1)' }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          bgcolor: DANGER_SOFT, border: `1px solid ${DANGER_BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px rgba(239,68,68,0.18)',
        }}>
          <GppBadIcon sx={{ color: DANGER, fontSize: 19 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>
            {bl.title}
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
            {bl.subtitle}
          </Typography>
        </Box>
      </Box>

      {/* Tab bar — mismo lenguaje que el de Configuración (Cuenta/WhatsApp/
         Envíos), en el acento rojo propio de Blacklist, para elegir un
         apartado a la vez en vez de tener Dominios e Industrias siempre
         apiladas una debajo de la otra. */}
      <Box sx={{
        display: 'flex', gap: 0.5, mb: 2, flexShrink: 0,
        p: 0.5, borderRadius: 2.5,
        bgcolor: 'var(--surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--border, rgba(255,255,255,0.06))',
      }}>
        {TABS.map((tab, i) => {
          const active = activeTab === i
          return (
            <Box key={i} onClick={() => setActiveTab(i)} sx={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.6,
              py: 0.9, px: 0.5, borderRadius: 2, cursor: 'pointer',
              bgcolor: active ? DANGER_SOFT : 'transparent',
              border: active ? `1px solid ${DANGER_BORDER}` : '1px solid transparent',
              boxShadow: active ? '0 0 12px rgba(239,68,68,0.12)' : 'none',
              transition: 'all 0.15s',
              '&:hover': !active ? { bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))', border: '1px solid var(--border, rgba(255,255,255,0.1))' } : {},
            }}>
              <Box sx={{ color: active ? DANGER : 'var(--text-muted, rgba(255,255,255,0.4))', display: 'flex' }}>
                {tab.icon}
              </Box>
              <Typography sx={{
                fontSize: '0.78rem', fontWeight: active ? 700 : 400,
                color: active ? DANGER : 'var(--text-muted, rgba(255,255,255,0.4))',
                transition: 'color 0.15s',
              }}>
                {tab.label}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, pr: 0.5, display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        {activeTab === 0 ? (
          <>
            <BlacklistList type="domain" icon={<LanguageIcon sx={{ fontSize: 13, color: DANGER }} />}
              label={bl.domains} placeholder={bl.domainPh} tip={bl.domainTip} bl={bl} />
            <SystemBlacklist bl={bl} />
          </>
        ) : activeTab === 1 ? (
          <BlacklistList type="industry" icon={<CategoryIcon sx={{ fontSize: 13, color: DANGER }} />}
            label={bl.industries} placeholder={bl.industryPh} tip={bl.industryTip} bl={bl} />
        ) : (
          <BlacklistList type="phone" icon={<BlockIcon sx={{ fontSize: 13, color: DANGER }} />}
            label={bl.phones} placeholder={bl.phonePh} tip={bl.phoneTip} bl={bl} />
        )}
      </Box>
    </Box>
  )
}
