'use client'
import { useState, useCallback } from 'react'
import { useLang } from '../context/LangContext'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Slider from '@mui/material/Slider'
import IconButton from '@mui/material/IconButton'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import TuneIcon from '@mui/icons-material/Tune'
import Divider from '@mui/material/Divider'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

const FIELD_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'rgba(255,255,255,0.04)', fontSize: '0.85rem', borderRadius: 2, color: 'white',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent,#3b82f6)' },
  },
  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--accent,#60a5fa)' },
  '& .MuiInputBase-input': { color: 'white' },
  '& .MuiFormHelperText-root': { color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' },
}

const DEFAULTS = { max_turns: 3, extra_instructions: '' }

export default function ChatAIConfig({ open, onClose, companyId, companyName, onSaved }) {
  const { t } = useLang()
  const s = t.settings
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)
  const [form,    setForm]    = useState(DEFAULTS)

  // Instrucción base global — bloqueada por default, con candado + advertencia.
  const [globalPrompt,   setGlobalPrompt]   = useState('')
  const [globalDefault,  setGlobalDefault]  = useState('')
  const [globalLoading,  setGlobalLoading]  = useState(false)
  const [globalSaving,   setGlobalSaving]   = useState(false)
  const [globalSaved,    setGlobalSaved]    = useState(false)
  const [globalError,    setGlobalError]    = useState('')
  const [locked,         setLocked]         = useState(true)
  const [unlockWarnOpen, setUnlockWarnOpen] = useState(false)

  const loadConfig = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setError(''); setSaved(false)
    try {
      const r = await fetch(`/api/conversations/${companyId}/ai-config`)
      const d = await r.json()
      if (!r.ok) { setError(d.detail || `Error ${r.status}`); return }
      setForm({
        max_turns:          d.max_turns          ?? DEFAULTS.max_turns,
        extra_instructions: d.extra_instructions ?? DEFAULTS.extra_instructions,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }

    setLocked(true); setGlobalSaved(false); setGlobalError('')
    setGlobalLoading(true)
    try {
      const r = await fetch('/api/conversations/ai-global-config')
      const d = await r.json()
      if (r.ok) {
        setGlobalDefault(d.default_system_prompt || '')
        setGlobalPrompt(d.system_prompt?.trim() ? d.system_prompt : (d.default_system_prompt || ''))
      }
    } catch {
      // silencioso — la instrucción base es "avanzado", no bloquea el resto del diálogo
    } finally {
      setGlobalLoading(false)
    }
  }, [companyId])

  async function handleSaveGlobalPrompt() {
    setGlobalSaving(true); setGlobalError('')
    try {
      const r = await fetch('/api/conversations/ai-global-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: globalPrompt.trim() === globalDefault.trim() ? '' : globalPrompt }),
      })
      const d = await r.json()
      if (!r.ok) { setGlobalError(d.detail || `Error ${r.status}`); return }
      setGlobalSaved(true)
      setTimeout(() => setGlobalSaved(false), 2500)
    } catch (e) {
      setGlobalError(e.message)
    } finally {
      setGlobalSaving(false)
    }
  }

  function handleUnlockClick() {
    if (locked) setUnlockWarnOpen(true)
    else setLocked(true)
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const r = await fetch(`/api/conversations/${companyId}/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.detail || `Error ${r.status}`); return }
      setSaved(true)
      onSaved?.()
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{ transition: { onEntered: loadConfig } }}
      maxWidth="xs"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          backgroundColor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(var(--accent-rgb,99,102,241),0.08) 0%, transparent 50%)',
          border: '1px solid rgba(var(--accent-rgb,99,102,241),0.2)',
          borderRadius: 3,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
        '& .MuiBackdrop-root': {
          backdropFilter: 'blur(4px)',
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 2, flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.15)',
            border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SmartToyIcon sx={{ color: 'var(--accent,#a5b4fc)', fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>
              {s.aiCfgTitle}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }} noWrap>
              {companyName}
            </Typography>
          </Box>
          <TuneIcon sx={{ fontSize: 16, color: 'rgba(255,255,255,0.15)' }} />
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '4px !important', pb: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <CircularProgress size={22} sx={{ color: 'var(--accent,#6366f1)' }} />
          </Box>
        ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
              {s.aiCfgMaxTurns}
            </Typography>
          </Divider>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1 }}>
              <Box sx={{
                px: 1.5, py: 0.25, borderRadius: 99,
                bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.15)',
                border: '1px solid rgba(var(--accent-rgb,99,102,241),0.3)',
              }}>
                <Typography sx={{ color: 'var(--accent,#a5b4fc)', fontWeight: 700, fontSize: '0.85rem' }}>
                  {form.max_turns}
                </Typography>
              </Box>
            </Box>
            <Slider
              value={form.max_turns}
              onChange={(_, v) => setForm(p => ({ ...p, max_turns: v }))}
              min={1} max={20} step={1}
              marks={[
                { value: 1, label: '1' },
                { value: 5, label: '5' },
                { value: 10, label: '10' },
                { value: 20, label: '20' },
              ]}
              sx={{
                color: 'var(--accent,#6366f1)',
                '& .MuiSlider-markLabel': { color: 'rgba(255,255,255,0.25)', fontSize: '0.68rem' },
                '& .MuiSlider-track': { border: 'none' },
                '& .MuiSlider-thumb': {
                  width: 18, height: 18,
                  '&:hover, &.Mui-active': { boxShadow: '0 0 0 8px rgba(var(--accent-rgb,99,102,241),0.16)' },
                },
              }}
            />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
              {s.aiCfgExtra}
            </Typography>
          </Divider>

          <TextField
            multiline rows={4} size="small" fullWidth
            placeholder={s.aiCfgExtraPh}
            value={form.extra_instructions}
            onChange={e => setForm(p => ({ ...p, extra_instructions: e.target.value }))}
            helperText={s.aiCfgExtraHint}
            sx={FIELD_SX}
          />

          {error && (
            <Alert severity="error" sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', '& .MuiAlert-icon': { color: '#f87171' }, fontSize: '0.8rem' }}>
              {error}
            </Alert>
          )}

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
              {s.aiCfgGlobalTitle}
            </Typography>
          </Divider>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.2 }}>
              <WarningAmberIcon sx={{ fontSize: 15, color: '#f59e0b', mt: 0.1, flexShrink: 0 }} />
              <Typography sx={{ color: 'rgba(245,158,11,0.85)', fontSize: '0.72rem', lineHeight: 1.5 }}>
                {s.aiCfgGlobalHint}
              </Typography>
              <IconButton size="small" onClick={handleUnlockClick} sx={{ ml: 'auto', flexShrink: 0, color: locked ? 'rgba(255,255,255,0.35)' : '#4ade80' }}>
                {locked ? <LockIcon sx={{ fontSize: 17 }} /> : <LockOpenIcon sx={{ fontSize: 17 }} />}
              </IconButton>
            </Box>

            {globalLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={18} sx={{ color: 'var(--accent,#6366f1)' }} />
              </Box>
            ) : (
              <>
                <TextField
                  multiline rows={8} size="small" fullWidth
                  value={globalPrompt}
                  disabled={locked}
                  onChange={e => setGlobalPrompt(e.target.value)}
                  sx={{ ...FIELD_SX, '& .MuiInputBase-input': { color: 'white', fontFamily: 'monospace', fontSize: '0.78rem' } }}
                />
                {!locked && (
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                    <Button size="small" onClick={() => setGlobalPrompt(globalDefault)}
                      sx={{ color: 'rgba(255,255,255,0.45)', textTransform: 'none', fontSize: '0.75rem' }}>
                      {s.aiCfgGlobalReset}
                    </Button>
                    <Button
                      size="small" variant="contained" onClick={handleSaveGlobalPrompt} disabled={globalSaving}
                      startIcon={globalSaved ? <CheckCircleIcon sx={{ fontSize: '15px !important' }} /> : null}
                      sx={{
                        bgcolor: globalSaved ? '#22c55e' : 'var(--accent,#6366f1)',
                        textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', borderRadius: 2,
                        '&:hover': { filter: 'brightness(1.1)' },
                      }}>
                      {globalSaving ? <CircularProgress size={14} sx={{ color: 'white' }} /> : globalSaved ? s.aiCfgGlobalSaved : s.aiCfgGlobalSave}
                    </Button>
                  </Box>
                )}
                {globalError && (
                  <Alert severity="error" sx={{ mt: 1, bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', '& .MuiAlert-icon': { color: '#f87171' }, fontSize: '0.8rem' }}>
                    {globalError}
                  </Alert>
                )}
              </>
            )}
          </Box>
        </Box>
        )}
      </DialogContent>

      <Dialog open={unlockWarnOpen} onClose={() => setUnlockWarnOpen(false)} maxWidth="xs" fullWidth
        sx={{ '& .MuiDialog-paper': { bgcolor: 'var(--card-bg, #161d2e)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 3 } }}>
        <DialogContent sx={{ pt: 3 }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 1 }}>
            <WarningAmberIcon sx={{ color: '#f59e0b', fontSize: 22, flexShrink: 0 }} />
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.92rem' }}>{s.aiCfgGlobalWarnTitle}</Typography>
          </Box>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', lineHeight: 1.6 }}>
            {s.aiCfgGlobalWarnBody}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setUnlockWarnOpen(false)} sx={{ color: 'rgba(255,255,255,0.45)', textTransform: 'none', fontSize: '0.82rem' }}>
            {s.aiCfgGlobalWarnCancel}
          </Button>
          <Button onClick={() => { setLocked(false); setUnlockWarnOpen(false) }} variant="contained"
            sx={{ bgcolor: '#f59e0b', color: '#000', textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', '&:hover': { bgcolor: '#fbbf24' } }}>
            {s.aiCfgGlobalWarnConfirm}
          </Button>
        </DialogActions>
      </Dialog>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
        <Button onClick={onClose} sx={{ color: 'rgba(255,255,255,0.45)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' } }}>
          {s.aiCfgClose}
        </Button>
        <Button
          onClick={handleSave}
          disabled={loading || saving}
          variant="contained"
          startIcon={saved
            ? <CheckCircleIcon sx={{ fontSize: '17px !important' }} />
            : saving ? null
            : <TuneIcon sx={{ fontSize: '17px !important' }} />}
          sx={{
            bgcolor: saved ? '#22c55e' : 'var(--accent,#6366f1)',
            '&:hover': { filter: 'brightness(1.1)' },
            '&.Mui-disabled': { bgcolor: 'rgba(var(--accent-rgb,99,102,241),0.25)', color: 'rgba(255,255,255,0.3)' },
            textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5,
            transition: 'background-color 0.25s',
          }}
        >
          {saving
            ? <CircularProgress size={15} sx={{ color: 'white' }} />
            : saved ? s.aiCfgSaved : s.aiCfgSave}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
