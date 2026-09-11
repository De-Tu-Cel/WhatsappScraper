'use client'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { INSTANCES_CHANGED_EVENT } from '../hooks/useDailyCapStats'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Divider from '@mui/material/Divider'
import Switch from '@mui/material/Switch'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import QrCodeIcon from '@mui/icons-material/QrCode'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import SmartphoneIcon from '@mui/icons-material/Smartphone'
import EditIcon from '@mui/icons-material/Edit'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import InsightsIcon from '@mui/icons-material/Insights'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment'
import DonutLargeIcon from '@mui/icons-material/DonutLarge'
import BarChartIcon from '@mui/icons-material/BarChart'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import { alpha } from '@mui/material/styles'
import { Chart } from './chart/Chart'
import { ChartLegends } from './chart/ChartLegends'
import { useApexChart } from './chart/useApexChart'
import { useLang } from '../context/LangContext'

const token = () => typeof window !== 'undefined' ? localStorage.getItem('user_token') : ''

const STATUS_COLOR = {
  // Evolution API / generic
  open:          '#22c55e',
  connected:     '#22c55e',
  connecting:    '#f59e0b',
  close:         '#ef4444',
  disconnected:  '#ef4444',
  // WAHA statuses (uppercase)
  WORKING:       '#22c55e',
  SCAN_QR_CODE:  '#f59e0b',
  STARTING:      '#f59e0b',
  STOPPED:       '#ef4444',
  FAILED:        '#ef4444',
  // wwebjs statuses
  initializing:  '#f59e0b',
  authenticated: '#f59e0b',
  need_scan:     '#f59e0b',
  auth_failure:  '#ef4444',
  error:         '#ef4444',
  not_found:     '#64748b',
  unknown:       '#64748b',
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'var(--card-bg, rgba(255,255,255,0.04))',
    fontSize: '0.88rem',
    borderRadius: 2,
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& input': { color: 'var(--text, #f1f5f9)' },
  '& label': { color: 'var(--text-muted, rgba(255,255,255,0.4))' },
  '& label.Mui-focused': { color: 'var(--accent,#3b82f6)' },
}

const DIALOG_SX = {
  '& .MuiDialog-paper': {
    bgcolor: 'var(--card-bg, #0d1117)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    minWidth: 360,
  },
}

const STAT_CHIP_SX = {
  bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))',
  color: 'var(--text-muted, rgba(255,255,255,0.5))',
  border: '1px solid var(--border, rgba(255,255,255,0.1))',
  fontSize: '0.68rem', fontWeight: 600, height: 22,
}

// Same pattern as Prospects/Analytics' stats row (icon + conic-gradient
// ring showing % of the total + label + value), reused here instead of
// plain chips + a separate segmented bar — that combo repeated the same
// "connected/disconnected" counts twice (once as chips, once as the bar's
// legend) and didn't match the rest of the app's stat-card language.
function InstStatCard({ icon, color, value, label, subtitle, percent }) {
  const pct = percent == null ? 100 : Math.max(0, Math.min(100, percent))
  return (
    <Box sx={{
      flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4,
      px: 2, py: 1.6,
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0, p: '3px',
        background: `conic-gradient(${color} ${pct}%, var(--border, rgba(255,255,255,0.12)) ${pct}% 100%)`,
      }}>
        <Box sx={{
          width: '100%', height: '100%', borderRadius: '50%',
          bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.76rem', color: 'var(--text)', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
            {subtitle}
          </Typography>
        )}
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {value}
        </Typography>
      </Box>
    </Box>
  )
}

// Header for each chart sub-card (pie/bar/trend) — a colored icon in a
// small gradient box next to the title, same visual language as the
// Performance banner's own icon box, instead of plain flat text that read
// dull/washed-out next to the rest of the panel's more designed sections.
function ChartCardHeader({ icon, color, title }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2 }}>
      <Box sx={{
        width: 24, height: 24, borderRadius: '7px', flexShrink: 0,
        background: `linear-gradient(135deg, ${alpha(color, 0.24)} 0%, ${alpha(color, 0.08)} 100%)`,
        border: `1px solid ${alpha(color, 0.32)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)' }}>
        {title}
      </Typography>
    </Box>
  )
}

// Gradient stat card ported from minimal-ui-kit/material-kit-react's
// AnalyticsWidgetSummary (icon + real %-change badge + value + sparkline),
// adapted to our theme tokens and real backend fields instead of their mock data.
// "vs prior" por sí solo no decía prior QUÉ (el usuario lo reportó confuso)
// — como cada tarjeta ya sabe qué rango está activo (day/week/month/year),
// se puede nombrar exactamente el periodo con el que se compara en vez de
// un genérico "anterior".
const RANGE_COMPARE_LABEL = {
  day:   { en: 'vs previous day',   es: 'vs día anterior' },
  week:  { en: 'vs previous week',  es: 'vs semana anterior' },
  month: { en: 'vs previous month', es: 'vs mes anterior' },
  year:  { en: 'vs previous year',  es: 'vs año anterior' },
}

function DashStatCard({ color, value, title, pctChange, sparkData, categories, range, lang }) {
  const chartOptions = useApexChart({
    chart: { sparkline: { enabled: true } },
    colors: [color],
    stroke: { width: 2 },
    fill: { opacity: 1, gradient: { opacityFrom: 0.4, opacityTo: 0 } },
    // Antes tooltip:false dejaba la curva puramente decorativa — no se
    // podía saber qué valor representaba cada punto. Ahora sí muestra el
    // valor real (y la fecha del bucket, si se pasó) al pasar el mouse.
    // followCursor:true se quitó — en sparklines minúsculos (44x26) que se
    // vuelven a montar en cada cambio de rango, ese modo se quedaba con el
    // tooltip pegado en pantalla tras salir con el mouse; el anclaje fijo
    // (default de ApexCharts) sí se oculta bien en mouseleave.
    // fixed.position lo ancla arriba a la derecha en vez de flotar justo
    // sobre el cursor — en un espacio tan chico, el tooltip por defecto
    // terminaba tapando el número grande de al lado en vez de solo indicar
    // el punto de la curva.
    tooltip: {
      enabled: true,
      x: { show: !!categories },
      y: { formatter: (v) => v == null ? '' : v.toLocaleString() },
      fixed: { enabled: true, position: 'topRight', offsetX: 6, offsetY: -32 },
    },
    markers: { size: 0, hover: { size: 4 } },
    // La base comparte yaxis.tickAmount y xaxis.tooltip/crosshairs con las
    // gráficas grandes (que sí muestran eje) — en sparkline mode ApexCharts
    // no siempre suprime los ticks solo, dejando unos numeritos diminutos
    // pegados a la izquierda del mini-gráfico; y la "pill" flotante de
    // categoría (xaxis.tooltip) no cabe en 44px de ancho — ambos se apagan
    // aquí, dejando el crosshair + punto de color como única señal de "aquí
    // está el mouse" en un espacio tan chico.
    xaxis: {
      categories, labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: { labels: { show: false } },
  })
  const up = (pctChange ?? 0) >= 0
  return (
    <Box sx={{
      minWidth: 0, p: 1.2, borderRadius: 2.5,
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
    }}>
      <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', mb: 0.6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.6 }}>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>{value}</Typography>
        {sparkData && sparkData.length > 1 && (
          <Chart type="line" series={[{ name: title, data: sparkData }]} options={chartOptions} height={26} width={44} sx={{ mr: 0.8 }} />
        )}
      </Box>
      {pctChange != null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.8 }}>
          <Box sx={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: up ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
          }}>
            {up ? <TrendingUpIcon sx={{ fontSize: 10, color: '#4ade80' }} /> : <TrendingDownIcon sx={{ fontSize: 10, color: '#f87171' }} />}
          </Box>
          <Typography sx={{ fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ fontWeight: 700, color: up ? '#4ade80' : '#f87171' }}>{up ? '+' : ''}{pctChange}%</Box>
            <Box component="span" sx={{ color: 'var(--text-muted)' }}>
              {' '}{(RANGE_COMPARE_LABEL[range] ?? RANGE_COMPARE_LABEL.week)[lang === 'en' ? 'en' : 'es']}
            </Box>
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// Wide card, different shape from DashStatCard on purpose — a gauge for the
// combined average (real aggregate over the range) next to a per-instance
// breakdown (real per-instance %, same instance_health_logs data, just not
// collapsed into one number) so the extra width is actually used for more
// information instead of the same small card just stretched out.
function InstanceHealthCard({ avgUptime, uptimeMap, instances, lang }) {
  const gaugeOptions = useApexChart({
    chart: { sparkline: { enabled: true } },
    colors: ['#f59e0b'],
    // 'round' line caps draw a filled dot at the arc's start even at 0% —
    // with real uptime data still at 0% for these instances, that floating
    // dot was the only visible thing on the ring, reading as a stray
    // ornament instead of "no progress yet". 'butt' caps draw nothing when
    // the arc length is zero, which is the honest empty state.
    stroke: { lineCap: 'butt' },
    plotOptions: {
      radialBar: {
        hollow: { size: '48%' },
        track: { background: 'rgba(255,255,255,0.12)', strokeWidth: '100%', margin: 0 },
        dataLabels: {
          // ApexCharts' radialBar shows a "name" sub-label ("Total" by
          // default) alongside the value unless explicitly turned off —
          // that stray "Total" text overlapping the number was the bug.
          name: { show: false },
          value: { show: true, offsetY: 2, fontSize: '0.72rem', fontWeight: 800, color: 'var(--text)', formatter: (v) => `${v}%` },
        },
      },
    },
    tooltip: { enabled: false },
  })
  // El detalle por instancia ya no vive siempre expandido en la tarjeta
  // (con varias instancias crecía hacia abajo sin control) — ahora vive en
  // un tooltip informativo al pasar el mouse, para que la tarjeta se quede
  // del mismo tamaño que sus vecinas sin importar cuántas instancias haya.
  const breakdown = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, py: 0.3, minWidth: 170 }}>
      {instances.map(inst => {
        // uptime_pct is null (not 0) when this instance has NO connect/
        // disconnect log at all — e.g. its webhook never fired since this
        // logging was added. That's "no data", not "was down all week";
        // showing a confident 0% there would be actively misleading.
        const raw = uptimeMap[inst.instance_name]?.uptime_pct
        const pct = raw == null ? null : Math.round(raw)
        return (
          <Box key={inst.instance_name} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.68rem', fontWeight: 600, color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inst.instance_name}
            </Typography>
            <Box sx={{ width: 50, height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.18)', overflow: 'hidden', flexShrink: 0 }}>
              <Box sx={{ width: `${pct ?? 0}%`, height: '100%', bgcolor: '#f59e0b', borderRadius: 2 }} />
            </Box>
            <Typography sx={{ width: 28, flexShrink: 0, textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color: pct == null ? 'var(--text-muted)' : '#f59e0b' }}>
              {pct == null ? '—' : `${pct}%`}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
  return (
    <Box sx={{
      minWidth: 0, height: '100%', p: 1.2, borderRadius: 2.5, bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* La fila (gauge + texto) antes se estiraba a todo el ancho de la
         tarjeta (heredado del alignItems:stretch de arriba) y el texto
         quedaba pegado a la izquierda con un hueco vacío a la derecha; ahora
         el contenedor centra la fila como bloque en vez de estirarla. */}
      <Tooltip title={instances.length > 0 ? breakdown : ''} arrow placement="bottom-start">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: instances.length > 0 ? 'help' : 'default' }}>
          <Chart type="radialBar" series={[avgUptime == null ? 0 : Math.round(avgUptime)]} options={gaugeOptions} height={58} width={58} />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lang === 'en' ? 'Avg. uptime' : 'Uptime prom.'}
              </Typography>
              {instances.length > 0 && <InfoOutlinedIcon sx={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7, flexShrink: 0 }} />}
            </Box>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1 }}>
              {avgUptime == null ? '—' : `${avgUptime}%`}
            </Typography>
          </Box>
        </Box>
      </Tooltip>
    </Box>
  )
}

// Real, non-invented metrics: messages sent + distinct contacts reached per
// instance (from message_logs, GET /admin/instances/metrics), real period-
// over-period %-change, and uptime % (from instance_health_logs, reused from
// the existing health endpoint). Chart components ported from
// minimal-ui-kit/material-kit-react (ApexCharts + its theming), adapted to
// this app's own theme tokens and data.
// chartsReady=false keeps every chart in its skeleton state even once data
// has loaded — needed because page.jsx's tab system pre-mounts every panel
// in the background a few seconds after boot (kept alive forever via
// display:none instead of unmounting), so this dashboard's 6 ApexCharts
// instances were rendering into a still-hidden, zero-size container the
// very first time. ApexCharts can't measure a display:none container and
// throws deep inside its own render pipeline ("Cannot read properties of
// undefined (reading 'filter')", no app stack frame — confirmed by testing:
// it reproduced with the tab never opened, in a burst of exactly 6, one per
// chart instance). Real charts only render once this tab has genuinely been
// activated at least once; until then they show the same loading skeleton.
function InstancesDashboard({ metrics, loading, range, onRangeChange, lang, chartsReady = true }) {
  const showCharts = !loading && chartsReady
  const RANGES = [
    { key: 'day',   label: lang === 'en' ? 'Today' : 'Hoy' },
    { key: 'week',  label: lang === 'en' ? 'Week' : 'Semana' },
    { key: 'month', label: lang === 'en' ? 'Month' : 'Mes' },
    { key: 'year',  label: lang === 'en' ? 'Year' : 'Año' },
  ]
  const rows = metrics?.instances ?? []
  const uptimeMap = metrics?.uptime ?? {}
  const withActivity = rows.filter(r => r.messages_sent > 0)
  // Solo promedia instancias con dato REAL de uptime — antes un `?? 0`
  // trataba "sin ningún log de conexión" igual que "confirmado 0% conectado",
  // arrastrando el promedio hacia abajo con instancias de las que en
  // realidad no sabemos nada (ver InstanceHealthCard más abajo).
  const uptimeValues = withActivity
    .map(r => uptimeMap[r.instance_name]?.uptime_pct)
    .filter(v => v != null)
  const avgUptime = uptimeValues.length
    ? Math.round(uptimeValues.reduce((sum, v) => sum + v, 0) / uptimeValues.length)
    : null
  const timeseries = metrics?.timeseries ?? []

  // Leyendas clicleables (mostrar/ocultar serie) para el bar y el trend —
  // el pastel no la necesita, cada slice ya es su propia serie visual.
  // toggleSeries() es imperativo (ApexCharts no expone esto por props), de
  // ahí la ref hacia la instancia real detrás de nuestro wrapper <Chart>.
  const barChartRef = useRef(null)
  const trendChartRef = useRef(null)
  const [hiddenBarSeries, setHiddenBarSeries] = useState(() => new Set())
  const [hiddenTrendSeries, setHiddenTrendSeries] = useState(() => new Set())
  const toggleSeries = (chartRef, hiddenSet, setHiddenSet) => (label) => {
    // Este react-apexcharts (2.1.1, la reescritura basada en hooks) asigna
    // la instancia directo a chartRef.current, sin el wrapper `.chart` que
    // sí tenía la versión de clase anterior.
    chartRef.current?.toggleSeries(label)
    setHiddenSet(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  const pieOptions = useApexChart({
    chart: { sparkline: { enabled: true } },
    colors: ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#60a5fa'],
    labels: withActivity.map(r => r.instance_name),
    stroke: { width: 0 },
    dataLabels: { enabled: true, dropShadow: { enabled: false } },
    tooltip: { y: { formatter: (v) => `${v.toLocaleString()} ${lang === 'en' ? 'messages' : 'mensajes'}` } },
    plotOptions: { pie: { donut: { labels: { show: false } } } },
  })

  // legend:false en ambas — la leyenda nativa de ApexCharts incrusta un
  // <foreignObject><style>...</style></foreignObject> con el CSS del layout
  // de su leyenda directamente en el SVG; en ciertos hovers ese bloque se
  // renderizaba como texto plano visible en vez de aplicarse como estilo
  // (el bug de CSS crudo apareciendo en pantalla). El pie ya usaba nuestro
  // propio <ChartLegends> en DOM normal en vez de la leyenda nativa — se
  // hace lo mismo aquí para bar/trend, evitando el bug de raíz en vez de
  // parchar el renderer interno de la librería.
  const barOptions = useApexChart({
    colors: [alpha('#3b82f6', 0.85), alpha('#22c55e', 0.85)],
    stroke: { width: 2, colors: ['transparent'] },
    plotOptions: { bar: { borderRadius: 6, borderRadiusApplication: 'end', columnWidth: '55%' } },
    xaxis: { categories: withActivity.map(r => r.instance_name), labels: { style: { fontSize: '10px' }, rotate: -35 } },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => v.toLocaleString() } },
  })

  const trendOptions = useApexChart({
    colors: ['#3b82f6', '#22c55e'],
    xaxis: { categories: timeseries.map(r => r.bucket), labels: { style: { fontSize: '10px' } } },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => v.toLocaleString() } },
  })

  const emptyState = (msg) => (
    <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{msg}</Typography>
    </Box>
  )
  const noActivityMsg = lang === 'en' ? 'No activity in this range' : 'Sin actividad en este rango'

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))',
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Mismo banner de encabezado (glow + ícono en caja degradada) que usa
         el título de Prospects, en vez del texto plano de antes que se veía
         apagado comparado con el resto de la app. */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap',
        px: 2, py: 1.6, position: 'relative',
        background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.12) 0%, rgba(var(--accent-rgb,59,130,246),0.04) 60%, transparent 100%)',
        borderBottom: '1px solid rgba(var(--accent-rgb,59,130,246),0.15)',
        '&::after': {
          content: '""', position: 'absolute', bottom: 0, left: 16, right: 16, height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.4) 40%, rgba(var(--accent-rgb,59,130,246),0.4) 60%, transparent)',
        },
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.25) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
            border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <InsightsIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 16 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
              {lang === 'en' ? 'Performance' : 'Desempeño'}
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
              {lang === 'en' ? 'Messages, contacts & uptime by instance' : 'Mensajes, contactos y uptime por instancia'}
            </Typography>
          </Box>
        </Box>
        {/* Segmented control — un solo contenedor "pastilla" donde el rango
           activo lleva su propio fondo sólido (con sombra sutil), en vez de
           chips sueltos todos con el mismo peso visual. */}
        <Box sx={{
          display: 'flex', gap: 0.2, p: 0.3, borderRadius: 2,
          bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.1))',
        }}>
          {RANGES.map(r => {
            const active = range === r.key
            return (
              <Box key={r.key} onClick={() => onRangeChange(r.key)}
                sx={{
                  px: 1.5, py: 0.5, borderRadius: 1.6, cursor: 'pointer', userSelect: 'none',
                  fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.8,
                  color: active ? '#fff' : 'var(--text-muted)',
                  bgcolor: active ? 'var(--accent, #3b82f6)' : 'transparent',
                  boxShadow: active ? '0 2px 8px rgba(var(--accent-rgb,59,130,246),0.4)' : 'none',
                  transition: 'background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
                  '&:hover': active ? {} : { bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))', color: 'var(--text)' },
                }}>
                {r.label}
              </Box>
            )
          })}
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>

      {!showCharts ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
          <Skeleton variant="rounded" sx={{ height: 110, bgcolor: 'var(--border)', borderRadius: 3 }} />
          <Skeleton variant="rounded" sx={{ height: 110, bgcolor: 'var(--border)', borderRadius: 3 }} />
          <Skeleton variant="rounded" sx={{ height: 110, bgcolor: 'var(--border)', borderRadius: 3 }} />
          <Skeleton variant="rounded" sx={{ height: 110, bgcolor: 'var(--border)', borderRadius: 3 }} />
        </Box>
      ) : (
        // Grid fijo de 4 columnas — las cuatro tarjetas (mensajes, contactos,
        // tasa de respuesta, uptime) reducidas y compactadas para caber
        // juntas en una sola fila.
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
          <DashStatCard range={range} color="#3b82f6" lang={lang}
            value={(metrics?.total_messages ?? 0).toLocaleString()} title={lang === 'en' ? 'Messages sent' : 'Mensajes enviados'}
            pctChange={metrics?.messages_pct_change} sparkData={timeseries.map(r => r.messages_sent)}
            categories={timeseries.map(r => r.bucket)} />
          <DashStatCard range={range} color="#22c55e" lang={lang}
            value={(metrics?.total_contacts ?? 0).toLocaleString()} title={lang === 'en' ? 'Contacts reached' : 'Contactos alcanzados'}
            pctChange={metrics?.contacts_pct_change} sparkData={timeseries.map(r => r.contacts_reached)}
            categories={timeseries.map(r => r.bucket)} />
          {/* % de contactos que respondieron al menos una vez — no
             "mensajes entrantes ÷ salientes" (verificado contra producción:
             ese conteo crudo daba 115%-245%, ya que un contacto puede
             responder varias veces al mismo envío). Contar contactos
             distintos mantiene un porcentaje real y acotado. */}
          <DashStatCard range={range} color="#a78bfa" lang={lang}
            value={metrics?.response_rate != null ? `${metrics.response_rate}%` : '—'}
            title={lang === 'en' ? 'Response rate' : 'Tasa de respuesta'}
            pctChange={metrics?.response_rate_pct_change} />
          <InstanceHealthCard avgUptime={avgUptime} uptimeMap={uptimeMap} instances={withActivity} lang={lang} />
        </Box>
      )}

      {/* Pie (share of volume by instance) + trend over time, side by side —
         skeleton placeholders match each real section's shape (circle for
         the pie, rectangle for the line chart) instead of just disappearing
         until the data lands. */}
      {/* Pastel + barras conviven en una fila (los dos son "reparto por
         instancia", pero en formas distintas) para que quepan cómodos en la
         columna angosta; la de tendencia en el tiempo, que necesita ancho
         real para las fechas del eje X, va sola abajo a todo lo ancho. Así
         los tres no terminan apilados uno igual al otro (repetitivo). */}
      {!showCharts ? (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ flex: '1 1 190px', minWidth: 180, borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
            <Skeleton variant="text" width="65%" sx={{ mb: 1, bgcolor: 'var(--border)', fontSize: '0.8rem' }} />
            <Skeleton variant="circular" width={140} height={140} sx={{ my: 1.5, mx: 'auto', bgcolor: 'var(--border)' }} />
          </Box>
          <Box sx={{ flex: '1 1 220px', minWidth: 200, borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
            <Skeleton variant="text" width="50%" sx={{ mb: 1, bgcolor: 'var(--border)', fontSize: '0.8rem' }} />
            <Skeleton variant="rounded" height={220} sx={{ bgcolor: 'var(--border)' }} />
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ flex: '1 1 190px', minWidth: 180, borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
            <ChartCardHeader icon={<DonutLargeIcon sx={{ fontSize: 14, color: '#8b5cf6' }} />} color="#8b5cf6"
              title={lang === 'en' ? 'Share by instance' : 'Reparto por instancia'} />
            {withActivity.length === 0 ? emptyState(noActivityMsg) : (
              <>
                {/* width/height van como props reales (no solo dentro de sx)
                   — sx solo estilaba el div contenedor; el <ReactApexChart>
                   interno recibía width='100%' (default) y height
                   undefined, lo que puede dejar el SVG sin altura real. */}
                <Chart type="pie" width={150} height={150} series={withActivity.map(r => r.messages_sent)} options={pieOptions}
                  sx={{ my: 1.5, mx: 'auto' }} />
                <Divider sx={{ borderStyle: 'dashed', mb: 1.2 }} />
                {/* Con varias instancias esta leyenda crecía sin límite hacia
                   abajo (una fila por cada una); ahora tiene una altura fija
                   con scroll propio, así no importa cuántas instancias
                   tengan actividad, la tarjeta no crece con ellas. */}
                <Box sx={{
                  maxHeight: 64, overflowY: 'auto', pr: 0.5,
                  '&::-webkit-scrollbar': { width: 4 },
                  '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
                  '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
                }}>
                  <ChartLegends
                    labels={pieOptions.labels}
                    colors={pieOptions.colors}
                    values={withActivity.map(r => r.messages_sent.toLocaleString())}
                    sx={{ justifyContent: 'center', flexWrap: 'wrap' }}
                  />
                </Box>
              </>
            )}
          </Box>
          {/* Per-instance breakdown — solo instancias con actividad real en
             el rango: con 21+ instancias registradas (la mayoría inactivas
             en cualquier rango dado), listarlas todas sería una pared de
             barras en cero que no dice nada y no escala. */}
          <Box sx={{ flex: '1 1 220px', minWidth: 200, borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
            <ChartCardHeader icon={<BarChartIcon sx={{ fontSize: 14, color: '#3b82f6' }} />} color="#3b82f6"
              title={lang === 'en' ? 'Per-instance breakdown' : 'Detalle por instancia'} />
            {withActivity.length === 0 ? emptyState(noActivityMsg) : (
              <>
                <ChartLegends
                  labels={[lang === 'en' ? 'Messages sent' : 'Mensajes enviados', lang === 'en' ? 'Contacts reached' : 'Contactos alcanzados']}
                  colors={[alpha('#3b82f6', 0.85), alpha('#22c55e', 0.85)]}
                  hidden={hiddenBarSeries}
                  onToggle={toggleSeries(barChartRef, hiddenBarSeries, setHiddenBarSeries)}
                  sx={{ mb: 1 }}
                />
                <Chart chartRef={barChartRef} type="bar" height={Math.max(180, Math.min(260, withActivity.length * 40))}
                  series={[
                    { name: lang === 'en' ? 'Messages sent' : 'Mensajes enviados', data: withActivity.map(r => r.messages_sent) },
                    { name: lang === 'en' ? 'Contacts reached' : 'Contactos alcanzados', data: withActivity.map(r => r.contacts_reached) },
                  ]}
                  options={barOptions} />
              </>
            )}
          </Box>
        </Box>
      )}

      {!showCharts ? (
        <Box sx={{ borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
          <Skeleton variant="text" width="45%" sx={{ mb: 1, bgcolor: 'var(--border)', fontSize: '0.8rem' }} />
          <Skeleton variant="rounded" height={240} sx={{ bgcolor: 'var(--border)' }} />
        </Box>
      ) : (
        <Box sx={{ borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))', p: 1.5 }}>
          <ChartCardHeader icon={<ShowChartIcon sx={{ fontSize: 14, color: '#22c55e' }} />} color="#22c55e"
            title={lang === 'en' ? 'Messages & contacts over time' : 'Mensajes y contactos en el tiempo'} />
          {timeseries.length === 0 ? emptyState(noActivityMsg) : (
            <>
              <ChartLegends
                labels={[lang === 'en' ? 'Messages' : 'Mensajes', lang === 'en' ? 'Contacts' : 'Contactos']}
                colors={['#3b82f6', '#22c55e']}
                hidden={hiddenTrendSeries}
                onToggle={toggleSeries(trendChartRef, hiddenTrendSeries, setHiddenTrendSeries)}
                sx={{ mb: 1 }}
              />
              <Chart chartRef={trendChartRef} type="area" height={240}
                series={[
                  { name: lang === 'en' ? 'Messages' : 'Mensajes', data: timeseries.map(r => r.messages_sent) },
                  { name: lang === 'en' ? 'Contacts' : 'Contactos', data: timeseries.map(r => r.contacts_reached) },
                ]}
                options={trendOptions} />
            </>
          )}
        </Box>
      )}
      </Box>
    </Box>
  )
}

const STATUS_LABEL_ES = { open: 'Conectada', connected: 'Conectada', connecting: 'Conectando', close: 'Desconectada', disconnected: 'Desconectada', WORKING: 'Conectada', SCAN_QR_CODE: 'Escanear QR', STARTING: 'Iniciando', STOPPED: 'Detenida', FAILED: 'Error', unknown: 'Desconocida', initializing: 'Iniciando', authenticated: 'Autenticando', need_scan: 'Escanear QR', auth_failure: 'Error auth', error: 'Error', not_found: 'No iniciada' }
const STATUS_LABEL_EN = { open: 'Connected', connected: 'Connected', connecting: 'Connecting', close: 'Disconnected', disconnected: 'Disconnected', WORKING: 'Connected', SCAN_QR_CODE: 'Scan QR', STARTING: 'Starting', STOPPED: 'Stopped', FAILED: 'Failed', unknown: 'Unknown', initializing: 'Starting', authenticated: 'Authenticating', need_scan: 'Scan QR', auth_failure: 'Auth error', error: 'Error', not_found: 'Not started' }

const DISCONNECT_LABEL_ES = { banned: 'Baneado por WhatsApp', logged_out: 'Cerró sesión', conflict: 'Conflicto de dispositivo', multidevice: 'Conflicto multi-dispositivo', server_error: 'Error interno', restart: 'Requiere reinicio', replaced: 'Sesión reemplazada', timeout: 'Timeout de conexión', closed: 'Conexión cerrada', disconnected: 'Desconectada', failed: 'Error de conexión' }
const DISCONNECT_LABEL_EN = { banned: 'Banned by WhatsApp', logged_out: 'Logged out', conflict: 'Device conflict', multidevice: 'Multi-device conflict', server_error: 'Internal error', restart: 'Restart required', replaced: 'Session replaced', timeout: 'Connection timeout', closed: 'Connection closed', disconnected: 'Disconnected', failed: 'Connection error' }

// ── InstanceRow ──────────────────────────────────────────────────────────────
function InstanceRow({ inst, onQr, onEditNumber, onRemove, onWarmup }) {
  const { t, lang } = useLang()
  const [hover, setHover] = useState(false)
  const status = inst.live_status || 'unknown'
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
  const isConnected = ['open', 'connected'].includes(status)
  const statusLabel = (lang === 'en' ? STATUS_LABEL_EN : STATUS_LABEL_ES)[status] ?? (lang === 'en' ? 'Unknown' : 'Desconocida')
  const REASON_COLOR = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c', disconnected: '#f87171', failed: '#f87171' }
  const disconnectColor = inst.disconnect_reason ? (REASON_COLOR[inst.disconnect_reason] ?? '#f87171') : color
  // While actively reconnecting (connecting) show the connecting color, not the stale disconnect reason
  const displayColor = (isConnected || status === 'connecting') ? color : disconnectColor
  const reasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
  const displayLabel = (!isConnected && status !== 'connecting' && reasonLabel) ? reasonLabel : statusLabel
  return (
    <Box
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1.2, py: 0.9, borderRadius: 1.5,
        bgcolor: hover ? 'var(--item-hover, rgba(255,255,255,0.04))' : 'transparent',
        border: '1px solid transparent',
        transition: 'all 0.15s',
        ...(hover && { borderColor: 'var(--border, rgba(255,255,255,0.08))' }),
      }}
    >
      {/* Status dot */}
      <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: displayColor,
          boxShadow: isConnected ? `0 0 6px ${displayColor}aa` : 'none',
          position: 'relative', zIndex: 1 }} />
        {isConnected && (
          <Box sx={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: displayColor, opacity: 0.4,
            '@keyframes ping': {
              '0%':   { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.4 },
              '75%':  { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
              '100%': { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
            },
            animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
          }} />
        )}
      </Box>
      {/* WhatsApp profile avatar — real photo when the provider exposed one (wwebjs),
          initials fallback otherwise (also covers providers we don't fetch a photo for yet) */}
      <Box sx={{
        width: 26, height: 26, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
        bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {inst.profile_pic_url
          ? <Box component="img" src={inst.profile_pic_url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>
              {(inst.profile_name || inst.label || inst.name || '?').slice(0, 2).toUpperCase()}
            </Typography>}
      </Box>
      {/* Name + number */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.label || inst.name}</Typography>
          {inst.provider === 'waha' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#60a5fa',
              bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)',
              px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0, letterSpacing: '0.03em' }}>
              WAHA
            </Typography>
          )}
          {inst.provider === 'wwebjs' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#34d399',
              bgcolor: 'rgba(52,211,153,0.12)', px: 0.6, py: 0.1, borderRadius: 0.5 }}>WWEBJS</Typography>
          )}
          {inst.provider === 'wasender' && (
            <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#a78bfa',
              bgcolor: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)',
              px: 0.5, borderRadius: 0.8, lineHeight: 1.6, flexShrink: 0, letterSpacing: '0.03em' }}>
              WS
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inst.profile_name ? `${inst.profile_name} · ` : ''}{inst.number ? `+${inst.number}` : t.inst.noNumber}
        </Typography>
      </Box>
      {/* Right side: status label (resting) or action icons (hover) */}
      {hover ? (
        <Box sx={{ display: 'flex', gap: 0.2, flexShrink: 0, alignItems: 'center' }}>
          <Tooltip title={inst.warmup_mode ? (lang === 'en' ? 'Warmup ON — 20 msg/day' : 'Calentamiento ON — 20 msg/día') : (lang === 'en' ? 'Warmup OFF — 150 msg/day' : 'Calentamiento OFF — 150 msg/día')} placement="top">
            <Switch
              size="small"
              checked={!!inst.warmup_mode}
              onChange={() => onWarmup(inst)}
              onClick={e => e.stopPropagation()}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#fbbf24' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#fbbf24' },
              }}
            />
          </Tooltip>
          <Tooltip title={t.inst.connectQr} placement="top">
            <IconButton size="small" onClick={() => onQr(inst)}
              sx={{ color: 'var(--accent,#60a5fa)', p: 0.4, '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)' } }}>
              <QrCodeIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          {/* Antes iba en morado fijo (#a78bfa) en vez de seguir el acento
             elegido en Ajustes, igual que el ícono de QR de al lado. */}
          <Tooltip title={lang === 'en' ? 'Edit phone number' : 'Editar número'} placement="top">
            <IconButton size="small" onClick={() => onEditNumber(inst)}
              sx={{ color: 'var(--accent,#60a5fa)', p: 0.4, '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)' } }}>
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={lang === 'en' ? 'Remove from user' : 'Quitar de este usuario'} placement="top">
            <IconButton size="small" onClick={() => onRemove(inst)}
              sx={{ color: 'var(--text-muted)', p: 0.4, '&:hover': { color: '#f87171', bgcolor: 'rgba(248,113,113,0.1)' } }}>
              <LinkOffIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {inst.ack_degraded && (
            <Tooltip title={lang === 'en' ? 'Delivery degraded — messages not reaching recipients' : 'Entrega degradada — mensajes no llegan a destinatarios'} placement="top">
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#f87171',
                bgcolor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                px: 0.5, borderRadius: 0.8, lineHeight: 1.6, cursor: 'default' }}>⚠ ACK</Typography>
            </Tooltip>
          )}
          {inst.warmup_mode && (
            <Tooltip title={lang === 'en' ? 'Warmup mode — 20 msg/day' : 'Modo calentamiento — 20 msg/día'} placement="top">
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#fbbf24',
                bgcolor: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                px: 0.5, borderRadius: 0.8, lineHeight: 1.6, cursor: 'default' }}>20/d</Typography>
            </Tooltip>
          )}
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: displayColor, letterSpacing: '0.01em', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ── UserCard ─────────────────────────────────────────────────────────────────
function UserCard({ user, instances, onAddSlot, onQr, onEditNumber, onRemove, onWarmup, cardIndex = 0 }) {
  const { t, lang } = useLang()
  const connectedCount = instances.filter(i => ['open', 'connected'].includes(i.live_status)).length
  const isAdmin = user.role === 'admin'
  // Derivados de var(--accent) en vez de morado/azul fijos — misma fórmula
  // que ya usan las tarjetas de usuario en Admin: Admin usa el acento tal
  // cual, Agent una versión mezclada con gris (misma familia, distinguible,
  // y ambos cambian solos si cambia el color base elegido en Ajustes).
  // roleAlpha(a) reemplaza el truco de "${roleColor}NN" (sufijo hex de
  // alpha) que solo funciona con strings hex planos, no con var()/color-mix().
  const roleSolid = isAdmin ? 'var(--accent, #3b82f6)' : 'color-mix(in srgb, var(--accent, #3b82f6) 55%, #94a3b8 45%)'
  const roleAlpha = (a) => isAdmin
    ? `rgba(var(--accent-rgb, 59,130,246), ${a})`
    : `color-mix(in srgb, ${roleSolid} ${Math.round(a * 100)}%, transparent)`
  const roleColor    = roleSolid
  const avatarBg     = roleAlpha(0.18)
  const avatarBorder = roleAlpha(0.55)
  const initials = (user.display_name || user.username || '?').slice(0, 2).toUpperCase()
  const slots = 5
  const emptySlots = Math.max(0, slots - instances.length)
  const hasRotation = connectedCount >= 2
  const roleLabel = isAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')
  const connectedWord = connectedCount === 1 ? t.inst.connectedSingular : t.inst.connectedPlural
  const glowColor = roleAlpha(0.22)
  return (
    <Box sx={{
      bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
      display: 'flex', flexDirection: 'column', gap: 0,
      border: '1px solid var(--border)',
      transition: 'border-color 0.25s, box-shadow 0.25s',
      '&:hover': { borderColor: roleColor, boxShadow: `0 0 0 1px ${roleAlpha(0.157)}, 0 8px 28px ${glowColor}` },
      '@keyframes fadeUp': {
        '0%':   { opacity: 0, transform: 'translateY(14px)' },
        '100%': { opacity: 1, transform: 'translateY(0)' },
      },
      animation: 'fadeUp 0.38s ease both',
      animationDelay: `${cardIndex * 0.06}s`,
    }}>
      {/* User header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 2, flexShrink: 0,
          bgcolor: avatarBg, border: `1.5px solid ${avatarBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: roleColor }}>{initials}</Typography>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.display_name || user.username}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: roleColor, fontWeight: 600, mt: 0.1 }}>
            {roleLabel}
          </Typography>
        </Box>
        <Chip
          label={`${instances.length}/${slots}`}
          size="small"
          sx={{ fontSize: '0.65rem', fontWeight: 700, height: 20,
            bgcolor: 'var(--item-hover)',
            color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        />
      </Box>

      <Divider sx={{ borderColor: 'var(--border)', mb: instances.length === 0 ? 0 : 1.2 }} />

      {instances.length === 0 ? (
        /* ── Empty state ── */
        <Box onClick={onAddSlot} sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          py: 2, gap: 1, cursor: 'pointer', borderRadius: 2, mt: 1,
          border: `1px dashed ${roleAlpha(0.188)}`,
          bgcolor: roleAlpha(0.05),
          transition: 'all 0.18s',
          '&:hover': { bgcolor: roleAlpha(0.12), borderColor: roleAlpha(0.376) },
        }}>
          <Box sx={{ display: 'flex', gap: 0.7 }}>
            {Array(5).fill(null).map((_, i) => (
              <Box key={i} sx={{ width: 9, height: 9, borderRadius: '50%',
                border: `1.5px dashed ${roleAlpha(0.271)}`, transition: 'all 0.18s' }} />
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: roleColor, fontWeight: 600, opacity: 0.75 }}>
            {lang === 'en' ? 'No instances assigned' : 'Sin instancias asignadas'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1.4, py: 0.45, borderRadius: 1.5, fontSize: '0.63rem', fontWeight: 700,
            bgcolor: roleAlpha(0.094), color: roleColor, border: `1px solid ${roleAlpha(0.157)}` }}>
            <AddIcon sx={{ fontSize: 12 }} />
            {lang === 'en' ? 'Assign from sidebar' : 'Asignar del sidebar'}
          </Box>
        </Box>
      ) : (
        <>
          {/* Instance rows */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, mb: 1.2 }}>
            {instances.map(inst => (
              <InstanceRow key={inst.name} inst={inst} onQr={onQr} onEditNumber={onEditNumber} onRemove={onRemove} onWarmup={onWarmup} />
            ))}
          </Box>
          {/* Capacity bar — 5 slot dots + add button */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 1, borderTop: '1px solid var(--border)' }}>
            <Box sx={{ display: 'flex', gap: 0.7, alignItems: 'center', flex: 1 }}>
              {Array.from({ length: 5 }).map((_, i) => {
                const inst = instances[i]
                if (inst) {
                  const status = inst.live_status || 'unknown'
                  const color = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                  const isConn = ['open', 'connected'].includes(status)
                  return (
                    <Tooltip key={i} title={inst.name} placement="top">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0,
                        boxShadow: isConn ? `0 0 5px ${color}99` : 'none', cursor: 'default' }} />
                    </Tooltip>
                  )
                }
                return (
                  <Tooltip key={i} title={t.inst.addSlot} placement="top">
                    <Box onClick={onAddSlot} sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      border: '1.5px dashed var(--text-muted)', cursor: 'pointer',
                      transition: 'border-color 0.15s',
                      '&:hover': { borderColor: roleColor, bgcolor: avatarBg } }} />
                  </Tooltip>
                )
              })}
            </Box>
            {hasRotation ? (
              <Chip label={t.inst.rotationActive} size="small"
                sx={{ fontSize: '0.58rem', height: 17, bgcolor: 'rgba(34,197,94,0.1)',
                  color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', fontWeight: 600 }} />
            ) : emptySlots > 0 ? (
              <Box onClick={onAddSlot}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0,
                  transition: 'color 0.15s', '&:hover': { color: roleColor } }}>
                <AddIcon sx={{ fontSize: 12 }} />
                {t.inst.addSlot}
              </Box>
            ) : null}
          </Box>
        </>
      )}

      {/* Stats line (only when instances exist) */}
      {instances.length > 0 && (
        <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', mt: 1 }}>
          {connectedCount} {t.inst.connectedOf} {instances.length} {connectedWord}
        </Typography>
      )}
    </Box>
  )
}

// ── InlineUserPicker ─────────────────────────────────────────────────────────
function InlineUserPicker({ instanceName, users, instances, onAssign, t, lang }) {
  const [search, setSearch] = useState('')
  const filtered = users.filter(u =>
    (u.display_name || u.username || '').toLowerCase().includes(search.toLowerCase())
  )
  const allFull = filtered.length > 0 && filtered.every(u => {
    const uid = u._id || u.id || u.username
    return instances.filter(i => i.assigned_to === uid).length >= 5
  })
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1,
        borderBottom: '1px solid var(--border)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.04)' }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--accent, #60a5fa)',
          textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
          {lang === 'en' ? 'Assign to' : 'Asignar a'}
        </Typography>
        {allFull && (
          <Typography sx={{ fontSize: '0.58rem', color: '#fbbf24', fontWeight: 600 }}>
            {lang === 'en' ? 'All full' : 'Todos llenos'}
          </Typography>
        )}
      </Box>

      {/* Search — only when > 4 users */}
      {users.length > 4 && (
        <Box sx={{ px: 1.2, pt: 0.8, pb: 0.2 }}>
          <Box component="input"
            placeholder={t.inst.searchUser}
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ display: 'block', width: '100%', boxSizing: 'border-box',
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              borderRadius: 1.5, py: 0.5, px: 1.2, color: 'var(--text)', fontSize: '0.75rem',
              outline: 'none', fontFamily: 'inherit',
              '&:focus': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.5)' } }}
          />
        </Box>
      )}

      {/* User list rows */}
      <Box sx={{ maxHeight: 220, overflowY: 'auto',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-button': { display: 'none' },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 4 },
      }}>
        {filtered.map((u, idx) => {
          const uid      = u._id || u.id || u.username
          const uAdmin   = u.role === 'admin'
          // Derivados de var(--accent) en vez de morado/azul fijos, misma
          // fórmula que ya usan las tarjetas de usuario en Admin — Admin
          // usa el acento tal cual, Agent una versión mezclada con gris.
          const uRoleSolid = uAdmin ? 'var(--accent, #3b82f6)' : 'color-mix(in srgb, var(--accent, #3b82f6) 55%, #94a3b8 45%)'
          const uColor   = uRoleSolid
          const uBg      = uAdmin ? 'rgba(var(--accent-rgb,59,130,246),0.18)' : `color-mix(in srgb, ${uRoleSolid} 18%, transparent)`
          const uBorder  = uAdmin ? 'rgba(var(--accent-rgb,59,130,246),0.45)' : `color-mix(in srgb, ${uRoleSolid} 45%, transparent)`
          const uInitials = (u.display_name || u.username || '?').slice(0, 2).toUpperCase()
          const uSlots   = instances.filter(i => i.assigned_to === uid).length
          const isFull   = uSlots >= 5
          const roleLabel = uAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')
          return (
            <Box key={uid}
              onClick={() => !isFull && onAssign(instanceName, u)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.4,
                px: 1.5, py: 1,
                borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: isFull ? 'not-allowed' : 'pointer',
                opacity: isFull ? 0.45 : 1,
                transition: 'background 0.12s',
                '&:hover': isFull ? {} : { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.07)' },
              }}>
              {/* Avatar */}
              <Box sx={{ width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
                bgcolor: uBg, border: `1.5px solid ${uBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: uColor }}>
                  {uInitials}
                </Typography>
              </Box>
              {/* Name + role */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                  {u.display_name || u.username}
                </Typography>
                <Typography sx={{ fontSize: '0.6rem', color: uColor, fontWeight: 600, lineHeight: 1.2 }}>
                  {roleLabel}
                </Typography>
              </Box>
              {/* Slot counter / Full badge */}
              <Box sx={{ flexShrink: 0, px: 0.9, py: 0.35, borderRadius: 1.2,
                bgcolor: isFull ? 'rgba(239,68,68,0.12)' : `${uBg}`,
                border: `1px solid ${isFull ? 'rgba(239,68,68,0.3)' : uBorder}` }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700,
                  color: isFull ? '#f87171' : uColor, lineHeight: 1 }}>
                  {uSlots}/5
                </Typography>
              </Box>
            </Box>
          )
        })}
        {filtered.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t.inst.noResults}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Bulk assign picker dialog ─────────────────────────────────────────────────
function BulkPickDialog({ open, onClose, selectedNames, users, instances, onAssign, lang }) {
  const [search, setSearch] = useState('')
  const count = selectedNames.size
  const filtered = users.filter(u =>
    (u.display_name || u.username || '').toLowerCase().includes(search.toLowerCase())
  )
  return (
    <Dialog open={open} onClose={onClose} slotProps={{ paper: { sx: {
      bgcolor: 'var(--card-bg)', border: '1px solid rgba(59,130,246,0.3)',
      borderRadius: 3, minWidth: 320, maxWidth: 400,
      backgroundImage: 'none',
    } }}}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>
          {lang === 'en' ? `Assign ${count} instance${count !== 1 ? 's' : ''}` : `Asignar ${count} instancia${count !== 1 ? 's' : ''}`}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', mt: 0.3 }}>
          {lang === 'en' ? 'Select the target user' : 'Elige el usuario destino'}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 1, pb: 0, px: 2 }}>
        {users.length > 4 && (
          <Box component="input"
            placeholder={lang === 'en' ? 'Search user…' : 'Buscar usuario…'}
            value={search} onChange={e => setSearch(e.target.value)}
            sx={{ display: 'block', width: '100%', boxSizing: 'border-box', mb: 1.5,
              bgcolor: 'var(--item-hover)', border: '1px solid var(--border)',
              borderRadius: 1.5, py: 0.6, px: 1.2, color: 'var(--text)', fontSize: '0.78rem',
              outline: 'none', fontFamily: 'inherit',
              '&:focus': { borderColor: 'rgba(59,130,246,0.5)' } }}
          />
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, pb: 1.5 }}>
          {filtered.map(u => {
            const uid       = u._id || u.id || u.username
            const uAdmin    = u.role === 'admin'
            const uColor    = uAdmin ? '#a78bfa' : '#60a5fa'
            const uBg       = uAdmin ? 'rgba(167,139,250,0.14)' : 'rgba(59,130,246,0.12)'
            const uBorder   = uAdmin ? 'rgba(167,139,250,0.35)' : 'rgba(59,130,246,0.35)'
            const uInitials = (u.display_name || u.username || '?').slice(0, 2).toUpperCase()
            const curSlots  = instances.filter(i => i.assigned_to === uid).length
            const canAssign = Math.max(0, 5 - curSlots)
            const willAssign = Math.min(count, canAssign)
            const isFull    = canAssign === 0
            return (
              <Box key={uid}
                onClick={() => !isFull && onAssign(u)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.2, p: 1.2,
                  borderRadius: 2, border: '1px solid var(--border)',
                  bgcolor: 'rgba(255,255,255,0.025)',
                  cursor: isFull ? 'not-allowed' : 'pointer',
                  opacity: isFull ? 0.45 : 1,
                  transition: 'background 0.12s, border-color 0.12s',
                  '&:hover': isFull ? {} : { bgcolor: 'rgba(59,130,246,0.07)', borderColor: 'rgba(59,130,246,0.25)' },
                }}>
                <Box sx={{ width: 34, height: 34, borderRadius: 1.5, flexShrink: 0,
                  bgcolor: uBg, border: `1.5px solid ${uBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: uColor }}>
                    {uInitials}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.display_name || u.username}
                  </Typography>
                  {willAssign < count && !isFull ? (
                    <Typography sx={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 500 }}>
                      {lang === 'en' ? `${willAssign}/${count} fit` : `${willAssign}/${count} caben`}
                    </Typography>
                  ) : (
                    <Typography sx={{ fontSize: '0.65rem', color: uColor }}>
                      {uAdmin ? 'Admin' : (lang === 'en' ? 'Agent' : 'Agente')}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ flexShrink: 0, px: 0.9, py: 0.35, borderRadius: 1.2,
                  bgcolor: isFull ? 'rgba(239,68,68,0.12)' : uBg,
                  border: `1px solid ${isFull ? 'rgba(239,68,68,0.3)' : uBorder}` }}>
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700,
                    color: isFull ? '#f87171' : uColor, lineHeight: 1 }}>
                    {curSlots}/5
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 1.5, pt: 0 }}>
        <Button onClick={onClose} size="small"
          sx={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.8rem' }}>
          {lang === 'en' ? 'Cancel' : 'Cancelar'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function InstancesPanel({ isActive } = {}) {
  const { t, lang } = useLang()
  // page.jsx's tab system mounts every panel in the background a few
  // seconds after boot (kept alive via display:none once "visited", never
  // truly unmounted) — isActive is only true while THIS tab is the one on
  // screen. Once it's been true at least once, keep it true from then on:
  // switching away and back shouldn't re-hide charts that already rendered
  // safely. See chartsReady on InstancesDashboard for why this matters.
  const everActiveRef = useRef(isActive)
  if (isActive) everActiveRef.current = true
  const [instances,    setInstances]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [users,        setUsers]        = useState([])
  const skeletonCounts = useRef({ users: [], unassigned: 3 })

  // ── Dashboard (messages sent / contacts reached / uptime per instance) ──
  const [metrics,        setMetrics]        = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsRange,   setMetricsRange]   = useState('week')

  // ── Create dialog ──
  const [createOpen,   setCreateOpen]   = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newNumber,    setNewNumber]    = useState('')
  const [creating,     setCreating]     = useState(false)
  const [createErr,    setCreateErr]    = useState('')

  // ── Pairing code dialog ──
  const [pairOpen,     setPairOpen]     = useState(false)
  const [pairPhone,    setPairPhone]    = useState('')
  const [pairCode,     setPairCode]     = useState(null)
  const [pairLoading,  setPairLoading]  = useState(false)
  const [pairErr,      setPairErr]      = useState('')

  // ── Add number wizard ──
  const [wizardOpen,    setWizardOpen]    = useState(false)
  const [wizardStep,    setWizardStep]    = useState(1)
  const [wizardPhone,   setWizardPhone]   = useState('')
  const [wizardName,    setWizardName]    = useState('')
  const [wizardCode,      setWizardCode]      = useState(null)
  const [wizardLoading,   setWizardLoading]   = useState(false)
  const [wizardErr,       setWizardErr]       = useState('')
  const [wizardConnected, setWizardConnected] = useState(false)
  const [wizardInstName,  setWizardInstName]  = useState('')
  const [wizardCountdown, setWizardCountdown] = useState(null)
  const wizardPollRef    = useRef(null)
  const wizardCountRef   = useRef(null)

  // ── SMSFast inside wizard ──
  const [wizardPhoneMode,  setWizardPhoneMode]  = useState('manual') // 'manual' | 'smsfast'
  const [sfCountry,        setSfCountry]        = useState(54)
  const [sfInfo,           setSfInfo]           = useState(null)
  const [sfInfoLoading,    setSfInfoLoading]    = useState(false)
  const [sfBuying,         setSfBuying]         = useState(false)
  const [sfActivationId,   setSfActivationId]   = useState(null)
  const [sfBoughtNumber,   setSfBoughtNumber]   = useState(null)
  const [sfCancelSecs,     setSfCancelSecs]     = useState(120)
  const [sfCancelling,     setSfCancelling]     = useState(false)
  const sfCancelRef        = useRef(null)

  // ── QR dialog ──
  const [qrOpen,       setQrOpen]       = useState(false)
  const [qrTarget,     setQrTarget]     = useState(null)
  const [qrImage,      setQrImage]      = useState(null)
  const qrPollRef   = useRef(null)
  const connPollRef = useRef(null)

  // ── Assign dialog ──
  const [assignOpen,     setAssignOpen]     = useState(false)
  const [assignTarget,   setAssignTarget]   = useState(null)
  const [assignUserId,   setAssignUserId]   = useState('')
  const [assignUserName, setAssignUserName] = useState('')
  const [assignSearch,   setAssignSearch]   = useState('')
  const [assigning,      setAssigning]      = useState(false)

  // ── Delete dialog ──
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)
  const [syncing,      setSyncing]      = useState(false)
  const [snack,        setSnack]        = useState({ open: false, msg: '' })

  // ── WAHA session dialog ──
  const [wahaOpen,      setWahaOpen]      = useState(false)
  const [wahaName,      setWahaName]      = useState('')
  const [wahaLoading,   setWahaLoading]   = useState(false)
  const [wahaErr,       setWahaErr]       = useState('')
  const [wahaQr,        setWahaQr]        = useState(null)   // base64 QR image
  const [wahaConnected, setWahaConnected] = useState(false)
  const [wahaScanned,   setWahaScanned]   = useState(false)  // phone scanned QR, now authenticating
  const [wahaSyncing,   setWahaSyncing]   = useState(false)
  const [wahaStatus,    setWahaStatus]    = useState('')     // STOPPED | STARTING | SCAN_QR_CODE | WORKING
  const wahaQrPollRef    = useRef(null)
  const wahaQrShownRef   = useRef(false)   // tracks if QR was ever displayed (avoids stale closure)
  // Link method: QR (default, scan with camera) or pairing code (type 8 chars into
  // WhatsApp manually — no camera/video call needed, ~3min window vs QR's ~20s,
  // useful when the phone being linked isn't in the same room).
  const [wahaLinkMethod, setWahaLinkMethod] = useState('qr') // 'qr' | 'code'
  const [wahaPhone,       setWahaPhone]       = useState('')
  const [wahaPairingCode, setWahaPairingCode] = useState(null)

  // ── Wasender create dialog ──
  const [wsOpen,      setWsOpen]      = useState(false)
  const [wsName,      setWsName]      = useState('')
  const [wsPhone,     setWsPhone]     = useState('')
  const [wsLoading,   setWsLoading]   = useState(false)
  const [wsErr,       setWsErr]       = useState('')
  const [wsQr,        setWsQr]        = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [wsScanned,   setWsScanned]   = useState(false)
  const [wsId,        setWsId]        = useState(null)
  const wsQrPollRef  = useRef(null)
  const wsQrShownRef = useRef(false)

  // ── Card menu (kept for assign dialog compatibility) ──
  const [menuAnchor,   setMenuAnchor]   = useState(null)
  const [menuInst,     setMenuInst]     = useState(null)

  // ── Pick instance dialog ──
  const [pickOpen,        setPickOpen]        = useState(false)
  const [pickTargetUser,  setPickTargetUser]  = useState(null)
  const [pickSelected,    setPickSelected]    = useState(new Set())
  const [unassignedOpen,  setUnassignedOpen]  = useState(true)
  const [expandedAssign,  setExpandedAssign]  = useState(null)
  const [sidebarAnchor,   setSidebarAnchor]   = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userSearch,       setUserSearch]       = useState('')
  const sidebarRowRefs = useRef({})

  // La columna de tarjetas de usuario no debe crecer sin límite conforme se
  // agreguen más usuarios (eso empujaba toda la página hacia abajo) — se
  // mide en vivo la altura real de Performance (su vecino en la misma fila)
  // y esa misma altura se le aplica como tope, con su propio scroll interno,
  // en vez de un número fijo adivinado que se desalinearía apenas cambiara
  // el contenido de Performance (idioma, rango, cantidad de instancias).
  const perfColRef = useRef(null)
  const [perfHeight, setPerfHeight] = useState(null)
  useEffect(() => {
    const el = perfColRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setPerfHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Multi-select assign ──
  const [selectedInsts, setSelectedInsts] = useState(new Set())
  const [bulkPickOpen,  setBulkPickOpen]  = useState(false)

  const fetchInstances = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/instances', { headers: { 'x-user-token': token() }, cache: 'no-store' })
      if (r.ok) setInstances(await r.json())
    } catch {}
    finally { setLoading(false) }
  }, [])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/instances?action=sync', { method: 'POST', headers: { 'x-user-token': token() } })
      await fetchInstances()
    } catch {}
    finally { setSyncing(false) }
  }, [fetchInstances])

  const handleSyncWaha = useCallback(async () => {
    setWahaSyncing(true)
    try {
      await Promise.allSettled([
        fetch('/api/admin/instances/sync-waha',    { method: 'POST', headers: { 'x-user-token': token() } }),
        fetch('/api/admin/instances/sync-wasender',{ method: 'POST', headers: { 'x-user-token': token() } }),
        fetch('/api/admin/instances/sync-wwebjs',  { method: 'POST', headers: { 'x-user-token': token() } }),
      ])
      await fetchInstances()
      setSnack({ open: true, msg: lang === 'en' ? 'Sessions synced' : 'Sesiones sincronizadas' })
    } catch {}
    finally { setWahaSyncing(false) }
  }, [fetchInstances, lang])

  function wahaClose() {
    if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current)
    setWahaOpen(false); setWahaName(''); setWahaQr(null)
    setWahaConnected(false); setWahaScanned(false); setWahaErr(''); setWahaLoading(false); setWahaStatus('')
    setWahaLinkMethod('qr'); setWahaPhone(''); setWahaPairingCode(null)
    wahaQrShownRef.current = false
  }

  async function handleWahaCreate() {
    const name = wahaName.trim()
    const isCode = wahaLinkMethod === 'code'
    const phone = wahaPhone.replace(/\D/g, '')
    if (!name) { setWahaErr(lang === 'en' ? 'Name required' : 'El nombre es requerido'); return }
    if (isCode && !phone) {
      setWahaErr(lang === 'en' ? 'Phone number required (e.g. 521234567890)' : 'Número requerido (ej. 521234567890)')
      return
    }
    setWahaLoading(true); setWahaErr(''); setWahaQr(null); setWahaPairingCode(null); setWahaConnected(false); setWahaScanned(false)
    try {
      const r = await fetch('/api/wwebjs/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify(isCode ? { name, phone_number: phone } : { name }),
      })
      const d = await r.json()
      if (!r.ok) { setWahaErr(d.detail || 'Error al crear sesión'); setWahaLoading(false); return }

      // Keep wahaLoading=true until QR/code arrives
      if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current)
      wahaQrPollRef.current = setInterval(async () => {
        try {
          const [linkRes, stRes] = await Promise.all([
            fetch(isCode ? `/api/wwebjs/session/${name}/pairing-code` : `/api/wwebjs/session/${name}/qr`),
            fetch(`/api/wwebjs/session/${name}/status`),
          ])
          if (stRes.ok) {
            const sd = await stRes.json()
            const rawStatus = sd.status || ''
            setWahaStatus(rawStatus)
            if (rawStatus === 'connected') {
              clearInterval(wahaQrPollRef.current)
              wahaQrShownRef.current = false
              setWahaQr(null); setWahaPairingCode(null); setWahaScanned(false); setWahaConnected(true); setWahaLoading(false)
              fetchInstances()
              return
            }
            // QR scanned / code entered → authenticated state → show "autenticando…"
            if (wahaQrShownRef.current && rawStatus === 'authenticated') {
              setWahaQr(null); setWahaPairingCode(null)
              setWahaScanned(true)
            }
          }
          if (linkRes.ok) {
            const ld = await linkRes.json()
            if (isCode && ld.code) {
              wahaQrShownRef.current = true
              setWahaPairingCode(ld.code)
              setWahaScanned(false)
              setWahaLoading(false)
            } else if (!isCode && ld.qr) {
              wahaQrShownRef.current = true
              setWahaQr(ld.qr)   // already a full data: URL
              setWahaScanned(false)
              setWahaLoading(false)
            }
          }
        } catch {}
      }, 2500)
      // intentionally no finally — wahaLoading stays true until QR/code arrives
    } catch (e) { setWahaErr(e.message); setWahaLoading(false) }
  }

  function wsClose() {
    if (wsQrPollRef.current) clearInterval(wsQrPollRef.current)
    setWsOpen(false); setWsName(''); setWsPhone(''); setWsQr(null)
    setWsConnected(false); setWsScanned(false); setWsErr(''); setWsLoading(false)
    wsQrShownRef.current = false; setWsId(null)
  }

  async function handleWsCreate() {
    const name = wsName.trim()
    const phone = wsPhone.trim()
    if (!name) { setWsErr(lang === 'en' ? 'Name required' : 'El nombre es requerido'); return }
    if (!phone) { setWsErr(lang === 'en' ? 'Phone number required (e.g. +521234567890)' : 'Número requerido (ej. +521234567890)'); return }
    setWsLoading(true); setWsErr(''); setWsQr(null); setWsConnected(false)
    try {
      const r = await fetch('/api/wasender/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name, phone_number: phone }),
      })
      const d = await r.json()
      if (!r.ok) { setWsErr(d.detail || d.error || 'Error al crear sesión'); setWsLoading(false); return }
      const wid = d.id
      if (!wid) { setWsErr('No se obtuvo wasender_id'); setWsLoading(false); return }
      setWsId(wid)
      // If create already returned a QR (from auto-connect), show it immediately
      if (d.qrCode) {
        try {
          const qrRes = await fetch(`/api/wasender/session/qr/${wid}`)
          if (qrRes.ok) {
            const qd = await qrRes.json()
            if (qd.base64) { wsQrShownRef.current = true; setWsQr(qd.base64); setWsLoading(false) }
          }
        } catch {}
      }
      if (wsQrPollRef.current) clearInterval(wsQrPollRef.current)
      wsQrPollRef.current = setInterval(async () => {
        try {
          const [qrRes, stRes] = await Promise.all([
            fetch(`/api/wasender/session/qr/${wid}`),
            fetch(`/api/wasender/session/status/${wid}`),
          ])
          if (stRes.ok) {
            const sd = await stRes.json()
            const stState = sd.state || ''
            const stStatus = (sd.status || '').toLowerCase()
            if (stState === 'open' || stStatus === 'connected') {
              clearInterval(wsQrPollRef.current)
              wsQrShownRef.current = false
              setWsQr(null); setWsScanned(false); setWsConnected(true); setWsLoading(false)
              fetchInstances()
              return
            }
            if (wsQrShownRef.current && stState && stState !== 'close') {
              setWsQr(null); setWsScanned(true)
            }
          }
          if (qrRes.ok) {
            const qd = await qrRes.json()
            if (qd.base64) {
              wsQrShownRef.current = true
              setWsQr(qd.base64)
              setWsScanned(false)
              setWsLoading(false)
            }
          }
        } catch {}
      }, 2500)
    } catch (e) { setWsErr(e.message); setWsLoading(false) }
  }

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/users', { headers: { 'x-user-token': token() } })
      if (r.ok) setUsers(await r.json())
    } catch {}
  }, [])

  const fetchMetrics = useCallback(async (range) => {
    setMetricsLoading(true)
    try {
      const r = await fetch(`/api/admin/instances/metrics?range=${range}`, { headers: { 'x-user-token': token() } })
      if (r.ok) setMetrics(await r.json())
    } catch {} finally { setMetricsLoading(false) }
  }, [])

  useEffect(() => { fetchInstances(); fetchUsers() }, [fetchInstances, fetchUsers])
  useEffect(() => { fetchMetrics(metricsRange) }, [fetchMetrics, metricsRange])
  // Cleanup QR polls on unmount / hot reload
  useEffect(() => () => { if (wahaQrPollRef.current) clearInterval(wahaQrPollRef.current) }, [])
  useEffect(() => () => { if (wsQrPollRef.current) clearInterval(wsQrPollRef.current) }, [])

  // Actualizar conteos para skeleton cada vez que llegan datos reales
  useEffect(() => {
    if (loading || (!users.length && !instances.length)) return
    skeletonCounts.current = {
      users: users.map(u => {
        const uid = u._id || u.id || u.username
        return instances.filter(i => i.assigned_to === uid).length
      }),
      unassigned: instances.filter(i => !i.assigned_to).length,
    }
  }, [loading, users, instances])

  // Auto-refresh pairing code when countdown expires
  const wizardInstNameRef = useRef('')
  const wizardPhoneRef    = useRef('')
  useEffect(() => { wizardInstNameRef.current = wizardInstName }, [wizardInstName])
  useEffect(() => { wizardPhoneRef.current    = wizardPhone    }, [wizardPhone])
  useEffect(() => {
    if (wizardCountdown !== 0 || !wizardInstNameRef.current) return
    ;(async () => {
      try {
        const phone = wizardPhoneRef.current.replace(/\D/g, '')
        const r = await fetch(`/api/evolution/instance/${wizardInstNameRef.current}?action=pairing-code`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        })
        const d = await r.json()
        const code = d.code || d.pairingCode || d.pairing_code
        if (code) { setWizardCode(code); startWizardCountdown() }
      } catch {}
    })()
  }, [wizardCountdown])

  const [qrStatus, setQrStatus] = useState('loading') // loading | retrying | ready | error

  // ── QR polling ──────────────────────────────────────────────────────────────
  const fetchQrOnce = useCallback(async (name, provider, wasenderId) => {
    try {
      const resolvedProvider = provider ?? qrTarget?.provider
      const isWaha     = resolvedProvider === 'waha'
      const isWasender = resolvedProvider === 'wasender'
      const isWwebjs   = resolvedProvider === 'wwebjs'
      const wid        = wasenderId ?? qrTarget?.wasender_id
      const url = isWasender
        ? `/api/wasender/session/qr/${wid}`
        : isWaha
        ? `/api/waha/session/qr/${name}`
        : isWwebjs
        ? `/api/wwebjs/session/${name}/qr`
        : `/api/evolution/instance/${name}?type=qr`
      const r = await fetch(url)
      if (!r.ok) {
        if (isWwebjs) {
          // wwebjs returns 400 with status when no QR yet — check if already connected
          const d = await r.json().catch(() => ({}))
          if (d?.status === 'connected') return 'scanned'
        }
        return false
      }
      const d = await r.json()
      // wwebjs returns { qr: 'data:image/png;base64,...', status }
      if (isWwebjs) {
        if (d?.status === 'connected') return 'scanned'
        if (d?.qr) {
          setQrImage(d.qr)
          setQrStatus('ready')
          return true
        }
        return false
      }
      const b64 = d.base64 || d.qrcode?.base64 || d.qr?.base64
      if (b64) {
        setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
        setQrStatus('ready')
        return true
      }
      // WAHA returns status=WORKING / wasender returns state=open when already connected
      if (d?.status === 'WORKING' || d?.state === 'open') return 'scanned'
    } catch {}
    return false
  }, [qrTarget])

  const startQrPoll = useCallback(async (name, withLogout = false, provider, wasenderId) => {
    if (qrPollRef.current) clearTimeout(qrPollRef.current)
    setQrImage(null); setQrStatus(withLogout ? 'retrying' : 'loading')

    if (withLogout) {
      try {
        const resolvedProvider = provider ?? qrTarget?.provider
        const isWasender = resolvedProvider === 'wasender'
        const wid        = wasenderId ?? qrTarget?.wasender_id
        if (isWasender) {
          await fetch(`/api/wasender/session/${wid}/restart`, { method: 'POST' })
        } else if (resolvedProvider === 'waha') {
          await fetch(`/api/waha/session/logout/${name}`, { method: 'POST' })
        } else if (resolvedProvider === 'wwebjs') {
          // Re-start the session so it generates a fresh QR
          await fetch(`/api/wwebjs/session/${name}/start`, { method: 'POST' }).catch(() => {})
        } else {
          await fetch(`/api/evolution/instance/${name}?action=logout`, { method: 'POST' })
        }
      } catch {}
      await new Promise(r => setTimeout(r, 700))
      setQrStatus('loading')
    }

    let attempts = 0
    const poll = async () => {
      attempts++
      const ok = await fetchQrOnce(name, provider, wasenderId)
      if (ok === 'scanned') {
        // User scanned QR — show connecting state and stop; connPoll closes dialog on WORKING/open
        setQrStatus('connecting')
        return
      } else if (ok) {
        // QR shown — re-poll to catch rotation (~60s for WAHA, shorter for wasender)
        attempts = 0
        qrPollRef.current = setTimeout(poll, 300)
      } else {
        if (attempts >= 10) { setQrStatus('error'); return }
        qrPollRef.current = setTimeout(poll, 1500)
      }
    }
    poll()
  }, [fetchQrOnce, qrTarget])

  function closeQr() {
    if (qrPollRef.current)   clearTimeout(qrPollRef.current)
    if (connPollRef.current) clearInterval(connPollRef.current)
    setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
  }

  const startConnPoll = useCallback((name, provider, wasenderId) => {
    if (connPollRef.current) clearInterval(connPollRef.current)
    let firstPoll = true
    let prevState = ''
    const resolvedProvider = provider ?? qrTarget?.provider
    const isWaha     = resolvedProvider === 'waha'
    const isWasender = resolvedProvider === 'wasender'
    const isWwebjs   = resolvedProvider === 'wwebjs'
    const wid        = wasenderId ?? qrTarget?.wasender_id
    connPollRef.current = setInterval(async () => {
      try {
        const url = isWasender
          ? `/api/wasender/session/status/${wid}`
          : isWaha
          ? `/api/waha/session/status/${name}`
          : isWwebjs
          ? `/api/wwebjs/session/${name}/status`
          : `/api/evolution/instance/${name}`
        const r = await fetch(url)
        if (!r.ok) return
        const d = await r.json()
        // wwebjs: { status: 'connected' | 'need_scan' | ... }
        const state = isWwebjs
          ? d?.status || ''
          : (d?.instance?.state || d?.state || '')
        if (firstPoll) {
          firstPoll = false
          prevState = state
          return
        }
        const isConnected = isWwebjs
          ? state === 'connected'
          : ['open', 'connected'].includes(state)
        const wasConnected = isWwebjs
          ? prevState === 'connected'
          : ['open', 'connected'].includes(prevState)
        prevState = state
        if (isConnected && !wasConnected) {
          if (connPollRef.current) clearInterval(connPollRef.current)
          if (qrPollRef.current)   clearTimeout(qrPollRef.current)
          setQrOpen(false); setQrTarget(null); setQrImage(null); setQrStatus('loading')
          fetchInstances()
        }
      } catch {}
    }, 2000)
  }, [fetchInstances, qrTarget])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function closeMenu() { setMenuAnchor(null); setMenuInst(null) }

  async function handleQrClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setQrTarget(inst); setQrOpen(true); setQrStatus('loading')

    if (inst.provider === 'wasender') {
      const wid = inst.wasender_id
      if (!wid) { setQrStatus('error'); return }
      try {
        const stRes = await fetch(`/api/wasender/session/status/${wid}`)
        const stData = stRes.ok ? await stRes.json() : {}
        const wsState  = stData.state  || ''
        const wsStatus = (stData.status || '').toLowerCase()
        const isLoggedOut = wsStatus === 'logged_out' || stData.status === 'logged_out'
        if (wsState !== 'open' && wsStatus !== 'connected') {
          setQrStatus('retrying')
          if (isLoggedOut) {
            // logged_out: use /connect which clears proxy, generates QR, restores proxy
            await fetch(`/api/wasender/session/${wid}/connect`, { method: 'POST' }).catch(() => {})
          } else {
            await fetch(`/api/wasender/session/${wid}/restart`, { method: 'POST' }).catch(() => {})
            for (let i = 0; i < 13; i++) {
              await new Promise(r => setTimeout(r, 1500))
              const sRes = await fetch(`/api/wasender/session/status/${wid}`).catch(() => null)
              if (sRes?.ok) {
                const sd = await sRes.json()
                if (sd.state === 'open' || (sd.status || '').toLowerCase() === 'connected') break
              }
            }
          }
          setQrStatus('loading')
        }
      } catch {}
      startQrPoll(inst.name, false, 'wasender', wid)
      startConnPoll(inst.name, 'wasender', wid)
      return
    }

    if (inst.provider === 'wwebjs') {
      // Ensure session is started in wwebjs-service
      try {
        const stRes = await fetch(`/api/wwebjs/session/${inst.name}/status`)
        const stData = stRes.ok ? await stRes.json() : {}
        const st = stData.status || ''
        if (st === 'connected') {
          // Already connected — nothing to do, just close
          setQrOpen(false); setQrTarget(null); setQrStatus('loading')
          return
        }
        if (st === 'not_found') {
          setQrStatus('retrying')
          await fetch(`/api/wwebjs/session/${inst.name}/start`, { method: 'POST' }).catch(() => {})
          setQrStatus('loading')
        }
        // For need_scan/disconnected/initializing just show QR
      } catch {}
      startQrPoll(inst.name, false, 'wwebjs', null)
      startConnPoll(inst.name, 'wwebjs', null)
      return
    }

    if (inst.provider === 'waha') {
      try {
        const stRes = await fetch(`/api/waha/session/status/${inst.name}`)
        const stData = stRes.ok ? await stRes.json() : {}
        const wahaStatus = stData.status || ''

        if (['FAILED', 'STOPPED'].includes(wahaStatus)) {
          setQrStatus('retrying')
          // 1. Logout to clear stored auth — forces a fresh QR instead of reconnect attempt
          await fetch(`/api/waha/session/logout/${inst.name}`, { method: 'POST' }).catch(() => {})
          await new Promise(r => setTimeout(r, 1500))
          // 2. Restart the session
          await fetch(`/api/waha/session/restart/${inst.name}`, { method: 'POST' }).catch(() => {})
          // 3. Poll until SCAN_QR_CODE (max 20s)
          for (let i = 0; i < 13; i++) {
            await new Promise(r => setTimeout(r, 1500))
            const sRes = await fetch(`/api/waha/session/status/${inst.name}`).catch(() => null)
            if (sRes?.ok) {
              const sd = await sRes.json()
              if (sd.status === 'SCAN_QR_CODE' || sd.status === 'WORKING') break
            }
          }
          setQrStatus('loading')
        }
      } catch {}
    }

    startQrPoll(inst.name, false, inst.provider, null)
    startConnPoll(inst.name, inst.provider, null)
  }

  function handleAssignClick(directInst) {
    const inst = directInst || menuInst; closeMenu()
    setAssignTarget(inst)
    setAssignUserId(inst.assigned_to ?? '')
    const storedName = inst.assigned_name ?? ''
    setAssignUserName(/^[a-f0-9]{24}$/.test(storedName) ? '' : storedName)
    setAssignSearch('')
    setAssignOpen(true)
  }

  function handleDeleteClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setDeleteTarget(inst)
  }

  const [pairTarget, setPairTarget] = useState(null)

  // ── Edit number dialog ──
  const [editNumberOpen,  setEditNumberOpen]  = useState(false)
  const [editNumberInst,   setEditNumberInst]   = useState(null)
  const [editNumberValue,  setEditNumberValue]  = useState('')
  const [editLabelValue,   setEditLabelValue]   = useState('')
  const [editNumberSaving, setEditNumberSaving] = useState(false)
  const [editNumberErr,    setEditNumberErr]    = useState('')

  function handleEditNumberClick(inst) {
    setEditNumberInst(inst)
    setEditNumberValue(inst?.number || '')
    // Precargar con el nombre EFECTIVO que ya se ve en toda la app (inst.label si
    // existe, si no inst.name — mismo fallback que usa la tabla) en vez de solo
    // inst.label — antes, si la instancia nunca tuvo un label propio guardado,
    // el campo se veía vacío pese a que la instancia claramente ya tenía un
    // nombre visible en otras partes, dando la impresión de que no había nada
    // que editar.
    setEditLabelValue(inst?.label || inst?.name || '')
    setEditNumberErr('')
    setEditNumberOpen(true)
  }

  async function handleEditNumberSave() {
    if (!editNumberInst) return
    const num = editNumberValue.replace(/\D/g, '')
    if (num && num.length < 8) {
      setEditNumberErr(lang === 'en' ? 'Number too short' : 'Número demasiado corto')
      return
    }
    setEditNumberSaving(true); setEditNumberErr('')
    const payload = {}
    if (num) payload.number = num
    // Comparar contra el mismo valor efectivo (label || name) que se precargó —
    // si no, con el fix de precarga de arriba, guardar sin tocar nada terminaría
    // escribiendo label=name innecesariamente cada vez.
    if (editLabelValue.trim() !== (editNumberInst?.label || editNumberInst?.name || '')) payload.label = editLabelValue.trim()
    if (!Object.keys(payload).length) { setEditNumberOpen(false); setEditNumberSaving(false); return }
    try {
      const res = await fetch(`/api/instances?name=${encodeURIComponent(editNumberInst.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { setEditNumberErr(lang === 'en' ? 'Error saving' : 'Error al guardar'); setEditNumberSaving(false); return }
      setInstances(prev => prev.map(i => i.name === editNumberInst.name ? { ...i, ...payload } : i))
      setEditNumberOpen(false)
    } catch { setEditNumberErr(lang === 'en' ? 'Network error' : 'Error de red') }
    setEditNumberSaving(false)
  }

  // ── Emulator registration dialog ──
  const [emuOpen,    setEmuOpen]    = useState(false)
  const [emuInst,    setEmuInst]    = useState('telnyx-01')
  const [emuCountry, setEmuCountry] = useState(54)
  const [emuLogs,    setEmuLogs]    = useState([])
  const [emuStep,    setEmuStep]    = useState('idle') // idle | confirming | running | success | error | done
  const [emuPreview, setEmuPreview] = useState(null)
  const [emuPreviewLoading, setEmuPreviewLoading] = useState(false)
  const emuEsRef = useRef(null)

  const SMSFAST_COUNTRIES = [
    { value: 54,  label: '🇲🇽 México' },
    { value: 36,  label: '🇨🇦 Canadá' },
    { value: 12,  label: '🇺🇸 USA (virtual)' },
    { value: 0,   label: '🌐 Cualquier país' },
  ]

  function handleEmuClick(directInst) {
    const inst = directInst || menuInst
    closeMenu()
    setEmuInst(inst?.name || 'wa-01')
    setEmuLogs([]); setEmuStep('idle')
    setEmuOpen(true)
  }

  async function handleEmuPreview() {
    setEmuPreviewLoading(true)
    try {
      const r = await fetch('/api/register/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: emuInst, country: emuCountry }),
      })
      const data = await r.json()
      setEmuPreview(data)
      setEmuStep('confirming')
    } catch (e) {
      setEmuPreview({ error: e.message, can_proceed: false, warnings: [e.message] })
      setEmuStep('confirming')
    } finally {
      setEmuPreviewLoading(false)
    }
  }

  function startEmuRegistration() {
    if (emuEsRef.current) emuEsRef.current.close()
    setEmuLogs([]); setEmuStep('running')
    const url = `/api/register/emulator-stream?phone=&instance=${encodeURIComponent(emuInst)}&country=${emuCountry}`
    const es = new EventSource(url)
    emuEsRef.current = es
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        setEmuLogs(prev => [...prev, d])
        if (d.step === 'success' || d.step === 'done') { setEmuStep('success'); es.close() }
        if (d.step === 'error') { setEmuStep('error'); es.close() }
      } catch {}
    }
    es.onerror = () => {
      setEmuLogs(prev => [...prev, { msg: 'Conexión SSE cerrada', step: 'done' }])
      setEmuStep(prev => prev === 'running' ? 'done' : prev)
      es.close()
    }
  }

  function handlePairClick() {
    const inst = menuInst; closeMenu()
    setPairPhone(''); setPairCode(null); setPairErr('')
    setPairTarget(inst)
    setPairOpen(true)
  }

  function stopWizardPoll() {
    if (wizardPollRef.current) { clearInterval(wizardPollRef.current); wizardPollRef.current = null }
  }

  function startWizardCountdown() {
    if (wizardCountRef.current) clearInterval(wizardCountRef.current)
    setWizardCountdown(60)
    wizardCountRef.current = setInterval(() => {
      setWizardCountdown(prev => {
        if (prev <= 1) { clearInterval(wizardCountRef.current); wizardCountRef.current = null; return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleRefreshCode() {
    setWizardLoading(true); setWizardErr('')
    try {
      const phone = wizardPhone.replace(/\D/g, '')
      const r = await fetch(`/api/evolution/instance/${wizardInstName}?action=pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const d = await r.json()
      const code = d.code || d.pairingCode || d.pairing_code
      if (!r.ok || !code) { setWizardErr(d.detail || d.error || t.inst.wizardErrCode) }
      else { setWizardCode(code); startWizardCountdown() }
    } catch (e) { setWizardErr(e.message) }
    finally { setWizardLoading(false) }
  }

  function startWizardPoll(instName) {
    stopWizardPoll()
    wizardPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/evolution/instance/${instName}?type=status`)
        if (!r.ok) return
        const d = await r.json()
        const state = (d.instance?.state || d.state || '').toLowerCase()
        if (state === 'open' || state === 'connected') {
          stopWizardPoll()
          setWizardConnected(true)
          fetchInstances()
        }
      } catch {}
    }, 3000)
  }

  function resetSfState() {
    if (sfCancelRef.current) { clearInterval(sfCancelRef.current); sfCancelRef.current = null }
    setWizardPhoneMode('manual')
    setSfInfo(null); setSfBuying(false); setSfActivationId(null)
    setSfBoughtNumber(null); setSfCancelSecs(120); setSfCancelling(false)
  }

  function openWizard() {
    stopWizardPoll()
    if (wizardCountRef.current) { clearInterval(wizardCountRef.current); wizardCountRef.current = null }
    resetSfState()
    setWizardStep(2); setWizardPhone(''); setWizardName(''); setWizardCode(null)
    setWizardErr(''); setWizardConnected(false); setWizardInstName(''); setWizardCountdown(null)
    setSfCountry(54)
    setWizardOpen(true)
  }

  async function fetchSfInfo(country) {
    setSfInfoLoading(true); setSfInfo(null)
    try {
      const r = await fetch(`/api/smsfast/info?country=${country}`, { cache: 'no-store' })
      const d = await r.json()
      setSfInfo(d)
    } catch {}
    finally { setSfInfoLoading(false) }
  }

  function startSfCancelCountdown() {
    if (sfCancelRef.current) clearInterval(sfCancelRef.current)
    setSfCancelSecs(120)
    sfCancelRef.current = setInterval(() => {
      setSfCancelSecs(prev => {
        if (prev <= 1) { clearInterval(sfCancelRef.current); sfCancelRef.current = null; return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSfBuy() {
    setSfBuying(true); setWizardErr('')
    try {
      const r = await fetch('/api/smsfast/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: sfCountry, maxPrice: sfInfo?.price }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d.detail || d.error || 'Error al comprar número')
      setSfActivationId(d.id)
      setSfBoughtNumber(d.number)
      setWizardPhone(d.number)
      if (!wizardName) setWizardName('wa-' + String(d.number).slice(-8))
      startSfCancelCountdown()
    } catch (e) {
      setWizardErr(e.message)
    } finally {
      setSfBuying(false)
    }
  }

  async function handleSfCancel() {
    if (!sfActivationId) return
    setSfCancelling(true)
    try {
      await fetch('/api/smsfast/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sfActivationId }),
      })
    } catch {}
    if (sfCancelRef.current) { clearInterval(sfCancelRef.current); sfCancelRef.current = null }
    setSfActivationId(null); setSfBoughtNumber(null); setWizardPhone(''); setSfCancelSecs(120)
    setSfCancelling(false)
  }

  async function handleWizardCreate() {
    if (!wizardName.trim()) { setWizardErr(t.inst.errRequired); return }
    const phone = wizardPhone.replace(/\D/g, '')
    if (!phone) { setWizardErr(lang === 'en' ? 'Phone number is required' : 'El número de teléfono es requerido'); return }
    const instName = wizardName.trim()
    setWizardLoading(true); setWizardErr('')
    try {
      const r = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name: instName, number: phone || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { setWizardErr(d.detail || t.inst.createGenErr); setWizardLoading(false); return }

      // If no phone provided — just create and close
      if (!phone) { fetchInstances(); setWizardOpen(false); setWizardLoading(false); return }

      // With phone — request pairing code
      const r2 = await fetch(`/api/evolution/instance/${instName}?action=pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const d2 = await r2.json()
      const code = d2.code || d2.pairingCode || d2.pairing_code
      if (!r2.ok || !code) { setWizardErr(d2.detail || d2.error || t.inst.wizardErrCode); setWizardLoading(false); return }
      setWizardInstName(instName)
      setWizardCode(code)
      setWizardStep(3)
      setWizardConnected(false)
      startWizardPoll(instName)
      startWizardCountdown()
      fetchInstances()
    } catch (e) {
      setWizardErr(e.message)
    } finally {
      setWizardLoading(false)
    }
  }

  async function handleRequestPairCode() {
    if (!pairPhone.trim()) { setPairErr('Ingresa el número de teléfono'); return }
    if (pairTarget?.provider === 'wasender') {
      setPairErr('WasenderAPI no soporta código de vinculación. Usa el botón QR para reconectar.')
      return
    }
    setPairLoading(true); setPairErr(''); setPairCode(null)
    try {
      const isWaha     = pairTarget?.provider === 'waha'
      const pairUrl = isWaha
        ? `/api/waha/session/pairing-code/${pairTarget?.name}`
        : `/api/evolution/instance/${pairTarget?.name}?action=pairing-code`
      const r = await fetch(pairUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pairPhone.replace(/\D/g, '') }),
      })
      const d = await r.json()
      const code = d.code || d.pairingCode || d.pairing_code
      if (!r.ok || !code) { setPairErr(d.detail || d.error || 'No se pudo generar el código'); return }
      setPairCode(code)
    } catch (e) {
      setPairErr(e.message)
    } finally {
      setPairLoading(false)
    }
  }

  async function handleCreate() {
    if (!newName.trim()) { setCreateErr(t.inst.errRequired); return }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(newName.trim()) && newName.trim().length > 1) {
      setCreateErr(t.inst.errInvalidName); return
    }
    setCreating(true); setCreateErr('')
    try {
      const r = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ name: newName.trim(), number: newNumber.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { setCreateErr(d.detail || t.inst.createGenErr); return }
      setCreateOpen(false); setNewName(''); setNewNumber('')
      fetchInstances()
    } catch { setCreateErr(t.inst.createNetErr) }
    finally { setCreating(false) }
  }

  async function handleAssign() {
    setAssigning(true)
    const action = assignUserId ? 'assign' : 'unassign'
    const found  = users.find(u => (u._id || u.id || u.username) === assignUserId)
    const resolvedName = found
      ? (found.display_name || found.username || '')
      : (assignUserName && !/^[a-f0-9]{24}$/.test(assignUserName) ? assignUserName : '')
    const body = assignUserId
      ? { user_id: assignUserId, user_name: resolvedName }
      : {}
    try {
      await fetch(`/api/instances/${assignTarget.name}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify(body),
      })
      const msg = assignUserId
        ? `${t.inst.assignSuccess} ${resolvedName}`
        : t.inst.unassignSuccess
      setAssignOpen(false)
      fetchInstances()
      window.dispatchEvent(new Event(INSTANCES_CHANGED_EVENT))
      setSnack({ open: true, msg })
    } catch {}
    finally { setAssigning(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/instances/${deleteTarget.name}`, {
        method: 'DELETE', headers: { 'x-user-token': token() },
      })
      setDeleteTarget(null); fetchInstances()
    } catch {}
    finally { setDeleting(false) }
  }

  // ── New helpers ──────────────────────────────────────────────────────────────
  function openPickForUser(user) {
    setPickTargetUser(user)
    setPickOpen(true)
  }

  function closePick() {
    setPickOpen(false)
    setPickSelected(new Set())
  }

  async function handlePickAssign(instanceName) {
    if (!pickTargetUser) return
    const userId = pickTargetUser._id || pickTargetUser.id || pickTargetUser.username
    const userName = pickTargetUser.display_name || pickTargetUser.username || ''
    await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    closePick()
    fetchInstances()
  }

  async function handlePickAssignMulti() {
    if (!pickTargetUser || pickSelected.size === 0) return
    const uid      = pickTargetUser._id || pickTargetUser.id || pickTargetUser.username
    const userName = pickTargetUser.display_name || pickTargetUser.username || ''
    const names    = [...pickSelected]
    setInstances(prev => prev.map(i => names.includes(i.name) ? { ...i, assigned_to: uid, assigned_name: userName } : i))
    closePick()
    const results = await Promise.all(names.map(name =>
      fetch(`/api/instances/${name}?action=assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: uid, user_name: userName }),
      }).then(r => r.ok)
    ))
    const ok = results.filter(Boolean).length
    const failed = names.filter((_, i) => !results[i])
    if (failed.length) setInstances(prev => prev.map(i => failed.includes(i.name) ? { ...i, assigned_to: null, assigned_name: null } : i))
    setSnack({ open: true, msg: `${ok} instancia${ok !== 1 ? 's' : ''} → ${userName}` })
  }

  async function handleInlineAssign(instanceName, user) {
    const userId   = user._id || user.id || user.username
    const userName = user.display_name || user.username || ''
    setInstances(prev => prev.map(i => i.name === instanceName ? { ...i, assigned_to: userId, assigned_name: userName } : i))
    setExpandedAssign(null)
    const r = await fetch(`/api/instances/${instanceName}?action=assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({ user_id: userId, user_name: userName }),
    })
    if (!r.ok) {
      setInstances(prev => prev.map(i => i.name === instanceName ? { ...i, assigned_to: null, assigned_name: null } : i))
      const d = await r.json().catch(() => ({}))
      setSnack({ open: true, msg: d.detail || (lang === 'en' ? 'Could not assign instance' : 'No se pudo asignar la instancia') })
      return
    }
    setSnack({ open: true, msg: `${instanceName} → ${userName}` })
  }

  async function handleQuickUnassign(inst) {
    setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, assigned_to: null, assigned_name: null } : i))
    const r = await fetch(`/api/instances/${inst.name}?action=unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({}),
    })
    if (!r.ok) fetchInstances()
    else setSnack({ open: true, msg: `${inst.name} ${t.inst.quickUnassignDone}` })
  }

  function toggleSelectInst(name) {
    setSelectedInsts(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  async function handleBulkAssign(user) {
    const uid       = user._id || user.id || user.username
    const userName  = user.display_name || user.username || ''
    const curSlots  = instances.filter(i => i.assigned_to === uid).length
    const canAssign = Math.max(0, 5 - curSlots)
    const toAssign  = [...selectedInsts].slice(0, canAssign)
    const skipped   = selectedInsts.size - toAssign.length
    setInstances(prev => prev.map(i => toAssign.includes(i.name) ? { ...i, assigned_to: uid, assigned_name: userName } : i))
    setBulkPickOpen(false)
    setSelectedInsts(new Set())
    const results = await Promise.all(toAssign.map(name =>
      fetch(`/api/instances/${name}?action=assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
        body: JSON.stringify({ user_id: uid, user_name: userName }),
      }).then(r => ({ name, ok: r.ok }))
    ))
    const failed = results.filter(r => !r.ok).map(r => r.name)
    const ok     = results.length - failed.length
    if (failed.length) setInstances(prev => prev.map(i => failed.includes(i.name) ? { ...i, assigned_to: null, assigned_name: null } : i))
    const pfx = lang === 'en'
      ? `${ok} instance${ok !== 1 ? 's' : ''} → ${userName}`
      : `${ok} instancia${ok !== 1 ? 's' : ''} → ${userName}`
    setSnack({ open: true, msg: skipped > 0
      ? `${pfx} (${skipped} ${lang === 'en' ? 'skipped, cap' : 'omitidas, límite'})`
      : pfx })
  }

  async function handleWarmupToggle(inst) {
    const optimisticVal = !inst.warmup_mode
    setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: optimisticVal } : i))
    const res = await fetch(`/api/instances/${inst.name}?action=warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-token': token() },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      const data = await res.json()
      setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: data.warmup_mode } : i))
      const label = data.warmup_mode
        ? `🌱 ${inst.name}: calentamiento ON (${data.cap} msg/día)`
        : `${inst.name}: calentamiento OFF (${data.cap} msg/día)`
      setSnack({ open: true, msg: label })
      // Los badges de cupo de las demás pestañas (search/batch/csv/campaña/
      // programados/URL individual) se quedan montados en segundo plano y no
      // saben que el cupo de este número acaba de cambiar — este evento los
      // hace refrescar de inmediato en vez de quedarse con el dato viejo.
      window.dispatchEvent(new Event(INSTANCES_CHANGED_EVENT))
    } else {
      setInstances(prev => prev.map(i => i.name === inst.name ? { ...i, warmup_mode: inst.warmup_mode } : i))
    }
  }

  const connected = instances.filter(i => ['open', 'connected'].includes(i.live_status)).length
  const disconnected = instances.filter(i => !['open','connected','connecting'].includes(i.live_status) && i.live_status).length
  const warmupCount  = instances.filter(i => i.warmup_mode).length

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2,
      overflowY: 'auto', overflowX: 'hidden', pr: 0.5,
      '&::-webkit-scrollbar': { width: 4 },
      '&::-webkit-scrollbar-button': { display: 'none' },
      '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
      '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
    }}>

      {/* Header — mismo banner (glow + ícono en caja degradada) que usa
         Performance, para que ambos títulos hagan juego en vez de que este
         se vea como texto plano al lado del otro con banner. */}
      <Box sx={{
        borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))',
        bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', flexShrink: 0,
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap',
          px: 2, py: 1.6, position: 'relative',
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.12) 0%, rgba(var(--accent-rgb,59,130,246),0.04) 60%, transparent 100%)',
          borderBottom: '1px solid rgba(var(--accent-rgb,59,130,246),0.15)',
          '&::after': {
            content: '""', position: 'absolute', bottom: 0, left: 16, right: 16, height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.4) 40%, rgba(var(--accent-rgb,59,130,246),0.4) 60%, transparent)',
          },
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.25) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PhoneAndroidIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 16 }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
                {t.inst.title}
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
                {lang === 'en' ? 'Connected sessions & user assignment' : 'Sesiones conectadas y asignación de usuarios'}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Tooltip title={lang === 'en' ? 'Refresh session status' : 'Actualizar estado de sesiones'}>
              <IconButton size="small" onClick={handleSyncWaha} disabled={wahaSyncing}
                sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--accent, #60a5fa)' } }}>
                {wahaSyncing ? <CircularProgress size={16} sx={{ color: 'var(--accent, #60a5fa)' }} />
                  : <RefreshIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={lang === 'en' ? 'Connect a new WhatsApp number via QR code' : 'Conectar un nuevo número de WhatsApp con código QR'} placement="bottom">
              {/* Antes iba en azul fijo (#60a5fa) sin importar el color de
                 paleta elegido en Ajustes, igual que el botón "Create" del
                 diálogo que abre — ahora ambos siguen var(--accent). */}
              <Button variant="outlined" startIcon={<AddIcon sx={{ fontSize: 15 }} />}
                onClick={() => { setWahaOpen(true); setWahaName(''); setWahaErr(''); setWahaQr(null); setWahaConnected(false); setWahaScanned(false); setWahaStatus('') }}
                sx={{ color: 'var(--accent, #60a5fa)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)', fontWeight: 700,
                  fontSize: '0.82rem', borderRadius: 2, textTransform: 'none', px: 2,
                  '&:hover': { borderColor: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)' } }}>
                {lang === 'en' ? 'Connect number' : 'Conectar número'}
              </Button>
            </Tooltip>
          </Box>
        </Box>

        <Box sx={{ p: 2 }}>
          {/* Stat cards — mismo patrón de ícono + anillo conic-gradient +
             label + valor que Prospects/Analytics, en una sola fila con
             Dividers verticales, en vez de chips sueltos + una barra
             segmentada aparte que repetía los mismos conteos dos veces.
             Antes esta fila no tenía skeleton propio: mientras `instances`
             seguía vacío durante la carga, se veían los conteos reales en
             cero (0 instancias, 0 conectadas...) en vez de un placeholder. */}
          {loading ? (
            <Box sx={{
              display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
              borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
              bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
            }}>
              {[0, 1, 2, 3].map(i => (
                <Fragment key={i}>
                  {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
                  <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
                    <Skeleton variant="circular" width={40} height={40} sx={{ flexShrink: 0, bgcolor: 'var(--border)' }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Skeleton variant="text" width={62} height={12} sx={{ mb: 0.5, bgcolor: 'var(--border)' }} />
                      <Skeleton variant="text" width={32} height={20} sx={{ bgcolor: 'var(--border)' }} />
                    </Box>
                  </Box>
                </Fragment>
              ))}
            </Box>
          ) : (
          <Box sx={{
            display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
            borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
            bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          }}>
            {[
              {
                key: 'total', color: 'rgba(148,163,184,0.7)',
                icon: <PhoneAndroidIcon sx={{ fontSize: 18, color: 'var(--text-muted)' }} />,
                value: instances.length.toLocaleString(), label: t.inst.statInstances,
              },
              {
                key: 'connected', color: '#4ade80',
                icon: <CheckCircleIcon sx={{ fontSize: 18, color: '#4ade80' }} />,
                value: connected.toLocaleString(), label: t.inst.statConnected,
                subtitle: instances.length > 0 ? `${Math.round((connected / instances.length) * 100)}%` : null,
                percent: instances.length > 0 ? Math.round((connected / instances.length) * 100) : 0,
              },
              {
                key: 'disconnected', color: '#f87171',
                icon: <LinkOffIcon sx={{ fontSize: 18, color: '#f87171' }} />,
                value: disconnected.toLocaleString(), label: t.inst.statDisconnected,
                subtitle: instances.length > 0 ? `${Math.round((disconnected / instances.length) * 100)}%` : null,
                percent: instances.length > 0 ? Math.round((disconnected / instances.length) * 100) : 0,
              },
              warmupCount > 0 && {
                key: 'warmup', color: '#fbbf24',
                icon: <LocalFireDepartmentIcon sx={{ fontSize: 18, color: '#fbbf24' }} />,
                value: warmupCount.toLocaleString(), label: t.inst.statWarmup,
                subtitle: instances.length > 0 ? `${Math.round((warmupCount / instances.length) * 100)}%` : null,
                percent: instances.length > 0 ? Math.round((warmupCount / instances.length) * 100) : 0,
              },
              {
                key: 'users', color: 'rgba(148,163,184,0.7)',
                icon: <PersonAddIcon sx={{ fontSize: 18, color: 'var(--text-muted)' }} />,
                value: users.length.toLocaleString(), label: t.inst.statUsers,
              },
            ].filter(Boolean).map(({ key, ...c }, i) => (
              <Fragment key={key}>
                {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
                <InstStatCard {...c} />
              </Fragment>
            ))}
          </Box>
          )}
        </Box>
      </Box>

      {/* Performance al lado de la gestión de instancias, no arriba a todo el
         ancho — el apretujamiento anterior venía de que la columna era
         demasiado angosta (minWidth 360), no de estar al lado; ahora tiene
         más espacio mínimo (520) para que las gráficas respiren. */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box ref={perfColRef} sx={{ flex: '1 1 520px', minWidth: 480 }}>
          <InstancesDashboard metrics={metrics} loading={metricsLoading} range={metricsRange} onRangeChange={setMetricsRange} lang={lang} chartsReady={everActiveRef.current} />
        </Box>

        {/* User cards grid + unassigned sidebar */}
        <Box sx={{ flex: '1 1 560px', minWidth: 0, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {/* Left: user cards — con más usuarios de los que caben en la altura
           de Performance, esta columna hace su propio scroll interno en vez
           de estirar la página entera hacia abajo. */}
        <Box sx={{
          flex: '1 1 480px', minWidth: 0,
          ...(perfHeight ? {
            maxHeight: perfHeight, overflowY: 'auto', pr: 0.5,
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
          } : {}),
        }}>
          {/* User search filter */}
          {!loading && users.length > 0 && (
            <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1,
              px: 1.2, py: 0.7, borderRadius: 2,
              bgcolor: 'var(--card-bg)', border: '1px solid var(--border)',
              '&:focus-within': { borderColor: 'rgba(100,116,139,0.5)' }, transition: 'border-color 0.15s',
            }}>
              <Box component="svg" viewBox="0 0 20 20" fill="none"
                sx={{ width: 14, height: 14, flexShrink: 0, color: 'var(--text-muted)' }}>
                <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </Box>
              <Box component="input"
                placeholder={lang === 'en' ? 'Search users…' : 'Buscar usuarios…'}
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                sx={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text)', fontSize: '0.78rem',
                  '&::placeholder': { color: 'var(--text-muted)', opacity: 0.7 },
                }}
              />
              {userSearch && (
                <Box onClick={() => setUserSearch('')} component="span"
                  sx={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1,
                    '&:hover': { color: 'var(--text)' }, userSelect: 'none' }}>
                  ×
                </Box>
              )}
            </Box>
          )}
        {loading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
            {(skeletonCounts.current.users.length ? skeletonCounts.current.users : [2, 3, 1, 2, 0, 1]).map((rowCount, i) => (
              <Box key={i} sx={{
                bgcolor: 'var(--card-bg)', borderRadius: 3, p: 2,
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', gap: 0,
                '@keyframes skCardIn': { '0%': { opacity: 0, transform: 'translateY(12px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
                animation: 'skCardIn 0.35s ease both',
                animationDelay: `${i * 0.08}s`,
              }}>
                {/* Header: avatar + name/role + slot counter */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, mb: 1.5 }}>
                  <Skeleton variant="rounded" width={38} height={38} sx={{ borderRadius: 2, flexShrink: 0,
                    bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)',
                    border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.22)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.15), transparent)' } }} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="56%" height={14} sx={{ mb: 0.3,
                      bgcolor: 'rgba(255,255,255,0.1)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.11), transparent)' } }} />
                    <Skeleton variant="text" width="30%" height={10} sx={{
                      bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.13)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.10), transparent)' } }} />
                  </Box>
                  <Skeleton variant="rounded" width={34} height={20} sx={{ borderRadius: 10,
                    bgcolor: 'rgba(255,255,255,0.07)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)' } }} />
                </Box>

                <Divider sx={{ borderColor: 'var(--border)', mb: rowCount === 0 ? 0 : 1.2 }} />

                {/* Instance rows */}
                {rowCount > 0 ? [...Array(rowCount)].map((_, r) => (
                  <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.2, py: 0.9,
                    borderRadius: 1.5, mb: 0.5,
                    bgcolor: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)',
                    '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
                    animation: 'skRowIn 0.25s ease both',
                    animationDelay: `${i * 0.08 + r * 0.05 + 0.12}s`,
                  }}>
                    {/* status dot */}
                    <Skeleton variant="circular" width={8} height={8} sx={{ flexShrink: 0,
                      bgcolor: r === 0 ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.12)' }} />
                    {/* name + provider badge + phone */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.25 }}>
                        <Skeleton variant="text" width={`${34 + (i * 13 + r * 11) % 22}%`} height={12} sx={{
                          bgcolor: 'rgba(255,255,255,0.09)',
                          '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.08), transparent)' } }} />
                        <Skeleton variant="rounded" width={30} height={13} sx={{ borderRadius: 0.7, flexShrink: 0,
                          bgcolor: 'rgba(52,211,153,0.14)',
                          '&::after': { background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.1), transparent)' } }} />
                      </Box>
                      <Skeleton variant="text" width={`${48 + (i * 7 + r * 9) % 22}%`} height={10} sx={{
                        bgcolor: 'rgba(255,255,255,0.06)',
                        '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.06), transparent)' } }} />
                    </Box>
                    {/* status label */}
                    <Skeleton variant="text" width={r === 0 ? 52 : 70} height={12} sx={{ flexShrink: 0,
                      bgcolor: r === 0 ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.07)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)' } }} />
                  </Box>
                )) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    py: 2.5, gap: 1, borderRadius: 1.5, mt: 1,
                    border: '1px dashed rgba(var(--accent-rgb,59,130,246),0.16)',
                    bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.025)' }}>
                    <Box sx={{ display: 'flex', gap: 0.7 }}>
                      {[...Array(5)].map((_, d) => (
                        <Skeleton key={d} variant="circular" width={9} height={9}
                          sx={{ bgcolor: 'rgba(255,255,255,0.07)' }} />
                      ))}
                    </Box>
                    <Skeleton variant="text" width="50%" height={10} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />
                    <Skeleton variant="rounded" width={100} height={20} sx={{ borderRadius: 1.5, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)' }} />
                  </Box>
                )}

                {/* Capacity bar — 5 slot dots + chip/button */}
                <Box sx={{ display: 'flex', gap: 0.7, mt: 1.5, pt: 1, borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                  {[...Array(5)].map((_, d) => (
                    <Skeleton key={d} variant="circular" width={10} height={10}
                      sx={{ bgcolor: d < rowCount ? 'rgba(34,197,94,0.32)' : 'rgba(255,255,255,0.07)' }} />
                  ))}
                  {rowCount >= 2 ? (
                    <Skeleton variant="rounded" width={80} height={17} sx={{ ml: 'auto', borderRadius: 10,
                      bgcolor: 'rgba(34,197,94,0.1)',
                      '&::after': { background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.1), transparent)' } }} />
                  ) : (
                    <Skeleton variant="text" width={58} height={12} sx={{ ml: 'auto', bgcolor: 'rgba(255,255,255,0.05)' }} />
                  )}
                </Box>

                {/* Stats line */}
                {rowCount > 0 && (
                  <Skeleton variant="text" width="44%" height={10} sx={{ mt: 0.8, bgcolor: 'rgba(255,255,255,0.04)' }} />
                )}
              </Box>
            ))}
          </Box>

        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
            {users
              .filter(u => {
                if (!userSearch.trim()) return true
                const q = userSearch.toLowerCase()
                return (u.display_name || u.username || '').toLowerCase().includes(q) ||
                  (u.email || '').toLowerCase().includes(q)
              })
              .map((user, cardIndex) => {
                const uid = user._id || user.id || user.username
                const userInsts = instances.filter(i => i.assigned_to === uid)
                return (
                  <UserCard key={uid} user={user} instances={userInsts} cardIndex={cardIndex}
                    onAddSlot={() => openPickForUser(user)}
                    onQr={inst => handleQrClick(inst)}
                    onEditNumber={inst => handleEditNumberClick(inst)}
                    onRemove={handleQuickUnassign}
                    onWarmup={handleWarmupToggle}
                  />
                )
              })}
          </Box>
        )}
        </Box>{/* end left panel */}

        {/* Right sidebar: unassigned instances */}
        {loading ? (
          <Box sx={{
            width: 240, flexShrink: 0,
            border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2.5,
            bgcolor: 'var(--card-bg)', alignSelf: 'flex-start', overflow: 'hidden',
            '@keyframes skCardIn': { '0%': { opacity: 0, transform: 'translateY(12px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
            animation: 'skCardIn 0.35s ease both', animationDelay: '0.3s',
          }}>
            {/* Header: mismo lenguaje de ícono-en-caja-degradada que Performance
               e Instances, en tono ámbar (mismo acento que ya usaba esta
               barra) en vez del punto + texto plano de antes. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 1.6, py: 1.4,
              background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, transparent 100%)',
              borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
              <Skeleton variant="rounded" width={26} height={26} sx={{ borderRadius: '8px', flexShrink: 0,
                bgcolor: 'rgba(245,158,11,0.16)',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.15), transparent)' } }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Skeleton variant="text" width="60%" height={13} sx={{ mb: 0.2,
                  bgcolor: 'rgba(255,255,255,0.1)',
                  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.12), transparent)' } }} />
                <Skeleton variant="text" width="80%" height={9} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />
              </Box>
              <Skeleton variant="rounded" width={22} height={16} sx={{ borderRadius: 10, bgcolor: 'rgba(245,158,11,0.12)', flexShrink: 0 }} />
              <Skeleton variant="circular" width={12} height={12} sx={{ bgcolor: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
            </Box>
            {/* Group label row — mirrors the "SIN CONEXIÓN" section header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.55,
              bgcolor: 'rgba(255,255,255,0.025)',
              borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)',
              '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
              animation: 'skRowIn 0.2s ease both', animationDelay: '0.32s' }}>
              <Skeleton variant="circular" width={5} height={5} sx={{ bgcolor: 'rgba(148,163,184,0.35)', flexShrink: 0 }} />
              <Skeleton variant="text" width="44%" height={10} sx={{ bgcolor: 'rgba(148,163,184,0.15)',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.12), transparent)' } }} />
              <Skeleton variant="rounded" width={16} height={12} sx={{ borderRadius: 10, ml: 'auto', bgcolor: 'rgba(255,255,255,0.06)' }} />
            </Box>
            {/* Instance rows */}
            {[...Array(skeletonCounts.current.unassigned || 4)].map((_, r) => (
              <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.65,
                borderBottom: '1px solid var(--border)',
                '@keyframes skRowIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
                animation: 'skRowIn 0.25s ease both', animationDelay: `${r * 0.06 + 0.38}s` }}>
                <Skeleton variant="circular" width={8} height={8} sx={{ flexShrink: 0,
                  bgcolor: 'rgba(255,255,255,0.12)' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Skeleton variant="text" width={`${42 + (r * 13) % 28}%`} height={11} sx={{ mb: 0.2,
                    bgcolor: 'rgba(255,255,255,0.09)',
                    '&::after': { background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.08), transparent)' } }} />
                  <Skeleton variant="text" width={`${52 + (r * 9) % 24}%`} height={9} sx={{ bgcolor: 'rgba(255,255,255,0.06)' }} />
                </Box>
                {/* Action buttons: QR, assign, edit, delete */}
                <Box sx={{ display: 'flex', gap: 0.3, flexShrink: 0 }}>
                  {[
                    'rgba(96,165,250,0.25)',
                    'rgba(96,165,250,0.2)',
                    'rgba(167,139,250,0.2)',
                    'rgba(248,113,113,0.2)',
                  ].map((bg, b) => (
                    <Skeleton key={b} variant="circular" width={20} height={20} sx={{ bgcolor: bg }} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (() => {
          const unassigned = instances.filter(i => !i.assigned_to)
          if (unassigned.length === 0) return null
          const connGroup   = unassigned.filter(i => ['open','connected'].includes(i.live_status))
          const pendGroup   = unassigned.filter(i => i.live_status === 'connecting')
          const restGroup   = unassigned.filter(i => !['open','connected','connecting'].includes(i.live_status))
          const grouped = [
            ...(connGroup.length   ? [{ _group: lang === 'en' ? 'Connected' : 'Conectadas',   color: '#4ade80', items: connGroup }] : []),
            ...(pendGroup.length   ? [{ _group: lang === 'en' ? 'Connecting' : 'Conectando',  color: '#fbbf24', items: pendGroup }] : []),
            ...(restGroup.length   ? [{ _group: lang === 'en' ? 'Disconnected' : 'Sin conexión', color: '#94a3b8', items: restGroup }] : []),
          ]
          return (
            <Box sx={{
              width: 240, flexShrink: 0,
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: 2.5,
              bgcolor: 'var(--card-bg)', alignSelf: 'flex-start',
              display: 'flex', flexDirection: 'column',
              maxHeight: 'calc(100vh - 200px)',
              overflow: 'hidden',
            }}>
              {/* Sidebar header — fixed, click to collapse/expand (lives outside
                 the scroll area). Mismo lenguaje de ícono-en-caja-degradada que
                 usan Performance e Instances, en tono ámbar (el acento que ya
                 traía esta barra), en vez del punto + texto plano de antes. */}
              <Box onClick={() => setSidebarCollapsed(c => !c)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 1.6, py: 1.4, position: 'relative',
                  cursor: 'pointer', userSelect: 'none', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, transparent 100%)',
                  borderBottom: sidebarCollapsed ? 'none' : '1px solid rgba(245,158,11,0.15)',
                  borderRadius: '10px 10px 0 0',
                  '&:hover': { background: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.06) 60%, transparent 100%)' },
                  transition: 'background 0.15s',
                  ...(!sidebarCollapsed && { '&::after': {
                    content: '""', position: 'absolute', bottom: 0, left: 14, right: 14, height: '1px',
                    background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.4) 40%, rgba(245,158,11,0.4) 60%, transparent)',
                  } }),
                }}>
                <Box sx={{
                  width: 26, height: 26, borderRadius: '8px', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(245,158,11,0.28) 0%, rgba(245,158,11,0.1) 100%)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <SmartphoneIcon sx={{ color: '#f59e0b', fontSize: 14 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ color: 'var(--text)', fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.2 }}>
                    {lang === 'en' ? 'Unassigned' : 'Sin asignar'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.6rem', color: 'var(--text-muted, rgba(255,255,255,0.35))', lineHeight: 1, mt: 0.2, whiteSpace: 'nowrap' }}>
                    {lang === 'en' ? 'Instances without a user' : 'Instancias sin usuario'}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.67rem', color: 'rgba(245,158,11,0.85)',
                  bgcolor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                  px: 1, py: 0.2, borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>
                  {unassigned.length}
                </Typography>
                <KeyboardArrowDownIcon sx={{ fontSize: 15, color: 'rgba(245,158,11,0.6)', flexShrink: 0,
                  transition: 'transform 0.2s', transform: sidebarCollapsed ? 'rotate(-90deg)' : 'none' }} />
              </Box>

              {/* Compact list — grouped by status; this is the ONLY scrollable region now */}
              {!sidebarCollapsed && (
              <Box sx={{
                flex: 1, minHeight: 0, overflowY: 'auto',
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-button': { display: 'none' },
                '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(245,158,11,0.25)', borderRadius: 4 },
                '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
              }}>
              {grouped.map(({ _group, color: gColor, items }) => (
                <Box key={_group}>
                  {/* Group label */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.55,
                    bgcolor: 'rgba(255,255,255,0.025)', borderBottom: '1px solid var(--border)',
                    borderTop: '1px solid var(--border)' }}>
                    <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: gColor, flexShrink: 0,
                      boxShadow: `0 0 4px ${gColor}99` }} />
                    <Typography sx={{ fontSize: '0.57rem', fontWeight: 700, color: gColor,
                      textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>
                      {_group}
                    </Typography>
                    <Typography sx={{ fontSize: '0.57rem', color: gColor, opacity: 0.6, fontWeight: 600 }}>
                      {items.length}
                    </Typography>
                  </Box>
                  {/* Rows */}
                  {items.map((inst, idx) => {
                    const isExp = expandedAssign === inst.name
                    const status = inst.live_status || 'unknown'
                    const icolor = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                    const isConn = ['open','connected'].includes(status)
                    const _RC = { banned: '#f87171', logged_out: '#fbbf24', conflict: '#fbbf24', multidevice: '#fbbf24', server_error: '#f87171', restart: '#fb923c', timeout: '#94a3b8', closed: '#94a3b8', replaced: '#fb923c', disconnected: '#f87171', failed: '#f87171' }
                    const dotColor = (!isConn && status !== 'connecting' && inst.disconnect_reason) ? (_RC[inst.disconnect_reason] ?? '#f87171') : icolor
                    const reasonLabel = inst.disconnect_reason ? ((lang === 'en' ? DISCONNECT_LABEL_EN : DISCONNECT_LABEL_ES)[inst.disconnect_reason] ?? inst.disconnect_reason_label) : null
                    return (
                      <Box key={inst.name}
                        ref={el => { sidebarRowRefs.current[inst.name] = el }}
                        sx={{ position: 'relative', ...(isExp && { zIndex: 201 }) }}>
                        <Box sx={{
                          display: 'flex', alignItems: 'center', gap: 0.8, px: 1.2, py: 0.65,
                          borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none',
                          '&:hover': { bgcolor: 'var(--item-hover)' }, transition: 'background 0.12s',
                          '&:hover .inst-check': { opacity: 1 },
                          ...(isExp && { bgcolor: 'rgba(59,130,246,0.04)' }),
                        }}>
                          {/* Multi-select checkbox */}
                          <Box className="inst-check"
                            onClick={e => { e.stopPropagation(); toggleSelectInst(inst.name) }}
                            sx={{
                              width: 13, height: 13, flexShrink: 0, borderRadius: 0.4,
                              border: selectedInsts.has(inst.name) ? '1.5px solid #60a5fa' : '1.5px solid rgba(255,255,255,0.22)',
                              bgcolor: selectedInsts.has(inst.name) ? 'rgba(59,130,246,0.85)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', transition: 'all 0.1s',
                              opacity: selectedInsts.size > 0 ? 1 : 0,
                              zIndex: 1,
                            }}>
                            {selectedInsts.has(inst.name) && (
                              <Typography sx={{ fontSize: '9px', lineHeight: 1, color: 'white', fontWeight: 700, userSelect: 'none', mt: '1px' }}>✓</Typography>
                            )}
                          </Box>
                          <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor,
                              boxShadow: isConn ? `0 0 6px ${dotColor}aa` : 'none', position: 'relative', zIndex: 1 }} />
                            {isConn && (
                              <Box sx={{
                                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                                width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor, opacity: 0.4,
                                '@keyframes ping': {
                                  '0%':   { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.4 },
                                  '75%':  { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
                                  '100%': { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 },
                                },
                                animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
                              }} />
                            )}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', lineHeight: 1.2,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {inst.label || inst.name}
                              </Typography>
                              {/* Badge de proveedor — mismo detalle que ya tienen las
                                 instancias asignadas dentro de las tarjetas de usuario
                                 (InstanceRow); aquí faltaba, y se veían más "en blanco"
                                 en comparación. */}
                              {inst.provider === 'waha' && (
                                <Typography sx={{ fontSize: '0.5rem', fontWeight: 700, color: '#60a5fa',
                                  bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)',
                                  px: 0.45, borderRadius: 0.8, lineHeight: 1.5, flexShrink: 0, letterSpacing: '0.03em' }}>
                                  WAHA
                                </Typography>
                              )}
                              {inst.provider === 'wwebjs' && (
                                <Typography sx={{ fontSize: '0.5rem', fontWeight: 700, color: '#34d399',
                                  bgcolor: 'rgba(52,211,153,0.12)', px: 0.5, py: 0.1, borderRadius: 0.5, flexShrink: 0 }}>
                                  WWEBJS
                                </Typography>
                              )}
                              {inst.provider === 'wasender' && (
                                <Typography sx={{ fontSize: '0.5rem', fontWeight: 700, color: '#a78bfa',
                                  bgcolor: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.25)',
                                  px: 0.45, borderRadius: 0.8, lineHeight: 1.5, flexShrink: 0, letterSpacing: '0.03em' }}>
                                  WS
                                </Typography>
                              )}
                            </Box>
                            <Typography sx={{ fontSize: '0.65rem', fontFamily: 'monospace', lineHeight: 1.2,
                              color: reasonLabel && !isConn ? dotColor : 'var(--text-muted)' }}>
                              {reasonLabel && !isConn ? reasonLabel : (inst.number ? `+${inst.number}` : t.inst.noNumber)}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.2, alignItems: 'center', flexShrink: 0 }}>
                            <Tooltip title={t.inst.connectQr}>
                              <IconButton size="small" onClick={() => handleQrClick(inst)}
                                sx={{ color: 'var(--accent, #60a5fa)', p: 0.4, '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)' } }}>
                                <QrCodeIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={isExp ? (lang === 'en' ? 'Close' : 'Cerrar') : t.inst.assignUser}>
                              <IconButton size="small"
                                onClick={e => {
                                  e.stopPropagation()
                                  if (isExp) {
                                    setExpandedAssign(null); setSidebarAnchor(null)
                                  } else {
                                    const el = sidebarRowRefs.current[inst.name]
                                    const rect = el ? el.getBoundingClientRect() : null
                                    setExpandedAssign(inst.name)
                                    setSidebarAnchor(rect ? { top: rect.bottom + 2, left: rect.left, width: rect.width } : null)
                                  }
                                }}
                                sx={{ color: 'var(--accent, #60a5fa)', p: 0.4, ...(isExp && { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)' }),
                                  '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)' } }}>
                                <KeyboardArrowDownIcon sx={{ fontSize: 14, transition: 'transform 0.2s',
                                  transform: isExp ? 'rotate(180deg)' : 'none' }} />
                              </IconButton>
                            </Tooltip>
                            {/* Antes iba en morado fijo (#a78bfa), no en el
                               acento elegido en Ajustes. */}
                            <Tooltip title={lang === 'en' ? 'Edit number' : 'Editar número'}>
                              <IconButton size="small" onClick={() => handleEditNumberClick(inst)}
                                sx={{ color: 'var(--accent, #60a5fa)', p: 0.4, '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)' } }}>
                                <EditIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t.inst.delete}>
                              <IconButton size="small" onClick={() => handleDeleteClick(inst)}
                                sx={{ color: '#f87171', p: 0.4, '&:hover': { bgcolor: 'rgba(248,113,133,0.1)' } }}>
                                <DeleteForeverIcon sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              ))}
              </Box>
              )}

              {/* Multi-select footer bar — fixed, lives outside the scroll area */}
              {selectedInsts.size > 0 && (
                <Box sx={{
                  flexShrink: 0,
                  px: 1.5, py: 1,
                  borderTop: '1px solid rgba(59,130,246,0.25)',
                  bgcolor: 'var(--card-bg)',
                  display: 'flex', alignItems: 'center', gap: 1,
                }}>
                  <Box sx={{
                    width: 20, height: 20, borderRadius: 1, flexShrink: 0,
                    bgcolor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: '#60a5fa' }}>
                      {selectedInsts.size}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', flex: 1 }}>
                    {lang === 'en' ? `selected` : `seleccionada${selectedInsts.size !== 1 ? 's' : ''}`}
                  </Typography>
                  <Box onClick={() => setSelectedInsts(new Set())}
                    sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', px: 0.5,
                      '&:hover': { color: 'rgba(255,255,255,0.6)' }, userSelect: 'none' }}>
                    ✕
                  </Box>
                  <Box onClick={() => setBulkPickOpen(true)}
                    sx={{
                      px: 1.2, py: 0.45, borderRadius: 1.5, cursor: 'pointer',
                      bgcolor: 'rgba(59,130,246,0.18)', border: '1px solid rgba(59,130,246,0.45)',
                      transition: 'background 0.12s',
                      '&:hover': { bgcolor: 'rgba(59,130,246,0.28)' },
                    }}>
                    <Typography sx={{ fontSize: '0.72rem', color: '#60a5fa', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {lang === 'en' ? 'Assign' : 'Asignar'}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          )
        })()}
        </Box>
      </Box>

      {/* Bulk assign dialog */}
      <BulkPickDialog
        open={bulkPickOpen}
        onClose={() => setBulkPickOpen(false)}
        selectedNames={selectedInsts}
        users={users}
        instances={instances}
        onAssign={handleBulkAssign}
        lang={lang}
      />

      {/* Sidebar assign dropdown — portal to body so overflow:auto never clips it */}
      {typeof window !== 'undefined' && expandedAssign && sidebarAnchor && createPortal(
        <>
          <Box onClick={() => { setExpandedAssign(null); setSidebarAnchor(null) }}
            sx={{ position: 'fixed', inset: 0, zIndex: 1200 }} />
          <Box sx={{
            position: 'fixed',
            top: sidebarAnchor.top,
            left: sidebarAnchor.left,
            width: Math.max(sidebarAnchor.width, 240),
            zIndex: 1201,
            border: '1px solid rgba(59,130,246,0.35)', borderRadius: 2,
            bgcolor: 'var(--card-bg)', boxShadow: '0 12px 40px rgba(0,0,0,0.55)', overflow: 'hidden',
          }}>
            <InlineUserPicker instanceName={expandedAssign} users={users} instances={instances}
              onAssign={(...args) => { handleInlineAssign(...args); setSidebarAnchor(null) }}
              t={t} lang={lang} />
          </Box>
        </>,
        document.body
      )}

      {/* ── Edit number dialog ──
          slotProps.paper.sx (con !important) en vez de sx:{'& .MuiDialog-paper'} —
          el tema global (MuiDialog.styleOverrides.paper en theme.js) gana por orden
          de inyección de emotion y pisaba el bgcolor/border de este diálogo en
          particular. Además, backgroundImage:'none' — MUI le pone a los Paper de
          elevación alta un overlay blanco semitransparente encima (efecto "papel"
          de tema oscuro, vía --Paper-overlay), que aclara CUALQUIER bgcolor que le
          pongas sin ese override — mismo patrón ya usado en otros diálogos de este
          archivo (ver databaseViewer.jsx) que sí se ven con el color correcto. */}
      <Dialog open={editNumberOpen} onClose={() => setEditNumberOpen(false)}
        slotProps={{ paper: { sx: {
          bgcolor: 'var(--card-bg,#161d2e) !important',
          background: 'var(--card-bg,#161d2e) !important',
          backgroundImage: 'none !important',
          border: '1px solid rgba(167,139,250,0.3) !important',
          borderRadius: 3, minWidth: 360, maxWidth: 420,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        } } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(167,139,250,0.15)',
              border: '1px solid rgba(167,139,250,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <EditIcon sx={{ fontSize: 17, color: '#a78bfa' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'Edit phone number' : 'Editar número'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.38))', fontSize: '0.7rem', fontFamily: 'monospace', mt: 0.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {editNumberInst?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setEditNumberOpen(false)}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.25))', '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.06)' }, flexShrink: 0 }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '8px !important', pb: 0, display: 'flex', flexDirection: 'column', gap: 1.8 }}>
          {/* Label / display name */}
          <TextField
            label={lang === 'en' ? 'Display name' : 'Nombre visible'}
            placeholder={lang === 'en' ? 'e.g. Mexico 1' : 'ej. México 1'}
            size="small" fullWidth autoFocus
            value={editLabelValue}
            onChange={e => setEditLabelValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !editNumberSaving && handleEditNumberSave()}
            sx={FIELD_SX}
            helperText={
              <span style={{ color: 'var(--text-muted,rgba(255,255,255,0.28))', fontSize: '0.67rem' }}>
                {lang === 'en' ? 'Friendly name shown in the UI' : 'Nombre amigable que se muestra en la UI'}
              </span>
            }
          />

          {/* Phone number */}
          <TextField
            label={lang === 'en' ? 'Phone number (with country code)' : 'Número de teléfono (con código de país)'}
            placeholder="5214428079840"
            size="small" fullWidth
            value={editNumberValue}
            onChange={e => setEditNumberValue(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={e => e.key === 'Enter' && !editNumberSaving && handleEditNumberSave()}
            sx={FIELD_SX}
            slotProps={{ input: { startAdornment: (
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.88rem', mr: 0.5, userSelect: 'none' }}>+</Typography>
            ) } }}
            helperText={editNumberErr
              ? <span style={{ color: '#f87171' }}>{editNumberErr}</span>
              : <span style={{ color: 'var(--text-muted,rgba(255,255,255,0.28))', fontSize: '0.67rem' }}>
                  {lang === 'en' ? 'Digits only, no spaces or +' : 'Solo dígitos, sin espacios ni +'}
                </span>}
          />
        </DialogContent>

        <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.05)', mt: 1 }}>
          <Button size="small" onClick={() => setEditNumberOpen(false)}
            sx={{ textTransform: 'none', color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.82rem',
              '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button size="small" variant="contained" onClick={handleEditNumberSave}
            disabled={editNumberSaving || !editNumberValue.trim()}
            startIcon={editNumberSaving ? null : <CheckCircleIcon sx={{ fontSize: '15px !important' }} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2,
              // Antes iba en morado fijo (#7c3aed) en vez del acento elegido
              // en Ajustes, igual que el ícono de lápiz que abre este diálogo.
              bgcolor: 'var(--accent, #3b82f6)', '&:hover': { bgcolor: 'color-mix(in srgb, var(--accent, #3b82f6) 82%, black)' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' } }}>
            {editNumberSaving
              ? <><CircularProgress size={13} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Saving…' : 'Guardando…'}</>
              : lang === 'en' ? 'Save' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Pick instance dialog ── */}
      <Dialog open={pickOpen} onClose={closePick} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)',
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.09) 0%, transparent 55%), var(--card-bg,#161d2e)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)',
          borderRadius: 3, minWidth: 390, maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
        },
      }}>
        <DialogTitle sx={{ pb: 1.2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.3 }}>
            <Box sx={{
              width: 38, height: 38, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PersonAddIcon sx={{ fontSize: 20, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.assignTitle}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.3 }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'var(--accent,#60a5fa)', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.72rem', color: 'var(--accent,#60a5fa)', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pickTargetUser?.display_name || pickTargetUser?.username}
                </Typography>
                {(() => {
                  const uid = pickTargetUser?._id || pickTargetUser?.id || pickTargetUser?.username
                  const cur = instances.filter(i => i.assigned_to === uid).length
                  return (
                    <Box sx={{ px: 0.8, py: 0.2, borderRadius: 1, flexShrink: 0,
                      bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)',
                      border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)' }}>
                      <Typography sx={{ fontSize: '0.58rem', color: 'var(--accent,#60a5fa)', fontWeight: 700 }}>
                        {cur}/5 slots
                      </Typography>
                    </Box>
                  )
                })()}
              </Box>
            </Box>
            <IconButton size="small" onClick={closePick}
              sx={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0,
                '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.06)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 0 }}>
          {(() => {
            const unassigned = instances.filter(i => !i.assigned_to)
            const uid = pickTargetUser?._id || pickTargetUser?.id || pickTargetUser?.username
            const curSlots = instances.filter(i => i.assigned_to === uid).length
            const maxPick = Math.max(0, 5 - curSlots)
            if (unassigned.length === 0)
              return (
                <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', py: 3, textAlign: 'center' }}>
                  {t.inst.noUnassigned}
                </Typography>
              )
            return (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2 }}>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--border)' }} />
                  <Typography sx={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                    {maxPick === 0
                      ? (lang === 'en' ? 'Slots full' : 'Slots llenos')
                      : (lang === 'en' ? `Up to ${maxPick} more` : `Hasta ${maxPick} más`)}
                  </Typography>
                  <Box sx={{ flex: 1, height: '1px', bgcolor: 'var(--border)' }} />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 280, overflowY: 'auto',
                  pr: 0.5,
                  '&::-webkit-scrollbar': { width: 3 },
                  '&::-webkit-scrollbar-button': { display: 'none' },
                  '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.25)', borderRadius: 4 },
                }}>
                  {unassigned.map(inst => {
                    const status  = inst.live_status || 'unknown'
                    const color   = STATUS_COLOR[status] ?? STATUS_COLOR.unknown
                    const isConn  = ['open','connected','WORKING'].includes(status)
                    const isDisco = ['close','disconnected','STOPPED','FAILED','auth_failure','error'].includes(status)
                    const isSel   = pickSelected.has(inst.name)
                    const atMax   = !isSel && pickSelected.size >= maxPick
                    const disabled = maxPick === 0 || atMax
                    return (
                      <Box key={inst.name}
                        onClick={() => {
                          if (disabled) return
                          setPickSelected(prev => {
                            const next = new Set(prev)
                            next.has(inst.name) ? next.delete(inst.name) : next.add(inst.name)
                            return next
                          })
                        }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1.2, px: 1.4, py: 0.9,
                          borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer',
                          border: isSel ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)' : '1px solid transparent',
                          bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.09)' : 'rgba(255,255,255,0.025)',
                          opacity: disabled ? 0.38 : 1,
                          transition: 'all 0.12s',
                          '&:hover': disabled ? {} : {
                            bgcolor: isSel ? 'rgba(var(--accent-rgb,59,130,246),0.12)' : 'rgba(var(--accent-rgb,59,130,246),0.06)',
                            borderColor: 'rgba(var(--accent-rgb,59,130,246),0.28)',
                          },
                        }}>
                        {/* Checkbox */}
                        <Box sx={{
                          width: 15, height: 15, borderRadius: 0.5, flexShrink: 0,
                          border: isSel ? '1.5px solid var(--accent,#60a5fa)' : '1.5px solid rgba(255,255,255,0.2)',
                          bgcolor: isSel ? 'var(--accent,#60a5fa)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.1s',
                        }}>
                          {isSel && <Typography sx={{ fontSize: '9px', color: 'white', fontWeight: 800, userSelect: 'none', mt: '1px' }}>✓</Typography>}
                        </Box>
                        {/* Status dot */}
                        <Box sx={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
                          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color,
                            boxShadow: isConn ? `0 0 6px ${color}bb` : 'none' }} />
                        </Box>
                        {/* Name + number */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ color: 'var(--text)', fontSize: '0.82rem', fontWeight: 600,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inst.label || inst.name}
                          </Typography>
                          <Typography sx={{ color: 'rgba(255,255,255,0.32)', fontSize: '0.64rem', fontFamily: 'monospace' }}>
                            {inst.number ? `+${inst.number}` : (lang === 'en' ? 'No number' : 'Sin número')}
                          </Typography>
                        </Box>
                        {/* Status chip */}
                        <Box sx={{ px: 0.8, py: 0.25, borderRadius: 1, flexShrink: 0,
                          bgcolor: `${color}18`, border: `1px solid ${color}44` }}>
                          <Typography sx={{ fontSize: '0.6rem', color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {isConn ? t.inst.statusConnected : isDisco ? t.inst.statusDisconnected : t.inst.statusUnknown}
                          </Typography>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            )
          })()}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, pb: 2, pt: 1.5, mt: 1,
          borderTop: '1px solid rgba(255,255,255,0.06)', gap: 1 }}>
          <Typography sx={{ flex: 1, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {pickSelected.size > 0 ? `${pickSelected.size} seleccionada${pickSelected.size !== 1 ? 's' : ''}` : ''}
          </Typography>
          <Button onClick={closePick}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem',
              '&:hover': { color: 'var(--text)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </Button>
          <Button onClick={handlePickAssignMulti} disabled={pickSelected.size === 0}
            variant="contained"
            sx={{
              bgcolor: 'var(--accent,#3b82f6)', color: 'white', textTransform: 'none',
              borderRadius: 1.5, px: 2, fontSize: '0.82rem', fontWeight: 600,
              boxShadow: 'none',
              '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.82)', boxShadow: 'none' },
              '&:disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
            }}>
            {lang === 'en'
              ? `Assign${pickSelected.size > 0 ? ` (${pickSelected.size})` : ''}`
              : `Asignar${pickSelected.size > 0 ? ` (${pickSelected.size})` : ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.1) 0%, transparent 55%), var(--card-bg,#161d2e)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PhoneAndroidIcon sx={{ fontSize: 18, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.createTitle}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {t.inst.createSubtitle}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '4px !important', px: 3 }}>
          <TextField
            label={t.inst.nameLabel}
            placeholder={t.inst.namePlaceholder}
            size="small"
            value={newName}
            onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            sx={FIELD_SX}
            onKeyDown={e => e.key === 'Enter' && !newNumber && handleCreate()}
            autoFocus
            helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>{t.inst.nameHint}</span>}
          />
          <TextField
            label={t.inst.numberLabel}
            placeholder={t.inst.numberPlaceholder}
            size="small"
            value={newNumber}
            onChange={e => setNewNumber(e.target.value.replace(/\D/g, ''))}
            sx={FIELD_SX}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>{t.inst.numberHint}</span>}
            slotProps={{ input: {
              startAdornment: <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.85rem', mr: 0.5, fontFamily: 'monospace' }}>+</Typography>
            }}}
          />
          {createErr && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{createErr}</Typography>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}
            sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
            {t.inst.cancel}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            variant="contained"
            sx={{
              bgcolor: 'var(--accent,#3b82f6)', textTransform: 'none', fontWeight: 700,
              fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
              '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.85)' },
              '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
            }}
          >
            {creating
              ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{t.inst.creating}</>
              : t.inst.create}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add number wizard ── */}
      <Dialog open={wizardOpen} onClose={() => { if (!wizardLoading) { stopWizardPoll(); setWizardOpen(false) } }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(34,197,94,0.08) 0%, transparent 55%)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 3, minWidth: 420, maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AddIcon sx={{ fontSize: 18, color: '#4ade80' }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.wizardTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {wizardStep === 2
                ? (lang === 'en' ? 'New instance' : 'Nueva instancia')
                : (lang === 'en' ? 'Linking code' : 'Código de vinculación')}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 1, px: 3 }}>
          {wizardStep === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', lineHeight: 1.6, mb: 0.5 }}>
                {t.inst.wizardStep1Intro}
              </Typography>
              {[
                [t.inst.wizardStep1a, t.inst.wizardStep1aSub],
                [t.inst.wizardStep1b, t.inst.wizardStep1bSub],
                [t.inst.wizardStep1c, t.inst.wizardStep1cSub],
                [t.inst.wizardStep1d, t.inst.wizardStep1dSub],
              ].map(([title, sub], i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.3 }}>
                    <Typography sx={{ color: '#4ade80', fontSize: '0.65rem', fontWeight: 800 }}>{i + 1}</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem', lineHeight: 1.4 }}>{title}</Typography>
                    <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', mt: 0.2 }}>{sub}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {wizardStep === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t.inst.nameLabel}
                placeholder={t.inst.namePlaceholder}
                size="small"
                value={wizardName}
                onChange={e => setWizardName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{t.inst.nameHint}</span>}
                autoFocus
                sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wizardLoading && handleWizardCreate()}
              />

              {/* ── Phone field ── */}
              <TextField
                label={t.inst.wizardPhoneLabel}
                placeholder={t.inst.wizardPhonePlaceholder}
                size="small"
                value={wizardPhone}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '')
                  setWizardPhone(v)
                  if (!wizardName) setWizardName('wa-' + v.slice(-8))
                }}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{t.inst.wizardPhoneHint}</span>}
                sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wizardLoading && handleWizardCreate()}
              />


              {wizardErr && (
                <Box sx={{ px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wizardErr}</Typography>
                </Box>
              )}
            </Box>
          )}

          {wizardStep === 3 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {wizardConnected ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
                  <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
                  <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                    {t.inst.wizardConnectedTitle}
                  </Typography>
                  <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', textAlign: 'center' }}>
                    {t.inst.wizardConnectedDesc.replace('{name}', wizardInstName)}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    {t.inst.wizardStep3Intro}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 1 }}>
                    <Box sx={{ px: 3, py: 2, borderRadius: 2, bgcolor: wizardCountdown === 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.1)', border: `1px solid ${wizardCountdown === 0 ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, transition: 'all 0.3s' }}>
                      <Typography sx={{ color: wizardCountdown === 0 ? '#f87171' : '#4ade80', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.25em', fontFamily: 'monospace', transition: 'color 0.3s' }}>
                        {wizardCode ? wizardCode.slice(0,4) + '-' + wizardCode.slice(4) : ''}
                      </Typography>
                    </Box>
                    {wizardCountdown !== null && (
                      <Typography sx={{ color: wizardCountdown <= 10 ? '#f87171' : 'rgba(255,255,255,0.3)', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                        {wizardCountdown === 0
                          ? (lang === 'en' ? 'Refreshing…' : 'Actualizando…')
                          : (lang === 'en' ? `Expires in ${wizardCountdown}s` : `Expira en ${wizardCountdown}s`)}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', fontWeight: 600, mb: 0.5 }}>
                      {t.inst.wizardWaLabel}
                    </Typography>
                    {[t.inst.wizardWaStep1, t.inst.wizardWaStep2, t.inst.wizardWaStep3, t.inst.wizardWaStep4].map((s, i) => (
                      <Typography key={i} sx={{ color: i === 3 ? '#4ade80' : 'rgba(255,255,255,0.45)', fontSize: '0.78rem', lineHeight: 1.8, pl: i > 0 ? 1 : 0 }}>
                        {s}
                      </Typography>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center' }}>
                    <CircularProgress size={12} sx={{ color: 'rgba(255,255,255,0.3)' }} />
                    <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem' }}>
                      {t.inst.wizardWaiting}
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          {wizardStep === 3 && !wizardConnected && (
            <Button onClick={async () => {
              stopWizardPoll()
              try { await fetch(`/api/evolution/instance/${wizardInstName}`, { method: 'DELETE' }) } catch {}
              fetchInstances()
              setWizardOpen(false)
            }}
              sx={{ color: '#f87171', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
              {t.inst.wizardCancelReg}
            </Button>
          )}
          <Button onClick={() => { stopWizardPoll(); setWizardOpen(false) }} disabled={wizardLoading}
            sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
            {wizardStep === 3 ? t.inst.wizardClose : t.inst.wizardCancel}
          </Button>
          {wizardStep === 1 && (
            <Button onClick={() => setWizardStep(2)} variant="contained"
              sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
              {t.inst.wizardNextBtn}
            </Button>
          )}
          {wizardStep === 2 && (
            <Button onClick={handleWizardCreate} disabled={wizardLoading || !wizardName.trim()} variant="contained"
              startIcon={wizardLoading ? null : (wizardPhone.trim() ? <PhoneAndroidIcon sx={{ fontSize: '17px !important' }} /> : <AddIcon sx={{ fontSize: '17px !important' }} />)}
              sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' } }}>
              {wizardLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{t.inst.wizardCreating}</>
                : wizardPhone.trim() ? t.inst.wizardCreateBtn : t.inst.create}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Pairing code dialog ── */}
      <Dialog open={pairOpen} onClose={() => { setPairOpen(false); setPairCode(null); setPairErr('') }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(34,197,94,0.08) 0%, transparent 55%)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 3, minWidth: 360,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PhoneAndroidIcon sx={{ fontSize: 18, color: '#4ade80' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                Conectar por número de teléfono
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {pairTarget?.name}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '4px !important', pb: 1 }}>
          {!pairCode ? (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Ingresa el número que quieres registrar. WhatsApp generará un código de 8 caracteres que deberás ingresar en la app.
              </Typography>
              <TextField
                label="Número de teléfono"
                placeholder="525595054461"
                size="small"
                value={pairPhone}
                onChange={e => setPairPhone(e.target.value)}
                helperText={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>Con código de país, sin + ni espacios</span>}
                onKeyDown={e => e.key === 'Enter' && handleRequestPairCode()}
                autoFocus
                sx={FIELD_SX}
              />
              {pairErr && (
                <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{pairErr}</Typography>
              )}
            </>
          ) : (
            <>
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                Ingresa este código en WhatsApp → Dispositivos vinculados → Vincular con número de teléfono:
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <Box sx={{
                  px: 3, py: 2, borderRadius: 2,
                  bgcolor: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.3)',
                }}>
                  <Typography sx={{ color: '#4ade80', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '0.18em', fontFamily: 'monospace' }}>
                    {pairCode}
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', textAlign: 'center' }}>
                El código expira en pocos minutos
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          <Button onClick={() => { setPairOpen(false); setPairCode(null) }} sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
            Cerrar
          </Button>
          {!pairCode && (
            <Button onClick={handleRequestPairCode} disabled={pairLoading} variant="contained"
              startIcon={pairLoading ? null : <PhoneAndroidIcon sx={{ fontSize: '17px !important' }} />}
              sx={{ bgcolor: '#22c55e', '&:hover': { bgcolor: '#16a34a' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
              {pairLoading ? <CircularProgress size={15} sx={{ color: 'white' }} /> : 'Generar código'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Emulator registration dialog ── */}
      <Dialog open={emuOpen} onClose={() => { if (emuStep !== 'running') { emuEsRef.current?.close(); setEmuOpen(false) } }} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg,#161d2e)', backgroundImage: 'none',
          border: '1px solid rgba(167,139,250,0.2)', borderRadius: 3, minWidth: 420, maxWidth: 520,
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: '#3b82f6' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,#e2e8f0)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {t.inst.emuMenuLabel}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.35))', fontSize: '0.72rem' }}>
                {t.inst.emuSubtitle}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '4px !important', pb: 1 }}>
          {emuStep === 'idle' && (
            <>
              <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.5))', fontSize: '0.8rem', lineHeight: 1.5 }}>
                {t.inst.emuIdleDesc}
              </Typography>
              <TextField label={t.inst.emuInstanceNameLabel} size="small" value={emuInst}
                onChange={e => setEmuInst(e.target.value)} sx={{ ...FIELD_SX, mt: 0.5 }} />
              <TextField
                select
                label={t.inst.emuCountryLabel}
                size="small"
                value={emuCountry}
                onChange={e => setEmuCountry(Number(e.target.value))}
                sx={{ ...FIELD_SX, mt: 0.5 }}
                helperText={<span style={{ color: 'var(--text-muted, rgba(255,255,255,0.4))', fontSize: '0.68rem' }}>{t.inst.emuCountryHelper}</span>}
              >
                {SMSFAST_COUNTRIES.map(c => (
                  <MenuItem key={c.value} value={c.value} sx={{ fontSize: '0.85rem' }}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          {emuStep === 'confirming' && emuPreview && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {/* Session activa */}
              {emuPreview.has_active_session && (
                <Box sx={{ bgcolor: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 1.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <Typography sx={{ fontSize: '0.78rem', color: '#60a5fa', lineHeight: 1.5 }}>
                    <strong>Sesión activa detectada</strong> — se retomará el número {emuPreview.session_phone} desde el paso &quot;{emuPreview.session_step}&quot; sin comprar uno nuevo.
                  </Typography>
                </Box>
              )}

              {/* País seleccionado */}
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 1.5, px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>País</Typography>
                <Typography sx={{ fontSize: '0.85rem', color: 'var(--text,#e2e8f0)', fontWeight: 600, ml: 'auto' }}>
                  {SMSFAST_COUNTRIES.find(c => c.value === emuCountry)?.label || `Código ${emuCountry}`}
                </Typography>
              </Box>

              {/* Balance y costo */}
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5 }}>Saldo SMSFast</Typography>
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: emuPreview.balance < 0.50 ? '#f87171' : '#34d399' }}>
                    ${emuPreview.balance?.toFixed(2)} USD
                  </Typography>
                </Box>
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.5 }}>Costo estimado</Typography>
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>
                    ~${emuPreview.estimated_cost?.toFixed(2)} USD
                  </Typography>
                </Box>
              </Box>

              {/* Warnings */}
              {emuPreview.warnings?.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                  {emuPreview.warnings.map((w, i) => (
                    <Box key={i} sx={{ bgcolor: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)', borderRadius: 1.2, px: 1.5, py: 0.8, display: 'flex', gap: 0.8, alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '0.75rem', color: '#fb7185' }}>⚠ {w}</Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Posibles resultados */}
              {!emuPreview.has_active_session && (
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 1.5, p: 1.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', mb: 0.8 }}>A tener en cuenta</Typography>
                  {[
                    'El número es virtual — Meta puede rechazarlo (~30% de probabilidad)',
                    'Si no llega el OTP en 10 min, se cancela y reembolsa automáticamente',
                    'Si WhatsApp registra pero el número ya tiene cuenta, no hay reembolso',
                  ].map((item, i) => (
                    <Typography key={i} sx={{ fontSize: '0.73rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, display: 'flex', gap: 0.8 }}>
                      · {item}
                    </Typography>
                  ))}
                </Box>
              )}

              {emuPreview.error && (
                <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>Error: {emuPreview.error}</Typography>
              )}
            </Box>
          )}

          {(emuStep === 'running' || emuStep === 'success' || emuStep === 'error' || emuStep === 'done') && (
            <Box sx={{ bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1.5, p: 1.2, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              {emuLogs.map((log, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
                  <Typography sx={{ fontSize: '0.7rem', color:
                    log.step === 'error'   ? '#f87171' :
                    log.step === 'success' ? '#4ade80' :
                    log.step === 'warn'    ? '#fbbf24' :
                    log.msg?.startsWith('✅') ? '#4ade80' :
                    log.msg?.startsWith('❌') ? '#f87171' :
                    log.msg?.startsWith('⚠️') ? '#fbbf24' :
                    'rgba(255,255,255,0.65)',
                    lineHeight: 1.5, fontFamily: 'monospace',
                  }}>
                    {log.msg}
                  </Typography>
                </Box>
              ))}
              {emuStep === 'running' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.5 }}>
                  <CircularProgress size={11} sx={{ color: '#a78bfa' }} />
                  <Typography sx={{ fontSize: '0.7rem', color: '#a78bfa', fontFamily: 'monospace' }}>en progreso...</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
          {emuStep !== 'running' && (
            <Button onClick={() => { emuEsRef.current?.close(); setEmuOpen(false) }}
              sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
              Cerrar
            </Button>
          )}
          {emuStep === 'idle' && (
            <Button variant="contained" onClick={handleEmuPreview} disabled={!emuInst.trim() || emuPreviewLoading}
              sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              {emuPreviewLoading ? t.inst.emuVerifying : t.inst.emuContinue}
            </Button>
          )}
          {emuStep === 'confirming' && (
            <>
              <Button onClick={() => setEmuStep('idle')}
                sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
                Cancelar
              </Button>
              <Button variant="contained" onClick={startEmuRegistration} disabled={!emuPreview?.can_proceed}
                sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
                {emuPreview?.has_active_session ? 'Retomar registro' : 'Confirmar y registrar'}
              </Button>
            </>
          )}
          {(emuStep === 'success' || emuStep === 'done') && (
            <Button variant="contained" onClick={() => { setEmuOpen(false); fetchInstances() }}
              sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Listo ✓
            </Button>
          )}
          {emuStep === 'error' && (
            <Button variant="contained" onClick={() => setEmuStep('idle')}
              sx={{ bgcolor: '#1d4ed8', '&:hover': { bgcolor: '#1e40af' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5, boxShadow: 'none' }}>
              Reintentar
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── QR dialog ── */}
      <Dialog open={qrOpen} onClose={closeQr} sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.09) 0%, transparent 55%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)',
          borderRadius: 3, minWidth: 340,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
      }}>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
                {t.inst.connectTitle}
              </Typography>
              <Typography sx={{ color: 'var(--accent,#60a5fa)', fontSize: '0.73rem', mt: 0.2, fontWeight: 600 }}>
                {qrTarget?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={closeQr} sx={{ color: 'rgba(255,255,255,0.25)', mt: -0.5, mr: -1, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pt: '8px !important', pb: 1 }}>
          {/* Steps */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[t.inst.qrStep1, t.inst.qrStep2, t.inst.qrStep3].map((step, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
                  border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>{i + 1}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)' }}>{step}</Typography>
                {i < 2 && <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem', mx: 0.2 }}>›</Typography>}
              </Box>
            ))}
          </Box>

          {/* QR box */}
          <Box sx={{
            width: 230, height: 230,
            borderRadius: 2.5,
            bgcolor: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: '0 0 0 6px rgba(var(--accent-rgb,59,130,246),0.12), 0 8px 32px rgba(0,0,0,0.4)',
            position: 'relative',
          }}>
            {qrStatus === 'ready' && qrImage
              ? <img src={qrImage} alt="QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, p: 2 }}>
                  <CircularProgress size={32} sx={{ color: qrStatus === 'connecting' ? '#22c55e' : '#3b82f6' }} />
                  <Typography sx={{ color: '#666', fontSize: '0.72rem', textAlign: 'center', lineHeight: 1.4 }}>
                    {qrStatus === 'retrying'
                      ? t.inst.qrRetrying
                      : qrStatus === 'error'
                        ? t.inst.qrError
                        : qrStatus === 'connecting'
                          ? t.inst.qrConnecting
                          : t.inst.qrGenerating}
                  </Typography>
                </Box>
              )
            }
          </Box>

          {/* Retry button — hidden while connecting */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            {qrStatus !== 'connecting' && (
            <Button size="small" startIcon={<RefreshIcon sx={{ fontSize: '14px !important' }} />}
              onClick={() => { if (qrTarget) startQrPoll(qrTarget.name, qrStatus === 'error', qrTarget.provider) }}
              sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', fontSize: '0.72rem',
                '&:hover': { color: 'rgba(255,255,255,0.7)' } }}>
              {qrStatus === 'error' ? t.inst.qrForce : t.inst.qrRetryBtn}
            </Button>
            )}
            {qrStatus === 'error' && (
              <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,100,100,0.6)', textAlign: 'center', maxWidth: 220 }}>
                {t.inst.qrForceWarn}
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3, pt: 2, justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => { closeQr(); fetchInstances() }} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' },
              textTransform: 'none', fontWeight: 700, fontSize: '0.85rem', borderRadius: 2, px: 5 }}>
            {t.inst.done}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Assign dialog ── */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.07) 0%, transparent 60%), var(--card-bg,#161d2e)',
          border: '1px solid var(--border,rgba(255,255,255,0.08))',
          borderRadius: 3, minWidth: 400, maxWidth: 440,
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '1rem' }}>
                {t.inst.assignTitle}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.73rem', mt: 0.2 }}>
                {assignTarget?.name}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setAssignOpen(false)} sx={{ color: 'rgba(255,255,255,0.25)', mt: -0.5, mr: -1, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '4px !important', pb: 1 }}>
          {/* Autocomplete search */}
          <TextField
            size="small"
            placeholder={t.inst.searchUser}
            value={assignSearch}
            onChange={e => setAssignSearch(e.target.value)}
            autoFocus
            sx={{
              mb: 1.5, width: '100%',
              '& .MuiOutlinedInput-root': {
                bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, color: 'white', fontSize: '0.85rem',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.22)' },
                '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
              },
              '& input::placeholder': { color: 'rgba(255,255,255,0.3)', opacity: 1 },
            }}
            slotProps={{ input: { startAdornment: <SearchIcon sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 17, mr: 0.8 }} /> } }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, maxHeight: 300, overflowY: 'auto',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 2 },
          }}>
            {/* Sin asignar */}
            {!t.inst.unassigned.toLowerCase().includes(assignSearch.toLowerCase()) ? null : (
              <Box onClick={() => { setAssignUserId(''); setAssignUserName('') }} sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 1.5, py: 1.1, borderRadius: 2, cursor: 'pointer',
                border: assignUserId === ''
                  ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)'
                  : '1px solid transparent',
                bgcolor: assignUserId === ''
                  ? 'rgba(var(--accent-rgb,59,130,246),0.1)'
                  : 'rgba(255,255,255,0.03)',
                transition: 'all 0.15s',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
              }}>
                <Box sx={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  bgcolor: 'rgba(255,255,255,0.05)',
                  border: '1.5px dashed rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <LinkOffIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.25)' }} />
                </Box>
                <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', fontStyle: 'italic', flex: 1 }}>
                  {t.inst.unassigned}
                </Typography>
                {assignUserId === '' && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'var(--accent,#3b82f6)', boxShadow: '0 0 5px var(--accent,#3b82f6)' }} />}
              </Box>
            )}

            {/* Filtered users */}
            {users
              .filter(u => {
                const name = (u.display_name || u.username || '').toLowerCase()
                return name.includes(assignSearch.toLowerCase())
              })
              .map(u => {
                const uid      = u._id || u.id || u.username
                const selected = assignUserId === uid
                const name     = u.display_name || u.username || ''
                const initials = name[0]?.toUpperCase() || '?'
                const roleColor = u.role === 'admin' ? '#a78bfa' : 'var(--accent,#60a5fa)'
                return (
                  <Box
                    key={uid}
                    onClick={() => { setAssignUserId(uid); setAssignUserName(name) }}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      px: 1.5, py: 1.1, borderRadius: 2, cursor: 'pointer',
                      border: selected
                        ? '1px solid rgba(var(--accent-rgb,59,130,246),0.45)'
                        : '1px solid transparent',
                      bgcolor: selected
                        ? 'rgba(var(--accent-rgb,59,130,246),0.1)'
                        : 'rgba(255,255,255,0.03)',
                      transition: 'all 0.15s',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
                    }}
                  >
                    <Box sx={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      bgcolor: `${roleColor === '#a78bfa' ? '#a78bfa' : 'var(--accent,#3b82f6)'}18`,
                      border: `1.5px solid ${roleColor === '#a78bfa' ? '#a78bfa' : 'var(--accent,#3b82f6)'}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography sx={{ fontSize: '0.73rem', fontWeight: 800, color: roleColor }}>
                        {initials}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ color: 'var(--text,#f1f5f9)', fontSize: '0.83rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </Typography>
                      <Typography sx={{ fontSize: '0.63rem', color: roleColor, opacity: 0.75 }}>
                        {u.role === 'admin' ? t.admin?.admin || 'Admin' : t.admin?.user || 'Agente'}
                      </Typography>
                    </Box>
                    {selected && <Box sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: 'var(--accent,#3b82f6)', boxShadow: '0 0 5px var(--accent,#3b82f6)' }} />}
                  </Box>
                )
              })}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Button onClick={() => setAssignOpen(false)}
            sx={{ color: 'rgba(255,255,255,0.35)', textTransform: 'none', fontSize: '0.82rem' }}>
            {t.inst.cancel}
          </Button>
          <Button onClick={handleAssign} disabled={assigning} variant="contained"
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { bgcolor: 'var(--accent,#2563eb)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
            {assigning ? <CircularProgress size={15} sx={{ color: 'white' }} /> : t.inst.save}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar feedback ── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ content: { sx: {
          bgcolor: 'rgba(22,24,30,0.97)',
          color: 'rgba(255,255,255,0.9)',
          fontWeight: 500,
          fontSize: '0.82rem',
          borderRadius: 2.5,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(12px)',
          px: 2.5, py: 1.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 1, minWidth: 220, textAlign: 'center',
        }}}}
        message={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center', width: '100%' }}>
            <CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80', flexShrink: 0 }} />
            <span>{snack.msg}</span>
          </Box>
        }
      />

      {/* ── Delete confirm ── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)}
        slotProps={{ paper: { sx: {
          width: 360, maxWidth: '90vw', borderRadius: 3,
          background: 'var(--card-bg, #161d2e)',
          border: '1px solid rgba(239,68,68,0.22)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}}}>
        <Box sx={{ p: 2.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <WarningAmberIcon sx={{ fontSize: 18, color: '#ef4444' }} />
              </Box>
              <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>
                {t.inst.deleteTitle}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setDeleteTarget(null)} disabled={deleting}
              sx={{ color: 'rgba(255,255,255,0.2)', '&:hover': { color: 'rgba(255,255,255,0.5)', bgcolor: 'rgba(255,255,255,0.05)' } }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          {/* Instance row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.2, mb: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <SmartphoneIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <Typography sx={{ color: '#fff', fontWeight: 600, fontSize: '0.88rem', flex: 1 }}>
              {deleteTarget?.name}
            </Typography>
            {deleteTarget?.number && (
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                +{deleteTarget.number}
              </Typography>
            )}
          </Box>

          {/* Warning */}
          <Typography sx={{ color: 'rgba(239,68,68,0.65)', fontSize: '0.75rem', mb: 2.5 }}>
            {t.inst.deleteWarnInst}
          </Typography>

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button fullWidth onClick={() => setDeleteTarget(null)} disabled={deleting}
              sx={{ textTransform: 'none', fontSize: '0.82rem', fontWeight: 500, color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, py: 0.9, '&:hover': { bgcolor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.18)' } }}>
              {t.inst.cancel}
            </Button>
            <Button fullWidth onClick={handleDelete} disabled={deleting}
              sx={{ textTransform: 'none', fontSize: '0.82rem', fontWeight: 700, color: '#fff', bgcolor: '#ef4444', borderRadius: 2, py: 0.9, gap: 0.5, '&:hover': { bgcolor: '#dc2626' }, '&:disabled': { bgcolor: 'rgba(239,68,68,0.4)', color: 'rgba(255,255,255,0.5)' } }}>
              {deleting ? <CircularProgress size={14} sx={{ color: 'white' }} /> : <><DeleteForeverIcon sx={{ fontSize: 15 }} />{t.inst.delete}</>}
            </Button>
          </Box>
        </Box>
      </Dialog>

      {/* ── wwebjs session dialog ── */}
      <Dialog open={wahaOpen} onClose={() => !wahaLoading && setWahaOpen(false)} sx={{
        '& .MuiDialog-paper': {
          // El primer stop del gradiente empezaba en 10% de opacidad — el
          // fondo real (var(--card-bg)) no llegaba sólido hasta el 55% de
          // la caja, dejando la parte de arriba del diálogo casi transparente
          // y mostrando la página detrás. Ahora --card-bg es una capa sólida
          // propia (segundo layer) y el degradado azul es solo un tinte
          // encima, nunca deja de haber un fondo opaco.
          background: 'linear-gradient(160deg, rgba(96,165,250,0.12) 0%, transparent 55%), var(--card-bg, #161d2e)',
          border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
              border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: 'var(--accent,#60a5fa)' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'Connect WhatsApp Number' : 'Conectar Número WhatsApp'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {wahaLinkMethod === 'code'
                  ? (lang === 'en' ? 'Link a number via pairing code (whatsapp-web.js)' : 'Vincula un número vía código de emparejamiento')
                  : (lang === 'en' ? 'Link a number via QR code (whatsapp-web.js)' : 'Vincula un número vía código QR')}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <Divider sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }} />
        <DialogContent sx={{ pt: '16px !important', px: 3 }}>
          {wahaScanned && !wahaConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={40} thickness={3} sx={{ color: '#25d366' }} />
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem' }}>
                {lang === 'en' ? 'Confirmed — authenticating…' : 'Confirmado — autenticando…'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'WhatsApp is verifying the session on your phone'
                  : 'WhatsApp está verificando la sesión en tu teléfono'}
              </Typography>
            </Box>
          ) : wahaConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                {lang === 'en' ? 'Session connected!' : '¡Sesión conectada!'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                {lang === 'en' ? 'Assign it to a user from the panel.' : 'Asígnala a un usuario desde el panel.'}
              </Typography>
            </Box>
          ) : wahaQr ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 0.5 }}>
              <Box component="img" src={wahaQr} alt="QR"
                sx={{ width: 220, height: 220, borderRadius: 2, border: '2px solid #334155', bgcolor: '#fff', p: 1 }} />
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'Scan with WhatsApp → Settings → Linked Devices → Link a Device'
                  : 'Escanea con WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 2, bgcolor: '#1e3a5f', border: '1px solid #3b82f6' }}>
                <CircularProgress size={12} sx={{ color: '#60a5fa' }} />
                <Typography sx={{ color: '#60a5fa', fontSize: '0.72rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Waiting for scan…' : 'Esperando escaneo…'}
                </Typography>
              </Box>
            </Box>
          ) : wahaPairingCode ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 1 }}>
              <Box sx={{
                px: 3, py: 2, borderRadius: 2, bgcolor: '#fff', border: '2px solid #334155',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Typography sx={{
                  fontFamily: 'monospace', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '0.12em',
                  color: '#111827',
                }}>
                  {wahaPairingCode.slice(0, 4)}-{wahaPairingCode.slice(4)}
                </Typography>
              </Box>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'On the phone → WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead" → type this code'
                  : 'En el teléfono → WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo → "Vincular con número de teléfono" → escribe este código'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 2, bgcolor: '#1e3a5f', border: '1px solid #3b82f6' }}>
                <CircularProgress size={12} sx={{ color: '#60a5fa' }} />
                <Typography sx={{ color: '#60a5fa', fontSize: '0.72rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Waiting — code refreshes every ~3 min' : 'Esperando — el código se renueva cada ~3 min'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {[
                  { key: 'qr',   label: lang === 'en' ? 'QR code' : 'Código QR' },
                  { key: 'code', label: lang === 'en' ? 'Pairing code' : 'Código de emparejamiento' },
                ].map(opt => (
                  <Box key={opt.key} component="button" onClick={() => setWahaLinkMethod(opt.key)}
                    sx={{
                      flex: 1, cursor: 'pointer', border: '1px solid', borderRadius: 1.5,
                      py: 0.9, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                      transition: 'all 0.15s',
                      bgcolor: wahaLinkMethod === opt.key ? 'rgba(var(--accent-rgb,59,130,246),0.15)' : 'transparent',
                      borderColor: wahaLinkMethod === opt.key ? 'rgba(var(--accent-rgb,59,130,246),0.5)' : 'rgba(255,255,255,0.12)',
                      color: wahaLinkMethod === opt.key ? 'var(--accent,#60a5fa)' : 'var(--text-muted,rgba(255,255,255,0.45))',
                      '&:hover': { bgcolor: wahaLinkMethod === opt.key ? 'rgba(var(--accent-rgb,59,130,246),0.2)' : 'rgba(255,255,255,0.05)' },
                    }}
                  >{opt.label}</Box>
                ))}
              </Box>
              <Divider sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }} />
              <TextField label={lang === 'en' ? 'Session name' : 'Nombre de sesión'} value={wahaName}
                onChange={e => setWahaName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="mi-sesion-1" size="small" fullWidth autoFocus sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wahaLoading && wahaName.trim() && handleWahaCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'Lowercase letters, numbers and dashes only' : 'Solo minúsculas, números y guiones'}
                </span>} />
              {wahaLinkMethod === 'code' && (
                <TextField label={lang === 'en' ? 'Phone number' : 'Número de teléfono'} value={wahaPhone}
                  onChange={e => setWahaPhone(e.target.value)}
                  placeholder="521234567890" size="small" fullWidth sx={FIELD_SX}
                  onKeyDown={e => e.key === 'Enter' && !wahaLoading && wahaName.trim() && wahaPhone.trim() && handleWahaCreate()}
                  helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                    {lang === 'en' ? 'Country code + number, no spaces or +' : 'Código de país + número, sin espacios ni +'}
                  </span>} />
              )}
              {wahaErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: '#450a0a', border: '1px solid #ef4444' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wahaErr}</Typography>
                </Box>
              )}
              {wahaLoading && !wahaErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, p: 1.5, borderRadius: 1.5, bgcolor: '#1c2333', border: '1px solid #334155' }}>
                  <CircularProgress size={14} sx={{ color: '#60a5fa' }} />
                  <Typography sx={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600 }}>
                    {wahaLinkMethod === 'code'
                      ? (lang === 'en' ? 'Starting session, generating code…' : 'Iniciando sesión, generando código…')
                      : (lang === 'en' ? 'Starting session, generating QR…' : 'Iniciando sesión, generando QR…')}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <Divider sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', mt: 1 }} />
        <DialogActions sx={{ px: 3, pt: 1.5, pb: 2.5, gap: 1 }}>
          {!(wahaScanned && !wahaConnected) && (
            <Button onClick={wahaClose}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
              {wahaConnected ? (lang === 'en' ? 'Close' : 'Cerrar') : (lang === 'en' ? 'Cancel' : 'Cancelar')}
            </Button>
          )}
          {!wahaQr && !wahaPairingCode && !wahaConnected && !wahaScanned && (
            <Button
              onClick={handleWahaCreate}
              disabled={wahaLoading || !wahaName.trim() || (wahaLinkMethod === 'code' && !wahaPhone.trim())}
              variant="contained"
              sx={{
                // Antes iba en azul fijo (#3b82f6) sin importar el color de
                // paleta elegido en Ajustes — ahora sigue var(--accent) como
                // el resto de los botones "contained" de la app.
                bgcolor: 'var(--accent, #3b82f6)', textTransform: 'none', fontWeight: 700,
                fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
                '&:hover': { bgcolor: 'color-mix(in srgb, var(--accent, #3b82f6) 82%, black)' },
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
              }}
            >
              {wahaLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Creating…' : 'Creando…'}</>
                : (lang === 'en' ? 'Create' : 'Crear')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── Wasender create session dialog ── */}
      <Dialog open={wsOpen} onClose={() => !wsLoading && wsClose()} sx={{
        '& .MuiDialog-paper': {
          background: 'linear-gradient(160deg, rgba(167,139,250,0.1) 0%, transparent 55%), var(--card-bg,#161d2e)',
          border: '1px solid rgba(167,139,250,0.2)',
          borderRadius: 3, minWidth: 380,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
      }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: 2, flexShrink: 0,
              bgcolor: 'rgba(167,139,250,0.18)',
              border: '1px solid rgba(167,139,250,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SmartphoneIcon sx={{ fontSize: 18, color: '#a78bfa' }} />
            </Box>
            <Box>
              <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.97rem', lineHeight: 1.2 }}>
                {lang === 'en' ? 'New Wasender Session' : 'Nueva Sesión Wasender'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.72rem', mt: 0.2 }}>
                {lang === 'en' ? 'Link a WhatsApp number via WasenderAPI' : 'Vincula un número de WhatsApp vía WasenderAPI'}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '4px !important', px: 3 }}>
          {wsScanned && !wsConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 2 }}>
              <CircularProgress size={40} thickness={3} sx={{ color: '#25d366' }} />
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem' }}>
                {lang === 'en' ? 'QR scanned — authenticating…' : 'QR escaneado — autenticando…'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'WhatsApp is verifying the session on your phone'
                  : 'WhatsApp está verificando la sesión en tu teléfono'}
              </Typography>
            </Box>
          ) : wsConnected ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 2 }}>
              <CheckCircleIcon sx={{ fontSize: 52, color: '#4ade80' }} />
              <Typography sx={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem' }}>
                {lang === 'en' ? 'Session connected!' : '¡Sesión conectada!'}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>
                {lang === 'en' ? 'Assign it to a user from the panel.' : 'Asígnala a un usuario desde el panel.'}
              </Typography>
            </Box>
          ) : wsQr ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 0.5 }}>
              <Box component="img" src={wsQr} alt="QR"
                sx={{ width: 220, height: 220, borderRadius: 2, border: '2px solid #334155', bgcolor: '#fff', p: 1 }} />
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'Scan with WhatsApp → Settings → Linked Devices → Link a Device'
                  : 'Escanea con WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.6, borderRadius: 2,
                bgcolor: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)' }}>
                <CircularProgress size={12} sx={{ color: '#a78bfa' }} />
                <Typography sx={{ color: '#a78bfa', fontSize: '0.72rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Waiting for scan…' : 'Esperando escaneo…'}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField label={lang === 'en' ? 'Session name' : 'Nombre de sesión'} value={wsName}
                onChange={e => setWsName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="ws-mexico-1" size="small" fullWidth autoFocus sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wsLoading && wsName.trim() && wsPhone.trim() && handleWsCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'Lowercase letters, numbers and dashes only' : 'Solo minúsculas, números y guiones'}
                </span>} />
              <TextField label={lang === 'en' ? 'WhatsApp phone number' : 'Número de WhatsApp'} value={wsPhone}
                onChange={e => setWsPhone(e.target.value.replace(/[^+\d]/g, ''))}
                placeholder="+521234567890" size="small" fullWidth sx={FIELD_SX}
                onKeyDown={e => e.key === 'Enter' && !wsLoading && wsName.trim() && wsPhone.trim() && handleWsCreate()}
                helperText={<span style={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.68rem' }}>
                  {lang === 'en' ? 'International format with country code' : 'Formato internacional con código de país'}
                </span>} />
              {wsErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 1,
                  borderRadius: 1.5, bgcolor: '#450a0a', border: '1px solid #ef4444' }}>
                  <Typography sx={{ color: '#f87171', fontSize: '0.78rem' }}>{wsErr}</Typography>
                </Box>
              )}
              {wsLoading && !wsErr && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, p: 1.5,
                  borderRadius: 1.5, bgcolor: '#1c2333', border: '1px solid #334155' }}>
                  <CircularProgress size={14} sx={{ color: '#a78bfa' }} />
                  <Typography sx={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 600 }}>
                    {lang === 'en' ? 'Creating session…' : 'Creando sesión…'}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          {!(wsScanned && !wsConnected) && (
            <Button onClick={wsClose}
              sx={{ color: 'var(--text-muted,rgba(255,255,255,0.4))', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2 }}>
              {wsConnected ? (lang === 'en' ? 'Close' : 'Cerrar') : (lang === 'en' ? 'Cancel' : 'Cancelar')}
            </Button>
          )}
          {!wsQr && !wsConnected && !wsScanned && (
            <Button onClick={handleWsCreate} disabled={wsLoading || !wsName.trim() || !wsPhone.trim()} variant="contained"
              sx={{
                bgcolor: '#7c3aed', textTransform: 'none', fontWeight: 700,
                fontSize: '0.82rem', borderRadius: 2, minWidth: 130,
                '&:hover': { bgcolor: '#6d28d9' },
                '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)' },
              }}>
              {wsLoading
                ? <><CircularProgress size={14} sx={{ color: 'white', mr: 1 }} />{lang === 'en' ? 'Creating…' : 'Creando…'}</>
                : (lang === 'en' ? 'Create' : 'Crear')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

    </Box>
  )
}
