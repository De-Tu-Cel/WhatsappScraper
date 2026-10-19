'use client'
import { useState, useEffect, useRef } from 'react'
import { authFetch } from '@/lib/api'
import { phoneKey } from '@/lib/phoneBlacklist'
import { useSendQueue } from '../context/SendQueueContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import { InstanceDisconnectedBanner } from './InstanceStatusBanner'
import { getOverBy, capOverflowKind } from '../lib/dailyCap'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import { SingleScrapeStatus } from './ProspectLoading'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import ResultDisplay, { ResultSkeleton } from './resultDisplay'
import { isValidUrl, urlValidationMsg, MAX_WA_MSG } from '@/lib/validators'
import { useLang } from '../context/LangContext'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { getMinTemplatesRequired, pickMessageVariant } from '@/lib/messageVariants'

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

export function MessageComposer({ result, onSend, sending: externalSending, disabled, capStats, onRefreshCap }) {
  const submissionLock = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState(false)
  const sending = externalSending || submitting
  const { t, lang } = useLang()
  const vals = extractValues(result)

  // All WA numbers found by the scraper
  const allNumbers = result?.scraped?._contacts_raw?.all_whatsapp_numbers || []
  const primary    = result?.primary_whatsapp_number
  const numbers = [...new Map([...allNumbers, ...(primary ? [primary] : [])].filter(Boolean).map(number => [phoneKey(number), number])).values()]
  // Default seguro: solo el número principal, no todos los que se hayan encontrado —
  // mandar a los demás números de la misma empresa queda como decisión explícita
  // (los chips de abajo siguen permitiendo agregarlos a mano).
  const [selectedNums, setSelectedNums] = useState(() => primary ? numbers.filter(number => phoneKey(number) === phoneKey(primary)).slice(0, 1) : numbers.slice(0, 1))
  const toggleNum = (n) => setSelectedNums(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  const [extraVariants, setExtraVariants] = useState([])

  // Mismo sistema de Message Templates que el envío masivo, en vez de un editor
  // libre aparte solo para el caso de 1 número — evita tener dos formas
  // distintas de redactar un mensaje en la app. Con 1 solo número, el propio
  // TemplateLibraryPicker fuerza selección única (singleSelect); con 2+, pide
  // plantillas suficientes para poder rotar el texto (ver getMinTemplatesRequired).
  const isBulk = selectedNums.length > 1

  // La biblioteca guarda plantillas genéricas (con placeholders {{nombre}}/
  // {{industria}}/etc); se resuelven contra los datos reales de esta empresa
  // antes de tratarlas como candidatas de envío.
  const allVariants = extraVariants.map(v => renderWithValues(v, vals).trim()).filter(Boolean)
  const belowMinTemplates = isBulk && allVariants.length < getMinTemplatesRequired(selectedNums.length)
  // Números que ya fueron contactados previamente (por número, no solo por empresa)
  const contactedNumbers = new Set((result?.already_contacted?.contacted_numbers || []).map(phoneKey))
  // Solo los números NUEVOS (no contactados antes) consumen cupo de nuevos contactos
  const newCount = selectedNums.filter(n => !contactedNumbers.has(phoneKey(n))).length
  // El backend deduplica por número real, no por empresa — cada número marcado
  // aquí (aunque sean todos de la misma empresa) cuesta su propio slot de cupo.
  const capPending  = !capStats && selectedNums.length > 0
  const overBy      = getOverBy(capStats, selectedNums.length, newCount, { requireStats: true })
  const overKind    = capOverflowKind(capStats, selectedNums.length, newCount)
  const capBlocked  = capPending || overBy > 0
  const sendBlocked = sending || disabled || selectedNums.length === 0 || allVariants.length === 0 || belowMinTemplates || capBlocked
    || allVariants.some(v => v.length > MAX_WA_MSG)

  async function handleSendClick() {
    if (sendBlocked || submissionLock.current) return
    submissionLock.current = true
    setSubmitting(true)
    setSubmissionError(false)
    try {
    if (onRefreshCap) {
      const fresh = await onRefreshCap()
      if (getOverBy(fresh || capStats, selectedNums.length, newCount, { requireStats: true }) > 0) return
    } else if (!capStats) return
    let lastVariant = null
    const messages = selectedNums.map(() => {
      const v = pickMessageVariant(allVariants, lastVariant)
      lastVariant = v
      return v
    })
      if (await onSend(messages, selectedNums) === false) setSubmissionError(true)
    } catch {
      setSubmissionError(true)
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <Box data-single-composer sx={{ containerType: 'inline-size', containerName: 'single-composer', p: { xs: 2, md: 2.5 }, borderRadius: '16px', border: '1px solid var(--border)', bgcolor: 'var(--card-bg)', '& [data-template-cards]': { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', maxHeight: 'clamp(240px,34vh,360px)', '@container single-composer (min-width: 620px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))' } }, '& [data-template-card]': { minHeight: 78, borderRadius: '11px', p: 1.4 }, '& [data-template-card] > .MuiBox-root': { minWidth: 0 } }}>
      {/* Header */}
      {submissionError && <Alert severity="error" sx={{ mb: 1 }}>No se pudo confirmar la solicitud. Revisa la cola antes de volver a enviarla.</Alert>}
      <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text)', mb: .5 }}>
        {lang === 'en' ? 'Prepare message' : 'Preparar mensaje'}
      </Typography>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: '.78rem', lineHeight: 1.6, mb: 2 }}>{lang === 'en' ? 'Choose the numbers and the message you want to send.' : 'Elige los números y la plantilla que quieres enviar.'}</Typography>

      <Box sx={{ mb: 2, border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 1.5, py: 1, bgcolor: 'rgba(var(--accent-rgb),.04)' }}>
          <Typography sx={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--text)' }}>{lang === 'en' ? 'Recipients' : 'Destinatarios'}</Typography>
          <Typography role="status" sx={{ fontSize: '.75rem', color: 'var(--accent)' }}>{selectedNums.length} {lang === 'en' ? 'of' : 'de'} {numbers.length}</Typography>
        </Box>
        {numbers.length > 1 && <Button size="small" disabled={sending} onClick={() => setSelectedNums(selectedNums.length === numbers.length ? [] : [...numbers])} sx={{ ml: 1, mt: .5, textTransform: 'none', color: 'var(--accent)', fontSize: '.75rem' }}>{selectedNums.length === numbers.length ? (lang === 'en' ? 'Clear selection' : 'Limpiar selección') : (lang === 'en' ? 'Select all numbers' : 'Seleccionar todos los números')}</Button>}
        <Box sx={{ maxHeight: 180, overflowY: 'auto' }}>{numbers.map(number => <Box component="label" key={number} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: .7, cursor: sending ? 'default' : 'pointer', borderTop: '1px solid var(--border)', bgcolor: selectedNums.includes(number) ? 'rgba(var(--accent-rgb),.045)' : 'transparent' }}>
          <Checkbox size="small" checked={selectedNums.includes(number)} disabled={sending} onChange={() => toggleNum(number)} slotProps={{ input: { 'aria-label': `${lang === 'en' ? 'Send to' : 'Enviar a'} ${number}` } }} sx={{ p: .4, color: 'var(--text-muted)', '&.Mui-checked': { color: 'var(--accent)' } }} />
          <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums', fontSize: '.83rem', color: 'var(--text)' }}>{number}</Typography>
          {contactedNumbers.has(phoneKey(number)) && <Chip label={lang === 'en' ? 'Messaged' : 'Contactado'} size="small" sx={{ fontSize: '.65rem', height: 21, bgcolor: 'var(--item-hover)', color: 'var(--text-muted)' }} />}
        </Box>)}</Box>
      </Box>

      {/* Plantillas — mismo sistema para 1 o varios números; con 1 solo el propio
          picker fuerza selección única en vez de dejar acumular varias sin sentido. */}
      <Box sx={{ mb: 2, pt: .5 }}>
        <TemplateLibraryPicker campaignCards
          onChange={setExtraVariants}
          recipientCount={selectedNums.length}
          baseCount={0}
          singleSelect={selectedNums.length <= 1}
          hasName={!!vals.nombre}
          hasCity={!!vals.ciudad}
          hasIndustry={!!vals.industria}
          hasWeb={!!vals.web}
        />
      </Box>

      {/* Botón enviar */}
      {selectedNums.length === 0 && (
        <Typography sx={{ color: '#fbbf24', fontSize: '0.72rem', mb: 1 }}>
          {t.single.selectNum}
        </Typography>
      )}
      <Box data-single-send-footer sx={{ position: 'sticky', bottom: 0, bgcolor: 'var(--card-bg)', pt: 1.75, mt: 1, borderTop: '1px solid var(--border)', zIndex: 1 }}>
      <Typography sx={{ color: 'var(--text-muted)', fontSize: '.73rem', mb: 1 }}>{selectedNums.length ? (lang === 'en' ? 'Preview after sending this selection' : 'Previsión después de enviar esta selección') : (lang === 'en' ? 'Available today' : 'Disponible hoy')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 1.5, mb: 1.5 }}>
        {[{ key: 'messages', available: capStats?.total_available, cost: selectedNums.length, label: lang === 'en' ? 'Messages remaining' : 'Envíos restantes' }, { key: 'new', available: capStats?.new_contacts_capacity, cost: newCount, label: lang === 'en' ? 'New contacts remaining' : 'Contactos nuevos restantes' }].map(item => <Box key={item.key} data-quota-preview={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.25, borderRadius: '10px', bgcolor: 'var(--surface)', border: '1px solid var(--border)' }}><Typography data-quota-remaining sx={{ fontSize: '1.25rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: item.available != null && item.cost > item.available ? '#f59e0b' : 'var(--text)' }}>{item.available == null ? '—' : Math.max(0, item.available - item.cost)}</Typography><Box sx={{ minWidth: 0 }}><Typography sx={{ color: 'var(--text)', fontSize: '.73rem', lineHeight: 1.4 }}>{item.label}</Typography><Typography sx={{ color: 'var(--text-muted)', fontSize: '.67rem', lineHeight: 1.5, mt: .3 }}>{lang === 'en' ? 'Available now: ' : 'Disponibles ahora: '}{item.available ?? '—'}</Typography></Box></Box>)}
      </Box>
      {capBlocked && !sending && (
        <Typography sx={{ color: '#f59e0b', fontSize: '0.72rem', mb: 1, textAlign: 'right' }}>
          {capPending
            ? (lang === 'en' ? 'Loading today\'s quota…' : 'Cargando el cupo de hoy…')
            : overKind === 'new'
              ? (lang === 'en' ? 'This selection exceeds today’s new-contact capacity.' : 'Esta selección supera el cupo de contactos nuevos de hoy.')
              : (lang === 'en' ? 'This selection exceeds today’s message capacity.' : 'Esta selección supera el cupo de mensajes de hoy.')}
        </Typography>
      )}
      <Button variant="contained" fullWidth disabled={sendBlocked} onClick={handleSendClick}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
          py: 1.2, borderRadius: 1.5,
          textTransform: 'none', fontWeight: 700,
          bgcolor: 'var(--accent)', color: 'var(--accent-contrast)',
          transition: 'all 0.15s',
          '&:hover': { bgcolor: 'var(--accent)', filter: 'brightness(1.08)' },
          '&.Mui-disabled': { bgcolor: 'var(--item-hover)', color: 'var(--text-muted)' },
        }}>
        {sending
          ? <CircularProgress size={16} color="inherit" />
          : t.single.confirm
        }
      </Button>
      <Typography sx={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '.72rem', mt: 1, lineHeight: 1.5 }}>{selectedNums.length} {lang === 'en' ? (selectedNums.length === 1 ? 'number selected' : 'numbers selected') : (selectedNums.length === 1 ? 'número seleccionado' : 'números seleccionados')}</Typography>
      </Box>
    </Box>
  )
}

function SearchBar({ url, setUrl, onSearch, loading, compact, onCancel }) {
  const { t } = useLang()
  const urlError = url.trim() && !isValidUrl(url.trim()) ? urlValidationMsg(url.trim(), { badProtocol: t.common.urlBadProtocol, invalid: t.common.urlInvalid }) : ''
  const canSearch = !loading && url.trim() && !urlError

  return (
    <Box sx={{ width: '100%' }}>
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
          placeholder={t.single.urlPlaceholder}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: -1, flexShrink: 0 }}>
          {url && !loading && (
            <IconButton size="small" onClick={() => setUrl('')}
              sx={{ color: 'rgba(255,255,255,0.35)', width: 34, height: 34, '&:hover': { color: '#f1f5f9' } }}>
              <ClearIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
          <Tooltip title={urlError || (!url.trim() ? t.single.urlEmpty : '')} disableHoverListener={canSearch}>
            <span>
              <IconButton onClick={onSearch} disabled={!canSearch} sx={{
                bgcolor: 'var(--accent, #3b82f6)', color: 'white', width: 42, height: 42,
                '&:hover': { bgcolor: 'var(--accent, #2563eb)' },
                '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.2)', color: 'rgba(255,255,255,0.4)' },
              }}>
                {loading ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <SearchIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          {loading && onCancel && (
            <Tooltip title="Cancelar búsqueda">
              <IconButton onClick={onCancel} sx={{
                bgcolor: 'rgba(239,68,68,0.12)', color: 'rgba(248,113,113,0.8)', width: 42, height: 42,
                border: '1px solid rgba(239,68,68,0.2)',
                '&:hover': { bgcolor: 'rgba(239,68,68,0.25)', color: '#f87171' },
              }}>
                <HighlightOffIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
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
  const { t, lang } = useLang()
  const { addJob } = useSendQueue()
  const { stats: capStats, refresh: refreshCapStats } = useDailyCapStats()
  const [url, setUrl] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [sending,     setSending]     = useState(false)
  const [result,      setResult]      = useState(null)
  const [error,       setError]       = useState('')
  const [blockedData, setBlockedData] = useState(null)   // { url, matched }
  const [sendSuccess, setSendSuccess] = useState(false)
  const { status: instanceStatus, isDisconnected } = useInstanceStatus()

  const hasResult = result || error || blockedData
  const hasWhatsapp = !!result?.primary_whatsapp_number
  const abortRef = useRef(null)

  function handleCancel() {
    if (abortRef.current) abortRef.current.abort()
  }

  // Step 1: scrape only (no send)
  async function handleScrape() {
    if (!url) return
    setError('')
    setResult(null)
    setBlockedData(null)
    setSendSuccess(false)
    setLoading(true)
    abortRef.current = new AbortController()
    try {
      const res = await authFetch('/api/process-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, skip_send: true }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Error ${res.status}`)
      }
      const data = await res.json()
      if (data.blacklisted) {
        setBlockedData({ url, matched: data.matched })
      } else {
        setResult(data)
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(`Error al analizar la URL: ${e.message}`)
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  // Step 2: send message with composed text.
  // `messagesOrText` is either one string (sent as-is to every number) or an
  // array parallel to `toNumbers` — MessageComposer passes an array with a
  // different rotated variant per number once there's more than one recipient.
  async function handleSend(messagesOrText, toNumbers) {
    const nums = Array.isArray(toNumbers) ? toNumbers : [toNumbers]
    if (!nums.length || !result) return
    const accepted = await addJob({
      numbers:   nums,
      messages:  messagesOrText,
      companyId: result.company_id,
      website:   result.website,
    }, result.name || result.website || '')
    if (!accepted) return false
    setSendSuccess(true)
    refreshCapStats()
    setTimeout(() => { setSendSuccess(false); refreshCapStats() }, 2500)
    return true
  }

  /* ── ESTADO INICIAL: barra centrada ── */
  const composer = result && !loading && (
        hasWhatsapp
          ? <>
              <InstanceDisconnectedBanner status={instanceStatus} sx={{ mt: 2, mb: 1 }} />
              {sendSuccess && <Alert severity="success" sx={{ mt: 2 }}>Solicitud añadida a la cola de envío</Alert>}
              {!sendSuccess && <MessageComposer result={result} onSend={handleSend} sending={sending} disabled={isDisconnected} capStats={capStats} onRefreshCap={refreshCapStats} />}
            </>
          : <Box sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid var(--border)', bgcolor: 'var(--item-hover)', textAlign: 'center' }}>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {t.single.noWa}
              </Typography>
            </Box>
      )

  if (!hasResult && !loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, gap: 1, px: 2.5, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography fontWeight={800} sx={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', mb: 0.5, background: 'linear-gradient(135deg, var(--text,#f1f5f9) 20%, var(--accent,#60a5fa) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            {t.single.heading}
          </Typography>
        </Box>
        <SearchBar url={url} setUrl={setUrl} onSearch={handleScrape} loading={loading} compact={false} onCancel={handleCancel} />
      </Box>
    )
  }

  /* ── CON RESULTADO: barra arriba + resultados + composer ── */
  return (
    <Box data-single-url sx={{ overflowY: 'auto', height: '100%', minWidth: 0, px: { xs: 0, md: 1 }, pb: 2, '& > .MuiBox-root': { width: '100%', maxWidth: 1520, mx: 'auto', boxSizing: 'border-box' } }}>
      {/* Barra superior */}
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
        <SearchBar url={url} setUrl={setUrl} onSearch={handleScrape} loading={loading} compact={true} onCancel={handleCancel} />
      </Box>

      {/* Resultados */}
      <Box sx={{ minWidth: 0 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <><SingleScrapeStatus url={url} lang={lang} /><ResultSkeleton /></>}
        {blockedData && !loading && (
          <Box sx={{
            borderRadius: 3, overflow: 'hidden',
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'linear-gradient(160deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 40%, transparent 70%), var(--card-bg,#161d2e)',
          }}>
            {/* Franja roja superior */}
            <Box sx={{ height: 3, background: 'linear-gradient(90deg, #ef4444, #f87171, transparent)' }} />
            <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center' }}>
              {/* Icono */}
              <Box sx={{
                width: 56, height: 56, borderRadius: '50%',
                bgcolor: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem',
              }}>
                🚫
              </Box>
              {/* Título */}
              <Box>
                <Typography sx={{ color: '#f87171', fontWeight: 700, fontSize: '1rem', mb: 0.4 }}>
                  {t.single.blockedBy || 'Dominio bloqueado'}
                </Typography>
                <Typography sx={{
                  color: 'var(--text, #f1f5f9)', fontFamily: 'monospace', fontSize: '0.88rem',
                  bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 1.5, px: 1.5, py: 0.4, display: 'inline-block', mt: 0.5,
                }}>
                  {blockedData.url}
                </Typography>
              </Box>
              {/* Coincidencia */}
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                bgcolor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)',
                borderRadius: 2, px: 2, py: 1,
              }}>
                <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem' }}>
                  {t.search?.tagBlockedTip || 'En tu blacklist — coincide con:'}
                </Typography>
                <Typography sx={{ color: '#f87171', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.82rem' }}>
                  &quot;{blockedData.matched}&quot;
                </Typography>
              </Box>
              {/* Hint */}
              <Typography sx={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.72rem', maxWidth: 340, lineHeight: 1.6 }}>
                {t.single.blockedHint || 'Puedes gestionar los dominios bloqueados desde la sección Blacklist.'}
              </Typography>
            </Box>
          </Box>
        )}
        {result && !loading && <ResultDisplay result={result} aside={composer} />}
      </Box>

    </Box>
  )
}
