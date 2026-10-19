/* global require, __dirname, Response, structuredClone, setTimeout, clearTimeout, queueMicrotask */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createHash } = require('node:crypto')

function factory() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/sharedScrapePoll.js'), 'utf8')
    .replace('export function createScrapePoller', 'function createScrapePoller')
  const context = { structuredClone, setTimeout, clearTimeout }
  vm.runInNewContext(source + '\nglobalThis.create=createScrapePoller', context)
  return context.create
}
const digest = async s => createHash('sha256').update(s).digest('hex')
const json = () => new Response('{"results":[{"name":"Example"}]}')

function tabs(fetcher, count = 2) {
  const held = new Set(), channels = [], messages = []
  const locks = { async request(key, opts, run) {
    if (held.has(key)) return run(null)
    held.add(key)
    try { return await run({ name: key }) } finally { held.delete(key) }
  } }
  const pollers = Array.from({ length: count }, () => {
    const channel = { postMessage(data) {
      messages.push(data)
      for (const other of channels) if (other !== channel) queueMicrotask(() => other.onmessage({ data }))
    } }
    channels.push(channel)
    return factory()({ fetcher, locks, channel, digest, waitMs: 30 })
  })
  return { pollers, messages }
}

test('six tabs share one HTTP request and receive independent results', async () => {
  let calls = 0
  const { pollers, messages } = tabs(async () => {
    calls++; await new Promise(r => setTimeout(r, 10)); return json()
  }, 6)
  const values = await Promise.all(pollers.map(p => p('/job/one', 'private-token')))
  assert.equal(calls, 1)
  values[0].data.results[0].name = 'changed'
  assert.ok(values.slice(1).every(v => v.data.results[0].name === 'Example'))
  assert.ok(!JSON.stringify(messages).includes('private-token'))
})

test('different logins never share snapshots', async () => {
  let calls = 0
  const { pollers } = tabs(async () => { calls++; return json() })
  await Promise.all([pollers[0]('/job/one', 'alice'), pollers[1]('/job/one', 'bob')])
  assert.equal(calls, 2)
})

test('action refresh bypasses cached snapshot', async () => {
  let calls = 0
  const poll = factory()({ fetcher: async () => { calls++; return json() }, digest })
  await poll('/job', 'alice')
  await poll('/job', 'alice')
  assert.equal(calls, 1)
  await poll('/job', 'alice', true)
  assert.equal(calls, 2)
})

test('lost leader falls back instead of leaving followers stuck', async () => {
  let calls = 0
  const poll = factory()({ fetcher: async () => { calls++; return json() }, digest,
    locks: { request: (key, opts, fn) => fn(null) }, channel: { postMessage() {} }, waitMs: 5 })
  assert.equal((await poll('/job', 'alice')).status, 200)
  assert.equal(calls, 1)
})

test('server errors are not cached and can be retried', async () => {
  let calls = 0
  const poll = factory()({ fetcher: async () => ++calls === 1 ? new Response('', { status: 503 }) : json(), digest })
  assert.equal((await poll('/job', 'alice')).status, 503)
  assert.equal((await poll('/job', 'alice')).status, 200)
  assert.equal(calls, 2)
})

test('unsupported cross-tab APIs preserve ordinary polling', async () => {
  const poll = factory()({ fetcher: async () => json(), digest })
  assert.equal((await poll('/job', 'alice')).data.results[0].name, 'Example')
})
