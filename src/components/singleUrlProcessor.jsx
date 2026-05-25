'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import SearchIcon from '@mui/icons-material/Search'
import Skeleton from '@mui/material/Skeleton'
import ResultDisplay from './resultDisplay'

const SKEL = { bgcolor: 'rgba(255,255,255,0.06)', '&::after': { background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)' } }

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
          // finished typing — pause 1.4 s then start deleting
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
          // finished deleting — brief gap then next word
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

function SearchBar({ url, setUrl, onSearch, loading, compact }) {
  const placeholder = useTypewriter(EXAMPLES, !url && !compact)

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      width: compact ? '100%' : { xs: '100%', sm: '620px' },
      bgcolor: '#0d1117',
      borderRadius: '50px',
      boxShadow: compact
        ? '0 2px 8px rgba(0,0,0,0.3)'
        : '0 4px 24px rgba(0,0,0,0.5)',
      border: '1.5px solid rgba(59,130,246,0.2)',
      px: 2.5,
      py: 0.5,
      transition: 'box-shadow 0.2s, border-color 0.2s',
      '&:hover': {
        boxShadow: '0 6px 28px rgba(59,130,246,0.2)',
        borderColor: 'rgba(59,130,246,0.45)',
      },
    }}>
      <TextField
        fullWidth
        variant="standard"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSearch()}
        placeholder={placeholder || 'https://empresa.com.mx/'}
        slotProps={{ input: { disableUnderline: true } }}
        sx={{
          '& input': {
            fontSize: compact ? '0.95rem' : '1.05rem',
            py: 0.8,
            color: '#f1f5f9',
            '&::placeholder': { color: 'rgba(255,255,255,0.3)', opacity: 1 },
          },
          '& .MuiInput-root::before': { display: 'none' },
          '& .MuiInput-root::after':  { display: 'none' },
        }}
      />
      <IconButton
        onClick={onSearch}
        disabled={loading}
        sx={{
          bgcolor: '#3b82f6',
          color: 'white',
          width: 42,
          height: 42,
          flexShrink: 0,
          mr: -1,
          '&:hover': { bgcolor: '#2563eb' },
          '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.3)', color: 'rgba(255,255,255,0.4)' },
        }}
      >
        {loading
          ? <CircularProgress size={20} sx={{ color: 'white' }} />
          : <SearchIcon fontSize="small" />
        }
      </IconButton>
    </Box>
  )
}

export default function SingleUrlProcessor() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const hasResult = result || error

  async function handleProcess() {
    if (!url) return
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/process-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError(`Error al procesar la URL: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  /* ── ESTADO INICIAL: barra centrada ── */
  if (!hasResult && !loading) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        gap: 1,
      }}>
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h4" fontWeight={700} color="text.primary" gutterBottom>
            ¿Que empresa estas buscando hoy?
          </Typography>
        </Box>

        <SearchBar
          url={url}
          setUrl={setUrl}
          onSearch={handleProcess}
          loading={loading}
          compact={false}
        />
      </Box>
    )
  }

  /* ── CON RESULTADO: barra arriba + resultados abajo ── */
  return (
    <Box>
      {/* Barra superior */}
      <Box sx={{
        bgcolor: 'rgba(13,17,23,0.7)',
        borderRadius: 2,
        p: 2,
        mb: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        <SearchBar
          url={url}
          setUrl={setUrl}
          onSearch={handleProcess}
          loading={loading}
          compact={true}
        />
        {loading && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Analizando...
          </Typography>
        )}
      </Box>

      {/* Resultados */}
      <Box sx={{ borderRadius: 3, p: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {loading && <ResultSkeleton />}
        {result && !loading && <ResultDisplay result={result} />}
      </Box>
    </Box>
  )
}
