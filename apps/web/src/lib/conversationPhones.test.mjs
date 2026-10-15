import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationPhoneKey, uniqueConversationPhones, formatConversationPhone, conversationMessageKeys, conversationNumberStats } from './conversationPhones.js'

test('MX historical alias collapses while Colombian and Mexican numbers remain distinct', () => {
  assert.equal(conversationPhoneKey('5215578432154@c.us'), conversationPhoneKey('+52 55 7843 2154'))
  assert.deepEqual(uniqueConversationPhones(['+523112000000', '+573112000000', '523112000000']), ['+523112000000', '+573112000000'])
  assert.notEqual(formatConversationPhone('+523112000000'), formatConversationPhone('+573112000000'))
  assert.equal(formatConversationPhone('+410215101710'), '+410215101710')
})

test('verification alone never counts as a contact; only three Gaservicio numbers have sends', () => {
  const numbers = ['525671254067', '526622561846', '526624712278', '526624332047', '526624294484', '526621391981', '526621910039']
  const messages = numbers.slice(0, 3).map(number => ({ direction: 'outbound', to_number: number, status: 'sent' }))
  const stats = conversationNumberStats(messages, numbers)
  assert.equal(Object.values(stats).filter(s => s.sent > 0).length, 3)
  assert.equal(stats[numbers[6]].sent, 0)
})

test('Frontiers unused number and Claro same national digits retain separate histories', () => {
  const messages = [{ direction: 'outbound', to_number: '522212332022', status: 'sent' },
    { direction: 'outbound', to_number: '523112000000', status: 'failed' },
    { direction: 'outbound', to_number: '573112000000', status: 'sent' },
    { direction: 'inbound', from_number: '573112000000', body: 'asistente virtual' }]
  const stats = conversationNumberStats(messages, ['410215101710', '522212332022', '523112000000', '573112000000'])
  assert.deepEqual(stats['410215101710'], { sent: 0, received: 0, failed: 0 })
  assert.deepEqual(stats['523112000000'], { sent: 0, received: 0, failed: 1 })
  assert.deepEqual(stats['573112000000'], { sent: 1, received: 1, failed: 0 })
})

test('LID replies follow the last successful send or explicit correlation, never every tab', () => {
  const messages = [{ direction: 'outbound', to_number: '525512345678', status: 'sent' },
    { direction: 'outbound', to_number: '525587654321', status: 'failed' },
    { direction: 'inbound', from_number: '123456789012345@lid' },
    { direction: 'inbound', from_number: 'other@lid', related_to_number: '525587654321' }]
  assert.deepEqual(conversationMessageKeys(messages), ['525512345678', '525587654321', '525512345678', '525587654321'])
})

test('pending optimistic sends are not presented as successful contacts', () => {
  const stats = conversationNumberStats([{ direction: 'outbound', to_number: '525512345678', status: 'pending' }], ['525512345678'])
  assert.equal(stats['525512345678'].sent, 0)
})
