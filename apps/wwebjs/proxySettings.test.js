const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const { normalizeProxy, launchKey, proxyForSession } = require('./proxySettings')
const oldProxy = { server: 'proxy.invalid:8080', username: 'dummy', password: 'dummy-old' }
const newProxy = { server: 'other.invalid:8080', username: 'dummy', password: 'dummy-new' }

test('proxy validation rejects unsupported schemes and invalid credentials or ports', () => {
  for (const server of ['ftp://proxy.invalid:8080', 'proxy.invalid:99999', 'http://u:p@host:80', 'socks5://u:p@host:1080']) {
    assert.throws(() => normalizeProxy({ server }), server)
  }
  assert.throws(() => normalizeProxy({ server: 'proxy.invalid:8080', password: 'without-user' }))
  assert.equal(normalizeProxy({ server: 'http://proxy.invalid:8080' }).server, 'proxy.invalid:8080')
})

test('SOCKS/HTTPS without credentials go straight to Chrome, as the production global proxy does', () => {
  // PROXY_SERVER en Coolify es socks5://… (2026-10-19): Chrome lo soporta nativo sin usuario.
  assert.equal(normalizeProxy({ server: 'socks5://proxy.invalid:1080' }).server, 'socks5://proxy.invalid:1080')
  assert.equal(normalizeProxy({ server: 'SOCKS5://proxy.invalid:1080', username: '', password: '' }).server, 'socks5://proxy.invalid:1080')
  assert.equal(normalizeProxy({ server: 'socks4://proxy.invalid:1080' }).server, 'socks4://proxy.invalid:1080')
  assert.equal(normalizeProxy({ server: 'https://proxy.invalid:8443' }).server, 'https://proxy.invalid:8443')
  // Con credenciales no: Chrome no autentica SOCKS y el intermediario local solo habla HTTP.
  assert.throws(() => normalizeProxy({ server: 'socks5://proxy.invalid:1080', username: 'dummy', password: 'dummy' }), /no es compatible/)
  // La sesión sin proxy propio que cae en ese global arranca en vez de quedar en error.
  const global = { server: 'socks5://proxy.invalid:1080', username: '', password: '' }
  assert.equal(proxyForSession({ id: 'a', settings: {}, globalProxy: global }).server, 'socks5://proxy.invalid:1080')
  // Un proxy propio sigue teniendo prioridad sobre el global.
  assert.equal(proxyForSession({ id: 'a', settings: { a: { proxy: oldProxy } }, globalProxy: global }).server, 'proxy.invalid:8080')
})

test('a required or unreadable configuration cannot silently fall back to a global proxy or direct connection', () => {
  for (const globalProxy of [null, oldProxy]) {
    assert.throws(() => proxyForSession({ id: 'a', settings: { a: { proxy_required: true } }, globalProxy }), /requiere/)
    assert.throws(() => proxyForSession({ id: 'a', settings: {}, required: true, globalProxy }), /requiere/)
    assert.throws(() => proxyForSession({ id: 'a', settings: {}, loadError: Error('corrupt'), globalProxy }), /configuración/)
  }
  assert.equal(proxyForSession({ id: 'a', settings: {}, globalProxy: null }), null)
})

async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dummy-proxy-settings-'))
  const settings = { a: { proxy: oldProxy, lean: false } }
  const sessions = new Map([['a', { status: 'connected', launchKey: launchKey(oldProxy, false) }]])
  let route, restarts = 0, status = 200, body
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const ctx = {
    sessionSettings: settings, sessions, normalizeProxy, proxyLaunchKey: launchKey,
    proxyFor: id => settings[id].proxy, fs, path, SESSIONS_PATH: root,
    saveSessionSettings: () => fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings)),
    restartSession: async id => { restarts++; sessions.get(id).launchKey = launchKey(settings[id].proxy, settings[id].lean); return true },
    console: { log() {} }, app: { get() {}, put: (url, fn) => { route = fn } },
  }
  const start = source.indexOf('function publicSettings('), end = source.indexOf('// Reinicia una', start)
  vm.runInNewContext(source.slice(start, end), ctx)
  const send = async data => {
    status = 200; body = undefined
    await route({ params: { id: 'a' }, body: data }, { status(code) { status = code; return this }, json(value) { body = value } })
    return { status, body }
  }
  try { await fn({ ctx, root, settings, sessions, send, restarts: () => restarts }) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('saving a new desired proxy never restarts an active session without explicit restart=true', async () => fixture(async f => {
  const { status, body } = await f.send({ proxy: newProxy, proxy_required: true })
  assert.equal(status, 200); assert.equal(body.pending_restart, true); assert.equal(body.applied, false)
  assert.equal(f.restarts(), 0)
  assert.equal(f.sessions.get('a').launchKey, launchKey(oldProxy, false))
  assert.equal(fs.existsSync(path.join(f.root, '.proxy-required-a')), true)
  assert.equal(JSON.stringify(body).includes('dummy-new'), false)
}))

test('synchronizing unchanged settings does not restart, even with restart=true', async () => fixture(async f => {
  const { body } = await f.send({ proxy: oldProxy, restart: true })
  assert.equal(f.restarts(), 0); assert.equal(body.applied, true); assert.equal(body.pending_restart, false)
}))

test('assigning the same effective global proxy as an own proxy does not restart Chromium', async () => fixture(async f => {
  f.settings.a.proxy = null
  f.ctx.proxyFor = id => f.settings[id].proxy || oldProxy
  const { body } = await f.send({ proxy: oldProxy, restart: true })
  assert.equal(f.restarts(), 0); assert.equal(body.applied, true)
}))

test('an explicitly requested pending change restarts once and then confirms applied settings', async () => fixture(async f => {
  await f.send({ proxy: newProxy, restart: false })
  const { body } = await f.send({ proxy: newProxy, restart: true })
  assert.equal(f.restarts(), 1); assert.equal(body.applied, true); assert.equal(body.pending_restart, false)
}))

test('failed persistence keeps previous memory and leaves the active session untouched', async () => fixture(async f => {
  f.ctx.saveSessionSettings = () => { throw Error('disk unavailable') }
  const { status } = await f.send({ proxy: newProxy, restart: true })
  assert.equal(status, 500); assert.equal(f.restarts(), 0)
  assert.equal(f.settings.a.proxy.server, oldProxy.server)
}))

test('a contradictory requirement is rejected before saving or restarting', async () => fixture(async f => {
  const { status } = await f.send({ proxy: null, proxy_required: true, restart: true })
  assert.equal(status, 400); assert.equal(f.restarts(), 0)
}))
