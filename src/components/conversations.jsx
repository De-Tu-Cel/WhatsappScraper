'use client'
import { useState, useEffect, useRef, useCallback, useMemo, Fragment, memo, useTransition } from 'react'
import { MAX_WA_MSG } from '@/lib/validators'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import { useUser } from '../context/UserContext'
import { useNavigation } from '../context/NavigationContext'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Badge from '@mui/material/Badge'
import Tooltip from '@mui/material/Tooltip'
import InputAdornment from '@mui/material/InputAdornment'
import SendIcon from '@mui/icons-material/Send'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SearchIcon from '@mui/icons-material/Search'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import BusinessIcon from '@mui/icons-material/Business'
import RefreshIcon from '@mui/icons-material/Refresh'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import DoneIcon from '@mui/icons-material/Done'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import MicIcon from '@mui/icons-material/Mic'
import ImageIcon from '@mui/icons-material/Image'
import VideocamIcon from '@mui/icons-material/Videocam'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import PersonIcon from '@mui/icons-material/Person'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import ArticleIcon from '@mui/icons-material/Article'
import Popover from '@mui/material/Popover'
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions'
import TuneIcon from '@mui/icons-material/Tune'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import { getCategoryConfig } from '@/lib/categoryConfig'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { InstanceDisconnectedBanner, SendErrorBanner, InstanceStatusDot } from './InstanceStatusBanner'
import ChatAIConfig from './ChatAIConfig'

const EMOJI_GROUPS = [
  { label: { en: 'Frequent',  es: 'Frecuentes' }, emojis: ['😀','😂','🥹','😊','😍','🤩','😎','🥳','😅','😭','😤','🤔','👍','👎','👋','🙌','🤝','❤️','🔥','✅','⭐','🎉','💯','🚀'] },
  { label: { en: 'Business',  es: 'Negocio' },    emojis: ['📞','📱','💬','📧','📝','💼','🏢','💰','📊','📈','🤝','⏰','📅','✔️','❌','⚠️','💡','🔔','📌','🔍'] },
  { label: { en: 'Gestures',  es: 'Gestos' },     emojis: ['👏','🙏','💪','🤞','✌️','🤙','👌','🫡','🫶','🫂','😁','😇','🥰','😘','🤗','😶','🙄','😴','🤯','🥴'] },
]

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

const _TZ = 'America/Mexico_City'

// WhatsApp bubble outline — tile for chat background (no fill, stroke only)
const _WA_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">',
  // large bubble (top-left)
  '<g transform="translate(5,3) scale(0.9)">',
  '<path d="M25 5C13.9 5 5 13.9 5 25c0 3.8 1.1 7.4 2.9 10.4L5 45l9.9-2.9C17.8 43.6 21.3 45 25 45c11.1 0 20-8.9 20-20S36.1 5 25 5z" fill="none" stroke="rgba(37,211,102,0.15)" stroke-width="2" stroke-linejoin="round"/>',
  '<path d="M17 19c0-.8.7-1.5 1.5-1.5H22l2 5-2.5 2c1.5 2.5 3.5 4.5 6 6l2-2.5 5 2v3.5c0 .8-.7 1.5-1.5 1.5C24 34.5 17 27 17 19z" fill="none" stroke="rgba(37,211,102,0.15)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  '</g>',
  // small bubble (bottom-right, rotated)
  '<g transform="translate(60,58) rotate(-12) scale(0.52)">',
  '<path d="M25 5C13.9 5 5 13.9 5 25c0 3.8 1.1 7.4 2.9 10.4L5 45l9.9-2.9C17.8 43.6 21.3 45 25 45c11.1 0 20-8.9 20-20S36.1 5 25 5z" fill="none" stroke="rgba(37,211,102,0.09)" stroke-width="2" stroke-linejoin="round"/>',
  '</g>',
  '</svg>',
].join('')
const WA_BG_PATTERN = `url("data:image/svg+xml,${encodeURIComponent(_WA_SVG)}")`

function formatTime(iso, lang = 'es') {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  const loc = lang === 'en' ? 'en-US' : 'es-MX'
  if (diff < 0) return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', timeZone: _TZ })
  if (diff < 60000) return lang === 'en' ? 'now' : 'ahora'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone: _TZ })
  return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', timeZone: _TZ })
}

function localeFor(lang) { return lang === 'en' ? 'en-US' : 'es-MX' }

// Hora del mensaje dentro del hilo — siempre HH:MM, nunca la fecha
// (el día se muestra aparte con el divisor sticky, igual que WhatsApp).
function formatMsgTime(iso, lang) {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit', timeZone: _TZ })
}

// Clave de día estable (YYYY-MM-DD en la zona horaria del negocio) para agrupar mensajes.
function dayKey(iso) {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: _TZ })
}

function isToday(iso) {
  return dayKey(iso) === dayKey(new Date().toISOString())
}

function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// No devuelve nada para "hoy" — esos mensajes no llevan divisor, solo los días anteriores.
function formatDateLabel(iso, lang, t) {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t.convs.yesterday
  return capitalizeFirst(d.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: _TZ }))
}

function DateDivider({ label }) {
  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'center', py: 0.8, mb: 0.4, pointerEvents: 'none' }}>
      <Box sx={{
        bgcolor: 'var(--card-bg)', backdropFilter: 'blur(4px)',
        border: '1px solid var(--border)',
        borderRadius: 99, px: 1.4, py: 0.35, boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
      }}>
        <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

function StatusIcon({ status, direction }) {
  if (direction === 'inbound') return null
  if (status === 'read')      return <DoneAllIcon sx={{ fontSize: 13, color: 'var(--accent, #60a5fa)' }} />
  if (status === 'delivered') return <DoneAllIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />
  if (status === 'sent')      return <DoneIcon    sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />
  return <AccessTimeIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }} />
}

function TypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center', ml: 0.5 }}>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width: 5, height: 5, borderRadius: '50%',
          bgcolor: 'var(--accent, #a5b4fc)',
          opacity: 0.7,
          animation: 'ai-bounce 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.18}s`,
          '@keyframes ai-bounce': {
            '0%, 60%, 100%': { transform: 'translateY(0)' },
            '30%': { transform: 'translateY(-5px)' },
          },
        }} />
      ))}
    </Box>
  )
}

function ConversationItemSkeleton() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: '1px solid var(--border)' }}>
      <Skeleton variant="rounded" width={40} height={40} sx={{ borderRadius: 2, flexShrink: 0, bgcolor: 'rgba(255,255,255,0.06)' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.6 }}>
          <Skeleton variant="text" width="45%" sx={{ bgcolor: 'rgba(255,255,255,0.08)' }} />
          <Skeleton variant="text" width={30} sx={{ bgcolor: 'rgba(255,255,255,0.06)' }} />
        </Box>
        <Skeleton variant="text" width="75%" sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />
      </Box>
    </Box>
  )
}

// Comparator ignores onClick (it's always () => setSelected(conv), stable behavior)
const ConversationItem = memo(function _ConversationItem({ conv, active, onClick }) {
  const { lang } = useLang()
  const isInbound = conv.last_direction === 'inbound'
  const domain = conv.domain || conv.website?.replace(/https?:\/\/(www\.)?/, '').split('/')[0] || ''
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5,
      cursor: 'pointer', borderBottom: '1px solid var(--border)',
      bgcolor: active ? 'rgba(var(--accent-rgb, 99,102,241), 0.12)' : 'transparent',
      borderLeft: active ? '2px solid var(--accent, #6366f1)' : '2px solid transparent',
      transition: 'all 0.15s',
      '&:hover': { bgcolor: active ? 'rgba(var(--accent-rgb, 99,102,241), 0.12)' : 'rgba(255,255,255,0.03)' },
    }}>
      {/* Avatar */}
      <Badge badgeContent={conv.unread || 0} color="error"
        sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', minWidth: 16, height: 16 } }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 2, flexShrink: 0, overflow: 'hidden',
          bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.15)', border: '1px solid rgba(var(--accent-rgb, 99,102,241), 0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {domain ? (
            <Box component="img"
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              sx={{ width: 22, height: 22, objectFit: 'contain' }}
              onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
          ) : null}
          <Box sx={{ display: domain ? 'none' : 'flex', color: 'var(--accent, #a5b4fc)', fontWeight: 800, fontSize: '1rem', textTransform: 'uppercase' }}>
            {(conv.company_name || '?')[0]}
          </Box>
        </Box>
      </Badge>
      {/* Info */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
            <Typography sx={{ color: conv.unread ? 'white' : 'rgba(255,255,255,0.8)', fontWeight: conv.unread ? 700 : 500, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {conv.company_name || conv.company_id}
            </Typography>
            {conv.ai_active && (
              <Tooltip title={conv.ai_typing ? (lang === 'en' ? 'AI Chat is typing...' : 'Chat IA está redactando...') : (lang === 'en' ? 'AI Chat active' : 'Chat IA en conversación')}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0, ml: 0.5,
                  bgcolor: conv.ai_typing ? 'rgba(var(--accent-rgb,99,102,241),0.25)' : 'rgba(var(--accent-rgb,99,102,241),0.1)',
                  border: '1px solid rgba(var(--accent-rgb,99,102,241),0.5)',
                  animation: conv.ai_typing ? 'ai-pulse 1s ease-in-out infinite' : 'none',
                  '@keyframes ai-pulse': {
                    '0%, 100%': { boxShadow: '0 0 0 0 rgba(var(--accent-rgb,99,102,241),0.4)' },
                    '50%': { boxShadow: '0 0 0 4px rgba(var(--accent-rgb,99,102,241),0)' },
                  },
                }}>
                  <SmartToyIcon sx={{ fontSize: 8, color: 'var(--accent, #a5b4fc)' }} />
                </Box>
              </Tooltip>
            )}
            {conv.last_analysis?.category && (() => {
              const cfg = getCategoryConfig(conv.last_analysis)
              const Icon = cfg.icon
              return (
                <Box sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, ml: 0.5,
                  border: `1px solid ${cfg.color}44`, bgcolor: cfg.bg,
                }}>
                  <Icon sx={{ fontSize: 11, color: cfg.color }} />
                </Box>
              )
            })()}
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem', flexShrink: 0, ml: 0.75 }}>
            {formatTime(conv.last_at, lang)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          {conv.sent_by_name && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.3, flexShrink: 0,
              bgcolor: agentColor(conv.sent_by_name) + '18',
              border: `1px solid ${agentColor(conv.sent_by_name)}44`,
              borderRadius: 1, px: 0.6, py: 0.1,
            }}>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: agentColor(conv.sent_by_name), flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.62rem', color: agentColor(conv.sent_by_name), fontWeight: 700, lineHeight: 1.4 }}>
                {conv.sent_by_name.split(' ')[0]}
              </Typography>
            </Box>
          )}
          <Typography sx={{
            color: isInbound ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)',
            fontSize: '0.73rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontStyle: isInbound ? 'normal' : 'italic', flex: 1, minWidth: 0,
          }}>
            {conv.last_message || '—'}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}, (prev, next) => prev.active === next.active && prev.conv === next.conv)

const MEDIA_LABELS = {
  '[sticker]':  { Icon: EmojiEmotionsIcon,   label: { en: 'Sticker',   es: 'Sticker' } },
  '[audio]':    { Icon: MicIcon,             label: { en: 'Audio',     es: 'Audio' } },
  '[imagen]':   { Icon: ImageIcon,           label: { en: 'Image',     es: 'Imagen' } },
  '[image]':    { Icon: ImageIcon,           label: { en: 'Image',     es: 'Imagen' } },
  '[video]':    { Icon: VideocamIcon,        label: { en: 'Video',     es: 'Video' } },
  '[location]': { Icon: LocationOnIcon,      label: { en: 'Location',  es: 'Ubicación' } },
  '[contact]':  { Icon: PersonIcon,          label: { en: 'Contact',   es: 'Contacto' } },
  '[document]': { Icon: InsertDriveFileIcon, label: { en: 'Document',  es: 'Documento' } },
  '[media]':    { Icon: AttachFileIcon,      label: { en: 'Media',     es: 'Multimedia' } },
  '[template]': { Icon: ArticleIcon,         label: { en: 'Template',  es: 'Plantilla' } },
}

function InteractiveMessage({ interactive, isOut, onReply }) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [sent, setSent] = useState(null)
  const { type, text, options = [] } = interactive
  const accent = isOut ? 'rgba(var(--accent-rgb,99,102,241),0.9)' : 'rgba(255,255,255,0.85)'
  const borderColor = isOut ? 'rgba(var(--accent-rgb,99,102,241),0.4)' : 'rgba(255,255,255,0.18)'

  function handleSelect(opt) {
    if (sent || isOut) return
    setSent(opt)
    setOpen(false)
    onReply?.(opt)
  }

  return (
    <Box>
      {text && (
        <Typography sx={{ color: 'rgba(255,255,255,0.88)', fontSize: '0.83rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: options.length ? 1 : 0,
          fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif' }}>
          {text}
        </Typography>
      )}

      {type === 'buttons' && options.length <= 3 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, borderTop: `1px solid ${borderColor}`, pt: 0.8 }}>
          {options.map((opt, i) => {
            const isSent = sent === opt
            return (
              <Box key={i} onClick={() => handleSelect(opt)} sx={{
                py: 0.6, px: 1, borderRadius: 1.5, textAlign: 'center',
                cursor: isOut || sent ? 'default' : 'pointer',
                border: `1px solid ${isSent ? 'rgba(74,222,128,0.5)' : borderColor}`,
                bgcolor: isSent ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
                transition: 'all 0.15s',
                '&:hover': !isOut && !sent ? { bgcolor: 'rgba(255,255,255,0.1)', borderColor: accent } : {},
              }}>
                <Typography sx={{ color: isSent ? '#4ade80' : accent, fontSize: '0.8rem', fontWeight: 600 }}>
                  {isSent ? `✓ ${opt}` : opt}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}

      {(type === 'list' || (type === 'buttons' && options.length > 3)) && (
        <>
          <Box onClick={e => { setAnchor(e.currentTarget); setOpen(true) }} sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8,
            mt: 0.5, py: 0.7, borderRadius: 1.5, cursor: 'pointer',
            borderTop: `1px solid ${borderColor}`,
            '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
          }}>
            <Typography sx={{ fontSize: '0.85rem', lineHeight: 1 }}>📋</Typography>
            <Typography sx={{ color: accent, fontSize: '0.8rem', fontWeight: 600 }}>
              {lang === 'en' ? `View options (${options.length})` : `Ver opciones (${options.length})`}
            </Typography>
            <Typography sx={{ color: accent, fontSize: '0.75rem' }}>›</Typography>
          </Box>
          <Popover open={open} anchorEl={anchor} onClose={() => setOpen(false)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, minWidth: 220, maxWidth: 300, overflow: 'hidden' } } }}>
            <Box sx={{ p: 1.5 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1 }}>{lang === 'en' ? 'Options' : 'Opciones'}</Typography>
              {options.map((opt, i) => {
                const isSent = sent === opt
                return (
                  <Box key={i} onClick={() => handleSelect(opt)} sx={{
                    py: 0.8, px: 1, borderRadius: 1.5, mb: 0.4, cursor: isOut || sent ? 'default' : 'pointer',
                    bgcolor: isSent ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isSent ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    transition: 'all 0.15s',
                    '&:hover': !isOut && !sent ? { bgcolor: 'rgba(255,255,255,0.08)' } : {},
                  }}>
                    <Typography sx={{ color: isSent ? '#4ade80' : 'rgba(255,255,255,0.85)', fontSize: '0.82rem', fontWeight: isSent ? 600 : 400 }}>
                      {isSent ? `✓ ${opt}` : opt}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          </Popover>
        </>
      )}

      {type === 'poll' && (
        <Box sx={{ mt: 0.5, borderTop: `1px solid ${borderColor}`, pt: 0.8 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.8 }}>📊 {lang === 'en' ? 'Poll' : 'Encuesta'}</Typography>
          {options.map((opt, i) => (
            <Box key={i} sx={{ mb: 0.5 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.78rem', mb: 0.2 }}>{opt}</Typography>
              <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)' }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

function formatSenderNumber(raw) {
  let d = String(raw).replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3)  // strip mobile "1" marker
  if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,5)} ${d.slice(5,8)} ${d.slice(8,12)}`
  if (d.length === 10) return `+52 ${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6,10)}`
  return d ? `+${d}` : raw
}

const MessageBubble = memo(function _MessageBubble({ msg, onReply }) {
  const { lang } = useLang()
  const isOut  = msg.direction === 'outbound'
  const isAI   = Boolean(msg.ai_generated)
  const raw    = msg.body || msg.message_body || ''
  const media  = MEDIA_LABELS[raw.trim().toLowerCase()]
  const body   = raw || '—'
  const interactive = msg.interactive
  const sentLabel = isOut ? (msg.instance_number ? formatSenderNumber(msg.instance_number) : msg.instance_name) : null
  return (
    <Box sx={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', mb: 0.8, px: 2 }}>
      <Box sx={{
        position: 'relative',
        maxWidth: '72%', px: 1.5, py: 1,
        borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        bgcolor: isOut
          ? isAI ? 'rgba(var(--accent-rgb, 99,102,241), 0.88)' : 'var(--accent, #6366f1)'
          : 'var(--card-bg, #161d2e)',
        border: `1px solid ${isOut
          ? 'rgba(0,0,0,0.15)'
          : 'rgba(255,255,255,0.1)'}`,
      }}>
        {interactive ? (
          <InteractiveMessage interactive={interactive} isOut={isOut} onReply={onReply} />
        ) : media ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <media.Icon sx={{ fontSize: 18, color: isOut ? 'rgba(var(--accent-rgb, 99,102,241), 0.9)' : 'rgba(255,255,255,0.5)' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', fontStyle: 'italic' }}>
              {media.label[lang] || media.label.es}
            </Typography>
          </Box>
        ) : (
          <Typography sx={{ color: 'rgba(255,255,255,0.88)', fontSize: '0.83rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif' }}>
            {body}
          </Typography>
        )}
        {sentLabel && (
          <Tooltip title={lang === 'en' ? 'Sent from this number' : 'Enviado desde este número'}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.3, mt: 0.5, opacity: 0.55 }}>
              <PhoneAndroidIcon sx={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.62rem', fontFamily: 'monospace', letterSpacing: '0.01em' }}>
                {sentLabel}
              </Typography>
            </Box>
          </Tooltip>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem' }}>
            {formatMsgTime(msg.created_at, lang)}
          </Typography>
          <StatusIcon status={msg.status} direction={msg.direction} />
        </Box>
        {/* AI badge — bottom-right corner of bubble */}
        {isAI && (
          <Tooltip title={lang === 'en' ? 'Sent by AI Chat' : 'Enviado por Chat IA'}>
            <Box sx={{
              position: 'absolute', bottom: -4, right: -4,
              width: 16, height: 16, borderRadius: '50%',
              bgcolor: 'var(--accent, #6366f1)',
              border: '2px solid var(--sidebar-bg, #0d1117)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <SmartToyIcon sx={{ fontSize: 8, color: '#fff' }} />
            </Box>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
})

function ThreadSkeleton() {
  const BUBBLES = [
    { align: 'flex-start', w: '68%', h: 52 },
    { align: 'flex-end',   w: '42%', h: 38 },
    { align: 'flex-start', w: '80%', h: 72 },
    { align: 'flex-end',   w: '55%', h: 44 },
    { align: 'flex-start', w: '44%', h: 36 },
    { align: 'flex-end',   w: '72%', h: 60 },
    { align: 'flex-end',   w: '35%', h: 36 },
    { align: 'center',     w: '26%', h: 20, isDivider: true },
    { align: 'flex-start', w: '62%', h: 56 },
    { align: 'flex-end',   w: '48%', h: 40 },
    { align: 'flex-start', w: '76%', h: 80 },
    { align: 'flex-end',   w: '38%', h: 36 },
    { align: 'flex-start', w: '58%', h: 44 },
    { align: 'flex-end',   w: '65%', h: 64 },
    { align: 'flex-start', w: '50%', h: 36 },
    { align: 'flex-end',   w: '30%', h: 36 },
  ]

  // All bubbles share the same phase — one calm, unified breath, no strobing
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: 1.4, px: 2, pt: 2.5, pb: 5,
      '@keyframes skelBreathe': {
        '0%,100%': { opacity: 0.45 },
        '50%':     { opacity: 0.75 },
      },
      animation: 'skelBreathe 2.8s ease-in-out infinite',
    }}>
      {BUBBLES.map((b, i) => {
        if (b.isDivider) {
          return (
            <Box key={i} sx={{
              alignSelf: 'center', width: b.w, height: b.h,
              borderRadius: 99, bgcolor: 'rgba(255,255,255,0.08)',
              mt: 0.5, mb: 0.5,
            }} />
          )
        }
        const isEnd = b.align === 'flex-end'
        return (
          <Box key={i} sx={{
            alignSelf: b.align, width: b.w, maxWidth: '74%', height: b.h,
            borderRadius: isEnd ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
            bgcolor: isEnd ? 'rgba(var(--accent-rgb,99,102,241),0.18)' : 'rgba(255,255,255,0.08)',
          }} />
        )
      })}
    </Box>
  )
}

export default function Conversations() {
  const [convs, setConvs]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [thread, setThread]         = useState([])
  const [threadLoad, setThreadLoad] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [, startSearchTransition]     = useTransition()
  const [reply, setReply]           = useState('')
  const replyValueRef = useRef('')
  replyValueRef.current = reply
  const [sending, setSending]       = useState(false)
  const [attachedFile, setAttachedFile] = useState(null) // {file, name, type}
  const [uploading, setUploading]   = useState(false)
  const fileInputRef = useRef(null)
  const [waNumbers, setWaNumbers]       = useState([])
  const [selectedNums, setSelectedNums] = useState([])
  const [activeNum, setActiveNum]       = useState('all')
  const [syncing, setSyncing]           = useState(false)
  const [emojiAnchor, setEmojiAnchor]   = useState(null)
  const [emojiGroup, setEmojiGroup]     = useState(0)
  const syncingRef                      = useRef(false)
  const lastSyncedRef                   = useRef(null)  // evita re-sync al mismo company
  const { stats: dailyStats, refresh: fetchDailyStats } = useDailyCapStats()
  const currentCompanyRef               = useRef(null)  // evita race condition en fetchCompanyNumbers
  const { t, lang } = useLang()
  const { user } = useUser()
  const [myConvsOnly, setMyConvsOnly] = useState(false)
  const threadLenRef    = useRef(0)
  const messagesBoxRef  = useRef(null)
  const listBoxRef      = useRef(null)
  const [skeletonCount, setSkeletonCount] = useState(7)
  const pendingScrollRef = useRef(false)
  const replyRef  = useRef(null)
  const [sendError, setSendError] = useState('')
  const [aiTyping, setAiTyping]         = useState(false)
  const [aiActive, setAiActive]         = useState(false)
  const [aiEnabled, setAiEnabled]       = useState(false)
  const [aiToggling, setAiToggling]     = useState(false)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()
  const { pendingConvId, pendingConvNumber, clearPendingConv } = useNavigation()
  const pendingNumRef = useRef(null)

  // Diagnóstico de por qué el seguimiento automático de IA podría estar en
  // pausa ahora mismo (circuit breaker del proveedor / fuera de horario) — se
  // muestra como banner en vez de que el usuario tenga que revisar logs.
  const [aiHealth, setAiHealth] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const r = await fetch('/api/conversations/ai-health')
        const d = await r.json()
        if (!cancelled && r.ok) setAiHealth(d)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])


  // When a notification card is clicked, auto-select the matching conversation
  useEffect(() => {
    if (!pendingConvId) return
    if (!convs.length) {
      // Convs not loaded yet — fetchConvs will set convs and re-trigger this effect
      fetchConvs()
      return
    }
    const match = convs.find(c => c.company_id === pendingConvId)
    if (match) {
      pendingNumRef.current = pendingConvNumber || null
      setSelected(match)
      clearPendingConv()
      // Scroll the selected item into view
      setTimeout(() => {
        const el = listBoxRef.current?.querySelector(`[data-company-id="${match.company_id}"]`)
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 80)
    } else {
      // Company not in current list — refresh and retry (handles newly registered contacts)
      fetchConvs()
    }
  }, [pendingConvId, convs, pendingConvNumber, clearPendingConv, fetchConvs])

  // Once the company's numbers load, jump straight to the one that sent the notification
  // instead of leaving activeNum on 'all' (which shows the "select a number" placeholder)
  useEffect(() => {
    if (!pendingNumRef.current || waNumbers.length === 0) return
    const norm = v => (v || '').replace(/\D/g, '').slice(-10)
    const target = norm(pendingNumRef.current)
    const match = waNumbers.find(n => norm(n) === target)
    if (match) setActiveNum(match)
    pendingNumRef.current = null
  }, [waNumbers])

  const fetchConvs = useCallback(async () => {
    try {
      const res = await authFetch('/api/conversations')
      if (!res.ok) return
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      setConvs(list)
      setSelected(prev => prev && list.find(c => c.company_id === prev.company_id) ? prev : null)
    } catch {
      // Network error — keep existing convs visible
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchThread = useCallback(async (companyId, scrollToBottom = false, silent = false, numFilter = null) => {
    if (!silent) {
      if (scrollToBottom) setThreadLoad(true)
    }
    try {
      const params = numFilter && numFilter !== 'all' ? `?number=${encodeURIComponent(numFilter)}` : ''
      const res = await fetch(`/api/conversations/${companyId}${params}`)
      const data = await res.json()
      const msgs = Array.isArray(data) ? data : []
      if (silent) {
        setThread(prev => {
          if (msgs.length === prev.length) return prev
          return msgs
        })
        if (msgs.length > threadLenRef.current) {
          fetch(`/api/conversations/${companyId}`, { method: 'POST' }).catch(() => {})
          setConvs(prev => prev.map(c => c.company_id === companyId ? { ...c, unread: 0 } : c))
        }
      } else {
        setThread(msgs)
      }
      if (scrollToBottom || msgs.length > threadLenRef.current) {
        threadLenRef.current = msgs.length
        pendingScrollRef.current = scrollToBottom ? 'instant' : 'smooth'
      }
      threadLenRef.current = msgs.length
      if (!silent) {
        fetch(`/api/conversations/${companyId}`, { method: 'POST' }).catch(() => {})
        setConvs(prev => prev.map(c => c.company_id === companyId ? { ...c, unread: 0 } : c))
      }
    } catch {
      if (!silent) setThread([])
    } finally {
      if (!silent) setThreadLoad(false)
    }
  }, [])

  const fetchCompanyNumbers = useCallback(async (companyId) => {
    currentCompanyRef.current = companyId
    try {
      const res = await fetch(`/api/companies/${companyId}`)
      const data = await res.json()
      if (currentCompanyRef.current !== companyId) return
      const numbers = [...new Set(
        (data.contacts || [])
          .filter(c => c.type === 'whatsapp')
          .map(c => c.value)
      )]
      setWaNumbers(numbers)
      setSelectedNums(numbers)
      // Don't override activeNum here — it's already set to 'all' by the selection effect
    } catch {
      if (currentCompanyRef.current !== companyId) return
      setWaNumbers([])
    }
  }, [])

  useEffect(() => { fetchConvs() }, [fetchConvs])

  // Ajusta cuántas filas de skeleton mostrar según el alto real del panel,
  // para que el placeholder llene el espacio en vez de dejar un hueco vacío.
  useEffect(() => {
    const el = listBoxRef.current
    if (!el) return
    const ROW_HEIGHT = 73
    const update = () => setSkeletonCount(Math.max(1, Math.ceil(el.clientHeight / ROW_HEIGHT) + 1))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      fetchConvs()
      if (selected) fetchThread(selected.company_id, false, true, activeNum !== 'all' ? activeNum : null)
    }, 20000)
    return () => clearInterval(id)
  }, [fetchConvs, fetchThread, selected, activeNum])

  // Scroll to bottom after thread renders — fires after DOM paint so scrollHeight is accurate
  useEffect(() => {
    const behavior = pendingScrollRef.current
    if (!behavior) return
    pendingScrollRef.current = false
    requestAnimationFrame(() => {
      messagesBoxRef.current?.scrollTo({ top: messagesBoxRef.current.scrollHeight, behavior })
    })
  }, [thread])

  // Poll AI follow-up status when a conversation is open
  useEffect(() => {
    if (!selected) {
      setAiTyping(false); setAiActive(false); setAiEnabled(false)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/conversations/${selected.company_id}/ai-status`)
        if (cancelled) return
        const data = await res.json()
        setAiEnabled(data.ai_enabled || false)
        setAiActive(data.ai_active || false)
        setAiTyping(prev => {
          const next = data.ai_typing || false
          if (!prev && next) {
            setTimeout(() => {
              messagesBoxRef.current?.scrollTo({ top: messagesBoxRef.current.scrollHeight, behavior: 'smooth' })
            }, 50)
          }
          return next
        })
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [selected])

  const handleAiToggle = useCallback(async () => {
    if (!selected || aiToggling) return
    const next = !aiEnabled
    // On first enable: check if config exists — if not, open config dialog first
    if (next) {
      try {
        const r = await fetch(`/api/conversations/${selected.company_id}/ai-config`)
        const d = await r.json()
        const hasConfig = r.ok && (d.extra_instructions || d.max_turns !== 3)
        if (!hasConfig) { setAiConfigOpen(true); return }
      } catch { /* proceed normally */ }
    }
    setAiToggling(true)
    try {
      await fetch(`/api/conversations/${selected.company_id}/ai-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      setAiEnabled(next)
      if (!next) setAiActive(false)
      fetchConvs()
    } catch { /* ignore */ } finally {
      setAiToggling(false)
    }
  }, [selected, aiEnabled, aiToggling, fetchConvs])

  // Sync reply target with active tab
  useEffect(() => {
    if (activeNum && activeNum !== 'all') setSelectedNums([activeNum])
    else setSelectedNums(waNumbers.slice(0, 1))
  }, [activeNum, waNumbers])

  // Re-fetch thread when user switches to a specific number tab
  useEffect(() => {
    if (!selected || !activeNum || activeNum === 'all') return
    fetchThread(selected.company_id, false, false, activeNum)
  }, [activeNum, selected, fetchThread])

  const handleSync = useCallback(async (companyId, force = false) => {
    if (!companyId || syncingRef.current) return
    if (!force && lastSyncedRef.current === companyId) return
    syncingRef.current = true
    lastSyncedRef.current = companyId
    setSyncing(true)
    try {
      const res  = await fetch(`/api/conversations/${companyId}/sync`, { method: 'POST' })
      const data = await res.json()
      if ((data.synced ?? 0) > 0) {
        await fetchThread(companyId, true)
        await fetchConvs()
      }
    } catch {}
    finally { syncingRef.current = false; setSyncing(false) }
  }, [fetchThread, fetchConvs])

  useEffect(() => {
    if (selected) {
      threadLenRef.current = 0
      setThread([])
      setWaNumbers([])    // clear old company's number tabs immediately
      setActiveNum('all')
      fetchThread(selected.company_id, true)
      fetchCompanyNumbers(selected.company_id)
      handleSync(selected.company_id)
    }
  }, [selected, fetchThread, fetchCompanyNumbers, handleSync])

  const handleSendReply = useCallback(async function handleSendReply(overrideText = null) {
    const text   = overrideText ?? replyValueRef.current
    const toSend = selectedNums.length > 0 ? selectedNums : waNumbers.slice(0, 1)
    if (!text.trim() && !attachedFile) return
    if (!selected || toSend.length === 0) return
    if (dailyStats && dailyStats.total_available <= 0) {
      setSendError(lang === 'en'
        ? `Daily limit reached (${dailyStats.total_sent}/${dailyStats.total_cap} messages). Resets at midnight UTC.`
        : `Límite diario alcanzado (${dailyStats.total_sent}/${dailyStats.total_cap} mensajes). Reinicia a las 00:00 UTC.`)
      return
    }
    setSendError('')
    setSending(true)

    // Upload file first if attached
    let mediaUrl = null
    let mediaField = null
    let mediaFileName = null
    if (attachedFile) {
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', attachedFile.file)
        const upRes = await authFetch('/api/files/upload', { method: 'POST', body: fd })
        if (!upRes.ok) {
          const err = await upRes.json().catch(() => ({}))
          throw new Error(err.detail || 'Error al subir archivo')
        }
        const upData = await upRes.json()
        mediaUrl = upData.url
        mediaField = attachedFile.type.startsWith('image/') ? 'image_url' : 'document_url'
        mediaFileName = attachedFile.name
      } catch (e) {
        setSendError(e.message)
        setSending(false)
        setUploading(false)
        return
      }
      setUploading(false)
    }

    // Route reply through the same instance that received the last inbound message
    const lastInbound = [...thread].reverse().find(m => m.direction === 'inbound')
    const replyInstance = lastInbound?.received_on_instance || null
    try {
      for (const num of toSend) {
        const payload = {
          company_id: selected.company_id,
          to_number: num,
          message: text.trim(),
          website: selected.website || '',
        }
        if (replyInstance) payload.instance = replyInstance
        if (mediaUrl) {
          payload[mediaField] = mediaUrl
          if (mediaField === 'document_url' && mediaFileName) payload.file_name = mediaFileName
        }
        const res = await authFetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Error ${res.status}`)
        }
      }
      // Optimistic update — show message immediately without waiting for the backend re-fetch
      const now = new Date().toISOString()
      setThread(prev => [
        ...prev,
        ...toSend.map(num => ({
          _id: `opt-${Date.now()}-${num}`,
          direction: 'outbound',
          message_body: text.trim(),
          body: text.trim(),
          to_number: num,
          status: 'pending',
          created_at: now,
          sent_at: now,
          platform: 'evolution',
          _optimistic: true,
        })),
      ])
      setReply('')
      if (replyRef._textarea) replyRef._textarea.value = ''
      setAttachedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      fetchDailyStats()
      const cid = selected.company_id
      setTimeout(() => fetchThread(cid, true), 1500)
      ;[4000, 8000].forEach(ms => setTimeout(() => fetchThread(cid, false, true), ms))
    } catch (err) {
      let msg = err.message || (lang === 'en' ? 'Failed to send message' : 'No se pudo enviar el mensaje')
      const ncMatch = msg.match(/^new_contact_limit:(\d+)$/)
      if (ncMatch) {
        const lim = ncMatch[1]
        msg = lang === 'en'
          ? `New-contact limit reached (${lim}/day) — this number can only start ${lim} new conversations per day.`
          : `Límite de contactos nuevos alcanzado (${lim}/día) — este número solo puede iniciar ${lim} conversaciones nuevas por día.`
      }
      setSendError(msg)
      setTimeout(() => setSendError(''), 8000)
    }
    finally { setSending(false) }
  }, [selectedNums, waNumbers, thread, selected, fetchThread, dailyStats, fetchDailyStats, lang])

  const filtered = useMemo(() => convs.filter(c => {
    if (myConvsOnly && c.sent_by_username !== user?.username) return false
    const q = search.toLowerCase()
    return (c.company_name || '').toLowerCase().includes(q) ||
           (c.industry     || '').toLowerCase().includes(q)
  }), [convs, myConvsOnly, user?.username, search])

  // Normalize: keep last 10 digits only for comparison
  const norm = n => (n || '').replace(/\D/g, '').slice(-10)

  // Stats per registered company number (using normalized comparison)
  const numStats = useMemo(() => {
    const stats = {}
    waNumbers.forEach(n => { stats[n] = { sent: 0, received: 0 } })
    thread.forEach(m => {
      const msgNum = norm(m.to_number || m.from_number || m.number)
      const match  = waNumbers.find(n => norm(n) === msgNum)
      if (match) {
        if (m.direction === 'outbound') stats[match].sent++
        else stats[match].received++
      }
    })
    return stats
  }, [thread, waNumbers])

  // Messages for the active tab (normalized comparison)
  const visibleThread = useMemo(() => {
    if (!activeNum || activeNum === 'all') return thread
    const target = norm(activeNum)
    // Only show unknown-number inbound in this tab if we actually sent to this number
    const sentToThisNum = thread.some(m =>
      m.direction === 'outbound' && norm(m.to_number || m.number) === target
    )
    return thread.filter(m => {
      const msgNum = norm(m.to_number || m.from_number || m.number)
      if (msgNum === target) return true
      // Include inbound from business/unknown numbers only if we sent to this tab's number
      if (m.direction === 'inbound' && !waNumbers.some(n => norm(n) === msgNum)) return sentToThisNum
      return false
    })
  }, [thread, activeNum, waNumbers])

  return (
    <>
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0, gap: 0, borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border)' }}>

      {/* ── Lista de conversaciones ── */}
      <Box sx={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', bgcolor: 'var(--sidebar-bg, #0d1117)' }}>
        {/* Header */}
        <Box sx={{ px: 2, pt: 2, pb: 1.5, borderBottom: '1px solid var(--border)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WhatsAppIcon sx={{ color: '#4ade80', fontSize: 20 }} />
              <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>{t.convs.title}</Typography>
            </Box>
            <Tooltip title={t.common.refresh}>
              <IconButton size="small" onClick={() => { setLoading(true); fetchConvs() }}
                sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text)' } }}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {(aiHealth?.circuit_open || aiHealth?.business_hours_active === false) && (
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 0.8, mb: 1.2, px: 1, py: 0.7,
              borderRadius: 1.5, bgcolor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
            }}>
              <SmartToyIcon sx={{ fontSize: 14, color: '#f59e0b', mt: 0.15, flexShrink: 0 }} />
              <Typography sx={{ color: '#f59e0b', fontSize: '0.7rem', lineHeight: 1.4 }}>
                {aiHealth.circuit_open ? t.convs.aiPausedCircuit : t.convs.aiPausedHours}
              </Typography>
            </Box>
          )}
          <TextField fullWidth size="small" placeholder={t.convs.search} value={searchInput}
            onChange={e => {
              const v = e.target.value
              setSearchInput(v)
              startSearchTransition(() => setSearch(v))
            }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'var(--text-muted)' }} /></InputAdornment> } }}
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8rem', bgcolor: 'var(--item-hover)', '& fieldset': { borderColor: 'var(--border)' }, '&:hover fieldset': { borderColor: 'var(--text-muted)' } }, '& input': { color: 'var(--text)', py: 0.8 } }} />

          {/* Toggle mis conversaciones / todas */}
          <Box sx={{ display: 'flex', mt: 1.5, bgcolor: 'var(--item-hover)', borderRadius: 2, p: 0.4, gap: 0.4 }}>
            {[
              { label: t.convs.allConvs, value: false },
              { label: t.convs.myConvs,  value: true },
            ].map(opt => (
              <Box key={String(opt.value)} onClick={() => setMyConvsOnly(opt.value)}
                sx={{
                  flex: 1, textAlign: 'center', py: 0.55, borderRadius: 1.5, cursor: 'pointer',
                  fontSize: '0.72rem', fontWeight: 600, transition: 'all 0.15s',
                  bgcolor: myConvsOnly === opt.value ? 'var(--accent, #3b82f6)' : 'transparent',
                  color: myConvsOnly === opt.value ? '#ffffff' : 'var(--text-muted)',
                  '&:hover': { color: myConvsOnly === opt.value ? '#ffffff' : 'var(--text)' },
                }}>
                {opt.label}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Lista */}
        <Box ref={listBoxRef} sx={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            Array.from({ length: skeletonCount }).map((_, i) => <ConversationItemSkeleton key={i} />)
          ) : filtered.length === 0 ? (
            <Box sx={{ px: 2, pt: 4, textAlign: 'center' }}>
              <WhatsAppIcon sx={{ fontSize: 36, color: 'rgba(255,255,255,0.1)', mb: 1 }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
                {searchInput ? t.common.noData : t.convs.noConvs}
              </Typography>
            </Box>
          ) : filtered.map(c => (
            <div key={c.company_id} data-company-id={c.company_id}>
              <ConversationItem conv={c}
                active={selected?.company_id === c.company_id}
                onClick={() => setSelected(c)} />
            </div>
          ))}
        </Box>

        {/* Total */}
        {!loading && convs.length > 0 && (
          <Box sx={{ px: 2, py: 1, borderTop: '1px solid var(--border)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem' }}>
              {convs.length} {convs.length !== 1 ? t.convs.conversations : t.convs.conversation} · {convs.reduce((a, c) => a + (c.unread || 0), 0)} {t.convs.unread}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Hilo de mensajes ── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {!selected ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%',
            backgroundImage: WA_BG_PATTERN, backgroundSize: '100px 100px' }}>
            <Box sx={{ textAlign: 'center', px: 4, py: 3, borderRadius: 3,
              bgcolor: 'var(--card-bg)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(37,211,102,0.22)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '50%', mx: 'auto', mb: 1.5,
                bgcolor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ForumOutlinedIcon sx={{ fontSize: 20, color: 'rgba(37,211,102,0.7)' }} />
              </Box>
              <Typography sx={{ color: 'var(--text)', fontSize: '0.92rem', fontWeight: 600, mb: 0.4 }}>
                {t.convs.noneSelected}
              </Typography>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {t.convs.pickCompany}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Header del hilo */}
            <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {/* Fila superior: nombre + link + refresh */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: waNumbers.length > 0 ? 1 : 0 }}>
                <BusinessIcon sx={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.9rem' }}>
                    {selected.company_name}
                  </Typography>
                  {selected.industry && (
                    <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>{selected.industry}</Typography>
                  )}
                </Box>
                {selected.website && (
                  <Chip label={selected.domain || selected.website} size="small" component="a"
                    href={selected.website} target="_blank" clickable
                    sx={{ fontSize: '0.7rem', height: 20, bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)', maxWidth: 180, overflow: 'hidden' }} />
                )}
              {syncing && (
                <CircularProgress size={12} sx={{ color: 'rgba(255,255,255,0.2)', mr: 0.5 }} />
              )}
                {/* AI toggle — pill switch with SmartToy ball */}
                <Tooltip title={aiEnabled ? t.convs.andyOn : t.convs.andyOff}>
                  <Box onClick={aiToggling ? undefined : handleAiToggle} sx={{
                    position: 'relative', cursor: aiToggling ? 'default' : 'pointer',
                    width: 42, height: 24, borderRadius: 99, flexShrink: 0,
                    bgcolor: aiEnabled ? 'var(--accent,#6366f1)' : 'rgba(255,255,255,0.1)',
                    border: `1.5px solid ${aiEnabled ? 'rgba(var(--accent-rgb,99,102,241),0.7)' : 'rgba(255,255,255,0.15)'}`,
                    transition: 'background-color 0.22s, border-color 0.22s',
                    '&:hover': { borderColor: aiEnabled ? 'rgba(var(--accent-rgb,99,102,241),1)' : 'rgba(255,255,255,0.3)' },
                  }}>
                    {/* sliding ball */}
                    <Box sx={{
                      position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                      left: aiEnabled ? 'calc(100% - 21px)' : '2px',
                      width: 19, height: 19, borderRadius: '50%',
                      bgcolor: '#fff',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
                    }}>
                      {aiToggling
                        ? <CircularProgress size={9} sx={{ color: aiEnabled ? 'var(--accent,#6366f1)' : 'rgba(0,0,0,0.3)' }} />
                        : <SmartToyIcon sx={{ fontSize: 11, color: aiEnabled ? 'var(--accent,#6366f1)' : 'rgba(0,0,0,0.3)' }} />}
                    </Box>
                    {/* typing pulse dot */}
                    {aiEnabled && aiTyping && (
                      <Box sx={{
                        position: 'absolute', top: -2, right: -2, width: 7, height: 7,
                        borderRadius: '50%', bgcolor: '#4ade80',
                        border: '1.5px solid var(--sidebar-bg,#0d1117)',
                        animation: 'ai-pulse 1s ease-in-out infinite',
                      }} />
                    )}
                  </Box>
                </Tooltip>
                <Tooltip title={t.settings.aiCfgBtn}>
                  <IconButton size="small" onClick={() => setAiConfigOpen(true)} sx={{
                    color: aiEnabled ? 'rgba(var(--accent-rgb,99,102,241),0.7)' : 'rgba(255,255,255,0.2)',
                    '&:hover': { color: 'var(--accent,#a5b4fc)', bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.1)' },
                    transition: 'all 0.15s',
                  }}>
                    <TuneIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t.common.refresh}>
                  <IconButton size="small" onClick={() => fetchThread(selected.company_id, true, false, activeNum !== 'all' ? activeNum : null)}
                    sx={{ color: 'rgba(255,255,255,0.3)', '&:hover': { color: 'white' } }}>
                    <RefreshIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>

              {/* Números — mismo diseño para 1 o varios */}
              {waNumbers.length > 0 && (
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'nowrap',
                  overflowX: 'auto', pb: 0.3,
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.12) transparent',
                  '&::-webkit-scrollbar': { height: 3 },
                  '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.15)', borderRadius: 2 },
                }}>
                  {waNumbers.map(num => {
                    const isActive  = activeNum === num
                    const stats     = numStats[num] || { sent: 0, received: 0 }
                    const replied   = stats.sent > 0 || stats.received > 0
                    const formatted = num.replace(/\D/g, '').slice(-10)
                      .replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')
                    return (
                      <Box key={num} onClick={() => setActiveNum(isActive ? 'all' : num)} sx={{
                        display: 'flex', alignItems: 'center', gap: 0.6, flexShrink: 0,
                        px: 1.2, py: 0.5, borderRadius: 99, cursor: 'pointer',
                        bgcolor: isActive ? 'rgba(var(--accent-rgb,99,102,241),0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${isActive ? 'rgba(var(--accent-rgb,99,102,241),0.4)' : 'rgba(255,255,255,0.1)'}`,
                        transition: 'all 0.15s',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)' },
                      }}>
                        <WhatsAppIcon sx={{
                          fontSize: 13, flexShrink: 0,
                          color: replied ? '#4ade80' : 'rgba(255,255,255,0.22)',
                          filter: replied ? 'drop-shadow(0 0 4px #4ade8066)' : 'none',
                        }} />
                        <Typography sx={{
                          fontSize: '0.72rem', fontFamily: 'monospace', letterSpacing: '0.03em',
                          fontWeight: isActive ? 700 : 400,
                          color: isActive ? 'var(--accent, #a5b4fc)' : 'rgba(255,255,255,0.6)',
                        }}>
                          {formatted}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Box>

            {waNumbers.length > 1 && activeNum && activeNum !== 'all' && (
              <Box sx={{ px: 2, py: 0.6, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {lang === 'en' ? 'Filtering · ' : 'Filtrando · '}{activeNum.replace(/\D/g,'').slice(-10).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')}
                </Typography>
              </Box>
            )}

            {/* Mensajes — área scrolleable */}
            <Box ref={messagesBoxRef} sx={{ flex: 1, overflowY: 'auto', py: 1.5, minHeight: 0,
              backgroundImage: WA_BG_PATTERN, backgroundSize: '100px 100px',
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
              '&::-webkit-scrollbar': { width: 4 },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
            }}>
              {threadLoad ? (
                <ThreadSkeleton />
              ) : waNumbers.length > 1 && (!activeNum || activeNum === 'all') ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', px: 3 }}>
                  <Box sx={{ textAlign: 'center', px: 4, py: 3, borderRadius: 3,
                    bgcolor: 'var(--card-bg)', backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(37,211,102,0.22)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                    <Box sx={{ width: 40, height: 40, borderRadius: '50%', mx: 'auto', mb: 1.5,
                      bgcolor: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <WhatsAppIcon sx={{ fontSize: 20, color: 'rgba(37,211,102,0.7)' }} />
                    </Box>
                    <Typography sx={{ color: 'var(--text)', fontSize: '0.92rem', fontWeight: 600 }}>
                      {t.convs.selectNumTab}
                    </Typography>
                  </Box>
                </Box>
              ) : visibleThread.length === 0 ? (
                <Box sx={{ textAlign: 'center', pt: 4 }}>
                  <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem' }}>{lang === 'en' ? 'No messages' : 'Sin mensajes'}</Typography>
                </Box>
              ) : (
                <Box key={selected?.company_id} sx={{
                  '@keyframes threadAppear': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
                  animation: 'threadAppear 0.18s ease',
                }}>
                  {(() => {
                    let lastDay = null
                    return visibleThread.map(m => {
                      const day = dayKey(m.created_at)
                      const showDivider = day && day !== lastDay && !isToday(m.created_at)
                      lastDay = day
                      return (
                        <Fragment key={m._id}>
                          {showDivider && <DateDivider label={formatDateLabel(m.created_at, lang, t)} />}
                          <MessageBubble msg={m} onReply={handleSendReply} />
                        </Fragment>
                      )
                    })
                  })()}
                  {aiTyping && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.8, px: 2 }}>
                      <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.8,
                        px: 1.5, py: 0.9,
                        borderRadius: '14px 14px 4px 14px',
                        bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.1)',
                        border: '1px solid rgba(var(--accent-rgb, 99,102,241), 0.2)',
                      }}>
                        <SmartToyIcon sx={{ fontSize: 12, color: 'var(--accent, #a5b4fc)', opacity: 0.7 }} />
                        <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem', fontStyle: 'italic' }}>
                          {lang === 'en' ? 'AI Chat is typing' : 'Chat IA está redactando'}
                        </Typography>
                        <TypingDots />
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </Box>

            {/* Emoji picker popover */}
            <Popover
              open={Boolean(emojiAnchor)} anchorEl={emojiAnchor}
              onClose={() => setEmojiAnchor(null)}
              anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
              transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2, p: 1.5, width: 300 } } }}
            >
              <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
                {EMOJI_GROUPS.map((g, i) => (
                  <Box key={g.label.es} onClick={() => setEmojiGroup(i)} sx={{
                    px: 1, py: 0.3, borderRadius: 1.5, cursor: 'pointer', fontSize: '0.65rem',
                    bgcolor: emojiGroup === i ? 'rgba(var(--accent-rgb,99,102,241),0.2)' : 'rgba(255,255,255,0.05)',
                    color: emojiGroup === i ? 'var(--accent,#a5b4fc)' : 'rgba(255,255,255,0.4)',
                    border: `1px solid ${emojiGroup === i ? 'rgba(var(--accent-rgb,99,102,241),0.35)' : 'transparent'}`,
                  }}>{g.label[lang] || g.label.es}</Box>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3 }}>
                {EMOJI_GROUPS[emojiGroup].emojis.map(e => (
                  <Box key={e} onClick={() => {
                    setReply(prev => prev + e)
                    replyRef.current?.querySelector('textarea')?.focus()
                  }} sx={{
                    fontSize: '1.35rem', cursor: 'pointer', p: 0.4, borderRadius: 1,
                    lineHeight: 1, transition: 'transform 0.1s',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', transform: 'scale(1.25)' },
                  }}>{e}</Box>
                ))}
              </Box>
            </Popover>

            {/* Input de respuesta */}
            <Box sx={{ px: 2, pt: 1.5, pb: 1, borderTop: '1px solid var(--border)', flexShrink: 0, bgcolor: 'var(--card-bg)' }}>
              <InstanceDisconnectedBanner status={instanceStatus} sx={{ mb: 1.2 }} />
              <SendErrorBanner error={sendError} onDismiss={() => setSendError('')} sx={{ mb: 1.2 }} />
              {/* File preview chip */}
              {attachedFile && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, px: 0.5 }}>
                  <Chip
                    size="small"
                    icon={attachedFile.type.startsWith('image/') ? <ImageIcon sx={{ fontSize: 14 }} /> : <InsertDriveFileIcon sx={{ fontSize: 14 }} />}
                    label={attachedFile.name}
                    onDelete={() => { setAttachedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    sx={{ bgcolor: 'rgba(99,102,241,0.15)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(99,102,241,0.3)',
                      fontSize: '0.72rem', maxWidth: 240,
                      '& .MuiChip-deleteIcon': { color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#ef4444' } } }}
                  />
                  {uploading && <CircularProgress size={12} sx={{ color: 'var(--accent, #a5b4fc)' }} />}
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                {/* Hidden file input */}
                <input ref={fileInputRef} type="file" hidden
                  accept="image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) setAttachedFile({ file: f, name: f.name, type: f.type })
                  }}
                />
                <Tooltip title={lang === 'en' ? 'Attach image or document' : 'Adjuntar imagen o documento'}>
                  <IconButton size="small" onClick={() => fileInputRef.current?.click()}
                    sx={{ color: attachedFile ? 'var(--accent, #a5b4fc)' : 'rgba(255,255,255,0.3)',
                      flexShrink: 0, mb: 0.5, '&:hover': { color: 'var(--accent, #a5b4fc)' } }}>
                    <AttachFileIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Emojis">
                  <IconButton size="small" onClick={e => setEmojiAnchor(e.currentTarget)}
                    sx={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0, mb: 0.5, '&:hover': { color: '#facc15' } }}>
                    <EmojiEmotionsIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <TextField ref={replyRef} fullWidth multiline maxRows={4} size="small"
                  placeholder={instanceStatus === 'disconnected' ? (lang === 'en' ? 'Instance disconnected — go to Settings' : 'Instancia desconectada — ve a Configuración') : t.convs.reply}
                  defaultValue=""
                  slotProps={{ htmlInput: { ref: el => { if (el) replyRef._textarea = el } } }}
                  onInput={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply() } }}
                  error={reply.length > MAX_WA_MSG}
                  sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem', bgcolor: 'rgba(255,255,255,0.04)',
                    '& fieldset': { borderColor: reply.length > MAX_WA_MSG ? '#ef4444' : instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)' } }, '& textarea': { color: 'white' } }} />
                <Tooltip title={
                  instanceStatus === 'disconnected' ? (lang === 'en' ? 'WhatsApp instance disconnected' : 'Instancia WhatsApp desconectada') :
                  dailyStats?.total_available <= 0 ? (lang === 'en' ? `Daily limit reached (${dailyStats.total_sent}/${dailyStats.total_cap}). Resets at midnight.` : `Límite diario alcanzado (${dailyStats.total_sent}/${dailyStats.total_cap}). Reinicia a medianoche.`) :
                  reply.length > MAX_WA_MSG ? (lang === 'en' ? `Too long (max ${MAX_WA_MSG})` : `Demasiado largo (máx. ${MAX_WA_MSG})`) :
                  waNumbers.length === 0 ? (lang === 'en' ? 'No WhatsApp numbers registered' : 'Sin números WhatsApp registrados') :
                  (waNumbers.length > 1 && (!activeNum || activeNum === 'all')) ? (lang === 'en' ? 'Select a number first' : 'Selecciona un número primero') :
                  selectedNums.length === 0 ? (lang === 'en' ? 'Select at least one number' : 'Selecciona al menos un número') : (lang === 'en' ? 'Send (Enter)' : 'Enviar (Enter)')
                }>
                  <span>
                    <IconButton onClick={() => handleSendReply()}
                      disabled={instanceStatus === 'disconnected' || (dailyStats?.total_available <= 0) || (!reply.trim() && !attachedFile) || sending || uploading || reply.length > MAX_WA_MSG || (waNumbers.length > 0 && selectedNums.length === 0) || (waNumbers.length > 1 && (!activeNum || activeNum === 'all'))}
                      sx={{ bgcolor: instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb, 99,102,241), 0.2)', border: `1px solid ${instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.25)' : 'rgba(var(--accent-rgb, 99,102,241), 0.3)'}`, borderRadius: 2, color: instanceStatus === 'disconnected' ? '#ef4444' : 'var(--accent, #a5b4fc)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.35)' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.15)' } }}>
                      {sending ? <CircularProgress size={18} sx={{ color: 'var(--accent, #a5b4fc)' }} /> : instanceStatus === 'disconnected' ? <WifiOffIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.4 }}>
                <InstanceStatusDot status={instanceStatus} />
                {dailyStats !== null && (() => {
                  const _committed  = dailyStats.total_sent + (dailyStats.scheduled_today || 0)
                  const _pending    = selectedNums.length
                  const _avail      = dailyStats.total_available
                  const _afterAvail = Math.max(0, _avail - _pending)
                  const _danger  = _afterAvail <= 0
                  const _warn    = !_danger && _afterAvail < 30
                  const _textCol = _danger ? '#f87171' : _warn ? '#fbbf24' : 'var(--text-muted)'
                  const _border  = _danger ? 'rgba(239,68,68,0.35)' : _warn ? 'rgba(251,191,36,0.3)' : 'var(--border)'
                  const _bg      = _danger ? 'rgba(239,68,68,0.08)' : _warn ? 'rgba(251,191,36,0.06)' : 'var(--item-hover)'
                  const _tip = _pending > 0
                    ? (lang === 'en'
                        ? `${dailyStats.total_sent} sent + ${dailyStats.scheduled_today || 0} scheduled + ${_pending} selected = ${_committed + _pending} / ${dailyStats.total_cap} • ${_afterAvail} available • Resets at 00:00 UTC`
                        : `${dailyStats.total_sent} enviados + ${dailyStats.scheduled_today || 0} programados + ${_pending} seleccionados = ${_committed + _pending} / ${dailyStats.total_cap} • Quedan ${_afterAvail} disponibles • Reset 00:00 UTC`)
                    : (lang === 'en'
                        ? `${dailyStats.total_sent} sent + ${dailyStats.scheduled_today || 0} scheduled today • ${_avail} available • Resets at 00:00 UTC`
                        : `${dailyStats.total_sent} enviados + ${dailyStats.scheduled_today || 0} programados hoy • ${_avail} disponibles • Reset 00:00 UTC`)
                  return (
                    <Tooltip title={_tip} placement="top">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px', px: 0.9, py: 0.3,
                        borderRadius: 1.5, border: `1px solid ${_border}`, bgcolor: _bg, cursor: 'default' }}>
                        <Box component="span" sx={{ fontSize: '0.6rem', color: _textCol, fontVariantNumeric: 'tabular-nums', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '2px' }}>
                          <span style={{ fontWeight: 600 }}>{_committed}</span>
                          {_pending > 0 && <>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.55rem', opacity: 0.6 }}>+</span>
                            <span style={{ color: '#fbbf24', fontWeight: 700 }}>{_pending}</span>
                          </>}
                          <span style={{ opacity: 0.3, margin: '0 2px' }}>/</span>
                          <span style={{ opacity: 0.55 }}>{dailyStats.total_cap}</span>
                        </Box>
                        <Box component="span" sx={{ fontSize: '0.52rem', color: 'var(--text-muted)', opacity: 0.6, lineHeight: 1, letterSpacing: '0.02em' }}>{lang === 'en' ? 'today' : 'hoy'}</Box>
                      </Box>
                    </Tooltip>
                  )
                })()}
                <Typography sx={{ fontSize: '0.65rem', color: reply.length > MAX_WA_MSG ? '#f87171' : reply.length > MAX_WA_MSG * 0.9 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>
                  {reply.length} / {MAX_WA_MSG}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>

    <ChatAIConfig
      open={aiConfigOpen}
      onClose={() => setAiConfigOpen(false)}
      companyId={selected?.company_id}
      companyName={selected?.company_name}
      onSaved={() => {
        setAiConfigOpen(false)
        if (!aiEnabled) handleAiToggle()
      }}
    />
    </>
  )
}
