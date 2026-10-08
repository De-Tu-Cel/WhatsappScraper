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

module.exports = {
  HEARTBEAT_STAMPEDE_MS,
  LAUNCH_GAP_MS,
  recordHeartbeatFailure,
  stampedeSessionIds,
  isTransientInitError,
  reserveLaunch,
}
