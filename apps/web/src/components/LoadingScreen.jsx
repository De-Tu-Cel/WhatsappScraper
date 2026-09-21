'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import AnimatedFingerprint from './AnimatedFingerprint'

export default function LoadingScreen() {
  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      bgcolor: 'var(--bg,#080c14)',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{
          width: 80, height: 80, borderRadius: 3, flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)', border: '1px solid var(--accent,#3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AnimatedFingerprint size={48} color="var(--accent,#60a5fa)" duration={1600} />
        </Box>
        <Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.4rem', lineHeight: 1.25 }}>Mystery</Typography>
          <Typography sx={{ color: 'var(--accent,#60a5fa)', fontWeight: 600, fontSize: '1.25rem', lineHeight: 1.25 }}>Shopper</Typography>
        </Box>
      </Box>
    </Box>
  )
}
