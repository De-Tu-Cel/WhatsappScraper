'use client'
import { createContext, useContext, useState, useEffect } from 'react'
import { T } from '../lib/translations'

const LangContext = createContext({ lang: 'es', t: T.es, setLang: () => {} })

export function LangProvider({ children }) {
  const [lang, setLangState] = useState('es')

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('app_settings') || '{}')
      if (saved.lang) setLangState(saved.lang)
    } catch {}
  }, [])

  function setLang(l) {
    setLangState(l)
    try {
      const saved = JSON.parse(localStorage.getItem('app_settings') || '{}')
      localStorage.setItem('app_settings', JSON.stringify({ ...saved, lang: l }))
    } catch {}
  }

  return (
    <LangContext.Provider value={{ lang, t: T[lang] || T.es, setLang }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
