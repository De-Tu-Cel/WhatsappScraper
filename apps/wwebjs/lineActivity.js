// One owner per physical line. HTTP waiters are bounded; durable jobs remain in Mongo.
class ActivityDeferred extends Error {
  constructor(code) { super(code); this.code = code }
}

function workingHours(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', hour: 'numeric', hourCycle: 'h23',
  }).format(new Date(now)))
  return hour >= 8 && hour < 19
}

function lineKey(session, id) {
  let phone = String(session?.phone || session?.phoneNumber || '').replace(/\D/g, '')
  if (phone.length === 13 && phone.startsWith('521')) phone = '52' + phone.slice(3)
  return phone || id
}

function createLineActivity({ sessions, now = Date.now, maxWaitMs = 3000 } = {}) {
  const lines = new Map()
  let stopping = false
  function state(id) {
    const key = lineKey(sessions.get(id), id)
    if (!lines.has(key)) lines.set(key, { active: null, waiting: [], lastFinishedAt: null, deferred: 0 })
    return lines.get(key)
  }
  function snapshot(id) {
    const s = state(id)
    return { operation: s.active, queued: s.waiting.length, last_finished_at: s.lastFinishedAt,
      last_operation: s.lastOperation || null,
      deferred: s.deferred, automatic_allowed: workingHours(now()), start_hour: 8, end_hour: 19,
      timezone: 'America/Mexico_City' }
  }
  function check(req) {
    if (stopping) throw new ActivityDeferred('LINE_UNAVAILABLE')
    if (req.body?.automatic !== false && !workingHours(now())) throw new ActivityDeferred('SEND_WINDOW_CLOSED')
    if (req.body?.sendBefore !== undefined) {
      const deadline = Date.parse(req.body.sendBefore)
      if (!Number.isFinite(deadline)) throw new ActivityDeferred('INVALID_SEND_DEADLINE')
      if (now() >= deadline) throw new ActivityDeferred('SEND_WINDOW_CLOSED')
    }
    if (req.aborted) throw new ActivityDeferred('ACTIVITY_CANCELLED')
  }
  async function acquire(s) {
    if (!s.active) { s.active = 'reserved'; return }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null }
      waiter.timer = setTimeout(() => {
        s.waiting = s.waiting.filter(w => w !== waiter)
        reject(new ActivityDeferred('LINE_BUSY'))
      }, maxWaitMs)
      s.waiting.push(waiter)
    })
  }
  function release(s) {
    const next = s.waiting.shift()
    if (next) { clearTimeout(next.timer); s.active = 'reserved'; next.resolve() }
    else s.active = null
  }
  function wrap(operation, handler, { manual = false } = {}) {
    return async (req, res) => {
      const s = state(req.params.id)
      const generation = sessions.get(req.params.id)
      let owned = false
      // Manual-only routes (history/profile edits) cannot be invoked by background workers.
      if (manual) req.body = { ...req.body, automatic: false }
      try {
        check(req)
        await acquire(s); owned = true
        check(req) // A queued request may cross closing time.
        s.active = operation
        req.checkLineActivity = () => {
          check(req)
          if (res.destroyed) throw new ActivityDeferred('ACTIVITY_CANCELLED')
          if (generation && (sessions.get(req.params.id) !== generation || generation.status !== 'connected' || generation.client?.lifecycleClosing)) {
            throw new ActivityDeferred('LINE_UNAVAILABLE')
          }
        }
        req.checkLineActivity()
        return await handler(req, res)
      } catch (error) {
        if (!(error instanceof ActivityDeferred)) throw error
        s.deferred++
        if (!res.destroyed && !res.headersSent) {
          return res.status(error.code === 'INVALID_SEND_DEADLINE' ? 400 : 409)
            .json({ code: error.code, error: error.message, retryable: error.code !== 'INVALID_SEND_DEADLINE' })
        }
      } finally {
        // Never release on socket close while the actual operation is still in flight.
        if (owned) { s.lastOperation = operation; s.lastFinishedAt = new Date(now()).toISOString(); release(s) }
      }
    }
  }
  async function runBackground(id, operation, fn) {
    const s = state(id)
    if (stopping || !workingHours(now()) || s.active) return false
    s.active = operation
    try { await fn(); return true }
    finally { s.lastOperation = operation; s.lastFinishedAt = new Date(now()).toISOString(); release(s) }
  }
  async function drain(id, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs
    while (state(id).active) {
      if (Date.now() >= deadline) throw new ActivityDeferred('LINE_BUSY')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  return { wrap, snapshot, runBackground, drain, stop: () => { stopping = true } }
}

module.exports = { createLineActivity, workingHours, lineKey, ActivityDeferred }
