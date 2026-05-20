'use client'
import { useState, useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import SendIcon from '@mui/icons-material/Send'
import DownloadIcon from '@mui/icons-material/Download'

// ── Ejemplos de URLs para la animación typewriter ──────────────
const EXAMPLES = [
  'https://pizzeria-mario.com.mx/\nhttps://ferreteria-sanchez.mx/\nhttps://spa-belleza-queretaro.com/\nhttps://taller-mecanico-hdz.mx/\nhttps://restaurante-oaxaca.com.mx/\nhttps://constructora-garcia.mx/',
  'https://hotel-sierra-madre.com/\nhttps://farmacia-central-gdl.mx/\nhttps://veterinaria-lopez.com.mx/\nhttps://gym-fitness-monterrey.mx/\nhttps://dentista-perez-qro.com/',
  'https://panaderia-flor-de-lis.mx/\nhttps://mecanico-express-cdmx.com/\nhttps://estetica-canina-gdl.mx/\nhttps://plomero-24hrs-mty.com/\nhttps://abogados-garcia-y-soc.mx/',
]

function useTypewriter(strings, active) {
  const [display, setDisplay] = useState('')
  const ref = useRef({ wordIdx: 0, charIdx: 0, deleting: false })

  useEffect(() => {
    if (!active) { setDisplay(''); return }
    let timer

    function tick() {
      const s    = ref.current
      const word = strings[s.wordIdx]
      if (!s.deleting) {
        if (s.charIdx < word.length) {
          const next = s.charIdx + 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 38)
        } else {
          ref.current = { ...s, deleting: true }
          timer = setTimeout(tick, 1600)
        }
      } else {
        if (s.charIdx > 0) {
          const next = s.charIdx - 1
          ref.current = { ...s, charIdx: next }
          setDisplay(word.slice(0, next))
          timer = setTimeout(tick, 22)
        } else {
          ref.current = { wordIdx: (s.wordIdx + 1) % strings.length, charIdx: 0, deleting: false }
          timer = setTimeout(tick, 400)
        }
      }
    }

    timer = setTimeout(tick, 700)
    return () => clearTimeout(timer)
  }, [active, strings])

  return display
}

export default function BatchProcessor() {
  const [rawUrls,  setRawUrls]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [rows,     setRows]     = useState([])
  const [progress, setProgress] = useState(0)
  const [statusMsg,setStatusMsg]= useState('')

  const placeholder = useTypewriter(EXAMPLES, !rawUrls && !loading)

  async function handleBatch() {
    const urls = rawUrls.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setRows([]); setProgress(0); setLoading(true)

    const results = []
    for (let i = 0; i < urls.length; i++) {
      setStatusMsg(`Procesando ${i + 1} de ${urls.length}`)
      setProgress(Math.round((i / urls.length) * 100))
      try {
        const res = await fetch('/api/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i] }),
        })
        const d = await res.json()
        results.push({
          url:       urls[i],
          empresa:   d.scraped?.name || '',
          industria: d.scraped?.industry || '',
          whatsapp:  d.primary_whatsapp_number || '',
          status_wa: d.send_result?.status_code || '—',
          status:    '✅',
        })
      } catch {
        results.push({ url: urls[i], empresa: '', industria: '', whatsapp: '', status_wa: '—', status: '❌' })
      }
      setRows([...results])
    }
    setProgress(100)
    setLoading(false)
    setStatusMsg(`${results.length} URLs procesadas`)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'status']
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => r[h] || '').join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_lote.csv'
    a.click()
  }

  const ok   = rows.filter(r => r.status === '✅').length
  const errs = rows.filter(r => r.status === '❌').length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

      {/* ── TEXTAREA + botón dentro ── */}
      <Box sx={{ position: 'relative' }}>
        <Box
          component="textarea"
          value={rawUrls}
          onChange={e => setRawUrls(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && handleBatch()}
          placeholder={placeholder || ''}
          rows={9}
          disabled={loading}
          sx={{
            width: '100%',
            resize: 'vertical',
            boxSizing: 'border-box',
            bgcolor: '#0d1117',
            color: '#f1f5f9',
            border: '1.5px solid rgba(59,130,246,0.2)',
            borderRadius: '12px',
            p: 2,
            pb: 6,
            pr: 6,
            fontSize: '0.9rem',
            lineHeight: 1.7,
            fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&::placeholder': { color: 'rgba(255,255,255,0.22)' },
            '&:hover': {
              borderColor: 'rgba(59,130,246,0.55)',
              boxShadow: '0 0 0 3px rgba(59,130,246,0.08)',
            },
            '&:focus': {
              borderColor: 'rgba(59,130,246,0.7)',
              boxShadow: '0 0 0 3px rgba(59,130,246,0.12)',
            },
            '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
          }}
        />

        {/* Botón enviar — esquina inferior derecha */}
        <IconButton
          onClick={handleBatch}
          disabled={loading || !rawUrls.trim()}
          size="small"
          sx={{
            position: 'absolute',
            bottom: 20,
            right: 10,
            bgcolor: rawUrls.trim() && !loading ? '#0062ffd8' : 'rgba(59,130,246,0.15)',
            color: rawUrls.trim() && !loading ? 'white' : 'rgba(255,255,255,0.3)',
            width: 36, height: 36,
            transition: 'background-color 0.2s',
            '&:hover': { bgcolor: rawUrls.trim() && !loading ? '#0137ad' : 'rgba(59,130,246,0.15)' },
            '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.1)', color: 'rgba(255,255,255,0.2)' },
          }}
        >
          {loading
            ? <CircularProgress size={16} sx={{ color: 'inherit' }} />
            : <SendIcon sx={{ fontSize: 16 }} />
          }
        </IconButton>

        {/* Hint Ctrl+Enter */}
        {!loading && (
          <Typography
            variant="caption"
            sx={{
              position: 'absolute', bottom: 25, right: 54,
              color: 'rgba(255,255,255,0.18)', userSelect: 'none',
            }}
          >
            Ctrl+Enter
          </Typography>
        )}
      </Box>

      {/* ── PROGRESS ── */}
      {loading && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{statusMsg}</Typography>
            <Typography variant="caption" color="text.secondary">{progress}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {/* ── RESULTS ── */}
      {rows.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {ok} procesadas · {errs} errores
            </Typography>
            {!loading && (
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={downloadCsv}>
                Descargar CSV
              </Button>
            )}
          </Box>
          <Box sx={{ overflowX: 'auto', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['URL', 'Empresa', 'Industria', 'WhatsApp', 'WA Status', ''].map(h => (
                    <TableCell key={h}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</TableCell>
                    <TableCell>{r.empresa}</TableCell>
                    <TableCell>{r.industria}</TableCell>
                    <TableCell>{r.whatsapp}</TableCell>
                    <TableCell>{r.status_wa}</TableCell>
                    <TableCell>{r.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}
    </Box>
  )
}
