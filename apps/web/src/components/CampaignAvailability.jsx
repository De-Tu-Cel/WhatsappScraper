import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Skeleton from '@mui/material/Skeleton'
import SendIcon from '@mui/icons-material/Send'
import GroupsIcon from '@mui/icons-material/Groups'
import AccessTimeIcon from '@mui/icons-material/AccessTime'

export default function CampaignAvailability({ stats, selectedCount, newSelectedCount, en }) {
  const metrics = [
    { key: 'messages', value: stats?.total_available, selected: selectedCount,
      label: en ? 'Messages available' : 'Mensajes disponibles',
      hint: en ? 'To new or existing contacts' : 'A contactos nuevos o ya contactados', icon: <SendIcon /> },
    { key: 'contacts', value: stats?.new_contacts_capacity, selected: newSelectedCount,
      label: en ? 'New contacts' : 'Contactos nuevos',
      hint: en ? 'Numbers you have never messaged' : 'Números a los que aún no has escrito', icon: <GroupsIcon /> },
  ]
  return (
    <Box data-campaign-availability sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '.83rem' }}>
          {selectedCount ? (en ? 'Remaining after this campaign' : 'Te quedaría después de esta campaña') : (en ? 'Your capacity today' : 'Tu capacidad para hoy')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: .5, color: 'var(--text-muted)', flexShrink: 0 }}>
          <AccessTimeIcon sx={{ fontSize: 12 }} />
          <Typography sx={{ fontSize: '.68rem', fontWeight: 600 }}>{en ? 'TODAY' : 'HOY'}</Typography>
        </Box>
      </Box>
      <Box aria-live="polite" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
        {metrics.map(({ key, value, selected, label, hint, icon }) => {
          const known = Number.isFinite(value)
          const remaining = known ? Math.max(0, value - selected) : null
          return (
            <Box key={key} data-campaign-metric={label} data-availability-kind={key} sx={{
              minWidth: 0, p: 1.25, borderRadius: 2.5, border: '1px solid var(--border)',
              background: key === 'messages' ? 'linear-gradient(145deg, rgba(var(--accent-rgb,59,130,246),.13), rgba(var(--accent-rgb,59,130,246),.035))' : 'var(--card-bg)',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: .7 }}>
                <Box sx={{ width: 30, height: 30, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
                  bgcolor: 'rgba(var(--accent-rgb,59,130,246),.1)', color: 'var(--accent)', '& svg': { fontSize: 16 } }}>{icon}</Box>
                {known ? <Typography data-availability-value sx={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1,
                  letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums', color: remaining ? 'var(--text)' : 'var(--text-muted)' }}>{remaining}</Typography>
                  : stats ? <Typography sx={{ color: 'var(--text-muted)' }}>—</Typography> : <Skeleton aria-label={en ? 'Checking capacity' : 'Consultando cupo'} width={42} height={30} />}
              </Box>
              <Typography sx={{ color: 'var(--text)', fontSize: '.78rem', fontWeight: 700, lineHeight: 1.35 }}>{label}</Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '.69rem', lineHeight: 1.4, mt: .35 }}>{hint}</Typography>
            </Box>
          )
        })}
      </Box>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: '.68rem', lineHeight: 1.4, mt: .85 }}>
        {en ? 'Each new contact also uses one message.' : 'Cada contacto nuevo también utiliza un mensaje.'}
      </Typography>
    </Box>
  )
}
