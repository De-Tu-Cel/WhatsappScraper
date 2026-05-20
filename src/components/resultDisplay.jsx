'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PhoneIcon from '@mui/icons-material/Phone'
import EmailIcon from '@mui/icons-material/Email'
import BusinessIcon from '@mui/icons-material/Business'
import CategoryIcon from '@mui/icons-material/Category'
import PeopleIcon from '@mui/icons-material/People'
import NotesIcon from '@mui/icons-material/Notes'
import ContactsIcon from '@mui/icons-material/Contacts'
import LanguageIcon from '@mui/icons-material/Language'
import HandymanIcon from '@mui/icons-material/Handyman'
import InventoryIcon from '@mui/icons-material/Inventory2'
import SendIcon from '@mui/icons-material/Send'
import FingerprintIcon from '@mui/icons-material/Fingerprint'

function SectionTitle({ icon, color = '#60a5fa', children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Box sx={{ color, display: 'flex' }}>{icon}</Box>
      <Typography variant="subtitle1" fontWeight={600} color="text.primary">{children}</Typography>
    </Box>
  )
}

function MetricCard({ icon, title, value, color = 'primary.main' }) {
  return (
    <Card>
      <CardContent sx={{ textAlign: 'center' }}>
        <Box sx={{ color, mb: 1 }}>{icon}</Box>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{title}</Typography>
      </CardContent>
    </Card>
  )
}

export default function ResultDisplay({ result }) {
  const s = result?.scraped || {}
  const sx = s._extra || {}
  const cr = s._contacts_raw || {}

  const totalContacts = (cr.emails?.length || 0) + (cr.phone_numbers?.length || 0)

  return (
    <Box>
      <Alert severity="success" sx={{ mb: 3 }}>Proceso completado exitosamente</Alert>

      {/* ── MÉTRICAS ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={3}>
          <MetricCard icon={<BusinessIcon />} title="Empresa"
            value={s.name?.slice(0, 18) || '—'} />
        </Grid>
        <Grid size={3}>
          <MetricCard icon={<CategoryIcon />} title="Industria"
            value={s.industry || '—'} color="secondary.main" />
        </Grid>
        <Grid size={3}>
          <MetricCard icon={<WhatsAppIcon />} title="WhatsApp"
            value={result.primary_whatsapp_number ? 'Sí' : 'No'}
            color="success.main" />
        </Grid>
        <Grid size={3}>
          <MetricCard icon={<PeopleIcon />} title="Contactos"
            value={totalContacts} color="warning.main" />
        </Grid>
      </Grid>

      {/* ── DESCRIPCIÓN ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <SectionTitle icon={<NotesIcon fontSize="small" />} color="#a78bfa">Descripción</SectionTitle>
          <Typography color="text.secondary">{s.description}</Typography>
        </CardContent>
      </Card>

      {/* ── CONTACTOS ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <SectionTitle icon={<ContactsIcon fontSize="small" />} color="#34d399">Información de Contacto</SectionTitle>
          <Grid container spacing={2}>
            {/* WhatsApp */}
            <Grid size={4}>
              <Box sx={{ p: 2, bgcolor: 'rgba(37,211,102,0.08)', borderRadius: 2, border: '1px solid rgba(37,211,102,0.15)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <WhatsAppIcon sx={{ color: '#25D366' }} />
                  <Typography fontWeight={600}>WhatsApp</Typography>
                </Box>
                {cr.all_whatsapp_numbers?.length > 0
                  ? cr.all_whatsapp_numbers.map(n => (
                      <Chip key={n} label={n} size="small" sx={{ m: 0.5, bgcolor: '#25D366', color: 'white' }} />
                    ))
                  : <Typography variant="body2" color="text.secondary">No encontrado</Typography>
                }
              </Box>
            </Grid>
            {/* Teléfonos */}
            <Grid size={4}>
              <Box sx={{ p: 2, bgcolor: 'rgba(59,130,246,0.08)', borderRadius: 2, border: '1px solid rgba(59,130,246,0.15)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <PhoneIcon color="primary" />
                  <Typography fontWeight={600}>Teléfonos</Typography>
                </Box>
                {cr.phone_numbers?.length > 0
                  ? cr.phone_numbers.slice(0, 5).map(n => (
                      <Chip key={n} label={n} size="small" sx={{ m: 0.5 }} />
                    ))
                  : <Typography variant="body2" color="text.secondary">No encontrados</Typography>
                }
              </Box>
            </Grid>
            {/* Emails */}
            <Grid size={4}>
              <Box sx={{ p: 2, bgcolor: 'rgba(239,68,68,0.08)', borderRadius: 2, border: '1px solid rgba(239,68,68,0.15)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <EmailIcon color="error" />
                  <Typography fontWeight={600}>Emails</Typography>
                </Box>
                {cr.emails?.length > 0
                  ? cr.emails.slice(0, 5).map(e => (
                      <Chip key={e} label={e} size="small" sx={{ m: 0.5 }} />
                    ))
                  : <Typography variant="body2" color="text.secondary">No encontrados</Typography>
                }
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* ── REDES SOCIALES ── */}
      {Object.keys(sx.social_media || {}).length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <SectionTitle icon={<LanguageIcon fontSize="small" />} color="#38bdf8">Redes Sociales</SectionTitle>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(sx.social_media).map(([platform, url]) => (
                <Chip
                  key={platform}
                  label={platform.charAt(0).toUpperCase() + platform.slice(1)}
                  component="a"
                  href={url}
                  target="_blank"
                  clickable
                  color="primary"
                  variant="outlined"
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* ── SERVICIOS Y PRODUCTOS ── */}
      {(sx.services?.length > 0 || sx.products?.length > 0) && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {sx.services?.length > 0 && (
            <Grid size={6}>
              <Card>
                <CardContent>
                  <SectionTitle icon={<HandymanIcon fontSize="small" />} color="#fb923c">Servicios</SectionTitle>
                  {sx.services.map((s, i) => (
                    <Typography key={i} variant="body2" sx={{ py: 0.5 }}>• {s}</Typography>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          )}
          {sx.products?.length > 0 && (
            <Grid size={6}>
              <Card>
                <CardContent>
                  <SectionTitle icon={<InventoryIcon fontSize="small" />} color="#f472b6">Productos</SectionTitle>
                  {sx.products.map((p, i) => (
                    <Typography key={i} variant="body2" sx={{ py: 0.5 }}>• {p}</Typography>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      )}

      {/* ── ENVÍO WHATSAPP ── */}
      {result.send_result && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <SectionTitle icon={<SendIcon fontSize="small" />} color="#25D366">Envío WhatsApp</SectionTitle>
            <Box
              component="pre"
              sx={{
                bgcolor: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 2,
                p: 2,
                fontSize: '0.8rem',
                fontFamily: '"Roboto Mono", "Courier New", monospace',
                color: '#86efac',
                overflow: 'auto',
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(result.send_result, null, 2)}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* ── IDs TÉCNICOS ── */}
      <Card>
        <CardContent>
          <SectionTitle icon={<FingerprintIcon fontSize="small" />} color="#94a3b8">IDs Técnicos</SectionTitle>
          <Table size="small">
            <TableBody>
              {[
                ['company_id', result.company_id],
                ['message_log_id', result.message_log_id],
                ['screenshot_evidence_id', result.screenshot_evidence_id],
                ['social_media_id', result.social_media_id],
              ].map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell sx={{ fontWeight: 600, width: 200 }}>{k}</TableCell>
                  <TableCell>{v || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  )
}