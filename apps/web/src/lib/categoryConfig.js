// Fuente única de verdad para la clasificación de conversaciones (categoría,
// color, ícono). La usan analytics.jsx (tabla/filtros) y conversations.jsx
// (chip en la lista de chats) para que ambos apartados muestren exactamente
// los mismos íconos de MUI en vez de duplicar/desincronizar emojis.
import PersonIcon from '@mui/icons-material/Person'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PsychologyIcon from '@mui/icons-material/Psychology'
import SpeakerNotesOffIcon from '@mui/icons-material/SpeakerNotesOff'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import PersonOffIcon from '@mui/icons-material/PersonOff'
import TimerOffIcon from '@mui/icons-material/TimerOff'

export const CATEGORY_CONFIG = {
  humano:     { tKey: 'human',     color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   icon: PersonIcon },
  automatico: { tKey: 'automatic', color: '#facc15', bg: 'rgba(250,204,21,0.12)',  icon: FlashOnIcon },
  // Respuesta automática al instante y después nadie contestó el 2do mensaje.
  automatico_sin_respuesta: { tKey: 'autoNoReply', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: TimerOffIcon },
  // Mismo concepto que "automatico" (Automático + Humano) — se muestra igual.
  hibrido_automatico: { tKey: 'automatic', color: '#facc15', bg: 'rgba(250,204,21,0.12)', icon: FlashOnIcon },
  bot:        { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: SmartToyIcon },
  // "menu" ya no la produce el clasificador (se fusionó con "bot") — se mantiene aquí
  // solo para que análisis viejos guardados con esa categoría se muestren igual que "bot".
  menu:       { tKey: 'bot',       color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: SmartToyIcon },
  bot_ia:     { tKey: 'botAi',     color: '#c084fc', bg: 'rgba(192,132,252,0.15)', icon: PsychologyIcon },
  sin_respuesta: { tKey: 'noReply', color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: SpeakerNotesOffIcon },
}

export const NO_CLASS_CONFIG = { tKey: 'noClass', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: HourglassEmptyIcon }

// Stored diagnoses remain available; public categories group human-assisted bots.
export const normCategory = cat => {
  if (['menu', 'hibrido', 'hibrido_bot'].includes(cat)) return 'bot'
  return cat === 'hibrido_automatico' ? 'automatico' : cat
}

// "bot" y "bot_ia" son mutuamente excluyentes según el flag is_ai, no dos
// categorías independientes — se usa para que stats y filtros cuenten igual
// que lo que se ve en la columna Categoría de la tabla.
export const matchesCategory = (row, cat) => {
  const nc = normCategory(row.category)
  if (nc !== 'bot') return nc === cat
  if (['hibrido', 'hibrido_bot'].includes(row.category)) return cat === 'bot'
  return cat === 'bot_ia' ? !!row.is_ai : cat === 'bot' ? !row.is_ai : false
}

export function getCategoryConfig(row) {
  const nc = normCategory(row.category)
  if (['bot', 'menu'].includes(row.category) && row.is_ai) return CATEGORY_CONFIG.bot_ia
  return CATEGORY_CONFIG[nc] || NO_CLASS_CONFIG
}

// Resultados de la comparación de clasificadores (Timing / IA / Timing + IA — ver
// apps/api/app/classification_compare.py). Son los resultados del diagrama de flujo
// determinista; cada clasificador se lleva a uno de ellos para poder compararlos.
export const COMMON_CONFIG = {
  humano:                      { tKey: 'human',      color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   icon: PersonIcon },
  humano_o_desconectado:       { tKey: 'humanOrOff', color: '#86c99a', bg: 'rgba(134,201,154,0.12)', icon: PersonOffIcon },
  automatico_humano:           { tKey: 'automatic',  color: '#facc15', bg: 'rgba(250,204,21,0.12)',  icon: FlashOnIcon },
  automatico_sin_respuesta:    { tKey: 'autoNoReply', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: TimerOffIcon },
  bot:                         { tKey: 'bot',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: SmartToyIcon },
  agente_ia:                   { tKey: 'botAi',      color: '#c084fc', bg: 'rgba(192,132,252,0.15)', icon: PsychologyIcon },
  sin_respuesta:               { tKey: 'noReply',    color: '#f87171', bg: 'rgba(248,113,113,0.12)', icon: SpeakerNotesOffIcon },
  pendiente:                   { tKey: 'pending',    color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', icon: HourglassEmptyIcon },
}

export function getCommonConfig(common) {
  return COMMON_CONFIG[common] || NO_CLASS_CONFIG
}
