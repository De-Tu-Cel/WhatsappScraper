'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { authFetch } from '@/lib/api'
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS_ES   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_ES     = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const DAYS_ES_L   = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
const USER_TZ     = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''

const STATUS_META = {
  pending:   { label: 'Pendiente',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',  icon: <HourglassEmptyIcon sx={{ fontSize: 13 }} /> },
  running:   { label: 'Enviando',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: <CircularProgress size={11} thickness={5} sx={{ color: '#f59e0b' }} /> },
  done:      { label: 'Completado', color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   icon: <CheckCircleIcon sx={{ fontSize: 13 }} /> },
  cancelled: { label: 'Cancelado',  color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: <CancelIcon sx={{ fontSize: 13 }} /> },
  error:     { label: 'Error',      color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   icon: <ErrorIcon sx={{ fontSize: 13 }} /> },
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    color: 'var(--text,#f1f5f9)', bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.85rem',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent,#3b82f6)' },
}

const PICKER_POPPER_SX = {
  '& .MuiPaper-root': { bgcolor: 'var(--card-bg,#1e293b)', color: 'var(--text,#f1f5f9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' },
  '& .MuiPickersDay-root': { color: 'var(--text,#f1f5f9)', '&:hover': { bgcolor: 'rgba(255,255,255,0.07)' }, '&.Mui-selected': { bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#3b82f6)' } } },
  '& .MuiPickersDay-today:not(.Mui-selected)': { border: '1px solid rgba(var(--accent-rgb,59,130,246),0.5)' },
  '& .MuiDayCalendar-weekDayLabel': { color: 'rgba(255,255,255,0.35)' },
  '& .MuiPickersCalendarHeader-label': { color: 'var(--text,#f1f5f9)', fontWeight: 700 },
  '& .MuiPickersArrowSwitcher-button': { color: 'rgba(255,255,255,0.5)', '&:hover': { color: 'var(--text,#f1f5f9)' } },
  '& .MuiMultiSectionDigitalClock-root': { bgcolor: 'var(--card-bg,#1e293b)' },
  '& .MuiMultiSectionDigitalClockSection-item': { color: 'var(--text,#f1f5f9)', '&:hover': { bgcolor: 'rgba(255,255,255,0.07)' }, '&.Mui-selected': { bgcolor: 'var(--accent,#3b82f6)', color: '#fff' } },
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
  return (
    <Dialog open={open} onClose={onCancel} sx={{ '& .MuiDialog-paper': { bgcolor: 'var(--card-bg,#1e293b)', color: 'var(--text,#f1f5f9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2.5, minWidth: 320 } }}>
      <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700, pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.83rem', lineHeight: 1.5 }}>{body}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Button onClick={onCancel} sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.83rem' }}>Cancelar</Button>
        <Button onClick={onConfirm} variant="contained"
          sx={{ bgcolor: danger ? '#ef4444' : 'var(--accent,#3b82f6)', textTransform: 'none', fontSize: '0.83rem', fontWeight: 600, borderRadius: 2, '&:hover': { bgcolor: danger ? '#dc2626' : 'rgba(var(--accent-rgb,59,130,246),0.85)' } }}>
          {confirmLabel || 'Confirmar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 1.5, bgcolor: meta.bg, border: `1px solid ${meta.color}44`, color: meta.color, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {meta.icon}{meta.label}
    </Box>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function SendProgress({ sent, total }) {
  if (!total) return null
  const pct = Math.min(100, Math.round((sent / total) * 100))
  return (
    <Box sx={{ mt: 0.8 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.68rem' }}>{sent}/{total} enviados</Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.68rem' }}>{pct}%</Typography>
      </Box>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.07)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent,#3b82f6)', borderRadius: 2 } }} />
    </Box>
  )
}

// ─── Company picker ───────────────────────────────────────────────────────────

function CompanyPicker({ selectedNums, numInfoMap, onChange }) {
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
    c.numbers.forEach(n => { if (allSel) { ns.delete(n.number); nm.delete(n.number) } else { ns.add(n.number); nm.set(n.number, { number: n.number, company_id: c._id, company_name: c.name, label: n.label }) } })
    onChange(ns, nm)
  }
  function toggleAll() {
    const allNums = filtered.flatMap(c => c.numbers.map(n => ({ number: n.number, company_id: c._id, company_name: c.name, label: n.label })))
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
    bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.18)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${active ? 'rgba(var(--accent-rgb,59,130,246),0.45)' : 'rgba(255,255,255,0.1)'}`,
    color: active ? 'var(--accent,#3b82f6)' : 'rgba(255,255,255,0.5)', cursor: 'pointer',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' }, transition: 'background-color 0.15s, border-color 0.15s',
  })

  return (
    <Box sx={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1, bgcolor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <BusinessIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.3)' }} />
        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontWeight: 700, fontSize: '0.75rem', flex: 1 }}>Destinatarios</Typography>
        {loadingCo && <CircularProgress size={11} sx={{ color: 'var(--accent,#3b82f6)' }} />}
      </Box>

      <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.08)', px: 1, py: 0.4, mb: 1 }}>
          <SearchIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }} />
          <Box component="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empresa..." sx={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text,#f1f5f9)', fontSize: '0.78rem', '&::placeholder': { color: 'rgba(255,255,255,0.2)' } }} />
          {search && <IconButton size="small" onClick={() => setSearch('')} sx={{ p: 0.2, color: 'rgba(255,255,255,0.3)' }}><CloseIcon sx={{ fontSize: 12 }} /></IconButton>}
        </Box>
        {industries.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            <Chip label="Todas" size="small" onClick={() => setIndustryFilter('')} sx={chipSx(!industryFilter)} />
            {(showAllIndustries ? industries : industries.slice(0, MAX_IND)).map(ind => (
              <Chip key={ind} label={ind} size="small" onClick={() => setIndustryFilter(f => f === ind ? '' : ind)} sx={chipSx(industryFilter === ind)} />
            ))}
            {industries.length > MAX_IND && (
              <Typography onClick={() => setShowAllIndustries(v => !v)} sx={{ color: 'var(--accent,#3b82f6)', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', px: 0.5, '&:hover': { opacity: 0.8 } }}>
                {showAllIndustries ? 'Ver menos' : `+${industries.length - MAX_IND} más`}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {filtered.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, borderBottom: '1px solid rgba(255,255,255,0.04)', bgcolor: 'rgba(255,255,255,0.01)' }}>
          <Checkbox size="small" checked={allSel} indeterminate={someSel} onChange={toggleAll} sx={{ p: 0.3, color: 'rgba(255,255,255,0.15)', '&.Mui-checked,&.MuiCheckbox-indeterminate': { color: 'var(--accent,#3b82f6)' } }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }}>Seleccionar todo ({allFilteredNums.length})</Typography>
        </Box>
      )}

      <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
        {loadingCo ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={20} sx={{ color: 'var(--accent,#3b82f6)' }} /></Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}><Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>Sin resultados</Typography></Box>
        ) : filtered.map(company => {
          const sc = company.numbers.filter(n => selectedNums.has(n.number)).length
          return (
            <Box key={company._id} sx={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.7, '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                <Checkbox size="small" checked={sc === company.numbers.length && company.numbers.length > 0} indeterminate={sc > 0 && sc < company.numbers.length} onChange={() => toggleCompany(company)} sx={{ p: 0.3, color: 'rgba(255,255,255,0.15)', '&.Mui-checked,&.MuiCheckbox-indeterminate': { color: 'var(--accent,#3b82f6)' } }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.2 }}>{company.name}</Typography>
                  {company.domain && <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.65rem' }}>{company.domain}</Typography>}
                </Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', flexShrink: 0 }}>{sc}/{company.numbers.length}</Typography>
              </Box>
              {company.numbers.map(n => {
                const isSel = selectedNums.has(n.number)
                return (
                  <Box key={n.number} onClick={() => toggle(n.number, { number: n.number, company_id: company._id, company_name: company.name, label: n.label })}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 3.5, pr: 1.5, py: 0.4, cursor: 'pointer', bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.04)' : 'transparent', '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                    <Checkbox size="small" checked={isSel} onChange={() => {}} sx={{ p: 0.25, color: 'rgba(255,255,255,0.12)', '&.Mui-checked': { color: 'var(--accent,#3b82f6)' } }} />
                    <WhatsAppIcon sx={{ fontSize: 11, color: isSel ? '#25d366' : 'rgba(255,255,255,0.18)', flexShrink: 0 }} />
                    <Typography sx={{ color: isSel ? 'var(--text,#f1f5f9)' : 'rgba(255,255,255,0.5)', fontSize: '0.74rem', fontFamily: 'monospace', flex: 1 }}>{fmtNumber(n.number)}</Typography>
                    {n.label && <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.65rem' }}>{n.label}</Typography>}
                    {n.active && (
                      <Tooltip title="Ya en campaña activa">
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
          ? <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.72rem' }}>Ningún número seleccionado</Typography>
          : <>
              <Typography sx={{ color: 'var(--accent,#3b82f6)', fontSize: '0.72rem', fontWeight: 600 }}>{selCount} número{selCount !== 1 ? 's' : ''}</Typography>
              {activeSelCount > 0 && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}><WarningAmberIcon sx={{ fontSize: 12, color: '#f59e0b' }} /><Typography sx={{ color: '#f59e0b', fontSize: '0.68rem' }}>{activeSelCount} ya en campaña</Typography></Box>}
            </>
        }
      </Box>
    </Box>
  )
}

// ─── Campaign form (create / edit / duplicate) ────────────────────────────────

function CampaignForm({ editJob, defaultDate, duplicateFrom, onDone }) {
  const isEdit = !!editJob
  const src    = duplicateFrom || editJob  // source for pre-filling

  const _initDt = isEdit ? (editJob.scheduled_at || defaultDate || '') : (defaultDate || '')

  const [name,      setName]    = useState(editJob?.name || (duplicateFrom ? `${duplicateFrom.name} (copia)` : ''))
  const [message,   setMessage] = useState(src?.message || '')
  const [dateVal,   setDateVal] = useState(() => _initDt ? dayjs(_initDt) : dayjs().add(1, 'hour').startOf('hour'))
  const [timeVal,   setTimeVal] = useState(() => _initDt ? dayjs(_initDt) : dayjs().add(1, 'hour').startOf('hour'))
  const [selectedNums, setSelectedNums] = useState(() => new Set((src?.selected_numbers || []).map(n => n.number)))
  const [numInfoMap,   setNumInfoMap]   = useState(() => new Map((src?.selected_numbers || []).map(n => [n.number, n])))
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    if (!isEdit && defaultDate) {
      const d = dayjs(defaultDate)
      setDateVal(d); setTimeVal(d)
    }
  }, [defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e) {
    e.preventDefault(); setError('')
    if (!name.trim() || !message.trim() || !dateVal || !timeVal) { setError('Completa todos los campos requeridos'); return }
    if (selectedNums.size === 0) { setError('Selecciona al menos un número'); return }
    setSubmitting(true)
    try {
      const combined = dateVal.hour(timeVal.hour()).minute(timeVal.minute()).second(0)
      const body = {
        name: name.trim(), message: message.trim(),
        scheduled_at: combined.format('YYYY-MM-DDTHH:mm:ss'),
        selected_numbers: [...selectedNums].map(n => numInfoMap.get(n)).filter(Boolean),
      }
      const res = await authFetch(
        isEdit ? `/api/admin/scheduled-sends/${editJob._id}` : '/api/admin/scheduled-sends',
        { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isEdit ? body : { ...body, company_ids: [] }) }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Error al guardar')
      onDone(data, isEdit)
    } catch (err) { setError(err.message) }
    finally { setSubmitting(false) }
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
    <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, p: 2.5 }}>
      <TextField label="Identificador del envío *" value={name} onChange={e => setName(e.target.value)} size="small" fullWidth sx={FIELD_SX} />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        <DatePicker label="Fecha *" value={dateVal} onChange={v => setDateVal(v)} disablePast
          slotProps={{ textField: { size: 'small', fullWidth: true, sx: FIELD_SX }, popper: { sx: PICKER_POPPER_SX } }} />
        <TimePicker label="Hora *" value={timeVal} onChange={v => setTimeVal(v)} ampm
          slotProps={{ textField: { size: 'small', fullWidth: true, sx: FIELD_SX }, popper: { sx: PICKER_POPPER_SX } }} />
      </Box>
      {USER_TZ && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: -0.8 }}>
          <AccessTimeIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.68rem' }}>Zona horaria: {USER_TZ}</Typography>
        </Box>
      )}
      <TextField label="Mensaje" value={message} onChange={e => setMessage(e.target.value)} multiline rows={3} fullWidth size="small" sx={FIELD_SX} />
      <CompanyPicker selectedNums={selectedNums} numInfoMap={numInfoMap} onChange={(ns, nm) => { setSelectedNums(ns); setNumInfoMap(nm) }} />
      {error && <Box sx={{ px: 1.5, py: 0.8, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}><Typography sx={{ color: '#ef4444', fontSize: '0.78rem' }}>{error}</Typography></Box>}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button type="submit" variant="contained" disabled={submitting}
          startIcon={submitting ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <SendIcon />}
          sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' }, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)' }, textTransform: 'none', fontWeight: 600, fontSize: '0.82rem', borderRadius: 2, px: 2 }}>
          {submitting ? 'Guardando...' : (isEdit ? 'Guardar' : (duplicateFrom ? 'Crear copia' : 'Programar'))}
        </Button>
        <Button variant="text" onClick={() => onDone(null, false)} sx={{ color: 'rgba(255,255,255,0.3)', textTransform: 'none', fontSize: '0.8rem' }}>Cancelar</Button>
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
      border: isSelected ? '1px solid rgba(var(--accent-rgb,59,130,246),0.6)' : '1px solid rgba(255,255,255,0.05)',
      bgcolor: isSelected ? 'rgba(var(--accent-rgb,59,130,246),0.1)' : isToday ? 'rgba(var(--accent-rgb,59,130,246),0.05)' : 'transparent',
      p: 0.5, cursor: isPast ? 'not-allowed' : 'pointer',
      opacity: isPast ? 0.35 : (inCurrentMonth ? 1 : 0.3),
      '&:hover': isPast ? {} : { bgcolor: isSelected ? 'rgba(var(--accent-rgb,59,130,246),0.14)' : isToday ? 'rgba(var(--accent-rgb,59,130,246),0.09)' : 'rgba(255,255,255,0.03)' },
      transition: 'background-color 0.12s, border-color 0.12s',
    }}>
      <Box sx={{ width: 22, height: 22, borderRadius: '50%', mb: 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: isToday ? 'var(--accent,#3b82f6)' : 'transparent' }}>
        <Typography sx={{ color: isToday ? '#fff' : 'rgba(255,255,255,0.55)', fontSize: '0.72rem', fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>{date.getDate()}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
        {dayJobs.slice(0, 3).map(j => <CampaignPill key={j._id} job={j} onClick={onJobClick} />)}
        {dayJobs.length > 3 && <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', pl: 0.5 }}>+{dayJobs.length - 3} más</Typography>}
      </Box>
    </Box>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({ jobs, viewYear, viewMonth, selectedDate, onDayClick, onJobClick }) {
  const today  = new Date()
  const days   = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth])
  const selDay = selectedDate ? new Date(selectedDate) : null
  const monthJobsCount = useMemo(() => jobs.filter(j => {
    try { const d = new Date(j.scheduled_at); return d.getFullYear() === viewYear && d.getMonth() === viewMonth } catch { return false }
  }).length, [jobs, viewYear, viewMonth])

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {DAYS_ES.map(d => (
          <Typography key={d} sx={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', fontWeight: 700, py: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</Typography>
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
          <ScheduleSendIcon sx={{ fontSize: 32, color: 'rgba(255,255,255,0.06)' }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.12)', fontSize: '0.82rem' }}>Sin envíos este mes</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.08)', fontSize: '0.72rem' }}>Da clic en cualquier día para programar uno</Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Week view ────────────────────────────────────────────────────────────────

function WeekView({ jobs, weekStart, selectedDate, onDayClick, onJobClick }) {
  const today  = new Date()
  const selDay = selectedDate ? new Date(selectedDate) : null
  const days   = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  }), [weekStart])

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Day headers */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {days.map((d, i) => {
          const isTod = isSameDay(d, today)
          return (
            <Box key={i} sx={{ textAlign: 'center', py: 1, borderRight: i < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{DAYS_ES_L[i]}</Typography>
              <Box sx={{ width: 30, height: 30, borderRadius: '50%', mx: 'auto', mt: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: isTod ? 'var(--accent,#3b82f6)' : 'transparent' }}>
                <Typography sx={{ color: isTod ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: '0.88rem', fontWeight: 700 }}>{d.getDate()}</Typography>
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
              borderRight: i < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              minHeight: 160, p: 0.75, cursor: isPast ? 'not-allowed' : 'pointer',
              opacity: isPast ? 0.35 : 1,
              bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent',
              border: isSel ? '1px solid rgba(var(--accent-rgb,59,130,246),0.4)' : '1px solid transparent',
              '&:hover': isPast ? {} : { bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.12)' : 'rgba(255,255,255,0.025)' },
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
  const [statusFilter, setStatusFilter] = useState('all')
  const filtered = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter)

  const filterChipSx = active => ({
    fontSize: '0.68rem', height: 22,
    bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.18)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${active ? 'rgba(var(--accent-rgb,59,130,246),0.4)' : 'rgba(255,255,255,0.08)'}`,
    color: active ? 'var(--accent,#3b82f6)' : 'rgba(255,255,255,0.45)', cursor: 'pointer',
    '&:hover': { bgcolor: 'rgba(255,255,255,0.07)' },
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Status filter */}
      <Box sx={{ display: 'flex', gap: 0.5, px: 2, py: 1, borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', flexShrink: 0 }}>
        <Chip label="Todos" size="small" onClick={() => setStatusFilter('all')} sx={filterChipSx(statusFilter === 'all')} />
        {Object.entries(STATUS_META).map(([k, v]) => (
          <Chip key={k} label={v.label} size="small" onClick={() => setStatusFilter(s => s === k ? 'all' : k)} sx={filterChipSx(statusFilter === k)} />
        ))}
      </Box>

      {filtered.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 1.5 }}>
          <ScheduleSendIcon sx={{ fontSize: 36, color: 'rgba(255,255,255,0.1)' }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.85rem' }}>
            {statusFilter === 'all' ? 'No hay campañas programadas' : `Sin campañas con estado "${STATUS_META[statusFilter]?.label}"`}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ overflowY: 'auto', flex: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px 120px 90px', gap: 1.5, px: 2, py: 0.8, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {['Fecha', 'Campaña', 'Estado', 'Progreso', ''].map((h, i) => (
              <Typography key={i} sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</Typography>
            ))}
          </Box>
          {filtered.map(job => {
            const canCancel = job.status === 'pending' || job.status === 'running'
            const canEdit   = job.status === 'pending'
            const canDelete = !canCancel
            return (
              <Box key={job._id} onClick={() => onJobClick(job)} sx={{
                display: 'grid', gridTemplateColumns: '130px 1fr 110px 120px 90px',
                gap: 1.5, alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.025)' }, transition: 'background 0.12s',
              }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>{fmtDate(job.scheduled_at)}</Typography>
                <Box>
                  <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.83rem', fontWeight: 600 }}>{job.name}</Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.28)', fontSize: '0.68rem' }}>
                    {job.selected_numbers?.length ? `${job.selected_numbers.length} números` : 'Sin asignar'}
                  </Typography>
                </Box>
                <StatusChip status={job.status} />
                <Box onClick={e => e.stopPropagation()}><SendProgress sent={job.sent_count||0} total={job.total_count||0} /></Box>
                <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', gap: 0.2 }}>
                  <Tooltip title="Duplicar"><IconButton size="small" onClick={() => onDuplicate(job)} sx={{ color: 'rgba(255,255,255,0.25)', '&:hover': { color: '#a78bfa' } }}><ContentCopyIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                  {canEdit   && <Tooltip title="Editar"><IconButton size="small" onClick={() => onJobClick(job)} sx={{ color: 'rgba(255,255,255,0.28)', '&:hover': { color: 'var(--accent,#3b82f6)' } }}><EditIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
                  {canCancel && <Tooltip title="Cancelar"><IconButton size="small" onClick={() => onRequestCancel(job)} sx={{ color: 'rgba(239,68,68,0.45)', '&:hover': { color: '#ef4444' } }}><CancelIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title="Eliminar"><IconButton size="small" onClick={() => onRequestDelete(job)} sx={{ color: 'rgba(255,255,255,0.18)', '&:hover': { color: '#ef4444' } }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>}
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
  const isOpen = !!panel
  const isEdit = panel?.mode === 'edit'

  return (
    <Box sx={{ width: isOpen ? 390 : 0, flexShrink: 0, overflow: 'hidden', transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)', borderLeft: isOpen ? '1px solid rgba(255,255,255,0.08)' : 'none', display: 'flex', flexDirection: 'column' }}>
      {isOpen && (
        <Box sx={{ width: 390, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.8, borderBottom: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: 1.5, flexShrink: 0, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {panel.mode === 'duplicate' ? <ContentCopyIcon sx={{ fontSize: 14, color: '#a78bfa' }} /> : isEdit ? <EditIcon sx={{ fontSize: 14, color: 'var(--accent,#3b82f6)' }} /> : <ScheduleSendIcon sx={{ fontSize: 15, color: 'var(--accent,#3b82f6)' }} />}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.2 }}>
                {panel.mode === 'duplicate' ? 'Duplicar envío' : isEdit ? 'Editar envío' : 'Programar envío'}
              </Typography>
              {(isEdit || panel.mode === 'duplicate') && (
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{panel.job?.name}</Typography>
              )}
            </Box>
            <IconButton size="small" onClick={() => onDone(null, false)} sx={{ color: 'rgba(255,255,255,0.3)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          {/* Read-only view for non-pending jobs */}
          {isEdit && panel.job?.status !== 'pending' ? (
            <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box><Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', mb: 0.5 }}>Estado</Typography><StatusChip status={panel.job.status} /></Box>
              <Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', mb: 0.5 }}>Programado</Typography>
                <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.83rem' }}>{fmtDate(panel.job.scheduled_at)}</Typography>
              </Box>
              <Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', mb: 0.5 }}>Mensaje</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{panel.job.message}</Typography>
              </Box>
              <Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', mb: 0.3 }}>Números</Typography>
                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>{panel.job.selected_numbers?.length || 0} seleccionados</Typography>
              </Box>
              <SendProgress sent={panel.job.sent_count||0} total={panel.job.total_count||0} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => onDuplicate(panel.job)}
                  sx={{ color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(167,139,250,0.08)' } }}>
                  Duplicar
                </Button>
                {panel.job.status === 'running' && (
                  <Button size="small" startIcon={<CancelIcon />} onClick={() => onRequestCancel(panel.job)}
                    sx={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(245,158,11,0.08)' } }}>
                    Cancelar envío
                  </Button>
                )}
                {(panel.job.status === 'done' || panel.job.status === 'cancelled' || panel.job.status === 'error') && (
                  <Button size="small" startIcon={<DeleteIcon />} onClick={() => onRequestDelete(panel.job)}
                    sx={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', border: '1px solid', textTransform: 'none', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}>
                    Eliminar
                  </Button>
                )}
              </Box>
            </Box>
          ) : (
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
      const sM = MONTHS_ES[weekStart.getMonth()].slice(0, 3)
      const eM = MONTHS_ES[end.getMonth()].slice(0, 3)
      return weekStart.getMonth() === end.getMonth()
        ? `${weekStart.getDate()}–${end.getDate()} ${sM} ${weekStart.getFullYear()}`
        : `${weekStart.getDate()} ${sM} – ${end.getDate()} ${eM} ${end.getFullYear()}`
    }
    return `${MONTHS_ES[viewMonth]} ${viewYear}`
  }, [calView, viewMonth, viewYear, weekStart])

  const hasActive = jobs.some(j => j.status === 'running')
  const VIEWS = [{ key: 'month', icon: <CalendarMonthIcon sx={{ fontSize: 15 }} />, label: 'Mes' }, { key: 'week', icon: <ViewWeekIcon sx={{ fontSize: 15 }} />, label: 'Semana' }, { key: 'list', icon: <ViewListIcon sx={{ fontSize: 15 }} />, label: 'Lista' }]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexShrink: 0 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ScheduleSendIcon sx={{ fontSize: 19, color: 'var(--accent,#3b82f6)' }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }}>Envíos Programados</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>Da clic en un día para programar una campaña</Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasActive && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <CircularProgress size={11} thickness={5} sx={{ color: '#f59e0b' }} />
            <Typography sx={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>En vivo</Typography>
          </Box>}
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setPanel({ mode: 'create', defaultDate: dateToDtLocal(today) })}
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' }, textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', borderRadius: 2, px: 1.8 }}>
            Programar envío
          </Button>
        </Box>
      </Box>

      {/* Main area */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'clip' }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Toolbar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.2, borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
            <IconButton size="small" onClick={navPrev} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}><ChevronLeftIcon sx={{ fontSize: 18 }} /></IconButton>
            <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.95rem', minWidth: 190, textAlign: 'center' }}>{toolbarLabel}</Typography>
            <IconButton size="small" onClick={navNext} sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'var(--text,#f1f5f9)' } }}><ChevronRightIcon sx={{ fontSize: 18 }} /></IconButton>
            <Button size="small" onClick={goToday} sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.72rem', textTransform: 'none', borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.12)', px: 1.2, py: 0.3, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }, ml: 0.5 }}>Hoy</Button>
            <Box sx={{ ml: 'auto', display: 'flex', bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.09)', overflow: 'hidden' }}>
              {VIEWS.map(v => (
                <Box key={v.key} onClick={() => setCalView(v.key)} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 1.2, py: 0.4, cursor: 'pointer', bgcolor: calView === v.key ? 'rgba(255,255,255,0.08)' : 'transparent', color: calView === v.key ? 'var(--text,#f1f5f9)' : 'rgba(255,255,255,0.35)', transition: 'background-color 0.12s' }}>
                  {v.icon}
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: calView === v.key ? 600 : 400 }}>{v.label}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Content */}
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1.5 }}>
              <CircularProgress size={22} sx={{ color: 'var(--accent,#3b82f6)' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>Cargando...</Typography>
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
        confirmLabel={confirm?.action === 'cancel' ? 'Cancelar envío' : 'Eliminar'}
        danger
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Box>
  )
}
