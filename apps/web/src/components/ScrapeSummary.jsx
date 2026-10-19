import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import SendIcon from '@mui/icons-material/Send'

export default function ScrapeSummary({ processed, total, ok, errors, withWa, selected, available, sent, lang }) {
  const en = lang === 'en'
  const cells = [
    { key: 'done', icon: <TravelExploreIcon />, value: processed, label: en ? 'Processed' : 'Procesadas', sub: processed < total ? `${en ? 'of' : 'de'} ${total}` : null, alert: errors > 0 ? `${errors} ${en ? 'with error' : 'con error'}` : null, color: '#60a5fa' },
    { key: 'wa', icon: <WhatsAppIcon />, value: withWa, label: en ? 'With WhatsApp' : 'Con WhatsApp', sub: ok > 0 ? `${Math.round(withWa / ok * 100)}%` : null, color: '#4ade80' },
    { key: 'selected', icon: <CheckBoxIcon />, value: selected, label: en ? 'Numbers selected' : 'Números seleccionados', sub: available > 0 ? `${en ? 'of' : 'de'} ${available}` : null, color: '#a78bfa' },
    { key: 'sent', icon: <SendIcon />, value: sent, label: en ? 'Sent' : 'Enviadas', color: '#fbbf24' },
  ]
  return <Box data-scrape-summary sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', lg: 'repeat(4,minmax(0,1fr))' }, flexShrink: 0, borderRadius: 2.5, border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', overflow: 'hidden' }}>
    {cells.map((c, index) => <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: { xs: 1, md: 2.4 }, py: 2, minWidth: 0, position: 'relative', '&::before': { content: '""', display: { xs: index % 2 ? 'block' : 'none', lg: index ? 'block' : 'none' }, position: 'absolute', left: 0, top: '24%', bottom: '24%', width: '1px', bgcolor: 'var(--border)' } }}>
      <Box sx={{ width: 38, height: 38, flexShrink: 0, borderRadius: 2, color: c.color, bgcolor: `${c.color}14`, border: `1px solid ${c.color}4d`, display: 'grid', placeItems: 'center', '& svg': { fontSize: 20 } }}>{c.icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: .7 }}>
          <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{c.value}</Typography>
          {c.sub && <Typography sx={{ fontSize: '.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>{c.sub}</Typography>}
        </Box>
        <Typography sx={{ fontSize: '.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>{c.label}</Typography>
        {c.alert && <Typography sx={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{c.alert}</Typography>}
      </Box>
    </Box>)}
  </Box>
}
