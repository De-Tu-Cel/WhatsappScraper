'use client'
import { useState } from 'react'
import Box from '@mui/material/Box'

// Logo del sitio → foto de Google Maps → favicon del dominio → inicial del
// nombre. Cada imagen que falla al cargar (hotlink bloqueado, URL vencida)
// cae a la siguiente opción. Los logos suelen ser horizontales: en tamaños
// chicos (tablas) conviene no pasar logoUrl y quedarse con foto/favicon.
// logoBg: fondo detrás de un logo (claro por default; uno oscuro para logos blancos).
export default function CompanyAvatar({ logoUrl, photoUrl, domain, name, size = 20, dimmed = false, logoBg }) {
  const sources = [
    logoUrl,
    photoUrl,
    domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null,
  ].filter(Boolean)
  const [idx, setIdx] = useState(0)
  const src = sources[idx]
  const isPhoto = !!src && src === photoUrl

  const frame = {
    width: size, height: size, flexShrink: 0, borderRadius: size >= 28 ? 1.2 : 0.6,
    opacity: dimmed ? 0.45 : 1, overflow: 'hidden',
  }

  if (!src) {
    return (
      <Box sx={{
        ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: 'rgba(var(--accent-rgb, 59,130,246), 0.14)', color: 'var(--accent, #60a5fa)',
        fontSize: size * 0.5, fontWeight: 700, lineHeight: 1,
      }}>
        {(name || '?').trim().charAt(0).toUpperCase()}
      </Box>
    )
  }
  return (
    <Box component="img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={() => setIdx(i => i + 1)}
      sx={{
        ...frame, objectFit: isPhoto ? 'cover' : 'contain',
        bgcolor: src === logoUrl ? (logoBg || 'rgba(255,255,255,0.92)') : 'transparent',
        p: src === logoUrl && size >= 28 ? 0.5 : 0, boxSizing: 'border-box',
      }}
    />
  )
}
