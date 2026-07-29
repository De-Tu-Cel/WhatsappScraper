'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import dayjs from 'dayjs'
import 'dayjs/locale/es'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Divider from '@mui/material/Divider'
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import SendIcon from '@mui/icons-material/Send'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import BusinessIcon from '@mui/icons-material/Business'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CloseIcon from '@mui/icons-material/Close'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ViewWeekIcon from '@mui/icons-material/ViewWeek'
import ViewListIcon from '@mui/icons-material/ViewList'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import { TemplateManagerDialog } from './messageTemplateLibrary'
import { MIN_TEMPLATES_FOR_BULK } from '@/lib/messageVariants'
import { HighlightedMessageInput } from './highlightedMessageInput'

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS_ES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_ES     = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const DAYS_ES_L   = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
const USER_TZ     = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''

const STATUS_META = {
  pending:   { tKey: 'statusPending',   color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  icon: <HourglassEmptyIcon sx={{ fontSize: 13 }} /> },
  running:   { tKey: 'statusRunning',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: <CircularProgress size={11} thickness={5} sx={{ color: '#f59e0b' }} /> },
  done:      { tKey: 'statusDone',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: <CheckCircleIcon sx={{ fontSize: 13 }} /> },
  cancelled: { tKey: 'statusCancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: <CancelIcon sx={{ fontSize: 13 }} /> },
  error:     { tKey: 'statusError',     color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: <ErrorIcon sx={{ fontSize: 13 }} /> },
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    color: 'var(--text,#f1f5f9)', bgcolor: 'var(--surface,rgba(255,255,255,0.04))', fontSize: '0.85rem',
    '& fieldset': { borderColor: 'var(--border,rgba(255,255,255,0.1))' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
    '& .MuiInputBase-input': { color: 'var(--text,#f1f5f9)', WebkitTextFillColor: 'var(--text,#f1f5f9)' },
    '& .MuiInputAdornment-root .MuiIconButton-root': { color: 'var(--text-muted,rgba(255,255,255,0.4))' },
  },
  '& .MuiInputLabel-root': { color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.82rem' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent,#3b82f6)' },
  // Light base theme: force dark text/border (overrides MUI X's internal palette-driven styles)
  '[data-theme-mode="light"] & .MuiOutlinedInput-root': { color: '#1a2234' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root .MuiInputBase-input': { color: '#1a2234', WebkitTextFillColor: '#1a2234' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(0,0,0,0.28)' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root:hover fieldset': { borderColor: 'rgba(0,0,0,0.5)' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root .MuiInputAdornment-root .MuiIconButton-root': { color: 'rgba(15,23,42,0.55)' },
  '[data-theme-mode="light"] & .MuiInputLabel-root': { color: 'rgba(15,23,42,0.58)' },
}

// MUI X v9 date/time picker text-field: targets PickersTextField root
// (different class hierarchy than regular TextField — visible text is in
//  sectionContent contenteditable spans, border is on notchedOutline)
const PICKER_FIELD_SX = {
  '& .MuiPickersInputBase-root': { bgcolor: 'var(--surface,rgba(255,255,255,0.04))', fontSize: '0.85rem' },
  '& .MuiPickersSectionList-sectionContent': { color: 'var(--text,#f1f5f9)' },
  '& .MuiPickersInputBase-sectionAfter, & .MuiPickersInputBase-sectionBefore': { color: 'var(--text,#f1f5f9)' },
  '& .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--border,rgba(255,255,255,0.1))' },
  '& .MuiPickersInputBase-root:hover .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
  '& .MuiPickersInputBase-root.Mui-focused .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--accent,#3b82f6)' },
  '& .MuiInputAdornment-root .MuiIconButton-root': { color: 'var(--text-muted,rgba(255,255,255,0.4))' },
  '& .MuiInputLabel-root': { color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.82rem' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent,#3b82f6)' },
  // Light mode: force dark text/border
  '[data-theme-mode="light"] & .MuiPickersSectionList-sectionContent': { color: '#1a2234' },
  '[data-theme-mode="light"] & .MuiPickersInputBase-sectionAfter, [data-theme-mode="light"] & .MuiPickersInputBase-sectionBefore': { color: '#1a2234' },
  '[data-theme-mode="light"] & .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.28)' },
  '[data-theme-mode="light"] & .MuiPickersInputBase-root:hover .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.55)' },
  '[data-theme-mode="light"] & .MuiPickersInputBase-root.Mui-focused .MuiPickersOutlinedInput-notchedOutline': { borderColor: 'var(--accent,#3b82f6)' },
  '[data-theme-mode="light"] & .MuiInputAdornment-root .MuiIconButton-root': { color: 'rgba(15,23,42,0.55)' },
  '[data-theme-mode="light"] & .MuiInputLabel-root': { color: 'rgba(15,23,42,0.58)' },
}

const PICKER_POPPER_SX = {
  '& .MuiPaper-root': { bgcolor: 'var(--card-bg,#1e293b)', color: 'var(--text,#f1f5f9)', border: '1px solid var(--border,rgba(255,255,255,0.1))', borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' },
  '& .MuiPickerDay-root': { color: 'var(--text,#f1f5f9)', '&:hover': { bgcolor: 'var(--item-hover,rgba(255,255,255,0.07))' }, '&.Mui-selected': { bgcolor: 'var(--accent,#3b82f6)', color: '#fff', '&:hover': { bgcolor: 'var(--accent,#3b82f6)' } } },
  '& .MuiPickerDay-today:not(.Mui-selected)': { border: '1px solid rgba(var(--accent-rgb,59,130,246),0.5)' },
  '& .MuiDayCalendar-weekDayLabel': { color: 'var(--text-muted,rgba(255,255,255,0.35))' },
  '& .MuiPickersCalendarHeader-label': { color: 'var(--text,#f1f5f9)', fontWeight: 700 },
  '& .MuiPickersArrowSwitcher-button': { color: 'var(--text-muted,rgba(255,255,255,0.5))', '&:hover': { color: 'var(--text,#f1f5f9)' } },
  '& .MuiMultiSectionDigitalClock-root': { bgcolor: 'var(--card-bg,#1e293b)' },
  '& .MuiMultiSectionDigitalClockSection-item': { color: 'var(--text,#f1f5f9)', '&:hover': { bgcolor: 'var(--item-hover,rgba(255,255,255,0.07))' }, '&.Mui-selected': { bgcolor: 'var(--accent,#3b82f6)', color: '#fff' } },
  '& .MuiDialogActions-root button': { color: 'var(--accent,#3b82f6)' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}
function fmtNumber(raw) {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5,8)} ${d.slice(8)}`
  if (d.length === 11) return `+${d.slice(0,1)} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
  return raw || ''
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dateToDtLocal(date, hour = 9) {
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(hour)}:00`
}
function getCalendarDays(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const days = []
  for (let i = startOffset; i > 0; i--) days.push(new Date(year, month, 1 - i))
  const last = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d))
  while (days.length < 42) { const p = days[days.length - 1]; days.push(new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1)) }
  return days
}
function getWeekStart(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }) {
  const { t } = useLang()
  return (
    <Dialog open={open} onClose={onCancel} sx={{ '& .MuiDialog-paper': { bgcolor: 'var(--card-bg,#1e293b)', color: 'var(--text,#f1f5f9)', border: '1px solid var(--border)', borderRadius: 2.5, minWidth: 320 } }}>
      <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700, pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.5 }}>{body}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Button onClick={onCancel} sx={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.83rem' }}>{t.common.cancel}</Button>
        <Button onClick={onConfirm} variant="contained"
          sx={{ bgcolor: danger ? '#ef4444' : 'var(--accent,#3b82f6)', textTransform: 'none', fontSize: '0.83rem', fontWeight: 600, borderRadius: 2, '&:hover': { bgcolor: danger ? '#dc2626' : 'rgba(var(--accent-rgb,59,130,246),0.85)' } }}>
          {confirmLabel || t.sched.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const { t } = useLang()
  const meta = STATUS_META[status] || STATUS_META.pending
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 1.5, bgcolor: meta.bg, border: `1px solid ${meta.color}44`, color: meta.color, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {meta.icon}{t.sched[meta.tKey]}
    </Box>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function SendProgress({ sent, total }) {
  const { t } = useLang()
  if (!total) return null
  const pct = Math.min(100, Math.round((sent / total) * 100))
  return (
    <Box sx={{ mt: 0.8 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.68rem' }}>{sent}/{total} {t.sched.sent}</Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.68rem' }}>{pct}%</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.07)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent,#3b82f6)', borderRadius: 2 } }} />
    </Box>
  )
}

// ─── Company picker ───────────────────────────────────────────────────────────

function CompanyPicker({ selectedNums, numInfoMap, onChange }) {
  const { t } = useLang()
  const [companies,          setCompanies]          = useState([])
  const [loadingCo,          setLoadingCo]          = useState(true)
  const [search,             setSearch]             = useState('')
  const [industryFilter,     setIndustryFilter]     = useState('')
  const [showAllIndustries,  setShowAllIndustries]  = useState(false)
  const MAX_IND = 4

  useEffect(() => {
    authFetch('/api/admin/companies-with-numbers')
      .then(r => r.json()).then(d => setCompanies(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoadingCo(false))
  }, [])

  const industries = useMemo(() => [...new Set(companies.map(c => c.industry).filter(Boolean))].sort(), [companies])
  const filtered   = useMemo(() => companies.filter(c => {
    if (industryFilter && c.industry !== industryFilter) return false
    if (search) { const q = search.toLowerCase(); return c.name.toLowerCase().includes(q) || (c.domain||'').toLowerCase().includes(q) }
    return true
  }), [companies, industryFilter, search])

  const activeSet = useMemo(() => { const s = new Set(); companies.forEach(c => c.numbers.forEach(n => { if (n.active) s.add(n.number) })); return s }, [companies])

  function toggle(num, info) {
    const ns = new Set(selectedNums); const nm = new Map(numInfoMap)
    if (ns.has(num)) { ns.delete(num); nm.delete(num) } else { ns.add(num); nm.set(num, info) }
    onChange(ns, nm)
  }
  function toggleCompany(c) {
    const ns = new Set(selectedNums); const nm = new Map(numInfoMap)
    const allSel = c.numbers.every(n => ns.has(n.number))
    c.numbers.forEach(n => { if (allSel) { ns.delete(n.number); nm.delete(n.number) } else { ns.add(n.number); nm.set(n.number, { number: n.number, company_id: c._id, company_name: c.name, label: n.label, industry: c.industry, city: c.city, web: c.website }) } })
    onChange(ns, nm)
  }
  function toggleAll() {
    const allNums = filtered.flatMap(c => c.numbers.map(n => ({ number: n.number, company_id: c._id, company_name: c.name, label: n.label, industry: c.industry, city: c.city, web: c.website })))
    const allSel = allNums.every(n => selectedNums.has(n.number))
    const ns = new Set(selectedNums); const nm = new Map(numInfoMap)
    allNums.forEach(n => { if (allSel) { ns.delete(n.number); nm.delete(n.number) } else { ns.add(n.number); nm.set(n.number, n) } })
    onChange(ns, nm)
  }

  const allFilteredNums = filtered.flatMap(c => c.numbers.map(n => n.number))
  const allSel  = allFilteredNums.length > 0 && allFilteredNums.every(n => selectedNums.has(n))
  const someSel = !allSel && allFilteredNums.some(n => selectedNums.has(n))
  const selCount = selectedNums.size
  const activeSelCount = [...selectedNums].filter(n => activeSet.has(n)).length

  const chipSx = active => ({
    fontSize: '0.68rem', height: 22, fontWeight: active ? 700 : 400,
    bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.18)' : 'var(--item-hover)',
    border: `1px solid ${active ? 'rgba(var(--accent-rgb,59,130,246),0.45)' : 'var(--border)'}`,
    color: active ? 'var(--accent,#3b82f6)' : 'var(--text-muted)', cursor: 'pointer',
    '&:hover': { bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.25)' : 'var(--item-hover)', opacity: active ? 1 : 0.85 }, transition: 'background-color 0.15s, border-color 0.15s',
  })

  return (
    <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1, bgcolor: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <BusinessIcon sx={{ fontSize: 14, color: 'var(--text-muted)' }} />
        <Typography sx={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: '0.75rem', flex: 1 }}>{t.sched.recipients}</Typography>
        {loadingCo && <CircularProgress size={11} sx={{ color: 'var(--accent,#3b82f6)' }} />}
      </Box>

      <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, borderBottom: '1px solid var(--border)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, bgcolor: 'var(--surface)', borderRadius: 1.5, border: '1px solid var(--border)', px: 1, py: 0.4, mb: 1 }}>
          <SearchIcon sx={{ fontSize: 13, color: 'var(--text-muted)' }} />
          <Box component="input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t.sched.searchCo} sx={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text,#f1f5f9)', fontSize: '0.78rem', '&::placeholder': { color: 'var(--text-muted)' } }} />
          {search && <IconButton size="small" onClick={() => setSearch('')} sx={{ p: 0.2, color: 'var(--text-muted)' }}><CloseIcon sx={{ fontSize: 12 }} /></IconButton>}
        </Box>
        {industries.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Chip label={t.sched.allIndustries} size="small" onClick={() => setIndustryFilter('')} sx={chipSx(!industryFilter)} />
            {(showAllIndustries ? industries : industries.slice(0, MAX_IND)).map(ind => (
              <Chip key={ind} label={ind} size="small" onClick={() => setIndustryFilter(f => f === ind ? '' : ind)} sx={chipSx(industryFilter === ind)} />
            ))}
            {industries.length > MAX_IND && (
              <Typography onClick={() => setShowAllIndustries(v => !v)} sx={{ color: 'var(--accent,#3b82f6)', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', px: 0.5, '&:hover': { opacity: 0.8 } }}>
                {showAllIndustries ? t.sched.showLess : `+${industries.length - MAX_IND} ${t.sched.showMore}`}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {filtered.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, borderBottom: '1px solid var(--border)', bgcolor: 'var(--surface)' }}>
          <Checkbox size="small" checked={allSel} indeterminate={someSel} onChange={toggleAll} sx={{ p: 0.3, color: 'var(--border)', '&.Mui-checked,&.MuiCheckbox-indeterminate': { color: 'var(--accent,#3b82f6)' } }} />
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{t.sched.selectAll} ({allFilteredNums.length})</Typography>
        </Box>
      )}

      <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
        {loadingCo ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} sx={{ color: 'var(--accent,#3b82f6)' }} /></Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}><Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Sin resultados</Typography></Box>
        ) : filtered.map(company => {
          const sc = company.numbers.filter(n => selectedNums.has(n.number)).length
          return (
            <Box key={company._id} sx={{ borderBottom: '1px solid var(--border)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.7, '&:hover': { bgcolor: 'var(--item-hover)' } }}>
                <Checkbox size="small" checked={sc === company.numbers.length && company.numbers.length > 0} indeterminate={sc > 0 && sc < company.numbers.length} onChange={() => toggleCompany(company)} sx={{ p: 0.3, color: 'var(--border)', '&.Mui-checked,&.MuiCheckbox-indeterminate': { color: 'var(--accent,#3b82f6)' } }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ color: 'var(--text)', fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.2 }}>{company.name}</Typography>
                  {company.domain && <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{company.domain}</Typography>}
                </Box>
                <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem', flexShrink: 0 }}>{sc}/{company.numbers.length}</Typography>
              </Box>
              {company.numbers.map(n => {
                const isSel = selectedNums.has(n.number)
                return (
                  <Box key={n.number} onClick={() => toggle(n.number, { number: n.number, company_id: company._id, company_name: company.name, label: n.label, industry: company.industry, city: company.city, web: company.website })}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 3.5, pr: 1.5, py: 0.4, cursor: 'pointer', bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.06)' : 'transparent', '&:hover': { bgcolor: 'var(--item-hover)' } }}>
                    <Checkbox size="small" checked={isSel} onChange={() => {}} sx={{ p: 0.25, color: 'var(--border)', '&.Mui-checked': { color: 'var(--accent,#3b82f6)' } }} />
                    <WhatsAppIcon sx={{ fontSize: 11, color: isSel ? '#25d366' : 'var(--text-muted)', flexShrink: 0 }} />
                    <Typography sx={{ color: isSel ? 'var(--text)' : 'var(--text-muted)', fontSize: '0.74rem', fontFamily: 'monospace', flex: 1 }}>{fmtNumber(n.number)}</Typography>
                    {n.label && <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{n.label}</Typography>}
                    {n.active && (
                      <Tooltip title={t.sched.activeInCampaign}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.2, bgcolor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 1, px: 0.5, py: 0.1 }}>
                          <WarningAmberIcon sx={{ fontSize: 9, color: '#f59e0b' }} />
                          <Typography sx={{ color: '#f59e0b', fontSize: '0.6rem', fontWeight: 600 }}>activa</Typography>
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>

      <Box sx={{ px: 1.5, py: 0.8, borderTop: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 1 }}>
        {selCount === 0
          ? <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.72rem' }}>{t.sched.noNumSel}</Typography>
          : <>
              <Typography sx={{ color: 'var(--accent,#3b82f6)', fontSize: '0.72rem', fontWeight: 600 }}>{selCount} {selCount !== 1 ? t.sched.numbers : t.sched.numSingular}</Typography>
              {activeSelCount > 0 && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><WarningAmberIcon sx={{ fontSize: 12, color: '#f59e0b' }} /><Typography sx={{ color: '#f59e0b', fontSize: '0.68rem' }}>{activeSelCount} {t.sched.alreadyInCampaign}</Typography></Box>}
            </>
        }
      </Box>
    </Box>
  )
}

// ─── Message variants editor ───────────────────────────────────────────────────
// Lets the user keep several worded variants of the same campaign message.
// The scheduler picks one at random per recipient (see scheduler.py
// _pick_message) so a bulk send doesn't repeat identical text — the pattern
// WhatsApp flags as bot-like and that can get a number banned.

function MessageVariantsEditor({ messages, setMessages, recipientCount = 0, hasCityData = true }) {
  const { t, lang } = useLang()
  const [savedTemplates, setSavedTemplates] = useState([])
  const [managerOpen,    setManagerOpen]    = useState(false)

  const loadSaved = useCallback(() => {
    authFetch(`/api/admin/message-templates?lang=${lang}`)
      .then(r => r.json()).then(d => setSavedTemplates(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [lang])
  useEffect(() => { loadSaved() }, [loadSaved])

  function updateAt(i, val) { setMessages(prev => prev.map((m, idx) => idx === i ? val : m)) }
  function removeAt(i) { setMessages(prev => prev.filter((_, idx) => idx !== i)) }
  function addBlank() { setMessages(prev => [...prev, '']) }
  function addFromTemplate(tpl) { setMessages(prev => (prev.length === 1 && !prev[0].trim()) ? [tpl.text] : [...prev, tpl.text]) }

  const cleanCount = messages.map(m => m.trim()).filter(Boolean).length
  const needsMin = recipientCount > 1
  const okMin = cleanCount >= MIN_TEMPLATES_FOR_BULK

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, flex: 1 }}>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600 }}>{t.sched.messagesLabel}</Typography>
          <Tooltip title={t.sched.messagesLabelHelp}>
            <HelpOutlineIcon sx={{ fontSize: 13, color: 'var(--text-muted)', opacity: 0.6, cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Button variant="contained" size="small" onClick={() => setManagerOpen(true)} sx={{ bgcolor: 'var(--accent,#3b82f6)', color: '#fff', textTransform: 'none', fontSize: '0.72rem', fontWeight: 600, borderRadius: 1.5, px: 1.5, boxShadow: 'none', '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.88)', boxShadow: 'none' } }}>
          {t.sched.manageTemplates}
        </Button>
      </Box>

      {needsMin && (
        <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'flex-start', borderRadius: 1.5, px: 1, py: 0.7,
          bgcolor: okMin ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${okMin ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
          <WarningAmberIcon sx={{ fontSize: 13, color: okMin ? '#4ade80' : '#f59e0b', mt: 0.2, flexShrink: 0 }} />
          <Typography sx={{ color: okMin ? '#4ade80' : '#f59e0b', fontSize: '0.7rem', lineHeight: 1.4 }}>
            {okMin ? t.tplLib.minRequiredOk(cleanCount) : t.tplLib.minRequiredBlock(MIN_TEMPLATES_FOR_BULK, cleanCount)}
          </Typography>
        </Box>
      )}

      {savedTemplates.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {savedTemplates.map(tpl => {
            const needsCity = /\{\{ciudad\}\}/.test(tpl.text)
            const blocked   = needsCity && !hasCityData
            return (
              <Tooltip key={tpl._id} title={blocked ? (lang === 'en' ? 'No city data for selected contacts' : 'Los contactos seleccionados no tienen ciudad') : ''} placement="top">
                <span>
                  <Chip label={tpl.name} size="small"
                    onClick={blocked ? undefined : () => addFromTemplate(tpl)}
                    sx={{ fontSize: '0.68rem', height: 22, cursor: blocked ? 'not-allowed' : 'pointer',
                      bgcolor: 'var(--item-hover)', border: `1px solid ${blocked ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                      color: blocked ? 'rgba(239,68,68,0.5)' : 'var(--text-muted)', opacity: blocked ? 0.6 : 1,
                      '&:hover': blocked ? {} : { borderColor: 'var(--accent,#3b82f6)', color: 'var(--accent,#3b82f6)' },
                    }} />
                </span>
              </Tooltip>
            )
          })}
        </Box>
      )}

      {messages.map((m, i) => (
        <Box key={i}>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', mb: 0.4 }}>{t.sched.variantLabel} {i + 1}</Typography>
          <Box sx={{ position: 'relative' }}>
            <HighlightedMessageInput value={m} onChange={v => updateAt(i, v)} rows={3} maxLength={1000} lang={lang} />
            <Typography sx={{ position: 'absolute', bottom: 6, right: 10, fontSize: '0.65rem', color: m.length > 900 ? '#ef4444' : 'var(--text-muted)', opacity: 0.6, pointerEvents: 'none' }}>
              {m.length} / 1000
            </Typography>
            {messages.length > 1 && (
              <IconButton size="small" onClick={() => removeAt(i)}
                sx={{ position: 'absolute', top: 6, right: 6, zIndex: 2, p: 0.3, color: 'rgba(239,68,68,0.45)', bgcolor: 'rgba(239,68,68,0.06)', borderRadius: 1,
                  '&:hover': { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.14)' } }}>
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        </Box>
      ))}

      <Button variant="contained" size="small" onClick={addBlank}
        sx={{ alignSelf: 'flex-end', bgcolor: 'var(--accent,#3b82f6)', color: '#fff', textTransform: 'none', fontSize: '0.75rem', fontWeight: 600, borderRadius: 1.5, px: 1.5, boxShadow: 'none', '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.88)', boxShadow: 'none' } }}>
        {t.sched.addVariant}
      </Button>

      <TemplateManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} onChange={loadSaved} />
    </Box>
  )
}

// ─── Campaign form (create / edit / duplicate) ────────────────────────────────

function CampaignForm({ editJob, defaultDate, duplicateFrom, onDone }) {
  const { t, lang } = useLang()
  const isEdit = !!editJob
  const src    = duplicateFrom || editJob  // source for pre-filling

  const _initDt = isEdit ? (editJob.scheduled_at || defaultDate || '') : (defaultDate || '')

  const [name,      setName]    = useState(editJob?.name || (duplicateFrom ? `${duplicateFrom.name} (copia)` : ''))
  const [messages,  setMessages] = useState(() => (src?.messages?.length ? src.messages : [src?.message || '']))
  const [dateVal,   setDateVal] = useState(() => _initDt ? dayjs(_initDt) : dayjs().add(1, 'hour').startOf('hour'))
  const [timeVal,   setTimeVal] = useState(() => _initDt ? dayjs(_initDt) : dayjs().add(1, 'hour').startOf('hour'))
  const [selectedNums, setSelectedNums] = useState(() => new Set((src?.selected_numbers || []).map(n => n.number)))
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map((src?.selected_numbers || []).map(n => [n.number, n])))
  const [submitting, setSubmitting] = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState('')

  // Diff mode: capture originals for edit mode
  const origName    = isEdit ? (editJob?.name    || '') : null
  const origMessages = isEdit ? (editJob?.messages?.length ? editJob.messages : [editJob?.message || '']) : null
  const origSchedAt = isEdit ? (editJob?.scheduled_at || null) : null

  useEffect(() => {
    if (!isEdit && defaultDate) {
      const d = dayjs(defaultDate)
      setDateVal(d); setTimeVal(d)
    }
  }, [defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const cleanMessages = useMemo(() => messages.map(m => m.trim()).filter(Boolean), [messages])
  const belowMinTemplates = selectedNums.size > 1 && cleanMessages.length < MIN_TEMPLATES_FOR_BULK

  async function handleSubmit(e) {
    e.preventDefault(); setError('')
    if (!name.trim() || cleanMessages.length === 0 || !dateVal || !timeVal) { setError(t.sched.fillAll); return }
    if (selectedNums.size === 0) { setError(t.sched.selectNum); return }
    if (belowMinTemplates) { setError(t.tplLib.minRequiredBlock(MIN_TEMPLATES_FOR_BULK, cleanMessages.length)); return }
    setSubmitting(true)
    try {
      const combined = dateVal.hour(timeVal.hour()).minute(timeVal.minute()).second(0)
      const body = {
        name: name.trim(), messages: cleanMessages,
        scheduled_at: combined.format('YYYY-MM-DDTHH:mm:ss'),
        selected_numbers: [...selectedNums].map(n => numInfoMap.get(n)).filter(Boolean),
      }
      const res = await authFetch(
        isEdit ? `/api/admin/scheduled-sends/${editJob._id}` : '/api/admin/scheduled-sends',
        { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isEdit ? body : { ...body, company_ids: [] }) }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || t.sched.saveError)
      setSaved(true)
      setTimeout(() => onDone(data, isEdit), 1500)
    } catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang}>
    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, p: 2.5, position: 'relative' }}>
      {saved && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(13,17,23,0.93)', zIndex: 10, borderRadius: 1, gap: 1.2 }}>
          <CheckCircleIcon sx={{ fontSize: 50, color: '#4ade80' }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.88rem', fontWeight: 600 }}>
            {isEdit ? 'Cambios guardados' : (duplicateFrom ? 'Campaña duplicada' : 'Envío programado')}
          </Typography>
        </Box>
      )}
      <Box>
        <TextField label={t.sched.nameLabel} value={name} onChange={e => setName(e.target.value)} size="small" fullWidth sx={FIELD_SX} />
        {origName !== null && name !== origName && (
          <Typography sx={{ fontSize: '0.67rem', color: 'rgba(255,255,255,0.25)', mt: 0.4, px: 0.5 }}>
            Original: <em>{origName}</em>
          </Typography>
        )}
      </Box>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }} />
      <Box sx={{ bgcolor: 'var(--surface,rgba(255,255,255,0.04))', borderRadius: 2, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <DatePicker label={t.sched.dateLabel} value={dateVal} onChange={v => setDateVal(v)} disablePast
            slotProps={{ textField: { size: 'small', fullWidth: true, sx: PICKER_FIELD_SX }, popper: { sx: PICKER_POPPER_SX } }} />
          <TimePicker label={t.sched.timeLabel} value={timeVal} onChange={v => setTimeVal(v)} ampm
            slotProps={{ textField: { size: 'small', fullWidth: true, sx: PICKER_FIELD_SX }, popper: { sx: PICKER_POPPER_SX } }} />
        </Box>
        {USER_TZ && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AccessTimeIcon sx={{ fontSize: 12, color: 'var(--text-muted)' }} />
            <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{t.sched.tzLabel} {USER_TZ}</Typography>
          </Box>
        )}
        {origSchedAt !== null && (() => {
          const origStr = dayjs(origSchedAt).format('DD/MM/YYYY HH:mm')
          const curStr  = dateVal && timeVal ? dateVal.hour(timeVal.hour()).minute(timeVal.minute()).format('DD/MM/YYYY HH:mm') : null
          return curStr && origStr !== curStr ? (
            <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', px: 0.5, opacity: 0.7 }}>
              Original: <em>{origStr}</em>
            </Typography>
          ) : null
        })()}
      </Box>
      <Box>
        <MessageVariantsEditor messages={messages} setMessages={setMessages} recipientCount={selectedNums.size}
          hasCityData={selectedNums.size > 0 && [...numInfoMap.values()].some(c => c.city)} />
        {origMessages !== null && JSON.stringify(messages) !== JSON.stringify(origMessages) && (
          <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', mt: 0.6, px: 0.5, opacity: 0.7 }}>
            {t.sched.originalModified} ({origMessages.length})
          </Typography>
        )}
      </Box>
      <CompanyPicker selectedNums={selectedNums} numInfoMap={numInfoMap} onChange={(ns, nm) => { setSelectedNums(ns); setNumInfoMap(nm) }} />
      {error && <Box sx={{ px: 1.5, py: 0.8, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}><Typography sx={{ color: '#ef4444', fontSize: '0.78rem' }}>{error}</Typography></Box>}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
        <Button type="submit" variant="contained" disabled={submitting || belowMinTemplates}
          startIcon={submitting ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <SendIcon />}
          sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)' }, textTransform: 'none', fontWeight: 600, fontSize: '0.82rem', borderRadius: 2, px: 2, minWidth: 140 }}>
          {submitting ? t.sched.saving : (isEdit ? t.sched.saveLbl : (duplicateFrom ? t.sched.duplicateLbl : t.sched.scheduleLbl))}
        </Button>
        <Button variant="outlined" onClick={() => onDone(null, false)} sx={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)' }, textTransform: 'none', fontSize: '0.8rem', borderRadius: 2 }}>{t.common.cancel}</Button>
      </Box>
    </Box>
    </LocalizationProvider>
  )
}

// ─── Campaign pill ────────────────────────────────────────────────────────────

function CampaignPill({ job, onClick }) {
  const meta = STATUS_META[job.status] || STATUS_META.pending
  return (
    <Box onClick={e => { e.stopPropagation(); onClick(job) }} sx={{
      display: 'flex', alignItems: 'center', gap: 0.4,
      bgcolor: meta.bg, borderLeft: `2px solid ${meta.color}`,
      borderRadius: '0 3px 3px 0', px: 0.6, py: 0.1,
      cursor: 'pointer', overflow: 'hidden',
      '&:hover': { filter: 'brightness(1.15)' }, transition: 'filter 0.12s',
    }}>
      <Typography sx={{ color: meta.color, fontSize: '0.62rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fmtTime(job.scheduled_at)} {job.name}
      </Typography>
    </Box>
  )
}

// ─── Day cell ─────────────────────────────────────────────────────────────────

function DayCell({ date, jobs, inCurrentMonth, isToday, isSelected, onDayClick, onJobClick }) {
  const todayMs = new Date(); todayMs.setHours(0, 0, 0, 0)
  const isPast  = date < todayMs && !isToday
  const dayJobs = jobs.filter(j => { try { return isSameDay(new Date(j.scheduled_at), date) } catch { return false } })
  return (
    <Box onClick={() => !isPast && onDayClick(date)} sx={{
      minHeight: 90,
      border: isSelected ? '1px solid rgba(var(--accent-rgb,59,130,246),0.6)' : '1px solid var(--border)',
      bgcolor: isSelected ? 'rgba(var(--accent-rgb,59,130,246),0.1)' : isToday ? 'rgba(var(--accent-rgb,59,130,246),0.05)' : 'transparent',
      p: 0.5, cursor: isPast ? 'not-allowed' : 'pointer',
      opacity: isPast ? 0.35 : (inCurrentMonth ? 1 : 0.3),
      '&:hover': isPast ? {} : { bgcolor: isSelected ? 'rgba(var(--accent-rgb,59,130,246),0.14)' : isToday ? 'rgba(var(--accent-rgb,59,130,246),0.09)' : 'var(--item-hover)' },
      transition: 'background-color 0.12s, border-color 0.12s',
    }}>
      <Box sx={{ width: 22, height: 22, borderRadius: '50%', mb: 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: isToday ? 'var(--accent,#3b82f6)' : 'transparent' }}>
        <Typography sx={{ color: isToday ? '#fff' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>{date.getDate()}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
        {dayJobs.slice(0, 3).map(j => <CampaignPill key={j._id} job={j} onClick={onJobClick} />)}
        {dayJobs.length > 3 && <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.6rem', pl: 0.5 }}>+{dayJobs.length - 3} más</Typography>}
      </Box>
    </Box>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({ jobs, viewYear, viewMonth, selectedDate, onDayClick, onJobClick }) {
  const { t } = useLang()
  const today  = new Date()
  const days   = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth])
  const selDay = selectedDate ? new Date(selectedDate) : null
  const monthJobsCount = useMemo(() => jobs.filter(j => {
    try { const d = new Date(j.scheduled_at); return d.getFullYear() === viewYear && d.getMonth() === viewMonth } catch { return false }
  }).length, [jobs, viewYear, viewMonth])

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--border)' }}>
        {t.sched.daysShort.map(d => (
          <Typography key={d} sx={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, py: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', flex: 1, minHeight: 0 }}>
        {days.map((date, i) => (
          <DayCell key={i} date={date} jobs={jobs}
            inCurrentMonth={date.getMonth() === viewMonth}
            isToday={isSameDay(date, today)}
            isSelected={selDay ? isSameDay(date, selDay) : false}
            onDayClick={onDayClick} onJobClick={onJobClick}
          />
        ))}
      </Box>
      {monthJobsCount === 0 && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', gap: 1 }}>
          <ScheduleSendIcon sx={{ fontSize: 32, color: 'var(--border)' }} />
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.82rem', opacity: 0.85 }}>{t.sched.noMonthSends}</Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', opacity: 0.55 }}>{t.sched.noMonthSendsHint}</Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekView({ jobs, weekStart, selectedDate, onDayClick, onJobClick }) {
  const { t } = useLang()
  const today  = new Date()
  const selDay = selectedDate ? new Date(selectedDate) : null
  const days   = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  }), [weekStart])

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Day headers */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid var(--border)' }}>
        {days.map((d, i) => {
          const isTod = isSameDay(d, today)
          return (
            <Box key={i} sx={{ textAlign: 'center', py: 1, borderRight: i < 6 ? '1px solid var(--border)' : 'none' }}>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.sched.daysLong[i]}</Typography>
              <Box sx={{ width: 30, height: 30, borderRadius: '50%', mx: 'auto', mt: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: isTod ? 'var(--accent,#3b82f6)' : 'transparent' }}>
                <Typography sx={{ color: isTod ? '#fff' : 'var(--text)', fontSize: '0.88rem', fontWeight: 700 }}>{d.getDate()}</Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
      {/* Day columns */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', flex: 1, overflowY: 'auto' }}>
        {days.map((d, i) => {
          const todayMs = new Date(); todayMs.setHours(0, 0, 0, 0)
          const isPast  = d < todayMs && !isSameDay(d, today)
          const isSel   = selDay ? isSameDay(d, selDay) : false
          const dayJobs = jobs.filter(j => { try { return isSameDay(new Date(j.scheduled_at), d) } catch { return false } })
          return (
            <Box key={i} onClick={() => !isPast && onDayClick(d)} sx={{
              borderRight: i < 6 ? '1px solid var(--border)' : 'none',
              minHeight: 160, p: 0.75, cursor: isPast ? 'not-allowed' : 'pointer',
              opacity: isPast ? 0.35 : 1,
              bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent',
              border: isSel ? '1px solid rgba(var(--accent-rgb,59,130,246),0.4)' : '1px solid transparent',
              '&:hover': isPast ? {} : { bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.12)' : 'var(--item-hover)' },
              transition: 'background-color 0.12s',
              display: 'flex', flexDirection: 'column', gap: 0.4,
            }}>
              {dayJobs.map(j => <CampaignPill key={j._id} job={j} onClick={onJobClick} />)}
              {dayJobs.length === 0 && !isPast && (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AddIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.06)' }} />
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

function ListView({ jobs, onJobClick, onRequestCancel, onRequestDelete, onDuplicate }) {
  const { t } = useLang()
  const [statusFilter, setStatusFilter] = useState('all')
  const filtered = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  const filterChipSx = active => ({
    fontSize: '0.68rem', height: 22,
    bgcolor: active ? 'var(--accent,#3b82f6)' : 'var(--card-bg)',
    border: `1px solid ${active ? 'var(--accent,#3b82f6)' : 'var(--border)'}`,
    color: active ? '#fff' : 'var(--text-muted)',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    boxShadow: active ? '0 0 8px rgba(var(--accent-rgb,59,130,246),0.4)' : 'none',
    transition: 'all 0.15s',
    '&:hover': { bgcolor: active ? 'var(--accent,#3b82f6)' : 'rgba(var(--accent-rgb,59,130,246),0.07)', opacity: active ? 0.88 : 1 },
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Status filter */}
      <Box sx={{ display: 'flex', gap: 0.5, px: 2, py: 1, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
        <Chip label={t.sched.allStatuses} size="small" onClick={() => setStatusFilter('all')} sx={filterChipSx(statusFilter === 'all')} />
        {Object.entries(STATUS_META).map(([k, v]) => (
          <Chip key={k} label={t.sched[v.tKey]} size="small" onClick={() => setStatusFilter(s => s === k ? 'all' : k)} sx={filterChipSx(statusFilter === k)} />
        ))}
      </Box>

      {filtered.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 1.5 }}>
          <ScheduleSendIcon sx={{ fontSize: 36, color: 'var(--border)' }} />
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {statusFilter === 'all' ? t.sched.noJobs : `${t.sched.noJobsStatus} "${t.sched[STATUS_META[statusFilter]?.tKey]}"`}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ overflowY: 'auto', flex: 1, px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          {filtered.map(job => {
            const meta      = STATUS_META[job.status] || STATUS_META.pending
            const canCancel = job.status === 'pending' || job.status === 'running'
            const canEdit   = job.status === 'pending'
            const canDelete = !canCancel
            const numCount  = job.selected_numbers?.length || 0
            const pct       = job.total_count ? Math.min(100, Math.round(((job.sent_count||0) / job.total_count) * 100)) : null
            return (
              <Box key={job._id} onClick={() => onJobClick(job)} sx={{
                display: 'flex', alignItems: 'stretch', borderRadius: 2, cursor: 'pointer', overflow: 'hidden',
                border: `1px solid ${meta.color}55`,
                bgcolor: 'var(--card-bg)',
                transition: 'border-color 0.18s, box-shadow 0.18s, background-color 0.18s',
                '&:hover': { borderColor: `${meta.color}99`, bgcolor: `${meta.color}10`, boxShadow: `0 2px 16px ${meta.color}22` },
              }}>
                {/* Date badge */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 1.8, py: 1.5, borderRight: `1px solid ${meta.color}22`, minWidth: 58, flexShrink: 0, bgcolor: `${meta.color}08` }}>
                  {job.scheduled_at ? (() => {
                    const d = new Date(job.scheduled_at)
                    const day = d.toLocaleString('es-MX', { day: '2-digit' })
                    const mon = d.toLocaleString('es-MX', { month: 'short' }).replace('.','')
                    const hr  = d.toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
                    return <>
                      <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '1.15rem', fontWeight: 700, lineHeight: 1 }}>{day}</Typography>
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', mt: 0.2 }}>{mon}</Typography>
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.6rem', mt: 0.5, fontFamily: 'monospace', opacity: 0.7 }}>{hr}</Typography>
                    </>
                  })() : <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</Typography>}
                </Box>

                {/* Main content */}
                <Box sx={{ flex: 1, minWidth: 0, px: 1.8, py: 1.4, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.85rem', fontWeight: 700, lineHeight: 1.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.name}
                    </Typography>
                    <StatusChip status={job.status} />
                  </Box>
                  <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {numCount ? `${numCount} ${t.sched.numbers}` : t.sched.unassigned}
                    {job.total_count > 0 ? ` · ${job.sent_count||0}/${job.total_count} ${t.sched.sent}` : ''}
                  </Typography>
                  {job.message && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {job.message}
                      </Typography>
                      {job.messages?.length > 1 && (
                        <Chip label={`+${job.messages.length - 1} ${t.sched.variantsSuffix}`} size="small"
                          sx={{ height: 15, fontSize: '0.58rem', flexShrink: 0, color: 'var(--accent,#3b82f6)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', border: 'none', '& .MuiChip-label': { px: 0.6 } }} />
                      )}
                    </Box>
                  )}
                  {pct !== null && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 5, borderRadius: 2, bgcolor: 'var(--border)', '& .MuiLinearProgress-bar': { bgcolor: meta.color, borderRadius: 2 } }} />
                      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem', minWidth: 28, textAlign: 'right' }}>{pct}%</Typography>
                    </Box>
                  )}
                </Box>

                {/* Actions */}
                <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.3, px: 1, py: 1, borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
                  <Tooltip title={t.sched.ttDuplicate} placement="left"><IconButton size="small" onClick={() => onDuplicate(job)} sx={{ color: 'var(--text-muted)', '&:hover': { color: '#a78bfa' } }}><ContentCopyIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                  {canEdit   && <Tooltip title={t.sched.ttEdit} placement="left"><IconButton size="small" onClick={() => onJobClick(job)} sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--accent,#3b82f6)' } }}><EditIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
                  {canCancel && <Tooltip title={t.sched.ttCancel} placement="left"><IconButton size="small" onClick={() => onRequestCancel(job)} sx={{ color: 'rgba(239,68,68,0.6)', '&:hover': { color: '#ef4444' } }}><CancelIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title={t.sched.ttDelete} placement="left"><IconButton size="small" onClick={() => onRequestDelete(job)} sx={{ color: 'var(--text-muted)', '&:hover': { color: '#ef4444' } }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

// ─── Side panel ───────────────────────────────────────────────────────────────

function SidePanel({ panel, onDone, onRequestCancel, onRequestDelete, onDuplicate }) {
  const { t } = useLang()
  const isOpen = !!panel
  const isEdit = panel?.mode === 'edit'
  const isReadOnly = isEdit && panel?.job?.status !== 'pending'
  const modeColor  = panel?.mode === 'duplicate' ? '#a78bfa' : (isEdit ? '#4ade80' : 'var(--accent,#3b82f6)')
  const modeRgb    = panel?.mode === 'duplicate' ? '167,139,250' : (isEdit ? '74,222,128' : '59,130,246')
  const [industryMap, setIndustryMap] = useState({})

  useEffect(() => {
    if (!isReadOnly || !panel?.job?.selected_numbers?.length) return
    authFetch('/api/admin/companies-with-numbers')
      .then(r => r.json())
      .then(data => {
        const map = {}
        ;(data || []).forEach(c => { if (c._id && c.industry) map[String(c._id)] = c.industry })
        setIndustryMap(map)
      })
      .catch(() => {})
  }, [panel?.job?._id, isReadOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box sx={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: isOpen ? 'min(390px, 55%)' : 0,
      overflow: 'hidden',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      borderLeft: isOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
      display: 'flex', flexDirection: 'column',
      bgcolor: 'var(--sidebar-bg, #0d1117)',
      zIndex: 2,
    }}>
      {isOpen && (
        <Box sx={{ width: 'min(390px, 55vw)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.8, borderBottom: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: 1.5, flexShrink: 0, bgcolor: `rgba(${modeRgb},0.12)`, border: `1px solid rgba(${modeRgb},0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {panel.mode === 'duplicate' ? <ContentCopyIcon sx={{ fontSize: 14, color: modeColor }} /> : isEdit ? <EditIcon sx={{ fontSize: 14, color: modeColor }} /> : <ScheduleSendIcon sx={{ fontSize: 15, color: modeColor }} />}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.2 }}>
                {panel.mode === 'duplicate' ? t.sched.duplicatePanel : isEdit ? t.sched.editPanel : t.sched.createPanel}
              </Typography>
              {(isEdit || panel.mode === 'duplicate') && panel.job?.name && (
                <Chip label={panel.job.name} size="small" sx={{ height: 17, fontSize: '0.62rem', bgcolor: `rgba(${modeRgb},0.1)`, color: modeColor, border: `1px solid rgba(${modeRgb},0.2)`, '& .MuiChip-label': { px: 0.8 }, maxWidth: '100%', mt: 0.3 }} />
              )}
            </Box>
            <IconButton size="small" onClick={() => onDone(null, false)} sx={{ color: 'rgba(255,255,255,0.3)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          {/* Read-only view for non-pending jobs */}
          {isReadOnly ? (() => {
            const job = panel.job
            const meta = STATUS_META[job.status] || STATUS_META.pending
            const sent  = job.sent_count || 0
            const total = job.total_count || (job.selected_numbers?.length || 0)
            const pct   = total > 0 ? Math.round(sent / total * 100) : 0

            const groupMap = {}
            for (const num of (job.selected_numbers || [])) {
              const key = num.company_id || num.company_name || '?'
              if (!groupMap[key]) groupMap[key] = { company_name: num.company_name || '—', company_id: num.company_id, numbers: [] }
              groupMap[key].numbers.push(num)
            }
            const groups = Object.values(groupMap)

            const LABEL_SX = { color: 'var(--text-muted)', fontSize: '0.66rem', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }

            return (
              <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>

                {/* Stats row */}
                <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusChip status={job.status} />
                  <Chip icon={<SendIcon sx={{ fontSize: '11px !important' }} />} label={`${sent} / ${total}`} size="small"
                    sx={{ height: 20, fontSize: '0.68rem', bgcolor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', '& .MuiChip-icon': { color: 'var(--text-muted)', ml: 0.8 }, '& .MuiChip-label': { px: 0.7 } }} />
                  <Chip icon={<WhatsAppIcon sx={{ fontSize: '11px !important' }} />} label={job.selected_numbers?.length || 0} size="small"
                    sx={{ height: 20, fontSize: '0.68rem', bgcolor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', '& .MuiChip-icon': { color: '#4ade80', ml: 0.8 }, '& .MuiChip-label': { px: 0.7 } }} />
                  <Chip icon={<AccessTimeIcon sx={{ fontSize: '11px !important' }} />} label={fmtDate(job.scheduled_at)} size="small"
                    sx={{ height: 20, fontSize: '0.68rem', bgcolor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', '& .MuiChip-icon': { color: 'var(--text-muted)', ml: 0.8 }, '& .MuiChip-label': { px: 0.7 } }} />
                </Box>

                {/* Progress */}
                <Box sx={{ bgcolor: 'var(--surface)', borderRadius: 2, p: 1.5, border: `1px solid ${meta.color}22` }}>
                  <Typography sx={LABEL_SX}>{t.sched.panelProgress}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                    <Typography sx={{ color: meta.color, fontWeight: 700, fontSize: '1.5rem', lineHeight: 1 }}>{sent}</Typography>
                    <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{t.sched.panelOf} {total} {t.sched.sent}</Typography>
                    {job.status === 'done' && total > 0 && sent >= total && (
                      <CheckCircleIcon sx={{ fontSize: 15, color: '#4ade80', ml: 0.3 }} />
                    )}
                  </Box>
                  <LinearProgress variant="determinate" value={Math.min(pct, 100)}
                    sx={{ height: job.status === 'done' ? 8 : 5, borderRadius: 3, bgcolor: 'var(--border)',
                      '& .MuiLinearProgress-bar': { bgcolor: meta.color, borderRadius: 3, boxShadow: job.status === 'done' ? `0 0 8px ${meta.color}55` : 'none' } }} />
                  <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.65rem', mt: 0.4, textAlign: 'right', opacity: 0.7 }}>{pct}%</Typography>
                </Box>

                {/* Message(s) */}
                <Box>
                  <Typography sx={LABEL_SX}>
                    {job.messages?.length > 1 ? `${t.sched.panelMessage} (${job.messages.length} ${t.sched.variantsSuffix})` : t.sched.panelMessage}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                    {(job.messages?.length ? job.messages : [job.message]).filter(Boolean).map((msg, i) => (
                      <Box key={i} sx={{ bgcolor: 'var(--surface)', borderRadius: 2, p: 1.5, border: '1px solid var(--border)', borderLeft: '3px solid rgba(var(--accent-rgb,59,130,246),0.35)' }}>
                        <Typography sx={{ color: 'var(--text)', fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{msg}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* Recipients grouped by company */}
                {groups.length > 0 && (
                  <Box>
                    <Typography sx={LABEL_SX}>{t.sched.panelRecipients} ({job.selected_numbers?.length || 0})</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                      {groups.map(g => {
                        const industry = industryMap[String(g.company_id)] || ''
                        return (
                          <Box key={g.company_id || g.company_name} sx={{ bgcolor: 'var(--surface)', borderRadius: 1.5, p: 1.2, border: '1px solid var(--border)' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mb: 0.4, flexWrap: 'wrap' }}>
                              <BusinessIcon sx={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }} />
                              <Typography sx={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{g.company_name}</Typography>
                              {industry && (
                                <Chip label={industry} size="small" sx={{ height: 15, fontSize: '0.58rem', color: 'var(--text-muted)', bgcolor: 'var(--item-hover)', border: 'none', '& .MuiChip-label': { px: 0.7 } }} />
                              )}
                            </Box>
                            {g.numbers.map(n => (
                              <Box key={n.number} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 2.4, mt: 0.25 }}>
                                <WhatsAppIcon sx={{ fontSize: 11, color: '#4ade80', flexShrink: 0 }} />
                                <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.74rem', fontFamily: 'monospace' }}>{n.number}</Typography>
                              </Box>
                            ))}
                          </Box>
                        )
                      })}
                    </Box>
                  </Box>
                )}

                {/* Actions — sticky to bottom of scroll container */}
                <Box sx={{ position: 'sticky', bottom: 0, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center', py: 1.5, mt: 0.5, borderTop: '1px solid var(--border)', bgcolor: 'var(--sidebar-bg, #0d1117)', backdropFilter: 'blur(4px)' }}>
                  <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => onDuplicate(job)}
                    sx={{ color: 'var(--accent,#3b82f6)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, transition: 'all 0.18s ease', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.6)' } }}>
                    {t.sched.dupBtn}
                  </Button>
                  {job.status === 'running' && (
                    <Button size="small" startIcon={<CancelIcon />} onClick={() => onRequestCancel(job)}
                      sx={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, transition: 'all 0.18s ease', '&:hover': { bgcolor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.6)' } }}>
                      {t.sched.cancelSendBtn}
                    </Button>
                  )}
                  {(job.status === 'done' || job.status === 'cancelled' || job.status === 'error') && (
                    <Button size="small" startIcon={<DeleteIcon />} onClick={() => onRequestDelete(job)}
                      sx={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, transition: 'all 0.18s ease', '&:hover': { bgcolor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.6)' } }}>
                      {t.sched.deleteBtn}
                    </Button>
                  )}
                </Box>
              </Box>
            )
          })() : (
            <CampaignForm
              editJob={isEdit ? panel.job : null}
              defaultDate={panel.mode === 'create' ? panel.defaultDate : undefined}
              duplicateFrom={panel.mode === 'duplicate' ? panel.job : undefined}
              onDone={onDone}
            />
          )}
        </Box>
      )}
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScheduledSends() {
  const { t } = useLang()
  const today = new Date()
  const [jobs,      setJobs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))
  const [calView,   setCalView]   = useState('month') // 'month' | 'week' | 'list'
  const [panel,     setPanel]     = useState(null)
  const [confirm,   setConfirm]   = useState(null)   // { action, job, title, body }
  const fetchJobs = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/scheduled-sends')
      if (!res.ok) return
      const data = await res.json()
      setJobs(Array.isArray(data) ? data : [])
    } catch { } finally { setLoading(false) }
  }, [])

  const hasRunning = jobs.some(j => j.status === 'running')

  useEffect(() => { fetchJobs() }, [fetchJobs])

  useEffect(() => {
    const interval = hasRunning ? 10_000 : 30_000
    const id = setInterval(() => { if (!document.hidden) fetchJobs() }, interval)
    return () => clearInterval(id)
  }, [hasRunning, fetchJobs])

  // ── Navigation ───────────────────────────────────────────────────────────────

  function navPrev() {
    if (calView === 'week') { setWeekStart(w => { const d = new Date(w); d.setDate(d.getDate() - 7); return d }) }
    else { setViewMonth(m => { const next = m - 1; if (next < 0) { setViewYear(y => y - 1); return 11 } return next }) }
  }
  function navNext() {
    if (calView === 'week') { setWeekStart(w => { const d = new Date(w); d.setDate(d.getDate() + 7); return d }) }
    else { setViewMonth(m => { const next = m + 1; if (next > 11) { setViewYear(y => y + 1); return 0 } return next }) }
  }
  function goToday() {
    setViewYear(today.getFullYear()); setViewMonth(today.getMonth())
    setWeekStart(getWeekStart(today))
  }

  // ── Panel handlers ───────────────────────────────────────────────────────────

  function handleDayClick(date) {
    if (panel?.mode === 'create') { setPanel(prev => ({ ...prev, defaultDate: dateToDtLocal(date) })) }
    else { setPanel({ mode: 'create', defaultDate: dateToDtLocal(date) }) }
  }

  function handleJobClick(job) {
    // Auto-navigate to the job's month/week
    const d = new Date(job.scheduled_at)
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
    setWeekStart(getWeekStart(d))
    setPanel({ mode: 'edit', job })
  }

  function handleDuplicate(job) {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    setPanel({ mode: 'duplicate', job, defaultDate: dateToDtLocal(tomorrow) })
  }

  async function handlePanelDone(result, wasEdit) {
    if (!result) { setPanel(null); return }
    if (wasEdit) { setJobs(prev => prev.map(j => j._id === result._id ? result : j)) }
    else { setJobs(prev => [result, ...prev]) }
    setPanel(null)
  }

  // ── Confirm actions ──────────────────────────────────────────────────────────

  function requestCancel(job) {
    setConfirm({ action: 'cancel', job, title: '¿Cancelar envío?', body: `Se detendrá "${job.name}". Los mensajes ya enviados no se pueden deshacer.` })
  }
  function requestDelete(job) {
    setConfirm({ action: 'delete', job, title: '¿Eliminar campaña?', body: `Se eliminará "${job.name}" de forma permanente.` })
  }

  async function handleConfirm() {
    const { action, job } = confirm
    setConfirm(null)
    try {
      await authFetch(`/api/admin/scheduled-sends/${job._id}`, { method: 'DELETE' })
      if (action === 'cancel') setJobs(prev => prev.map(j => j._id === job._id ? { ...j, status: 'cancelled' } : j))
      if (action === 'delete') setJobs(prev => prev.filter(j => j._id !== job._id))
      if (panel?.job?._id === job._id) setPanel(null)
    } catch { }
  }

  // ── Toolbar label ────────────────────────────────────────────────────────────

  const toolbarLabel = useMemo(() => {
    if (calView === 'week') {
      const end = new Date(weekStart); end.setDate(end.getDate() + 6)
      const sM = t.sched.months[weekStart.getMonth()].slice(0, 3)
      const eM = t.sched.months[end.getMonth()].slice(0, 3)
      return weekStart.getMonth() === end.getMonth()
        ? `${weekStart.getDate()}–${end.getDate()} ${sM} ${weekStart.getFullYear()}`
        : `${weekStart.getDate()} ${sM} – ${end.getDate()} ${eM} ${end.getFullYear()}`
    }
    return `${t.sched.months[viewMonth]} ${viewYear}`
  }, [calView, viewMonth, viewYear, weekStart, t])

  const hasActive = jobs.some(j => j.status === 'running')
  const VIEWS = [{ key: 'month', icon: <CalendarMonthIcon sx={{ fontSize: 15 }} />, label: t.sched.viewMonth }, { key: 'week', icon: <ViewWeekIcon sx={{ fontSize: 15 }} />, label: t.sched.viewWeek }, { key: 'list', icon: <ViewListIcon sx={{ fontSize: 15 }} />, label: t.sched.viewList }]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ScheduleSendIcon sx={{ fontSize: 19, color: 'var(--accent,#3b82f6)' }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }}>{t.sched.title}</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>{t.sched.subtitle}</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasActive && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <CircularProgress size={11} thickness={5} sx={{ color: '#f59e0b' }} />
            <Typography sx={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>{t.sched.live}</Typography>
          </Box>}
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setPanel({ mode: 'create', defaultDate: dateToDtLocal(today) })}
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' }, textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', borderRadius: 2, px: 1.8 }}>
            {t.sched.scheduleBtn}
          </Button>
        </Box>
      </Box>

      {/* Main area */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, bgcolor: 'var(--item-hover)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Toolbar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1.2, borderBottom: '1px solid var(--border)', flexShrink: 0, overflow: 'hidden' }}>
            {/* Nav group */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <IconButton size="small" onClick={navPrev} sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}><ChevronLeftIcon sx={{ fontSize: 18 }} /></IconButton>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>{toolbarLabel}</Typography>
              <IconButton size="small" onClick={navNext} sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}><ChevronRightIcon sx={{ fontSize: 18 }} /></IconButton>
              <Button size="small" onClick={goToday} sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'none', borderRadius: 1.5, border: '1px solid var(--border)', px: 1.2, py: 0.3, '&:hover': { bgcolor: 'var(--item-hover)' } }}>{t.sched.today}</Button>
            </Box>
            {/* View switcher */}
            <Box sx={{ ml: 'auto', flexShrink: 0, display: 'flex', bgcolor: 'var(--item-hover)', borderRadius: 1.5, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {VIEWS.map(v => (
                <Box key={v.key} onClick={() => setCalView(v.key)} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1.2, py: 0.4, cursor: 'pointer', bgcolor: calView === v.key ? 'var(--border)' : 'transparent', color: calView === v.key ? 'var(--text,#f1f5f9)' : 'var(--text-muted)', transition: 'background-color 0.12s' }}>
                  {v.icon}
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: calView === v.key ? 600 : 400, display: { xs: 'none', sm: 'block' } }}>{v.label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Content */}
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5 }}>
              <CircularProgress size={22} sx={{ color: 'var(--accent,#3b82f6)' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>{t.sched.loading}</Typography>
            </Box>
          ) : calView === 'month' ? (
            <MonthView jobs={jobs} viewYear={viewYear} viewMonth={viewMonth}
              selectedDate={panel?.mode === 'create' || panel?.mode === 'duplicate' ? panel.defaultDate : null}
              onDayClick={handleDayClick} onJobClick={handleJobClick} />
          ) : calView === 'week' ? (
            <WeekView jobs={jobs} weekStart={weekStart}
              selectedDate={panel?.mode === 'create' || panel?.mode === 'duplicate' ? panel.defaultDate : null}
              onDayClick={handleDayClick} onJobClick={handleJobClick} />
          ) : (
            <ListView jobs={jobs} onJobClick={handleJobClick}
              onRequestCancel={requestCancel} onRequestDelete={requestDelete} onDuplicate={handleDuplicate} />
          )}
        </Box>

        {/* Side panel */}
        <SidePanel panel={panel} onDone={handlePanelDone}
          onRequestCancel={requestCancel} onRequestDelete={requestDelete} onDuplicate={handleDuplicate} />
      </Box>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ''}
        body={confirm?.body || ''}
        confirmLabel={confirm?.action === 'cancel' ? t.sched.confirmCancelSend : t.sched.deleteBtn}
        danger
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Box>
  )
}
