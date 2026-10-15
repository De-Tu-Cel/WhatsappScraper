// Ejecuta el handler real aislado: sin servidor, navegador ni WhatsApp.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8')
const route = source.slice(source.indexOf("app.post('/session/:id/send',"), source.indexOf("app.post('/session/:id/send-media',"))

async function simulate({ remaining = 500, typingMs = 1000, withDeadline = true, invalid = false } = {}) {
  let now = Date.parse('2026-10-15T01:00:00Z') - remaining
  const deadline = now + remaining
  let sends = 0
  const session = { status: 'connected', client: {
    getNumberId: async () => ({ _serialized: 'qa@c.us' }),
    pupPage: { evaluate: async () => {} },
    sendMessage: async () => { sends++; return { id: { _serialized: 'fake' } } },
  } }
  let handler
  vm.runInNewContext(route, {
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
})
test('otros envíos sin deadline conservan su comportamiento', async () => {
  assert.equal((await simulate({ withDeadline: false })).sends, 1)
})
test('una fecha inválida no elimina la protección', async () => {
  const { sends, res } = await simulate({ invalid: true })
  assert.equal(sends, 0)
  assert.equal(res.statusCode, 400)
})
