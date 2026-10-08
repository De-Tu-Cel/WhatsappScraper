import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOGIN_GRACE_MS, VERSION_RELOAD_GRACE_MS,
  decideBuildBind, decideVersionReload, versionReloadUrl,
} from './sessionGuard.js'

const ready = {
  pageBuildId: 'page-new',
  liveBuildId: 'live-old',
  pendingLive: null,
  alreadyReloadedFor: null,
  documentComplete: true,
  pageAgeMs: VERSION_RELOAD_GRACE_MS + 1,
  msSinceActivity: LOGIN_GRACE_MS + 1,
}

test('no recarga si la página aún está pintando o acaba de abrir', () => {
  assert.equal(decideVersionReload({ ...ready, documentComplete: false }).action, 'wait')
  assert.equal(decideVersionReload({ ...ready, pageAgeMs: 800 }).action, 'wait')
})

test('no recarga a los segundos de entrar: es el login, no un deploy', () => {
  assert.equal(decideVersionReload({ ...ready, msSinceActivity: 8_000 }).action, 'wait')
})

test('un id distinto se confirma dos veces antes de recargar', () => {
  const first = decideVersionReload(ready)
  assert.equal(first.action, 'confirm')
  assert.equal(first.pending, 'live-old')
  const second = decideVersionReload({ ...ready, pendingLive: 'live-old' })
  assert.equal(second.action, 'reload')
})

test('si el vivo coincide con la página, no recarga', () => {
  assert.equal(decideVersionReload({ ...ready, liveBuildId: 'page-new' }).action, 'match')
})

test('sin marca de build en el login se pega; no saca', () => {
  assert.equal(decideBuildBind({ bound: null, live: 'abc', msSinceActivity: 2_000 }), 'bind')
  assert.equal(decideBuildBind({ bound: 'abc', live: 'abc', msSinceActivity: 2_000 }), 'keep')
})

test('un desajuste justo después de entrar se pega; uno tarde saca', () => {
  assert.equal(decideBuildBind({ bound: 'old', live: 'new', msSinceActivity: 4_000 }), 'bind')
  assert.equal(decideBuildBind({ bound: 'old', live: 'new', msSinceActivity: null }), 'bind')
  assert.equal(decideBuildBind({ bound: 'old', live: 'new', msSinceActivity: LOGIN_GRACE_MS + 1 }), 'logout')
})

test('la recarga sigue siendo una ruta relativa, no localhost', () => {
  assert.equal(versionReloadUrl('https://app.detucel.com/', 'abc'), '/?_v=abc')
})
