'use client'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Link from '@mui/material/Link'
import { useLang } from '../context/LangContext'

export default function ServiceBalanceNotice({ notification: n }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const ai = n.service === 'ai'
  const dollars = value => new Intl.NumberFormat(en ? 'en-US' : 'es-MX', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(Number(value))
  const title = ai
    ? (en ? 'OpenAI: budget nearly used' : 'OpenAI: presupuesto próximo a agotarse')
    : (en ? 'DataForSEO: low balance' : 'DataForSEO: saldo próximo a agotarse')
  const detail = ai
    ? (en ? `${dollars(n.amount)} of ${dollars(n.budget)} spent this month.` : `${dollars(n.amount)} de ${dollars(n.budget)} gastados este mes.`)
    : (en ? `${dollars(n.amount)} USD remaining. Top up to avoid interrupting Maps searches.` : `Quedan ${dollars(n.amount)} USD. Recarga para evitar interrupciones en las búsquedas de Maps.`)
  return (
    <Alert data-testid={`service-balance-${n.service}`} severity={n.severity === 'critical' ? 'error' : 'warning'}
      sx={{ flexShrink: 0, bgcolor: 'var(--card-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 2 }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.75rem', mt: .5 }}>{detail}</Typography>
      {ai && <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', mt: .6 }}>
        {en ? 'Budget reference, not prepaid credit. Costs may take time to update. This alert does not pause AI.' : 'Referencia de presupuesto, no saldo prepago. El gasto puede tardar en actualizarse. Este aviso no pausa la IA.'}
      </Typography>}
      <Box sx={{ mt: 1 }}>
        <Link href={ai ? 'https://platform.openai.com/settings/organization/billing/overview' : 'https://app.dataforseo.com/'}
          target="_blank" rel="noopener noreferrer" sx={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 600 }}>
          {en ? 'Review billing' : 'Revisar saldo y facturación'}
        </Link>
      </Box>
      <Typography sx={{ mt: .7, fontSize: '0.65rem', color: 'var(--text-muted)' }}>
        {en ? 'Last checked: ' : 'Última consulta: '}{new Date(n.checked_at).toLocaleString(en ? 'en-US' : 'es-MX')}
      </Typography>
    </Alert>
  )
}
