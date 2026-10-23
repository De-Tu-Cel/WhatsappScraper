// A provider ID, never a generated placeholder: send responses and webhooks
// must use the same representation to correlate acknowledgments and dedupe.
function messageId(message) {
  const key = message?.id
  for (const value of [key?._serialized, key?.id, typeof key === 'string' ? key : null]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

module.exports = { messageId }
