'use client'
// Comparación de los tres clasificadores de conversaciones — Timing (diagrama de flujo
// determinista), IA (solo contenido) y Timing + IA (el de producción). Muestra el
// resultado de cada uno y el log paso a paso de cómo llegó cada uno a su resultado, por
// empresa y, en empresas con varios números, por número.
// Backend: apps/api/app/classification_compare.py.
//
// Fondo, texto y bordes siguen el tema y la paleta del usuario; los colores con
// significado (Sí/No, reglas, categorías, cada clasificador) son fijos.
import { useEffect, useState, useCallback } from 'react'
import useSWR, { mutate as swrMutate } from 'swr'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Collapse from '@mui/material/Collapse'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import ReplayIcon from '@mui/icons-material/Replay'
import TimerIcon from '@mui/icons-material/Timer'
import PsychologyIcon from '@mui/icons-material/Psychology'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import PercentIcon from '@mui/icons-material/Percent'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import RuleIcon from '@mui/icons-material/Rule'
import { useLang } from '../context/LangContext'
import { authFetch } from '@/lib/api'
import { COMMON_CONFIG, getCategoryConfig, getCommonConfig } from '@/lib/categoryConfig'
import { parseUtc, MX_TZ } from '@/lib/dates'
import { STAT_STRIP_BG } from '@/lib/surfaces'

export const METHODS = ['timing', 'ia', 'hibrido']
const METHOD_META = {
  timing:  { label: 'colTiming', help: 'helpTiming', icon: TimerIcon,      color: '#60a5fa' },
  ia:      { label: 'colIa',     help: 'helpIa',     icon: PsychologyIcon, color: '#f472b6' },
  hibrido: { label: 'colHybrid', help: 'helpHybrid', icon: CallMergeIcon,  color: '#2dd4bf' },
  rango:   { label: 'colRange',  help: 'helpRange',  icon: PercentIcon,    color: '#818cf8' },
}
// Superficies, texto y bordes salen del tema y la paleta del usuario (variables de
// app/layout.jsx); los colores de significado (Sí/No, regla, categorías) son fijos.
const C = {
  surface: 'var(--item-hover, rgba(255,255,255,0.03))', border: 'var(--border, rgba(255,255,255,0.08))',
  faint: 'var(--item-hover, rgba(255,255,255,0.06))', card: 'var(--card-bg, #161d2e)',
  text: 'var(--text, #f1f5f9)', muted: 'var(--text-muted, rgba(255,255,255,0.45))',
  yes: '#4ade80', no: '#fbbf24', rule: '#f59e0b', note: '#94a3b8',
}
const SUMMARY_KEY = '/api/classification/comparisons/summary'

// En los temas claros los colores de significado (pensados para fondo oscuro) se
// lavaban — ahí se oscurecen para que se lean.
const LIGHT = '[data-theme-mode="light"] &'
const inkOnLight = (hex) => `color-mix(in srgb, ${hex} 55%, #000)`

// Volver a pedir el resumen después de comparar una conversación desde la tabla.
export const refreshComparisonSummary = () => swrMutate(SUMMARY_KEY)

// Los últimos 10 dígitos — así se guardan los números en la comparación.
export const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10)

// Config visual de un resultado: Timing e IA se pintan con su categoría común; Timing + IA
// con la categoría de producción (la misma que la lista y el reporte).
export function resultConfig(method, result) {
  if (!result) return null
  if (method === 'hibrido' && result.category) return getCategoryConfig({ category: result.category, is_ai: result.is_ai })
  return getCommonConfig(result.common)
}

function resultLabel(t, method, result, cfg) {
  if (!result.common && method !== 'hibrido') return result.label || 'Error'
  return t.analytics[cfg.tKey] || result.label
}

// compact: para las columnas de la tabla — ancho fijo, el nombre largo se corta y se
// lee completo al pasar el mouse.
export function ResultChip({ method, result, onClick, compact, large }) {
  const { t } = useLang()
  const cfg = resultConfig(method, result)
  if (!cfg) return null
  const Icon = cfg.icon
  const label = resultLabel(t, method, result, cfg)
  const chip = (
    <Chip icon={<Icon />} label={label} size="small" onClick={onClick}
      sx={{
        height: large ? 26 : 20, fontSize: large ? '0.78rem' : '0.68rem', fontWeight: large ? 700 : 500,
        maxWidth: compact ? 112 : 240,
        bgcolor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`,
        [LIGHT]: { color: inkOnLight(cfg.color), '& .MuiChip-icon': { color: inkOnLight(cfg.color) } },
        cursor: onClick ? 'pointer' : 'default',
        '& .MuiChip-icon': { color: cfg.color, fontSize: large ? 16 : 13, ml: '6px', mr: '-2px' },
        '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', px: large ? '9px' : '7px' },
        '&:hover': onClick ? { bgcolor: cfg.bg, borderColor: cfg.color } : undefined,
        '&:focus-visible': { outline: `2px solid ${cfg.color}`, outlineOffset: 1 },
      }} />
  )
  return compact ? <Tooltip title={label}>{chip}</Tooltip> : chip
}

export function AgreementBadge({ agreement }) {
  const { t } = useLang()
  if (!agreement) return null
  const all = agreement.todos
  const pairs = [
    ['timing_ia', t.analytics.colTiming, t.analytics.colIa],
    ['timing_hibrido', t.analytics.colTiming, t.analytics.colHybrid],
    ['ia_hibrido', t.analytics.colIa, t.analytics.colHybrid],
  ]
  const tip = pairs.map(([k, a, b]) => agreement[k] == null ? null
    : `${a} ${agreement[k] ? t.analytics.agreePair : t.analytics.agreePairNot} ${b}`).filter(Boolean).join(' · ')
  const [Icon, color, label] = all == null
    ? [HourglassEmptyIcon, '#94a3b8', t.analytics.agreePending]
    : all ? [CheckCircleIcon, C.yes, t.analytics.agreeAll] : [CompareArrowsIcon, C.no, t.analytics.agreeSome]
  return (
    <Tooltip title={tip || label}>
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.1, py: 0.35, borderRadius: 99,
        border: `1px solid ${color}55`, bgcolor: `${color}18`, color, whiteSpace: 'nowrap', [LIGHT]: { color: inkOnLight(color) },
      }}>
        <Icon sx={{ fontSize: 15 }} />
        <Typography component="span" sx={{ fontSize: '0.74rem', fontWeight: 700 }}>{label}</Typography>
      </Box>
    </Tooltip>
  )
}

function fmtRanAt(value) {
  const d = parseUtc(value)
  if (!d) return '—'
  return d.toLocaleString('es-MX', { timeZone: MX_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const fmtSecs = (s) => s == null ? '—' : s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`

function Pill({ children, color }) {
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.9, py: 0.2, borderRadius: 99,
      fontSize: '0.68rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      color: color || C.muted, bgcolor: color ? `${color}18` : C.faint, border: `1px solid ${color ? `${color}44` : C.border}`,
      ...(color ? { [LIGHT]: { color: inkOnLight(color), borderColor: `${color}88` } } : {}),
    }}>{children}</Box>
  )
}

// Datos clave de cada método, arriba del log.
// El número que se muestra es el centro del piso y el techo (88 y 96 → 92).
// Un intervalo guardado antes de tener pct se calcula igual (2026-10-07).
export function parecidoPct(rango) {
  if (!rango) return null
  if (rango.pct != null && Number.isFinite(Number(rango.pct))) return Math.round(Number(rango.pct))
  if (rango.min == null || rango.max == null) return null
  const a = Math.round(Number(rango.min))
  const b = Math.round(Number(rango.max))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((Math.min(a, b) + Math.max(a, b)) / 2)
}

export function formatRango(rango) {
  const pct = parecidoPct(rango)
  return pct == null ? '' : `${pct}%`
}

export function rangoWasOverridden(result) {
  const rango = result?.rango
  if (!rango || rango.category == null) return false
  return rango.category !== result.category || !!rango.is_ai !== !!result.is_ai
}

function categoryLabel(t, rango) {
  const cfg = getCategoryConfig({ category: rango?.category, is_ai: rango?.is_ai })
  return t.analytics[cfg.tKey] || ''
}

// Lo que muestra la columna Rango. Si hay parecido nuevo, son una o varias
// clasificaciones. Si la comparación es anterior, queda el intervalo único.
export function parecidoItems(hibrido) {
  const cat = hibrido?.common || hibrido?.category
  // Sin contestación no hay de qué parecerse (Gas 1 2228120419, 2026-10-08).
  if (cat === 'sin_respuesta') return []
  const items = hibrido?.parecido?.items
  if (Array.isArray(items) && items.some(it => it && it.min != null && it.max != null)) {
    return items.filter(it => it && it.min != null && it.max != null)
  }
  const rango = hibrido?.rango
  if (rango && rango.min != null && rango.max != null) return [rango]
  return []
}

function fillTip(template, vars) {
  let text = typeof template === 'string' ? template : ''
  for (const [key, value] of Object.entries(vars)) text = text.replace(`{${key}}`, String(value))
  return text
}

function parecidoTip(t, hibrido, it, fresh, items) {
  const text = formatRango(it)
  if (!fresh && rangoWasOverridden({ rango: it, category: hibrido?.category, is_ai: hibrido?.is_ai })) {
    return fillTip(t.analytics.rangeShifted, { range: text, cat: categoryLabel(t, it) })
  }
  const lo = Math.round(Number(it.min))
  const hi = Math.round(Number(it.max))
  const exact = Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi
    ? fillTip(t.analytics.rangeExact, { pct: parecidoPct(it), min: Math.min(lo, hi), max: Math.max(lo, hi) })
    : fillTip(t.analytics.rangeExactSame, { pct: parecidoPct(it) })
  if (!fresh) return `${t.analytics.rangeLegacy || ''} ${exact}`.trim()
  return items.length > 1 ? `${exact} ${t.analytics.rangeMixed || ''}`.trim() : exact
}

export function ParecidoCell({ hibrido, onClick }) {
  const { t } = useLang()
  const items = parecidoItems(hibrido)
  if (!items.length) {
    return (
      <Typography sx={{
        fontSize: '0.7rem', lineHeight: 1, textAlign: 'center', fontStyle: 'italic',
        color: 'var(--text-muted, rgba(255,255,255,0.28))',
      }}>{t.analytics.noCategory}</Typography>
    )
  }
  const fresh = Array.isArray(hibrido?.parecido?.items) && hibrido.parecido.items.length > 0
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.45 }}>
      {items.map((it, i) => {
        const text = formatRango(it)
        if (!text) return null
        const cfg = getCategoryConfig({ category: it.category, is_ai: it.is_ai })
        const Icon = cfg.icon
        const name = t.analytics[cfg.tKey] || ''
        return (
          <Tooltip key={`${it.category}-${it.is_ai}-${i}`} title={parecidoTip(t, hibrido, it, fresh, items)}
            slotProps={{ tooltip: { className: 'classifier-help-tip', sx: {
              bgcolor: 'var(--card-bg, #161d2e)', color: 'var(--text, #f1f5f9)',
              border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 1.5,
              fontSize: '0.75rem', lineHeight: 1.45, maxWidth: 280,
            } } }}>
            <Chip icon={<Icon />} size="small" onClick={onClick}
              label={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.6, maxWidth: '100%' }}>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
                <Box component="span" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{text}</Box>
              </Box>}
              sx={{
                height: 22, maxWidth: 142, fontSize: '0.66rem', fontWeight: 600,
                bgcolor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}55`,
                cursor: onClick ? 'pointer' : 'default',
                [LIGHT]: { color: inkOnLight(cfg.color), '& .MuiChip-icon': { color: inkOnLight(cfg.color) } },
                '& .MuiChip-icon': { color: cfg.color, fontSize: 14, ml: '5px', mr: '-4px' },
                '& .MuiChip-label': { px: '7px', overflow: 'hidden' },
                '&:hover': onClick ? { bgcolor: cfg.bg, borderColor: cfg.color } : undefined,
              }} />
          </Tooltip>
        )
      })}
    </Box>
  )
}

function ParecidoLog({ hibrido }) {
  const { t } = useLang()
  const meta = METHOD_META.rango
  const Icon = meta.icon
  const items = parecidoItems(hibrido)
  const fresh = Array.isArray(hibrido?.parecido?.items)
  const steps = fresh
    ? (hibrido.parecido.trace || []).filter(s => s?.paso && s.paso !== 'Resultado')
    : items.length
      ? [{ paso: t.analytics.rangeLegacyTitle, detalle: t.analytics.rangeLegacy }]
      : [{ paso: t.analytics.rangeEmptyTitle, detalle: t.analytics.rangeEmpty }]
  const countLabel = items.length > 1
    ? t.analytics.rangeCountMixed.replace('{n}', String(items.length))
    : items.length === 1 ? t.analytics.rangeCountOne : t.analytics.rangeEmptyTitle
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', border: `1px solid ${C.border}`, borderRadius: 2.5, bgcolor: C.surface, overflow: 'hidden' }}>
      <Box sx={{ p: 2, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.1, borderBottom: `1px solid ${C.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${meta.color}1f`, color: meta.color, flexShrink: 0 }}>
            <Icon sx={{ fontSize: 18 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: C.text, letterSpacing: '0.01em' }}>{t.analytics[meta.label]}</Typography>
          <ClassifierHelp method="rango" size={17} />
        </Box>
        <Typography sx={{ fontSize: '0.74rem', color: C.muted, lineHeight: 1.5 }}>{t.analytics[meta.help]}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
          <Pill color={items.length > 1 ? meta.color : undefined}>{countLabel}</Pill>
          {hibrido?.parecido?.model && <Pill>{hibrido.parecido.model}</Pill>}
        </Box>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, px: 2, pt: 2, pb: 1.5, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {steps.map((step, i) => <Step key={i} step={step} n={i + 1} isLast={i === steps.length - 1} />)}
      </Box>
      <Box sx={{ flexShrink: 0 }}>
      {items.length > 0 ? items.map((it, i) => {
        const cfg = getCategoryConfig({ category: it.category, is_ai: it.is_ai })
        const text = formatRango(it)
        const name = t.analytics[cfg.tKey] || ''
        return (
          <Box key={`${it.category}-${i}`} sx={{
            mx: 1.5, mb: i === items.length - 1 ? 1.5 : 0.7, mt: 0, p: 1.3, borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
            bgcolor: cfg.bg, border: `1px solid ${cfg.color}55`,
          }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color, [LIGHT]: { color: inkOnLight(cfg.color) } }}>
                {i === 0 ? t.analytics.logResult : t.analytics.rangeAlso}
              </Typography>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: cfg.color, lineHeight: 1.25, mt: 0.25, [LIGHT]: { color: inkOnLight(cfg.color) } }}>
                {name}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: cfg.color, fontVariantNumeric: 'tabular-nums', flexShrink: 0, [LIGHT]: { color: inkOnLight(cfg.color) } }}>
              {text}
            </Typography>
          </Box>
        )
      }) : (
        <Box sx={{ m: 1.5, mt: 0, p: 1.4, borderRadius: 2, border: `1px solid ${C.border}`, bgcolor: C.faint }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted }}>
            {t.analytics.logResult}
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', color: C.muted, mt: 0.4 }}>{t.analytics.rangeEmptyTitle}</Typography>
        </Box>
      )}
      </Box>
    </Box>
  )
}

export function RangeReadout({ rango, category, isAi, onClick, wide = false }) {
  const { t } = useLang()
  const text = formatRango(rango)
  if (!text) {
    return (
      <Typography sx={{
        fontSize: '0.75rem', lineHeight: 1, textAlign: 'center',
        color: 'var(--text-muted, rgba(255,255,255,0.28))',
      }}>—</Typography>
    )
  }
  const lo = parecidoPct(rango)
  const shifted = rangoWasOverridden({ rango, category, is_ai: isAi })
  // Pastilla, igual que las otras celdas de análisis. El tramo pintado se leía como un
  // control roto cuando el intervalo era alto y angosto (2026-10-07).
  const color = shifted ? '#f59e0b' : (lo >= 75 ? '#4ade80' : '#93c5fd')
  const tip = shifted
    ? fillTip(t.analytics.rangeShifted, { range: text, cat: categoryLabel(t, rango) })
    : (t.analytics.colRangeHelp || '')
  return (
    <Tooltip title={tip}
      slotProps={{ tooltip: { className: 'classifier-help-tip', sx: {
        bgcolor: 'var(--card-bg, #161d2e)', color: 'var(--text, #f1f5f9)',
        border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 1.5,
        fontSize: '0.75rem', lineHeight: 1.45, maxWidth: 280,
      } } }}>
      <Box onClick={onClick} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.6,
        height: wide ? 26 : 22, pl: 0.8, pr: 1.05, borderRadius: 99,
        bgcolor: `${color}1c`, border: `1px solid ${color}55`, color,
        cursor: onClick ? 'pointer' : 'default',
        [LIGHT]: { color: inkOnLight(color), borderColor: `${color}88` },
      }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', flexShrink: 0 }} />
        <Typography sx={{
          fontSize: wide ? '0.8rem' : '0.72rem', fontWeight: 700, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums', color: 'inherit',
        }}>{text}</Typography>
      </Box>
    </Tooltip>
  )
}

function MethodFacts({ method, result }) {
  const { t } = useLang()
  const pills = [<Pill key="m">{result.model || t.analytics.logNoModel}</Pill>]
  // Con la tabla de condiciones (ConditionsTable) T1/T2 ya se ven ahí; los pills quedan
  // solo para comparaciones guardadas antes de que existiera la tabla.
  if (method === 'timing' && result.inputs && !result.checks) {
    const { t1_s, t2_s, umbral_t1_s, umbral_t2_s } = result.inputs
    const ok = (v, max) => v == null ? undefined : (v <= max ? C.yes : C.no)
    pills.push(<Pill key="t1" color={ok(t1_s, umbral_t1_s)}>T1 {fmtSecs(t1_s)} · máx. {umbral_t1_s} s</Pill>)
    pills.push(<Pill key="t2" color={ok(t2_s, umbral_t2_s)}>T2 {fmtSecs(t2_s)} · máx. {umbral_t2_s} s</Pill>)
  }
  if (method === 'ia' && result.confidence != null) {
    pills.push(<Pill key="c">{t.analytics.logConfidence} {Math.round(result.confidence * 100)}%</Pill>)
  }
  if (method === 'hibrido') {
    const n = (result.trace || []).filter(s => /^Corrección/.test(s.paso)).length
    pills.push(<Pill key="r" color={n ? C.rule : undefined}>{t.analytics.logRules}: {n ? t.analytics.logRulesChanged : t.analytics.logNoRules}</Pill>)
  }
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>{pills}</Box>
}

// Las condiciones del diagrama de Timing, en orden: qué se midió, el límite y cómo
// salió. La que decidió el resultado se resalta ("→ Humano"); las que no se alcanzaron
// quedan en gris.
function ConditionsTable({ checks, resultCfg }) {
  const { t } = useLang()
  const head = { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted }
  const cell = { px: 1, py: 0.75, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', minWidth: 0 }
  const estado = { si: [C.yes, t.analytics.logYes], no: [C.no, t.analytics.logNo], pendiente: [undefined, t.analytics.pending] }
  return (
    <Box>
      <Typography sx={{ ...head, mb: 0.6 }}>{t.analytics.logConditions}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) auto minmax(64px, 112px) minmax(86px, auto)', border: `1px solid ${C.border}`, borderRadius: 1.5, overflow: 'hidden' }}>
        {[t.analytics.logCondition, t.analytics.logMeasured, t.analytics.logLimit, t.analytics.logOutcome].map(h => (
          <Box key={h} sx={{ px: 1, py: 0.6, bgcolor: C.faint, minWidth: 0 }}><Typography noWrap sx={head}>{h}</Typography></Box>
        ))}
        {checks.map(c => {
          const skipped = c.estado === 'no_evaluada'
          const decisive = !!c.lleva_a
          const rowSx = {
            ...cell,
            opacity: skipped ? 0.45 : 1,
            bgcolor: decisive && resultCfg ? resultCfg.bg : 'transparent',
          }
          const [color, label] = estado[c.estado] || []
          return (
            <Box key={c.key} sx={{ display: 'contents' }}>
              <Box sx={rowSx}>
                <Typography sx={{ fontSize: '0.74rem', fontWeight: decisive ? 700 : 500, color: C.text, lineHeight: 1.35 }}>{c.cond}</Typography>
              </Box>
              <Box sx={{ ...rowSx, justifyContent: 'flex-end' }}>
                <Typography sx={{ fontSize: '0.74rem', fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{c.medido || '—'}</Typography>
              </Box>
              <Box sx={rowSx}>
                <Typography sx={{ fontSize: '0.7rem', color: C.muted, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>{c.limite}</Typography>
              </Box>
              <Box sx={{ ...rowSx, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 0.4 }}>
                {skipped
                  ? <Typography sx={{ fontSize: '0.68rem', color: C.muted, fontStyle: 'italic', whiteSpace: 'nowrap' }}>{t.analytics.logNotEvaluated}</Typography>
                  : <Pill color={color}>{label}</Pill>}
                {decisive && resultCfg && (
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: resultCfg.color, lineHeight: 1.25, [LIGHT]: { color: inkOnLight(resultCfg.color) } }}>
                    → {c.lleva_a}
                  </Typography>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// Un paso del log: decisión del diagrama (¿…? → Sí/No), regla fija que corrigió al
// modelo, nota, evidencia citada o paso normal.
// La conversación tal cual la recibió la IA — quién escribió, cuánto tardó y el texto.
function Transcript({ items }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ mt: 0.6 }}>
      <Button size="small" onClick={() => setOpen(o => !o)}
        sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 600, px: 1, py: 0.2, minWidth: 0, color: 'var(--accent, #60a5fa)',
              border: `1px solid ${C.border}`, borderRadius: 99 }}>
        {open ? t.analytics.logHideInput : `${t.analytics.logShowInput} (${items.length} ${t.analytics.logMessages})`}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.6,
                   p: 1, borderRadius: 1.5, bgcolor: C.faint, border: `1px solid ${C.border}` }}>
          {items.map((it, i) => {
            const us = it.de === 'Nosotros'
            return (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '88px 1fr', columnGap: 1, alignItems: 'start' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.3 }}>
                  <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: us ? 'var(--accent, #60a5fa)' : C.text }}>
                    {us ? t.analytics.logUs : t.analytics.logBiz}
                  </Typography>
                  {it.t && <Pill color={it.t.startsWith('⚡') ? C.no : undefined}>{it.t}</Pill>}
                </Box>
                <Typography sx={{ fontSize: '0.72rem', color: C.muted, lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {it.texto}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Collapse>
    </Box>
  )
}

function Step({ step, n, isLast }) {
  const { t } = useLang()
  const isDecision = step.paso.startsWith('¿')
  // Sin \b: en JS la "í" no cuenta como letra de palabra y /^Sí\b/ nunca coincidía.
  const answer = step.respuesta
    ? { si: 'yes', no: 'no', pendiente: 'pending' }[step.respuesta]
    : isDecision ? (/^Sí(?!\p{L})/u.test(step.detalle) ? 'yes' : /^No(?!\p{L})/u.test(step.detalle) ? 'no' : null) : null
  const isRule = step.paso.startsWith('Corrección')
  const isNote = step.paso.startsWith('Nota')
  const isEvidence = step.paso.startsWith('Evidencia')
  const dot = isRule ? C.rule : answer === 'yes' ? C.yes : answer === 'no' ? C.no : null
  const quotes = isEvidence ? step.detalle.split(/»\s*·\s*«/).map(q => q.replace(/^«|»$/g, '')) : null
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '22px 1fr', columnGap: 1.2, position: 'relative', pb: isLast ? 0 : 1.6 }}>
      {!isLast && <Box sx={{ position: 'absolute', left: 10.5, top: 24, bottom: 2, width: '1px', bgcolor: C.border }} />}
      <Box sx={{
        width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.64rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', zIndex: 1,
        bgcolor: dot ? `${dot}22` : C.card, color: dot || C.muted, border: `1px solid ${dot ? `${dot}66` : C.border}`,
        ...(dot ? { [LIGHT]: { color: inkOnLight(dot) } } : {}),
      }}>
        {isNote ? <InfoOutlinedIcon sx={{ fontSize: 13 }} /> : isRule ? <RuleIcon sx={{ fontSize: 13 }} /> : n}
      </Box>
      <Box sx={{ minWidth: 0, pt: '1px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: isNote ? C.note : C.text }}>{step.paso}</Typography>
          {answer && (
            <Pill color={answer === 'yes' ? C.yes : answer === 'no' ? C.no : undefined}>
              {answer === 'yes' ? t.analytics.logYes : answer === 'no' ? t.analytics.logNo : t.analytics.pending}
            </Pill>
          )}
          {isRule && <Pill color={C.rule}>{t.analytics.logRuleTag}</Pill>}
        </Box>
        {step.hilo ? (
          <>
            <Typography sx={{ fontSize: '0.76rem', color: C.muted, lineHeight: 1.55, mt: 0.2 }}>{step.detalle}</Typography>
            <Transcript items={step.hilo} />
          </>
        ) : quotes ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, mt: 0.6 }}>
            {quotes.map((q, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 0.6, p: 0.8, borderRadius: 1.5, bgcolor: C.faint, border: `1px solid ${C.border}` }}>
                <FormatQuoteIcon sx={{ fontSize: 14, color: C.muted, flexShrink: 0, mt: '1px' }} />
                <Typography sx={{ fontSize: '0.74rem', color: C.text, lineHeight: 1.5, wordBreak: 'break-word', fontStyle: 'italic' }}>{q}</Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography sx={{ fontSize: '0.76rem', color: C.muted, lineHeight: 1.55, wordBreak: 'break-word', mt: 0.2, fontStyle: isNote ? 'italic' : 'normal' }}>
            {step.detalle}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// Lo que puede devolver cada clasificador (taxonomía común de classification_compare.py).
const METHOD_OUTPUTS = {
  timing:  ['humano', 'automatico_humano', 'automatico_sin_respuesta', 'bot', 'agente_ia', 'humano_o_desconectado', 'pendiente'],
  ia:      ['humano', 'automatico_humano', 'automatico_sin_respuesta', 'bot', 'agente_ia', 'sin_respuesta'],
  hibrido: ['humano', 'automatico_humano', 'automatico_sin_respuesta', 'bot', 'agente_ia', 'sin_respuesta'],
  rango:   ['humano', 'automatico_humano', 'automatico_sin_respuesta', 'bot', 'agente_ia'],
}

// El "?" usa el fondo y el texto del tema activo. globals.css pinta todo tooltip de
// claro en #1e293b con !important; la clase classifier-help-tip lo gana (2026-10-07).
const TIP = {
  bg: 'var(--card-bg, #161d2e)',
  text: 'var(--text, #f1f5f9)',
  muted: 'var(--text-muted, rgba(241,245,249,0.62))',
  border: 'var(--border, rgba(255,255,255,0.1))',
}

function HelpSection({ label, tone, children }) {
  return (
    <Box>
      <Box sx={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.4,
        color: tone || TIP.muted }}>{label}</Box>
      {children}
    </Box>
  )
}

// "?" junto al nombre de un clasificador: al pasar el mouse (o con el teclado) explica qué
// revisa, cómo decide, qué resultados puede dar y dónde se puede equivocar. limits = los
// umbrales del diagrama (inputs de un resultado de Timing); sin ellos, los de fábrica.
export function ClassifierHelp({ method, limits, size = 15 }) {
  const { t } = useLang()
  const how = t.analytics.classifierHow
  const h = how?.[method]
  const meta = METHOD_META[method]
  if (!h || !meta) return null
  const Icon = meta.icon
  const fill = (s) => s
    .replace(/\{t1\}/g, `${limits?.umbral_t1_s ?? 10} s`)
    .replace(/\{t2\}/g, `${limits?.umbral_t2_s ?? 5} s`)
    .replace(/\{wait\}/g, `${limits?.espera_h ?? 1} h`)
  const text = { fontSize: '0.74rem', lineHeight: 1.5, fontWeight: 400, color: TIP.text }
  const body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <Box sx={{ width: 24, height: 24, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${meta.color}1f`,
          '&& .MuiSvgIcon-root': { color: `${meta.color} !important` } }}>
          <Icon sx={{ fontSize: 15 }} />
        </Box>
        <Box sx={{ fontSize: '0.84rem', fontWeight: 800, color: TIP.text }}>{how.title}: {t.analytics[meta.label]}</Box>
      </Box>
      <HelpSection label={how.sees}><Box sx={text}>{fill(h.sees)}</Box></HelpSection>
      <HelpSection label={how.decides}>
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.7 }}>
          {h.steps.map((s, i) => (
            <Box component="li" key={i} sx={{ display: 'flex', gap: 0.8 }}>
              <Box sx={{ width: 17, height: 17, mt: '1px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', fontWeight: 800, color: meta.color, bgcolor: `${meta.color}26` }}>{i + 1}</Box>
              <Box sx={text}>{fill(s)}</Box>
            </Box>
          ))}
        </Box>
      </HelpSection>
      <HelpSection label={how.outputs}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {METHOD_OUTPUTS[method].map(k => {
            const cfg = COMMON_CONFIG[k]
            return (
              <Box key={k} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.8, py: 0.2, borderRadius: 99, bgcolor: cfg.bg, border: `1px solid ${cfg.color}40` }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: cfg.color }} />
                <Box sx={{ fontSize: '0.66rem', fontWeight: 600, color: TIP.text, whiteSpace: 'nowrap' }}>{t.analytics[cfg.tKey]}</Box>
              </Box>
            )
          })}
        </Box>
      </HelpSection>
      <HelpSection label={how.weak} tone={C.no}><Box sx={{ ...text, color: TIP.muted }}>{fill(h.weak)}</Box></HelpSection>
      {h.note && (
        <Box sx={{ fontSize: '0.72rem', fontWeight: 700, color: meta.color, pt: 1, borderTop: `1px solid ${TIP.border}` }}>{h.note}</Box>
      )}
    </Box>
  )
  return (
    <Tooltip title={body} placement="bottom-start" enterDelay={120} leaveDelay={80}
      slotProps={{ tooltip: { className: 'classifier-help-tip', sx: { bgcolor: TIP.bg, color: TIP.text, border: `1px solid ${TIP.border}`, borderRadius: 2.5, p: 1.75, maxWidth: 380,
        boxShadow: '0 14px 36px rgba(0,0,0,0.28)' } } }}>
      <Box component="span" role="button" tabIndex={0} aria-label={`${how.title}: ${t.analytics[meta.label]}`}
        onClick={e => e.stopPropagation()}
        sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'help', color: C.muted, borderRadius: '50%', transition: 'color 0.15s',
          '&:hover, &:focus-visible': { color: meta.color, outline: 'none' } }}>
        <HelpOutlineIcon sx={{ fontSize: size }} />
      </Box>
    </Tooltip>
  )
}

function MethodLog({ method, result }) {
  const { t } = useLang()
  const meta = METHOD_META[method]
  const Icon = meta.icon
  const cfg = resultConfig(method, result)
  const steps = (result?.trace || []).filter(s => s.paso !== 'Resultado')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', border: `1px solid ${C.border}`, borderRadius: 2.5, bgcolor: C.surface, overflow: 'hidden' }}>
      <Box sx={{ p: 2, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.1, borderBottom: `1px solid ${C.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${meta.color}1f`, color: meta.color, flexShrink: 0 }}>
            <Icon sx={{ fontSize: 18 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: C.text, letterSpacing: '0.01em' }}>{t.analytics[meta.label]}</Typography>
          <ClassifierHelp method={method} limits={method === 'timing' ? result?.inputs : undefined} size={17} />
        </Box>
        <Typography sx={{ fontSize: '0.74rem', color: C.muted, lineHeight: 1.5 }}>{t.analytics[meta.help]}</Typography>
        {result && <MethodFacts method={method} result={result} />}
        {result?.ran_at && (
          <Typography sx={{ fontSize: '0.68rem', color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
            {t.analytics.logRanAt} {fmtRanAt(result.ran_at)}
          </Typography>
        )}
        {method === 'timing' && result?.checks && <ConditionsTable checks={result.checks} resultCfg={cfg} />}
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, px: 2, pt: 2, pb: 1.5, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {steps.map((step, i) => <Step key={i} step={step} n={i + 1} isLast={i === steps.length - 1} />)}
      </Box>
      {result && cfg && (
        <Box sx={{ m: 1.5, mt: 0, flexShrink: 0, p: 1.4, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, bgcolor: cfg.bg, border: `1px solid ${cfg.color}55` }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color, [LIGHT]: { color: inkOnLight(cfg.color) } }}>
            {t.analytics.logResult}
          </Typography>
          <ResultChip method={method} result={result} large />
        </Box>
      )}
    </Box>
  )
}

const SK = { bgcolor: 'color-mix(in srgb, var(--text, #f1f5f9) 11%, transparent)' }

// Silueta de una columna del log mientras carga: mismo encabezado (ícono, nombre, ayuda,
// pills), la tabla de condiciones en Timing, los pasos con su número y el resultado.
function MethodLogSkeleton({ method }) {
  const meta = METHOD_META[method]
  const Icon = meta.icon
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', border: `1px solid ${C.border}`, borderRadius: 2.5, bgcolor: C.surface, overflow: 'hidden' }}>
      <Box sx={{ p: 2, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.1, borderBottom: `1px solid ${C.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${meta.color}1f`, color: meta.color, flexShrink: 0 }}>
            <Icon sx={{ fontSize: 18 }} />
          </Box>
          <Skeleton variant="text" width={method === 'hibrido' ? 104 : 64} height={24} sx={SK} />
        </Box>
        <Skeleton variant="text" width="96%" height={14} sx={SK} />
        <Skeleton variant="text" width="72%" height={14} sx={SK} />
        <Box sx={{ display: 'flex', gap: 0.6 }}>
          <Skeleton variant="rounded" width={88} height={20} sx={{ ...SK, borderRadius: 99 }} />
          {method !== 'timing' && <Skeleton variant="rounded" width={110} height={20} sx={{ ...SK, borderRadius: 99 }} />}
        </Box>
        <Skeleton variant="text" width={118} height={12} sx={SK} />
        {method === 'timing' && (
          <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 1.5, overflow: 'hidden', mt: 0.4 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 48px 72px 70px', gap: 1, px: 1, py: 0.75,
                borderTop: i ? `1px solid ${C.border}` : 'none', bgcolor: i ? 'transparent' : C.faint }}>
                <Skeleton variant="text" height={14} width={i ? '86%' : '50%'} sx={SK} />
                <Skeleton variant="text" height={14} sx={SK} />
                <Skeleton variant="text" height={14} sx={SK} />
                {i ? <Skeleton variant="rounded" height={18} width={34} sx={{ ...SK, borderRadius: 99 }} /> : <Skeleton variant="text" height={14} sx={SK} />}
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box sx={{ px: 2, pt: 2, pb: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1.6 }}>
        {Array.from({ length: method === 'timing' ? 4 : 6 }).map((_, i) => (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '22px 1fr', columnGap: 1.2 }}>
            <Skeleton variant="circular" width={22} height={22} sx={SK} />
            <Box sx={{ minWidth: 0 }}>
              <Skeleton variant="text" width={`${46 + ((i * 17) % 34)}%`} height={18} sx={SK} />
              <Skeleton variant="text" width="94%" height={14} sx={SK} />
              {i % 2 === 0 && <Skeleton variant="text" width="64%" height={14} sx={SK} />}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ m: 1.5, mt: 0, p: 1.4, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, border: `1px solid ${C.border}`, bgcolor: C.faint }}>
        <Skeleton variant="text" width={70} height={14} sx={SK} />
        <Skeleton variant="rounded" width={96} height={26} sx={{ ...SK, borderRadius: 99 }} />
      </Box>
    </Box>
  )
}

const fmtNumber = (n) => last10(n).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')

// number: en empresas con varios números, abre la comparación de ese número.
export function ComparisonDialog({ companyId, companyName, number, onClose, onChanged }) {
  const { t } = useLang()
  const [doc, setDoc] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | empty | running | error
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await authFetch(`/api/classification/comparisons/${companyId}`)
      if (res.status === 404) { setDoc(null); setState('empty'); return }
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
      setDoc(data); setState('ready')
    } catch (e) { setError(e.message); setState('error') }
  }, [companyId])

  useEffect(() => { if (companyId) load() }, [companyId, load])

  async function rerun() {
    setState('running'); setError('')
    try {
      const res = await authFetch(`/api/classification/comparisons/${companyId}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`)
      setDoc(data); setState('ready'); onChanged?.(); refreshComparisonSummary()
    } catch (e) { setError(e.message); setState(doc ? 'ready' : 'error') }
  }

  const view = number ? (doc?.numbers || []).find(x => x.number === last10(number)) : doc
  return (
    <Dialog open={!!companyId} onClose={onClose} maxWidth="xl" fullWidth
      slotProps={{ paper: { sx: { bgcolor: C.card, backgroundImage: 'none', color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: { md: 'min(92vh, 900px)' }, display: 'flex', flexDirection: 'column' } } }}>
      <DialogTitle sx={{ pb: 1.5, pt: 2.5, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.muted }}>
              {t.analytics.logTitle}
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', mt: 0.3 }}>
              {companyName}
              {number && <Box component="span" sx={{ ml: 1, fontWeight: 600, color: C.muted, fontFamily: 'monospace', fontSize: '0.95rem' }}>{fmtNumber(number)}</Box>}
            </Typography>
          </Box>
          {view?.agreement && <AgreementBadge agreement={view.agreement} />}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ px: 3, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {state === 'loading' && (
          <Box aria-busy="true" aria-label={t.analytics.logLoading}
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(4, minmax(0, 1fr))' }, gridAutoRows: { xs: 'auto', md: 'minmax(0, 1fr)' }, gap: 1.5, flex: 1, minHeight: 0 }}>
            {METHODS.map(m => <MethodLogSkeleton key={m} method={m} />)}
            <MethodLogSkeleton method="rango" />
          </Box>
        )}
        {(state === 'empty' || (state === 'ready' && !view)) && (
          <Typography sx={{ py: 4, fontSize: '0.85rem', color: C.muted, textAlign: 'center' }}>{t.analytics.logEmpty}</Typography>
        )}
        {error && <Typography sx={{ mb: 1, fontSize: '0.8rem', color: '#f87171' }}>{t.analytics.compareFailed}: {error}</Typography>}
        {view && (state === 'ready' || state === 'running') && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(4, minmax(0, 1fr))' }, gridAutoRows: { xs: 'auto', md: 'minmax(0, 1fr)' }, gap: 1.5, flex: 1, minHeight: 0, opacity: state === 'running' ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            {METHODS.map(m => <MethodLog key={m} method={m} result={view[m]} />)}
            <ParecidoLog hibrido={view.hibrido} />
          </Box>
        )}
      </DialogContent>
      <Divider sx={{ borderColor: C.border, mx: 3, mt: 1 }} />
      <DialogActions sx={{ px: 3, pt: 1.5, pb: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ color: C.muted, textTransform: 'none' }}>Cerrar</Button>
        <Button variant="contained" onClick={rerun} disabled={state === 'running' || state === 'loading'}
          startIcon={state === 'running' ? <CircularProgress size={14} sx={{ color: 'inherit' }} /> : <ReplayIcon />}
          sx={{ textTransform: 'none', fontWeight: 700, bgcolor: 'var(--accent, #3b82f6)', '&:hover': { bgcolor: 'var(--accent, #3b82f6)', filter: 'brightness(1.1)' } }}>
          {state === 'running' ? t.analytics.compareRunning : (doc ? t.analytics.logRerun : t.analytics.compareRun)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Resumen de la comparación ───────────────────────────────────────────────
const CATEGORY_ORDER = ['humano', 'humano_o_desconectado', 'automatico_humano', 'automatico_sin_respuesta', 'bot', 'agente_ia', 'sin_respuesta', 'pendiente']
const ERROR_CFG = { tKey: 'cmpError', color: '#64748b', bg: 'rgba(100,116,139,0.15)' }
const PAIR_COLORS = { timing_ia: ['#60a5fa', '#f472b6'], timing_hibrido: ['#60a5fa', '#2dd4bf'], ia_hibrido: ['#f472b6', '#2dd4bf'] }
const pctOf = (x) => (x?.de ? Math.round((x.si / x.de) * 100) : null)

function SectionLabel({ children }) {
  return (
    <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em', color: C.text, opacity: 0.85, mb: 1.2 }}>
      {children}
    </Typography>
  )
}

function MethodName({ method, t }) {
  const meta = METHOD_META[method]
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: meta.color }} />
      <Box component="span" sx={{ fontSize: '0.76rem', color: C.text, fontWeight: 600 }}>{t.analytics[meta.label]}</Box>
    </Box>
  )
}

function PairRow({ pair, a, b, x, t }) {
  const p = pctOf(x)
  const [ca, cb] = PAIR_COLORS[pair]
  return (
    <Tooltip title={x?.de ? `${x.si} de ${x.de}` : ''} placement="left">
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, auto) 1fr 40px', alignItems: 'center', gap: 1.4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <MethodName method={a} t={t} /><Box component="span" sx={{ color: C.muted, fontSize: '0.72rem' }}>=</Box><MethodName method={b} t={t} />
        </Box>
        <Box sx={{ height: 8, borderRadius: 99, bgcolor: C.faint, overflow: 'hidden' }}>
          <Box sx={{ width: `${p ?? 0}%`, height: '100%', borderRadius: 99, background: `linear-gradient(90deg, ${ca}, ${cb})`, transition: 'width 0.5s ease' }} />
        </Box>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.text }}>
          {p == null ? '—' : `${p}%`}
        </Typography>
      </Box>
    </Tooltip>
  )
}

function DistributionRow({ method, counts, t }) {
  const entries = [...CATEGORY_ORDER, 'error'].filter(k => counts?.[k]).map(k => [k, counts[k]])
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: 1.4 }}>
      <MethodName method={method} t={t} />
      <Box sx={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', gap: '2px' }}>
        {entries.map(([k, n]) => {
          const cfg = k === 'error' ? ERROR_CFG : COMMON_CONFIG[k]
          return (
            <Tooltip key={k} title={`${t.analytics[cfg.tKey]}: ${n} (${Math.round((n / total) * 100)}%)`}>
              <Box sx={{ width: `${(n / total) * 100}%`, minWidth: 4, bgcolor: cfg.color, opacity: 0.9, '&:hover': { opacity: 1, filter: 'brightness(1.15)' } }} />
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}

function ComparisonSummarySkeleton() {
  const line = { bgcolor: 'color-mix(in srgb, var(--text, #f1f5f9) 11%, transparent)' }
  return (
    <Box aria-busy="true" sx={{
      containerType: 'inline-size', flexShrink: 0,
      borderRadius: 2.5, border: `1px solid ${C.border}`, background: STAT_STRIP_BG,
    }}>
      <Box sx={{
        display: 'grid', columnGap: 2.5, rowGap: 2.5, px: 3, py: 2.2, gridTemplateColumns: '1fr',
        '@container (min-width: 720px)': { gridTemplateColumns: '1fr 1fr' },
        '@container (min-width: 1100px)': {
          gridTemplateColumns: 'auto minmax(320px, 560px) minmax(380px, 860px)',
          justifyContent: 'space-between', columnGap: 6,
        },
      }}>
        {/* Coincidencia global: título, porcentaje grande y muestra comparada. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Skeleton variant="circular" width={18} height={18} sx={line} />
            <Skeleton variant="text" width={190} height={20} sx={line} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 1.2 }}>
            <Skeleton variant="text" width={72} height={48} sx={line} />
            <Skeleton variant="text" width={104} height={18} sx={line} />
          </Box>
          <Skeleton variant="text" width={145} height={14} sx={{ ...line, mt: 0.6 }} />
        </Box>

        {/* Las tres coincidencias por pares conservan etiquetas, barra y porcentaje. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Skeleton variant="text" width={155} height={15} sx={{ ...line, mb: 1.2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
            {[0, 1, 2].map(i => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(150px, auto) 1fr 40px', alignItems: 'center', gap: 1.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.55 }}>
                  <Skeleton variant="circular" width={7} height={7} sx={line} />
                  <Skeleton variant="text" width={i === 0 ? 42 : 52} height={15} sx={line} />
                  <Skeleton variant="text" width={8} height={14} sx={line} />
                  <Skeleton variant="circular" width={7} height={7} sx={line} />
                  <Skeleton variant="text" width={i === 1 ? 72 : 50} height={15} sx={line} />
                </Box>
                <Skeleton variant="rounded" height={8} sx={{ ...line, borderRadius: 99 }} />
                <Skeleton variant="text" width={34} height={17} sx={line} />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Distribución de Timing, IA y Timing + IA con la leyenda inferior. */}
        <Box sx={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          '@container (min-width: 720px)': { gridColumn: '1 / -1' },
          '@container (min-width: 1100px)': { gridColumn: 'auto' },
        }}>
          <Skeleton variant="text" width={166} height={15} sx={{ ...line, mb: 1.2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
            {[62, 26, 82].map((nameWidth, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '96px 1fr', alignItems: 'center', gap: 1.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Skeleton variant="circular" width={7} height={7} sx={line} />
                  <Skeleton variant="text" width={nameWidth} height={15} sx={line} />
                </Box>
                <Box sx={{ display: 'flex', height: 14, gap: '2px' }}>
                  {[24, 14, 18, 10, 20, 8].map((w, j) => (
                    <Skeleton key={j} variant="rectangular" width={`${w}%`} height={14} sx={{ ...line, borderRadius: j === 0 || j === 5 ? 99 : 0 }} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.6, mt: 1.4 }}>
            {[70, 100, 54, 74].map((w, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                <Skeleton variant="rounded" width={8} height={8} sx={line} />
                <Skeleton variant="text" width={w} height={13} sx={line} />
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function ComparisonSummary() {
  const { t } = useLang()
  const fetcher = url => authFetch(url).then(r => r.json())
  const { data: sum, isLoading, error } = useSWR(SUMMARY_KEY, fetcher, { revalidateOnFocus: false })
  if (isLoading) return <ComparisonSummarySkeleton />
  if (error) return null
  if (!sum?.total) return null

  const c = sum.coincidencia || {}
  const all = pctOf(c.todos)
  const present = CATEGORY_ORDER.filter(k => METHODS.some(m => sum.por_metodo?.[m]?.[k]))
  return (
    <Box sx={{
      containerType: 'inline-size', flexShrink: 0,
      borderRadius: 2.5, border: `1px solid ${C.border}`,
      background: STAT_STRIP_BG,
    }}>
    <Box sx={{
      // Columnas según el ancho de la tarjeta (no de la ventana: la barra lateral cambia
      // cuánto mide). En tres columnas el bloque del % toma solo lo que mide y las barras
      // crecen hasta un tope; lo que sobra se reparte parejo entre los tres bloques — antes
      // quedaba un hueco grande junto al 54% y las barras se estiraban de lado a lado.
      display: 'grid', columnGap: 2.5, rowGap: 2.5, px: 3, py: 2.2, gridTemplateColumns: '1fr',
      '@container (min-width: 720px)': { gridTemplateColumns: '1fr 1fr' },
      '@container (min-width: 1100px)': {
        gridTemplateColumns: 'auto minmax(320px, 560px) minmax(380px, 860px)',
        justifyContent: 'space-between', columnGap: 6,
      },
    }}>
      {/* Los tres coinciden */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <CompareArrowsIcon sx={{ fontSize: 18, color: '#4ade80' }} />
          <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: C.text }}>{t.analytics.sumTitle}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 1.2 }}>
          <Typography sx={{ fontSize: '2.6rem', fontWeight: 900, lineHeight: 1, color: '#4ade80', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
            {all == null ? '—' : `${all}%`}
          </Typography>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: C.text }}>{t.analytics.agreeAll.toLowerCase()}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.74rem', color: C.muted, fontVariantNumeric: 'tabular-nums', mt: 0.6 }}>
          {c.todos?.de ? `${c.todos.si} de ${c.todos.de} · ` : ''}{sum.total} {t.analytics.sumCompared}
        </Typography>
      </Box>

      {/* Coincidencia por pares */}
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <SectionLabel>{t.analytics.sumPairs}</SectionLabel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
          <PairRow pair="timing_ia" a="timing" b="ia" x={c.timing_ia} t={t} />
          <PairRow pair="timing_hibrido" a="timing" b="hibrido" x={c.timing_hibrido} t={t} />
          <PairRow pair="ia_hibrido" a="ia" b="hibrido" x={c.ia_hibrido} t={t} />
        </Box>
      </Box>

      {/* Cómo reparte cada uno */}
      <Box sx={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        '@container (min-width: 720px)': { gridColumn: '1 / -1' },
        '@container (min-width: 1100px)': { gridColumn: 'auto' },
      }}>
        <SectionLabel>{t.analytics.sumDistribution}</SectionLabel>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
          {METHODS.map(m => <DistributionRow key={m} method={m} counts={sum.por_metodo?.[m]} t={t} />)}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.6, rowGap: 0.5, mt: 1.4 }}>
          {present.map(k => (
            <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: COMMON_CONFIG[k].color }} />
              <Typography sx={{ fontSize: '0.7rem', color: C.muted }}>{t.analytics[COMMON_CONFIG[k].tKey]}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
    </Box>
  )
}
