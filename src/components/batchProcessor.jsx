'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TableContainer from '@mui/material/TableContainer'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import SendIcon from '@mui/icons-material/Send'
import DownloadIcon from '@mui/icons-material/Download'
import ListAltIcon from '@mui/icons-material/ListAlt'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import LinkIcon from '@mui/icons-material/Link'
import InboxIcon from '@mui/icons-material/Inbox'

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

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color, bgColor, borderColor }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0,
      display: 'flex', alignItems: 'center', gap: 1.5,
      px: 2, py: 1.5,
      bgcolor: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 2,
    }}>
      <Box sx={{
        width: 32, height: 32, flexShrink: 0,
        bgcolor: `${color}22`,
        border: `1px solid ${color}44`,
        borderRadius: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      py: 6, gap: 1.5,
      border: '1px dashed rgba(255,255,255,0.08)',
      borderRadius: 3,
    }}>
      <Box sx={{
        width: 52, height: 52,
        bgcolor: 'rgba(59,130,246,0.08)',
        border: '1px solid rgba(59,130,246,0.18)',
        borderRadius: 3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <InboxIcon sx={{ color: 'rgba(59,130,246,0.5)', fontSize: 26 }} />
      </Box>
      <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem', fontWeight: 500 }}>
        Sin resultados aún
      </Typography>
      <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.75rem' }}>
        Pega tus URLs arriba y presiona enviar
      </Typography>
    </Box>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BatchProcessor() {
  const [rawUrls,    setRawUrls]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [rows,       setRows]       = useState([])
  const [progress,   setProgress]   = useState(0)
  const [currentUrl, setCurrentUrl] = useState('')
  const [done,       setDone]       = useState(false)

  const placeholder = useTypewriter(EXAMPLES, !rawUrls && !loading)

  const urlList = useMemo(
    () => rawUrls.split('\n').map(u => u.trim()).filter(Boolean),
    [rawUrls]
  )

  async function handleBatch() {
    if (!urlList.length) return
    setRows([]); setProgress(0); setLoading(true); setDone(false)

    const results = []
    for (let i = 0; i < urlList.length; i++) {
      setCurrentUrl(urlList[i])
      setProgress(Math.round((i / urlList.length) * 100))
      try {
        const res = await fetch('/api/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlList[i] }),
        })
        const d = await res.json()
        results.push({
          url:       urlList[i],
          empresa:   d.scraped?.name || '—',
          industria: d.scraped?.industry || '—',
          whatsapp:  d.primary_whatsapp_number || '',
          status_wa: d.send_result?.status_code || '—',
          ok:        true,
        })
      } catch {
        results.push({ url: urlList[i], empresa: '—', industria: '—', whatsapp: '', status_wa: '—', ok: false })
      }
      setRows([...results])
    }
    setProgress(100)
    setCurrentUrl('')
    setLoading(false)
    setDone(true)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'status']
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => h === 'status' ? (r.ok ? 'ok' : 'error') : (r[h] || '')).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_lote.csv'
    a.click()
  }

  const okCount  = rows.filter(r => r.ok).length
  const errCount = rows.filter(r => !r.ok).length
  const waCount  = rows.filter(r => r.whatsapp).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 38, height: 38, flexShrink: 0,
            bgcolor: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ListAltIcon sx={{ color: '#60a5fa', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
              Procesamiento en lote
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
              Pega una URL por línea · máx. 50 URLs
            </Typography>
          </Box>
        </Box>

        {/* Contador de URLs detectadas */}
        {urlList.length > 0 && !loading && (
          <Chip
            icon={<LinkIcon sx={{ fontSize: '14px !important' }} />}
            label={`${urlList.length} URL${urlList.length !== 1 ? 's' : ''}`}
            size="small"
            sx={{
              bgcolor: 'rgba(59,130,246,0.12)',
              color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.25)',
              fontWeight: 600,
              fontSize: '0.72rem',
              height: 24,
              '& .MuiChip-icon': { color: '#60a5fa' },
            }}
          />
        )}
      </Box>

      {/* ── Textarea ── */}
      <Box sx={{ position: 'relative' }}>
        {/* Contador + limpiar — esquina superior derecha */}
        {rawUrls && (
          <Box sx={{
            position: 'absolute', top: 10, right: 10, zIndex: 1,
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.7rem', userSelect: 'none' }}>
              {urlList.length} / 50
            </Typography>
            {!loading && (
              <Tooltip title="Limpiar">
                <IconButton
                  size="small"
                  onClick={() => { setRawUrls(''); setRows([]); setDone(false) }}
                  sx={{ color: 'rgba(255,255,255,0.2)', p: 0.3, '&:hover': { color: 'rgba(255,255,255,0.6)' } }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}

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
            pt: rawUrls ? 3.5 : 2,
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
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.13) transparent',
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.13)', borderRadius: 2 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}
        />

        {/* Hint Ctrl+Enter */}
        {!loading && (
          <Typography variant="caption" sx={{
            position: 'absolute', bottom: 25, right: 54,
            color: 'rgba(255,255,255,0.18)', userSelect: 'none',
          }}>
            Ctrl+Enter
          </Typography>
        )}

        {/* Botón enviar */}
        <IconButton
          onClick={handleBatch}
          disabled={loading || !rawUrls.trim()}
          size="small"
          sx={{
            position: 'absolute', bottom: 20, right: 10,
            bgcolor: rawUrls.trim() && !loading ? '#3b82f6' : 'rgba(59,130,246,0.1)',
            color: rawUrls.trim() && !loading ? 'white' : 'rgba(255,255,255,0.25)',
            width: 36, height: 36,
            transition: 'all 0.2s',
            '&:hover': { bgcolor: rawUrls.trim() && !loading ? '#2563eb' : 'rgba(59,130,246,0.1)' },
            '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.08)', color: 'rgba(255,255,255,0.15)' },
          }}
        >
          {loading
            ? <CircularProgress size={16} sx={{ color: 'inherit' }} />
            : <SendIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>

      {/* ── Progress ── */}
      {loading && (
        <Box sx={{
          px: 2.5, py: 2,
          bgcolor: 'rgba(59,130,246,0.05)',
          border: '1px solid rgba(59,130,246,0.15)',
          borderRadius: 2,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={14} sx={{ color: '#3b82f6' }} />
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                Procesando {rows.length + 1} de {urlList.length}
              </Typography>
            </Box>
            <Typography sx={{ color: '#60a5fa', fontWeight: 700, fontSize: '0.82rem' }}>
              {progress}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              borderRadius: 4, height: 6, bgcolor: 'rgba(59,130,246,0.1)',
              '& .MuiLinearProgress-bar': {
                background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                borderRadius: 4,
              },
            }}
          />
          {currentUrl && (
            <Typography sx={{
              mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {currentUrl}
            </Typography>
          )}
        </Box>
      )}

      {/* ── Stat cards ── */}
      {rows.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <StatCard
            icon={<CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />}
            label="Procesadas"
            value={okCount}
            color="#4ade80"
            bgColor="rgba(34,197,94,0.06)"
            borderColor="rgba(34,197,94,0.18)"
          />
          <StatCard
            icon={<WhatsAppIcon sx={{ fontSize: 16, color: '#60a5fa' }} />}
            label="Con WhatsApp"
            value={waCount}
            color="#60a5fa"
            bgColor="rgba(59,130,246,0.06)"
            borderColor="rgba(59,130,246,0.18)"
          />
          <StatCard
            icon={<ErrorIcon sx={{ fontSize: 16, color: '#f87171' }} />}
            label="Errores"
            value={errCount}
            color="#f87171"
            bgColor="rgba(239,68,68,0.06)"
            borderColor="rgba(239,68,68,0.18)"
          />
        </Box>
      )}

      {/* ── Results ── */}
      {done && rows.length === 0 ? (
        <EmptyState />
      ) : rows.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, minHeight: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: 0.5 }}>
              RESULTADOS
            </Typography>
            {!loading && (
              <Button
                size="small"
                startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                onClick={downloadCsv}
                sx={{
                  color: '#60a5fa', fontSize: '0.75rem',
                  border: '1px solid rgba(59,130,246,0.25)',
                  borderRadius: 1.5, px: 1.5, py: 0.4,
                  '&:hover': { bgcolor: 'rgba(59,130,246,0.08)' },
                }}
              >
                Descargar CSV
              </Button>
            )}
          </Box>

          <TableContainer sx={{
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.07)',
            flexGrow: 1,
            overflow: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.1) transparent',
            '&::-webkit-scrollbar': { width: 4, height: 4 },
            '&::-webkit-scrollbar-button': { display: 'none' },
            '&::-webkit-scrollbar-track': { background: 'transparent', marginBlock: '40px' },
            '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.12)', borderRadius: 2 },
            '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.28)' },
          }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['URL', 'Empresa', 'Industria', 'WhatsApp', 'WA Status', 'Estado'].map(h => (
                    <TableCell key={h} sx={{
                      bgcolor: '#161d2e',
                      color: 'rgba(255,255,255,0.5)',
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      letterSpacing: 0.5,
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i} sx={{
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.025)' },
                    '& td': { borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.8rem' },
                  }}>
                    <TableCell sx={{ maxWidth: 200, color: '#60a5fa' }}>
                      <Typography
                        component="a" href={r.url} target="_blank" rel="noopener"
                        sx={{ fontSize: '0.78rem', color: '#60a5fa', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                      >
                        {r.url.length > 32 ? r.url.slice(0, 32) + '…' : r.url}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{r.empresa}</TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.55)' }}>{r.industria}</TableCell>
                    <TableCell>
                      {r.whatsapp ? (
                        <Chip
                          icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />}
                          label={r.whatsapp}
                          size="small"
                          sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }}
                        />
                      ) : (
                        <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: 'rgba(255,255,255,0.4)' }}>{r.status_wa}</TableCell>
                    <TableCell>
                      {r.ok ? (
                        <Chip label="OK" size="small" icon={<CheckCircleIcon sx={{ fontSize: '12px !important' }} />}
                          sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
                      ) : (
                        <Chip label="Error" size="small" icon={<ErrorIcon sx={{ fontSize: '12px !important' }} />}
                          sx={{ bgcolor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#f87171' } }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : !loading && (
        <EmptyState />
      )}
    </Box>
  )
}
