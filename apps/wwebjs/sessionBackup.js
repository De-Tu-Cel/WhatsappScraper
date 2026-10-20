// Offline, authenticated backups. No WhatsApp client or network connection is opened.
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { spawnSync } = require('node:child_process')
const MAGIC = Buffer.from('WASESS01')
const SKIP = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])
const allowedRoot = name => /^session-[a-zA-Z0-9_-]+$/.test(name) ||
  /^\.(?:disabled|proxy-required)-[a-zA-Z0-9_-]+$/.test(name) || name === 'wwebjs-settings.json'
const inside = (root, file) => { const rel = path.relative(path.resolve(root), path.resolve(file)); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) }
function validKey(key) { if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('A 32-byte backup key is required') }

async function* records(root, relative = '', totals = { files: 0, bytes: 0 }) {
  for (const entry of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    if ((!relative && !allowedRoot(entry.name)) || SKIP.has(entry.name)) continue
    if (entry.isSymbolicLink()) throw Error('Backup refuses symbolic links')
    const name = relative ? `${relative}/${entry.name}` : entry.name
    const file = path.join(root, name)
    if (entry.isDirectory()) {
      yield Buffer.from(JSON.stringify({ path: name, directory: true }) + '\n')
      yield* records(root, name, totals)
    } else if (entry.isFile()) {
      const stat = await fsp.stat(file)
      yield Buffer.from(JSON.stringify({ path: name, size: stat.size }) + '\n')
      let bytes = 0
      for await (const chunk of fs.createReadStream(file)) { bytes += chunk.length; yield chunk }
      if (bytes !== stat.size) throw Error('Profile changed during backup; stop the service first')
      totals.files++; totals.bytes += bytes
    } else throw Error('Unsupported profile entry')
  }
  if (!relative) yield Buffer.from(JSON.stringify({ end: true, ...totals }) + '\n')
}

async function backupProfiles(root, destination, key) {
  validKey(key)
  if (inside(root, destination)) throw Error('Backup must be outside the session directory')
  if (fs.existsSync(destination)) throw Error('Backup destination already exists')
  const temporary = `${destination}.partial-${crypto.randomUUID()}`
  const iv = crypto.randomBytes(12), header = Buffer.concat([MAGIC, iv])
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  try {
    await fsp.writeFile(temporary, header, { flag: 'wx', mode: 0o600 })
    await pipeline(Readable.from(records(root)), zlib.createGzip(), cipher,
      fs.createWriteStream(temporary, { flags: 'a', mode: 0o600 }))
    await fsp.appendFile(temporary, cipher.getAuthTag())
    // Publish without overwriting another backup, including concurrent writers.
    await fsp.link(temporary, destination)
  } finally { await fsp.rm(temporary, { force: true }) }
}

function safeEntry(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || name.includes('\0') ||
      name.split('/').some(part => !part || part === '.' || part === '..') || !allowedRoot(name.split('/')[0])) {
    throw Error('Unsafe backup entry')
  }
  const target = path.resolve(root, name)
  if (!inside(root, target)) throw Error('Unsafe backup path')
  return target
}

async function unpack(compressed, root) {
  const stream = fs.createReadStream(compressed).pipe(zlib.createGunzip())
  const iterator = stream[Symbol.asyncIterator]()
  let buffer = Buffer.alloc(0), ended = false
  async function more() {
    const next = await iterator.next()
    if (next.done) { ended = true; return }
    buffer = Buffer.concat([buffer, next.value])
  }
  let files = 0, bytes = 0
  try {
    while (true) {
      let newline
      while ((newline = buffer.indexOf(10)) < 0) {
        if (ended || buffer.length > 16384) throw Error('Incomplete or invalid backup')
        await more()
      }
      if (newline > 16384) throw Error('Invalid backup header')
      const entry = JSON.parse(buffer.subarray(0, newline).toString('utf8'))
      buffer = buffer.subarray(newline + 1)
      if (entry.end) {
        if (entry.files !== files || entry.bytes !== bytes) throw Error('Backup manifest mismatch')
        while (!ended) { if (buffer.length) throw Error('Unexpected backup data'); await more() }
        if (buffer.length) throw Error('Unexpected backup data')
        return { files, bytes }
      }
      const file = safeEntry(root, entry.path)
      if (entry.directory === true) { await fsp.mkdir(file, { recursive: true, mode: 0o700 }); continue }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw Error('Invalid backup file size')
      await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
      const handle = await fsp.open(file, 'wx', 0o600)
      try {
        let remaining = entry.size
        while (remaining > 0) {
          if (!buffer.length) { if (ended) throw Error('Truncated backup'); await more(); continue }
          const count = Math.min(remaining, buffer.length, 65536)
          await handle.writeFile(buffer.subarray(0, count))
          buffer = buffer.subarray(count); remaining -= count
        }
      } finally { await handle.close() }
      files++; bytes += entry.size
    }
  } finally { stream.destroy() }
}

async function restoreProfiles(archive, destination, key) {
  validKey(key)
  if (fs.existsSync(destination)) throw Error('Restore destination must not exist')
  const parent = path.dirname(path.resolve(destination))
  const staging = await fsp.mkdtemp(path.join(parent, '.wa-restore-'))
  await fsp.chmod(staging, 0o700)
  const compressed = path.join(staging, 'payload.gz'), profiles = path.join(staging, 'profiles')
  try {
    const handle = await fsp.open(archive, 'r')
    let size, header, tag
    try {
      size = (await handle.stat()).size
      if (size < 36) throw Error('Invalid backup file')
      header = Buffer.alloc(20); tag = Buffer.alloc(16)
      await handle.read(header, 0, 20, 0); await handle.read(tag, 0, 16, size - 16)
    } finally { await handle.close() }
    if (!header.subarray(0, 8).equals(MAGIC)) throw Error('Unsupported backup version')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(8))
    decipher.setAAD(header); decipher.setAuthTag(tag)
    // Authenticate the complete archive before parsing or exposing any profile.
    await pipeline(fs.createReadStream(archive, { start: 20, end: size - 17 }), decipher,
      fs.createWriteStream(compressed, { flags: 'wx', mode: 0o600 }))
    await fsp.mkdir(profiles, { mode: 0o700 })
    const result = await unpack(compressed, profiles)
    if (fs.existsSync(destination)) throw Error('Restore destination already exists')
    await fsp.rename(profiles, destination)
    return result
  } finally { await fsp.rm(staging, { recursive: true, force: true }) }
}

async function main(args) {
  const [command, source, target, keyFile] = args
  if (command === 'init-key' && source && args.length === 2) {
    await fsp.writeFile(source, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 })
    console.log('Backup key created; keep it separate from archives.')
    return
  }
  if (!['backup', 'restore'].includes(command) || args.length !== 4) {
    throw Error('Usage: node sessionBackup.js init-key KEY | backup SESSION_DIR ARCHIVE KEY | restore ARCHIVE NEW_DIR KEY')
  }
  if (command === 'backup') {
    if (inside(source, keyFile)) throw Error('Keep the backup key outside session storage')
    if (process.platform !== 'linux') throw Error('Production backup requires Linux flock and a stopped service')
    if (process.env.WA_BACKUP_LOCKED !== '1') {
      // Sin --no-fork (solo existe en util-linux >= 2.39): aquí flock puede
      // esperar a su hijo sin problema, y así funciona en cualquier imagen.
      const child = spawnSync('flock', ['--nonblock', path.join(source, '.service.lock'),
        process.execPath, __filename, ...args], { stdio: 'inherit', env: { ...process.env, WA_BACKUP_LOCKED: '1' } })
      if (child.error || child.status !== 0) throw Error('Backup failed or session storage is in use; stop the service first')
      return
    }
  }
  const key = await fsp.readFile(keyFile)
  try {
    if (command === 'backup') await backupProfiles(source, target, key)
    else await restoreProfiles(source, target, key)
    console.log(command === 'backup' ? 'Encrypted backup completed.' : 'Authenticated restore completed into a new directory; no session was connected.')
  } finally { key.fill(0) }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1 })
module.exports = { backupProfiles, restoreProfiles, safeEntry }
