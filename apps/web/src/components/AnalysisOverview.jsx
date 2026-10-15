'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Collapse from '@mui/material/Collapse'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import { authFetch } from '@/lib/api'
import { getCategoryConfig } from '@/lib/categoryConfig'
import { analysisModelInfo } from '@/lib/analysisModel'
import { parseUtc, MX_TZ } from '@/lib/dates'
import { useLang } from '../context/LangContext'

async function fetchMessages(url) {
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`Error ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Invalid conversation')
  return data
}

const time = value => {
  const date = parseUtc(value)
  return date && Number.isFinite(date.getTime()) ? date.getTime() : null
}
const conclusions = {
  humano: ['Se identificó atención humana en la conversación.', 'Human service was identified in the conversation.'],
  automatico: ['Hubo una respuesta automática inicial y después atención humana.', 'An automated opening was followed by human service.'],
  hibrido_automatico: ['Hubo una respuesta automática inicial y después atención humana.', 'An automated opening was followed by human service.'],
  automatico_sin_respuesta: ['Solo se registró atención automática, sin intervención humana posterior.', 'Only automated service was recorded, with no subsequent human response.'],
  bot: ['La conversación muestra un menú o un flujo de atención automatizado.', 'The conversation shows a menu or an automated service flow.'],
  hibrido_bot: ['Se identificó un flujo de bot en la conversación.', 'A bot flow was identified in the conversation.'],
  sin_respuesta: ['No se registró una respuesta después del contacto.', 'No reply was recorded after contact.'],
}

export default function AnalysisOverview({ companyId, number, view, savedAt, companyScope, preview, loading, onShowDetails }) {
  const { t, lang } = useLang()
  const en = lang === 'en'
  const [showEvidence, setShowEvidence] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const { data: messages, error, isLoading, mutate } = useSWR(
    `/api/conversations/${companyId}${number ? `?number=${encodeURIComponent(number)}` : ''}`,
    fetchMessages, { revalidateOnMount: true, dedupingInterval: 0 },
  )
  const valid = (messages || []).filter(m => m.status !== 'failed')
  const sent = valid.filter(m => m.direction === 'outbound')
  const replies = valid.filter(m => m.direction === 'inbound')
  const failed = (messages || []).filter(m => m.direction === 'outbound' && m.status === 'failed')
  const hybrid = view?.hibrido
  const identity = analysisModelInfo(hybrid, en)
  const cfg = hybrid?.category && !hybrid.error ? getCategoryConfig(hybrid) : null
  const Icon = cfg?.icon
  const rangeTop = hybrid?.parecido?.items?.[0]
  const rangeDifferent = !!(rangeTop && cfg && getCategoryConfig(rangeTop).tKey !== cfg.tKey)
  const timestamps = ['timing', 'ia', 'hibrido'].map(m => time(view?.[m]?.ran_at)).filter(v => v != null)
  const analyzed = time(view?.input_last_at || hybrid?.input_last_at) ?? (timestamps.length ? Math.min(...timestamps) : time(savedAt))
  const latest = Math.max(0, ...valid.map(m => time(m.created_at) || 0))
  const stale = analyzed != null && latest > analyzed
  const incomplete = !view || ['timing', 'ia', 'hibrido'].some(m => !view[m] || view[m].error)
    || (replies.length > 0 && hybrid?.category !== 'sin_respuesta' && !hybrid?.parecido?.items?.length && !hybrid?.rango)
  const onlyFailed = !error && !isLoading && !sent.length && failed.length > 0 && !replies.length
  const lastSendTime = sent.at(-1)?.sent_at || sent.at(-1)?.created_at
  const fmt = value => {
    const date = parseUtc(value)
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString(en ? 'en-US' : 'es-MX', { timeZone: MX_TZ }) : '—'
  }
  const evidence = (hybrid?.trace || []).find(step => step.hilo)?.hilo?.filter(m => m.de === 'Negocio').slice(-3) || []
  const corrections = (hybrid?.trace || []).filter(step => /^Corrección/.test(step.paso || ''))
  const reason = corrections.at(-1)?.detalle || hybrid?.notes
  const conclusion = onlyFailed
    ? (en ? 'No successful send was recorded. This does not mean the business failed to reply.' : 'No se registró un envío exitoso. Esto no significa que el negocio no contestara.')
    : hybrid?.is_ai && hybrid.category === 'bot'
      ? (en ? 'The conversation shows signs of conversational AI service.' : 'La conversación muestra señales de atención por IA conversacional.')
      : conclusions[hybrid?.category]?.[en ? 1 : 0]
  const stats = [[en ? 'Sent messages' : 'Mensajes enviados', sent.length], [en ? 'Replies' : 'Respuestas', replies.length], [en ? 'Failed attempts' : 'Intentos fallidos', failed.length]]
  const subdued = { color: 'var(--text-muted)', fontSize: '.75rem', lineHeight: 1.5 }
  return <Box data-analysis-overview sx={{ mb: 2, borderRadius: 3, border: '1px solid var(--border)',
    background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.10), transparent 65%), var(--card-bg)', flexShrink: 0, overflow: 'hidden' }}>
    {loading || isLoading ? <Box sx={{ p: 2 }}><CircularProgress size={18} aria-label={en ? 'Loading analysis' : 'Cargando análisis'} /></Box> : <>
      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          <Typography sx={{ fontSize: '.68rem', fontWeight: 800, letterSpacing: '.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {preview ? (en ? 'Test result' : 'Resultado de prueba') : (en ? 'Official result' : 'Resultado oficial')} · Timing + {en ? 'AI' : 'IA'}
          </Typography>
          <Chip size="small" variant="outlined" label={stale ? (en ? 'New messages' : 'Mensajes nuevos') : incomplete ? (en ? 'Review pending' : 'Revisión pendiente') : (en ? 'Saved analysis' : 'Análisis guardado')}
            sx={{ borderColor: 'var(--border)', color: 'var(--text-muted)', fontSize: '.67rem' }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          {Icon && <Box sx={{ width: 42, height: 42, flexShrink: 0, borderRadius: 2.5, bgcolor: cfg.bg, display: 'grid', placeItems: 'center', color: cfg.color }}><Icon sx={{ fontSize: 23 }} /></Box>}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography component="h3" data-testid="official-verdict" sx={{ m: 0, fontWeight: 800, fontSize: { xs: '1.12rem', sm: '1.35rem' }, color: 'var(--text)', lineHeight: 1.25 }}>
              {onlyFailed ? (en ? 'Contact unsuccessful' : 'Contacto no realizado') : cfg ? t.analytics[cfg.tKey] : (en ? 'Analysis pending' : 'Análisis pendiente')}
            </Typography>
            {conclusion && <Typography sx={{ mt: .65, fontSize: '.85rem', lineHeight: 1.6, color: 'var(--text)' }}>{conclusion}</Typography>}
          </Box>
        </Box>
        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'minmax(0,1.2fr) minmax(0,1fr)' }, gap: 1 }}>
          <Box data-testid="analysis-model" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'var(--item-hover)', minWidth: 0 }}>
            <Typography sx={subdued}>{en ? 'Model recorded for this analysis' : 'Modelo registrado en este análisis'}</Typography>
            <Typography sx={{ mt: .35, fontFamily: 'monospace', fontSize: '.82rem', fontWeight: 700, overflowWrap: 'anywhere' }}>{identity.label}</Typography>
            <Typography sx={{ ...subdued, mt: .3 }}>{identity.provider}{identity.requested && identity.requested !== identity.label ? ` · ${en ? 'Requested' : 'Solicitado'}: ${identity.requested}` : ''}</Typography>
          </Box>
          <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'var(--item-hover)', minWidth: 0 }}>
            <Typography sx={subdued}>{en ? 'Last analysis' : 'Último análisis'}</Typography>
            <Typography sx={{ mt: .35, fontSize: '.82rem', fontWeight: 600 }}>{fmt(hybrid?.ran_at || savedAt)}</Typography>
            {lastSendTime && <Typography sx={{ ...subdued, mt: .3 }}>{en ? 'Last send' : 'Último envío'}: {fmt(lastSendTime)}</Typography>}
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 1, mt: 1 }}>
          {stats.map(([label, value]) => <Box key={label} sx={{ py: 1.2, px: .75, border: '1px solid var(--border)', borderRadius: 2, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.12rem', fontWeight: 800, color: 'var(--text)' }}>{value}</Typography>
            <Typography sx={{ ...subdued, fontSize: '.7rem' }}>{label}</Typography>
          </Box>)}
        </Box>
      </Box>
      <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 2 }}>
        {companyScope && <Alert severity="info" sx={{ mb: 1 }}>{en ? 'Historical company analysis without a breakdown by number.' : 'Análisis histórico de la empresa, sin desglose por número.'}</Alert>}
        {stale && <Alert severity="warning" sx={{ mb: 1 }}>{en ? 'New messages have not been analyzed yet.' : 'Hay mensajes nuevos sin analizar.'}</Alert>}
        {incomplete && <Alert severity="info" sx={{ mb: 1 }}>{en ? 'The analysis is pending or incomplete.' : 'El análisis está pendiente o incompleto.'}</Alert>}
        {(view?.agreement?.todos === false || rangeDifferent) && <Box data-testid="analysis-differences" role="note"
          aria-label={en ? 'Differences between evaluations' : 'Diferencias entre evaluaciones'}
          sx={{ mb: 1.5, p: { xs: 1.5, sm: 1.75 }, border: '1px solid var(--border)', borderRadius: 2.5,
            background: 'linear-gradient(110deg, rgba(var(--accent-rgb,59,130,246),.075), transparent)',
            display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 32, height: 32, flexShrink: 0,
            borderRadius: 2, bgcolor: 'rgba(var(--accent-rgb,59,130,246),.12)', color: 'var(--accent)' }}>
            <CompareArrowsIcon sx={{ fontSize: 19 }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--text)' }}>
              {en ? 'Different readings of this conversation' : 'Lecturas distintas de esta conversación'}
            </Typography>
            <Typography sx={{ ...subdued, mt: .35 }}>
              {en ? 'Each method evaluates different signals. Timing + AI determines the report result.'
                : 'Cada método evalúa señales diferentes. Timing + IA determina el resultado del reporte.'}
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5, rowGap: .5 }}>
              {cfg && <Box sx={{ display: 'flex', alignItems: 'center', gap: .6, flexWrap: 'wrap' }}>
                <Typography sx={{ ...subdued, fontSize: '.68rem' }}>{preview
                  ? (en ? 'Test result' : 'Resultado de prueba') : (en ? 'Official result' : 'Resultado oficial')}</Typography>
                <Chip size="small" label={t.analytics[cfg.tKey]} sx={{ height: 23, fontSize: '.67rem', fontWeight: 700,
                  color: cfg.color, bgcolor: cfg.bg, border: `1px solid ${cfg.border || 'var(--border)'}` }} />
              </Box>}
              {onShowDetails && <Button size="small" onClick={onShowDetails}
                sx={{ p: 0, minWidth: 0, textTransform: 'none', color: 'var(--accent)', fontSize: '.73rem' }}>
                {en ? 'Compare evaluations' : 'Comparar evaluaciones'}
              </Button>}
            </Box>
          </Box>
        </Box>}
        {error && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => mutate()}>{en ? 'Retry' : 'Reintentar'}</Button>}>
          {en ? 'Could not load conversation details.' : 'No se pudo cargar el detalle de la conversación.'}</Alert>}
        {reason && !onlyFailed && <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ ...subdued, fontWeight: 700, mb: .5 }}>{en ? 'Basis for the verdict' : 'Fundamento del veredicto'}</Typography>
          <Typography sx={{ fontSize: '.82rem', lineHeight: 1.65, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{reason}</Typography>
        </Box>}
        {!replies.length && !error && <Typography sx={{ ...subdued, mt: 1 }}>{en ? 'Service quality cannot be evaluated without a reply. Failed sends do not count as contact.' : 'Sin una respuesta no se puede evaluar la calidad de atención. Los envíos fallidos no cuentan como contacto.'}</Typography>}
        <Box sx={{ display: 'flex', gap: .75, flexWrap: 'wrap', mt: 1 }}>
          {evidence.length > 0 && <Button size="small" onClick={() => setShowEvidence(v => !v)} aria-expanded={showEvidence} sx={{ textTransform: 'none', color: 'var(--accent)' }}>
            {showEvidence ? (en ? 'Hide evidence' : 'Ocultar evidencia') : (en ? `View evidence (${evidence.length})` : `Ver evidencia (${evidence.length})`)}</Button>}
          {corrections.length > 0 && hybrid?.notes && hybrid.notes !== reason && <Button size="small" onClick={() => setShowOriginal(v => !v)} aria-expanded={showOriginal} sx={{ textTransform: 'none', color: 'var(--accent)' }}>
            {showOriginal ? (en ? 'Hide original diagnosis' : 'Ocultar diagnóstico original') : (en ? 'View original AI diagnosis' : 'Ver diagnóstico original de IA')}</Button>}
        </Box>
        <Collapse in={showEvidence}>
          {evidence.map((m, i) => <Box key={i} sx={{ mt: 1, p: 1.2, borderRadius: 2, border: '1px solid var(--border)', bgcolor: 'var(--item-hover)' }}>
            <Typography sx={subdued}>{m.t || (en ? 'Business message' : 'Mensaje del negocio')}</Typography>
            <Typography sx={{ fontSize: '.8rem', lineHeight: 1.6, mt: .35, overflowWrap: 'anywhere' }}>“{m.texto}”</Typography>
          </Box>)}
        </Collapse>
        <Collapse in={showOriginal}>
          <Alert severity="info" sx={{ mt: 1 }}>{en ? 'Original model diagnosis before fixed-rule corrections. It may differ from the official verdict.' : 'Diagnóstico original del modelo, anterior a las correcciones por reglas. Puede diferir del veredicto oficial.'}</Alert>
          <Typography sx={{ mt: 1, fontSize: '.8rem', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{hybrid?.notes}</Typography>
        </Collapse>
      </Box>
    </>}
  </Box>
}
