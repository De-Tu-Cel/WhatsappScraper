// Corre con: node --test src/lib/dailyCap.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getOverBy, buildRecommendation } from './dailyCap.js'

test('returns 0 when there are no stats yet', () => {
  assert.equal(getOverBy(null, 5), 0)
})

test('returns 0 when nothing is selected', () => {
  assert.equal(getOverBy({ total_available: 3 }, 0), 0)
})

test('returns 0 when the selection fits exactly', () => {
  assert.equal(getOverBy({ total_available: 5 }, 5), 0)
})

test('returns 0 when the selection is under the available quota', () => {
  assert.equal(getOverBy({ total_available: 10 }, 3), 0)
})

test('returns the exact overflow when the selection exceeds the available quota', () => {
  assert.equal(getOverBy({ total_available: 5 }, 8), 3)
})

test('clamps to 0 instead of going negative when available quota is 0', () => {
  assert.equal(getOverBy({ total_available: 0 }, 1), 1)
})

test('works with the reduced future-date stats shape (no rows/total_sent)', () => {
  const futureStats = { total_cap: 200, scheduled_that_day: 190, total_available: 10 }
  assert.equal(getOverBy(futureStats, 15), 5)
  assert.equal(getOverBy(futureStats, 10), 0)
})

// ── buildRecommendation ──────────────────────────────────────────────────────

test('buildRecommendation returns empty string with no stats', () => {
  assert.equal(buildRecommendation(null), '')
})

test('buildRecommendation flags the reduced future-date shape (no instances)', () => {
  const futureStats = { total_cap: 200, scheduled_that_day: 10, total_available: 190 }
  assert.match(buildRecommendation(futureStats), /no se puede desglosar por número/)
})

test('buildRecommendation flags when the user has no instances assigned', () => {
  assert.match(buildRecommendation({ instances: [] }), /No tienes instancias/)
})

test('buildRecommendation mentions warmup and normal counts separately', () => {
  const stats = {
    instances: [
      { label: 'A', warmup_mode: true,  available: 15, cap: 20 },
      { label: 'B', warmup_mode: false, available: 150, cap: 200 },
    ],
  }
  const msg = buildRecommendation(stats)
  assert.match(msg, /1 en warmup \(20\/día c\/u\)/)
  assert.match(msg, /1 normal \(200\/día c\/u\)/)
  assert.match(msg, /Reparte tus envíos/)
})

test('buildRecommendation calls out the tightest instance when it is low', () => {
  const stats = {
    instances: [
      { label: 'Tight', warmup_mode: true,  available: 5,  cap: 20 },
      { label: 'Roomy', warmup_mode: false, available: 150, cap: 200 },
    ],
  }
  const msg = buildRecommendation(stats)
  assert.match(msg, /Tight es el que menos cupo tiene hoy \(5 disponibles\)/)
})

test('buildRecommendation does not warn about the tightest instance when all have plenty of room', () => {
  const stats = {
    instances: [
      { label: 'A', warmup_mode: false, available: 150, cap: 200 },
      { label: 'B', warmup_mode: false, available: 180, cap: 200 },
    ],
  }
  assert.doesNotMatch(buildRecommendation(stats), /evita cargarle más/)
})

test('buildRecommendation skips the "spread it out" tip with a single instance', () => {
  const stats = { instances: [{ label: 'Solo', warmup_mode: false, available: 150, cap: 200 }] }
  assert.doesNotMatch(buildRecommendation(stats), /Reparte tus envíos/)
})
