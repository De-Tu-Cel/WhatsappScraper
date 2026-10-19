'use client'
import { useEffect, useRef, useState } from 'react'
import { useLang } from '../context/LangContext'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Skeleton from '@mui/material/Skeleton'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
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
import LinkIcon from '@mui/icons-material/Link'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import StarIcon from '@mui/icons-material/Star'
import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import XIcon from '@mui/icons-material/X'
import LinkedInIcon from '@mui/icons-material/LinkedIn'
import YouTubeIcon from '@mui/icons-material/YouTube'
import ShareIcon from '@mui/icons-material/Share'
import CompanyAvatar from './CompanyAvatar'

const SOCIAL = {
  facebook:  { label: 'Facebook',  icon: <FacebookIcon sx={{ fontSize: '14px !important' }} />,  color: '#60a5fa' },
  instagram: { label: 'Instagram', icon: <InstagramIcon sx={{ fontSize: '14px !important' }} />, color: '#f472b6' },
  twitter:   { label: 'X',         icon: <XIcon sx={{ fontSize: '13px !important' }} />,         color: 'var(--text, #e2e8f0)' },
  linkedin:  { label: 'LinkedIn',  icon: <LinkedInIcon sx={{ fontSize: '14px !important' }} />,  color: '#38bdf8' },
  youtube:   { label: 'YouTube',   icon: <YouTubeIcon sx={{ fontSize: '14px !important' }} />,   color: '#f87171' },
}

function ChipGroup({ label, items, color }) {
  if (!items?.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
      <Typography sx={{ fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
        {items.map(it => (
          <Chip key={it} label={it} size="small"
            sx={{ height: 22, fontSize: '0.72rem', bgcolor: `${color}14`, color, border: `1px solid ${color}33` }} />
        ))}
      </Box>
    </Box>
  )
}

function RatingBars({ distribution, votes }) {
  const total = votes || Object.values(distribution || {}).reduce((a, b) => a + (b || 0), 0)
  if (!total) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, minWidth: 150, flex: 1, maxWidth: 260 }}>
      {['5', '4', '3', '2', '1'].map(k => {
        const n = distribution?.[k] || 0
        return (
          <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
            <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted, rgba(255,255,255,0.45))', width: 8, fontVariantNumeric: 'tabular-nums' }}>{k}</Typography>
            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'var(--border, rgba(255,255,255,0.08))', overflow: 'hidden' }}>
              <Box sx={{ width: `${(n / total) * 100}%`, height: '100%', bgcolor: '#fbbf24', borderRadius: 3 }} />
            </Box>
            <Typography sx={{ fontSize: '0.68rem', color: 'var(--text-muted, rgba(255,255,255,0.45))', width: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Loading skeleton — mirrors the real layout below (banner, metrics, ────────
// description, 3-column contact info) so the modal doesn't pop content in with
// a layout shift; shown wherever ResultDisplay's data is still being fetched.
const SKEL = {
  bgcolor: 'var(--item-hover)',
  '&::after': { background: 'linear-gradient(90deg,transparent,rgba(var(--accent-rgb),0.08),transparent)' },
  '@media (prefers-reduced-motion: reduce)': { animation: 'none', '&::after': { animation: 'none' } },
}

export function ResultSkeleton() {
  return <Box aria-hidden="true" sx={{ display: 'grid', gap: 2 }}>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, p: 2.5, border: '1px solid var(--border)', borderRadius: '16px' }}><Skeleton variant="rounded" width={48} height={48} sx={SKEL} /><Box sx={{ flex: '1 1 180px' }}><Skeleton width="40%" height={24} sx={SKEL} /><Skeleton width="65%" height={18} sx={SKEL} /></Box><Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 2, flex: { xs: '1 1 100%', md: '0 1 360px' } }}>{[0,1,2].map(i => <Skeleton key={i} variant="rounded" height={48} sx={SKEL} />)}</Box></Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(380px,1.05fr)' }, gap: 2.5 }}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Box sx={{ p: 2, border: '1px solid var(--border)', borderRadius: '12px' }}><Skeleton width="45%" height={24} sx={SKEL} />{[0,1,2].map(i => <Box key={i} sx={{ mt: 2 }}><Skeleton width="30%" height={18} sx={SKEL} /><Skeleton variant="rounded" height={48} sx={{ ...SKEL, mt: .75 }} /></Box>)}</Box>
        <Skeleton variant="rounded" height={160} sx={SKEL} />
      </Box>
      <Box sx={{ p: 2, border: '1px solid var(--border)', borderRadius: '12px' }}><Skeleton width="55%" height={24} sx={SKEL} /><Skeleton variant="rounded" height={100} sx={{ ...SKEL, mt: 2 }} />{[0,1,2].map(i => <Skeleton key={i} variant="rounded" height={80} sx={{ ...SKEL, mt: 1.5 }} />)}</Box>
    </Box>
  </Box>
}

function ScrollFade({ children, maxHeight, fadeColor, scrollbarColor, deps }) {
  const ref = useRef(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setOverflowing(el.scrollHeight > el.clientHeight + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return (
    <Box sx={{ position: 'relative' }}>
      <Box ref={ref} sx={{ maxHeight, overflowY: 'auto', pr: 0.5,
        '&::-webkit-scrollbar': { width: 0 },
        '&::-webkit-scrollbar-thumb': { borderRadius: 4 },
        '&:hover::-webkit-scrollbar': { width: 4 },
        '&:hover::-webkit-scrollbar-track': { background: 'transparent' },
        '&:hover::-webkit-scrollbar-thumb': { background: scrollbarColor },
      }}>
        {children}
      </Box>
      {overflowing && (
        <Box sx={{
          position: 'absolute', left: 0, right: 8, bottom: 0, height: 28,
          background: `linear-gradient(to bottom, transparent, ${fadeColor})`,
          pointerEvents: 'none',
        }} />
      )}
    </Box>
  )
}

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
      bgcolor: 'var(--card-bg)', backgroundImage: 'none',
      border: '1px solid var(--border)',
    }}>
      {/* brillo radial en esquina */}
      <CardContent sx={{ position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box sx={{ color: 'var(--accent)', display: 'flex' }}>{icon}</Box>
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
      <Typography variant="body2" sx={{ color: 'var(--text, rgba(255,255,255,0.78))', fontSize: '0.82rem', minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Box>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function ContactColumn({ icon, title, items, emptyMsg, contactedNums, lang, verified, columns = false }) {
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState(false)
  const shown = [...new Set(items || [])]
  async function copy(value) {
    try { await navigator.clipboard.writeText(value); setCopied(value); setCopyError(false) }
    catch { setCopyError(true) }
  }
  return <Box sx={{ minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: .7 }}><Box sx={{ color: 'var(--accent)', display: 'flex', '& svg': { fontSize: 18 } }}>{icon}</Box><Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: '.83rem' }}>{title}</Typography><Typography sx={{ color: 'var(--text-muted)', fontSize: '.73rem' }}>{shown.length}</Typography></Box>
    {shown.length ? <Box sx={{ display: 'grid', gridTemplateColumns: columns && shown.length > 1 ? { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' } : 'minmax(0,1fr)', gap: .75, maxHeight: 220, overflowY: 'auto' }}>{shown.map(value => <Box key={value} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: .8, minWidth: 0, border: '1px solid var(--border)', borderRadius: '9px', bgcolor: 'var(--surface)', '&:hover': { bgcolor: 'var(--item-hover)' } }}>
      <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums', fontSize: '.83rem', color: 'var(--text)' }}>{value}</Typography>
      {verified === value && <Chip size="small" label={lang === 'en' ? 'Verified' : 'Verificado'} sx={{ height: 21, fontSize: '.65rem', color: 'var(--text)', bgcolor: 'rgba(34,197,94,.1)' }} />}
      {contactedNums?.has(value) && <Typography sx={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{lang === 'en' ? 'Messaged' : 'Contactado'}</Typography>}
      <Tooltip title={copied === value ? (lang === 'en' ? 'Copied' : 'Copiado') : (lang === 'en' ? 'Copy' : 'Copiar')}><IconButton size="small" aria-label={`${lang === 'en' ? 'Copy' : 'Copiar'} ${value}`} onClick={() => copy(value)} sx={{ color: copied === value ? 'var(--accent)' : 'var(--text-muted)' }}>{copied === value ? <CheckIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
    </Box>)}</Box> : <Typography sx={{ color: 'var(--text-muted)', fontSize: '.78rem', py: .5 }}>{emptyMsg}</Typography>}
    {copyError && <Typography role="alert" sx={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{lang === 'en' ? 'Could not copy. Select the value to copy it manually.' : 'No se pudo copiar. Selecciona el dato para copiarlo manualmente.'}</Typography>}
  </Box>
}

export default function ResultDisplay({ result, aside }) {
  const { t, lang } = useLang()
  const r = t.result
  const s  = result?.scraped || {}
  const sx = s._extra || {}
  const cr = s._contacts_raw || {}
  const totalContacts = new Set([...(cr.all_whatsapp_numbers || []), ...(cr.phone_numbers || []), ...(result.primary_whatsapp_number ? [result.primary_whatsapp_number] : [])].map(number => String(number).replace(/\D/g, ''))).size + new Set(cr.emails || []).size
  const domain = s.domain || s.website?.replace(/https?:\/\/(www\.)?/, '').split('/')[0] || ''
  const contacted = result?.already_contacted

  const completeness = [
    !!result?.primary_whatsapp_number,
    (cr.phone_numbers?.length || 0) > 0,
    (cr.emails?.length || 0) > 0,
    !!s.description,
    !!(sx.city || sx.state),
  ].filter(Boolean).length

  const en = lang === 'en'
  const hasMore = !!(sx.main_activity || sx.business_hours || s.metadata || s.maps_url || s.maps_profile || Object.values(sx.social_media || {}).some(Boolean) || contacted?.contacted || cr.persons?.length || sx.services?.length || sx.products?.length || result.send_result)
  return (
    <Box data-single-result sx={{ minWidth: 0 }}>
      <Box sx={{ p: { xs: 2, md: 2.5 }, mb: 2.5, border: '1px solid var(--border)', borderRadius: '18px', background: 'linear-gradient(110deg,rgba(var(--accent-rgb),.055),transparent 65%),var(--card-bg)', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <CompanyAvatar logoUrl={s.logo_url} photoUrl={s.photo_url} domain={domain} name={s.name} size={48} logoBg={/white|blanco|negativ/i.test(s.logo_url || '') ? '#1e293b' : undefined} />
        <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
          <Typography sx={{ color: 'var(--text)', fontWeight: 800, fontSize: '1.25rem', overflowWrap: 'anywhere' }}>{s.name || domain || '—'}</Typography>
          <Box sx={{ display: 'flex', gap: .75, alignItems: 'center', flexWrap: 'wrap', mt: .75 }}>
            {s.industry && <Chip size="small" label={s.industry} sx={{ height: 24, color: 'var(--accent)', bgcolor: 'rgba(var(--accent-rgb),.09)', fontSize: '.73rem' }} />}
            {(clean(sx.city) || clean(sx.state)) && <Typography sx={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{[clean(sx.city), clean(sx.state)].filter(Boolean).join(', ')}</Typography>}
            {contacted?.contacted && <Chip size="small" label={en ? 'Previously contacted' : 'Ya contactada'} sx={{ height: 24, fontSize: '.7rem', bgcolor: 'var(--item-hover)', color: 'var(--text-muted)' }} />}
          </Box>
        </Box>
        <Box data-single-metrics sx={{ order: { xs: 3, md: 0 }, flex: { xs: '1 1 100%', md: '0 1 auto' }, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', borderTop: { xs: '1px solid var(--border)', md: 0 }, pt: { xs: 1.5, md: 0 } }}>
          {[{ value: `${completeness * 20}%`, label: en ? 'Data completeness' : 'Completitud de datos' }, { value: result.primary_whatsapp_number ? (en ? 'Yes' : 'Sí') : '—', label: en ? 'Verified WhatsApp' : 'WhatsApp verificado' }, { value: totalContacts, label: en ? 'Contact methods' : 'Datos de contacto' }].map((metric,index) => <Box key={metric.label} sx={{ px: { xs: 1, md: 2.5 }, textAlign: 'center', minWidth: 0, borderLeft: index ? '1px solid var(--border)' : 0, maxWidth: { md: 160 } }}><Typography sx={{ fontWeight: 800, color: 'var(--text)', fontSize: '1.25rem', lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>{metric.value}</Typography><Typography sx={{ fontSize: '.72rem', color: 'var(--text-muted)', mt: .6, lineHeight: 1.4 }}>{metric.label}</Typography></Box>)}
        </Box>
        {(s.website || s.maps_url) && <Button component="a" href={s.website || s.maps_url} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />} variant="outlined" sx={{ color: 'var(--accent)', borderColor: 'var(--border)', textTransform: 'none', borderRadius: '10px', fontWeight: 600 }}>{s.website ? (en ? 'Visit website' : 'Visitar sitio') : 'Google Maps'}</Button>}
      </Box>
      <Box data-single-workspace sx={{ display: 'grid', gridTemplateColumns: aside ? { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) minmax(380px,1.05fr)' } : 'minmax(0,1fr)', alignItems: 'start', gap: 2.5 }}>
        <Box data-single-details sx={{ minWidth: 0 }}>
          <Section icon={<ContactsIcon fontSize="small" />} title={r.contactInfo}>
            <Box sx={{ display: 'grid', gap: 2 }}>
              <ContactColumn icon={<WhatsAppIcon />} title="WhatsApp" items={cr.all_whatsapp_numbers?.length ? cr.all_whatsapp_numbers : result.primary_whatsapp_number ? [result.primary_whatsapp_number] : []} emptyMsg={r.notFound} contactedNums={new Set(contacted?.contacted_numbers || [])} lang={lang} verified={result.primary_whatsapp_number} />
              <ContactColumn columns icon={<PhoneIcon />} title={en ? 'Phones' : 'Teléfonos'} items={cr.phone_numbers} emptyMsg={r.notFoundPl} lang={lang} />
              <ContactColumn icon={<EmailIcon />} title={en ? 'Email addresses' : 'Correos'} items={cr.emails} emptyMsg={r.notFoundPl} lang={lang} />
            </Box>
          </Section>
          {(sx.city || sx.state || sx.address || sx.postal_code) && <Section icon={<LocationOnIcon fontSize="small" />} title={r.location}><InfoRow label={r.city} value={sx.city} /><InfoRow label={r.state} value={sx.state} /><InfoRow label={r.country} value={sx.country} /><InfoRow label={r.address} value={sx.address} /><InfoRow label={r.postalCode} value={sx.postal_code} /></Section>}
          {s.description && s.description !== r.descNA && <Section icon={<NotesIcon fontSize="small" />} title={r.description}><Typography sx={{ color: 'var(--text)', fontSize: '.84rem', lineHeight: 1.75, overflowWrap: 'anywhere' }}>{s.description}</Typography></Section>}
          {hasMore && <Box component="details" data-single-more sx={{ border: '1px solid var(--border)', borderRadius: '12px', bgcolor: 'var(--card-bg)', p: 2, '& > summary': { cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, fontSize: '.85rem' }, '&[open] > summary': { mb: 2 }, '& .MuiCard-root': { boxShadow: 'none' } }}><Box component="summary">{en ? 'More business information' : 'Más información del negocio'}</Box>
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
                ].filter(({ val }) => val).map(({ label }) => (
                  <Chip key={label} size="small"
                    icon={<CheckIcon sx={{ fontSize: '13px !important' }} />}
                    label={label}
                    sx={{ bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: 'inherit' } }}
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

      {/* ── PERFIL DE GOOGLE MAPS ── (lo que publica un negocio aunque no tenga sitio web) */}
      {(s.maps_url || s.maps_profile) && (() => {
        const mp = s.maps_profile || {}
        const en = lang === 'en'
        return (
          <Section icon={<LocationOnIcon fontSize="small" />} title={en ? 'Google Maps profile' : 'Perfil de Google Maps'} color="#2dd4bf">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.8 }}>
              <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'center', flexWrap: 'wrap' }}>
                {s.photo_url && (
                  <Box component="img" src={s.photo_url} alt="" referrerPolicy="no-referrer" loading="lazy"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                    sx={{ width: 120, height: 84, objectFit: 'cover', borderRadius: 1.5, flexShrink: 0, border: '1px solid var(--border)' }} />
                )}
                {s.rating ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                      <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text, white)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.rating}</Typography>
                      <StarIcon sx={{ fontSize: 20, color: '#fbbf24' }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.7rem', color: 'var(--text-muted, rgba(255,255,255,0.45))', mt: 0.4 }}>
                      {s.reviews || 0} {en ? 'reviews' : 'reseñas'}
                    </Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: '0.78rem', color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>{en ? 'No reviews yet' : 'Sin reseñas todavía'}</Typography>
                )}
                <RatingBars distribution={mp.rating_distribution} votes={s.reviews} />
              </Box>

              <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                {s.maps_url && (
                  <Chip component="a" href={s.maps_url} target="_blank" clickable size="small" icon={<LinkIcon sx={{ fontSize: '13px !important' }} />}
                    label={en ? 'Open in Google Maps' : 'Ver en Google Maps'}
                    sx={{ height: 22, fontSize: '0.72rem', bgcolor: 'rgba(45,212,191,0.1)', color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.25)', '& .MuiChip-icon': { color: '#2dd4bf' } }} />
                )}
                {mp.book_online_url && (
                  <Chip component="a" href={mp.book_online_url} target="_blank" clickable size="small" label={en ? 'Online booking' : 'Reservar en línea'}
                    sx={{ height: 22, fontSize: '0.72rem', bgcolor: 'rgba(45,212,191,0.1)', color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.25)' }} />
                )}
                {mp.price_level && <Chip size="small" label={`${en ? 'Price' : 'Precio'}: ${mp.price_level}`} sx={{ height: 22, fontSize: '0.72rem' }} />}
                {mp.is_claimed && <Chip size="small" icon={<CheckIcon sx={{ fontSize: '13px !important' }} />} label={en ? 'Owner-verified profile' : 'Perfil verificado por el dueño'}
                  sx={{ height: 22, fontSize: '0.72rem', bgcolor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)', '& .MuiChip-icon': { color: 'inherit' } }} />}
                {mp.total_photos > 0 && <Chip size="small" label={`${mp.total_photos} ${en ? 'photos' : 'fotos'}`} sx={{ height: 22, fontSize: '0.72rem' }} />}
              </Box>

              <ChipGroup label={en ? 'What reviews mention' : 'Lo que mencionan las reseñas'} items={mp.review_topics} color="#fbbf24" />
              <ChipGroup label={en ? 'Payments' : 'Formas de pago'} items={mp.payment_methods} color="#60a5fa" />
              <ChipGroup label={en ? 'Amenities' : 'Comodidades y extras'} items={mp.amenities} color="#a78bfa" />
              {mp.related_businesses?.length > 0 && (
                <InfoRow label={en ? 'People also search' : 'También buscan'} value={mp.related_businesses.join(' · ')} />
              )}
              {!s.maps_profile && (
                <Typography sx={{ fontSize: '0.72rem', color: 'var(--text-muted, rgba(255,255,255,0.45))' }}>
                  {en ? 'Profile details are fetched when the business is processed.' : 'El detalle del perfil se obtiene al procesar el negocio.'}
                </Typography>
              )}
            </Box>
          </Section>
        )
      })()}

      {/* ── REDES SOCIALES ── */}
      {Object.keys(sx.social_media || {}).length > 0 && (
        <Section icon={<ShareIcon fontSize="small" />} title={lang === 'en' ? 'Social media' : 'Redes sociales'} color="#f472b6">
          <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
            {Object.entries(sx.social_media).filter(([, url]) => url).map(([k, url]) => {
              const m = SOCIAL[k] || { label: k.charAt(0).toUpperCase() + k.slice(1), icon: <LinkIcon sx={{ fontSize: '13px !important' }} />, color: '#a5b4fc' }
              return (
                <Chip key={k} component="a" href={url} target="_blank" clickable size="small" icon={m.icon} label={m.label}
                  sx={{ height: 24, fontSize: '0.74rem', color: m.color, bgcolor: 'var(--surface, rgba(255,255,255,0.04))', border: '1px solid var(--border)', '& .MuiChip-icon': { color: m.color } }} />
              )
            })}
          </Box>
        </Section>
      )}

      {/* ── YA CONTACTADA ── */}
      {contacted?.contacted && (
        <Section icon={<CheckCircleIcon fontSize="small" />} title={lang === 'en' ? 'Already contacted' : 'Ya contactada'} color="#fbbf24">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            {contacted.by_name && (
              <InfoRow label={lang === 'en' ? 'By' : 'Por'} value={contacted.by_name} />
            )}
            {contacted.at && (
              <InfoRow
                label={r.contactedAt}
                value={new Date(contacted.at).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              />
            )}
            {contacted.contacted_numbers?.length > 0 && (
              <Box sx={{ mt: 0.2 }}>
                <Typography variant="caption" sx={{ color: 'var(--text-muted, rgba(255,255,255,0.45))', fontSize: '0.67rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5, display: 'block' }}>
                  {lang === 'en' ? 'Numbers messaged' : 'Números contactados'}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                  {contacted.contacted_numbers.map((num, i) => {
                    let disp = num.replace(/^521(\d{10})$/, '52$1')
                    if (!disp.startsWith('+')) disp = '+' + disp
                    return (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                        <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#fbbf24', flexShrink: 0 }} />
                        <Typography variant="caption" sx={{ color: 'var(--text, rgba(255,255,255,0.85))', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                          {disp}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
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
                  {p.role && <Typography variant="caption" sx={{ color: 'var(--text-secondary, rgba(255,255,255,0.5))' }}>· {p.role}</Typography>}
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
                <Box sx={{ maxHeight: 200, overflowY: 'auto', pr: 0.5,
                  '&::-webkit-scrollbar': { width: 0 },
                  '&::-webkit-scrollbar-thumb': { borderRadius: 4 },
                  '&:hover::-webkit-scrollbar': { width: 4 },
                  '&:hover::-webkit-scrollbar-track': { background: 'transparent' },
                  '&:hover::-webkit-scrollbar-thumb': { background: 'rgba(251,146,60,0.4)' },
                }}>
                  {sx.services.map((item, i) => (
                    <Typography key={i} variant="body2" sx={{ py: 0.5, color: 'var(--text, rgba(255,255,255,0.6))', fontSize: '0.82rem', borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))', '&:last-of-type': { borderBottom: 'none' } }}>• {item}</Typography>
                  ))}
                </Box>
              </Section>
            </Box>
          )}
          {sx.products?.length > 0 && (
            <Box sx={{ flex: 1 }}>
              <Section icon={<InventoryIcon fontSize="small" />} title={r.products} color="#f472b6">
                <Box sx={{ maxHeight: 200, overflowY: 'auto', pr: 0.5,
                  '&::-webkit-scrollbar': { width: 0 },
                  '&::-webkit-scrollbar-thumb': { borderRadius: 4 },
                  '&:hover::-webkit-scrollbar': { width: 4 },
                  '&:hover::-webkit-scrollbar-track': { background: 'transparent' },
                  '&:hover::-webkit-scrollbar-thumb': { background: 'rgba(244,114,182,0.4)' },
                }}>
                  {sx.products.map((item, i) => (
                    <Typography key={i} variant="body2" sx={{ py: 0.5, color: 'var(--text, rgba(255,255,255,0.6))', fontSize: '0.82rem', borderBottom: '1px solid var(--border, rgba(255,255,255,0.05))', '&:last-of-type': { borderBottom: 'none' } }}>• {item}</Typography>
                  ))}
                </Box>
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

          </Box>}
        </Box>
        {aside && <Box data-single-send-column sx={{ minWidth: 0, position: { lg: 'sticky' }, top: 8, borderRadius: '16px' }}>{aside}</Box>}
      </Box>
    </Box>
  )
}
