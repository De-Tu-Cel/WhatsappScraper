// Esquemas que Chrome entiende directo en --proxy-server. HTTP con usuario y
// contraseña pasa por el intermediario local (relayFor), que solo habla HTTP
// CONNECT; Chrome no sabe autenticarse en SOCKS. Por eso SOCKS/HTTPS solo sin
// credenciales — exactamente lo que funcionaba en producción (PROXY_SERVER
// global = socks5://…, 2026-10-19). La primera versión de esta validación
// rechazaba cualquier SOCKS y habría dejado sin arrancar a las sesiones que
// caen en ese proxy global.
const DIRECT_SCHEMES = new Set(['socks5', 'socks4', 'https'])

function normalizeProxy(proxy) {
  if (proxy == null) return null
  if (typeof proxy !== 'object' || typeof proxy.server !== 'string') throw Error('Invalid proxy')
  const match = /^(?:([a-z0-9]+):\/\/)?([\w.-]+):(\d{2,5})$/i.exec(proxy.server.trim())
  const scheme = (match?.[1] || 'http').toLowerCase()
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535 || (scheme !== 'http' && !DIRECT_SCHEMES.has(scheme))) {
    throw Error('Proxy no válido: usa host:puerto, http://host:puerto, o socks5://host:puerto sin usuario')
  }
  if ((proxy.username != null && typeof proxy.username !== 'string') ||
      (proxy.password != null && typeof proxy.password !== 'string') || (proxy.password && !proxy.username)) {
    throw Error('Invalid proxy credentials')
  }
  if (scheme !== 'http' && (proxy.username || proxy.password)) {
    throw Error(`Un proxy ${scheme.toUpperCase()} con usuario y contraseña no es compatible: Chrome no puede autenticarse en él. Usa un proxy HTTP o uno ${scheme.toUpperCase()} sin credenciales`)
  }
  const host = `${match[2]}:${Number(match[3])}`
  return { server: scheme === 'http' ? host : `${scheme}://${host}`, username: proxy.username || '', password: proxy.password || '' }
}

function launchKey(proxy, lean) {
  const p = normalizeProxy(proxy)
  return JSON.stringify([p ? [p.server, p.username, p.password] : null, Boolean(lean)])
}

function proxyForSession({ id, settings, loadError, globalProxy, required = false }) {
  if (loadError) throw Error('La configuración de proxies no se pudo leer; restaura el archivo antes de iniciar sesiones')
  const own = settings[id] || {}
  if ((required || own.proxy_required) && !own.proxy?.server) throw Error('Esta sesión requiere un proxy asignado antes de iniciar')
  return normalizeProxy(own.proxy?.server ? own.proxy : globalProxy)
}

module.exports = { normalizeProxy, launchKey, proxyForSession }
