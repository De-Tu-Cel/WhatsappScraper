'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'

// Una línea de texto que no cabe: se desvanece en el borde derecho y, al pasar
// el mouse, se desliza despacio hasta mostrar el final (y regresa al salir).
// Solo se mueve si de verdad está cortada; `title` da además un tooltip con el
// texto completo para quien tiene las animaciones reducidas.
export default function MarqueeText({ children, title, sx }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [overflow, setOverflow] = useState(0)
  const [hover, setHover] = useState(false)

  const measure = () => {
    const outer = outerRef.current, inner = innerRef.current
    if (outer && inner) setOverflow(Math.max(0, inner.scrollWidth - outer.clientWidth))
  }
  useLayoutEffect(measure, [children])

  // ~40px por segundo: lento para leer, sin que un nombre largo tarde una eternidad.
  const duration = Math.min(8, Math.max(1.2, overflow / 40))
  const fade = 'linear-gradient(90deg, #000 calc(100% - 22px), transparent)'

  return (
    <Tooltip title={title || ''} placement="top" arrow disableHoverListener={!title || overflow === 0} enterDelay={600}>
      <Box ref={outerRef}
        onMouseEnter={() => { measure(); setHover(true) }}
        onMouseLeave={() => setHover(false)}
        sx={{
          overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0,
          ...(overflow > 0 && !hover ? { maskImage: fade, WebkitMaskImage: fade } : {}),
          ...sx,
        }}>
        <Box ref={innerRef} component="span" sx={{
          display: 'inline-block',
          transform: hover && overflow > 0 ? `translateX(-${overflow}px)` : 'translateX(0)',
          transition: hover && overflow > 0 ? `transform ${duration}s linear 0.35s` : 'transform 0.35s ease',
          '@media (prefers-reduced-motion: reduce)': { transform: 'none', transition: 'none' },
        }}>
          {children}
        </Box>
      </Box>
    </Tooltip>
  )
}
