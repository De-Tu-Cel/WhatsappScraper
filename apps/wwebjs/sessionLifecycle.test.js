const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createSessionRegistry, restoreSession, serializeSession, closeBrowserProfile,
  shutdownSessions } = require('./sessionLifecycle')
const { createLineActivity } = require('./lineActivity')
const vm = require('node:vm')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
const quick = { initMs: 10, closeMs: 10, exitMs: 10 }

async function storage(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lifecycle-test-'))
  try { await fn(root, createSessionRegistry(root)) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('disabled instances survive registry reload without deleting their credentials', async () => storage(async (root, registry) => {
  fs.mkdirSync(path.join(root, 'session-a'))
  fs.writeFileSync(path.join(root, 'session-a', 'dummy-auth'), 'test-only')
  registry.disable('a')
  assert.deepEqual(createSessionRegistry(root).profiles(), [])
  assert.equal(fs.readFileSync(path.join(root, 'session-a', 'dummy-auth'), 'utf8'), 'test-only')
  registry.enable('a')
  assert.deepEqual(createSessionRegistry(root).profiles(), ['a'])
}))

test('profile enumeration excludes files, symlinks and invalid IDs', async () => storage(async (root, registry) => {
  fs.mkdirSync(path.join(root, 'session-good'))
  fs.mkdirSync(path.join(root, 'session-bad.id'))
  fs.writeFileSync(path.join(root, 'session-file'), '')
  if (process.platform !== 'win32') fs.symlinkSync(path.join(root, 'session-good'), path.join(root, 'session-link'))
  assert.deepEqual(registry.profiles(), ['good'])
  assert.throws(() => registry.disable('../escape'), /Invalid session/)
}))

function restoreOptions(registry) {
  const locks = new Map(), sessions = new Map(), calls = []
  return { locks, sessions, registry, id: 'a', stopping: () => false,
    prepare: async () => { calls.push('prepare') },
    create: id => { calls.push('create'); sessions.set(id, { status: 'initializing' }) }, calls }
}

test('boot restoration and manual start share ownership and only create once', async () => storage(async (root, registry) => {
  const s = restoreOptions(registry)
  const hold = deferred()
  const manual = serializeSession(s.locks, 'a', async () => { await hold.promise; s.create('a') })
  const automatic = restoreSession(s)
  hold.resolve()
  await manual
  assert.equal(await automatic, false)
  assert.deepEqual(s.calls, ['create'])
}))

test('two simultaneous restores create one browser', async () => storage(async (root, registry) => {
  const s = restoreOptions(registry)
  assert.deepEqual(await Promise.all([restoreSession(s), restoreSession(s)]), [true, false])
  assert.deepEqual(s.calls, ['prepare', 'create'])
}))

test('deletion and shutdown cancel an already queued boot restore', async () => storage(async (root, registry) => {
  for (const reason of ['deleted', 'stopping']) {
    registry.enable('a')
    const s = restoreOptions(registry), hold = deferred()
    let stopping = false
    s.stopping = () => stopping
    s.locks.set('a', hold.promise)
    const restore = restoreSession(s)
    if (reason === 'deleted') registry.disable('a')
    else stopping = true
    hold.resolve()
    assert.equal(await restore, false)
    assert.deepEqual(s.calls, [])
  }
}))

function processStub() {
  const p = new EventEmitter()
  p.exitCode = null; p.signalCode = null
  p.kill = () => { p.killed = true }
  return p
}

test('a kill request is insufficient: profile locks remain until the exit event', async () => {
  const p = processStub(), exits = deferred(); let cleared = false
  p.kill = () => { p.killed = true; exits.resolve() }
  const client = { pupBrowser: { process: () => p }, destroy: async () => {} }
  const closing = closeBrowserProfile(client, null, () => { cleared = true }, { ...quick, exitMs: 1000 })
  await exits.promise
  assert.equal(cleared, false)
  p.signalCode = 'SIGKILL'; p.emit('exit')
  await closing
  assert.equal(cleared, true)
})

test('an unconfirmed process exit refuses profile reuse, even if killed is true', async () => {
  const p = processStub(); p.killed = true
  let cleared = false
  await assert.rejects(closeBrowserProfile({ pupBrowser: { process: () => p }, destroy: async () => {} },
    null, () => { cleared = true }, quick), /exit not confirmed/)
  assert.equal(cleared, false)
  assert.equal(p.listenerCount('exit'), 0)
})

test('initialization that finishes late is closed and never unlocks a pending launch', async () => {
  const init = deferred(); let destroys = 0, cleared = false
  await assert.rejects(closeBrowserProfile({ destroy: async () => { destroys++ } }, init.promise,
    () => { cleared = true }, quick), /launch still pending/)
  assert.equal(cleared, false)
  init.resolve(); await tick()
  assert.equal(destroys, 2)
})

test('a browser created during the initialization wait must exit before removing its locks', async () => {
  const init = deferred(), firstClose = deferred(), p = processStub()
  let destroys = 0, cleared = false
  const client = { destroy: async () => {
    destroys++
    if (destroys === 1) { firstClose.resolve(); return }
    p.exitCode = 0
  } }
  const closing = closeBrowserProfile(client, init.promise, () => {
    assert.equal(p.exitCode, 0); cleared = true
  }, { ...quick, exitMs: 1000 })
  await firstClose.promise
  client.pupBrowser = { process: () => p }
  init.resolve()
  await closing
  assert.equal(destroys, 2)
  assert.equal(cleared, true)
})

test('graceful closure preserves locks on destroy errors without a verifiable browser', async () => {
  let cleared = false
  await assert.rejects(closeBrowserProfile({ destroy: async () => { throw Error('failed') } }, null,
    () => { cleared = true }, quick), /closure not confirmed/)
  assert.equal(cleared, false)
})

test('normal browser exit and initialization completion permit profile reuse', async () => {
  const p = processStub(); let cleared = false
  await closeBrowserProfile({ pupBrowser: { process: () => p }, destroy: async () => { p.exitCode = 0 } },
    Promise.resolve(), () => { cleared = true }, quick)
  assert.equal(cleared, true)
})

test('shutdown drains active sends and rejects queued/new work before closing the profile', async () => {
  const sessions = new Map([['a', { phone: '525500000001', status: 'connected' }]])
  const gate = createLineActivity({ sessions }), hold = deferred(); let sends = 0, closed = false
  const request = { params: { id: 'a' }, body: { automatic: false } }
  const response = () => ({ status() { return this }, json() {} })
  const send = gate.wrap('send', async () => { sends++; await hold.promise })
  const first = send(request, response())
  await tick()
  const queued = send(request, response())
  const shutdown = shutdownSessions({ sessions, locks: new Map(), stopActivity: gate.stop,
    close: async () => { await gate.drain('a'); closed = true }, timeoutMs: 1000 })
  await tick(); assert.equal(closed, false)
  await send(request, response())
  hold.resolve(); await Promise.all([first, queued])
  assert.equal((await shutdown).complete, true)
  assert.equal(sends, 1); assert.equal(closed, true)
})

test('shutdown reports incomplete closure rather than silently succeeding', async () => {
  const sessions = new Map([['a', {}]])
  assert.equal((await shutdownSessions({ sessions, locks: new Map(), stopActivity() {},
    close: async () => { throw Error('not closed') } })).complete, false)
  assert.equal((await shutdownSessions({ sessions, locks: new Map(), stopActivity() {},
    close: () => new Promise(() => {}), timeoutMs: 10 })).complete, false)
})

test('actual DELETE route persists the disabled marker even when no browser exists', async () => storage(async (root, registry) => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const route = source.slice(source.indexOf("app.delete('/session/:id',"), source.indexOf("app.get('/sessions',"))
  let handler, status = 200, body
  vm.runInNewContext(route, { sessionRegistry: registry, _startLocks: new Map(), sessions: new Map(),
    app: { delete: (url, fn) => { handler = fn } },
  })
  await handler({ params: { id: 'a' } }, {
    status(value) { status = value; return this }, json(value) { body = value },
  })
  assert.equal(status, 200)
  assert.equal(body.success, true)
  assert.equal(createSessionRegistry(root).disabled('a'), true)
}))

test('actual DELETE route preserves the instance and its marker when browser closure fails', async () => storage(async (root, registry) => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const route = source.slice(source.indexOf("app.delete('/session/:id',"), source.indexOf("app.get('/sessions',"))
  let handler, status = 200, relaysClosed = 0
  const sessions = new Map([['a', { client: {} }]])
  vm.runInNewContext(route, { sessionRegistry: registry, _startLocks: new Map(), sessions,
    clearInterval() {}, clearTimeout() {},
    destroySessionClient: async () => { throw Error('exit not confirmed') },
    closeRelay: () => { relaysClosed++ }, app: { delete: (url, fn) => { handler = fn } },
  })
  await handler({ params: { id: 'a' } }, { status(value) { status = value; return this }, json() {} })
  assert.equal(status, 500)
  assert.equal(registry.disabled('a'), true)
  assert.equal(sessions.has('a'), true)
  assert.equal(relaysClosed, 0)
}))
