'use client'
import { useState, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import TableContainer from '@mui/material/TableContainer'
import TablePagination from '@mui/material/TablePagination'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import StopIcon from '@mui/icons-material/Stop'
import CloseIcon from '@mui/icons-material/Close'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import TableChartIcon from '@mui/icons-material/TableChart'
import LinkIcon from '@mui/icons-material/Link'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

const URL_REGEX = /^https?:\/\//i

const TABLE_HEAD_CELL = {
  bgcolor: '#161d2e',
  color: 'rgba(255,255,255,0.5)',
  fontWeight: 700,
  fontSize: '0.7rem',
  letterSpacing: 0.5,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  whiteSpace: 'nowrap',
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
        <Typography sx={{ color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1.2 }}>{value}</Typography>
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>{label}</Typography>
      </Box>
    </Box>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CsvImporter() {
  const inputRef   = useRef(null)
  const pauseRef   = useRef(false)
  const cancelRef  = useRef(false)

  const [dragging,   setDragging]   = useState(false)
  const [fileName,   setFileName]   = useState('')
  const [urlCol,     setUrlCol]     = useState('')
  const [allUrls,    setAllUrls]    = useState([])
  const [preview,    setPreview]    = useState([])   // [{col, sample}]
  const [loading,    setLoading]    = useState(false)
  const [paused,     setPaused]     = useState(false)
  const [results,    setResults]    = useState([])
  const [progress,   setProgress]   = useState(0)
  const [currentUrl, setCurrentUrl] = useState('')
  const [done,       setDone]       = useState(false)
  const [page,       setPage]       = useState(0)
  const [rowsPerPage,setRowsPerPage]= useState(25)

  function parseFile(file) {
    if (!file || !file.name.endsWith('.csv')) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      const lines = ev.target.result.split('\n').filter(Boolean)
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
      const rows = lines.slice(1).map(line =>
        Object.fromEntries(line.split(',').map((v, i) => [headers[i], v.trim().replace(/"/g, '')]))
      )
      const detected = headers.find(h => rows.some(r => URL_REGEX.test(r[h]))) || ''
      const urls = detected ? rows.map(r => r[detected]).filter(u => URL_REGEX.test(u)) : []
      // Preview: up to 3 columns with sample values
      const cols = headers.slice(0, 4).map(h => ({ col: h, sample: rows.slice(0, 1).map(r => r[h]).join('') }))
      setUrlCol(detected)
      setAllUrls(urls)
      setPreview(cols)
      setResults([])
      setDone(false)
      setPage(0)
    }
    reader.readAsText(file)
  }

  function handleDrop(e) { e.preventDefault(); setDragging(false); parseFile(e.dataTransfer.files?.[0]) }
  function handleInputChange(e) { parseFile(e.target.files?.[0]) }
  function handleReset() {
    setFileName(''); setUrlCol(''); setAllUrls([]); setPreview([])
    setResults([]); setDone(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleProcess() {
    if (!allUrls.length) return
    pauseRef.current  = false
    cancelRef.current = false
    setResults([]); setProgress(0); setLoading(true); setDone(false); setPaused(false); setPage(0)

    const res = []
    for (let i = 0; i < allUrls.length; i++) {
      // Wait while paused
      while (pauseRef.current && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      if (cancelRef.current) break

      setCurrentUrl(allUrls[i])
      setProgress(Math.round((i / allUrls.length) * 100))

      try {
        const r = await fetch('/api/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: allUrls[i] }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = await r.json()
        const duplicate = d.duplicate === true
        res.push({
          url:       allUrls[i],
          empresa:   d.scraped?.name || '—',
          industria: d.scraped?.industry || '—',
          whatsapp:  d.primary_whatsapp_number || '',
          status_wa: d.send_result?.status_code || '—',
          ok:        true,
          duplicate,
        })
      } catch {
        res.push({ url: allUrls[i], empresa: '—', industria: '—', whatsapp: '', status_wa: '—', ok: false, duplicate: false })
      }
      setResults([...res])
    }

    setProgress(100)
    setCurrentUrl('')
    setLoading(false)
    setPaused(false)
    setDone(true)
  }

  function handlePause() {
    pauseRef.current = !pauseRef.current
    setPaused(pauseRef.current)
  }

  function handleCancel() {
    cancelRef.current = true
    pauseRef.current  = false
    setPaused(false)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'estado']
    const csv = [
      headers.join(','),
      ...results.map(r => headers.map(h => {
        if (h === 'estado') return r.duplicate ? 'duplicado' : r.ok ? 'ok' : 'error'
        return r[h] || ''
      }).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_csv.csv'
    a.click()
  }

  const hasFile    = allUrls.length > 0
  const okCount    = results.filter(r => r.ok && !r.duplicate).length
  const errCount   = results.filter(r => !r.ok).length
  const dupCount   = results.filter(r => r.duplicate).length
  const waCount    = results.filter(r => r.whatsapp).length
  const totalPages = Math.ceil(results.length / rowsPerPage)
  const pageRows   = results.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  function rowBg(r) {
    if (!r.ok) return 'rgba(239,68,68,0.07)'
    if (r.duplicate) return 'rgba(251,191,36,0.05)'
    return 'transparent'
  }
  function rowBorder(r) {
    if (!r.ok) return '1px solid rgba(239,68,68,0.15)'
    if (r.duplicate) return '1px solid rgba(251,191,36,0.12)'
    return '1px solid rgba(255,255,255,0.04)'
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, flexShrink: 0,
          bgcolor: 'rgba(59,130,246,0.12)',
          border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <TableChartIcon sx={{ color: '#60a5fa', fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>
            Importar CSV
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>
            Sube un CSV con URLs 
          </Typography>
        </Box>
      </Box>

      {/* ── Drop zone / File pill ── */}
      {!hasFile ? (
        <Box
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          sx={{
            width: '100%', flexGrow: 1, minHeight: 220,
            border: `1.5px dashed ${dragging ? 'rgba(59,130,246,0.7)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 3,
            bgcolor: dragging ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.03)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, cursor: 'pointer',
            transition: 'border-color 0.2s, background-color 0.2s, transform 0.15s',
            transform: dragging ? 'scale(1.01)' : 'scale(1)',
            '&:hover': { borderColor: 'rgba(59,130,246,0.5)', bgcolor: 'rgba(59,130,246,0.06)' },
          }}
        >
          <Box sx={{
            width: 56, height: 56,
            bgcolor: dragging ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.1)',
            border: `1px solid ${dragging ? 'rgba(59,130,246,0.5)' : 'rgba(59,130,246,0.2)'}`,
            borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
          }}>
            <UploadFileIcon sx={{ color: dragging ? '#60a5fa' : 'rgba(59,130,246,0.6)', fontSize: 28, transition: 'color 0.2s' }} />
          </Box>
          <Box sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: '0.9rem' }}>
              {dragging ? 'Suelta aquí tu archivo' : 'Arrastra tu archivo CSV aquí'}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem' }}>
              o{' '}
              <Box component="span" sx={{ color: '#60a5fa', fontWeight: 500 }}>haz clic para seleccionar</Box>
            </Typography>
          </Box>
          <Chip label=".csv" size="small" sx={{ bgcolor: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.7rem', height: 20 }} />
          <input ref={inputRef} type="file" accept=".csv" hidden onChange={handleInputChange} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* File pill */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderRadius: 2, border: '1px solid rgba(59,130,246,0.2)', bgcolor: 'rgba(59,130,246,0.06)' }}>
            <Box sx={{ width: 36, height: 36, flexShrink: 0, bgcolor: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <InsertDriveFileOutlinedIcon sx={{ color: '#60a5fa', fontSize: 18 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.72rem' }}>
                {allUrls.length} URLs detectadas
                
              </Typography>
            </Box>
            <Tooltip title="Quitar archivo">
              <IconButton size="small" onClick={handleReset} sx={{ color: 'rgba(255,255,255,0.3)', '&:hover': { color: 'rgba(255,255,255,0.7)' } }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* No URL column warning */}
          {!urlCol && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 1.5 }}>
              <WarningAmberIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
              <Typography sx={{ color: '#fbbf24', fontSize: '0.75rem' }}>
                No se detectó ninguna columna con URLs válidas
              </Typography>
            </Box>
          )}

          {/* Controls row */}
          {!loading ? (
            <Button
              fullWidth
              variant="contained"
              onClick={handleProcess}
              disabled={!urlCol || !allUrls.length}
              startIcon={<PlayArrowIcon sx={{ fontSize: 38 }} />}
              sx={{
                bgcolor: '#3b82f6', fontWeight: 600, fontSize: '0.95rem',
                py: 1.2, textTransform: 'none', borderRadius: 1.5,
                '&:hover': { bgcolor: '#2563eb' },
                '&.Mui-disabled': { bgcolor: 'rgba(59,130,246,0.2)', color: 'rgba(255,255,255,0.3)' },
              }}
            >
              Procesar {allUrls.length} URLs
            </Button>
          ) : (
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Button
                fullWidth
                onClick={handlePause}
                startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
                sx={{
                  flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem',
                  color: '#fbbf24', bgcolor: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(251,191,36,0.15)', borderColor: 'rgba(251,191,36,0.45)' },
                }}
              >
                {paused ? 'Reanudar' : 'Pausar'}
              </Button>
              <Button
                fullWidth
                onClick={handleCancel}
                startIcon={<StopIcon />}
                sx={{
                  flex: 1, py: 1, textTransform: 'none', fontWeight: 600, fontSize: '0.88rem',
                  color: '#f87171', bgcolor: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)', borderRadius: 1.5,
                  '&:hover': { bgcolor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)' },
                }}
              >
                Cancelar
              </Button>
            </Box>
          )}
        </Box>
      )}

      {/* ── Progress card ── */}
      {loading && (
        <Box sx={{ px: 2.5, py: 2, bgcolor: paused ? 'rgba(251,191,36,0.05)' : 'rgba(59,130,246,0.05)', border: `1px solid ${paused ? 'rgba(251,191,36,0.2)' : 'rgba(59,130,246,0.15)'}`, borderRadius: 2, transition: 'all 0.3s' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {paused
                ? <PauseIcon sx={{ fontSize: 14, color: '#fbbf24' }} />
                : <CircularProgress size={14} sx={{ color: '#3b82f6' }} />
              }
              <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                {paused ? 'Pausado —' : 'Procesando'} {results.length} de {allUrls.length}
              </Typography>
            </Box>
            <Typography sx={{ color: paused ? '#fbbf24' : '#60a5fa', fontWeight: 700, fontSize: '0.82rem' }}>
              {progress}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              borderRadius: 4, height: 6,
              bgcolor: paused ? 'rgba(251,191,36,0.1)' : 'rgba(59,130,246,0.1)',
              '& .MuiLinearProgress-bar': {
                background: paused
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                borderRadius: 4,
              },
            }}
          />
          {currentUrl && !paused && (
            <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.28)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentUrl}
            </Typography>
          )}
        </Box>
      )}

      {/* ── Stat cards ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <StatCard icon={<CheckCircleIcon sx={{ fontSize: 16, color: '#4ade80' }} />} label="Procesadas" value={okCount} color="#4ade80" bgColor="rgba(34,197,94,0.06)" borderColor="rgba(34,197,94,0.18)" />
          <StatCard icon={<WhatsAppIcon sx={{ fontSize: 16, color: '#60a5fa' }} />} label="Con WhatsApp" value={waCount} color="#60a5fa" bgColor="rgba(59,130,246,0.06)" borderColor="rgba(59,130,246,0.18)" />
          <StatCard icon={<WarningAmberIcon sx={{ fontSize: 16, color: '#fbbf24' }} />} label="Duplicados" value={dupCount} color="#fbbf24" bgColor="rgba(251,191,36,0.06)" borderColor="rgba(251,191,36,0.18)" />
          <StatCard icon={<ErrorIcon sx={{ fontSize: 16, color: '#f87171' }} />} label="Errores" value={errCount} color="#f87171" bgColor="rgba(239,68,68,0.06)" borderColor="rgba(239,68,68,0.18)" />
        </Box>
      )}

      {/* ── Results table ── */}
      {results.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexGrow: 1, minHeight: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem', fontWeight: 600, letterSpacing: 0.5 }}>
              RESULTADOS
            </Typography>
            {!loading && (
              <Button
                size="small"
                startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                onClick={downloadCsv}
                sx={{ color: '#60a5fa', fontSize: '0.75rem', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 1.5, px: 1.5, py: 0.4, textTransform: 'none', '&:hover': { bgcolor: 'rgba(59,130,246,0.08)' } }}
              >
                Descargar CSV
              </Button>
            )}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
            <TableContainer sx={{
              flexGrow: 1, height: 0, overflow: 'auto',
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
                      <TableCell key={h} sx={TABLE_HEAD_CELL}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageRows.map((r, i) => (
                    <TableRow key={i} sx={{ bgcolor: rowBg(r), '& td': { borderBottom: rowBorder(r) } }}>
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography component="a" href={r.url} target="_blank" rel="noopener"
                          sx={{ fontSize: '0.78rem', color: r.ok ? '#60a5fa' : '#f87171', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                          {r.url.length > 32 ? r.url.slice(0, 32) + '…' : r.url}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.8)', fontWeight: 500, fontSize: '0.8rem' }}>{r.empresa}</TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem' }}>{r.industria}</TableCell>
                      <TableCell>
                        {r.whatsapp ? (
                          <Chip icon={<WhatsAppIcon sx={{ fontSize: '12px !important' }} />} label={r.whatsapp} size="small"
                            sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#4ade80' } }} />
                        ) : (
                          <Typography sx={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.78rem' }}>—</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>{r.status_wa}</TableCell>
                      <TableCell>
                        {r.duplicate ? (
                          <Chip label="Duplicado" size="small" icon={<WarningAmberIcon sx={{ fontSize: '12px !important' }} />}
                            sx={{ bgcolor: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', height: 20, fontSize: '0.68rem', '& .MuiChip-icon': { color: '#fbbf24' } }} />
                        ) : r.ok ? (
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

            <TablePagination
              rowsPerPageOptions={[25, 50, 100]}
              component="div"
              count={results.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
              labelRowsPerPage="Filas por página:"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              sx={{
                color: 'rgba(255,255,255,0.5)',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                flexShrink: 0,
                '& .MuiTablePagination-toolbar': { minHeight: 48 },
                '& .MuiTablePagination-selectIcon': { color: 'rgba(255,255,255,0.4)' },
                '& .MuiIconButton-root': { color: 'rgba(255,255,255,0.4)' },
                '& .Mui-disabled': { opacity: 0.3 },
                '& .MuiSelect-select': { color: 'rgba(255,255,255,0.6)' },
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  )
}
