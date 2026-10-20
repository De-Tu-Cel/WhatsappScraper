/* global require, __dirname */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/phoneVerification.js'), 'utf8')
  .replace('export function phoneVerification', 'function phoneVerification')
const context = {}
vm.runInNewContext(source + '\nglobalThis.lookup=phoneVerification', context)

test('primary number without a lookup is not verified', () => {
  assert.equal(context.lookup({}, '+525512345678'), null)
})
test('Mexican legacy alias shares the latest verification', () => {
  const result = context.lookup({
    '+5215512345678': { valid: true, checked_at: '2026-10-01' },
    '+525512345678': { valid: false, checked_at: '2026-10-19' },
  }, '+52 55 1234 5678')
  assert.equal(result.valid, false)
})
test('same national digits in another country never inherit verification', () => {
  assert.equal(context.lookup({ '+573122882088': { valid: true } }, '+523122882088'), null)
  assert.equal(context.lookup({ '+573122882088': { valid: true } }, '+57 312 288 2088').valid, true)
})
