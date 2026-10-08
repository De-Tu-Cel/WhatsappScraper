const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  recordHeartbeatFailure,
  stampedeSessionIds,
  isTransientInitError,
  reserveLaunch,
  LAUNCH_GAP_MS,
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
