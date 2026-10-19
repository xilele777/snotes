import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'

const origin = process.env.SNOTES_STAGING_URL
const token = process.env.SNOTES_STAGING_TOKEN
if (!origin || !token || process.env.SNOTES_STAGING_DEDICATED !== 'true') throw new Error('Set SNOTES_STAGING_URL, SNOTES_STAGING_TOKEN and SNOTES_STAGING_DEDICATED=true for an EMPTY disposable instance')
const url = new URL(origin)
if (url.pathname !== '/' || url.search || url.hash) throw new Error('Use the staging origin only')
let epoch
async function request(path, body, method = 'POST', expected = 200) {
  const response = await fetch(new URL(path, url), { method, headers: { Authorization: `Bearer ${token}`, ...(epoch ? { 'X-Snotes-Epoch': epoch } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, expected, `${path}: ${response.status}`)
  return response.json()
}
epoch = (await request('/api/sync/instance', undefined, 'GET')).epoch
const initial = await request('/api/sync/pull', { since: 0 })
assert.equal(initial.notes.length, 0, 'Staging must be empty; refusing to mutate existing data')
assert.equal(initial.groups.length, 0, 'Staging must have no existing groups')
assert.equal((await request('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })).books.length, 0, 'Staging must have no existing notebooks')
const ids = []
const started = new Date().toISOString()
const results = []
for (const count of [101, 1000]) {
  const batch = Array.from({ length: count }, () => randomUUID())
  for (let i = 0; i < batch.length; i += 5) await Promise.all(batch.slice(i, i + 5).map(async id => {
    await request('/api/notes', { id, title: 'staging acceptance', summary: '', content: '# 中文批量验收', create_time: Date.now() })
    ids.push(id)
  }))
  const inventory = new Set()
  let cursor = null
  do {
    const page = await request('/api/sync/pull', { since: 0, cursor, limit: 80 })
    page.notes.forEach(note => inventory.add(note.id))
    cursor = page.next_cursor
  } while (cursor)
  assert.equal(inventory.size, ids.length)
  for (let i = 0; i < batch.length; i += 50) {
    const page = await request('/api/sync/bodies', { ids: batch.slice(i, i + 50) })
    assert.equal(page.bodies.length, batch.slice(i, i + 50).length)
    assert(page.bodies.every(note => note.content === '# 中文批量验收'))
  }
  results.push({ count, inventory: inventory.size, status: 'passed' })
  console.log(`Passed create/pagination/body verification for ${count} notes`)
}
const form = new FormData()
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
form.set('file', new Blob([image], { type: 'image/png' }), 'acceptance.png')
form.set('note_id', ids[0])
const uploaded = await fetch(new URL('/api/images/upload', url), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Snotes-Epoch': epoch }, body: form, signal: AbortSignal.timeout(30_000) })
assert(uploaded.ok)
const object = await uploaded.json()
const imageResponse = await fetch(new URL(object.url, url), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
assert(imageResponse.ok)
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), image)
const unauthorized = await fetch(new URL(object.url, url), { signal: AbortSignal.timeout(30_000) })
assert.equal(unauthorized.status, 401)
mkdirSync('tmp/acceptance', { recursive: true })
writeFileSync('tmp/acceptance/staging-acceptance.json', JSON.stringify({ origin: url.origin, started, finished: new Date().toISOString(), epoch, results, image: { url: object.url, verified: true }, note_ids: ids, cleanup: 'Data intentionally retained in dedicated staging for restore drills. Remove the disposable instance after evidence is collected.' }, null, 2))
console.log('Evidence written to tmp/acceptance/staging-acceptance.json; test data retained for recovery drills')
