// Presence is best effort; it is not evidence of delivery or recipient visibility.
const { withTimeout } = require('./sessionAsync')

async function setIdlePresence(client, sleep = ms => new Promise(r => setTimeout(r, ms)), { timeoutMs = 5000 } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await withTimeout(() => client.sendPresenceUnavailable(), timeoutMs, 'Idle presence')
      return true
    } catch (_) {
      if (attempt === 0) await sleep(250)
    }
  }
  console.warn('[Presence] could not restore unavailable state after two attempts')
  return false
}

async function withTypingPresence(client, chatId, duration, action, sleep = ms => new Promise(r => setTimeout(r, ms)), { timeoutMs = 5000 } = {}) {
  const ms = Number(duration)
  if (!Number.isFinite(ms) || ms < 0 || ms > 25000) {
    const error = new Error('typingMs must be between 0 and 25000')
    error.code = 'INVALID_TYPING_DURATION'
    throw error
  }
  const presence = { requested: ms > 0, started: false, cleared: false }
  try {
    try {
      await withTimeout(() => client.sendPresenceAvailable(), timeoutMs, 'Online presence')
      presence.online = true
    } catch (_) {
      presence.online = false
    }
    if (ms > 0) {
      try {
        await withTimeout(() => client.pupPage.evaluate(id => window.WWebJS.sendChatstate('typing', id), chatId), timeoutMs, 'Typing presence')
        presence.started = true
        await sleep(ms)
      } catch (_) {
        presence.error = 'typing_unavailable'
      } finally {
        // Even a partially successful start must get a cleanup attempt.
        try {
          await withTimeout(() => client.pupPage.evaluate(id => window.WWebJS.sendChatstate('stop', id), chatId), timeoutMs, 'Typing cleanup')
          presence.cleared = true
        } catch (_) {
          presence.error = 'typing_cleanup_unavailable'
        }
      }
    }
    return { value: await action(), presence }
  } finally {
    // A failed send or cancellation must also restore idle presence. Never retry the send.
    presence.offline = await setIdlePresence(client, undefined, { timeoutMs })
  }
}

module.exports = { withTypingPresence, setIdlePresence }
