'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { alpha } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Snackbar from '@mui/material/Snackbar'
import Skeleton from '@mui/material/Skeleton'
import Divider from '@mui/material/Divider'
import Avatar from '@mui/material/Avatar'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import RefreshIcon from '@mui/icons-material/Refresh'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import StorageIcon from '@mui/icons-material/Storage'
import BusinessIcon from '@mui/icons-material/Business'
import { visuallyHidden } from '@mui/utils'

const HEAD_CELLS = [
  { id: 'name',         label: 'Empresa',    align: 'left',   sortable: true  },
  { id: 'website',      label: 'Sitio web',  align: 'left',   sortable: false },
  { id: 'industry',     label: 'Industria',  align: 'center', sortable: true  },
  { id: 'city',         label: 'Ciudad',     align: 'center', sortable: true  },
  { id: 'has_whatsapp', label: 'WhatsApp',   align: 'center', sortable: true  },
  { id: 'created_at',   label: 'Registrado', align: 'center', sortable: true  },
]

const WHATSAPP_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'true', label: 'Con WA' },
  { value: 'false', label: 'Sin WA' },
]

const ALERT_TITLES = {
  success: 'Listo',
  error: 'Error',
  info: 'Info',
  warning: 'Advertencia',
}

const MENU_PROPS = {
  PaperProps: {
    sx: {
      bgcolor: '#0d1117',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 2,
      mt: 0.5,
      '& .MuiMenuItem-root': {
        fontSize: '0.82rem',
        color: 'rgba(255,255,255,0.75)',
        '&:hover': { bgcolor: 'rgba(59,130,246,0.12)' },
        '&.Mui-selected': { bgcolor: 'rgba(59,130,246,0.18)', color: 'white' },
        '&.Mui-selected:hover': { bgcolor: 'rgba(59,130,246,0.25)' },
      },
      '& ul': {
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.15) transparent',
        '&::-webkit-scrollbar': { width: 4 },
        '&::-webkit-scrollbar-button': { display: 'none' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)', borderRadius: 2 },
        '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.3)' },
      },
    },
  },
}

const SELECT_SX = {
  color: 'rgba(255,255,255,0.85)',
  '& .MuiSelect-icon': { color: 'rgba(255,255,255,0.4)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.12)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.25)' },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
}

const LABEL_SX = {
  color: 'rgba(255,255,255,0.4)',
  '&.Mui-focused': { color: '#3b82f6' },
  '&.MuiFormLabel-filled': { color: 'rgba(255,255,255,0.55)' },
}

const FIELD_SX = {
  '& .MuiInputBase-root': { color: 'rgba(255,255,255,0.85)' },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.35)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#3b82f6' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.22)' },
  '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
}

const SKEL_SX = {
  bgcolor: 'rgba(255,255,255,0.06)',
  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)' },
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function truncate(str, n = 32) {
  if (!str) return '—'
  return str.length > n ? str.slice(0, n) + '…' : str
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────
function EnhancedToolbar({ numSelected, onDelete, onRefresh, onToggleFilter, filterOpen }) {
  return (
    <Toolbar
      sx={[
        { pl: { sm: 2 }, pr: { xs: 1, sm: 1 }, borderRadius: '12px 12px 0 0', position: 'relative', zIndex: 1, background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(139,92,246,0.06) 50%, rgba(9,18,37,0.6) 100%)' },
        numSelected > 0 && { bgcolor: (t) => alpha(t.palette.error.main, 0.12) },
      ]}
    >
      {numSelected > 0 ? (
        <Typography variant="subtitle1" sx={{ flex: '1 1 100%', color: 'error.light', fontWeight: 600 }}>
          {numSelected} seleccionado{numSelected !== 1 ? 's' : ''}
        </Typography>
      ) : (
        <Box sx={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 1}}>
          <StorageIcon sx={{ color: '#3b82f6', fontSize: 20 }} />
          <Typography variant="h6" sx={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>
            Base de datos
          </Typography>
        </Box>
      )}

      {numSelected > 0 ? (
        <Tooltip title="Eliminar seleccionados">
          <IconButton onClick={onDelete} color="error">
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Actualizar">
            <IconButton onClick={onRefresh} size="small" sx={{ color: 'rgba(255,255,255,0.5)', '&:hover': { color: 'white' } }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Filtros">
            <IconButton onClick={onToggleFilter} size="small" sx={{ color: filterOpen ? '#3b82f6' : 'rgba(255,255,255,0.5)', '&:hover': { color: 'white' } }}>
              <FilterListIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Toolbar>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function FilterBar({ filters, onChange, industries, cities }) {
  const [openIndustry, setOpenIndustry] = useState(false)
  const [openCity,     setOpenCity]     = useState(false)
  const [openWA,       setOpenWA]       = useState(false)

  return (
    <Box sx={{ px: 2, pt: 2, pb: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder="Buscar empresa o sitio…"
        value={filters.search}
        onChange={(e) => onChange('search', e.target.value)}
        sx={{
          minWidth: 220, flexGrow: 1,
          '& .MuiInputBase-root': { color: 'rgba(255,255,255,0.85)' },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.12)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.25)' },
          '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#3b82f6' },
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.35)' }} />
              </InputAdornment>
            ),
          },
        }}
      />

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="filter-industry-label" sx={LABEL_SX}>Industria</InputLabel>
        <Select
          labelId="filter-industry-label"
          open={openIndustry}
          onClose={() => setOpenIndustry(false)}
          onOpen={() => setOpenIndustry(true)}
          value={filters.industry}
          label="Industria"
          onChange={(e) => onChange('industry', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          <MenuItem value=""><em>Todas</em></MenuItem>
          {industries.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel id="filter-city-label" sx={LABEL_SX}>Ciudad</InputLabel>
        <Select
          labelId="filter-city-label"
          open={openCity}
          onClose={() => setOpenCity(false)}
          onOpen={() => setOpenCity(true)}
          value={filters.city}
          label="Ciudad"
          onChange={(e) => onChange('city', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          <MenuItem value=""><em>Todas</em></MenuItem>
          {cities.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel id="filter-wa-label" sx={LABEL_SX}>WhatsApp</InputLabel>
        <Select
          labelId="filter-wa-label"
          open={openWA}
          onClose={() => setOpenWA(false)}
          onOpen={() => setOpenWA(true)}
          value={filters.has_whatsapp}
          label="WhatsApp"
          onChange={(e) => onChange('has_whatsapp', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          {WHATSAPP_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.value === '' ? <em>{o.label}</em> : o.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  )
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────
function EditDialog({ open, company, onClose, onSave }) {
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (company) {
      setForm({
        name:         company.name         || '',
        industry:     company.industry     || '',
        city:         company.city         || '',
        state:        company.state        || '',
        website:      company.website      || '',
        description:  company.description  || '',
        has_whatsapp: company.has_whatsapp ?? false,
        status:       company.status       || '',
      })
    }
  }, [company])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    await onSave(company._id, form)
    setSaving(false)
  }

  const initial = (company?.name || '?')[0].toUpperCase()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          background: 'linear-gradient(160deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.08) 35%, #0d1117 65%)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          position: 'relative',
          '&::before': {
            content: '""',
            position: 'absolute', top: -50, left: -50,
            width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)',
            pointerEvents: 'none',
          },
        },
      }}
    >
      {/* Header */}
      <DialogTitle sx={{ p: 0 , bgcolor: 'rgba(4, 13, 27, 0.81)', borderBottom: '1px solid rgba(255, 255, 255, 0.07)'}}>
        <Box sx={{
          px: 3, pt: 3, pb: 2.5,
          display: 'flex', alignItems: 'center', gap: 2,
          bgcolor: 'inherit',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Avatar sx={{
            width: 44, height: 44, flexShrink: 0,
            bgcolor: 'rgba(59,130,246,0.2)',
            border: '1px solid rgba(59,130,246,0.35)',
            color: '#60a5fa',
            fontWeight: 700,
            fontSize: '1.1rem',
          }}>
            {initial}
          </Avatar>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              Editar empresa
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', mt: 0.25 }}>
              {truncate(company?.name || '', 40)}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 0, bgcolor: 'inherit' }}>
        {/* Sección: General */}
        <Typography variant="overline" sx={{ color: '#3b82f6', fontSize: '0.65rem', letterSpacing: 1.5, mb: 1.5, display: 'block' }}>
          Información general
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, mb: 2.5 }}>
          <TextField label="Nombre"    size="small" fullWidth sx={FIELD_SX} value={form.name    || ''} onChange={(e) => set('name',    e.target.value)} />
          <TextField label="Sitio web" size="small" fullWidth sx={FIELD_SX} value={form.website || ''} onChange={(e) => set('website', e.target.value)} />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField label="Industria" size="small" fullWidth sx={FIELD_SX} value={form.industry || ''} onChange={(e) => set('industry', e.target.value)} />
            <TextField label="Ciudad"    size="small" fullWidth sx={FIELD_SX} value={form.city     || ''} onChange={(e) => set('city',     e.target.value)} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField label="Estado" size="small" fullWidth sx={FIELD_SX} value={form.state  || ''} onChange={(e) => set('state',  e.target.value)} />
            <TextField label="Status" size="small" fullWidth sx={FIELD_SX} value={form.status || ''} onChange={(e) => set('status', e.target.value)} />
          </Box>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 2.5 }} />

        {/* Sección: Descripción */}
        <Typography variant="overline" sx={{ color: '#3b82f6', fontSize: '0.65rem', letterSpacing: 1.5, mb: 1.5, display: 'block' }}>
          Descripción
        </Typography>
        <TextField
          size="small" fullWidth multiline rows={2}
          placeholder="Sin descripción…"
          sx={{ ...FIELD_SX, mb: 2.5 }}
          value={form.description || ''}
          onChange={(e) => set('description', e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 2 }} />

        {/* WhatsApp toggle */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1.5,
          bgcolor: form.has_whatsapp ? 'rgba(34,197,94,0.07)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${form.has_whatsapp ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 2,
          mb: 1,
          transition: 'all 0.2s ease',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1.5,
              bgcolor: form.has_whatsapp ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}>
              <WhatsAppIcon sx={{ fontSize: 16, color: form.has_whatsapp ? '#4ade80' : 'rgba(255,255,255,0.25)' }} />
            </Box>
            <Box>
              <Typography sx={{ color: form.has_whatsapp ? '#4ade80' : 'rgba(255, 255, 255, 0.49)', fontSize: '0.85rem', fontWeight: 500 }}>
                Tiene WhatsApp
              </Typography>
              <Typography sx={{ color: 'rgba(255, 255, 255, 0.26)', fontSize: '0.72rem' }}>
                {form.has_whatsapp ? 'Número registrado' : 'Sin número registrado'}
              </Typography>
            </Box>
          </Box>
          <Switch
            checked={!!form.has_whatsapp}
            onChange={(e) => set('has_whatsapp', e.target.checked)}
            sx={{
              '& .MuiSwitch-switchBase.Mui-checked': { color: '#4ade80' },
              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#22c55e' },
            }}
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 2, gap: 1, bgcolor: 'inherit' }}>
        <Button
          onClick={onClose}
          sx={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, px: 2.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' } }}
        >
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          sx={{ bgcolor: '#0d66f7', borderRadius: 2, px: 3, fontWeight: 600, '&:hover': { bgcolor: '#1b54cf' }, '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.3)' } }}
        >
          {saving ? <CircularProgress size={16} sx={{ color: 'white' }} /> : 'Guardar cambios'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Skeleton rows ─────────────────────────────────────────────────────────────
function SkeletonRows({ count }) {
  return Array.from({ length: count }).map((_, i) => (
    <TableRow key={i}>
      <TableCell padding="checkbox">
        <Skeleton variant="rounded" width={18} height={18} sx={SKEL_SX} />
      </TableCell>
      <TableCell>
        <Skeleton variant="text" width="70%" sx={{ ...SKEL_SX, fontSize: '0.82rem' }} />
      </TableCell>
      <TableCell>
        <Skeleton variant="text" width="80%" sx={{ ...SKEL_SX, fontSize: '0.78rem' }} />
      </TableCell>
      <TableCell align="center">
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="text" width={80} sx={{ ...SKEL_SX, fontSize: '0.82rem' }} />
        </Box>
      </TableCell>
      <TableCell align="center">
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="text" width={70} sx={{ ...SKEL_SX, fontSize: '0.82rem' }} />
        </Box>
      </TableCell>
      <TableCell align="center">
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="rounded" width={32} height={20} sx={SKEL_SX} />
        </Box>
      </TableCell>
      <TableCell align="center">
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="text" width={80} sx={{ ...SKEL_SX, fontSize: '0.82rem' }} />
        </Box>
      </TableCell>
      <TableCell />
    </TableRow>
  ))
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DatabaseViewer() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [order, setOrder] = useState('desc')
  const [orderBy, setOrderBy] = useState('created_at')
  const [selected, setSelected] = useState([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState({ search: '', industry: '', city: '', has_whatsapp: '' })
  const [editTarget, setEditTarget] = useState(null)
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' })
  const [industries, setIndustries] = useState([])
  const [cities, setCities] = useState([])

  const notify = (msg, severity = 'success') => setSnack({ open: true, msg, severity })

  useEffect(() => {
    fetch('/api/companies/meta')
      .then((r) => r.json())
      .then((d) => { setIndustries(d.industries || []); setCities(d.cities || []) })
      .catch(() => {})
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page + 1,
        page_size: rowsPerPage,
        ...(filters.search       && { search: filters.search }),
        ...(filters.industry     && { industry: filters.industry }),
        ...(filters.city         && { city: filters.city }),
        ...(filters.has_whatsapp !== '' && { has_whatsapp: filters.has_whatsapp }),
      })
      const res = await fetch(`/api/companies?${params}`)
      const data = await res.json()
      setRows(data.companies || [])
      setTotal(data.total || 0)
    } catch {
      notify('No se pudieron cargar los datos', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, rowsPerPage, filters])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setPage(0) }, [filters])

  const handleFilterChange = (key, value) => setFilters((f) => ({ ...f, [key]: value }))

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[orderBy] ?? ''
      const bv = b[orderBy] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return order === 'asc' ? cmp : -cmp
    })
  }, [rows, order, orderBy])

  const handleRequestSort = (_, property) => {
    setOrder(orderBy === property && order === 'asc' ? 'desc' : 'asc')
    setOrderBy(property)
  }

  const handleSelectAll = (e) => {
    setSelected(e.target.checked ? sortedRows.map((r) => r._id) : [])
  }

  const handleSelectRow = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleDelete = async () => {
    if (!selected.length) return
    try {
      const res = await fetch('/api/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      })
      const data = await res.json()
      notify(`${data.deleted} empresa${data.deleted !== 1 ? 's' : ''} eliminada${data.deleted !== 1 ? 's' : ''}`, 'success')
      setSelected([])
      fetchData()
    } catch {
      notify('No se pudieron eliminar los registros', 'error')
    }
  }

  const handleSaveEdit = async (id, fields) => {
    try {
      const res = await fetch(`/api/companies/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error()
      notify('Los cambios fueron guardados correctamente', 'success')
      setEditTarget(null)
      fetchData()
    } catch {
      notify('No se pudieron guardar los cambios', 'error')
    }
  }

  const numSelected = selected.length
  const rowCount = sortedRows.length

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Paper sx={{ width: '100%', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column', flexGrow: 1, position: 'relative', background: 'linear-gradient(160deg, rgba(59,130,246,0.07) 0%, rgba(139,92,246,0.04) 25%, #0d1117 55%)' }}>
        {/* brillo radial */}
        <Box sx={{ position: 'absolute', top: -50, left: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <EnhancedToolbar
          numSelected={numSelected}
          onDelete={handleDelete}
          onRefresh={fetchData}
          onToggleFilter={() => setFilterOpen((o) => !o)}
          filterOpen={filterOpen}
        />

        <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.07)', position: 'relative', zIndex: 1 }} />

        <Collapse in={filterOpen} sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <FilterBar filters={filters} onChange={handleFilterChange} industries={industries} cities={cities} />
          </Box>
        </Collapse>

        <TableContainer
          sx={{
            flexGrow: 1, position: 'relative', zIndex: 1,
            overflow: 'auto',
            height: 0,
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.13) transparent',
            '&::-webkit-scrollbar': { width: 5, height: 5 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent', marginBlock: '40px' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.13)', borderRadius: 3 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}
        >
          <Table stickyHeader size="small" aria-label="tabla de empresas">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" sx={{ bgcolor: '#161d2e', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <Checkbox
                    color="primary"
                    indeterminate={numSelected > 0 && numSelected < rowCount}
                    checked={rowCount > 0 && numSelected === rowCount}
                    onChange={handleSelectAll}
                    sx={{ color: 'rgba(255,255,255,0.3)', '&.Mui-checked': { color: '#3b82f6' } }}
                  />
                </TableCell>
                {HEAD_CELLS.map((hc) => (
                  <TableCell
                    key={hc.id}
                    align={hc.align}
                    sortDirection={orderBy === hc.id ? order : false}
                    sx={{ bgcolor: '#161d2e', color: 'rgba(255,255,255,0.55)', fontWeight: 600, fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}
                  >
                    {hc.sortable ? (
                      <Box sx={{ display: 'flex', width: '100%', justifyContent: hc.align === 'center' ? 'center' : 'flex-start' }}>
                        {hc.align === 'center' && (
                          <Box component="span" sx={{ width: 22, flexShrink: 0 }} />
                        )}
                        <TableSortLabel
                          active={orderBy === hc.id}
                          direction={orderBy === hc.id ? order : 'asc'}
                          onClick={(e) => handleRequestSort(e, hc.id)}
                          sx={{
                            color: 'inherit !important',
                            '& .MuiTableSortLabel-icon': { color: '#3b82f6 !important', marginLeft: '6px', fontSize: 16 },
                          }}
                        >
                          {hc.label}
                          {orderBy === hc.id && (
                            <Box component="span" sx={visuallyHidden}>
                              {order === 'desc' ? 'sorted descending' : 'sorted ascending'}
                            </Box>
                          )}
                        </TableSortLabel>
                      </Box>
                    ) : hc.label}
                  </TableCell>
                ))}
                <TableCell sx={{ bgcolor: '#161d2e', borderBottom: '1px solid rgba(255,255,255,0.08)' }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <SkeletonRows count={rowsPerPage} />
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={HEAD_CELLS.length + 2} align="center" sx={{ py: 6, color: 'rgba(255,255,255,0.3)', borderBottom: 'none' }}>
                    Sin resultados
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => {
                  const isSelected = selected.includes(row._id)
                  return (
                    <TableRow
                      key={row._id}
                      hover
                      selected={isSelected}
                      sx={{
                        cursor: 'pointer',
                        '&.Mui-selected': { bgcolor: 'rgba(59,130,246,0.08)' },
                        '&.Mui-selected:hover': { bgcolor: 'rgba(59,130,246,0.12)' },
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                        '& td': { borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', fontSize: '0.82rem' },
                      }}
                    >
                      <TableCell padding="checkbox" onClick={() => handleSelectRow(row._id)}>
                        <Checkbox
                          checked={isSelected}
                          color="primary"
                          sx={{ color: 'rgba(255,255,255,0.2)', '&.Mui-checked': { color: '#3b82f6' } }}
                        />
                      </TableCell>
                      <TableCell onClick={() => handleSelectRow(row._id)}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 500, color: 'white' }}>
                          {truncate(row.name, 28) || '—'}
                        </Typography>
                      </TableCell>
                      <TableCell onClick={() => handleSelectRow(row._id)}>
                        <Typography component="a" href={row.website} target="_blank" rel="noopener"
                          onClick={(e) => e.stopPropagation()}
                          sx={{ fontSize: '0.78rem', color: '#60a5fa', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                          {truncate(row.website || row.domain, 30)}
                        </Typography>
                      </TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{truncate(row.industry, 22)}</TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{row.city || '—'}</TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>
                        {row.has_whatsapp ? (
                          <Chip icon={<WhatsAppIcon sx={{ fontSize: '13px !important' }} />} label="Sí" size="small"
                            sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', height: 20, fontSize: '0.7rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
                        ) : (
                          <Chip label="No" size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', height: 20, fontSize: '0.7rem' }} />
                        )}
                      </TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{formatDate(row.created_at)}</TableCell>
                      <TableCell align="right" sx={{ pr: 1 }}>
                        <Tooltip title="Editar">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditTarget(row) }}
                            sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: '#3b82f6', bgcolor: 'rgba(59,130,246,0.1)' } }}>
                            <EditIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          rowsPerPageOptions={[10, 25, 50]}
          component="div"
          count={total}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
          labelRowsPerPage="Filas por página:"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count !== -1 ? count : `más de ${to}`}`}
          sx={{
            color: 'rgba(255,255,255,0.5)',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            '& .MuiTablePagination-toolbar': { minHeight: 48 },
            '& .MuiTablePagination-selectIcon': { color: 'rgba(255,255,255,0.4)' },
            '& .MuiIconButton-root': { color: 'rgba(255,255,255,0.4)' },
            '& .Mui-disabled': { opacity: 0.3 },
            '& .MuiSelect-select': { color: 'rgba(255,255,255,0.6)' },
          }}
        />
      </Paper>

      <EditDialog
        open={!!editTarget}
        company={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleSaveEdit}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{
            borderRadius: 2,
            border: `1px solid ${snack.severity === 'success' ? 'rgba(34,197,94,0.25)' : snack.severity === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.25)'}`,
            bgcolor: snack.severity === 'success' ? 'rgba(15,23,30,0.97)' : snack.severity === 'error' ? 'rgba(20,10,10,0.97)' : 'rgba(10,15,30,0.97)',
            minWidth: 280,
          }}
        >
          <AlertTitle sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
            {ALERT_TITLES[snack.severity]}
          </AlertTitle>
          <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>
            {snack.msg}
          </Typography>
        </Alert>
      </Snackbar>
    </Box>
  )
}
