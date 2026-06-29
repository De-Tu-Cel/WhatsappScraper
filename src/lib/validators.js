export const MAX_WA_MSG = 4096

export function isValidUrl(str) {
  if (!str || !str.trim()) return false
  try {
    const u = new URL(str.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Accepts: +521234567890, 521234567890, 1234567890 (10–15 digits, optional leading +)
export function isValidWhatsAppNumber(str) {
  if (!str) return false
  const digits = str.replace(/[\s\-().+]/g, '')
  return /^\d{10,15}$/.test(digits)
}

const _URL_MSGS_ES = {
  badProtocol: 'La URL debe empezar con https:// o http://',
  invalid:     'URL inválida. Ej: https://empresa.com.mx',
}
const _WA_MSGS_ES = {
  empty:   'El número no puede estar vacío',
  invalid: 'Formato inválido. Ej: +52 55 1234 5678 (10–15 dígitos)',
}

export function urlValidationMsg(url, msgs = _URL_MSGS_ES) {
  if (!url || !url.trim()) return ''
  if (!url.startsWith('http://') && !url.startsWith('https://'))
    return msgs.badProtocol
  if (!isValidUrl(url)) return msgs.invalid
  return ''
}

export function waNumberValidationMsg(num, msgs = _WA_MSGS_ES) {
  if (!num || !num.trim()) return msgs.empty
  if (!isValidWhatsAppNumber(num)) return msgs.invalid
  return ''
}
