'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import CircularProgress from '@mui/material/CircularProgress'
import SettingsIcon from '@mui/icons-material/Settings'
import CheckIcon from '@mui/icons-material/Check'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import Slider from '@mui/material/Slider'
import TimerIcon from '@mui/icons-material/Timer'
import SaveIcon from '@mui/icons-material/Save'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import DescriptionIcon from '@mui/icons-material/Description'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'
import { loadSendConfig, saveSendConfig, DEFAULT_SEND_CONFIG } from '@/lib/sendConfig'
import { RiskBadge } from './SendConfigPanel'
import { TemplateManagerDialog } from './messageTemplateLibrary'

import { ACCENTS, THEMES } from '@/lib/themeConfig'
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

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',')
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
  root.style.setProperty('--accent',      accentObj.value)
  root.style.setProperty('--accent-rgb',  hexToRgb(accentObj.value))
  root.style.setProperty('--accent-glow', accentObj.glow)
  root.style.setProperty('--bg',          themeObj.bg)
  root.style.setProperty('--sidebar-bg',  themeObj.sidebar)
  root.style.setProperty('--surface',     themeObj.surface)
  root.style.setProperty('--card-bg',     themeObj.card)
  const isMono  = themeObj.cat === 'mono'
  const isVivid = themeObj.cat === 'light'
  root.style.setProperty('--text',
    isMono ? '#1a2234' : '#f1f5f9')
  root.style.setProperty('--text-muted',
    isMono  ? 'rgba(15,23,42,0.58)'    :
    isVivid ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.45)')
  root.style.setProperty('--border',
    isMono  ? 'rgba(0,0,0,0.16)'       :
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

function Section({ icon, title, children }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5,
        pl: 1.5, py: 0.5,
        borderLeft: '2px solid var(--accent, #3b82f6)',
        bgcolor: 'var(--surface, rgba(255,255,255,0.02))',
        borderRadius: '0 6px 6px 0',
      }}>
        <Box sx={{
          width: 26, height: 26, borderRadius: 1.5, flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.12)',
          border: '1px solid var(--accent, #3b82f6)',
          boxShadow: '0 0 8px var(--accent-glow, rgba(59,130,246,0.3))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent, #3b82f6)',
          '& svg': { fontSize: 15 },
        }}>
          {icon}
        </Box>
        <Typography sx={{
          color: 'var(--text, rgba(255,255,255,0.8))',
          fontWeight: 700,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          {title}
        </Typography>
      </Box>
      {children}
    </Box>
  )
}

const INPUT_SX = { '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.82rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' } }, '& input': { color: 'white' } }

function AccountSection({ user }) {
  const { t, lang } = useLang()
  const [code,      setCode]      = useState(null)  // null=no cargado, ''=no tiene, 'XXXX'=código
  const [revealed,  setRevealed]  = useState(false)
  const [copied,    setCopied]    = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [myInst,    setMyInst]    = useState([])

  useEffect(() => {
    const tok = localStorage.getItem('user_token')
    if (!tok) return
    fetch('/api/instances', { headers: { 'x-user-token': tok } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        const all = Array.isArray(d) ? d : (d.instances || [])
        const uid = user?._id || user?.id
        setMyInst(uid ? all.filter(i => i.assigned_to === uid) : [])
      })
      .catch(() => {})
  }, [user?._id])

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

  const masked = code ? code.slice(0,3) + '·'.repeat(6) + code.slice(-3) : '············'

  return (
    <Section icon={<AccountCircleIcon />} title={t.settings.account}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>

        {/* Perfil */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--accent,#60a5fa)', textTransform: 'uppercase' }}>{(user?.display_name || '?')[0]}</Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.88rem' }}>{user?.display_name}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
              {user?.email || `@${user?.username}`} · {user?.role === 'admin' ? t.settings.adminRole : t.settings.agentRole}
            </Typography>
          </Box>
        </Box>

        {/* WhatsApp instances */}
        {myInst.length > 0 && (() => {
          const connCount = myInst.filter(i => ['open','connected'].includes(i.live_status)).length
          const hasRotation = connCount >= 2
          return (
            <Box sx={{ p: 1.2, borderRadius: 2, bgcolor: 'rgba(37,211,102,0.04)', border: '1px solid rgba(37,211,102,0.12)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <PhoneAndroidIcon sx={{ fontSize: 13, color: '#4ade80' }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {lang === 'en' ? 'WhatsApp Instances' : 'Instancias WhatsApp'}
                  </Typography>
                </Box>
                {hasRotation && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 0.8, py: 0.2, borderRadius: 1,
                    bgcolor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                    <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: '#4ade80' }} />
                    <Typography sx={{ fontSize: '0.58rem', color: '#4ade80', fontWeight: 700 }}>
                      {lang === 'en' ? 'rotation active' : 'rotación activa'}
                    </Typography>
                  </Box>
                )}
              </Box>
              {myInst.map(inst => {
                const s = inst.live_status || 'unknown'
                const isConn = ['open','connected'].includes(s)
                const isConnecting = s === 'connecting'
                const dot = isConn ? '#22c55e' : isConnecting ? '#f59e0b' : '#64748b'
                const label = isConn
                  ? (lang === 'en' ? 'Connected' : 'Conectada')
                  : isConnecting
                    ? (lang === 'en' ? 'Connecting' : 'Conectando')
                    : (lang === 'en' ? 'Disconnected' : 'Desconectada')
                return (
                  <Box key={inst.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.35 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: dot, flexShrink: 0,
                      boxShadow: isConn ? `0 0 4px ${dot}88` : 'none' }} />
                    <Typography sx={{ fontSize: '0.77rem', fontWeight: 600, color: '#4ade80', fontFamily: 'monospace',
                      flex: '0 0 auto', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.name}
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inst.number ? `+${inst.number}` : (lang === 'en' ? 'No number' : 'Sin número')}
                    </Typography>
                    <Typography sx={{ fontSize: '0.64rem', fontWeight: 600, color: dot, flexShrink: 0 }}>
                      {label}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          )
        })()}

        {/* Código de recuperación */}
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(250,204,21,0.05)', border: '1px solid rgba(250,204,21,0.15)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography sx={{ color: '#facc15', fontSize: '0.72rem', fontWeight: 700 }}>🔑 {t.settings.recoveryCode}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem' }}>
              {t.settings.recoveryHint}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Código */}
            <Box sx={{ flex: 1, py: 0.8, px: 1.2, borderRadius: 1.5, bgcolor: 'rgba(0,0,0,0.25)', border: '1px solid rgba(250,204,21,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontFamily: 'monospace', fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.18em', color: revealed && code ? '#facc15' : 'rgba(255,255,255,0.25)' }}>
                {revealed ? (code || t.settings.notAvailable) : masked}
              </Typography>
            </Box>

            {/* Botón ver/ocultar */}
            <Tooltip title={revealed ? t.settings.hide : t.settings.viewCode}>
              <Box onClick={revealed ? () => setRevealed(false) : loadCode} sx={{
                p: 0.8, borderRadius: 1.5, cursor: 'pointer',
                bgcolor: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                '&:hover': { bgcolor: 'rgba(250,204,21,0.2)' },
              }}>
                {loading
                  ? <CircularProgress size={14} sx={{ color: '#facc15' }} />
                  : revealed
                  ? <VisibilityOffIcon sx={{ fontSize: 16, color: '#facc15' }} />
                  : <VisibilityIcon sx={{ fontSize: 16, color: '#facc15' }} />}
              </Box>
            </Tooltip>

            {/* Copiar */}
            {revealed && code && (
              <Tooltip title={copied ? t.settings.copied : t.settings.copy}>
                <Box onClick={copyCode} sx={{
                  p: 0.8, borderRadius: 1.5, cursor: 'pointer',
                  bgcolor: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
                }}>
                  <ContentCopyIcon sx={{ fontSize: 15, color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)', display: 'block' }} />
                </Box>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Box>
    </Section>
  )
}


const SETTINGS_SLIDER_SX = {
  color: 'var(--accent, #3b82f6)',
  height: 4,
  px: 1,
  py: 1.5,
  '& .MuiSlider-thumb': {
    width: 16, height: 16,
    boxShadow: '0 0 0 3px rgba(var(--accent-rgb,59,130,246),0.18)',
    '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 6px rgba(var(--accent-rgb,59,130,246),0.25)' },
  },
  '& .MuiSlider-track': { border: 'none', height: 4 },
  '& .MuiSlider-rail': { opacity: 0.35, height: 4, bgcolor: 'var(--border)' },
  '& .MuiSlider-mark': { width: 2, height: 2, borderRadius: '50%', bgcolor: 'var(--border)', transform: 'translate(-50%,-50%)' },
  '& .MuiSlider-markActive': { bgcolor: 'var(--accent, #3b82f6)', opacity: 0.6 },
  '& .MuiSlider-markLabel': { fontSize: '0.6rem', color: 'var(--text-muted)', pointerEvents: 'none', mt: 0.3 },
  '& .MuiSlider-markLabelActive': { color: 'var(--text-muted)', opacity: 0.85 },
  '& .MuiSlider-valueLabel': { fontSize: '0.65rem', fontWeight: 700, py: 0.3, px: 0.8, bgcolor: 'var(--accent, #3b82f6)', borderRadius: 1 },
}

function TimingSliderRow({ label, tooltip, value, onChange, min, max, step, unit, minDist = 1, marks = true }) {
  function handleChange(_, newVal, activeThumb) {
    let v = [...newVal]
    if (v[1] - v[0] < minDist) {
      if (activeThumb === 0) { const c = Math.min(v[0], value[1] - minDist); v = [c, c + minDist] }
      else { const c = Math.max(v[1], value[0] + minDist); v = [c - minDist, c] }
    }
    onChange(v)
  }
  return (
    <Box sx={{ mb: 3.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</Typography>
          {tooltip && (
            <Tooltip title={tooltip} placement="top" arrow>
              <InfoOutlinedIcon sx={{ fontSize: 13, color: 'var(--border)', cursor: 'help', '&:hover': { color: 'var(--accent,#3b82f6)' } }} />
            </Tooltip>
          )}
        </Box>
        <Box sx={{ px: 1, py: 0.15, borderRadius: 1, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)' }}>
          <Typography sx={{ fontSize: '0.68rem', color: 'var(--accent, #3b82f6)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
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

function SendTimingSection() {
  const { t } = useLang()
  const sc = t.sendConfig
  const [cfg, setCfg] = useState(() => loadSendConfig())
  const [tplOpen, setTplOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  function update(key, val) {
    const next = { ...cfg, [key]: val }
    setCfg(next)
    saveSendConfig(next)
  }

  function handleSave() {
    saveSendConfig(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <Section icon={<TimerIcon />} title={sc.title}>
      <TimingSliderRow label={sc.msgDelay}   tooltip={sc.tipMsgDelay}   value={cfg.msgDelay}   onChange={v => update('msgDelay', v)}   min={5}  max={300} step={5}  unit={sc.seconds} minDist={5}
        marks={[5,30,60,120,180,240,300].map(v => ({ value: v, label: v >= 60 ? `${v/60}m` : `${v}s` }))} />
      <TimingSliderRow label={sc.batchSize}  tooltip={sc.tipBatchSize}  value={cfg.batchSize}  onChange={v => update('batchSize', v)}  min={1}  max={20}  step={1}  unit={sc.msgs}    minDist={1}
        marks={[1,5,10,15,20].map(v => ({ value: v, label: String(v) }))} />
      <TimingSliderRow label={sc.batchDelay} tooltip={sc.tipBatchDelay} value={cfg.batchDelay} onChange={v => update('batchDelay', v)} min={1}  max={30}  step={1}  unit={sc.minutes} minDist={1}
        marks={[1,5,10,15,20,30].map(v => ({ value: v, label: `${v}m` }))} />
      <RiskBadge config={cfg} />

      {/* Save button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
        <Box
          onClick={handleSave}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.6, py: 0.6, borderRadius: 1.5, cursor: 'pointer',
            border: `1px solid ${saved ? 'rgba(34,197,94,0.5)' : 'rgba(59,130,246,0.4)'}`,
            bgcolor: saved ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
            transition: 'all 0.25s',
            '&:hover': { bgcolor: saved ? 'rgba(34,197,94,0.18)' : 'rgba(59,130,246,0.18)' },
          }}
        >
          {saved
            ? <CheckIcon sx={{ fontSize: 14, color: '#4ade80' }} />
            : <SaveIcon  sx={{ fontSize: 14, color: '#60a5fa' }} />}
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: saved ? '#4ade80' : '#60a5fa', transition: 'color 0.25s' }}>
            {saved ? sc.savedBtn : sc.saveBtn}
          </Typography>
        </Box>
      </Box>

      <Box onClick={() => setTplOpen(true)} sx={{
        mt: 2.5, display: 'flex', alignItems: 'center', gap: 1, py: 1, px: 1.2, borderRadius: 2, cursor: 'pointer',
        bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.06)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.18)',
        '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)' },
      }}>
        <DescriptionIcon sx={{ fontSize: 16, color: 'var(--accent,#60a5fa)' }} />
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent,#60a5fa)' }}>{t.tplLib.manageBtn}</Typography>
      </Box>
      <TemplateManagerDialog open={tplOpen} onClose={() => setTplOpen(false)} />
    </Section>
  )
}

// Blacklist moved out to its own sidebar page — src/components/BlacklistPanel.jsx

export default function Settings() {
  const { user }                = useUser()
  const { t, lang }              = useLang()
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [evo,  setEvo]          = useState(DEFAULT_EVO)
  const [activeTab,  setActiveTab]  = useState(0)

  useEffect(() => {
    const s = loadSettings()
    setSettings(s)
    applySettings(s)
    setEvo(loadEvoConfig())
  }, [])

  function save(patch) {
    let next = { ...settings, ...patch }
    // Auto-set DeTuCel accent when DeTuCel theme is picked
    if (patch.theme === 'detucel') next.accent = '#1557f5'
    setSettings(next)
    localStorage.setItem('app_settings', JSON.stringify(next))
    applySettings(next)
  }

  function saveEvo(patch) {
    const next = { ...evo, ...patch }
    setEvo(next)
    saveEvoConfig(next)
  }

  // ── QR Connection state ──
  const [qrOpen,       setQrOpen]       = useState(false)
  const [qrImage,      setQrImage]      = useState(null)
  const [qrStatus,     setQrStatus]     = useState('idle') // idle | phone | creating | waiting | connected | error
  const [qrPhone,      setQrPhone]      = useState('')
  const [phoneInput,   setPhoneInput]   = useState('')
  const [connStatus,   setConnStatus]   = useState('checking') // checking | connected | disconnected
  const [connPhone,    setConnPhone]    = useState('')
  const [qrWaitSecs,   setQrWaitSecs]   = useState(0)   // seconds waiting for QR image
  const pollRef    = useRef(null)
  const qrTimerRef = useRef(null)

  // Verificar estado real de conexión — lee instancias asignadas al usuario desde la API
  useEffect(() => {
    const uid = user?._id
    if (!uid) { setConnStatus('disconnected'); return }
    async function checkConn() {
      const tok = localStorage.getItem('user_token')
      if (!tok) { setConnStatus('disconnected'); return }
      try {
        const r = await fetch('/api/instances', { headers: { 'x-user-token': tok } })
        if (!r.ok) { setConnStatus('disconnected'); return }
        const d = await r.json()
        const all = Array.isArray(d) ? d : (d.instances || [])
        const mine = all.filter(i => i.assigned_to === uid)
        const connected = mine.filter(i => ['open','connected','WORKING'].includes(i.live_status))
        if (connected.length > 0) {
          setConnStatus('connected')
          setConnPhone(connected[0].number ? `+${connected[0].number}` : connected[0].name)
        } else {
          setConnStatus(mine.length > 0 ? 'disconnected' : 'disconnected')
        }
      } catch { setConnStatus('disconnected') }
    }
    checkConn()
  }, [user])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const fetchQr = useCallback(async (name, retries = 4) => {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(`/api/waha/session/qr/${name}`)
        const d = await r.json()
        const b64 = d.base64
        if (b64) {
          setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
          if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null; setQrWaitSecs(0) }
          return true
        }
      } catch {}
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500))
    }
    return false
  }, [])

  const checkStatus = useCallback(async (name) => {
    try {
      const r = await fetch(`/api/waha/session/status/${name}`)
      const d = await r.json()
      const state = d.state || d.instance?.state || ''
      if (state === 'open') {
        stopPolling()
        setQrStatus('connected')
        const phone = d.number || name
        setQrPhone(phone)
        saveEvoConfig({ ...loadEvoConfig(), instance: name })
        setEvo(prev => ({ ...prev, instance: name }))
        setConnStatus('connected')
        setConnPhone(phoneInput || phone)
        const token = localStorage.getItem('user_token')
        if (token) {
          fetch('/api/auth/evolution', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-user-token': token },
            body: JSON.stringify({ instance: name, number: phoneInput || phone }),
          }).catch(() => {})
        }
      }
    } catch {}
  }, [stopPolling])

  async function handleConnect() {
    setPhoneInput('')
    setQrStatus('phone')
    setQrImage(null)
    setQrOpen(true)
  }

  async function handleStartConnection() {
    const safeUsername = (user?.username && user.username !== 'undefined' && user.username !== 'null') ? user.username : (user?.id || user?._id || 'user')
    const instanceName = `${safeUsername}-wa`
    saveEvo({ instance: instanceName })
    setQrStatus('creating')

    // Step 1: check if WAHA session already exists and is connected
    try {
      const statusRes = await fetch(`/api/waha/session/status/${instanceName}`)
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        const state = statusData?.state || statusData?.instance?.state || ''
        if (state === 'open') {
          stopPolling()
          setQrStatus('connected')
          const phone = statusData?.number || instanceName
          setQrPhone(phone)
          saveEvoConfig({ ...loadEvoConfig(), instance: instanceName })
          setEvo(prev => ({ ...prev, instance: instanceName }))
          setConnStatus('connected')
          setConnPhone(phoneInput || phone)
          if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
          return
        }
        // Session exists but not connected — delete and recreate for fresh QR
        await fetch(`/api/waha/session/${instanceName}`, { method: 'DELETE' }).catch(() => {})
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch {}

    // Step 2: create WAHA session (QR is not in create response — fetched separately)
    setQrStatus('waiting')
    setQrWaitSecs(0)
    qrTimerRef.current = setInterval(() => setQrWaitSecs(s => s + 1), 1000)
    try {
      const res = await fetch('/api/waha/session/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: instanceName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setQrStatus('error')
        setQrImage(null)
        console.error('[QR] WAHA session create error:', data.detail || data.error)
        if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
        return
      }
      // Wait for session to initialize then fetch QR
      await new Promise(r => setTimeout(r, 2500))
      await fetchQr(instanceName)
    } catch (e) {
      console.error('[QR] WAHA session create exception:', e)
    }

    let qrShown = false
    let pollAttempts = 0
    pollRef.current = setInterval(async () => {
      pollAttempts++
      if (!qrShown) qrShown = await fetchQr(instanceName)
      await checkStatus(instanceName)
      // Auto-timeout after ~36s (12 × 3s) with no QR — avoids infinite spinner
      if (!qrShown && pollAttempts >= 12) {
        stopPolling()
        if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
        setQrStatus('error')
      }
    }, 3000)
  }

  function handleCloseQr() {
    stopPolling()
    if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
    setQrOpen(false)
    setQrStatus('idle')
    setQrImage(null)
    setQrWaitSecs(0)
  }

  const TABS = [
    { icon: <AccountCircleIcon sx={{ fontSize: 15 }} />, label: t.settings.tabAccount    || 'Cuenta' },
    { icon: <PhoneAndroidIcon sx={{ fontSize: 15 }} />,  label: t.settings.tabWhatsApp   || 'WhatsApp', badge: connStatus === 'connected' },
    { icon: <TimerIcon sx={{ fontSize: 15 }} />,         label: t.settings.tabSendTiming || 'Envíos' },
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, flexShrink: 0 }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.1)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <SettingsIcon sx={{ color: 'var(--accent,#3b82f6)', fontSize: 19 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>{t.settings.title}</Typography>
          <Typography sx={{ color: 'var(--text-muted,rgba(255,255,255,0.3))', fontSize: '0.72rem' }}>{t.settings.subtitle}</Typography>
        </Box>
      </Box>

      {/* ── Tab bar ── */}
      <Box sx={{
        display: 'flex', gap: 0.5, mb: 2.5, flexShrink: 0,
        p: 0.5, borderRadius: 2.5,
        bgcolor: 'var(--surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--border, rgba(255,255,255,0.06))',
      }}>
        {TABS.map((tab, i) => {
          const active = activeTab === i
          return (
            <Box key={i} onClick={() => setActiveTab(i)} sx={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.6,
              py: 0.9, px: 0.5, borderRadius: 2, cursor: 'pointer', position: 'relative',
              bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.14)' : 'transparent',
              border: active ? '1px solid rgba(var(--accent-rgb,59,130,246),0.28)' : '1px solid transparent',
              boxShadow: active ? '0 0 12px rgba(var(--accent-rgb,59,130,246),0.12)' : 'none',
              transition: 'all 0.15s',
              '&:hover': !active ? { bgcolor: 'var(--item-hover, rgba(255,255,255,0.06))', border: '1px solid var(--border, rgba(255,255,255,0.1))' } : {},
              '[data-theme-mode="light"] &:hover': !active ? { bgcolor: 'rgba(0,0,0,0.07)', border: '1px solid rgba(0,0,0,0.14)' } : {},
            }}>
              <Box sx={{ color: active ? 'var(--accent,#3b82f6)' : 'var(--text-muted, rgba(255,255,255,0.4))', display: 'flex' }}>
                {tab.icon}
              </Box>
              <Typography sx={{
                fontSize: '0.72rem', fontWeight: active ? 700 : 400,
                color: active ? 'var(--accent,#3b82f6)' : 'var(--text-muted, rgba(255,255,255,0.4))',
                transition: 'color 0.15s',
              }}>
                {tab.label}
              </Typography>
              {tab.badge && (
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#25d366', boxShadow: '0 0 6px #25d366aa', flexShrink: 0 }} />
              )}
            </Box>
          )
        })}
      </Box>

      {/* ── Tab content ── */}
      <Box sx={{ flex: 1, overflowY: 'auto', pl: 1, pr: 4, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>

        {/* ═══ TAB 0: Cuenta ═══ */}
        {activeTab === 0 && (
          <AccountSection user={user} connStatus={connStatus} connPhone={connPhone} evo={evo} />
        )}

        {/* ═══ TAB 1: WhatsApp ═══ */}
        {activeTab === 1 && <>
          <Section icon={<PhoneAndroidIcon />} title={t.settings.whatsapp}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {connStatus === 'checking' ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                  <CircularProgress size={16} sx={{ color: 'rgba(255,255,255,0.25)' }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>{t.settings.verifying}</Typography>
                </Box>
              ) : connStatus === 'connected' ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, borderRadius: 2, bgcolor: 'rgba(37,211,102,0.08)', border: '1px solid rgba(37,211,102,0.22)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#25d366', boxShadow: '0 0 8px #25d366aa', flexShrink: 0 }} />
                    <Box>
                      <Typography sx={{ color: '#4ade80', fontWeight: 600, fontSize: '0.85rem' }}>{t.settings.connected}</Typography>
                      <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>{connPhone || evo.instance}</Typography>
                    </Box>
                  </Box>
                  <Box onClick={handleConnect} sx={{ px: 1.2, py: 0.5, borderRadius: 1.5, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
                    <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)' }}>{t.settings.change}</Typography>
                  </Box>
                </Box>
              ) : (
                <Box>
                  <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', mb: 1.5, lineHeight: 1.5 }}>
                    {t.settings.waConnectHint}
                  </Typography>
                  <Box onClick={handleConnect} sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
                    py: 1.3, borderRadius: 2, cursor: 'pointer',
                    bgcolor: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.3)',
                    transition: 'all 0.15s',
                    '&:hover': { bgcolor: 'rgba(37,211,102,0.2)', borderColor: 'rgba(37,211,102,0.5)' },
                  }}>
                    <QrCode2Icon sx={{ fontSize: 18, color: '#25d366' }} />
                    <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: '#25d366' }}>
                      {t.settings.connect}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          </Section>
        </>}

        {/* ═══ TAB 2: Envíos ═══ */}
        {activeTab === 2 && <SendTimingSection />}

      </Box>

      {/* ── QR Dialog — fuera del scroll ── */}
      <Dialog open={qrOpen} onClose={handleCloseQr} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#161d2e)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.7)' } } }}>
        <DialogContent sx={{ textAlign: 'center', py: 3, bgcolor: 'var(--card-bg,#161d2e)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 2 }}>
            <PhoneAndroidIcon sx={{ color: '#25d366', fontSize: 22 }} />
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>{t.settings.qrTitle}</Typography>
          </Box>

          {qrStatus === 'phone' && (
            <Box sx={{ bgcolor: 'var(--surface,#111827)', borderRadius: 2, p: 2, border: '1px solid rgba(255,255,255,0.07)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', mb: 2, lineHeight: 1.5 }}>{t.settings.qrPhoneHint}</Typography>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0,
                bgcolor: 'var(--surface,#111827)', borderRadius: 2,
                border: '1.5px solid rgba(255,255,255,0.1)', overflow: 'hidden', mb: 2,
                '&:focus-within': { borderColor: '#25d366', boxShadow: '0 0 0 3px rgba(37,211,102,0.1)' },
                transition: 'all 0.15s',
              }}>
                <Box sx={{ px: 1.5, py: 1.2, bgcolor: 'rgba(37,211,102,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                  <Typography sx={{ color: '#4ade80', fontSize: '0.95rem', fontWeight: 600, fontFamily: 'monospace' }}>+52</Typography>
                </Box>
                <Box component="input" autoFocus type="tel" placeholder="5512345678"
                  value={phoneInput.replace(/\D/g, '').replace(/^52/, '')}
                  onChange={e => { const digits = e.target.value.replace(/\D/g, '').slice(0, 10); setPhoneInput('+52' + digits) }}
                  onKeyDown={e => { if (e.key === 'Enter' && phoneInput.replace(/\D/g,'').length >= 12) handleStartConnection() }}
                  sx={{ flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent', color: 'white', fontSize: '1.1rem', fontFamily: 'monospace', letterSpacing: '0.08em', px: 1.5, py: 1.2, '&::placeholder': { color: 'rgba(255,255,255,0.2)' } }}
                />
              </Box>
              <Box onClick={() => phoneInput.replace(/\D/g,'').length >= 12 && handleStartConnection()} sx={{
                py: 1.1, borderRadius: 2, cursor: phoneInput.replace(/\D/g,'').length >= 12 ? 'pointer' : 'default', textAlign: 'center',
                bgcolor: phoneInput.replace(/\D/g,'').length >= 12 ? 'rgba(37,211,102,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${phoneInput.replace(/\D/g,'').length >= 12 ? 'rgba(37,211,102,0.35)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'all 0.15s',
                '&:hover': phoneInput.replace(/\D/g,'').length >= 12 ? { bgcolor: 'rgba(37,211,102,0.25)' } : {},
              }}>
                <Typography sx={{ color: phoneInput.replace(/\D/g,'').length >= 12 ? '#25d366' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: '0.88rem' }}>
                  {t.settings.qrContinue}
                </Typography>
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.68rem', mt: 1.5, textAlign: 'center' }}>{t.settings.qrFootnote}</Typography>
            </Box>
          )}

          {qrStatus === 'creating' && (
            <Box sx={{ py: 4, bgcolor: 'var(--surface,#111827)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.07)' }}>
              <CircularProgress size={40} sx={{ color: '#25d366' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', mt: 2 }}>{t.settings.qrPreparing}</Typography>
            </Box>
          )}

          {qrStatus === 'waiting' && (
            <Box sx={{ bgcolor: 'var(--surface,#111827)', borderRadius: 2, p: 2, border: '1px solid rgba(255,255,255,0.07)' }}>
              {phoneInput && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1.5, py: 0.8, borderRadius: 1.5, bgcolor: 'rgba(37,211,102,0.08)', border: '1px solid rgba(37,211,102,0.2)' }}>
                  <PhoneAndroidIcon sx={{ fontSize: 15, color: '#4ade80' }} />
                  <Typography sx={{ color: '#4ade80', fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 600 }}>{phoneInput}</Typography>
                </Box>
              )}
              {qrImage ? (
                <Box sx={{ display: 'inline-block' }}>
                  <Box component="img" src={qrImage} alt="QR Code" sx={{ width: 220, height: 220, borderRadius: 2, border: '4px solid white', display: 'block' }} />
                </Box>
              ) : (
                <Box sx={{ width: 220, height: 220, mx: 'auto', borderRadius: 2, bgcolor: 'var(--surface,#111827)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
                  <CircularProgress size={32} sx={{ color: '#25d366' }} />
                  {qrWaitSecs >= 12 && (
                    <Box onClick={() => { stopPolling(); handleStartConnection() }} sx={{ px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer', bgcolor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', '&:hover': { bgcolor: 'rgba(37,211,102,0.2)' } }}>
                      <Typography sx={{ fontSize: '0.7rem', color: '#4ade80', fontWeight: 600 }}>{t.settings.qrRetry}</Typography>
                    </Box>
                  )}
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, justifyContent: 'center' }}>
                <CircularProgress size={12} sx={{ color: '#25d366' }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem' }}>{t.settings.qrWaiting}</Typography>
              </Box>
              <Box sx={{ mt: 1.5, textAlign: 'left', width: '100%', maxWidth: 240 }}>
                {[t.settings.qrStep1, t.settings.qrStep2, t.settings.qrStep3, t.settings.qrStep4].map((step, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.8 }}>
                    <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: 'rgba(37,211,102,0.2)', border: '1px solid rgba(37,211,102,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.1 }}>
                      <Typography sx={{ fontSize: '0.55rem', color: '#4ade80', fontWeight: 800 }}>{i+1}</Typography>
                    </Box>
                    <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem', lineHeight: 1.4 }}>{step}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {qrStatus === 'connected' && (
            <Box sx={{ py: 2, bgcolor: 'rgba(37,211,102,0.06)', borderRadius: 2, border: '1px solid rgba(37,211,102,0.18)' }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: 'rgba(37,211,102,0.15)', border: '2px solid #25d366', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                <CheckIcon sx={{ color: '#25d366', fontSize: 32 }} />
              </Box>
              <Typography sx={{ color: '#25d366', fontWeight: 700, fontSize: '1rem' }}>
                {lang === 'en' ? 'Number linked!' : '¡Número vinculado!'}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', mt: 0.5, fontFamily: 'monospace' }}>{phoneInput || qrPhone}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', mt: 0.5 }}>
                {lang === 'en' ? 'Messages will be sent from this number' : 'Los mensajes saldrán desde este número'}
              </Typography>
              <Box onClick={handleCloseQr} sx={{ mt: 2.5, px: 3, py: 0.8, borderRadius: 2, cursor: 'pointer', display: 'inline-block', bgcolor: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.3)', '&:hover': { bgcolor: 'rgba(37,211,102,0.25)' } }}>
                <Typography sx={{ color: '#25d366', fontSize: '0.82rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Done' : 'Listo'}
                </Typography>
              </Box>
            </Box>
          )}

          {qrStatus === 'error' && (
            <Box sx={{ py: 2, px: 2, bgcolor: 'rgba(248,113,113,0.06)', borderRadius: 2, border: '1px solid rgba(248,113,113,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ color: '#f87171', fontSize: '0.85rem', textAlign: 'center' }}>
                {lang === 'en'
                  ? 'Could not generate QR. Make sure the WAHA server is running and the API Key is correct.'
                  : 'No se pudo generar el QR. Verifica que el servidor WAHA esté activo y la API Key sea correcta.'}
              </Typography>
              <Box onClick={handleStartConnection}
                sx={{ px: 2.5, py: 0.7, borderRadius: 2, cursor: 'pointer',
                  bgcolor: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)',
                  '&:hover': { bgcolor: 'rgba(248,113,113,0.22)' } }}>
                <Typography sx={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                  {lang === 'en' ? 'Retry' : 'Reintentar'}
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>

    </Box>
  )
}
