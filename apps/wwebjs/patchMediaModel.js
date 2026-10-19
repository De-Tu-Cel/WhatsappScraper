// whatsapp-web.js 1.34.7: https://github.com/wwebjs/whatsapp-web.js/pull/201923
// The collision is created inside the injected browser code, not MessageMedia.
const fs = require('node:fs')

function patchSource(source) {
  const start = source.indexOf('window.WWebJS.sendMessage = async')
  const end = source.indexOf('window.WWebJS.editMessage = async', start)
  if (start < 0 || end < 0) throw new Error('Unsupported whatsapp-web.js sendMessage layout')
  const send = source.slice(start, end)
  if (send.includes('delete message.__x_id;')) return source
  const anchor = "        // Bot's won't reply if canonicalUrl is set (linking)"
  if (send.split(anchor).length !== 2 || !send.includes('...mediaOptions,')) {
    throw new Error('Media ID patch requires review for this whatsapp-web.js version')
  }
  return source.slice(0, start) + send.replace(anchor,
    '        // MediaData private ID must not overwrite the outgoing MsgKey.\n' +
    '        delete message.__x_id;\n\n' + anchor) + source.slice(end)
}

function ensureMediaModelPatch() {
  const file = require.resolve('whatsapp-web.js/src/util/Injected/Utils.js')
  const source = fs.readFileSync(file, 'utf8')
  const patched = patchSource(source)
  if (patched !== source) fs.writeFileSync(file, patched)
}

if (require.main === module) ensureMediaModelPatch()
module.exports = { patchSource, ensureMediaModelPatch }
