// Corre con: node --test src/lib/dailyCap.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getOverBy, buildRecommendation, fitNewContacts, capOverflowKind } from './dailyCap.js'

test('returns 0 when there are no stats yet', () => {
  assert.equal(getOverBy(null, 5), 0)
})

test('a send that requires the cap blocks the whole selection until the cap has loaded', () => {
  assert.equal(getOverBy(null, 6, 6, { requireStats: true }), 6)
  assert.equal(getOverBy(null, 0, 0, { requireStats: true }), 0)
})

test('new contacts over a warmup cap count even when the daily message cap still has room', () => {
  const stats = { total_available: 20, new_contacts_capacity: 5 }
  assert.equal(getOverBy(stats, 6, 6), 1)
  assert.equal(getOverBy(stats, 5, 5), 0)
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

test('a future date without a new-contact field does not invent that cap', () => {
  const futureStats = { total_cap: 200, scheduled_that_day: 0, total_available: 200 }
  assert.equal(getOverBy(futureStats, 6, 6), 0)
  assert.equal(capOverflowKind(futureStats, 6, 6), null)
})

test('fitNewContacts keeps nothing when the cap has not loaded', () => {
  const rows = [{ id: 1 }, { id: 2 }]
  const { kept, trimmed } = fitNewContacts(rows, null)
  assert.deepEqual(kept, [])
  assert.equal(trimmed, 2)
})

test('fitNewContacts keeps only the warmup slots and leaves the overflow out', () => {
  const rows = [1, 2, 3, 4, 5, 6].map(id => ({ id }))
  const stats = { new_contacts_capacity: 5, instances: [{ instance: 'gely-wa', new_contacts_left: 5 }] }
  const { kept, trimmed } = fitNewContacts(rows, stats)
  assert.equal(kept.length, 5)
  assert.equal(trimmed, 1)
})

test('fitNewContacts does not spend the same slot twice', () => {
  const assigned = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]
  const loose = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]
  const stats = {
    new_contacts_capacity: 5,
    instances: [{ instance: 'gely-wa', new_contacts_left: 5 }],
  }
  const { kept, trimmed } = fitNewContacts([...assigned, ...loose], stats, row => row.id.startsWith('a') ? 'gely-wa' : '')
  assert.equal(kept.length, 5)
  assert.equal(trimmed, 1)
})

test('fitNewContacts drops companies pinned to an instance that is already full', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  const stats = {
    new_contacts_capacity: 5,
    instances: [
      { instance: 'gely-wa', new_contacts_left: 0 },
      { instance: 'otro', new_contacts_left: 5 },
    ],
  }
  const { kept, trimmed } = fitNewContacts(rows, stats, () => 'gely-wa')
  assert.deepEqual(kept, [])
  assert.equal(trimmed, 2)
})

test('two assigned sessions add their new-contact room, and a third user is not in that sum', () => {
  const stats = {
    total_available: 170,
    new_contacts_capacity: 17,
    instances: [
      { instance: 'gely-wa', new_contacts_left: 5 },
      { instance: 'otra', new_contacts_left: 12 },
    ],
  }
  assert.equal(getOverBy(stats, 17, 17), 0)
  assert.equal(getOverBy(stats, 18, 18), 1)
  const rows = [
    ...[1, 2, 3, 4, 5, 6].map(id => ({ id, inst: 'gely-wa' })),
    ...[7, 8, 9, 10, 11, 12].map(id => ({ id, inst: 'otra' })),
  ]
  const { kept, trimmed } = fitNewContacts(rows, stats, row => row.inst)
  assert.equal(kept.filter(r => r.inst === 'gely-wa').length, 5)
  assert.equal(kept.filter(r => r.inst === 'otra').length, 6)
  assert.equal(trimmed, 1)
})

test('dropping a session drops its room from the counter', () => {
  const withTwo = { total_available: 40, new_contacts_capacity: 10 }
  const withOne = { total_available: 20, new_contacts_capacity: 5 }
  assert.equal(getOverBy(withTwo, 6, 6), 0)
  assert.equal(getOverBy(withOne, 6, 6), 1)
  assert.equal(capOverflowKind(withOne, 6, 6), 'new')
})

test('the new-contact cap is what the button names when it is the tighter limit', () => {
  const stats = { total_available: 20, new_contacts_capacity: 5 }
  assert.equal(capOverflowKind(stats, 6, 6), 'new')
  assert.equal(capOverflowKind(stats, 25, 0), 'daily')
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
