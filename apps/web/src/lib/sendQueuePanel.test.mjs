import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  secondsUntil, formatCountdown, formatSendWhen, itemClockLine,
  groupQueueItems, countQueue, newestCreatedAt, shouldReopenOnNewSend, summaryTitle,
} from './sendQueuePanel.js'

const now = new Date('2026-10-08T17:42:18.000-06:00')

test('el reloj del siguiente envío baja desde next_action_at y no se atrasa solo', () => {
  const target = new Date(now.getTime() + 27_400).toISOString()
  assert.equal(secondsUntil(target, now.getTime()), 28)
  assert.equal(secondsUntil(target, now.getTime() + 1000), 27)
  assert.equal(formatCountdown(28), '00:28')
  assert.equal(formatCountdown(3723), '1:02:03')
})

test('un envío de hoy muestra día y segundo; uno de ayer dice ayer', () => {
  assert.match(formatSendWhen('2026-10-08T17:42:18.000-06:00', now), /^hoy \d{2}:\d{2}:\d{2}$/)
  assert.match(formatSendWhen('2026-10-07T16:03:12.000-06:00', now), /^ayer \d{2}:\d{2}:\d{2}$/)
  assert.match(formatSendWhen('2026-10-06T09:00:01.000-06:00', now), /6.*\d{2}:\d{2}:\d{2}/)
})

test('el que espera anuncia cuánto le falta; el enviado guarda su hora', () => {
  const waiting = itemClockLine({ display_status: 'waiting', next_action_at: '2026-10-08T17:42:45.000-06:00' }, 27)
  assert.match(waiting, /^Sale en 00:27 · /)
  assert.match(waiting, /\d{2}:\d{2}:\d{2}/)
  const sent = itemClockLine({ status: 'sent', finished_at: '2026-10-08T17:40:01.000-06:00' })
  assert.match(sent, /^Enviado /)
  assert.match(sent, /\d{2}:\d{2}:\d{2}/)
  assert.match(
    itemClockLine({ display_status: 'paused', wait_message: 'WhatsApp se desconectó' }, 90),
    /WhatsApp se desconectó · reintenta en 01:30/,
  )
})

test('un lote nuevo no borra el de antes: cada uno queda en su grupo', () => {
  const groups = groupQueueItems([
    { id: 'a', batch_id: '1', batch_label: 'Primero', created_at: '10:00' },
    { id: 'b', batch_id: '2', batch_label: 'Después', created_at: '11:00' },
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].label, 'Primero')
  assert.equal(groups[1].label, 'Después')
})

test('los contadores separan enviados de los que aún van a salir', () => {
  const counts = countQueue([
    { status: 'sent' },
    { status: 'pending' },
    { status: 'sending', display_status: 'sending' },
    { status: 'pending', display_status: 'waiting' },
  ])
  assert.deepEqual(counts, { active: 3, sent: 1, pendingCancel: 2 })
})

test('si el usuario la cerró, un envío más nuevo la vuelve a abrir', () => {
  assert.equal(shouldReopenOnNewSend('2026-10-08T17:00:00.000Z', '2026-10-08T17:10:00.000Z'), true)
  assert.equal(shouldReopenOnNewSend('2026-10-08T17:10:00.000Z', '2026-10-08T17:10:00.000Z'), false)
  assert.equal(shouldReopenOnNewSend('', '2026-10-08T17:10:00.000Z'), true)
  assert.equal(newestCreatedAt([{ created_at: 'a' }, { created_at: 'c' }, { created_at: 'b' }]), 'c')
})

test('el título usa el delay real: mensaje, lote o WhatsApp caído', () => {
  assert.equal(summaryTitle({ phase: 'sending', activeCount: 2 }), 'Enviando ahora')
  assert.equal(summaryTitle({ phase: 'waiting', waitReason: 'message_delay', countdown: 27 }), 'Siguiente envío en 00:27')
  assert.equal(summaryTitle({ phase: 'waiting', waitReason: 'batch_break', countdown: 185 }), 'Pausa de lote en 03:05')
  assert.equal(summaryTitle({ phase: 'paused', waitMessage: 'WhatsApp se desconectó' }), 'WhatsApp se desconectó')
  assert.equal(summaryTitle({ phase: 'idle', activeCount: 0 }), 'Envíos de hoy')
})
