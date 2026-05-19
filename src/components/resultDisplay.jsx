'use client'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Alert from '@mui/material/Alert'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PhoneIcon from '@mui/icons-material/Phone'
import EmailIcon from '@mui/icons-material/Email'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import BusinessIcon from '@mui/icons-material/Business'
import PeopleIcon from '@mui/icons-material/People'

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
      <Alert severity="success" sx={{ mb: 3 }}>✅ Proceso completado exitosamente</Alert>

      {/* ── MÉTRICAS ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}>
          <MetricCard icon={<BusinessIcon />} title="Empresa"
            value={s.name?.slice(0, 18) || '—'} />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard icon={<BusinessIcon />} title="Industria"
            value={s.industry || '—'} color="secondary.main" />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard icon={<WhatsAppIcon />} title="WhatsApp"
            value={result.primary_whatsapp_number ? '✅ Sí' : '❌ No'}
            color="success.main" />
        </Grid>
        <Grid item xs={6} md={3}>
          <MetricCard icon={<PeopleIcon />} title="Contactos"
            value={totalContacts} color="warning.main" />
        </Grid>
      </Grid>

      {/* ── DESCRIPCIÓN ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>📋 Descripción</Typography>
          <Typography color="text.secondary">{s.description}</Typography>
        </CardContent>
      </Card>

      {/* ── ACTIVIDAD + UBICACIÓN ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>🎯 Actividad Principal</Typography>
              <Typography color="text.secondary">{sx.main_activity || '—'}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>📍 Ubicación</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocationOnIcon color="error" />
                <Typography color="text.secondary">
                  {[sx.city, sx.state, sx.country].filter(Boolean).join(', ') || '—'}
                </Typography>
              </Box>
              {sx.address && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {sx.address}
                </Typography>
              )}
              {sx.business_hours && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  🕐 {sx.business_hours}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── CONTACTOS ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>📞 Información de Contacto</Typography>
          <Grid container spacing={2}>
            {/* WhatsApp */}
            <Grid item xs={12} md={4}>
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
            <Grid item xs={12} md={4}>
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
            <Grid item xs={12} md={4}>
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
            <Typography variant="h6" gutterBottom>🌐 Redes Sociales</Typography>
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
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>🔧 Servicios</Typography>
                  {sx.services.map((s, i) => (
                    <Typography key={i} variant="body2" sx={{ py: 0.5 }}>• {s}</Typography>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          )}
          {sx.products?.length > 0 && (
            <Grid item xs={12} md={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>📦 Productos</Typography>
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
            <Typography variant="h6" gutterBottom>📤 Envío WhatsApp</Typography>
            <Chip
              label={`Status: ${result.send_result.status_code}`}
              color={result.send_result.status_code === 200 ? 'success' : 'error'}
              sx={{ mr: 1 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Enviado a: {result.to_number}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* ── IDs TÉCNICOS ── */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>🔧 IDs Técnicos</Typography>
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