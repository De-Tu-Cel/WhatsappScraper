'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Slider from '@mui/material/Slider'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import SearchIcon from '@mui/icons-material/Search'

export default function SearchProspects() {
  const [form, setForm] = useState({ industry: '', city: '', keywords: '' })
  const [numResults, setNumResults] = useState(10)
  const [searchOnly, setSearchOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [progress, setProgress] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [error, setError] = useState('')

  function handleChange(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSearch() {
    if (!form.industry || !form.city) {
      setError('Debes ingresar industria y ciudad'); return
    }
    setError(''); setRows([]); setProgress(0)
    setLoading(true); setStatusMsg('Buscando URLs…')

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, num_results: numResults }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const { urls } = await res.json()

      if (searchOnly) {
        setRows(urls.map((url, i) => ({ id: i, url })))
        setStatusMsg(`${urls.length} URLs encontradas`)
        return
      }

      // Procesar una a una
      const results = []
      for (let i = 0; i < urls.length; i++) {
        setStatusMsg(`Procesando ${i + 1}/${urls.length}: ${urls[i]}`)
        setProgress(Math.round(((i) / urls.length) * 100))
        try {
          const r = await fetch('/api/process-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: urls[i] }),
          })
          const d = await r.json()
          results.push({
            id: i,
            url: urls[i],
            empresa: d.scraped?.name || '',
            industria: d.scraped?.industry || '',
            whatsapp: d.primary_whatsapp_number || '',
            enviado_a: d.to_number || '',
            status_wa: d.send_result?.status_code || 'sin número',
            status: '✅ ok',
          })
        } catch {
          results.push({ id: i, url: urls[i], status: '❌ error' })
        }
        setRows([...results])
      }
      setProgress(100)
      setStatusMsg(`${results.length} URLs procesadas`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const ok = rows.filter(r => r.status === '✅ ok').length
  const withWa = rows.filter(r => r.whatsapp).length
  const sent = rows.filter(r => String(r.status_wa) === '200').length
  const errs = rows.filter(r => r.status?.includes('error')).length

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={4}>
          <TextField fullWidth label="🏭 Industria" placeholder="Ej: Restaurantes"
            value={form.industry} onChange={handleChange('industry')} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField fullWidth label="🏙️ Ciudad / Región" placeholder="Ej: Querétaro"
            value={form.city} onChange={handleChange('city')} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField fullWidth label="🔍 Palabras clave (opcional)" placeholder="Ej: WhatsApp pedidos"
            value={form.keywords} onChange={handleChange('keywords')} />
        </Grid>
        <Grid item xs={12} md={8}>
          <Typography gutterBottom>Número de resultados: {numResults}</Typography>
          <Slider value={numResults} onChange={(_, v) => setNumResults(v)}
            min={5} max={50} step={5} marks valueLabelDisplay="auto" />
        </Grid>
        <Grid item xs={12} md={4} sx={{ display: 'flex', alignItems: 'center' }}>
          <FormControlLabel
            control={<Switch checked={searchOnly} onChange={e => setSearchOnly(e.target.checked)} />}
            label="Solo buscar (sin procesar)"
          />
        </Grid>
      </Grid>

      <Button variant="contained" size="large" onClick={handleSearch} disabled={loading}
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}>
        {loading ? 'Procesando...' : 'Buscar Prospectos'}
      </Button>

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

      {loading && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>{statusMsg}</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {rows.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {[['✅ Procesados', ok], ['📱 Con WhatsApp', withWa], ['📤 Enviados', sent], ['❌ Errores', errs]]
              .map(([label, val]) => (
                <Grid item xs={6} md={3} key={label}>
                  <Card><CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight={700}>{val}</Typography>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                  </CardContent></Card>
                </Grid>
              ))}
          </Grid>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['URL', 'Empresa', 'Industria', 'WhatsApp', 'Status WA', 'Estado'].map(h => (
                    <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</TableCell>
                    <TableCell>{r.empresa}</TableCell>
                    <TableCell>{r.industria}</TableCell>
                    <TableCell>{r.whatsapp}</TableCell>
                    <TableCell>{r.status_wa}</TableCell>
                    <TableCell>{r.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}
    </Box>
  )
}