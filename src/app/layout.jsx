import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import ThemeRegistry from '../components/themeRegistry'
import { UserProvider } from '../context/UserContext'
import { LangProvider } from '../context/LangContext'

export const metadata = {
  title: 'Mystery Shopper',
  description: 'Herramienta de prospección y análisis de empresas',
}

const THEME_SCRIPT = `(function(){
  try {
    var s = JSON.parse(localStorage.getItem('app_settings') || '{}');
    var accent = s.accent || '#3b82f6';
    var theme  = s.theme  || 'navy';

    var ACCENTS = {
      '#1557f5':'21,87,245','#3b82f6':'59,130,246','#0ea5e9':'14,165,233',
      '#06b6d4':'6,182,212','#14b8a6':'20,184,166','#00ffd5':'0,255,213',
      '#34d399':'52,211,153','#8b5cf6':'139,92,246','#c4b5fd':'196,181,253',
      '#e879f9':'232,121,249','#c026d3':'192,38,211','#6366f1':'99,102,241',
      '#94a3b8':'148,163,184','#22c55e':'34,197,94','#84cc16':'132,204,22',
      '#a3e635':'163,230,53','#39ff14':'57,255,20','#f97316':'249,115,22',
      '#f59e0b':'245,158,11','#faff00':'250,255,0','#f43f5e':'244,63,94',
      '#ec4899':'236,72,153','#ff0080':'255,0,128','#ef4444':'239,68,68',
    };
    var THEMES = {
      navy:{bg:'#080c14',sb:'#0d1117',sf:'#111827',cd:'#161d2e'},
      carbon:{bg:'#050505',sb:'#0d0d0d',sf:'#111111',cd:'#141414'},
      slate:{bg:'#0f172a',sb:'#1e293b',sf:'#293548',cd:'#334155'},
      midnight:{bg:'#0c0a1e',sb:'#130f2e',sf:'#191434',cd:'#1e1a3a'},
      forest:{bg:'#051409',sb:'#0a1f0e',sf:'#0c2610',cd:'#0f2d15'},
      rosewood:{bg:'#140508',sb:'#1e0a10',sf:'#250d14',cd:'#2d111a'},
      ocean:{bg:'#050f1a',sb:'#0a1829',sf:'#0c1f34',cd:'#0d2540'},
      lava:{bg:'#120808',sb:'#1a0e0e',sf:'#221010',cd:'#2a1212'},
      abyss:{bg:'#020408',sb:'#04080f',sf:'#060c18',cd:'#080f1e'},
      void:{bg:'#000000',sb:'#080808',sf:'#0d0d0d',cd:'#111111'},
      copper:{bg:'#110a05',sb:'#1a1008',sf:'#201409',cd:'#2a1a0a'},
      storm:{bg:'#0b0e13',sb:'#131820',sf:'#192030',cd:'#1e2535'},
      emerald:{bg:'#041510',sb:'#071f18',sf:'#0a261e',cd:'#0d2e23'},
      dusk:{bg:'#120d1a',sb:'#1a1228',sf:'#201535',cd:'#271a3d'},
      aurora:{bg:'#050e10',sb:'#091820',sf:'#0b2028',cd:'#0d2530'},
      obsidian:{bg:'#09090b',sb:'#101014',sf:'#141418',cd:'#18181c'},
      desert:{bg:'#110e08',sb:'#1a160c',sf:'#1f1b0e',cd:'#251f10'},
      blood:{bg:'#0f0205',sb:'#180309',sf:'#1e040c',cd:'#240510'},
      glacier:{bg:'#060f14',sb:'#0c1a24',sf:'#0f1f2e',cd:'#132436'},
      cinder:{bg:'#100c09',sb:'#181310',sf:'#1e1813',cd:'#241c16'},
      plum:{bg:'#0e0718',sb:'#180e24',sf:'#20132e',cd:'#271838'},
      sakura:{bg:'#13070f',sb:'#1e0e1a',sf:'#261223',cd:'#2e152a'},
      titanio:{bg:'#0c0c10',sb:'#131318',sf:'#191920',cd:'#1f1f28'},
      royal:{bg:'#07091e',sb:'#0c1030',sf:'#10153c',cd:'#141a48'},
      petroleo:{bg:'#040f0e',sb:'#081a18',sf:'#0b2220',cd:'#0e2a28'},
      olivo:{bg:'#0b0e05',sb:'#131808',sf:'#18200b',cd:'#1d270d'},
      crepusculo:{bg:'#0b0b1e',sb:'#121228',sf:'#181835',cd:'#1e1e40'},
      canela:{bg:'#130a04',sb:'#1f1207',sf:'#261609',cd:'#2e1a0b'},
      detucel:{bg:'#071a10',sb:'#0a1628',sf:'#0d2216',cd:'#102a1e'},
      diurna:{bg:'#15100a',sb:'#1e170b',sf:'#25200d',cd:'#2d2610'},
    };

    function hexToRgb(h){
      return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(',');
    }

    var accentRgb = ACCENTS[accent] || hexToRgb(accent);
    var t = THEMES[theme] || THEMES.navy;
    var r = document.documentElement;
    r.style.setProperty('--accent', accent);
    r.style.setProperty('--accent-rgb', accentRgb);
    r.style.setProperty('--accent-glow', 'rgba('+accentRgb+',0.3)');
    r.style.setProperty('--bg', t.bg);
    r.style.setProperty('--sidebar-bg', t.sb);
    r.style.setProperty('--surface', t.sf);
    r.style.setProperty('--card-bg', t.cd);
    r.style.setProperty('--text', '#f1f5f9');
    r.style.setProperty('--text-muted', 'rgba(255,255,255,0.38)');
    r.style.setProperty('--border', 'rgba(255,255,255,0.07)');
    r.style.setProperty('--item-hover', 'rgba(255,255,255,0.05)');
    r.setAttribute('data-theme-mode', 'dark');
  } catch(e) {}
})();`

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeRegistry><UserProvider><LangProvider>{children}</LangProvider></UserProvider></ThemeRegistry>
      </body>
    </html>
  )
}