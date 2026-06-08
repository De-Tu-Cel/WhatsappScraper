'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import { keyframes } from '@mui/system'
import StorefrontIcon from '@mui/icons-material/Storefront'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LockResetIcon from '@mui/icons-material/LockReset'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

/* ── Animaciones ─────────────────────────────────────────────────────────── */
const gradientShift = keyframes`
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
`
const pulse = keyframes`
  0%,100% { box-shadow: 0 0 12px rgba(21,87,245,0.2); }
  50%      { box-shadow: 0 0 22px rgba(21,87,245,0.32); }
`
const shimmer = keyframes`
  0%   { transform: translateX(-100%) skewX(-15deg); }
  100% { transform: translateX(250%) skewX(-15deg); }
`
const arrowBounce = keyframes`
  0%,100% { transform: translateX(0); }
  50%      { transform: translateX(5px); }
`

/* ── Estilos del input ───────────────────────────────────────────────────── */
const INPUT_SX = {
  '& .MuiOutlinedInput-root': {
    bgcolor: 'rgba(255,255,255,0.04)',
    fontSize: '0.92rem',
    borderRadius: '12px',
    transition: 'all 0.2s',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', transition: 'all 0.2s' },
    '&:hover fieldset': { borderColor: 'rgba(var(--accent-rgb,59,130,246),0.4)' },
    '&.Mui-focused': {
      bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.05)',
      '& fieldset': { borderColor: 'var(--accent,#3b82f6)', borderWidth: 1.5 },
    },
  },
  '& input': { color: 'white', py: 1.3 },
  '& input::-ms-reveal': { display: 'none' },
  '& input::-ms-clear': { display: 'none' },
  '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus': {
    WebkitBoxShadow: '0 0 0px 1000px rgba(255,255,255,0.04) inset',
    WebkitTextFillColor: 'white',
    caretColor: 'white',
    transition: 'background-color 5000s ease-in-out 0s',
  },
}

function PinField({ value, onChange, placeholder = '••••••', label, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <Box>
      <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</Typography>
      <TextField fullWidth size="small" type={show ? 'text' : 'password'}
        placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 8, inputMode: 'numeric' } }} autoComplete={autoComplete}
        slotProps={{ input: { endAdornment: (
          <Box onClick={() => setShow(s => !s)} sx={{ cursor: 'pointer', color: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', pr: 0.5, '&:hover': { color: 'rgba(255,255,255,0.6)' }, transition: 'color 0.15s' }}>
            {show ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
          </Box>
        )}}}
        sx={INPUT_SX} />
    </Box>
  )
}

function SubmitBtn({ loading, label }) {
  const [hovered, setHovered] = useState(false)
  const isEnter = label.includes('→')
  return (
    <Box component="button" type="submit" disabled={loading}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      sx={{
        mt: 0.5, py: 1.4, borderRadius: '12px', border: 'none',
        cursor: loading ? 'default' : 'pointer', width: '100%',
        background: 'linear-gradient(135deg, #1557f5 0%, #0e2d5c 100%)',
        color: 'white', fontWeight: 700, fontSize: '0.95rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8,
        boxShadow: '0 2px 12px rgba(21,87,245,0.25)',
        transition: 'all 0.2s', opacity: loading ? 0.7 : 1,
        position: 'relative', overflow: 'hidden',
        '&:hover:not(:disabled)': {
          transform: 'translateY(-1px)',
          boxShadow: '0 4px 20px rgba(21,87,245,0.38)',
          background: 'linear-gradient(135deg, #1e6aff 0%, #1045c0 100%)',
        },
        '&:active:not(:disabled)': { transform: 'scale(0.99)' },
      }}>
      {/* Shimmer al hover */}
      {hovered && !loading && (
        <Box sx={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none', overflow: 'hidden', borderRadius: '12px',
          '&::after': {
            content: '""', position: 'absolute', top: 0, width: '40%', height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)',
            animation: `${shimmer} 0.6s ease forwards`,
          },
        }} />
      )}
      {loading
        ? <CircularProgress size={18} sx={{ color: 'white' }} />
        : (
          <>
            <Box component="span">{label.replace(' →','').replace('→','').trim()}</Box>
            {isEnter && (
              <Box component="span" sx={{
                display: 'inline-block',
                animation: hovered ? `${arrowBounce} 0.5s ease infinite` : 'none',
                transition: 'transform 0.2s',
              }}>→</Box>
            )}
          </>
        )}
    </Box>
  )
}

function ErrorBox({ msg, success }) {
  return (
    <Box sx={{
      py: 0.9, px: 1.5, borderRadius: '10px',
      bgcolor: success ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
      border: `1px solid ${success ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.2)'}`,
      animation: `${fadeUp} 0.2s ease`,
    }}>
      <Typography sx={{ color: success ? '#4ade80' : '#f87171', fontSize: '0.78rem', textAlign: 'center' }}>
        {msg}
      </Typography>
    </Box>
  )
}

export default function LoginScreen({ hasUsers }) {
  const { login, register } = useUser()
  const { t } = useLang()
  const [mode,         setMode]         = useState(hasUsers ? 'login' : 'register')
  const [username,     setUsername]     = useState('')
  const [displayName,  setDisplayName]  = useState('')
  const [email,        setEmail]        = useState('')
  const [pin,          setPin]          = useState('')
  const [pin2,         setPin2]         = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPin,       setNewPin]       = useState('')
  const [resetToken,   setResetToken]   = useState('')
  const [resetEmail,   setResetEmail]   = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')
  const [savedCode,    setSavedCode]    = useState('')
  const [copied,       setCopied]       = useState(false)
  const [mounted,      setMounted]      = useState(false)

  useEffect(() => { setTimeout(() => setMounted(true), 50) }, [])

  function reset(newMode) {
    setMode(newMode); setError(''); setPin(''); setPin2('')
    setUsername(''); setDisplayName(''); setEmail(''); setRecoveryCode(''); setNewPin('')
    setResetToken(''); setResetEmail('')
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError('')

    if (mode === 'login') {
      if (!username.trim() || pin.length < 4) { setError('Ingresa tu usuario y PIN'); return }
      setLoading(true)
      try { await login(username.trim(), pin) }
      catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'register') {
      if (!username.trim() || pin.length < 4) { setError('Usuario y PIN mínimo 4 dígitos'); return }
      if (!email.includes('@detucel.mx')) { setError('Solo se permiten correos @detucel.mx'); return }
      if (pin !== pin2) { setError('Los PINs no coinciden'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), display_name: displayName.trim() || username.trim(), pin, email: email.trim() }),
        })
        if (!res.ok) throw new Error((await res.json()).detail || 'Error al registrar')
        const data = await res.json()
        setSavedCode(data.recovery_code || '')
        setMode('show_code')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'recover') {
      if (!username.trim() || !recoveryCode.trim() || newPin.length < 4) { setError('Completa todos los campos'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/auth/recover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), recovery_code: recoveryCode.trim(), new_pin: newPin }),
        })
        if (!res.ok) throw new Error((await res.json()).detail || 'Código incorrecto')
        reset('login')
        setError('✓ PIN actualizado. Inicia sesión con tu nuevo PIN.')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'forgot') {
      const fullEmail = resetEmail.trim() + '@detucel.mx'
      if (!resetEmail.trim()) { setError('Ingresa tu correo'); return }
      setLoading(true)
      try {
        await fetch('/api/auth/forgot-pin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: fullEmail }),
        })
        setMode('reset_pin')
        setError('✓ Si el correo existe, recibirás un código en los próximos minutos.')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'reset_pin') {
      if (!resetToken.trim() || newPin.length < 4) { setError('Completa todos los campos'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/auth/reset-pin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken.trim(), new_pin: newPin }),
        })
        if (!res.ok) throw new Error((await res.json()).detail || 'Código inválido o expirado')
        reset('login')
        setError('✓ PIN actualizado. Inicia sesión con tu nuevo PIN.')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }
  }

  async function handleContinueAfterCode() {
    setLoading(true)
    try { await login(username.trim(), pin) } catch {}
    finally { setLoading(false) }
  }

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      bgcolor: '#060f0c',
    }}>
      {/* Gradiente uniforme de arriba azul hacia abajo verde — sin manchas */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          linear-gradient(170deg,
            rgba(14,45,92,0.55) 0%,
            rgba(10,22,40,0.3) 45%,
            rgba(8,40,26,0.45) 100%
          )
        `,
      }} />

      {/* Brillo central muy sutil detrás de la card */}
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        width: 500, height: 400,
        background: 'radial-gradient(ellipse, rgba(21,87,245,0.07) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      {/* Grid de puntos sutil */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
        maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, black 0%, transparent 100%)',
      }} />

      {/* Card principal */}
      <Box sx={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 400, mx: 2,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(30px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        <Box sx={{
          bgcolor: 'rgba(8,18,34,0.9)',
          backdropFilter: 'blur(24px)',
          borderRadius: '24px', p: 4,
          boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
          border: '1px solid transparent',
          background: `
            linear-gradient(rgba(8,18,34,0.92), rgba(8,18,34,0.92)) padding-box,
            linear-gradient(135deg, rgba(21,87,245,0.4) 0%, rgba(255,255,255,0.06) 50%, rgba(14,45,30,0.3) 100%) border-box
          `,
        }}>

          {/* Logo */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
            <Box sx={{
              width: 72, height: 72, borderRadius: '20px', mb: 2.5,
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb,59,130,246),0.3) 0%, rgba(var(--accent-rgb,59,130,246),0.1) 100%)',
              border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: `${pulse} 3s ease-in-out infinite`,
            }}>
              <StorefrontIcon sx={{ color: 'var(--accent,#60a5fa)', fontSize: 36 }} />
            </Box>
            <Typography sx={{ color: 'white', fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Lector Comercial
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', mt: 0.5 }}>
              {mode === 'login'     ? t.login.welcome
             : mode === 'register'  ? t.login.register
             : mode === 'recover'   ? t.login.recover
             : mode === 'forgot'    ? 'Recuperación por correo'
             : mode === 'reset_pin' ? 'Ingresa el código del correo'
             :                        t.login.saveCode}
            </Typography>
          </Box>

          {/* Separador */}
          <Box sx={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(21,87,245,0.3), rgba(14,45,30,0.3), transparent)', mb: 3.5, mt: -1 }} />

          {/* ── LOGIN ── */}
          {mode === 'login' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.user}</Typography>
                <TextField fullWidth size="small" placeholder="marco.dominguez" autoFocus
                  value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username" sx={INPUT_SX} />
              </Box>
              <PinField label="PIN" value={pin} onChange={setPin} autoComplete="current-password" />
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label={`${t.login.enter} →`} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                {hasUsers && (
                  <Typography onClick={() => reset('register')} sx={LINK_SX}>{t.login.createAcc}</Typography>
                )}
                <Typography onClick={() => reset('recover')} sx={{ ...LINK_SX, ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <LockResetIcon sx={{ fontSize: 13 }} /> {t.login.forgotPin}
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── REGISTRO ── */}
          {mode === 'register' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.email}</Typography>
                <TextField fullWidth size="small" placeholder="nombre" autoFocus
                  value={email.replace('@detucel.mx', '')}
                  onChange={e => setEmail(e.target.value.toLowerCase().replace(/\s/g,'').replace('@detucel.mx','') + '@detucel.mx')}
                  autoComplete="email"
                  slotProps={{ input: { endAdornment: (
                    <Box sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', whiteSpace: 'nowrap', pr: 0.5 }}>@detucel.mx</Box>
                  )}}}
                  sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.fullName}</Typography>
                <TextField fullWidth size="small" placeholder="Marco Domínguez"
                  value={displayName} onChange={e => setDisplayName(e.target.value)} sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.user}</Typography>
                <TextField fullWidth size="small" placeholder="marco"
                  value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g,''))}
                  autoComplete="username" sx={INPUT_SX} />
              </Box>
              <PinField label={t.login.pin} value={pin} onChange={setPin} autoComplete="new-password" />
              <PinField label={t.login.confirmPin} value={pin2} onChange={setPin2} placeholder="••••••" autoComplete="new-password" />
              {error && <ErrorBox msg={error} />}
              <SubmitBtn loading={loading} label="Crear cuenta" />
              {hasUsers && (
                <Typography onClick={() => reset('login')} sx={{ ...LINK_SX, textAlign: 'center', mt: 0.5 }}>
                  {t.login.hasAcc}
                </Typography>
              )}
            </Box>
          )}

          {/* ── CÓDIGO DE RECUPERACIÓN ── */}
          {mode === 'show_code' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, animation: `${fadeUp} 0.3s ease` }}>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)' }}>
                <Typography sx={{ fontSize: '0.75rem', color: '#facc15', fontWeight: 700, mb: 0.5 }}>⚠️ Guarda este código ahora</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  Si olvidas tu PIN necesitarás este código. <strong>No se mostrará de nuevo.</strong>
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, py: 1.2, px: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                  <Typography sx={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.2em', fontFamily: 'monospace' }}>
                    {savedCode}
                  </Typography>
                </Box>
                <Tooltip title={copied ? '¡Copiado!' : 'Copiar'}>
                  <Box onClick={() => { navigator.clipboard.writeText(savedCode); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    sx={{ p: 1.2, borderRadius: 2, cursor: 'pointer', bgcolor: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)', border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`, '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                    <ContentCopyIcon sx={{ fontSize: 18, color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)', display: 'block' }} />
                  </Box>
                </Tooltip>
              </Box>
              <Box onClick={handleContinueAfterCode} sx={{
                py: 1.3, borderRadius: '12px', cursor: 'pointer', textAlign: 'center',
                background: 'linear-gradient(135deg, #1557f5, rgba(21,87,245,0.8))',
                boxShadow: '0 2px 12px rgba(21,87,245,0.25)',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 20px rgba(21,87,245,0.35)' }, transition: 'all 0.2s',
              }}>
                {loading ? <CircularProgress size={18} sx={{ color: 'white' }} />
                  : <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.92rem' }}>Ya lo guardé → Entrar</Typography>}
              </Box>
            </Box>
          )}

          {/* ── RECUPERAR PIN ── */}
          {mode === 'recover' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Usuario</Typography>
                <TextField fullWidth size="small" placeholder="tu usuario" autoFocus value={username} onChange={e => setUsername(e.target.value.toLowerCase())} sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Código de recuperación</Typography>
                <TextField fullWidth size="small" placeholder="XXXXXXXXXXXX"
                  value={recoveryCode} onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: '0.1em' } } }} sx={INPUT_SX} />
              </Box>
              <PinField label="Nuevo PIN" value={newPin} onChange={setNewPin} placeholder="nuevo PIN" autoComplete="new-password" />
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label={t.login.changePin} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography onClick={() => reset('login')} sx={LINK_SX}>{t.login.back}</Typography>
                <Typography onClick={() => reset('forgot')} sx={{ ...LINK_SX, color: 'rgba(96,165,250,0.5)' }}>
                  Recibir código por email
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── OLVIDÉ MI CÓDIGO — pedir email ── */}
          {mode === 'forgot' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.2)' }}>
                <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  Te enviaremos un código de 8 caracteres a tu correo <strong style={{ color: 'rgba(255,255,255,0.65)' }}>@detucel.mx</strong>. Expira en 15 minutos.
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Correo</Typography>
                <TextField fullWidth size="small" placeholder="nombre" autoFocus
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value.toLowerCase().replace(/\s/g, '').replace('@detucel.mx', ''))}
                  slotProps={{ input: { endAdornment: (
                    <Box sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.82rem', whiteSpace: 'nowrap', pr: 0.5 }}>@detucel.mx</Box>
                  )}}}
                  sx={INPUT_SX} />
              </Box>
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label="Enviar código →" />
              <Typography onClick={() => reset('recover')} sx={{ ...LINK_SX, textAlign: 'center', mt: 0.5 }}>
                {t.login.back}
              </Typography>
            </Box>
          )}

          {/* ── INGRESAR CÓDIGO DEL EMAIL + NUEVO PIN ── */}
          {mode === 'reset_pin' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)' }}>
                <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  Revisa tu bandeja de entrada y pega el código de 8 caracteres que te enviamos.
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.4)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Código del correo</Typography>
                <TextField fullWidth size="small" placeholder="XXXXXXXX" autoFocus
                  value={resetToken} onChange={e => setResetToken(e.target.value.toUpperCase())}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }, maxLength: 8 } }}
                  sx={INPUT_SX} />
              </Box>
              <PinField label="Nuevo PIN" value={newPin} onChange={setNewPin} placeholder="nuevo PIN" autoComplete="new-password" />
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label="Cambiar PIN →" />
              <Typography onClick={() => reset('forgot')} sx={{ ...LINK_SX, textAlign: 'center', mt: 0.5 }}>
                {t.login.back}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Versión debajo del card */}
        <Typography sx={{ textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: '0.68rem', mt: 2 }}>
          Lector Comercial · DeTuCel © 2026
        </Typography>
      </Box>
    </Box>
  )
}

const LINK_SX = {
  fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
  '&:hover': { color: 'var(--accent,#60a5fa)' }, transition: 'color 0.15s',
}
