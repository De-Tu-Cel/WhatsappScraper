'use client'
import { useState, useCallback, useRef } from 'react'
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
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Avatar from '@mui/material/Avatar'
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import SendIcon from '@mui/icons-material/Send'

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

export default function GasBotModal({ open, onClose, initialData = null }) {
  const { t } = useLang()
  const s = t.settings
  const fileInputRef = useRef(null)

  const [loading,  setLoading]  = useState(false)
  const [userData, setUserData] = useState(null)
  const [fetchErr, setFetchErr] = useState('')

  const [selectedNum, setSelectedNum] = useState('')

  const [form, setForm] = useState({ name: '', phone: '', schedule: '' })
  const [image, setImage] = useState('') // data:image/... base64

  const [sending,  setSending]  = useState(false)
  const [sendErr,  setSendErr]  = useState('')
  const [success,  setSuccess]  = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setFetchErr(''); setUserData(null)
    setSelectedNum(''); setSuccess(false); setSendErr(''); setImage('')

    setForm({
      name:     initialData?.company_name || '',
      phone:    initialData?.phone         || '',
      schedule: '',
    })

    try {
      const r = await fetch('/api/andy/commercials')
      const d = await r.json()
      if (!r.ok) { setFetchErr(`${d.error || `Error ${r.status}`}${d.cause ? ` (${d.cause})` : ''}`); return }
      setUserData(d)
      if (d.numbers?.length === 1) {
        setSelectedNum(d.numbers[0].phone_number_id)
      }
    } catch (e) {
      setFetchErr(s.andyBotErrNet.replace('{msg}', e.message))
    } finally {
      setLoading(false)
    }
  }, [initialData])

  function handlePickImage(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result)
    reader.readAsDataURL(file)
  }

  async function handleSend() {
    if (!selectedNum) { setSendErr(s.gasBotErrNum); return }

    const portfolioId = userData.portfolio_id || 'OwnWA'

    setSending(true); setSendErr('')
    try {
      const varsBody = {
        variables: {
          NAME:     form.name || '',
          PHONE:    form.phone || '',
          SCHEDULE: form.schedule || '',
        },
      }
      const rv = await fetch(`/api/andy/variables/${portfolioId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-phone-number-id': selectedNum },
        body: JSON.stringify(varsBody),
      })
      const dv = await rv.json().catch(() => ({}))
      if (!rv.ok) { setSendErr(dv.detail || dv.error || dv.message || `Error ${rv.status}`); return }

      if (image) {
        const rp = await fetch(`/api/andy/profile-picture/${portfolioId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-phone-number-id': selectedNum },
          body: JSON.stringify({ image }),
        })
        const dp = await rp.json().catch(() => ({}))
        if (!rp.ok) { setSendErr(dp.detail || dp.error || dp.message || `Error ${rp.status}`); return }
      }

      setSuccess(true)
    } catch (e) {
      setSendErr(s.gasBotErrNet.replace('{msg}', e.message))
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    setSuccess(false); setSendErr(''); setFetchErr('')
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
          backgroundImage: 'linear-gradient(160deg, rgba(251,146,60,0.1) 0%, transparent 50%)',
          border: '1px solid rgba(251,146,60,0.2)',
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
            bgcolor: 'rgba(251,146,60,0.15)',
            border: '1px solid rgba(251,146,60,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LocalGasStationIcon sx={{ color: '#fb923c', fontSize: 22 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>
              {s.gasBotTitle}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
              {s.gasBotSub}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important', pb: 1 }}>

        {loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 5, gap: 1.5 }}>
            <CircularProgress sx={{ color: '#fb923c' }} size={36} />
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem' }}>{s.gasBotLoading}</Typography>
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
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1.05rem' }}>{s.gasBotSuccess}</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem', textAlign: 'center' }}>
              {s.gasBotSuccessSub.replace('{num}', selectedNumData?.display_number || '')}
            </Typography>
          </Box>
        )}

        {!loading && !fetchErr && !success && userData && (
          <>
            {/* Phone select */}
            <FormControl fullWidth size="small" sx={FIELD_SX}>
              <InputLabel>{s.gasBotSelectPhone}</InputLabel>
              <Select label={s.gasBotSelectPhone} value={selectedNum} onChange={e => setSelectedNum(e.target.value)}
                slotProps={{ paper: { sx: { bgcolor: 'var(--surface,#1e2a3a)', border: '1px solid rgba(255,255,255,0.1)' } } }}>
                <MenuItem value=""><em style={{ color: 'rgba(255,255,255,0.3)' }}>{s.gasBotSelNum}</em></MenuItem>
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

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
                {s.gasBotSection}
              </Typography>
            </Divider>

            <TextField label={s.gasBotName} size="small" fullWidth value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} sx={FIELD_SX} />

            <TextField label={s.gasBotPhoneVar} size="small" fullWidth value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} sx={FIELD_SX} />

            <TextField label={s.gasBotSchedule} size="small" fullWidth value={form.schedule}
              helperText={s.gasBotScheduleHint}
              onChange={e => setForm(p => ({ ...p, schedule: e.target.value }))} sx={FIELD_SX} />

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, px: 1 }}>
                {s.gasBotPicture}
              </Typography>
            </Divider>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Avatar src={image || undefined} sx={{ width: 44, height: 44, bgcolor: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.3)' }}>
                <LocalGasStationIcon sx={{ color: '#fb923c', fontSize: 20 }} />
              </Avatar>
              <Button
                onClick={() => fileInputRef.current?.click()}
                startIcon={<PhotoCameraIcon sx={{ fontSize: '17px !important' }} />}
                sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none', fontSize: '0.8rem', borderRadius: 2, border: '1px solid rgba(255,255,255,0.12)', px: 1.5, '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' } }}>
                {image ? s.gasBotPictureChange : s.gasBotPictureBtn}
              </Button>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" hidden onChange={handlePickImage} />
              <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.68rem' }}>{s.gasBotPictureHint}</Typography>
            </Box>

            {sendErr && (
              <Alert severity="error" sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', '& .MuiAlert-icon': { color: '#f87171' }, fontSize: '0.8rem' }}>
                {sendErr}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5, borderTop: '1px solid rgba(255,255,255,0.07)', gap: 1 }}>
        <Button onClick={handleClose} sx={{ color: 'rgba(255,255,255,0.45)', textTransform: 'none', fontSize: '0.82rem', borderRadius: 2, px: 2, transition: 'all 0.15s', '&:hover': { color: '#ffffff', bgcolor: 'rgba(255,255,255,0.1)', } }}>
          {success ? s.gasBotClose : s.gasBotCancel}
        </Button>
        {!success && !loading && !fetchErr && userData && (
          <Button onClick={handleSend} disabled={sending} variant="contained"
            startIcon={sending ? null : <SendIcon sx={{ fontSize: '17px !important' }} />}
            sx={{ bgcolor: '#fb923c', '&:hover': { filter: 'brightness(1.1)' }, textTransform: 'none', fontWeight: 700, fontSize: '0.82rem', borderRadius: 2, px: 2.5 }}>
            {sending ? <CircularProgress size={15} sx={{ color: 'white' }} /> : s.gasBotSend}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
