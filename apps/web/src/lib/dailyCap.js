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
export function getOverBy(stats, selectionCount, newCount = selectionCount, { requireStats = false } = {}) {
  if (!selectionCount) return 0
  // Sin el cupo cargado no se puede saber si el lote cabe. En el envío de hoy
  // eso no es "sin límite": Antonio (2026-10-07) encoló 6 contactos nuevos con
  // gely-wa en warmup (tope 5) porque la pantalla no tenía el número y dejó
  // pasar todo. El servidor no debe ser el único que lo corta.
  if (!stats) return requireStats ? selectionCount : 0
  const totalOver = Math.max(0, selectionCount - (stats.total_available ?? 0))
  const ncOver = stats.new_contacts_capacity != null
    ? Math.max(0, newCount - stats.new_contacts_capacity)
    : 0
  return Math.max(totalOver, ncOver)
}

// Cuántos contactos nuevos del lote caben hoy. Si el cupo no cargó, no cabe
// ninguno: encolarlos y esperar a que el servidor los rechace fue lo que marcó
// Gas Express Nieto y Bochegas como fallidos sin haber salido.
export function fitNewContacts(newRows, stats, instanceOf = (row) => row?.assigned_instance) {
  const known = stats != null && stats.new_contacts_capacity != null
  const globalRoom = known ? Math.max(0, Number(stats.new_contacts_capacity) || 0) : 0
  const instCap = Object.fromEntries(
    (stats?.instances ?? []).map(inst => [inst.instance, inst.new_contacts_left ?? 0]),
  )
  const byInstance = {}
  const unassigned = []
  for (const row of newRows) {
    const inst = instanceOf(row)
    if (inst && instCap[inst] !== undefined) (byInstance[inst] ??= []).push(row)
    else unassigned.push(row)
  }
  let roomLeft = globalRoom
  const kept = []
  let trimmed = 0
  for (const [inst, rows] of Object.entries(byInstance)) {
    const cap = Math.min(instCap[inst] ?? 0, roomLeft)
    const take = rows.slice(0, cap)
    kept.push(...take)
    roomLeft -= take.length
    trimmed += rows.length - take.length
  }
  const unassignedCap = Math.min(roomLeft, unassigned.length)
  kept.push(...unassigned.slice(0, unassignedCap))
  trimmed += unassigned.length - unassignedCap
  return { kept, trimmed }
}

// Qué tope es el que no da: el de contactos nuevos o el de mensajes del día.
// El botón tiene que decir cuál, porque "desmarca para caber en el cupo" no
// explica que el calentamiento de Antonio (2026-10-07) corta en 5 aunque el
// número todavía pueda mandar más mensajes.
export function capOverflowKind(stats, selectionCount, newCount = selectionCount) {
  if (!stats || !selectionCount) return null
  const totalOver = Math.max(0, selectionCount - (stats.total_available ?? 0))
  const ncOver = stats.new_contacts_capacity != null
    ? Math.max(0, newCount - stats.new_contacts_capacity)
    : 0
  if (ncOver <= 0 && totalOver <= 0) return null
  if (ncOver > 0 && ncOver >= totalOver) return 'new'
  return 'daily'
}

// Recomendación personalizada de cómo distribuir envíos, calculada con las
// instancias reales del usuario — sin esto, el usuario no tiene forma de saber
// qué tan repartido (o concentrado) está su riesgo entre sus números.
export function buildRecommendation(stats, lang = 'es') {
  const en = lang === 'en'
  if (!stats) return ''
  if (!stats.instances) {
    return en
      ? "Estimated combined capacity for that date — can't be broken down by number until the day arrives."
      : 'Cupo estimado combinado para esa fecha — no se puede desglosar por número hasta que llegue el día.'
  }
  if (!stats.instances.length) {
    return en
      ? "You don't have any WhatsApp instances assigned — connect one to be able to send."
      : 'No tienes instancias de WhatsApp asignadas — conecta una para poder enviar.'
  }
  const warmup = stats.instances.filter(r => r.warmup_mode)
  const normal = stats.instances.filter(r => !r.warmup_mode)
  const tightest = [...stats.instances].sort((a, b) => a.available - b.available)[0]

  const parts = []
  if (warmup.length) parts.push(en ? `${warmup.length} in warmup (20/day each)` : `${warmup.length} en warmup (20/día c/u)`)
  if (normal.length) parts.push(en
    ? `${normal.length} normal${normal.length > 1 ? 's' : ''} (200/day each)`
    : `${normal.length} normal${normal.length > 1 ? 'es' : ''} (200/día c/u)`)
  let msg = en ? `You have ${parts.join(' and ')}.` : `Tienes ${parts.join(' y ')}.`
  if (stats.instances.length > 1) {
    msg += en
      ? ' Spread your sends across your numbers instead of concentrating them on just one.'
      : ' Reparte tus envíos entre tus números en vez de concentrarlos en uno solo.'
  }
  if (tightest && tightest.available < 30) {
    msg += en
      ? ` ${tightest.label} has the least capacity left today (${tightest.available} available) — avoid loading it further.`
      : ` ${tightest.label} es el que menos cupo tiene hoy (${tightest.available} disponibles) — evita cargarle más.`
  }
  return msg
}
