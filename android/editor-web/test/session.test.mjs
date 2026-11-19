import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const result = await build({ entryPoints: ['src/session.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { WebSession, validLoad } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const load = (sessionId = 'session-a', markdown = '# 原稿\n\n<br />\n') => ({ bridgeVersion: 1, type: 'load', profileId: 'editor-prototype', noteId: 'sample-a', sessionId, markdown, readOnly: false, dark: false, fontSize: 16 })

test('initial normalization and repeated mode changes never save the raw baseline', () => {
  const messages = []
  const session = new WebSession(m => messages.push(m))
  session.load(load())
  session.observeBaseline('# 原稿\n\n\u200b\n')
  session.capture('# 原稿\n\n\u200b\n', false)
  assert.equal(messages.length, 0)
  assert.equal(session.value, load().markdown)
})
test('composition completion publishes even when the final characters do not change', () => {
  const messages = []
  const session = new WebSession(m => messages.push(m))
  session.load(load())
  session.capture('你好', true, true)
  session.capture('你好', false, true)
  assert.deepEqual(messages.map(m => [m.revision, m.composing]), [[1, true], [1, false]])
})
test('old ACKs cannot confirm newer input or another document', () => {
  const session = new WebSession(() => {})
  session.load(load())
  session.capture('一', false, true)
  session.capture('二', false, true)
  assert.equal(session.saved('session-a', 1), false)
  assert.equal(session.saved('session-a', 2), true)
  assert.equal(session.saved('session-a', 1), false)
  session.load(load('session-b'))
  assert.equal(session.saved('session-a', 2), false)
  assert.equal(session.saved('session-b', 10), false)
})
test('undo and redo retain exact source text and reset with the session', () => {
  const session = new WebSession(() => {})
  session.load(load())
  session.capture('修改', false, true)
  assert.equal(session.history(false), load().markdown)
  assert.equal(session.history(true), '修改')
  session.load(load('session-b', '另一篇'))
  assert.equal(session.history(false), undefined)
})
test('read-only and invalid envelopes reject mutations and malformed limits', () => {
  const messages = []
  const session = new WebSession(m => messages.push(m))
  session.load({ ...load(), readOnly: true })
  session.capture('禁止写回', false, true)
  assert.equal(messages.length, 0)
  assert.equal(validLoad(load()), true)
  for (const value of [null, {}, { ...load(), fontSize: NaN }, { ...load(), markdown: 'x'.repeat(2_000_001) }, { ...load(), sessionId: '' }]) assert.equal(validLoad(value), false)
})
