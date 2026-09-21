'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// Simplified port of the reference ChartLegends — a dot + label + value row
// per series, without the icon/sublabel/slotProps surface we don't use.
// onToggle (present) makes each item clickable to show/hide its series —
// same pattern as ApexCharts' own native legend, just driven by our custom
// DOM legend instead (native legend was dropped earlier for the raw-CSS
// tooltip bug it caused). `hidden` marks which labels are currently off.
export function ChartLegends({ labels = [], colors = [], values = [], hidden, onToggle, sx }) {
  return (
    <Box component="ul" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, listStyle: 'none', p: 0, m: 0, ...sx }}>
      {labels.map((label, i) => {
        const isHidden = hidden?.has ? hidden.has(label) : false
        const clickable = !!onToggle
        return (
          <Box component="li" key={label}
            onClick={clickable ? () => onToggle(label, i) : undefined}
            sx={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
              cursor: clickable ? 'pointer' : 'default',
              opacity: isHidden ? 0.35 : 1,
              transition: 'opacity 0.15s',
              userSelect: 'none',
              ...(clickable && { '&:hover': { opacity: isHidden ? 0.5 : 0.8 } }),
            }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: colors[i] }} />
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', textDecoration: isHidden ? 'line-through' : 'none' }}>{label}</Typography>
            </Box>
            {values[i] != null && (
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', mt: 0.5 }}>{values[i]}</Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
