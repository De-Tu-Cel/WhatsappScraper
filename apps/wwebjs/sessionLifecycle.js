const fs = require('node:fs')
const path = require('node:path')

const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)

function createSessionRegistry(root) {
  const marker = id => {
    if (!validId(id)) throw Error('Invalid session id')
    return path.join(root, `.disabled-${id}`)
  }
  return {
    disabled: id => fs.existsSync(marker(id)),
    disable(id) {
      fs.mkdirSync(root, { recursive: true, mode: 0o700 })
      // A per-session marker avoids a shared JSON read/modify/write race.
      const file = fs.openSync(marker(id), 'a', 0o600)
      try { fs.fsyncSync(file) } finally { fs.closeSync(file) }
      if (process.platform !== 'win32') {
        const directory = fs.openSync(root, 'r')
        try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
      }
    },
    enable(id) { fs.rmSync(marker(id), { force: true }) },
    profiles() {
      if (!fs.existsSync(root)) return []
      return fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('session-'))
        .map(e => e.name.slice(8)).filter(id => validId(id) && !this.disabled(id)).sort()
    },
  }
}

function serializeSession(locks, id, fn) {
  const operation = (locks.get(id) || Promise.resolve()).catch(() => {}).then(fn)
  locks.set(id, operation.catch(() => {}))
  return operation
}

function restoreSession({ locks, sessions, registry, id, stopping, prepare, create }) {
  return serializeSession(locks, id, async () => {
    if (stopping() || registry.disabled(id) || sessions.has(id)) return false
    await prepare(id)
    if (stopping() || registry.disabled(id) || sessions.has(id)) return false
    create(id)
    return true
  })
}

function settleWithin(promise, ms) {
  let timer
  return Promise.race([
    Promise.resolve(promise).then(() => true, () => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), ms) }),
  ]).finally(() => clearTimeout(timer))
}

function waitForExit(proc, ms) {
  if (!proc || proc.exitCode != null || proc.signalCode != null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); proc.removeListener('exit', done); resolve() }
    const timer = setTimeout(() => {
      proc.removeListener('exit', done)
      reject(Error('Chromium exit not confirmed; profile remains locked'))
    }, ms)
    proc.once('exit', done)
    if (proc.exitCode != null || proc.signalCode != null) done()
  })
}

async function closeBrowserProfile(client, initPromise, clearLocks,
  { initMs = 5000, closeMs = 8000, exitMs = 3000 } = {}) {
  client.lifecycleClosing = true
  if (initPromise && !await settleWithin(initPromise, initMs)) {
    // Closing a browser already created by initialize often settles that promise.
    await settleWithin(Promise.resolve().then(() => client.destroy()), closeMs)
    if (!await settleWithin(initPromise, exitMs)) {
      // If launch completes later, inspect and close the actual late browser.
      // A timeout never authorizes clearing locks or creating a replacement.
      Promise.resolve(initPromise).catch(() => {}).then(() =>
        closeBrowserProfile(client, null, () => {}, { initMs, closeMs, exitMs }))
        .catch(() => console.warn('[Session] late browser cleanup could not be confirmed'))
      throw Error('Browser launch still pending; profile remains locked')
    }
    // Re-read pupBrowser after initialize settles; an earlier snapshot may be null.
    return closeBrowserProfile(client, null, clearLocks, { initMs, closeMs, exitMs })
  }
  const browser = client.pupBrowser
  const proc = browser?.process?.()
  let closeError
  const closed = await settleWithin(Promise.resolve().then(() => client.destroy()).catch(e => { closeError = e }), closeMs)
  if (proc && proc.exitCode == null && proc.signalCode == null) {
    // browser.close can resolve just before the OS delivers the exit event.
    // Give a clean close time to finish flushing before resorting to SIGKILL.
    try { await waitForExit(proc, Math.min(exitMs, 1000)) }
    catch (_) {
      proc.kill('SIGKILL')
      await waitForExit(proc, exitMs)
    }
  } else if ((!closed || closeError) && (!browser || browser.isConnected?.() !== false)) {
    throw Error('Browser closure not confirmed; profile remains locked')
  }
  if (browser?.isConnected?.() && !proc) throw Error('Browser still connected; profile remains locked')
  clearLocks({ processExited: Boolean(proc) })
}

async function shutdownSessions({ sessions, locks, stopActivity, close, timeoutMs = 25000 }) {
  stopActivity()
  const work = [...sessions.entries()].map(([id, session]) => serializeSession(locks, id, () => close(session, id)))
  let results
  const done = await settleWithin(Promise.allSettled(work).then(r => { results = r }), timeoutMs)
  return { complete: done && results.every(r => r.status === 'fulfilled'),
    failures: results?.filter(r => r.status === 'rejected').length ?? work.length }
}

module.exports = { validId, createSessionRegistry, serializeSession, restoreSession,
  settleWithin, waitForExit, closeBrowserProfile, shutdownSessions }
