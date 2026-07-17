// Shared anti-bot-detection helper: sending the exact same message text to
// many WhatsApp numbers in a row is a common signal WhatsApp uses to flag and
// block accounts. Every bulk-send surface (Scheduled Sends, Batch URLs, CSV
// Import, Database) rotates between several message templates instead.

export const MIN_TEMPLATES_FOR_BULK = 3

// Pick a variant at random, avoiding an immediate repeat of `lastText` when
// there's more than one option. Mirrors backEnd/app/scheduler.py's
// _pick_message so the same anti-repetition rule applies client- and
// server-side.
export function pickMessageVariant(variants, lastText) {
  const clean = (variants || []).filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  const choices = clean.filter(v => v !== lastText)
  const pool = choices.length ? choices : clean
  return pool[Math.floor(Math.random() * pool.length)]
}
