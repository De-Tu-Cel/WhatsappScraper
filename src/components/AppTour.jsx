'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useLang } from '../context/LangContext'

const Joyride = dynamic(
  () => import('react-joyride').then(mod => ({ default: mod.Joyride })),
  { ssr: false }
)

// navKey gates a step to users who actually have that nav item in their sidebar
// (visibleNavItems already filters admin-only items out for regular users, so
// #tour-nav-instances/#tour-nav-warmup/#tour-nav-admin don't exist in the DOM for
// them — without this gate Joyride would try to spotlight a target that isn't
// there). Steps with no navKey (sidebar, top controls, settings) always show.
const TOUR_STEPS_META = [
  { target: '#tour-sidebar' },
  { target: '#tour-top-controls' },
  { target: '#tour-nav-instances', navKey: 'instances' },
  { target: '#tour-nav-single',    navKey: 'single' },
  { target: '#tour-nav-batch',     navKey: 'batch' },
  { target: '#tour-nav-csv',       navKey: 'csv' },
  { target: '#tour-nav-database',  navKey: 'database' },
  { target: '#tour-nav-search',    navKey: 'search' },
  { target: '#tour-nav-blacklist', navKey: 'blacklist' },
  { target: '#tour-nav-convs',     navKey: 'convs' },
  { target: '#tour-nav-schedule',  navKey: 'schedule' },
  { target: '#tour-nav-campaign',  navKey: 'campaign' },
  { target: '#tour-nav-analytics', navKey: 'analytics' },
  { target: '#tour-nav-warmup',    navKey: 'warmup' },
  { target: '#tour-nav-admin',     navKey: 'admin' },
  { target: '#tour-settings' },
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

function TourTooltip({ step, tooltipProps, primaryProps, backProps, skipProps, isLastStep, index, size, tl }) {
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
      <div style={{ color: '#1e293b', fontSize: '0.84rem', lineHeight: 1.65 }}>
        {step.content}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
        <button {...skipProps} style={{
          background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer',
          color: '#64748b', fontSize: '0.75rem', padding: '4px 10px',
          transition: 'all 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; e.currentTarget.style.borderColor = '#94a3b8' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#cbd5e1' }}
        >
          {tl.skip}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
            {index + 1}/{size}
          </span>
          {index > 0 && (
            <button {...backProps} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#64748b', fontSize: '0.82rem', padding: '6px 10px',
            }}>
              {tl.back}
            </button>
          )}
          <button {...primaryProps} style={{
            backgroundColor: '#1557f5', border: 'none', cursor: 'pointer',
            color: '#ffffff', fontWeight: 700, fontSize: '0.82rem',
            padding: '8px 18px', borderRadius: 10,
            boxShadow: '0 4px 14px rgba(21,87,245,0.4)',
          }}>
            {isLastStep ? tl.finish : tl.next}
          </button>
        </div>
      </div>
    </div>
  )
}


// navigate(key) switches the active tab by nav key (e.g. 'search', 'blacklist')
export default function AppTour({ username, navigate, navKeys }) {
  const [run, setRun] = useState(false)
  const { t } = useLang()
  const tl = t.tour

  // Zip metadata with translated content by original index BEFORE filtering, so
  // step i's content always lines up with TOUR_STEPS_META[i] regardless of which
  // steps get dropped for this user's role.
  const tourMeta = TOUR_STEPS_META
    .map((meta, i) => ({ ...meta, title: tl.steps[i]?.title, content: tl.steps[i]?.content }))
    .filter(meta => !meta.navKey || (navKeys && navKeys.includes(meta.navKey)))

  const tourSteps = tourMeta.map(({ target, title, content }) => ({
    target,
    title,
    content,
    placement:    'right',
    disableBeacon: true,
  }))

  useEffect(() => {
    if (!username) return
    const key = `tour_done_${username}`
    if (!localStorage.getItem(key)) {
      const timer = setTimeout(() => {
        localStorage.setItem(key, '1')
        setRun(true)
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [username])

  function handleCallback({ status, type, index }) {
    if (status === 'finished' || status === 'skipped') {
      localStorage.setItem(`tour_done_${username}`, '1')
      setRun(false)
      return
    }
    if (type === 'step:before') {
      const navKey = tourMeta[index]?.navKey
      if (navKey && navigate && navKeys) {
        const navIndex = navKeys.indexOf(navKey)
        if (navIndex !== -1) navigate(navIndex)
      }
    }
  }

  if (!run) return null

  return (
    <Joyride
      steps={tourSteps}
      run={run}
      continuous
      showSkipButton
      scrollToFirstStep
      spotlightClicks={false}
      disableScrolling
      callback={handleCallback}
      tooltipComponent={(props) => <TourTooltip {...props} tl={tl} />}
      options={JOYRIDE_OPTIONS}
      styles={JOYRIDE_STYLES}
    />
  )
}
