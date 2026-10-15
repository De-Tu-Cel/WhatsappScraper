'use client'
import { useState, useRef } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import { authFetch } from '@/lib/api'
import { useUser } from '@/context/UserContext'
import { useLang } from '@/context/LangContext'

export default function ServiceHealthNotice({ notification, onRefresh, onCheckResult }) {
  const { user } = useUser()
  const { lang } = useLang()
  const en = lang === 'en'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const checkLock = useRef(false)
  async function check(service) {
    if (busy || checkLock.current) return
    checkLock.current = true
    setBusy(true); setError('')
    try {
      const res = await authFetch('/api/services/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      const checked = data.check
      const state = data.services?.[service]
      if (!checked && !state) throw new Error(en ? 'The server did not return a check result.' : 'El servidor no devolvió el resultado de la comprobación.')
      const available = checked?.available ?? state?.status === 'available'
      const reason = checked?.reason ?? state?.reason
      const details = {
        billing: en ? 'Credit is still unavailable or the spending limit remains active.' : 'Sigue sin saldo o con el límite de gasto activo.',
        auth: en ? 'Check the provider credentials.' : 'Revisa las credenciales del proveedor.',
        rate_limit: en ? 'The provider still has a temporary request limit.' : 'El proveedor sigue con un límite temporal de solicitudes.',
        unavailable: en ? 'The provider could not be reached. Try again later.' : 'No se pudo comunicar con el proveedor. Inténtalo más tarde.',
      }
      const label = service === 'ai' ? 'IA' : 'DataForSEO'
      let message = service === 'ai'
        ? (available ? (en ? 'AI responded successfully. The provider is available.' : 'La IA respondió correctamente. El proveedor está disponible.') : details[reason] || details.unavailable)
        : (en ? 'Balance check completed.' : 'Consulta de saldo completada.')
      if (service === 'dataforseo' && checked?.ok === false) message = en ? 'Could not check the balance. Try again.' : 'No se pudo consultar el saldo. Inténtalo de nuevo.'
      else if (service === 'dataforseo' && checked?.balance != null) {
        message = (en ? 'Balance: ' : 'Saldo: ') + new Intl.NumberFormat(en ? 'en-US' : 'es-MX', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(Number(checked.balance)) + ' USD. ' +
          (available ? (en ? 'You can retry Maps; an endpoint spending limit may still apply.' : 'Puedes reintentar Maps; aún podría aplicar un límite de gasto del endpoint.') : (en ? 'Maps remains paused.' : 'Maps sigue en pausa.'))
      } else if (service === 'dataforseo' && !available) message = details[reason] || details.unavailable
      onCheckResult?.({ service, message: `${label}: ${message}`, severity: checked?.ok === false ? 'error' : available ? 'success' : 'warning' })
      onRefresh?.()
      window.dispatchEvent(new Event('service-health-refresh'))
    } catch (err) {
      const message = err.message || (en ? 'Check failed.' : 'No se pudo verificar.')
      setError(onCheckResult ? '' : message)
      onCheckResult?.({ service, message, severity: 'error' })
    }
    finally { checkLock.current = false; setBusy(false) }
  }
  if (user?.role !== 'admin' || !notification) return null
  const blocked = [[notification.service, notification]]
  const reasons = {
    billing: en ? 'No credit or spending limit reached.' : 'Sin saldo o límite de gasto alcanzado.',
    auth: en ? 'Credentials rejected.' : 'Credenciales rechazadas.',
    rate_limit: en ? 'Temporary request limit.' : 'Límite temporal de solicitudes.',
    unavailable: en ? 'Temporarily unavailable.' : 'Temporalmente no disponible.',
  }
  return <Box sx={{ flexShrink: 0 }} data-testid="service-health-notice">
    {blocked.map(([name, value]) => <Alert key={name} severity="warning" sx={{ mb: .5, borderRadius: 2, bgcolor: 'var(--card-bg)', color: 'var(--text)', border: '1px solid var(--border)', '& .MuiAlert-message': { minWidth: 0, width: '100%' } }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', fontSize: '.8rem' }}>
        <Box sx={{ flex: '1 1 230px' }}>
          <strong>{value.label}: {reasons[value.reason] || reasons.unavailable}</strong>{' '}
          {name === 'ai'
            ? (en ? 'AI analysis and chat replies are paused. You can reply manually.' : 'Los análisis con IA y el Chat IA están en pausa. Puedes responder manualmente.')
            : (en ? 'Maps is paused. Free sources remain available; searches may be partial.' : 'Maps está en pausa. Siguen disponibles las fuentes gratuitas; la búsqueda puede ser parcial.')}
        </Box>
        {user?.role === 'admin' && <Button size="small" disabled={busy} onClick={() => check(name)} sx={{ color: 'var(--accent)', textTransform: 'none' }}>
          {busy ? (en ? 'Checking…' : 'Verificando…') : name === 'ai' ? (en ? 'Test AI (uses tokens)' : 'Probar IA (usa tokens)') : (en ? 'Check balance' : 'Verificar saldo')}
        </Button>}
      </Box>
    </Alert>)}
    {error && <Alert severity="error">{error}</Alert>}
  </Box>
}
