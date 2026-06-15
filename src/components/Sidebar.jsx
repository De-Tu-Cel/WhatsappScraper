'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import StorefrontIcon from '@mui/icons-material/Storefront'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import SettingsIcon from '@mui/icons-material/Settings'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

const SIDEBAR_FULL = 248
const SIDEBAR_MINI = 64

const C = {
  sidebarBorder: 'rgba(255,255,255,0.10)',
  accent:        'var(--accent, #3b82f6)',
  accentGlow:    'var(--accent-glow, rgba(59,130,246,0.18))',
  accentText:    'var(--accent, #60a5fa)',
  dimText:       'rgba(255,255,255,0.45)',
  text:          'rgba(255,255,255,0.92)',
}

export default function Sidebar({ open, setOpen, active, setActive, navItems, settingsOpen, onSettingsClick }) {
  const { user, logout } = useUser()
  const { t } = useLang()
  return (
    <Box id="tour-sidebar" sx={{
      width: open ? SIDEBAR_FULL : SIDEBAR_MINI,
      transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${C.sidebarBorder}`,
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      position: 'relative',
      background: 'linear-gradient(160deg, rgba(var(--accent-rgb,59,130,246),0.10) 0%, rgba(var(--accent-rgb,59,130,246),0.03) 45%, var(--sidebar-bg, #0d1117) 70%)',
    }}>
      {/* brillo radial en esquina superior */}
      <Box sx={{
        position: 'absolute', top: -40, left: -40,
        width: 200, height: 200, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(var(--accent-rgb,99,102,241),0.18) 0%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />
      {/* Logo / toggle */}
      <Box sx={{
        height: 64, px: 1.5, flexShrink: 0, position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center',
        justifyContent: open ? 'flex-start' : 'center',
        transition: 'justify-content 0s',
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          overflow: 'hidden',
          opacity: open ? 1 : 0,
          maxWidth: open ? 180 : 0,
          transition: 'opacity 0.2s ease, max-width 0.28s cubic-bezier(0.4,0,0.2,1)',
          whiteSpace: 'nowrap',
        }}>
          <Box sx={{
            width: 36, height: 36, flexShrink: 0,
            bgcolor: C.accentGlow, borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(59,130,246,0.3)',
          }}>
            <StorefrontIcon sx={{ color: C.accentText, fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ color: C.text, fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2 }}>Mystery</Typography>
            <Typography sx={{ color: C.accentText, fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>Shopper</Typography>
          </Box>
        </Box>

        <IconButton
          onClick={() => setOpen(o => !o)}
          size="small"
          sx={{
            ml: open ? 'auto' : 0, flexShrink: 0,
            color: C.dimText,
            '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.06)' },
          }}
        >
          {open ? <ChevronLeftIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Divider sx={{ borderColor: C.sidebarBorder, position: 'relative', zIndex: 1 }} />

      {/* Nav */}
      <List sx={{ px: 1, pt: 1.5, flexGrow: 1, position: 'relative', zIndex: 1 }}>
        {navItems.map((item, i) => {
          const isActive = !settingsOpen && active === i
          return (
            <Tooltip key={i} title={open ? '' : item.label} placement="right" arrow>
              <ListItemButton
                id={`tour-nav-${item.key}`}
                onClick={() => setActive(i)}
                sx={{
                  borderRadius: 2, mb: 0.5, minHeight: 44,
                  color: isActive ? 'white' : C.dimText,
                  bgcolor: isActive ? C.accentGlow : 'transparent',
                  outline: isActive ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
                  justifyContent: open ? 'flex-start' : 'center',
                  px: open ? 1.5 : 1,
                  transition: 'padding 0.28s cubic-bezier(0.4,0,0.2,1)',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: C.text },
                }}
              >
                <ListItemIcon sx={{
                  color: isActive ? C.accent : C.dimText,
                  minWidth: 0,
                  mr: open ? 1.5 : 0,
                  transition: 'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)',
                  justifyContent: 'center',
                  '& svg': { fontSize: 20 },
                }}>
                  {item.icon}
                </ListItemIcon>
                <Box sx={{
                  overflow: 'hidden',
                  opacity: open ? 1 : 0,
                  maxWidth: open ? 160 : 0,
                  transition: 'opacity 0.2s ease, max-width 0.28s cubic-bezier(0.4,0,0.2,1)',
                  whiteSpace: 'nowrap',
                }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: isActive ? 600 : 400, color: 'inherit' }}>
                    {item.label}
                  </Typography>
                </Box>
              </ListItemButton>
            </Tooltip>
          )
        })}
      </List>

      {/* Settings button — separado del nav */}
      <Box sx={{ px: 1, pb: 1, position: 'relative', zIndex: 1 }}>
        <Divider sx={{ borderColor: C.sidebarBorder, mb: 1 }} />
        <Tooltip title={open ? '' : t.settings.title} placement="right" arrow>
          <ListItemButton
            onClick={onSettingsClick}
            sx={{
              borderRadius: 2, minHeight: 44,
              color: settingsOpen ? 'white' : C.dimText,
              bgcolor: settingsOpen ? C.accentGlow : 'transparent',
              outline: settingsOpen ? `1px solid ${C.accent}` : '1px solid transparent',
              justifyContent: open ? 'flex-start' : 'center',
              px: open ? 1.5 : 1,
              transition: 'padding 0.28s cubic-bezier(0.4,0,0.2,1)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', color: C.text },
            }}
          >
            <ListItemIcon sx={{
              color: settingsOpen ? C.accent : C.dimText,
              minWidth: 0,
              mr: open ? 1.5 : 0,
              transition: 'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)',
              justifyContent: 'center',
              '& svg': { fontSize: 20 },
            }}>
              <SettingsIcon />
            </ListItemIcon>
            <Box sx={{
              overflow: 'hidden',
              opacity: open ? 1 : 0,
              maxWidth: open ? 160 : 0,
              transition: 'opacity 0.2s ease, max-width 0.28s cubic-bezier(0.4,0,0.2,1)',
              whiteSpace: 'nowrap',
            }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: settingsOpen ? 600 : 400, color: 'inherit' }}>
                {t.settings.title}
              </Typography>
            </Box>
          </ListItemButton>
        </Tooltip>
      </Box>

      {/* Footer */}
      <Box sx={{
        display: 'flex', alignItems: 'center',
        px: 1.5, py: 1.5, flexShrink: 0,
        borderTop: `1px solid ${C.sidebarBorder}`,
        position: 'relative', zIndex: 1,
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center',
          width: '100%',
          justifyContent: open ? 'flex-start' : 'center',
          pl: open ? 0.5 : 0,
        }}>
          {/* Avatar */}
          <Box sx={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            bgcolor: 'rgba(var(--accent-rgb,59,130,246),0.2)',
            border: '1.5px solid rgba(var(--accent-rgb,59,130,246),0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--accent,#60a5fa)', textTransform: 'uppercase' }}>
              {(user?.display_name || user?.username || '?')[0]}
            </Typography>
          </Box>
          <Box sx={{
            overflow: 'hidden', flex: 1, minWidth: 0,
            opacity: open ? 1 : 0,
            maxWidth: open ? 120 : 0,
            transition: 'opacity 0.2s ease, max-width 0.28s cubic-bezier(0.4,0,0.2,1)',
            whiteSpace: 'nowrap', ml: open ? 1 : 0,
          }}>
            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.display_name || user?.username || ''}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.18)' }}>
              v1.0 · DeTuCel
            </Typography>
          </Box>
          {open && (
            <Tooltip title="Cerrar sesión">
              <IconButton size="small" onClick={logout}
                sx={{ ml: 'auto', color: C.dimText, flexShrink: 0, '&:hover': { color: '#f87171' } }}>
                <LogoutIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  )
}
