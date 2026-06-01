'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import Tooltip from '@mui/material/Tooltip'
import TextField from '@mui/material/TextField'
import SettingsIcon from '@mui/icons-material/Settings'
import LanguageIcon from '@mui/icons-material/Language'
import PaletteIcon from '@mui/icons-material/Palette'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import CheckIcon from '@mui/icons-material/Check'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import LinkIcon from '@mui/icons-material/Link'

export const ACCENTS = [
  // Marca
  { label: 'DeTuCel Blue',  value: '#1557f5', glow: 'rgba(21,87,245,0.35)'   },
  // Fríos
  { label: 'Azul',          value: '#3b82f6', glow: 'rgba(59,130,246,0.3)'   },
  { label: 'Azul eléctrico',value: '#0ea5e9', glow: 'rgba(14,165,233,0.3)'   },
  { label: 'Cian',          value: '#06b6d4', glow: 'rgba(6,182,212,0.3)'    },
  { label: 'Turquesa',      value: '#14b8a6', glow: 'rgba(20,184,166,0.3)'   },
  { label: 'Teal neón',     value: '#00ffd5', glow: 'rgba(0,255,213,0.3)'    },
  { label: 'Menta',         value: '#34d399', glow: 'rgba(52,211,153,0.3)'   },
  { label: 'Violeta',       value: '#8b5cf6', glow: 'rgba(139,92,246,0.3)'   },
  { label: 'Lavanda',       value: '#c4b5fd', glow: 'rgba(196,181,253,0.35)' },
  { label: 'Persa',         value: '#e879f9', glow: 'rgba(232,121,249,0.3)'  },
  { label: 'Púrpura neón',  value: '#c026d3', glow: 'rgba(192,38,211,0.3)'   },
  { label: 'Índigo',        value: '#6366f1', glow: 'rgba(99,102,241,0.3)'   },
  { label: 'Plateado',      value: '#94a3b8', glow: 'rgba(148,163,184,0.3)'  },
  // Cálidos
  { label: 'Verde',         value: '#22c55e', glow: 'rgba(34,197,94,0.3)'    },
  { label: 'Verde lima',    value: '#84cc16', glow: 'rgba(132,204,22,0.3)'   },
  { label: 'Chartreuse',    value: '#a3e635', glow: 'rgba(163,230,53,0.3)'   },
  { label: 'Verde neón',    value: '#39ff14', glow: 'rgba(57,255,20,0.3)'    },
  { label: 'Naranja',       value: '#f97316', glow: 'rgba(249,115,22,0.3)'   },
  { label: 'Ámbar',         value: '#f59e0b', glow: 'rgba(245,158,11,0.3)'   },
  { label: 'Amarillo neón', value: '#faff00', glow: 'rgba(250,255,0,0.3)'    },
  { label: 'Coral',         value: '#f43f5e', glow: 'rgba(244,63,94,0.3)'    },
  { label: 'Rosa',          value: '#ec4899', glow: 'rgba(236,72,153,0.3)'   },
  { label: 'Hot pink',      value: '#ff0080', glow: 'rgba(255,0,128,0.3)'    },
  { label: 'Rojo',          value: '#ef4444', glow: 'rgba(239,68,68,0.3)'    },
]

export const THEMES = [
  // Tema de marca — va primero
  {
    label: 'DeTuCel', value: 'detucel',
    bg: '#182e24', sidebar: '#0e2d5c', surface: '#3a4a5c', card: '#264436',
    preview: ['#0e2d5c', '#3a4a5c', '#264436'],
  },
  { label: 'Navy',       value: 'navy',      bg: '#080c14', sidebar: '#0d1117', surface: '#111827', card: '#161d2e', preview: ['#080c14','#0d1117','#161d2e'] },
  { label: 'Carbón',     value: 'carbon',    bg: '#050505', sidebar: '#0d0d0d', surface: '#111111', card: '#141414', preview: ['#050505','#0d0d0d','#1a1a1a'] },
  { label: 'Pizarra',    value: 'slate',     bg: '#0f172a', sidebar: '#1e293b', surface: '#293548', card: '#334155', preview: ['#0f172a','#1e293b','#334155'] },
  { label: 'Midnight',   value: 'midnight',  bg: '#0c0a1e', sidebar: '#130f2e', surface: '#191434', card: '#1e1a3a', preview: ['#0c0a1e','#130f2e','#1e1a3a'] },
  { label: 'Forest',     value: 'forest',    bg: '#051409', sidebar: '#0a1f0e', surface: '#0c2610', card: '#0f2d15', preview: ['#051409','#0a1f0e','#0f2d15'] },
  { label: 'Rosewood',   value: 'rosewood',  bg: '#140508', sidebar: '#1e0a10', surface: '#250d14', card: '#2d111a', preview: ['#140508','#1e0a10','#2d111a'] },
  { label: 'Ocean',      value: 'ocean',     bg: '#050f1a', sidebar: '#0a1829', surface: '#0c1f34', card: '#0d2540', preview: ['#050f1a','#0a1829','#0d2540'] },
  { label: 'Lava',       value: 'lava',      bg: '#120808', sidebar: '#1a0e0e', surface: '#221010', card: '#2a1212', preview: ['#120808','#1a0e0e','#2a1212'] },
  { label: 'Abyss',      value: 'abyss',     bg: '#020408', sidebar: '#04080f', surface: '#060c18', card: '#080f1e', preview: ['#020408','#04080f','#080f1e'] },
  { label: 'Void',       value: 'void',      bg: '#000000', sidebar: '#080808', surface: '#0d0d0d', card: '#111111', preview: ['#000000','#080808','#111111'] },
  { label: 'Copper',     value: 'copper',    bg: '#110a05', sidebar: '#1a1008', surface: '#201409', card: '#2a1a0a', preview: ['#110a05','#1a1008','#2a1a0a'] },
  { label: 'Storm',      value: 'storm',     bg: '#0b0e13', sidebar: '#131820', surface: '#192030', card: '#1e2535', preview: ['#0b0e13','#131820','#1e2535'] },
  { label: 'Emerald',    value: 'emerald',   bg: '#041510', sidebar: '#071f18', surface: '#0a261e', card: '#0d2e23', preview: ['#041510','#071f18','#0d2e23'] },
  { label: 'Dusk',       value: 'dusk',      bg: '#120d1a', sidebar: '#1a1228', surface: '#201535', card: '#271a3d', preview: ['#120d1a','#1a1228','#271a3d'] },
  { label: 'Aurora',     value: 'aurora',    bg: '#050e10', sidebar: '#091820', surface: '#0b2028', card: '#0d2530', preview: ['#050e10','#091820','#0d2530'] },
  { label: 'Obsidiana',  value: 'obsidian',  bg: '#09090b', sidebar: '#101014', surface: '#141418', card: '#18181c', preview: ['#09090b','#101014','#18181c'] },
  { label: 'Desert',     value: 'desert',    bg: '#110e08', sidebar: '#1a160c', surface: '#1f1b0e', card: '#251f10', preview: ['#110e08','#1a160c','#251f10'] },
  { label: 'Blood Moon', value: 'blood',     bg: '#0f0205', sidebar: '#180309', surface: '#1e040c', card: '#240510', preview: ['#0f0205','#180309','#240510'] },
  { label: 'Glaciar',    value: 'glacier',   bg: '#060f14', sidebar: '#0c1a24', surface: '#0f1f2e', card: '#132436', preview: ['#060f14','#0c1a24','#132436'] },
  { label: 'Cinder',     value: 'cinder',    bg: '#100c09', sidebar: '#181310', surface: '#1e1813', card: '#241c16', preview: ['#100c09','#181310','#241c16'] },
  // Nuevos
  { label: 'Plum',       value: 'plum',      bg: '#0e0718', sidebar: '#180e24', surface: '#20132e', card: '#271838', preview: ['#0e0718','#180e24','#271838'] },
  { label: 'Sakura',     value: 'sakura',    bg: '#13070f', sidebar: '#1e0e1a', surface: '#261223', card: '#2e152a', preview: ['#13070f','#1e0e1a','#2e152a'] },
  { label: 'Titanio',    value: 'titanio',   bg: '#0c0c10', sidebar: '#131318', surface: '#191920', card: '#1f1f28', preview: ['#0c0c10','#131318','#1f1f28'] },
  { label: 'Royal',      value: 'royal',     bg: '#07091e', sidebar: '#0c1030', surface: '#10153c', card: '#141a48', preview: ['#07091e','#0c1030','#141a48'] },
  { label: 'Petróleo',   value: 'petroleo',  bg: '#040f0e', sidebar: '#081a18', surface: '#0b2220', card: '#0e2a28', preview: ['#040f0e','#081a18','#0e2a28'] },
  { label: 'Olivo',      value: 'olivo',     bg: '#0b0e05', sidebar: '#131808', surface: '#18200b', card: '#1d270d', preview: ['#0b0e05','#131808','#1d270d'] },
  { label: 'Crepúsculo', value: 'crepusculo',bg: '#0b0b1e', sidebar: '#121228', surface: '#181835', card: '#1e1e40', preview: ['#0b0b1e','#121228','#1e1e40'] },
  { label: 'Canela',     value: 'canela',    bg: '#130a04', sidebar: '#1f1207', surface: '#261609', card: '#2e1a0b', preview: ['#130a04','#1f1207','#2e1a0b'] },
]

const LANGS = [
  { label: 'Español', value: 'es', flag: '🇲🇽' },
  { label: 'English', value: 'en', flag: '🇺🇸' },
]

const DEFAULT_SETTINGS = { accent: '#3b82f6', theme: 'navy', lang: 'es' }

const DEFAULT_ANDY = { url: '', endpoint: '/api/pending', user: '', pass: '', token: '' }

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
  if (themeObj.light) {
    root.style.setProperty('--text',        themeObj.text       || '#0f172a')
    root.style.setProperty('--text-muted',  themeObj.textMuted  || '#64748b')
    root.style.setProperty('--border',      themeObj.border     || 'rgba(0,0,0,0.1)')
    root.style.setProperty('--item-hover',  themeObj.itemHover  || 'rgba(0,0,0,0.05)')
    root.setAttribute('data-theme-mode', 'light')
  } else {
    root.style.setProperty('--text',        '#f1f5f9')
    root.style.setProperty('--text-muted',  'rgba(255,255,255,0.38)')
    root.style.setProperty('--border',      'rgba(255,255,255,0.07)')
    root.style.setProperty('--item-hover',  'rgba(255,255,255,0.05)')
    root.setAttribute('data-theme-mode', 'dark')
  }
}

function Section({ icon, title, children }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5,
        pl: 1.5, py: 0.5,
        borderLeft: '2px solid var(--accent, #3b82f6)',
        bgcolor: 'rgba(255,255,255,0.02)',
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
          color: 'rgba(255,255,255,0.8)',
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

export default function Settings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [andy, setAndy]         = useState(DEFAULT_ANDY)

  useEffect(() => {
    const s = loadSettings()
    setSettings(s)
    applySettings(s)
    setAndy(loadAndyConfig())
  }, [])

  function save(patch) {
    let next = { ...settings, ...patch }
    // Auto-set DeTuCel accent when DeTuCel theme is picked
    if (patch.theme === 'detucel') next.accent = '#1557f5'
    setSettings(next)
    localStorage.setItem('app_settings', JSON.stringify(next))
    applySettings(next)
  }

  function saveAndy(patch) {
    const next = { ...andy, ...patch }
    setAndy(next)
    saveAndyConfig(next)
  }

  const currentAccent = ACCENTS.find(a => a.value === settings.accent) || ACCENTS[0]
  const currentTheme  = THEMES.find(t => t.value === settings.theme)   || THEMES[0]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexShrink: 0 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: 2,
          bgcolor: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <SettingsIcon sx={{ color: 'var(--accent, #3b82f6)', fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>Configuración</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem' }}>Apariencia de la interfaz</Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.5, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>

        {/* ── Idioma ── */}
        <Section icon={<LanguageIcon />} title="Idioma">
          <Box sx={{ display: 'flex', gap: 1 }}>
            {LANGS.map(l => {
              const active = settings.lang === l.value
              return (
                <Box key={l.value} onClick={() => save({ lang: l.value })} sx={{
                  flex: 1, py: 1.2, px: 1.5, borderRadius: 2, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1,
                  bgcolor: active ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
                  border: active ? '1px solid var(--accent,#3b82f6)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: active ? '0 0 10px var(--accent-glow, rgba(59,130,246,0.2))' : 'none',
                  transition: 'all 0.15s',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.18)' },
                }}>
                  <Typography sx={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0 }}>{l.flag}</Typography>
                  <Typography sx={{
                    fontSize: '0.82rem',
                    fontWeight: active ? 700 : 400,
                    color: active ? 'var(--accent,#3b82f6)' : 'rgba(255,255,255,0.5)',
                    flexGrow: 1,
                  }}>
                    {l.label}
                  </Typography>
                  {/* Always rendered — opacity prevents layout shift */}
                  <CheckIcon sx={{
                    fontSize: 14,
                    color: 'var(--accent,#3b82f6)',
                    flexShrink: 0,
                    opacity: active ? 1 : 0,
                    transition: 'opacity 0.15s',
                  }} />
                </Box>
              )
            })}
          </Box>
          <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.2)', mt: 0.8 }}>
            Traducción completa disponible próximamente.
          </Typography>
        </Section>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 3 }} />

        {/* ── Color de acento ── */}
        <Section icon={<PaletteIcon />} title="Color de acento">
          {/* Current accent preview bar */}
          <Box sx={{
            mb: 1.5, px: 1.5, py: 1, borderRadius: 2,
            background: `linear-gradient(90deg, ${currentAccent.value}22 0%, transparent 100%)`,
            border: `1px solid ${currentAccent.value}44`,
            display: 'flex', alignItems: 'center', gap: 1.5,
          }}>
            <Box sx={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              bgcolor: currentAccent.value,
              boxShadow: `0 0 10px ${currentAccent.glow}, 0 0 20px ${currentAccent.glow}`,
            }} />
            <Box>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: currentAccent.value, lineHeight: 1.2 }}>
                {currentAccent.label}
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                {currentAccent.value}
              </Typography>
            </Box>
          </Box>

          {/* Swatch grid */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pl: 0.5, pr: 0.5 }}>
            {ACCENTS.map(a => {
              const active = settings.accent === a.value
              return (
                <Tooltip key={a.value} title={a.label} placement="top" arrow>
                  <Box onClick={() => save({ accent: a.value })} sx={{
                    width: 34, height: 34, borderRadius: '50%', cursor: 'pointer',
                    bgcolor: a.value, flexShrink: 0,
                    border: active ? '2.5px solid white' : '2.5px solid transparent',
                    outline: active ? `2px solid ${a.value}` : '2px solid transparent',
                    outlineOffset: 2,
                    boxShadow: active
                      ? `0 0 18px ${a.glow}, 0 0 6px ${a.value}`
                      : `0 0 6px ${a.glow}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                    '&:hover': { transform: 'scale(1.2)', boxShadow: `0 0 14px ${a.glow}, 0 0 4px ${a.value}` },
                  }}>
                    <CheckIcon sx={{
                      fontSize: 14, color: 'white',
                      filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))',
                      opacity: active ? 1 : 0,
                      transition: 'opacity 0.12s',
                    }} />
                  </Box>
                </Tooltip>
              )
            })}
          </Box>
        </Section>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 3 }} />

        {/* ── Tema base ── */}
        <Section icon={<DarkModeIcon />} title="Tema base">
          {/* Current theme preview bar */}
          <Box sx={{
            mb: 1.5, px: 1.5, py: 1, borderRadius: 2,
            bgcolor: currentTheme.card,
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 1.5,
          }}>
            {/* Mini 3-stripe */}
            <Box sx={{ display: 'flex', borderRadius: 1, overflow: 'hidden', width: 36, height: 20, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}>
              {currentTheme.preview.map((c, i) => (
                <Box key={i} sx={{ flex: 1, bgcolor: c }} />
              ))}
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent,#3b82f6)', lineHeight: 1.2 }}>
                {currentTheme.label}
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                {currentTheme.bg} · {currentTheme.sidebar}
              </Typography>
            </Box>
          </Box>

          {/* Theme grid */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1 }}>
            {THEMES.map(t => {
              const active = settings.theme === t.value
              return (
                <Tooltip key={t.value} title={t.label} placement="top" arrow>
                  <Box onClick={() => save({ theme: t.value })} sx={{
                    borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer',
                    border: active ? '1.5px solid var(--accent,#3b82f6)' : '1.5px solid rgba(255,255,255,0.07)',
                    boxShadow: active ? '0 0 14px var(--accent-glow,rgba(59,130,246,0.35))' : 'none',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: 'rgba(255,255,255,0.28)', transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' },
                  }}>
                    {/* 3-stripe preview */}
                    <Box sx={{ display: 'flex', height: 28, position: 'relative' }}>
                      {t.preview.map((c, i) => (
                        <Box key={i} sx={{ flex: 1, bgcolor: c }} />
                      ))}
                      {t.value === 'detucel' && !active && (
                        <Box sx={{
                          position: 'absolute', top: 2, right: 2,
                          bgcolor: '#1557f5', borderRadius: 0.5,
                          px: 0.4, py: 0.1,
                        }}>
                          <Typography sx={{ fontSize: '0.42rem', color: 'white', fontWeight: 800, lineHeight: 1.4, letterSpacing: '0.02em' }}>DTC</Typography>
                        </Box>
                      )}
                      {active && (
                        <Box sx={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: t.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)',
                        }}>
                          <CheckIcon sx={{ fontSize: 13, color: 'var(--accent,#3b82f6)', filter: 'drop-shadow(0 0 4px var(--accent,#3b82f6))' }} />
                        </Box>
                      )}
                    </Box>
                    {/* Label */}
                    <Box sx={{
                      px: 0.75, py: 0.5,
                      bgcolor: t.preview[1],
                      borderTop: active ? '1px solid var(--accent,#3b82f6)44' : `1px solid ${t.light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'}`,
                    }}>
                      <Typography sx={{
                        fontSize: '0.6rem',
                        fontWeight: active ? 700 : 400,
                        color: active ? 'var(--accent,#3b82f6)' : (t.light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)'),
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {t.label}
                      </Typography>
                    </Box>
                  </Box>
                </Tooltip>
              )
            })}
          </Box>
        </Section>

        {/* ── Integración Bot (Andy) ── */}
        <Section icon={<SmartToyIcon />} title="Integración Bot">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', mb: 0.5 }}>
              Configuración del servidor Own-WA de Andy. Guarda las credenciales una vez y el token se gestiona automáticamente.
            </Typography>

            {/* URL base */}
            <Box>
              <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>URL del servidor</Typography>
              <TextField fullWidth size="small" placeholder="https://own-wa.detucel.mx"
                value={andy.url} onChange={e => saveAndy({ url: e.target.value })}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.82rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' } }, '& input': { color: 'white' } }} />
            </Box>

            {/* Endpoint */}
            <Box>
              <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Endpoint de datos</Typography>
              <TextField fullWidth size="small" placeholder="/api/pending"
                value={andy.endpoint} onChange={e => saveAndy({ endpoint: e.target.value })}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.82rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' } }, '& input': { color: 'white' } }} />
            </Box>

            {/* Usuario + Contraseña */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Usuario</Typography>
                <TextField fullWidth size="small" placeholder="usuario"
                  value={andy.user} onChange={e => saveAndy({ user: e.target.value })}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.82rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' } }, '& input': { color: 'white' } }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Contraseña</Typography>
                <TextField fullWidth size="small" type="password" placeholder="••••••••"
                  value={andy.pass} onChange={e => saveAndy({ pass: e.target.value })}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.82rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' }, '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' } }, '& input': { color: 'white' } }} />
              </Box>
            </Box>

            {/* Token (read-only) */}
            {andy.token && (
              <Box sx={{ p: 1.2, borderRadius: 1.5, bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.06)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.18)' }}>
                <Typography sx={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', mb: 0.3, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Token activo (auto-gestionado)</Typography>
                <Typography sx={{ fontSize: '0.7rem', color: 'var(--accent,#60a5fa)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {andy.token.slice(0, 40)}…
                </Typography>
                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.2)', mt: 0.5, cursor: 'pointer', '&:hover': { color: '#f87171' } }}
                  onClick={() => saveAndy({ token: '' })}>
                  Limpiar token
                </Typography>
              </Box>
            )}

            {/* Status indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: andy.url && andy.user && andy.pass ? '#4ade80' : 'rgba(255,255,255,0.2)' }} />
              <Typography sx={{ fontSize: '0.7rem', color: andy.url && andy.user && andy.pass ? '#4ade80' : 'rgba(255,255,255,0.3)' }}>
                {andy.url && andy.user && andy.pass ? 'Configurado — listo para usar desde Análisis' : 'Pendiente de configurar'}
              </Typography>
            </Box>
          </Box>
        </Section>

      </Box>
    </Box>
  )
}
