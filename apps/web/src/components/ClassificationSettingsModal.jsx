'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import Slider from '@mui/material/Slider'
import TextField from '@mui/material/TextField'
import Skeleton from '@mui/material/Skeleton'
import CircularProgress from '@mui/material/CircularProgress'
import Autocomplete from '@mui/material/Autocomplete'
import Collapse from '@mui/material/Collapse'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CheckIcon from '@mui/icons-material/Check'
import TuneIcon from '@mui/icons-material/Tune'
import BoltIcon from '@mui/icons-material/Bolt'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import AddIcon from '@mui/icons-material/Add'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'

function sliderSx(color) {
  return {
    color,
    height: 4,
    px: 0.5,
    py: 1.5,
    '& .MuiSlider-thumb': {
      width: 16, height: 16,
      boxShadow: `0 0 0 3px ${color}30`,
      '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 6px ${color}40` },
    },
    '& .MuiSlider-track': { border: 'none', height: 4 },
    '& .MuiSlider-rail': { opacity: 0.35, height: 4, bgcolor: 'var(--border)' },
    '& .MuiSlider-mark': { width: 2, height: 2, borderRadius: '50%', bgcolor: 'var(--border)', transform: 'translate(-50%,-50%)' },
    '& .MuiSlider-markActive': { bgcolor: color, opacity: 0.6 },
    '& .MuiSlider-markLabel': { fontSize: '0.6rem', color: 'var(--text-muted)', pointerEvents: 'none', mt: 0.3 },
    '& .MuiSlider-markLabelActive': { color: 'var(--text-muted)', opacity: 0.85 },
    '& .MuiSlider-valueLabel': { fontSize: '0.65rem', fontWeight: 700, py: 0.3, px: 0.8, bgcolor: color, borderRadius: 1 },
  }
}

const CARD_SX = {
  mb: 2, p: 2, borderRadius: 2,
  bgcolor: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
}

function TimingCard({ icon, color, bg, title, phraseBefore, value, unit, phraseAfter, tooltip, warning,
                      onChange, min, max, step, marks = true }) {
  return (
    <Box sx={{
      ...CARD_SX,
      p: 2.1,
      position: 'relative',
      overflow: 'hidden',
      '&::before': {
        content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        bgcolor: color, opacity: 0.85,
      },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.6 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 1.5, flexShrink: 0, mt: 0.1,
          bgcolor: bg, border: `1px solid ${color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {title && (
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color, mb: 0.45 }}>
              {title}
            </Typography>
          )}
          <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, rgba(255,255,255,0.85))', lineHeight: 1.6 }}>
            {phraseBefore}{' '}
            <Box component="span" sx={{
              display: 'inline-block', px: 1, py: 0.15, mx: 0.2, borderRadius: 1.2,
              bgcolor: bg, border: `1px solid ${color}66`,
              color, fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem',
            }}>
              {value}{unit}
            </Box>{' '}
            {phraseAfter}
            {tooltip && (
              <Tooltip title={tooltip} placement="top" arrow>
                <InfoOutlinedIcon sx={{ fontSize: 13, ml: 0.5, verticalAlign: 'middle', color: 'var(--border)', cursor: 'help', '&:hover': { color } }} />
              </Tooltip>
            )}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ width: '92%', mx: 'auto' }}>
        <Slider value={value} onChange={(_, v) => onChange(v)}
          min={min} max={max} step={step} marks={marks}
          valueLabelDisplay="auto" valueLabelFormat={v => `${v}${unit}`}
          sx={sliderSx(color)} />
      </Box>
      {warning && (
        <Typography sx={{ fontSize: '0.72rem', color: '#f59e0b', mt: 1 }}>
          ⚠️ {warning}
        </Typography>
      )}
    </Box>
  )
}

function TimingCardSkeleton() {
  return (
    <Box sx={CARD_SX}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
        <Skeleton variant="rounded" width={30} height={30} sx={{ borderRadius: 1.5, bgcolor: 'var(--border)', flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <Skeleton variant="text" width="90%" height={20} sx={{ bgcolor: 'var(--border)' }} />
          <Skeleton variant="text" width="60%" height={20} sx={{ bgcolor: 'var(--border)' }} />
        </Box>
      </Box>
      <Box sx={{ width: '90%', mx: 'auto' }}>
        <Skeleton variant="rounded" width="100%" height={4} sx={{ borderRadius: 2, bgcolor: 'var(--border)' }} />
      </Box>
    </Box>
  )
}

function ClassificationSettingsSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map(i => <TimingCardSkeleton key={i} />)}
      <Skeleton variant="text" width={90} height={18} sx={{ bgcolor: 'var(--border)' }} />
    </>
  )
}

const CLASSIFIER_DEFAULTS = {
  t1_threshold_seconds: 10, t2_threshold_seconds: 5,
  probe_wait_hours: 1, no_reply_wait_minutes: 60,
  industry_templates: [],
  llm_instructions: '',
}

const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--text, #f1f5f9)', fontSize: '0.8rem', lineHeight: 1.45 },
  '& .MuiInputLabel-root': { color: 'var(--text-muted, rgba(255,255,255,0.45))' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border, rgba(255,255,255,0.14))' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border, rgba(255,255,255,0.28))' },
}

function foldIndustry(value) {
  return (value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

function fingerprint(v) {
  if (!v) return ''
  return JSON.stringify({
    t1: v.t1_threshold_seconds,
    t2: v.t2_threshold_seconds,
    probe: v.probe_wait_hours,
    wait: v.no_reply_wait_minutes,
    templates: (v.industry_templates || []).map(item => ({
      id: item.id,
      industry: (item.industry || '').trim(),
      text: (item.text || '').trim(),
    })),
  })
}

const MUTED = 'var(--text-muted, rgba(255,255,255,0.5))'
const TEXT = 'var(--text, #f1f5f9)'
const ACCENT_RGB = 'var(--accent-rgb,99,102,241)'

function StepPill({ n, children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flex: 1, minWidth: 150 }}>
      <Box sx={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent, #818cf8)',
        bgcolor: `rgba(${ACCENT_RGB},0.15)`, border: `1px solid rgba(${ACCENT_RGB},0.4)`,
      }}>{n}</Box>
      <Typography sx={{ fontSize: '0.74rem', color: TEXT, lineHeight: 1.3 }}>{children}</Typography>
    </Box>
  )
}

function TemplatesTab({ c, values, selectedId, setSelectedId, showBase, setShowBase,
                        addTemplate, removeTemplate, editTemplate, appendExample }) {
  const templates = values.industry_templates || []
  const options = values.industry_options || []
  const counts = Object.fromEntries(options.map(o => [foldIndustry(o.industry), o.companies]))
  const used = new Set(templates.map(item => foldIndustry(item.industry)))
  const available = options.filter(o => !used.has(foldIndustry(o.industry)))
  const selected = templates.find(item => item.id === selectedId) || templates[0] || null
  const examples = c.examples || []

  return (
    <>
      <Box sx={{ ...CARD_SX, py: 1.5, px: 1.8, mb: 1.6 }}>
        <Typography sx={{ fontSize: '0.8rem', color: TEXT, lineHeight: 1.5, mb: 1.2 }}>
          {c.templatesIntro}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <StepPill n={1}>{c.step1}</StepPill>
          <StepPill n={2}>{c.step2}</StepPill>
          <StepPill n={3}>{c.step3}</StepPill>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '240px 1fr' }, gap: 2, mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Autocomplete
            size="small"
            options={available}
            value={null}
            blurOnSelect
            clearOnBlur
            getOptionLabel={o => o.industry}
            isOptionEqualToValue={(a, b) => a.industry === b.industry}
            onChange={(_, o) => o && addTemplate(o.industry)}
            noOptionsText={c.noMoreIndustries}
            renderOption={(props, o) => {
              const { key, ...rest } = props
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: '0.8rem' }}>
                  <span>{o.industry}</span>
                  <Typography component="span" sx={{ fontSize: '0.7rem', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{o.companies}</Typography>
                </Box>
              )
            }}
            renderInput={params => {
              const inputSlot = params.slotProps?.input || {}
              return (
                <TextField {...params} placeholder={c.addIndustry}
                  slotProps={{
                    ...params.slotProps,
                    input: {
                      ...inputSlot,
                      startAdornment: (
                        <>
                          <AddIcon sx={{ fontSize: 18, color: 'var(--accent, #818cf8)', ml: 0.5 }} />
                          {inputSlot.startAdornment}
                        </>
                      ),
                    },
                  }}
                  sx={fieldSx} />
              )
            }}
            slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg, #161d2e)', color: TEXT, border: '1px solid var(--border, rgba(255,255,255,0.12))' } } }}
            sx={{ mb: 1.2 }}
          />

          {templates.length === 0 && (
            <Typography sx={{ fontSize: '0.74rem', color: MUTED, lineHeight: 1.45, px: 0.5 }}>{c.emptyTemplates}</Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            {templates.map(item => {
              const active = selected?.id === item.id
              const n = counts[foldIndustry(item.industry)]
              const filled = Boolean((item.text || '').trim())
              return (
                <Box key={item.id} component="button" type="button" onClick={() => setSelectedId(item.id)} sx={{
                  all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%',
                  display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.9, borderRadius: 2,
                  bgcolor: active ? `rgba(${ACCENT_RGB},0.16)` : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${active ? `rgba(${ACCENT_RGB},0.5)` : 'var(--border, rgba(255,255,255,0.08))'}`,
                  '&:hover': { borderColor: `rgba(${ACCENT_RGB},0.4)` },
                  '&:focus-visible': { outline: `2px solid rgba(${ACCENT_RGB},0.6)` },
                }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: filled ? '#4ade80' : '#f59e0b' }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.industry}
                    </Typography>
                    <Typography sx={{ fontSize: '0.66rem', color: MUTED }}>
                      {filled ? c.companiesCount.replace('{n}', n ?? 0) : c.templateEmpty}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>

        <Box sx={{ ...CARD_SX, mb: 0, minWidth: 0 }}>
          {!selected ? (
            <Typography sx={{ fontSize: '0.78rem', color: MUTED }}>{c.pickToEdit}</Typography>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: TEXT }}>{selected.industry}</Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: MUTED, lineHeight: 1.45 }}>
                    {c.appliesTo.replace('{n}', counts[foldIndustry(selected.industry)] ?? 0)}
                    {' '}
                    {(selected.match === 'gas' || selected.match === 'auto')
                      ? ((selected.also || []).length
                        ? c.appliesAlso.replace('{list}', selected.also.join(', '))
                        : c.appliesFamily)
                      : c.appliesExact}
                  </Typography>
                </Box>
                <Button size="small" onClick={() => removeTemplate(selected.id)} startIcon={<DeleteOutlineIcon sx={{ fontSize: 16 }} />}
                  sx={{ textTransform: 'none', fontSize: '0.72rem', color: MUTED, '&:hover': { color: '#f87171', bgcolor: 'rgba(248,113,113,0.08)' } }}>
                  {c.removeTemplate}
                </Button>
              </Box>

              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: TEXT, mb: 0.6 }}>{c.whatToKnow}</Typography>
              <TextField value={selected.text || ''} placeholder={c.templatePh}
                onChange={e => editTemplate(selected.id, { text: e.target.value.slice(0, 800) })}
                multiline minRows={4} fullWidth sx={fieldSx}
                helperText={`${(selected.text || '').length}/800`}
                slotProps={{ formHelperText: { sx: { textAlign: 'right', mx: 0, color: MUTED } } }} />

              {examples.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: MUTED, mb: 0.6 }}>{c.examplesTitle}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                    {examples.map(sentence => (
                      <Box key={sentence} component="button" type="button" onClick={() => appendExample(selected.id, sentence)} sx={{
                        all: 'unset', cursor: 'pointer', fontSize: '0.68rem', lineHeight: 1.3, color: TEXT,
                        px: 1, py: 0.45, borderRadius: 99, border: '1px dashed var(--border, rgba(255,255,255,0.2))',
                        '&:hover': { borderColor: 'var(--accent, #818cf8)', color: 'var(--accent, #818cf8)' },
                      }}>+ {sentence}</Box>
                    ))}
                  </Box>
                </Box>
              )}

              <Box sx={{ mt: 1.6, p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(0,0,0,0.2)', border: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
                <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, mb: 0.5 }}>
                  {c.previewTitle}
                </Typography>
                <Typography sx={{ fontSize: '0.74rem', color: TEXT, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {(selected.text || '').trim()
                    ? `NOTA DEL EQUIPO PARA ESTE GIRO (aplícala junto con las reglas de abajo; no puede contradecir una regla fija):\n${selected.text.trim()}`
                    : c.previewEmpty}
                </Typography>
              </Box>
            </>
          )}
        </Box>
      </Box>

      <Box sx={{ ...CARD_SX, mb: 1 }}>
        <Box component="button" type="button" onClick={() => setShowBase(s => !s)} sx={{
          all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, width: '100%',
        }}>
          <SmartToyIcon sx={{ fontSize: 18, color: 'var(--accent, #818cf8)' }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: TEXT }}>{c.instructionsTitle}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: MUTED, lineHeight: 1.4 }}>{c.instructionsHelp}</Typography>
          </Box>
          <ExpandMoreIcon sx={{ color: MUTED, transition: 'transform 0.2s', transform: showBase ? 'rotate(180deg)' : 'none' }} />
        </Box>
        <Collapse in={showBase} unmountOnExit>
          <Box sx={{
            mt: 1.4, maxHeight: 300, overflow: 'auto', p: 1.4, borderRadius: 1.5,
            bgcolor: 'rgba(0,0,0,0.22)', border: '1px solid var(--border, rgba(255,255,255,0.08))',
            fontSize: '0.74rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', color: TEXT,
          }}>
            {values.llm_instructions || '—'}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: MUTED, mt: 0.8 }}>{c.instructionsEnd}</Typography>
        </Collapse>
      </Box>

      {values.notes_updated_by && (
        <Typography sx={{ fontSize: '0.68rem', color: MUTED }}>
          {c.notesBy}: {values.notes_updated_by}
        </Typography>
      )}
    </>
  )
}

export default function ClassificationSettingsModal({ open, onClose }) {
  const { t } = useLang()
  const c = t.classification
  const [values, setValues] = useState(null)
  const [baseline, setBaseline] = useState('')
  const [tab, setTab] = useState(0)
  const [saveState, setSaveState] = useState('idle')
  const [errorText, setErrorText] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [showBase, setShowBase] = useState(false)
  const savedTimer = useRef(null)

  useEffect(() => {
    if (!open) return
    setTab(0)
    setSaveState('idle')
    setErrorText('')
    setShowBase(false)
    authFetch('/api/admin/classifier-settings')
      .then(r => r.json())
      .then(data => {
        const next = { ...CLASSIFIER_DEFAULTS, ...data, industry_templates: data.industry_templates || [] }
        setValues(next)
        setBaseline(fingerprint(next))
        setSelectedId(next.industry_templates[0]?.id || null)
      })
      .catch(() => {
        setValues(CLASSIFIER_DEFAULTS)
        setBaseline(fingerprint(CLASSIFIER_DEFAULTS))
      })
  }, [open])

  const dirty = Boolean(values) && fingerprint(values) !== baseline
  const t2Warning = values && values.t2_threshold_seconds > values.t1_threshold_seconds

  function edit(patch) {
    setValues(v => ({ ...v, ...patch }))
    setSaveState('idle')
    setErrorText('')
  }

  function editTemplate(id, patch) {
    edit({
      industry_templates: (values.industry_templates || []).map(item => item.id === id ? { ...item, ...patch } : item),
    })
  }

  function addTemplate(industry) {
    if (!industry) return
    const folded = foldIndustry(industry)
    const existing = (values.industry_templates || []).find(item => foldIndustry(item.industry) === folded)
    if (existing) {
      setSelectedId(existing.id)
      return
    }
    const id = `new-${Date.now()}`
    edit({
      industry_templates: [
        ...(values.industry_templates || []),
        { id, industry, match: '', text: '' },
      ],
    })
    setSelectedId(id)
  }

  function removeTemplate(id) {
    const rest = (values.industry_templates || []).filter(item => item.id !== id)
    edit({ industry_templates: rest })
    setSelectedId(rest[0]?.id || null)
  }

  function appendExample(id, sentence) {
    const item = (values.industry_templates || []).find(x => x.id === id)
    if (!item) return
    const current = (item.text || '').trim()
    if (current.includes(sentence)) return
    editTemplate(id, { text: (current ? `${current} ${sentence}` : sentence).slice(0, 800) })
  }

  async function save() {
    const names = (values.industry_templates || []).map(item => foldIndustry(item.industry)).filter(Boolean)
    if (new Set(names).size !== names.length) {
      setSaveState('error')
      setErrorText(c.duplicateIndustry)
      setTab(1)
      return
    }
    setSaveState('saving')
    setErrorText('')
    try {
      const res = await authFetch('/api/admin/classifier-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          t1_threshold_seconds: values.t1_threshold_seconds,
          t2_threshold_seconds: values.t2_threshold_seconds,
          probe_wait_hours: values.probe_wait_hours,
          no_reply_wait_minutes: values.no_reply_wait_minutes,
          industry_templates: (values.industry_templates || []).map(item => ({
            id: item.id, industry: item.industry, text: item.text,
          })),
        }),
      })
      const saved = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(saved.detail || c.saveError)
      const next = { ...values, ...saved, industry_templates: saved.industry_templates || [] }
      setValues(next)
      setBaseline(fingerprint(next))
      setSaveState('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600)
    } catch (err) {
      setSaveState('error')
      setErrorText(err.message || c.saveError)
    }
  }

  function requestClose() {
    if (dirty && !window.confirm(c.discardConfirm)) return
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      maxWidth="md"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          backgroundColor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(var(--accent-rgb,99,102,241),0.1) 0%, transparent 50%)',
          border: '1px solid rgba(var(--accent-rgb,99,102,241),0.2)',
          borderRadius: 3,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
        '& .MuiBackdrop-root': {
          backdropFilter: 'blur(4px)',
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: 2, flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.15)',
            border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TuneIcon sx={{ color: 'var(--accent,#818cf8)', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
              {c.title}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
              {c.subtitle}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: '4px !important' }}>
        {!values ? (
          <ClassificationSettingsSkeleton />
        ) : (
          <>
            <Box sx={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.6, mb: 1.2, p: 0.45,
              borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              {[
                { label: c.tabTiming, icon: AccessTimeIcon },
                { label: c.tabTemplates, icon: SmartToyIcon },
              ].map((item, i) => {
                const Icon = item.icon
                const active = tab === i
                return (
                  <Button key={item.label} onClick={() => setTab(i)} startIcon={<Icon sx={{ fontSize: 18 }} />} sx={{
                    textTransform: 'none', fontWeight: 800, fontSize: '0.8rem', borderRadius: 2, py: 0.7,
                    color: active ? 'var(--text, #f1f5f9)' : 'var(--text-muted, rgba(255,255,255,0.45))',
                    bgcolor: active ? `rgba(${ACCENT_RGB},0.22)` : 'transparent',
                    border: `1px solid ${active ? `rgba(${ACCENT_RGB},0.5)` : 'transparent'}`,
                    boxShadow: active ? `0 0 0 1px rgba(${ACCENT_RGB},0.12)` : 'none',
                    '&:hover': { bgcolor: active ? `rgba(${ACCENT_RGB},0.28)` : 'rgba(255,255,255,0.04)' },
                  }}>{item.label}</Button>
                )
              })}
            </Box>
            <Typography sx={{ fontSize: '0.72rem', color: MUTED, lineHeight: 1.45, mb: 2 }}>
              {tab === 0 ? c.tabTimingHelp : c.tabTemplatesHelp}
            </Typography>

            {tab === 0 && (
              <>
                <TimingCard
                  icon={<BoltIcon sx={{ fontSize: 17, color: '#facc15' }} />}
                  color="#facc15" bg="rgba(250,204,21,0.12)" title={c.labelT1}
                  phraseBefore={c.phraseT1Before} value={values.t1_threshold_seconds} unit={c.seconds} phraseAfter={c.phraseT1After}
                  tooltip={c.tipT1}
                  onChange={v => edit({ t1_threshold_seconds: v })}
                  min={3} max={60} step={1}
                  marks={[3, 10, 20, 30, 45, 60].map(v => ({ value: v, label: `${v}s` }))}
                />
                <TimingCard
                  icon={<SmartToyIcon sx={{ fontSize: 17, color: '#a78bfa' }} />}
                  color="#a78bfa" bg="rgba(167,139,250,0.12)" title={c.labelT2}
                  phraseBefore={c.phraseT2Before} value={values.t2_threshold_seconds} unit={c.seconds} phraseAfter={c.phraseT2After}
                  tooltip={c.tipT2}
                  warning={t2Warning ? c.warnT2GtT1 : null}
                  onChange={v => edit({ t2_threshold_seconds: v })}
                  min={3} max={30} step={1}
                  marks={[3, 5, 10, 15, 20, 30].map(v => ({ value: v, label: `${v}s` }))}
                />
                <TimingCard
                  icon={<AccessTimeIcon sx={{ fontSize: 17, color: '#94a3b8' }} />}
                  color="#94a3b8" bg="rgba(148,163,184,0.12)" title={c.labelNoReply}
                  phraseBefore={c.phraseNoReplyBefore} value={values.no_reply_wait_minutes} unit={c.minutes} phraseAfter={c.phraseNoReplyAfter}
                  tooltip={c.tipNoReply}
                  onChange={v => edit({ no_reply_wait_minutes: v })}
                  min={15} max={1440} step={15}
                  marks={[60, 180, 360, 720, 1440].map(v => ({ value: v, label: `${v / 60}h` }))}
                />
                <TimingCard
                  icon={<MailOutlineIcon sx={{ fontSize: 17, color: '#818cf8' }} />}
                  color="#818cf8" bg="rgba(129,140,248,0.12)" title={c.labelProbe}
                  phraseBefore={c.phraseProbeBefore} value={values.probe_wait_hours} unit={c.hours} phraseAfter={c.phraseProbeAfter}
                  tooltip={c.tipProbe}
                  onChange={v => edit({ probe_wait_hours: v })}
                  min={0.5} max={24} step={0.5}
                  marks={[1, 4, 8, 12, 24].map(v => ({ value: v, label: `${v}h` }))}
                />
              </>
            )}

            {tab === 1 && (
              <TemplatesTab
                c={c}
                values={values}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                showBase={showBase}
                setShowBase={setShowBase}
                addTemplate={addTemplate}
                removeTemplate={removeTemplate}
                editTemplate={editTemplate}
                appendExample={appendExample}
              />
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.8, minWidth: 0 }}>
          {dirty && saveState === 'idle' && (
            <Typography sx={{ fontSize: '0.72rem', color: '#fbbf24' }}>{c.unsaved}</Typography>
          )}
          {saveState === 'saving' && <>
            <CircularProgress size={14} sx={{ color: 'var(--text-muted)' }} />
            <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.saving}</Typography>
          </>}
          {saveState === 'saved' && <>
            <CheckIcon sx={{ fontSize: 16, color: '#4ade80' }} />
            <Typography sx={{ fontSize: '0.72rem', color: '#4ade80' }}>{c.saved}</Typography>
          </>}
          {saveState === 'error' && (
            <Typography sx={{ fontSize: '0.72rem', color: '#f87171' }}>{errorText || c.saveError}</Typography>
          )}
        </Box>
        <Button onClick={requestClose} sx={{ color: 'rgba(255,255,255,0.5)', textTransform: 'none' }}>
          {t.common.close || 'Cerrar'}
        </Button>
        <Button onClick={save} disabled={!values || !dirty || saveState === 'saving'} variant="contained"
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, boxShadow: 'none',
            bgcolor: 'var(--accent, #6366f1)', '&:hover': { bgcolor: 'var(--accent, #6366f1)', filter: 'brightness(1.08)' } }}>
          {c.saveBtn}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
