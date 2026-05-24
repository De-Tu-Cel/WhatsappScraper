'use client'
import { createTheme } from '@mui/material/styles'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6',
      light: '#60a5fa',
      dark: '#1d4ed8',
    },
    secondary: {
      main: '#8b5cf6',
    },
    success: {
      main: '#22c55e',
    },
    warning: {
      main: '#f59e0b',
    },
    error: {
      main: '#ef4444',
    },
    background: {
      default: '#080c14',
      paper: '#161d2e',
    },
    text: {
      primary: '#f1f5f9',
      secondary: 'rgba(255,255,255,0.5)',
      disabled: 'rgba(255,255,255,0.25)',
    },
    divider: 'rgba(255,255,255,0.07)',
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*': {
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.12) transparent',
        },
        '*::-webkit-scrollbar': { width: 4, height: 4 },
        '*::-webkit-scrollbar-button': { display: 'none' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          background: 'rgba(255,255,255,0.12)',
          borderRadius: 2,
        },
        '*::-webkit-scrollbar-thumb:hover': {
          background: 'rgba(255,255,255,0.28)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          boxShadow: '0 4px 14px rgba(59,130,246,0.4)',
          '&:hover': {
            background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
            boxShadow: '0 6px 20px rgba(59,130,246,0.5)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#1e2840',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#0d1117',
            '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
            '&:hover fieldset': { borderColor: 'rgba(59,130,246,0.5)' },
            '&.Mui-focused fieldset': { borderColor: '#3b82f6' },
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
        standardSuccess: {
          backgroundColor: 'rgba(34,197,94,0.12)',
          color: '#86efac',
          border: '1px solid rgba(34,197,94,0.2)',
        },
        standardError: {
          backgroundColor: 'rgba(239,68,68,0.12)',
          color: '#fca5a5',
          border: '1px solid rgba(239,68,68,0.2)',
        },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: { borderCollapse: 'separate', borderSpacing: 0 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          color: '#e2e8f0',
        },
        head: {
          backgroundColor: '#0d1117',
          color: 'rgba(255,255,255,0.5)',
          fontWeight: 600,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': { backgroundColor: 'rgba(59,130,246,0.05)' },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)' },
        bar: { borderRadius: 4 },
      },
    },
    MuiSlider: {
      styleOverrides: {
        rail: { backgroundColor: 'rgba(255,255,255,0.12)' },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'rgba(255,255,255,0.07)' },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        track: { backgroundColor: 'rgba(255,255,255,0.2)' },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          backgroundColor: '#0d1117',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { backgroundColor: '#1e2840' },
      },
    },
  },
})

export default theme
