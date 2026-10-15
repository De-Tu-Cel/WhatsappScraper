import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('./analysisModel.js', import.meta.url), 'utf8')
const { analysisModelInfo } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('each historical result keeps its recorded model independently', () => {
  const old = { model: 'gpt-4.1-mini', provider: 'openai' }
  const latest = { model: 'claude-haiku-5-5', provider: 'anthropic' }
  assert.equal(analysisModelInfo(old).label, 'gpt-4.1-mini')
  assert.equal(analysisModelInfo(latest).provider, 'Anthropic')
  assert.equal(analysisModelInfo(old).provider, 'OpenAI')
})
test('missing identity is distinct from a rule-only result', () => {
  assert.equal(analysisModelInfo({}).kind, 'unknown')
  assert.equal(analysisModelInfo({}, true).label, 'Model not recorded')
  assert.equal(analysisModelInfo({ analysis_origin: 'rules' }).kind, 'rules')
  assert.equal(analysisModelInfo({}, false, 'timing').kind, 'rules')
})
test('model version and alias can be displayed separately', () => {
  const identity = analysisModelInfo({ model: 'gpt-4.1-mini-2025-04-14', model_requested: 'gpt-4.1-mini' })
  assert.equal(identity.label, 'gpt-4.1-mini-2025-04-14')
  assert.equal(identity.requested, 'gpt-4.1-mini')
})
