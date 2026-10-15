import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCategoryConfig, matchesCategory, normCategory } from './categoryConfig.js'

test('historical human-assisted bots share Bots label, color and filter', () => {
  for (const category of ['hibrido', 'hibrido_bot', 'menu']) {
    const row = { category, is_ai: false }
    assert.equal(normCategory(category), 'bot')
    assert.deepEqual(getCategoryConfig(row), getCategoryConfig({ category: 'bot' }))
    assert.equal(matchesCategory(row, 'bot'), true)
    assert.equal(matchesCategory(row, 'bot_ia'), false)
  }
})

test('the merge leaves AI agents and automatic acknowledgements separate', () => {
  assert.equal(getCategoryConfig({ category: 'bot', is_ai: true }).tKey, 'botAi')
  assert.equal(matchesCategory({ category: 'bot', is_ai: true }, 'bot'), false)
  assert.equal(getCategoryConfig({ category: 'hibrido_bot', is_ai: true }).tKey, 'bot')
  assert.equal(getCategoryConfig({ category: 'hibrido_automatico' }).tKey, 'automatic')
  assert.equal(matchesCategory({ category: 'hibrido_automatico' }, 'automatico'), true)
})
