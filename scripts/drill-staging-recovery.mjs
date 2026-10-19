import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const configPath = process.argv[2]
if (!configPath) throw new Error('Pass the dedicated staging Wrangler configuration path')
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'))
if (parsed.error) throw new Error('Invalid staging JSON/JSONC configuration')
const config = parsed.config
const database = config.d1_databases?.[0]
if (process.env.SNOTES_STAGING_DEDICATED !== 'true' || !config.name.startsWith('snotes-acceptance-')
  || !database?.database_name.startsWith('snotes-acceptance-') || database.database_id === '66325ab4-c335-4976-9a62-b0c9e5e21e97') throw new Error('Dedicated disposable staging configuration required')
const origin = process.env.SNOTES_STAGING_URL
const token = process.env.SNOTES_STAGING_TOKEN
if (!origin || !token) throw new Error('Set staging origin and token')
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js')
function cli(args) {
  return JSON.parse(execFileSync(process.execPath, [wrangler, ...args, '--config', resolve(configPath), '--json'], { encoding: 'utf8', timeout: 180_000, maxBuffer: 10_000_000 }))
}
function sql(command) { return cli(['d1', 'execute', database.database_name, '--remote', '--command', command]) }
let epoch
async function api(path, body, method = 'POST', expected = 200, supplied = epoch) {
  const res = await fetch(new URL(path, origin), { method, headers: { Authorization: `Bearer ${token}`, ...(supplied ? { 'X-Snotes-Epoch': supplied } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  assert.equal(res.status, expected, `${path}: ${res.status}`)
  return res.json()
}
const report = { origin, started: new Date().toISOString(), cases: [] }
epoch = (await api('/api/sync/instance', undefined, 'GET')).epoch
const id = randomUUID()
const meta = { id, name: '恢复演练', description: '', icon: '📚', ord: 0, invalid: 0 }
await api('/api/knowledge-bases', { ...meta, operation_id: randomUUID() })
const before = await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })
const noteReceipt = await api('/api/sync/pull', { since: 0, limit: 1 })
const bookmark = cli(['d1', 'time-travel', 'info', database.database_name]).bookmark
assert(bookmark)
await api(`/api/knowledge-bases/${id}`, { ...meta, name: '恢复点之后', base_meta_version: 1, operation_id: randomUUID() }, 'PATCH')
const later = await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })
const restore = cli(['d1', 'time-travel', 'restore', database.database_name, '--bookmark', bookmark])
// Crucial boundary: snapshots restore receipts too. Before the external hook
// the exact old receipt is valid again; rotating deployment identity fences it.
assert.equal((await api('/api/knowledge-bases/sync/checkpoint', { since: before.until, checkpoint: before.checkpoint })).valid, true)
execFileSync(process.execPath, ['scripts/rotate-sync-epoch.mjs', resolve(configPath), ...(config.vars?.SYNC_REQUIRE_EPOCH === 'true' ? ['--strict-enabled'] : [])], { stdio: 'pipe', timeout: 180_000 })
const oldEpoch = epoch
for (let attempt = 0; attempt < 20; attempt++) {
  epoch = (await api('/api/sync/instance', undefined, 'GET')).epoch
  if (epoch !== oldEpoch) break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
assert.notEqual(epoch, oldEpoch)
assert.equal((await api('/api/knowledge-bases/sync/checkpoint', { since: before.until, checkpoint: before.checkpoint })).valid, false)
assert.equal((await api('/api/sync/checkpoint', { since: noteReceipt.server_time, checkpoint: noteReceipt.checkpoint })).valid, false)
await api(`/api/knowledge-bases/${id}`, { ...meta, name: '必须拒绝', base_meta_version: 1, operation_id: randomUUID() }, 'PATCH', 409, oldEpoch)
await api(`/api/knowledge-bases/${id}`, { ...meta, name: '必须拒绝旧客户端', base_meta_version: 1, operation_id: randomUUID() }, 'PATCH', 409, null)
assert.equal((await api(`/api/knowledge-bases/${id}/toc`, undefined, 'GET')).book.name, '恢复演练')
report.cases.push({ name: 'full-time-travel-restore', bookmark, restore, before_epoch: oldEpoch, after_epoch: epoch, stale_both_domain_receipts: 'rejected', old_writes: 'rejected', status: 'passed', later_watermark: later.until })
const notes = await api('/api/sync/pull', { since: 0, limit: 1 })
const books = await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })
// A notebook-only table restore does not advance the note watermark, nor the
// independent notebook clock. Revisions still invalidate the same-watermark receipt.
sql(`UPDATE knowledge_base SET name = '仅恢复笔记本表' WHERE id = '${id}'`)
assert.equal((await api('/api/sync/checkpoint', { since: notes.server_time, checkpoint: notes.checkpoint })).valid, true)
assert.equal((await api('/api/knowledge-bases/sync/checkpoint', { since: books.until, checkpoint: books.checkpoint })).valid, false)
const inventory = await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })
assert(inventory.books.some(book => book.id === id && book.name === '仅恢复笔记本表'))
assert.equal(inventory.until, books.until)
report.cases.push({ name: 'same-watermark-notebook-only-replacement', note_watermark: notes.server_time, book_watermark: books.until, status: 'passed' })
sql(`DELETE FROM knowledge_base_toc WHERE knowledge_base_id = '${id}'; DELETE FROM knowledge_base_operation WHERE knowledge_base_id = '${id}'; DELETE FROM knowledge_base WHERE id = '${id}'`)
const missing = await api('/api/knowledge-bases/sync/pull', { since: 0, inventory: true })
assert(!missing.books.some(book => book.id === id))
report.cases.push({ name: 'completely-missing-notebook-inventory', status: 'passed' })
report.finished = new Date().toISOString()
mkdirSync('tmp/acceptance', { recursive: true })
writeFileSync('tmp/acceptance/staging-recovery.json', JSON.stringify(report, null, 2))
console.log('Recovery drill passed; evidence: staging-recovery.json')
