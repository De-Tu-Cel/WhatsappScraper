const { test } = require('node:test')
const assert = require('node:assert/strict')
const { publicContactName, cachedContactName } = require('./contactNames')

test('public name prefers verified business name, never address book or scraped labels', () => {
  assert.equal(publicContactName({ verifiedName: 'Gas Uno Puebla', pushname: 'Gas Uno', name: 'Fugas' }), 'Gas Uno Puebla')
  assert.equal(publicContactName({ name: 'Fugas', shortName: 'Gas', label: 'Reportar fuga' }), '')
  assert.equal(publicContactName({ verifiedName: {}, pushname: '  Gas  Uno\nPuebla  ' }), 'Gas Uno Puebla')
})

test('name lookup reads only the local Contact cache', async () => {
  let requested
  const client = { pupPage: { evaluate: async (fn, jid) => {
    global.window = { require: module => {
      assert.equal(module, 'WAWebCollections')
      return { Contact: { get: id => { requested = id; return { pushname: 'Gas Uno', name: 'Fugas' } } } }
    } }
    try { return fn(jid) } finally { delete global.window }
  } } }
  assert.equal(await cachedContactName(client, '5212228120419@c.us'), 'Gas Uno')
  assert.equal(requested, '5212228120419@c.us')
})

test('missing cache and browser failures fall back to public notify name', async () => {
  assert.equal(await cachedContactName({ pupPage: { evaluate: async () => null } }, 'jid', 'Gas Uno'), 'Gas Uno')
  assert.equal(await cachedContactName({ pupPage: { evaluate: async () => { throw Error('page closed') } } }, 'jid'), '')
})

test('a stalled browser cannot indefinitely block inbound processing', async () => {
  assert.equal(await cachedContactName({ pupPage: { evaluate: () => new Promise(() => {}) } }, 'jid', 'Gas Uno'), 'Gas Uno')
})
