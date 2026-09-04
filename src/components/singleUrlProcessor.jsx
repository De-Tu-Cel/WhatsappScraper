'use client'
import { useState, useEffect, useRef } from 'react'
import { authFetch } from '@/lib/api'
import { useSendQueue } from '../context/SendQueueContext'
import { useInstanceStatus } from '../hooks/useInstanceStatus'
import { useDailyCapStats } from '../hooks/useDailyCapStats'
import { InstanceDisconnectedBanner } from './InstanceStatusBanner'
import DailyCapBadge, { getOverBy } from './DailyCapBadge'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import Skeleton from '@mui/material/Skeleton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import ResultDisplay from './resultDisplay'
import { isValidUrl, urlValidationMsg, MAX_WA_MSG } from '@/lib/validators'
import { useLang } from '../context/LangContext'
import { TemplateLibraryPicker } from './messageTemplateLibrary'
import { MIN_TEMPLATES_FOR_BULK, pickMessageVariant } from '@/lib/messageVariants'

const SKEL = { bgcolor: 'var(--skeleton-base,rgba(255,255,255,0.06))', '[data-theme-mode="light"] &': { bgcolor: 'rgba(0,0,0,0.08)' }, '&::after': { background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)', '[data-theme-mode="light"] &': { background: 'linear-gradient(90deg,transparent,rgba(0,0,0,0.04),transparent)' } } }

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
export function getTemplates(t) {
  return [
    {
      id: 'general',
      label: t.single.tplWith,
      desc: t.single.tplWithDesc,
      needs: ['nombre', 'ciudad'],
      text: t.single.tplWithText,
    },
    {
      id: 'sin_ciudad',
      label: t.single.tplName,
      desc: t.single.tplNameDesc,
      needs: ['nombre'],
      text: t.single.tplNameText,
    },
    {
      id: 'industria',
      label: t.single.tplIndustry,
      desc: t.single.tplIndustryDesc,
      needs: ['nombre', 'industria'],
      text: t.single.tplIndustryText,
    },
  ]
}

// Static export kept for backwards-compatibility (uses Spanish strings)
export const TEMPLATES = [
  {
    id: 'industria_ciudad',
    label: 'Industria + ciudad',
    desc: 'Menciona el giro del negocio y la ciudad — el más personalizado',
    needs: ['nombre', 'industria', 'ciudad'],
    text: 'Hola {{nombre}}, encontré tu negocio de {{industria}} en {{ciudad}} y me gustaría presentarte algo que puede ayudarte. ¿Tienes un momento? 😊',
  },
  {
    id: 'industria',
    label: 'Con giro del negocio',
    desc: 'Menciona el tipo de negocio (salon, taller, restaurante…)',
    needs: ['nombre', 'industria'],
    text: 'Hola {{nombre}}, vi que tienes un negocio de {{industria}} y tengo algo que podría interesarte. ¿Tienes disponibilidad para platicar? 🙌',
  },
  {
    id: 'general',
    label: 'Solo con nombre',
    desc: 'Para cuando no se detectó industria ni ciudad',
    needs: ['nombre'],
    text: 'Hola {{nombre}}, encontré tu negocio en línea y me gustaría presentarte una propuesta. ¿Tienes un momento? 😊',
  },
]

function getVariables(t) {
  return [
    { key: '{{nombre}}',    field: 'nombre',    label: t.single.varNombre,    color: '#4ade80', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.2)'  },
    { key: '{{ciudad}}',    field: 'ciudad',    label: t.single.varCiudad,    color: '#60a5fa', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)' },
    { key: '{{industria}}', field: 'industria', label: t.single.varIndustria, color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)' },
    { key: '{{web}}',       field: 'web',       label: t.single.varWeb,       color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)' },
  ]
}

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

export function MessageComposer({ result, onSend, sending, disabled, capStats }) {
  const { t, lang } = useLang()
  const inputRef = useRef(null)
  const vals = extractValues(result)
  const [charCount, setCharCount] = useState(0)

  const TEMPLATES_I18N = getTemplates(t)
  const VARIABLES_I18N = getVariables(t)

  // All WA numbers found by the scraper
  const allNumbers = result?.scraped?._contacts_raw?.all_whatsapp_numbers || []
  const primary    = result?.primary_whatsapp_number
  const numbers    = allNumbers.length > 0 ? allNumbers : (primary ? [primary] : [])
  // Default seguro: solo el número principal, no todos los que se hayan encontrado —
  // mandar a los demás números de la misma empresa queda como decisión explícita
  // (los chips de abajo siguen permitiendo agregarlos a mano).
  const [selectedNums, setSelectedNums] = useState(() => (primary ? [primary] : numbers.slice(0, 1)))
  const toggleNum = (n) => setSelectedNums(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  const [extraVariants, setExtraVariants] = useState([])

  // Auto-select first available template
  const firstAvailable = TEMPLATES_I18N.find(tpl => tpl.needs.every(n => vals[n]))
  const [activeTemplate, setActiveTemplate] = useState(firstAvailable?.id || TEMPLATES_I18N[0].id)
  const [defaultText, setDefaultText] = useState(() => renderWithValues((firstAvailable || TEMPLATES_I18N[0]).text, vals))

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
    const v = VARIABLES_I18N.find(v => v.key === varKey)
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

  // Sending to 2+ numbers at once is exactly the case that needs varied text
  // (see MIN_TEMPLATES_FOR_BULK) — editing a single message stops making
  // sense there, so the free-edit template flow only applies to a single
  // recipient; picking 2+ numbers switches to picking 3+ saved templates.
  const isBulk = selectedNums.length > 1

  // The library holds generic templates (with {{nombre}}/{{industria}}/etc
  // placeholders); resolve them against this company's real scraped values
  // before treating them as send candidates, same as the starting-point chips do.
  const allVariants = isBulk
    ? extraVariants.map(v => renderWithValues(v, vals).trim()).filter(Boolean)
    : [getCurrentText().trim()].filter(Boolean)
  const belowMinTemplates = isBulk && allVariants.length < MIN_TEMPLATES_FOR_BULK
  const overLength = !isBulk && charCount > MAX_WA_MSG
  // Números que ya fueron contactados previamente (por número, no solo por empresa)
  const contactedNumbers = new Set(result?.already_contacted?.contacted_numbers || [])
  // Solo los números NUEVOS (no contactados antes) consumen cupo de nuevos contactos
  const newCount = selectedNums.filter(n => !contactedNumbers.has(n)).length
  // El backend deduplica por número real, no por empresa — cada número marcado
  // aquí (aunque sean todos de la misma empresa) cuesta su propio slot de cupo.
  const overBy      = getOverBy(capStats, selectedNums.length, newCount)
  const capBlocked  = overBy > 0
  const sendBlocked = sending || disabled || selectedNums.length === 0 || overLength || belowMinTemplates || capBlocked
    || (isBulk && allVariants.some(v => v.length > MAX_WA_MSG))

  function handleSendClick() {
    if (sendBlocked) return
    let lastVariant = null
    const messages = selectedNums.map(() => {
      const v = pickMessageVariant(allVariants, lastVariant)
      lastVariant = v
      return v
    })
    onSend(messages, selectedNums)
  }

  return (
    <Box sx={{ mt: 3, p: 2.5, borderRadius: 2, border: '1px solid rgba(34,197,94,0.2)', bgcolor: 'rgba(34,197,94,0.04)' }}>
      {/* Header */}
      <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#4ade80', mb: 0.5 }}>
        {t.single.msgTitle}
      </Typography>

      {/* Selector de número */}
      {numbers.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
            {numbers.length > 1 ? t.single.sendTo : t.single.number}
          </Typography>
          {numbers.length > 1 && (
            <Chip
              label={selectedNums.length === numbers.length ? t.single.allSelected : t.single.allUnselected}
              size="small"
              onClick={() => setSelectedNums(selectedNums.length === numbers.length ? [] : [...numbers])}
              sx={{ fontSize: '0.68rem', height: 22, cursor: 'pointer',
                bgcolor: selectedNums.length === numbers.length ? 'rgba(var(--accent-rgb, 59,130,246), 0.2)' : 'rgba(255,255,255,0.04)',
                color:   selectedNums.length === numbers.length ? 'var(--accent, #60a5fa)' : 'rgba(255,255,255,0.35)',
                border:  `1px solid ${selectedNums.length === numbers.length ? 'rgba(var(--accent-rgb, 59,130,246), 0.4)' : 'rgba(255,255,255,0.1)'}`,
              }}
            />
          )}
          {numbers.map(n => {
            const isContacted = contactedNumbers.has(n)
            const isSelected  = selectedNums.includes(n)
            return (
              <Tooltip key={n} title={isContacted ? (lang === 'en' ? 'Previously contacted' : 'Ya contactado') : ''} placement="top" arrow>
                <Chip label={n} size="small"
                  onClick={() => numbers.length > 1 && toggleNum(n)}
                  sx={{ fontSize: '0.72rem', height: 24,
                    cursor: numbers.length > 1 ? 'pointer' : 'default',
                    bgcolor: isSelected
                      ? (isContacted ? 'rgba(251,191,36,0.18)' : 'rgba(34,197,94,0.2)')
                      : (isContacted ? 'rgba(251,191,36,0.05)' : 'rgba(255,255,255,0.05)'),
                    color: isSelected
                      ? (isContacted ? '#fbbf24' : '#4ade80')
                      : (isContacted ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.35)'),
                    border: `1px solid ${isSelected
                      ? (isContacted ? 'rgba(251,191,36,0.4)' : 'rgba(34,197,94,0.4)')
                      : (isContacted ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.08)')}`,
                    textDecoration: isSelected ? 'none' : 'line-through',
                  }} />
              </Tooltip>
            )
          })}
        </Box>
      )}

      {/* Plantillas — solo tiene sentido editar UN mensaje cuando se manda a un solo número */}
      {!isBulk && <>
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t.single.startingPoint}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mb: 2 }}>
        {TEMPLATES_I18N.map(tpl => {
          const missingFields = tpl.needs.filter(n => !vals[n])
          const disabled = missingFields.length > 0
          const missingLabels = missingFields.map(f => VARIABLES_I18N.find(v => v.field === f)?.label).join(', ')
          return (
            <Tooltip key={tpl.id} title={disabled ? `${t.single.missing}${missingLabels}` : tpl.desc} placement="top">
              <span>
                <Chip label={tpl.label} size="small"
                  onClick={() => !disabled && applyTemplate(tpl)}
                  sx={{ fontSize: '0.7rem', height: 26,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.35 : 1,
                    bgcolor: activeTemplate === tpl.id ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                    color:   activeTemplate === tpl.id ? '#4ade80' : 'rgba(255,255,255,0.45)',
                    border:  `1px solid ${activeTemplate === tpl.id ? 'rgba(34,197,94,0.35)' : 'rgba(255,255,255,0.08)'}`,
                    '&:hover': !disabled ? { bgcolor: 'rgba(34,197,94,0.22)', border: '1px solid rgba(34,197,94,0.5)' } : {},
                    '[data-theme-mode="light"] &': { bgcolor: activeTemplate === tpl.id ? 'rgba(34,197,94,0.2)' : 'rgba(0,0,0,0.05)', color: activeTemplate === tpl.id ? '#16a34a' : 'rgba(0,0,0,0.5)', border: `1px solid ${activeTemplate === tpl.id ? 'rgba(34,197,94,0.5)' : 'rgba(0,0,0,0.12)'}` },
                    '[data-theme-mode="light"] &:hover': !disabled ? { bgcolor: 'rgba(34,197,94,0.45)', color: '#15803d', border: '1px solid rgba(34,197,94,0.7)' } : {},
                  }} />
              </span>
            </Tooltip>
          )
        })}
      </Box>

      {/* Editor */}
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t.single.editMsg}
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
          {charCount > MAX_WA_MSG && ` ${t.single.tooLongSuffix}`}
        </Typography>
      </Box>

      {/* Variables insertables —deshabilitadas si no se encontró el dato */}
      <Typography sx={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', mb: 0.8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t.single.insertData}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mb: 2 }}>
        {VARIABLES_I18N.map(v => {
          const available = !!vals[v.field]
          return (
            <Tooltip key={v.key} title={available ? `${t.single.insert}${vals[v.field]}` : t.single.notFound} placement="top">
              <span>
                <Chip label={v.label} size="small"
                  onClick={() => available && insertValue(v.key)}
                  sx={{ fontSize: '0.7rem', height: 24,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.3,
                    bgcolor: v.bg, color: v.color, border: `1px solid ${v.border}`,
                    '&:hover': available ? { filter: 'brightness(1.15) saturate(1.3)' } : {},
                    '[data-theme-mode="light"] &': { bgcolor: v.bg.replace(/[\d.]+\)$/, m => String(Math.min(1, parseFloat(m)*4) + ')')) },
                    '[data-theme-mode="light"] &:hover': available ? { bgcolor: v.bg.replace(/[\d.]+\)$/, m => String(Math.min(1, parseFloat(m)*8) + ')')), filter: 'saturate(1.5)' } : {},
                  }} />
              </span>
            </Tooltip>
          )
        })}
      </Box>
      </>}

      {/* Plantillas — con 2+ números se manda texto rotado entre 3+ plantillas en vez de editar uno solo */}
      {isBulk && (
        <Box sx={{ mb: 2, p: 1.2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'rgba(255,255,255,0.02)' }}>
          <TemplateLibraryPicker onChange={setExtraVariants} recipientCount={selectedNums.length} baseCount={0} />
        </Box>
      )}

      {/* Botón enviar */}
      {selectedNums.length === 0 && numbers.length > 1 && (
        <Typography sx={{ color: '#fbbf24', fontSize: '0.72rem', mb: 1 }}>
          {t.single.selectNum}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.6 }}>
        <DailyCapBadge stats={capStats} selectionCount={selectedNums.length} newSelectionCount={newCount} />
      </Box>
      {capBlocked && !sending && (
        <Typography sx={{ color: '#f59e0b', fontSize: '0.72rem', mb: 1, textAlign: 'right' }}>
          Cupo diario agotado — inténtalo más tarde o desde otra instancia
        </Typography>
      )}
      <Box onClick={handleSendClick}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
          py: 1.2, borderRadius: 1.5,
          cursor: sendBlocked ? 'default' : 'pointer',
          bgcolor: sendBlocked ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.18)',
          border: '1px solid rgba(34,197,94,0.35)',
          opacity: sendBlocked ? 0.5 : 1,
          transition: 'all 0.15s',
          '&:hover': !sendBlocked ? { bgcolor: 'rgba(34,197,94,0.28)', borderColor: 'rgba(34,197,94,0.6)' } : {},
        }}>
        {sending
          ? <CircularProgress size={16} sx={{ color: '#4ade80' }} />
          : <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: '#4ade80' }}>{t.single.confirm}</Typography>
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
          // finished typing —pause 1.4 s then start deleting
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
          // finished deleting —brief gap then next word
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

function SearchBar({ url, setUrl, onSearch, loading, compact, onCancel }) {
  const { t } = useLang()
  const placeholder = useTypewriter(EXAMPLES, !url && !compact)
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
          placeholder={placeholder || t.single.urlPlaceholder}
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
  const { t } = useLang()
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
  function handleSend(messagesOrText, toNumbers) {
    const nums = Array.isArray(toNumbers) ? toNumbers : [toNumbers]
    if (!nums.length || !result) return
    addJob({
      numbers:   nums,
      messages:  messagesOrText,
      companyId: result.company_id,
      website:   result.website,
    }, result.name || result.website || '')
    setSendSuccess(true)
    refreshCapStats()
    setTimeout(() => { setSendSuccess(false); refreshCapStats() }, 2500)
  }

  /* ── ESTADO INICIAL: barra centrada ── */
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
    <Box sx={{ overflowY: 'auto', height: '100%' }}>
      {/* Barra superior */}
      <Box sx={{ bgcolor: 'var(--sidebar-bg, #0d1117)', borderRadius: 2, p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, border: '1px solid rgba(255,255,255,0.07)' }}>
        <SearchBar url={url} setUrl={setUrl} onSearch={handleScrape} loading={loading} compact={true} onCancel={handleCancel} />
      </Box>

      {/* Resultados */}
      <Box sx={{ borderRadius: 3, p: 1 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <ResultSkeleton />}
        {blockedData && !loading && (
          <Box sx={{
            borderRadius: 3, overflow: 'hidden',
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'linear-gradient(160deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 40%, var(--card-bg,#161d2e) 70%)',
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
        {result && !loading && <ResultDisplay result={result} />}
      </Box>

      {/* Compositor —solo si hay WhatsApp y ya terminó el scrape */}
      {result && !loading && (
        hasWhatsapp
          ? <>
              <InstanceDisconnectedBanner status={instanceStatus} sx={{ mt: 2, mb: 1 }} />
              {sendSuccess && <Alert severity="success" sx={{ mt: 2 }}>Mensaje enviado correctamente</Alert>}
              {!sendSuccess && <MessageComposer result={result} onSend={handleSend} sending={sending} disabled={isDisconnected} capStats={capStats} />}
            </>
          : <Box sx={{ mt: 3, p: 2, borderRadius: 2, border: '1px solid var(--border)', bgcolor: 'var(--item-hover)', textAlign: 'center' }}>
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {t.single.noWa}
              </Typography>
            </Box>
      )}
    </Box>
  )
}
