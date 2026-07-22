'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Slider from '@mui/material/Slider'
import Collapse from '@mui/material/Collapse'
import LinearProgress from '@mui/material/LinearProgress'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TimerIcon from '@mui/icons-material/Timer'
import { saveSendConfig } from '@/lib/sendConfig'
import { useLang } from '../context/LangContext'

const SLIDER_SX = {
  color: 'var(--accent, #3b82f6)',
  height: 4,
  mt: 0.5,
  mb: 0,
  '& .MuiSlider-thumb': {
    width: 14, height: 14,
    boxShadow: '0 0 0 3px rgba(var(--accent-rgb,59,130,246),0.18)',
    '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 5px rgba(var(--accent-rgb,59,130,246),0.25)' },
  },
  '& .MuiSlider-track': { border: 'none', height: 4 },
  '& .MuiSlider-rail': { opacity: 0.15, height: 4 },
  '& .MuiSlider-mark': { width: 2, height: 2, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.25)', transform: 'translate(-50%,-50%)' },
  '& .MuiSlider-markActive': { bgcolor: 'var(--accent, #3b82f6)', opacity: 0.6 },
  '& .MuiSlider-valueLabel': {
    fontSize: '0.65rem', fontWeight: 700, py: 0.3, px: 0.8,
    bgcolor: 'var(--accent, #3b82f6)',
    borderRadius: 1,
  },
}

/* ── Range slider with minimum distance enforcement ── */
function RangeRow({ label, value, onChange, min, max, step = 1, unit, minDist = 1 }) {
  function handleChange(_, newVal, activeThumb) {
    if (newVal[1] - newVal[0] < minDist) {
      if (activeThumb === 0) {
        const clamped = Math.min(newVal[0], max - minDist)
        onChange([clamped, clamped + minDist])
      } else {
        const clamped = Math.max(newVal[1], min + minDist)
        onChange([clamped - minDist, clamped])
      }
    } else {
      onChange(newVal)
    }
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.2 }}>
        <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', fontWeight: 600 }}>
          {label}
        </Typography>
        <Box sx={{
          px: 1, py: 0.15, borderRadius: 1,
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
        }}>
          <Typography sx={{ fontSize: '0.68rem', color: 'var(--accent, #3b82f6)', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {value[0]}–{value[1]} {unit}
          </Typography>
        </Box>
      </Box>
      <Slider
        value={value}
        onChange={handleChange}
        min={min} max={max} step={step}
        marks disableSwap
        valueLabelDisplay="auto"
        valueLabelFormat={v => `${v}${unit}`}
        sx={SLIDER_SX}
      />
    </Box>
  )
}

/* ── Main collapsible panel ── */
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
      border: `1px solid ${open ? 'rgba(var(--accent-rgb,59,130,246),0.25)' : 'rgba(255,255,255,0.07)'}`,
      bgcolor: open ? 'rgba(var(--accent-rgb,59,130,246),0.03)' : 'rgba(255,255,255,0.02)',
      overflow: 'hidden',
      transition: 'border-color 0.2s, background-color 0.2s',
    }}>
      {/* Header */}
      <Box
        onClick={() => !disabled && setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 1.5, py: 0.9, cursor: disabled ? 'default' : 'pointer',
          '&:hover': disabled ? {} : { bgcolor: 'rgba(255,255,255,0.02)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TimerIcon sx={{ fontSize: 14, color: 'var(--accent, #3b82f6)' }} />
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', fontWeight: 600 }}>
            {sc.title}
          </Typography>
          {/* Inline summary chips */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {[
              `${config.msgDelay[0]}–${config.msgDelay[1]}${sc.seconds}`,
              `${config.batchSize[0]}–${config.batchSize[1]} msgs`,
              `${config.batchDelay[0]}–${config.batchDelay[1]}${sc.minutes}`,
            ].map((chip, i) => (
              <Box key={i} sx={{
                px: 0.7, py: 0.05, borderRadius: 0.8,
                bgcolor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>
                  {chip}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <ExpandMoreIcon sx={{
          fontSize: 15, color: 'rgba(255,255,255,0.25)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          flexShrink: 0,
        }} />
      </Box>

      <Collapse in={open}>
        <Box sx={{
          px: 2, pb: 1.5, pt: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}>
          <RangeRow
            label={sc.msgDelay}
            value={config.msgDelay}
            onChange={v => update('msgDelay', v)}
            min={5} max={300} step={5}
            unit={sc.seconds} minDist={5}
          />
          <RangeRow
            label={sc.batchSize}
            value={config.batchSize}
            onChange={v => update('batchSize', v)}
            min={1} max={20} step={1}
            unit={sc.msgs} minDist={1}
          />
          <RangeRow
            label={sc.batchDelay}
            value={config.batchDelay}
            onChange={v => update('batchDelay', v)}
            min={1} max={30} step={1}
            unit={sc.minutes} minDist={1}
          />
          <Box sx={{
            px: 1.2, py: 0.8, borderRadius: 1.5,
            bgcolor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <Typography sx={{ fontSize: '0.63rem', color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
              🎲 {sc.hint}
            </Typography>
          </Box>
        </Box>
      </Collapse>
    </Box>
  )
}

/* ── Countdown bar shown during send ── */
export function CountdownBar({ countdown, total, label, batchNum, msgNum, msgTotal }) {
  if (countdown === null || countdown === undefined) return null
  const secs  = countdown % 60
  const mins  = Math.floor(countdown / 60)
  const pct   = total > 0 ? Math.min(100, ((total - countdown) / total) * 100) : 0
  const isBatch = label === 'batch'
  const color   = isBatch ? '#fbbf24' : 'var(--accent, #3b82f6)'
  const bgAlpha = isBatch ? 'rgba(251,191,36' : 'rgba(var(--accent-rgb,59,130,246)'

  return (
    <Box sx={{
      px: 1.5, py: 1, borderRadius: 2,
      bgcolor: `${bgAlpha},0.05)`,
      border: `1px solid ${bgAlpha},0.18)`,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.7 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Typography sx={{ fontSize: '0.72rem', color, fontWeight: 600 }}>
            {isBatch ? '☕ Pausa entre lotes' : '⏳ Próximo envío'}
          </Typography>
          {batchNum != null && (
            <Box sx={{
              px: 0.7, py: 0.1, borderRadius: 0.8,
              bgcolor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace' }}>
                lote {batchNum} · {msgNum}/{msgTotal}
              </Typography>
            </Box>
          )}
        </Box>
        <Typography sx={{
          fontSize: '0.88rem', fontWeight: 800, fontFamily: 'monospace',
          color, fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.05em',
        }}>
          {mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `0:${String(secs).padStart(2, '0')}`}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate" value={pct}
        sx={{
          borderRadius: 4, height: 4,
          bgcolor: `${bgAlpha},0.1)`,
          '& .MuiLinearProgress-bar': {
            background: isBatch
              ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
              : 'linear-gradient(90deg,var(--accent,#3b82f6),rgba(var(--accent-rgb,59,130,246),0.6))',
            borderRadius: 4,
          },
        }}
      />
    </Box>
  )
}
