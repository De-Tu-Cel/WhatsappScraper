import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Skeleton from '@mui/material/Skeleton'
import LinearProgress from '@mui/material/LinearProgress'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'

const panel = { border: '1px solid var(--border)', borderRadius: '14px', bgcolor: 'var(--card-bg)', overflow: 'hidden' }
const shimmer = {
  bgcolor: 'var(--item-hover)',
  '&::after': { background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.08), transparent)' },
  '@media (prefers-reduced-motion: reduce)': { animation: 'none', '&::after': { animation: 'none' } },
}

function PlaceholderRows({ count, paused = false }) {
  return <Box aria-hidden="true" sx={panel}>
    {Array.from({ length: count }, (_, i) => <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.6, borderBottom: i < count - 1 ? '1px solid var(--border)' : 0 }}>
      <Skeleton animation={paused ? false : "wave"} variant="rounded" width={17} height={17} sx={{ ...shimmer, flexShrink: 0 }} />
      <Skeleton animation={paused ? false : "wave"} variant="rounded" width={28} height={28} sx={{ ...shimmer, borderRadius: '8px', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton animation={paused ? false : "wave"} variant="rounded" height={10} sx={{ ...shimmer, width: `${[38, 52, 32, 45, 36, 56][i % 6]}%`, maxWidth: 360, minWidth: 65 }} />
        <Skeleton animation={paused ? false : "wave"} variant="rounded" height={7} sx={{ ...shimmer, width: '22%', maxWidth: 160, minWidth: 45, mt: 1 }} />
      </Box>
      <Skeleton animation={paused ? false : "wave"} variant="rounded" width={52} height={22} sx={{ ...shimmer, flexShrink: 0, borderRadius: '6px' }} />
    </Box>)}
  </Box>
}

export function ProspectSearchSkeleton({ query, count, lang }) {
  const en = lang === 'en'
  return <Box data-search-loading aria-busy="true" sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
    <Box role="status" sx={{ ...panel, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, flexShrink: 0, borderRadius: '11px', bgcolor: 'var(--item-hover)', color: 'var(--accent)' }}><TravelExploreIcon sx={{ fontSize: 22 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text)' }}>{en ? 'Finding prospects' : 'Buscando prospectos'}</Typography>
          <Typography sx={{ fontSize: '.8rem', color: 'var(--text-muted)', mt: .4, overflowWrap: 'anywhere' }}>{query}</Typography>
        </Box>
      </Box>
      <LinearProgress aria-label={en ? 'Search in progress' : 'Búsqueda en curso'} sx={{ mt: 2, height: 3, borderRadius: 2, bgcolor: 'var(--item-hover)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' }, '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { animation: 'none' } } }} />
      <Typography sx={{ fontSize: '.76rem', color: 'var(--text-muted)', mt: 1 }}>{en ? 'Results will appear when the search finishes.' : 'Los resultados aparecerán al terminar la búsqueda.'}</Typography>
    </Box>
    <Box aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'repeat(4, minmax(0,1fr))' }, gap: 1.25 }}>
      {[0, 1, 2, 3].map(i => <Box key={i} sx={{ ...panel, display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5 }}>
        <Skeleton animation="wave" variant="rounded" width={32} height={32} sx={{ ...shimmer, flexShrink: 0, borderRadius: '9px' }} />
        <Box sx={{ flex: 1 }}><Skeleton animation="wave" width="35%" height={24} sx={shimmer} /><Skeleton animation="wave" width="75%" height={13} sx={shimmer} /></Box>
      </Box>)}
    </Box>
    <PlaceholderRows count={Math.max(1, Math.min(count, 6))} />
  </Box>
}

export function ScrapingPlaceholders({ lang, paused }) {
  return <Box data-scrape-placeholders sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
    <Typography sx={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{lang === 'en' ? 'The first results will appear here as sites finish processing.' : 'Los primeros resultados aparecerán aquí conforme termine cada sitio.'}</Typography>
    <PlaceholderRows count={3} paused={paused} />
  </Box>
}

export function SingleScrapeStatus({ url, lang }) {
  const en = lang === 'en'
  return <Box data-single-scrape-status role="status" sx={{ ...panel, p: 2, mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <TravelExploreIcon sx={{ color: 'var(--accent)', fontSize: 22 }} />
      <Typography sx={{ fontWeight: 700, color: 'var(--text)', fontSize: '.95rem' }}>{en ? 'Processing website' : 'Procesando sitio web'}</Typography>
    </Box>
    <Typography sx={{ mt: 1, color: 'var(--text-muted)', fontSize: '.82rem', overflowWrap: 'anywhere' }}>{url}</Typography>
    <LinearProgress aria-label={en ? 'Scraping in progress' : 'Scraping en curso'} sx={{ mt: 2, height: 3, borderRadius: 2, bgcolor: 'var(--item-hover)', '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' }, '@media (prefers-reduced-motion: reduce)': { '& .MuiLinearProgress-bar': { animation: 'none' } } }} />
    <Typography sx={{ mt: 1, color: 'var(--text-muted)', fontSize: '.76rem' }}>{en ? 'Business details and contacts will appear when processing finishes.' : 'Los datos de la empresa y sus contactos aparecerán al terminar.'}</Typography>
  </Box>
}
