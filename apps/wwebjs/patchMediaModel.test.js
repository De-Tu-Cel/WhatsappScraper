const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { patchSource, ensureMediaModelPatch } = require('./patchMediaModel')

const installed = fs.readFileSync(require.resolve('whatsapp-web.js/src/util/Injected/Utils.js'), 'utf8')
const original = installed.replace(/        \/\/ MediaData private ID must not overwrite the outgoing MsgKey\.\r?\n        delete message\.__x_id;\r?\n\r?\n/, '')

function sender(source, { serialized = true } = {}) {
  let sent = null
  let calls = 0
  class MsgKey {
    constructor(data) { Object.assign(this, data); if (serialized) this._serialized = 'qa-message' }
    static async newId() { return 'new-id' }
  }
  const modules = {
    WAWebChatGetters: { getIsNewsletter: () => false, getIsBroadcast: () => false },
    WALinkify: { findLink: () => null },
    WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => 'me', getMaybeMePnUser: () => 'me' },
    WAWebMsgKey: MsgKey,
    WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
    WAWebSendMsgChatAction: { addAndSendMsgToChat: (_chat, message) => {
      // The WA model reads enumerable private storage before the public ID.
      const id = Object.hasOwn(message, '__x_id') ? message.__x_id : message.id
      if (!id) throw new Error('Data passed to getter must include an id property')
      sent = message; calls++
      return [Promise.resolve(message), Promise.resolve()]
    } },
    WAWebCollections: { Msg: { get: key => key && (key === 'qa-message' || key === sent?.id) ? sent : undefined } },
  }
  const window = { WWebJS: {
    processMediaData: async () => ({ __x_id: undefined, mediaHandle: 'upload-handle',
      toJSON: () => ({ type: 'document', mimetype: 'application/pdf' }) }),
  }, require: name => {
    assert.ok(modules[name], `Unexpected browser module ${name}`)
    return modules[name]
  } }
  const start = source.indexOf('window.WWebJS.sendMessage = async')
  const end = source.indexOf('window.WWebJS.editMessage = async', start)
  vm.runInNewContext(source.slice(start, end), { window })
  return { send: options => window.WWebJS.sendMessage({ id: { isLid: () => false } }, 'QA', options),
    calls: () => calls }
}

test('actual installed browser sender reproduces the unpatched media collision', async () => {
  const client = sender(original)
  await assert.rejects(client.send({ media: {} }), /must include an id/)
  assert.equal(client.calls(), 0)
})

test('patched browser sender preserves MsgKey and upload fields for documents', async () => {
  const client = sender(patchSource(original))
  const message = await client.send({ media: {}, caption: 'Prueba', sendMediaAsDocument: true })
  assert.equal(message.id._serialized, 'qa-message')
  assert.equal(Object.hasOwn(message, '__x_id'), false)
  assert.equal(message.mediaHandle, 'upload-handle')
  assert.equal(message.caption, 'Prueba')
  assert.equal(message.mimetype, 'application/pdf')
  assert.equal(client.calls(), 1)
})

test('patched browser sender still sends text once', async () => {
  const client = sender(patchSource(original))
  const message = await client.send({})
  assert.equal(message.body, 'QA')
  assert.equal(client.calls(), 1)
})

test('installation is idempotent and unknown dependency layouts require review', () => {
  assert.equal(patchSource(patchSource(original)), patchSource(original))
  assert.throws(() => patchSource('unknown source'), /Unsupported/)
  ensureMediaModelPatch()
  const utils = require('whatsapp-web.js/src/util/Injected/Utils.js')
  assert.match(utils.LoadUtils.toString(), /delete message\.__x_id/)
})

test('accepted text and document keep their provider IDs when _serialized is absent', async () => {
  const { messageId } = require('./messageIdentity')
  const unpatchedLookup = patchSource(original).replace(
    '.Msg.get(newMsgKey._serialized || newMsgKey);', '.Msg.get(newMsgKey._serialized);')
  assert.equal(await sender(unpatchedLookup, { serialized: false }).send({}), undefined)
  for (const options of [{}, { media: {}, sendMediaAsDocument: true }]) {
    const client = sender(patchSource(unpatchedLookup), { serialized: false })
    const msg = await client.send(options)
    assert.equal(messageId(msg), 'new-id')
    assert.equal(client.calls(), 1)
  }
})
