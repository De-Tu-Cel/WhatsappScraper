const B = process.env.BACKEND_URL || 'http://localhost:8000'
const STARTUP_TIMEOUT_MS = 20_000

export function backendFetch(path, opts = {}) {
  return fetch(`${B}${path}`, { signal: AbortSignal.timeout(STARTUP_TIMEOUT_MS), ...opts })
}
