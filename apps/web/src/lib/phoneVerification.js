function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 13 && digits.startsWith('521') ? '52' + digits.slice(3) : digits
}

export function phoneVerification(validation, number) {
  const key = phoneKey(number)
  if (!key) return null
  const matches = Object.entries(validation || {}).filter(([candidate]) => phoneKey(candidate) === key)
    .map(([, value]) => value).filter(value => value && typeof value.valid === 'boolean')
    .sort((a, b) => (Date.parse(b.checked_at) || 0) - (Date.parse(a.checked_at) || 0))
  return matches[0] || null
}
