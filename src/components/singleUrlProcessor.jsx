'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import Skeleton from '@mui/material/Skeleton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import ResultDisplay from './resultDisplay'
import { isValidUrl, urlValidationMsg, MAX_WA_MSG } from '@/lib/validators'

const SKEL = { bgcolor: 'rgba(255,255,255,0.06)', '&::after': { background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)' } }

function ResultSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Banner */}
      <Box sx={{ p: 2.5, borderRadius: 3, border: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(255,255,255,0.02)' }}>
        <Skeleton variant="text" width={220} height={36} sx={SKEL} />
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Skeleton variant="rounded" width={90} height={22} sx={{ ...SKEL, borderRadius: 10 }} />
          <Skeleton variant="rounded" width={120} height={22} sx={{ ...SKEL, borderRadius: 10 }} />
        </Box>
      </Box>
      {/* Métricas */}
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        {[1,2,3,4].map(i => <Skeleton key={i} variant="rounded" sx={{ ...SKEL, flex: 1, height: 80, borderRadius: 2 }} />)}
      </Box>
      {/* Cards */}
      {[140, 180, 120].map((h, i) => (
        <Box key={i} sx={{ p: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)', bgcolor: 'rgba(255,255,255,0.02)' }}>
          <Skeleton variant="text" width={140} height={22} sx={{ ...SKEL, mb: 1.5 }} />
          <Skeleton variant="rounded" height={h} sx={SKEL} />
        </Box>
      ))}
    </Box>
  )
}

// ── Plantillas de mensaje ────────────────────────────────────────────────────
export const TEMPLATES = [
  {
    id: 'general',
    label: 'Con nombre y ciudad',
    desc: 'Menciona el nombre del negocio y la ciudad',
    needs: ['nombre', 'ciudad'],
    text: 'Hola {{nombre}}, somos Detucel. Nos especializamos en soluciones digitales para negocios como el tuyo en {{ciudad}}. ¿Te gustaría conocer cómo podemos ayudarte? 😊',
  },
  {
    id: 'sin_ciudad',
    label: 'Solo con nombre',
    desc: 'Para cuando no se detectó la ciudad',
    needs: ['nombre'],
    text: 'Hola {{nombre}}, somos Detucel. Nos especializamos en soluciones digitales para negocios. ¿Te gustaría conocer cómo podemos ayudarte? 😊',
  },
  {
    id: 'industria',
    label: 'Con giro del negocio',
    desc: 'Menciona el tipo de negocio (restaurante, taller, etc.)',
    needs: ['nombre', 'industria'],
    text: 'Hola {{nombre}}, somos Detucel. Trabajamos con negocios del sector {{industria}} en México y nos gustaría presentarte nuestros servicios. ¿Tienes un momento? 🙌',
  },
]

const VARIABLES = [
  { key: '{{nombre}}',    field: 'nombre',    label: 'Nombre del negocio', color: '#4ade80', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'  },
  { key: '{{ciudad}}',    field: 'ciudad',    label: 'Ciudad',             color: '#60a5fa', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)' },
  { key: '{{industria}}', field: 'industria', label: 'Giro / industria',   color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)' },
  { key: '{{web}}',       field: 'web',       label: 'Sitio web',          color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)' },
]

function extractValues(data) {
  const scraped = data?.scraped || {}
  return {
    nombre:    scraped.name || scraped.metadata?.title || null,
    ciudad:    scraped._extra?.city || scraped.city || null,
    industria: scraped.industry || null,
    web:       data?.website || null,
  }
}

function renderWithValues(text, vals) {
  if (!text) return ''
  return text
    .replace(/\{\{nombre\}\}/g,    vals.nombre    ?? '')
    .replace(/\{\{ciudad\}\}/g,    vals.ciudad    ?? '')
    .replace(/\{\{industria\}\}/g, vals.industria ?? '')
    .replace(/\{\{web\}\}/g,       vals.web       ?? '')
}

export function MessageComposer({ result, onSend, sending }) {
  const inputRef = useRef(null)
  const vals = extractValues(result)
  const [charCount, setCharCount] = useState(0)

  // All WA numbers found by the scraper
  const allNumbers = result?.scraped?._contacts_raw?.all_whatsapp_numbers || []
  const primary    = result?.primary_whatsapp_number
  const numbers    = allNumbers.length > 0 ? allNumbers : (primary ? [primary] : [])
  const [selectedNums, setSelectedNums] = useState(numbers)
  const toggleNum = (n) => setSelectedNums(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])

  // Auto-select first available template
  const firstAvailable = TEMPLATES.find(t => t.needs.every(n => vals[n]))
  const [activeTemplate, setActiveTemplate] = useState(firstAvailable?.id || TEMPLATES[0].id)
  const [defaultText, setDefaultText] = useState(() => renderWithValues((firstAvailable || TEMPLATES[0]).text, vals))

  function applyTemplate(tpl) {
    setActiveTemplate(tpl.id)
    const newText = renderWithValues(tpl.text, vals)
    setDefaultText(newText)
    // Reset the uncontrolled textarea with the new template text via execCommand
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
      document.execCommand('insertText', false, newText)
    }
  }

  function insertValue(varKey) {
    const v = VARIABLES.find(v => v.key === varKey)
    const realValue = vals[v?.field] || ''
    if (!realValue) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    document.execCommand('insertText', false, realValue)
  }

  function getCurrentText() {
    return inputRef.current?.value ?? defaultText
  }

  return (
    <Box sx={{ mt: 3, p: 2.5, borderRadius: 2, border: '1px solid rgba(34,197,94,0.2)', bgcolor: 'rgba(34,197,94,0.04)' }}>
      {/* Header */}
      <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#4ade80', mb: 0.5 }}>
        Enviar mensaje de WhatsApp
      </Typography>

      {/* Selector de número */}
      {numbers.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
            {numbers.length > 1 ? 'Enviar a:' : 'Número:'}
          </Typography>
          {numbers.length > 1 && (
            <Chip
              label={selectedNums.length === numbers.length ? 'Todos ✓' : 'Todos'}
              size="small"
              onClick={() => setSelectedNums(selectedNums.length === numbers.length ? [] : [...numbers])}
              sx={{ fontSize: '0.68rem', height: 22, cursor: 'pointer',
                bgcolor: selectedNums.length === numbers.length ? 'rgba(var(--accent-rgb, 59,130,246), 0.2)' : 'rgba(255,255,255,0.04)',
                color:   selectedNums.length === numbers.length ? 'var(--accent, #60a5fa)' : 'rgba(255,255,255,0.35)',
                border:  `1px solid ${selectedNums.length === numbers.length ? 'rgba(var(--accent-rgb, 59,130,246), 0.4)' : 'rgba(255,255,255,0.1)'}`,
              }}
            />
          )}
          {numbers.map(n => (
            <Chip key={n} label={n} size="small"
              onClick={() => numbers.length > 1 && toggleNum(n)}
              sx={{ fontSize: '0.72rem', height: 24,
                cursor: numbers.length > 1 ? 'pointer' : 'default',
                bgcolor: selectedNums.includes(n) ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
                color:   selectedNums.includes(n) ? '#4ade80' : 'rgba(255,255,255,0.35)',
                border:  `1px solid ${selectedNums.includes(n) ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                textDecoration: selectedNums.includes(n) ? 'none' : 'line-through',
              }} />
          ))}
        </Box>
      )}

      {/* Plantillas */}
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Punto de partida
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 2 }}>
        {TEMPLATES.map(t => {
          const missingFields = t.needs.filter(n => !vals[n])
          const disabled = missingFields.length > 0
          const missingLabels = missingFields.map(f => VARIABLES.find(v => v.field === f)?.label).join(', ')
          return (
            <Tooltip key={t.id} title={disabled ? `Falta: ${missingLabels}` : t.desc} placement="top">
              <span>
                <Chip label={t.label} size="small"
                  onClick={() => !disabled && applyTemplate(t)}
                  sx={{ fontSize: '0.7rem', height: 26,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.35 : 1,
                    bgcolor: activeTemplate === t.id ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                    color:   activeTemplate === t.id ? '#4ade80' : 'rgba(255,255,255,0.45)',
                    border:  `1px solid ${activeTemplate === t.id ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    '&:hover': !disabled ? { bgcolor: 'rgba(34,197,94,0.1)' } : {},
                  }} />
              </span>
            </Tooltip>
          )
        })}
      </Box>

      {/* Editor */}
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Escribe o edita el mensaje
      </Typography>
      <TextField key={activeTemplate} fullWidth multiline rows={4} size="small"
        defaultValue={defaultText} inputRef={inputRef}
        onChange={e => setCharCount(e.target.value.length)}
        error={charCount > MAX_WA_MSG}
        sx={{ mb: 0.5, '& .MuiOutlinedInput-root': { fontSize: '0.85rem', bgcolor: 'var(--sidebar-bg, #0d1117)', lineHeight: 1.6,
          '& fieldset': charCount > MAX_WA_MSG ? { borderColor: '#ef4444 !important' } : {} } }} />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, pr: 0.5 }}>
        <Typography sx={{ fontSize: '0.68rem', color: charCount > MAX_WA_MSG ? '#f87171' : charCount > MAX_WA_MSG * 0.9 ? '#fbbf24' : 'rgba(255,255,255,0.25)' }}>
          {charCount} / {MAX_WA_MSG}
          {charCount > MAX_WA_MSG && ' — demasiado largo'}
        </Typography>
      </Box>

      {/* Variables insertables — deshabilitadas si no se encontró el dato */}
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Insertar datos del negocio
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 2 }}>
        {VARIABLES.map(v => {
          const available = !!vals[v.field]
          return (
            <Tooltip key={v.key} title={available ? `Insertar: ${vals[v.field]}` : 'No se encontró este dato'} placement="top">
              <span>
                <Chip label={v.label} size="small"
                  onClick={() => available && insertValue(v.key)}
                  sx={{ fontSize: '0.7rem', height: 24,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.3,
                    bgcolor: v.bg, color: v.color, border: `1px solid ${v.border}`,
                    '&:hover': available ? { filter: 'brightness(1.2)' } : {},
                  }} />
              </span>
            </Tooltip>
          )
        })}
      </Box>

      {/* Botón enviar */}
      {selectedNums.length === 0 && numbers.length > 1 && (
        <Typography sx={{ color: '#fbbf24', fontSize: '0.72rem', mb: 1 }}>
          Selecciona al menos un número para enviar.
        </Typography>
      )}
      <Box onClick={() => { const t = getCurrentText(); if (!sending && t.trim() && selectedNums.length > 0 && t.length <= MAX_WA_MSG) onSend(t, selectedNums) }}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
          py: 1.2, borderRadius: 1.5,
          cursor: (sending || selectedNums.length === 0 || charCount > MAX_WA_MSG) ? 'default' : 'pointer',
          bgcolor: (sending || selectedNums.length === 0 || charCount > MAX_WA_MSG) ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.18)',
          border: '1px solid rgba(34,197,94,0.35)',
          opacity: (sending || selectedNums.length === 0 || charCount > MAX_WA_MSG) ? 0.5 : 1,
          transition: 'all 0.15s',
          '&:hover': !(sending || selectedNums.length === 0) ? { bgcolor: 'rgba(34,197,94,0.28)', borderColor: 'rgba(34,197,94,0.6)' } : {},
        }}>
        {sending
          ? <CircularProgress size={16} sx={{ color: '#4ade80' }} />
          : <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80' }}>Confirmar y enviar mensaje</Typography>
        }
      </Box>
    </Box>
  )
}

const EXAMPLES = [
  'https://pizzeria-mario.com.mx/',
  'https://ferreteria-sanchez.mx/',
  'https://spa-belleza-queretaro.com/',
  'https://taller-mecanico-hdz.mx/',
  'https://restaurante-oaxaca.com.mx/',
  'https://constructora-garcia.mx/',
]

function useTypewriter(strings, active) {
  const [display, setDisplay] = useState('')
  const ref = useRef({ wordIdx: 0, charIdx: 0, deleting: false })

  useEffect(() => {
    if (!active) {
      setDisplay('')
      return
    }

    let timer

    function tick() {
      const s = ref.current
      const word = strings[s.wordIdx]

      if (!s.deleting) {
        if (s.charIdx < word.length) {
          const next = s.charIdx + 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 80)
        } else {
          // finished typing — pause 1.4 s then start deleting
          ref.current = { ...s, deleting: true }
          timer = setTimeout(tick, 1400)
        }
      } else {
        if (s.charIdx > 0) {
          const next = s.charIdx - 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 45)
        } else {
          // finished deleting — brief gap then next word
          ref.current = { wordIdx: (s.wordIdx + 1) % strings.length, charIdx: 0, deleting: false }
          timer = setTimeout(tick, 300)
        }
      }
    }

    timer = setTimeout(tick, 600)   // initial delay before first char
    return () => clearTimeout(timer)
  }, [active, strings])             // effect only re-runs if active or strings changes

  return display
}

function SearchBar({ url, setUrl, onSearch, loading, compact }) {
  const placeholder = useTypewriter(EXAMPLES, !url && !compact)
  const urlError = url.trim() && !isValidUrl(url.trim()) ? urlValidationMsg(url.trim()) : ''
  const canSearch = !loading && url.trim() && !urlError

  return (
    <Box sx={{ width: compact ? '100%' : { xs: '100%', sm: '620px' } }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'var(--sidebar-bg, #0d1117)',
        borderRadius: '50px',
        boxShadow: compact ? '0 2px 8px rgba(0,0,0,0.3)' : '0 4px 24px rgba(0,0,0,0.5)',
        border: `1.5px solid ${urlError ? 'rgba(239,68,68,0.5)' : 'var(--accent, #3b82f6)'}`,
        opacity: urlError ? 1 : undefined,
        px: 2.5, py: 0.5,
        transition: 'box-shadow 0.2s, border-color 0.2s',
        '&:not(:focus-within)': {
          borderColor: urlError ? 'rgba(239,68,68,0.5)' : 'rgba(var(--accent-rgb, 59,130,246), 0.35)',
        },
        '&:focus-within': {
          borderColor: urlError ? 'rgba(239,68,68,0.8)' : 'var(--accent, #3b82f6)',
          boxShadow: urlError
            ? '0 0 0 3px rgba(239,68,68,0.15)'
            : '0 0 0 3px var(--accent-glow, rgba(59,130,246,0.3))',
        },
        '&:hover': {
          borderColor: urlError ? 'rgba(239,68,68,0.7)' : 'rgba(var(--accent-rgb, 59,130,246), 0.6)',
        },
      }}>
        <TextField
          fullWidth variant="standard" value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && canSearch && onSearch()}
          placeholder={placeholder || 'https://empresa.com.mx/'}
          slotProps={{ input: { disableUnderline: true } }}
          sx={{
            '& input': {
              fontSize: compact ? '0.95rem' : '1.05rem', py: 0.8, color: '#f1f5f9',
              '&::placeholder': { color: 'rgba(255,255,255,0.3)', opacity: 1 },
            },
            '& .MuiInput-root::before': { display: 'none' },
            '& .MuiInput-root::after':  { display: 'none' },
          }}
        />
        <Tooltip title={urlError || (!url.trim() ? 'Ingresa una URL para continuar' : '')} disableHoverListener={canSearch}>
          <span>
            <IconButton onClick={onSearch} disabled={!canSearch} sx={{
              bgcolor: 'var(--accent, #3b82f6)', color: 'white', width: 42, height: 42, flexShrink: 0, mr: -1,
              '&:hover': { bgcolor: 'var(--accent, #2563eb)' },
              '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.2)', color: 'rgba(255,255,255,0.4)' },
            }}>
              {loading ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <SearchIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {urlError && (
        <Typography sx={{ color: '#f87171', fontSize: '0.72rem', mt: 0.6, pl: 2 }}>
          {urlError}
        </Typography>
      )}
    </Box>
  )
}

export default function SingleUrlProcessor() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [sendSuccess, setSendSuccess] = useState(false)

  const hasResult = result || error
  const hasWhatsapp = !!result?.primary_whatsapp_number

  // Step 1: scrape only (no send)
  async function handleScrape() {
    if (!url) return
    setError('')
    setResult(null)
    setSendSuccess(false)
    setLoading(true)
    try {
      const res = await fetch('/api/process-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, skip_send: true }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setError(`Error al analizar la URL: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Step 2: send message with composed text
  async function handleSend(messageText, toNumbers) {
    setSending(true)
    setSendSuccess(false)
    const nums = Array.isArray(toNumbers) ? toNumbers : [toNumbers]
    let successCount = 0
    let lastErr = null
    try {
      for (const toNumber of nums) {
        try {
          const res = await fetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: result.company_id,
              to_number: toNumber || result.primary_whatsapp_number,
              message: messageText,
              website: result.website,
            }),
          })
          if (!res.ok) throw new Error(`Error ${res.status}`)
          successCount++
        } catch (e) {
          lastErr = e
        }
      }
      if (successCount > 0) {
        setSendSuccess(true)
      } else {
        throw lastErr || new Error('No se pudo enviar')
      }
    } catch (e) {
      setError(`Error al enviar: ${e.message}`)
    } finally {
      setSending(false)
    }
  }

  /* ── ESTADO INICIAL: barra centrada ── */
  if (!hasResult && !loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, gap: 1 }}>
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h4" fontWeight={700} color="text.primary" gutterBottom>
            ¿Que empresa estas buscando hoy?
          </Typography>
        </Box>
        <SearchBar url={url} setUrl={setUrl} onSearch={handleScrape} loading={loading} compact={false} />
      </Box>
    )
  }

  /* ── CON RESULTADO: barra arriba + resultados + composer ── */
  return (
    <Box sx={{ overflowY: 'auto', height: '100%' }}>
      {/* Barra superior */}
      <Box sx={{ bgcolor: 'var(--sidebar-bg, #0d1117)', borderRadius: 2, p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, border: '1px solid rgba(255,255,255,0.07)' }}>
        <SearchBar url={url} setUrl={setUrl} onSearch={handleScrape} loading={loading} compact={true} />
        {loading && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>Analizando...</Typography>}
      </Box>

      {/* Resultados */}
      <Box sx={{ borderRadius: 3, p: 1 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <ResultSkeleton />}
        {result && !loading && <ResultDisplay result={result} />}
      </Box>

      {/* Compositor — solo si hay WhatsApp y ya terminó el scrape */}
      {result && !loading && (
        hasWhatsapp
          ? <>
              {sendSuccess && <Alert severity="success" sx={{ mt: 2 }}>Mensaje enviado correctamente</Alert>}
              {!sendSuccess && <MessageComposer result={result} onSend={handleSend} sending={sending} />}
            </>
          : <Box sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.07)', bgcolor: 'rgba(255,255,255,0.02)', textAlign: 'center' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>
                No se encontró número de WhatsApp — no es posible enviar mensaje
              </Typography>
            </Box>
      )}
    </Box>
  )
}
