'use client'
/**
 * Evaluación del canal WhatsApp: arma el one-pager para el prospecto desde la conversación
 * real y el análisis, deja corregir cada texto con vista previa en vivo y da la liga pública.
 * Backend: apps/api/app/api/evaluaciones.py. Colores: solo las variables del tema de la app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import Button from '@mui/material/Button'
import InputBase from '@mui/material/InputBase'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import ListSubheader from '@mui/material/ListSubheader'
import Collapse from '@mui/material/Collapse'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import CloseIcon from '@mui/icons-material/Close'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import DownloadIcon from '@mui/icons-material/Download'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import SaveIcon from '@mui/icons-material/Save'
import CheckIcon from '@mui/icons-material/Check'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import StorefrontIcon from '@mui/icons-material/StorefrontOutlined'
import SpeedIcon from '@mui/icons-material/Speed'
import ThumbUpIcon from '@mui/icons-material/ThumbUpAltOutlined'
import TrackChangesIcon from '@mui/icons-material/TrackChanges'
import DesktopIcon from '@mui/icons-material/DesktopWindowsOutlined'
import PhoneIcon from '@mui/icons-material/PhoneIphone'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { authFetch } from '../lib/api'

const NIVEL_COLOR = ['#EF4444', '#F97316', '#F59E0B', '#22C55E'] // los de la escala en la página
// La plantilla se ve como hoja carta (816 × 1056) desde 860 px de ancho; más su margen.
const ANCHO_HOJA = 880
const ALTO_HOJA = 1124
const MAX_OPORTUNIDADES = 3 // lo que cabe en la hoja carta (el servidor pide de 1 a 3)
const QUIEN = { cliente: 'Cliente', negocio: 'Negocio', nota: 'Nota' }
const GUIA_KEY = 'evaluacion_guia_oculta'
// Ámbar y rojo de texto: en los temas claros de la app (data-theme-mode) se oscurecen para leerse.
const ambar = { color: '#f59e0b', '[data-theme-mode="light"] &': { color: '#b45309' } }
const rojo = { color: '#ef4444', '[data-theme-mode="light"] &': { color: '#b91c1c' } }
const verde = { color: '#22c55e', '[data-theme-mode="light"] &': { color: '#15803d' } }
const ultimos10 = (n) => String(n || '').replace(/\D/g, '').slice(-10)
const vacio = (v) => v === '' || v == null

// Llave estable por tarjeta: al reordenar o quitar, React no mezcla los campos de una con otra.
let ultimoUid = 0
const nuevoUid = () => { ultimoUid += 1; return ultimoUid }

const AYUDA = {
  empresa: 'Nombre y logo que salen en el encabezado de la hoja. El logo también es la foto de perfil del negocio en el chat.',
  logoUrl: 'Pega la liga directa a la imagen (PNG, JPG o WEBP). Se descarga y revisa al guardar.',
  nombreBot: 'El nombre con el que aparece el negocio arriba del chat, como en su perfil de WhatsApp.',
  nivel: 'Dónde está hoy su WhatsApp en la escala de 5 niveles. El 5 (bot de pedidos 24/7) es a donde lo lleva De Tu Cel.',
  diagnostico: 'La frase en negritas bajo la escala: el resumen del canal en una línea.',
  falta: 'Sigue al diagnóstico: qué le hace falta para pasar de “contestar mensajes” a vender por el chat.',
  fortalezas: 'Lo que el negocio ya hace bien. Reconocerlo hace que la evaluación se sienta justa. Cada una se marca con ✓ verde en un mensaje del negocio.',
  usarDetectada: 'Llena la tarjeta con algo que el sistema comprobó en la conversación.',
  oportunidades: 'Lo que hoy le cuesta ventas, de la más grave a la menos. Cada una lleva un número naranja en el mensaje donde se ve. Puedes dejar de 1 a 3: es lo que cabe en la hoja.',
  usarHallazgo: 'Textos ya escritos a partir de hechos comprobados (horas, mensajes sin respuesta, teléfonos…). Llena título, etiqueta, lo que vimos, la oportunidad, la ventaja y el mensaje.',
  etiqueta: 'La pastilla naranja con el dato duro, por ejemplo “14 h de espera”. Debe poder comprobarse en el chat.',
  vimos: 'Lo que pasó en la conversación, con la hora. Es la prueba del hallazgo.',
  oportunidad: 'Cómo se resuelve, en una frase corta.',
  resuelve: 'La ventaja de De Tu Cel que soluciona este punto. En la sección de ventajas aparece ligada a este número.',
  seVeEnOp: 'El mensaje del chat donde se pone el número. Quien abre la hoja toca el hallazgo y se le resalta ese mensaje.',
  seVeEnFo: 'El mensaje del negocio donde se pone la ✓ verde.',
  vista: 'Es la página real que verá el cliente. Se actualiza sola mientras editas; la liga pública cambia hasta que guardas.',
}

const PASOS = [
  'Lee los avisos en amarillo: dicen qué conviene confirmar antes de enviar.',
  'Corrige lo que quieras. La hoja de la derecha cambia al instante; los (?) explican cada campo.',
  'Guarda y copia la liga para mandarla por WhatsApp.',
]

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
  const pin = (clave) => e.pines?.[clave] ?? ''
  const ventajaDe = (k) => Object.keys(e.resuelve || {}).find((v) => e.resuelve[v] === String(k + 1)) || ''
  return {
    logo: e.logo || null, logoCambio: null, logoUrl: '',
    nombre: e.nombre, nombreBot: e.nombreBot, telefono: e.telefono, nivel: e.nivel,
    sintesis_titular: e.sintesis_titular, sintesis_texto: e.sintesis_texto,
    fortalezas: e.fortalezas.map((f, k) => ({ uid: nuevoUid(), titulo: f.titulo, texto: f.texto, mensaje: pin(`v${k + 1}`) })),
    oportunidades: e.oportunidades.map((o, k) => ({
      uid: nuevoUid(), titulo: o.titulo, dato: o.dato, vimos: o.vimos, oportunidad: o.oportunidad,
      ventaja: ventajaDe(k), mensaje: pin(`${k + 1}`),
    })),
  }
}

/** Lo que se manda al backend, al guardar o para la vista previa. Números de marca y ventajas
 * salen del orden de las tarjetas: al quitar o mover una, todo se renumera solo. */
function cuerpoDesde(form, { vistaPrevia = false } = {}) {
  const resuelve = {}
  const pines = {}
  form.oportunidades.forEach((o, k) => {
    if (o.ventaja) resuelve[o.ventaja] = String(k + 1)
    if (!vacio(o.mensaje)) pines[String(k + 1)] = Number(o.mensaje)
  })
  form.fortalezas.forEach((f, k) => { if (!vacio(f.mensaje)) pines[`v${k + 1}`] = Number(f.mensaje) })
  const c = form.logoCambio
  return {
    nombre: form.nombre, nombreBot: form.nombreBot, telefono: form.telefono, nivel: Number(form.nivel),
    sintesis_titular: form.sintesis_titular, sintesis_texto: form.sintesis_texto,
    fortalezas: form.fortalezas.map(({ titulo, texto }) => ({ titulo, texto })),
    oportunidades: form.oportunidades.map(({ titulo, dato, vimos, oportunidad }) => ({ titulo, dato, vimos, oportunidad })),
    resuelve, pines,
    ...(c?.tipo === 'quitar' ? { quitar_logo: true } : {}),
    ...(c?.tipo === 'data' ? { logo_data: c.valor } : {}),
    // La URL del logo se descarga solo al guardar, no en cada tecla de la vista previa.
    ...(c?.tipo === 'url' && !vistaPrevia ? { logo_url: c.valor } : {}),
  }
}

// ── piezas visuales: todas con las variables del tema ─────────────────────────
const campoSx = {
  width: '100%', fontSize: '0.84rem', lineHeight: 1.45, color: 'var(--text)', bgcolor: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: '10px', px: 1.25, py: 0.8,
  transition: 'border-color .15s, box-shadow .15s',
  '&:hover': { borderColor: 'rgba(var(--accent-rgb),0.45)' },
  '&.Mui-focused': { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px rgba(var(--accent-rgb),0.16)' },
  '& input, & textarea': { p: 0 },
  '& input::placeholder, & textarea::placeholder': { color: 'var(--text-muted)', opacity: 0.8 },
  '& .MuiSelect-select': { p: 0, pr: '24px !important', minHeight: 'unset', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '& .MuiSelect-icon': { color: 'var(--text-muted)', right: 6 },
}
const menuProps = {
  slotProps: { paper: { sx: {
    bgcolor: 'var(--card-bg)', backgroundImage: 'none', color: 'var(--text)', border: '1px solid var(--border)', maxHeight: 380, maxWidth: 460,
    '& .MuiMenuItem-root': { fontSize: '0.82rem', whiteSpace: 'normal', alignItems: 'flex-start', py: 0.9 },
    '& .MuiMenuItem-root:hover': { bgcolor: 'var(--item-hover)' },
    '& .MuiMenuItem-root.Mui-selected': { bgcolor: 'rgba(var(--accent-rgb),0.14)' },
    '& .MuiListSubheader-root': { bgcolor: 'var(--card-bg)', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, lineHeight: '30px' },
  } } },
}
const toggleSx = {
  '& .MuiToggleButton-root': { color: 'var(--text-muted)', borderColor: 'var(--border)', px: 1, py: 0.5,
    '&.Mui-selected, &.Mui-selected:hover': { color: 'var(--accent)', bgcolor: 'rgba(var(--accent-rgb),0.14)' } },
}
// Tooltip invertido (texto sobre fondo de texto): se lee igual en temas claros y oscuros.
const tooltipProps = {
  arrow: true,
  slotProps: {
    tooltip: { sx: { bgcolor: 'var(--text)', color: 'var(--bg)', fontSize: '0.74rem', lineHeight: 1.45, px: 1.25, py: 1,
      maxWidth: 290, borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' } },
    arrow: { sx: { color: 'var(--text)' } },
  },
}
const botonSx = { textTransform: 'none', fontWeight: 700, borderRadius: '10px' }
const principalSx = { ...botonSx, bgcolor: 'var(--accent)', color: 'var(--accent-contrast, #fff)', boxShadow: 'none',
  '&:hover': { bgcolor: 'var(--accent)', filter: 'brightness(1.08)', boxShadow: '0 4px 16px var(--accent-glow, transparent)' },
  '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb),0.25)', color: 'var(--text-muted)' } }
const iconoSx = { color: 'var(--text-muted)', p: 0.5, '&:hover': { color: 'var(--accent)', bgcolor: 'rgba(var(--accent-rgb),0.1)' },
  '&.Mui-disabled': { color: 'var(--text-muted)', opacity: 0.35 }, '& svg': { fontSize: 17 } }

/** (?) con la explicación: al pasar el cursor, al enfocarlo con el teclado o al tocarlo en celular. */
function Ayuda({ texto, de }) {
  return (
    <Tooltip title={texto} placement="top" enterTouchDelay={0} leaveTouchDelay={6000} {...tooltipProps}>
      <IconButton size="small" aria-label={`Qué es: ${de}`}
        sx={{ p: 0.25, color: 'var(--text-muted)', opacity: 0.75, '&:hover, &:focus-visible': { color: 'var(--accent)', opacity: 1 }, '& svg': { fontSize: 15 } }}>
        <HelpOutlineIcon />
      </IconButton>
    </Tooltip>
  )
}

/** Botón de ícono con su explicación (tooltip) que también sirve deshabilitado. */
function Accion({ titulo, onClick, disabled, children }) {
  return (
    <Tooltip title={titulo} {...tooltipProps}>
      <span><IconButton size="small" aria-label={titulo} onClick={onClick} disabled={disabled} sx={iconoSx}>{children}</IconButton></span>
    </Tooltip>
  )
}

function Etiqueta({ texto, ayuda, contador }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 20 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
        <Typography component="span" sx={{ fontSize: '0.71rem', fontWeight: 600, color: 'var(--text-muted)' }}>{texto}</Typography>
        {ayuda && <Ayuda texto={ayuda} de={texto} />}
      </Box>
      {contador}
    </Box>
  )
}

function Campo({ etiqueta, ayuda, valor, onChange, max, multiline = false, filas = 2, placeholder }) {
  const n = (valor || '').length
  const tono = max && n >= max ? rojo : max && n >= max * 0.85 ? ambar : { color: 'var(--text-muted)' }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      <Etiqueta texto={etiqueta} ayuda={ayuda} contador={max ? (
        <Tooltip title="Caracteres usados / máximo que cabe en la hoja" {...tooltipProps}>
          <Typography component="span" sx={{ fontSize: '0.66rem', fontVariantNumeric: 'tabular-nums', ...tono }}>{n}/{max}</Typography>
        </Tooltip>
      ) : null} />
      <InputBase value={valor ?? ''} onChange={(e) => onChange(e.target.value)} multiline={multiline} minRows={multiline ? filas : undefined}
        placeholder={placeholder} sx={campoSx} inputProps={{ maxLength: max, 'aria-label': etiqueta }} />
    </Box>
  )
}

function Elegir({ etiqueta, ayuda, valor, onChange, children, renderValue, nota }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      <Etiqueta texto={etiqueta} ayuda={ayuda} />
      <Select variant="standard" value={valor ?? ''} onChange={(e) => onChange(e.target.value)} displayEmpty input={<InputBase sx={campoSx} />}
        MenuProps={menuProps} SelectDisplayProps={{ 'aria-label': etiqueta }} renderValue={renderValue}>
        {children}
      </Select>
      {nota && <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{nota}</Typography>}
    </Box>
  )
}

const tenue = (texto) => <span style={{ color: 'var(--text-muted)' }}>{texto}</span>

function Seccion({ icono, titulo, descripcion, ayuda, extra, children }) {
  return (
    <Box component="section" aria-label={titulo} sx={{ p: 2, borderRadius: '14px', border: '1px solid var(--border)', bgcolor: 'var(--surface)',
      display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ width: 30, height: 30, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent)', '& svg': { fontSize: 18 } }}>{icono}</Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Typography component="h3" sx={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{titulo}</Typography>
            {ayuda && <Ayuda texto={ayuda} de={titulo} />}
          </Box>
          {descripcion && <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{descripcion}</Typography>}
        </Box>
        {extra}
      </Box>
      {children}
    </Box>
  )
}

function Insignia({ color, children }) {
  return (
    <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
      bgcolor: color, color: '#fff', fontSize: '0.75rem', fontWeight: 800, '& svg': { fontSize: 15 } }}>{children}</Box>
  )
}

function Tarjeta({ insignia, titulo, extra, children }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: '12px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
        {insignia}
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0 }} noWrap>{titulo}</Typography>
        {extra}
      </Box>
      {children}
    </Box>
  )
}

function Pastilla({ children, sx }) {
  return (
    <Box sx={{ px: 1.1, py: 0.3, borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
      bgcolor: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent)', ...sx }}>{children}</Box>
  )
}

// ── el editor ──────────────────────────────────────────────────────────────────
export default function EvaluacionDialog({ open, onClose, companyId, companyName, number }) {
  const [ev, setEv] = useState(null)
  const [form, setForm] = useState(null)
  // Se monta de nuevo cada vez que se abre (key en analytics.jsx): empieza cargando.
  const [estado, setEstado] = useState('cargando') // 'cargando' | 'generando' | 'guardando' | null
  const [error, setError] = useState('')
  const [industrias, setIndustrias] = useState(null)
  const [industria, setIndustria] = useState('')
  const [vista, setVista] = useState('')
  const [actualizando, setActualizando] = useState(false)
  const [errorVista, setErrorVista] = useState('')
  const [cambios, setCambios] = useState(false)
  const [aviso, setAviso] = useState('')
  const [deshacer, setDeshacer] = useState(null) // {item, k}: la oportunidad que se acaba de quitar
  const [verAvisos, setVerAvisos] = useState(true)
  const [guiaOculta, setGuiaOculta] = useState(() => {
    try { return localStorage.getItem(GUIA_KEY) === '1' } catch { return false }
  })
  const [modoVista, setModoVista] = useState('escritorio')
  const [tema, setTema] = useState('light')
  const [escala, setEscala] = useState(0.5)
  const [marco, setMarco] = useState(null) // callback ref: el panel aparece hasta que hay evaluación
  const enviado = useRef('')

  const cargarVista = useCallback(async (id) => {
    const res = await authFetch(`/api/evaluaciones/${id}/html`)
    setVista(res.ok ? await res.text() : '')
  }, [])

  const mostrar = useCallback(async (data) => {
    setEv(data); setForm(formularioDesde(data)); setCambios(false); setIndustrias(null); setErrorVista(''); setDeshacer(null)
    enviado.current = ''
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

  // Vista previa en vivo: cada cambio se ve en la hoja sin guardar (con una pausa al teclear).
  const cuerpoVista = useMemo(() => (form ? JSON.stringify(cuerpoDesde(form, { vistaPrevia: true })) : ''), [form])
  useEffect(() => {
    if (!ev || !cambios || !cuerpoVista || cuerpoVista === enviado.current) return
    let vigente = true
    const t = setTimeout(async () => {
      setActualizando(true)
      try {
        const res = await authFetch(`/api/evaluaciones/${ev.id}/vista-previa`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpoVista,
        })
        if (!vigente) return
        if (res.ok) { setVista(await res.text()); setErrorVista(''); enviado.current = cuerpoVista }
        else {
          const d = (await res.json().catch(() => ({})))?.detail
          setErrorVista(typeof d === 'string' ? d : 'Hay un dato que no se puede mostrar: revisa los campos')
        }
      } catch {
        if (vigente) setErrorVista('No se pudo actualizar la vista previa')
      } finally {
        if (vigente) setActualizando(false)
      }
    }, 450)
    return () => { vigente = false; clearTimeout(t) }
  }, [cuerpoVista, ev, cambios])

  // La hoja de escritorio se escala para caber completa a lo ancho del panel.
  useEffect(() => {
    if (!marco) return
    const obs = new ResizeObserver(([e]) => setEscala(Math.max(0.3, Math.min(1, (e.contentRect.width - 8) / ANCHO_HOJA))))
    obs.observe(marco)
    return () => obs.disconnect()
  }, [marco])

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
    if (!ev || !form) return
    setEstado('guardando'); setError('')
    try {
      await mostrar(await leer(await authFetch(`/api/evaluaciones/${ev.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpoDesde(form)),
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
  const cerrar = () => {
    if (cambios && !window.confirm('Tienes cambios sin guardar. ¿Cerrar de todos modos?')) return
    onClose()
  }
  const regenerar = () => {
    if (!window.confirm('Se redactará una evaluación nueva desde la conversación; la actual se conserva. ¿Continuar?')) return
    setEv(null); setForm(null); setVista(''); generar()
  }
  const mostrarGuia = (ver) => {
    setGuiaOculta(!ver)
    try { localStorage.setItem(GUIA_KEY, ver ? '0' : '1') } catch { /* sin almacenamiento: solo por esta vez */ }
  }

  const set = (campo, valor) => { setForm((f) => ({ ...f, [campo]: valor })); setCambios(true) }
  const setItem = (lista, k, cambiosItem) => {
    setForm((f) => ({ ...f, [lista]: f[lista].map((x, i) => (i === k ? { ...x, ...cambiosItem } : x)) }))
    setCambios(true)
  }
  const subirLogo = (archivo) => {
    if (!archivo) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) { setError('El logo debe ser PNG, JPG o WEBP.'); return }
    if (archivo.size > 1_000_000) { setError('El logo pesa más de 1 MB.'); return }
    const lector = new FileReader()
    lector.onload = () => { setForm((f) => ({ ...f, logo: lector.result, logoUrl: '', logoCambio: { tipo: 'data', valor: lector.result } })); setCambios(true) }
    lector.readAsDataURL(archivo)
  }

  const ocupado = !!estado
  // Los mismos topes que el servidor: con ellos la hoja carta siempre cabe.
  const lim = ev?.limites || {}
  const hechos = ev?.info?.hechos || { oportunidades: [], fortalezas: [] }
  const mensajes = useMemo(() => (ev?.conversacion || []).filter((m) => m.tipo in QUIEN), [ev])
  // Cada mensaje lleva una sola marca: los que ya usa otro hallazgo salen como ocupados.
  const marcas = useMemo(() => {
    const m = new Map()
    form?.fortalezas.forEach((f, k) => { if (!vacio(f.mensaje)) m.set(Number(f.mensaje), `✓${k + 1}`) })
    form?.oportunidades.forEach((o, k) => { if (!vacio(o.mensaje)) m.set(Number(o.mensaje), String(k + 1)) })
    return m
  }, [form])
  const libre = (i, propia) => i == null || !marcas.has(i) || marcas.get(i) === propia
  const negocioLibres = mensajes.filter((m) => m.tipo === 'negocio' && !marcas.has(m.i)).length
  const ventajasUsadas = (k) => new Set(form.oportunidades.filter((o, i) => i !== k && o.ventaja).map((o) => o.ventaja))
  // El tema de la hoja se fuerza en la vista previa; el cliente ve el de su teléfono.
  const vistaHtml = useMemo(() => vista.replace(/<html\b/i, `<html data-theme="${tema}"`), [vista, tema])

  const opcionesMensaje = (propia, tipos) => [
    <MenuItem key="ninguno" value=""><em>Sin marca en la conversación</em></MenuItem>,
    ...mensajes.filter((m) => tipos.includes(m.tipo)).map((m) => {
      const otra = marcas.get(m.i)
      const usado = otra && otra !== propia
      return (
        <MenuItem key={m.i} value={m.i} disabled={!!usado}>
          <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {[m.hora, QUIEN[m.tipo], usado ? `ya tiene la marca ${otra}` : ''].filter(Boolean).join(' · ')}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem' }}>{m.resumen || '(sin texto)'}</Typography>
          </Box>
        </MenuItem>
      )
    }),
  ]
  const mensajeElegido = (v) => {
    if (vacio(v)) return tenue('Sin marca en la conversación')
    const m = mensajes.find((x) => x.i === Number(v))
    return m ? `${m.hora ? `${m.hora} · ` : ''}${m.resumen}` : `Mensaje ${v}`
  }

  const usarFortaleza = (k, id) => {
    const h = hechos.fortalezas.find((x) => x.id === id)
    if (h) setItem('fortalezas', k, { titulo: h.titulo, texto: h.texto, mensaje: libre(h.mensaje, `✓${k + 1}`) ? (h.mensaje ?? '') : '' })
  }
  const desdeHecho = (h, k) => ({
    titulo: h.titulo, dato: h.dato, vimos: h.vimos, oportunidad: h.oportunidad,
    ventaja: ventajasUsadas(k).has(h.ventaja) ? '' : (h.ventaja || ''),
    mensaje: libre(h.mensaje, String(k + 1)) ? (h.mensaje ?? '') : '',
  })
  const usarOportunidad = (k, id) => {
    const h = hechos.oportunidades.find((x) => x.id === id)
    if (h) setItem('oportunidades', k, desdeHecho(h, k))
  }
  // Agregar: parte del siguiente hallazgo detectado que aún no está; si no queda, en blanco.
  const agregarOportunidad = () => {
    const k = form.oportunidades.length
    if (k >= MAX_OPORTUNIDADES) return
    const presentes = new Set(form.oportunidades.map((o) => o.dato))
    const h = hechos.oportunidades.find((x) => !presentes.has(x.dato))
    const nueva = h ? desdeHecho(h, k) : { titulo: 'Nueva oportunidad', dato: '', vimos: '', oportunidad: '', ventaja: '', mensaje: '' }
    setForm((f) => ({ ...f, oportunidades: [...f.oportunidades, { ...nueva, uid: nuevoUid() }] }))
    setCambios(true)
  }
  const quitarOportunidad = (k) => {
    setDeshacer({ item: form.oportunidades[k], k })
    setForm((f) => ({ ...f, oportunidades: f.oportunidades.filter((_, i) => i !== k) }))
    setCambios(true)
  }
  const moverOportunidad = (k, d) => {
    setForm((f) => {
      const l = [...f.oportunidades]
      ;[l[k], l[k + d]] = [l[k + d], l[k]]
      return { ...f, oportunidades: l }
    })
    setCambios(true)
  }
  const restaurar = () => {
    if (!deshacer) return
    const { item, k } = deshacer
    setForm((f) => {
      if (f.oportunidades.length >= MAX_OPORTUNIDADES) return f
      // Si mientras tanto otro hallazgo tomó su mensaje o su ventaja, vuelve sin ellos.
      const mensajesUsados = new Set([...f.fortalezas, ...f.oportunidades].filter((x) => !vacio(x.mensaje)).map((x) => Number(x.mensaje)))
      const ventajasEnUso = new Set(f.oportunidades.map((o) => o.ventaja).filter(Boolean))
      const vuelve = { ...item, mensaje: mensajesUsados.has(Number(item.mensaje)) ? '' : item.mensaje,
        ventaja: ventajasEnUso.has(item.ventaja) ? '' : item.ventaja }
      const l = [...f.oportunidades]
      l.splice(Math.min(k, l.length), 0, vuelve)
      return { ...f, oportunidades: l }
    })
    setDeshacer(null); setCambios(true)
  }

  const atajo = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (cambios && !ocupado) guardar() }
  }

  const nOp = form?.oportunidades.length || 0

  return (
    <Dialog open={open} onClose={ocupado ? undefined : cerrar} fullWidth maxWidth={false} onKeyDown={atajo}
      sx={{
        '& .MuiDialog-paper': { width: 'min(1560px, 96vw)', height: { lg: '94vh' }, maxHeight: '96vh', m: 1, borderRadius: '18px', overflow: 'hidden',
          bgcolor: 'var(--card-bg)', backgroundImage: 'none', color: 'var(--text)', border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column' },
        '& .MuiBackdrop-root': { backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' },
      }}>
      {/* Encabezado: quién es y las acciones principales */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <Box sx={{ width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent)' }}><AutoAwesomeIcon /></Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>Evaluación del canal WhatsApp</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)' }} noWrap>
            {companyName}{ev?.editable?.telefono ? ` · ${ev.editable.telefono}` : number ? ` · ${number}` : ''}
          </Typography>
        </Box>
        {ev && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Tooltip {...tooltipProps} title={ev.info?.origen === 'llm'
              ? 'La IA redactó los textos a partir de hechos comprobados en la conversación. Etiquetas, horas y marcas salen de esos hechos, no de la IA.'
              : 'Textos de los hallazgos detectados en la conversación (sin IA).'}>
              <Box tabIndex={0} sx={{ outline: 'none', '&:focus-visible': { boxShadow: '0 0 0 2px var(--accent)', borderRadius: '999px' } }}>
                <Pastilla>{ev.info?.origen === 'llm' ? 'Redactado con IA' : 'Texto de los hallazgos'}</Pastilla>
              </Box>
            </Tooltip>
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.74rem', mr: 0.5, ...(cambios ? ambar : { color: 'var(--text-muted)' }) }}>
              {cambios
                ? <><Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#f59e0b' }} />Sin guardar</>
                : <><CheckIcon sx={{ fontSize: 15, ...verde }} />Guardado</>}
            </Box>
            {guiaOculta && <Accion titulo="Ver la guía de uso" onClick={() => mostrarGuia(true)}><HelpOutlineIcon /></Accion>}
            <Accion titulo={cambios ? 'Guarda primero para descargar' : 'Descargar la página (HTML)'} onClick={descargar} disabled={ocupado || cambios}><DownloadIcon /></Accion>
            <Accion titulo={cambios ? 'Guarda primero: la liga muestra lo guardado' : 'Abrir la liga como la verá el cliente'}
              onClick={() => window.open(liga, '_blank', 'noopener')} disabled={ocupado || cambios}><OpenInNewIcon /></Accion>
            <Tooltip {...tooltipProps} title={cambios ? 'Guarda primero: la liga muestra lo guardado' : 'Liga pública para mandar por WhatsApp. No pide sesión.'}>
              <span><Button size="small" onClick={copiar} disabled={ocupado || cambios} startIcon={<LinkIcon />}
                sx={{ ...botonSx, color: 'var(--accent)', '&.Mui-disabled': { color: 'var(--text-muted)' } }}>Copiar liga</Button></span>
            </Tooltip>
            <Tooltip {...tooltipProps} title="Guardar (Ctrl+S)">
              <span><Button size="small" variant="contained" onClick={guardar} disabled={ocupado || !cambios}
                startIcon={estado === 'guardando' ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />} sx={principalSx}>
                Guardar
              </Button></span>
            </Tooltip>
          </Box>
        )}
        <IconButton aria-label="Cerrar" onClick={cerrar} disabled={ocupado} sx={{ color: 'var(--text-muted)' }}><CloseIcon /></IconButton>
      </Box>

      {/* Cuerpo */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {estado === 'cargando' && <Box sx={{ m: 'auto', p: 6 }}><CircularProgress sx={{ color: 'var(--accent)' }} /></Box>}

        {!ev && estado !== 'cargando' && (
          <Box sx={{ m: 'auto', p: 4, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ width: 64, height: 64, borderRadius: '18px', display: 'grid', placeItems: 'center',
              bgcolor: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent)', '& svg': { fontSize: 34 } }}><AutoAwesomeIcon /></Box>
            <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>Arma la evaluación de {companyName}</Typography>
            <Typography sx={{ fontSize: '0.86rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              Se detectan los hechos de la conversación real{number ? ' con este número' : ''}: esperas, mensajes sin respuesta,
              avisos automáticos… La IA solo los redacta. Tú revisas y corriges antes de mandarla.
            </Typography>
            {error && <Typography role="alert" sx={{ fontSize: '0.82rem', ...ambar }}>{error}</Typography>}
            {industrias && (
              <Box sx={{ width: 260, textAlign: 'left' }}>
                <Elegir etiqueta="Plantilla del giro" valor={industria} onChange={setIndustria} renderValue={(v) => (v ? v : tenue('Elige una'))}>
                  {industrias.map((i) => <MenuItem key={i} value={i}>{i}</MenuItem>)}
                </Elegir>
              </Box>
            )}
            <Button variant="contained" onClick={generar} disabled={ocupado || (industrias && !industria)}
              startIcon={estado === 'generando' ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
              sx={{ ...principalSx, borderRadius: '12px', px: 3, py: 1 }}>
              {estado === 'generando' ? 'Redactando la evaluación…' : 'Generar evaluación'}
            </Button>
          </Box>
        )}

        {ev && form && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '490px 1fr' }, width: '100%', minHeight: 0, overflow: { xs: 'auto', lg: 'hidden' } }}>
            {/* Editor */}
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.75, overflowY: { lg: 'auto' }, borderRight: { lg: '1px solid var(--border)' },
              '&::-webkit-scrollbar': { width: 8 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--scrollbar-thumb, var(--border))', borderRadius: 8 } }}>
              {error && (
                <Box role="alert" sx={{ p: 1.25, borderRadius: '10px', border: '1px solid rgba(239,68,68,0.35)', bgcolor: 'rgba(239,68,68,0.1)', color: 'var(--text)', fontSize: '0.8rem', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <WarningAmberIcon sx={{ fontSize: 18, ...rojo }} />
                  <Box sx={{ flex: 1 }}>{error}</Box>
                  <IconButton size="small" aria-label="Cerrar aviso" onClick={() => setError('')} sx={{ color: 'var(--text-muted)', p: 0.25 }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                </Box>
              )}

              {!guiaOculta && (
                <Box sx={{ position: 'relative', p: 1.5, pr: 4, borderRadius: '12px', border: '1px solid rgba(var(--accent-rgb),0.3)', bgcolor: 'rgba(var(--accent-rgb),0.07)' }}>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', mb: 1 }}>Cómo usar este editor</Typography>
                  <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {PASOS.map((p, i) => (
                      <Box component="li" key={p} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Box sx={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                          bgcolor: 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: '0.68rem', fontWeight: 800 }}>{i + 1}</Box>
                        <Typography sx={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.45, pt: '1px' }}>{p}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Box sx={{ position: 'absolute', top: 6, right: 6 }}>
                    <Accion titulo="Ocultar la guía (vuelve con el ? de arriba)" onClick={() => mostrarGuia(false)}><CloseIcon /></Accion>
                  </Box>
                </Box>
              )}

              {(ev.info?.avisos || []).length > 0 && (
                <Box sx={{ borderRadius: '12px', border: '1px solid rgba(245,158,11,0.35)', bgcolor: 'rgba(245,158,11,0.08)' }}>
                  <Box component="button" type="button" onClick={() => setVerAvisos((v) => !v)} aria-expanded={verAvisos}
                    sx={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1,
                      borderRadius: '12px', '&:focus-visible': { outline: '2px solid var(--accent)' } }}>
                    <WarningAmberIcon sx={{ fontSize: 18, ...ambar }} />
                    <Typography sx={{ flex: 1, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)' }}>
                      Revisa antes de enviar ({ev.info.avisos.length})
                    </Typography>
                    <ExpandMoreIcon sx={{ fontSize: 18, color: 'var(--text-muted)', transform: verAvisos ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                  </Box>
                  <Collapse in={verAvisos}>
                    <Box component="ul" sx={{ m: 0, pl: 4.5, pr: 1.5, pb: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {ev.info.avisos.map((a) => (
                        <Typography component="li" key={a} sx={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{a}</Typography>
                      ))}
                    </Box>
                  </Collapse>
                </Box>
              )}

              <Seccion icono={<StorefrontIcon />} titulo="Empresa" descripcion="Cómo aparece en el encabezado y en el chat." ayuda={AYUDA.empresa}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 128, height: 60, flexShrink: 0, borderRadius: '10px', bgcolor: '#fff', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', p: 0.75 }}>
                    {form.logo
                      // eslint-disable-next-line @next/next/no-img-element -- data URL del logo: next/image no aplica
                      ? <img src={form.logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                      : <Typography sx={{ fontSize: '0.68rem', color: '#64748b', textAlign: 'center', lineHeight: 1.3 }}>
                          {form.logoCambio?.tipo === 'url' ? 'Se descarga al guardar' : 'Sin logo: se muestra el nombre'}
                        </Typography>}
                  </Box>
                  <Tooltip {...tooltipProps} title="Así sale como foto de perfil arriba del chat. Sin logo, salen sus iniciales.">
                    <Box tabIndex={0} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4, flexShrink: 0, outline: 'none',
                      '&:focus-visible': { boxShadow: '0 0 0 2px var(--accent)', borderRadius: '8px' } }}>
                      <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#fff', border: '1px solid var(--border)', overflow: 'hidden',
                        display: 'grid', placeItems: 'center', color: '#075E54', fontWeight: 900, fontSize: '0.9rem' }}>
                        {form.logo
                          // eslint-disable-next-line @next/next/no-img-element -- data URL del logo: next/image no aplica
                          ? <img src={form.logo} alt="" style={{ width: '74%', height: '74%', objectFit: 'contain' }} />
                          : (form.nombre || '?').split(/\s+/).slice(0, 2).map((p) => p.charAt(0)).join('').toUpperCase()}
                      </Box>
                      <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>En el chat</Typography>
                    </Box>
                  </Tooltip>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, alignItems: 'flex-start', ml: 'auto' }}>
                    <Button component="label" size="small" sx={{ ...botonSx, color: 'var(--accent)', px: 1 }}>
                      Subir logo
                      <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { subirLogo(e.target.files?.[0]); e.target.value = '' }} />
                    </Button>
                    <Button size="small" disabled={!form.logo}
                      onClick={() => { setForm((f) => ({ ...f, logo: null, logoUrl: '', logoCambio: { tipo: 'quitar' } })); setCambios(true) }}
                      sx={{ ...botonSx, fontWeight: 600, color: 'var(--text-muted)', px: 1 }}>Quitar logo</Button>
                  </Box>
                </Box>
                <Campo etiqueta="…o la URL de la imagen del logo" ayuda={AYUDA.logoUrl} valor={form.logoUrl} placeholder="https://…/logo.png"
                  onChange={(v) => {
                    setForm((f) => ({ ...f, logoUrl: v, ...(v.trim() ? { logo: null, logoCambio: { tipo: 'url', valor: v.trim() } } : { logo: ev.editable.logo || null, logoCambio: null }) }))
                    setCambios(true)
                  }} />
                <Campo etiqueta="Nombre" valor={form.nombre} onChange={(v) => set('nombre', v)} max={80} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
                  <Campo etiqueta="Nombre en WhatsApp" ayuda={AYUDA.nombreBot} valor={form.nombreBot} onChange={(v) => set('nombreBot', v)} max={60} />
                  <Campo etiqueta="Teléfono" valor={form.telefono} onChange={(v) => set('telefono', v)} max={30} />
                </Box>
              </Seccion>

              <Seccion icono={<SpeedIcon />} titulo="Nivel de experiencia" ayuda={AYUDA.nivel}
                descripcion={ev.info?.nivel_fuente === 'clasificacion' ? 'Sale de la clasificación de Análisis.' : 'Estimado por los tiempos de respuesta: revísalo.'}>
                <Box role="radiogroup" aria-label="Nivel hoy" sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.75 }}>
                  {ev.escala.slice(0, 4).map((nombre, k) => {
                    const activo = Number(form.nivel) === k + 1
                    return (
                      <Box key={nombre} component="button" type="button" role="radio" aria-checked={activo} onClick={() => set('nivel', k + 1)}
                        sx={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', borderRadius: '10px', p: 1, textAlign: 'center',
                          border: `1px solid ${activo ? NIVEL_COLOR[k] : 'var(--border)'}`,
                          bgcolor: activo ? `${NIVEL_COLOR[k]}22` : 'var(--bg)', transition: 'border-color .15s, background-color .15s',
                          '&:hover': { borderColor: NIVEL_COLOR[k] }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 } }}>
                        <Box sx={{ mx: 'auto', mb: 0.5, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                          bgcolor: activo ? NIVEL_COLOR[k] : 'transparent', border: `2px solid ${NIVEL_COLOR[k]}`,
                          color: activo ? '#fff' : NIVEL_COLOR[k], fontSize: '0.72rem', fontWeight: 800 }}>{k + 1}</Box>
                        <Typography sx={{ fontSize: '0.66rem', lineHeight: 1.2, fontWeight: activo ? 700 : 500, color: activo ? 'var(--text)' : 'var(--text-muted)' }}>{nombre}</Typography>
                      </Box>
                    )
                  })}
                </Box>
                <Campo etiqueta="Diagnóstico (va en negritas)" ayuda={AYUDA.diagnostico} valor={form.sintesis_titular} onChange={(v) => set('sintesis_titular', v)} max={lim.sintesis_titular} />
                <Campo etiqueta="Qué le falta para vender por el chat" ayuda={AYUDA.falta} valor={form.sintesis_texto} onChange={(v) => set('sintesis_texto', v)} max={lim.sintesis_texto} multiline />
              </Seccion>

              <Seccion icono={<ThumbUpIcon />} titulo="Lo que ya funciona" descripcion="Cada una se marca con ✓ en un mensaje del negocio." ayuda={AYUDA.fortalezas}>
                {form.fortalezas.map((f, k) => (
                  <Tarjeta key={f.uid} insignia={<Insignia color="#16a34a"><CheckIcon /></Insignia>} titulo={f.titulo || `Fortaleza ${k + 1}`}
                    extra={hechos.fortalezas.length > 0 && (
                      <Tooltip {...tooltipProps} title={AYUDA.usarDetectada} placement="left">
                        <Select variant="standard" value="" displayEmpty onChange={(e) => usarFortaleza(k, e.target.value)} MenuProps={menuProps}
                          SelectDisplayProps={{ 'aria-label': `Usar una fortaleza detectada para la ${k + 1}` }}
                          input={<InputBase sx={{ ...campoSx, width: 'auto', py: 0.3, fontSize: '0.72rem', bgcolor: 'transparent' }} />}
                          renderValue={() => <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Usar detectada</span>}>
                          <ListSubheader>Detectado en la conversación</ListSubheader>
                          {hechos.fortalezas.map((h) => (
                            <MenuItem key={h.id} value={h.id}>
                              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, ...verde }}>{h.titulo}</Typography>
                                <Typography sx={{ fontSize: '0.78rem' }}>{h.texto}</Typography>
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </Tooltip>
                    )}>
                    <Campo etiqueta="Título" valor={f.titulo} onChange={(v) => setItem('fortalezas', k, { titulo: v })} max={lim.f_titulo} />
                    <Campo etiqueta="Detalle" valor={f.texto} onChange={(v) => setItem('fortalezas', k, { texto: v })} max={lim.f_texto} />
                    <Elegir etiqueta="Se ve en" ayuda={AYUDA.seVeEnFo} valor={f.mensaje} onChange={(v) => setItem('fortalezas', k, { mensaje: v })} renderValue={mensajeElegido}
                      nota={vacio(f.mensaje) && negocioLibres === 0
                        ? 'Todos los mensajes del negocio ya tienen marca: puede quedar sin marca o libera uno en otro hallazgo.' : null}>
                      {opcionesMensaje(`✓${k + 1}`, ['negocio'])}
                    </Elegir>
                  </Tarjeta>
                ))}
              </Seccion>

              <Seccion icono={<TrackChangesIcon />} titulo="Áreas de oportunidad" ayuda={AYUDA.oportunidades}
                descripcion="De la más grave a la menos. El número aparece en la conversación."
                extra={<Pastilla sx={{ bgcolor: 'rgba(245,158,11,0.16)', ...ambar }}>{nOp} de {MAX_OPORTUNIDADES}</Pastilla>}>
                {form.oportunidades.map((o, k) => (
                  <Tarjeta key={o.uid} insignia={<Insignia color="#f59e0b">{k + 1}</Insignia>} titulo={o.titulo || `Oportunidad ${k + 1}`}
                    extra={(
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                        <Accion titulo="Subir (más grave)" onClick={() => moverOportunidad(k, -1)} disabled={k === 0}><ArrowUpwardIcon /></Accion>
                        <Accion titulo="Bajar (menos grave)" onClick={() => moverOportunidad(k, 1)} disabled={k === nOp - 1}><ArrowDownwardIcon /></Accion>
                        <Accion titulo={nOp === 1 ? 'Debe quedar al menos una' : 'Quitar esta oportunidad'} onClick={() => quitarOportunidad(k)} disabled={nOp === 1}>
                          <DeleteOutlineIcon />
                        </Accion>
                      </Box>
                    )}>
                    {hechos.oportunidades.length > 0 && (
                      <Elegir etiqueta="Usar un hallazgo detectado" ayuda={AYUDA.usarHallazgo} valor="" onChange={(id) => usarOportunidad(k, id)}
                        renderValue={() => tenue('Elige uno para llenar la tarjeta…')}>
                        <ListSubheader>Detectado en la conversación</ListSubheader>
                        {hechos.oportunidades.map((h) => (
                          <MenuItem key={h.id} value={h.id}>
                            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, ...ambar }}>{h.dato}</Typography>
                              <Typography sx={{ fontSize: '0.8rem' }}>{h.vimos}</Typography>
                            </Box>
                          </MenuItem>
                        ))}
                      </Elegir>
                    )}
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 1 }}>
                      <Campo etiqueta="Título" valor={o.titulo} onChange={(v) => setItem('oportunidades', k, { titulo: v })} max={lim.o_titulo} />
                      <Campo etiqueta="Etiqueta" ayuda={AYUDA.etiqueta} valor={o.dato} onChange={(v) => setItem('oportunidades', k, { dato: v })} max={lim.o_dato} />
                    </Box>
                    <Campo etiqueta="Lo que vimos" ayuda={AYUDA.vimos} valor={o.vimos} onChange={(v) => setItem('oportunidades', k, { vimos: v })} max={lim.o_vimos} multiline />
                    <Campo etiqueta="La oportunidad" ayuda={AYUDA.oportunidad} valor={o.oportunidad} onChange={(v) => setItem('oportunidades', k, { oportunidad: v })} max={lim.o_oportunidad} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 1 }}>
                      <Elegir etiqueta="La resuelve" ayuda={AYUDA.resuelve} valor={o.ventaja} onChange={(v) => setItem('oportunidades', k, { ventaja: v })}
                        renderValue={(v) => (v ? ev.ventajas.find((x) => x.id === v)?.titulo : tenue('Ninguna'))}>
                        <MenuItem value=""><em>Ninguna</em></MenuItem>
                        {ev.ventajas.map((v) => <MenuItem key={v.id} value={v.id} disabled={ventajasUsadas(k).has(v.id)}>{v.titulo}</MenuItem>)}
                      </Elegir>
                      <Elegir etiqueta="Se ve en" ayuda={AYUDA.seVeEnOp} valor={o.mensaje} onChange={(v) => setItem('oportunidades', k, { mensaje: v })} renderValue={mensajeElegido}>
                        {opcionesMensaje(String(k + 1), ['cliente', 'negocio', 'nota'])}
                      </Elegir>
                    </Box>
                  </Tarjeta>
                ))}
                <Tooltip {...tooltipProps} title={nOp >= MAX_OPORTUNIDADES ? 'Máximo 3: es lo que cabe en la hoja carta. Quita una para agregar otra.'
                  : 'Agrega la siguiente detectada en la conversación (o una en blanco si ya están todas).'}>
                  <span>
                    <Button fullWidth onClick={agregarOportunidad} disabled={nOp >= MAX_OPORTUNIDADES} startIcon={<AddIcon />}
                      sx={{ ...botonSx, fontWeight: 600, py: 1, color: 'var(--accent)', border: '1px dashed rgba(var(--accent-rgb),0.5)',
                        '&:hover': { bgcolor: 'rgba(var(--accent-rgb),0.08)', borderColor: 'var(--accent)' },
                        '&.Mui-disabled': { color: 'var(--text-muted)', borderColor: 'var(--border)' } }}>
                      Agregar área de oportunidad
                    </Button>
                  </span>
                </Tooltip>
              </Seccion>

              <Button onClick={regenerar} disabled={ocupado} startIcon={<RefreshIcon />}
                sx={{ ...botonSx, fontWeight: 600, alignSelf: 'flex-start', color: 'var(--text-muted)', mb: 1 }}>
                Redactar de nuevo desde la conversación
              </Button>
            </Box>

            {/* Vista previa */}
            <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: 760, lg: 0 }, bgcolor: 'var(--bg)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>Vista previa</Typography>
                    <Ayuda texto={AYUDA.vista} de="Vista previa" />
                  </Box>
                  <Typography role="status" sx={{ fontSize: '0.72rem', ...(errorVista ? ambar : { color: 'var(--text-muted)' }) }} noWrap>
                    {errorVista || (actualizando ? 'Actualizando…' : cambios ? 'Así se verá al guardar' : 'Así la verá el cliente')}
                  </Typography>
                </Box>
                {actualizando && <CircularProgress size={14} sx={{ color: 'var(--accent)' }} />}
                <ToggleButtonGroup size="small" exclusive value={modoVista} onChange={(_, v) => v && setModoVista(v)} aria-label="Dispositivo" sx={toggleSx}>
                  <Tooltip {...tooltipProps} title="Como se ve en computadora (hoja carta)">
                    <ToggleButton value="escritorio" aria-label="Computadora"><DesktopIcon fontSize="small" /></ToggleButton>
                  </Tooltip>
                  <Tooltip {...tooltipProps} title="Como se ve en el celular, donde la abrirá la mayoría">
                    <ToggleButton value="celular" aria-label="Celular"><PhoneIcon fontSize="small" /></ToggleButton>
                  </Tooltip>
                </ToggleButtonGroup>
                <ToggleButtonGroup size="small" exclusive value={tema} onChange={(_, v) => v && setTema(v)} aria-label="Tema de la página" sx={toggleSx}>
                  <Tooltip {...tooltipProps} title="Modo claro">
                    <ToggleButton value="light" aria-label="Claro"><LightModeIcon fontSize="small" /></ToggleButton>
                  </Tooltip>
                  <Tooltip {...tooltipProps} title="Modo oscuro: así la ve quien tiene su teléfono en oscuro">
                    <ToggleButton value="dark" aria-label="Oscuro"><DarkModeIcon fontSize="small" /></ToggleButton>
                  </Tooltip>
                </ToggleButtonGroup>
              </Box>
              <Box ref={setMarco} sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
                position: 'relative', opacity: estado === 'guardando' ? 0.6 : 1, transition: 'opacity .2s' }}>
                {/* Aislada del resto de la app: sin allow-same-origin, sus scripts no ven la sesión. */}
                {modoVista === 'escritorio' ? (
                  <Box sx={{ width: ANCHO_HOJA * escala, height: ALTO_HOJA * escala, flexShrink: 0, borderRadius: '10px', overflow: 'hidden',
                    border: '1px solid var(--border)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
                    <iframe title="Vista previa de la evaluación" srcDoc={vistaHtml} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                      style={{ border: 0, width: ANCHO_HOJA, height: ALTO_HOJA, transform: `scale(${escala})`, transformOrigin: '0 0', display: 'block' }} />
                  </Box>
                ) : (
                  <Box sx={{ width: 402, height: 812, flexShrink: 0, borderRadius: '40px', border: '6px solid #0f172a', overflow: 'hidden',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.3)', bgcolor: '#0f172a' }}>
                    <iframe title="Vista previa de la evaluación en celular" srcDoc={vistaHtml} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                      style={{ border: 0, width: 390, height: 800, display: 'block', borderRadius: '34px' }} />
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      <Snackbar open={!!aviso} autoHideDuration={4000} onClose={() => setAviso('')} message={aviso}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
      <Snackbar open={!!deshacer} autoHideDuration={8000} onClose={(_, razon) => { if (razon !== 'clickaway') setDeshacer(null) }}
        message={deshacer ? `Se quitó «${deshacer.item.titulo || 'la oportunidad'}»` : ''}
        action={<Button size="small" onClick={restaurar} sx={{ ...botonSx, color: 'var(--accent)' }}>Deshacer</Button>}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} />
    </Dialog>
  )
}
