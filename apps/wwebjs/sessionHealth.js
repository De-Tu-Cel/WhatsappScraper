const { withTimeout } = require('./sessionAsync')
const REAUTH_STATES = new Set(['UNPAIRED', 'UNPAIRED_IDLE', 'TOS_BLOCK', 'SMB_TOS_BLOCK', 'DEPRECATED_VERSION', 'PROXYBLOCK'])
// Estados normales y pasajeros de WhatsApp Web (reconectando su socket, abierto
// un momento en otro lado, etc.). Antes contaban como falla igual que un
// getState() colgado: dos seguidos (~35 s) recreaban el navegador y tres
// recreaciones en 15 min dejaban la línea en "error". Ahora se les da margen.
const TRANSIENT_STATES = new Set(['TIMEOUT', 'OPENING', 'PAIRING', 'CONFLICT'])
// Latidos seguidos en un estado pasajero antes de tratarlo como falla real.
// El latido corre cada 15–20 s: 4 ≈ 1 a 1.3 minutos sin volver a CONNECTED.
const TRANSIENT_LIMIT = 4

async function checkSessionHealth({ sessions, id, session, stopping = () => false, timeoutMs = 10000 }) {
  const current = () => !stopping() && sessions.get(id) === session && session.status === 'connected' && !session.client.lifecycleClosing
  if (!current() || session.heartbeatPending) return { kind: 'discarded' }
  session.heartbeatPending = true
  try {
    const state = await withTimeout(() => session.client.getState(), timeoutMs, 'getState()')
    if (!current()) return { kind: 'discarded' }
    if (state === 'CONNECTED') return { kind: 'healthy', state }
    if (REAUTH_STATES.has(state)) return { kind: 'attention', state }
    if (TRANSIENT_STATES.has(state)) return { kind: 'transient', state }
    return { kind: 'failed', state, error: `Unexpected connection state: ${String(state)}` }
  } catch (error) {
    return current() ? { kind: 'failed', error: error.message } : { kind: 'discarded' }
  } finally { session.heartbeatPending = false }
}

function createRecoveryBudget({ maxAttempts = 3, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const attempts = new Map()
  return {
    admit(id) {
      const time = now()
      const recent = (attempts.get(id) || []).filter(at => time - at < windowMs && time >= at)
      if (recent.length >= maxAttempts) return false
      recent.push(time); attempts.set(id, recent)
      return true
    },
  }
}

// Qué hacer con un resultado del latido, dado cuántos estados pasajeros van
// seguidos. 'wait' = no hacer nada todavía; 'failed' = cuenta como falla.
function heartbeatVerdict(health, transientStreak = 0, limit = TRANSIENT_LIMIT) {
  if (health.kind === 'healthy') return { verdict: 'healthy', transientStreak: 0 }
  if (health.kind !== 'transient') return { verdict: health.kind, transientStreak }
  const streak = transientStreak + 1
  return { verdict: streak < limit ? 'wait' : 'failed', transientStreak: streak }
}

module.exports = { checkSessionHealth, createRecoveryBudget, heartbeatVerdict, TRANSIENT_STATES, TRANSIENT_LIMIT }
