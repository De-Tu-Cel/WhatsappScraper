'use client'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import SettingsIcon from '@mui/icons-material/Settings'
import { useUser } from '../context/UserContext'
import { useLang } from '../context/LangContext'

function goToSettings() {
  window.dispatchEvent(new CustomEvent('nav:settings'))
}

/** Red banner shown when Evolution instance is disconnected */
export function InstanceDisconnectedBanner({ status, sx }) {
  const { t } = useLang()
  if (status !== 'disconnected') return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.9, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', ...sx }}>
      <WifiOffIcon sx={{ fontSize: 15, color: '#ef4444', flexShrink: 0 }} />
      <Typography sx={{ color: '#ef4444', fontSize: '0.75rem', flex: 1 }}>
        {t.instance.disconnected}
      </Typography>
      <Tooltip title={t.instance.goSettings}>
        <IconButton size="small" onClick={goToSettings} sx={{ color: 'rgba(239,68,68,0.6)', p: 0.3, '&:hover': { color: '#ef4444' } }}>
          <SettingsIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

/** Red banner for send errors returned by the backend */
export function SendErrorBanner({ error, onDismiss, sx }) {
  if (!error) return null
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 1.5, py: 0.9, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', ...sx }}>
      <WifiOffIcon sx={{ fontSize: 14, color: '#f87171', flexShrink: 0, mt: 0.15 }} />
      <Typography sx={{ color: '#f87171', fontSize: '0.74rem', lineHeight: 1.4, flex: 1 }}>{error}</Typography>
      {onDismiss && (
        <IconButton size="small" onClick={onDismiss} sx={{ color: 'rgba(255,255,255,0.2)', p: 0.2, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.68rem', lineHeight: 1 }}>✕</Typography>
        </IconButton>
      )}
    </Box>
  )
}

/** Small status dot shown near send buttons */
export function InstanceStatusDot({ status, sx }) {
  const { t } = useLang()
  const { user } = useUser()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, ...sx }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: status === 'connected' ? '#22c55e' : status === 'disconnected' ? '#ef4444' : 'rgba(255,255,255,0.2)' }} />
      <Typography sx={{ fontSize: '0.62rem', color: status === 'connected' ? 'rgba(34,197,94,0.7)' : status === 'disconnected' ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.2)' }}>
        {status === 'connected'
          ? `${user?.evolution_instance || 'WhatsApp'} ${t.instance.connectedLbl}`
          : status === 'disconnected' ? t.instance.disconnectedLbl : t.instance.verifying}
      </Typography>
    </Box>
  )
}
