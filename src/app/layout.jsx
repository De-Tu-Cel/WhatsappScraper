import './globals.css'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import ThemeRegistry from '../components/themeRegistry'
import { UserProvider } from '../context/UserContext'
import { LangProvider } from '../context/LangContext'
import { ACCENTS, THEMES } from '../lib/themeConfig'

export const metadata = {
  title: 'Mystery Shopper',
  description: 'Herramienta de prospección y análisis de empresas',
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)].join(',')
}

// Tablas generadas desde ACCENTS/THEMES (src/lib/themeConfig.js) — antes este
// script tenía una copia manual que se desincronizó del tema real cada vez
// que se agregaba un tema nuevo, causando un flash del color equivocado al
// cargar (se pintaba con el default hasta que Settings.jsx corregía tras
// hidratar). Generarlas aquí las mantiene siempre idénticas a la fuente real.
const ACCENT_RGB_MAP = Object.fromEntries(ACCENTS.map(a => [a.value, hexToRgb(a.value)]))
const THEME_MAP = Object.fromEntries(THEMES.map(t => [
  t.value, { bg: t.bg, sb: t.sidebar, sf: t.surface, cd: t.card, cat: t.cat || 'dark' },
]))

const THEME_SCRIPT = `(function(){
  try {
    var s = JSON.parse(localStorage.getItem('app_settings') || '{}');
    var accent = s.accent || '#3b82f6';
    var theme  = s.theme  || 'navy';

    var ACCENT_RGB = ${JSON.stringify(ACCENT_RGB_MAP)};
    var THEMES = ${JSON.stringify(THEME_MAP)};

    function hexToRgb(h){
      return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(',');
    }

    var accentRgb = ACCENT_RGB[accent] || hexToRgb(accent);
    var t = THEMES[theme] || THEMES.navy;
    var isMono  = t.cat === 'mono';
    var isVivid = t.cat === 'light';
    var r = document.documentElement;
    r.style.setProperty('--accent',      accent);
    r.style.setProperty('--accent-rgb',  accentRgb);
    r.style.setProperty('--accent-glow', 'rgba('+accentRgb+',0.3)');
    r.style.setProperty('--bg',          t.bg);
    r.style.setProperty('--sidebar-bg',  t.sb);
    r.style.setProperty('--surface',     t.sf);
    r.style.setProperty('--card-bg',     t.cd);
    r.style.setProperty('--text',        isMono ? '#1a2234' : '#f1f5f9');
    r.style.setProperty('--text-muted',
      isMono ? 'rgba(15,23,42,0.58)' : isVivid ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.45)');
    r.style.setProperty('--border',
      isMono ? 'rgba(0,0,0,0.16)' : isVivid ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)');
    r.style.setProperty('--item-hover',
      isMono ? 'rgba(0,0,0,0.07)' : isVivid ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)');
    r.style.setProperty('--scrollbar-thumb',
      isMono ? 'rgba(0,0,0,0.20)' : isVivid ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)');
    r.style.setProperty('--scrollbar-thumb-hover',
      isMono ? 'rgba(0,0,0,0.36)' : isVivid ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.28)');
    r.setAttribute('data-theme-mode', isMono ? 'light' : 'dark');
    r.setAttribute('data-theme-cat',  isMono ? 'mono' : isVivid ? 'vivid' : 'dark');
  } catch(e) {}
})();`

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Script plano (no next/script) para que bloquee el parseo del head
            y corra ANTES del primer paint del body — next/script con
            strategy="beforeInteractive" solo garantiza correr antes de la
            hidratación, no antes del primer pintado, así que se veía un
            flash con los valores de fallback de var(--bg,...)/var(--accent,...). */}
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeRegistry><UserProvider><LangProvider>{children}</LangProvider></UserProvider></ThemeRegistry>
      </body>
    </html>
  )
}