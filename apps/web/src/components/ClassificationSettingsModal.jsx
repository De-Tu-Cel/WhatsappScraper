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
import Skeleton from '@mui/material/Skeleton'
import CircularProgress from '@mui/material/CircularProgress'
import CheckIcon from '@mui/icons-material/Check'
import TuneIcon from '@mui/icons-material/Tune'
import BoltIcon from '@mui/icons-material/Bolt'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
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

function TimingCard({ icon, color, bg, phraseBefore, value, unit, phraseAfter, tooltip, warning,
                      onChange, min, max, step, marks = true }) {
  return (
    <Box sx={CARD_SX}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
        <Box sx={{
          width: 30, height: 30, borderRadius: 1.5, flexShrink: 0, mt: 0.1,
          bgcolor: bg, border: `1px solid ${color}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </Box>
        <Typography sx={{ fontSize: '0.8rem', color: 'var(--text, rgba(255,255,255,0.85))', lineHeight: 1.6, flex: 1 }}>
          {phraseBefore}{' '}
          <Box component="span" sx={{
            display: 'inline-block', px: 0.8, py: 0.1, mx: 0.2, borderRadius: 1,
            bgcolor: bg, border: `1px solid ${color}55`,
            color, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem',
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
      <Box sx={{ width: '90%', mx: 'auto' }}>
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
}

export default function ClassificationSettingsModal({ open, onClose }) {
  const { t } = useLang()
  const c = t.classification
  const [values, setValues] = useState(null) // null mientras carga
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const saveTimer = useRef(null)

  useEffect(() => {
    if (!open) return
    authFetch('/api/admin/classifier-settings')
      .then(r => r.json())
      .then(setValues)
      .catch(() => setValues(CLASSIFIER_DEFAULTS))
  }, [open])

  function update(key, val) {
    const next = { ...values, [key]: val }
    setValues(next)
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await authFetch('/api/admin/classifier-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
        if (!res.ok) throw new Error()
        const saved = await res.json()
        setValues(saved) // refleja el clamp del servidor si el usuario llegó a un límite
        setSaveState('saved')
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1500)
      } catch {
        setSaveState('error')
      }
    }, 600)
  }

  const t2Warning = values && values.t2_threshold_seconds > values.t1_threshold_seconds

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
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

      <DialogContent sx={{ pt: '8px !important' }}>
        {!values ? (
          <ClassificationSettingsSkeleton />
        ) : (
          <>
            <TimingCard
              icon={<BoltIcon sx={{ fontSize: 16, color: '#facc15' }} />}
              color="#facc15" bg="rgba(250,204,21,0.12)"
              phraseBefore={c.phraseT1Before} value={values.t1_threshold_seconds} unit={c.seconds} phraseAfter={c.phraseT1After}
              tooltip={c.tipT1}
              onChange={v => update('t1_threshold_seconds', v)}
              min={3} max={60} step={1}
              marks={[3, 10, 20, 30, 45, 60].map(v => ({ value: v, label: `${v}s` }))}
            />

            <TimingCard
              icon={<SmartToyIcon sx={{ fontSize: 16, color: '#a78bfa' }} />}
              color="#a78bfa" bg="rgba(167,139,250,0.12)"
              phraseBefore={c.phraseT2Before} value={values.t2_threshold_seconds} unit={c.seconds} phraseAfter={c.phraseT2After}
              tooltip={c.tipT2}
              warning={t2Warning ? c.warnT2GtT1 : null}
              onChange={v => update('t2_threshold_seconds', v)}
              min={3} max={30} step={1}
              marks={[3, 5, 10, 15, 20, 30].map(v => ({ value: v, label: `${v}s` }))}
            />

            <TimingCard
              icon={<AccessTimeIcon sx={{ fontSize: 16, color: '#94a3b8' }} />}
              color="#94a3b8" bg="rgba(148,163,184,0.12)"
              phraseBefore={c.phraseNoReplyBefore} value={values.no_reply_wait_minutes} unit={c.minutes} phraseAfter={c.phraseNoReplyAfter}
              tooltip={c.tipNoReply}
              onChange={v => update('no_reply_wait_minutes', v)}
              min={15} max={1440} step={15}
              marks={[60, 180, 360, 720, 1440].map(v => ({ value: v, label: `${v / 60}h` }))}
            />

            <TimingCard
              icon={<MailOutlineIcon sx={{ fontSize: 16, color: '#818cf8' }} />}
              color="#818cf8" bg="rgba(129,140,248,0.12)"
              phraseBefore={c.phraseProbeBefore} value={values.probe_wait_hours} unit={c.hours} phraseAfter={c.phraseProbeAfter}
              tooltip={c.tipProbe}
              onChange={v => update('probe_wait_hours', v)}
              min={0.5} max={24} step={0.5}
              marks={[1, 4, 8, 12, 24].map(v => ({ value: v, label: `${v}h` }))}
            />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 18 }}>
              {saveState === 'saving' && <>
                <CircularProgress size={12} sx={{ color: 'rgba(255,255,255,0.3)' }} />
                <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' }}>{c.saving}</Typography>
              </>}
              {saveState === 'saved' && <>
                <CheckIcon sx={{ fontSize: 14, color: '#4ade80' }} />
                <Typography sx={{ fontSize: '0.7rem', color: '#4ade80' }}>{c.saved}</Typography>
              </>}
              {saveState === 'error' && (
                <Typography sx={{ fontSize: '0.7rem', color: '#f87171' }}>{c.saveError}</Typography>
              )}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <Button onClick={onClose} sx={{ color: 'rgba(255,255,255,0.5)', textTransform: 'none' }}>
          {t.common.close || 'Cerrar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
