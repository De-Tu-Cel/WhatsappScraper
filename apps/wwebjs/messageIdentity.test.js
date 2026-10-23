const { test } = require('node:test')
const assert = require('node:assert/strict')
const { messageId } = require('./messageIdentity')

test('legacy serialized keys and current provider keys remain correlatable', () => {
  assert.equal(messageId({ id: { _serialized: 'true_remote_ABC', id: 'ABC' } }), 'true_remote_ABC')
  assert.equal(messageId({ id: { fromMe: true, remote: {}, id: 'ABC' } }), 'ABC')
  assert.equal(messageId({ id: 'ABC' }), 'ABC')
  assert.equal(messageId({ id: { _serialized: '', id: 'ABC' } }), 'ABC')
})

test('unknown message shapes do not fabricate successful delivery IDs', () => {
  for (const value of [undefined, null, {}, { id: {} }, { id: { id: '' } }, { id: 42 }]) {
    assert.equal(messageId(value), null)
  }
})
