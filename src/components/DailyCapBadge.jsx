'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { getOverBy, buildRecommendation } from '../lib/dailyCap'
import { useLang } from '../context/LangContext'

export { getOverBy }

// Chip "X/Y hoy" (mismo estilo que ya vivía inline en sendCampaign.jsx) + al
// hacer hover, desglose por instancia (warmup o no) — antes solo existía el
// total combinado, sin decir de dónde salía cada número.
export default function DailyCapBadge({ stats, selectionCount = 0, newSelectionCount = selectionCount, sx }) {
  const { lang } = useLang()
  if (!stats) return null

  // Dos formas posibles de `stats`: la de "hoy" (GET /api/instances/daily-stats,
  // con total_sent + instances[] por instancia) y la reducida de un día futuro
  // (GET /api/instances/capacity-for-date, solo total_cap/total_available — no hay
  // manera de saber qué instancia atenderá una empresa aún no contactada antes de
  // que llegue esa fecha, así que no hay desglose por instancia posible ahí).
  const isFutureMode = stats.total_sent === undefined
  const used      = isFutureMode ? (stats.scheduled_that_day || 0) : (stats.total_sent + (stats.scheduled_today || 0))
  const cap       = stats.total_cap
  const available = stats.total_available
  const overBy    = getOverBy(stats, selectionCount, newSelectionCount)
  const danger    = available <= 0 || overBy > 0
  const warn      = !danger && available < 30
  // Ámbar, no rojo — agotar el cupo se resetea solo a medianoche, no es una
  // falla del sistema (eso sí es rojo: instancia desconectada, error de envío).
  const color     = danger ? '#f59e0b' : warn ? '#fbbf24' : 'var(--text-muted)'
  const border    = danger ? 'rgba(245,158,11,0.3)' : warn ? 'rgba(251,191,36,0.25)' : 'var(--border)'
  const bg        = danger ? 'rgba(245,158,11,0.06)' : warn ? 'rgba(251,191,36,0.05)' : 'var(--item-hover)'
  const remaining = Math.max(0, available - selectionCount)
  const recommendation = buildRecommendation(stats)

  const tooltip = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, py: 0.3, minWidth: 200 }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700 }}>
        {isFutureMode
          ? (lang === 'en'
              ? <>Estimated for that day: {available} available of {cap} ({used} already scheduled)</>
              : <>Estimado para ese día: {available} disponibles de {cap} ({used} ya programados)</>)
          : (lang === 'en'
              ? <>Today you can contact up to {available} of {cap} — you&apos;ve used {used} ({stats.total_sent} sent{stats.scheduled_today ? ` + ${stats.scheduled_today} scheduled` : ''})</>
              : <>Hoy puedes contactar hasta {available} de {cap} — ya usaste {used} ({stats.total_sent} enviados{stats.scheduled_today ? ` + ${stats.scheduled_today} programados` : ''})</>)}
      </Typography>
      {(stats.instances || []).map(r => (
        <Box key={r.instance} sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, fontSize: '0.68rem' }}>
            <Box component="span" sx={{ flex: 1, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}{r.warmup_mode ? (lang === 'en' ? ' · warmup' : ' · warmup') : ''}
            </Box>
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.sent_today}/{r.cap}</Box>
          </Box>
          {r.new_contacts_limit != null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5 }}>
              <Box component="span" sx={{ fontSize: '0.62rem', color: r.new_contacts_today >= r.new_contacts_limit ? '#f59e0b' : 'rgba(74,222,128,0.75)', flex: 1 }}>
                {lang === 'en' ? '↳ new contacts:' : '↳ contactos nuevos:'}
              </Box>
              <Box component="span" sx={{ fontSize: '0.62rem', fontVariantNumeric: 'tabular-nums', color: r.new_contacts_today >= r.new_contacts_limit ? '#f59e0b' : 'rgba(74,222,128,0.75)', flexShrink: 0 }}>
                {r.new_contacts_today}/{r.new_contacts_limit}
              </Box>
            </Box>
          )}
        </Box>
      ))}
      {overBy > 0 && (
        <Typography sx={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, mt: 0.3 }}>
          {lang === 'en' ? `Your selection exceeds the cap by ${overBy}` : `Tu selección excede el cupo por ${overBy}`}
        </Typography>
      )}
      <Typography sx={{ fontSize: '0.62rem', opacity: 0.55 }}>{lang === 'en' ? 'Resets at 00:00 UTC' : 'Reinicia a las 00:00 UTC'}</Typography>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.3, ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title={tooltip} placement="top">
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px',
            px: 1, py: 0.4, borderRadius: 1.5, border: `1px solid ${border}`,
            bgcolor: bg, cursor: 'default',
          }}>
            <Typography sx={{ fontSize: '0.7rem', color, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontWeight: 700 }}>{used}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
              <span style={{ color: 'var(--text-muted)' }}>{cap}</span>
            </Typography>
            <Typography sx={{ fontSize: '0.58rem', color: 'var(--text-muted)', lineHeight: 1 }}>
              {isFutureMode ? (lang === 'en' ? 'that day' : 'ese día') : (lang === 'en' ? 'today' : 'hoy')}
            </Typography>
          </Box>
        </Tooltip>
        <Tooltip title={recommendation} placement="top" arrow>
          <InfoOutlinedIcon sx={{ fontSize: 13, color: 'var(--text-muted)', cursor: 'help' }} />
        </Tooltip>
      </Box>
      <Typography sx={{ fontSize: '0.62rem', color: remaining <= 0 ? '#f59e0b' : 'var(--text-muted)' }}>
        {selectionCount > 0
          ? (lang === 'en' ? `→ ${remaining} remaining if you confirm` : `→ quedarían ${remaining} si confirmas`)
          : (lang === 'en'
              ? `${available} sends available ${isFutureMode ? 'that day' : 'today'}`
              : `${available} envíos disponibles ${isFutureMode ? 'ese día' : 'hoy'}`)}
      </Typography>
      {!isFutureMode && stats.new_contacts_capacity != null && (() => {
        const ncRemaining = Math.max(0, stats.new_contacts_capacity - newSelectionCount)
        return (
          <Typography sx={{ fontSize: '0.62rem', color: ncRemaining <= 0 ? '#f59e0b' : 'rgba(74,222,128,0.75)' }}>
            {lang === 'en'
              ? `${ncRemaining} new contacts available today`
              : `${ncRemaining} contactos nuevos disponibles hoy`}
          </Typography>
        )
      })()}
    </Box>
  )
}
