'use client'
// Shared "message template library" UI: a CRUD manager for user-authored
// message variants, and a picker that lets any bulk-send surface (Batch
// URLs, CSV Import, Database, Scheduled Sends) select several of them for a
// single send. Sending the exact same text to many WhatsApp numbers is a
// common bot-detection signal, so any surface sending to 2+ recipients
// should rotate between 3+ variants instead (see MIN_TEMPLATES_FOR_BULK in
// @/lib/messageVariants and backEnd/app/scheduler.py's _pick_message).
import { useState, useEffect, useRef, useCallback } from 'react'
import { authFetch } from '@/lib/api'
import { useLang } from '../context/LangContext'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DescriptionIcon from '@mui/icons-material/Description'
import { MIN_TEMPLATES_FOR_BULK } from '@/lib/messageVariants'
import { HighlightedMessageInput, HighlightedPreview } from './highlightedMessageInput'

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    color: 'var(--text,#f1f5f9)', bgcolor: 'var(--surface,rgba(255,255,255,0.04))', fontSize: '0.85rem',
    '& fieldset': { borderColor: 'var(--border,rgba(255,255,255,0.1))' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.45)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
    '& .MuiInputBase-input': { color: 'var(--text,#f1f5f9)', WebkitTextFillColor: 'var(--text,#f1f5f9)' },
  },
  '& .MuiInputLabel-root': { color: 'var(--text-muted,rgba(255,255,255,0.4))', fontSize: '0.82rem' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent,#3b82f6)' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root': { color: '#1a2234' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root .MuiInputBase-input': { color: '#1a2234', WebkitTextFillColor: '#1a2234' },
  '[data-theme-mode="light"] & .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(0,0,0,0.28)' },
  '[data-theme-mode="light"] & .MuiInputLabel-root': { color: 'rgba(15,23,42,0.58)' },
}

// ─── Tiny confirm dialog (kept local to avoid coupling to any one page) ───────

function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }) {
  const { t } = useLang()
  return (
    <Dialog open={open} onClose={onCancel} sx={{ '& .MuiDialog-paper': {
      bgcolor: 'var(--card-bg,#1e293b)', backgroundImage: 'none',
      color: 'var(--text,#f1f5f9)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.6)', minWidth: 320,
    } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: 2, flexShrink: 0,
            bgcolor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <DeleteIcon sx={{ fontSize: 16, color: '#f87171' }} />
          </Box>
          <Typography sx={{ color: 'var(--text,white)', fontWeight: 700, fontSize: '0.93rem' }}>{title}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.5 }}>{body}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Button onClick={onCancel} sx={{ color: 'var(--text-muted)', textTransform: 'none', fontSize: '0.83rem', borderRadius: 1.5 }}>{t.common.cancel}</Button>
        <Button onClick={onConfirm}
          sx={{ bgcolor: '#ef4444', color: '#fff', textTransform: 'none', fontSize: '0.83rem', fontWeight: 600, borderRadius: 1.5, px: 2,
            '&:hover': { bgcolor: '#ef4444', filter: 'brightness(0.88)' } }}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ─── Template manager (CRUD) ───────────────────────────────────────────────────

const VAR_CHIPS = [
  { key: 'nombre',   labelEs: 'nombre',   labelEn: 'name'     },
  { key: 'industria',labelEs: 'industria',labelEn: 'industry'  },
  { key: 'ciudad',   labelEs: 'ciudad',   labelEn: 'city'      },
  { key: 'web',      labelEs: 'web',      labelEn: 'web'       },
]

// Two-column CRUD body (list + editor), self-contained. Used standalone inside
// the Settings "Plantillas" tab, and wrapped in a Dialog by TemplateManagerDialog
// for the picker's "Administrar" button.
export function TemplateManagerBody({ onChange, onCountChange }) {
  const { t, lang } = useLang()
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [editing,   setEditing]   = useState(null) // { _id?, name, text } or null
  const [error,     setError]     = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const textareaRef = useRef(null)

  function insertVar(varKey) {
    const el = textareaRef.current
    const placeholder = `{{${varKey}}}`
    if (!el) {
      setEditing(prev => ({ ...prev, text: (prev.text || '') + placeholder }))
      return
    }
    const start = el.selectionStart ?? (editing?.text || '').length
    const end   = el.selectionEnd   ?? start
    const base  = editing?.text || ''
    const newText = base.slice(0, start) + placeholder + base.slice(end)
    setEditing(prev => ({ ...prev, text: newText }))
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + placeholder.length
    })
  }

  const load = useCallback(() => {
    setLoading(true)
    authFetch(`/api/admin/message-templates?lang=${lang}`)
      .then(r => r.json()).then(d => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoading(false))
  }, [lang])

  useEffect(() => { load() }, [load])
  const onCountChangeRef = useRef(onCountChange)
  useEffect(() => { onCountChangeRef.current = onCountChange })
  useEffect(() => { onCountChangeRef.current?.(templates.length) }, [templates])

  async function handleSave() {
    if (!editing?.name?.trim() || !editing?.text?.trim()) { setError(t.tplLib.fillAll); return }
    setError('')
    try {
      const isNew = !editing._id
      const res = await authFetch(isNew ? '/api/admin/message-templates' : `/api/admin/message-templates/${editing._id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editing.name.trim(), text: editing.text.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || t.tplLib.saveError)
      setEditing(null)
      load()
      onChange?.()
    } catch (err) { setError(err.message) }
  }

  async function handleDelete(tpl) {
    setConfirmDel(null)
    try {
      await authFetch(`/api/admin/message-templates/${tpl._id}`, { method: 'DELETE' })
      setTemplates(prev => prev.filter(x => x._id !== tpl._id))
      if (editing?._id === tpl._id) { setEditing(null); setError('') }
      onChange?.()
    } catch { /* noop */ }
  }

  const VAR_COLORS = { nombre: '#818cf8', industria: '#fb923c', ciudad: '#38bdf8', web: '#a78bfa' }

  return (
    <>
      {/* ── Two-column body ── */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: list */}
        <Box sx={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 1.2, borderBottom: '1px solid var(--border)' }}>
            <Button variant="contained" size="small" fullWidth startIcon={<AddIcon sx={{ fontSize: 15 }} />}
              onClick={() => { setEditing({ name: '', text: '' }); setError('') }}
              sx={{ bgcolor: 'var(--accent,#3b82f6)', color: '#fff', textTransform: 'none', fontWeight: 600,
                borderRadius: 1.5, fontSize: '0.78rem', boxShadow: 'none',
                '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.88)', boxShadow: 'none' } }}>
              {t.tplLib.newTemplate}
            </Button>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 0.8, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={16} sx={{ color: 'var(--accent)' }} /></Box>
            ) : templates.length === 0 ? (
              <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center', py: 3 }}>{t.tplLib.noTemplates}</Typography>
            ) : templates.map(tpl => {
              const isActive = editing?._id === tpl._id
              const usedVars = Object.keys(VAR_COLORS).filter(v => tpl.text.includes(`{{${v}}}`))
              const varLabels = { nombre: lang === 'en' ? 'name' : 'nombre', industria: lang === 'en' ? 'industry' : 'industria', ciudad: lang === 'en' ? 'city' : 'ciudad', web: 'web' }
              return (
                <Box key={tpl._id}
                  onClick={() => { setEditing({ _id: tpl._id, name: tpl.name, text: tpl.text }); setError('') }}
                  sx={{ borderRadius: 1.5, p: 1, cursor: 'pointer',
                    border: `1px solid ${isActive ? 'rgba(var(--accent-rgb,59,130,246),0.5)' : 'var(--border)'}`,
                    bgcolor: isActive ? 'rgba(var(--accent-rgb,59,130,246),0.1)' : 'transparent',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)', bgcolor: isActive ? 'rgba(var(--accent-rgb,59,130,246),0.1)' : 'rgba(var(--accent-rgb,59,130,246),0.04)' },
                  }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                    <Typography sx={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.78rem', flex: 1, minWidth: 0 }} noWrap>{tpl.name}</Typography>
                    <IconButton size="small" onClick={e => { e.stopPropagation(); setConfirmDel(tpl) }}
                      sx={{ color: 'var(--text-muted)', p: 0.2, flexShrink: 0, '&:hover': { color: '#ef4444' } }}>
                      <DeleteIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Box>
                  <HighlightedPreview text={tpl.text} lang={lang}
                    sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.68rem', mt: 0.3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                  {usedVars.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3, mt: 0.5 }}>
                      {usedVars.map(v => (
                        <Box key={v} sx={{ fontSize: '0.58rem', fontWeight: 700, px: 0.6, py: 0.1, borderRadius: 0.8,
                          bgcolor: `${VAR_COLORS[v]}18`, color: VAR_COLORS[v], border: `1px solid ${VAR_COLORS[v]}40` }}>
                          {varLabels[v]}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* Right: editor */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2.5, overflow: 'hidden' }}>
          {editing ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%' }}>
              <TextField label={t.tplLib.tplNameLabel} size="small" value={editing.name}
                onChange={e => setEditing(v => ({ ...v, name: e.target.value }))} fullWidth sx={FIELD_SX} />
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.6, flexWrap: 'wrap' }}>
                  <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.72rem', mr: 0.5 }}>{t.tplLib.messageLabel}</Typography>
                  {VAR_CHIPS.map(v => (
                    <Box key={v.key} onClick={() => insertVar(v.key)} sx={{
                      cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700, px: 0.9, py: 0.2,
                      borderRadius: 1, border: '1px solid var(--border)',
                      bgcolor: 'var(--item-hover)', color: VAR_COLORS[v.key],
                      userSelect: 'none', '&:hover': { opacity: 0.75 },
                    }}>
                      {lang === 'en' ? v.labelEn : v.labelEs}
                    </Box>
                  ))}
                </Box>
                <HighlightedMessageInput value={editing.text} rows={7} maxLength={1000} lang={lang}
                  inputRef={textareaRef}
                  onChange={v => setEditing(prev => ({ ...prev, text: v }))} />
              </Box>
              {error && <Typography sx={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</Typography>}
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 'auto' }}>
                <Button size="small" onClick={() => { setEditing(null); setError('') }}
                  sx={{ color: 'var(--text-muted)', textTransform: 'none', borderRadius: 1.5 }}>{t.common.cancel}</Button>
                <Button size="small" onClick={handleSave}
                  sx={{ bgcolor: 'var(--accent,#3b82f6)', color: '#fff', textTransform: 'none', fontWeight: 600,
                    borderRadius: 1.5, px: 2, '&:hover': { bgcolor: 'var(--accent,#3b82f6)', filter: 'brightness(0.88)' } }}>
                  {t.tplLib.saveLbl}
                </Button>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 1.2, color: 'var(--text-muted)', opacity: 0.45 }}>
              <DescriptionIcon sx={{ fontSize: 38 }} />
              <Typography sx={{ fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.6 }}>
                {lang === 'en' ? 'Select a template to edit\nor create a new one' : 'Selecciona una plantilla para editar\no crea una nueva'}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <ConfirmDialog open={!!confirmDel} title={t.tplLib.deleteTplConfirmTitle}
        body={confirmDel ? `${t.tplLib.deleteTplConfirmBody} "${confirmDel.name}"` : ''}
        confirmLabel={t.tplLib.deleteBtn} onConfirm={() => handleDelete(confirmDel)} onCancel={() => setConfirmDel(null)} />
    </>
  )
}

// ─── Modal wrapper around the body, for surfaces that open it as a dialog
// (the picker's "Administrar plantillas" button, Scheduled Sends) ─────────────

export function TemplateManagerDialog({ open, onClose, onChange }) {
  const { t } = useLang()
  const [count, setCount] = useState(0)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      sx={{ '& .MuiDialog-paper': {
        bgcolor: 'var(--card-bg,#1e293b)', backgroundImage: 'none',
        color: 'var(--text,#f1f5f9)',
        border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
        borderRadius: 3, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        height: 520, display: 'flex', flexDirection: 'column',
      } }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 2.5, py: 1.5, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <Box sx={{ width: 32, height: 32, borderRadius: 2, flexShrink: 0,
          bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DescriptionIcon sx={{ fontSize: 17, color: 'var(--accent,#60a5fa)' }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.93rem', lineHeight: 1.2 }}>{t.tplLib.manageBtn}</Typography>
          <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{t.tplLib.libraryCount(count)}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--text)' } }}>
          <CloseIcon sx={{ fontSize: 17 }} />
        </IconButton>
      </Box>

      <TemplateManagerBody onChange={onChange} onCountChange={setCount} />
    </Dialog>
  )
}

// ─── Template picker (select N saved templates for one send) ──────────────────
// Self-contained: fetches the library, tracks its own selection, and reports
// the selected raw texts back via onChange whenever the selection or the
// underlying template list changes. `recipientCount` only affects the
// hint/warning shown — enforcing the minimum before sending is the caller's
// responsibility (compare the reported texts.length to MIN_TEMPLATES_FOR_BULK).

// `baseCount`: how many variants the CALLER already has outside this picker
// (almost always 1 — the free-edit "write or edit the message" box that
// every surface keeps above this picker). The minimum-3 rule counts that
// text too, so the hint here must add it in rather than requiring 3 more
// from the library on top of it.
// Maps each {{variable}} to the availability flag that governs it — a template
// using a variable gets disabled when NONE of the currently selected recipients
// have that data, since it would render with a blank gap for every one of them
// (e.g. "te contactamos desde " with nothing after "desde" when city is missing).
const VAR_CHECKS = [
  { re: /\{\{nombre\}\}/,    flag: 'hasName',     labelKey: 'varName' },
  { re: /\{\{ciudad\}\}/,    flag: 'hasCity',     labelKey: 'varCity' },
  { re: /\{\{industria\}\}/, flag: 'hasIndustry', labelKey: 'varIndustry' },
  { re: /\{\{web\}\}/,       flag: 'hasWeb',      labelKey: 'varWeb' },
]

export function TemplateLibraryPicker({
  onChange, recipientCount = 0, baseCount = 0, label,
  hasName = true, hasCity = true, hasIndustry = true, hasWeb = true,
}) {
  const { t, lang } = useLang()
  const [templates,   setTemplates]   = useState([])
  const [loading,      setLoading]     = useState(true)
  const [selectedIds,  setSelectedIds] = useState([])
  const [managerOpen,  setManagerOpen] = useState(false)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const availability = { hasName, hasCity, hasIndustry, hasWeb }
  const missingVarsFor = useCallback((text) => VAR_CHECKS.filter(v => v.re.test(text) && !availability[v.flag]),
    [hasName, hasCity, hasIndustry, hasWeb]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    setLoading(true)
    authFetch(`/api/admin/message-templates?lang=${lang}`)
      .then(r => r.json()).then(d => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => {}).finally(() => setLoading(false))
  }, [lang])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const texts = templates.filter(tpl => selectedIds.includes(tpl._id)).map(tpl => tpl.text)
    onChangeRef.current?.(texts)
  }, [templates, selectedIds])

  // Drop any selection that becomes blocked when the recipient set changes
  // (e.g. user picks a template while city data is available, then adds a
  // recipient list where nobody has a city) — never leave a broken pick behind.
  useEffect(() => {
    setSelectedIds(prev => prev.filter(id => {
      const tpl = templates.find(x => x._id === id)
      return !tpl || missingVarsFor(tpl.text).length === 0
    }))
  }, [templates, missingVarsFor])

  function toggle(id, blocked) {
    if (blocked) return
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const needsMin = recipientCount > 1
  const totalCount = baseCount + selectedIds.length
  const ok = totalCount >= MIN_TEMPLATES_FOR_BULK

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, flex: 1 }}>{label || t.tplLib.title}</Typography>
        <Button size="small" onClick={() => setManagerOpen(true)}
          sx={{
            color: 'var(--accent,#3b82f6)', textTransform: 'none', fontSize: '0.72rem', fontWeight: 600,
            borderRadius: 1.5, px: 1, py: 0.3,
            '&:hover': { bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)' },
          }}>
          {t.tplLib.manageBtn}
        </Button>
      </Box>

      <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', opacity: 0.75 }}>
        {baseCount > 0 ? t.tplLib.pickHintWithBase : t.tplLib.pickHint}
      </Typography>

      {needsMin ? (
        <Box sx={{ display: 'flex', gap: 0.6, alignItems: 'flex-start', borderRadius: 1.5, px: 1, py: 0.7,
          bgcolor: ok ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
          {ok
            ? <CheckCircleIcon sx={{ fontSize: 13, color: '#4ade80', mt: 0.2, flexShrink: 0 }} />
            : <WarningAmberIcon sx={{ fontSize: 13, color: '#f59e0b', mt: 0.2, flexShrink: 0 }} />}
          <Typography sx={{ color: ok ? '#4ade80' : '#f59e0b', fontSize: '0.7rem', lineHeight: 1.4 }}>
            {ok ? t.tplLib.minRequiredOk(totalCount) : t.tplLib.minRequiredBlock(MIN_TEMPLATES_FOR_BULK, totalCount)}
          </Typography>
        </Box>
      ) : (
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.7rem', opacity: 0.6 }}>{t.tplLib.singleRecipientOk}</Typography>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={16} sx={{ color: 'var(--accent,#3b82f6)' }} /></Box>
      ) : templates.length === 0 ? (
        <Typography sx={{ color: 'var(--text-muted)', fontSize: '0.76rem', py: 1 }}>{t.tplLib.noTemplates}</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 220, overflowY: 'auto' }}>
          {templates.map(tpl => {
            const isSel = selectedIds.includes(tpl._id)
            const missing = missingVarsFor(tpl.text)
            const blocked = missing.length > 0
            const row = (
              <Box key={tpl._id} onClick={() => toggle(tpl._id, blocked)} sx={{
                display: 'flex', alignItems: 'flex-start', gap: 0.6, cursor: blocked ? 'not-allowed' : 'pointer',
                border: `1px solid ${blocked ? 'rgba(239,68,68,0.25)' : isSel ? 'rgba(var(--accent-rgb,59,130,246),0.4)' : 'var(--border)'}`, borderRadius: 1.5, p: 0.8,
                bgcolor: blocked ? 'rgba(239,68,68,0.04)' : isSel ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'var(--card-bg)',
                opacity: blocked ? 0.6 : 1,
                transition: 'border-color 0.15s, background-color 0.15s',
                '&:hover': blocked ? {} : { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' },
              }}>
                <Checkbox size="small" checked={isSel} disabled={blocked} onChange={() => toggle(tpl._id, blocked)} onClick={e => e.stopPropagation()}
                  sx={{ p: 0.3, color: 'var(--border)', '&.Mui-checked': { color: 'var(--accent,#3b82f6)' } }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ color: 'var(--text)', fontWeight: 600, fontSize: '0.78rem' }}>{tpl.name}</Typography>
                  <HighlightedPreview text={tpl.text} lang={lang} sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                </Box>
              </Box>
            )
            if (!blocked) return row
            const varLabels = missing.map(v => t.tplLib[v.labelKey]).join(', ')
            return <Tooltip key={tpl._id} title={t.tplLib.blockedMissingVar(varLabels)} placement="top"><span>{row}</span></Tooltip>
          })}
        </Box>
      )}

      <TemplateManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} onChange={load} />
    </Box>
  )
}
