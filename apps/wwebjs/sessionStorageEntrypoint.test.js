const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

test('real entrypoint excludes a second owner, forwards SIGTERM and preserves fictitious storage',
  { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dummy-storage-entrypoint-'))
    const storage = path.join(root, 'profiles')
    fs.mkdirSync(storage)
    fs.writeFileSync(path.join(storage, 'dummy-auth'), 'test-only')
    fs.writeFileSync(path.join(root, 'index.js'), `
      const fs = require('fs'), path = require('path');
      if (process.env.SESSION_STORAGE_LOCKED !== '1') process.exit(3);
      process.on('SIGTERM', () => { fs.writeFileSync(path.join(process.env.SESSIONS_PATH,'closed'), 'clean');process.exit(0) });
      process.stdout.write('ready\\n');setInterval(()=>{},1000);
    `)
    const start = () => spawn('sh', [path.join(__dirname, 'storage-entrypoint.sh')], {
      cwd: root, env: { ...process.env, SESSIONS_PATH: storage }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const holder = start()
    let second, restored
    try {
      await once(holder.stdout, 'data')
      second = start()
      const [failed] = await once(second, 'exit')
      assert.notEqual(failed, 0)
      const exited = once(holder, 'exit'); holder.kill('SIGTERM')
      assert.equal((await exited)[0], 0)
      assert.equal(fs.readFileSync(path.join(storage, 'closed'), 'utf8'), 'clean')
      restored = start(); await once(restored.stdout, 'data')
      assert.equal(fs.readFileSync(path.join(storage, 'dummy-auth'), 'utf8'), 'test-only')
    } finally {
      for (const child of [holder, second, restored]) {
        if (child && child.exitCode == null && child.signalCode == null) {
          const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited
        }
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

test('with REQUIRE_EXISTING_SESSIONS an empty volume refuses to start; one with profiles starts',
  { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
    // Recurso aparte en Coolify: un volumen externo mal nombrado se monta vacío.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dummy-storage-required-'))
    const storage = path.join(root, 'profiles')
    fs.mkdirSync(storage)
    fs.writeFileSync(path.join(root, 'index.js'), "process.stdout.write('ready\\n');setInterval(()=>{},1000);")
    const env = { ...process.env, SESSIONS_PATH: storage, REQUIRE_EXISTING_SESSIONS: '1', EMPTY_STORAGE_PAUSE: '0' }
    const start = () => spawn('sh', [path.join(__dirname, 'storage-entrypoint.sh')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let running
    try {
      const empty = start()
      let err = ''
      empty.stderr.on('data', (d) => { err += d })
      const [code] = await once(empty, 'exit')
      assert.notEqual(code, 0)
      assert.match(err, /WWEBJS_SESSIONS_VOLUME/)
      assert.equal(fs.existsSync(path.join(storage, '.service.lock')), false) // ni siquiera tomó el candado
      fs.mkdirSync(path.join(storage, 'session-gely-wa'))
      running = start()
      await once(running.stdout, 'data')
    } finally {
      if (running && running.exitCode == null && running.signalCode == null) {
        const exited = once(running, 'exit'); running.kill('SIGTERM'); await exited
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
