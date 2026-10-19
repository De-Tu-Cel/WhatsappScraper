const { test } = require('node:test')
const assert = require('node:assert/strict')
const { verifyRegistration } = require('./numberVerification')
const fs = require('node:fs')
const vm = require('node:vm')
const { createLineActivity } = require('./lineActivity')

function endpoint(status, client, hour = 18) {
  const source = fs.readFileSync(require.resolve('./index.js'), 'utf8')
  const start = source.indexOf("app.post('/session/:id/verify'")
  const end = source.indexOf('// Save a contact', start)
  let handler
  const sessions = new Map([['qa', { status, phone: '525500000001', client }]])
  const gate = createLineActivity({ sessions, now: () => Date.parse(`2026-10-16T${String(hour).padStart(2, '0')}:00:00Z`) })
  vm.runInNewContext(source.slice(start, end), {
    app: { post(path, fn) { handler = fn } }, sessions, lineActivity: gate,
    require: name => { assert.equal(name, './numberVerification'); return { verifyRegistration } },
    console: { log() {} },
  })
  return handler
}

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } })

test('confirms actual client invocations, timing and request correlation without logging target', async () => {
  const events = [], calls = []
  const client = { async isRegisteredUser(jid) { calls.push(jid); return true }, async getNumberId(digits) { calls.push(digits); return { _serialized: 'jid' } } }
  const result = await verifyRegistration(client, '525500000001', { requestId: 'a'.repeat(32), now: () => '2026-10-16T18:00:00Z', onEvent: e => events.push(e) })
  assert.equal(calls.length, 2)
  assert.equal(result.registered, true)
  assert.equal(result.verification.lookup_started, true)
  assert.equal(result.verification.client_calls, 2)
  assert.equal(result.verification.request_id, 'a'.repeat(32))
  assert.deepEqual(events.map(e => e.event), ['verification_started', 'verification_finished'])
  assert.equal(JSON.stringify(events).includes('525500000001'), false)
})

test('negative response is one client call and a completed negative, not an error', async () => {
  const result = await verifyRegistration({ async isRegisteredUser() { return false }, async getNumberId() { assert.fail('Must not call') } }, '525500000001')
  assert.equal(result.registered, false)
  assert.equal(result.verification.client_calls, 1)
  assert.equal(result.verification.outcome, 'not_registered')
  assert.ok(result.verification.finished_at)
})

test('client failure still confirms lookup started and records terminal event', async () => {
  const events = []
  await assert.rejects(verifyRegistration({ async isRegisteredUser() { throw new Error('private target') } }, '525500000001', { onEvent: e => events.push(e) }), error => {
    assert.equal(error.verification.lookup_started, true)
    assert.equal(error.verification.outcome, 'error')
    return true
  })
  assert.equal(events.length, 2)
  assert.equal(JSON.stringify(events).includes('private target'), false)
})

test('actual HTTP route confirms disconnected rejection without touching WhatsApp', async () => {
  const handler = endpoint('need_scan', { async isRegisteredUser() { assert.fail('No lookup expected') } })
  const res = response()
  await handler({ params: { id: 'qa' }, body: { phone: '525500000002', requestId: 'a'.repeat(32) } }, res)
  // The shared gate may reject before the route; both mean no lookup began.
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'LINE_UNAVAILABLE')
})

test('actual HTTP route forwards correlation and lookup evidence on success', async () => {
  const handler = endpoint('connected', { async isRegisteredUser() { return false } })
  const res = response()
  await handler({ params: { id: 'qa' }, body: { phone: '+525500000002', requestId: 'a'.repeat(32) } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.registered, false)
  assert.equal(res.body.verification.lookup_started, true)
  assert.equal(res.body.verification.request_id, 'a'.repeat(32))
})

test('actual HTTP route preserves started evidence on client failure', async () => {
  const handler = endpoint('connected', { async isRegisteredUser() { throw new Error('private-phone') } })
  const res = response()
  await handler({ params: { id: 'qa' }, body: { phone: '+525500000002' } }, res)
  assert.equal(res.statusCode, 500)
  assert.equal(res.body.verification.lookup_started, true)
  assert.equal(res.body.error, 'Verification failed')
})

test('actual HTTP route cannot start a verification outside working hours', async () => {
  const handler = endpoint('connected', { async isRegisteredUser() { assert.fail('No lookup expected') } }, 4)
  const res = response()
  await handler({ params: { id: 'qa' }, body: { phone: '+525500000002' } }, res)
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'SEND_WINDOW_CLOSED')
})
