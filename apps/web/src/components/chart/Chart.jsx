'use client'
import dynamic from 'next/dynamic'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import './styles.css'

// ApexCharts keeps a single GLOBAL registry of every chart instance on the
// page at window.Apex._chartInstances (used for the chart.group sync/zoom
// feature, which we don't use, but the library checks it on every
// updateOptions() call regardless). It's only lazily set to [] the first
// time any one chart instance finishes constructing — but the internal
// getGroupedCharts() that reads it during updateOptions() has NO guard for
// it still being undefined at that point (two sibling methods in the same
// file do guard for exactly this). With this dashboard mounting 6 chart
// instances at once, if any chart's updateOptions() fires before the very
// first chart's registration step completes, ApexCharts itself throws
// "Cannot read properties of undefined (reading 'filter')" — confirmed by
// reading node_modules/apexcharts/dist/core.esm.js directly. Initializing
// the array ourselves before any chart ever mounts closes the race
// regardless of mount order/timing.
if (typeof window !== 'undefined') {
  window.Apex = window.Apex || {}
  window.Apex._chartInstances = window.Apex._chartInstances || []
}

// Same shape as the reference's ChartLoading — a skeleton filling the chart's
// own footprint (circular for pie/donut/radialBar/polarArea, else rectangular)
// instead of a spinner, so the loading state doesn't jump around.
const CIRCULAR_TYPES = ['donut', 'radialBar', 'pie', 'polarArea']
function ChartLoading({ type }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0, borderRadius: 'inherit' }}>
      <Skeleton variant={CIRCULAR_TYPES.includes(type) ? 'circular' : 'rounded'}
        sx={{ width: '100%', height: '100%', bgcolor: 'var(--border, rgba(255,255,255,0.08))' }} />
    </Box>
  )
}

// ApexCharts touches `window` at import time, so it can never be part of the
// server-rendered bundle — same reason the reference component lazy-loads it,
// simplified here to Next's own no-SSR dynamic import instead of manually
// wiring React.lazy + a client-only check. The loading fallback is built once
// per `type` (module-level cache) so it stays a stable reference across
// renders instead of being recreated — dynamic() would otherwise re-trigger
// its own lazy load every time.
const chartsByType = {}
function getReactApexChart(type) {
  if (!chartsByType[type]) {
    chartsByType[type] = dynamic(() => import('react-apexcharts'), {
      ssr: false,
      loading: () => <ChartLoading type={type} />,
    })
  }
  return chartsByType[type]
}

// This installed react-apexcharts (2.1.1) is the newer hooks-based rewrite,
// NOT the older class component — it does not accept a React `ref` at all
// (it's a plain function component, never wrapped in forwardRef). It reads
// the ApexCharts instance handle from a plain PROP called `chartRef`
// instead, and assigns the instance directly to `chartRef.current` (no
// `.chart` wrapper, unlike the old class-ref convention). Passing `ref=`
// here (the previous version of this file did, via forwardRef) doesn't
// match what the library reads, which left every chart silently never
// completing its own mount — no crash, no warning, just an empty div,
// confirmed by inspecting the DOM directly and reading
// node_modules/react-apexcharts/dist/react-apexcharts.esm.js.
export function Chart({ type, series, options, height, width = '100%', sx, chartRef }) {
  const ReactApexChart = getReactApexChart(type)
  return (
    <Box sx={{ width, flexShrink: 0, position: 'relative', ...sx }}>
      <ReactApexChart chartRef={chartRef} type={type} series={series} options={options} height={height} width={width} />
    </Box>
  )
}
