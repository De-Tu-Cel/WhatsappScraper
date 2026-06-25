'use client'
import { useState, useCallback } from 'react'
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
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PersonIcon from '@mui/icons-material/Person'
import EmailIcon from '@mui/icons-material/Email'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
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
}

export default function AndyBotBuilder({ open, onClose, initialData = null }) {
  const [loading,  setLoading]  = useState(false)
  const [userData, setUserData] = useState(null)
  const [fetchErr, setFetchErr] = useState('')

  const [selectedNum, setSelectedNum] = useState('')
  const [botType,     setBotType]     = useState('flow')
  const [inUseWarn,   setInUseWarn]   = useState(false)

  const [form, setForm] = useState({
    company_name: '', business_line: '', industry: '', emails: '', website: '', prompt: '',
  })

  const [creating,  setCreating]  = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [success,   setSuccess]   = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setFetchErr(''); setUserData(null)
    setSelectedNum(''); setInUseWarn(false); setSuccess(false); setCreateErr('')

    // Fetch emails from company contacts if we have a company_id
    let emails = initialData?.emails || ''
    if (!emails && initialData?.company_id) {
      try {
        const cr = await fetch(`/api/companies/${initialData.company_id}`)
        if (cr.ok) {
          const cd = await cr.json()
          const emailContacts = (cd.contacts || [])
            .filter(c => c.type === 'email' && c.value)
            .map(c => c.value)
          emails = emailContacts.join(', ')
        }
      } catch {}
    }

    setForm({
      company_name:  initialData?.company_name  || '',
      business_line: initialData?.industry      || '',
      industry:      initialData?.industry      || '',
      emails,
      website:       initialData?.website       || '',
      prompt: '',
    })

    try {
      const r = await fetch('/api/andy/commercials')
      const d = await r.json()
      if (!r.ok) { setFetchErr(`${d.error || `Error ${r.status}`}${d.cause ? ` (${d.cause})` : ''}`); return }
      setUserData(d)
      // Auto-select if only one number available (no warning on auto-select — chip already shows bot name)
      if (d.numbers?.length === 1) {
        setSelectedNum(d.numbers[0].phone_number_id)
      }
    } catch (e) {
      setFetchErr(`Error de red: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [initialData])

  function handleSelectNum(phoneId) {
    setSelectedNum(phoneId)
    const num = userData?.numbers?.find(n => n.phone_number_id === phoneId)
    setInUseWarn(!!num?.in_use)
  }

  async function handleCreate() {
    if (!selectedNum)                 { setCreateErr('Selecciona un número telefónico'); return }
    if (!form.company_name.trim())    { setCreateErr('El nombre de la empresa es requerido'); return }
    if (!form.prompt.trim())          { setCreateErr('El prompt es requerido'); return }

    const num         = userData.numbers.find(n => n.phone_number_id === selectedNum)
    const portfolioId = userData.portfolio_id || 'OwnWA'

    const body = {
      prompt:        form.prompt,
      company:       form.company_name,
      business_type: form.business_line,
      industry:      form.industry,
      emails:        form.emails,
      website:       form.website,
      bot:           botType,
    }

    setCreating(true); setCreateErr('')
    try {
      const r = await fetch(`/api/andy/build/${portfolioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-phone-number-id': selectedNum },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setCreateErr(d.detail || d.error || d.message || `Error ${r.status}`); return }
      setSuccess(true)
    } catch (e) {
      setCreateErr(`Error de red: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  function handleClose() {
    setSuccess(false); setCreateErr(''); setFetchErr('')
    onClose()
  }

  const selectedNumData = userData?.numbers?.find(n => n.phone_number_id === selectedNum)

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      slotProps={{ transition: { onEntered: loadData } }}
      maxWidth="sm"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          backgroundColor: 'var(--card-bg, #161d2e)',
          backgroundImage: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.1) 0%, transparent 50%)',
          border: '1px solid rgba(var(--accent-rgb,59,130,246),0.2)',
          borderRadius: 3,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        },
        '& .MuiBackdrop-root': {
          backdropFilter: 'blur(4px)',
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: 2, flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.15)',
            border: '1px solid rgba(var(--accent-rgb,59,130,246),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SmartToyIcon sx={{ color: 'var(--accent,#60a5fa)', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
              Crear bot con Andy
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
              Configura y despliega un bot de WhatsApp
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important', pb: 1 }}>

        {loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 5, gap: 1.5 }}>
            <CircularProgress sx={{ color: 'var(--accent,#3b82f6)' }} size={36} />
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem' }}>Cargando…</Typography>
          </Box>
        )}

        {fetchErr && !loading && (
          <Alert severity="error" sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', '& .MuiAlert-icon': { color: '#f87171' } }}>
            {fetchErr}
          </Alert>
        )}

        {success && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 4 }}>
            <CheckCircleIcon sx={{ fontSize: 60, color: '#22c55e' }} />
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.05rem' }}>¡Bot creado exitosamente!</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem', textAlign: 'center' }}>
              Configurado en {selectedNumData?.display_number}.
            </Typography>
          </Box>
        )}

        {!loading && !fetchErr && !success && userData && (
          <>
            {/* User info */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 2, p: 1.5,
              bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <Box sx={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.18)',
                border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Typography sx={{ color: 'var(--accent,#60a5fa)', fontWeight: 800, fontSize: '0.9rem' }}>
                  {(userData.name || '?')[0].toUpperCase()}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
                  <PersonIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }} />
                  <Typography sx={{ color: 'white', fontWeight: 600, fontSize: '0.85rem' }}>{userData.name}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mt: 0.2 }}>
                  <EmailIcon sx={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem' }}>{userData.email}</Typography>
                </Box>
              </Box>
              <Chip label={`${userData.numbers?.length || 0} números`} size="small"
                sx={{ bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)', color: 'var(--accent,#60a5fa)', border: '1px solid rgba(var(--accent-rgb,59,130,246),0.22)', fontSize: '0.65rem' }} />
            </Box>

            {/* Phone select */}
            <FormControl fullWidth size="small" sx={FIELD_SX}>
              <InputLabel>Número de teléfono</InputLabel>
              <Select label="Número de teléfono" value={selectedNum} onChange={e => handleSelectNum(e.target.value)}
                slotProps={{ paper: { sx: { bgcolor: 'var(--surface,#1e2a3a)', border: '1px solid rgba(255,255,255,0.1)' } } }}>
                <MenuItem value=""><em style={{ color: 'rgba(255,255,255,0.3)' }}>Selecciona un número</em></MenuItem>
                {userData.numbers?.map(n => (
                  <MenuItem key={n.phone_number_id} value={n.phone_number_id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                      <Typography sx={{ flex: 1, fontSize: '0.83rem', color: 'white' }}>{n.display_number}</Typography>
                      <Chip label={n.bot_name || 'Disponible'} size="small" sx={{
                        height: 18, fontSize: '0.6rem', fontWeight: 600,
                        bgcolor: n.in_use ? 'rgba(251,191,36,0.12)' : 'rgba(34,197,94,0.12)',
                        color:   n.in_use ? '#fbbf24' : '#22c55e',
                        border: `1px solid ${n.in_use ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)'}`,
                      }} />
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {inUseWarn && (
              <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}
                sx={{ bgcolor: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', '& .MuiAlert-icon': { color: '#fbbf24' }, fontSize: '0.8rem' }}>
                El teléfono seleccionado ya tiene un bot activo (<strong>{selectedNumData?.bot_name}</strong>). Si continúas, se sobrescribirá.
              </Alert>
            )}

            {/* Bot type */}
            <FormControl fullWidth size="small" sx={FIELD_SX}>
              <InputLabel>Tipo de bot</InputLabel>
              <Select label="Tipo de bot" value={botType} onChange={e => setBotType(e.target.value)}
                slotProps={{ paper: { sx: { bgcolor: 'var(--surface,#1e2a3a)', border: '1px solid rgba(255,255,255,0.1)' } } }}>
                <MenuItem value="flow">Bot Flujo</MenuItem>
                <MenuItem value="ai">Bot IA Conversacional</MenuItem>
              </Select>
            </FormControl>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
                Datos del negocio
              </Typography>
            </Divider>

            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="Nombre de la empresa" size="small" fullWidth value={form.company_name}
                onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} sx={FIELD_SX} />
              <TextField label="Giro del negocio" size="small" fullWidth value={form.business_line}
                onChange={e => setForm(p => ({ ...p, business_line: e.target.value }))} sx={FIELD_SX} />
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="Industria" size="small" fullWidth value={form.industry}
                onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} sx={FIELD_SX} />
              <TextField label="Correo(s)" size="small" fullWidth placeholder="a@b.com, c@d.com"
                value={form.emails} onChange={e => setForm(p => ({ ...p, emails: e.target.value }))}
                helperText="Separa varios correos con coma" sx={FIELD_SX} />
            </Box>

            <TextField label="Página web" size="small" fullWidth placeholder="https://tuempresa.com"
              value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))} sx={FIELD_SX} />

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
                Instrucciones del bot
              </Typography>
            </Divider>

            <TextField label="Prompt / Instrucciones" multiline rows={3} size="small" fullWidth
              placeholder='Ej. "Crea un bot para atención a clientes, responde en español…"'
              value={form.prompt} onChange={e => setForm(p => ({ ...p, prompt: e.target.value }))} sx={FIELD_SX} />

            {createErr && (
              <Alert severity="error" sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', '& .MuiAlert-icon': { color: '#f87171' }, fontSize: '0.8rem' }}>
                {createErr}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
        <Button onClick={handleClose} sx={{ color: 'rgba(255,255,255,0.45)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, transition: 'all 0.15s', '&:hover': { color: '#ffffff', bgcolor: 'rgba(255,255,255,0.1)', } }}>
          {success ? 'Cerrar' : 'Cancelar'}
        </Button>
        {!success && !loading && !fetchErr && userData && (
          <Button onClick={handleCreate} disabled={creating} variant="contained"
            startIcon={creating ? null : <SmartToyIcon sx={{ fontSize: '17px !important' }} />}
            sx={{ bgcolor: 'var(--accent,#3b82f6)', '&:hover': { filter: 'brightness(1.1)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
            {creating ? <CircularProgress size={15} sx={{ color: 'white' }} /> : 'Crear bot'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
