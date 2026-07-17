'use client'
// Shared rendering for {{variable}} placeholders in message text: shown
// without the braces, bold and colored, so the user can tell at a glance
// which words will be substituted per recipient without the raw {{}} syntax
// cluttering the message.
import { useRef } from 'react'
import Box from '@mui/material/Box'

const VAR_COLORS = { nombre: '#818cf8', ciudad: '#38bdf8', industria: '#fb923c', web: '#a78bfa', empresa: '#818cf8' }

const VAR_LABELS_EN = { nombre: 'name', ciudad: 'city', industria: 'industry', web: 'web', empresa: 'business' }

export function highlightVarsHtml(text, lang = 'es') {
  const useEn = lang === 'en'
  return (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\{\{(nombre|ciudad|industria|web|empresa)\}\}/g, (_, k) => {
      const label = useEn ? (VAR_LABELS_EN[k] || k) : k
      return `<span style="color:${VAR_COLORS[k]};font-weight:700;">${label}</span>`
    })
}

export function HighlightedPreview({ text, lang, sx }) {
  return (
    <Box component="span" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...sx }}
      dangerouslySetInnerHTML={{ __html: highlightVarsHtml(text, lang) }} />
  )
}

// Editable textarea with the same highlighting, built as a transparent
// textarea layered over a highlighted div (same technique already used in
// batchProcessor.jsx/csvImporter.jsx) so the caret and selection behave like
// a normal textarea while the visible text shows the colored variable names.
export function HighlightedMessageInput({ value, onChange, rows = 3, maxLength = 1000, disabled, placeholder, lang, inputRef }) {
  const taRef = useRef(null)
  const hlRef = useRef(null)
  function syncScroll() { if (hlRef.current && taRef.current) hlRef.current.scrollTop = taRef.current.scrollTop }

  return (
    <Box sx={{
      position: 'relative', borderRadius: 1.5,
      border: '1px solid rgba(255,255,255,0.12)',
      bgcolor: 'rgba(255,255,255,0.05)',
      '&:focus-within': { borderColor: 'var(--accent,#3b82f6)' },
      '[data-theme-mode="light"] &': { border: '1px solid rgba(0,0,0,0.23)', bgcolor: 'rgba(0,0,0,0.03)' },
      '[data-theme-mode="light"] &:focus-within': { borderColor: 'var(--accent,#3b82f6)' },
    }}>
      <Box component="textarea" ref={el => { taRef.current = el; if (inputRef) inputRef.current = el }} value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        sx={{
          position: 'relative', zIndex: 1, display: 'block',
          width: '100%', minHeight: rows * 24, resize: 'vertical',
          bgcolor: 'transparent',
          color: 'transparent', WebkitTextFillColor: 'transparent',
          caretColor: 'var(--text,#e2e8f0)',
          '[data-theme-mode="light"] &': { caretColor: '#1a2234' },
          border: 'none', outline: 'none', borderRadius: 1.5,
          p: 1.2, fontSize: '0.85rem', lineHeight: 1.6, fontFamily: 'inherit',
          boxSizing: 'border-box',
          '&::selection': { color: 'transparent', WebkitTextFillColor: 'transparent', bgcolor: 'rgba(59,130,246,0.35)' },
          '&::placeholder': { color: 'rgba(255,255,255,0.3)', WebkitTextFillColor: 'rgba(255,255,255,0.3)' },
          '[data-theme-mode="light"] &::placeholder': { color: 'rgba(15,23,42,0.4)', WebkitTextFillColor: 'rgba(15,23,42,0.4)' },
        }}
      />
      <Box
        ref={hlRef}
        dangerouslySetInnerHTML={{ __html: highlightVarsHtml(value, lang) + ' ' }}
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 2, pointerEvents: 'none',
          p: 1.2, fontSize: '0.85rem', lineHeight: 1.6, fontFamily: 'inherit',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          overflowY: 'hidden',
          color: 'var(--text,#e2e8f0)', borderRadius: 1.5,
          '[data-theme-mode="light"] &': { color: '#1a2234' },
        }}
      />
    </Box>
  )
}
