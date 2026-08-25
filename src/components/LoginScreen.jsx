'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import { keyframes } from '@mui/system'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LockResetIcon from '@mui/icons-material/LockReset'
import { useUser } from '../context/UserContext'
import { T } from '../lib/translations'

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
const glowPulse = keyframes`
  0%,100% { opacity: 0.5; transform: translate(-50%,-50%) scale(1); }
  50%      { opacity: 1;   transform: translate(-50%,-50%) scale(1.15); }
`
const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`
const spinR = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(-360deg); }
`
const statusPulse = keyframes`
  0%,100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(1.35); }
`

/* ── Partículas flotantes ─────────────────────────────────────────────────── */
function Particles() {
  const canvasRef = useRef(null)
  const mouseRef  = useRef({ x: -9999, y: -9999 })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const onMouse = e => { mouseRef.current = { x: e.clientX, y: e.clientY } }
    const onLeave = ()  => { mouseRef.current = { x: -9999,    y: -9999    } }
    window.addEventListener('mousemove',  onMouse)
    window.addEventListener('mouseleave', onLeave)

    const pts = Array.from({ length: 90 }, () => ({
      x:     Math.random() * window.innerWidth,
      y:     Math.random() * window.innerHeight,
      r:     Math.random() * 1.8 + 0.5,
      vx:    (Math.random() - 0.5) * 0.28,
      vy:    (Math.random() - 0.5) * 0.28,
      baseA: Math.random() * 0.5 + 0.15,
      phase: Math.random() * Math.PI * 2,
      freq:  Math.random() * 0.018 + 0.006,
      hue:   Math.random() < 0.62 ? '21,87,245' : Math.random() < 0.75 ? '22,101,52' : '99,102,241',
    }))

    const CONN_SQ   = 130 * 130  // squared threshold — avoids sqrt on most pairs
    const MOUSE_SQ  = 110 * 110
    let frame = 0

    function draw() {
      frame++
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const { x: mx, y: my } = mouseRef.current

      // ① Move + mouse repulsion
      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width)  p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        const dx = p.x - mx; const dy = p.y - my
        const d2 = dx * dx + dy * dy
        if (d2 < MOUSE_SQ && d2 > 0) {
          const d = Math.sqrt(d2)
          const f = (110 - d) / 110 * 0.7
          p.x += (dx / d) * f
          p.y += (dy / d) * f
        }
      })

      // ② Connection lines — check with squared dist, sqrt only when inside range
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x; const dy = pts[i].y - pts[j].y
          const d2 = dx * dx + dy * dy
          if (d2 < CONN_SQ) {
            const d = Math.sqrt(d2)
            ctx.beginPath()
            ctx.moveTo(pts[i].x, pts[i].y)
            ctx.lineTo(pts[j].x, pts[j].y)
            ctx.strokeStyle = `rgba(${pts[i].hue},${(1 - d / 130) * 0.22})`
            ctx.lineWidth = 0.7
            ctx.stroke()
          }
        }
      }

      // ③ Particles — glow + pulsing core
      pts.forEach(p => {
        const a = p.baseA * (0.62 + 0.38 * Math.sin(frame * p.freq + p.phase))
        // outer glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4)
        grd.addColorStop(0, `rgba(${p.hue},${a * 0.7})`)
        grd.addColorStop(1, `rgba(${p.hue},0)`)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()
        // bright core
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${p.hue},${Math.min(a * 1.9, 0.95)})`
        ctx.fill()
      })

      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize',     resize)
      window.removeEventListener('mousemove',  onMouse)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [])
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
}

/* ── Estilos del input ───────────────────────────────────────────────────── */
const INPUT_SX = {
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'rgba(255,255,255,0.13) !important',
    fontSize: '0.92rem',
    borderRadius: '12px',
    transition: 'all 0.2s',
    '& fieldset': { borderColor: 'rgba(255,255,255,0.28) !important', borderRadius: '12px', transition: 'all 0.2s' },
    '&:hover fieldset': { borderColor: 'rgba(21,87,245,0.7) !important' },
    '&.Mui-focused': {
      backgroundColor: 'rgba(21,87,245,0.2) !important',
      '& fieldset': { borderColor: '#4f86f7 !important', borderWidth: 1.5 },
    },
  },
  '& .MuiInputBase-input': { color: '#ffffff !important', WebkitTextFillColor: '#ffffff !important', caretColor: '#ffffff', py: 1.3 },
  '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.42) !important', opacity: '1 !important' },
  '& input': { color: '#ffffff !important', WebkitTextFillColor: '#ffffff !important' },
  '& input::placeholder': { color: 'rgba(255,255,255,0.42) !important', opacity: '1 !important' },
  '& input::-ms-reveal': { display: 'none' },
  '& input::-ms-clear': { display: 'none' },
  '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus': {
    WebkitBoxShadow: '0 0 0px 1000px rgba(10,28,72,0.94) inset',
    WebkitTextFillColor: '#ffffff',
    caretColor: 'white',
    transition: 'background-color 5000s ease-in-out 0s',
  },
  '& .MuiOutlinedInput-root:has(input:-webkit-autofill)': {
    background: 'rgba(255,255,255,0.13) !important',
  },
  '& .MuiOutlinedInput-root:has(input:-webkit-autofill) .MuiInputAdornment-root': {
    background: 'rgba(255,255,255,0.13) !important',
  },
}

function PinField({ value, onChange, placeholder = '••••••', label, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <Box>
      <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{label}</Typography>
      <TextField fullWidth size="small" type={show ? 'text' : 'password'}
        placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 8, inputMode: 'numeric' }, input: { endAdornment: (
          <Box onClick={() => setShow(s => !s)} sx={{ cursor: 'pointer', color: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', pr: 0.5, '&:hover': { color: 'rgba(255,255,255,0.6)' }, transition: 'color 0.15s' }}>
            {show ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
          </Box>
        )}}} autoComplete={autoComplete}
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
  const [lang, setLangState] = useState('es')
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('app_settings') || '{}')
      if (saved.lang) setLangState(saved.lang)
    } catch {}
  }, [])
  const t = T[lang] || T.es
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
      if (!username.trim() || pin.length < 4) { setError(lang === 'en' ? 'Enter your username and PIN' : 'Ingresa tu usuario y PIN'); return }
      setLoading(true)
      try { await login(username.trim(), pin) }
      catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'register') {
      if (!username.trim() || pin.length < 4) { setError(lang === 'en' ? 'Username and PIN min 4 digits' : 'Usuario y PIN mínimo 4 dígitos'); return }
      if (!email.includes('@detucel.mx')) { setError(lang === 'en' ? 'Only @detucel.mx emails allowed' : 'Solo se permiten correos @detucel.mx'); return }
      if (pin !== pin2) { setError(lang === 'en' ? 'PINs do not match' : 'Los PINs no coinciden'); return }
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
      if (!username.trim() || !recoveryCode.trim() || newPin.length < 4) { setError(lang === 'en' ? 'Fill in all fields' : 'Completa todos los campos'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/auth/recover', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), recovery_code: recoveryCode.trim(), new_pin: newPin }),
        })
        if (!res.ok) throw new Error((await res.json()).detail || (lang === 'en' ? 'Invalid code' : 'Código incorrecto'))
        reset('login')
        setError(lang === 'en' ? '✓ PIN updated. Sign in with your new PIN.' : '✓ PIN actualizado. Inicia sesión con tu nuevo PIN.')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'forgot') {
      const fullEmail = resetEmail.trim() + '@detucel.mx'
      if (!resetEmail.trim()) { setError(lang === 'en' ? 'Enter your email' : 'Ingresa tu correo'); return }
      setLoading(true)
      try {
        await fetch('/api/auth/forgot-pin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: fullEmail }),
        })
        setMode('reset_pin')
        setError(lang === 'en' ? '✓ If the email exists, you will receive a code within the next few minutes.' : '✓ Si el correo existe, recibirás un código en los próximos minutos.')
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }

    if (mode === 'reset_pin') {
      if (!resetToken.trim() || newPin.length < 4) { setError(lang === 'en' ? 'Fill in all fields' : 'Completa todos los campos'); return }
      setLoading(true)
      try {
        const res = await fetch('/api/auth/reset-pin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken.trim(), new_pin: newPin }),
        })
        if (!res.ok) throw new Error((await res.json()).detail || (lang === 'en' ? 'Invalid or expired code' : 'Código inválido o expirado'))
        reset('login')
        setError(lang === 'en' ? '✓ PIN updated. Sign in with your new PIN.' : '✓ PIN actualizado. Inicia sesión con tu nuevo PIN.')
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
    <Box data-login="true" sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      bgcolor: '#060f0c',
    }}>
      {/* Gradiente base — capa de profundidad */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          linear-gradient(170deg,
            rgba(10,35,100,0.72) 0%,
            rgba(8,18,38,0.35) 45%,
            rgba(5,32,20,0.65) 100%
          )
        `,
      }} />

      {/* Luces ambientales en esquinas — gradientes anclados al borde, solo se ve la cola suave */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 55% 60% at 0% 0%,   rgba(21,87,245,0.18) 0%, transparent 100%),
          radial-gradient(ellipse 50% 55% at 100% 100%, rgba(22,101,52,0.15) 0%, transparent 100%),
          radial-gradient(ellipse 38% 42% at 100% 0%,  rgba(99,102,241,0.11) 0%, transparent 100%)
        `,
      }} />

      {/* Partículas flotantes */}
      <Particles />

      {/* Glow pulsante detrás del card */}
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%',
        width: 760, height: 640, pointerEvents: 'none',
        background: 'radial-gradient(ellipse, rgba(21,87,245,0.30) 0%, rgba(22,101,52,0.14) 45%, transparent 70%)',
        animation: `${glowPulse} 4s ease-in-out infinite`,
      }} />

      {/* Grid de puntos */}
      <Box sx={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.065) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        maskImage: 'radial-gradient(ellipse 88% 88% at 50% 50%, black 0%, transparent 100%)',
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
          backdropFilter: 'blur(28px)',
          borderRadius: '24px', p: 4,
          boxShadow: '0 32px 80px rgba(0,0,0,0.75)',
          border: '1px solid transparent',
          background: `
            linear-gradient(175deg, rgba(10,28,72,0.94) 0%, rgba(6,22,14,0.94) 100%) padding-box,
            linear-gradient(135deg, rgba(21,87,245,0.5) 0%, rgba(255,255,255,0.05) 50%, rgba(22,101,52,0.4) 100%) border-box
          `,
        }}>

          {/* Logo */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
            {/* Ícono con anillos orbitales */}
            <Box sx={{ position: 'relative', width: 72, height: 72, mb: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Anillo exterior — gira lento */}
              <Box sx={{
                position: 'absolute', inset: -13, borderRadius: '30px',
                border: '1.5px dashed rgba(21,87,245,0.28)',
                animation: `${spin} 14s linear infinite`,
              }} />
              {/* Arco de color en el anillo exterior */}
              <Box sx={{
                position: 'absolute', inset: -13, borderRadius: '30px',
                border: '1.5px solid transparent',
                borderTopColor: 'rgba(21,87,245,0.65)',
                borderRightColor: 'rgba(99,102,241,0.4)',
                animation: `${spin} 14s linear infinite`,
              }} />
              {/* Anillo interior — gira en sentido contrario más rápido */}
              <Box sx={{
                position: 'absolute', inset: -6, borderRadius: '24px',
                border: '1px dashed rgba(99,102,241,0.22)',
                animation: `${spinR} 8s linear infinite`,
              }} />
              {/* Arco de color en el anillo interior */}
              <Box sx={{
                position: 'absolute', inset: -6, borderRadius: '24px',
                border: '1px solid transparent',
                borderBottomColor: 'rgba(22,101,52,0.55)',
                animation: `${spinR} 8s linear infinite`,
              }} />
              {/* Caja del ícono */}
              <Box sx={{
                width: 72, height: 72, borderRadius: '20px',
                background: 'linear-gradient(135deg, rgba(21,87,245,0.22) 0%, rgba(22,101,52,0.15) 100%)',
                border: '1.5px solid rgba(21,87,245,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: `${pulse} 3s ease-in-out infinite`,
                boxShadow: '0 0 0 7px rgba(21,87,245,0.07), 0 0 28px rgba(21,87,245,0.18)',
              }}>
                <FingerprintIcon sx={{ fontSize: 42, color: '#7dd3fc', filter: 'drop-shadow(0 0 8px rgba(96,165,250,0.8)) drop-shadow(0 0 3px rgba(129,140,248,0.5))' }} />
              </Box>
            </Box>
            <Typography sx={{
              fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.02em', lineHeight: 1.1,
              background: 'linear-gradient(135deg, #f1f5f9 20%, #4f86f7 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              Mystery Shopper
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.48)', fontSize: '0.8rem', mt: 0.6, letterSpacing: '0.01em' }}>
              {mode === 'login'     ? t.login.welcome
             : mode === 'register'  ? t.login.register
             : mode === 'recover'   ? t.login.recover
             : mode === 'forgot'    ? (lang === 'en' ? 'Email recovery' : 'Recuperación por correo')
             : mode === 'reset_pin' ? (lang === 'en' ? 'Enter the email code' : 'Ingresa el código del correo')
             :                        t.login.saveCode}
            </Typography>
          </Box>

          {/* Separador */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3.5, mt: -1 }}>
            <Box sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(21,87,245,0.45))' }} />
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'rgba(21,87,245,0.55)', boxShadow: '0 0 8px rgba(21,87,245,0.5)' }} />
            <Box sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(21,87,245,0.45), transparent)' }} />
          </Box>
          {/* ── LOGIN ── */}
          {mode === 'login' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.user}</Typography>
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
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.email}</Typography>
                <TextField fullWidth size="small" placeholder="nombre" autoFocus
                  value={email.replace('@detucel.mx', '')}
                  onChange={e => setEmail(e.target.value.toLowerCase().replace(/\s/g,'').replace('@detucel.mx','') + '@detucel.mx')}
                  autoComplete="email"
                  slotProps={{ input: { endAdornment: (
                    <Box sx={{ color: '#ffffff', fontSize: '0.82rem', whiteSpace: 'nowrap', pr: 0.5 }}>@detucel.mx</Box>
                  )}}}
                  sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.fullName}</Typography>
                <TextField fullWidth size="small" placeholder="Marco Domínguez"
                  value={displayName} onChange={e => setDisplayName(e.target.value)} sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.user}</Typography>
                <TextField fullWidth size="small" placeholder="marco"
                  value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g,''))}
                  autoComplete="username" sx={INPUT_SX} />
              </Box>
              <PinField label={t.login.pin} value={pin} onChange={setPin} autoComplete="new-password" />
              <PinField label={t.login.confirmPin} value={pin2} onChange={setPin2} placeholder="••••••" autoComplete="new-password" />
              {error && <ErrorBox msg={error} />}
              <SubmitBtn loading={loading} label={t.login.createAcc} />
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
                <Typography sx={{ fontSize: '0.75rem', color: '#facc15', fontWeight: 700, mb: 0.5 }}>⚠️ {lang === 'en' ? 'Save this code now' : 'Guarda este código ahora'}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: '#ffffff', lineHeight: 1.5 }}>
                  {lang === 'en' ? <>If you forget your PIN you will need this code. <strong>It will not be shown again.</strong></> : <>Si olvidas tu PIN necesitarás este código. <strong>No se mostrará de nuevo.</strong></>}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, py: 1.2, px: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
                  <Typography sx={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.2em', fontFamily: 'monospace' }}>
                    {savedCode}
                  </Typography>
                </Box>
                <Tooltip title={copied ? (lang === 'en' ? 'Copied!' : '¡Copiado!') : (lang === 'en' ? 'Copy' : 'Copiar')}>
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
                  : <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.92rem' }}>{lang === 'en' ? 'I saved it → Sign in' : 'Ya lo guardé → Entrar'}</Typography>}
              </Box>
            </Box>
          )}

          {/* ── RECUPERAR PIN ── */}
          {mode === 'recover' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.user}</Typography>
                <TextField fullWidth size="small" placeholder={lang === 'en' ? 'your username' : 'tu usuario'} autoFocus value={username} onChange={e => setUsername(e.target.value.toLowerCase())} sx={INPUT_SX} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t.login.recCode}</Typography>
                <TextField fullWidth size="small" placeholder="XXXXXXXXXXXX"
                  value={recoveryCode} onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: '0.1em' } } }} sx={INPUT_SX} />
              </Box>
              <PinField label={t.login.newPin} value={newPin} onChange={setNewPin} placeholder={lang === 'en' ? 'new PIN' : 'nuevo PIN'} autoComplete="new-password" />
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label={t.login.changePin} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography onClick={() => reset('login')} sx={LINK_SX}>{t.login.back}</Typography>
                <Typography onClick={() => reset('forgot')} sx={{ ...LINK_SX, color: '#93c5fd' }}>
                  {lang === 'en' ? 'Receive code by email' : 'Recibir código por email'}
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── OLVIDÉ MI CÓDIGO — pedir email ── */}
          {mode === 'forgot' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.2)' }}>
                <Typography sx={{ fontSize: '0.72rem', color: '#ffffff', lineHeight: 1.5 }}>
                  {lang === 'en'
                    ? <>We will send an 8-character code to your <strong style={{ color: 'rgba(255,255,255,0.65)' }}>@detucel.mx</strong> email. Expires in 15 minutes.</>
                    : <>Te enviaremos un código de 8 caracteres a tu correo <strong style={{ color: 'rgba(255,255,255,0.65)' }}>@detucel.mx</strong>. Expira en 15 minutos.</>}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{lang === 'en' ? 'Email' : 'Correo'}</Typography>
                <TextField fullWidth size="small" placeholder="nombre" autoFocus
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value.toLowerCase().replace(/\s/g, '').replace('@detucel.mx', ''))}
                  slotProps={{ input: { endAdornment: (
                    <Box sx={{ color: '#ffffff', fontSize: '0.82rem', whiteSpace: 'nowrap', pr: 0.5 }}>@detucel.mx</Box>
                  )}}}
                  sx={INPUT_SX} />
              </Box>
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label={lang === 'en' ? 'Send code →' : 'Enviar código →'} />
              <Typography onClick={() => reset('recover')} sx={{ ...LINK_SX, textAlign: 'center', mt: 0.5 }}>
                {t.login.back}
              </Typography>
            </Box>
          )}

          {/* ── INGRESAR CÓDIGO DEL EMAIL + NUEVO PIN ── */}
          {mode === 'reset_pin' && (
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1.8, animation: `${fadeUp} 0.3s ease` }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)' }}>
                <Typography sx={{ fontSize: '0.72rem', color: '#ffffff', lineHeight: 1.5 }}>
                  {lang === 'en' ? 'Check your inbox and paste the 8-character code we sent you.' : 'Revisa tu bandeja de entrada y pega el código de 8 caracteres que te enviamos.'}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.62)', mb: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{lang === 'en' ? 'Email code' : 'Código del correo'}</Typography>
                <TextField fullWidth size="small" placeholder="XXXXXXXX" autoFocus
                  value={resetToken} onChange={e => setResetToken(e.target.value.toUpperCase())}
                  slotProps={{ htmlInput: { style: { fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }, maxLength: 8 } }}
                  sx={INPUT_SX} />
              </Box>
              <PinField label={t.login.newPin} value={newPin} onChange={setNewPin} placeholder={lang === 'en' ? 'new PIN' : 'nuevo PIN'} autoComplete="new-password" />
              {error && <ErrorBox msg={error} success={error.startsWith('✓')} />}
              <SubmitBtn loading={loading} label={`${t.login.changePin} →`} />
              <Typography onClick={() => reset('forgot')} sx={{ ...LINK_SX, textAlign: 'center', mt: 0.5 }}>
                {t.login.back}
              </Typography>
            </Box>
          )}

          {/* Status pill */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3.5 }}>
            <Box sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.7,
              px: 1.4, py: 0.45, borderRadius: '20px',
              bgcolor: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <Box sx={{ position: 'relative', width: 7, height: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Box sx={{ position: 'absolute', width: 7, height: 7, borderRadius: '50%', bgcolor: 'rgba(34,197,94,0.35)', animation: `${statusPulse} 2s ease-in-out infinite` }} />
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#22c55e', position: 'relative', zIndex: 1 }} />
              </Box>
              <Typography sx={{ fontSize: '0.65rem', color: 'rgba(34,197,94,0.85)', fontWeight: 600, letterSpacing: '0.04em' }}>
                {lang === 'en' ? 'System active' : 'Sistema activo'}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Versión debajo del card */}
        <Box sx={{ textAlign: 'center', mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.7 }}>
          <Box component="span" sx={{ display: 'inline-block', width: 4, height: 4, borderRadius: '1px', bgcolor: 'rgba(21,87,245,0.35)', transform: 'rotate(45deg)' }} />
          <Typography component="span" sx={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.68rem' }}>
            Mystery Shopper · DeTuCel © 2026
          </Typography>
          <Box component="span" sx={{ display: 'inline-block', width: 4, height: 4, borderRadius: '1px', bgcolor: 'rgba(21,87,245,0.35)', transform: 'rotate(45deg)' }} />
        </Box>
      </Box>
    </Box>
  )
}

const LINK_SX = {
  fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
  '&:hover': { color: '#4f86f7' }, transition: 'color 0.15s',
}
