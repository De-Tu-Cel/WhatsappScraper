const { test } = require('node:test')
const assert = require('node:assert/strict')
const { withTypingPresence, setIdlePresence } = require('./typingPresence')

function client(events, fail = false) {
  return {
    sendPresenceAvailable: async () => { events.push('online') },
    sendPresenceUnavailable: async () => { events.push('offline') },
    pupPage: { evaluate: async fn => {
    events.push(String(fn).includes("'typing'") ? 'typing' : 'stop')
    if (fail) throw new Error('bridge unavailable')
  } } }
}

test('a new chat uses presence bridge without resolving a Chat object', async () => {
  const events = []
  const result = await withTypingPresence(client(events), 'mock@c.us', 1000,
    async () => { events.push('send'); return 'id' }, async () => { events.push('wait') })
  assert.deepEqual(events, ['online', 'typing', 'wait', 'stop', 'send', 'offline'])
  assert.equal(result.presence.started, true)
  assert.equal(result.presence.cleared, true)
})

test('presence failure is observable and never causes a second send', async () => {
  const events = []
  const result = await withTypingPresence(client(events, true), 'mock@c.us', 1000,
    async () => { events.push('send'); return 'id' })
  assert.equal(result.presence.started, false)
  assert.equal(result.presence.error, 'typing_cleanup_unavailable')
  assert.deepEqual(events, ['online', 'typing', 'stop', 'send', 'offline'])
})

test('zero disables typing but restores idle presence for either text or media', async () => {
  const events = []
  const result = await withTypingPresence(client(events), 'mock@c.us', 0,
    async () => { events.push('send'); return 'id' })
  assert.deepEqual(events, ['online', 'send', 'offline'])
  assert.equal(result.presence.requested, false)
})

test('state is cleared before a rejected or cancelled send', async () => {
  const events = []
  await assert.rejects(withTypingPresence(client(events), 'mock@c.us', 1000,
    async () => { throw Error('cancelled') }, async () => {}), /cancelled/)
  assert.deepEqual(events, ['online', 'typing', 'stop', 'offline'])
})

test('idle cleanup retries once without repeating the message', async () => {
  const events = []
  const c = client(events)
  let attempts = 0
  c.sendPresenceUnavailable = async () => {
    attempts++
    if (attempts === 1) throw Error('temporary failure')
  }
  const result = await withTypingPresence(c, 'mock@c.us', 0,
    async () => { events.push('send'); return 'id' })
  assert.equal(attempts, 2)
  assert.equal(result.presence.offline, true)
  assert.equal(events.filter(e => e === 'send').length, 1)
})

test('failed online presence still permits one send and attempts idle cleanup', async () => {
  const events = []
  const c = client(events)
  c.sendPresenceAvailable = async () => { throw Error('unavailable') }
  const result = await withTypingPresence(c, 'mock@c.us', 0,
    async () => { events.push('send'); return 'id' })
  assert.equal(result.presence.online, false)
  assert.equal(result.presence.offline, true)
  assert.deepEqual(events, ['send', 'offline'])
})

test('idle cleanup failure is bounded and observable', async () => {
  let attempts = 0
  const result = await setIdlePresence({ sendPresenceUnavailable: async () => {
    attempts++
    throw Error('disconnected')
  } }, async () => {})
  assert.equal(result, false)
  assert.equal(attempts, 2)
})

test('invalid duration never reaches WhatsApp', async () => {
  for (const duration of [NaN, -1, Infinity, 25001]) {
    const events = []
    await assert.rejects(withTypingPresence(client(events), 'mock@c.us', duration,
      async () => { events.push('send') }), /typingMs/)
    assert.deepEqual(events, [])
  }
})
