/* global require, __dirname, setTimeout, TextEncoder, Response, fetch */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { webcrypto } = require('node:crypto')
const http = require('node:http')

function load(fetch, store = new Map()) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/api.js'), 'utf8')
    .replace('export async function authFetch', 'async function authFetch')
  const context = { fetch, crypto: webcrypto, TextEncoder,
    window: { dispatchEvent() {} }, Event: class {},
    localStorage: { getItem: () => 'qa', removeItem() {} },
    sessionStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) } }
  vm.runInNewContext(source + '\nglobalThis.authFetch=authFetch', context)
  return context.authFetch
}
const options = { method: 'POST', body: JSON.stringify({ jobs: [{ numbers: ['525500000001'], messages: ['Synthetic QA'] }] }) }

test('concurrent callers share the request and can each read its response', async () => {
  let calls = 0, release
  const hold = new Promise(resolve => { release = resolve })
  const send = load(async () => { calls++; await hold; return new Response('{"ok":true}') })
  const a = send('/api/send-queue', options), b = send('/api/send-queue', options)
  await new Promise(resolve => setTimeout(resolve, 25)); release()
  const responses = await Promise.all([a, b])
  assert.equal(calls, 1)
  assert.deepEqual(await Promise.all(responses.map(r => r.json())), [{ ok: true }, { ok: true }])
})

test('an uncertain response and reload retain the operation ID', async () => {
  const store = new Map(), ids = []
  let status = 409
  const transport = async (_, opts) => { ids.push(JSON.parse(opts.body).request_id); return new Response('{}', { status }) }
  await load(transport, store)('/api/send-queue', options)
  status = 200
  await load(transport, store)('/api/send-queue', options)
  await load(transport, store)('/api/send-queue', options)
  assert.equal(ids[0], ids[1])
  assert.notEqual(ids[1], ids[2])
})

test('real HTTP cut after 200 headers does not discard the operation ID', async () => {
  const ids = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    ids.push(JSON.parse(body).request_id)
    if (ids.length === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' })
      res.write('{"ok":')
      setTimeout(() => res.destroy(), 25)
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const store = new Map()
    const transport = (_, opts) => fetch(`http://127.0.0.1:${server.address().port}/api/send-queue`, opts)
    await assert.rejects(load(transport, store)('/api/send-queue', options))
    const response = await load(transport, store)('/api/send-queue', options)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(ids[0], ids[1])
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
