// 2026-10-07, 19:33 hora de México: gely-wa, marco-wa, sender666 y
// tania-sesion-1, -3 y -4 escribieron "getState() timed out" en el mismo
// milisegundo. El proceso estaba trabado, no eran seis sesiones muertas.
// El latido las mató juntas, Chrome no alcanzó a abrir y nadie lo reintentó.

const HEARTBEAT_STAMPEDE_MS = 2000
const LAUNCH_GAP_MS = 15000

function recordHeartbeatFailure(entries, sessionId, now, windowMs = HEARTBEAT_STAMPEDE_MS) {
  const fresh = (entries || []).filter((entry) => now - entry.at <= windowMs && now - entry.at >= 0)
  fresh.push({ sessionId, at: now })
  return fresh
}

function stampedeSessionIds(entries, now, windowMs = HEARTBEAT_STAMPEDE_MS) {
  const ids = []
  const seen = new Set()
  for (const entry of entries || []) {
    if (now - entry.at > windowMs || now - entry.at < 0) continue
    if (seen.has(entry.sessionId)) continue
    seen.add(entry.sessionId)
    ids.push(entry.sessionId)
  }
  return ids
}

function isTransientInitError(message) {
  const text = String(message || '')
  if (/net::ERR_/.test(text)) return true
  return /waiting for the WS endpoint URL/i.test(text)
}

function reserveLaunch(now, nextLaunchAt, gapMs = LAUNCH_GAP_MS) {
  const at = Math.max(now, nextLaunchAt || 0)
  return { delay: at - now, nextLaunchAt: at + gapMs }
}

// Límite del primer arranque: 3 min de base + 30 s por cada otra sesión que
// esté arrancando al mismo tiempo (compiten por CPU a través de su proxy), con
// tope de +3 min. Antes eran 3 min fijos: restaurar 6+ sesiones a la vez podía
// agotarlo sin que nada estuviera realmente trabado.
const READY_BASE_MS = 180000
function readyWatchdogMs(concurrentStarting = 0, baseMs = READY_BASE_MS, perSessionMs = 30000, maxExtraMs = 180000) {
  return baseMs + Math.min(Math.max(0, concurrentStarting) * perSessionMs, maxExtraMs)
}

// Mientras WhatsApp Web siga reportando avance (evento loading_screen) el
// límite se reinicia — solo se recupera una sesión que lleva todo el plazo SIN
// avanzar. Tope absoluto para no extenderlo para siempre.
const READY_HARD_LIMIT_MS = 10 * 60 * 1000
function canExtendReadyWatchdog(status, bootStartedAt, now = Date.now(), hardLimitMs = READY_HARD_LIMIT_MS) {
  return ['initializing', 'authenticated'].includes(status) && now - bootStartedAt < hardLimitMs
}

// Auditoría 2026-10-15: watchdog, latido y desconexión podían competir con
// /start por el mismo perfil de Chrome. Revalidar también después del cierre:
// mientras esperamos puede llegar un LOGOUT que exige un QR, no otro arranque.
function queueSessionRecovery({ locks, sessions, sessionId, session, schedule, destroy, create, allowed, stopping, admit = () => true }) {
  const eligible = () => !stopping() && sessions.get(sessionId) === session && allowed(session.status)
  // Waiting for a staggered launch must not hold the lifecycle lock. Otherwise
  // shutdown can spend its entire grace period waiting for a future timer.
  return new Promise((resolve, reject) => {
    schedule(() => {
      const prior = locks.get(sessionId) || Promise.resolve()
      const operation = prior.catch(() => {}).then(async () => {
        if (!eligible() || !admit(sessionId)) return false
        await destroy(session)
        if (!eligible()) return false
        sessions.delete(sessionId)
        create(sessionId, session.phoneNumber)
        return true
      })
      locks.set(sessionId, operation.catch(() => {}))
      operation.then(resolve, reject)
      return operation.catch(() => false)
    })
  })
}

module.exports = {
  HEARTBEAT_STAMPEDE_MS,
  LAUNCH_GAP_MS,
  recordHeartbeatFailure,
  stampedeSessionIds,
  isTransientInitError,
  reserveLaunch,
  queueSessionRecovery,
  readyWatchdogMs,
  canExtendReadyWatchdog,
  READY_HARD_LIMIT_MS,
}
