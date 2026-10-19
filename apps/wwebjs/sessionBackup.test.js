const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { backupProfiles, restoreProfiles, safeEntry } = require('./sessionBackup')

async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-backup-test-'))
  const source = path.join(root, 'source'), archive = path.join(root, 'backup.enc'), target = path.join(root, 'restored')
  fs.mkdirSync(path.join(source, 'session-dummy', 'Default', 'IndexedDB'), { recursive: true })
  const payload = crypto.randomBytes(512 * 1024)
  fs.writeFileSync(path.join(source, 'session-dummy', 'Default', 'IndexedDB', 'dummy'), payload)
  fs.writeFileSync(path.join(source, '.disabled-dummy'), '')
  fs.writeFileSync(path.join(source, 'wwebjs-settings.json'), '{"dummy":{"lean":true}}')
  fs.writeFileSync(path.join(source, '.service.lock'), 'not credentials')
  fs.writeFileSync(path.join(source, 'session-dummy', 'SingletonLock'), 'stale-lock')
  const key = crypto.randomBytes(32)
  try { await fn({ root, source, archive, target, key, payload }) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('encrypted offline backup restores every dummy byte, settings and disabled markers without connecting', async () => fixture(async f => {
  await backupProfiles(f.source, f.archive, f.key)
  const result = await restoreProfiles(f.archive, f.target, f.key)
  assert.equal(result.files, 3)
  assert.deepEqual(fs.readFileSync(path.join(f.target, 'session-dummy', 'Default', 'IndexedDB', 'dummy')), f.payload)
  assert.equal(fs.readFileSync(path.join(f.target, 'wwebjs-settings.json'), 'utf8'), '{"dummy":{"lean":true}}')
  assert.ok(fs.existsSync(path.join(f.target, '.disabled-dummy')))
  assert.equal(fs.existsSync(path.join(f.target, '.service.lock')), false)
  assert.equal(fs.existsSync(path.join(f.target, 'session-dummy', 'SingletonLock')), false)
}))

for (const fault of ['wrong-key', 'tampered', 'truncated']) {
  test(`restore rejects ${fault} before publishing any profile`, async () => fixture(async f => {
    await backupProfiles(f.source, f.archive, f.key)
    if (fault === 'wrong-key') f.key = crypto.randomBytes(32)
    else {
      const bytes = fs.readFileSync(f.archive)
      if (fault === 'tampered') { bytes[40] ^= 1; fs.writeFileSync(f.archive, bytes) }
      else fs.writeFileSync(f.archive, bytes.subarray(0, bytes.length - 10))
    }
    await assert.rejects(restoreProfiles(f.archive, f.target, f.key))
    assert.equal(fs.existsSync(f.target), false)
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['backup.enc', 'source'])
  }))
}

test('backup and restore cannot overwrite credentials or an existing archive', async () => fixture(async f => {
  await assert.rejects(backupProfiles(f.source, path.join(f.source, 'backup.enc'), f.key), /outside/)
  await backupProfiles(f.source, f.archive, f.key)
  await assert.rejects(backupProfiles(f.source, f.archive, f.key), /already exists/)
  await assert.rejects(restoreProfiles(f.archive, f.source, f.key), /must not exist/)
  assert.deepEqual(fs.readFileSync(path.join(f.source, 'session-dummy', 'Default', 'IndexedDB', 'dummy')), f.payload)
}))

test('restore rejects traversal, absolute paths and non-profile entries', () => {
  for (const value of ['../outside', '/etc/passwd', 'session-a/../outside', 'session-a/../../x',
    'session-a\\outside', 'C:/outside', 'session-a//x', 'unknown/key', 'session-a/\0']) {
    assert.throws(() => safeEntry(os.tmpdir(), value), /Unsafe/)
  }
})

test('backup preserves proxy requirements independently of the JSON settings', async () => fixture(async f => {
  fs.writeFileSync(path.join(f.source, '.proxy-required-dummy'), '')
  await backupProfiles(f.source, f.archive, f.key)
  await restoreProfiles(f.archive, f.target, f.key)
  assert.equal(fs.existsSync(path.join(f.target, '.proxy-required-dummy')), true)
}))

test('backup refuses profile symlinks instead of following external credentials', { skip: process.platform === 'win32' }, async () => fixture(async f => {
  fs.symlinkSync('/etc/passwd', path.join(f.source, 'session-dummy', 'link'))
  await assert.rejects(backupProfiles(f.source, f.archive, f.key), /symbolic/)
  assert.equal(fs.existsSync(f.archive), false)
}))

test('kernel storage lease excludes a second service or backup until its holder exits', { skip: process.platform !== 'linux' }, async () => fixture(async f => {
  const lock = path.join(f.source, '.service.lock')
  const holder = spawn('flock', ['--nonblock', '--no-fork', lock, process.execPath, '-e',
    "process.stdout.write('locked\\n');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await once(holder.stdout, 'data')
    assert.notEqual(spawnSync('flock', ['--nonblock', lock, 'true']).status, 0)
  } finally { const ended = once(holder, 'exit'); holder.kill(); await ended }
  assert.equal(spawnSync('flock', ['--nonblock', lock, 'true']).status, 0)
}))
