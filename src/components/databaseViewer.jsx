'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { authFetch } from '@/lib/api'
import { useSendQueue } from '../context/SendQueueContext'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
const display = v => (!v || ['null','none','undefined','n/a'].includes(String(v).trim().toLowerCase())) ? '—' : v
import { useLang } from '../context/LangContext'
import { isValidUrl, urlValidationMsg, isValidWhatsAppNumber, waNumberValidationMsg } from '@/lib/validators'
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
import LinearProgress from '@mui/material/LinearProgress'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import FilterListIcon from '@mui/icons-material/FilterList'
import SearchIcon from '@mui/icons-material/Search'
import RefreshIcon from '@mui/icons-material/Refresh'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import StorageIcon from '@mui/icons-material/Storage'
import AddIcon from '@mui/icons-material/Add'
import VisibilityIcon from '@mui/icons-material/Visibility'
import SendIcon from '@mui/icons-material/Send'
import MessageIcon from '@mui/icons-material/Message'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { visuallyHidden } from '@mui/utils'

function cleanDomain(url) {
  if (!url) return null
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch { return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] }
}
import ResultDisplay from './resultDisplay'
import { MessageComposer, getTemplates } from './singleUrlProcessor'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { MIN_TEMPLATES_FOR_BULK, pickMessageVariant } from '@/lib/messageVariants'
import { HighlightedMessageInput } from './highlightedMessageInput'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { InstanceDisconnectedBanner, SendErrorBanner } from './InstanceStatusBanner'
import { SendConfigPanel, CountdownBar } from './SendConfigPanel'
import { loadSendConfig, randMsgDelayMs, randBatchBreakMs, randBatchSize } from '@/lib/sendConfig'

function getHeadCells(t) {
  return [
    { id: 'name',         label: t.db.colCompany,    align: 'center', sortable: true  },
    { id: 'website',      label: t.db.colWebsite,    align: 'center', sortable: false },
    { id: 'industry',     label: t.db.colIndustry,   align: 'center', sortable: true  },
    { id: 'city',         label: t.db.colCity,       align: 'center', sortable: true  },
    { id: 'has_whatsapp', label: t.db.whatsapp,      align: 'center', sortable: true  },
    { id: 'created_at',   label: t.db.colRegistered, align: 'center', sortable: true  },
    { id: 'last_scraped_at', label: t.db.colLastScraped, align: 'center', sortable: true },
  ]
}

function getWhatsappOptions(t) {
  return [
    { value: '', label: t.db.waAll },
    { value: 'true', label: t.db.waWith },
    { value: 'false', label: t.db.waWithout },
  ]
}

function getAlertTitles(t) {
  return {
    success: t.db.alertDone,
    error:   t.common.error,
    info:    'Info',
    warning: t.db.alertWarning,
  }
}

const MENU_PROPS = {
  slotProps: {
    paper: {
      sx: {
        bgcolor: 'var(--sidebar-bg, #0d1117)',
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        borderRadius: 2,
        mt: 0.5,
        '& .MuiMenuItem-root': {
          fontSize: '0.82rem',
          color: 'var(--text-muted, rgba(255,255,255,0.75))',
          '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)' },
          '&.Mui-selected': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.18)', color: 'var(--text, white)' },
          '&.Mui-selected:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.25)' },
        },
        '& ul': {
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--scrollbar-thumb, rgba(255,255,255,0.15)) transparent',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-button': { display: 'none' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: 'var(--scrollbar-thumb, rgba(255,255,255,0.15))', borderRadius: 2 },
          '&::-webkit-scrollbar-thumb:hover': { background: 'var(--scrollbar-thumb-hover, rgba(255,255,255,0.3))' },
        },
      },
    },
  },
}

const SELECT_SX = {
  bgcolor: 'var(--surface, #0d1117)',
  color: 'var(--text, rgba(255,255,255,0.85))',
  '& .MuiSelect-icon': { color: 'var(--text-muted, rgba(255,255,255,0.4))' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border, rgba(255,255,255,0.12))' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.35)' },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent, #3b82f6)' },
}

const LABEL_SX = {
  color: 'var(--text-muted, rgba(255,255,255,0.4))',
  '&.Mui-focused': { color: 'var(--accent, #3b82f6)' },
  '&.MuiFormLabel-filled': { color: 'var(--text-muted, rgba(255,255,255,0.55))' },
}

const FIELD_SX = {
  '& .MuiInputBase-root': { color: 'rgba(255,255,255,0.85)' },
  '& .MuiOutlinedInput-input': { paddingTop: '16.5px', paddingBottom: '8.5px' },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.35)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent, #3b82f6)' },
  '& .MuiInputLabel-root.Mui-error': { color: '#f87171' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.22)' },
  '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent, #3b82f6)' },
  '& .MuiInputBase-root.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#ef4444 !important' },
  '& .MuiFormHelperText-root': { color: 'rgba(255,255,255,0.3)' },
  '& .MuiFormHelperText-root.Mui-error': { color: '#f87171' },
}

const SKEL_SX = {
  bgcolor: 'var(--border)',
  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.04), transparent)' },
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function truncate(str, n = 32) {
  if (!str) return '—'
  return str.length > n ? str.slice(0, n) + '…' : str
}

function renderTemplate(template, row) {
  if (!template) return ''
  return template.text
    .replace(/\{\{nombre\}\}/g,    row.name     || '')
    .replace(/\{\{ciudad\}\}/g,    row.city     || '')
    .replace(/\{\{industria\}\}/g, row.industry || '')
    .replace(/\{\{web\}\}/g,       row.website  || row.domain || '')
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────
function EnhancedToolbar({ numSelected, onDelete, onCampaign, onRescrape, rescraping, selectedWithWA, onRefresh, onToggleFilter, filterOpen, total, instanceStatus, onAddCompany }) {
  const { t, lang } = useLang()
  const { stats: capStats } = useDailyCapStats()
  const capBlocked = !!(capStats && capStats.total_available <= 0)
  return (
    <Toolbar sx={{
      pl: { sm: 2 }, pr: { xs: 1, sm: 1 },
      borderRadius: '12px 12px 0 0', position: 'relative', zIndex: 1,
      background: 'linear-gradient(135deg, rgba(var(--accent-rgb, 59,130,246), 0.12) 0%, rgba(var(--accent-rgb, 59,130,246), 0.04) 60%, transparent 100%)',
      minHeight: '60px !important',
      borderBottom: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.15)',
      '&::after': {
        content: '""', position: 'absolute', bottom: 0, left: 16, right: 16, height: '1px',
        background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.4) 40%, rgba(var(--accent-rgb,59,130,246),0.4) 60%, transparent)',
      },
    }}>
      {/* Left: icon + title + stats */}
      <Box sx={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.25) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <StorageIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 16 }} />
        </Box>
        <Box>
          <Typography variant="h6" sx={{ color: 'var(--text, white)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
            {t.db.heading}
          </Typography>
          {total > 0 && (
            <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
              {total.toLocaleString()} {total === 1 ? t.db.companySingular : t.db.companySingular + 's'} {t.db.registradas}
            </Typography>
          )}
        </Box>
        {numSelected > 0 && (
          <Chip
            label={`${numSelected} ${numSelected !== 1 ? t.db.selected : t.db.selectedSingle}`}
            size="small"
            sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600, bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.15)', color: 'var(--accent, #60a5fa)', border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.3)' }}
          />
        )}
      </Box>

      {/* Right: contextual actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        {numSelected > 0 ? (
          <>
            <Tooltip title={
              instanceStatus === 'disconnected' ? t.db.instDisconnTip :
              capBlocked ? (lang === 'en' ? `Daily limit reached (${capStats.total_sent}/${capStats.total_cap}). Resets at midnight.` : `Límite diario alcanzado (${capStats.total_sent}/${capStats.total_cap}). Reinicia a medianoche.`) :
              selectedWithWA === 0 ? t.db.noWaSelected :
              `${t.db.sendMsgTo} ${selectedWithWA} ${t.db.withWA}`
            }>
              <span>
                <Button size="small" onClick={onCampaign} disabled={selectedWithWA === 0 || instanceStatus === 'disconnected' || capBlocked}
                  startIcon={<MessageIcon sx={{ fontSize: '14px !important' }} />}
                  sx={{
                    fontSize: '0.75rem', fontWeight: 600, textTransform: 'none',
                    color: instanceStatus === 'disconnected' ? '#ef4444' : '#4ade80',
                    bgcolor: instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.1)',
                    border: `1px solid ${instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
                    borderRadius: 1.5, px: 1.5, py: 0.5,
                    '&:hover': { bgcolor: instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.18)', borderColor: instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)' },
                    '&.Mui-disabled': instanceStatus === 'disconnected'
                      ? { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }
                      : { color: 'rgba(255,255,255,0.2)', bgcolor: 'transparent', border: '1px solid rgba(255,255,255,0.08)' },
                  }}
                >
                  {t.db.send}{selectedWithWA > 0 ? ` (${selectedWithWA})` : ''}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={rescraping ? `${t.db.rescraping} ${rescraping}…` : `${t.db.rescrape} ${numSelected} ${t.db.companySingular}${numSelected !== 1 ? 's' : ''}`}>
              <span>
                <Button size="small" onClick={onRescrape} disabled={!!rescraping}
                  startIcon={rescraping ? <CircularProgress size={12} sx={{ color: 'inherit' }} /> : <RefreshIcon sx={{ fontSize: '14px !important' }} />}
                  sx={{
                    fontSize: '0.75rem', fontWeight: 600, textTransform: 'none',
                    color: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.1)',
                    border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.25)', borderRadius: 1.5,
                    px: 1.5, py: 0.5,
                    '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.18)', borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.45)' },
                    '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)', bgcolor: 'transparent', border: '1px solid rgba(255,255,255,0.08)' },
                  }}>
                  {t.db.rescrape}
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={`${t.db.delete} ${numSelected} ${t.db.companySingular}${numSelected !== 1 ? 's' : ''}`}>
              <IconButton onClick={onDelete} size="small"
                sx={{ color: 'rgba(255,255,255,0.3)', ml: 0.5, '&:hover': { color: '#f87171', bgcolor: 'rgba(239,68,68,0.1)' } }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title={t.db.addCompanyTip}>
              <Button size="small" onClick={onAddCompany} startIcon={<AddIcon sx={{ fontSize: '15px !important' }} />}
                sx={{
                  fontSize: '0.75rem', fontWeight: 600, textTransform: 'none',
                  color: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)',
                  border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', borderRadius: 1.5,
                  px: 1.5, py: 0.5, mr: 0.5,
                  '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.18)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
                }}>
                {t.db.addCompany}
              </Button>
            </Tooltip>
            <Tooltip title={t.db.refresh}>
              <IconButton onClick={onRefresh} size="small" sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', '&:hover': { color: 'var(--text, white)' } }}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t.db.filters}>
              <IconButton onClick={onToggleFilter} size="small" sx={{ color: filterOpen ? 'var(--accent, #3b82f6)' : 'var(--text-muted, rgba(255,255,255,0.5))', '&:hover': { color: 'var(--text, white)' } }}>
                <FilterListIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
    </Toolbar>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function FilterBar({ filters, onChange, industries, cities }) {
  const { t } = useLang()
  const [openIndustry, setOpenIndustry] = useState(false)
  const [openCity,     setOpenCity]     = useState(false)
  const [openWA,       setOpenWA]       = useState(false)

  const whatsappOptions = getWhatsappOptions(t)

  return (
    <Box sx={{ px: 2, pt: 2, pb: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        placeholder={t.db.searchPh}
        value={filters.search}
        onChange={(e) => onChange('search', e.target.value)}
        sx={{
          minWidth: 220, flexGrow: 1,
          '& .MuiInputBase-root': { bgcolor: 'var(--surface, #0d1117)', color: 'var(--text, rgba(255,255,255,0.85))' },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border, rgba(255,255,255,0.12))' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.35)' },
          '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent, #3b82f6)' },
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'var(--text-muted, rgba(255,255,255,0.35))' }} />
              </InputAdornment>
            ),
          },
        }}
      />

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="filter-industry-label" sx={LABEL_SX}>{t.db.industry}</InputLabel>
        <Select
          labelId="filter-industry-label"
          open={openIndustry}
          onClose={() => setOpenIndustry(false)}
          onOpen={() => setOpenIndustry(true)}
          value={filters.industry}
          label={t.db.industry}
          onChange={(e) => onChange('industry', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          <MenuItem value=""><em>{t.db.allF}</em></MenuItem>
          {industries.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel id="filter-city-label" sx={LABEL_SX}>{t.db.city}</InputLabel>
        <Select
          labelId="filter-city-label"
          open={openCity}
          onClose={() => setOpenCity(false)}
          onOpen={() => setOpenCity(true)}
          value={filters.city}
          label={t.db.city}
          onChange={(e) => onChange('city', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          <MenuItem value=""><em>{t.db.allF}</em></MenuItem>
          {cities.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel id="filter-wa-label" sx={LABEL_SX}>{t.db.whatsapp}</InputLabel>
        <Select
          labelId="filter-wa-label"
          open={openWA}
          onClose={() => setOpenWA(false)}
          onOpen={() => setOpenWA(true)}
          value={filters.has_whatsapp}
          label={t.db.whatsapp}
          onChange={(e) => onChange('has_whatsapp', e.target.value)}
          sx={SELECT_SX}
          MenuProps={MENU_PROPS}
        >
          {whatsappOptions.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.value === '' ? <em>{o.label}</em> : o.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  )
}

// ─── Add company dialog (manual entry, no scraping) ────────────────────────────
const ADD_COMPANY_DEFAULTS = { name: '', industry: '', city: '', state: '', website: '', whatsapp_number: '', description: '' }

function AddCompanyDialog({ open, onClose, onCreated, onNotify }) {
  const { t } = useLang()
  const [form, setForm] = useState(ADD_COMPANY_DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => { if (open) { setForm(ADD_COMPANY_DEFAULTS); setTouched(false) } }, [open])

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  // The backend auto-prepends https:// to a bare domain (see api_create_company),
  // so validate the same normalized form it will actually store — otherwise typing
  // "empresa.com" without the protocol gets rejected here even though it'd work fine.
  const websiteTrimmed = form.website.trim()
  const websiteNormalized = websiteTrimmed && !websiteTrimmed.startsWith('http') ? `https://${websiteTrimmed}` : websiteTrimmed
  const webErr = websiteTrimmed ? urlValidationMsg(websiteNormalized, { badProtocol: t.common.urlBadProtocol, invalid: t.common.urlInvalid }) : ''
  const waErr  = form.whatsapp_number.trim() ? waNumberValidationMsg(form.whatsapp_number.trim(), { empty: t.db.numEmpty, invalid: t.db.numInvalidFmt }) : ''
  const nameErr = touched && !form.name.trim()

  async function handleCreate() {
    setTouched(true)
    if (!form.name.trim() || webErr || waErr) return
    setSaving(true)
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || t.db.addCompanyError)
      onCreated?.()
    } catch (err) {
      onNotify?.(err.message || t.db.addCompanyError, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: {
        background: 'var(--sidebar-bg, #0d1117)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.85)', overflow: 'hidden',
      } } }}>
      <DialogTitle sx={{ p: 0, bgcolor: 'var(--surface, #111827)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Box sx={{ px: 3, pt: 3, pb: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AddIcon sx={{ color: 'var(--accent, #60a5fa)', fontSize: 22 }} />
          </Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>{t.db.addCompanyTitle}</Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1.8, bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
        <TextField label={t.db.nameLabel} size="small" fullWidth sx={{ ...FIELD_SX, mt: 1 }}
          value={form.name} onChange={e => set('name', e.target.value)}
          error={nameErr} helperText={nameErr ? t.db.nameRequired : ''} />
        <TextField label={t.db.websiteLabel} size="small" fullWidth sx={FIELD_SX}
          value={form.website} onChange={e => set('website', e.target.value)}
          error={!!webErr} helperText={webErr || t.db.websiteEx} />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField label={t.db.industryLabel2} size="small" fullWidth sx={FIELD_SX} value={form.industry} onChange={e => set('industry', e.target.value)} />
          <TextField label={t.db.cityLabel2} size="small" fullWidth sx={FIELD_SX} value={form.city} onChange={e => set('city', e.target.value)} />
        </Box>
        <TextField label={t.db.stateLabel} size="small" fullWidth sx={FIELD_SX} value={form.state} onChange={e => set('state', e.target.value)} />
        <TextField label={t.db.whatsappNumLabel} size="small" fullWidth sx={FIELD_SX}
          placeholder="+52 55 1234 5678" value={form.whatsapp_number} onChange={e => set('whatsapp_number', e.target.value)}
          error={!!waErr} helperText={waErr || t.db.whatsappNumHint} />
        <TextField label={t.db.descLabel} size="small" fullWidth multiline rows={2} sx={FIELD_SX}
          placeholder={t.db.descPh} value={form.description} onChange={e => set('description', e.target.value)} />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, gap: 1 }}>
        <Button onClick={onClose} disabled={saving} sx={{ color: 'rgba(255,255,255,0.5)', borderRadius: 2, textTransform: 'none' }}>
          {t.common.cancel}
        </Button>
        <Button onClick={handleCreate} disabled={saving} variant="contained"
          startIcon={saving ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <AddIcon sx={{ fontSize: '16px !important' }} />}
          sx={{ bgcolor: 'var(--accent,#3b82f6)', borderRadius: 2, fontWeight: 700, textTransform: 'none', '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.9)' } }}>
          {t.db.addCompany}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────
function EditDialog({ open, company, contacts, onClose, onSave }) {
  const { t, lang } = useLang()
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [waNumbers, setWaNumbers] = useState([])
  const [newNum, setNewNum] = useState('')
  const [newNumError, setNewNumError] = useState('')
  const [editingIdx, setEditingIdx] = useState(null)
  const [editingVal, setEditingVal] = useState('')
  const [editingError, setEditingError] = useState('')

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

  useEffect(() => {
    if (contacts) { setWaNumbers(contacts); setEditingIdx(null) }
  }, [contacts])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const addNum = () => {
    const n = newNum.trim()
    if (!n) { setNewNumError(t.db.numEmpty); return }
    const waMsgs = { empty: t.db.numEmpty, invalid: t.db.numInvalidFmt }
    const err = waNumberValidationMsg(n, waMsgs)
    if (err) { setNewNumError(err); return }
    if (waNumbers.includes(n)) { setNewNumError(t.db.numDuplicate); return }
    setWaNumbers(prev => [...prev, n])
    setNewNum('')
    setNewNumError('')
  }
  const removeNum = (idx) => setWaNumbers(prev => prev.filter((_, i) => i !== idx))

  const startEdit = (idx) => { setEditingIdx(idx); setEditingVal(waNumbers[idx]); setEditingError('') }
  const commitEdit = () => {
    const v = editingVal.trim()
    if (!v) { setEditingError(t.db.numEmpty); return }
    const waMsgs = { empty: t.db.numEmpty, invalid: t.db.numInvalidFmt }
    const err = waNumberValidationMsg(v, waMsgs)
    if (err) { setEditingError(err); return }
    if (waNumbers.some((n, i) => n === v && i !== editingIdx)) { setEditingError(t.db.numDuplicate); return }
    setWaNumbers(prev => prev.map((n, i) => i === editingIdx ? v : n))
    setEditingIdx(null)
    setEditingVal('')
    setEditingError('')
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(company._id, form, waNumbers)
    setSaving(false)
  }

  const initial = (company?.name || '?')[0].toUpperCase()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: {
          background: 'var(--sidebar-bg, #0d1117)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 3,
          boxShadow: '0 24px 64px rgba(0,0,0,0.85)',
          overflow: 'hidden',
        } } }}
    >
      {/* Header */}
      <DialogTitle sx={{ p: 0, bgcolor: 'var(--surface, #111827)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Box sx={{
          px: 3, pt: 3, pb: 2.5,
          display: 'flex', alignItems: 'center', gap: 2,
          bgcolor: 'inherit',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Avatar sx={{
            width: 44, height: 44, flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.2)',
            border: '1px solid rgba(var(--accent-rgb, 59,130,246), 0.35)',
            color: 'var(--accent, #60a5fa)',
            fontWeight: 700,
            fontSize: '1.1rem',
          }}>
            {initial}
          </Avatar>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              {t.db.editTitle}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', mt: 0.25 }}>
              {truncate(company?.name || '', 40)}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 0, bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
        {/* Sección: General */}
        <Typography variant="overline" sx={{ color: 'var(--accent, #3b82f6)', fontSize: '0.65rem', letterSpacing: 1.5, mb: 1.5, display: 'block' }}>
          {t.db.generalInfo}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, mb: 2.5 }}>
          <TextField label={t.db.nameLabel} size="small" fullWidth sx={FIELD_SX}
            value={form.name || ''}
            onChange={(e) => set('name', e.target.value)}
            error={form.name !== undefined && !form.name?.trim()}
            helperText={form.name !== undefined && !form.name?.trim() ? t.db.nameRequired : ''}
          />
          {(() => {
            const webErr = form.website?.trim() ? urlValidationMsg(form.website.trim(), { badProtocol: t.common.urlBadProtocol, invalid: t.common.urlInvalid }) : ''
            return (
              <TextField label={t.db.websiteLabel} size="small" fullWidth sx={FIELD_SX}
                value={form.website || ''}
                onChange={(e) => set('website', e.target.value)}
                error={!!webErr}
                helperText={webErr || t.db.websiteEx}
              />
            )
          })()}
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField label={t.db.industryLabel2} size="small" fullWidth sx={FIELD_SX} value={form.industry || ''} onChange={(e) => set('industry', e.target.value)} />
            <TextField label={t.db.cityLabel2}     size="small" fullWidth sx={FIELD_SX} value={form.city     || ''} onChange={(e) => set('city',     e.target.value)} />
          </Box>
          <TextField label={t.db.stateLabel} size="small" fullWidth sx={FIELD_SX} value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 2.5 }} />

        {/* Sección: Descripción */}
        <Typography variant="overline" sx={{ color: 'var(--accent, #3b82f6)', fontSize: '0.65rem', letterSpacing: 1.5, mb: 1.5, display: 'block' }}>
          {t.db.descLabel}
        </Typography>
        <TextField
          size="small" fullWidth multiline rows={2}
          placeholder={t.db.descPh}
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
                {t.db.hasWhatsApp}
              </Typography>
              <Typography sx={{ color: 'rgba(255, 255, 255, 0.26)', fontSize: '0.72rem' }}>
                {form.has_whatsapp ? t.db.registeredNum : t.db.noRegisteredNum}
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

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', my: 2 }} />
        <Typography variant="overline" sx={{ color: 'var(--accent, #3b82f6)', fontSize: '0.65rem', letterSpacing: 1.5, mb: 1.5, display: 'block' }}>
          {t.db.whatsappNums}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, mb: 1.5 }}>
          {waNumbers.length === 0 && (
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.78rem' }}>{t.db.noNumsReg}</Typography>
          )}
          {waNumbers.map((n, i) => (
            editingIdx === i ? (
              <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <TextField
                    size="small" autoFocus fullWidth value={editingVal}
                    onChange={(e) => { setEditingVal(e.target.value); if (editingError) setEditingError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditingIdx(null); setEditingError('') } }}
                    onBlur={commitEdit}
                    error={!!editingError}
                    sx={{ ...FIELD_SX,
                      '& .MuiInputBase-root': { color: i === 0 ? '#4ade80' : 'rgba(255,255,255,0.85)', fontSize: '0.82rem' },
                      '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: i === 0 ? '#4ade80' : '#3b82f6' },
                    }}
                  />
                  {editingError && <Typography sx={{ color: '#f87171', fontSize: '0.68rem', mt: 0.3 }}>{editingError}</Typography>}
                </Box>
              </Box>
            ) : (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1,
                px: 1.5, py: 0.6, borderRadius: 1.5,
                bgcolor: i === 0 ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${i === 0 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`,
                cursor: 'pointer', '&:hover': { bgcolor: i === 0 ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.07)' },
              }}>
                {i === 0 && (
                  <Typography sx={{ fontSize: '0.6rem', color: '#4ade80', fontWeight: 700,
                    bgcolor: 'rgba(34,197,94,0.15)', px: 0.6, borderRadius: 0.5, lineHeight: '16px' }}>
                    {t.db.primaryNum}
                  </Typography>
                )}
                <Typography onClick={() => startEdit(i)}
                  sx={{ flex: 1, fontSize: '0.82rem', color: i === 0 ? '#4ade80' : 'rgba(255,255,255,0.75)',
                        fontFamily: 'monospace' }}>
                  {n}
                </Typography>
                <Tooltip title={t.db.editBtn}>
                  <IconButton size="small" onClick={() => startEdit(i)}
                    sx={{ color: 'rgba(255,255,255,0.2)', p: 0.3, '&:hover': { color: '#3b82f6' } }}>
                    <EditIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t.db.delete}>
                  <IconButton size="small" onClick={() => removeNum(i)}
                    sx={{ color: 'rgba(255,255,255,0.2)', p: 0.3, '&:hover': { color: '#f87171' } }}>
                    <DeleteIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            )
          ))}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField size="small" fullWidth placeholder="+52 55 1234 5678" value={newNum}
              onChange={(e) => { setNewNum(e.target.value); if (newNumError) setNewNumError('') }}
              onKeyDown={(e) => e.key === 'Enter' && addNum()}
              error={!!newNumError}
              sx={FIELD_SX} />
            <Button onClick={addNum} variant="outlined" size="small"
              disabled={!newNum.trim()}
              sx={{ borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80', minWidth: 64,
                    '&:hover': { borderColor: '#4ade80', bgcolor: 'rgba(34,197,94,0.08)' },
                    '&.Mui-disabled': { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.2)' } }}>
              {t.db.addNum}
            </Button>
          </Box>
          {newNumError && (
            <Typography sx={{ color: '#f87171', fontSize: '0.72rem', pl: 0.5 }}>{newNumError}</Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 2, gap: 1, bgcolor: 'var(--sidebar-bg, #0d1117)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Button
          onClick={onClose}
          sx={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, px: 2.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' } }}
        >
          {t.common.cancel}
        </Button>
        {(() => {
          const nameErr   = !form.name?.trim()
          const webErr    = !!(form.website?.trim() && urlValidationMsg(form.website.trim(), { badProtocol: t.common.urlBadProtocol, invalid: t.common.urlInvalid }))
          const waErr     = form.has_whatsapp && waNumbers.length === 0
          const isInvalid = nameErr || webErr || waErr
          const tooltip   = nameErr   ? (lang === 'en' ? 'Company name is required' : 'El nombre de la empresa es requerido')
                          : webErr    ? (lang === 'en' ? 'Website has an invalid format' : 'El sitio web tiene un formato inválido')
                          : waErr     ? (lang === 'en' ? 'Company has WhatsApp enabled but no numbers registered' : 'La empresa tiene WhatsApp activo pero no hay números registrados')
                          : ''
          return (
            <Tooltip title={tooltip} disableHoverListener={!isInvalid || saving}>
              <span>
                <Button
                  variant="contained"
                  onClick={handleSave}
                  disabled={saving || isInvalid}
                  sx={{ bgcolor: '#3b82f6', borderRadius: 2, px: 3, fontWeight: 600,
                    '&:hover': { bgcolor: '#2563eb' },
                    '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)' },
                  }}
                >
                  {saving ? <CircularProgress size={16} sx={{ color: 'rgba(255,255,255,0.5)' }} /> : t.db.saveChanges}
                </Button>
              </span>
            </Tooltip>
          )
        })()}
      </DialogActions>
    </Dialog>
  )
}

// ─── Skeleton rows ─────────────────────────────────────────────────────────────
// Debe tener exactamente las mismas 9 celdas que una fila real (checkbox + 7
// columnas de headCells + acciones) — antes se quedaba corto por una columna
// (faltaba "Últ. scrape") y la celda de acciones iba vacía, así que al llegar
// los datos reales aparecía una columna entera de golpe en vez de solo
// rellenarse el contenido.
function SkeletonRows({ count }) {
  return Array.from({ length: count }).map((_, i) => (
    <TableRow key={i}>
      <TableCell padding="checkbox">
        <Skeleton variant="rounded" width={18} height={18} sx={SKEL_SX} />
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9 }}>
          <Skeleton variant="circular" width={6} height={6} sx={SKEL_SX} />
          <Skeleton variant="text" width="70%" sx={{ ...SKEL_SX, fontSize: '0.82rem', flex: 1 }} />
        </Box>
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
      <TableCell align="center">
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="text" width={80} sx={{ ...SKEL_SX, fontSize: '0.82rem' }} />
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ pr: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
          <Skeleton variant="circular" width={22} height={22} sx={SKEL_SX} />
          <Skeleton variant="circular" width={22} height={22} sx={SKEL_SX} />
          <Skeleton variant="circular" width={22} height={22} sx={SKEL_SX} />
        </Box>
      </TableCell>
    </TableRow>
  ))
}

// ─── Campaign dialog ──────────────────────────────────────────────────────────
export const MAX_CAMPAIGN_MSG = 4096

export function CampaignDialog({ open, selectedRows, onClose, onNotify, instanceStatus = 'unknown', isDisconnected = false }) {
  const { t, lang } = useLang()
  const TEMPLATES_DATA = getTemplates(t)
  const [msgText,      setMsgText]      = useState(TEMPLATES_DATA[0].text)
  const [extraVariants, setExtraVariants] = useState([])
  const [sending,      setSending]      = useState(false)
  const [sendError,    setSendError]    = useState('')
  const [progress,     setProgress]     = useState(0)
  const [results,      setResults]      = useState([])
  const [done,         setDone]         = useState(false)
  const sendingRef  = useRef(false)
  const cancelRef   = useRef(false)
  const [activeTpl,    setActiveTpl]    = useState(TEMPLATES_DATA[0].id)
  const [sendCfg,      setSendCfg]      = useState(() => loadSendConfig())
  const [countdown,    setCountdown]    = useState(null)
  const [cdTotal,      setCdTotal]      = useState(null)
  const [cdLabel,      setCdLabel]      = useState('msg')
  const [batchNum,     setBatchNum]     = useState(1)

  useEffect(() => {
    if (!open) { setSending(false); setProgress(0); setResults([]); setDone(false); setCountdown(null); cancelRef.current = false }
  }, [open])

  function applyTemplate(tpl) {
    setActiveTpl(tpl.id)
    setMsgText(tpl.text)
  }

  const waRows      = selectedRows.filter(r => r.has_whatsapp)
  const sentCount   = results.filter(r => r.status === 'sent').length
  const failedCount = results.filter(r => r.status === 'failed').length
  const noWaCount   = results.filter(r => r.status === 'no_wa').length
  const charCount   = msgText.length
  const isBulk      = waRows.length > 1
  // En bulk, el mensaje base deja de usarse — solo se envían las plantillas
  // marcadas en la Biblioteca, para que lo enviado sea exactamente lo seleccionado.
  const msgInvalid  = !isBulk && (!msgText.trim() || charCount > MAX_CAMPAIGN_MSG)
  const allVariants   = (isBulk ? extraVariants : [msgText]).map(v => v.trim()).filter(Boolean)
  const belowMinTemplates = isBulk && allVariants.length < MIN_TEMPLATES_FOR_BULK

  async function waitWithTimer(ms, label) {
    const totalSecs = Math.ceil(ms / 1000)
    setCdTotal(totalSecs); setCountdown(totalSecs); setCdLabel(label)
    const end = Date.now() + ms
    await new Promise(resolve => {
      const tick = () => {
        if (cancelRef.current) { resolve(); return }
        const remaining = end - Date.now()
        if (remaining <= 0) { setCountdown(0); resolve(); return }
        setCountdown(Math.ceil(remaining / 1000))
        setTimeout(tick, 200)
      }
      tick()
    })
    setCountdown(null); setCdTotal(null)
  }

  async function handleSend() {
    if (msgInvalid || sendingRef.current || belowMinTemplates) return
    cancelRef.current = false
    sendingRef.current = true
    setSending(true); setProgress(0); setResults([]); setDone(false)
    const res = []
    let lastVariant = null
    let msgsInBatch = 0
    let nextBreakAt = randBatchSize(sendCfg)
    let currentBatch = 1
    setBatchNum(1)
    for (let i = 0; i < waRows.length; i++) {
      if (cancelRef.current) break
      const row = waRows[i]
      setProgress(Math.round(((i + 1) / waRows.length) * 100))
      try {
        const compRes  = await fetch(`/api/companies/${row._id}`)
        const data     = await compRes.json()
        const contacts = data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || []
        if (contacts.length === 0) {
          res.push({ name: row.name, status: 'no_wa' }); setResults([...res]); continue
        }
        let lastStatus = 'failed'
        for (const num of contacts) {
          const variant = pickMessageVariant(allVariants, lastVariant)
          lastVariant = variant
          const message = variant
            .replace(/\{\{nombre\}\}/g,    row.name     || '')
            .replace(/\{\{ciudad\}\}/g,    row.city     || '')
            .replace(/\{\{industria\}\}/g, row.industry || '')
            .replace(/\{\{web\}\}/g,       row.website  || row.domain || '')
          const r = await authFetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_id: row._id, to_number: num, message, website: row.website }),
          })
          if (!r.ok) {
            const errJson = await r.json().catch(() => ({}))
            let detail = errJson.detail || `Error ${r.status}`
            const ncMatch = detail.match(/^new_contact_limit:(\d+)$/)
            if (ncMatch) {
              detail = `Límite de contactos nuevos alcanzado (${ncMatch[1]}/día)`
            }
            setSendError(detail)
            setTimeout(() => setSendError(''), 10_000)
            throw new Error(detail)
          }
          const json = await r.json()
          if (json.status === 'sent') lastStatus = 'sent'
        }
        res.push({ name: row.name, status: lastStatus })
      } catch {
        res.push({ name: row.name, status: 'failed' })
      }
      setResults([...res])
      msgsInBatch++
      if (i < waRows.length - 1) {
        if (msgsInBatch >= nextBreakAt) {
          msgsInBatch = 0
          nextBreakAt = randBatchSize(sendCfg)
          currentBatch++
          setBatchNum(currentBatch)
          await waitWithTimer(randBatchBreakMs(sendCfg), 'batch')
        } else {
          await waitWithTimer(randMsgDelayMs(sendCfg), 'msg')
        }
      }
    }
    setSending(false); setDone(true); sendingRef.current = false
    setCountdown(null); setBatchNum(1)
    const sent = res.filter(r => r.status === 'sent').length
    onNotify(
      lang === 'en' ? `${sent} message${sent !== 1 ? 's' : ''} sent` : `${sent} mensaje${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''}`,
      sent > 0 ? 'success' : 'warning'
    )
  }

  return (
    <Dialog open={open} onClose={!sending ? onClose : undefined} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg, #0d1117)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.85)', overflow: 'hidden' } } }}>
      <DialogTitle sx={{ p: 0, bgcolor: 'var(--surface, #111827)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Box sx={{ px: 3, pt: 3, pb: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ width: 44, height: 44, flexShrink: 0, bgcolor: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageIcon sx={{ color: '#4ade80', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              {lang === 'en' ? 'Send campaign' : 'Enviar campaña'}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', mt: 0.25 }}>
              {lang === 'en'
                ? `${waRows.length} ${waRows.length !== 1 ? 'companies' : 'company'} with WhatsApp selected`
                : `${waRows.length} empresa${waRows.length !== 1 ? 's' : ''} con WhatsApp seleccionada${waRows.length !== 1 ? 's' : ''}`}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 2.5, pb: 1, bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
        {!isBulk && <>
        {/* Plantillas como punto de partida */}
        <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
          {t.batch.baseTemplate}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 1.8 }}>
          {TEMPLATES_DATA.map(tpl => (
            <Chip key={tpl.id} label={tpl.label} size="small"
              onClick={() => !sending && applyTemplate(tpl)}
              sx={{
                fontSize: '0.72rem', height: 26, cursor: sending ? 'default' : 'pointer',
                bgcolor: activeTpl === tpl.id ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.04)',
                color:   activeTpl === tpl.id ? '#4ade80' : 'rgba(255,255,255,0.45)',
                border:  `1px solid ${activeTpl === tpl.id ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
                '&:hover': !sending ? { bgcolor: 'rgba(34,197,94,0.1)' } : {},
              }} />
          ))}
        </Box>

        {/* Editor libre */}
        <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
          {lang === 'en' ? 'Message' : 'Mensaje'}
        </Typography>
        <HighlightedMessageInput value={msgText} onChange={setMsgText} disabled={sending} rows={5} maxLength={MAX_CAMPAIGN_MSG + 1} lang={lang} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.6, mb: 1.5 }}>
          <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)' }}>
            Variables: <Box component="span" sx={{ color: '#4ade80', fontFamily: 'monospace' }}>{'{{nombre}}'}</Box>{' '}
            <Box component="span" sx={{ color: '#60a5fa', fontFamily: 'monospace' }}>{'{{ciudad}}'}</Box>{' '}
            <Box component="span" sx={{ color: '#fbbf24', fontFamily: 'monospace' }}>{'{{industria}}'}</Box>{' '}
            <Box component="span" sx={{ color: '#a78bfa', fontFamily: 'monospace' }}>{'{{web}}'}</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.68rem', color: charCount > MAX_CAMPAIGN_MSG ? '#f87171' : charCount > MAX_CAMPAIGN_MSG * 0.9 ? '#fbbf24' : 'rgba(255,255,255,0.25)', fontVariantNumeric: 'tabular-nums' }}>
            {charCount} / {MAX_CAMPAIGN_MSG}
          </Typography>
        </Box>
        </>}

        <Box sx={{ mb: 1.5, p: 1.2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(255,255,255,0.02)' }}>
          <TemplateLibraryPicker onChange={setExtraVariants} recipientCount={waRows.length} baseCount={0} />
        </Box>

        {/* Send config */}
        <Box sx={{ mb: 1.5 }}>
          <SendConfigPanel config={sendCfg} onChange={setSendCfg} disabled={sending} />
        </Box>

        {/* Countdown timer */}
        {sending && countdown !== null && (
          <Box sx={{ mb: 1.5 }}>
            <CountdownBar
              countdown={countdown} total={cdTotal} label={cdLabel}
              batchNum={batchNum} msgNum={results.length} msgTotal={waRows.length}
            />
          </Box>
        )}

        <InstanceDisconnectedBanner status={instanceStatus} sx={{ mb: 1.5 }} />
        <SendErrorBanner error={sendError} onDismiss={() => setSendError('')} sx={{ mb: 1.5 }} />

        {/* Progress / Results */}
        {(sending || done) && (
          <Box sx={{ mb: 1 }}>
            {sending && (
              <Box sx={{ mb: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>
                    {lang === 'en' ? `Sending… ${results.length} of ${waRows.length}` : `Enviando… ${results.length} de ${waRows.length}`}
                  </Typography>
                  <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '0.82rem' }}>{progress}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={progress}
                  sx={{ borderRadius: 4, height: 5, bgcolor: 'rgba(34,197,94,0.1)', '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg,#22c55e,#4ade80)', borderRadius: 4 } }} />
              </Box>
            )}
            {done && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={lang === 'en' ? `${sentCount} sent` : `${sentCount} enviado${sentCount !== 1 ? 's' : ''}`} size="small"
                  sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', fontSize: '0.72rem', height: 24 }} />
                {failedCount > 0 && (
                  <Chip label={lang === 'en' ? `${failedCount} failed` : `${failedCount} fallido${failedCount !== 1 ? 's' : ''}`} size="small"
                    sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.72rem', height: 24 }} />
                )}
                {noWaCount > 0 && (
                  <Chip label={lang === 'en' ? `${noWaCount} no number` : `${noWaCount} sin número`} size="small"
                    sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.72rem', height: 24 }} />
                )}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 2, gap: 1, bgcolor: 'var(--sidebar-bg, #0d1117)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <Button onClick={onClose} disabled={sending}
          sx={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, px: 2.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)' } }}>
          {done ? t.common.close : t.common.cancel}
        </Button>
        {!done && (
          <Button
            onClick={handleSend}
            disabled={sending || waRows.length === 0 || msgInvalid || isDisconnected || belowMinTemplates}
            startIcon={sending ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <SendIcon sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: !sending && waRows.length > 0 && !msgInvalid ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.05)',
              color:   !sending && waRows.length > 0 && !msgInvalid ? '#4ade80' : 'rgba(255,255,255,0.3)',
              border:  `1px solid ${!sending && waRows.length > 0 && !msgInvalid ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 2, px: 3, fontWeight: 600,
              '&:hover': { bgcolor: !sending && waRows.length > 0 && !msgInvalid ? 'rgba(34,197,94,0.28)' : 'rgba(255,255,255,0.05)' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.07)' },
            }}
          >
            {sending ? (lang === 'en' ? 'Sending…' : 'Enviando…') : (lang === 'en' ? `Send to ${waRows.length} ${waRows.length !== 1 ? 'companies' : 'company'}` : `Enviar a ${waRows.length} empresa${waRows.length !== 1 ? 's' : ''}`)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DatabaseViewer({ isActive }) {
  const { t, lang } = useLang()
  const headCells  = getHeadCells(t)
  const alertTitles = getAlertTitles(t)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(15)
  const [order, setOrder] = useState('desc')
  const [orderBy, setOrderBy] = useState('created_at')
  const [selected, setSelected] = useState([])
  const [rowCache, setRowCache] = useState({})  // id → row, acumula filas de todas las páginas
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState({ search: '', industry: '', city: '', has_whatsapp: '' })
  const [editTarget, setEditTarget] = useState(null)
  const [viewTarget, setViewTarget] = useState(null)
  const [viewData, setViewData] = useState(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [msgTarget, setMsgTarget] = useState(null)
  const [msgData, setMsgData] = useState(null)
  const [msgSending, setMsgSending] = useState(false)
  const [editContacts, setEditContacts] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rescraping, setRescraping]       = useState('')   // label del progreso
  const [campaignOpen, setCampaignOpen]   = useState(false)
  const [addCompanyOpen, setAddCompanyOpen] = useState(false)
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' })
  const [industries, setIndustries] = useState([])
  const [cities, setCities] = useState([])
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const { addJob } = useSendQueue()

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
      const companies = data.companies || []
      setRows(companies)
      setTotal(data.total || 0)
      // Acumular filas en caché para calcular selecciones cross-page
      setRowCache(prev => {
        const next = { ...prev }
        companies.forEach(r => { next[r._id] = r })
        return next
      })
    } catch {
      notify(lang === 'en' ? 'Failed to load data' : 'No se pudieron cargar los datos', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, rowsPerPage, filters])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { if (isActive) fetchData() }, [isActive])
  useEffect(() => {
    setPage(0)
    setRowCache({})   // limpiar caché al cambiar filtros
    setSelected([])   // limpiar selección al cambiar filtros
  }, [filters])

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

  const handleDeleteConfirmed = async () => {
    setConfirmDelete(false)
    if (!selected.length) return
    try {
      const res = await fetch('/api/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      })
      const data = await res.json()
      notify(lang === 'en' ? `${data.deleted} ${data.deleted !== 1 ? 'companies' : 'company'} deleted` : `${data.deleted} empresa${data.deleted !== 1 ? 's' : ''} eliminada${data.deleted !== 1 ? 's' : ''}`, 'success')
      setSelected([])
      fetchData()
    } catch {
      notify(lang === 'en' ? 'Failed to delete records' : 'No se pudieron eliminar los registros', 'error')
    }
  }

  const handleRescrape = async () => {
    const targets = sortedRows.filter(r => selected.includes(r._id))
    if (!targets.length) { notify(lang === 'en' ? 'Select at least one company' : 'Selecciona al menos una empresa', 'warning'); return }
    let ok = 0, fail = 0, noUrl = 0
    const CONCURRENCY = 4
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY)
      const first = chunk[0]
      setRescraping(`${first.name || first.domain || 'empresa'} (${i + 1}–${Math.min(i + CONCURRENCY, targets.length)}/${targets.length})`)
      await Promise.all(chunk.map(async (row) => {
        if (!row.website && !row.domain) { noUrl++; return }
        try {
          const res = await fetch(`/api/companies/${row._id}/rescrape`, { method: 'POST' })
          if (res.ok) ok++; else fail++
        } catch { fail++ }
      }))
    }
    setRescraping('')
    setSelected([])
    fetchData()
    const parts = lang === 'en' ? [`${ok} updated`] : [`${ok} actualizadas`]
    if (fail)  parts.push(lang === 'en' ? `${fail} failed` : `${fail} fallidas`)
    if (noUrl) parts.push(lang === 'en' ? `${noUrl} no URL` : `${noUrl} sin URL`)
    notify((lang === 'en' ? 'Re-scraping complete: ' : 'Re-scraping completo: ') + parts.join(', '), ok > 0 ? 'success' : 'error')
  }

  const handleOpenView = async (row) => {
    setViewTarget(row)
    setViewData(null)
    setViewLoading(true)
    try {
      const res = await fetch(`/api/companies/${row._id}`)
      const data = await res.json()
      // Adapt to the format ResultDisplay expects
      setViewData({
        website: data.website,
        scraped: {
          name: data.name,
          industry: data.industry,
          description: data.description,
          domain: data.domain,
          _extra: {
            city: data.city,
            state: data.state,
            address: data.address,
            business_hours: data.business_hours,
            services: data.services,
            products: data.products,
            social_media: data.social_media?.platforms || {},
          },
          _contacts_raw: {
            whatsapp_numbers: data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || [],
            all_whatsapp_numbers: data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || [],
            phone_numbers: data.contacts?.filter(c => c.type === 'phone').map(c => c.value) || [],
            emails: data.contacts?.filter(c => c.type === 'email').map(c => c.value) || [],
            persons: data.person_contacts || [],
          },
          metadata: data.metadata || {},
        },
        primary_whatsapp_number: data.contacts?.find(c => c.type === 'whatsapp' && c.is_primary)?.value
          || data.contacts?.find(c => c.type === 'whatsapp')?.value || null,
        to_number: data.contacts?.find(c => c.type === 'whatsapp')?.value || null,
        company_id: row._id,
        message_log_id: data.last_message_log_id || null,
      })
    } catch {
      notify(lang === 'en' ? 'Failed to load information' : 'No se pudo cargar la información', 'error')
      setViewTarget(null)
    } finally {
      setViewLoading(false)
    }
  }

  const handleOpenMsg = async (row) => {
    setMsgTarget(row)
    setMsgData(null)
    setViewLoading(true)
    try {
      const res = await fetch(`/api/companies/${row._id}`)
      const data = await res.json()
      setMsgData({
        website: data.website,
        scraped: {
          name: data.name,
          industry: data.industry,
          _extra: { city: data.city, state: data.state },
          _contacts_raw: {
            whatsapp_numbers: data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || [],
            all_whatsapp_numbers: data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || [],
          },
        },
        primary_whatsapp_number: data.contacts?.find(c => c.type === 'whatsapp' && c.is_primary)?.value
          || data.contacts?.find(c => c.type === 'whatsapp')?.value || null,
        company_id: row._id,
      })
    } catch {
      notify(lang === 'en' ? 'Failed to load information' : 'No se pudo cargar la información', 'error')
      setMsgTarget(null)
    } finally {
      setViewLoading(false)
    }
  }

  // `messagesOrText` is either one string or an array parallel to `numbers` —
  // MessageComposer sends an array with a different rotated variant per
  // number once a company has more than one WhatsApp contact selected.
  const handleSendFromDB = (messagesOrText, numbers) => {
    if (!msgData) return
    const nums = Array.isArray(numbers) ? numbers : [numbers]
    if (nums.length === 0) return
    addJob({
      numbers:   nums,
      messages:  messagesOrText,
      companyId: msgData.company_id,
      website:   msgData.website,
    }, msgData.scraped?.name || msgData.website || '')
    setMsgTarget(null)
  }

  const handleSaveEdit = async (id, fields, waNumbers) => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/companies/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        }),
        fetch(`/api/companies/${id}/contacts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ whatsapp_numbers: waNumbers }),
        }),
      ])
      if (!r1.ok || !r2.ok) throw new Error()
      notify(lang === 'en' ? 'Changes saved successfully' : 'Los cambios fueron guardados correctamente', 'success')
      setEditTarget(null)
      fetchData()
    } catch {
      notify(lang === 'en' ? 'Failed to save changes' : 'No se pudieron guardar los cambios', 'error')
    }
  }

  const handleOpenEdit = async (row) => {
    setEditTarget(row)
    setEditContacts([])
    try {
      const res = await fetch(`/api/companies/${row._id}`)
      const data = await res.json()
      setEditContacts(data.contacts?.filter(c => c.type === 'whatsapp').map(c => c.value) || [])
    } catch {}
  }

  const numSelected    = selected.length
  const rowCount       = sortedRows.length
  // selectedWithWA usa el caché cross-page para no perder el conteo al paginar
  const selectedWithWA = useMemo(
    () => selected.filter(id => rowCache[id]?.has_whatsapp).length,
    [selected, rowCache]
  )
  // Filas seleccionadas usando caché (para CampaignDialog cross-page)
  const selectedRowsFull = useMemo(
    () => selected.map(id => rowCache[id]).filter(Boolean),
    [selected, rowCache]
  )

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Paper sx={{ width: '100%', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column', flexGrow: 1, position: 'relative', background: 'var(--sidebar-bg, #0d1117)', boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 2px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset' }}>
        {/* brillo radial */}
        <Box sx={{ position: 'absolute', top: -50, left: -50, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(var(--accent-rgb, 99,102,241), 0.07) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <EnhancedToolbar
          numSelected={numSelected}
          onDelete={() => setConfirmDelete(true)}
          onCampaign={() => setCampaignOpen(true)}
          onRescrape={handleRescrape}
          rescraping={rescraping}
          selectedWithWA={selectedWithWA}
          onRefresh={fetchData}
          onToggleFilter={() => setFilterOpen((o) => !o)}
          filterOpen={filterOpen}
          total={total}
          instanceStatus={instanceStatus}
          onAddCompany={() => setAddCompanyOpen(true)}
        />

        <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.07)', position: 'relative', zIndex: 1 }} />

        <Collapse in={filterOpen} sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <FilterBar filters={filters} onChange={handleFilterChange} industries={industries} cities={cities} />
          </Box>
        </Collapse>

        {/* ── Stats strip ── */}
        {!loading && (
          <Box sx={{ px: 2, py: 0.9, display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            bgcolor: 'rgba(255,255,255,0.012)', position: 'relative', zIndex: 1,
          }}>
            {/* Total count */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent,#3b82f6)', flexShrink: 0,
                boxShadow: '0 0 5px rgba(var(--accent-rgb,59,130,246),0.5)' }} />
              <Typography sx={{ fontSize: '0.69rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                <Box component="span" sx={{ color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {total.toLocaleString()}
                </Box>{' '}{lang === 'en' ? (total === 1 ? 'company' : 'companies') : (total === 1 ? 'empresa' : 'empresas')}
              </Typography>
            </Box>
            {/* WA ratio — current page */}
            {rows.length > 0 && (() => {
              const waCount = rows.filter(r => r.has_whatsapp).length
              const pct = Math.round((waCount / rows.length) * 100)
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.69rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    <Box component="span" sx={{ color: '#22c55e', fontWeight: 700 }}>{pct}%</Box>{' '}{lang === 'en' ? 'with WA' : 'con WA'}
                  </Typography>
                </Box>
              )
            })()}
            {/* Contacted — current page */}
            {rows.length > 0 && (() => {
              const c = rows.filter(r => r.contacted).length
              if (!c) return null
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--accent, #60a5fa)', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.69rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    <Box component="span" sx={{ color: 'var(--accent, #60a5fa)', fontWeight: 700 }}>{c}</Box>{' '}{lang === 'en' ? 'contacted' : 'contactadas'}
                  </Typography>
                </Box>
              )
            })()}
            {/* Último scraping — most recent across current page */}
            {rows.length > 0 && (() => {
              const dates = rows.map(r => r.last_scraped_at).filter(Boolean)
              if (!dates.length) return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'rgba(148,163,184,0.3)', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.69rem', color: 'rgba(148,163,184,0.4)', fontWeight: 500 }}>
                    {lang === 'en' ? 'not scraped' : 'sin scraping'}
                  </Typography>
                </Box>
              )
              const latest = dates.reduce((a, b) => a > b ? a : b)
              const daysAgo = Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000)
              const label = lang === 'en'
                ? (daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`)
                : (daysAgo === 0 ? 'hoy' : daysAgo === 1 ? 'ayer' : `hace ${daysAgo}d`)
              const color = daysAgo <= 1 ? '#4ade80' : daysAgo <= 7 ? '#fbbf24' : '#f87171'
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0,
                    boxShadow: `0 0 5px ${color}88` }} />
                  <Typography sx={{ fontSize: '0.69rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {lang === 'en' ? 'last scrape' : 'últ. scraping'}{' '}
                    <Box component="span" sx={{ color, fontWeight: 700 }}>{label}</Box>
                  </Typography>
                </Box>
              )
            })()}
            {/* Active filter chips — right side */}
            {(filters.search || filters.industry || filters.city || filters.has_whatsapp !== '') && (
              <Box sx={{ ml: 'auto', display: 'flex', gap: 0.7, flexWrap: 'wrap', alignItems: 'center' }}>
                {filters.search && (
                  <Chip size="small" label={`"${filters.search}"`}
                    onDelete={() => handleFilterChange('search', '')}
                    sx={{ height: 20, fontSize: '0.63rem', bgcolor: 'rgba(var(--accent-rgb, 96,165,250), 0.1)', color: 'var(--accent, #60a5fa)',
                      border: '1px solid rgba(var(--accent-rgb, 96,165,250), 0.22)',
                      '& .MuiChip-deleteIcon': { color: 'var(--accent, #60a5fa)', fontSize: 12, '&:hover': { color: 'var(--accent, #93c5fd)' } } }} />
                )}
                {filters.industry && (
                  <Chip size="small" label={filters.industry}
                    onDelete={() => handleFilterChange('industry', '')}
                    sx={{ height: 20, fontSize: '0.63rem', bgcolor: 'rgba(167,139,250,0.1)', color: '#a78bfa',
                      border: '1px solid rgba(167,139,250,0.22)',
                      '& .MuiChip-deleteIcon': { color: '#a78bfa', fontSize: 12, '&:hover': { color: '#c4b5fd' } } }} />
                )}
                {filters.city && (
                  <Chip size="small" label={filters.city}
                    onDelete={() => handleFilterChange('city', '')}
                    sx={{ height: 20, fontSize: '0.63rem', bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                      border: '1px solid rgba(251,191,36,0.22)',
                      '& .MuiChip-deleteIcon': { color: '#fbbf24', fontSize: 12, '&:hover': { color: '#fcd34d' } } }} />
                )}
                {filters.has_whatsapp !== '' && (
                  <Chip size="small"
                    label={filters.has_whatsapp === 'true' ? (lang === 'en' ? 'Has WA' : 'Con WA') : (lang === 'en' ? 'No WA' : 'Sin WA')}
                    onDelete={() => handleFilterChange('has_whatsapp', '')}
                    sx={{ height: 20, fontSize: '0.63rem',
                      bgcolor: filters.has_whatsapp === 'true' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                      color: filters.has_whatsapp === 'true' ? '#22c55e' : '#f87171',
                      border: `1px solid ${filters.has_whatsapp === 'true' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'}`,
                      '& .MuiChip-deleteIcon': { color: 'inherit', fontSize: 12 } }} />
                )}
              </Box>
            )}
          </Box>
        )}

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
                <TableCell padding="checkbox" sx={{ bgcolor: 'var(--card-bg, #161d2e)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <Checkbox
                    color="primary"
                    indeterminate={numSelected > 0 && numSelected < rowCount}
                    checked={rowCount > 0 && numSelected === rowCount}
                    onChange={handleSelectAll}
                    sx={{ color: 'rgba(255,255,255,0.3)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' }, '&.MuiCheckbox-indeterminate': { color: 'var(--accent, #3b82f6)' } }}
                  />
                </TableCell>
                {headCells.map((hc) => (
                  <TableCell
                    key={hc.id}
                    align={hc.align}
                    sortDirection={orderBy === hc.id ? order : false}
                    sx={{ bgcolor: 'var(--card-bg, #161d2e)', color: 'rgba(255,255,255,0.55)', fontWeight: 600, fontSize: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}
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
                            '& .MuiTableSortLabel-icon': { color: 'var(--accent, #3b82f6) !important', marginLeft: '6px', fontSize: 16 },
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
                <TableCell sx={{ bgcolor: 'var(--card-bg, #161d2e)', borderBottom: '1px solid rgba(255,255,255,0.08)' }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <SkeletonRows count={rowsPerPage} />
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={headCells.length + 2} align="center" sx={{ py: 6, color: 'rgba(255,255,255,0.3)', borderBottom: 'none' }}>
                    {t.db.noResults}
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
                        '&.Mui-selected': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246),0.08)', boxShadow: 'inset 3px 0 0 var(--accent, #3b82f6)' },
                        '&.Mui-selected:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246),0.12)', boxShadow: 'inset 3px 0 0 var(--accent, #3b82f6)' },
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' },
                        '& td': { borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', fontSize: '0.82rem' },
                      }}
                    >
                      <TableCell padding="checkbox" onClick={() => handleSelectRow(row._id)}>
                        <Checkbox
                          checked={isSelected}
                          color="primary"
                          sx={{ color: 'rgba(255,255,255,0.2)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' } }}
                        />
                      </TableCell>
                      <TableCell onClick={() => handleSelectRow(row._id)}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
                          <Tooltip title={row.name || '—'} placement="top" disableHoverListener={!row.name || row.name.length <= 28}>
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 500, color: 'white' }}>
                              {truncate(row.name, 28) || '—'}
                            </Typography>
                          </Tooltip>
                          {row.contacted && (
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, flexShrink: 0,
                              bgcolor: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                              borderRadius: 1, px: 0.6, py: 0.15 }}>
                              <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#4ade80', flexShrink: 0 }} />
                              <Typography sx={{ fontSize: '0.6rem', color: '#4ade80', fontWeight: 700, whiteSpace: 'nowrap',
                                '[data-theme-mode="light"] &': { color: '#16a34a' } }}>
                                {t.campaign?.contacted || 'Contactada'}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell onClick={() => handleSelectRow(row._id)}>
                        {(() => {
                          const url = row.website || row.domain
                          const domain = cleanDomain(url)
                          if (!domain) return <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                          const faviconSrc = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
                          return (
                            <Tooltip title={url} placement="top">
                              <Box component="a" href={url} target="_blank" rel="noopener"
                                onClick={e => e.stopPropagation()}
                                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.7,
                                  textDecoration: 'none', cursor: 'pointer',
                                  '&:hover .url-text': { textDecoration: 'underline' },
                                  '&:hover .url-ext': { opacity: 1 },
                                }}>
                                <Box sx={{
                                  width: 18, height: 18, flexShrink: 0, borderRadius: '5px',
                                  bgcolor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                                }}>
                                  <Box component="img" src={faviconSrc} width={12} height={12}
                                    sx={{ flexShrink: 0, display: 'block', objectFit: 'contain' }}
                                    onError={e => { e.target.style.display = 'none' }} />
                                </Box>
                                <Typography className="url-text"
                                  sx={{ fontSize: '0.78rem', color: '#60a5fa', lineHeight: 1.2,
                                    maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {domain}
                                </Typography>
                                <OpenInNewIcon className="url-ext"
                                  sx={{ fontSize: 11, color: '#60a5fa', opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }} />
                              </Box>
                            </Tooltip>
                          )
                        })()}
                      </TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>
                        <Tooltip title={row.industry || '—'} placement="top" disableHoverListener={!row.industry || row.industry.length <= 22}>
                          <span>{truncate(row.industry, 22)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{display(row.city)}</TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>
                        {row.has_whatsapp ? (
                          <Chip icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />} label={t.db.yes} size="small"
                            sx={{ bgcolor: 'rgba(34,197,94,0.16)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.4)', height: 22, fontSize: '0.7rem', fontWeight: 700, px: 0.3, boxShadow: '0 0 8px rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: '#22c55e' } }} />
                        ) : (
                          <Chip label={t.db.no} size="small"
                            sx={{ bgcolor: 'rgba(239,68,68,0.08)', color: 'rgba(248,113,113,0.55)', border: '1px solid rgba(239,68,68,0.18)', height: 22, fontSize: '0.7rem', fontWeight: 600, px: 0.3 }} />
                        )}
                      </TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{formatDate(row.created_at)}</TableCell>
                      <TableCell align="center" onClick={() => handleSelectRow(row._id)}>{formatDate(row.last_scraped_at)}</TableCell>
                      <TableCell align="right" sx={{ pr: 1 }}>
                        <Tooltip title={t.db.viewInfo}>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenView(row) }}
                            sx={{ color: 'rgba(255,255,255,0.35)', '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.45)' }, '&:hover': { color: '#a78bfa', bgcolor: 'rgba(167,139,250,0.1)' } }}>
                            <VisibilityIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={row.has_whatsapp ? (row.contacted ? (t.campaign?.contacted || 'Ya contactada') + ' — ' + t.db.sendMsg : t.db.sendMsg) : t.db.noWaReg}>
                          <span>
                            <IconButton size="small" disabled={!row.has_whatsapp} onClick={(e) => { e.stopPropagation(); handleOpenMsg(row) }}
                              sx={{
                                color: row.contacted ? '#4ade80' : 'rgba(255,255,255,0.35)',
                                '&.Mui-disabled': { opacity: 0.25 },
                                '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: row.contacted ? '#16a34a' : 'rgba(15,23,42,0.45)' },
                                '&:hover': { color: '#4ade80', bgcolor: 'rgba(74,222,128,0.1)' },
                                '[data-theme-mode="light"] &:hover': { color: '#16a34a', bgcolor: 'rgba(22,163,74,0.1)' },
                              }}>
                              <SendIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t.db.editBtn}>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenEdit(row) }}
                            sx={{ color: 'rgba(255,255,255,0.35)', '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.45)' }, '&:hover': { color: '#3b82f6', bgcolor: 'rgba(59,130,246,0.1)' } }}>
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
          rowsPerPageOptions={[15, 25, 50]}
          component="div"
          count={total}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
          labelRowsPerPage={t.db.rowsPerPage}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} ${t.db.displayedRowsOf} ${count !== -1 ? count : `${t.db.displayedRowsMore} ${to}`}`}
          sx={{
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border)',
            '& .MuiTablePagination-toolbar': { minHeight: 48 },
            '& .MuiTablePagination-selectIcon': { color: 'var(--text-muted)' },
            '& .MuiIconButton-root': { color: 'var(--text-muted)' },
            '& .Mui-disabled': { opacity: 0.3 },
            '& .MuiSelect-select': { color: 'var(--text)' },
          }}
        />
      </Paper>

      {/* Modal: Ver información scrapeada */}
      <Dialog open={!!viewTarget} onClose={() => setViewTarget(null)} maxWidth="lg" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--bg, #080c14)', backgroundImage: 'none', background: 'var(--bg, #080c14)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', p: 0 } } }}>
        <DialogContent sx={{ p: 2.5, bgcolor: 'var(--bg, #080c14)', '&:first-of-type': { pt: 2.5 } }}>
          {viewLoading && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, gap: 2 }}>
              <CircularProgress size={36} sx={{ color: '#6366f1' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem' }}>{t.db.loadingInfo}</Typography>
            </Box>
          )}
          {!viewLoading && viewData && <ResultDisplay result={viewData} />}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, bgcolor: 'var(--bg, #080c14)' }}>
          <Button onClick={() => setViewTarget(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>{t.db.close}</Button>
        </DialogActions>
      </Dialog>

      {/* Modal: Enviar mensaje */}
      <Dialog open={!!msgTarget} onClose={() => setMsgTarget(null)} maxWidth="sm" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--bg, #080c14)', backgroundImage: 'none', background: 'var(--bg, #080c14)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)' } } }}>
        <DialogTitle sx={{ color: 'white', fontWeight: 700, pb: 1, bgcolor: 'var(--bg, #080c14)' }}>
          {t.db.sendMsgTo} {msgTarget?.name || msgTarget?.domain || '—'}
        </DialogTitle>
        <DialogContent sx={{ pt: 0, bgcolor: 'var(--bg, #080c14)' }}>
          <InstanceDisconnectedBanner status={instanceStatus} sx={{ mb: 1.5 }} />
          {viewLoading && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, gap: 2 }}>
              <CircularProgress size={36} sx={{ color: '#6366f1' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem' }}>{lang === 'en' ? 'Loading contact numbers…' : 'Cargando números de contacto…'}</Typography>
            </Box>
          )}
          {!viewLoading && msgData && (
            <MessageComposer result={msgData} onSend={handleSendFromDB} sending={msgSending} disabled={isDisconnected} />
          )}
          {!viewLoading && msgData && !msgData.primary_whatsapp_number && (
            <Alert severity="warning" sx={{ mt: 2, bgcolor: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>
              {t.db.noWaCompany}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, bgcolor: 'var(--bg, #080c14)' }}>
          <Button onClick={() => setMsgTarget(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>{t.common.cancel}</Button>
        </DialogActions>
      </Dialog>

      {/* Confirmación de borrado */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg, #0d1117)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 3 } } }}>
        <DialogTitle sx={{ color: 'white', fontWeight: 700, pb: 1 }}>
          {t.db.deleteConfirmPrefix} {selected.length} {selected.length !== 1 ? t.db.companyPlural : t.db.companySingular}?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.88rem' }}>
            {t.db.deleteWarn}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setConfirmDelete(false)} sx={{ color: 'rgba(255,255,255,0.5)', borderRadius: 2 }}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleDeleteConfirmed} variant="contained"
            sx={{ bgcolor: '#ef4444', borderRadius: 2, fontWeight: 700, '&:hover': { bgcolor: '#dc2626' } }}>
            {t.common.delete}
          </Button>
        </DialogActions>
      </Dialog>

      <CampaignDialog
        open={campaignOpen}
        selectedRows={selectedRowsFull}
        onClose={() => setCampaignOpen(false)}
        onNotify={notify}
        instanceStatus={instanceStatus}
        isDisconnected={isDisconnected}
      />

      <AddCompanyDialog
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        onCreated={() => { setAddCompanyOpen(false); fetchData(); notify(t.db.addCompanyOk, 'success') }}
        onNotify={notify}
      />

      <EditDialog
        open={!!editTarget}
        company={editTarget}
        contacts={editContacts}
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
            {alertTitles[snack.severity]}
          </AlertTitle>
          <Typography sx={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.7)' }}>
            {snack.msg}
          </Typography>
        </Alert>
      </Snackbar>
    </Box>
  )
}
