'use client'
import { useState, useRef } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CloseIcon from '@mui/icons-material/Close'

const C = {
  border:     'rgba(255,255,255,0.1)',
  borderHov:  'rgba(59,130,246,0.5)',
  bg:         'rgba(59,130,246,0.04)',
  bgHov:      'rgba(59,130,246,0.08)',
  dimText:    'rgba(255,255,255,0.4)',
  accent:     '#3b82f6',
}

export default function CsvImporter() {
  const inputRef = useRef(null)

  const [dragging, setDragging]   = useState(false)
  const [fileName, setFileName]   = useState('')
  const [columns,  setColumns]    = useState([])
  const [preview,  setPreview]    = useState([])
  const [urlCol,   setUrlCol]     = useState('')
  const [allRows,  setAllRows]    = useState([])
  const [loading,  setLoading]    = useState(false)
  const [results,  setResults]    = useState([])
  const [progress, setProgress]   = useState(0)
  const [statusMsg,setStatusMsg]  = useState('')

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
      setColumns(headers)
      setPreview(rows.slice(0, 5))
      setAllRows(rows)
      setUrlCol(headers[0])
      setResults([])
    }
    reader.readAsText(file)
  }

  function handleInputChange(e) { parseFile(e.target.files?.[0]) }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    parseFile(e.dataTransfer.files?.[0])
  }

  function handleReset() {
    setFileName(''); setColumns([]); setPreview([])
    setAllRows([]); setUrlCol(''); setResults([])
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleProcess() {
    const urls = allRows.map(r => r[urlCol]).filter(Boolean)
    if (!urls.length) return
    setResults([]); setProgress(0); setLoading(true)

    const res = []
    for (let i = 0; i < urls.length; i++) {
      setStatusMsg(`Procesando ${i + 1} de ${urls.length}`)
      setProgress(Math.round((i / urls.length) * 100))
      try {
        const r = await fetch('/api/process-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i] }),
        })
        const d = await r.json()
        res.push({
          url: urls[i],
          empresa:   d.scraped?.name || '',
          industria: d.scraped?.industry || '',
          whatsapp:  d.primary_whatsapp_number || '',
          status_wa: d.send_result?.status_code || '—',
          status: '✅',
        })
      } catch {
        res.push({ url: urls[i], empresa: '', industria: '', whatsapp: '', status_wa: '—', status: '❌' })
      }
      setResults([...res])
    }
    setProgress(100)
    setLoading(false)
  }

  function downloadCsv() {
    const headers = ['url', 'empresa', 'industria', 'whatsapp', 'status_wa', 'status']
    const csv = [headers.join(','), ...results.map(r => headers.map(h => r[h] || '').join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados.csv'
    a.click()
  }

  const hasFile = columns.length > 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>

      {/* ── DROP ZONE ── */}
      {!hasFile ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          sx={{
            width: '100%',
            border: `1.5px dashed ${dragging ? C.borderHov : C.border}`,
            borderRadius: 3,
            bgcolor: dragging ? C.bgHov : C.bg,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 1.5,
            py: 8,
            cursor: 'pointer',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:hover': { borderColor: C.borderHov, bgcolor: C.bgHov },
          }}
        >
          <InsertDriveFileOutlinedIcon sx={{ fontSize: 40, color: C.dimText }} />
          <Typography variant="body1" fontWeight={600} color="text.primary">
            Arrastra tu archivo CSV aquí
          </Typography>
          <Typography variant="body2" color="text.secondary">
            o{' '}
            <Box component="span" sx={{ color: C.accent, cursor: 'pointer' }}>
              elige un archivo
            </Box>
          </Typography>
          <input ref={inputRef} type="file" accept=".csv" hidden onChange={handleInputChange} />
        </Box>
        </Box>
      ) : (
        /* ── FILE LOADED PILL ── */
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2,
          p: 2, borderRadius: 2,
          border: `1px solid rgba(59,130,246,0.2)`,
          bgcolor: 'rgba(59,130,246,0.06)',
        }}>
          <InsertDriveFileOutlinedIcon sx={{ color: C.accent, fontSize: 22 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={600} color="text.primary">{fileName}</Typography>
            <Typography variant="caption" color="text.secondary">{allRows.length} filas detectadas</Typography>
          </Box>
          <Chip
            label="Cambiar archivo"
            size="small"
            variant="outlined"
            onClick={handleReset}
            deleteIcon={<CloseIcon />}
            onDelete={handleReset}
            sx={{ borderColor: C.border, color: C.dimText }}
          />
        </Box>
      )}

      {/* ── COLUMNA + BOTÓN ── */}
      {hasFile && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Columna con URLs</InputLabel>
            <Select
              value={urlCol}
              label="Columna con URLs"
              onChange={e => setUrlCol(e.target.value)}
            >
              {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={handleProcess}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
          >
            {loading ? `${progress}%` : `Procesar ${allRows.length} filas`}
          </Button>
        </Box>
      )}

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

      {/* ── PREVIEW TABLE (before processing) ── */}
      {hasFile && !results.length && !loading && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Vista previa — primeras 5 filas
          </Typography>
          <Box sx={{ overflowX: 'auto', borderRadius: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {columns.map(c => <TableCell key={c}>{c}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map(c => (
                      <TableCell key={c} sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row[c]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}

      {/* ── RESULTS TABLE ── */}
      {results.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {results.filter(r => r.status === '✅').length} procesadas · {results.filter(r => r.status === '❌').length} errores
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
                {results.map((r, i) => (
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
