'use client'
import Box from '@mui/material/Box'

// Banderas dibujadas a mano (no emoji): en Windows, los emojis de bandera
// muchas veces no tienen glifo real y el sistema cae a mostrar el código de
// país en texto dentro de una caja — se ve roto. Como solo hay 2 idiomas,
// alcanza con 2 SVGs simplificados en vez de agregar una librería de banderas.
const FLAGS = {
  mx: (
    <svg viewBox="0 0 24 16" width="100%" height="100%">
      <rect width="24" height="16" fill="#006847" />
      <rect x="8" width="8" height="16" fill="#fff" />
      <rect x="16" width="8" height="16" fill="#ce1126" />
      <circle cx="12" cy="8" r="2.1" fill="#8b5a2b" />
      <circle cx="12" cy="8" r="1.1" fill="#2f6b2f" />
    </svg>
  ),
  us: (
    <svg viewBox="0 0 24 16" width="100%" height="100%">
      <rect width="24" height="16" fill="#fff" />
      {Array.from({ length: 7 }).map((_, i) => (
        <rect key={i} y={i * (16 / 13) * 2} width="24" height={16 / 13} fill="#B22234" />
      ))}
      <rect width="9.6" height="8.6" fill="#3C3B6E" />
      {Array.from({ length: 2 }).map((_, row) => (
        Array.from({ length: 3 }).map((_, col) => (
          <circle key={`${row}-${col}`} cx={1.8 + col * 3} cy={2 + row * 4.4} r="0.55" fill="#fff" />
        ))
      ))}
    </svg>
  ),
}

export default function FlagIcon({ code, size = 18 }) {
  return (
    <Box sx={{
      width: size, height: size * (16 / 24), flexShrink: 0,
      borderRadius: '2px', overflow: 'hidden',
      boxShadow: '0 0 0 1px rgba(255,255,255,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {FLAGS[code] || null}
    </Box>
  )
}
