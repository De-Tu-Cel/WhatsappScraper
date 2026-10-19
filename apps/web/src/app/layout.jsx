import './globals.css'
import './sectionPolish.css'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import ThemeRegistry from '../components/themeRegistry'
import VersionWatcher from '../components/VersionWatcher'
import PresenceHeartbeat from '../components/PresenceHeartbeat'
import { UserProvider } from '../context/UserContext'
import { LangProvider } from '../context/LangContext'
import { ACCENTS, THEMES, resolveAccent } from '../lib/themeConfig'
import { readBuildId } from '../lib/buildId'

export const metadata = {
  title: 'Mystery Shopper',
  description: 'Herramienta de prospección y análisis de empresas',
}

// Tablas generadas desde ACCENTS/THEMES (src/lib/themeConfig.js) — antes este
// script tenía una copia manual que se desincronizó del tema real cada vez
// que se agregaba un tema nuevo, causando un flash del color equivocado al
// cargar (se pintaba con el default hasta que Settings.jsx corregía tras
// hidratar). Generarlas aquí las mantiene siempre idénticas a la fuente real.
const THEME_MAP = Object.fromEntries(THEMES.map(t => [t.value, t]))
const ACCENT_VALUES = ACCENTS.map(a => a.value)

const THEME_SCRIPT = `(function(){
  try {
    var s = JSON.parse(localStorage.getItem('app_settings') || '{}');
    var accent = s.accent || '#3b82f6';
    var theme  = s.theme  || 'navy';

    var ACCENT_VALUES = ${JSON.stringify(ACCENT_VALUES)};
    var resolveAccent = ${resolveAccent.toString()};
    var THEMES = ${JSON.stringify(THEME_MAP)};

    var t = THEMES[theme] || THEMES.navy;
    var resolved = resolveAccent(ACCENT_VALUES.includes(accent) ? accent : ACCENT_VALUES[0], t);
    var isMono  = t.cat === 'mono';
    var isVivid = t.cat === 'light';
    var r = document.documentElement;
    r.style.setProperty('--accent', resolved.value);
    r.style.setProperty('--accent-rgb', resolved.rgb);
    r.style.setProperty('--accent-contrast', resolved.contrast);
    r.style.setProperty('--accent-glow', resolved.glow);
    r.style.setProperty('--bg', t.bg);
    r.style.setProperty('--sidebar-bg', t.sidebar);
    r.style.setProperty('--surface', t.surface);
    r.style.setProperty('--card-bg', t.card);
    r.style.setProperty('--text',        isMono ? '#1a2234' : '#f1f5f9');
    r.style.setProperty('--text-muted',
      isMono ? '#1f2f42' : isVivid ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.45)');
    r.style.setProperty('--border',
      isMono ? 'rgba(30,41,59,0.20)' : isVivid ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)');
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
        <VersionWatcher buildId={readBuildId()} />
        <ThemeRegistry><UserProvider><PresenceHeartbeat /><LangProvider>{children}</LangProvider></UserProvider></ThemeRegistry>
      </body>
    </html>
  )
}