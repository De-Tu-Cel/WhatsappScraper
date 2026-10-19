const test = require('node:test')
const assert = require('node:assert/strict')
const { statusEvidence } = require('./sessionDiagnostics')

test('status evidence includes memory and activity without client credentials', () => {
  const evidence = statusEvidence({ id: 'example', now: () => 0,
    session: { heartbeatFailStreak: 2, apiSecret: 'private', client: {
      pupBrowser: { process: () => ({ pid: 123, exitCode: null, signalCode: null }) } } },
    memory: () => ({ example: { memory_mb: 512, processes: 3 } }),
    activity: { snapshot: () => ({ operation: 'send', last_operation: 'verify' }) } })
  assert.equal(evidence.session_memory.memory_mb, 512)
  assert.equal(evidence.heartbeat_failures, 2)
  assert.equal(evidence.activity.last_operation, 'verify')
  assert.equal(evidence.captured_at, '1970-01-01T00:00:00.000Z')
  assert.ok(!JSON.stringify(evidence).includes('private'))
})

test('missing browser and memory do not suppress disconnect evidence', () => {
  const evidence = statusEvidence({ id: 'example', session: {},
    memory: () => { throw Error('proc unavailable') }, activity: { snapshot: () => null } })
  assert.equal(evidence.session_memory, null)
  assert.equal(evidence.browser_process, null)
  assert.ok(evidence.event_id)
})
