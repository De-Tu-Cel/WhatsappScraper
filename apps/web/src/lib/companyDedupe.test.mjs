// Corre con: node --test src/lib/companyDedupe.test.mjs
// Sin Jest/Vitest/RTL — no existen en este repo, así que la lógica pura
// (sin render de React) se prueba con el test runner nativo de Node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeByCompany } from './companyDedupe.js'

test('keeps the first row per company_id and drops later duplicates', () => {
  const rows = [
    { company_id: 'co-a', number: '1' },
    { company_id: 'co-a', number: '2' },
    { company_id: 'co-b', number: '3' },
    { company_id: 'co-a', number: '4' },
  ]
  const result = dedupeByCompany(rows)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map(r => r.company_id), ['co-a', 'co-b'])
  assert.equal(result[0].number, '1') // primer número visto, no el último
})

test('returns an empty array for an empty input', () => {
  assert.deepEqual(dedupeByCompany([]), [])
})

test('rows with no duplicates pass through unchanged', () => {
  const rows = [{ company_id: 'co-a' }, { company_id: 'co-b' }, { company_id: 'co-c' }]
  assert.deepEqual(dedupeByCompany(rows), rows)
})

test('rows sharing a falsy/undefined company_id are treated as one group', () => {
  // company_id ausente no debería crashear — igual que el filtro previo a esta
  // extracción (waRowsAll ya exige r.company_id truthy antes de deduplicar).
  const rows = [{ company_id: undefined, n: 1 }, { company_id: undefined, n: 2 }]
  const result = dedupeByCompany(rows)
  assert.equal(result.length, 1)
  assert.equal(result[0].n, 1)
})
