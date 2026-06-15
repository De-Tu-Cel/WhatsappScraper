'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

const Joyride = dynamic(
  () => import('react-joyride').then(mod => ({ default: mod.Joyride })),
  { ssr: false }
)

const step = (target, title, content) => ({
  target, title, content, placement: 'right', disableBeacon: true,
})

const TOUR_STEPS = [
  step('#tour-sidebar',      '👋 Bienvenido a Mystery Shopper', 'Este es el panel de navegación. Desde aquí accedes a todas las secciones de la app. Puedes colapsarlo para ganar espacio.'),
  step('#tour-nav-single',   '🔗 URL Individual',               'Pega la URL de una empresa para extraer automáticamente su nombre, industria, ciudad y número de WhatsApp.'),
  step('#tour-nav-batch',    '📋 Lote de URLs',                 'Procesa hasta 50 URLs a la vez. Ideal para prospectar varias empresas de una sola vez y enviarles mensajes en bulk.'),
  step('#tour-nav-csv',      '📂 Importar CSV',                 'Sube un archivo CSV con URLs para procesarlas todas automáticamente. Útil cuando tienes listas grandes de prospectos.'),
  step('#tour-nav-database', '🗄️ Base de datos',                'Aquí vive toda tu base de prospectos. Puedes filtrar por industria, ciudad o WhatsApp, seleccionar empresas y enviarles mensajes directamente.'),
  step('#tour-nav-search',   '🔍 Buscar prospectos',            'Busca empresas por industria o tipo de negocio (restaurantes, talleres, dentistas…). La app las encuentra y las agrega a tu base de datos.'),
  step('#tour-nav-convs',    '💬 Conversaciones',               'Ve y responde todos los mensajes de WhatsApp en un solo lugar. Las empresas que te contesten aparecerán aquí organizadas por chat.'),
  step('#tour-nav-analytics','📊 Análisis',                     'Métricas de las respuestas recibidas: cuántas son humanas, cuántas son bots, calidad promedio y tiempo de reacción.'),
]

const JOYRIDE_OPTIONS = {
  zIndex: 10000,
  primaryColor: '#1557f5',
  overlayColor: 'rgba(0,0,0,0.55)',
  spotlightPadding: 6,
}

const JOYRIDE_STYLES = {
  beaconInner: { backgroundColor: '#1557f5' },
  beaconOuter: { backgroundColor: 'rgba(21,87,245,0.25)', border: '2px solid #1557f5' },
}

function TourTooltip({ step, tooltipProps, primaryProps, backProps, skipProps, isLastStep, index, size }) {
  return (
    <div {...tooltipProps} style={{
      backgroundColor: '#ffffff',
      border: '1px solid rgba(21,87,245,0.25)',
      borderRadius: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      padding: '22px 26px',
      maxWidth: 340,
      fontFamily: 'inherit',
    }}>
      {step.title && (
        <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.95rem', marginBottom: 8 }}>
          {step.title}
        </div>
      )}
      <div style={{ color: '#475569', fontSize: '0.84rem', lineHeight: 1.65 }}>
        {step.content}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
        <button {...skipProps} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#94a3b8', fontSize: '0.75rem', padding: '4px 0',
        }}>
          Saltar tour
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
            {index + 1}/{size}
          </span>
          {index > 0 && (
            <button {...backProps} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '0.82rem', padding: '6px 10px',
            }}>
              ← Atrás
            </button>
          )}
          <button {...primaryProps} style={{
            backgroundColor: '#1557f5', border: 'none', cursor: 'pointer',
            color: '#ffffff', fontWeight: 700, fontSize: '0.82rem',
            padding: '8px 18px', borderRadius: 10,
            boxShadow: '0 4px 14px rgba(21,87,245,0.4)',
          }}>
            {isLastStep ? '¡Listo! ✓' : 'Siguiente →'}
          </button>
        </div>
      </div>
    </div>
  )
}


export default function AppTour({ username }) {
  const [run, setRun] = useState(false)

  useEffect(() => {
    if (!username) return
    const key = `tour_done_${username}`
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => {
        localStorage.setItem(key, '1')
        setRun(true)
      }, 800)
      return () => clearTimeout(t)
    }
  }, [username])

  function handleCallback({ status }) {
    if (status === 'finished' || status === 'skipped') {
      localStorage.setItem(`tour_done_${username}`, '1')
      setRun(false)
    }
  }

  if (!run) return null

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      continuous
      showSkipButton
      scrollToFirstStep
      spotlightClicks={false}
      disableScrolling
      callback={handleCallback}
      tooltipComponent={TourTooltip}
      options={JOYRIDE_OPTIONS}
      styles={JOYRIDE_STYLES}
    />
  )
}
