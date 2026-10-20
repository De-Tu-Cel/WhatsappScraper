'use client'
/**
 * Evaluación del canal WhatsApp: arma el one-pager para el prospecto desde la conversación
 * real y el análisis, deja corregir cada texto antes de mandarlo y da la liga pública.
 * Backend: apps/api/app/api/evaluaciones.py. Vista previa en un iframe aislado (sandbox).
 */
import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import CloseIcon from '@mui/icons-material/Close'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import DownloadIcon from '@mui/icons-material/Download'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import SaveIcon from '@mui/icons-material/Save'
import { authFetch } from '../lib/api'

const ultimos10 = (n) => String(n || '').replace(/\D/g, '').slice(-10)

async function leer(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data?.detail
    const err = new Error(typeof d === 'string' ? d : d?.message || `Error ${res.status}`)
    err.detail = d
    throw err
  }
  return data
}

function formularioDesde(ev) {
  const e = ev.editable
  const ventajaDe = (k) => Object.keys(e.resuelve || {}).find((v) => e.resuelve[v] === String(k + 1)) || ''
  return {
    logo: e.logo || null, logoCambio: null, logoUrl: '',
    nombre: e.nombre, nombreBot: e.nombreBot, telefono: e.telefono, nivel: e.nivel,
    sintesis_titular: e.sintesis_titular, sintesis_texto: e.sintesis_texto,
    fortalezas: e.fortalezas.map((f) => ({ titulo: f.titulo, texto: f.texto })),
    oportunidades: e.oportunidades.map((o, k) => ({ titulo: o.titulo, dato: o.dato, vimos: o.vimos, oportunidad: o.oportunidad, ventaja: ventajaDe(k) })),
  }
}

function Seccion({ titulo, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted, rgba(255,255,255,0.5))' }}>
        {titulo}
      </Typography>
      {children}
    </Box>
  )
}

export default function EvaluacionDialog({ open, onClose, companyId, companyName, number }) {
  const [ev, setEv] = useState(null)
  const [form, setForm] = useState(null)
  // Se monta de nuevo cada vez que se abre (key en analytics.jsx): empieza cargando.
  const [estado, setEstado] = useState('cargando') // 'cargando' | 'generando' | 'guardando' | null
  const [error, setError] = useState('')
  const [industrias, setIndustrias] = useState(null)
  const [industria, setIndustria] = useState('')
  const [vista, setVista] = useState('')
  const [cambios, setCambios] = useState(false)
  const [aviso, setAviso] = useState('')

  const cargarVista = useCallback(async (id) => {
    const res = await authFetch(`/api/evaluaciones/${id}/html`)
    setVista(res.ok ? await res.text() : '')
  }, [])

  const mostrar = useCallback(async (data) => {
    setEv(data); setForm(formularioDesde(data)); setCambios(false); setIndustrias(null)
    await cargarVista(data.id)
  }, [cargarVista])

  // Al abrir: la evaluación más reciente de ese número, si ya hay una.
  useEffect(() => {
    if (!open || !companyId) return
    let vigente = true
    ;(async () => {
      try {
        const { items = [] } = await leer(await authFetch(`/api/evaluaciones?company_id=${encodeURIComponent(companyId)}`))
        const previa = items.find((e) => !number || ultimos10(e.numero) === ultimos10(number))
        if (previa && vigente) await mostrar(await leer(await authFetch(`/api/evaluaciones/${previa.id}`)))
      } catch (e) {
        if (vigente) setError(e.message)
      } finally {
        if (vigente) setEstado(null)
      }
    })()
    return () => { vigente = false }
  }, [open, companyId, number, mostrar])

  const generar = async () => {
    setEstado('generando'); setError('')
    try {
      const body = { company_id: companyId, ...(number ? { numero: number } : {}), ...(industria ? { industria } : {}) }
      await mostrar(await leer(await authFetch('/api/evaluaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })))
    } catch (e) {
      if (e.detail?.code === 'industria') { setIndustrias(e.detail.opciones); setError(e.detail.message) }
      else setError(e.message)
    } finally {
      setEstado(null)
    }
  }

  const guardar = async () => {
    setEstado('guardando'); setError('')
    try {
      const resuelve = {}
      form.oportunidades.forEach((o, k) => { if (o.ventaja) resuelve[o.ventaja] = String(k + 1) })
      const body = {
        nombre: form.nombre, nombreBot: form.nombreBot, telefono: form.telefono, nivel: Number(form.nivel),
        sintesis_titular: form.sintesis_titular, sintesis_texto: form.sintesis_texto,
        fortalezas: form.fortalezas, resuelve,
        oportunidades: form.oportunidades.map(({ ventaja, ...o }) => o),
        ...(form.logoCambio?.tipo === 'quitar' ? { quitar_logo: true } : {}),
        ...(form.logoCambio?.tipo === 'data' ? { logo_data: form.logoCambio.valor } : {}),
        ...(form.logoCambio?.tipo === 'url' ? { logo_url: form.logoCambio.valor } : {}),
      }
      await mostrar(await leer(await authFetch(`/api/evaluaciones/${ev.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })))
      setAviso('Cambios guardados')
    } catch (e) {
      setError(e.message)
    } finally {
      setEstado(null)
    }
  }

  const liga = ev ? `${typeof window !== 'undefined' ? window.location.origin : ''}/evaluacion/${ev.token}` : ''
  const copiar = async () => {
    try { await navigator.clipboard.writeText(liga); setAviso('Liga copiada: ya la puedes mandar por WhatsApp') }
    catch { setAviso(liga) }
  }
  const descargar = async () => {
    const res = await authFetch(`/api/evaluaciones/${ev.id}/html?descargar=1`)
    if (!res.ok) { setError('No se pudo descargar'); return }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url; a.download = `evaluacion-${(form?.nombre || 'empresa').replace(/\s+/g, '-')}.html`; a.click()
    URL.revokeObjectURL(url)
  }

  const set = (campo, valor) => { setForm((f) => ({ ...f, [campo]: valor })); setCambios(true) }
  const subirLogo = (archivo) => {
    if (!archivo) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) { setError('El logo debe ser PNG, JPG o WEBP.'); return }
    if (archivo.size > 1_000_000) { setError('El logo pesa más de 1 MB.'); return }
    const lector = new FileReader()
    lector.onload = () => setForm((f) => { setCambios(true); return { ...f, logo: lector.result, logoCambio: { tipo: 'data', valor: lector.result } } })
    lector.readAsDataURL(archivo)
  }
  const setItem = (lista, k, campo, valor) => {
    setForm((f) => ({ ...f, [lista]: f[lista].map((x, i) => (i === k ? { ...x, [campo]: valor } : x)) }))
    setCambios(true)
  }
  const ocupado = !!estado
  // Los mismos topes que el servidor: con ellos la hoja carta siempre cabe.
  const lim = ev?.limites || {}
  const ventajasUsadas = (k) => new Set(form.oportunidades.filter((o, i) => i !== k && o.ventaja).map((o) => o.ventaja))

  return (
    <Dialog open={open} onClose={ocupado ? undefined : onClose} fullWidth maxWidth="xl"
      sx={{ '& .MuiDialog-paper': { height: { lg: '92vh' }, borderRadius: 3 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6 }}>
        <AutoAwesomeIcon sx={{ color: 'var(--accent, #6366f1)' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '1rem' }}>Evaluación del canal WhatsApp</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted, rgba(255,255,255,0.5))' }} noWrap>
            {companyName}{number ? ` · ${number}` : ''}
          </Typography>
        </Box>
        {ev && (
          <Chip size="small" sx={{ ml: 1 }} color={ev.info?.origen === 'llm' ? 'primary' : 'default'}
            label={ev.info?.origen === 'llm' ? 'Borrador redactado con IA' : 'Borrador por reglas'} />
        )}
        <IconButton aria-label="Cerrar" onClick={onClose} disabled={ocupado} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', minHeight: 0 }}>
        {estado === 'cargando' && (
          <Box sx={{ m: 'auto', p: 6 }}><CircularProgress /></Box>
        )}

        {!ev && estado !== 'cargando' && (
          <Box sx={{ m: 'auto', p: 4, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'center', alignItems: 'center' }}>
            <Typography sx={{ fontSize: '0.95rem' }}>
              Arma la evaluación con la conversación real{number ? ' de este número' : ''} y su análisis.
              Una IA redacta el borrador: lo revisas y corriges antes de mandarlo.
            </Typography>
            {error && <Alert severity="warning" sx={{ textAlign: 'left', width: '100%' }}>{error}</Alert>}
            {industrias && (
              <TextField select size="small" label="Plantilla del giro" value={industria} onChange={(e) => setIndustria(e.target.value)} sx={{ minWidth: 240 }}>
                {industrias.map((i) => <MenuItem key={i} value={i}>{i}</MenuItem>)}
              </TextField>
            )}
            <Button variant="contained" onClick={generar} disabled={ocupado || (industrias && !industria)}
              startIcon={estado === 'generando' ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
              sx={{ textTransform: 'none', fontWeight: 700 }}>
              {estado === 'generando' ? 'Redactando la evaluación…' : 'Generar evaluación'}
            </Button>
          </Box>
        )}

        {ev && form && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '440px 1fr' }, width: '100%', minHeight: 0 }}>
            <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5, overflowY: 'auto', borderRight: { lg: '1px solid rgba(127,127,127,0.18)' } }}>
              {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
              {(ev.info?.avisos || []).length > 0 && (
                <Alert severity="info" sx={{ '& ul': { m: 0, pl: 2 } }}>
                  <ul>{ev.info.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                </Alert>
              )}

              <Seccion titulo="Empresa">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 120, height: 56, flexShrink: 0, borderRadius: 2, bgcolor: '#fff', border: '1px solid rgba(127,127,127,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {form.logo
                      // eslint-disable-next-line @next/next/no-img-element -- data URL del logo: next/image no aplica
                      ? <img src={form.logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <Typography sx={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'center', px: 1 }}>Sin logo: se muestra el nombre</Typography>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Button component="label" size="small" sx={{ textTransform: 'none', justifyContent: 'flex-start' }}>
                      Subir logo
                      <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { subirLogo(e.target.files?.[0]); e.target.value = '' }} />
                    </Button>
                    <Button size="small" disabled={!form.logo} onClick={() => setForm((f) => { setCambios(true); return { ...f, logo: null, logoCambio: { tipo: 'quitar' } } })}
                      sx={{ textTransform: 'none', justifyContent: 'flex-start' }}>
                      Quitar logo
                    </Button>
                  </Box>
                </Box>
                <TextField size="small" label="…o pega la URL de la imagen del logo" value={form.logoUrl}
                  onChange={(e) => setForm((f) => { setCambios(true); const v = e.target.value; return { ...f, logoUrl: v, logoCambio: v.trim() ? { tipo: 'url', valor: v.trim() } : null } })}
                  helperText="Se descarga al guardar. Revisa que sea el logo de esta empresa." />
                <TextField size="small" label="Nombre" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} slotProps={{ htmlInput: { maxLength: 80 } }} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                  <TextField size="small" label="Nombre en WhatsApp" value={form.nombreBot} onChange={(e) => set('nombreBot', e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
                  <TextField size="small" label="Teléfono" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} slotProps={{ htmlInput: { maxLength: 30 } }} />
                </Box>
              </Seccion>

              <Seccion titulo="Nivel de experiencia">
                <TextField select size="small" label="Nivel hoy" value={form.nivel} onChange={(e) => set('nivel', e.target.value)}
                  helperText={ev.info?.nivel_fuente === 'clasificacion' ? 'Sale de la clasificación Timing + IA de Análisis.' : 'Estimado por los tiempos de respuesta.'}>
                  {ev.escala.slice(0, 4).map((nombre, k) => <MenuItem key={nombre} value={k + 1}>{k + 1}. {nombre}</MenuItem>)}
                </TextField>
                <TextField size="small" label="Diagnóstico (en negritas)" value={form.sintesis_titular} onChange={(e) => set('sintesis_titular', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.sintesis_titular } }} />
                <TextField size="small" label="Qué falta para que sea experiencia" value={form.sintesis_texto} onChange={(e) => set('sintesis_texto', e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: lim.sintesis_texto } }} />
              </Seccion>

              <Seccion titulo="Lo que ya funciona">
                {form.fortalezas.map((f, k) => (
                  <Box key={k} sx={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 1 }}>
                    <TextField size="small" label={`Título ${k + 1}`} value={f.titulo} onChange={(e) => setItem('fortalezas', k, 'titulo', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.f_titulo } }} />
                    <TextField size="small" label="Detalle" value={f.texto} onChange={(e) => setItem('fortalezas', k, 'texto', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.f_texto } }} />
                  </Box>
                ))}
              </Seccion>

              <Seccion titulo="Áreas de oportunidad">
                {form.oportunidades.map((o, k) => (
                  <Box key={k} sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, borderRadius: 2, border: '1px solid rgba(127,127,127,0.2)' }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 1 }}>
                      <TextField size="small" label={`Oportunidad ${k + 1}`} value={o.titulo} onChange={(e) => setItem('oportunidades', k, 'titulo', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.o_titulo } }} />
                      <TextField size="small" label="Etiqueta" value={o.dato} onChange={(e) => setItem('oportunidades', k, 'dato', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.o_dato } }} />
                    </Box>
                    <TextField size="small" label="Lo que vimos" value={o.vimos} onChange={(e) => setItem('oportunidades', k, 'vimos', e.target.value)} multiline slotProps={{ htmlInput: { maxLength: lim.o_vimos } }} />
                    <TextField size="small" label="Oportunidad" value={o.oportunidad} onChange={(e) => setItem('oportunidades', k, 'oportunidad', e.target.value)} slotProps={{ htmlInput: { maxLength: lim.o_oportunidad } }} />
                    <TextField select size="small" label="La resuelve" value={o.ventaja} onChange={(e) => setItem('oportunidades', k, 'ventaja', e.target.value)}>
                      <MenuItem value=""><em>Ninguna</em></MenuItem>
                      {ev.ventajas.map((v) => (
                        <MenuItem key={v.id} value={v.id} disabled={ventajasUsadas(k).has(v.id)}>{v.titulo}</MenuItem>
                      ))}
                    </TextField>
                  </Box>
                ))}
              </Seccion>
            </Box>

            <Box sx={{ position: 'relative', minHeight: { xs: 640, lg: 0 }, bgcolor: '#e9eef5' }}>
              {estado === 'guardando' && (
                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.15)', zIndex: 1 }}>
                  <CircularProgress />
                </Box>
              )}
              {/* Aislada del resto de la app: sin allow-same-origin, sus scripts no ven la sesión. */}
              <iframe title="Vista previa de la evaluación" srcDoc={vista} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                style={{ border: 0, width: '100%', height: '100%', minHeight: 640, display: 'block' }} />
            </Box>
          </Box>
        )}
      </DialogContent>

      {ev && (
        <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Tooltip title="Vuelve a redactar desde la conversación (la evaluación actual se conserva)">
            <span>
              <Button onClick={() => { setEv(null); setForm(null); generar() }} disabled={ocupado} sx={{ textTransform: 'none' }}>
                Generar de nuevo
              </Button>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Button onClick={descargar} disabled={ocupado || cambios} startIcon={<DownloadIcon />} sx={{ textTransform: 'none' }}>Descargar HTML</Button>
          <Button onClick={() => window.open(liga, '_blank', 'noopener')} disabled={ocupado || cambios} startIcon={<OpenInNewIcon />} sx={{ textTransform: 'none' }}>Abrir</Button>
          <Button onClick={copiar} disabled={ocupado || cambios} startIcon={<LinkIcon />} sx={{ textTransform: 'none' }}>Copiar liga</Button>
          <Button variant="contained" onClick={guardar} disabled={ocupado || !cambios}
            startIcon={estado === 'guardando' ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            sx={{ textTransform: 'none', fontWeight: 700 }}>
            Guardar cambios
          </Button>
        </DialogActions>
      )}

      <Snackbar open={!!aviso} autoHideDuration={4000} onClose={() => setAviso('')} message={aviso}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Dialog>
  )
}
