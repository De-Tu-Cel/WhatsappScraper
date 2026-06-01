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

export function urlValidationMsg(url) {
  if (!url || !url.trim()) return ''
  if (!url.startsWith('http://') && !url.startsWith('https://'))
    return 'La URL debe empezar con https:// o http://'
  if (!isValidUrl(url)) return 'URL inválida. Ej: https://empresa.com.mx'
  return ''
}

export function waNumberValidationMsg(num) {
  if (!num || !num.trim()) return 'El número no puede estar vacío'
  if (!isValidWhatsAppNumber(num)) return 'Formato inválido. Ej: +52 55 1234 5678 (10–15 dígitos)'
  return ''
}
