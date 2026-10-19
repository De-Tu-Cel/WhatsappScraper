// Acknowledges a real invocation of the WhatsApp client, not just an HTTP request.
async function verifyRegistration(client, digits, { requestId, now = () => new Date().toISOString(), onEvent = () => {} } = {}) {
  const verification = { request_id: requestId || null, lookup_started: true, started_at: now(), client_calls: 1 }
  onEvent({ ...verification, event: 'verification_started' })
  try {
    const registered = await client.isRegisteredUser(`${digits}@c.us`)
    let numberId = null
    if (registered) {
      verification.client_calls++
      numberId = await client.getNumberId(digits).catch(() => null)
    }
    verification.finished_at = now()
    verification.outcome = registered ? 'registered' : 'not_registered'
    onEvent({ ...verification, event: 'verification_finished' })
    return { registered, chatId: numberId?._serialized || null, verification }
  } catch (error) {
    verification.finished_at = now()
    verification.outcome = 'error'
    onEvent({ ...verification, event: 'verification_finished' })
    error.verification = verification
    throw error
  }
}

module.exports = { verifyRegistration }
