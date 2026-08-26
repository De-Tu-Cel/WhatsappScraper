// Fuente única de verdad para la clasificación de conversaciones (categoría,
// color, ícono). La usan analytics.jsx (tabla/filtros) y conversations.jsx
// (chip en la lista de chats) para que ambos apartados muestren exactamente
// los mismos íconos de MUI en vez de duplicar/desincronizar emojis.
import PersonIcon from '@mui/icons-material/Person'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import SyncAltIcon from '@mui/icons-material/SyncAlt'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PsychologyIcon from '@mui/icons-material/Psychology'
import SpeakerNotesOffIcon from '@mui/icons-material/SpeakerNotesOff'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'

export const CATEGORY_CONFIG = {
  humano:     { tKey: 'human',     color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   icon: PersonIcon },
  automatico: { tKey: 'automatic', color: '#facc15', bg: 'rgba(250,204,21,0.12)',  icon: FlashOnIcon },
  hibrido:    { tKey: 'hybrid',    color: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  icon: SyncAltIcon },
  bot:        { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: SmartToyIcon },
  // "menu" ya no la produce el clasificador (se fusionó con "bot") — se mantiene aquí
  // solo para que análisis viejos guardados con esa categoría se muestren igual que "bot".
  menu:       { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: SmartToyIcon },
  bot_ia:     { tKey: 'botAi',     color: '#c084fc', bg: 'rgba(192,132,252,0.15)', icon: PsychologyIcon },
  sin_respuesta: { tKey: 'noReply', color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: SpeakerNotesOffIcon },
}

export const NO_CLASS_CONFIG = { tKey: 'noClass', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: HourglassEmptyIcon }

// Normaliza la categoría legado "menu" a la vigente "bot" para filtros/conteos — la
// categoría mostrada en la tabla ya se resuelve vía CATEGORY_CONFIG.
export const normCategory = cat => (cat === 'menu' ? 'bot' : cat)

// "bot" y "bot_ia" son mutuamente excluyentes según el flag is_ai, no dos
// categorías independientes — se usa para que stats y filtros cuenten igual
// que lo que se ve en la columna Categoría de la tabla.
export const matchesCategory = (row, cat) => {
  const nc = normCategory(row.category)
  if (nc !== 'bot') return nc === cat
  return cat === 'bot_ia' ? !!row.is_ai : cat === 'bot' ? !row.is_ai : false
}

export function getCategoryConfig(row) {
  if (row.category === 'bot' && row.is_ai) return CATEGORY_CONFIG.bot_ia
  return CATEGORY_CONFIG[row.category] || NO_CLASS_CONFIG
}
