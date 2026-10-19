const { test } = require('node:test')
const assert = require('node:assert/strict')
const { withTypingPresence } = require('./typingPresence')

function client(events, fail = false) {
  return { pupPage: { evaluate: async fn => {
    events.push(String(fn).includes("'typing'") ? 'typing' : 'stop')
    if (fail) throw new Error('bridge unavailable')
  } } }
}

test('a new chat uses presence bridge without resolving a Chat object', async () => {
  const events = []
  const result = await withTypingPresence(client(events), 'mock@c.us', 1000,
    async () => { events.push('send'); return 'id' }, async () => { events.push('wait') })
  assert.deepEqual(events, ['typing', 'wait', 'stop', 'send'])
  assert.equal(result.presence.started, true)
  assert.equal(result.presence.cleared, true)
})

test('presence failure is observable and never causes a second send', async () => {
  const events = []
  const result = await withTypingPresence(client(events, true), 'mock@c.us', 1000,
    async () => { events.push('send'); return 'id' })
  assert.equal(result.presence.started, false)
  assert.equal(result.presence.error, 'typing_cleanup_unavailable')
  assert.deepEqual(events, ['typing', 'stop', 'send'])
})

test('zero explicitly disables presence for either text or media', async () => {
  const events = []
  const result = await withTypingPresence(client(events), 'mock@c.us', 0,
    async () => { events.push('send'); return 'id' })
  assert.deepEqual(events, ['send'])
  assert.equal(result.presence.requested, false)
})

test('state is cleared before a rejected or cancelled send', async () => {
  const events = []
  await assert.rejects(withTypingPresence(client(events), 'mock@c.us', 1000,
    async () => { throw Error('cancelled') }, async () => {}), /cancelled/)
  assert.deepEqual(events, ['typing', 'stop'])
})

test('invalid duration never reaches WhatsApp', async () => {
  for (const duration of [NaN, -1, Infinity, 25001]) {
    const events = []
    await assert.rejects(withTypingPresence(client(events), 'mock@c.us', duration,
      async () => { events.push('send') }), /typingMs/)
    assert.deepEqual(events, [])
  }
})
