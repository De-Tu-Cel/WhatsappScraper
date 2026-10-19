// Presence is best effort; it is not evidence of delivery or recipient visibility.
async function withTypingPresence(client, chatId, duration, action, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  const ms = Number(duration)
  if (!Number.isFinite(ms) || ms < 0 || ms > 25000) {
    const error = new Error('typingMs must be between 0 and 25000')
    error.code = 'INVALID_TYPING_DURATION'
    throw error
  }
  const presence = { requested: ms > 0, started: false, cleared: false }
  if (ms > 0) {
    try {
      await client.pupPage.evaluate(id => window.WWebJS.sendChatstate('typing', id), chatId)
      presence.started = true
      await sleep(ms)
    } catch (_) {
      presence.error = 'typing_unavailable'
    } finally {
      // Even a partially successful start must get a cleanup attempt.
      try {
        await client.pupPage.evaluate(id => window.WWebJS.sendChatstate('stop', id), chatId)
        presence.cleared = true
      } catch (_) {
        presence.error = 'typing_cleanup_unavailable'
      }
    }
  }
  return { value: await action(), presence }
}

module.exports = { withTypingPresence }
