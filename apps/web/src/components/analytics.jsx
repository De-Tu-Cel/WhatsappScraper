'use client'
import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react'
import useSWR from 'swr'
import { createPortal } from 'react-dom'
import WhatsAppText from './WhatsAppText'
import { useLang } from '../context/LangContext'
import { useUser } from '../context/UserContext'
import { authFetch } from '@/lib/api'
import { STAT_STRIP_BG } from '@/lib/surfaces'
import { parseVCards, documentType, splitInlineOptions, mediaCaption, MEDIA_PLACEHOLDERS } from '@/lib/messageFormat'
import { parseUtc, mxDayKey } from '@/lib/dates'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import Pagination from '@mui/material/Pagination'
import Select from '@mui/material/Select'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import Divider from '@mui/material/Divider'
import BarChartIcon from '@mui/icons-material/BarChart'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import PersonIcon from '@mui/icons-material/Person'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import FlashOnIcon from '@mui/icons-material/FlashOn'
import StarIcon from '@mui/icons-material/Star'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import EvaluacionDialog from './EvaluacionDialog'
import SendIcon from '@mui/icons-material/Send'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import PsychologyIcon from '@mui/icons-material/Psychology'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import SpeakerNotesOffIcon from '@mui/icons-material/SpeakerNotesOff'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Checkbox from '@mui/material/Checkbox'
import GroupIcon from '@mui/icons-material/Group'
import AndyBotBuilder from './AndyBotBuilder'
import GasBotModal from './GasBotModal'
import ClassificationSettingsModal from './ClassificationSettingsModal'
import TimerOffIcon from '@mui/icons-material/TimerOff'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import { ResultChip, ComparisonDialog, ComparisonSummary, ClassifierHelp, ParecidoCell, refreshComparisonSummary, last10 } from './ClassifierComparison'
import ConversationAnalysisButton from './ConversationAnalysisButton'
import ChatBubbleOutlineIcon from '@mui/icons-material/ForumOutlined'
import { CATEGORY_CONFIG, normCategory, matchesCategory, getCategoryConfig } from '@/lib/categoryConfig'

// Same palette/hash as conversations.jsx's agentColor — an agent's dot in the
// conversation list and their avatar here end up the same color.
const AGENT_COLORS = [
  '#60a5fa', '#4ade80', '#f472b6', '#fb923c',
  '#a78bfa', '#34d399', '#f87171', '#facc15',
]
function agentColor(name) {
  if (!name) return 'rgba(255,255,255,0.35)'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]
}

const GAS_INDUSTRY_KEYWORDS = ['gas', 'lp', 'gasera', 'gaseras', 'energia']

function isGasIndustry(industry) {
  const norm = (industry || '')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '') // strip accents
  if (!norm) return false
  return GAS_INDUSTRY_KEYWORDS.some(kw => new RegExp(`\\b${kw}\\b`).test(norm))
}

function QualityDots({ score, color }) {
  const { lang } = useLang()
  const rated = typeof score === 'number' && Number.isFinite(score) && score >= 1 && score <= 5
  if (!rated) return <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>—</Typography>
  const filled = Math.round(score)
  const label = `${Number(score.toFixed(1))} / 5`
  return <Tooltip title={lang === 'en' ? `${label}. Estimated service quality: professionalism, understanding, empathy, solution, next step and initiative. It is not classification confidence.` : `${label}. Calidad estimada de atención: profesionalismo, comprensión, empatía, solución, siguiente paso e iniciativa. No es confianza de clasificación.`}>
    <Box aria-label={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.7 }}>
      <Box sx={{ display: 'flex', gap: 0.3 }}>{[1,2,3,4,5].map(i => <Box key={i} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: i <= filled ? color : 'var(--border)' }} />)}</Box>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontVariantNumeric: 'tabular-nums' }}>{Number(score.toFixed(1))}</Typography>
    </Box>
  </Tooltip>
}

function formatReactionTime(minutes, seconds) {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 0) return '—'
  if (minutes < 1) {
    const s = seconds != null ? Math.round(seconds) : Math.round(minutes * 60)
    return `${s}s`
  }
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function BusinessHoursChip({ value }) {
  const { lang } = useLang()
  if (value === null || value === undefined) {
    return <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem' }}>—</Typography>
  }
  return value ? (
    <Chip label={lang === 'en' ? 'Business hrs' : 'Hábil'} size="small" sx={{
      height: 18, fontSize: '0.65rem',
      bgcolor: 'rgba(34,197,94,0.12)', color: '#4ade80',
      border: '1px solid rgba(34,197,94,0.25)',
    }} />
  ) : (
    <Chip label={lang === 'en' ? 'Off hours' : 'Fuera'} size="small" sx={{
      height: 18, fontSize: '0.65rem',
      bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)',
      border: '1px solid rgba(255,255,255,0.1)',
    }} />
  )
}

const _TZ = 'America/Mexico_City'

function formatLastAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diff = now - d
  if (diff < 0) return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
  if (diff < 60000) return 'ahora'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: _TZ })
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
}

const CELL_SX = {
  borderBottom: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: '0.82rem',
  py: 1.5,
  px: 1.5,
}

const COMPANY_PIN_SX = {
  position: 'sticky', left: 32, zIndex: 1, width: 260, minWidth: 260, maxWidth: 260,
  bgcolor: 'var(--card-bg)', boxShadow: '3px 0 8px rgba(0,0,0,0.08)',
}
const EXPAND_PIN_SX = {
  position: 'sticky', left: 0, zIndex: 1, width: 32, minWidth: 32, maxWidth: 32,
  boxSizing: 'border-box', bgcolor: 'var(--card-bg)',
}
const ACTION_GROUP_SX = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.7,
  '& .MuiIconButton-root': { width: 32, height: 32, borderRadius: '9px', border: '1px solid var(--border)', bgcolor: 'var(--item-hover)' },
}
// Shared geometry keeps the loading state aligned with the populated table.
function AnalyticsColumns() {
  return <colgroup>{[32, 260, 130, 150, 112, 112, 112, 148, 90, 130, 110, 240, 45, 45, 45].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
}

function AnalyticsRowsSkeleton({ count }) {
  return <TableBody data-analytics-loading aria-label="Loading analysis" sx={{ '& .MuiSkeleton-root': { bgcolor: 'var(--item-hover)' }, '@media (prefers-reduced-motion: reduce)': { '& .MuiSkeleton-root::after': { animation: 'none' } } }}>
    {Array.from({ length: Math.min(count, 15) }, (_, row) => <TableRow key={row} sx={{ height: 96 }}>
      <TableCell sx={{ ...CELL_SX, ...EXPAND_PIN_SX, px: 0.5 }}><Skeleton variant="rounded" width={18} height={18} /></TableCell>
      <TableCell sx={{ ...CELL_SX, ...COMPANY_PIN_SX }}>
        <Skeleton width={row % 2 ? '72%' : '88%'} height={19} />
        <Skeleton width="56%" height={14} sx={{ mb: 0.8 }} />
        <Box sx={{ display: 'flex', gap: 0.7 }}><Skeleton variant="rounded" width={102} height={26} sx={{ borderRadius: '9px' }} /><Skeleton variant="rounded" width={26} height={26} sx={{ borderRadius: '9px' }} /></Box>
      </TableCell>
      <TableCell sx={CELL_SX}><Skeleton width="88%" height={17} sx={{ mx: 'auto' }} /></TableCell>
      <TableCell sx={CELL_SX}><Skeleton width="80%" height={17} sx={{ mx: 'auto' }} /></TableCell>
      {[0, 1, 2].map(i => <TableCell key={i} sx={{ ...CELL_SX, ...ANALYSIS_CELL_SX }}><Skeleton variant="rounded" width={78} height={22} sx={{ mx: 'auto', borderRadius: '6px' }} /></TableCell>)}
      <TableCell sx={CELL_SX}><Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, alignItems: 'center' }}><Skeleton variant="rounded" width={90} height={20} /><Skeleton variant="rounded" width={112} height={20} /></Box></TableCell>
      <TableCell sx={CELL_SX}><Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.4 }}>{[0,1,2,3,4].map(i => <Skeleton key={i} variant="circular" width={6} height={6} />)}</Box></TableCell>
      {[0,1].map(i => <TableCell key={i} sx={CELL_SX}><Skeleton width={i ? 48 : 38} height={17} sx={{ mx: 'auto' }} /></TableCell>)}
      <TableCell sx={CELL_SX}><Skeleton width="90%" height={16} sx={{ mx: 'auto' }} /><Skeleton width="70%" height={16} sx={{ mx: 'auto' }} /></TableCell>
      <TableCell colSpan={3} sx={CELL_SX}><Box sx={ACTION_GROUP_SX}>{[0,1,2].map(i => <Skeleton key={i} variant="rounded" width={32} height={32} sx={{ borderRadius: '9px' }} />)}</Box></TableCell>
    </TableRow>)}
  </TableBody>
}

const SORT_LABEL_CENTER_SX = {
  width: '100%',
  position: 'relative',
  justifyContent: 'center',
  color: 'rgba(255,255,255,0.5) !important',
  '& .MuiTableSortLabel-icon': {
    position: 'absolute',
    right: 0,
    margin: 0,
    color: 'rgba(255,255,255,0.3) !important',
  },
  '&.Mui-active': { color: 'white !important' },
}

// Short vertical divider between header columns (inset from top/bottom, not
// touching the cell's edges) — same pattern as the Prospects table header.
const HEADER_CELL_SX = {
  bgcolor: 'var(--card-bg, #161d2e)',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '0.72rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  py: 1.2,
  px: 1.5,
  position: 'sticky',
  top: 'var(--analytics-filter-height, 0px)',
  zIndex: 2,
  '&::after': {
    content: '""', position: 'absolute', top: 10, bottom: 10, right: 0,
    width: '1px', bgcolor: 'rgba(255,255,255,0.08)',
  },
}

// Last column in each header row — no divider needed after it (nothing to
// separate from the table's own edge).
const HEADER_CELL_LAST_SX = { ...HEADER_CELL_SX, '&::after': { display: 'none' } }

// Grupo "Análisis" (Timing / IA / Timing + IA): encabezado de dos niveles con una línea
// bajo el título del grupo. Colores neutros a propósito — con el color de la paleta el
// bloque cambiaba de tono según el tema.
const ANALYSIS_ROW_H = 26   // alto de la fila "Análisis" del encabezado
const ANALYSIS_SUB_H = 36   // alto de la fila Timing / IA / Timing + IA
const ANALYSIS_COL_W = 112
const ANALYSIS_FRAME = '1px solid rgba(255,255,255,0.07)'
const ANALYSIS_GROUP_SX = { color: 'rgba(255,255,255,0.62)', letterSpacing: '0.14em', '&::after': { display: 'none' } }
const ANALYSIS_SUB_SX = {
  height: ANALYSIS_SUB_H, py: 0, color: 'rgba(255,255,255,0.5)',
  top: `calc(var(--analytics-filter-height, 0px) + var(--analytics-group-height, ${ANALYSIS_ROW_H}px))`,
}
const ANALYSIS_CELL_SX = { px: 0.75, width: ANALYSIS_COL_W }

// One section of the shared stats card (icon + label + value) — no border of
// its own; lives inside ONE outer card together with the others, separated by
// vertical Dividers. Same pattern as Prospects' StatCard (databaseViewer.jsx),
// replacing the loose separate-chip pills this screen used to render. The
// icon ring is a conic-gradient progress ring (like the reference invoice
// card's Paid/Pending/Overdue rings) showing `percent` (0-100) of the total
// that this stat represents, instead of a flat solid-color outline.
function StatCard({ icon, color, value, label, subtitle, percent }) {
  const pct = percent == null ? 100 : Math.max(0, Math.min(100, percent))
  // minWidth kept low (vs. the old 150px floor) and every text node gets
  // overflow+ellipsis instead of a bare nowrap — a flex item's automatic
  // min-width is its content's min-content size unless overflow isn't
  // "visible", so a bare nowrap label ("Automático+Humano" etc.) silently
  // forced every card to at least that wide, and the row only ever grew to
  // wrap onto extra lines instead of actually shrinking with the tab.
  return (
    <Box sx={{
      flex: '1 1 0', minWidth: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.2,
      px: 1.6, py: 1.6, overflow: 'hidden',
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0, p: '3px',
        background: `conic-gradient(${color} ${pct}%, var(--border, rgba(255,255,255,0.12)) ${pct}% 100%)`,
      }}>
        <Box sx={{
          width: '100%', height: '100%', borderRadius: '50%',
          bgcolor: 'var(--card-bg, rgba(255,255,255,0.02))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography title={label} sx={{ fontSize: '0.8rem', color: 'var(--text)', fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
          {label}
        </Typography>
        {subtitle && (
          <Typography title={subtitle} sx={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </Typography>
        )}
        <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', lineHeight: 1.4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </Typography>
      </Box>
    </Box>
  )
}

// Same shape as the real stats card (outer bordered strip, 8 sections split
// by vertical dividers, icon-ring circle + 2 text lines each) so the stats
// row doesn't just vanish and pop back in — matching StatCard's layout keeps
// the page height stable while analytics data is loading.
// Seven public metrics, with wrapping on smaller panels. Human-assisted bots
// share the Bot metric. Dividers do not occupy grid cells.
const STAT_DIVIDER = { content: '""', position: 'absolute', backgroundColor: 'var(--border, rgba(255,255,255,0.08))' }
const STAT_STRIP_SX = {
  containerType: 'inline-size', overflow: 'hidden', flexShrink: 0,
  borderRadius: 2.5, border: '1px solid var(--border, rgba(255,255,255,0.08))',
  background: STAT_STRIP_BG,
}
const STAT_GRID_SX = {
  display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  '& > *': { position: 'relative' },
  '& > *:not(:first-of-type)::before': { ...STAT_DIVIDER, left: 0, top: '16px', bottom: '16px', width: '1px' },
  '@container (max-width: 1200px)': {
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    '& > *:nth-of-type(4n+1)::before': { display: 'none' },
    '& > *:nth-of-type(n+5)::after': { ...STAT_DIVIDER, top: 0, left: '16px', right: '16px', height: '1px' },
  },
  '@container (max-width: 480px)': {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    '& > *:nth-of-type(2n+1)::before': { display: 'none' },
    '& > *:nth-of-type(n+3)::after': { ...STAT_DIVIDER, top: 0, left: '16px', right: '16px', height: '1px' },
  },
}

function StatsCardSkeleton() {
  return (
    <Box sx={STAT_STRIP_SX}>
      <Box sx={STAT_GRID_SX}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Box key={i} sx={{ minWidth: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.2, px: 1.6, py: 1.6, overflow: 'hidden' }}>
            <Skeleton variant="circular" width={40} height={40} sx={{ bgcolor: 'rgba(255,255,255,0.1)', flexShrink: 0,
              '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)' } }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Skeleton variant="text" width="70%" sx={{ bgcolor: 'rgba(255,255,255,0.1)', fontSize: '0.85rem',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)' } }} />
              <Skeleton variant="text" width="50%" sx={{ bgcolor: 'rgba(255,255,255,0.1)', fontSize: '1.4rem',
                '&::after': { background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)' } }} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Cómo se ve cada mensaje en el screenshot del reporte: el mismo criterio que Conversaciones
// (opciones como botones, contacto como tarjeta, foto, documento, multimedia) pero en colores
// claros. Antes imprimía el texto crudo: "[Opciones: Español | English…]", "BEGIN:VCARD…"
// (Taboo Restaurant, 2026-10-06). Íconos con emoji en vez de SVG: html2canvas los dibuja seguro.
const CAPTURE_EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif'

function CaptureBody({ msg, isOut }) {
  const raw = msg.body || msg.message_body || ''
  const ink = isOut ? '#1e40af' : '#1e293b'
  const soft = isOut ? 'rgba(37,99,235,0.07)' : '#f1f5f9'
  const line = isOut ? 'rgba(37,99,235,0.25)' : 'rgba(15,23,42,0.12)'
  const textSx = { color: ink, fontSize: '13px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: CAPTURE_EMOJI_FONT }
  const caption = mediaCaption(raw, msg.media_url)
  const interactive = msg.interactive || (!isOut ? splitInlineOptions(raw) : null)
  const isImage = Boolean(msg.media_url) && (msg.media_content_type || '').startsWith('image/')

  if (interactive && (interactive.options || []).length) {
    return (
      <Box>
        {interactive.text && <Box sx={{ ...textSx, mb: '8px' }}><WhatsAppText text={interactive.text} /></Box>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '5px', borderTop: `1px solid ${line}`, pt: '8px' }}>
          {interactive.options.map((opt, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '8px', py: '5px',
              borderRadius: '8px', border: `1px solid ${line}`, bgcolor: soft }}>
              <Box sx={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', bgcolor: '#ffffff', border: `1px solid ${line}`,
                color: '#64748b', fontSize: '10px', fontWeight: 700 }}>{i + 1}</Box>
              <Box sx={{ color: '#2563eb', fontSize: '12.5px', fontWeight: 600, fontFamily: CAPTURE_EMOJI_FONT }}>{opt}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  if (raw.includes('BEGIN:VCARD')) {
    const cards = parseVCards(raw)
    if (cards.length) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {cards.map((c, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: '9px', px: '10px', py: '7px', minWidth: 190,
              borderRadius: '10px', border: `1px solid ${line}`, bgcolor: soft }}>
              <Box sx={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', bgcolor: '#e2e8f0', fontSize: '16px',
                fontFamily: CAPTURE_EMOJI_FONT }}>👤</Box>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ color: ink, fontSize: '13px', fontWeight: 700, lineHeight: 1.25 }}>{c.fn || 'Contacto'}</Box>
                {c.biz && c.biz !== c.fn && <Box sx={{ color: '#64748b', fontSize: '11px', lineHeight: 1.25 }}>{c.biz}</Box>}
                {c.tel && <Box sx={{ color: '#64748b', fontSize: '11px', lineHeight: 1.25, fontFamily: 'monospace' }}>{c.tel}</Box>}
              </Box>
            </Box>
          ))}
        </Box>
      )
    }
  }

  if (isImage) {
    const sticker = raw.trim().toLowerCase() === '[sticker]'
    // Por la ruta /api/files de esta misma app: una imagen de otro dominio sin CORS deja el
    // canvas "contaminado" y html2canvas ya no puede exportar el screenshot.
    const src = (msg.media_url || '').replace(/^https?:\/\/[^/]+(?=\/api\/files\/)/i, '')
    return (
      <Box>
        <Box component="img" src={src} alt=""
          sx={sticker ? { width: 96, height: 96, objectFit: 'contain', display: 'block' }
                      : { maxWidth: 240, maxHeight: 280, width: '100%', borderRadius: '8px', display: 'block', objectFit: 'cover' }} />
        {caption && <Box sx={{ ...textSx, mt: '6px' }}><WhatsAppText text={caption} /></Box>}
      </Box>
    )
  }

  if (msg.media_url) {
    const doc = documentType(msg.media_content_type, 'Documento')
    const accent = doc.color || '#64748b'
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', px: '8px', py: '6px', borderRadius: '8px',
          border: `1px solid ${line}`, bgcolor: soft }}>
          <Box sx={{ width: '28px', height: '28px', borderRadius: '7px', flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', bgcolor: `${accent}22`, border: `1px solid ${accent}55`, fontSize: '14px',
            fontFamily: CAPTURE_EMOJI_FONT }}>📄</Box>
          <Box sx={{ color: ink, fontSize: '12.5px', fontWeight: 700 }}>{doc.label}</Box>
        </Box>
        {caption && <Box sx={{ ...textSx, mt: '6px' }}><WhatsAppText text={caption} /></Box>}
      </Box>
    )
  }

  const placeholder = MEDIA_PLACEHOLDERS[raw.trim().toLowerCase()]
  if (placeholder || !raw.trim()) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '12.5px', fontStyle: 'italic' }}>
        <Box component="span" sx={{ fontStyle: 'normal', fontFamily: CAPTURE_EMOJI_FONT }}>{placeholder ? placeholder.emoji : '📎'}</Box>
        {placeholder ? placeholder.label.es : 'Mensaje sin texto (foto, audio o archivo)'}
      </Box>
    )
  }

  return <Box sx={textSx}><WhatsAppText text={raw} /></Box>
}

// Separador de día del screenshot del reporte, como el de Conversaciones pero siempre con la
// fecha completa y el día de la semana: "Hoy" o "Ayer" dejan de ser ciertos en cuanto el
// reporte se lee otro día, y el día de la semana dice si contestaron en fin de semana.
function captureDayLabel(date) {
  const s = date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: _TZ })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function CaptureDayDivider({ label, first }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: first ? 0 : '6px' }}>
      <Box sx={{ px: '10px', py: '3px', borderRadius: '99px', bgcolor: '#e2e8f0', border: '1px solid rgba(15,23,42,0.08)',
                 color: '#475569', fontSize: '10.5px', fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>
        {label}
      </Box>
    </Box>
  )
}

// Hidden conversation renderer for html2canvas
// Must be in the viewport (not left:-9999) so html2canvas can read it
function ConversationCapture({ thread, captureRef, visible }) {
  if (!visible) return null
  return createPortal(
    <Box data-report-capture-host aria-hidden="true" style={{ position: 'fixed', top: 0, left: -20000, pointerEvents: 'none', width: 520 }}>
      <Box
        ref={captureRef}
        data-report-capture
        sx={{
          width: 500,
          bgcolor: '#f8fafc',
          p: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {thread.map((msg, i) => {
          const isOut = msg.direction === 'outbound'
          // Un separador cada vez que cambia el día (en hora de Ciudad de México), incluido el
          // primero, para saber de qué día es cada mensaje.
          const at = parseUtc(msg.created_at)
          const day = at && !isNaN(at) ? mxDayKey(at) : null
          const prev = i > 0 ? parseUtc(thread[i - 1].created_at) : null
          const newDay = day && (!prev || isNaN(prev) || mxDayKey(prev) !== day)
          return (
            <Fragment key={i}>
            {newDay && <CaptureDayDivider label={captureDayLabel(at)} first={i === 0} />}
            <Box sx={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
              <Box sx={{
                maxWidth: '78%',
                px: '12px', py: '7px',
                borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                bgcolor: isOut ? '#dbeafe' : '#ffffff',
                border: `1px solid ${isOut ? 'rgba(37,99,235,0.25)' : 'rgba(0,0,0,0.1)'}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              }}>
                <CaptureBody msg={msg} isOut={isOut} />
                <Box sx={{ color: '#94a3b8', fontSize: '10px', mt: '3px',
                           textAlign: 'right', fontFamily: 'system-ui, sans-serif' }}>
                  {/* Same Mexico City time as Conversaciones — without timeZone the
                     screenshot took the zone of whichever computer made the report. */}
                  {msg.created_at ? new Date(msg.created_at.endsWith('Z') ? msg.created_at : msg.created_at + 'Z').toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: _TZ }) : ''}
                </Box>
              </Box>
            </Box>
            </Fragment>
          )
        })}
      </Box>
    </Box>, document.body
  )
}

export default function Analytics({ onNavigateToConv }) {
  const scrollRef = useRef(null)
  const filtersRef = useRef(null)
  const headerRowRef = useRef(null)
  const tableRegionRef = useRef(null)

  const [analyzeAttempts, setAnalyzeAttempts] = useState(0)
  const requeueSessionRef  = useRef(false)
  const requeueInFlight    = useRef(false)
  const remainingRef       = useRef(0)
  const prevAnalyzingRef   = useRef(false)
  const esRef              = useRef(null)  // active EventSource for SSE

  // ── SWR: caching + background revalidation ────────────────────────────────
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(15)
  const [filterCat, setFilterCat] = useState('all')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [filterAgents, setFilterAgents] = useState([])  // selected usernames
  const [searchText, setSearchText] = useState('')
  // Debounced separately from searchText — the input needs to feel instant while
  // typing, but searching now hits the server on every change (it has to: search
  // used to just filter the current page's 20 already-fetched rows, which is why
  // it never found matches outside whatever page happened to be open). Without
  // this, every keystroke would fire its own request instead of one per pause.
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchText), 350)
    return () => clearTimeout(id)
  }, [searchText])
  useEffect(() => { setPage(1) }, [searchQuery])
  const _swrFetcher = async url => {
    const response = await authFetch(url)
    if (!response.ok) throw new Error(`Error ${response.status}`)
    return response.json()
  }
  const _swrKey = `/api/analytics?page=${page}&page_size=${rowsPerPage}`
    + (filterCat !== 'all' ? `&category=${filterCat}` : '')
    + (filterAgents.length ? `&agents=${filterAgents.join(',')}` : '')
    + (searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '')
    + (reviewFilter !== 'all' ? `&review=${reviewFilter}` : '')
  const { data: _analyticsData, isLoading: loading, mutate: mutateAnalytics } = useSWR(
    _swrKey,
    _swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000, keepPreviousData: true }
  )
  useEffect(() => {
    const filters = filtersRef.current
    const scroll = scrollRef.current
    const header = headerRowRef.current
    const table = tableRegionRef.current?.querySelector('table')
    if (!filters || !scroll) return
    // Measure wrapping filters and the actual group row, including font scaling.
    const updateHeights = () => {
      // Keep dashboards and wrapping filters at viewport width while the table scrolls.
      const width = Math.ceil(scroll.clientWidth)
      const value = `${width}px`
      if (scroll.style.getPropertyValue('--analytics-content-width') !== value) {
        scroll.style.setProperty('--analytics-content-width', value)
      }
      scroll.style.setProperty('--analytics-filter-height', `${filters.getBoundingClientRect().height}px`)
      if (header) scroll.style.setProperty('--analytics-group-height', `${header.getBoundingClientRect().height}px`)
    }
    updateHeights()
    const observer = new ResizeObserver(updateHeights)
    observer.observe(filters)
    observer.observe(scroll)
    if (table) observer.observe(table)
    if (header) observer.observe(header)
    return () => observer.disconnect()
  }, [loading])
  const data           = _analyticsData?.items           || []
  const totalPages     = Math.max(1, _analyticsData?.pages || 1)
  const totalItems     = _analyticsData?.total           || 0
  // Same "persist last known value while loading" treatment as categoryCounts
  // below — computed over the WHOLE filtered set server-side now, not just
  // whatever page's 20 rows happened to already be fetched client-side.
  const _avgQRef = useRef(null)
  if (_analyticsData && 'avg_quality' in _analyticsData) _avgQRef.current = _analyticsData.avg_quality
  const avgQualityServer = _avgQRef.current
  // Persist last known agent list so the filter menu doesn't flicker empty while loading
  const _agentsRef = useRef([])
  if (_analyticsData?.agents) _agentsRef.current = _analyticsData.agents
  const allAgents = _agentsRef.current
  const [agentMenuAnchor, setAgentMenuAnchor] = useState(null)
  const toggleAgentFilter = (username) => {
    setFilterAgents(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username])
    setPage(1)
  }
  // Persist last known counts so filter chips never flicker to 0 while a new page/filter loads
  const _ccRef = useRef({})
  if (_analyticsData?.category_counts) _ccRef.current = _analyticsData.category_counts
  const categoryCounts = _ccRef.current
  const [generating, setGenerating]         = useState(null)
  const [reportThread, setReportThread]     = useState([])
  const [captureVisible, setCaptureVisible] = useState(false)
  const [expandedRows, setExpandedRows]     = useState(new Set())
  const [pendingReportConfirm, setPendingReportConfirm] = useState(null) // { row, filterNum, message, resolvesBy }
  const [reportPreview, setReportPreview] = useState(null) // { url, fileName }

  function toggleExpand(company_id) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(company_id) ? next.delete(company_id) : next.add(company_id)
      return next
    })
  }
  const captureRef = useRef(null)
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'error' })
  const notify = (message, severity = 'error') => setSnack({ open: true, message, severity })
  const [sortField, setSortField] = useState('last_at')
  const [sortDir, setSortDir]     = useState('desc')
  const [botBuilderOpen,  setBotBuilderOpen]  = useState(false)
  const [botBuilderRow,   setBotBuilderRow]   = useState(null)
  const [evalFor,         setEvalFor]         = useState(null)  // { id, name, number } → EvaluacionDialog
  const [gasBotOpen,      setGasBotOpen]      = useState(false)
  const [gasBotRow,       setGasBotRow]       = useState(null)
  const [classificationSettingsOpen, setClassificationSettingsOpen] = useState(false)
  const { user } = useUser()
  const isAdmin = user?.role === 'admin'
  // Comparación de clasificadores (Timing / IA / Timing + IA): fila cuyo log está abierto
  // y fila que se está comparando en este momento.
  const [compareFor, setCompareFor] = useState(null) // { id, name, number? }
  // Corre los tres clasificadores para esa conversación (una llamada a gpt-4.1-mini por
  // clasificador de IA, y por número que respondió en empresas con varios).
  function compareButton(row) {
    const busy = false
    return (
      <Button size="small" onClick={() => setCompareFor({ id: row.company_id, name: row.company_name })} disabled={busy}
        startIcon={busy ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <CompareArrowsIcon sx={{ fontSize: '14px !important' }} />}
        sx={{ textTransform: 'none', fontSize: '0.68rem', py: 0, minWidth: 0, color: 'var(--accent,#a5b4fc)' }}>
        {busy ? t.analytics.compareRunning : (lang === 'en' ? 'View analysis' : 'Ver análisis')}
      </Button>
    )
  }

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }


  // Queue the next batch of unanalyzed messages; returns the API response
  const triggerRequeue = useCallback(async () => {
    if (!isAdmin) return { queued: 0, remaining: 0 }
    if (requeueInFlight.current) return { queued: 0, remaining: remainingRef.current }
    requeueInFlight.current = true
    try {
      const res  = await authFetch('/api/admin/requeue-unanalyzed', { method: 'POST' })
      const json = await res.json()
      remainingRef.current = json.remaining ?? 0
      return json
    } catch { return { queued: 0, remaining: 0 } }
    finally { requeueInFlight.current = false }
  }, [isAdmin])

  // On mount: silently start auto-requeue if there are rezagados
  useEffect(() => {
    triggerRequeue().then(result => {
      if ((result.queued || 0) > 0) {
        requeueSessionRef.current = true
        setPage(1)  // SWR auto-fetches page 1 when key changes
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // SSE: replace 8s polling — server pushes when pending count changes
  const MAX_ANALYZE_ATTEMPTS = 20
  useEffect(() => {
    const hasAnalyzing = data.some(r => r.analyzing)

    // analyzing → false transition: queue next batch
    if (!hasAnalyzing && prevAnalyzingRef.current && requeueSessionRef.current) {
      if (remainingRef.current > 0) {
        triggerRequeue().then(result => {
          if ((result.queued || 0) > 0) {
            setAnalyzeAttempts(0)
            mutateAnalytics()
          } else {
            requeueSessionRef.current = false
          }
        })
      } else {
        requeueSessionRef.current = false
      }
    }
    prevAnalyzingRef.current = hasAnalyzing

    if (!hasAnalyzing) {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      if (analyzeAttempts > 0) setAnalyzeAttempts(0)
      return
    }
    if (analyzeAttempts >= MAX_ANALYZE_ATTEMPTS) return
    if (esRef.current) return  // already listening

    // Open SSE connection — server pushes when pending count drops to 0
    const es = new EventSource('/api/analytics/stream')
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const { pending } = JSON.parse(e.data)
        if (pending === 0) {
          setAnalyzeAttempts(a => a + 1)
          mutateAnalytics()
          es.close(); esRef.current = null
        }
      } catch {}
    }
    es.onerror = () => {
      es.close(); esRef.current = null
      // Fallback: 8s timeout if SSE fails
      setTimeout(() => { setAnalyzeAttempts(a => a + 1); mutateAnalytics() }, 8000)
    }
    return () => { if (esRef.current === es) { es.close(); esRef.current = null } }
  }, [data, mutateAnalytics, analyzeAttempts, triggerRequeue])

  const handleGenerateReport = useCallback(async (row, filterNum = null, force = false) => {
    const genKey = filterNum ? `${row.company_id}_${filterNum}` : row.company_id
    setGenerating(genKey)
    try {
      // 1. Parallel: load html2canvas module + fetch thread simultaneously
      const [html2canvasModule, threadRes] = await Promise.all([
        import('html2canvas'),
        authFetch(`/api/conversations/${row.company_id}${filterNum ? `?number=${encodeURIComponent(filterNum)}` : ''}`),
      ])
      const thread = threadRes.ok ? await threadRes.json() : []
      const rawThread = Array.isArray(thread) ? thread : []
      const threadArr = rawThread
      setReportThread(threadArr)
      setCaptureVisible(true)

      // 3. Wait for the browser to actually paint the newly-rendered thread —
      // a blind 800ms guessed long enough for the worst case and added that
      // same delay to every report regardless of thread length. A double rAF:
      // the first fires once React's DOM update has committed, the second
      // confirms the browser has actually painted it before html2canvas runs.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      // Las fotos del hilo (ver CaptureBody) tienen que terminar de cargar antes de capturar;
      // como mucho 5 s, para que una imagen que no carga no detenga el reporte.
      const _imgs = captureRef.current ? [...captureRef.current.querySelectorAll('img')] : []
      await Promise.race([
        Promise.all(_imgs.map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r })))),
        new Promise(r => setTimeout(r, 5000)),
      ])

      // 4. Capture with html2canvas
      let screenshotB64 = null
      try {
        const html2canvas = html2canvasModule.default
        if (captureRef.current) {
          const canvas = await html2canvas(captureRef.current, {
            backgroundColor: '#f8fafc',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true,
            foreignObjectRendering: false,
            onclone: doc => {
              const host = doc.querySelector('[data-report-capture-host]')
              if (host) { host.style.left = '0px'; host.style.top = '0px' }
            },
            windowWidth: 520,
            windowHeight: captureRef.current.scrollHeight || 600,
          })
          if (canvas.width > 0 && canvas.height > 0) {
            screenshotB64 = canvas.toDataURL('image/png')
          }
        } else {
          console.warn('captureRef.current is null — component may not have mounted')
        }
      } catch (e) {
        console.warn('html2canvas failed:', e)
        notify('No se pudo capturar el screenshot; el reporte se generará sin imagen.', 'warning')
      }

      // 4. POST to report endpoint
      const reportRes = await fetch(`/api/reports/${row.company_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshot_b64: screenshotB64, filter_number: filterNum || null, force }),
      })

      if (!reportRes.ok) {
        if (reportRes.status === 409) {
          let detail = null
          try { detail = JSON.parse(await reportRes.text())?.error } catch {}
          try { detail = typeof detail === 'string' ? JSON.parse(detail)?.detail : detail } catch {}
          setPendingReportConfirm({
            row, filterNum,
            message: detail?.message || 'Todavía no se confirma si la última respuesta es de un bot o una persona.',
            resolvesBy: detail?.resolves_by || null,
          })
          return
        }
        const errText = await reportRes.text()
        notify(`Error al generar el reporte: ${errText || reportRes.statusText}`)
        return
      }

      // 5. Preview in-app instead of downloading immediately — the download
      // itself happens from the button inside the modal.
      const blob = await reportRes.blob()
      const url = URL.createObjectURL(blob)
      const name = (row.company_name || row.company_id || 'empresa').replace(/\s+/g, '_')
      const suffix = filterNum ? `_${filterNum.replace(/\D/g,'').slice(-4)}` : ''
      setReportPreview({ url, fileName: `reporte-${name}${suffix}.pdf` })
      notify('Reporte generado correctamente.', 'success')
    } catch (e) {
      notify(`Error inesperado: ${e?.message || 'intenta de nuevo'}`)
    } finally {
      setGenerating(null)  // genKey cleared
      setReportThread([])
      setCaptureVisible(false)
    }
  }, [])

  const closeReportPreview = useCallback(() => {
    setReportPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [])

  function quickActions(row, number, review = row.review) {
    const labels = {
      pending: lang === 'en' ? 'Analysis pending' : 'Análisis pendiente',
      new_messages: lang === 'en' ? 'New messages' : 'Mensajes nuevos',
      different_results: lang === 'en' ? 'Different results' : 'Resultados diferentes',
    }
    return <Box data-analysis-quick-actions sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
      <ConversationAnalysisButton companyId={row.company_id} companyName={row.company_name}
        number={number} numberCount={(row.numbers || []).length} onChanged={mutateAnalytics} />
      <Tooltip title={lang === 'en' ? 'Open conversation' : 'Abrir conversación'}>
        <IconButton size="small" aria-label={lang === 'en' ? 'Open conversation' : 'Abrir conversación'}
          onClick={() => onNavigateToConv?.(row.company_id, number)} disabled={!onNavigateToConv}
          sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--accent)', bgcolor: 'var(--item-hover)' } }}>
          <ChatBubbleOutlineIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Tooltip>
      {review?.flags?.map(flag => labels[flag] ? <Chip key={flag} size="small" label={labels[flag]}
        sx={{ height: 20, fontSize: '0.64rem', bgcolor: 'var(--item-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }} /> : null)}
    </Box>
  }

  const downloadReportPreview = useCallback(() => {
    if (!reportPreview) return
    const a = document.createElement('a')
    a.href = reportPreview.url
    a.download = reportPreview.fileName
    a.click()
    closeReportPreview()
  }, [reportPreview, closeReportPreview])

  // filterNum: si se pasa, filtra thread y contacto a ese número específico
  function openBotBuilder(row) {
    setBotBuilderRow({
      company_id:    row.company_id    || '',
      company_name:  row.company_name  || '',
      industry:      row.industry      || '',
      website:       row.domain        || '',
      emails:        row.emails        || '',
    })
    setBotBuilderOpen(true)
  }

  function openGasBot(row, number) {
    const validNumbers = (row.numbers || []).filter(n => (n.number || '').replace(/\D/g,'').length >= 10)
    setGasBotRow({
      company_name: row.company_name || '',
      phone:        number || validNumbers[0]?.number || '',
    })
    setGasBotOpen(true)
  }

  // filterCat, filterAgents and now search are all server-side — the backend
  // already returns only matching items for the current page, so `data` needs
  // no further client-side filtering (it used to redundantly re-filter by text
  // here, which only ever searched whatever page was already loaded).
  const sortedData = [...data].sort((a, b) => {
    let av = a[sortField] ?? '', bv = b[sortField] ?? ''
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const globalTotal = categoryCounts.total || 0
  const pct = cat  => globalTotal ? Math.round(((categoryCounts[cat] || 0) / globalTotal) * 100) : 0
  const humanPct   = pct('humano')
  const autoPct    = pct('automatico')
  const autoNoReplyPct = pct('automatico_sin_respuesta')
  const botPct     = pct('bot')
  const botIaPct   = pct('bot_ia')
  const avgQualityNum = avgQualityServer ?? 0
  const avgQuality = avgQualityServer != null ? avgQualityServer.toFixed(1) : '—'

  const { t, lang } = useLang()
  const [notesFor, setNotesFor] = useState(null)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <Dialog open={!!notesFor} onClose={() => setNotesFor(null)} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '16px' } } }}>
      <DialogTitle>{notesFor?.name}</DialogTitle>
      <DialogContent><Typography sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{notesFor?.text}</Typography></DialogContent>
      <DialogActions><Button onClick={() => setNotesFor(null)}>{lang === 'en' ? 'Close' : 'Cerrar'}</Button></DialogActions>
    </Dialog>
    <Box ref={scrollRef} data-analytics-scroll sx={{
      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2,
      position: 'relative', overflow: 'auto', scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      '& > *': { flexShrink: 0 },
      '& > :not([data-analytics-table-region])': {
        position: 'sticky', left: 0,
        width: 'var(--analytics-content-width, 100%)',
        minWidth: 'var(--analytics-content-width, 100%)',
        boxSizing: 'border-box',
      },
    }}>

      <ConversationCapture thread={reportThread} captureRef={captureRef} visible={captureVisible} />

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 2,
            bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.15)', border: '1px solid rgba(var(--accent-rgb, 99,102,241), 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChartIcon sx={{ color: 'var(--accent, #a5b4fc)', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
              {t.analytics.title}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
              {t.analytics.subtitle}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>

          {isAdmin && data.some(r => r.analyzing) && (
            <Tooltip title={t.analytics.cancelPending || 'Detener análisis pendientes'}>
              <IconButton size="small" onClick={async () => {
                requeueSessionRef.current = false
                remainingRef.current = 0
                setAnalyzeAttempts(0)
                await authFetch('/api/admin/cancel-pending', { method: 'POST' })
                mutateAnalytics()
              }}
                sx={{ color: '#f87171', '&:hover': { color: '#fca5a5' } }}>
                <ErrorOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t.common.refresh}>
            <IconButton size="small" onClick={() => {
              setAnalyzeAttempts(0)
              requeueSessionRef.current = false
              remainingRef.current = 0
              mutateAnalytics()
              triggerRequeue().then(result => {
                if ((result.queued || 0) > 0) {
                  requeueSessionRef.current = true
                }
              })
            }}
              sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'white' } }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {isAdmin && (
            <Tooltip title={t.classification.tab}>
              <IconButton size="small" onClick={() => setClassificationSettingsOpen(true)}
                sx={{ color: 'rgba(255,255,255,0.4)', '&:hover': { color: 'var(--accent, #818cf8)' } }}>
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Summary stats — one bordered strip with internal dividers between
          sections, matching Prospects' StatCard/Divider pattern, instead of
          loose separate chips with gaps between them. */}
      {loading ? (
        <StatsCardSkeleton />
      ) : (
        <Box sx={STAT_STRIP_SX}>
          <Box sx={STAT_GRID_SX}>
            {[
              { key: 'total',     icon: <StarIcon sx={{ fontSize: 20, color: 'var(--text-muted)' }} />, color: 'rgba(148,163,184,0.6)', value: globalTotal, label: t.analytics.total, percent: 100 },
              { key: 'human',     icon: <PersonIcon sx={{ fontSize: 20, color: '#4ade80' }} />, color: '#4ade80', value: `${humanPct}%`, label: t.analytics.pctHuman, percent: humanPct },
              { key: 'automatic', icon: <FlashOnIcon sx={{ fontSize: 20, color: '#facc15' }} />, color: '#facc15', value: `${autoPct}%`, label: t.analytics.automatic, percent: autoPct },
              { key: 'autoNoReply', icon: <TimerOffIcon sx={{ fontSize: 20, color: '#fb923c' }} />, color: '#fb923c', value: `${autoNoReplyPct}%`, label: t.analytics.autoNoReply, percent: autoNoReplyPct },
              { key: 'bot',       icon: <SmartToyIcon sx={{ fontSize: 20, color: '#a78bfa' }} />, color: '#a78bfa', value: `${botPct}%`, label: t.analytics.bot, percent: botPct },
              { key: 'botIa',     icon: <PsychologyIcon sx={{ fontSize: 20, color: '#c084fc' }} />, color: '#c084fc', value: `${botIaPct}%`, label: t.analytics.botAi, percent: botIaPct },
              { key: 'quality',   icon: <StarIcon sx={{ fontSize: 20, color: '#facc15' }} />, color: '#facc15', value: avgQuality, label: t.analytics.avgQuality, percent: (avgQualityNum / 5) * 100 },
            ].map(({ key, ...c }) => <StatCard key={key} {...c} />)}
          </Box>
        </Box>
      )}

      <ComparisonSummary />

      {/* ── Filtros ── */}
      <Box ref={filtersRef} data-analytics-filters sx={{
        display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0,
        position: 'sticky', top: 0, left: 0, zIndex: 3, p: 1.5, border: '1px solid var(--border)', borderRadius: '14px',
        bgcolor: 'var(--card-bg, #161d2e)',
      }}>
        {/* Buscador */}
        <TextField size="small" placeholder={t.analytics.searchPh} value={searchText}
          onChange={e => setSearchText(e.target.value)}
          slotProps={{ input: { startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.3)' }} />
            </InputAdornment>
          ), endAdornment: searchText ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setSearchText('')} sx={{ p: 0.3 }}>
                <ClearIcon sx={{ fontSize: 15, color: 'rgba(255,255,255,0.4)' }} />
              </IconButton>
            </InputAdornment>
          ) : null }}}
          sx={{ width: { xs: '100%', sm: 280 }, flexShrink: 0, '& .MuiOutlinedInput-root': { fontSize: '0.8rem', bgcolor: 'var(--card-bg,#161d2e)', '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' }, '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }, '& input': { color: 'white', py: 0.7 } }} />

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.08)', height: 20, alignSelf: 'center', display: { xs: 'none', sm: 'block' } }} />

        {/* Chips de categoría */}
        {[
          { value: 'all',           icon: null,             label: t.analytics.all,     color: 'rgba(255,255,255,0.6)',  bg: 'rgba(255,255,255,0.06)'  },
          { value: 'humano',        icon: PersonIcon,       label: t.analytics.human,   color: '#4ade80',                bg: 'rgba(74,222,128,0.1)'    },
          { value: 'automatico',    icon: FlashOnIcon,      label: t.analytics.automatic, color: '#facc15',              bg: 'rgba(250,204,21,0.1)'    },
          { value: 'automatico_sin_respuesta', icon: TimerOffIcon, label: t.analytics.autoNoReply, color: '#fb923c',      bg: 'rgba(251,146,60,0.1)'    },
          { value: 'bot',           icon: SmartToyIcon,     label: t.analytics.bot,     color: '#a78bfa',                bg: 'rgba(167,139,250,0.1)'   },
          { value: 'bot_ia',        icon: PsychologyIcon,   label: t.analytics.botAi,   color: '#c084fc',                bg: 'rgba(192,132,252,0.1)'   },
          // "sin_respuesta" (confirmado, ya se cumplió el tiempo de espera y
          // nunca contestaron) no tenía chip propio — antes no había forma de
          // ver esas empresas aisladas, se confundía con "sin_clasificar"
          // (que es un estado distinto: contactada pero AÚN dentro de la
          // ventana de espera, sin confirmar todavía si va a responder).
          { value: 'sin_respuesta', icon: SpeakerNotesOffIcon, label: t.analytics.noReply, color: '#f87171',            bg: 'rgba(248,113,113,0.08)' },
          { value: 'sin_clasificar',icon: HourglassEmptyIcon, label: t.analytics.noClass, color: '#94a3b8',              bg: 'rgba(148,163,184,0.08)'  },
        ].map(f => {
          const isActive = filterCat === f.value
          const count    = f.value === 'all' ? (categoryCounts.total || 0)
                         : f.value === 'sin_clasificar' ? (categoryCounts.sin_clasificar || 0)
                         : (categoryCounts[f.value] || 0)
          const Icon = f.icon
          return (
            <Box component="button" type="button" aria-pressed={isActive} key={f.value} onClick={() => { setFilterCat(f.value); setPage(1) }} sx={{ font: 'inherit',
              display: 'flex', alignItems: 'center', gap: 0.5,
              px: 1.2, py: 0.45, borderRadius: 99, cursor: 'pointer',
              bgcolor: isActive ? f.bg : 'transparent',
              border: `1px solid ${isActive ? f.color + '66' : 'rgba(255,255,255,0.08)'}`,
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
              WebkitTapHighlightColor: 'transparent',
              '&:hover': { bgcolor: f.bg, borderColor: f.color + '44' },
            }}>
              {Icon && <Icon sx={{ fontSize: 14, color: isActive ? f.color : 'rgba(255,255,255,0.4)' }} />}
              <Typography sx={{ fontSize: '0.75rem', fontWeight: isActive ? 700 : 400, color: isActive ? f.color : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                {f.label}
              </Typography>
              {count > 0 && (
                <Box sx={{ bgcolor: isActive ? f.color + '33' : 'rgba(255,255,255,0.06)', borderRadius: 99, px: 0.6, minWidth: 18, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.6rem', color: isActive ? f.color : 'rgba(255,255,255,0.3)', fontWeight: 700, lineHeight: 1.6 }}>{count}</Typography>
                </Box>
              )}
            </Box>
          )
        })}

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.08)', height: 20, alignSelf: 'center', display: { xs: 'none', sm: 'block' } }} />

        {/* Filtro por agente — quién le respondió/escribió a la empresa. Checkbox
            multi-select en vez de un solo valor porque una empresa puede haber
            pasado por más de un agente (relevo, línea compartida). */}
        <Box onClick={e => setAgentMenuAnchor(e.currentTarget)} sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          px: 1.2, py: 0.45, borderRadius: 99, cursor: 'pointer',
          bgcolor: filterAgents.length ? 'rgba(165,180,252,0.1)' : 'transparent',
          border: `1px solid ${filterAgents.length ? 'var(--accent, #a5b4fc)66' : 'rgba(255,255,255,0.08)'}`,
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          WebkitTapHighlightColor: 'transparent',
          '&:hover': { bgcolor: 'rgba(165,180,252,0.1)', borderColor: 'var(--accent, #a5b4fc)44' },
        }}>
          <GroupIcon sx={{ fontSize: 14, color: filterAgents.length ? 'var(--accent, #a5b4fc)' : 'rgba(255,255,255,0.4)' }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: filterAgents.length ? 700 : 400, color: filterAgents.length ? 'var(--accent, #a5b4fc)' : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
            {t.analytics.agent}
          </Typography>
          {filterAgents.length > 0 && (
            <Box sx={{ bgcolor: 'var(--accent, #a5b4fc)33', borderRadius: 99, px: 0.6, minWidth: 18, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', color: 'var(--accent, #a5b4fc)', fontWeight: 700, lineHeight: 1.6 }}>{filterAgents.length}</Typography>
            </Box>
          )}
        </Box>
        <Menu anchorEl={agentMenuAnchor} open={!!agentMenuAnchor} onClose={() => setAgentMenuAnchor(null)}
          slotProps={{
            paper: { sx: {
              bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 2.5, mt: 0.6, minWidth: 220, maxHeight: 340, overflowY: 'auto',
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.15) transparent',
              '&::-webkit-scrollbar': { width: 5 },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)', borderRadius: 4 },
            } },
            list: { sx: { py: 0.6, px: 0.6 } },
          }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1, py: 0.7, mb: 0.4 }}>
            <GroupIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />
            <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t.analytics.agent}
            </Typography>
          </Box>
          {allAgents.length === 0 && (
            <MenuItem disabled sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', borderRadius: 1.5 }}>{t.analytics.noAgents}</MenuItem>
          )}
          {allAgents.map(a => {
            const isBot = a.username === 'ai_andy'
            const checked = filterAgents.includes(a.username)
            const color = isBot ? '#c084fc' : agentColor(a.name)
            return (
              <MenuItem key={a.username} onClick={() => toggleAgentFilter(a.username)} sx={{
                py: 0.5, px: 0.8, mb: 0.2, borderRadius: 1.5, gap: 0.9,
                bgcolor: checked ? 'rgba(var(--accent-rgb,99,102,241),0.12)' : 'transparent',
                '&:hover': { bgcolor: checked ? 'rgba(var(--accent-rgb,99,102,241),0.18)' : 'rgba(255,255,255,0.05)' },
              }}>
                <Checkbox size="small" checked={checked}
                  sx={{ p: 0, color: 'var(--text-muted)', '&.Mui-checked': { color: 'var(--accent, #3b82f6)' } }} />
                <Box sx={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: `${color}22`, border: `1px solid ${color}44`,
                }}>
                  {isBot
                    ? <SmartToyIcon sx={{ fontSize: 12, color }} />
                    : <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color, textTransform: 'uppercase' }}>{(a.name || '?')[0]}</Typography>}
                </Box>
                <Typography sx={{ fontSize: '0.8rem', fontWeight: checked ? 700 : 500, color: checked ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)' }}>
                  {isBot ? t.analytics.botAi : a.name}
                </Typography>
              </MenuItem>
            )
          })}
        </Menu>

        <Select size="small" value={reviewFilter} onChange={e => { setReviewFilter(e.target.value); setPage(1) }}
          inputProps={{ 'aria-label': lang === 'en' ? 'Analysis review status' : 'Estado de revisión del análisis' }}
          sx={{ color: 'var(--text)', fontSize: '0.75rem', borderRadius: 99, minWidth: 160,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' } }}>
          <MenuItem value="all">{lang === 'en' ? 'All analysis states' : 'Todos los estados'}</MenuItem>
          <MenuItem value="pending">{lang === 'en' ? 'Pending analysis' : 'Análisis pendiente'}</MenuItem>
          <MenuItem value="new_messages">{lang === 'en' ? 'New messages' : 'Mensajes nuevos'}</MenuItem>
          <MenuItem value="different_results">{lang === 'en' ? 'Different results' : 'Resultados diferentes'}</MenuItem>
        </Select>
        {/* Estado de filtro activo — Limpiar + contador, agrupados aparte */}
        {(filterCat !== 'all' || reviewFilter !== 'all' || searchText || filterAgents.length > 0) && (
          <>
            <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.08)', height: 20, alignSelf: 'center', ml: 'auto', display: { xs: 'none', sm: 'block' } }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: { xs: 'auto', sm: 0 } }}>
              <Box onClick={() => { setFilterCat('all'); setReviewFilter('all'); setSearchText(''); setFilterAgents([]); setPage(1) }} sx={{
                display: 'flex', alignItems: 'center', gap: 0.4,
                px: 1, py: 0.45, borderRadius: 99, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)',
                fontSize: '0.72rem', transition: 'all 0.15s',
                '&:hover': { color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' },
              }}>
                <CloseIcon sx={{ fontSize: 13, color: 'inherit' }} />
                <Typography sx={{ fontSize: '0.72rem', color: 'inherit' }}>Limpiar</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>
                {sortedData.length} {t.analytics.of} {data.length} {t.analytics.companies}
              </Typography>
            </Box>
          </>
        )}
      </Box>

      {/* Table / states */}
      {/* Tan ancho como la tabla, no como la ventana: con la ventana angosta la tabla se desplaza
          de lado y el borde derecho quedaba a media tabla (2026-10-20). fit-content y no
          max-content: el max-content de una tabla al 100% en Chrome es de un millón de px. */}
      <Box ref={tableRegionRef} data-analytics-table-region sx={{ minHeight: 0, minWidth: '100%', width: 'fit-content', display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: '14px' }}>
        {loading ? (
          <TableContainer sx={{
            minHeight: 0, overflow: 'visible',
            scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
          }}>
            <Table size="small" stickyHeader sx={{ minWidth: 1600, tableLayout: 'fixed', '& tbody tr:not([data-analysis-child]):hover > td': { bgcolor: 'var(--item-hover)' }, '& tbody tr:not([data-analysis-child]):hover > td:nth-of-type(-n+2)': { bgcolor: 'var(--card-bg)' } }}>
              <AnalyticsColumns />
              <TableHead>
                <TableRow ref={headerRowRef}>
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_LAST_SX, ...EXPAND_PIN_SX, zIndex: 4, px: 0.5 }} />
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, ...COMPANY_PIN_SX, zIndex: 4, textAlign: 'center' }}>{t.analytics.company}</TableCell>
                  {[t.analytics.phoneNum, t.analytics.industry].map(label => <TableCell key={label} rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>{label}</TableCell>)}
                  <TableCell colSpan={4} sx={{ ...HEADER_CELL_SX, ...ANALYSIS_GROUP_SX, height: ANALYSIS_ROW_H, py: 0, textAlign: 'center', borderBottom: ANALYSIS_FRAME }}>{t.analytics.analysisGroup}</TableCell>
                  {[t.analytics.quality, t.analytics.reaction, t.analytics.lastResp, t.analytics.notes].map(label => <TableCell key={label} rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>{label}</TableCell>)}
                  <TableCell rowSpan={2} colSpan={3} sx={{ ...HEADER_CELL_LAST_SX, textAlign: 'center' }}>{lang === 'en' ? 'Actions' : 'Acciones'}<Typography sx={{ fontSize: '0.64rem', textTransform: 'none', color: 'var(--text-muted)', mt: 0.5 }}>Chat IA · Bot · PDF</Typography></TableCell>
                </TableRow>
                <TableRow>{[t.analytics.colTiming, t.analytics.colIa, lang === 'en' ? 'Result' : 'Resultado', t.analytics.colRange].map(label => <TableCell key={label} sx={{ ...HEADER_CELL_SX, ...ANALYSIS_SUB_SX, textAlign: 'center', px: 0.75 }}>{label}</TableCell>)}</TableRow>
              </TableHead>
              <AnalyticsRowsSkeleton count={rowsPerPage} />
            </Table>
          </TableContainer>
        ) : data.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, pt: 6, gap: 1.5 }}>
            <BarChartIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.08)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', textAlign: 'center', maxWidth: 360 }}>
              {t.analytics.noData}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem', textAlign: 'center', maxWidth: 360 }}>
              {t.analytics.noDataSub}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{
            minHeight: 0, overflow: 'visible',
            scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
          }}>
            <Table size="small" stickyHeader sx={{ minWidth: 1600, tableLayout: 'fixed', '& tbody tr:not([data-analysis-child]):hover > td': { bgcolor: 'var(--item-hover)' }, '& tbody tr:not([data-analysis-child]):hover > td:nth-of-type(-n+2)': { bgcolor: 'var(--card-bg)' } }}>
              <AnalyticsColumns />
              <TableHead>
                <TableRow ref={headerRowRef}>
                  {/* Columna expand — sin label */}
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_LAST_SX, ...EXPAND_PIN_SX, zIndex: 4, px: 0.5 }} />
                  {/* Empresa */}
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, ...COMPANY_PIN_SX, zIndex: 4, textAlign: 'left' }}>
                    <TableSortLabel active={sortField === 'company_name'} direction={sortField === 'company_name' ? sortDir : 'asc'}
                      onClick={() => handleSort('company_name')}
                      sx={SORT_LABEL_CENTER_SX}>
                      {t.analytics.company}
                    </TableSortLabel>
                  </TableCell>
                  {/* Número */}
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, minWidth: 130, whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                      <WhatsAppIcon sx={{ fontSize: 12 }} /> {t.analytics.phoneNum}
                    </Box>
                  </TableCell>
                  {/* Industria + Categoría */}
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'industry'} direction={sortField === 'industry' ? sortDir : 'asc'}
                      onClick={() => handleSort('industry')}
                      sx={SORT_LABEL_CENTER_SX}>
                      {t.analytics.industry}
                    </TableSortLabel>
                  </TableCell>
                  {/* Categoría, dividida en los tres clasificadores */}
                  <TableCell colSpan={4} sx={{ ...HEADER_CELL_SX, ...ANALYSIS_GROUP_SX, height: ANALYSIS_ROW_H, py: 0, textAlign: 'center', borderBottom: ANALYSIS_FRAME }}>
                    {t.analytics.analysisGroup}
                  </TableCell>
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'response_quality'} direction={sortField === 'response_quality' ? sortDir : 'asc'}
                      onClick={() => handleSort('response_quality')}
                      sx={SORT_LABEL_CENTER_SX}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <StarIcon sx={{ fontSize: 12 }} /> {t.analytics.quality}
                      </Box>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, minWidth: 130, whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'reaction_time_min'} direction={sortField === 'reaction_time_min' ? sortDir : 'asc'}
                      onClick={() => handleSort('reaction_time_min')}
                      sx={SORT_LABEL_CENTER_SX}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <AccessTimeIcon sx={{ fontSize: 12 }} /> {t.analytics.reaction}
                      </Box>
                    </TableSortLabel>
                  </TableCell>
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'last_at'} direction={sortField === 'last_at' ? sortDir : 'asc'}
                      onClick={() => handleSort('last_at')}
                      sx={SORT_LABEL_CENTER_SX}>
                      {t.analytics.lastResp}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell rowSpan={2} sx={{ ...HEADER_CELL_SX, textAlign: 'center' }}>{t.analytics.notes}</TableCell>
                  <TableCell rowSpan={2} colSpan={3} sx={{ ...HEADER_CELL_LAST_SX, textAlign: 'center', minWidth: 134 }}>
                    {lang === 'en' ? 'Actions' : 'Acciones'}
                    <Typography sx={{ fontSize: '0.64rem', textTransform: 'none', color: 'var(--text-muted)', mt: 0.5 }}>Chat IA · Bot · PDF</Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  {/* "?" de cada clasificador: cómo decide (ClassifierHelp). Los límites del
                      diagrama de Timing salen de cualquier comparación ya corrida. */}
                  {[['timing', 'colTiming'], ['ia', 'colIa'], ['hibrido', 'colHybrid']].map(([method, label]) => (
                    <TableCell key={method} sx={{ ...HEADER_CELL_SX, ...ANALYSIS_SUB_SX, width: ANALYSIS_COL_W, px: 0.75, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        {method === 'hibrido' ? (lang === 'en' ? 'Result' : 'Resultado') : t.analytics[label]}
                        <ClassifierHelp method={method} size={13}
                          limits={method === 'timing' ? sortedData.find(r => r.comparison?.timing?.inputs)?.comparison.timing.inputs : undefined} />
                      </Box>
                    </TableCell>
                  ))}
                  <TableCell sx={{ ...HEADER_CELL_SX, ...ANALYSIS_SUB_SX, width: 148, px: 0.75, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <Tooltip title={t.analytics.colRangeHelp}
                      slotProps={{ tooltip: { className: 'classifier-help-tip', sx: {
                        bgcolor: 'var(--card-bg, #161d2e)', color: 'var(--text, #f1f5f9)',
                        border: '1px solid var(--border, rgba(255,255,255,0.1))', borderRadius: 1.5,
                        fontSize: '0.75rem', lineHeight: 1.45, maxWidth: 320,
                      } } }}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, cursor: 'help' }}>
                        {t.analytics.colRange}
                        <HelpOutlineIcon sx={{ fontSize: 13, color: 'var(--text-muted, rgba(255,255,255,0.35))' }} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedData.map((row) => {
                  const cat = getCategoryConfig(row)
                  const notesText = row.notes || ''
                  const notesTruncated = notesText
                  const isGenerating = generating === row.company_id
                  const validNumbers = (row.numbers || []).filter(n => (n.number || '').replace(/\D/g,'').length >= 10)
                  const hasMultiple = validNumbers.length > 1
                  const isExpanded = expandedRows.has(row.company_id)
                  return (
                    <Fragment key={row.company_id}>
                    <TableRow sx={{
                      '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.05))' },
                      '[data-theme-mode="light"] &:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
                      transition: 'background 0.15s',
                    }}>
                      {/* Expand button */}
                      <TableCell sx={{ ...CELL_SX, ...EXPAND_PIN_SX, px: 0.5 }}>
                        {hasMultiple && (
                          <IconButton aria-label={`${isExpanded ? (lang === 'en' ? 'Collapse' : 'Contraer') : (lang === 'en' ? 'Expand' : 'Expandir')} ${row.company_name}`} aria-expanded={isExpanded} size="small" onClick={() => toggleExpand(row.company_id)}
                            sx={{ color: 'rgba(255,255,255,0.3)', p: 0.3, '&:hover': { color: 'var(--accent,#a5b4fc)' } }}>
                            {isExpanded
                              ? <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                              : <KeyboardArrowRightIcon sx={{ fontSize: 16 }} />}
                          </IconButton>
                        )}
                      </TableCell>

                      {/* Empresa */}
                      <TableCell sx={{ ...CELL_SX, ...COMPANY_PIN_SX }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.84rem' }}>
                            {row.company_name || row.company_id}
                          </Typography>
                          {row.analyzing && (
                            <Tooltip title={t.analytics.analyzingTooltip}>
                              <CircularProgress size={11} thickness={5} sx={{ color: 'var(--accent,#a5b4fc)', opacity: 0.8, flexShrink: 0 }} />
                            </Tooltip>
                          )}
                          {hasMultiple && (
                            <Chip label={`${validNumbers.length} ${t.analytics.numsChip}`} size="small" sx={{
                              height: 16, fontSize: '0.6rem',
                              bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.15)',
                              color: 'var(--accent,#a5b4fc)',
                              border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
                            }} />
                          )}
                        </Box>
                        {row.domain && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem' }}>
                            {row.domain}
                          </Typography>
                        )}
                        {/* Solo se muestra a nivel empresa cuando hay UN número — con
                           varios números mezclaba en un solo badge a quien de verdad
                           contactó a cada uno, dando a entender que un agente/bot habló
                           con TODOS los números de la empresa cuando en realidad pudo
                           haber sido solo uno. Con varios números, la atribución real
                           ya vive en cada fila expandida (una por número). */}
                        {!hasMultiple && row.handled_by?.length > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.4, mt: 0.3 }}>
                            {row.handled_by.map(h => {
                              const isBot = h.username === 'ai_andy'
                              // The AI's own conversational persona name now varies per WhatsApp
                              // instance (Marco / Richie / etc.) — showing it here as "Andy" next
                              // to real agent names is both redundant and confusing. A bot icon
                              // marks "the AI was in this conversation too" without a name at all.
                              return (
                                <Tooltip key={h.username} title={isBot ? t.analytics.aiHandled : t.analytics.handledByTooltip}>
                                  <Box sx={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.35,
                                    height: 18, px: isBot ? 0 : 0.7, minWidth: 18, boxSizing: 'border-box', borderRadius: 99,
                                    bgcolor: isBot ? 'rgba(192,132,252,0.12)' : 'rgba(255,255,255,0.06)',
                                    border: `1px solid ${isBot ? 'rgba(192,132,252,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                  }}>
                                    {isBot
                                      ? <SmartToyIcon sx={{ fontSize: 10, color: '#c084fc' }} />
                                      : <PersonIcon sx={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />}
                                    {!isBot && (
                                      <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.65rem', fontWeight: 500, lineHeight: 1 }}>
                                        {h.name}
                                      </Typography>
                                    )}
                                  </Box>
                                </Tooltip>
                              )
                            })}
                          </Box>
                        )}
                        {quickActions(row, hasMultiple ? null : validNumbers[0]?.number)}
                      </TableCell>

                      {/* Número */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && validNumbers[0] && (() => {
                          const n0 = validNumbers[0]
                          const sn = (n0.number || '').replace(/\D/g,'').slice(-10).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
                          const replied0 = n0.responses > 0
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                              <WhatsAppIcon sx={{ fontSize: 12, color: replied0 ? '#4ade80' : 'rgba(255,255,255,0.18)', filter: replied0 ? 'drop-shadow(0 0 3px #4ade8066)' : 'grayscale(1)', flexShrink: 0 }} />
                              <Typography sx={{ fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap', color: replied0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.35)' }}>{sn}</Typography>
                            </Box>
                          )
                        })()}
                      </TableCell>

                      {/* Industria */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', textAlign: 'center' }}>
                          {row.industry || '—'}
                        </Typography>
                      </TableCell>

                      {/* Análisis — Timing / IA / Timing + IA. Clic en cualquiera abre el log
                          de cómo llegó cada uno. Con varios números, la comparación va en
                          cada fila del desplegable (no se mezcla la plática de números distintos). */}
                      {hasMultiple ? (
                        <TableCell colSpan={4} sx={{ ...CELL_SX, ...ANALYSIS_CELL_SX, width: undefined, textAlign: 'center' }}>
                          {/* La comparación va en cada número del desplegable. El rango
                              de la empresa aquí se leía como si fuera de un número que
                              no contestó (Gas 1 / 2228120419, 2026-10-08). */}
                          <Button size="small" onClick={() => toggleExpand(row.company_id)} aria-expanded={isExpanded} sx={{ textTransform: 'none', color: 'var(--accent)', fontSize: '0.76rem', bgcolor: 'rgba(var(--accent-rgb),0.07)', borderRadius: '8px', px: 1.5 }}>
                            {isExpanded ? (lang === 'en' ? 'Hide numbers' : 'Ocultar números') : (lang === 'en' ? `See analysis of ${validNumbers.length} numbers` : `Ver análisis de ${validNumbers.length} números`)}
                          </Button>
                        </TableCell>
                      ) : (
                        <>
                          {['timing', 'ia'].map(m => (
                            <TableCell key={m} sx={{ ...CELL_SX, ...ANALYSIS_CELL_SX, textAlign: 'center' }}>
                              {row.comparison?.[m]
                                ? <ResultChip compact method={m} result={row.comparison[m]} onClick={() => setCompareFor({ id: row.company_id, name: row.company_name })} />
                                : m === 'timing'
                                  ? compareButton(row)
                                  : <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.28)', fontStyle: 'italic' }}>{lang === 'en' ? 'Not analyzed' : 'Sin analizar'}</Typography>}
                            </TableCell>
                          ))}
                          <TableCell sx={{ ...CELL_SX, ...ANALYSIS_CELL_SX, textAlign: 'center' }}>
                            {row.comparison?.hibrido
                              ? <ResultChip compact method="hibrido" result={row.comparison.hibrido} onClick={() => setCompareFor({ id: row.company_id, name: row.company_name })} />
                              : row.category
                                ? <ResultChip compact method="hibrido" result={{ category: row.category, is_ai: row.is_ai, common: row.category }} />
                                : <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>{lang === 'en' ? 'Not analyzed' : 'Sin analizar'}</Typography>}
                          </TableCell>
                          <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                            <ParecidoCell hibrido={row.comparison?.hibrido}
                              onClick={row.comparison?.hibrido ? () => setCompareFor({ id: row.company_id, name: row.company_name }) : undefined} />
                          </TableCell>
                        </>
                      )}

                      {/* Calidad */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (row.response_quality != null
                          ? <QualityDots score={row.response_quality} color={cat.color} />
                          : <Tooltip title={t.analytics.notRated} placement="top">
                              <Box sx={{ display: 'inline-flex' }}><QualityDots score={0} color="rgba(255,255,255,0.1)" /></Box>
                            </Tooltip>)}
                      </TableCell>

                      {/* T. Reacción */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem', textAlign: 'center' }}>
                            {formatReactionTime(row.reaction_time_min, row.reaction_time_seconds)}
                          </Typography>
                        )}
                      </TableCell>


                      {/* Última respuesta */}
                      <TableCell sx={{ ...CELL_SX, textAlign: 'center' }}>
                        {!hasMultiple && (
                          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.78rem', textAlign: 'center' }}>
                            {formatLastAt(row.last_at)}
                          </Typography>
                        )}
                      </TableCell>

                      {/* Notas */}
                      <TableCell sx={{ ...CELL_SX, minWidth: 200, maxWidth: 240, textAlign: 'center' }}>
                        {!hasMultiple && (notesText
                          ? <Tooltip title={notesText} placement="top"><Typography component="button" onClick={() => setNotesFor({ name: row.company_name, text: notesText })} sx={{ p: 0, border: 0, background: 'none', fontFamily: 'inherit', textAlign: 'center', width: '100%', mx: 'auto', color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.6, cursor: 'pointer', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{notesTruncated}</Typography></Tooltip>
                          : <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>—</Typography>)}

                      </TableCell>

                      <TableCell colSpan={3} sx={CELL_SX}><Box sx={ACTION_GROUP_SX}>
                      {/* Andy */}
                      <Box>
                        {(() => {
                          const noReply = row.total_responses === 0
                          const noAnalysis = !row.category || noReply
                          const andyTip = noReply ? t.analytics.noReply : noAnalysis ? t.analytics.noAnalysis : hasMultiple ? t.analytics.sendAllToAndy : t.analytics.sendToAndy
                          return (
                            <Tooltip title={andyTip}>
                              <span>
                                <IconButton size="small" disabled={noAnalysis} onClick={() => openBotBuilder(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <SendIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </Box>

                      {/* Modificar Bot — solo industrias de gas */}
                      <Box>
                        {(() => {
                          const isGas = isGasIndustry(row.industry)
                          return (
                            <Tooltip title={!isGas ? t.analytics.notGasIndustry : t.analytics.modifyBotTooltip}>
                              <span>
                                <IconButton size="small" disabled={!isGas} onClick={() => openGasBot(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: '#fb923c', bgcolor: 'rgba(251,146,60,0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <LocalGasStationIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </Box>

                      {/* Reporte */}
                      <Box>
                        {!hasMultiple && (() => {
                          // "sin_respuesta" se puede reportar igual — el PDF sirve
                          // justamente para dejar constancia de que no hubo respuesta.
                          const noContact = !row.category || (row.category !== 'sin_respuesta' && !row.total_responses)
                          const tip = isGenerating ? t.analytics.generating : generating ? t.analytics.pleaseWait : row.category === 'sin_respuesta' ? t.analytics.noReply : !row.category || !row.total_responses ? t.analytics.noConvRecord : t.analytics.reportPdf
                          return (
                            <Tooltip title={tip}>
                              <span>
                                <IconButton size="small" disabled={!!generating || noContact} onClick={() => handleGenerateReport(row)}
                                  sx={{ color: isGenerating ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  {isGenerating ? <CircularProgress size={14} sx={{ color: 'var(--accent,#6366f1)' }} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </Box>

                      {/* Evaluación del canal WhatsApp (one-pager para el prospecto) */}
                      <Box>
                        {!hasMultiple && (() => {
                          const noContact = !row.category || (row.category !== 'sin_respuesta' && !row.total_responses)
                          const isGas = isGasIndustry(row.industry)  // la evaluación es solo para gaseras
                          return (
                            <Tooltip title={!isGas ? t.analytics.notGasIndustry : noContact ? t.analytics.noConvRecord : (lang === 'en' ? 'WhatsApp channel evaluation (one-pager)' : 'Evaluación del canal WhatsApp (one-pager)')}>
                              <span>
                                <IconButton size="small" disabled={noContact || !isGas} onClick={() => setEvalFor({ id: row.company_id, name: row.company_name })}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )
                        })()}
                      </Box>
                      </Box></TableCell>
                    </TableRow>

                    {/* Filas expandibles — una por número, alineadas con columnas */}
                    {hasMultiple && isExpanded && row.numbers.filter(n => (n.number || '').replace(/\D/g,'').length >= 10).map((n, numberIndex) => {
                      const nCat     = getCategoryConfig({ category: n.category, is_ai: n.is_ai })
                      const replied  = n.responses > 0
                      const inherited = n.inherited_analysis === true
                      const hasAnalysis = !!n.category
                      const shortNum = (n.number || '').replace(/\D/g,'').slice(-10)
                        .replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
                      const whatsappName = (n.whatsapp_name || (n.label_source === 'whatsapp' ? n.label : '') || '').trim()
                      const showLabel = Boolean(whatsappName)
                      const numKey  = `${row.company_id}_${n.number}`
                      const genKey  = numKey
                      const isGenNum = generating === genKey
                      const isLastNumber = numberIndex === validNumbers.length - 1
                      const NSUB = { ...CELL_SX, borderBottom: isLastNumber ? '2px solid var(--border)' : '1px solid var(--border)' }
                      return (
                        <TableRow key={numKey} data-analysis-child={row.company_id} sx={{
                          '& > td': { color: 'var(--text-muted)', bgcolor: 'var(--card-bg)', backgroundImage: 'linear-gradient(rgba(var(--accent-rgb),0.055),rgba(var(--accent-rgb),0.055))' },
                          '&:hover > td': { backgroundImage: 'linear-gradient(rgba(var(--accent-rgb),0.095),rgba(var(--accent-rgb),0.095))' },
                        }}>
                          <TableCell sx={{ ...NSUB, ...EXPAND_PIN_SX, px: 0.5 }} />
                          {/* Empresa — nombre de sucursal o número como fallback */}
                          <TableCell sx={{ ...NSUB, ...COMPANY_PIN_SX }}>
                            <Typography sx={{ fontSize: '0.61rem', color: 'var(--text-muted)', mb: 0.5, letterSpacing: '0.03em' }}>{lang === 'en' ? `Number ${numberIndex + 1} of ${validNumbers.length}` : `Número ${numberIndex + 1} de ${validNumbers.length}`}</Typography>
                            <Box>
                              <Typography data-analysis-contact-name title={showLabel ? (lang === 'en' ? 'WhatsApp profile name' : 'Nombre del perfil de WhatsApp') : ''} sx={{ fontSize: '0.75rem', fontWeight: showLabel ? 600 : 400, color: replied ? (showLabel ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)') : 'rgba(255,255,255,0.3)', lineHeight: 1.3, fontFamily: showLabel ? 'inherit' : 'monospace' }}>
                                {showLabel ? whatsappName : shortNum}
                              </Typography>
                              {n.source && (
                                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.22)', lineHeight: 1.2 }}>
                                  {n.source}
                                </Typography>
                              )}
                              {/* Quién atendió ESTE número específico — antes solo se veía a
                                 nivel empresa, mezclando agentes de números distintos en una
                                 empresa con varias líneas ("no especifica que user se comunico
                                 con el" para cada número). */}
                              {n.handled_by?.length > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.35, mt: 0.3 }}>
                                  {n.handled_by.map(h => {
                                    const isBotNum = h.username === 'ai_andy'
                                    return (
                                      <Tooltip key={h.username} title={isBotNum ? t.analytics.aiHandled : t.analytics.handledByTooltip}>
                                        <Box sx={{
                                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3,
                                          height: 16, px: isBotNum ? 0 : 0.6, minWidth: 16, boxSizing: 'border-box', borderRadius: 99,
                                          bgcolor: isBotNum ? 'rgba(192,132,252,0.12)' : 'rgba(255,255,255,0.05)',
                                          border: `1px solid ${isBotNum ? 'rgba(192,132,252,0.3)' : 'rgba(255,255,255,0.09)'}`,
                                        }}>
                                          {isBotNum
                                            ? <SmartToyIcon sx={{ fontSize: 9, color: '#c084fc' }} />
                                            : <PersonIcon sx={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />}
                                          {!isBotNum && (
                                            <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.6rem', fontWeight: 500, lineHeight: 1 }}>
                                              {h.name}
                                            </Typography>
                                          )}
                                        </Box>
                                      </Tooltip>
                                    )
                                  })}
                                </Box>
                              )}
                            </Box>
                            {quickActions(row, n.number, n.review)}
                          </TableCell>
                          {/* Número */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                              <WhatsAppIcon sx={{
                                fontSize: 12,
                                color: replied ? '#4ade80' : 'rgba(255,255,255,0.18)',
                                filter: replied ? 'drop-shadow(0 0 3px #4ade8066)' : 'grayscale(1)',
                                flexShrink: 0,
                              }} />
                              <Typography sx={{ fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap', color: replied ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.28)' }}>
                                {shortNum}
                              </Typography>
                            </Box>
                          </TableCell>
                          {/* Industria — vacía */}
                          <TableCell sx={NSUB} />
                          {/* Análisis de este número: Timing, IA, Timing + IA y rango */}
                          {(() => {
                            const cmp = (row.comparison?.numbers || []).find(x => x.number === last10(n.number))
                            const open = () => setCompareFor({ id: row.company_id, name: row.company_name, number: n.number })
                            const cells = ['timing', 'ia', 'hibrido'].map(m => (
                              <TableCell key={m} sx={{ ...NSUB, ...ANALYSIS_CELL_SX, textAlign: 'center' }}>
                                {cmp?.[m]
                                  ? <ResultChip compact method={m} result={cmp[m]} onClick={open} />
                                  : (m === 'hibrido' && replied && hasAnalysis
                                    ? <Box sx={{ opacity: inherited ? 0.65 : 1, display: 'inline-flex' }}>
                                        <ResultChip compact method="hibrido" result={{ category: n.category, is_ai: n.is_ai, common: n.category }} />
                                      </Box>
                                    : <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.28)', fontStyle: 'italic' }}>{lang === 'en' ? 'Not analyzed' : 'Sin analizar'}</Typography>)}
                              </TableCell>
                            ))
                            cells.push(
                              <TableCell key="rango" sx={{ ...NSUB, textAlign: 'center' }}>
                                <ParecidoCell hibrido={cmp?.hibrido} onClick={cmp ? open : undefined} />
                              </TableCell>
                            )
                            return cells
                          })()}
                          {/* Calidad */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            {replied && n.response_quality != null
                              ? <QualityDots score={n.response_quality} color={nCat.color} />
                              : replied
                                ? <Tooltip title={t.analytics.notRated} placement="top">
                                    <Box sx={{ display: 'inline-flex' }}><QualityDots score={0} color="rgba(255,255,255,0.1)" /></Box>
                                  </Tooltip>
                                : <QualityDots score={0} color="rgba(255,255,255,0.1)" />}
                          </TableCell>
                          {/* T. Reacción */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', textAlign: 'center' }}>
                              {n.reaction_time_min != null ? formatReactionTime(n.reaction_time_min, n.reaction_time_seconds) : '—'}
                            </Typography>
                          </TableCell>
                          {/* Última respuesta */}
                          <TableCell sx={{ ...NSUB, textAlign: 'center' }}>
                            <Typography sx={{ fontSize: '0.75rem', color: replied ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)', textAlign: 'center' }}>
                              {n.last_at ? formatLastAt(n.last_at) : '—'}
                            </Typography>
                          </TableCell>
                          {/* Notas */}
                          <TableCell sx={{ ...NSUB, minWidth: 200, maxWidth: 240, textAlign: 'center' }}>

                            {!replied
                              ? <Typography sx={{ color: 'rgba(248,113,113,0.5)', fontSize: '0.72rem', fontStyle: 'italic' }}>{t.analytics.noReply}</Typography>
                              : n.notes
                                ? <Tooltip title={n.notes} placement="top">
                                    <Typography component="button" onClick={() => setNotesFor({ name: row.company_name, text: n.notes })} sx={{ p: 0, border: 0, background: 'none', fontFamily: 'inherit', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer', textAlign: 'center', width: '100%', mx: 'auto', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: 220 }}>
                                      {n.notes}
                                    </Typography>
                                  </Tooltip>
                                : <Typography sx={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.72rem' }}>—</Typography>}
                          </TableCell>
                          <TableCell colSpan={3} sx={NSUB}><Box sx={ACTION_GROUP_SX}>
                          {/* Andy por número — deshabilitado si no respondió o sin análisis */}
                          <Box>
                            <Tooltip title={!replied ? t.analytics.noReply : !hasAnalysis ? t.analytics.noAnalysis : t.analytics.sendToAndy}>
                              <span>
                                <IconButton size="small" disabled={!replied || !hasAnalysis} onClick={() => openBotBuilder(row)}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <SendIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                          {/* Modificar Bot por número — solo industrias de gas */}
                          <Box>
                            {(() => {
                              const isGas = isGasIndustry(row.industry)
                              return (
                                <Tooltip title={!isGas ? t.analytics.notGasIndustry : t.analytics.modifyBotTooltip}>
                                  <span>
                                    <IconButton size="small" disabled={!isGas} onClick={() => openGasBot(row, n.number)}
                                      sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: '#fb923c', bgcolor: 'rgba(251,146,60,0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                      <LocalGasStationIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )
                            })()}
                          </Box>
                          {/* PDF por número */}
                          <Box>
                            <Tooltip title={isGenNum ? t.analytics.generating : generating ? t.analytics.pleaseWait : !replied ? t.analytics.noReply : `${t.analytics.reportPdf} ${shortNum}`}>
                              <span>
                                <IconButton size="small" disabled={!!generating || (!replied && n.category !== 'sin_respuesta')} onClick={() => handleGenerateReport(row, n.number)}
                                  sx={{ color: isGenNum ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  {isGenNum ? <CircularProgress size={14} sx={{ color: 'var(--accent,#6366f1)' }} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                          {/* Evaluación del canal WhatsApp por número */}
                          <Box>
                            <Tooltip title={!isGasIndustry(row.industry) ? t.analytics.notGasIndustry : !replied && n.category !== 'sin_respuesta' ? t.analytics.noReply : `${lang === 'en' ? 'WhatsApp channel evaluation' : 'Evaluación del canal WhatsApp'} ${shortNum}`}>
                              <span>
                                <IconButton size="small" disabled={!isGasIndustry(row.industry) || (!replied && n.category !== 'sin_respuesta')} onClick={() => setEvalFor({ id: row.company_id, name: row.company_name, number: n.number })}
                                  sx={{ color: 'rgba(255,255,255,0.35)', '&:hover': { color: 'var(--accent,#6366f1)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' }, '&.Mui-disabled': { opacity: 0.3 }, '[data-theme-mode="light"] &:not(.Mui-disabled)': { color: 'rgba(15,23,42,0.65)' } }}>
                                  <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                          </Box></TableCell>
                        </TableRow>
                      )
                    })}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

    </Box>

      {/* Pagination stays outside the scroll area so it is always reachable. */}
      <Box data-analytics-pagination sx={{
        display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 1,
        alignItems: 'center', justifyContent: 'space-between',
        px: 1.5, py: 1.25, borderTop: '1px solid var(--border)', flexShrink: 0,
        bgcolor: 'var(--card-bg, #161d2e)',
      }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.25, rowGap: 0.75 }}>
        <Typography component="label" id="analytics-page-size-label" htmlFor="analytics-page-size"
          sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {t.db.rowsPerPage.replace(/:$/, '')}
        </Typography>
        <Select size="small" id="analytics-page-size" labelId="analytics-page-size-label" value={rowsPerPage}
          onChange={event => {
            setRowsPerPage(Number(event.target.value))
            setPage(1)
          }}
          sx={{ width: 68, height: 30, borderRadius: 1.5, bgcolor: 'var(--item-hover)',
            '& .MuiSelect-icon': { color: 'var(--text-muted)', fontSize: 18 },
            '& .MuiSelect-select': { color: 'var(--text)', fontSize: '0.75rem', fontWeight: 600, py: 0.5, pl: 1.25 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)' },
          }}>
          {[15, 25, 50].map(count => <MenuItem key={count} value={count}>{count}</MenuItem>)}
        </Select>
        <Divider orientation="vertical" sx={{ height: 16, borderColor: 'var(--border)', mx: 0.25, display: { xs: 'none', md: 'block' } }} />
        <Typography sx={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          <Box component="span" sx={{ color: 'var(--text)', fontWeight: 600 }}>
            {totalItems ? (page - 1) * rowsPerPage + 1 : 0}–{Math.min(page * rowsPerPage, totalItems)}
          </Box>
          {' '}{t.analytics.of}{' '}<Box component="span" sx={{ color: 'var(--text)', fontWeight: 600 }}>{totalItems}</Box>{' '}{t.analytics.companies}
        </Typography>
        </Box>
        <Pagination count={totalPages} page={page} size="small" siblingCount={0} showFirstButton showLastButton
          onChange={(_, nextPage) => {
            setPage(nextPage)
            const scroll = scrollRef.current
            const filters = filtersRef.current
            const table = tableRegionRef.current
            if (scroll && filters && table) scroll.scrollTo({
              top: Math.max(0, table.offsetTop - filters.getBoundingClientRect().height),
            })
          }}
          getItemAriaLabel={(type, itemPage) => type === 'page'
            ? `${t.analytics.page} ${itemPage}`
            : (lang === 'en'
              ? { first: 'First page', last: 'Last page', next: 'Next page', previous: 'Previous page' }
              : { first: 'Primera página', last: 'Última página', next: 'Página siguiente', previous: 'Página anterior' })[type]}
          sx={{ ml: 'auto',
            '& .MuiPagination-ul': { gap: 0.25, flexWrap: 'nowrap' },
            '& .MuiPaginationItem-root': {
              color: 'var(--text-muted)', borderRadius: 1.5, minWidth: 30, height: 30,
              mx: 0, fontSize: '0.75rem', border: '1px solid transparent',
              '&:hover': { bgcolor: 'var(--item-hover)', color: 'var(--text)' },
              '&.Mui-disabled': { opacity: 0.25 },
              '&.Mui-selected': {
                bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.15)', color: 'var(--accent, #3b82f6)',
                borderColor: 'rgba(var(--accent-rgb, 59,130,246), 0.3)', fontWeight: 700,
                '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.23)' },
              },
            },
          }} />
      </Box>

      <AndyBotBuilder open={botBuilderOpen} initialData={botBuilderRow} onClose={() => { setBotBuilderOpen(false); setBotBuilderRow(null) }} />

      <GasBotModal open={gasBotOpen} initialData={gasBotRow} onClose={() => { setGasBotOpen(false); setGasBotRow(null) }} />

      {evalFor && (
        <EvaluacionDialog key={`${evalFor.id}_${evalFor.number || ''}`} open onClose={() => setEvalFor(null)}
          companyId={evalFor.id} companyName={evalFor.name} number={evalFor.number} />
      )}

      {isAdmin && (
        <ClassificationSettingsModal open={classificationSettingsOpen} onClose={() => setClassificationSettingsOpen(false)} />
      )}

      {compareFor && (
        <ComparisonDialog companyId={compareFor.id} companyName={compareFor.name} number={compareFor.number}
          onClose={() => setCompareFor(null)} onChanged={mutateAnalytics} />
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>

      <Dialog open={!!pendingReportConfirm} onClose={() => setPendingReportConfirm(null)} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#1e293b)', backgroundImage: 'none', color: 'var(--text,#f1f5f9)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 3 } } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <WarningAmberIcon sx={{ fontSize: 20, color: '#f59e0b' }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>Análisis todavía en progreso</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {pendingReportConfirm?.message}
            {pendingReportConfirm?.resolvesBy && (
              <> Se resuelve solo antes de las {new Date(pendingReportConfirm.resolvesBy).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}.</>
            )}
            {' '}¿Quieres descargarlo de todos modos con esa categoría aún sin confirmar?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setPendingReportConfirm(null)} sx={{ color: 'var(--text-muted)', textTransform: 'none' }}>
            Esperar
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const { row, filterNum } = pendingReportConfirm
              setPendingReportConfirm(null)
              handleGenerateReport(row, filterNum, true)
            }}
            sx={{ bgcolor: '#f59e0b', color: '#000', textTransform: 'none', fontWeight: 700, '&:hover': { bgcolor: '#fbbf24' } }}>
            Descargar de todos modos
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!reportPreview} onClose={closeReportPreview} maxWidth={false} fullWidth
        slotProps={{ paper: { sx: { bgcolor: 'var(--card-bg,#1e293b)', backgroundImage: 'none', color: 'var(--text,#f1f5f9)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3, width: 'min(1400px, calc(100vw - 32px))', maxWidth: 'none', height: '94dvh', maxHeight: 'calc(100dvh - 24px)', m: 1.5 } } }}>
        <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
            <PictureAsPdfIcon sx={{ fontSize: 20, color: '#ef4444' }} />
            <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {reportPreview?.fileName}
            </Typography>
          </Box>
          <IconButton size="small" onClick={closeReportPreview} sx={{ color: 'var(--text-muted)' }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', bgcolor: '#303134' }}>
          {reportPreview?.url && (
            <iframe title={lang === 'en' ? 'Report preview' : 'Vista previa del reporte'} src={`${reportPreview.url}#view=FitH&pagemode=none&navpanes=0`} style={{ flex: 1, width: '100%', height: '100%', minHeight: 0, border: 0 }} />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
          <Button onClick={closeReportPreview} sx={{ color: 'var(--text-muted)', textTransform: 'none' }}>
            Cerrar
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon sx={{ fontSize: 18 }} />}
            onClick={downloadReportPreview}
            sx={{ bgcolor: 'var(--accent,#6366f1)', textTransform: 'none', fontWeight: 700 }}>
            Descargar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
