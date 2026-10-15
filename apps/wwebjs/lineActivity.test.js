const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createLineActivity, workingHours } = require('./lineActivity')
const noon = Date.parse('2026-10-15T18:00:00Z')
const request = (id = 'a', body = {}) => ({ params: { id }, body })
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } })
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(options = {}) {
  const sessions = new Map([['a', { phone: '5212228120419', status: 'connected' }], ['b', { phone: '525500000002', status: 'connected' }]])
  return { sessions, gate: createLineActivity({ sessions, now: () => noon, ...options }) }
}

test('automatic hours use CDMX boundaries regardless of server timezone', () => {
  for (const [time, expected] of [['13:59:59', false], ['14:00:00', true], ['00:59:59', true], ['01:00:00', false]]) {
    assert.equal(workingHours(Date.parse(`2026-10-15T${time}Z`)), expected, time)
  }
})

test('campaign, AI, verification and media share FIFO ownership on the same line', async () => {
  const { gate } = setup(); const hold = deferred(); const order = []; let active = 0, max = 0
  const run = name => gate.wrap(name, async () => { active++; max = Math.max(max, active); order.push(name); if (name === 'campaign') await hold.promise; active-- })(request(), response())
  const jobs = ['campaign', 'ai', 'verify', 'media'].map(run)
  await flush(); assert.deepEqual(order, ['campaign']); assert.equal(gate.snapshot('a').queued, 3)
  hold.resolve(); await Promise.all(jobs)
  assert.deepEqual(order, ['campaign', 'ai', 'verify', 'media']); assert.equal(max, 1)
})

test('separate physical lines work independently', async () => {
  const { gate } = setup(); const hold = deferred(); let other = false
  const first = gate.wrap('send', async () => hold.promise)(request('a'), response())
  await gate.wrap('verify', async () => { other = true })(request('b'), response())
  assert.equal(other, true); hold.resolve(); await first
})

test('52 and 521 aliases in different session IDs share the physical line lock', async () => {
  const { gate, sessions } = setup(); sessions.get('b').phone = '522228120419'
  const hold = deferred(); let second = false
  const first = gate.wrap('send', async () => hold.promise)(request('a'), response())
  const next = gate.wrap('verify', async () => { second = true })(request('b'), response())
  await flush(); assert.equal(second, false); hold.resolve(); await Promise.all([first, next]); assert.equal(second, true)
})

test('automatic calls at night never reach the handler, even without sendBefore', async () => {
  const { gate } = setup({ now: () => Date.parse('2026-10-16T09:00:00Z') }); let called = false; const res = response()
  await gate.wrap('send', async () => { called = true })(request(), res)
  assert.equal(called, false); assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'SEND_WINDOW_CLOSED')
})

test('explicit manual replies remain possible at night but still acquire ownership', async () => {
  const { gate } = setup({ now: () => Date.parse('2026-10-16T09:00:00Z') }); let called = false
  await gate.wrap('send', async () => { called = true; assert.equal(gate.snapshot('a').operation, 'send') })(request('a', { automatic: false }), response())
  assert.equal(called, true)
})

test('queued automatic call cannot start after closing time', async () => {
  let now = noon; const { gate } = setup({ now: () => now }); const hold = deferred(); let calls = 0
  const first = gate.wrap('send', async () => hold.promise)(request(), response())
  const res = response(); const next = gate.wrap('verify', async () => { calls++ })(request(), res)
  await flush(); now = Date.parse('2026-10-16T01:00:00Z'); hold.resolve(); await Promise.all([first, next])
  assert.equal(calls, 0); assert.equal(res.body.code, 'SEND_WINDOW_CLOSED')
})

test('bounded wait returns a safe retry signal and removes the waiter', async () => {
  const { gate } = setup({ maxWaitMs: 10 }); const hold = deferred(); let called = false
  const first = gate.wrap('send', async () => hold.promise)(request(), response()); const res = response()
  await gate.wrap('verify', async () => { called = true })(request(), res)
  assert.equal(called, false); assert.equal(res.body.code, 'LINE_BUSY'); assert.equal(gate.snapshot('a').queued, 0)
  hold.resolve(); await first
})

test('handler error releases ownership for the next operation', async () => {
  const { gate } = setup()
  await assert.rejects(gate.wrap('send', async () => { throw Error('mock failure') })(request(), response()))
  await gate.wrap('verify', async () => {})(request(), response())
  assert.equal(gate.snapshot('a').operation, null)
})

test('client disconnect never unlocks an operation that is still running', async () => {
  const { gate } = setup(); const hold = deferred(); const res = response(); const req = request()
  const first = gate.wrap('send', async () => hold.promise)(req, res)
  await flush(); res.destroyed = true
  assert.equal(gate.snapshot('a').operation, 'send'); hold.resolve(); await first
  assert.equal(gate.snapshot('a').operation, null)
})

test('disconnected or replaced sessions cannot start a queued operation', async () => {
  const { gate, sessions } = setup(); const hold = deferred(); let called = false
  const first = gate.wrap('send', async () => hold.promise)(request(), response())
  const res = response(); const next = gate.wrap('verify', async () => { called = true })(request(), res)
  await flush(); sessions.set('a', { phone: '522228120419', status: 'connected' }); hold.resolve(); await Promise.all([first, next])
  assert.equal(called, false); assert.equal(res.body.code, 'LINE_UNAVAILABLE')
})

test('profile and presence background work shares the lock and rests at night', async () => {
  let now = noon; const { gate } = setup({ now: () => now }); const hold = deferred(); let called = false
  const first = gate.runBackground('a', 'profile-sync', async () => hold.promise)
  assert.equal(await gate.runBackground('a', 'presence', async () => { called = true }), false)
  hold.resolve(); await first; now = Date.parse('2026-10-16T09:00:00Z')
  assert.equal(await gate.runBackground('a', 'presence', async () => { called = true }), false); assert.equal(called, false)
})

test('real send handler is serialized and cannot send after its composing delay crosses 19:00', async () => {
  let now = noon, active = 0, max = 0, sends = 0, handler
  const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
  const route = source.slice(source.indexOf("app.post('/session/:id/send',"), source.indexOf("app.post('/session/:id/send-media',"))
  const { sessions, gate } = setup({ now: () => now }); const hold = deferred()
  sessions.get('a').client = { getNumberId: async () => ({ _serialized: 'mock@c.us' }), pupPage: { evaluate: async () => {} },
    sendMessage: async () => { sends++; active++; max = Math.max(max, active); if (sends === 1) await hold.promise; active--; return { id: { _serialized: 'mock' } } } }
  vm.runInNewContext(route, { lineActivity: gate, app: { post: (_, fn) => { handler = fn } }, sessions, Math,
    Date: class extends Date { static now() { return now } }, setTimeout: (fn, ms) => { now += ms; fn() }, console: { log() {}, error() {} } })
  const req = typingMs => request('a', { to: '525500000001', message: 'isolated', typingMs })
  const first = handler(req(0), response()); const next = handler(req(0), response())
  await flush(); assert.equal(sends, 1); hold.resolve(); await Promise.all([first, next]); assert.equal(max, 1)
  now = Date.parse('2026-10-16T00:59:59Z'); sessions.get('a').lastSendAt = 0; const res = response()
  await handler(req(2000), res); assert.equal(sends, 2); assert.equal(res.body.code, 'SEND_WINDOW_CLOSED')
})
