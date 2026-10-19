// Fuente única de verdad para acentos y temas. La usan Settings.jsx (aplicación
// en vivo desde la UI) y app/layout.jsx (script de pre-hidratación que pinta el
// tema correcto antes del primer paint, para no depender de un duplicado que
// se puede desincronizar cada vez que se agrega un tema nuevo).
// Shared by the first paint and live settings: accents adapt to every surface.
// Keep this function self-contained so layout can embed it before hydration.
export function resolveAccent(hex, theme) {
  const rgb = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const luminance = channels => channels.map(v => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const source = rgb(hex)
  const gray = source.reduce((a, b) => a + b, 0) / 3
  const softened = source.map(c => c * 0.82 + gray * 0.18)
  const backgrounds = [theme.bg, theme.sidebar, theme.surface, theme.card].map(c => luminance(rgb(c)))
  const target = theme.cat === 'mono' ? 0 : 255
  let channels = softened.map(Math.round)
  for (let step = 0; step <= 100; step++) {
    channels = softened.map(c => Math.round(c + (target - c) * step / 100))
    if (backgrounds.every(bg => ratio(luminance(channels), bg) >= 4.5)) break
  }
  const value = '#' + channels.map(c => c.toString(16).padStart(2, '0')).join('')
  const light = ratio(luminance(channels), 1)
  const dark = ratio(luminance(channels), 0)
  return { value, rgb: channels.join(','), contrast: light >= dark ? '#fff' : '#000',
    glow: `rgba(${channels.join(',')},0.12)` }
}

export const ACCENTS = [
  // Marca
  { tKey: 'accentDtcBlue',     value: '#1557f5', glow: 'rgba(21,87,245,0.35)'   },
  // Fríos
  { tKey: 'accentBlue',        value: '#3b82f6', glow: 'rgba(59,130,246,0.3)'   },
  { tKey: 'accentElectricBlue',value: '#0ea5e9', glow: 'rgba(14,165,233,0.3)'   },
  { tKey: 'accentCyan',        value: '#06b6d4', glow: 'rgba(6,182,212,0.3)'    },
  { tKey: 'accentTurquoise',   value: '#14b8a6', glow: 'rgba(20,184,166,0.3)'   },
  { tKey: 'accentNeonTeal',    value: '#00ffd5', glow: 'rgba(0,255,213,0.3)'    },
  { tKey: 'accentMint',        value: '#34d399', glow: 'rgba(52,211,153,0.3)'   },
  { tKey: 'accentViolet',      value: '#8b5cf6', glow: 'rgba(139,92,246,0.3)'   },
  { tKey: 'accentLavender',    value: '#c4b5fd', glow: 'rgba(196,181,253,0.35)' },
  { tKey: 'accentPersian',     value: '#e879f9', glow: 'rgba(232,121,249,0.3)'  },
  { tKey: 'accentNeonPurple',  value: '#c026d3', glow: 'rgba(192,38,211,0.3)'   },
  { tKey: 'accentIndigo',      value: '#6366f1', glow: 'rgba(99,102,241,0.3)'   },
  { tKey: 'accentSilver',      value: '#94a3b8', glow: 'rgba(148,163,184,0.3)'  },
  // Cálidos
  { tKey: 'accentGreen',       value: '#22c55e', glow: 'rgba(34,197,94,0.3)'    },
  { tKey: 'accentLime',        value: '#84cc16', glow: 'rgba(132,204,22,0.3)'   },
  { tKey: 'accentChartreuse',  value: '#a3e635', glow: 'rgba(163,230,53,0.3)'   },
  { tKey: 'accentNeonGreen',   value: '#39ff14', glow: 'rgba(57,255,20,0.3)'    },
  { tKey: 'accentOrange',      value: '#f97316', glow: 'rgba(249,115,22,0.3)'   },
  { tKey: 'accentAmber',       value: '#f59e0b', glow: 'rgba(245,158,11,0.3)'   },
  { tKey: 'accentNeonYellow',  value: '#faff00', glow: 'rgba(250,255,0,0.3)'    },
  { tKey: 'accentCoral',       value: '#f43f5e', glow: 'rgba(244,63,94,0.3)'    },
  { tKey: 'accentPink',        value: '#ec4899', glow: 'rgba(236,72,153,0.3)'   },
  { tKey: 'accentHotPink',     value: '#ff0080', glow: 'rgba(255,0,128,0.3)'    },
  { tKey: 'accentRed',         value: '#ef4444', glow: 'rgba(239,68,68,0.3)'    },
  // Extras
  { tKey: 'accentGold',        value: '#eab308', glow: 'rgba(234,179,8,0.3)'    },
  { tKey: 'accentRose',        value: '#fb7185', glow: 'rgba(251,113,133,0.3)'  },
  { tKey: 'accentDeepTeal',    value: '#0d9488', glow: 'rgba(13,148,136,0.3)'   },
  { tKey: 'accentBronze',      value: '#b45309', glow: 'rgba(180,83,9,0.3)'     },
  { tKey: 'accentPeriwinkle',  value: '#818cf8', glow: 'rgba(129,140,248,0.3)'  },
  { tKey: 'accentSpringGreen', value: '#00d084', glow: 'rgba(0,208,132,0.3)'    },
  { tKey: 'accentIce',         value: '#a5f3fc', glow: 'rgba(165,243,252,0.35)' },
  { tKey: 'accentSunrise',     value: '#fb923c', glow: 'rgba(251,146,60,0.3)'   },
  // Profundos (para temas claros y pasteles)
  { tKey: 'accentOceanDeep',   value: '#0369a1', glow: 'rgba(3,105,161,0.35)'   },
  { tKey: 'accentForestDeep',  value: '#16a34a', glow: 'rgba(22,163,74,0.35)'   },
  { tKey: 'accentCrimson',     value: '#be123c', glow: 'rgba(190,18,60,0.35)'   },
  { tKey: 'accentVioletDeep',  value: '#6d28d9', glow: 'rgba(109,40,217,0.35)'  },
  { tKey: 'accentStone',       value: '#78716c', glow: 'rgba(120,113,108,0.3)'  },
  { tKey: 'accentMagenta',     value: '#d946ef', glow: 'rgba(217,70,239,0.3)'   },
  { tKey: 'accentSapphireSoft', value: '#5979b3' },
  { tKey: 'accentPetrolSoft',   value: '#4f8d96' },
  { tKey: 'accentSageSoft',     value: '#709080' },
  { tKey: 'accentHeatherSoft',  value: '#9277a6' },
  { tKey: 'accentBrickSoft',    value: '#b37468' },
  { tKey: 'accentHoneySoft',    value: '#ac8b52' },
]

export const THEMES = [
  // Tema de marca — va primero
  {
    tKey: 'themeDetucel', value: 'detucel',
    bg: '#182e24', sidebar: '#0e2d5c', surface: '#3a4a5c', card: '#264436',
    preview: ['#0e2d5c', '#3a4a5c', '#264436'],
  },
  { tKey: 'themeNavy',      value: 'navy',      bg: '#080c14', sidebar: '#0d1117', surface: '#111827', card: '#161d2e', preview: ['#080c14','#0d1117','#161d2e'] },
  { tKey: 'themeCarbon',    value: 'carbon',    bg: '#050505', sidebar: '#0d0d0d', surface: '#111111', card: '#141414', preview: ['#050505','#0d0d0d','#1a1a1a'] },
  { tKey: 'themeSlate',     value: 'slate',     bg: '#0f172a', sidebar: '#1e293b', surface: '#293548', card: '#334155', preview: ['#0f172a','#1e293b','#334155'] },
  { tKey: 'themeMidnight',  value: 'midnight',  bg: '#0c0a1e', sidebar: '#130f2e', surface: '#191434', card: '#1e1a3a', preview: ['#0c0a1e','#130f2e','#1e1a3a'] },
  { tKey: 'themeForest',    value: 'forest',    bg: '#051409', sidebar: '#0a1f0e', surface: '#0c2610', card: '#0f2d15', preview: ['#051409','#0a1f0e','#0f2d15'] },
  { tKey: 'themeRosewood',  value: 'rosewood',  bg: '#140508', sidebar: '#1e0a10', surface: '#250d14', card: '#2d111a', preview: ['#140508','#1e0a10','#2d111a'] },
  { tKey: 'themeOcean',     value: 'ocean',     bg: '#050f1a', sidebar: '#0a1829', surface: '#0c1f34', card: '#0d2540', preview: ['#050f1a','#0a1829','#0d2540'] },
  { tKey: 'themeLava',      value: 'lava',      bg: '#120808', sidebar: '#1a0e0e', surface: '#221010', card: '#2a1212', preview: ['#120808','#1a0e0e','#2a1212'] },
  { tKey: 'themeAbyss',     value: 'abyss',     bg: '#020408', sidebar: '#04080f', surface: '#060c18', card: '#080f1e', preview: ['#020408','#04080f','#080f1e'] },
  { tKey: 'themeVoid',      value: 'void',      bg: '#000000', sidebar: '#080808', surface: '#0d0d0d', card: '#111111', preview: ['#000000','#080808','#111111'] },
  { tKey: 'themeCopper',    value: 'copper',    bg: '#110a05', sidebar: '#1a1008', surface: '#201409', card: '#2a1a0a', preview: ['#110a05','#1a1008','#2a1a0a'] },
  { tKey: 'themeStorm',     value: 'storm',     bg: '#0b0e13', sidebar: '#131820', surface: '#192030', card: '#1e2535', preview: ['#0b0e13','#131820','#1e2535'] },
  { tKey: 'themeEmerald',   value: 'emerald',   bg: '#041510', sidebar: '#071f18', surface: '#0a261e', card: '#0d2e23', preview: ['#041510','#071f18','#0d2e23'] },
  { tKey: 'themeDusk',      value: 'dusk',      bg: '#120d1a', sidebar: '#1a1228', surface: '#201535', card: '#271a3d', preview: ['#120d1a','#1a1228','#271a3d'] },
  { tKey: 'themeAurora',    value: 'aurora',    bg: '#050e10', sidebar: '#091820', surface: '#0b2028', card: '#0d2530', preview: ['#050e10','#091820','#0d2530'] },
  { tKey: 'themeObsidian',  value: 'obsidian',  bg: '#09090b', sidebar: '#101014', surface: '#141418', card: '#18181c', preview: ['#09090b','#101014','#18181c'] },
  { tKey: 'themeDesert',    value: 'desert',    bg: '#110e08', sidebar: '#1a160c', surface: '#1f1b0e', card: '#251f10', preview: ['#110e08','#1a160c','#251f10'] },
  { tKey: 'themeBloodMoon', value: 'blood',     bg: '#0f0205', sidebar: '#180309', surface: '#1e040c', card: '#240510', preview: ['#0f0205','#180309','#240510'] },
  { tKey: 'themeGlacier',   value: 'glacier',   bg: '#060f14', sidebar: '#0c1a24', surface: '#0f1f2e', card: '#132436', preview: ['#060f14','#0c1a24','#132436'] },
  { tKey: 'themeCinder',    value: 'cinder',    bg: '#100c09', sidebar: '#181310', surface: '#1e1813', card: '#241c16', preview: ['#100c09','#181310','#241c16'] },
  // Nuevos
  { tKey: 'themePlum',      value: 'plum',      bg: '#0e0718', sidebar: '#180e24', surface: '#20132e', card: '#271838', preview: ['#0e0718','#180e24','#271838'] },
  { tKey: 'themeSakura',    value: 'sakura',    bg: '#13070f', sidebar: '#1e0e1a', surface: '#261223', card: '#2e152a', preview: ['#13070f','#1e0e1a','#2e152a'] },
  { tKey: 'themeTitanium',  value: 'titanio',   bg: '#0c0c10', sidebar: '#131318', surface: '#191920', card: '#1f1f28', preview: ['#0c0c10','#131318','#1f1f28'] },
  { tKey: 'themeRoyal',     value: 'royal',     bg: '#07091e', sidebar: '#0c1030', surface: '#10153c', card: '#141a48', preview: ['#07091e','#0c1030','#141a48'] },
  { tKey: 'themePetroleum', value: 'petroleo',  bg: '#040f0e', sidebar: '#081a18', surface: '#0b2220', card: '#0e2a28', preview: ['#040f0e','#081a18','#0e2a28'] },
  { tKey: 'themeOlive',     value: 'olivo',     bg: '#0b0e05', sidebar: '#131808', surface: '#18200b', card: '#1d270d', preview: ['#0b0e05','#131808','#1d270d'] },
  { tKey: 'themeTwilight',  value: 'crepusculo',bg: '#0b0b1e', sidebar: '#121228', surface: '#181835', card: '#1e1e40', preview: ['#0b0b1e','#121228','#1e1e40'] },
  { tKey: 'themeCinnamon',  value: 'canela',    bg: '#130a04', sidebar: '#1f1207', surface: '#261609', card: '#2e1a0b', preview: ['#130a04','#1f1207','#2e1a0b'] },
  { tKey: 'themeDaytime',   value: 'diurna',    bg: '#15100a', sidebar: '#1e170b', surface: '#25200d', card: '#2d2610', preview: ['#15100a','#1e170b','#2d2610'] },
  // Matte light themes: tinted surfaces, no pure white.
  { tKey: 'themeMonochrome', value: 'mono', cat:'mono', bg: '#a4adb9', sidebar: '#939eae', surface: '#afb8c3', card: '#bbc3cd', preview: ['#939eae','#afb8c3','#bbc3cd'] },

  // ── Neutros sofisticados (claros sin saturación, elegantes) ──
  { tKey: 'themeSnow',       value: 'nieve',    cat:'mono', bg: '#b5b0a8', sidebar: '#a39e96', surface: '#beb9b0', card: '#c8c3ba', preview: ['#a39e96','#beb9b0','#c8c3ba'] },
  { tKey: 'themeParchment',  value: 'pergamino',cat:'mono', bg: '#b3a58d', sidebar: '#a3957e', surface: '#bbae97', card: '#c7baa3', preview: ['#a3957e','#bbae97','#c7baa3'] },
  { tKey: 'themeCement',     value: 'cemento',  cat:'mono', bg: '#aaa7a3', sidebar: '#999692', surface: '#b5b2ae', card: '#c0bdb9', preview: ['#999692','#b5b2ae','#c0bdb9'] },
  { tKey: 'themeSand',       value: 'arena',    cat:'mono', bg: '#b0a58f', sidebar: '#9f947f', surface: '#baaf99', card: '#c5baa5', preview: ['#9f947f','#baaf99','#c5baa5'] },
  { tKey: 'themeSilver',     value: 'plata',    cat:'mono', bg: '#a6adb2', sidebar: '#959da3', surface: '#b1b8bd', card: '#bdc4c8', preview: ['#959da3','#b1b8bd','#bdc4c8'] },
  { tKey: 'themeFog',        value: 'niebla',   cat:'mono', bg: '#a0adb7', sidebar: '#8e9da9', surface: '#acb8c1', card: '#bac5cd', preview: ['#8e9da9','#acb8c1','#bac5cd'] },

  // Muted pastels with dark text.
  { tKey: 'themeCloud',      value: 'nube',     cat:'mono', bg: '#9cabbc', sidebar: '#8a9bae', surface: '#a8b6c5', card: '#b7c3cf', preview: ['#8a9bae','#a8b6c5','#b7c3cf'] },
  { tKey: 'themeMintFresh',  value: 'menta',    cat:'mono', bg: '#9faea5', sidebar: '#8e9f94', surface: '#acb9b0', card: '#bac6bd', preview: ['#8e9f94','#acb9b0','#bac6bd'] },
  { tKey: 'themeBlush',      value: 'rubor',    cat:'mono', bg: '#b3a3a6', sidebar: '#a29296', surface: '#bdaeaf', card: '#c9bcbd', preview: ['#a29296','#bdaeaf','#c9bcbd'] },
  { tKey: 'themePowderBlue', value: 'polvos',   cat:'mono', bg: '#9caabe', sidebar: '#8a99af', surface: '#aab7c9', card: '#b9c4d3', preview: ['#8a99af','#aab7c9','#b9c4d3'] },
  { tKey: 'themeChampagne',  value: 'champan',  cat:'mono', bg: '#b2ab97', sidebar: '#a19a85', surface: '#bdb6a3', card: '#c9c2af', preview: ['#a19a85','#bdb6a3','#c9c2af'] },
  { tKey: 'themeLilacMist',  value: 'lila',     cat:'mono', bg: '#aba3b8', sidebar: '#9a91a8', surface: '#b6afc2', card: '#c3bdcd', preview: ['#9a91a8','#b6afc2','#c3bdcd'] },

  // ── Claros (tonos medios ~33-40% L, saturación ~22-35% — elegantes, no chillan) ──
  { tKey: 'themeSlateBlue',  value: 'pizarra',  cat:'light', bg: '#485c6a', sidebar: '#566a78', surface: '#405260', card: '#5e6e7c', preview: ['#485c6a','#566a78','#5e6e7c'] },
  { tKey: 'themePaper',      value: 'paper',    cat:'light', bg: '#55493d', sidebar: '#63574b', surface: '#4d3f33', card: '#6f6053', preview: ['#55493d','#63574b','#6f6053'] },
  { tKey: 'themeSteelBlue',  value: 'acero',    cat:'light', bg: '#354e6b', sidebar: '#415c79', surface: '#2e4561', card: '#466078', preview: ['#354e6b','#415c79','#466078'] },
  { tKey: 'themeMoss',       value: 'musgo',    cat:'light', bg: '#305340', sidebar: '#3c6349', surface: '#2a4c38', card: '#436953', preview: ['#305340','#3c6349','#436953'] },
  { tKey: 'themeLavender',   value: 'lavanda',  cat:'light', bg: '#403568', sidebar: '#4e4376', surface: '#3a2d5f', card: '#584d79', preview: ['#403568','#4e4376','#584d79'] },
  { tKey: 'themeTerracotta', value: 'terracota',cat:'light', bg: '#674437', sidebar: '#755245', surface: '#5b3b2d', card: '#826255', preview: ['#674437','#755245','#826255'] },
  { tKey: 'themeDustyRose',  value: 'palo',     cat:'light', bg: '#593443', sidebar: '#674251', surface: '#512c3b', card: '#744c59', preview: ['#593443','#674251','#744c59'] },
  { tKey: 'themeDeepTeal',   value: 'teal',     cat:'light', bg: '#285b69', sidebar: '#346977', surface: '#215160', card: '#3a6d7a', preview: ['#285b69','#346977','#3a6d7a'] },
  { tKey: 'themeLeather',    value: 'cuero',    cat:'light', bg: '#5c4925', sidebar: '#6a5630', surface: '#523d1d', card: '#795f39', preview: ['#5c4925','#6a5630','#795f39'] },
  { tKey: 'themeDenim',      value: 'denim',    cat:'light', bg: '#2f3d58', sidebar: '#3d5068', surface: '#28354d', card: '#48536b', preview: ['#2f3d58','#3d5068','#48536b'] },
  { tKey: 'themeWalnut',     value: 'nogal',    cat:'light', bg: '#48382a', sidebar: '#564638', surface: '#403022', card: '#5e4e3c', preview: ['#48382a','#564638','#5e4e3c'] },
  { tKey: 'themeSage',       value: 'salvia',   cat:'light', bg: '#2f4738', sidebar: '#3d5546', surface: '#293f31', card: '#415a49', preview: ['#2f4738','#3d5546','#415a49'] },
  { tKey: 'themeSteel',      value: 'steel',    cat:'light', bg: '#313e4e', sidebar: '#3f4c5c', surface: '#2b3645', card: '#47545f', preview: ['#313e4e','#3f4c5c','#47545f'] },
  { tKey: 'themeWine',       value: 'vino',     cat:'light', bg: '#4b2431', sidebar: '#59323f', surface: '#431c29', card: '#663d49', preview: ['#4b2431','#59323f','#663d49'] },
  { tKey: 'themeInk',        value: 'tinta',    cat:'light', bg: '#222f43', sidebar: '#2e3d53', surface: '#1b2635', card: '#38455b', preview: ['#222f43','#2e3d53','#38455b'] },
  { tKey: 'themeClay',       value: 'arcilla',  cat:'light', bg: '#664d3f', sidebar: '#745b4c', surface: '#594134', card: '#826458', preview: ['#664d3f','#745b4c','#826458'] },
  { tKey: 'themeGunmetal',   value: 'grafito',  cat:'light', bg: '#41505d', surface: '#394656', sidebar: '#4e5e6b', card: '#586875', preview: ['#41505d','#4e5e6b','#586875'] },
  { tKey: 'themeKhaki',      value: 'caqui',    cat:'light', bg: '#686045', sidebar: '#766e53', surface: '#5b543b', card: '#776f55', preview: ['#686045','#766e53','#776f55'] },
  { tKey: 'themeMauve',      value: 'malva',    cat:'light', bg: '#5b4151', sidebar: '#694f5f', surface: '#513744', card: '#775c6f', preview: ['#5b4151','#694f5f','#775c6f'] },
  { tKey: 'themeJade',       value: 'jade',     cat:'light', bg: '#33654f', sidebar: '#3f745d', surface: '#2d5a46', card: '#437860', preview: ['#33654f','#3f745d','#437860'] },
  { tKey: 'themeAsh',        value: 'ceniza',   cat:'light', bg: '#4b5057', surface: '#43484f', sidebar: '#595e65', card: '#63686f', preview: ['#4b5057','#595e65','#63686f'] },

  // ── Oscuros nuevos ──
  { tKey: 'themeCosmos',     value: 'cosmos',   bg: '#080612', sidebar: '#0e0c1e', surface: '#120f26', card: '#171330', preview: ['#080612','#0e0c1e','#171330'] },
  { tKey: 'themeEspresso',   value: 'espresso', bg: '#0a0705', sidebar: '#120e08', surface: '#18120a', card: '#1e160c', preview: ['#0a0705','#120e08','#1e160c'] },
  { tKey: 'themeCenote',     value: 'cenote',   bg: '#04090f', sidebar: '#07131e', surface: '#091828', card: '#0c1e32', preview: ['#04090f','#07131e','#0c1e32'] },
  { tKey: 'themeMagma',      value: 'magma',    bg: '#0e0504', sidebar: '#1a0806', surface: '#200a07', card: '#260d09', preview: ['#0e0504','#1a0806','#260d09'] },
  { tKey: 'themeArcade',     value: 'arcade',   bg: '#060610', sidebar: '#0c0c1e', surface: '#0f0f26', card: '#13132e', preview: ['#060610','#0c0c1e','#13132e'] },
  { tKey: 'themeWetAsphalt', value: 'asfalto',  bg: '#07090c', sidebar: '#0e1014', surface: '#13151a', card: '#181a20', preview: ['#07090c','#0e1014','#181a20'] },
  { tKey: 'themeBlueHour', value: 'hora-azul', bg: '#101722', sidebar: '#141e2c', surface: '#1a2738', card: '#223247' },
  { tKey: 'themeDarkFir', value: 'abeto', bg: '#101b18', sidebar: '#14231e', surface: '#1b2c26', card: '#24392f' },
  { tKey: 'themeAubergine', value: 'berenjena', bg: '#1b1420', sidebar: '#241b2c', surface: '#2c2236', card: '#392c44' },
  { tKey: 'themeBlackTea', value: 'te-negro', bg: '#1c1814', sidebar: '#26201b', surface: '#302821', card: '#3e3329' },
  { tKey: 'themeDeepFjord', value: 'fiordo', bg: '#101c21', sidebar: '#14262d', surface: '#1b3038', card: '#233f48' },
  { tKey: 'themeVolcanic', value: 'volcanico', bg: '#1b1a1d', sidebar: '#242328', surface: '#2e2c33', card: '#3a3740' },
  { tKey: 'themeLinen', value: 'lino', cat: 'mono', bg: '#b2aca1', sidebar: '#a39c90', surface: '#beb7ac', card: '#c9c3b8' },
  { tKey: 'themeSeaGlass', value: 'vidrio-marino', cat: 'mono', bg: '#a0afa9', sidebar: '#909f99', surface: '#adbab4', card: '#bbc7c1' },
  { tKey: 'themeBluePorcelain', value: 'porcelana-azul', cat: 'mono', bg: '#a5aeba', sidebar: '#939eae', surface: '#b1bac6', card: '#bfc7d1' },
  { tKey: 'themeOat', value: 'avena', cat: 'mono', bg: '#b5ad9b', sidebar: '#a59c89', surface: '#c0b8a6', card: '#cbc3b2' },
  { tKey: 'themeRoseQuartz', value: 'cuarzo-rosa', cat: 'mono', bg: '#b1a4ad', sidebar: '#a1939e', surface: '#bdb0b9', card: '#c9bec6' },
  { tKey: 'themeEucalyptus', value: 'eucalipto', cat: 'mono', bg: '#a7afa0', sidebar: '#959f8e', surface: '#b3bbac', card: '#c1c9ba' },
]
