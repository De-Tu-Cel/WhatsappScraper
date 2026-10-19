// Read/dismiss marks belong to an account, not every user sharing this browser.
export function notificationKey(kind, userId) {
  return `notifications:${userId}:${kind}`
}

export function notificationMark(storage, kind, userId) {
  if (!userId) return ''
  try { return storage.getItem(notificationKey(kind, userId)) || '' } catch { return '' }
}

export function notificationSince(storage, userId) {
  return [notificationMark(storage, 'read', userId), notificationMark(storage, 'cleared', userId)]
    .filter(value => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || ''
}

export function markNotifications(storage, kind, userId, stamp) {
  if (!userId) return
  try { storage.setItem(notificationKey(kind, userId), stamp) } catch { /* Private storage may be unavailable. */ }
}
