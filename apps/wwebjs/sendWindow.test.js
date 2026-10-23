// Ejecuta el handler real aislado: sin servidor, navegador ni WhatsApp.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
const route = source.slice(source.indexOf("app.post('/session/:id/send',"), source.indexOf("app.post('/session/:id/send-media',"))

async function simulate({ remaining = 500, typingMs = 1000, withDeadline = true, invalid = false,
                          providerResult = { id: { _serialized: 'fake' } } } = {}) {
  let now = Date.parse('2026-10-15T01:00:00Z') - remaining
  const deadline = now + remaining
  let sends = 0
  const session = { status: 'connected', client: {
    getNumberId: async () => ({ _serialized: 'qa@c.us' }),
    pupPage: { evaluate: async () => {} },
    sendMessage: async () => { sends++; return providerResult },
  } }
  let handler
  vm.runInNewContext(route, {
    providerMessageId: require('./messageIdentity').messageId,
    withTypingPresence: (client, id, ms, fn) => require('./typingPresence').withTypingPresence(client, id, ms, fn, async delay => { if (typeof now !== 'undefined') now += delay }),
    lineActivity: { wrap: (_, fn) => fn },
    app: { post: (_, fn) => { handler = fn } }, sessions: new Map([['qa', session]]),
    Date: class extends Date { static now() { return now } }, Math,
    setTimeout: (fn, ms) => { now += ms; fn() }, console: { log() {}, error() {} },
  })
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await handler({ params: { id: 'qa' }, body: {
    to: '525500000001', message: 'información?', typingMs,
    ...(withDeadline ? { sendBefore: invalid ? 'invalid' : new Date(deadline).toISOString() } : {}),
  } }, res)
  return { sends, res }
}

test('cierre durante el typing bloquea el envío real', async () => {
  const { sends, res } = await simulate()
  assert.equal(sends, 0)
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.code, 'SEND_WINDOW_CLOSED')
})
test('una tarea que llega después del cierre se rechaza', async () => {
  const { sends, res } = await simulate({ remaining: -1 })
  assert.equal(sends, 0)
  assert.equal(res.statusCode, 409)
})
test('dentro del horario conserva el envío', async () => {
  const { sends, res } = await simulate({ remaining: 60000 })
  assert.equal(sends, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.messageId, 'fake')
})

test('el handler conserva el ID actual sin _serialized y no repite un envío sin ID', async () => {
  const current = await simulate({ remaining: 60000, providerResult: { id: { id: '3EB-real-provider-id' } } })
  assert.equal(current.res.statusCode, 200)
  assert.equal(current.res.body.messageId, '3EB-real-provider-id')
  assert.equal(current.sends, 1)
  // Null represents a provider which accepted but omitted the model.
  const absent = await simulate({ remaining: 60000, providerResult: null })
  assert.equal(absent.res.statusCode, 200)
  assert.equal(absent.res.body.messageId, null)
  assert.equal(absent.sends, 1)
})
test('otros envíos sin deadline conservan su comportamiento', async () => {
  assert.equal((await simulate({ withDeadline: false })).sends, 1)
})
test('una fecha inválida no elimina la protección', async () => {
  const { sends, res } = await simulate({ invalid: true })
  assert.equal(sends, 0)
  assert.equal(res.statusCode, 400)
})
