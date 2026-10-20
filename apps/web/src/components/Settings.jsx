'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import CircularProgress from '@mui/material/CircularProgress'
import CheckIcon from '@mui/icons-material/Check'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import Slider from '@mui/material/Slider'
import TimerIcon from '@mui/icons-material/Timer'
import SpeedIcon from '@mui/icons-material/Speed'
import SaveIcon from '@mui/icons-material/Save'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import IconButton from '@mui/material/IconButton'
import DescriptionIcon from '@mui/icons-material/Description'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import Button from '@mui/material/Button'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import SpaIcon from '@mui/icons-material/Spa'
import BalanceIcon from '@mui/icons-material/Balance'
import BoltIcon from '@mui/icons-material/Bolt'
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import PinOutlinedIcon from '@mui/icons-material/PinOutlined'
import { authFetch } from '../lib/api'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'
import { loadSendConfig, saveSendConfig, DEFAULT_SEND_CONFIG } from '@/lib/sendConfig'
import { RiskBadge } from './SendConfigPanel'
import { TemplateManagerDialog } from './messageTemplateLibrary'

import { ACCENTS, THEMES, resolveAccent } from '@/lib/themeConfig'
export { ACCENTS, THEMES }

export const LANGS = [
  { value: 'es', flagCode: 'mx', labels: { es: 'Español', en: 'Spanish' } },
  { value: 'en', flagCode: 'us', labels: { es: 'Inglés',  en: 'English' } },
]

const DEFAULT_SETTINGS = { accent: '#3b82f6', theme: 'navy', lang: 'es' }

const DEFAULT_ANDY = { url: 'https://own-wa.detucel.mx', endpoint: '/api/pending', user: '', pass: '', token: '' }
const DEFAULT_EVO  = { url: 'http://localhost:8080', apiKey: '', instance: '' }

export function loadEvoConfig() {
  if (typeof window === 'undefined') return DEFAULT_EVO
  try { return { ...DEFAULT_EVO, ...JSON.parse(localStorage.getItem('evo_config') || '{}') } }
  catch { return DEFAULT_EVO }
}
export function saveEvoConfig(cfg) {
  if (typeof window === 'undefined') return
  localStorage.setItem('evo_config', JSON.stringify({ ...DEFAULT_EVO, ...cfg }))
}

export function loadAndyConfig() {
  if (typeof window === 'undefined') return DEFAULT_ANDY
  try { return { ...DEFAULT_ANDY, ...JSON.parse(localStorage.getItem('andy_config') || '{}') } }
  catch { return DEFAULT_ANDY }
}

export function saveAndyConfig(cfg) {
  if (typeof window === 'undefined') return
  localStorage.setItem('andy_config', JSON.stringify({ ...DEFAULT_ANDY, ...cfg }))
}

export function loadSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('app_settings') || '{}') }
  } catch { return DEFAULT_SETTINGS }
}

export function applySettings(settings) {
  if (typeof document === 'undefined') return
  const accentObj = ACCENTS.find(a => a.value === settings.accent) || ACCENTS[0]
  const themeObj  = THEMES.find(t => t.value === settings.theme)   || THEMES[0]
  const root = document.documentElement
  const accent = resolveAccent(accentObj.value, themeObj)
  root.style.setProperty('--accent', accent.value)
  root.style.setProperty('--accent-rgb', accent.rgb)
  root.style.setProperty('--accent-contrast', accent.contrast)
  root.style.setProperty('--accent-glow', accent.glow)
  root.style.setProperty('--bg',          themeObj.bg)
  root.style.setProperty('--sidebar-bg',  themeObj.sidebar)
  root.style.setProperty('--surface',     themeObj.surface)
  root.style.setProperty('--card-bg',     themeObj.card)
  const isMono  = themeObj.cat === 'mono'
  const isVivid = themeObj.cat === 'light'
  root.style.setProperty('--text',
    isMono ? '#1a2234' : '#f1f5f9')
  root.style.setProperty('--text-muted',
    isMono  ? '#1f2f42'    :
    isVivid ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.45)')
  root.style.setProperty('--border',
    isMono  ? 'rgba(30,41,59,0.20)'       :
    isVivid ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)')
  root.style.setProperty('--item-hover',
    isMono  ? 'rgba(0,0,0,0.07)'       :
    isVivid ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)')
  root.style.setProperty('--scrollbar-thumb',
    isMono  ? 'rgba(0,0,0,0.20)'       :
    isVivid ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)')
  root.style.setProperty('--scrollbar-thumb-hover',
    isMono  ? 'rgba(0,0,0,0.36)'       :
    isVivid ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.28)')
  root.setAttribute('data-theme-mode', isMono ? 'light' : 'dark')
  root.setAttribute('data-theme-cat',  isMono ? 'mono' : isVivid ? 'vivid' : 'dark')
}

// ── Piezas visuales compartidas ──────────────────────────────────────────────
// Misma familia que Instancias/Desempeño: tarjeta con borde suave y encabezado
// con caja de ícono degradada, en vez de títulos en mayúsculas sueltos.

function Card({ children, sx }) {
  return (
    <Box sx={{
      borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))',
      bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))', overflow: 'hidden', minWidth: 0,
      display: 'flex', flexDirection: 'column', ...sx,
    }}>
      {children}
    </Box>
  )
}

function IconBox({ color = 'var(--accent, #3b82f6)', rgb = 'var(--accent-rgb,59,130,246)', size = 30, children }) {
  return (
    <Box sx={{
      width: size, height: size, borderRadius: `${Math.round(size * 0.3)}px`, flexShrink: 0,
      background: `linear-gradient(135deg, rgba(${rgb},0.26) 0%, rgba(${rgb},0.08) 100%)`,
      border: `1px solid rgba(${rgb},0.32)`, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      '& svg': { fontSize: Math.round(size * 0.55) },
    }}>
      {children}
    </Box>
  )
}

function CardHeader({ icon, rgb, color, title, subtitle, right }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.2, px: 2, py: 1.5, position: 'relative',
      background: `linear-gradient(135deg, rgba(${rgb || 'var(--accent-rgb,59,130,246)'},0.1) 0%, transparent 70%)`,
      borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
    }}>
      <IconBox rgb={rgb} color={color}>{icon}</IconBox>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.25 }}>{title}</Typography>
        {subtitle && <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.35, mt: 0.15 }}>{subtitle}</Typography>}
      </Box>
      {right}
    </Box>
  )
}

function StatusPill({ color, label, glow }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.6, flexShrink: 0, px: 1, py: 0.35, borderRadius: 99,
      bgcolor: `${color}1a`, border: `1px solid ${color}47`,
    }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, boxShadow: glow ? `0 0 6px ${color}aa` : 'none' }} />
      <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color, lineHeight: 1, whiteSpace: 'nowrap' }}>{label}</Typography>
    </Box>
  )
}

// 5214428079840 → +52 1 442 807 9840 (México); otros países, tal cual con "+".
function fmtPhone(n) {
  const d = String(n || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 13 && d.startsWith('521')) return `+52 1 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`
  if (d.length === 12 && d.startsWith('52')) return `+52 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return `+${d}`
}

const isConnectedStatus = s => ['open', 'connected', 'WORKING'].includes(s)

function instanceState(inst, lang) {
  const s = inst.live_status || 'unknown'
  if (isConnectedStatus(s)) return { color: '#22c55e', label: lang === 'en' ? 'Connected' : 'Conectada', glow: true }
  if (['connecting', 'initializing', 'authenticated', 'STARTING'].includes(s)) return { color: '#f59e0b', label: lang === 'en' ? 'Connecting' : 'Conectando' }
  if (['need_scan', 'SCAN_QR_CODE'].includes(s)) return { color: '#f59e0b', label: lang === 'en' ? 'Needs QR scan' : 'Requiere escanear QR' }
  return { color: '#94a3b8', label: lang === 'en' ? 'Disconnected' : 'Desconectada' }
}

// ── Encabezado con identidad y estado de un vistazo ─────────────────────────

function SettingsHero({ user, lang, myInst, savedCfg, onGo }) {
  const en = lang === 'en'
  const total = myInst.length
  const conn = myInst.filter(i => isConnectedStatus(i.live_status)).length
  const risk = paceRisk(savedCfg)
  const waColor = total === 0 ? '#94a3b8' : conn === total ? '#22c55e' : conn > 0 ? '#f59e0b' : '#f87171'
  const chips = [
    { key: 'whatsapp', icon: <PhoneAndroidIcon />, color: waColor, label: 'WhatsApp',
      value: total ? (en ? `${conn} of ${total} connected` : `${conn} de ${total} ${total === 1 ? 'conectado' : 'conectados'}`) : (en ? 'no numbers' : 'sin números') },
    { key: 'sending', icon: <SpeedIcon />, color: RISK_META[risk].color, label: en ? 'Pace' : 'Ritmo',
      value: `${savedCfg.msgDelay[0]}–${savedCfg.msgDelay[1]} s · ${RISK_META[risk][en ? 'en' : 'es']}` },
  ]
  return (
    <Box sx={{
      position: 'relative', overflow: 'hidden', borderRadius: 3, mb: 2, flexShrink: 0,
      border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)',
      background: 'linear-gradient(120deg, rgba(var(--accent-rgb,59,130,246),0.2) 0%, rgba(var(--accent-rgb,59,130,246),0.06) 45%, var(--card-bg, rgba(255,255,255,0.02)) 100%)',
      px: { xs: 2, sm: 2.5 }, py: 2.2,
      display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
      // Brillo decorativo en la esquina: le da profundidad sin competir con el texto.
      '&::before': {
        content: '""', position: 'absolute', width: 260, height: 260, right: -80, top: -140, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(var(--accent-rgb,59,130,246),0.28) 0%, transparent 70%)', pointerEvents: 'none',
      },
    }}>
      <Box sx={{
        width: 60, height: 60, borderRadius: '50%', flexShrink: 0, position: 'relative',
        background: 'linear-gradient(135deg, var(--accent,#3b82f6) 0%, color-mix(in srgb, var(--accent,#3b82f6) 55%, #0b1220) 100%)',
        boxShadow: '0 8px 24px rgba(var(--accent-rgb,59,130,246),0.35), inset 0 0 0 2px rgba(255,255,255,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', color: '#fff', textTransform: 'uppercase' }}>
          {(user?.display_name || user?.username || '?')[0]}
        </Typography>
      </Box>
      <Box sx={{ flex: '1 1 220px', minWidth: 0, position: 'relative' }}>
        <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent,#60a5fa)' }}>
          {en ? 'Settings' : 'Configuración'}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.2 }}>
          <Typography sx={{ color: 'var(--text)', fontWeight: 800, fontSize: '1.25rem', lineHeight: 1.2 }}>
            {user?.display_name || user?.username || '—'}
          </Typography>
          <Box sx={{ px: 0.9, py: 0.2, borderRadius: 99, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.16)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.35)' }}>
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--accent,#60a5fa)' }}>
              {user?.role === 'admin' ? (en ? 'Administrator' : 'Administrador') : (en ? 'Agent' : 'Agente')}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', mt: 0.3 }}>{user?.email || (user?.username ? `@${user.username}` : '')}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.2, flexWrap: 'wrap', position: 'relative' }}>
        {chips.map(c => (
          <Box key={c.key} onClick={() => onGo(c.key)} sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 1.4, py: 1, borderRadius: 2.5, cursor: 'pointer', minWidth: 170,
            bgcolor: 'rgba(0,0,0,0.18)', border: '1px solid var(--border, rgba(255,255,255,0.1))', backdropFilter: 'blur(6px)',
            transition: 'border-color 0.2s, transform 0.2s',
            '&:hover': { borderColor: c.color, transform: 'translateY(-1px)' },
          }}>
            <Box sx={{ width: 30, height: 30, borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: `${c.color}1f`, border: `1px solid ${c.color}55`, color: c.color, '& svg': { fontSize: 16 } }}>
              {c.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.label}</Typography>
              <Typography sx={{ fontSize: '0.78rem', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.value}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Navegación lateral ──────────────────────────────────────────────────────

function SettingsNav({ sections, active, onChange }) {
  return (
    <Box component="nav" sx={{
      display: 'flex', flexDirection: { xs: 'row', md: 'column' }, gap: 0.8,
      position: { md: 'sticky' }, top: 0, alignSelf: 'start', overflowX: { xs: 'auto', md: 'visible' },
      p: 0.8, borderRadius: 3, border: '1px solid var(--border, rgba(255,255,255,0.08))', bgcolor: 'var(--surface, rgba(255,255,255,0.02))',
    }}>
      {sections.map(s => {
        const on = active === s.key
        return (
          <Box key={s.key} role="button" tabIndex={0} aria-pressed={on} onClick={() => onChange(s.key)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(s.key) } }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.2, px: 1.2, py: 1.1, borderRadius: 2.2, cursor: 'pointer',
              flex: { xs: '1 0 auto', md: 'none' }, position: 'relative',
              bgcolor: on ? 'rgba(var(--accent-rgb,59,130,246),0.13)' : 'transparent',
              border: '1px solid', borderColor: on ? 'rgba(var(--accent-rgb,59,130,246),0.4)' : 'transparent',
              transition: 'background-color 0.15s, border-color 0.15s',
              '&:hover': on ? {} : { bgcolor: 'var(--item-hover, rgba(255,255,255,0.05))' },
              '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
            }}>
            <Box sx={{
              width: 34, height: 34, borderRadius: '10px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: on ? 'rgba(var(--accent-rgb,59,130,246),0.2)' : 'var(--item-hover, rgba(255,255,255,0.05))',
              color: on ? 'var(--accent,#3b82f6)' : 'var(--text-muted)', '& svg': { fontSize: 18 },
            }}>
              {s.icon}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: on ? 'var(--text)' : 'var(--text)', lineHeight: 1.25 }}>{s.label}</Typography>
              <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{s.desc}</Typography>
            </Box>
            {s.badge}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Cuenta ───────────────────────────────────────────────────────────────────

function AccountTab({ user, myInst, onGo }) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const [code,     setCode]     = useState(null)  // null=no cargado, ''=no tiene, 'XXXX'=código
  const [revealed, setRevealed] = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [loading,  setLoading]  = useState(false)

  async function loadCode() {
    setLoading(true)
    try {
      const token = localStorage.getItem('user_token')
      const r = await fetch('/api/auth/recovery-code', { headers: { 'x-user-token': token } })
      const d = await r.json()
      setCode(d.recovery_code || '')
      setRevealed(true)
    } catch { setCode('') }
    finally { setLoading(false) }
  }

  function copyCode() {
    if (!code) return
    navigator.clipboard.writeText(code)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const masked = '•'.repeat(12)
  const conn = myInst.filter(i => isConnectedStatus(i.live_status)).length
  const rows = [
    { icon: <PersonOutlineIcon />, label: en ? 'Name' : 'Nombre', value: user?.display_name || '—' },
    { icon: <AlternateEmailIcon />, label: en ? 'Username' : 'Usuario', value: user?.username ? `@${user.username}` : '—', mono: true },
    { icon: <MailOutlineIcon />, label: en ? 'Email' : 'Correo', value: user?.email || '—' },
    { icon: <AdminPanelSettingsOutlinedIcon />, label: en ? 'Role' : 'Rol',
      value: user?.role === 'admin' ? t.settings.adminRole : t.settings.agentRole },
  ]

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0,1fr))' }, gap: 2 }}>
      <Card>
        <CardHeader icon={<AccountCircleIcon />} title={en ? 'Profile' : 'Perfil'}
          subtitle={en ? 'How you appear in the team' : 'Cómo apareces en el equipo'} />
        <Box sx={{ p: 1.2 }}>
          {rows.map(r => (
            <Box key={r.label} sx={{
              display: 'flex', alignItems: 'center', gap: 1.4, px: 1, py: 1.1, borderRadius: 2,
              '&:not(:last-of-type)': { borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))' },
            }}>
              <Box sx={{ color: 'var(--text-muted)', display: 'flex', '& svg': { fontSize: 18 } }}>{r.icon}</Box>
              <Typography sx={{ width: 84, flexShrink: 0, fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>{r.label}</Typography>
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.84rem', color: 'var(--text)', fontWeight: 600,
                fontFamily: r.mono ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Card>

      <Card>
        <CardHeader icon={<ShieldOutlinedIcon />} rgb="250,204,21" color="#facc15" title={t.settings.recoveryCode}
          subtitle={en ? 'Your way back in if you forget your PIN' : 'Tu forma de volver a entrar si olvidas tu PIN'} />
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, flex: 1 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, p: 1, pl: 1.8, borderRadius: 2.5,
            bgcolor: 'rgba(0,0,0,0.22)', border: '1px solid rgba(250,204,21,0.25)',
          }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: '1.15rem', fontWeight: 700, letterSpacing: '0.22em',
              color: revealed && code ? '#facc15' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {revealed ? (code || t.settings.notAvailable) : masked}
            </Typography>
            <Tooltip title={revealed ? t.settings.hide : t.settings.viewCode}>
              <IconButton size="small" onClick={revealed ? () => setRevealed(false) : loadCode}
                sx={{ color: '#facc15', bgcolor: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', '&:hover': { bgcolor: 'rgba(250,204,21,0.2)' } }}>
                {loading ? <CircularProgress size={16} sx={{ color: '#facc15' }} /> : revealed ? <VisibilityOffIcon sx={{ fontSize: 17 }} /> : <VisibilityIcon sx={{ fontSize: 17 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title={copied ? t.settings.copied : t.settings.copy}>
              <span>
                <IconButton size="small" onClick={copyCode} disabled={!(revealed && code)}
                  sx={{ color: copied ? '#4ade80' : 'var(--text-muted)', border: '1px solid var(--border, rgba(255,255,255,0.1))',
                    '&:hover': { bgcolor: 'var(--item-hover)' } }}>
                  {copied ? <CheckIcon sx={{ fontSize: 17 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, p: 1.2, borderRadius: 2, bgcolor: 'rgba(250,204,21,0.06)', border: '1px dashed rgba(250,204,21,0.25)' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: '#facc15', mt: 0.1 }} />
            <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {en ? 'Keep it somewhere safe and private. Anyone with this code can reset your access.'
                  : 'Guárdalo en un lugar seguro y privado. Con este código se puede restablecer tu acceso.'}
            </Typography>
          </Box>
        </Box>
      </Card>

      {/* Atajo a WhatsApp: el resumen aquí, el detalle en su sección. */}
      <Box onClick={() => onGo('whatsapp')} sx={{
        gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderRadius: 3, cursor: 'pointer',
        border: '1px solid rgba(37,211,102,0.22)',
        background: 'linear-gradient(120deg, rgba(37,211,102,0.1) 0%, transparent 60%), var(--card-bg)',
        transition: 'border-color 0.2s', '&:hover': { borderColor: 'rgba(37,211,102,0.5)' },
      }}>
        <IconBox rgb="37,211,102" color="#4ade80" size={34}><PhoneAndroidIcon /></IconBox>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
            {myInst.length
              ? (en ? `${myInst.length} WhatsApp number${myInst.length === 1 ? '' : 's'} assigned` : `${myInst.length} ${myInst.length === 1 ? 'número asignado' : 'números asignados'} de WhatsApp`)
              : (en ? 'No WhatsApp numbers assigned yet' : 'Aún no tienes números de WhatsApp asignados')}
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {myInst.length ? (en ? `${conn} connected right now` : `${conn} ${conn === 1 ? 'conectado' : 'conectados'} ahora mismo`) : (en ? 'Ask an admin to assign you one' : 'Pide a un administrador que te asigne uno')}
          </Typography>
        </Box>
        <ChevronRightIcon sx={{ color: 'var(--text-muted)' }} />
      </Box>
    </Box>
  )
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

function WhatsAppTab({ myInst, checking, failed, onReconnect, onRefresh }) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const total = myInst.length
  const conn = myInst.filter(i => isConnectedStatus(i.live_status)).length
  const down = myInst.filter(i => !isConnectedStatus(i.live_status))
  const ring = total ? Math.round((conn / total) * 100) : 0
  const color = failed ? '#f87171' : total === 0 ? '#94a3b8' : conn === total ? '#22c55e' : conn > 0 ? '#f59e0b' : '#f87171'
  const headline = failed
    ? (en ? 'Could not load your numbers' : 'No se pudieron cargar tus números')
    : total === 0
      ? (en ? 'No numbers assigned' : 'Sin números asignados')
      : en ? `${conn} of ${total} connected` : `${conn} de ${total} ${total === 1 ? 'conectado' : 'conectados'}`
  const detail = failed
    ? (en ? 'Check your connection and try again.' : 'Revisa tu conexión e inténtalo de nuevo.')
    : total === 0
      ? (en ? 'An admin assigns WhatsApp numbers from Instances. Once you have one, you can reconnect it here.' : 'Un administrador asigna los números desde Instancias. En cuanto tengas uno, aquí mismo puedes reconectarlo.')
      : conn >= 2
        ? (en ? 'Rotation active: sends are spread across your connected numbers.' : 'Rotación activa: los envíos se reparten entre tus números conectados.')
        : conn === 1
          ? (down.length ? (en ? 'Your sends go out through one number. Reconnect the others to spread them.' : 'Tus envíos salen por un solo número. Reconecta los demás para repartirlos.')
                         : (en ? 'All your sends go out through this one number.' : 'Todos tus envíos salen por este único número.'))
          : (en ? 'None of your numbers is connected, so nothing can be sent. Reconnect one with a QR or pairing code.' : 'Ninguno de tus números está conectado, así que no se puede enviar. Reconecta uno con QR o código de vinculación.')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card sx={{
        flexDirection: 'row', alignItems: 'center', gap: 2, p: 2.2, flexWrap: 'wrap',
        background: `linear-gradient(120deg, ${color}1c 0%, transparent 60%), var(--card-bg)`,
        borderColor: `${color}40`,
      }}>
        <Box sx={{ width: 68, height: 68, borderRadius: '50%', p: '4px', flexShrink: 0,
          background: `conic-gradient(${color} ${ring}%, var(--border, rgba(255,255,255,0.12)) ${ring}% 100%)` }}>
          <Box sx={{ width: '100%', height: '100%', borderRadius: '50%', bgcolor: 'var(--card-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {checking ? <CircularProgress size={22} sx={{ color }} /> : <PhoneAndroidIcon sx={{ fontSize: 28, color }} />}
          </Box>
        </Box>
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.25 }}>
            {checking ? t.settings.verifying : headline}
          </Typography>
          <Typography sx={{ fontSize: '0.76rem', color: 'var(--text-muted)', mt: 0.4, lineHeight: 1.5 }}>{detail}</Typography>
        </Box>
        {failed ? (
          <Button onClick={onRefresh} startIcon={<RefreshIcon />} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2.2, color: 'var(--text)', border: '1px solid var(--border)' }}>
            {en ? 'Try again' : 'Reintentar'}
          </Button>
        ) : down.length === 1 && (
          <Button onClick={() => onReconnect(down[0])} startIcon={<QrCode2Icon />} variant="contained" disableElevation sx={{
            textTransform: 'none', fontWeight: 700, borderRadius: 2.2, px: 2, py: 0.9, flexShrink: 0,
            // !important: el tema global pinta los botones contained con el acento.
            bgcolor: '#22c55e !important', color: '#052e12 !important', '&:hover': { bgcolor: '#16a34a !important' },
          }}>
            {en ? 'Reconnect' : 'Reconectar'}
          </Button>
        )}
      </Card>

      {total > 0 && (
        <Box>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-muted)', mb: 1 }}>
            {en ? 'Your numbers' : 'Tus números'}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 1.5 }}>
            {myInst.map(inst => {
              const st = instanceState(inst, lang)
              return (
                <Card key={inst.name} sx={{ p: 1.6, gap: 1.2, transition: 'border-color 0.2s', '&:hover': { borderColor: `${st.color}66` } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                    <Box sx={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: `${st.color}1a`, border: `1.5px solid ${st.color}66` }}>
                      <PhoneAndroidIcon sx={{ fontSize: 18, color: st.color }} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fmtPhone(inst.number) || (en ? 'No number' : 'Sin número')}
                      </Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ pt: 1.1, borderTop: '1px dashed var(--border, rgba(255,255,255,0.1))', display: 'flex', alignItems: 'center', gap: 1, minHeight: 30 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}><StatusPill color={st.color} label={st.label} glow={st.glow} /></Box>
                    {!isConnectedStatus(inst.live_status) && (
                      <Button size="small" onClick={() => onReconnect(inst)} startIcon={<QrCode2Icon sx={{ fontSize: '15px !important' }} />} sx={{
                        textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', borderRadius: 2, px: 1.2, py: 0.3, flexShrink: 0,
                        color: '#4ade80', border: '1px solid rgba(34,197,94,0.4)', bgcolor: 'rgba(34,197,94,0.08)',
                        '&:hover': { bgcolor: 'rgba(34,197,94,0.16)' },
                      }}>
                        {en ? 'Reconnect' : 'Reconectar'}
                      </Button>
                    )}
                  </Box>
                </Card>
              )
            })}
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── Envíos ───────────────────────────────────────────────────────────────────

// Mismos umbrales que RiskBadge (SendConfigPanel.jsx).
function paceRisk(cfg) {
  const minDelay = cfg.msgDelay[0], maxBatch = cfg.batchSize[1], minBreak = cfg.batchDelay[0]
  if (minDelay < 15 || maxBatch > 15 || minBreak < 2) return 'high'
  if (minDelay < 25 || maxBatch > 10 || minBreak < 4) return 'medium'
  return 'low'
}
const RISK_META = {
  low:    { color: '#22c55e', es: 'seguro',       en: 'safe' },
  medium: { color: '#f59e0b', es: 'riesgo medio', en: 'medium risk' },
  high:   { color: '#ef4444', es: 'riesgo alto',  en: 'high risk' },
}

// Los tres caen en la banda "segura" de RiskBadge — elegir uno nunca sube el riesgo.
const PACE_PRESETS = [
  { key: 'careful',  icon: <SpaIcon />,   rgb: '45,212,191', color: '#2dd4bf', es: 'Cuidadoso',   en: 'Careful',
    descEs: 'Líneas nuevas o recién reconectadas', descEn: 'New or freshly reconnected lines',
    cfg: { msgDelay: [45, 90], batchSize: [2, 5], batchDelay: [10, 20] } },
  { key: 'balanced', icon: <BalanceIcon />, rgb: 'var(--accent-rgb,59,130,246)', color: 'var(--accent,#3b82f6)', es: 'Equilibrado', en: 'Balanced',
    descEs: 'El recomendado para el día a día', descEn: 'Recommended for everyday use',
    cfg: { ...DEFAULT_SEND_CONFIG } },
  { key: 'fast',     icon: <BoltIcon />,  rgb: '245,158,11', color: '#f59e0b', es: 'Ágil',        en: 'Fast',
    descEs: 'Líneas maduras con buen historial', descEn: 'Mature lines with a good track record',
    cfg: { msgDelay: [25, 40], batchSize: [5, 10], batchDelay: [4, 8] } },
]
const sameRange = (a, b) => a[0] === b[0] && a[1] === b[1]
const sameCfg = (a, b) => ['msgDelay', 'batchSize', 'batchDelay'].every(k => sameRange(a[k], b[k]))

// Estimación aproximada: un lote = (n-1) pausas entre mensajes + la pausa larga.
function paceEstimate(cfg) {
  const avg = ([a, b]) => (a + b) / 2
  const batch = avg(cfg.batchSize), gap = avg(cfg.msgDelay), brk = avg(cfg.batchDelay) * 60
  const cycle = Math.max(1, (batch - 1) * gap + brk)
  const perHour = (batch / cycle) * 3600
  return { perHour, minutesFor100: (100 / perHour) * 60 }
}
function fmtMinutes(min) {
  const total = Math.round(min)
  const h = Math.floor(total / 60), m = total % 60
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}

const SETTINGS_SLIDER_SX = {
  color: 'var(--accent, #3b82f6)',
  height: 6,
  // Ancho menos el margen: con padding lateral el slider (width 100%) se salía
  // de su tarjeta y cortaba las etiquetas de los extremos.
  width: 'calc(100% - 24px)', mx: '12px', boxSizing: 'border-box',
  py: 1.5,
  '& .MuiSlider-thumb': {
    width: 18, height: 18, bgcolor: '#fff', border: '3px solid var(--accent, #3b82f6)',
    boxShadow: '0 0 0 4px rgba(var(--accent-rgb,59,130,246),0.16)',
    '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 7px rgba(var(--accent-rgb,59,130,246),0.22)' },
  },
  '& .MuiSlider-track': { border: 'none', height: 6, background: 'linear-gradient(90deg, rgba(var(--accent-rgb,59,130,246),0.7), var(--accent,#3b82f6))' },
  '& .MuiSlider-rail': { opacity: 1, height: 6, bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))' },
  '& .MuiSlider-mark': { width: 3, height: 3, borderRadius: '50%', bgcolor: 'var(--border)', transform: 'translate(-50%,-50%)' },
  '& .MuiSlider-markActive': { bgcolor: '#fff', opacity: 0.7 },
  '& .MuiSlider-markLabel': { fontSize: '0.62rem', color: 'var(--text-muted)', pointerEvents: 'none', mt: 0.4 },
  '& .MuiSlider-markLabelActive': { color: 'var(--text-muted)', opacity: 0.85 },
  '& .MuiSlider-valueLabel': { fontSize: '0.65rem', fontWeight: 700, py: 0.3, px: 0.8, bgcolor: 'var(--accent, #3b82f6)', borderRadius: 1 },
}

function TimingSliderRow({ icon, label, tooltip, value, onChange, min, max, step, unit, minDist = 1, marks = true }) {
  function handleChange(_, newVal, activeThumb) {
    let v = [...newVal]
    if (v[1] - v[0] < minDist) {
      if (activeThumb === 0) { const c = Math.min(v[0], value[1] - minDist); v = [c, c + minDist] }
      else { const c = Math.max(v[1], value[0] + minDist); v = [c - minDist, c] }
    }
    onChange(v)
  }
  return (
    <Box sx={{ p: 1.6, pb: 0.8, borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.07))', bgcolor: 'rgba(255,255,255,0.015)' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 0.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ color: 'var(--accent,#60a5fa)', display: 'flex', '& svg': { fontSize: 17 } }}>{icon}</Box>
          <Typography sx={{ fontSize: '0.8rem', color: 'var(--text)', fontWeight: 700 }}>{label}</Typography>
          {tooltip && (
            <Tooltip title={tooltip} placement="top" arrow>
              <InfoOutlinedIcon sx={{ fontSize: 14, color: 'var(--text-muted)', cursor: 'help', '&:hover': { color: 'var(--accent,#3b82f6)' } }} />
            </Tooltip>
          )}
        </Box>
        <Box sx={{ px: 1.1, py: 0.25, borderRadius: 99, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.14)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)' }}>
          <Typography sx={{ fontSize: '0.74rem', color: 'var(--text)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {value[0]}–{value[1]} {unit}
          </Typography>
        </Box>
      </Box>
      <Slider value={value} onChange={handleChange}
        min={min} max={max} step={step} marks={marks} disableSwap
        valueLabelDisplay="auto" valueLabelFormat={v => `${v}${unit}`}
        sx={SETTINGS_SLIDER_SX} />
    </Box>
  )
}

function SendTimingSection({ settingsOpen, onSaved }) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const sc = t.sendConfig
  const [cfg, setCfg] = useState(() => loadSendConfig())
  const [savedCfg, setSavedCfg] = useState(() => loadSendConfig())
  const [tplOpen, setTplOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const wasOpenRef = useRef(settingsOpen)

  // Descartar cambios sin guardar al salir de la pantalla de Configuración —
  // el tab sigue montado (el panel solo se oculta con display:none en page.jsx),
  // así que sin esto el borrador quedaría "flotando" en memoria y reaparecería
  // tal cual al volver a abrir Configuración.
  useEffect(() => {
    if (wasOpenRef.current && !settingsOpen) {
      setCfg(loadSendConfig())
    }
    wasOpenRef.current = settingsOpen
  }, [settingsOpen])

  function update(key, val) {
    setCfg(prev => ({ ...prev, [key]: val }))
  }

  const dirty = !sameCfg(cfg, savedCfg)

  function handleSave() {
    if (!dirty) return
    saveSendConfig(cfg)
    setSavedCfg(cfg)
    onSaved?.(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const est = paceEstimate(cfg)
  const activePreset = PACE_PRESETS.find(p => sameCfg(cfg, p.cfg))?.key

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.55fr) minmax(280px,1fr)' }, gap: 2, alignItems: 'start' }}>
      <Card>
        <CardHeader icon={<SpeedIcon />} title={en ? 'Sending pace' : 'Ritmo de envío'}
          subtitle={en ? 'Start from a preset and fine-tune if you need to' : 'Parte de un ritmo predefinido y ajústalo si lo necesitas'} />
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0,1fr))' }, gap: 1.2 }}>
            {PACE_PRESETS.map(p => {
              const on = activePreset === p.key
              return (
                <Box key={p.key} role="button" tabIndex={0} aria-pressed={on} onClick={() => setCfg({ ...cfg, ...p.cfg })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCfg({ ...cfg, ...p.cfg }) } }}
                  sx={{
                    p: 1.4, borderRadius: 2.5, cursor: 'pointer', position: 'relative',
                    border: '1.5px solid', borderColor: on ? p.color : 'var(--border, rgba(255,255,255,0.08))',
                    background: on ? `linear-gradient(135deg, rgba(${p.rgb},0.18) 0%, rgba(${p.rgb},0.04) 100%)` : 'rgba(255,255,255,0.015)',
                    transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
                    '&:hover': { borderColor: p.color, transform: 'translateY(-1px)' },
                    '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
                  }}>
                  {on && <CheckCircleIcon sx={{ position: 'absolute', top: 10, right: 10, fontSize: 16, color: p.color }} />}
                  <IconBox rgb={p.rgb} color={p.color} size={30}>{p.icon}</IconBox>
                  <Typography sx={{ mt: 1, fontSize: '0.84rem', fontWeight: 800, color: 'var(--text)' }}>{en ? p.en : p.es}</Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{en ? p.descEn : p.descEs}</Typography>
                </Box>
              )
            })}
          </Box>
          <TimingSliderRow icon={<TimerIcon />} label={sc.msgDelay} tooltip={sc.tipMsgDelay} value={cfg.msgDelay} onChange={v => update('msgDelay', v)} min={5} max={300} step={5} unit={sc.seconds} minDist={5}
            marks={[5, 30, 60, 120, 180, 240, 300].map(v => ({ value: v, label: v >= 60 ? `${v / 60}m` : `${v}s` }))} />
          <TimingSliderRow icon={<LayersOutlinedIcon />} label={sc.batchSize} tooltip={sc.tipBatchSize} value={cfg.batchSize} onChange={v => update('batchSize', v)} min={1} max={20} step={1} unit={sc.msgs} minDist={1}
            marks={[1, 5, 10, 15, 20].map(v => ({ value: v, label: String(v) }))} />
          <TimingSliderRow icon={<CoffeeOutlinedIcon />} label={sc.batchDelay} tooltip={sc.tipBatchDelay} value={cfg.batchDelay} onChange={v => update('batchDelay', v)} min={1} max={30} step={1} unit={sc.minutes} minDist={1}
            marks={[1, 5, 10, 15, 20, 30].map(v => ({ value: v, label: `${v}m` }))} />
        </Box>
      </Card>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, position: { lg: 'sticky' }, top: { lg: 0 } }}>
        <Card>
          <CardHeader icon={<InsightsOutlinedIcon />} title={en ? 'What this pace means' : 'Qué significa este ritmo'}
            subtitle={en ? 'Approximate, per line, before daily limits' : 'Aproximado, por línea, sin contar límites diarios'} />
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.2 }}>
              {[
                { label: en ? 'Messages per hour' : 'Mensajes por hora', value: `≈ ${Math.round(est.perHour)}` },
                { label: en ? '100 messages take' : '100 mensajes tardan', value: `≈ ${fmtMinutes(est.minutesFor100)}` },
              ].map(s => (
                <Box key={s.label} sx={{ p: 1.3, borderRadius: 2.2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.07)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.18)' }}>
                  <Typography sx={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</Typography>
                  <Typography sx={{ fontSize: '1.2rem', color: 'var(--text)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>{s.value}</Typography>
                </Box>
              ))}
            </Box>
            <RiskBadge config={cfg} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pt: 0.5 }}>
              {dirty && !saved && (
                <Typography sx={{ flex: 1, fontSize: '0.7rem', color: '#fbbf24', fontWeight: 600 }}>
                  ● {en ? 'Unsaved changes' : 'Cambios sin guardar'}
                </Typography>
              )}
              {!dirty && !saved && <Box sx={{ flex: 1 }} />}
              {saved && (
                <Typography sx={{ flex: 1, fontSize: '0.7rem', color: '#4ade80', fontWeight: 600 }}>✓ {sc.savedBtn}</Typography>
              )}
              {dirty && (
                <Button size="small" onClick={() => setCfg(savedCfg)} sx={{ textTransform: 'none', color: 'var(--text-muted)', fontSize: '0.74rem', borderRadius: 2 }}>
                  {en ? 'Discard' : 'Descartar'}
                </Button>
              )}
              <Button onClick={handleSave} disabled={!dirty} variant="contained" disableElevation
                startIcon={saved ? <CheckIcon /> : <SaveIcon />}
                sx={{
                  textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', borderRadius: 2, px: 1.8,
                  bgcolor: saved ? '#22c55e' : 'var(--accent, #3b82f6)',
                  '&:hover': { bgcolor: 'color-mix(in srgb, var(--accent, #3b82f6) 82%, black)' },
                  '&.Mui-disabled': { bgcolor: saved ? '#22c55e' : 'var(--item-hover, rgba(255,255,255,0.06))', color: saved ? '#052e12' : 'var(--text-muted)' },
                }}>
                {sc.saveBtn}
              </Button>
            </Box>
          </Box>
        </Card>

        {/* Plantillas — fila completa clicable */}
        <Card sx={{ cursor: 'pointer', transition: 'border-color 0.2s', '&:hover': { borderColor: 'rgba(168,85,247,0.5)' } }}>
          <Box onClick={() => setTplOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 2, py: 1.6,
            background: 'linear-gradient(120deg, rgba(168,85,247,0.1) 0%, transparent 65%)' }}>
            <IconBox rgb="168,85,247" color="#c084fc" size={34}><DescriptionIcon /></IconBox>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.86rem' }}>{t.tplLib.title}</Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{t.tplLib.manageBtn}</Typography>
            </Box>
            <ChevronRightIcon sx={{ fontSize: 20, color: 'var(--text-muted)' }} />
          </Box>
        </Card>
      </Box>
      <TemplateManagerDialog open={tplOpen} onClose={() => setTplOpen(false)} />
    </Box>
  )
}

// ── Reconectar un número (wwebjs) ───────────────────────────────────────────
// Mismo flujo que "Reconectar" en Instancias (startQrPoll/startConnPoll de
// InstancesPanel.jsx): status → start si no existe → QR o código de vinculación
// → esperar a que la sesión quede "connected". Al cerrar sin vincular se
// detiene el navegador (DELETE /wwebjs/session/{id}, que NO borra el número).

const wait = ms => new Promise(r => setTimeout(r, ms))
const LINK_MAX_WAIT_MS = 90 * 1000   // arranque en frío de Chrome
const LINK_MAX_SHOWN_MS = 5 * 60 * 1000

function WwebjsLinkDialog({ inst, onClose, onLinked }) {
  const { lang } = useLang()
  const en = lang === 'en'
  const [method, setMethod] = useState('qr')
  const [phase, setPhase] = useState('loading') // loading | ready | connecting | linked | error
  const [qr, setQr] = useState(null)
  const [code, setCode] = useState(null)
  const [copied, setCopied] = useState(false)
  const runRef = useRef(0)
  const phaseRef = useRef('loading')
  useEffect(() => { phaseRef.current = phase }, [phase])
  const digits = String(inst?.number || '').replace(/\D/g, '')
  const name = inst?.name

  const begin = useCallback(async (m, restart) => {
    if (!name) return
    const run = ++runRef.current
    const alive = () => runRef.current === run
    setPhase('loading'); setQr(null); setCode(null)
    try {
      if (restart) {
        // Código: hay que recrear el cliente con el número (pairWithPhoneNumber).
        await authFetch(`/api/wwebjs/session/${name}/start`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m === 'code' ? { phone_number: digits } : {}),
        }).catch(() => {})
        await wait(700)
      } else {
        const st = await authFetch(`/api/wwebjs/session/${name}/status`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
        if (st.status === 'connected') { if (alive()) { setPhase('linked'); onLinked?.() } return }
        if (st.status === 'not_found') await authFetch(`/api/wwebjs/session/${name}/start`, { method: 'POST' }).catch(() => {})
      }
    } catch { /* el sondeo de abajo decide */ }

    const startedAt = Date.now()
    let shownAt = null
    while (alive()) {
      const url = m === 'code' ? `/api/wwebjs/session/${name}/pairing-code` : `/api/wwebjs/session/${name}/qr`
      const d = await authFetch(url).then(r => r.json()).catch(() => ({}))
      if (!alive()) return
      if (d?.status === 'connected') { setPhase('connecting'); return }
      const got = m === 'code' ? d?.code : d?.qr
      if (got) {
        m === 'code' ? setCode(got) : setQr(got)
        setPhase('ready')
        if (shownAt == null) shownAt = Date.now()
        if (Date.now() - shownAt > LINK_MAX_SHOWN_MS) { setPhase('error'); return }
        await wait(1500) // el QR rota cada ~20 s
      } else {
        if (shownAt == null && Date.now() - startedAt > LINK_MAX_WAIT_MS) { setPhase('error'); return }
        await wait(500)
      }
    }
  }, [name, digits, onLinked])

  // Al abrir: arrancar con QR. Al cerrar: cortar cualquier sondeo en curso.
  useEffect(() => {
    if (!name) return
    setMethod('qr'); setCopied(false)
    begin('qr', false)
    return () => { runRef.current++ }
  }, [name, begin])

  // ¿Ya quedó conectada? Igual que startConnPoll: cada 2 s, solo después de
  // haber mostrado un QR/código (o de que el escaneo ya se haya detectado).
  useEffect(() => {
    if (!name) return
    const id = setInterval(async () => {
      if (!['ready', 'connecting'].includes(phaseRef.current)) return
      const st = await authFetch(`/api/wwebjs/session/${name}/status`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
      if (st.status === 'connected') {
        runRef.current++
        setPhase('linked')
        onLinked?.()
      }
    }, 2000)
    return () => clearInterval(id)
  }, [name, onLinked])

  function close() {
    runRef.current++
    if (name && !['connecting', 'linked'].includes(phaseRef.current)) {
      authFetch(`/api/wwebjs/session/${name}`, { method: 'DELETE' }).catch(() => {})
    }
    onClose()
  }

  function switchMethod(m) {
    if (m === method) return
    setMethod(m)
    begin(m, true)
  }

  const steps = method === 'qr'
    ? (en ? ['Open WhatsApp on the phone', 'Go to Linked devices', 'Tap "Link a device"', 'Scan this code'] : ['Abre WhatsApp en el teléfono', 'Entra a Dispositivos vinculados', 'Toca "Vincular un dispositivo"', 'Escanea este código'])
    : (en ? ['Open WhatsApp on the phone', 'Go to Linked devices → Link a device', 'Tap "Link with phone number instead"', 'Type this code'] : ['Abre WhatsApp en el teléfono', 'Dispositivos vinculados → Vincular un dispositivo', 'Toca "Vincular con el número de teléfono"', 'Escribe este código'])

  return (
    <Dialog open={!!inst} onClose={close} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#161d2e) !important', backgroundImage: 'none !important', border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.7)' } } }}>
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 2.2, py: 1.8,
          background: 'linear-gradient(135deg, rgba(37,211,102,0.14) 0%, transparent 70%)', borderBottom: '1px solid var(--border)' }}>
          <IconBox rgb="37,211,102" color="#4ade80" size={34}><PhoneAndroidIcon /></IconBox>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text)' }}>{en ? 'Reconnect number' : 'Reconectar número'}</Typography>
            <Typography sx={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{fmtPhone(inst?.number) || inst?.name} · {inst?.name}</Typography>
          </Box>
          <IconButton size="small" onClick={close} aria-label={en ? 'Close' : 'Cerrar'} sx={{ color: 'var(--text-muted)' }}><CloseIcon sx={{ fontSize: 18 }} /></IconButton>
        </Box>

        {phase === 'linked' ? (
          <Box sx={{ py: 5, px: 3, textAlign: 'center' }}>
            <Box sx={{ width: 68, height: 68, mx: 'auto', mb: 2, borderRadius: '50%', bgcolor: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckIcon sx={{ fontSize: 34, color: '#22c55e' }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text)' }}>{en ? 'Number connected' : 'Número conectado'}</Typography>
            <Typography sx={{ fontSize: '0.8rem', color: 'var(--text-muted)', mt: 0.5 }}>{en ? 'Sends can go out through this line again.' : 'Los envíos ya pueden volver a salir por esta línea.'}</Typography>
            <Button onClick={onClose} variant="contained" disableElevation sx={{ mt: 2.5, textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: '#22c55e !important', color: '#052e12 !important' }}>
              {en ? 'Done' : 'Listo'}
            </Button>
          </Box>
        ) : (
          <Box sx={{ p: 2.2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, borderRadius: 2.5, bgcolor: 'var(--surface, rgba(255,255,255,0.03))', border: '1px solid var(--border)' }}>
              {[
                { key: 'qr', icon: <QrCode2Icon />, label: en ? 'QR code' : 'Código QR' },
                { key: 'code', icon: <PinOutlinedIcon />, label: en ? 'Pairing code' : 'Código de vinculación', disabled: !digits },
              ].map(o => (
                <Tooltip key={o.key} title={o.disabled ? (en ? 'This number has no phone saved' : 'Este número no tiene teléfono guardado') : ''}>
                  <Box role="button" aria-pressed={method === o.key} onClick={() => !o.disabled && switchMethod(o.key)} sx={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8, py: 0.9, borderRadius: 2,
                    cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.45 : 1,
                    bgcolor: method === o.key ? 'rgba(37,211,102,0.14)' : 'transparent',
                    border: '1px solid', borderColor: method === o.key ? 'rgba(37,211,102,0.4)' : 'transparent',
                    color: method === o.key ? '#4ade80' : 'var(--text-muted)', '& svg': { fontSize: 17 },
                  }}>
                    {o.icon}<Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>{o.label}</Typography>
                  </Box>
                </Tooltip>
              ))}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '240px minmax(0,1fr)' }, gap: 2.2, alignItems: 'center' }}>
              <Box sx={{ width: 240, height: 240, mx: 'auto', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: phase === 'ready' && method === 'qr' ? '#fff' : 'var(--surface, rgba(255,255,255,0.03))',
                border: '1px solid var(--border)', overflow: 'hidden', p: phase === 'ready' && method === 'qr' ? 1 : 0 }}>
                {phase === 'ready' && method === 'qr' && qr && <Box component="img" src={qr} alt="QR" sx={{ width: '100%', height: '100%', display: 'block' }} />}
                {phase === 'ready' && method === 'code' && code && (
                  <Box sx={{ textAlign: 'center', px: 1.5 }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: '1.7rem', fontWeight: 800, letterSpacing: '0.18em', color: '#4ade80' }}>
                      {code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
                    </Typography>
                    <Button size="small" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                      startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />} sx={{ mt: 1, textTransform: 'none', color: copied ? '#4ade80' : 'var(--text-muted)' }}>
                      {copied ? (en ? 'Copied' : 'Copiado') : (en ? 'Copy code' : 'Copiar código')}
                    </Button>
                  </Box>
                )}
                {(phase === 'loading' || phase === 'connecting') && (
                  <Box sx={{ textAlign: 'center' }}>
                    <CircularProgress size={34} sx={{ color: '#22c55e' }} />
                    <Typography sx={{ fontSize: '0.76rem', color: 'var(--text-muted)', mt: 1.5 }}>
                      {phase === 'connecting' ? (en ? 'Connecting…' : 'Conectando…') : (en ? 'Preparing WhatsApp…' : 'Preparando WhatsApp…')}
                    </Typography>
                  </Box>
                )}
                {phase === 'error' && (
                  <Box sx={{ textAlign: 'center', px: 2 }}>
                    <Typography sx={{ fontSize: '0.8rem', color: '#f87171', mb: 1.5 }}>
                      {en ? 'The code expired or the session did not respond.' : 'El código expiró o la sesión no respondió.'}
                    </Typography>
                    <Button size="small" onClick={() => begin(method, true)} startIcon={<RefreshIcon />}
                      sx={{ textTransform: 'none', fontWeight: 700, color: '#f87171', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 2 }}>
                      {en ? 'Try again' : 'Reintentar'}
                    </Button>
                  </Box>
                )}
              </Box>
              <Box>
                {steps.map((s, i) => (
                  <Box key={s} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.2, mb: 1.2 }}>
                    <Box sx={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.4)' }}>
                      <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: '#4ade80' }}>{i + 1}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.45, pt: 0.1 }}>{s}</Typography>
                  </Box>
                ))}
                <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted)', mt: 1.5, lineHeight: 1.5 }}>
                  {en ? 'This window closes by itself once the number is connected.' : 'Esta ventana se cierra sola en cuanto el número quede conectado.'}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Blacklist moved out to its own sidebar page — src/components/BlacklistPanel.jsx

export default function Settings({ settingsOpen }) {
  const { user }                = useUser()
  const { t, lang }              = useLang()
  const [activeTab,  setActiveTab]  = useState('account')
  // Números asignados a este usuario (wwebjs): una sola consulta que alimenta
  // el encabezado, la navegación, Cuenta y WhatsApp.
  const [myInst,     setMyInst]     = useState([])
  const [instState,  setInstState]  = useState('checking') // checking | ready | error
  const [instReload, setInstReload] = useState(0)
  const [linkInst,   setLinkInst]   = useState(null)
  // Ritmo ya guardado (no el borrador de los sliders), para el encabezado.
  const [savedCfg,   setSavedCfg]   = useState(DEFAULT_SEND_CONFIG)
  useEffect(() => { setSavedCfg(loadSendConfig()) }, [])

  // Tema/acento guardados en este navegador.
  useEffect(() => { applySettings(loadSettings()) }, [])

  // /wwebjs/instances/user-status resuelve al usuario por su token, así que
  // sirve igual para agentes (antes se leía /api/instances, que es solo de
  // admins, y se filtraba por user._id, que /auth/me nunca manda: siempre
  // salía "sin números" aunque el usuario sí tuviera).
  useEffect(() => {
    if (!user) return
    let alive = true
    authFetch('/api/wwebjs/instances/user-status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (alive) { setMyInst(d.instances || []); setInstState('ready') } })
      .catch(() => { if (alive) setInstState('error') })
    return () => { alive = false }
  }, [user, instReload])

  const onLinked = useCallback(() => setInstReload(n => n + 1), [])

  const en = lang === 'en'
  const myConn = myInst.filter(i => isConnectedStatus(i.live_status)).length
  const SECTIONS = [
    { key: 'account', icon: <AccountCircleIcon />, label: t.settings.tabAccount || 'Cuenta',
      desc: en ? 'Profile and recovery code' : 'Perfil y código de recuperación' },
    { key: 'whatsapp', icon: <PhoneAndroidIcon />, label: t.settings.tabWhatsApp || 'WhatsApp',
      desc: en ? 'Your numbers and their status' : 'Tus números y su estado',
      badge: myInst.length > 0 && (
        <Box sx={{ px: 0.8, borderRadius: 99, fontSize: '0.66rem', fontWeight: 800, lineHeight: '18px', flexShrink: 0,
          color: myConn ? '#4ade80' : '#f87171', bgcolor: myConn ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
          border: `1px solid ${myConn ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
          {myConn}/{myInst.length}
        </Box>
      ) },
    { key: 'sending', icon: <TimerIcon />, label: t.settings.tabSendTiming || 'Envíos',
      desc: en ? 'Pace, risk and templates' : 'Ritmo, riesgo y plantillas' },
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Box sx={{
        flex: 1, minHeight: 0, overflowY: 'auto', pr: { xs: 0.5, md: 2 }, pb: 3,
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        <SettingsHero user={user} lang={lang} myInst={myInst} savedCfg={savedCfg} onGo={setActiveTab} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: '240px minmax(0,1fr)' }, gap: 2, alignItems: 'start' }}>
          <SettingsNav sections={SECTIONS} active={activeTab} onChange={setActiveTab} />
          <Box sx={{ minWidth: 0 }}>
            {activeTab === 'account' && <AccountTab user={user} myInst={myInst} onGo={setActiveTab} />}
            {activeTab === 'whatsapp' && (
              <WhatsAppTab myInst={myInst} checking={instState === 'checking'} failed={instState === 'error'}
                onReconnect={setLinkInst} onRefresh={() => { setInstState('checking'); setInstReload(n => n + 1) }} />
            )}
            {activeTab === 'sending' && <SendTimingSection settingsOpen={settingsOpen} onSaved={setSavedCfg} />}
          </Box>
        </Box>
      </Box>

      <WwebjsLinkDialog inst={linkInst} onClose={() => { setLinkInst(null); setInstReload(n => n + 1) }} onLinked={onLinked} />
    </Box>
  )
}
