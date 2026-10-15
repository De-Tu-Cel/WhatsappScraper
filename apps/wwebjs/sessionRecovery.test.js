const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  recordHeartbeatFailure,
  stampedeSessionIds,
  isTransientInitError,
  reserveLaunch,
  LAUNCH_GAP_MS,
  queueSessionRecovery,
} = require('./sessionRecovery')

describe('heartbeat stampede', () => {
  it('treats the six sessions that failed in the same millisecond as one stall', () => {
    const now = Date.parse('2026-10-08T01:33:44.874Z')
    const names = ['gely-wa', 'tania-sesion-1', 'tania-sesion-4', 'tania-sesion-3', 'sender666', 'marco-wa']
    let log = []
    for (const name of names) log = recordHeartbeatFailure(log, name, now)
    assert.deepEqual(stampedeSessionIds(log, now), names)
  })

  it('leaves a single zombie alone so it can still be recreated', () => {
    const now = 1_000_000
    const log = recordHeartbeatFailure([], 'gely-wa', now)
    assert.deepEqual(stampedeSessionIds(log, now), ['gely-wa'])
  })

  it('forgets a failure from the previous wave', () => {
    const first = Date.parse('2026-10-08T01:33:25.173Z')
    const second = Date.parse('2026-10-08T01:33:44.874Z')
    let log = recordHeartbeatFailure([], 'sender666', first)
    log = recordHeartbeatFailure(log, 'marco-wa', second)
    assert.deepEqual(stampedeSessionIds(log, second), ['marco-wa'])
  })
})

describe('serialized session recovery', () => {
  function setup() {
    const session = { status: 'disconnected', phoneNumber: 'test-phone' }
    const sessions = new Map([['test', session]])
    const locks = new Map()
    const launches = []
    const calls = []
    const options = {
      locks, sessions, sessionId: 'test', session,
      schedule: fn => launches.push(fn),
      destroy: async () => { calls.push('destroy') },
      create: (id, phone) => { calls.push(['create', id, phone]); sessions.set(id, { status: 'initializing' }) },
      allowed: status => status === 'disconnected',
      stopping: () => false,
    }
    return { session, sessions, locks, launches, calls, options }
  }
  const tick = () => new Promise(resolve => setImmediate(resolve))

  it('runs only one recovery when two disconnect handlers target the same profile', async () => {
    const s = setup()
    const first = queueSessionRecovery(s.options)
    const second = queueSessionRecovery(s.options)
    await tick()
    assert.equal(s.launches.length, 1)
    await s.launches.shift()()
    assert.equal(await first, true)
    await tick()
    await s.launches.shift()()
    assert.equal(await second, false)
    assert.deepEqual(s.calls, ['destroy', ['create', 'test', 'test-phone']])
  })

  it('waits for a manual reconnect and leaves the replacement client untouched', async () => {
    const s = setup()
    let completeManual
    s.locks.set('test', new Promise(resolve => { completeManual = resolve }))
    const recovery = queueSessionRecovery(s.options)
    await tick()
    assert.equal(s.launches.length, 0)
    s.sessions.set('test', { status: 'connected' })
    completeManual()
    await tick()
    await s.launches.shift()()
    assert.equal(await recovery, false)
    assert.deepEqual(s.calls, [])
  })

  for (const status of ['need_scan', 'auth_failure', 'connected']) {
    it(`does not relaunch if ${status} arrives during browser teardown`, async () => {
      const s = setup()
      s.options.destroy = async () => { s.session.status = status }
      const recovery = queueSessionRecovery(s.options)
      await tick()
      await s.launches.shift()()
      assert.equal(await recovery, false)
      assert.deepEqual(s.calls, [])
      assert.equal(s.sessions.get('test'), s.session)
    })
  }

  it('cancels a queued recovery once shutdown begins', async () => {
    const s = setup()
    let stopping = false
    s.options.stopping = () => stopping
    const recovery = queueSessionRecovery(s.options)
    await tick()
    stopping = true
    await s.launches.shift()()
    assert.equal(await recovery, false)
    assert.deepEqual(s.calls, [])
  })

  it('releases the lock after a teardown failure so a manual retry can proceed', async () => {
    const s = setup()
    s.options.destroy = async () => { throw new Error('close failed') }
    const recovery = queueSessionRecovery(s.options)
    const rejected = assert.rejects(recovery, /close failed/)
    await tick()
    await s.launches.shift()()
    await rejected
    await s.locks.get('test')
    assert.deepEqual(s.calls, [])
    assert.equal(s.sessions.get('test'), s.session)
  })
})

describe('chrome launch retry', () => {
  it('retries the puppeteer websocket timeout that left the six sessions dead', () => {
    assert.equal(
      isTransientInitError('Timed out after 30000 ms while waiting for the WS endpoint URL to appear in stdout!'),
      true,
    )
  })

  it('still retries a proxy network error', () => {
    assert.equal(isTransientInitError('net::ERR_TUNNEL_CONNECTION_FAILED'), true)
  })

  it('does not retry a real logout', () => {
    assert.equal(isTransientInitError('LOGOUT'), false)
  })
})

describe('staggered relaunch', () => {
  it('spaces automatic launches by the same 15s the boot uses', () => {
    const now = 5_000
    const first = reserveLaunch(now, 0)
    const second = reserveLaunch(now, first.nextLaunchAt)
    const third = reserveLaunch(now, second.nextLaunchAt)
    assert.equal(first.delay, 0)
    assert.equal(second.delay, LAUNCH_GAP_MS)
    assert.equal(third.delay, LAUNCH_GAP_MS * 2)
  })

  it('starts immediately when nothing is queued', () => {
    const now = 90_000
    const slot = reserveLaunch(now, now - 1_000)
    assert.equal(slot.delay, 0)
    assert.equal(slot.nextLaunchAt, now + LAUNCH_GAP_MS)
  })
})
