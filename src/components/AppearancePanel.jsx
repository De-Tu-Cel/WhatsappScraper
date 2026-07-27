'use client'
import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import PaletteIcon from '@mui/icons-material/Palette'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useLang } from '../context/LangContext'
import { ACCENTS, THEMES, loadSettings, applySettings } from './Settings'

// A bordered card with its label shown as a pill overlapping the top edge —
// the info icon's tooltip explains what the section controls on hover.
function SectionBox({ label, hint, children, sx }) {
  return (
    <Box sx={{
      position: 'relative', mt: 1.6,
      border: '1px solid var(--border, rgba(255,255,255,0.1))',
      borderRadius: 3, pt: 2.4, pb: 1.8, px: 1.6,
      ...sx,
    }}>
      <Box sx={{
        position: 'absolute', top: -12, left: 12,
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        bgcolor: 'var(--card-bg, #161d2e)',
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        borderRadius: 999, px: 1.2, py: 0.35,
      }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text, #f1f5f9)', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        {hint && (
          <Tooltip title={hint} arrow placement="top">
            <InfoOutlinedIcon sx={{ fontSize: 13, color: 'var(--text-muted, rgba(255,255,255,0.4))', cursor: 'help' }} />
          </Tooltip>
        )}
      </Box>
      {children}
    </Box>
  )
}

const SUB_LABEL_SX = {
  fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted, rgba(255,255,255,0.4))', mb: 1, display: 'flex', alignItems: 'center', gap: 0.5,
}

// Visual-only settings (base theme + accent color), pulled out of the full
// Settings page into their own slide-in panel — opens on the right, opposite
// the left Sidebar, so it's reachable from anywhere without leaving the tab
// the user is on.
export default function AppearancePanel({ open, onClose }) {
  const { t } = useLang()
  const [settings, setSettings] = useState(null)

  useEffect(() => { setSettings(loadSettings()) }, [])

  function save(patch) {
    setSettings(prev => {
      const base = prev || loadSettings()
      const next = { ...base, ...patch }
      if (patch.theme === 'detucel') next.accent = '#1557f5'
      localStorage.setItem('app_settings', JSON.stringify(next))
      applySettings(next)
      return next
    })
  }

  const darkThemes  = THEMES.filter(th => !th.cat || th.cat === 'dark')
  const lightThemes = THEMES.filter(th => th.cat === 'light' || th.cat === 'mono')

  return (
    <Box sx={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: open ? 'min(340px, 60%)' : 0,
      overflow: 'hidden',
      transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      borderLeft: open ? '1px solid var(--border, rgba(255,255,255,0.08))' : 'none',
      display: 'flex', flexDirection: 'column',
      bgcolor: 'var(--sidebar-bg, #0d1117)',
      zIndex: 5,
    }}>
      {open && settings && (
        <Box sx={{ width: 'min(340px, 60vw)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.8,
            borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
            bgcolor: 'var(--surface, rgba(255,255,255,0.02))', flexShrink: 0,
          }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: 1.5, flexShrink: 0,
              bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.12)',
              border: '1px solid var(--accent, #3b82f6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PaletteIcon sx={{ fontSize: 15, color: 'var(--accent, #3b82f6)' }} />
            </Box>
            <Typography sx={{ color: 'var(--text, #f1f5f9)', fontWeight: 700, fontSize: '0.88rem', flex: 1 }}>
              {t.settings.tabAppearance || 'Apariencia'}
            </Typography>
            <IconButton size="small" onClick={onClose}
              sx={{ color: 'var(--text-muted, rgba(255,255,255,0.3))', '&:hover': { color: 'var(--text, #f1f5f9)' } }}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </IconButton>
          </Box>

          <Box sx={{ p: 2.2, pt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {/* Accent color */}
            <SectionBox label={t.settings.accent} hint={t.settings.accentHint}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0.9 }}>
                {ACCENTS.map(a => {
                  const active = settings.accent === a.value
                  return (
                    <Tooltip key={a.value} title={t.settings[a.tKey] || a.tKey} placement="top" arrow>
                      <Box onClick={() => save({ accent: a.value })} sx={{
                        width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                        bgcolor: a.value,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: active ? '2px solid var(--text, #fff)' : '2px solid transparent',
                        boxShadow: active ? `0 0 10px ${a.glow}` : 'none',
                        transition: 'transform 0.12s', '&:hover': { transform: 'scale(1.1)' },
                      }}>
                        {active && <CheckIcon sx={{ fontSize: 14, color: '#fff' }} />}
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
            </SectionBox>

            {/* Base theme */}
            <SectionBox label={t.settings.theme} hint={t.settings.themeHint}>
              <Typography sx={SUB_LABEL_SX}>{t.settings.themesDark}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.8, mb: 2 }}>
                {darkThemes.map(th => {
                  const active = settings.theme === th.value
                  return (
                    <Tooltip key={th.value} title={t.settings[th.tKey] || th.tKey} placement="top" arrow>
                      <Box onClick={() => save({ theme: th.value })} sx={{
                        cursor: 'pointer', borderRadius: 1.5, p: 0.5,
                        border: `1.5px solid ${active ? 'var(--accent, #3b82f6)' : 'var(--border, rgba(255,255,255,0.08))'}`,
                        bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent',
                      }}>
                        <Box sx={{ display: 'flex', height: 24, borderRadius: 1, overflow: 'hidden' }}>
                          {th.preview.map((c, i) => <Box key={i} sx={{ flex: 1, bgcolor: c }} />)}
                        </Box>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>

              <Typography sx={SUB_LABEL_SX}>{t.settings.themesLight}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.8 }}>
                {lightThemes.map(th => {
                  const active = settings.theme === th.value
                  return (
                    <Tooltip key={th.value} title={t.settings[th.tKey] || th.tKey} placement="top" arrow>
                      <Box onClick={() => save({ theme: th.value })} sx={{
                        cursor: 'pointer', borderRadius: 1.5, p: 0.5,
                        border: `1.5px solid ${active ? 'var(--accent, #3b82f6)' : 'var(--border, rgba(255,255,255,0.08))'}`,
                        bgcolor: active ? 'rgba(var(--accent-rgb,59,130,246),0.08)' : 'transparent',
                      }}>
                        <Box sx={{ display: 'flex', height: 24, borderRadius: 1, overflow: 'hidden' }}>
                          {th.preview.map((c, i) => <Box key={i} sx={{ flex: 1, bgcolor: c }} />)}
                        </Box>
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
            </SectionBox>
          </Box>
        </Box>
      )}
    </Box>
  )
}
