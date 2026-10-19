import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'

// Presentation only: counts, state and actions always come from the real job.
export default function ScrapeProgress({ processed, total, progress, paused, pausing, inFlight, currentUrl, onPause, onCancel, children, lang }) {
  const en = lang === 'en'
  const color = paused || pausing ? 'var(--warning-text, #b87900)' : 'var(--accent)'
  const pauseLabel = pausing ? (en ? 'Pausing…' : 'Pausando…') : paused ? (en ? 'Resume' : 'Reanudar') : (en ? 'Pause' : 'Pausar')
  return <Box data-scrape-progress sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0, p: { xs: 2, md: 2.5 }, border: '1px solid var(--border)', borderRadius: '16px', bgcolor: 'var(--card-bg)' }}>
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {paused && !pausing ? <PauseIcon sx={{ fontSize: 16, color, flexShrink: 0 }} /> : <CircularProgress size={14} sx={{ color, flexShrink: 0, '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& circle': { animation: 'none' } } }} />}
          <Typography sx={{ color: 'var(--text)', fontSize: '.95rem', fontWeight: 700 }}>
            {pausing ? (en ? `Pausing… finishing ${inFlight} in progress —` : `Pausando… terminando ${inFlight} en curso —`) : paused ? (en ? 'Paused —' : 'Pausado —') : (en ? 'Processing' : 'Procesando')} {processed} {en ? 'of' : 'de'} {total}
          </Typography>
        </Box>
        <Typography sx={{ color, fontWeight: 800, fontSize: '1.5rem', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{progress}%</Typography>
      </Box>
      <LinearProgress aria-label={en ? 'Scraping progress' : 'Avance del scraping'} variant="determinate" value={progress} sx={{ borderRadius: 4, height: 6, bgcolor: 'var(--item-hover)', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 }, '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { transition: 'none' } } }} />
      {currentUrl && !paused && <Typography sx={{ mt: 1.5, color: 'var(--text-muted)', fontSize: '.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUrl}</Typography>}
    </Box>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, pt: 1.5, borderTop: '1px solid var(--border)' }}>
      <Typography sx={{ flex: '1 1 240px', fontSize: '.78rem', color: 'var(--text-muted)' }}>{en ? 'Progress updates as each site finishes.' : 'El avance se actualiza al terminar cada sitio.'}</Typography>
      <Button disabled={pausing} onClick={onPause} startIcon={pausing ? <CircularProgress size={14} color="inherit" /> : paused ? <PlayArrowIcon /> : <PauseIcon />} sx={{ px: 2, py: .8, textTransform: 'none', fontWeight: 600, color, border: '1px solid var(--border)', borderRadius: 1.5, bgcolor: 'var(--item-hover)', '&:hover': { bgcolor: 'var(--border)' } }}>{pauseLabel}</Button>
      <Button onClick={onCancel} startIcon={<HighlightOffIcon />} color="error" variant="outlined" sx={{ px: 2, py: .8, textTransform: 'none', fontWeight: 600, borderRadius: 1.5 }}>{en ? 'Cancel' : 'Cancelar'}</Button>
      {children}
    </Box>
  </Box>
}
