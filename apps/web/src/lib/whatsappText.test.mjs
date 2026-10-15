import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whatsappTextTokens as parse } from './whatsappText.js'

test('Gas Imperial: formats literal placeholders without fabricating a link', () => {
  const tokens = parse('En *marca* ¡Agradecemos su preferencia! Descarga nuestra APP *link*')
  assert.deepEqual(tokens.filter(t => t.type === 'strong').map(t => t.children[0].text), ['marca', 'link'])
  assert.equal(tokens.some(t => t.type === 'link'), false)
})
test('formats WhatsApp emphasis, nested emphasis, strikethrough and code', () => {
  assert.deepEqual(parse('*hola _Ana_*')[0], { type: 'strong', children: [{ type: 'text', text: 'hola ' }, { type: 'em', children: [{ type: 'text', text: 'Ana' }] }] })
  assert.equal(parse('~antes~')[0].type, 's')
  assert.deepEqual(parse('```https://example.com _literal_```'), [{ type: 'code', text: 'https://example.com _literal_' }])
})
test('handles double asterisks received as literal text', () => {
  assert.deepEqual(parse('**mensaje**'), [{ type: 'strong', children: [{ type: 'text', text: 'mensaje' }] }])
})
test('preserves unmatched markers, line breaks and word underscores', () => {
  assert.deepEqual(parse('Hola\n*incompleto\nmi_variable_ok'), [{ type: 'text', text: 'Hola\n*incompleto\nmi_variable_ok' }])
})
test('makes actual URLs clickable without consuming surrounding punctuation', () => {
  assert.deepEqual(parse('(https://example.com/app).'), [{ type: 'text', text: '(' }, { type: 'link', text: 'https://example.com/app', href: 'https://example.com/app' }, { type: 'text', text: ').' }])
})
test('keeps query strings, underscores and balanced parentheses in URLs', () => {
  const address = 'https://example.com/app_(gas)?id=1&tipo=gas_lp'
  assert.deepEqual(parse(address), [{ type: 'link', text: address, href: address }])
})
test('links www addresses and formatted URLs', () => {
  assert.equal(parse('www.example.com/app')[0].href, 'https://www.example.com/app')
  assert.equal(parse('*https://example.com/app*')[0].children[0].href, 'https://example.com/app')
})
test('does not interpret HTML or unsafe URL schemes', () => {
  for (const input of ['<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'data:text/html,test', '[abrir](javascript:alert(1))', 'https://']) {
    assert.deepEqual(parse(input), [{ type: 'text', text: input }])
  }
})
