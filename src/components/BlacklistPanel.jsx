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
import Divider from '@mui/material/Divider'
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
      display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.8, borderRadius: 1.5,
      bgcolor: 'var(--item-hover, rgba(255,255,255,0.04))', border: '1px solid var(--border, rgba(255,255,255,0.08))',
    }}>
      <BlockIcon sx={{ fontSize: 13, color: DANGER, flexShrink: 0 }} />
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
      border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 3,
      pt: 2.4, pb: 2, px: 2, bgcolor: 'var(--surface, rgba(255,255,255,0.02))',
    }}>
      <Box sx={{
        position: 'absolute', top: -13, left: 14,
        display: 'inline-flex', alignItems: 'center', gap: 0.6,
        bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid var(--border, rgba(255,255,255,0.1))',
        borderRadius: 999, px: 1.3, py: 0.4,
      }}>
        {icon}
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: DANGER, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </Typography>
      </Box>

      <Typography sx={SUB_LABEL_SX}>{bl.addLabel || bl.add}</Typography>
      <AddRow value={addVal} onChange={setAddVal} error={addErr} placeholder={placeholder} tip={tip} onAdd={handleAdd} />

      <Divider sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 2 }} />

      <Typography sx={SUB_LABEL_SX}>{bl.searchLabel || bl.searchPh}</Typography>
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
        <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted, rgba(255,255,255,0.35))', fontStyle: 'italic', textAlign: 'center', py: 1 }}>
          {search ? (bl.noResults || 'Sin resultados') : bl.empty}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {items.map(e => (
            <EntryRow key={e._id} entry={e} onDelete={handleDelete} onSave={handleSave} />
          ))}
        </Box>
      )}

      {total > PAGE_SIZE && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1.4 }}>
          <IconButton size="small" disabled={page <= 1} onClick={() => goPage(page - 1)}
            sx={{ color: 'var(--text-muted)', '&.Mui-disabled': { opacity: 0.25 } }}>
            <ChevronLeftIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {page} / {totalPages} · {total}
          </Typography>
          <IconButton size="small" disabled={page >= totalPages} onClick={() => goPage(page + 1)}
            sx={{ color: 'var(--text-muted)', '&.Mui-disabled': { opacity: 0.25 } }}>
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      )}
    </Box>
  )
}

export default function BlacklistPanel({ isActive }) {
  const { t } = useLang()
  const bl = t.blacklist

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header — a touch of red so it reads as a blocklist, not a generic settings page */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexShrink: 0 }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          bgcolor: DANGER_SOFT, border: `1px solid ${DANGER_BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <GppBadIcon sx={{ color: DANGER, fontSize: 19 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>
            {bl.title}
          </Typography>
          <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.4))', fontSize: '0.75rem' }}>
            {bl.subtitle}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, pr: 0.5, display: 'flex', flexDirection: 'column', gap: 3.5 }}>
        <BlacklistList type="domain" icon={<LanguageIcon sx={{ fontSize: 13, color: DANGER }} />}
          label={bl.domains} placeholder={bl.domainPh} tip={bl.domainTip} bl={bl} />
        <BlacklistList type="industry" icon={<CategoryIcon sx={{ fontSize: 13, color: DANGER }} />}
          label={bl.industries} placeholder={bl.industryPh} tip={bl.industryTip} bl={bl} />
      </Box>
    </Box>
  )
}
