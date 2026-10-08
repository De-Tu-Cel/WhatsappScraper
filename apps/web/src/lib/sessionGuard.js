// Safari en Mac (2026-10-07): al cerrar la tapa o dejar la pestaña atrás, el
// navegador congela la página. El setInterval y el setTimeout no corren, y al
// despertar —si la pestaña ya estaba al frente— a veces no hay
// visibilitychange. Estas cuentas usan la hora real, que sí avanza mientras
// la página está congelada.

export const INACTIVITY_MS = 30 * 60 * 1000
export const WARNING_MS = 3 * 60 * 1000
export const LAST_ACTIVITY_KEY = 'last_activity_at'

// Un salto mayor que esto, con un latido de 5 s, es la página que estuvo
// congelada, no un retraso normal del temporizador.
export const CLOCK_JUMP_MS = 15 * 1000

export function readLastActivity(storage) {
  try {
    const n = Number(storage.getItem(LAST_ACTIVITY_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function writeLastActivity(storage, now = Date.now()) {
  try { storage.setItem(LAST_ACTIVITY_KEY, String(now)) } catch {}
}

// Sin marca previa no se cierra: es la primera carga de esta regla.
export function inactivityLeft(lastActivity, now, timeout = INACTIVITY_MS) {
  if (!lastActivity) return timeout
  return timeout - (now - lastActivity)
}

export function clockJumped(lastTick, now, limit = CLOCK_JUMP_MS) {
  return now - lastTick > limit
}

// Safari a veces guarda la respuesta de /api/build-id aunque lleve no-store.
export function buildIdRequestUrl(now = Date.now()) {
  return `/api/build-id?t=${now}`
}

// location.reload() puede volver a pintar el HTML viejo desde la memoria.
// Una query nueva obliga a pedir el documento de esta versión.
export function versionReloadUrl(href, live) {
  const url = new URL(href, 'http://localhost')
  url.searchParams.set('_v', live)
  return `${url.pathname}${url.search}${url.hash}`
}

export function stripVersionParam(href) {
  const url = new URL(href, 'http://localhost')
  if (!url.searchParams.has('_v')) return null
  url.searchParams.delete('_v')
  const search = url.searchParams.toString()
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
}
