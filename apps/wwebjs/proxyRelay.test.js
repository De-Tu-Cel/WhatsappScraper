const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const http = require('node:http'), net = require('node:net')
const { once } = require('node:events')
const { withTimeout } = require('./sessionAsync')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function fixture(proxyHandler, fn) {
  const sockets = new Set(), upstream = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); proxyHandler(socket); socket.resume()
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const relays = new Map(), source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const start = source.indexOf('function relayFor(')
  // Keep only the two relay functions regardless of adjacent commentary.
  const stop = source.indexOf('function proxyServerArg(', start)
  const ctx = { http, net, Buffer, relays, nextRelayPort: 0, PROXY_HANDSHAKE_TIMEOUT_MS: 50, console: { error() {} } }
  vm.runInNewContext(source.slice(start, stop), ctx)
  ctx.relayFor('dummy', { server: `127.0.0.1:${upstream.address().port}`, username: 'dummy', password: 'dummy' })
  const relay = relays.get('dummy').server
  await once(relay, 'listening')
  const client = net.connect(relay.address().port, '127.0.0.1')
  client.on('error', () => {})
  await once(client, 'connect')
  try { await fn({ client, sockets }) }
  finally {
    client.destroy()
    for (const socket of sockets) socket.destroy()
    ctx.closeRelay('dummy')
    await new Promise(resolve => upstream.close(resolve))
  }
}

test('client disconnect during a silent proxy handshake releases the upstream socket', async () => {
  await fixture(() => {}, async ({ client, sockets }) => {
    client.write('CONNECT dummy.invalid:443 HTTP/1.1\r\n\r\n')
    while (!sockets.size) await sleep(1)
    const closed = once([...sockets][0], 'close')
    client.destroy()
    await withTimeout(() => closed, 1000)
    assert.equal(sockets.size, 0)
  })
})

test('an unresponsive proxy handshake has a bounded lifetime', async () => {
  await fixture(() => {}, async ({ client }) => {
    const closed = once(client, 'close')
    client.write('CONNECT dummy.invalid:443 HTTP/1.1\r\n\r\n')
    await withTimeout(() => closed, 1000)
    assert.equal(client.destroyed, true)
  })
})

test('established tunnels remain open past the handshake deadline and carry traffic', async () => {
  await fixture(socket => {
    let established = false
    socket.on('data', bytes => {
      if (established) return socket.write(bytes)
      assert.match(bytes.toString(), /Proxy-Authorization: Basic /)
      established = true; socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
  }, async ({ client }) => {
    const response = once(client, 'data')
    client.write('CONNECT dummy.invalid:443 HTTP/1.1\r\n\r\n')
    assert.match((await response)[0].toString(), /200/)
    await sleep(150)
    assert.equal(client.destroyed, false)
    const echo = once(client, 'data'); client.write('dummy-ping')
    assert.equal((await withTimeout(() => echo, 1000))[0].toString(), 'dummy-ping')
  })
})

test('proxy rejection produces an error instead of a direct connection fallback', async () => {
  await fixture(socket => socket.once('data', () => socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')), async ({ client }) => {
    const response = once(client, 'data')
    client.write('CONNECT dummy.invalid:443 HTTP/1.1\r\n\r\n')
    assert.match((await withTimeout(() => response, 1000))[0].toString(), /502/)
  })
})
