// The backend stores every time in UTC, but some endpoints send it without a
// zone ("2026-10-05T15:00:28") — and new Date() reads such a string as the
// computer's local time: 6 hours off in Mexico (Calentamiento showed a message
// sent at 9:00 as 3:00 p.m., 2026-10-05). Conversaciones did this by hand.
export const MX_TZ = 'America/Mexico_City'

export function parseUtc(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const s = String(value)
  return new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : s + 'Z')
}

// "2026-10-05" — the calendar day in Mexico City time, to group or compare days
// the same way everywhere, whatever zone the computer is set to.
export function mxDayKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: MX_TZ })
}
