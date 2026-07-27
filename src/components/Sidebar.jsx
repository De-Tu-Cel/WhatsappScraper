'use client'
import React from 'react'
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
import { useInstanceStatus } from '../hooks/useInstanceStatus'

const SIDEBAR_FULL = 248
const SIDEBAR_MINI = 64

const C = {
  sidebarBorder: 'var(--border, rgba(255,255,255,0.10))',
  accent:        'var(--accent, #3b82f6)',
  accentGlow:    'var(--accent-glow, rgba(59,130,246,0.18))',
  accentText:    'var(--accent, #60a5fa)',
  dimText:       'var(--text-muted, rgba(255,255,255,0.45))',
  text:          'var(--text, rgba(255,255,255,0.92))',
}

const GROUP_KEYS = [
  { labelKey: 'groupProspeccion',  keys: ['single', 'batch', 'csv', 'database', 'search', 'blacklist'] },
  { labelKey: 'groupComunicacion', keys: ['convs', 'schedule'] },
  { labelKey: 'groupAnalisis',     keys: ['analytics'] },
  { labelKey: 'groupSistema',      keys: ['admin', 'instances'] },
]

function NavItem({ item, index, isActive, open, onClick }) {
  return (
    <Tooltip key={index} title={open ? '' : item.label} placement="right" arrow>
      <ListItemButton
        id={`tour-nav-${item.key}`}
        onClick={() => onClick(index)}
        sx={{
          borderRadius: 2, mb: 0.5, minHeight: 42,
          color: isActive ? 'white' : C.dimText,
          bgcolor: isActive ? C.accentGlow : 'transparent',
          outline: isActive ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
          justifyContent: open ? 'flex-start' : 'center',
          px: open ? 1.5 : 1,
          transition: 'padding 0.28s cubic-bezier(0.4,0,0.2,1)',
          '&:hover': { bgcolor: 'var(--item-hover)', color: C.text },
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
}

function GroupLabel({ label, open }) {
  return (
    <Box sx={{
      overflow: 'hidden',
      opacity: open ? 1 : 0,
      maxHeight: open ? 28 : 0,
      transition: 'opacity 0.2s ease, max-height 0.25s cubic-bezier(0.4,0,0.2,1)',
      px: 1.5, mb: 0.5,
    }}>
      <Typography sx={{
        fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        userSelect: 'none',
      }}>
        {label}
      </Typography>
    </Box>
  )
}

export default React.memo(function Sidebar({ open, setOpen, active, setActive, navItems, settingsOpen, onSettingsClick }) {
  const { user, logout } = useUser()
  const { t } = useLang()
  const { status: instanceStatus } = useInstanceStatus()

  const itemsByKey = Object.fromEntries(navItems.map((item, i) => [item.key, { item, index: i }]))

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
            '&:hover': { color: C.text, bgcolor: 'var(--item-hover)' },
          }}
        >
          {open ? <ChevronLeftIcon fontSize="small" /> : <MenuIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Divider sx={{ borderColor: C.sidebarBorder, position: 'relative', zIndex: 1 }} />

      {/* Nav — agrupado */}
      <List sx={{ px: 1, pt: 1.5, pb: 0.5, flexGrow: 1, position: 'relative', zIndex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {GROUP_KEYS.map((group, gi) => {
          const groupLabel = t.nav[group.labelKey]
          const groupItems = group.keys
            .map(k => itemsByKey[k])
            .filter(Boolean)
          const hasSettings = group.labelKey === 'groupSistema'
          if (groupItems.length === 0 && !hasSettings) return null

          const isLast = gi === GROUP_KEYS.length - 1
          return (
            <Box key={group.labelKey} sx={{ mb: isLast ? 0 : 1 }}>
              <GroupLabel label={groupLabel} open={open} />
              {groupItems.map(({ item, index }) => (
                <NavItem
                  key={item.key}
                  item={item}
                  index={index}
                  isActive={!settingsOpen && active === index}
                  open={open}
                  onClick={setActive}
                />
              ))}
              {/* Settings se añade al final del grupo Sistema */}
              {group.labelKey === 'groupSistema' && (
                <Tooltip title={open ? '' : t.settings.title} placement="right" arrow>
                  <ListItemButton
                    id="tour-settings"
                    onClick={onSettingsClick}
                    sx={{
                      borderRadius: 2, mb: 0.5, minHeight: 42,
                      color: settingsOpen ? 'white' : C.dimText,
                      bgcolor: settingsOpen ? C.accentGlow : 'transparent',
                      outline: settingsOpen ? `1px solid rgba(59,130,246,0.25)` : '1px solid transparent',
                      justifyContent: open ? 'flex-start' : 'center',
                      px: open ? 1.5 : 1,
                      transition: 'padding 0.28s cubic-bezier(0.4,0,0.2,1)',
                      '&:hover': { bgcolor: 'var(--item-hover)', color: C.text },
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
              )}
              {!isLast && (
                <Divider sx={{ borderColor: 'var(--border)', mt: 1 }} />
              )}
            </Box>
          )
        })}
      </List>

      {/* Footer: avatar + estado instancia + logout */}
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
            <Typography sx={{ color: 'var(--text)', fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.display_name || user?.username || ''}
            </Typography>
            {/* Estado de instancia debajo del nombre */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.2 }}>
              <Box sx={{
                width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                bgcolor: instanceStatus === 'connected' ? '#22c55e' : instanceStatus === 'disconnected' ? '#ef4444' : 'var(--border)',
              }} />
              <Typography sx={{
                fontSize: '0.6rem',
                color: instanceStatus === 'connected' ? 'rgba(34,197,94,0.7)' : instanceStatus === 'disconnected' ? 'rgba(239,68,68,0.8)' : 'var(--text-muted)',
              }}>
                {instanceStatus === 'connected'
                  ? `WhatsApp ${t.instance.connectedLbl}`
                  : instanceStatus === 'disconnected' ? t.instance.disconnectedLbl : t.instance.verifying}
              </Typography>
            </Box>
          </Box>

          {open && (
            <Tooltip title={t.nav.logout}>
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
})
