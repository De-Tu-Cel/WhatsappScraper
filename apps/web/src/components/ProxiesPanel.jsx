'use client'
// Proxies por número de WhatsApp: el pool (Instancias → Proxies) y el diálogo de cada
// número (su proxy, modo ligero, memoria y por qué IP sale). La lógica vive en el backend
// (apps/api/app/proxies.py); aquí nunca llega una contraseña.
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Menu from '@mui/material/Menu'
import Divider from '@mui/material/Divider'
import Skeleton from '@mui/material/Skeleton'
import VpnLockIcon from '@mui/icons-material/VpnLock'
import RefreshIcon from '@mui/icons-material/Refresh'
import CloseIcon from '@mui/icons-material/Close'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import SpeedIcon from '@mui/icons-material/Speed'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PublicIcon from '@mui/icons-material/Public'
import SmartphoneIcon from '@mui/icons-material/Smartphone'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import PlaceIcon from '@mui/icons-material/Place'
import ScheduleIcon from '@mui/icons-material/Schedule'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useLang } from '../context/LangContext'
import { parseUtc } from '../lib/dates'

const token = () => (typeof window !== 'undefined' && localStorage.getItem('user_token')) || ''

async function api(path, opts = {}) {
  const r = await fetch(`/api/proxies${path}`, {
    cache: 'no-store', ...opts,
    headers: { 'Content-Type': 'application/json', 'x-user-token': token(), ...(opts.headers || {}) },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`)
  return j
}

// Código de país como etiqueta: Windows no dibuja banderas emoji (se ven como "us").
function CountryCode({ cc }) {
  return (
    <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.66rem', fontWeight: 700, px: 0.5, py: 0.1, mr: 0.6,
      borderRadius: 0.8, color: 'var(--text-muted)', border: '1px solid var(--border, rgba(255,255,255,0.12))' }}>
      {cc || '—'}
    </Box>
  )
}

const STATUS = {
  ok:        { es: 'Funciona',    en: 'Working',     color: '#4ade80' },
  failing:   { es: 'No responde', en: 'Not working', color: '#f87171' },
  unchecked: { es: 'Sin revisar', en: 'Not checked', color: '#94a3b8' },
}

function ago(iso, lang) {
  const d = parseUtc(iso)
  if (!d) return lang === 'en' ? 'never' : 'nunca'
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000))
  if (min < 1) return lang === 'en' ? 'just now' : 'hace un momento'
  if (min < 60) return lang === 'en' ? `${min} min ago` : `hace ${min} min`
  const h = Math.round(min / 60)
  return lang === 'en' ? `${h} h ago` : `hace ${h} h`
}

const PAPER_SX = {
  bgcolor: 'var(--card-bg,#161d2e) !important', background: 'var(--card-bg,#161d2e) !important',
  backgroundImage: 'none !important', border: '1px solid var(--border, rgba(255,255,255,0.1)) !important',
  borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
}

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'var(--card-bg, rgba(255,255,255,0.04))', fontSize: '0.85rem', borderRadius: 2,
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& input, & textarea, & .MuiSelect-select': { color: 'var(--text, #f1f5f9)' },
  '& label': { color: 'var(--text-muted, rgba(255,255,255,0.4))' },
  '& label.Mui-focused': { color: 'var(--accent,#3b82f6)' },
}

const PRIMARY_BTN_SX = {
  textTransform: 'none', fontWeight: 700, fontSize: '0.8rem', borderRadius: 2, px: 2,
  bgcolor: 'var(--accent, #3b82f6)', '&:hover': { bgcolor: 'color-mix(in srgb, var(--accent, #3b82f6) 82%, black)' },
  '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' },
}

const GHOST_BTN_SX = {
  textTransform: 'none', fontSize: '0.8rem', color: 'var(--text-muted,rgba(255,255,255,0.5))', borderRadius: 2,
  '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.05)' },
}

function DialogHeader({ icon, title, subtitle, onClose }) {
  return (
    <DialogTitle sx={{ pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 2, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
        }}>{icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: 'var(--text,#f1f5f9)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>{title}</Typography>
          {subtitle && (
            <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.38))', fontSize: '0.7rem', fontFamily: 'monospace', mt: 0.2 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose}
          sx={{ color: 'var(--text-muted,rgba(255,255,255,0.25))', '&:hover': { color: 'var(--text,white)', bgcolor: 'rgba(255,255,255,0.06)' } }}>
          <CloseIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Box>
    </DialogTitle>
  )
}

function StatusDot({ status, lang, title }) {
  const s = STATUS[status] || STATUS.unchecked
  return (
    <Tooltip title={title || ''} placement="top">
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.color, boxShadow: status === 'ok' ? `0 0 6px ${s.color}99` : 'none' }} />
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: s.color }}>{s[lang === 'en' ? 'en' : 'es']}</Typography>
      </Box>
    </Tooltip>
  )
}

// ── Importar lista ───────────────────────────────────────────────────────────
function ImportDialog({ open, onClose, onDone }) {
  const { lang } = useLang()
  const L = (es, en) => (lang === 'en' ? en : es)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api('/import', { method: 'POST', body: JSON.stringify({ text }) })
      setResult(r); setText(''); onDone?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} slotProps={{ paper: { sx: { ...PAPER_SX, width: 520, maxWidth: 'calc(100% - 32px)' } } }}>
      <DialogHeader icon={<ContentPasteIcon sx={{ fontSize: 17, color: 'var(--accent,#60a5fa)' }} />}
        title={L('Importar proxies', 'Import proxies')} onClose={onClose} />
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 1.4 }}>
        <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {L('Uno por renglón, como ip:puerto:usuario:contraseña. También puedes pegar la tabla tal cual del panel de Webshare. Cada proxy se revisa saliendo por él, para saber si funciona y de qué país es su IP.',
             'One per line, as ip:port:username:password. You can also paste the table straight from the Webshare panel. Each proxy is checked by going out through it, to learn whether it works and which country its IP is in.')}
        </Typography>
        <TextField multiline minRows={7} maxRows={14} fullWidth value={text} onChange={e => setText(e.target.value)}
          placeholder="138.226.70.167:7857:usuario:contraseña" sx={{ ...FIELD_SX, '& textarea': { fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text,#f1f5f9)' } }} />
        {err && <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{err}</Typography>}
        {result && (
          <Typography sx={{ fontSize: '0.78rem', color: '#4ade80' }}>
            {L(`Listo: ${result.added} nuevos, ${result.updated} actualizados. ${result.ok} funcionan, ${result.failing} no responden.${result.reapplied ? ` Se re-aplicó a ${result.reapplied} ${result.reapplied === 1 ? 'número' : 'números'} que ya los usaban.` : ''}`,
               `Done: ${result.added} new, ${result.updated} updated. ${result.ok} working, ${result.failing} not responding.${result.reapplied ? ` Re-applied to ${result.reapplied} number(s) already using them.` : ''}`)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1.5, gap: 1, borderTop: '1px solid rgba(255,255,255,0.05)', mt: 1 }}>
        <Button size="small" onClick={onClose} disabled={busy} sx={GHOST_BTN_SX}>{result ? L('Cerrar', 'Close') : L('Cancelar', 'Cancel')}</Button>
        <Button size="small" variant="contained" onClick={submit} disabled={busy || !text.trim()} sx={PRIMARY_BTN_SX}>
          {busy ? <><CircularProgress size={13} sx={{ color: 'white', mr: 1 }} />{L('Revisando…', 'Checking…')}</> : L('Importar y revisar', 'Import and check')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Sección del pool ─────────────────────────────────────────────────────────
// Mismo lenguaje visual que el resto de Instancias: encabezado con banda degradada y caja
// de ícono, franja de métricas con anillos, y tarjetas compactas como las de Equipo.

const PANEL_HEADER_SX = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap',
  px: 2, py: 1.6, position: 'relative',
  background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.12) 0%, rgba(var(--accent-rgb,59,130,246),0.04) 60%, transparent 100%)',
  borderBottom: '1px solid rgba(var(--accent-rgb,59,130,246),0.15)',
  '&::after': {
    content: '""', position: 'absolute', bottom: 0, left: 16, right: 16, height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb,59,130,246),0.4) 40%, rgba(var(--accent-rgb,59,130,246),0.4) 60%, transparent)',
  },
}

const ICON_BOX_SX = {
  width: 32, height: 32, borderRadius: '9px', flexShrink: 0,
  background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.25) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
  border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const OUTLINED_BTN_SX = {
  color: 'var(--accent, #60a5fa)', borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)', fontWeight: 700,
  fontSize: '0.82rem', borderRadius: 2, textTransform: 'none', px: 2,
  '&:hover': { borderColor: 'var(--accent, #60a5fa)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.08)' },
}

const STRIP_SX = {
  display: 'flex', flexWrap: 'wrap', overflow: 'hidden',
  borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
  bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
}

// Igual que InstStatCard de InstancesPanel (anillo conic-gradient + label + valor).
function StatCard({ icon, color, value, label, subtitle, percent }) {
  const pct = percent == null ? 100 : Math.max(0, Math.min(100, percent))
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, p: '3px',
        background: `conic-gradient(${color} ${pct}%, var(--border, rgba(255,255,255,0.12)) ${pct}% 100%)` }}>
        <Box sx={{ width: '100%', height: '100%', borderRadius: '50%', bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.76rem', color: 'var(--text)', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{label}</Typography>
        {subtitle && <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap' }}>{subtitle}</Typography>}
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
      </Box>
    </Box>
  )
}

function SettingTile({ icon, color = 'var(--accent, #60a5fa)', title, children, action }) {
  return (
    <Box sx={{ flex: '1 1 320px', minWidth: 0, border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2.5,
      px: 1.8, py: 1.5, display: 'flex', gap: 1.4, bgcolor: 'rgba(255,255,255,0.015)' }}>
      <Box sx={{ ...ICON_BOX_SX, width: 34, height: 34, color }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 30 }}>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>{title}</Typography>
          {action}
        </Box>
        {children}
      </Box>
    </Box>
  )
}

// Encabezado de cada grupo (en uso / libres / …): punto + nombre + conteo, y una
// línea de qué significa el grupo, para no tener que adivinarlo por el color.
function GroupLabel({ color, label, count, hint, open, onToggle }) {
  const clickable = !!onToggle
  return (
    <Box onClick={onToggle} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, cursor: clickable ? 'pointer' : 'default', userSelect: 'none' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text)', whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <Box sx={{ px: 0.8, borderRadius: 99, fontSize: '0.64rem', fontWeight: 800, lineHeight: '18px', color: 'var(--text-muted)',
        bgcolor: 'var(--item-hover, rgba(255,255,255,0.05))', border: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }}>{count}</Box>
      {hint && (
        <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {hint}
        </Typography>
      )}
      <Box sx={{ flex: 1, height: '1px', minWidth: 16, background: 'linear-gradient(90deg, var(--border, rgba(255,255,255,0.12)), transparent)' }} />
      {clickable && (
        <ExpandMoreIcon sx={{ fontSize: 18, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }} />
      )}
    </Box>
  )
}

// Barra de cómo se reparte el pool: cuánto está ocupado, libre, caído o fuera de uso.
function PoolBar({ segments, lang }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  if (!total) return null
  return (
    <Box sx={{ border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2.5, px: 1.8, py: 1.4, bgcolor: 'rgba(255,255,255,0.015)' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)' }}>
          {lang === 'en' ? 'How the pool is used' : 'Cómo se usa el pool'}
        </Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
          {total} {lang === 'en' ? 'proxies' : 'proxies'}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: '3px', height: 10, borderRadius: 99, overflow: 'hidden', bgcolor: 'var(--item-hover, rgba(255,255,255,0.05))' }}>
        {segments.filter(s => s.count > 0).map(s => (
          <Tooltip key={s.key} title={`${s.label}: ${s.count}`} placement="top">
            <Box sx={{ flex: s.count, bgcolor: s.color, opacity: s.dim ? 0.55 : 1, transition: 'flex 0.4s ease' }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
        {segments.map(s => (
          <Box key={s.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.7 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color, opacity: s.dim ? 0.55 : 1 }} />
            <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {s.label} <Box component="span" sx={{ fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{s.count}</Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Estado del proxy cuando no tiene número: en el pie de la tarjeta, en vez de
// un "sin número" en cursiva que se veía igual en libres, caídos y desactivados.
const IDLE_STATE = {
  free:     { es: 'Disponible',   en: 'Available',      color: '#4ade80' },
  failing:  { es: 'No responde',  en: 'Not responding', color: '#f87171' },
  disabled: { es: 'Desactivado',  en: 'Disabled',       color: '#94a3b8' },
  other:    { es: 'Otro país',    en: 'Other country',  color: '#94a3b8' },
}

function ProxyTile({ p, lang, busy, onCheck, onToggle, onDelete, dim, idle }) {
  const L = (es, en) => (lang === 'en' ? en : es)
  const [anchor, setAnchor] = useState(null)
  const s = STATUS[p.status] || STATUS.unchecked
  const inUse = p.instances.length > 0
  const idleState = IDLE_STATE[idle] || IDLE_STATE.other
  const place = [p.city, p.region && p.region !== p.city ? p.region : null].filter(Boolean).join(', ')
  return (
    <Box sx={{
      border: '1px solid', borderColor: inUse ? 'rgba(var(--accent-rgb,59,130,246),0.28)' : 'var(--border, rgba(255,255,255,0.08))',
      borderRadius: 2.5, px: 1.5, pt: 1.3, pb: 1.1, height: '100%', boxSizing: 'border-box',
      background: inUse
        ? 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.09) 0%, transparent 60%), var(--card-bg)'
        : 'var(--card-bg)',
      display: 'flex', flexDirection: 'column', gap: 0.8, minWidth: 0,
      opacity: dim ? 0.6 : 1, transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s',
      '&:hover': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.5)', boxShadow: '0 8px 24px rgba(0,0,0,0.28)', transform: 'translateY(-1px)', opacity: 1 },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, minWidth: 0 }}>
        <Tooltip title={`${s[lang === 'en' ? 'en' : 'es']} · ${L('revisado', 'checked')} ${ago(p.last_checked_at, lang)}${p.last_error ? ` · ${p.last_error}` : ''}`} placement="top">
          <Box sx={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: s.color, boxShadow: p.status === 'ok' ? `0 0 7px ${s.color}aa` : 'none' }} />
          </Box>
        </Tooltip>
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.host}<Box component="span" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>:{p.port}</Box>
        </Typography>
        <CountryCode cc={p.country} />
        <IconButton size="small" aria-label={L('Acciones del proxy', 'Proxy actions')} onClick={e => setAnchor(e.currentTarget)} disabled={!!busy}
          sx={{ p: 0.3, color: 'var(--text-muted)', '&:hover': { color: 'var(--accent,#60a5fa)', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)' } }}>
          {busy === p.id ? <CircularProgress size={14} /> : <MoreHorizIcon sx={{ fontSize: 17 }} />}
        </IconButton>
      </Box>
      <Tooltip title={p.org || ''} placement="top-start">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <PlaceIcon sx={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {place || '—'}{p.org ? <Box component="span" sx={{ opacity: 0.75 }}> · {p.org}</Box> : null}
          </Typography>
        </Box>
      </Tooltip>
      {/* Pie fijo: a quién está asignado (o su estado si está libre) + hace cuánto se revisó. */}
      <Box sx={{ mt: 'auto', pt: 0.9, borderTop: '1px dashed var(--border, rgba(255,255,255,0.1))',
        display: 'flex', alignItems: 'center', gap: 0.8, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1, minWidth: 0 }}>
          {inUse ? p.instances.map(n => (
            <Box key={n} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.8, py: 0.2, borderRadius: 99, maxWidth: '100%',
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.32)' }}>
              <SmartphoneIcon sx={{ fontSize: 11, color: 'var(--accent,#60a5fa)' }} />
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent,#60a5fa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</Typography>
            </Box>
          )) : (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 0.8, py: 0.2, borderRadius: 99,
              border: `1px solid ${idleState.color}55`, bgcolor: `${idleState.color}14` }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: idleState.color }}>{idleState[lang === 'en' ? 'en' : 'es']}</Typography>
            </Box>
          )}
        </Box>
        {p.exit_ip_change_count > 0 && (
          <Tooltip placement="top" title={L(`La IP de salida cambió ${p.exit_ip_change_count} ${p.exit_ip_change_count === 1 ? 'vez' : 'veces'}`,
            `The exit IP changed ${p.exit_ip_change_count} time${p.exit_ip_change_count === 1 ? '' : 's'}`)}>
            <SwapHorizIcon sx={{ fontSize: 15, color: '#fbbf24', flexShrink: 0 }} />
          </Tooltip>
        )}
        {p.fail_streak > 0 && (
          <Tooltip placement="top" title={L(`${p.fail_streak} revisiones seguidas sin responder`, `${p.fail_streak} checks in a row without answering`)}>
            <WarningAmberIcon sx={{ fontSize: 14, color: '#f87171', flexShrink: 0 }} />
          </Tooltip>
        )}
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, flexShrink: 0 }}>
          <ScheduleIcon sx={{ fontSize: 11, color: 'var(--text-muted)' }} />
          <Typography sx={{ fontSize: '0.64rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ago(p.last_checked_at, lang)}</Typography>
        </Box>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} elevation={0}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { sx: { py: 0.5 } }, paper: { sx: { mt: 0.5, borderRadius: 2, minWidth: 200, bgcolor: 'var(--card-bg, #16181d)',
          backgroundImage: 'none', border: '1px solid var(--border, rgba(255,255,255,0.1))', boxShadow: '0 16px 40px rgba(0,0,0,0.45)' } } }}>
        {[
          { key: 'check', label: L('Revisar ahora', 'Check now'), icon: <RefreshIcon />, onClick: onCheck },
          { key: 'toggle', label: p.enabled ? L('Desactivar', 'Disable') : L('Activar', 'Enable'), icon: <PowerSettingsNewIcon />, onClick: onToggle },
          { key: 'delete', label: inUse ? L('Eliminar (tiene números)', 'Delete (has numbers)') : L('Eliminar', 'Delete'), icon: <DeleteForeverIcon />,
            onClick: onDelete, danger: true, disabled: inUse },
        ].map(it => (
          <MenuItem key={it.key} disabled={it.disabled} onClick={() => { setAnchor(null); it.onClick() }}
            sx={{ gap: 1.2, py: 0.8, fontSize: '0.8rem', color: it.danger ? '#f87171' : 'var(--text)',
              '& svg': { fontSize: 16, color: it.danger ? '#f87171' : 'var(--accent,#60a5fa)' },
              '&:hover': { bgcolor: it.danger ? 'rgba(248,113,113,0.08)' : 'var(--item-hover, rgba(255,255,255,0.05))' } }}>
            {it.icon}{it.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}

const SK = { bgcolor: 'var(--border, rgba(255,255,255,0.08))' }

// Silueta de los ajustes y de las tarjetas mientras llega la lista: mismas cajas que
// SettingTile y ProxyTile para que la página no brinque al cargar.
function ProxiesSkeleton() {
  const widths = ['74%', '60%', '82%', '68%', '71%', '56%', '79%', '64%']
  const places = [62, 48, 70, 55, 66, 44, 58, 72]
  const card = { border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2.5, bgcolor: 'rgba(255,255,255,0.015)' }
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: 2,
      '@keyframes proxySkeletonIn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      '& [data-sk-in]': { animation: 'proxySkeletonIn 0.3s ease both' },
      '@media (prefers-reduced-motion: reduce)': { '& [data-sk-in]': { animation: 'none' } },
    }}>
      {/* Ajustes: caja de ícono + título + control a la derecha + 3 líneas */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {[0, 1].map(i => (
          <Box key={i} data-sk-in sx={{ ...card, flex: '1 1 320px', minWidth: 0, px: 1.8, py: 1.5, display: 'flex', gap: 1.4 }}>
            <Skeleton variant="rounded" width={34} height={34} sx={{ ...SK, borderRadius: '9px', flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minHeight: 30, mb: 0.6 }}>
                <Skeleton variant="rounded" width={i ? 150 : 104} height={13} sx={SK} />
                {i ? <Skeleton variant="rounded" width={78} height={20} sx={{ ...SK, borderRadius: 99 }} />
                   : <Skeleton variant="rounded" width={150} height={32} sx={{ ...SK, borderRadius: 2 }} />}
              </Box>
              <Skeleton variant="rounded" width="96%" height={9} sx={{ ...SK, mb: 0.7 }} />
              <Skeleton variant="rounded" width={i ? '90%' : '93%'} height={9} sx={{ ...SK, mb: 0.7 }} />
              <Skeleton variant="rounded" width={i ? '62%' : '70%'} height={9} sx={SK} />
            </Box>
          </Box>
        ))}
      </Box>

      {/* Barra "Cómo se usa el pool" */}
      <Box data-sk-in sx={{ ...card, px: 1.8, py: 1.4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.2 }}>
          <Skeleton variant="rounded" width={140} height={12} sx={SK} />
          <Skeleton variant="rounded" width={60} height={10} sx={SK} />
        </Box>
        <Box sx={{ display: 'flex', gap: '3px', height: 10, borderRadius: 99, overflow: 'hidden' }}>
          {[46, 8, 32, 14].map((f, i) => <Skeleton key={i} variant="rectangular" height={10} sx={{ ...SK, flex: f }} />)}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, mt: 1.1 }}>
          {[62, 88, 54, 70].map((w, i) => <Skeleton key={i} variant="rounded" width={w} height={10} sx={SK} />)}
        </Box>
      </Box>

      {/* Grupos: en uso primero y libres después, con la forma de la tarjeta nueva */}
      {[6, 5].map((n, g) => (
        <Box key={g}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Skeleton variant="circular" width={8} height={8} sx={SK} />
            <Skeleton variant="rounded" width={g ? 48 : 58} height={11} sx={SK} />
            <Skeleton variant="rounded" width={22} height={18} sx={{ ...SK, borderRadius: 99 }} />
            <Skeleton variant="rounded" width={g ? 150 : 210} height={10} sx={{ ...SK, opacity: 0.7 }} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 1.2 }}>
            {Array.from({ length: n }).map((_, i) => (
              <Box key={i} data-sk-in sx={{
                border: '1px solid var(--border, rgba(255,255,255,0.08))', borderRadius: 2.5, px: 1.5, pt: 1.3, pb: 1.1,
                bgcolor: 'var(--card-bg)', display: 'flex', flexDirection: 'column', gap: 0.8, minWidth: 0,
                animationDelay: `${(g * 6 + i) * 40}ms`,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9 }}>
                  <Skeleton variant="circular" width={9} height={9} sx={{ ...SK, flexShrink: 0 }} />
                  <Skeleton variant="rounded" height={13} sx={{ ...SK, width: widths[(g * 3 + i) % widths.length], borderRadius: 1 }} />
                  <Skeleton variant="rounded" width={24} height={16} sx={{ ...SK, borderRadius: 0.8, ml: 'auto', flexShrink: 0 }} />
                  <Skeleton variant="circular" width={20} height={20} sx={{ ...SK, flexShrink: 0 }} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Skeleton variant="circular" width={11} height={11} sx={{ ...SK, flexShrink: 0 }} />
                  <Skeleton variant="rounded" height={10} sx={{ ...SK, width: `${places[(g * 2 + i) % places.length]}%` }} />
                </Box>
                <Box sx={{ mt: 0.2, pt: 0.9, borderTop: '1px dashed var(--border, rgba(255,255,255,0.1))', display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Skeleton variant="rounded" width={g ? 72 : 94} height={20} sx={{ ...SK, borderRadius: 99,
                    bgcolor: g ? 'rgba(74,222,128,0.12)' : 'rgba(var(--accent-rgb,59,130,246),0.14)' }} />
                  <Skeleton variant="rounded" width={62} height={10} sx={{ ...SK, ml: 'auto', opacity: 0.7 }} />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function ProxiesSection({ onChanged }) {
  const { lang } = useLang()
  const L = (es, en) => (lang === 'en' ? en : es)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState('')
  // "No se usan" (otro país / desactivados) empieza plegado: no se pueden asignar
  // y antes ocupaban una fila completa de tarjetas en gris.
  const [showUnused, setShowUnused] = useState(false)

  // Qué número usa qué proxy: si cambia sin que hayas hecho nada aquí (asignación automática,
  // un proxy caído que movió sus números, o el menú ⋯ de una fila), se recarga también la
  // lista de Instancias para que sus chips de proxy digan lo mismo.
  const assignSig = useRef('')
  const sigOf = d => (d?.proxies || []).map(p => `${p.id}:${(p.instances || []).join(',')}`).join('|')

  const load = useCallback(async () => {
    try { const d = await api(''); assignSig.current = sigOf(d); setData(d); setErr('') } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => {
    let alive = true
    api('').then(d => { if (alive) { assignSig.current = sigOf(d); setData(d) } }).catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [])

  // Se actualiza sola cada 10 s mientras la página está a la vista: con la asignación
  // automática los números cambian de proxy en segundo plano (al prenderla pasan uno tras
  // otro en un par de minutos).
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const d = await api('')
        const sig = sigOf(d)
        const moved = assignSig.current && sig !== assignSig.current
        assignSig.current = sig
        setData(d)
        if (moved) onChanged?.()
      } catch { /* la siguiente vuelta lo vuelve a intentar */ }
    }, 10000)
    return () => clearInterval(id)
  }, [onChanged])

  const run = async (key, fn) => {
    setBusy(key); setErr('')
    try { await fn(); await load(); onChanged?.() } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const settings = data?.settings || { country: 'US', auto_assign: false }
  const proxies = data?.proxies || []
  const s = data?.summary || { total: 0, usable: 0, ok: 0, free: 0, assigned_instances: 0, wwebjs_instances: 0 }
  const countries = [...new Set([settings.country, ...proxies.map(p => p.country).filter(Boolean)])].sort()
  const usableIn = cc => proxies.filter(p => p.country === cc && p.status === 'ok' && p.enabled).length
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

  const usable = p => p.enabled && p.status === 'ok' && p.country === settings.country
  const allGroups = [
    { key: 'used', color: 'var(--accent,#60a5fa)', label: L('En uso', 'In use'),
      hint: L('cada uno con el número que sale por él', 'each with the number going out through it'),
      items: proxies.filter(p => p.instances.length > 0) },
    { key: 'failing', color: '#f87171', label: L('No responden', 'Not responding'), idle: 'failing',
      hint: L('no se asignan hasta que vuelvan a responder', 'not assigned until they answer again'),
      items: proxies.filter(p => !p.instances.length && p.enabled && p.status === 'failing') },
    { key: 'free', color: '#4ade80', label: L('Libres', 'Free'), idle: 'free',
      hint: L(`listos para asignar en ${settings.country}`, `ready to assign in ${settings.country}`),
      items: proxies.filter(p => !p.instances.length && usable(p)) },
    { key: 'other', color: '#94a3b8', label: L('No se usan', 'Not used'), dim: true, collapsible: true,
      hint: L('otro país o desactivados', 'other country or disabled'),
      items: proxies.filter(p => !p.instances.length && !usable(p) && !(p.enabled && p.status === 'failing')) },
  ]
  const groups = allGroups.filter(g => g.items.length)
  const poolSegments = allGroups.map(g => ({ key: g.key, label: g.label, color: g.color, count: g.items.length, dim: g.dim }))

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))', bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', flexShrink: 0 }}>
      {/* Encabezado */}
      <Box sx={PANEL_HEADER_SX}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={ICON_BOX_SX}><VpnLockIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 16 }} /></Box>
          <Box>
            <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>Proxies</Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'var(--text-muted, rgba(255,255,255,0.3))', lineHeight: 1, mt: 0.2 }}>
              {L('Una IP fija por número de WhatsApp', 'A fixed IP per WhatsApp number')}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Tooltip title={L('Revisar todos ahora', 'Check all now')}>
            <span>
              <IconButton size="small" onClick={() => run('check-all', () => api('/check-all', { method: 'POST' }))} disabled={!!busy || !proxies.length}
                sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--accent, #60a5fa)' } }}>
                {busy === 'check-all' ? <CircularProgress size={16} sx={{ color: 'var(--accent, #60a5fa)' }} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Button variant="outlined" startIcon={<ContentPasteIcon sx={{ fontSize: 15 }} />} onClick={() => setImportOpen(true)} sx={OUTLINED_BTN_SX}>
            {L('Importar lista', 'Import list')}
          </Button>
        </Box>
      </Box>

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Métricas */}
        {!data ? (
          <Box sx={STRIP_SX}>
            {[0, 1, 2, 3].map(i => (
              <Fragment key={i}>
                {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
                <Box sx={{ flex: '1 1 0', minWidth: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.4, px: 2, py: 1.6 }}>
                  <Skeleton variant="circular" width={40} height={40} sx={{ flexShrink: 0, bgcolor: 'var(--border)' }} />
                  <Box>
                    <Skeleton variant="text" width={i === 2 ? 108 : i === 3 ? 82 : 62} height={13} sx={{ bgcolor: 'var(--border)' }} />
                    {i > 0 && <Skeleton variant="text" width={i === 3 ? 96 : 34} height={11} sx={{ bgcolor: 'var(--border)' }} />}
                    <Skeleton variant="text" width={i === 2 ? 54 : 32} height={22} sx={{ bgcolor: 'var(--border)' }} />
                  </Box>
                </Box>
              </Fragment>
            ))}
          </Box>
        ) : (
          <Box sx={STRIP_SX}>
            {[
              { key: 'total', color: 'rgba(148,163,184,0.7)', icon: <VpnLockIcon sx={{ fontSize: 18, color: 'var(--text-muted)' }} />,
                label: 'Proxies', value: s.total },
              { key: 'ok', color: '#4ade80', icon: <CheckCircleIcon sx={{ fontSize: 18, color: '#4ade80' }} />,
                label: L('Funcionan', 'Working'), value: s.ok, subtitle: `${pct(s.ok, s.total)}%`, percent: pct(s.ok, s.total) },
              { key: 'numbers', color: 'var(--accent, #60a5fa)', icon: <SmartphoneIcon sx={{ fontSize: 18, color: 'var(--accent, #60a5fa)' }} />,
                label: L('Números con proxy', 'Numbers with a proxy'), value: `${s.assigned_instances} / ${s.wwebjs_instances}`,
                subtitle: `${pct(s.assigned_instances, s.wwebjs_instances)}%`, percent: pct(s.assigned_instances, s.wwebjs_instances) },
              { key: 'free', color: '#a78bfa', icon: <PublicIcon sx={{ fontSize: 18, color: '#a78bfa' }} />,
                label: L(`Libres en ${settings.country}`, `Free in ${settings.country}`), value: s.free,
                subtitle: L(`de ${s.usable} que funcionan`, `of ${s.usable} working`), percent: pct(s.free, s.usable) },
            ].map(({ key, ...c }, i) => (
              <Fragment key={key}>
                {i > 0 && <Divider orientation="vertical" flexItem sx={{ borderColor: 'var(--border, rgba(255,255,255,0.08))', my: 1.4 }} />}
                <StatCard {...c} />
              </Fragment>
            ))}
          </Box>
        )}

        {!data && !err && <ProxiesSkeleton />}

        {/* Ajustes */}
        {proxies.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <SettingTile icon={<PublicIcon sx={{ fontSize: 17 }} />} title={L('País de las IPs', 'IP country')}
              action={
                <TextField select size="small" value={settings.country} disabled={busy === 'settings'}
                  onChange={e => run('settings', () => api('/settings', { method: 'PUT', body: JSON.stringify({ country: e.target.value }) }))}
                  sx={{ ...FIELD_SX, minWidth: 150, '& .MuiSelect-select': { py: 0.6, fontSize: '0.8rem', color: 'var(--text,#f1f5f9)' } }}>
                  {countries.map(cc => <MenuItem key={cc} value={cc} sx={{ fontSize: '0.8rem' }}>{cc} · {usableIn(cc)} {L('funcionan', 'working')}</MenuItem>)}
                </TextField>
              }>
              <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {L('Solo se asignan IPs de este país. Cada número conserva la suya; si hay más números que proxies, se comparten empezando por los menos usados.',
                   'Only IPs from this country are assigned. Each number keeps its own; when there are more numbers than proxies, the least used are shared first.')}
              </Typography>
            </SettingTile>
            <SettingTile icon={<AutorenewIcon sx={{ fontSize: 17 }} />} title={L('Asignación automática', 'Automatic assignment')}
              color={settings.auto_assign ? (settings.migrate_paused ? '#fbbf24' : '#4ade80') : 'var(--text-muted)'}
              action={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Typography sx={{ fontSize: '0.66rem', fontWeight: 700,
                    color: settings.auto_assign ? (settings.migrate_paused ? '#fbbf24' : '#4ade80') : 'var(--text-muted)' }}>
                    {settings.auto_assign ? (settings.migrate_paused ? L('En pausa', 'Paused') : L('Prendida', 'On')) : L('Apagada', 'Off')}
                  </Typography>
                  <Switch size="small" checked={!!settings.auto_assign} disabled={busy === 'settings'}
                    onChange={e => run('settings', () => api('/settings', { method: 'PUT', body: JSON.stringify({ auto_assign: e.target.checked }) }))} />
                </Box>
              }>
              <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {settings.auto_assign && settings.migrate_paused
                  ? L(`En pausa: ${settings.migrate_paused.name} no volvió a conectarse por su proxy (${settings.migrate_paused.status}). Revisa si pide QR; luego apágala y vuelve a prenderla para seguir con los demás.`,
                      `Paused: ${settings.migrate_paused.name} did not reconnect through its proxy (${settings.migrate_paused.status}). Check whether it needs a QR scan, then turn this off and on again to continue.`)
                  : settings.auto_assign
                  ? L('Prendida: cada número nuevo recibe una IP al crearse, y los que ya existían la reciben en ese momento, uno tras otro (si alguno pide QR, se pausa y te llega un correo). Si un proxy lleva 2 h caído, sus números se mueven a otro.',
                      'On: each new number gets an IP when created, and existing ones get theirs right away, one after another (if one needs a QR scan, it pauses and you get an email). If a proxy is down for 2 h, its numbers move to another.')
                  : L('Apagada: asignas tú desde el menú ⋯ de cada número → "Proxy y rendimiento". Si un proxy se cae, solo te llega un correo.',
                      'Off: you assign from each number’s ⋯ menu → "Proxy and performance". If a proxy goes down, you only get an email.')}
              </Typography>
            </SettingTile>
          </Box>
        )}

        {err && <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{err}</Typography>}

        {/* Lista */}
        {data && proxies.length === 0 && (
          <Box sx={{ border: '1px dashed var(--border, rgba(255,255,255,0.12))', borderRadius: 2.5, py: 3, px: 2, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {L('Sin proxies todavía: cada número sale por la IP del servidor. Pega tu lista con "Importar lista".',
                 'No proxies yet: every number goes out through the server IP. Paste your list with "Import list".')}
            </Typography>
          </Box>
        )}
        {proxies.length > 0 && <PoolBar segments={poolSegments} lang={lang} />}

        {groups.map(g => (
          <Box key={g.key}>
            <GroupLabel color={g.color} label={g.label} count={g.items.length} hint={g.hint}
              open={g.collapsible ? showUnused : undefined} onToggle={g.collapsible ? () => setShowUnused(v => !v) : undefined} />
            {(!g.collapsible || showUnused) && (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 1.2, alignItems: 'stretch' }}>
              {g.items.map(p => (
                <ProxyTile key={p.id} p={p} lang={lang} busy={busy} dim={g.dim}
                  idle={g.key === 'other' ? (p.enabled ? 'other' : 'disabled') : g.idle}
                  onCheck={() => run(p.id, () => api(`/${p.id}/check`, { method: 'POST' }))}
                  onToggle={() => run(p.id, () => api(`/${p.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !p.enabled }) }))}
                  onDelete={() => run(p.id, () => api(`/${p.id}`, { method: 'DELETE' }))} />
              ))}
            </Box>
            )}
          </Box>
        ))}
      </Box>

      {/* key: cada vez que se abre arranca vacío, sin resetear estado en un efecto */}
      <ImportDialog key={importOpen ? 'open' : 'closed'} open={importOpen} onClose={() => setImportOpen(false)}
        onDone={() => { load(); onChanged?.() }} />
    </Box>
  )
}

// ── Proxy y rendimiento de un número ─────────────────────────────────────────
export function InstanceNetworkDialog({ inst, onClose, onChanged }) {
  const { lang } = useLang()
  const L = (es, en) => (lang === 'en' ? en : es)
  const open = Boolean(inst)
  const [pool, setPool] = useState(null)
  const [choice, setChoice] = useState('auto')
  const [current, setCurrent] = useState(() => inst?.proxy || null)
  const [lean, setLean] = useState(() => !!inst?.lean_mode)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [exit, setExit] = useState(null)

  useEffect(() => {
    if (!inst) return
    let alive = true
    api('').then(d => { if (alive) setPool(d) }).catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [inst])

  if (!inst) return null
  const settings = pool?.settings || { country: 'US' }
  const usable = (pool?.proxies || []).filter(p => p.enabled && p.status === 'ok' && p.country === settings.country)

  const apply = async () => {
    setBusy('proxy'); setErr(''); setNote(''); setExit(null)
    try {
      const proxyId = choice === 'none' ? null : choice
      const r = await api(`/instances/${encodeURIComponent(inst.name)}`, { method: 'POST', body: JSON.stringify({ proxy_id: proxyId }) })
      const fresh = await api('')
      setPool(fresh)
      const p = (fresh.proxies || []).find(x => x.id === r.proxy_id)
      setCurrent(p ? { id: p.id, host: p.host, port: p.port, country: p.country, city: p.city, status: p.status, exit_ip: p.exit_ip } : null)
      setNote(r.wwebjs?.restarted
        ? L('Listo. La sesión se reinició con su nuevo proxy; se reconecta sola en 1-2 minutos, sin volver a escanear.',
            'Done. The session restarted with its new proxy; it reconnects by itself in 1-2 minutes, no rescan needed.')
        : L('Listo. Se aplicará la próxima vez que arranque la sesión.', 'Done. It applies the next time the session starts.'))
      onChanged?.()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const toggleLean = async checked => {
    setBusy('lean'); setErr(''); setNote('')
    try {
      const r = await api(`/instances/${encodeURIComponent(inst.name)}/lean`, { method: 'POST', body: JSON.stringify({ enabled: checked }) })
      setLean(checked)
      setNote(r.wwebjs?.restarted
        ? L('Listo. La sesión se reinició; se reconecta sola en 1-2 minutos.', 'Done. The session restarted; it reconnects by itself in 1-2 minutes.')
        : L('Listo. Se aplicará la próxima vez que arranque la sesión.', 'Done. It applies the next time the session starts.'))
      onChanged?.()
    } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const verify = async () => {
    setBusy('verify'); setErr(''); setExit(null)
    try { setExit(await api(`/instances/${encodeURIComponent(inst.name)}/check`)) } catch (e) { setErr(e.message) } finally { setBusy('') }
  }

  const row = (label, value) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
      <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</Typography>
      <Box sx={{ fontSize: '0.8rem', color: 'var(--text)', textAlign: 'right' }}>{value}</Box>
    </Box>
  )

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} slotProps={{ paper: { sx: { ...PAPER_SX, width: 440, maxWidth: 'calc(100% - 32px)' } } }}>
      <DialogHeader icon={<VpnLockIcon sx={{ fontSize: 17, color: 'var(--accent,#60a5fa)' }} />}
        title={L('Proxy y rendimiento', 'Proxy and performance')} subtitle={inst.label || inst.name} onClose={onClose} />
      <DialogContent sx={{ pt: '8px !important', display: 'flex', flexDirection: 'column', gap: 1.6 }}>
        {/* Proxy actual */}
        <Box sx={{ border: '1px solid var(--border)', borderRadius: 2, p: 1.4, display: 'flex', flexDirection: 'column', gap: 0.8 }}>
          {row(L('Sale por', 'Goes out through'), current
            ? <span style={{ fontFamily: 'monospace' }}>{current.host}:{current.port}</span>
            : <span style={{ color: 'var(--text-muted)' }}>{L('la IP del servidor (sin proxy)', 'the server IP (no proxy)')}</span>)}
          {current && row(L('Ubicación', 'Location'), `${current.city || ''} ${current.country || ''}`.trim() || '—')}
          {current && row(L('Estado', 'Status'), <StatusDot status={current.status} lang={lang} />)}
          {row(L('Memoria', 'Memory'), inst.memory_mb != null ? `${inst.memory_mb} MB` : <span style={{ color: 'var(--text-muted)' }}>{L('sin dato', 'n/a')}</span>)}
        </Box>

        {/* Cambiar proxy */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField select size="small" fullWidth label={L('Cambiar a', 'Change to')} value={choice} onChange={e => setChoice(e.target.value)} sx={FIELD_SX}>
            <MenuItem value="auto">{L(`Al azar entre los menos usados (${settings.country})`, `Random among the least used (${settings.country})`)}</MenuItem>
            {usable.map(p => (
              <MenuItem key={p.id} value={p.id} disabled={current?.id === p.id}>
                <span style={{ fontFamily: 'monospace' }}>{p.host}</span>
                &nbsp;·&nbsp;{p.city || p.country}&nbsp;·&nbsp;
                <span style={{ color: p.instances.length ? '#fbbf24' : '#4ade80' }}>
                  {p.instances.length ? L(`lo usa ${p.instances.join(', ')}`, `used by ${p.instances.join(', ')}`) : L('libre', 'free')}
                </span>
              </MenuItem>
            ))}
            <MenuItem value="none">{L('Sin proxy (IP del servidor)', 'No proxy (server IP)')}</MenuItem>
          </TextField>
          <Button size="small" variant="contained" onClick={apply} disabled={!!busy || (choice === 'none' && !current)} sx={{ ...PRIMARY_BTN_SX, height: 40, flexShrink: 0 }}>
            {busy === 'proxy' ? <CircularProgress size={14} sx={{ color: 'white' }} /> : L('Aplicar', 'Apply')}
          </Button>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', mt: -0.8, lineHeight: 1.45 }}>
          {L('Cambiar el proxy reinicia la sesión (1-2 min, sin volver a escanear). No lo cambies seguido: para WhatsApp, un número que brinca de IP es señal de riesgo.',
             'Changing the proxy restarts the session (1-2 min, no rescan). Avoid changing it often: to WhatsApp, a number that keeps changing IP is a risk signal.')}
        </Typography>

        {/* Modo ligero */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SpeedIcon sx={{ fontSize: 18, color: lean ? '#4ade80' : 'var(--text-muted)' }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>{L('Modo ligero', 'Light mode')}</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {L('Menos procesos de Chrome, y si de madrugada pasa de 900 MB se reinicia sola (3-5 am, una a la vez). Cambiarlo reinicia la sesión.',
                 'Fewer Chrome processes, and if it goes over 900 MB it restarts itself overnight (3-5 am, one at a time). Changing it restarts the session.')}
            </Typography>
          </Box>
          {busy === 'lean' ? <CircularProgress size={16} /> : <Switch checked={lean} disabled={!!busy} onChange={e => toggleLean(e.target.checked)} />}
        </Box>

        {/* Verificar salida */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" onClick={verify} disabled={!!busy}
            startIcon={busy === 'verify' ? <CircularProgress size={12} /> : <TravelExploreIcon sx={{ fontSize: '15px !important' }} />} sx={{ ...GHOST_BTN_SX, px: 1 }}>
            {L('Verificar por dónde sale', 'Check where it goes out')}
          </Button>
          {exit && (exit.ok
            ? <Typography sx={{ fontSize: '0.75rem', color: exit.matches === false ? '#f87171' : '#4ade80' }}>
                {exit.outbound_ip} · {exit.city} {exit.country}{' '}
                {exit.matches === true ? L('✓ es su proxy', '✓ its proxy') : exit.matches === false ? L('✗ no es su proxy', '✗ not its proxy') : ''}
              </Typography>
            : <Typography sx={{ fontSize: '0.75rem', color: '#fbbf24' }}>
                {L('No se pudo verificar: ', 'Could not verify: ')}{exit.error}
              </Typography>)}
        </Box>

        {note && <Typography sx={{ fontSize: '0.75rem', color: '#4ade80' }}>{note}</Typography>}
        {err && <Typography sx={{ fontSize: '0.75rem', color: '#f87171' }}>{err}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.05)', mt: 1 }}>
        <Button size="small" onClick={onClose} disabled={!!busy} sx={GHOST_BTN_SX}>{L('Cerrar', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
