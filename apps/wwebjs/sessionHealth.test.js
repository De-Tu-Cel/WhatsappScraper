const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkSessionHealth, createRecoveryBudget, heartbeatVerdict } = require('./sessionHealth')
const { queueSessionRecovery, readyWatchdogMs, canExtendReadyWatchdog, READY_HARD_LIMIT_MS } = require('./sessionRecovery')
const { withTimeout } = require('./sessionAsync')
const { shutdownSessions } = require('./sessionLifecycle')
const { withTypingPresence } = require('./typingPresence')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function setup(state) {
  const session = { status: 'connected', client: { getState: async () => state } }
  return { session, sessions: new Map([['a', session]]), id: 'a', timeoutMs: 10 }
}

test('only CONNECTED counts as a healthy heartbeat; WhatsApp Web reconnect states are transient', async () => {
  assert.equal((await checkSessionHealth(setup('CONNECTED'))).kind, 'healthy')
  for (const state of [null, undefined, 'SOMETHING_NEW']) {
    assert.equal((await checkSessionHealth(setup(state))).kind, 'failed', String(state))
  }
  for (const state of ['TIMEOUT', 'OPENING', 'PAIRING', 'CONFLICT']) {
    const result = await checkSessionHealth(setup(state))
    assert.equal(result.kind, 'transient', state); assert.equal(result.state, state)
  }
})

test('a transient state only becomes a failure after several heartbeats in a row', () => {
  let streak = 0, verdicts = []
  for (let i = 0; i < 5; i++) {
    const v = heartbeatVerdict({ kind: 'transient', state: 'TIMEOUT' }, streak)
    streak = v.transientStreak; verdicts.push(v.verdict)
  }
  assert.deepEqual(verdicts, ['wait', 'wait', 'wait', 'failed', 'failed'])
  // Volver a CONNECTED reinicia la cuenta: un TIMEOUT suelto después vuelve a esperar.
  const healthy = heartbeatVerdict({ kind: 'healthy' }, streak)
  assert.deepEqual(healthy, { verdict: 'healthy', transientStreak: 0 })
  assert.equal(heartbeatVerdict({ kind: 'transient' }, healthy.transientStreak).verdict, 'wait')
  // Las fallas duras y los estados de reautenticación no esperan.
  assert.equal(heartbeatVerdict({ kind: 'failed' }, 0).verdict, 'failed')
  assert.equal(heartbeatVerdict({ kind: 'attention' }, 0).verdict, 'attention')
})

test('boot limit grows with sessions starting at the same time, up to a cap', () => {
  assert.equal(readyWatchdogMs(0), 180000)
  assert.equal(readyWatchdogMs(5), 180000 + 5 * 30000)
  assert.equal(readyWatchdogMs(50), 180000 + 180000)
})

test('loading progress extends the boot limit only while starting and within the hard limit', () => {
  const t0 = 1_000_000
  assert.equal(canExtendReadyWatchdog('initializing', t0, t0 + 60_000), true)
  assert.equal(canExtendReadyWatchdog('authenticated', t0, t0 + 9 * 60_000), true)
  assert.equal(canExtendReadyWatchdog('authenticated', t0, t0 + READY_HARD_LIMIT_MS), false)
  for (const status of ['connected', 'need_scan', 'error']) assert.equal(canExtendReadyWatchdog(status, t0, t0 + 1000), false)
})

test('actual recovery with an invalid proxy reports it and never tears down the browser', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const start = source.indexOf('function reportProxyProblem('), end = source.indexOf('function startLivenessHeartbeat(', start)
  const session = { status: 'connected', heartbeatTimer: 1, profileSyncTimer: 2 }
  const sessions = new Map([['a', session]])
  const webhooks = [], calls = { destroy: 0, create: 0, budget: 0 }
  const ctx = {
    queueSessionRecovery, _startLocks: new Map(), sessions, scheduleAutoLaunch: fn => fn(), _shuttingDown: false,
    sessionRegistry: { disabled: () => false }, clearInterval() {},
    proxyFor: () => { throw Error('Solo se admite proxy HTTP') },
    recoveryBudget: { admit: () => { calls.budget++; return true } },
    forwardWebhook: payload => webhooks.push(payload),
    destroySessionClient: async () => { calls.destroy++ }, createClient: () => { calls.create++ },
    console: { error() {}, warn() {}, log() {} },
  }
  vm.runInNewContext(source.slice(start, end) + "\nresult = recoverSession('a', session, () => true)", Object.assign(ctx, { session }))
  assert.equal(await ctx.result, false)
  assert.deepEqual(calls, { destroy: 0, create: 0, budget: 0 })
  assert.equal(session.status, 'error')
  // JSON: los objetos vienen de otro contexto vm (otro prototipo de Object).
  assert.equal(JSON.stringify(webhooks.map(w => w.data)), JSON.stringify([{ status: 'error', reason: 'PROXY_INVALID' }]))
})

test('revocation and provider restrictions require attention rather than automatic reactivation', async () => {
  for (const state of ['UNPAIRED', 'UNPAIRED_IDLE', 'TOS_BLOCK', 'SMB_TOS_BLOCK', 'DEPRECATED_VERSION', 'PROXYBLOCK']) {
    const result = await checkSessionHealth(setup(state))
    assert.equal(result.kind, 'attention'); assert.equal(result.state, state)
  }
})

test('heartbeat discards both success and failure from a replaced generation', async () => {
  for (const state of ['CONNECTED', 'TIMEOUT']) {
    const s = setup(), hold = deferred()
    s.session.client.getState = () => hold.promise
    const poll = checkSessionHealth(s)
    s.sessions.set('a', { status: 'connected' })
    hold.resolve(state)
    assert.equal((await poll).kind, 'discarded')
  }
})

test('overlapping heartbeats use one client call and hung calls become bounded failures', async () => {
  const s = setup(); let calls = 0
  s.session.client.getState = () => { calls++; return new Promise(() => {}) }
  const first = checkSessionHealth(s)
  assert.equal((await checkSessionHealth(s)).kind, 'discarded')
  assert.equal((await first).kind, 'failed')
  assert.equal(calls, 1); assert.equal(s.session.heartbeatPending, false)
})

test('shutdown and closing clients do not start new health calls', async () => {
  const s = setup('CONNECTED')
  s.stopping = () => true
  assert.equal((await checkSessionHealth(s)).kind, 'discarded')
  s.stopping = () => false; s.session.client.lifecycleClosing = true
  assert.equal((await checkSessionHealth(s)).kind, 'discarded')
})

test('recovery budget is per session, bounds flapping and expires without a restart', () => {
  let time = 0
  const budget = createRecoveryBudget({ maxAttempts: 3, windowMs: 100, now: () => time })
  for (let i = 0; i < 3; i++) assert.equal(budget.admit('a'), true)
  assert.equal(budget.admit('a'), false)
  assert.equal(budget.admit('b'), true)
  time = 101
  assert.equal(budget.admit('a'), true)
})

test('denied recovery never destroys the profile or creates another browser', async () => {
  const session = { status: 'disconnected' }; let calls = 0
  const result = await queueSessionRecovery({ locks: new Map(), sessions: new Map([['a', session]]),
    sessionId: 'a', session, schedule: fn => fn(), stopping: () => false,
    allowed: () => true, admit: () => false,
    destroy: async () => { calls++ }, create: () => { calls++ } })
  assert.equal(result, false); assert.equal(calls, 0)
})

test('a recovery waiting for its launch slot cannot block graceful shutdown', async () => {
  const session = { status: 'disconnected' }, sessions = new Map([['a', session]]), locks = new Map()
  let scheduled, stopping = false, closes = 0, launches = 0
  const recovery = queueSessionRecovery({ sessions, locks, sessionId: 'a', session,
    schedule: fn => { scheduled = fn }, stopping: () => stopping, allowed: () => true,
    destroy: async () => { closes++ }, create: () => { launches++ } })
  assert.equal(locks.has('a'), false)
  const result = await shutdownSessions({ sessions, locks, stopActivity: () => { stopping = true },
    close: async () => { closes++ }, timeoutMs: 100 })
  assert.equal(result.complete, true)
  await scheduled()
  assert.equal(await recovery, false)
  assert.equal(closes, 1); assert.equal(launches, 0)
})

test('hung presence cleanup cannot retain line ownership indefinitely or duplicate a send', async () => {
  let sends = 0
  const client = { sendPresenceAvailable: () => new Promise(() => {}), sendPresenceUnavailable: () => new Promise(() => {}) }
  const result = await withTypingPresence(client, 'dummy', 0, async () => { sends++; return 'sent' }, async () => {}, { timeoutMs: 5 })
  assert.equal(result.value, 'sent'); assert.equal(result.presence.offline, false)
  assert.equal(sends, 1)
})

test('auxiliary call timeouts preserve errors and do not retry the operation', async () => {
  let calls = 0
  await assert.rejects(withTimeout(() => { calls++; return new Promise(() => {}) }, 5, 'Test'), /Test timed out/)
  assert.equal(calls, 1)
  await assert.rejects(withTimeout(() => { throw Error('original') }, 100), /original/)
})

test('actual profile poll discards a changed picture from an old client generation', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const start = source.indexOf('function startProfileSyncPoll('), end = source.indexOf('// Some whatsapp-web.js', start)
  let poll, webhooks = 0
  const hold = deferred(), session = { status: 'connected', client: {}, lastPushname: 'old' }, sessions = new Map([['a', session]])
  vm.runInNewContext(source.slice(start, end) + "\nstartProfileSyncPoll('a')", {
    sessions, clearInterval() {}, setInterval: fn => { poll = fn }, _shuttingDown: false,
    lineActivity: { runBackground: (id, name, fn) => fn() }, fetchProfilePicUrl: () => hold.promise,
    forwardWebhook: () => { webhooks++ }, console: { log() {} },
  })
  const running = poll()
  sessions.set('a', { status: 'connected', client: {} })
  hold.resolve('dummy-picture')
  await running
  assert.equal(webhooks, 0)
})

test('actual boot watchdog recovers stalled initialization but never a QR, replaced or closing session', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const start = source.indexOf('function armReadyWatchdog('), end = source.indexOf('function createClient(', start)
  for (const mode of ['initializing', 'authenticated', 'need_scan', 'connected', 'error', 'closing', 'replaced']) {
    let timer, recoveries = 0, delay
    const session = { status: mode, client: { lifecycleClosing: mode === 'closing' } }, sessions = new Map([['a', session]])
    if (mode === 'replaced') sessions.set('a', { status: 'initializing' })
    vm.runInNewContext(source.slice(start, end) + "\narmReadyWatchdog('a', session, 180000)", {
      sessions, session, _shuttingDown: false, clearTimeout() {},
      setTimeout: (fn, ms) => { timer = fn; delay = ms }, console: { warn() {} },
      recoverSession: async () => { recoveries++ },
    })
    await timer()
    assert.equal(delay, 180000)
    assert.equal(session.readyWatchdogMs, 180000) // el evento loading_screen lo reutiliza
    assert.equal(recoveries, ['initializing', 'authenticated'].includes(mode) ? 1 : 0, mode)
  }
})
