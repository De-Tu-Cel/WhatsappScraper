'use client'
// Panel "Desempeño" de Instancias — separado de InstancesPanel.jsx (que ya
// pasaba de 5k líneas) cuando se agregaron embudo, resultado de envíos,
// estabilidad por sesión y tiempo de primera respuesta (2026-10-19).
import { useState, useRef } from 'react'
import Box from '@mui/material/Box'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Skeleton from '@mui/material/Skeleton'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import InsightsIcon from '@mui/icons-material/Insights'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import BarChartIcon from '@mui/icons-material/BarChart'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import SendIcon from '@mui/icons-material/Send'
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import TimerIcon from '@mui/icons-material/Timer'
import ViewQuiltIcon from '@mui/icons-material/ViewQuilt'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import BlockIcon from '@mui/icons-material/Block'
import HelpIcon from '@mui/icons-material/Help'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import { alpha, useTheme } from '@mui/material/styles'
import { Chart } from './chart/Chart'
import { ChartLegends } from './chart/ChartLegends'
import { useApexChart } from './chart/useApexChart'

// Header for each chart sub-card — a colored icon in a small gradient box
// next to the title, same visual language as the Performance banner's own
// icon box. `subtitle` explains what is counted; `right` holds a headline
// number so the card doesn't need a separate stat tile.
function ChartCardHeader({ icon, color, title, subtitle, right }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.4 }}>
      <Box sx={{
        width: 26, height: 26, borderRadius: '8px', flexShrink: 0,
        background: `linear-gradient(135deg, ${alpha(color, 0.24)} 0%, ${alpha(color, 0.08)} 100%)`,
        border: `1px solid ${alpha(color, 0.32)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.35, mt: 0.15 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {right && <Box sx={{ flexShrink: 0, textAlign: 'right' }}>{right}</Box>}
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

// lowerIsBetter: para métricas como el tiempo de respuesta, donde bajar es
// la buena noticia — la flecha sigue la dirección real, el color no.
function DashStatCard({ color, value, title, pctChange, sparkData, categories, range, lang, lowerIsBetter = false, sparkFormatter, footnote }) {
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
      y: { formatter: (v) => v == null ? '' : (sparkFormatter ? sparkFormatter(v) : v.toLocaleString()) },
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
  const good = lowerIsBetter ? !up : up
  return (
    <Box sx={{
      minWidth: 0, height: '100%', boxSizing: 'border-box', p: 1.4, pt: 1.5, borderRadius: 2.5, position: 'relative', overflow: 'hidden',
      background: `linear-gradient(160deg, ${alpha(color, 0.09)} 0%, transparent 55%), var(--card-bg, rgba(255,255,255,0.02))`,
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
    }}>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', mb: 0.6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.6 }}>
        <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
        {sparkData && sparkData.length > 1 && (
          <Chart type="line" series={[{ name: title, data: sparkData }]} options={chartOptions} height={30} width={64} sx={{ mr: 0.4 }} />
        )}
      </Box>
      {pctChange != null && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.8 }}>
          <Box sx={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: good ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
          }}>
            {up ? <TrendingUpIcon sx={{ fontSize: 10, color: good ? '#4ade80' : '#f87171' }} /> : <TrendingDownIcon sx={{ fontSize: 10, color: good ? '#4ade80' : '#f87171' }} />}
          </Box>
          <Typography sx={{ fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ fontWeight: 700, color: good ? '#4ade80' : '#f87171' }}>{up ? '+' : ''}{pctChange}%</Box>
            <Box component="span" sx={{ color: 'var(--text-muted)' }}>
              {' '}{(RANGE_COMPARE_LABEL[range] ?? RANGE_COMPARE_LABEL.week)[lang === 'en' ? 'en' : 'es']}
            </Box>
          </Typography>
        </Box>
      )}
      {footnote && (
        <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {footnote}
        </Typography>
      )}
    </Box>
  )
}

// Small glance card for an external paid service's spend/balance — not a
// full billing dashboard, just enough to notice if something's off. Three
// states: not configured yet (no key set), error (call failed), or the real
// number. Deliberately simpler than DashStatCard (no sparkline/%-change,
// there's no meaningful trend data for a single point-in-time balance).
function BalanceCard({ label, lang, loading, data, unit }) {
  const notConfigured = !loading && (!data || data.configured === false)
  const errored = !loading && data && data.configured && data.ok === false
  const dotColor = notConfigured ? 'var(--text-muted)' : errored ? '#f87171' : '#4ade80'
  let display = '—'
  if (!loading && data?.ok) {
    const n = unit === 'balance' ? data.balance : data.spend_this_month
    display = n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  }
  const subtitle = notConfigured
    ? (lang === 'en' ? 'Not set up' : 'No configurado')
    : errored
      ? (lang === 'en' ? 'Check failed' : 'Error al consultar')
      : (unit === 'balance' ? (lang === 'en' ? 'Current balance' : 'Saldo actual') : (lang === 'en' ? 'Spend this month' : 'Gasto este mes'))
  return (
    <Box sx={{
      minWidth: 0, p: 1.2, borderRadius: 2.5,
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
      border: '1px solid var(--border, rgba(255,255,255,0.08))',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: dotColor }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: notConfigured || errored ? 'var(--text-muted)' : 'var(--text)', lineHeight: 1.1 }}>
          {loading ? '…' : display}
        </Typography>
        <Typography sx={{ fontSize: '0.64rem', color: 'var(--text-muted)', lineHeight: 1.3, mt: 0.2 }}>{subtitle}</Typography>
        {unit === 'spend' && notConfigured && (
          <Typography sx={{ fontSize: '0.64rem', color: 'var(--text-muted)', mt: 0.4 }}>
            {lang === 'en' ? 'Connect an Anthropic Admin API key and workspace to view Claude costs.' : 'Configura una clave Admin de Anthropic y su workspace para consultar el gasto de Claude.'}
          </Typography>
        )}
        {unit === 'spend' && data?.ok && data.monthly_budget_usd > 0 && (
          <Typography sx={{ fontSize: '0.64rem', color: 'var(--text-muted)', mt: 0.4 }}>
            {lang === 'en' ? `Alert budget: $${data.monthly_budget_usd} USD · not prepaid credit` : `Presupuesto de alerta: $${data.monthly_budget_usd} USD · no es saldo prepago`}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

const MONTH_NAMES = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}

// How many past calendar years the "Año" menu and the "Mes" menu's year
// switcher offer — arbitrary but generous lookback; picking a year with no
// data just shows zeros (see the backend's month/year bounds), it's not an
// error case that needs guarding against here.
const PERIOD_YEARS_BACK = 5

// Lets "Mes"/"Año" jump to any past calendar period — previously those tabs
// only ever showed the current month/year with no way to look further back,
// so checking e.g. March's numbers meant waiting for March to come around
// again. The center label opens a menu to jump directly to any month/year in
// one click (a prev/next-only stepper meant clicking 8 times to go from
// September back to January); the arrows stay for quick one-step nudges.
// Hidden entirely for "Hoy"/"Semana", which stay rolling lookbacks (a
// "specific past day/week" picker wasn't asked for).
function PeriodStepper({ range, year, month, lang, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null)
  // The year being browsed inside the month-picker menu — separate from the
  // committed `year` prop so paging through years while choosing a month
  // doesn't change the dashboard's data until an actual month is clicked.
  const [menuYear, setMenuYear] = useState(year)
  if (range !== 'month' && range !== 'year') return null
  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const atLatest = range === 'month' ? (year === curYear && month === curMonth) : (year === curYear)
  const label = range === 'month' ? `${MONTH_NAMES[lang === 'en' ? 'en' : 'es'][month - 1]} ${year}` : `${year}`
  const step = (dir) => {
    if (range === 'month') {
      let m = month + dir, y = year
      if (m < 1) { m = 12; y -= 1 }
      if (m > 12) { m = 1; y += 1 }
      onChange(y, m)
    } else {
      onChange(year + dir, month)
    }
  }
  const openMenu = (e) => { setMenuYear(year); setAnchorEl(e.currentTarget) }
  const closeMenu = () => setAnchorEl(null)
  const monthLabels = MONTH_NAMES[lang === 'en' ? 'en' : 'es']

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.2, px: 0.4, py: 0.2, borderRadius: 2,
      bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.1))',
    }}>
      <IconButton size="small" onClick={() => step(-1)} sx={{ p: 0.4 }}
        aria-label={lang === 'en' ? 'Previous period' : 'Periodo anterior'}>
        <ChevronLeftIcon sx={{ fontSize: 16, color: 'var(--text-muted)' }} />
      </IconButton>
      <Typography onClick={openMenu} sx={{
        fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)', minWidth: 92, textAlign: 'center',
        userSelect: 'none', cursor: 'pointer', borderRadius: 1, px: 0.4,
        '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))' },
      }}>
        {label}
      </Typography>
      <IconButton size="small" onClick={() => step(1)} disabled={atLatest} sx={{ p: 0.4 }}
        aria-label={lang === 'en' ? 'Next period' : 'Periodo siguiente'}>
        <ChevronRightIcon sx={{ fontSize: 16, color: atLatest ? 'var(--border)' : 'var(--text-muted)' }} />
      </IconButton>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        elevation={0}
        slotProps={{
          list: { sx: { p: 0 } },
          paper: {
            sx: {
              mt: 0.7, borderRadius: 3,
              // MUI's Menu paper defaults to overflowY:'auto' with a fairly
              // tight maxHeight — with only a handful of years/12 months this
              // never actually needs to scroll, so the default was showing a
              // pointless scrollbar on a list that fully fits.
              maxHeight: 'none', overflow: 'visible',
              bgcolor: 'var(--card-bg, #16181d)',
              border: '1px solid var(--border, rgba(255,255,255,0.1))',
              boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
            },
          },
        }}>
        {/* Mismo encabezado (ícono en caja degradada + texto) que usan las
           cabeceras de las gráficas — para que el menú se sienta parte del
           mismo diseño en vez de un <select> genérico del navegador. */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.4, py: 1,
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.14) 0%, rgba(var(--accent-rgb,59,130,246),0.03) 70%, transparent 100%)',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        }}>
          <Box sx={{
            width: 22, height: 22, borderRadius: '7px', flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.28) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
            border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CalendarMonthIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 13 }} />
          </Box>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)' }}>
            {range === 'year'
              ? (lang === 'en' ? 'Jump to year' : 'Ir a un año')
              : (lang === 'en' ? 'Jump to month' : 'Ir a un mes')}
          </Typography>
        </Box>

        {range === 'year' ? (
          <Box sx={{ p: 0.6, minWidth: 130 }}>
            {Array.from({ length: PERIOD_YEARS_BACK + 1 }, (_, i) => curYear - i).map(y => {
              const active = y === year
              return (
                <MenuItem key={y} selected={active} onClick={() => { onChange(y, month); closeMenu() }}
                  sx={{
                    fontSize: '0.78rem', fontWeight: active ? 700 : 500, justifyContent: 'center', borderRadius: 1.6, my: 0.15,
                    color: active ? '#fff' : 'var(--text)',
                    bgcolor: active ? 'var(--accent, #3b82f6) !important' : 'transparent',
                    '&:hover': { bgcolor: active ? 'var(--accent, #3b82f6)' : 'var(--item-hover, rgba(255,255,255,0.06))' },
                  }}>
                  {y}
                </MenuItem>
              )
            })}
          </Box>
        ) : (
          <Box sx={{ px: 1, py: 0.8, minWidth: 230 }}>
            {/* Pill del año, mismo lenguaje visual que el segmented control de
               Hoy/Semana/Mes/Año — no flechas + número sueltos. */}
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mb: 0.8,
              borderRadius: 2, bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border, rgba(255,255,255,0.1))',
              px: 0.3, py: 0.2,
            }}>
              <IconButton size="small" onClick={() => setMenuYear(y => y - 1)} sx={{ p: 0.3 }}
                aria-label={lang === 'en' ? 'Previous year' : 'Año anterior'}>
                <ChevronLeftIcon sx={{ fontSize: 15, color: 'var(--text-muted)' }} />
              </IconButton>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
                {menuYear}
              </Typography>
              <IconButton size="small" onClick={() => setMenuYear(y => y + 1)} disabled={menuYear >= curYear} sx={{ p: 0.3 }}
                aria-label={lang === 'en' ? 'Next year' : 'Año siguiente'}>
                <ChevronRightIcon sx={{ fontSize: 15, color: menuYear >= curYear ? 'var(--border)' : 'var(--text-muted)' }} />
              </IconButton>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, pb: 0.4 }}>
              {monthLabels.map((label, idx) => {
                const m = idx + 1
                const disabled = menuYear === curYear && m > curMonth
                const active = menuYear === year && m === month
                return (
                  <Box key={m} onClick={() => { if (disabled) return; onChange(menuYear, m); closeMenu() }}
                    sx={{
                      px: 0.8, py: 0.6, borderRadius: 1.6, textAlign: 'center', fontSize: '0.72rem', fontWeight: 700,
                      cursor: disabled ? 'default' : 'pointer', userSelect: 'none', transition: 'background-color 0.15s ease, color 0.15s ease',
                      color: disabled ? 'var(--border)' : active ? '#fff' : 'var(--text)',
                      bgcolor: active ? 'var(--accent, #3b82f6)' : 'transparent',
                      boxShadow: active ? '0 2px 8px rgba(var(--accent-rgb,59,130,246),0.4)' : 'none',
                      '&:hover': disabled ? {} : { bgcolor: active ? 'var(--accent, #3b82f6)' : 'var(--item-hover, rgba(255,255,255,0.06))' },
                    }}>
                    {label.slice(0, 3)}
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
      </Menu>
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


// ── Piezas compartidas del grid ──────────────────────────────────────────────

const PANEL_SX = {
  minWidth: 0, boxSizing: 'border-box', borderRadius: 2.5, p: 1.6,
  bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
  border: '1px solid var(--border, rgba(255,255,255,0.08))',
  display: 'flex', flexDirection: 'column',
}
const TRACK_BG = 'var(--item-hover, rgba(255,255,255,0.05))'

// Celda del grid de 12 columnas: ancho completo hasta lg, `span` columnas
// desde ahí. Cada fila usa una proporción distinta (7/5, 8/4, 5/7, 4/8) para
// que el panel no se lea como la misma tarjeta repetida una y otra vez.
function PerfCard({ span = 12, children, sx }) {
  return <Box sx={{ ...PANEL_SX, gridColumn: { xs: 'span 12', lg: `span ${span}` }, ...sx }}>{children}</Box>
}

function SectionLabel({ children }) {
  return (
    <Box sx={{ gridColumn: 'span 12', display: 'flex', alignItems: 'center', gap: 1.2, mt: 0.8 }}>
      <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {children}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, var(--border, rgba(255,255,255,0.12)), transparent)' }} />
    </Box>
  )
}

function EmptyState({ msg, height = 200 }) {
  return (
    <Box sx={{ flex: 1, minHeight: height, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
      <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{msg}</Typography>
    </Box>
  )
}

// El backend no mandó el bloque (versión vieja del servidor): decirlo tal
// cual en vez de un "sin actividad" que contradice las tarjetas de arriba.
function Unavailable({ lang }) {
  return <EmptyState msg={lang === 'en'
    ? 'The server did not return this metric. Restart or update the backend.'
    : 'El servidor no devolvió esta métrica. Reinicia o actualiza el backend.'} />
}

function HeadlineNumber({ value, label }) {
  return (
    <>
      <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{label}</Typography>
    </>
  )
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

// Minutos → texto corto legible ("4 min", "2 h 15 min", "1.5 d").
export function fmtDuration(min) {
  if (min == null) return '—'
  if (min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  if (min < 1440) {
    const total = Math.round(min)
    const h = Math.floor(total / 60), m = total % 60
    return m ? `${h} h ${m} min` : `${h} h`
  }
  const d = min / 1440
  return `${d.toFixed(d < 10 ? 1 : 0)} d`
}

// Causas que manda wwebjs-service (DisconnectReason de whatsapp-web.js y los
// estados del heartbeat), más las claves en minúscula de proveedores viejos.
const SESSION_REASON_LABEL = {
  es: {
    HEARTBEAT_TIMEOUT: 'Dejó de responder', LOGOUT: 'Cerrada en el teléfono', UNPAIRED: 'Desvinculada',
    UNPAIRED_IDLE: 'Desvinculado por inactividad', TOS_BLOCK: 'Bloqueo por términos de WhatsApp', SMB_TOS_BLOCK: 'Bloqueo de WA Business',
    CONFLICT: 'Abierta en otro lugar', NAVIGATION: 'Recarga de WhatsApp Web', AUTH_FAILURE: 'Fallo de autenticación',
    RECOVERY_LIMIT: 'Agotó los reintentos', error: 'Agotó los reintentos', PROXY_INVALID: 'Proxy inválido o faltante',
    auth_failure: 'Fallo de autenticación', need_scan: 'Requiere escanear QR', disconnected: 'Desconexión', unknown: 'Sin causa registrada',
    banned: 'Baneado por WhatsApp', logged_out: 'Cerró sesión', conflict: 'Conflicto de dispositivo', timeout: 'Timeout de conexión',
    closed: 'Conexión cerrada', replaced: 'Sesión reemplazada', restart: 'Requiere reinicio',
  },
  en: {
    HEARTBEAT_TIMEOUT: 'Stopped responding', LOGOUT: 'Logged out on phone', UNPAIRED: 'Unlinked',
    UNPAIRED_IDLE: 'Unlinked for inactivity', TOS_BLOCK: 'WhatsApp terms block', SMB_TOS_BLOCK: 'WA Business block',
    CONFLICT: 'Opened elsewhere', NAVIGATION: 'WhatsApp Web reload', AUTH_FAILURE: 'Authentication failure',
    RECOVERY_LIMIT: 'Ran out of retries', error: 'Ran out of retries', PROXY_INVALID: 'Invalid or missing proxy',
    auth_failure: 'Authentication failure', need_scan: 'QR scan required', disconnected: 'Disconnected', unknown: 'No cause recorded',
    banned: 'Banned by WhatsApp', logged_out: 'Logged out', conflict: 'Device conflict', timeout: 'Connection timeout',
    closed: 'Connection closed', replaced: 'Session replaced', restart: 'Restart required',
  },
}
const reasonLabel = (reason, lang, fallback) =>
  SESSION_REASON_LABEL[lang === 'en' ? 'en' : 'es'][reason] ?? fallback ?? reason

// Color fijo por instancia (orden alfabético de TODAS las instancias, no por
// ranking de volumen) — así una instancia no cambia de color al cambiar de rango.
const INSTANCE_PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#60a5fa']
function instanceColorMap(names) {
  const map = {}
  ;[...names].sort().forEach((n, i) => { map[n] = INSTANCE_PALETTE[i % INSTANCE_PALETTE.length] })
  return map
}

// ── 1. Embudo contactadas → respondieron ─────────────────────────────────────

const FUNNEL_GRID = { xs: '92px minmax(0,1fr) 58px', sm: '124px minmax(0,1fr) 64px' }

function FunnelCard({ funnel, lang }) {
  const en = lang === 'en'
  const steps = [
    { key: 'contacted',    label: en ? 'Contacted' : 'Contactadas',        hint: en ? 'Distinct companies we wrote to' : 'Empresas distintas a las que se les escribió' },
    { key: 'accepted',     label: en ? 'Send confirmed' : 'Envío confirmado', hint: en ? 'WhatsApp accepted at least one of our messages' : 'WhatsApp aceptó al menos uno de los mensajes' },
    { key: 'replied',      label: en ? 'Replied' : 'Respondieron',          hint: en ? 'Answered at least once in the period' : 'Contestaron al menos una vez en el periodo' },
    { key: 'conversation', label: en ? 'Conversation' : 'Conversación',     hint: en ? 'Replied 2 or more times' : 'Respondieron 2 o más veces' },
  ]
  const top = funnel?.contacted ?? 0
  const shades = [0.95, 0.78, 0.6, 0.44]
  const repliedPct = pct(funnel?.replied ?? 0, top)
  const convPct = pct(funnel?.conversation ?? 0, top)
  return (
    <>
      <ChartCardHeader icon={<FilterAltIcon sx={{ fontSize: 15, color: '#3b82f6' }} />} color="#3b82f6"
        title={en ? 'Contacted → replied' : 'Contactadas → respondieron'}
        subtitle={en ? 'Distinct companies at each step' : 'Empresas distintas en cada paso'} />
      {funnel === undefined ? <Unavailable lang={lang} /> : top === 0 ? <EmptyState msg={en ? 'Nobody was contacted in this range' : 'No se contactó a nadie en este rango'} /> : (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {steps.map((s, i) => {
            const value = funnel?.[s.key] ?? 0
            const width = value > 0 ? Math.max(4, (value / top) * 100) : 0
            const prevValue = i > 0 ? (funnel?.[steps[i - 1].key] ?? 0) : null
            const stepRate = i > 0 ? pct(value, prevValue) : null
            return (
              <Box key={s.key}>
                {i > 0 && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: FUNNEL_GRID, columnGap: 1.2, alignItems: 'center', height: 20 }}>
                    <span />
                    <Typography sx={{ textAlign: 'center', fontSize: '0.62rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      ↓ {stepRate == null ? '—' : `${stepRate}%`} {en ? 'move on' : 'avanza'}
                    </Typography>
                    <span />
                  </Box>
                )}
                <Tooltip title={s.hint} placement="top" arrow>
                  <Box sx={{ display: 'grid', gridTemplateColumns: FUNNEL_GRID, columnGap: 1.2, alignItems: 'center', cursor: 'default' }}>
                    <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{s.label}</Typography>
                    <Box sx={{ height: 30, display: 'flex', justifyContent: 'center', borderRadius: 1.5, bgcolor: TRACK_BG }}>
                      <Box sx={{
                        width: `${width}%`, height: '100%', borderRadius: 1.5,
                        background: `linear-gradient(90deg, rgba(var(--accent-rgb,59,130,246),${shades[i]}) 0%, rgba(var(--accent-rgb,59,130,246),${shades[i] * 0.8}) 100%)`,
                        transition: 'width 0.5s ease',
                      }} />
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                        {value.toLocaleString()}
                      </Typography>
                      <Typography sx={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {i === 0 ? '100%' : `${pct(value, top)}%`}
                      </Typography>
                    </Box>
                  </Box>
                </Tooltip>
              </Box>
            )
          })}
          <Typography sx={{ mt: 1.6, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {en
              ? <>Out of every 100 contacted, <b style={{ color: 'var(--text)' }}>{repliedPct}</b> reply and <b style={{ color: 'var(--text)' }}>{convPct}</b> keep the conversation going.</>
              : <>De cada 100 contactadas, <b style={{ color: 'var(--text)' }}>{repliedPct}</b> responden y <b style={{ color: 'var(--text)' }}>{convPct}</b> siguen la conversación.</>}
          </Typography>
        </Box>
      )}
    </>
  )
}

// ── 2. Resultado de envíos ───────────────────────────────────────────────────

const OUTCOMES = [
  { key: 'confirmed', color: '#22c55e', Icon: CheckCircleIcon, es: 'Confirmados', en: 'Confirmed',
    hintEs: 'WhatsApp aceptó el mensaje', hintEn: 'WhatsApp accepted the message' },
  { key: 'failed', color: '#ef4444', Icon: CancelIcon, es: 'Fallidos', en: 'Failed',
    hintEs: 'El envío falló (desconexión, número inválido, error del proveedor)', hintEn: 'The send failed (disconnection, invalid number, provider error)' },
  { key: 'uncertain', color: '#f59e0b', Icon: HelpIcon, es: 'Entrega incierta', en: 'Uncertain',
    hintEs: 'Se cortó a medio envío: revisar el chat antes de repetir (total global, sin instancia)', hintEn: 'Cut off mid-send: check the chat before retrying (global total, no instance)' },
  { key: 'blocked', color: '#94a3b8', Icon: BlockIcon, es: 'Frenados por reglas', en: 'Blocked by rules',
    hintEs: 'No se enviaron por las reglas de contacto (lista negra, baja, etc.)', hintEn: 'Not sent because of contact rules (blacklist, opt-out, etc.)' },
]
const INSTANCE_OUTCOMES = OUTCOMES.filter(o => o.key !== 'uncertain')

function SendOutcomesCard({ outcomes, lang }) {
  const en = lang === 'en'
  const theme = useTheme()
  const items = OUTCOMES.map(o => ({ ...o, value: outcomes?.[o.key] ?? 0 }))
  const total = items.reduce((sum, o) => sum + o.value, 0)
  const instances = outcomes?.instances ?? []
  const donutOptions = useApexChart({
    labels: items.map(o => (en ? o.en : o.es)),
    colors: items.map(o => o.color),
    stroke: { width: 2, colors: [theme.palette.background.paper] },
    legend: { show: false },
    dataLabels: { enabled: false },
    tooltip: { y: { formatter: (v) => `${v.toLocaleString()} ${en ? 'messages' : 'mensajes'}` } },
    plotOptions: { pie: { donut: { size: '76%', labels: {
      show: true,
      name: { offsetY: 18, fontSize: '11px' },
      value: { offsetY: -14, fontSize: '22px', fontWeight: 800, formatter: (v) => Number(v).toLocaleString() },
      total: { show: true, showAlways: true, label: en ? 'Sends' : 'Envíos', fontSize: '11px', formatter: () => total.toLocaleString() },
    } } } },
  })
  return (
    <>
      <ChartCardHeader icon={<SendIcon sx={{ fontSize: 14, color: '#22c55e' }} />} color="#22c55e"
        title={en ? 'Send outcome' : 'Resultado de envíos'}
        subtitle={en ? 'Every outbound message attempt' : 'Cada intento de mensaje saliente'} />
      {outcomes === undefined ? <Unavailable lang={lang} /> : total === 0 ? <EmptyState msg={en ? 'No sends in this range' : 'Sin envíos en este rango'} /> : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Chart type="donut" width={150} height={150} series={items.map(o => o.value)} options={donutOptions} sx={{ mx: 'auto' }} />
            <Box sx={{ flex: '1 1 160px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.9 }}>
              {items.map(({ key, color, Icon, value, ...o }) => (
                <Tooltip key={key} title={en ? o.hintEn : o.hintEs} placement="left" arrow>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, cursor: 'default' }}>
                    <Icon sx={{ fontSize: 15, color, flexShrink: 0 }} />
                    <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.74rem', fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{en ? o.en : o.es}</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</Typography>
                    <Typography sx={{ width: 42, textAlign: 'right', fontSize: '0.64rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{pct(value, total)}%</Typography>
                  </Box>
                </Tooltip>
              ))}
              <Tooltip arrow placement="left" title={en
                ? 'Messages with a delivery receipt (double check). For WhatsApp Web lines it is recorded starting with this version.'
                : 'Mensajes con acuse de entrega (doble palomita). En líneas de WhatsApp Web se registra a partir de esta versión.'}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.3, pt: 0.8, borderTop: '1px dashed var(--border)', cursor: 'help' }}>
                  <DoneAllIcon sx={{ fontSize: 14, color: '#60a5fa' }} />
                  <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                    <b style={{ color: 'var(--text)' }}>{(outcomes?.delivered ?? 0).toLocaleString()}</b> {en ? 'with delivery receipt' : 'con acuse de entrega'}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>
          </Box>
          {instances.length > 0 && (
            <Box sx={{ mt: 1.6, pt: 1.2, borderTop: '1px solid var(--border)' }}>
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {en ? 'By instance' : 'Por instancia'}
              </Typography>
              <Box sx={{ maxHeight: 112, overflowY: 'auto', pr: 0.5, display: 'flex', flexDirection: 'column', gap: 0.8,
                '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 } }}>
                {instances.map(r => {
                  const rowTotal = r.confirmed + r.failed + r.blocked
                  return (
                    <Tooltip key={r.instance_name} placement="left" arrow
                      title={INSTANCE_OUTCOMES.map(o => `${r[o.key]} ${(en ? o.en : o.es).toLowerCase()}`).join(' · ')}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: '104px minmax(0,1fr) 36px', alignItems: 'center', gap: 1, cursor: 'default' }}>
                        <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.instance_name}</Typography>
                        <Box sx={{ display: 'flex', gap: '2px', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: TRACK_BG }}>
                          {INSTANCE_OUTCOMES.map(o => r[o.key] > 0 && (
                            <Box key={o.key} sx={{ flex: r[o.key], bgcolor: o.color }} />
                          ))}
                        </Box>
                        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rowTotal}</Typography>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
            </Box>
          )}
        </>
      )}
    </>
  )
}

// ── 3. Estabilidad por sesión ────────────────────────────────────────────────

const uptimeColor = (p) => (p == null ? '#64748b' : p >= 95 ? '#22c55e' : p >= 80 ? '#f59e0b' : '#ef4444')
const STABILITY_GRID = { xs: 'minmax(0,1fr) minmax(0,1.3fr) 52px', md: 'minmax(0,1fr) minmax(0,1.6fr) 64px minmax(0,1.3fr)' }

function StabilityCard({ stability, lang }) {
  const en = lang === 'en'
  // Solo sesiones con algún dato real en el rango — una instancia sin ningún
  // evento de conexión registrado no es "0% de uptime", es "sin datos".
  const rows = (stability ?? []).filter(r => r.uptime_pct != null || r.disconnects > 0)
  const totalDisconnects = rows.reduce((sum, r) => sum + r.disconnects, 0)
  const head = (txt, sx) => (
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', ...sx }}>{txt}</Typography>
  )
  return (
    <>
      <ChartCardHeader icon={<NetworkCheckIcon sx={{ fontSize: 15, color: '#14b8a6' }} />} color="#14b8a6"
        title={en ? 'Stability by session' : 'Estabilidad por sesión'}
        subtitle={en ? 'Time connected, drops and their main cause' : 'Tiempo conectada, caídas y su causa principal'}
        right={<HeadlineNumber value={totalDisconnects.toLocaleString()} label={en ? 'disconnections' : 'desconexiones'} />} />
      {stability === undefined ? <Unavailable lang={lang} /> : rows.length === 0 ? <EmptyState msg={en ? 'No connection events recorded in this range' : 'Sin eventos de conexión registrados en este rango'} /> : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: STABILITY_GRID, columnGap: 1.4, px: 1, pb: 0.6, borderBottom: '1px solid var(--border)' }}>
            {head(en ? 'Session' : 'Sesión')}
            {head(en ? 'Availability' : 'Disponibilidad')}
            {head(en ? 'Drops' : 'Caídas', { textAlign: 'center' })}
            {head(en ? 'Main cause' : 'Causa principal', { display: { xs: 'none', md: 'block' } })}
          </Box>
          <Box sx={{ flex: 1, maxHeight: 248, overflowY: 'auto', pr: 0.3,
            '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(100,116,139,0.3)', borderRadius: 4 } }}>
            {rows.map(r => {
              const p = r.uptime_pct == null ? null : Math.round(r.uptime_pct)
              const color = uptimeColor(p)
              const reasons = Object.entries(r.reasons || {}).sort((a, b) => b[1] - a[1])
              const top = reasons[0]
              return (
                <Box key={r.instance_name} sx={{
                  display: 'grid', gridTemplateColumns: STABILITY_GRID, columnGap: 1.4, alignItems: 'center',
                  px: 1, py: 0.9, borderBottom: '1px solid var(--border)', '&:last-of-type': { borderBottom: 'none' },
                  '&:hover': { bgcolor: TRACK_BG },
                }}>
                  <Typography sx={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.instance_name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: TRACK_BG, overflow: 'hidden' }}>
                      <Box sx={{ width: `${p ?? 0}%`, height: '100%', borderRadius: 3, bgcolor: color, transition: 'width 0.5s ease' }} />
                    </Box>
                    <Typography sx={{ width: 34, textAlign: 'right', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                      {p == null ? '—' : `${p}%`}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Box sx={{
                      minWidth: 28, px: 0.8, py: 0.15, borderRadius: 10, textAlign: 'center', fontSize: '0.68rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                      color: r.disconnects ? '#fca5a5' : 'var(--text-muted)',
                      bgcolor: r.disconnects ? 'rgba(239,68,68,0.12)' : 'transparent',
                      border: `1px solid ${r.disconnects ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                    }}>{r.disconnects}</Box>
                  </Box>
                  <Tooltip arrow placement="top" title={reasons.length > 1 ? reasons.map(([k, n]) => `${reasonLabel(k, lang)}: ${n}`).join(' · ') : ''}>
                    <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: '0.68rem', color: top ? 'var(--text)' : 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {top ? `${reasonLabel(top[0], lang)}${reasons.length > 1 ? ` +${reasons.length - 1}` : ''}` : '—'}
                    </Typography>
                  </Tooltip>
                </Box>
              )
            })}
          </Box>
        </>
      )}
    </>
  )
}

function DisconnectReasonsCard({ reasons, lang }) {
  const en = lang === 'en'
  const rows = (reasons ?? []).slice(0, 8)
  const options = useApexChart({
    colors: ['#f97316'],
    plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end', barHeight: '56%' } },
    xaxis: {
      categories: rows.map(r => reasonLabel(r.reason, lang, r.label)),
      labels: { style: { fontSize: '10px' }, formatter: (v) => Math.round(v) },
      tooltip: { enabled: false }, crosshairs: { show: false },
    },
    yaxis: { labels: { style: { fontSize: '11px' }, maxWidth: 220 } },
    grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    tooltip: { y: { formatter: (v) => `${v} ${en ? 'disconnections' : 'desconexiones'}`, title: { formatter: () => '' } } },
  })
  return (
    <>
      <ChartCardHeader icon={<LinkOffIcon sx={{ fontSize: 15, color: '#f97316' }} />} color="#f97316"
        title={en ? 'Why sessions drop' : 'Causas de desconexión'}
        subtitle={en ? 'All sessions, this period' : 'Todas las sesiones, este periodo'} />
      {reasons === undefined ? <Unavailable lang={lang} /> : rows.length === 0 ? <EmptyState msg={en ? 'No disconnections in this range' : 'Sin desconexiones en este rango'} /> : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <Chart type="bar" height={Math.max(170, rows.length * 38 + 40)} series={[{ name: en ? 'Disconnections' : 'Desconexiones', data: rows.map(r => r.count) }]} options={options} />
        </Box>
      )}
    </>
  )
}

// ── 4. Tiempo de primera respuesta ───────────────────────────────────────────

const RESPONSE_BIN_LABELS = {
  lt5m: '<5 min', '5_30m': '5–30 min', '30m_2h': '30 min–2 h', '2_8h': '2–8 h', '8_24h': '8–24 h', gt24h: '>24 h',
}

function ResponseDistributionCard({ data, lang }) {
  const en = lang === 'en'
  const bins = data?.histogram ?? []
  const options = useApexChart({
    colors: ['#a78bfa'],
    plotOptions: { bar: { borderRadius: 5, borderRadiusApplication: 'end', columnWidth: '64%' } },
    xaxis: { categories: bins.map(b => RESPONSE_BIN_LABELS[b.key] ?? b.key), labels: { style: { fontSize: '10px' } }, tooltip: { enabled: false } },
    yaxis: { labels: { formatter: (v) => Math.round(v) } },
    tooltip: { y: { formatter: (v) => `${v} ${en ? 'contacts' : 'contactos'}` } },
  })
  return (
    <>
      <ChartCardHeader icon={<TimerIcon sx={{ fontSize: 15, color: '#a78bfa' }} />} color="#a78bfa"
        title={en ? 'How fast they reply' : 'Qué tan rápido responden'}
        subtitle={en ? 'Time from our first message to their first reply' : 'Del primer mensaje enviado a su primera respuesta'}
        right={<HeadlineNumber value={fmtDuration(data?.median_minutes)} label={en ? `median · ${data?.count ?? 0} replies` : `mediana · ${data?.count ?? 0} respuestas`} />} />
      {data === undefined ? <Unavailable lang={lang} /> : !data?.count ? <EmptyState msg={en ? 'No replies in this range' : 'Sin respuestas en este rango'} /> : (
        <Chart type="bar" height={210} series={[{ name: en ? 'Contacts' : 'Contactos', data: bins.map(b => b.count) }]} options={options} />
      )}
    </>
  )
}

function ResponseTrendCard({ data, lang }) {
  const en = lang === 'en'
  const series = data?.timeseries ?? []
  const options = useApexChart({
    colors: ['#a78bfa'],
    stroke: { width: 2, curve: 'smooth' },
    markers: { size: 4, hover: { size: 6 } },
    xaxis: { categories: series.map(r => r.bucket), labels: { style: { fontSize: '10px' } } },
    yaxis: { labels: { formatter: (v) => fmtDuration(v) } },
    tooltip: {
      y: { formatter: (v, { dataPointIndex }) => `${fmtDuration(v)} · ${series[dataPointIndex]?.count ?? 0} ${en ? 'replies' : 'respuestas'}` },
    },
  })
  return (
    <>
      <ChartCardHeader icon={<ShowChartIcon sx={{ fontSize: 15, color: '#a78bfa' }} />} color="#a78bfa"
        title={en ? 'Median first reply over time' : 'Mediana de primera respuesta en el tiempo'}
        subtitle={en ? 'Grouped by the day the first message went out' : 'Agrupada por el día en que salió el primer mensaje'} />
      {data === undefined ? <Unavailable lang={lang} /> : series.length === 0 ? <EmptyState msg={en ? 'No replies in this range' : 'Sin respuestas en este rango'} /> : (
        <Chart type="line" height={210} series={[{ name: en ? 'Median' : 'Mediana', data: series.map(r => r.median_minutes) }]} options={options} />
      )}
    </>
  )
}

// ── 5. Volumen ───────────────────────────────────────────────────────────────

function ShareTreemapCard({ rows, colorMap, lang }) {
  const en = lang === 'en'
  const options = useApexChart({
    colors: rows.map(r => colorMap[r.instance_name] ?? INSTANCE_PALETTE[0]),
    legend: { show: false },
    plotOptions: { treemap: { distributed: true, enableShades: false, borderRadius: 6 } },
    dataLabels: {
      enabled: true, style: { fontSize: '12px', fontWeight: 700 },
      formatter: (text, op) => [text, op.value.toLocaleString()], offsetY: -2,
    },
    stroke: { width: 2, colors: ['rgba(0,0,0,0.25)'] },
    tooltip: { y: { formatter: (v) => `${v.toLocaleString()} ${en ? 'messages' : 'mensajes'}` } },
  })
  return (
    <>
      <ChartCardHeader icon={<ViewQuiltIcon sx={{ fontSize: 15, color: '#8b5cf6' }} />} color="#8b5cf6"
        title={en ? 'Share by instance' : 'Reparto por instancia'}
        subtitle={en ? 'Tile size = messages sent' : 'Tamaño del bloque = mensajes enviados'} />
      {rows.length === 0 ? <EmptyState msg={en ? 'No activity in this range' : 'Sin actividad en este rango'} /> : (
        <Chart type="treemap" height={240}
          series={[{ data: rows.map(r => ({ x: r.instance_name, y: r.messages_sent })) }]} options={options} />
      )}
    </>
  )
}

function useSeriesToggle() {
  const chartRef = useRef(null)
  const [hidden, setHidden] = useState(() => new Set())
  // react-apexcharts 2.1.1 (hooks) asigna la instancia directo a chartRef.current.
  const toggle = (label) => {
    chartRef.current?.toggleSeries(label)
    setHidden(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }
  return { chartRef, hidden, toggle }
}

function InstanceBarsCard({ rows, lang }) {
  const en = lang === 'en'
  const { chartRef, hidden, toggle } = useSeriesToggle()
  const labels = [en ? 'Messages sent' : 'Mensajes enviados', en ? 'Contacts reached' : 'Contactos alcanzados']
  const colors = [alpha('#3b82f6', 0.85), alpha('#22c55e', 0.85)]
  // legend:false — la leyenda nativa de ApexCharts incrusta un <style> en un
  // foreignObject que en ciertos hovers se pintaba como texto crudo; se usa
  // <ChartLegends> en DOM normal en su lugar.
  const options = useApexChart({
    colors,
    stroke: { width: 2, colors: ['transparent'] },
    plotOptions: { bar: { borderRadius: 6, borderRadiusApplication: 'end', columnWidth: '55%' } },
    xaxis: { categories: rows.map(r => r.instance_name), labels: { style: { fontSize: '10px' }, rotate: -35 } },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => v.toLocaleString() } },
  })
  return (
    <>
      <ChartCardHeader icon={<BarChartIcon sx={{ fontSize: 15, color: '#3b82f6' }} />} color="#3b82f6"
        title={en ? 'Per-instance breakdown' : 'Detalle por instancia'}
        subtitle={en ? 'Messages vs. distinct contacts' : 'Mensajes contra contactos distintos'} />
      {rows.length === 0 ? <EmptyState msg={en ? 'No activity in this range' : 'Sin actividad en este rango'} /> : (
        <>
          <ChartLegends labels={labels} colors={colors} hidden={hidden} onToggle={toggle} sx={{ mb: 1 }} />
          <Chart chartRef={chartRef} type="bar" height={Math.max(200, Math.min(260, rows.length * 40))}
            series={[
              { name: labels[0], data: rows.map(r => r.messages_sent) },
              { name: labels[1], data: rows.map(r => r.contacts_reached) },
            ]}
            options={options} />
        </>
      )}
    </>
  )
}

function VolumeTrendCard({ timeseries, lang }) {
  const en = lang === 'en'
  const { chartRef, hidden, toggle } = useSeriesToggle()
  const labels = [en ? 'Messages' : 'Mensajes', en ? 'Contacts' : 'Contactos']
  const options = useApexChart({
    colors: ['#3b82f6', '#22c55e'],
    xaxis: { categories: timeseries.map(r => r.bucket), labels: { style: { fontSize: '10px' } } },
    legend: { show: false },
    tooltip: { y: { formatter: (v) => v.toLocaleString() } },
  })
  return (
    <>
      <ChartCardHeader icon={<ShowChartIcon sx={{ fontSize: 15, color: '#22c55e' }} />} color="#22c55e"
        title={en ? 'Messages & contacts over time' : 'Mensajes y contactos en el tiempo'} />
      {timeseries.length === 0 ? <EmptyState msg={en ? 'No activity in this range' : 'Sin actividad en este rango'} height={240} /> : (
        <>
          <ChartLegends labels={labels} colors={['#3b82f6', '#22c55e']} hidden={hidden} onToggle={toggle} sx={{ mb: 1 }} />
          <Chart chartRef={chartRef} type="area" height={240}
            series={[
              { name: labels[0], data: timeseries.map(r => r.messages_sent) },
              { name: labels[1], data: timeseries.map(r => r.contacts_reached) },
            ]}
            options={options} />
        </>
      )}
    </>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// Métricas reales (nada inventado): message_logs para volumen, embudo,
// resultados y primera respuesta; delivery_receipts para la entrega incierta;
// instance_health_logs para uptime y desconexiones (GET /admin/instances/metrics).
// chartsReady=false mantiene todas las gráficas en skeleton aunque ya hayan
// llegado los datos — page.jsx pre-monta cada pestaña oculta (display:none) y
// ApexCharts revienta midiendo un contenedor de tamaño cero ("Cannot read
// properties of undefined (reading 'filter')"). Solo se pintan de verdad una
// vez que la pestaña se activó al menos una vez.
export default function InstancesDashboard({ metrics, loading, range, onRangeChange, lang, chartsReady = true, balances, balancesLoading,
  periodYear, periodMonth, onPeriodChange }) {
  const en = lang === 'en'
  const showCharts = !loading && chartsReady
  const RANGES = [
    { key: 'day',   label: en ? 'Today' : 'Hoy' },
    { key: 'week',  label: en ? 'Week' : 'Semana' },
    { key: 'month', label: en ? 'Month' : 'Mes' },
    { key: 'year',  label: en ? 'Year' : 'Año' },
  ]
  const rows = metrics?.instances ?? []
  const uptimeMap = metrics?.uptime ?? {}
  const withActivity = rows.filter(r => r.messages_sent > 0)
  const colorMap = instanceColorMap(rows.map(r => r.instance_name))
  // Solo promedia instancias con dato REAL de uptime — "sin ningún log de
  // conexión" no es lo mismo que "0% conectada".
  const uptimeValues = withActivity
    .map(r => uptimeMap[r.instance_name]?.uptime_pct)
    .filter(v => v != null)
  const avgUptime = uptimeValues.length
    ? Math.round(uptimeValues.reduce((sum, v) => sum + v, 0) / uptimeValues.length)
    : null
  const timeseries = metrics?.timeseries ?? []
  const firstResponse = metrics?.first_response
  const frMedian = firstResponse?.median_minutes
  const frPrev = firstResponse?.prev_median_minutes
  const frPctChange = frMedian != null && frPrev ? Math.round(((frMedian - frPrev) / frPrev) * 1000) / 10 : null

  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))',
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Mismo banner de encabezado (glow + ícono en caja degradada) que usa
         el título de Prospects. */}
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
              {en ? 'Performance' : 'Desempeño'}
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
              {en ? 'Conversion, delivery, stability and response time' : 'Conversión, entregas, estabilidad y tiempo de respuesta'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <PeriodStepper range={range} year={periodYear} month={periodMonth} lang={lang} onChange={onPeriodChange} />
          {/* Segmented control — el rango activo lleva fondo sólido. */}
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
      </Box>

      <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 1.5, alignItems: 'stretch' }}>
        {!showCharts ? (
          <>
            <Box sx={{ gridColumn: 'span 12', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.5 }}>
              {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} variant="rounded" sx={{ height: 96, bgcolor: 'var(--border)', borderRadius: 2.5 }} />)}
            </Box>
            {[7, 5, 8, 4, 5, 7].map((span, i) => (
              <Box key={i} sx={{ ...PANEL_SX, gridColumn: { xs: 'span 12', lg: `span ${span}` } }}>
                <Skeleton variant="text" width="45%" sx={{ mb: 1, bgcolor: 'var(--border)', fontSize: '0.8rem' }} />
                <Skeleton variant="rounded" height={220} sx={{ bgcolor: 'var(--border)' }} />
              </Box>
            ))}
          </>
        ) : (
          <>
            {/* KPIs — auto-fit: 5 por fila en ancho completo, se acomodan solos en angosto. */}
            <Box sx={{ gridColumn: 'span 12', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.5 }}>
              <DashStatCard range={range} color="#3b82f6" lang={lang}
                value={(metrics?.total_messages ?? 0).toLocaleString()} title={en ? 'Messages sent' : 'Mensajes enviados'}
                pctChange={metrics?.messages_pct_change} sparkData={timeseries.map(r => r.messages_sent)}
                categories={timeseries.map(r => r.bucket)}
                footnote={metrics?.warmup_messages > 0
                  ? (en ? `Excludes ${metrics.warmup_messages.toLocaleString()} warmup` : `Sin contar ${metrics.warmup_messages.toLocaleString()} de calentamiento`)
                  : null} />
              <DashStatCard range={range} color="#22c55e" lang={lang}
                value={(metrics?.total_contacts ?? 0).toLocaleString()} title={en ? 'Contacts reached' : 'Contactos alcanzados'}
                pctChange={metrics?.contacts_pct_change} sparkData={timeseries.map(r => r.contacts_reached)}
                categories={timeseries.map(r => r.bucket)} />
              {/* % de contactos distintos que respondieron al menos una vez (no
                 entrantes ÷ salientes, que daba >100% en producción). */}
              <DashStatCard range={range} color="#06b6d4" lang={lang}
                value={metrics?.response_rate != null ? `${metrics.response_rate}%` : '—'}
                title={en ? 'Response rate' : 'Tasa de respuesta'}
                pctChange={metrics?.response_rate_pct_change} />
              <DashStatCard range={range} color="#a78bfa" lang={lang} lowerIsBetter
                value={fmtDuration(frMedian)} title={en ? 'First reply (median)' : '1ª respuesta (mediana)'}
                pctChange={frPctChange} sparkData={(firstResponse?.timeseries ?? []).map(r => r.median_minutes)}
                categories={(firstResponse?.timeseries ?? []).map(r => r.bucket)} sparkFormatter={fmtDuration} />
              <InstanceHealthCard avgUptime={avgUptime} uptimeMap={uptimeMap} instances={withActivity} lang={lang} />
            </Box>

            <SectionLabel>{en ? 'Conversion & delivery' : 'Conversión y entregas'}</SectionLabel>
            <PerfCard span={7}><FunnelCard funnel={metrics?.funnel} lang={lang} /></PerfCard>
            <PerfCard span={5}><SendOutcomesCard outcomes={metrics?.send_outcomes} lang={lang} /></PerfCard>

            <SectionLabel>{en ? 'Session stability' : 'Estabilidad de sesiones'}</SectionLabel>
            <PerfCard span={8}><StabilityCard stability={metrics?.stability} lang={lang} /></PerfCard>
            <PerfCard span={4}><DisconnectReasonsCard reasons={metrics?.disconnect_reasons} lang={lang} /></PerfCard>

            <SectionLabel>{en ? 'Response time' : 'Tiempo de respuesta'}</SectionLabel>
            <PerfCard span={5}><ResponseDistributionCard data={firstResponse} lang={lang} /></PerfCard>
            <PerfCard span={7}><ResponseTrendCard data={firstResponse} lang={lang} /></PerfCard>

            <SectionLabel>{en ? 'Volume' : 'Volumen'}</SectionLabel>
            <PerfCard span={4}><ShareTreemapCard rows={withActivity} colorMap={colorMap} lang={lang} /></PerfCard>
            <PerfCard span={8}><InstanceBarsCard rows={withActivity} lang={lang} /></PerfCard>
            <PerfCard span={12}><VolumeTrendCard timeseries={timeseries} lang={lang} /></PerfCard>
          </>
        )}

        {/* Saldo/gasto de servicios de pago — al final: es para tener a la
           vista si algo se dispara, no una métrica de desempeño de las líneas. */}
        <SectionLabel>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
            <AccountBalanceWalletIcon sx={{ fontSize: 13 }} />{en ? 'Paid services' : 'Servicios de pago'}
          </Box>
        </SectionLabel>
        <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6' }, display: 'grid' }}>
          <BalanceCard label="Claude" lang={lang} loading={balancesLoading} data={balances?.anthropic} unit="spend" />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', md: 'span 6' }, display: 'grid' }}>
          <BalanceCard label="DataForSEO" lang={lang} loading={balancesLoading} data={balances?.dataforseo} unit="balance" />
        </Box>
      </Box>
    </Box>
  )
}
