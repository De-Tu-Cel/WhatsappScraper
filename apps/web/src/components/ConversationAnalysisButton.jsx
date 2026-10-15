'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import Tooltip from '@mui/material/Tooltip'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import { useLang } from '../context/LangContext'
import { ComparisonDialog } from './ClassifierComparison'

// Gas Imperial (2026-10-13): conservar acceso al historial de empresa,
// mostrando su alcance cuando no existe un resultado separado por numero.
export default function ConversationAnalysisButton({ companyId, companyName, number, numberCount, onChanged }) {
  const { lang } = useLang()
  const [open, setOpen] = useState(false)
  if (!companyId) return null
  return <>
    <Tooltip describeChild title={lang === 'en' ? 'View analysis and response status' : 'Ver an\u00e1lisis y estado de respuesta'}>
      <Button size="small" variant="outlined" startIcon={<CompareArrowsIcon />} onClick={() => setOpen(true)}
        sx={{ flexShrink: 0, textTransform: 'none', fontSize: '0.72rem', fontWeight: 700,
          color: 'var(--accent)', borderColor: 'var(--border)', bgcolor: 'var(--item-hover)', borderRadius: 2,
          '&:hover': { borderColor: 'var(--accent)' } }}>
        {lang === 'en' ? 'View analysis' : 'Ver an\u00e1lisis'}
      </Button>
    </Tooltip>
    {open && <ComparisonDialog companyId={companyId} companyName={companyName} number={number}
      allowCompanyFallback showCompanyScope={numberCount !== 1} onChanged={onChanged}
      onClose={() => setOpen(false)} />}
  </>
}
