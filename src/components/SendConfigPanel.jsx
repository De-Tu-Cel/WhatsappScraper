'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Slider from '@mui/material/Slider'
import Collapse from '@mui/material/Collapse'
import LinearProgress from '@mui/material/LinearProgress'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TimerIcon from '@mui/icons-material/Timer'
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed'
import LocalCafeIcon from '@mui/icons-material/LocalCafe'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { saveSendConfig, DEFAULT_SEND_CONFIG } from '@/lib/sendConfig'
import { useLang } from '../context/LangContext'

function sliderSx(color = '#3b82f6') {
  return {
    color,
    height: 4,
    px: 1,
    py: 1.5,
    transition: 'color 0.3s ease',
    '& .MuiSlider-thumb': {
      width: 16, height: 16,
      boxShadow: `0 0 0 3px ${color}30`,
      transition: 'box-shadow 0.3s ease',
      '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 6px ${color}40` },
    },
    '& .MuiSlider-track': { border: 'none', height: 4, transition: 'background-color 0.3s' },
    '& .MuiSlider-rail': { opacity: 0.35, height: 4, bgcolor: 'var(--border)' },
    '& .MuiSlider-mark': { width: 2, height: 2, borderRadius: '50%', bgcolor: 'var(--border)', transform: 'translate(-50%,-50%)' },
    '& .MuiSlider-markActive': { bgcolor: color, opacity: 0.6 },
    '& .MuiSlider-markLabel': { color: 'var(--text-muted)', fontSize: '0.65rem' },
    '& .MuiSlider-markLabelActive': { color: 'var(--text-muted)' },
    '& .MuiSlider-valueLabel': {
      fontSize: '0.65rem', fontWeight: 700, py: 0.3, px: 0.8,
      bgcolor: color,
      borderRadius: 1,
    },
  }
}

function riskStyle(level) {
  if (level === 'danger') return { color: '#f87171', bg: 'rgba(239,68,68,0.12)' }
  if (level === 'warn')   return { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' }
  return { color: '#4ade80', bg: 'rgba(34,197,94,0.12)' }
}
function msgDelayStyle(min) { return riskStyle(min < 15 ? 'danger' : min < 25 ? 'warn' : 'ok') }
function batchSizeStyle(max) { return riskStyle(max > 15 ? 'danger' : max > 10 ? 'warn' : 'ok') }
function batchDelayStyle(min) { return riskStyle(min < 2 ? 'danger' : min < 4 ? 'warn' : 'ok') }

const CARD_SX = {
  mb: 1.5, p: 1.5, borderRadius: 2,
  bgcolor: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
}

/* ── Range slider with minimum distance enforcement, wrapped in its own card ── */
function RangeRow({ icon, color, bg, label, value, onChange, min, max, step = 1, unit, minDist = 1, marks = true }) {
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
    <Box sx={CARD_SX}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{
            width: 24, height: 24, borderRadius: 1.2, flexShrink: 0,
            bgcolor: bg, border: `1px solid ${color}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background-color 0.3s, border-color 0.3s',
          }}>
            {icon}
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted, rgba(255,255,255,0.5))', fontWeight: 600 }}>
            {label}
          </Typography>
        </Box>
        <Box sx={{ px: 1, py: 0.15, borderRadius: 1, bgcolor: bg, border: `1px solid ${color}55`, transition: 'background-color 0.3s, border-color 0.3s' }}>
          <Typography sx={{ fontSize: '0.68rem', color, fontVariantNumeric: 'tabular-nums', fontWeight: 700, transition: 'color 0.3s' }}>
            {value[0]}–{value[1]} {unit}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ width: '90%', mx: 'auto' }}>
        <Slider
          value={value}
          onChange={handleChange}
          min={min} max={max} step={step}
          marks={marks} disableSwap
          valueLabelDisplay="auto"
          valueLabelFormat={v => `${v}${unit}`}
          sx={sliderSx(color)}
        />
      </Box>
    </Box>
  )
}

/* ── Risk indicator ── */
export function RiskBadge({ config }) {
  const { t } = useLang()
  const sc = t.sendConfig
  const minDelay = config.msgDelay[0]
  const maxBatch = config.batchSize[1]
  const minBreak = config.batchDelay[0]

  const warnings = []
  if (minDelay < 15)      warnings.push(sc.warnDelayDanger)
  else if (minDelay < 25) warnings.push(sc.warnDelaySlight)
  if (maxBatch > 15)      warnings.push(sc.warnBatchLarge)
  else if (maxBatch > 10) warnings.push(sc.warnBatchSlight)
  if (minBreak < 2)       warnings.push(sc.warnBreakDanger)
  else if (minBreak < 4)  warnings.push(sc.warnBreakSlight)

  const isHigh = minDelay < 15 || maxBatch > 15 || minBreak < 2
  const isMed  = minDelay < 25 || maxBatch > 10 || minBreak < 4
  const level  = isHigh ? 'high' : isMed ? 'medium' : 'low'
  const C = {
    low:    { color: '#4ade80', bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.22)',   icon: '✓', label: sc.riskLow },
    medium: { color: '#fbbf24', bg: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.25)', icon: '⚠', label: sc.riskMedium },
    high:   { color: '#f87171', bg: 'rgba(239,68,68,0.07)',  border: 'rgba(239,68,68,0.25)',  icon: '⚠', label: sc.riskHigh },
  }[level]

  return (
    <Box sx={{ px: 1.2, py: 0.8, borderRadius: 1.5, bgcolor: C.bg, border: `1px solid ${C.border}` }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: C.color, mb: warnings.length ? 0.4 : 0 }}>
        {C.icon} {C.label}
      </Typography>
      {warnings.map((w, i) => (
        <Typography key={i} sx={{ fontSize: '0.63rem', color: C.color, opacity: 0.82, lineHeight: 1.5 }}>
          • {w}
        </Typography>
      ))}
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

  function resetDefaults() {
    onChange({ ...DEFAULT_SEND_CONFIG })
    saveSendConfig({ ...DEFAULT_SEND_CONFIG })
  }

  return (
    <Box sx={{
      borderRadius: 2,
      border: open ? '1px solid rgba(var(--accent-rgb,59,130,246),0.25)' : '1px solid var(--border)',
      bgcolor: open ? 'rgba(var(--accent-rgb,59,130,246),0.03)' : 'var(--item-hover)',
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
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
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
                bgcolor: 'var(--item-hover)',
                border: '1px solid var(--border)',
              }}>
                <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {chip}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <ExpandMoreIcon sx={{
          fontSize: 15, color: 'var(--text-muted)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          flexShrink: 0,
        }} />
      </Box>

      <Collapse in={open} sx={{ '&.MuiCollapse-entered': { overflow: 'visible' } }}>
        <Box sx={{
          pl: 2.5, pr: 2.5, pb: 1.5, pt: 0.5,
          borderTop: '1px solid var(--border)',
        }}>
          {(() => {
            const ds = msgDelayStyle(config.msgDelay[0])
            const bs = batchSizeStyle(config.batchSize[1])
            const rs = batchDelayStyle(config.batchDelay[0])
            return (<>
              <RangeRow
                icon={<TimerIcon sx={{ fontSize: 14, color: ds.color, transition: 'color 0.3s' }} />}
                color={ds.color} bg={ds.bg}
                label={sc.msgDelay}
                value={config.msgDelay}
                onChange={v => update('msgDelay', v)}
                min={5} max={300} step={5}
                unit={sc.seconds} minDist={5}
                marks={[5,30,60,120,180,240,300].map(v => ({ value: v, label: v >= 60 ? `${v/60}m` : `${v}s` }))}
              />
              <RangeRow
                icon={<DynamicFeedIcon sx={{ fontSize: 14, color: bs.color, transition: 'color 0.3s' }} />}
                color={bs.color} bg={bs.bg}
                label={sc.batchSize}
                value={config.batchSize}
                onChange={v => update('batchSize', v)}
                min={1} max={20} step={1}
                unit={sc.msgs} minDist={1}
                marks={[1,5,10,15,20].map(v => ({ value: v, label: String(v) }))}
              />
              <RangeRow
                icon={<LocalCafeIcon sx={{ fontSize: 14, color: rs.color, transition: 'color 0.3s' }} />}
                color={rs.color} bg={rs.bg}
                label={sc.batchDelay}
                value={config.batchDelay}
                onChange={v => update('batchDelay', v)}
                min={1} max={30} step={1}
                unit={sc.minutes} minDist={1}
                marks={[1,5,10,15,20,30].map(v => ({ value: v, label: `${v}m` }))}
              />
            </>)
          })()}
          <RiskBadge config={config} />
          <Box sx={{ mt: 0.5 }}>
            {/* Reset defaults */}
            <Box
              onClick={disabled ? undefined : resetDefaults}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.4, borderRadius: 1.2, cursor: disabled ? 'default' : 'pointer',
                border: '1px solid rgba(255,255,255,0.08)',
                bgcolor: 'rgba(255,255,255,0.03)',
                opacity: disabled ? 0.4 : 1,
                '&:hover': disabled ? {} : { bgcolor: 'rgba(255,255,255,0.07)' },
              }}
            >
              <RestartAltIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }} />
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
                Restaurar defaults
              </Typography>
            </Box>
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
