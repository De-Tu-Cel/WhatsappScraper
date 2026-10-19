'use client'
import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import SearchIcon from '@mui/icons-material/Search'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { authFetch } from '@/lib/api'

export default function BlacklistRuleTester({ type, revision, lang }) {
  const en = lang === 'en'
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const controller = useRef(null)
  useEffect(() => {
    controller.current?.abort(); setValue(''); setResult(null); setError(''); setLoading(false)
    return () => controller.current?.abort()
  }, [type, revision])
  function changeValue(next) {
    controller.current?.abort(); setValue(next); setResult(null); setError(''); setLoading(false)
  }
  async function check(event) {
    event.preventDefault()
    if (!value.trim() || loading) return
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    setLoading(true); setResult(null); setError('')
    try {
      const query = new URLSearchParams({ type, value: value.trim() })
      const response = await authFetch(`/api/blacklist/check?${query}`, { signal: current.signal })
      const data = await response.json()
      if (current.signal.aborted) return
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : (en ? 'Could not check the rules. Try again.' : 'No se pudieron comprobar las reglas. Inténtalo de nuevo.'))
      if (typeof data.blocked !== 'boolean' || !Array.isArray(data.matches)) throw new Error(en ? 'Invalid response' : 'Respuesta inválida')
      setResult(data)
    } catch (exc) {
      if (!current.signal.aborted) setError(exc.message)
    } finally { if (controller.current === current) setLoading(false) }
  }
  const label = type === 'domain' ? (en ? 'Domain or URL to check' : 'Dominio o URL a comprobar') : type === 'industry' ? (en ? 'Industry or business name' : 'Industria o nombre del negocio') : (en ? 'Phone number to check' : 'Teléfono a comprobar')
  return <Box data-blacklist-tester sx={{ border: '1px solid var(--border)', borderRadius: '14px', bgcolor: 'var(--card-bg)' }}>
    <Button fullWidth disableRipple onClick={() => setOpen(!open)} aria-expanded={open} startIcon={<SearchIcon />} endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none' }} />} sx={{ justifyContent: 'flex-start', color: 'var(--accent)', textTransform: 'none', fontWeight: 700, px: 2, py: 1.4, '& .MuiButton-endIcon': { ml: 'auto' } }}>{en ? 'Test a rule' : 'Probar regla'}</Button>
    {open && <Box sx={{ px: 2, pb: 2 }}>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: '.8rem', mb: 2 }}>{en ? 'Checks saved rules and the system domain list. No searches, messages or changes are made.' : 'Comprueba las reglas guardadas y los dominios del sistema. No hace búsquedas, envíos ni cambios.'}</Typography>
      <Box component="form" onSubmit={check} sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" label={label} value={value} onChange={event => changeValue(event.target.value)} sx={{ flex: '1 1 250px' }} />
        <Button type="submit" variant="contained" disabled={!value.trim() || loading} startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />} sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700 }}>{en ? 'Check' : 'Comprobar'}</Button>
      </Box>
      {error && <Typography role="alert" sx={{ mt: 1.5, color: 'error.main', fontSize: '.82rem' }}>{error}</Typography>}
      {result && <Box role="status" sx={{ mt: 1.5, p: 1.5, border: '1px solid var(--border)', borderRadius: '10px', bgcolor: 'var(--surface)' }}>
        <Typography sx={{ fontWeight: 700, fontSize: '.9rem', color: result.blocked ? 'error.main' : 'var(--text)' }}>{result.blocked ? (en ? 'Matching block rule found' : 'Coincide con una regla de bloqueo') : (en ? 'No match in these lists' : 'Sin coincidencias en estas listas')}</Typography>
        {result.matches.map((rule, i) => <Typography key={i} sx={{ mt: .5, fontSize: '.82rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{rule.value} · {rule.source === 'system' ? (en ? 'System · search filter' : 'Sistema · filtro del buscador') : (en ? 'Saved rule' : 'Regla guardada')}</Typography>)}
        {!result.blocked && <Typography sx={{ mt: .5, fontSize: '.8rem', color: 'var(--text-muted)' }}>{en ? 'Other search filters and sending restrictions can still apply.' : 'Aún pueden aplicar otros filtros de búsqueda y restricciones de envío.'}</Typography>}
      </Box>}
    </Box>}
  </Box>
}
