import Typography from '@mui/material/Typography'

export default function LineActivityStatus({ activity, lang = 'es' }) {
  if (!activity || (!activity.operation && !activity.queued)) return null
  const en = lang === 'en'
  const names = en
    ? { send: 'Sending a message', 'send-media': 'Sending a file', verify: 'Checking a phone', read: 'Reading a chat', typing: 'Composing', react: 'Reacting', 'contact/save': 'Saving a contact', messages: 'Syncing history', presence: 'Updating presence', 'profile-sync': 'Checking the profile' }
    : { send: 'Enviando mensaje', 'send-media': 'Enviando archivo', verify: 'Verificando teléfono', read: 'Leyendo chat', typing: 'Escribiendo', react: 'Enviando reacción', 'contact/save': 'Guardando contacto', messages: 'Sincronizando historial', presence: 'Actualizando presencia', 'profile-sync': 'Consultando perfil' }
  const label = activity.operation
    ? names[activity.operation] || (en ? 'Operation in progress' : 'Operación en curso')
    : (en ? 'Waiting for a turn' : 'Esperando turno')
  return (
    <Typography data-line-activity title={en ? 'Automatic activity: 08:00–19:00, Mexico City. One operation per line.' : 'Actividad automática: 08:00–19:00, CDMX. Una operación por línea.'}
      sx={{ fontSize: '0.62rem', mt: 0.35, color: activity.operation ? 'var(--accent)' : 'var(--text-muted)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
      {label}{activity.queued > 0 ? ` · ${activity.queued} ${en ? 'waiting for a turn' : 'esperando turno'}` : ''}
    </Typography>
  )
}
