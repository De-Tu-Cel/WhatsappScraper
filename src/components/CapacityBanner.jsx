'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { getOverBy } from '../lib/dailyCap'
import { useLang } from '../context/LangContext'

// Aviso prominente de cuántos contactos nuevos se pueden comunicar hoy — mismo
// peso visual que el aviso naranja de "selecciona al menos 3 plantillas", para
// que no se pierda como texto chico junto al botón de enviar (ahí sigue
// viviendo DailyCapBadge, con el desglose por instancia al hacer hover).
export default function CapacityBanner({ stats, selectionCount = 0, sx }) {
  const { lang } = useLang()
  if (!stats) return null
  const available    = stats.total_available
  const overBy       = getOverBy(stats, selectionCount)
  const remaining     = Math.max(0, available - selectionCount)
  const isFutureMode  = stats.total_sent === undefined
  const blocked       = overBy > 0
  const warn          = !blocked && remaining < 30

  // Rojo se reserva para fallas reales (sin instancia conectada, error de envío)
  // — agotar el cupo del día no es una falla, es un límite que se resetea solo
  // a medianoche, así que se queda en la familia ámbar/amarillo, no rojo.
  const color  = blocked ? '#f59e0b' : warn ? '#fbbf24' : '#4ade80'
  const bg     = blocked ? 'rgba(245,158,11,0.08)' : warn ? 'rgba(251,191,36,0.08)' : 'rgba(34,197,94,0.06)'
  const border = blocked ? 'rgba(245,158,11,0.25)' : warn ? 'rgba(251,191,36,0.25)' : 'rgba(34,197,94,0.2)'

  const when = isFutureMode ? (lang === 'en' ? 'that day' : 'ese día') : (lang === 'en' ? 'today' : 'hoy')
  const label = blocked
    ? (lang === 'en'
        ? `⚠ Your selection exceeds the ${isFutureMode ? 'estimated' : "today's"} cap by ${overBy} — deselect some to continue.`
        : `⚠ Tu selección excede el cupo ${isFutureMode ? 'estimado' : 'de hoy'} por ${overBy} — desmarca algunos para continuar.`)
    : selectionCount > 0
      ? (lang === 'en'
          ? `Selected ${selectionCount} — ${remaining} sends still available ${when}.`
          : `Seleccionaste ${selectionCount} — quedarían ${remaining} envíos disponibles ${when}.`)
      : (lang === 'en'
          ? `You can send up to ${available} messages ${when} without exceeding your daily limit.`
          : `Puedes enviar hasta ${available} mensajes ${when} sin pasar tu límite diario.`)

  return (
    <Box sx={{ px: 1.5, py: 0.8, borderRadius: 1.5, bgcolor: bg, border: `1px solid ${border}`, ...sx }}>
      <Typography sx={{ fontSize: '0.75rem', color, fontWeight: 600 }}>{label}</Typography>
    </Box>
  )
}
