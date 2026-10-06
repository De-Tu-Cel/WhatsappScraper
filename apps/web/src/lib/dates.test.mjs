// Corre con: node --test src/lib/dates.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUtc, mxDayKey, MX_TZ } from './dates.js'

const hm = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: MX_TZ })

test('a time with no zone is UTC — the 9:00 warmup message (15:00 UTC)', () => {
  assert.equal(hm(parseUtc('2026-10-05T15:00:28.645000')), '09:00')
})

test('times that already say their zone are left alone', () => {
  assert.equal(parseUtc('2026-10-05T15:00:28Z').toISOString(), '2026-10-05T15:00:28.000Z')
  assert.equal(parseUtc('2026-10-05T09:00:28-06:00').toISOString(), '2026-10-05T15:00:28.000Z')
  assert.equal(parseUtc('2026-10-05T15:00:28+00:00').toISOString(), '2026-10-05T15:00:28.000Z')
})

test('empty stays empty, a Date passes through', () => {
  assert.equal(parseUtc(''), null)
  assert.equal(parseUtc(null), null)
  const d = new Date()
  assert.equal(parseUtc(d), d)
})

test('the day is the Mexico City day, not the UTC one', () => {
  // 7 p.m. in Mexico on the 4th is already the 5th in UTC
  assert.equal(mxDayKey(parseUtc('2026-10-05T01:00:00')), '2026-10-04')
  assert.equal(mxDayKey(parseUtc('2026-10-05T06:30:00')), '2026-10-05')
})
