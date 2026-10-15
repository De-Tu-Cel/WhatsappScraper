// Conversaciones conserva el país; solo el antiguo 521 mexicano equivale a 52.
export function conversationPhoneKey(value) {
  const raw = String(value || '')
  if (raw.includes('@lid') || raw.includes('@g.us')) return raw
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('521')) digits = '52' + digits.slice(3)
  return digits
}

export function uniqueConversationPhones(values) {
  const seen = new Set()
  return values.filter(value => {
    const key = conversationPhoneKey(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatConversationPhone(value) {
  const key = conversationPhoneKey(value)
  if (/^(52|57)\d{10}$/.test(key)) return `+${key.slice(0, 2)} ${key.slice(2, 4)} ${key.slice(4, 8)} ${key.slice(8)}`
  return /^\d+$/.test(key) ? `+${key}` : String(value || '')
}

export function conversationMessageKeys(messages) {
  let lastOutbound = ''
  return messages.map(message => {
    if (message.direction === 'outbound') {
      const key = conversationPhoneKey(message.to_number || message.number)
      if (!['failed', 'error'].includes(message.status)) lastOutbound = key
      return key
    }
    const key = conversationPhoneKey(message.related_to_number || message.from_number || message.number)
    return !key || key.includes('@lid') ? lastOutbound : key
  })
}

export function conversationNumberStats(messages, numbers) {
  const keys = conversationMessageKeys(messages)
  return Object.fromEntries(numbers.map(number => {
    const key = conversationPhoneKey(number)
    const stats = { sent: 0, received: 0, failed: 0 }
    messages.forEach((message, index) => {
      if (keys[index] !== key) return
      if (message.direction === 'outbound') {
        if (['failed', 'error'].includes(message.status)) stats.failed++
        else if (!['pending', 'queued', 'sending'].includes(message.status)) stats.sent++
      } else if (message.direction === 'inbound') stats.received++
    })
    return [number, stats]
  }))
}
