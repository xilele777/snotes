import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServerApp } from '../../server/app'
import { DiskImages } from '../../server/images'
import { SqliteDatabase } from '../../server/sqlite'
import { ORPHAN_IMAGE_GRACE_MS, runMaintenance } from '../../worker/maintenance'

let directory: string
let db: SqliteDatabase
let app: ReturnType<typeof createServerApp>
let env: { DB: SqliteDatabase; R2: DiskImages; ACCESS_TOKEN: string; RUNTIME: 'server' }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'snotes-api-test-'))
  db = new SqliteDatabase(join(directory, 'snotes.sqlite'))
  db.migrate(resolve('migrations'))
  const assets = join(directory, 'dist')
  mkdirSync(join(assets, 'assets'), { recursive: true })
  writeFileSync(join(assets, 'index.html'), '<!doctype html><title>snotes</title>')
  writeFileSync(join(assets, 'sw.js'), '// service worker')
  writeFileSync(join(assets, 'assets', 'app.js'), '// hashed app')
  app = createServerApp(assets)
  env = { DB: db, R2: new DiskImages(join(directory, 'images')), ACCESS_TOKEN: 'dev-token', RUNTIME: 'server' }
})
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })

const api = (path: string, body?: unknown, method = 'POST') => app.request(path, {
  method, headers: { Authorization: 'Bearer dev-token', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, env)

async function createNote() {
  const id = crypto.randomUUID()
  const response = await api('/api/notes', { id, title: 'title', summary: '', content: 'original', create_time: Date.now() })
  expect(response.status).toBe(200)
  return id
}

it('serves public health and SPA, protects API and keeps missing assets out of SPA fallback', async () => {
  expect(await (await app.request('/api/health', {}, env)).json()).toEqual({ ok: true })
  expect((await app.request('/api/sync/pull', { method: 'POST' }, env)).status).toBe(401)
  const index = await app.request('/', {}, env)
  expect(await index.text()).toContain('<title>snotes</title>')
  expect(index.headers.get('Cache-Control')).toBe('no-cache')
  expect((await app.request('/notes/id', {}, env)).status).toBe(200)
  expect((await app.request('/assets/missing.js', {}, env)).status).toBe(404)
  expect((await app.request('/data/snotes.sqlite', {}, env)).status).toBe(404)
  expect((await app.request('/.env', {}, env)).status).toBe(404)
  expect((await api('/api/missing')).status).toBe(404)
  expect((await app.request('/assets/app.js', {}, env)).headers.get('Cache-Control')).toContain('immutable')
  expect((await app.request('/sw.js', {}, env)).headers.get('Cache-Control')).toBe('no-cache')
  const metrics = await api('/api/metrics/types')
  expect(await metrics.json()).toMatchObject({ error: 'not_supported' })
})

it('saves notes, detects concurrent changes and returns sync bodies after restart', async () => {
  const id = await createNote()
  const results = await Promise.all(['a', 'b'].map((content) => api(`/api/notes/${id}`, { content, title: 'title', summary: '', base_version: 1 }, 'PATCH')))
  const updates = await Promise.all(results.map((response) => response.json()))
  expect(updates.filter((result) => result.conflicted)).toHaveLength(1)
  expect(updates.find((result) => result.conflicted).previous_content).toMatch(/^[ab]$/)
  db.close()
  db = new SqliteDatabase(join(directory, 'snotes.sqlite'))
  db.migrate(resolve('migrations'))
  env.DB = db
  const sync = await (await api('/api/sync/pull', { since: 0 })).json()
  expect(sync.notes).toHaveLength(1)
  expect(sync.notes[0].version).toBe(3)
  const bodies = await (await api('/api/sync/bodies', { ids: [id] })).json()
  expect(bodies.bodies[0].content).toMatch(/^[ab]$/)
})

it('uploads images, authorizes Cookie reads, handles ETags and purges disk objects', async () => {
  const id = await createNote()
  const form = new FormData()
  form.set('note_id', id)
  form.set('file', new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' }))
  const upload = await app.request('/api/images/upload', { method: 'POST', headers: { Authorization: 'Bearer dev-token' }, body: form }, env)
  expect(upload.status).toBe(200)
  const { url, file_key } = await upload.json()
  expect((await app.request(url, {}, env)).status).toBe(401)
  const first = await app.request(url, { headers: { Cookie: 'snotes_token=dev-token' } }, env)
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  const second = await app.request(url, { headers: { Cookie: 'snotes_token=dev-token', 'If-None-Match': first.headers.get('ETag')! } }, env)
  expect(second.status).toBe(304)
  await api(`/api/notes/${id}/trash`)
  await api(`/api/notes/${id}/recover`)
  expect(await env.R2.get(file_key)).not.toBeNull()
  await api(`/api/notes/${id}/purge`)
  expect(await env.R2.get(file_key)).toBeNull()
  expect(await db.prepare('SELECT invalid FROM note WHERE id = ?').bind(id).first()).toEqual({ invalid: 2 })
})

it('bounds request bodies before parsing them', async () => {
  const response = await app.request('/api/notes', {
    method: 'POST', headers: { Authorization: 'Bearer dev-token' }, body: 'x'.repeat(12 * 1024 * 1024 + 1),
  }, env)
  expect(response.status).toBe(413)
})

it('runs the shared maintenance job against SQLite and disk images', async () => {
  const kept = await createNote()
  const trashed = await createNote()
  await api(`/api/notes/${kept}`, { content: '![](/api/images/k/kept.png)', title: 'title', summary: '', base_version: 1 }, 'PATCH')
  await api(`/api/notes/${trashed}/trash`)
  const old = Date.now() - ORPHAN_IMAGE_GRACE_MS - 1
  await env.R2.put('k/kept.png', new Uint8Array([1]).buffer)
  await env.R2.put('k/orphan.png', new Uint8Array([1]).buffer)
  await db.batch([
    db.prepare('INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, 1, ?, ?)').bind('k/kept.png', kept, 'image/png', old),
    db.prepare('INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, 1, ?, ?)').bind('k/orphan.png', kept, 'image/png', old),
    db.prepare('UPDATE note SET update_time = ? WHERE id = ?').bind(Date.now() - 8 * 24 * 60 * 60 * 1000, trashed),
  ])

  const report = await runMaintenance({ ...env, TRASH_RETENTION_DAYS: '7' })

  expect(report).toEqual({ orphan_images: 1, expired_trash: 1, reaped_tombstones: 0 })
  expect(await env.R2.get('k/orphan.png')).toBeNull()
  expect(await env.R2.get('k/kept.png')).not.toBeNull()
  expect(await db.prepare('SELECT invalid FROM note WHERE id = ?').bind(trashed).first()).toEqual({ invalid: 2 })
})
