'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { MAX_WA_MSG } from '@/lib/validators'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import { useUser } from '../context/UserContext'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
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
import Popover from '@mui/material/Popover'
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { InstanceDisconnectedBanner, SendErrorBanner, InstanceStatusDot } from './InstanceStatusBanner'

const EMOJI_GROUPS = [
  { label: 'Frecuentes', emojis: ['😀','😂','🥹','😊','😍','🤩','😎','🥳','😅','😭','😤','🤔','👍','👎','👋','🙌','🤝','❤️','🔥','✅','⭐','🎉','💯','🚀'] },
  { label: 'Negocio',    emojis: ['📞','📱','💬','📧','📝','💼','🏢','💰','📊','📈','🤝','⏰','📅','✔️','❌','⚠️','💡','🔔','📌','🔍'] },
  { label: 'Gestos',     emojis: ['👏','🙏','💪','🤞','✌️','🤙','👌','🫡','🫶','🫂','😁','😇','🥰','😘','🤗','😶','🙄','😴','🤯','🥴'] },
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

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now - d
  if (diff < 0) return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
  if (diff < 60000) return 'ahora'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: _TZ })
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: _TZ })
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

function ConversationItem({ conv, active, onClick }) {
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
            <Typography sx={{ color: conv.unread ? 'white' : 'rgba(255,255,255,0.8)', fontWeight: conv.unread ? 700 : 500, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
              {conv.company_name || conv.company_id}
            </Typography>
            {conv.ai_active && (
              <Tooltip title={conv.ai_typing ? 'Chat IA está redactando...' : 'Chat IA en conversación'}>
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
              const cat = conv.last_analysis.category
              const isAI = cat === 'bot' && conv.last_analysis?.is_ai
              const cfg = isAI
                ? { label: '🧠', color: '#c084fc' }
                : ({ humano: { label: '👤', color: '#4ade80' }, automatico: { label: '⚡', color: '#facc15' }, bot: { label: '🤖', color: '#a78bfa' } }[cat] || { label: '?', color: 'rgba(255,255,255,0.3)' })
              return (
                <Chip
                  label={cfg.label}
                  size="small"
                  sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'transparent', color: cfg.color, border: `1px solid ${cfg.color}44`, px: 0.3, ml: 0.5, flexShrink: 0 }}
                />
              )
            })()}
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem', flexShrink: 0 }}>
            {formatTime(conv.last_at)}
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
}

const MEDIA_LABELS = {
  '[sticker]':  { emoji: '🎭', label: 'Sticker' },
  '[audio]':    { emoji: '🎵', label: 'Audio' },
  '[imagen]':   { emoji: '🖼️', label: 'Imagen' },
  '[image]':    { emoji: '🖼️', label: 'Imagen' },
  '[video]':    { emoji: '🎬', label: 'Video' },
  '[location]': { emoji: '📍', label: 'Ubicación' },
  '[contact]':  { emoji: '👤', label: 'Contacto' },
  '[document]': { emoji: '📄', label: 'Documento' },
}

function InteractiveMessage({ interactive, isOut, onReply }) {
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
              Ver opciones ({options.length})
            </Typography>
            <Typography sx={{ color: accent, fontSize: '0.75rem' }}>›</Typography>
          </Box>
          <Popover open={open} anchorEl={anchor} onClose={() => setOpen(false)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            slotProps={{ paper: { sx: { bgcolor: 'var(--sidebar-bg,#0d1117)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, minWidth: 220, maxWidth: 300, overflow: 'hidden' } } }}>
            <Box sx={{ p: 1.5 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1 }}>Opciones</Typography>
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
          <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.8 }}>📊 Encuesta</Typography>
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

function MessageBubble({ msg, onReply }) {
  const isOut  = msg.direction === 'outbound'
  const isAI   = Boolean(msg.ai_generated)
  const raw    = msg.body || msg.message_body || ''
  const media  = MEDIA_LABELS[raw.trim().toLowerCase()]
  const body   = raw || '—'
  const interactive = msg.interactive
  return (
    <Box sx={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', mb: 0.8, px: 2 }}>
      <Box sx={{
        position: 'relative',
        maxWidth: '72%', px: 1.5, py: 1,
        borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        bgcolor: isOut
          ? isAI ? 'rgba(var(--accent-rgb, 99,102,241), 0.15)' : 'rgba(var(--accent-rgb, 99,102,241), 0.22)'
          : 'rgba(255,255,255,0.07)',
        border: `1px solid ${isOut
          ? isAI ? 'rgba(var(--accent-rgb, 99,102,241), 0.22)' : 'rgba(var(--accent-rgb, 99,102,241), 0.3)'
          : 'rgba(255,255,255,0.09)'}`,
      }}>
        {interactive ? (
          <InteractiveMessage interactive={interactive} isOut={isOut} onReply={onReply} />
        ) : media ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography sx={{ fontSize: '1.4rem', lineHeight: 1 }}>{media.emoji}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', fontStyle: 'italic' }}>
              {media.label}
            </Typography>
          </Box>
        ) : (
          <Typography sx={{ color: 'rgba(255,255,255,0.88)', fontSize: '0.83rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif' }}>
            {body}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, mt: 0.4 }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem' }}>
            {formatTime(msg.created_at)}
          </Typography>
          <StatusIcon status={msg.status} direction={msg.direction} />
        </Box>
        {/* AI badge — bottom-right corner of bubble */}
        {isAI && (
          <Tooltip title="Enviado por Chat IA">
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
}

export default function Conversations() {
  const [convs, setConvs]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [thread, setThread]         = useState([])
  const [threadLoad, setThreadLoad] = useState(false)
  const [search, setSearch]         = useState('')
  const [reply, setReply]           = useState('')
  const [sending, setSending]       = useState(false)
  const [waNumbers, setWaNumbers]       = useState([])
  const [selectedNums, setSelectedNums] = useState([])
  const [activeNum, setActiveNum]       = useState('all')
  const [syncing, setSyncing]           = useState(false)
  const [emojiAnchor, setEmojiAnchor]   = useState(null)
  const [emojiGroup, setEmojiGroup]     = useState(0)
  const syncingRef                      = useRef(false)
  const lastSyncedRef                   = useRef(null)  // evita re-sync al mismo company
  const currentCompanyRef               = useRef(null)  // evita race condition en fetchCompanyNumbers
  const { t } = useLang()
  const { user } = useUser()
  const [myConvsOnly, setMyConvsOnly] = useState(false)
  const threadLenRef = useRef(0)
  const messagesBoxRef = useRef(null)
  const replyRef  = useRef(null)
  const [sendError, setSendError] = useState('')
  const [aiTyping, setAiTyping]     = useState(false)
  const [aiActive, setAiActive]     = useState(false)
  const [aiEnabled, setAiEnabled]   = useState(false)
  const [aiToggling, setAiToggling] = useState(false)
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()

  const fetchConvs = useCallback(async () => {
    try {
      const res = await authFetch('/api/conversations')
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      setConvs(list)
      setSelected(prev => prev && list.find(c => c.company_id === prev.company_id) ? prev : null)
    } catch {
      setConvs([])
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
        setTimeout(() => {
          messagesBoxRef.current?.scrollTo({ top: messagesBoxRef.current.scrollHeight, behavior: 'smooth' })
        }, 50)
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

  useEffect(() => {
    const id = setInterval(() => {
      fetchConvs()
      if (selected) fetchThread(selected.company_id, false, true, activeNum !== 'all' ? activeNum : null)
    }, 20000)
    return () => clearInterval(id)
  }, [fetchConvs, fetchThread, selected, activeNum])

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
    setAiToggling(true)
    const next = !aiEnabled
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
      setActiveNum('all')
      fetchThread(selected.company_id, true)
      fetchCompanyNumbers(selected.company_id)
      handleSync(selected.company_id)
    }
  }, [selected, fetchThread, fetchCompanyNumbers, handleSync])

  async function handleSendReply(overrideText = null) {
    const text   = overrideText ?? reply
    const toSend = selectedNums.length > 0 ? selectedNums : waNumbers.slice(0, 1)
    if (!text.trim() || !selected || toSend.length === 0) return
    setSendError('')
    setSending(true)
    try {
      for (const num of toSend) {
        const res = await authFetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: selected.company_id,
            to_number: num,
            message: text.trim(),
            website: selected.website || '',
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Error ${res.status}`)
        }
      }
      setReply('')
      if (replyRef._textarea) replyRef._textarea.value = ''
      const cid = selected.company_id
      setTimeout(() => fetchThread(cid, true), 800)
      ;[3000, 6000, 10000].forEach(ms => setTimeout(() => fetchThread(cid, false, true), ms))
    } catch (err) {
      const msg = err.message || 'No se pudo enviar el mensaje'
      setSendError(msg)
      setTimeout(() => setSendError(''), 8000)
    }
    finally { setSending(false) }
  }

  const filtered = convs.filter(c => {
    if (myConvsOnly && c.sent_by_username !== user?.username) return false
    const q = search.toLowerCase()
    return (c.company_name || '').toLowerCase().includes(q) ||
           (c.industry     || '').toLowerCase().includes(q)
  })

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
          <TextField fullWidth size="small" placeholder={t.convs.search} value={search}
            onChange={e => setSearch(e.target.value)}
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
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
              <CircularProgress size={28} sx={{ color: 'var(--accent, #6366f1)' }} />
            </Box>
          ) : filtered.length === 0 ? (
            <Box sx={{ px: 2, pt: 4, textAlign: 'center' }}>
              <WhatsAppIcon sx={{ fontSize: 36, color: 'rgba(255,255,255,0.1)', mb: 1 }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
                {search ? t.common.noData : t.convs.noConvs}
              </Typography>
            </Box>
          ) : filtered.map(c => (
            <ConversationItem key={c.company_id} conv={c}
              active={selected?.company_id === c.company_id}
              onClick={() => setSelected(c)} />
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
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
            <Box sx={{ p: 3, borderRadius: '50%', bgcolor: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.1)' }}>
              <WhatsAppIcon sx={{ fontSize: 48, color: 'rgba(37,211,102,0.25)', display: 'block' }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '1rem', fontWeight: 600, mb: 0.5 }}>
                {t.convs.noneSelected}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem' }}>
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
                  Filtrando · {activeNum.replace(/\D/g,'').slice(-10).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2 $3')}
                </Typography>
              </Box>
            )}

            {/* Mensajes — área scrolleable */}
            <Box ref={messagesBoxRef} sx={{ flex: 1, overflowY: 'auto', py: 1.5, minHeight: 0,
              scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent',
              '&::-webkit-scrollbar': { width: 4 },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
            }}>
              {threadLoad ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 4 }}>
                  <CircularProgress size={24} sx={{ color: 'var(--accent, #6366f1)' }} />
                </Box>
              ) : waNumbers.length > 1 && (!activeNum || activeNum === 'all') ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, px: 3 }}>
                  <WhatsAppIcon sx={{ fontSize: 40, color: 'rgba(37,211,102,0.2)' }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', textAlign: 'center' }}>
                    {t.convs.selectNumTab}
                  </Typography>
                </Box>
              ) : visibleThread.length === 0 ? (
                <Box sx={{ textAlign: 'center', pt: 4 }}>
                  <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem' }}>Sin mensajes</Typography>
                </Box>
              ) : (
                <>
                  {visibleThread.map(m => (
                    <MessageBubble key={m._id} msg={m} onReply={opt => handleSendReply(opt)} />
                  ))}
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
                          Chat IA está redactando
                        </Typography>
                        <TypingDots />
                      </Box>
                    </Box>
                  )}
                </>
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
                  <Box key={g.label} onClick={() => setEmojiGroup(i)} sx={{
                    px: 1, py: 0.3, borderRadius: 1.5, cursor: 'pointer', fontSize: '0.65rem',
                    bgcolor: emojiGroup === i ? 'rgba(var(--accent-rgb,99,102,241),0.2)' : 'rgba(255,255,255,0.05)',
                    color: emojiGroup === i ? 'var(--accent,#a5b4fc)' : 'rgba(255,255,255,0.4)',
                    border: `1px solid ${emojiGroup === i ? 'rgba(var(--accent-rgb,99,102,241),0.35)' : 'transparent'}`,
                  }}>{g.label}</Box>
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
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <Tooltip title="Emojis">
                  <IconButton size="small" onClick={e => setEmojiAnchor(e.currentTarget)}
                    sx={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0, mb: 0.5, '&:hover': { color: '#facc15' } }}>
                    <EmojiEmotionsIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
                <TextField ref={replyRef} fullWidth multiline maxRows={4} size="small"
                  placeholder={instanceStatus === 'disconnected' ? 'Instancia desconectada — ve a Configuración' : t.convs.reply}
                  defaultValue=""
                  slotProps={{ htmlInput: { ref: el => { if (el) replyRef._textarea = el } } }}
                  onInput={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply() } }}
                  error={reply.length > MAX_WA_MSG}
                  sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem', bgcolor: 'rgba(255,255,255,0.04)',
                    '& fieldset': { borderColor: reply.length > MAX_WA_MSG ? '#ef4444' : instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)' } }, '& textarea': { color: 'white' } }} />
                <Tooltip title={
                  instanceStatus === 'disconnected' ? 'Instancia WhatsApp desconectada' :
                  reply.length > MAX_WA_MSG ? `Demasiado largo (máx. ${MAX_WA_MSG})` :
                  waNumbers.length === 0 ? 'Sin números WhatsApp registrados' :
                  (waNumbers.length > 1 && (!activeNum || activeNum === 'all')) ? 'Selecciona un número primero' :
                  selectedNums.length === 0 ? 'Selecciona al menos un número' : 'Enviar (Enter)'
                }>
                  <span>
                    <IconButton onClick={() => handleSendReply()}
                      disabled={instanceStatus === 'disconnected' || !reply.trim() || sending || reply.length > MAX_WA_MSG || (waNumbers.length > 0 && selectedNums.length === 0) || (waNumbers.length > 1 && (!activeNum || activeNum === 'all'))}
                      sx={{ bgcolor: instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb, 99,102,241), 0.2)', border: `1px solid ${instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.25)' : 'rgba(var(--accent-rgb, 99,102,241), 0.3)'}`, borderRadius: 2, color: instanceStatus === 'disconnected' ? '#ef4444' : 'var(--accent, #a5b4fc)', '&:hover': { bgcolor: 'rgba(var(--accent-rgb, 99,102,241), 0.35)' }, '&.Mui-disabled': { color: 'rgba(255,255,255,0.15)' } }}>
                      {sending ? <CircularProgress size={18} sx={{ color: 'var(--accent, #a5b4fc)' }} /> : instanceStatus === 'disconnected' ? <WifiOffIcon sx={{ fontSize: 18 }} /> : <SendIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.4 }}>
                <InstanceStatusDot status={instanceStatus} />
                <Typography sx={{ fontSize: '0.65rem', color: reply.length > MAX_WA_MSG ? '#f87171' : reply.length > MAX_WA_MSG * 0.9 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>
                  {reply.length} / {MAX_WA_MSG}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
