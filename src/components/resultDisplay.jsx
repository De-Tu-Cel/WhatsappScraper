'use client'
import { useLang } from '../context/LangContext'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import PhoneIcon from '@mui/icons-material/Phone'
import EmailIcon from '@mui/icons-material/Email'
import BusinessIcon from '@mui/icons-material/Business'
import CategoryIcon from '@mui/icons-material/Category'
import PeopleIcon from '@mui/icons-material/People'
import NotesIcon from '@mui/icons-material/Notes'
import ContactsIcon from '@mui/icons-material/Contacts'
import HandymanIcon from '@mui/icons-material/Handyman'
import InventoryIcon from '@mui/icons-material/Inventory2'
import SendIcon from '@mui/icons-material/Send'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import StoreIcon from '@mui/icons-material/Store'
import PersonIcon from '@mui/icons-material/Person'
import BadgeIcon from '@mui/icons-material/Badge'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import LinkIcon from '@mui/icons-material/Link'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'

// ─── JSON syntax highlight ─────────────────────────────────────────────────────
function JsonHighlight({ data }) {
  const raw = JSON.stringify(data, null, 2)
  const html = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)"(\s*:)/g, '<span style="color:#79b8ff">"$1"</span>$2')
    .replace(/:\s*"([^"]*)"/g, ': <span style="color:#9ecbff">"$1"</span>')
    .replace(/:\s*(-?\d+(\.\d+)?)/g, ': <span style="color:#f8c555">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span style="color:#d2a8ff">$1</span>')
    .replace(/:\s*(null)/g, ': <span style="color:#d2a8ff">$1</span>')
  return (
    <Box component="pre" dangerouslySetInnerHTML={{ __html: html }} sx={{
      bgcolor: 'var(--surface, rgba(0,0,0,0.35))',
      border: '1px solid var(--border, rgba(255,255,255,0.07))',
      borderRadius: 2, p: 2, fontSize: '0.8rem',
      fontFamily: '"Roboto Mono", "Courier New", monospace',
      color: 'var(--text, rgba(255,255,255,0.75))', overflow: 'auto', m: 0,
      whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      scrollbarWidth: 'thin', scrollbarColor: 'var(--border, rgba(255,255,255,0.1)) transparent',
    }} />
  )
}

// ─── Section card ──────────────────────────────────────────────────────────────
function Section({ icon, title, color, children }) {
  return (
    <Card sx={{
      mb: 2,
      overflow: 'hidden',
      position: 'relative',
      background: `linear-gradient(135deg, ${color}0f 0%, transparent 60%)`,
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
    }}>
      {/* brillo radial en esquina */}
      <Box sx={{
        position: 'absolute', top: -30, left: -30,
        width: 120, height: 120, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box sx={{ color, display: 'flex' }}>{icon}</Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'var(--text, rgba(255,255,255,0.85))', fontSize: '0.9rem' }}>
            {title}
          </Typography>
        </Box>
        {children}
      </CardContent>
    </Card>
  )
}

// ─── Info row ──────────────────────────────────────────────────────────────────
function clean(v) { return (!v || v === 'null' || v === 'undefined' || v === 'None') ? null : v }

function InfoRow({ label, value }) {
  const v = clean(value)
  if (!v) return null
  value = v
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.7, borderBottom: '1px solid var(--border)', '&:last-of-type': { borderBottom: 'none' } }}>
      <Typography variant="body2" sx={{ color: 'var(--text-muted, rgba(255,255,255,0.35))', minWidth: 90, flexShrink: 0, fontSize: '0.78rem' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--text, rgba(255,255,255,0.78))', fontSize: '0.82rem' }}>
        {value}
      </Typography>
    </Box>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricCard({ icon, title, value, color }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0.5, py: 2, px: 1,
      borderRadius: 2,
      border: `1px solid ${color}33`,
      borderTop: `3px solid ${color}`,
      overflow: 'hidden',
      position: 'relative',
      background: `linear-gradient(135deg, ${color}12 0%, transparent 65%)`,
    }}>
      <Box sx={{
        position: 'absolute', top: -25, left: -25,
        width: 90, height: 90, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}1a 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <Box sx={{ color, display: 'flex', mb: 0.5, position: 'relative' }}>{icon}</Box>
      <Typography sx={{ color, fontWeight: 700, fontSize: '1.15rem', lineHeight: 1, position: 'relative' }}>{value}</Typography>
      <Typography sx={{ color: 'var(--text-muted, rgba(255,255,255,0.35))', fontSize: '0.68rem', textAlign: 'center', position: 'relative' }}>{title}</Typography>
    </Box>
  )
}

// ─── Contact column ────────────────────────────────────────────────────────────
function ContactColumn({ icon, title, items, color, emptyMsg }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
        <Box sx={{ color }}>{icon}</Box>
        <Typography fontWeight={700} fontSize="0.82rem" sx={{ color: 'var(--text, rgba(255,255,255,0.75))' }}>{title}</Typography>
      </Box>
      {items?.length > 0
        ? items.map((n, i) => (
            <Typography key={`${n}-${i}`} variant="body2" sx={{ py: 0.3, color, fontWeight: 500, textAlign: 'center', fontSize: '0.82rem', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
              {n}
            </Typography>
          ))
        : <Typography variant="body2" sx={{ color: 'var(--text-muted, rgba(255,255,255,0.25))', textAlign: 'center', fontSize: '0.78rem' }}>{emptyMsg}</Typography>
      }
    </Box>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ResultDisplay({ result }) {
  const { t } = useLang()
  const r = t.result
  const s  = result?.scraped || {}
  const sx = s._extra || {}
  const cr = s._contacts_raw || {}
  const totalContacts = (cr.emails?.length || 0) + (cr.phone_numbers?.length || 0)
  const domain = s.domain || s.website?.replace(/https?:\/\/(www\.)?/, '').split('/')[0] || ''
  const contacted = result?.already_contacted

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── BANNER ── */}
      <Box sx={{
        mb: 3, borderRadius: 3, overflow: 'hidden',
        border: '1px solid var(--border)',
        position: 'relative',
      }}>
        {/* fondo degradado */}
        <Box sx={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(139,92,246,0.1) 50%, transparent 100%)',
          zIndex: 0,
        }} />
        {/* brillo superior izquierdo */}
        <Box sx={{
          position: 'absolute', top: -40, left: -40,
          width: 180, height: 180, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)',
          zIndex: 0,
        }} />

        <Box sx={{ position: 'relative', zIndex: 1, p: 3, display: 'flex', alignItems: 'center', gap: 2.5 }}>
          {/* Avatar con favicon */}
          <Box sx={{
            width: 56, height: 56, flexShrink: 0, borderRadius: 2.5,
            bgcolor: 'rgba(99,102,241,0.2)',
            border: '1.5px solid rgba(99,102,241,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            {domain ? (
              <Box
                component="img"
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                alt={s.name || domain}
                sx={{ width: 32, height: 32, objectFit: 'contain' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextSibling.style.display = 'flex'
                }}
              />
            ) : null}
            <Box sx={{
              display: domain ? 'none' : 'flex',
              alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%',
              fontSize: '1.5rem', fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase',
            }}>
              {(s.name || domain || '?')[0]}
            </Box>
          </Box>

          {/* Info principal */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: 'var(--text, white)', fontWeight: 800, fontSize: '1.25rem', lineHeight: 1.2, mb: 0.8 }}>
              {s.name || domain || '—'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
              {s.industry && (
                <Chip label={s.industry} size="small" sx={{ bgcolor: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.7rem', height: 20 }} />
              )}
              {(clean(sx.city) || clean(sx.state)) && (
                <Chip icon={<LocationOnIcon sx={{ fontSize: '11px !important' }} />} label={[clean(sx.city), clean(sx.state)].filter(Boolean).join(', ')} size="small"
                  sx={{ bgcolor: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)', fontSize: '0.7rem', height: 20, '& .MuiChip-icon': { color: '#fb923c' } }} />
              )}
              {domain && (
                <Chip icon={<LinkIcon sx={{ fontSize: '11px !important' }} />} label={domain} size="small" component="a" href={s.website} target="_blank" clickable
                  sx={{ bgcolor: 'var(--surface, rgba(255,255,255,0.06))', color: 'var(--text-muted, rgba(255,255,255,0.4))', border: '1px solid var(--border, rgba(255,255,255,0.1))', fontSize: '0.7rem', height: 20, '& .MuiChip-icon': { color: 'var(--text-muted, rgba(255,255,255,0.3))' }, '&:hover': { bgcolor: 'var(--item-hover, rgba(255,255,255,0.1))', color: 'var(--text, rgba(255,255,255,0.7))' } }} />
              )}
              {contacted?.contacted && (
                <Chip
                  label={`${r.alreadyLabel}${contacted.by_name ? ` ${r.alreadyBy} ${contacted.by_name.split(' ')[0]}` : ''}`}
                  size="small"
                  sx={{ bgcolor: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', fontSize: '0.68rem', height: 20 }}
                />
              )}
            </Box>
          </Box>

          {/* WhatsApp pill */}
          <Box sx={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 1.2,
            px: 2, py: 1.2, borderRadius: 2,
            bgcolor: result.primary_whatsapp_number ? 'rgba(37,211,102,0.12)' : 'var(--item-hover)',
            border: `1px solid ${result.primary_whatsapp_number ? 'rgba(37,211,102,0.3)' : 'var(--border)'}`,
            boxShadow: result.primary_whatsapp_number ? '0 0 16px rgba(37,211,102,0.12)' : 'none',
          }}>
            <WhatsAppIcon sx={{ fontSize: 22, color: result.primary_whatsapp_number ? '#25D366' : 'var(--text-muted, rgba(255,255,255,0.18))' }} />
            <Box>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: result.primary_whatsapp_number ? '#4ade80' : 'var(--text-muted, rgba(255,255,255,0.2))', textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1 }}>
                {result.primary_whatsapp_number ? r.whatsapp : r.noWa}
              </Typography>
              {result.primary_whatsapp_number && (
                <Typography sx={{ fontSize: '0.75rem', color: 'var(--text, rgba(255,255,255,0.6))', mt: 0.2 }}>
                  {result.primary_whatsapp_number}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ── MÉTRICAS ── */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <MetricCard icon={<BusinessIcon sx={{ fontSize: 20 }} />} title={r.company}   value={s.name?.slice(0, 14) || '—'} color="#60a5fa" />
        <MetricCard icon={<CategoryIcon sx={{ fontSize: 20 }} />} title={r.industry}  value={s.industry?.split(' ')[0] || '—'} color="#a78bfa" />
        <MetricCard icon={<WhatsAppIcon sx={{ fontSize: 20 }} />} title={r.whatsapp}  value={result.primary_whatsapp_number ? t.common.yes : t.common.no} color={result.primary_whatsapp_number ? '#4ade80' : '#f87171'} />
        <MetricCard icon={<PeopleIcon sx={{ fontSize: 20 }} />}   title={r.contacts}  value={totalContacts} color="#fb923c" />
      </Box>

      {/* ── DESCRIPCIÓN ── */}
      {s.description && s.description !== r.descNA && (
        <Section icon={<NotesIcon fontSize="small" />} title={r.description} color="#a78bfa">
          <Typography sx={{ color: 'var(--text, rgba(255,255,255,0.6))', fontSize: '0.85rem', lineHeight: 1.7 }}>
            {s.description}
          </Typography>
        </Section>
      )}

      {/* ── CONTACTOS ── */}
      <Section icon={<ContactsIcon fontSize="small" />} title={r.contactInfo} color="#34d399">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 140, p: 1.5, bgcolor: 'rgba(37,211,102,0.06)', borderRadius: 2, border: '1px solid rgba(37,211,102,0.12)' }}>
            <ContactColumn icon={<WhatsAppIcon />} title={r.whatsapp} items={cr.all_whatsapp_numbers} color="#4ade80" emptyMsg={r.notFound} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 140, p: 1.5, bgcolor: 'rgba(59,130,246,0.06)', borderRadius: 2, border: '1px solid rgba(59,130,246,0.12)' }}>
            <ContactColumn icon={<PhoneIcon />} title="Teléfonos" items={cr.phone_numbers?.slice(0, 8)} color="#60a5fa" emptyMsg={r.notFoundPl} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 140, p: 1.5, bgcolor: 'rgba(239,68,68,0.06)', borderRadius: 2, border: '1px solid rgba(239,68,68,0.12)' }}>
            <ContactColumn icon={<EmailIcon />} title="Emails" items={cr.emails?.slice(0, 8)} color="#f87171" emptyMsg={r.notFoundPl} />
          </Box>
        </Box>
      </Section>

      {/* ── UBICACIÓN ── */}
      {(sx.city || sx.state || sx.address || sx.postal_code) && (
        <Section icon={<LocationOnIcon fontSize="small" />} title={r.location} color="#fb923c">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
            <InfoRow label={r.city}       value={sx.city} />
            <InfoRow label={r.state}      value={sx.state} />
            <InfoRow label={r.country}    value={sx.country} />
            <InfoRow label={r.address}    value={sx.address} />
            <InfoRow label={r.postalCode} value={sx.postal_code} />
          </Box>
        </Section>
      )}

      {/* ── DATOS DEL NEGOCIO ── */}
      {(sx.main_activity || sx.business_hours || s.metadata) && (
        <Section icon={<StoreIcon fontSize="small" />} title={r.businessData} color="#38bdf8">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            <InfoRow label={r.activity} value={sx.main_activity} />
            <InfoRow label={r.schedule} value={sx.business_hours} />
            {s.metadata && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {[
                  { label: r.contactForm, val: s.metadata.has_contact_form },
                  { label: r.ecommerce,   val: s.metadata.has_ecommerce },
                ].map(({ label, val }) => (
                  <Chip key={label} size="small"
                    icon={val ? <CheckIcon sx={{ fontSize: '13px !important' }} /> : <CloseIcon sx={{ fontSize: '13px !important' }} />}
                    label={label}
                    sx={{ bgcolor: val ? 'rgba(34,197,94,0.1)' : 'var(--surface, rgba(255,255,255,0.04))', color: val ? '#4ade80' : 'var(--text-muted, rgba(255,255,255,0.35))', border: `1px solid ${val ? 'rgba(34,197,94,0.2)' : 'var(--border, rgba(255,255,255,0.08))'}`, '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                ))}
                {s.metadata.language && (
                  <Chip size="small" label={`${r.language}: ${s.metadata.language}`} sx={{ bgcolor: 'var(--surface, rgba(255,255,255,0.04))', color: 'var(--text-muted, rgba(255,255,255,0.35))', border: '1px solid var(--border, rgba(255,255,255,0.08))' }} />
                )}
              </Box>
            )}
          </Box>
        </Section>
      )}

      {/* ── PERSONAS DE CONTACTO ── */}
      {cr.persons?.length > 0 && (
        <Section icon={<BadgeIcon fontSize="small" />} title={r.contactPersons} color="#c084fc">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {cr.persons.map((p, i) => (
              <Box key={i} sx={{ p: 1.5, bgcolor: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.12)', borderRadius: 1.5, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PersonIcon sx={{ fontSize: 15, color: '#c084fc' }} />
                  <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--text, rgba(255,255,255,0.85))' }}>{p.name}</Typography>
                </Box>
                {p.email && <Typography variant="caption" sx={{ color: '#f87171', ml: 3 }}>{p.email}</Typography>}
                {p.phone && <Typography variant="caption" sx={{ color: '#60a5fa', ml: 3 }}>{p.phone}</Typography>}
              </Box>
            ))}
          </Box>
        </Section>
      )}

      {/* ── SERVICIOS Y PRODUCTOS ── */}
      {(sx.services?.length > 0 || sx.products?.length > 0) && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          {sx.services?.length > 0 && (
            <Box sx={{ flex: 1 }}>
              <Section icon={<HandymanIcon fontSize="small" />} title={r.services} color="#fb923c">
                {sx.services.map((item, i) => (
                  <Typography key={i} variant="body2" sx={{ py: 0.5, color: 'var(--text, rgba(255,255,255,0.6))', fontSize: '0.82rem', borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))', '&:last-of-type': { borderBottom: 'none' } }}>• {item}</Typography>
                ))}
              </Section>
            </Box>
          )}
          {sx.products?.length > 0 && (
            <Box sx={{ flex: 1 }}>
              <Section icon={<InventoryIcon fontSize="small" />} title={r.products} color="#f472b6">
                {sx.products.map((item, i) => (
                  <Typography key={i} variant="body2" sx={{ py: 0.5, color: 'var(--text, rgba(255,255,255,0.6))', fontSize: '0.82rem', borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))', '&:last-of-type': { borderBottom: 'none' } }}>• {item}</Typography>
                ))}
              </Section>
            </Box>
          )}
        </Box>
      )}

      {/* ── ENVÍO WHATSAPP ── */}
      {result.send_result && (
        <Section icon={<SendIcon fontSize="small" />} title={r.sendWhatsapp} color="#25D366">
          <JsonHighlight data={result.send_result} />
        </Section>
      )}

    </Box>
  )
}
