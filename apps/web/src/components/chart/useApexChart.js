'use client'
import { useTheme, alpha } from '@mui/material/styles'

// Same base ApexCharts config as minimal-ui-kit/material-kit-react's
// use-chart.ts, adapted from theme.vars.palette.* (MUI CSS-variables mode,
// which this app doesn't enable) to plain theme.palette.* against our own
// dark theme (src/theme/theme.js) — same visual language, own token source.
export function useApexChart(overrides) {
  const theme = useTheme()
  const base = baseChartOptions(theme)
  return deepMerge(base, overrides || {})
}

function baseChartOptions(theme) {
  const LABEL_TOTAL = {
    show: true,
    label: 'Total',
    color: theme.palette.text.secondary,
    fontSize: String(theme.typography.subtitle2.fontSize),
    fontWeight: theme.typography.subtitle2.fontWeight,
  }
  const LABEL_VALUE = {
    offsetY: 8,
    color: theme.palette.text.primary,
    fontSize: String(theme.typography.h4.fontSize),
    fontWeight: theme.typography.h4.fontWeight,
  }

  return {
    chart: {
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      fontFamily: theme.typography.fontFamily,
      foreColor: theme.palette.text.disabled,
      background: 'transparent',
      animations: {
        enabled: true,
        speed: 360,
        animateGradually: { enabled: true, delay: 120 },
        dynamicAnimation: { enabled: true, speed: 360 },
      },
    },
    colors: [
      theme.palette.primary.main,
      theme.palette.warning.main,
      theme.palette.success.main,
      theme.palette.error.main,
      theme.palette.secondary.main,
      theme.palette.primary.light,
    ],
    states: {
      hover: { filter: { type: 'darken' } },
      active: { filter: { type: 'darken' } },
    },
    fill: {
      opacity: 1,
      gradient: { type: 'vertical', shadeIntensity: 0, opacityFrom: 0.4, opacityTo: 0, stops: [0, 100] },
    },
    dataLabels: { enabled: false },
    stroke: { width: 2.5, curve: 'smooth', lineCap: 'round' },
    grid: {
      strokeDashArray: 3,
      borderColor: theme.palette.divider,
      padding: { top: 0, right: 0, bottom: 0 },
      xaxis: { lines: { show: false } },
    },
    // crosshairs (línea guía vertical punteada) + xaxis.tooltip (la
    // etiqueta flotante con la categoría, ej. "Jun") + markers.hover (el
    // punto de color exacto donde está el mouse) son lo que le faltaba al
    // hover para verse como el de referencia — antes solo se veía el cuadro
    // de valores, sin nada que marcara la posición real sobre la curva.
    xaxis: {
      axisBorder: { show: false }, axisTicks: { show: false },
      crosshairs: { show: true, stroke: { color: theme.palette.text.disabled, width: 1, dashArray: 4 } },
      // El tamaño por default del texto (~14px) hacía que tanto el tooltip
      // principal como esta "pill" flotante de categoría se vieran enormes
      // comparados con el resto de la UI — ambos bajan a un tamaño acorde
      // al resto de las gráficas (etiquetas de eje ya van en 10px).
      tooltip: { enabled: true, style: { fontSize: '10px' } },
    },
    yaxis: { tickAmount: 5 },
    markers: { size: 0, strokeColors: theme.palette.background.paper, hover: { size: 4, sizeOffset: 1 } },
    tooltip: { theme: 'dark', fillSeriesColor: false, x: { show: true }, marker: { show: true }, style: { fontSize: '11px' } },
    legend: {
      show: false,
      position: 'top',
      fontWeight: 500,
      fontSize: '13px',
      horizontalAlign: 'right',
      markers: { shape: 'circle' },
      labels: { colors: theme.palette.text.primary },
      itemMargin: { horizontal: 8, vertical: 8 },
    },
    plotOptions: {
      bar: { borderRadius: 4, columnWidth: '48%', borderRadiusApplication: 'end' },
      pie: { donut: { labels: { show: true, value: { ...LABEL_VALUE }, total: { ...LABEL_TOTAL } } } },
      radialBar: {
        hollow: { margin: -8, size: '100%' },
        track: { margin: -8, strokeWidth: '50%', background: alpha(theme.palette.grey[500], 0.16) },
        dataLabels: { value: { ...LABEL_VALUE }, total: { ...LABEL_TOTAL } },
      },
    },
    responsive: [
      { breakpoint: theme.breakpoints.values.sm, options: { plotOptions: { bar: { borderRadius: 3, columnWidth: '80%' } } } },
      { breakpoint: theme.breakpoints.values.md, options: { plotOptions: { bar: { columnWidth: '60%' } } } },
    ],
  }
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v) }
function deepMerge(a, b) {
  const out = { ...a }
  for (const k of Object.keys(b || {})) {
    out[k] = isPlainObject(a[k]) && isPlainObject(b[k]) ? deepMerge(a[k], b[k]) : b[k]
  }
  return out
}
