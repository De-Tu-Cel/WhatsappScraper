// Lógica pura de cupo diario, separada de DailyCapBadge.jsx (que tiene JSX) para
// poder testearla con el runner nativo de Node sin necesitar un transform/JSX loader.

// Cuántas empresas de la selección actual exceden el cupo disponible — exportado
// para que cada componente use el MISMO cálculo para bloquear su botón de enviar
// en vez de reimplementarlo por su cuenta. Funciona tanto con stats de "hoy"
// (total_available combinado) como con el cupo estimado de un día futuro — ambas
// formas exponen total_available.
// newCount: how many of the selected numbers are NEW contacts (not previously messaged).
// Defaults to selectionCount (conservative — treats all as new) for callers that
// don't track per-number history. MessageComposer passes the accurate value.
export function getOverBy(stats, selectionCount, newCount = selectionCount) {
  if (!stats || !selectionCount) return 0
  const totalOver = Math.max(0, selectionCount - stats.total_available)
  const ncOver = stats.new_contacts_capacity != null
    ? Math.max(0, newCount - stats.new_contacts_capacity)
    : 0
  return Math.max(totalOver, ncOver)
}

// Recomendación personalizada de cómo distribuir envíos, calculada con las
// instancias reales del usuario — sin esto, el usuario no tiene forma de saber
// qué tan repartido (o concentrado) está su riesgo entre sus números.
export function buildRecommendation(stats) {
  if (!stats) return ''
  if (!stats.instances) {
    return 'Cupo estimado combinado para esa fecha — no se puede desglosar por número hasta que llegue el día.'
  }
  if (!stats.instances.length) {
    return 'No tienes instancias de WhatsApp asignadas — conecta una para poder enviar.'
  }
  const warmup = stats.instances.filter(r => r.warmup_mode)
  const normal = stats.instances.filter(r => !r.warmup_mode)
  const tightest = [...stats.instances].sort((a, b) => a.available - b.available)[0]

  const parts = []
  if (warmup.length) parts.push(`${warmup.length} en warmup (20/día c/u)`)
  if (normal.length) parts.push(`${normal.length} normal${normal.length > 1 ? 'es' : ''} (200/día c/u)`)
  let msg = `Tienes ${parts.join(' y ')}.`
  if (stats.instances.length > 1) {
    msg += ' Reparte tus envíos entre tus números en vez de concentrarlos en uno solo.'
  }
  if (tightest && tightest.available < 30) {
    msg += ` ${tightest.label} es el que menos cupo tiene hoy (${tightest.available} disponibles) — evita cargarle más.`
  }
  return msg
}
