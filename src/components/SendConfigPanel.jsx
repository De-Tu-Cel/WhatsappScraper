'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Slider from '@mui/material/Slider'
import Collapse from '@mui/material/Collapse'
import LinearProgress from '@mui/material/LinearProgress'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TimerIcon from '@mui/icons-material/Timer'
import { saveSendConfig } from '@/lib/sendConfig'
import { useLang } from '../context/LangContext'

/* ── Slider row ── */
function RangeRow({ label, value, onChange, min, max, step = 1, unit }) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.45))', fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.7rem', color: 'var(--accent, #3b82f6)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
          {value[0]}–{value[1]} {unit}
        </Typography>
      </Box>
      <Slider
        value={value}
        onChange={(_, v) => onChange(v)}
        min={min} max={max} step={step}
        disableSwap
        size="small"
        sx={{
          color: 'var(--accent, #3b82f6)',
          height: 3,
          '& .MuiSlider-thumb': { width: 12, height: 12 },
          '& .MuiSlider-track': { border: 'none' },
          '& .MuiSlider-rail': { opacity: 0.2 },
          py: 0.5,
        }}
      />
    </Box>
  )
}

/* ── Main panel ── */
export function SendConfigPanel({ config, onChange, disabled = false }) {
  const { t } = useLang()
  const sc = t.sendConfig
  const [open, setOpen] = useState(false)

  function update(key, val) {
    const next = { ...config, [key]: val }
    onChange(next)
    saveSendConfig(next)
  }

  return (
    <Box sx={{
      borderRadius: 2,
      border: '1px solid rgba(255,255,255,0.08)',
      bgcolor: 'rgba(255,255,255,0.02)',
      overflow: 'hidden',
    }}>
      {/* Header / toggle */}
      <Box
        onClick={() => !disabled && setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 1.5, py: 1, cursor: disabled ? 'default' : 'pointer',
          '&:hover': disabled ? {} : { bgcolor: 'rgba(255,255,255,0.03)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TimerIcon sx={{ fontSize: 15, color: 'var(--accent, #3b82f6)' }} />
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', fontWeight: 600 }}>
            {sc.title}
          </Typography>
          <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>
            {config.msgDelay[0]}–{config.msgDelay[1]}s · {sc.batchOf} {config.batchSize[0]}–{config.batchSize[1]}
          </Typography>
        </Box>
        <ExpandMoreIcon sx={{
          fontSize: 16, color: 'rgba(255,255,255,0.3)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }} />
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
          <RangeRow
            label={sc.msgDelay}
            value={config.msgDelay}
            onChange={v => update('msgDelay', v)}
            min={5} max={300} step={5}
            unit={sc.seconds}
          />
          <RangeRow
            label={sc.batchSize}
            value={config.batchSize}
            onChange={v => update('batchSize', v)}
            min={1} max={20} step={1}
            unit={sc.msgs}
          />
          <RangeRow
            label={sc.batchDelay}
            value={config.batchDelay}
            onChange={v => update('batchDelay', v)}
            min={1} max={30} step={1}
            unit={sc.minutes}
          />
          <Typography sx={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.2)', mt: 0.5, lineHeight: 1.4 }}>
            {sc.hint}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  )
}

/* ── Countdown bar shown during send ── */
export function CountdownBar({ countdown, total, label, batchNum, msgNum, msgTotal }) {
  if (countdown === null || countdown === undefined) return null
  const secs = countdown % 60
  const mins = Math.floor(countdown / 60)
  const pct  = total > 0 ? Math.min(100, ((total - countdown) / total) * 100) : 0
  const isBatch = label === 'batch'

  return (
    <Box sx={{
      px: 1.5, py: 1, borderRadius: 2,
      bgcolor: isBatch ? 'rgba(251,191,36,0.05)' : 'rgba(var(--accent-rgb,59,130,246),0.05)',
      border: `1px solid ${isBatch ? 'rgba(251,191,36,0.15)' : 'rgba(var(--accent-rgb,59,130,246),0.15)'}`,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
        <Typography sx={{ fontSize: '0.72rem', color: isBatch ? '#fbbf24' : 'var(--accent, #3b82f6)', fontWeight: 600 }}>
          {isBatch ? '☕ Pausa entre lotes' : '⏳ Próximo envío'}
          {batchNum != null && (
            <Box component="span" sx={{ ml: 1, color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: '0.65rem' }}>
              · lote {batchNum} · msg {msgNum}/{msgTotal}
            </Box>
          )}
        </Typography>
        <Typography sx={{
          fontSize: '0.8rem', fontWeight: 700, fontFamily: 'monospace',
          color: isBatch ? '#fbbf24' : 'var(--accent, #3b82f6)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `0:${String(secs).padStart(2, '0')}`}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          borderRadius: 4, height: 3,
          bgcolor: isBatch ? 'rgba(251,191,36,0.1)' : 'rgba(var(--accent-rgb,59,130,246),0.1)',
          '& .MuiLinearProgress-bar': {
            background: isBatch
              ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
              : 'linear-gradient(90deg,var(--accent,#3b82f6),rgba(var(--accent-rgb,59,130,246),0.7))',
            borderRadius: 4,
          },
        }}
      />
    </Box>
  )
}
