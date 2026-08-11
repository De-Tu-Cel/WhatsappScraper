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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import DescriptionIcon from '@mui/icons-material/Description'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'
import { loadSendConfig, saveSendConfig, DEFAULT_SEND_CONFIG } from '@/lib/sendConfig'
import { RiskBadge } from './SendConfigPanel'
import { TemplateManagerDialog } from './messageTemplateLibrary'

export const ACCENTS = [
  // Marca
  { tKey: 'accentDtcBlue',     value: '#1557f5', glow: 'rgba(21,87,245,0.35)'   },
  // Fríos
  { tKey: 'accentBlue',        value: '#3b82f6', glow: 'rgba(59,130,246,0.3)'   },
  { tKey: 'accentElectricBlue',value: '#0ea5e9', glow: 'rgba(14,165,233,0.3)'   },
  { tKey: 'accentCyan',        value: '#06b6d4', glow: 'rgba(6,182,212,0.3)'    },
  { tKey: 'accentTurquoise',   value: '#14b8a6', glow: 'rgba(20,184,166,0.3)'   },
  { tKey: 'accentNeonTeal',    value: '#00ffd5', glow: 'rgba(0,255,213,0.3)'    },
  { tKey: 'accentMint',        value: '#34d399', glow: 'rgba(52,211,153,0.3)'   },
  { tKey: 'accentViolet',      value: '#8b5cf6', glow: 'rgba(139,92,246,0.3)'   },
  { tKey: 'accentLavender',    value: '#c4b5fd', glow: 'rgba(196,181,253,0.35)' },
  { tKey: 'accentPersian',     value: '#e879f9', glow: 'rgba(232,121,249,0.3)'  },
  { tKey: 'accentNeonPurple',  value: '#c026d3', glow: 'rgba(192,38,211,0.3)'   },
  { tKey: 'accentIndigo',      value: '#6366f1', glow: 'rgba(99,102,241,0.3)'   },
  { tKey: 'accentSilver',      value: '#94a3b8', glow: 'rgba(148,163,184,0.3)'  },
  // Cálidos
  { tKey: 'accentGreen',       value: '#22c55e', glow: 'rgba(34,197,94,0.3)'    },
  { tKey: 'accentLime',        value: '#84cc16', glow: 'rgba(132,204,22,0.3)'   },
  { tKey: 'accentChartreuse',  value: '#a3e635', glow: 'rgba(163,230,53,0.3)'   },
  { tKey: 'accentNeonGreen',   value: '#39ff14', glow: 'rgba(57,255,20,0.3)'    },
  { tKey: 'accentOrange',      value: '#f97316', glow: 'rgba(249,115,22,0.3)'   },
  { tKey: 'accentAmber',       value: '#f59e0b', glow: 'rgba(245,158,11,0.3)'   },
  { tKey: 'accentNeonYellow',  value: '#faff00', glow: 'rgba(250,255,0,0.3)'    },
  { tKey: 'accentCoral',       value: '#f43f5e', glow: 'rgba(244,63,94,0.3)'    },
  { tKey: 'accentPink',        value: '#ec4899', glow: 'rgba(236,72,153,0.3)'   },
  { tKey: 'accentHotPink',     value: '#ff0080', glow: 'rgba(255,0,128,0.3)'    },
  { tKey: 'accentRed',         value: '#ef4444', glow: 'rgba(239,68,68,0.3)'    },
  // Extras
  { tKey: 'accentGold',        value: '#eab308', glow: 'rgba(234,179,8,0.3)'    },
  { tKey: 'accentRose',        value: '#fb7185', glow: 'rgba(251,113,133,0.3)'  },
  { tKey: 'accentDeepTeal',    value: '#0d9488', glow: 'rgba(13,148,136,0.3)'   },
  { tKey: 'accentBronze',      value: '#b45309', glow: 'rgba(180,83,9,0.3)'     },
  { tKey: 'accentPeriwinkle',  value: '#818cf8', glow: 'rgba(129,140,248,0.3)'  },
  { tKey: 'accentSpringGreen', value: '#00d084', glow: 'rgba(0,208,132,0.3)'    },
  { tKey: 'accentIce',         value: '#a5f3fc', glow: 'rgba(165,243,252,0.35)' },
  { tKey: 'accentSunrise',     value: '#fb923c', glow: 'rgba(251,146,60,0.3)'   },
  // Profundos (para temas claros y pasteles)
  { tKey: 'accentOceanDeep',   value: '#0369a1', glow: 'rgba(3,105,161,0.35)'   },
  { tKey: 'accentForestDeep',  value: '#16a34a', glow: 'rgba(22,163,74,0.35)'   },
  { tKey: 'accentCrimson',     value: '#be123c', glow: 'rgba(190,18,60,0.35)'   },
  { tKey: 'accentVioletDeep',  value: '#6d28d9', glow: 'rgba(109,40,217,0.35)'  },
  { tKey: 'accentStone',       value: '#78716c', glow: 'rgba(120,113,108,0.3)'  },
  { tKey: 'accentMagenta',     value: '#d946ef', glow: 'rgba(217,70,239,0.3)'   },
]

export const THEMES = [
  // Tema de marca — va primero
  {
    tKey: 'themeDetucel', value: 'detucel',
    bg: '#182e24', sidebar: '#0e2d5c', surface: '#3a4a5c', card: '#264436',
    preview: ['#0e2d5c', '#3a4a5c', '#264436'],
  },
  { tKey: 'themeNavy',      value: 'navy',      bg: '#080c14', sidebar: '#0d1117', surface: '#111827', card: '#161d2e', preview: ['#080c14','#0d1117','#161d2e'] },
  { tKey: 'themeCarbon',    value: 'carbon',    bg: '#050505', sidebar: '#0d0d0d', surface: '#111111', card: '#141414', preview: ['#050505','#0d0d0d','#1a1a1a'] },
  { tKey: 'themeSlate',     value: 'slate',     bg: '#0f172a', sidebar: '#1e293b', surface: '#293548', card: '#334155', preview: ['#0f172a','#1e293b','#334155'] },
  { tKey: 'themeMidnight',  value: 'midnight',  bg: '#0c0a1e', sidebar: '#130f2e', surface: '#191434', card: '#1e1a3a', preview: ['#0c0a1e','#130f2e','#1e1a3a'] },
  { tKey: 'themeForest',    value: 'forest',    bg: '#051409', sidebar: '#0a1f0e', surface: '#0c2610', card: '#0f2d15', preview: ['#051409','#0a1f0e','#0f2d15'] },
  { tKey: 'themeRosewood',  value: 'rosewood',  bg: '#140508', sidebar: '#1e0a10', surface: '#250d14', card: '#2d111a', preview: ['#140508','#1e0a10','#2d111a'] },
  { tKey: 'themeOcean',     value: 'ocean',     bg: '#050f1a', sidebar: '#0a1829', surface: '#0c1f34', card: '#0d2540', preview: ['#050f1a','#0a1829','#0d2540'] },
  { tKey: 'themeLava',      value: 'lava',      bg: '#120808', sidebar: '#1a0e0e', surface: '#221010', card: '#2a1212', preview: ['#120808','#1a0e0e','#2a1212'] },
  { tKey: 'themeAbyss',     value: 'abyss',     bg: '#020408', sidebar: '#04080f', surface: '#060c18', card: '#080f1e', preview: ['#020408','#04080f','#080f1e'] },
  { tKey: 'themeVoid',      value: 'void',      bg: '#000000', sidebar: '#080808', surface: '#0d0d0d', card: '#111111', preview: ['#000000','#080808','#111111'] },
  { tKey: 'themeCopper',    value: 'copper',    bg: '#110a05', sidebar: '#1a1008', surface: '#201409', card: '#2a1a0a', preview: ['#110a05','#1a1008','#2a1a0a'] },
  { tKey: 'themeStorm',     value: 'storm',     bg: '#0b0e13', sidebar: '#131820', surface: '#192030', card: '#1e2535', preview: ['#0b0e13','#131820','#1e2535'] },
  { tKey: 'themeEmerald',   value: 'emerald',   bg: '#041510', sidebar: '#071f18', surface: '#0a261e', card: '#0d2e23', preview: ['#041510','#071f18','#0d2e23'] },
  { tKey: 'themeDusk',      value: 'dusk',      bg: '#120d1a', sidebar: '#1a1228', surface: '#201535', card: '#271a3d', preview: ['#120d1a','#1a1228','#271a3d'] },
  { tKey: 'themeAurora',    value: 'aurora',    bg: '#050e10', sidebar: '#091820', surface: '#0b2028', card: '#0d2530', preview: ['#050e10','#091820','#0d2530'] },
  { tKey: 'themeObsidian',  value: 'obsidian',  bg: '#09090b', sidebar: '#101014', surface: '#141418', card: '#18181c', preview: ['#09090b','#101014','#18181c'] },
  { tKey: 'themeDesert',    value: 'desert',    bg: '#110e08', sidebar: '#1a160c', surface: '#1f1b0e', card: '#251f10', preview: ['#110e08','#1a160c','#251f10'] },
  { tKey: 'themeBloodMoon', value: 'blood',     bg: '#0f0205', sidebar: '#180309', surface: '#1e040c', card: '#240510', preview: ['#0f0205','#180309','#240510'] },
  { tKey: 'themeGlacier',   value: 'glacier',   bg: '#060f14', sidebar: '#0c1a24', surface: '#0f1f2e', card: '#132436', preview: ['#060f14','#0c1a24','#132436'] },
  { tKey: 'themeCinder',    value: 'cinder',    bg: '#100c09', sidebar: '#181310', surface: '#1e1813', card: '#241c16', preview: ['#100c09','#181310','#241c16'] },
  // Nuevos
  { tKey: 'themePlum',      value: 'plum',      bg: '#0e0718', sidebar: '#180e24', surface: '#20132e', card: '#271838', preview: ['#0e0718','#180e24','#271838'] },
  { tKey: 'themeSakura',    value: 'sakura',    bg: '#13070f', sidebar: '#1e0e1a', surface: '#261223', card: '#2e152a', preview: ['#13070f','#1e0e1a','#2e152a'] },
  { tKey: 'themeTitanium',  value: 'titanio',   bg: '#0c0c10', sidebar: '#131318', surface: '#191920', card: '#1f1f28', preview: ['#0c0c10','#131318','#1f1f28'] },
  { tKey: 'themeRoyal',     value: 'royal',     bg: '#07091e', sidebar: '#0c1030', surface: '#10153c', card: '#141a48', preview: ['#07091e','#0c1030','#141a48'] },
  { tKey: 'themePetroleum', value: 'petroleo',  bg: '#040f0e', sidebar: '#081a18', surface: '#0b2220', card: '#0e2a28', preview: ['#040f0e','#081a18','#0e2a28'] },
  { tKey: 'themeOlive',     value: 'olivo',     bg: '#0b0e05', sidebar: '#131808', surface: '#18200b', card: '#1d270d', preview: ['#0b0e05','#131808','#1d270d'] },
  { tKey: 'themeTwilight',  value: 'crepusculo',bg: '#0b0b1e', sidebar: '#121228', surface: '#181835', card: '#1e1e40', preview: ['#0b0b1e','#121228','#1e1e40'] },
  { tKey: 'themeCinnamon',  value: 'canela',    bg: '#130a04', sidebar: '#1f1207', surface: '#261609', card: '#2e1a0b', preview: ['#130a04','#1f1207','#2e1a0b'] },
  { tKey: 'themeDaytime',   value: 'diurna',    bg: '#15100a', sidebar: '#1e170b', surface: '#25200d', card: '#2d2610', preview: ['#15100a','#1e170b','#2d2610'] },
  // ── Monocromático (fondo blanco, texto negro) ──
  { tKey: 'themeMonochrome', value: 'mono', cat:'mono', bg: '#d8dce6', sidebar: '#ccd1dc', surface: '#d2d6e0', card: '#c3c8d4', preview: ['#d8dce6','#ccd1dc','#c3c8d4'] },

  // ── Pasteles (fondos muy claros, texto oscuro) ──
  { tKey: 'themeCloud',      value: 'nube',     cat:'mono', bg: '#c4d0dc', sidebar: '#b8c6d4', surface: '#ccd6e0', card: '#b0bece', preview: ['#c4d0dc','#b8c6d4','#b0bece'] },
  { tKey: 'themeMintFresh',  value: 'menta',    cat:'mono', bg: '#c8ddd4', sidebar: '#bcd4ca', surface: '#d0e4da', card: '#b0ccC0', preview: ['#c8ddd4','#bcd4ca','#b0ccc0'] },
  { tKey: 'themeBlush',      value: 'rubor',    cat:'mono', bg: '#ddd0d4', sidebar: '#d4c6cc', surface: '#e4d8da', card: '#ccb8be', preview: ['#ddd0d4','#d4c6cc','#ccb8be'] },
  { tKey: 'themePowderBlue', value: 'polvos',   cat:'mono', bg: '#c8d4e8', sidebar: '#bccae0', surface: '#d0daf0', card: '#b8c8dc', preview: ['#c8d4e8','#bccae0','#b8c8dc'] },
  { tKey: 'themeChampagne',  value: 'champan',  cat:'mono', bg: '#ddd8c4', sidebar: '#d4cebc', surface: '#e6e0cc', card: '#ccc8b0', preview: ['#ddd8c4','#d4cebc','#ccc8b0'] },
  { tKey: 'themeLilacMist',  value: 'lila',     cat:'mono', bg: '#d4cce0', sidebar: '#cac0d8', surface: '#dcd4e8', card: '#c0b8d0', preview: ['#d4cce0','#cac0d8','#c0b8d0'] },

  // ── Claros (tonos medios ~33-40% L, saturación ~22-35% — elegantes, no chillan) ──
  { tKey: 'themeSlateBlue',  value: 'pizarra',  cat:'light', bg: '#445c6e', sidebar: '#526a7c', surface: '#3c5264', card: '#5a6e80', preview: ['#445c6e','#526a7c','#5a6e80'] },
  { tKey: 'themePaper',      value: 'paper',    cat:'light', bg: '#58493a', sidebar: '#665748', surface: '#503f30', card: '#726050', preview: ['#58493a','#665748','#726050'] },
  { tKey: 'themeSteelBlue',  value: 'acero',    cat:'light', bg: '#2e4e72', sidebar: '#3a5c80', surface: '#284468', card: '#40607e', preview: ['#2e4e72','#3a5c80','#40607e'] },
  { tKey: 'themeMoss',       value: 'musgo',    cat:'light', bg: '#2c5840', sidebar: '#386848', surface: '#265038', card: '#3e6e52', preview: ['#2c5840','#386848','#3e6e52'] },
  { tKey: 'themeLavender',   value: 'lavanda',  cat:'light', bg: '#3e3070', sidebar: '#4c3e7e', surface: '#382866', card: '#564880', preview: ['#3e3070','#4c3e7e','#564880'] },
  { tKey: 'themeTerracotta', value: 'terracota',cat:'light', bg: '#6e4232', sidebar: '#7c5040', surface: '#623a28', card: '#886050', preview: ['#6e4232','#7c5040','#886050'] },
  { tKey: 'themeDustyRose',  value: 'palo',     cat:'light', bg: '#5e3042', sidebar: '#6c3e50', surface: '#56283a', card: '#7a4858', preview: ['#5e3042','#6c3e50','#7a4858'] },
  { tKey: 'themeDeepTeal',   value: 'teal',     cat:'light', bg: '#1e5e70', sidebar: '#2a6c7e', surface: '#185466', card: '#307080', preview: ['#1e5e70','#2a6c7e','#307080'] },
  { tKey: 'themeLeather',    value: 'cuero',    cat:'light', bg: '#624a1e', sidebar: '#705828', surface: '#583e16', card: '#806030', preview: ['#624a1e','#705828','#806030'] },
  { tKey: 'themeDenim',      value: 'denim',    cat:'light', bg: '#2a3c5e', sidebar: '#38506e', surface: '#243452', card: '#445270', preview: ['#2a3c5e','#38506e','#445270'] },
  { tKey: 'themeWalnut',     value: 'nogal',    cat:'light', bg: '#4c3826', sidebar: '#5a4634', surface: '#44301e', card: '#624e38', preview: ['#4c3826','#5a4634','#624e38'] },
  { tKey: 'themeSage',       value: 'salvia',   cat:'light', bg: '#2c4a38', sidebar: '#3a5846', surface: '#264230', card: '#3e5e48', preview: ['#2c4a38','#3a5846','#3e5e48'] },
  { tKey: 'themeSteel',      value: 'steel',    cat:'light', bg: '#2e3e52', sidebar: '#3c4c60', surface: '#283648', card: '#445462', preview: ['#2e3e52','#3c4c60','#445462'] },
  { tKey: 'themeWine',       value: 'vino',     cat:'light', bg: '#502030', sidebar: '#5e2e3e', surface: '#481828', card: '#6c3848', preview: ['#502030','#5e2e3e','#6c3848'] },
  { tKey: 'themeInk',        value: 'tinta',    cat:'light', bg: '#1e2e48', sidebar: '#2a3c58', surface: '#182638', card: '#344460', preview: ['#1e2e48','#2a3c58','#344460'] },
  { tKey: 'themeClay',       value: 'arcilla',  cat:'light', bg: '#6b4c3b', sidebar: '#795a48', surface: '#5e4030', card: '#886254', preview: ['#6b4c3b','#795a48','#886254'] },
  { tKey: 'themeGunmetal',   value: 'grafito',  cat:'light', bg: '#3d5060', surface: '#35465a', sidebar: '#4a5e6e', card: '#546878', preview: ['#3d5060','#4a5e6e','#546878'] },
  { tKey: 'themeKhaki',      value: 'caqui',    cat:'light', bg: '#6b6240', sidebar: '#79704e', surface: '#5e5636', card: '#847a56', preview: ['#6b6240','#79704e','#847a56'] },
  { tKey: 'themeMauve',      value: 'malva',    cat:'light', bg: '#5e3d52', sidebar: '#6c4b60', surface: '#543444', card: '#7a5870', preview: ['#5e3d52','#6c4b60','#7a5870'] },
  { tKey: 'themeJade',       value: 'jade',     cat:'light', bg: '#2d6b50', sidebar: '#387a5e', surface: '#276046', card: '#428868', preview: ['#2d6b50','#387a5e','#428868'] },
  { tKey: 'themeAsh',        value: 'ceniza',   cat:'light', bg: '#4a5058', surface: '#424850', sidebar: '#585e66', card: '#626870', preview: ['#4a5058','#585e66','#626870'] },
]

export const LANGS = [
  { value: 'es', flag: '🇲🇽', labels: { es: 'Español', en: 'Spanish' } },
  { value: 'en', flag: '🇺🇸', labels: { es: 'Inglés',  en: 'English' } },
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
                const dot = isConn ? '#22c55e' : isConnecting ? '#f59e0b' : 'rgba(255,255,255,0.2)'
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

  function update(key, val) {
    const next = { ...cfg, [key]: val }
    setCfg(next)
    saveSendConfig(next)
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
  const { t }                    = useLang()
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
        const connected = mine.filter(i => ['open','connected'].includes(i.live_status))
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
        const r = await fetch(`/api/evolution/instance/${name}?type=qr`)
        const d = await r.json()
        const b64 = d.base64 || d.qrcode?.base64 || d.qr?.base64
        if (b64) {
          setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
          if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null; setQrWaitSecs(0) }
          return true  // QR received
        }
      } catch {}
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500))
    }
    return false  // no QR after all retries
  }, [])

  const checkStatus = useCallback(async (name) => {
    try {
      const r = await fetch(`/api/evolution/instance/${name}?type=status`)
      const d = await r.json()
      const state = d.instance?.state || d.state || ''
      if (state === 'open') {
        stopPolling()
        setQrStatus('connected')
        const phone = d.instance?.profileName || d.instance?.wid?.user || name
        setQrPhone(phone)
        saveEvoConfig({ ...loadEvoConfig(), instance: name })
        setEvo(prev => ({ ...prev, instance: name }))
        setConnStatus('connected')
        setConnPhone(phoneInput || phone)
        // Save instance + phone to user profile in backend
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
    // Open phone input step first
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

    // Step 1: check if instance already exists and is connected
    try {
      const statusRes = await fetch(`/api/evolution/instance/${instanceName}?type=status`)
      if (statusRes.ok) {
        const statusData = await statusRes.json()
        const state = statusData?.instance?.state || statusData?.state || ''
        if (state === 'open') {
          // Already connected — no QR needed
          stopPolling()
          setQrStatus('connected')
          const phone = statusData?.instance?.profileName || statusData?.instance?.wid?.user || instanceName
          setQrPhone(phone)
          saveEvoConfig({ ...loadEvoConfig(), instance: instanceName })
          setEvo(prev => ({ ...prev, instance: instanceName }))
          setConnStatus('connected')
          setConnPhone(phoneInput || phone)
          if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
          return
        }
        // Instance exists but not connected — delete so we can recreate with fresh QR
        await fetch(`/api/evolution/instance/${instanceName}`, { method: 'DELETE' }).catch(() => {})
        await new Promise(r => setTimeout(r, 1500))
      }
    } catch {}

    // Step 2: create instance — QR comes back directly in response (qrcode: true)
    setQrStatus('waiting')
    setQrWaitSecs(0)
    qrTimerRef.current = setInterval(() => setQrWaitSecs(s => s + 1), 1000)
    try {
      const res = await fetch('/api/evolution/instance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setQrStatus('error')
        setQrImage(null)
        console.error('[QR] instance create error:', data.detail)
        if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null }
        return
      }
      if (data?.hash) saveEvo({ apiKey: data.hash })
      const b64 = data?.qrcode?.base64
      if (b64) {
        setQrImage(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
        if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null; setQrWaitSecs(0) }
      }
      await fetch('/api/evolution/instance/webhook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName }),
      }).catch(() => {})
    } catch (e) {
      console.error('[QR] instance create exception:', e)
    }

    pollRef.current = setInterval(async () => {
      await checkStatus(instanceName)
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
              <Typography sx={{ color: '#25d366', fontWeight: 700, fontSize: '1rem' }}>¡Número vinculado!</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', mt: 0.5, fontFamily: 'monospace' }}>{phoneInput || qrPhone}</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', mt: 0.5 }}>Los mensajes saldrán desde este número</Typography>
              <Box onClick={handleCloseQr} sx={{ mt: 2.5, px: 3, py: 0.8, borderRadius: 2, cursor: 'pointer', display: 'inline-block', bgcolor: 'rgba(37,211,102,0.15)', border: '1px solid rgba(37,211,102,0.3)', '&:hover': { bgcolor: 'rgba(37,211,102,0.25)' } }}>
                <Typography sx={{ color: '#25d366', fontSize: '0.82rem', fontWeight: 600 }}>Listo</Typography>
              </Box>
            </Box>
          )}

          {qrStatus === 'error' && (
            <Box sx={{ py: 1.5, px: 2, bgcolor: 'rgba(248,113,113,0.06)', borderRadius: 2, border: '1px solid rgba(248,113,113,0.2)' }}>
              <Typography sx={{ color: '#f87171', fontSize: '0.85rem' }}>
                No se pudo crear la instancia. Verifica que Evolution API esté activo y la API Key sea correcta.
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>

    </Box>
  )
}
