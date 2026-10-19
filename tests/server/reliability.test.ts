import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createServerApp } from '../../server/app'
import { SqliteDatabase } from '../../server/sqlite'
import { purgeNotes, reapTombstones, TOMBSTONE_RETENTION_MS } from '../../worker/db'
import { deleteOrphanImages, ORPHAN_IMAGE_GRACE_MS } from '../../worker/maintenance'
import { cleanupDeletedNotebookImages } from '../../worker/knowledge-base-deletion'
import type { Database, Statement } from '../../worker/storage'
import type { Env } from '../../worker/types'

let directory: string
let db: SqliteDatabase
let app: ReturnType<typeof createServerApp>
let env: Env
const deleted = vi.fn(async () => {})
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'snotes-reliability-'))
  db = new SqliteDatabase(join(directory, 'notes.sqlite'))
  db.migrate(resolve('migrations'))
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(directory, 'assets', 'large.js'), 'const example = 1;\n'.repeat(1000))
  app = createServerApp(directory)
  env = { DB: db, R2: { delete: deleted } as unknown as Env['R2'], ACCESS_TOKEN: 'test' }
  deleted.mockClear()
})
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks() })
const create = (id: string, content: string, extra = {}) => app.request('/api/notes', {
  method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, content, title: content.slice(0, 40), summary: '', create_time: 1, ...extra }),
}, env)

it('concurrent tombstone revival keeps metadata and body from one winner', async () => {
  await create('revive', 'original')
  await purgeNotes(env, ['revive'])
  const responses = await Promise.all([create('revive', 'first'), create('revive', 'second')])
  expect(responses.map(r => r.status).sort()).toEqual([200, 503])
  const row = await db.prepare('SELECT n.title, b.content FROM note n JOIN note_body b ON n.id = b.note_id WHERE n.id = ?').bind('revive').first<{ title: string; content: string }>()
  expect(['first', 'second']).toContain(row!.title)
  expect(row!.content).toBe(row!.title)
})

it('purge and reaping stay below the D1 limit for 101 IDs', async () => {
  let maximum = 0
  const limited: Database = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return new Proxy(statement, {
        get(target, key) {
          if (key === 'bind') return (...values: Parameters<Statement['bind']>) => {
            maximum = Math.max(maximum, values.length)
            if (values.length > 100) throw new Error('D1 bind limit exceeded')
            return target.bind(...values)
          }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
    batch: db.batch.bind(db),
  }
  const ids = Array.from({ length: 101 }, (_, i) => `n-${i}`)
  await db.batch(ids.map(id => db.prepare('INSERT INTO note (id, create_time, update_time) VALUES (?, 1, 1)').bind(id)))
  await purgeNotes({ ...env, DB: limited }, ids)
  await reapTombstones({ ...env, DB: limited }, Date.now() + TOMBSTONE_RETENTION_MS + 100_000)
  expect(maximum).toBeLessThanOrEqual(81)
  expect(await db.prepare('SELECT count(*) AS n FROM note').first()).toEqual({ n: 0 })
})

it('database rollback never deletes image bytes', async () => {
  await create('owner', '![image](/api/images/owner/p.png)')
  await db.prepare('INSERT INTO image VALUES (?, ?, 1, ?, 1)').bind('owner/p.png', 'owner', 'image/png').run()
  const faulty: Database = { prepare: db.prepare.bind(db), batch: statements => db.batch([...statements, db.prepare('SELECT * FROM missing_table')]) }
  await expect(purgeNotes({ ...env, DB: faulty }, ['owner'])).rejects.toThrow()
  expect(deleted).not.toHaveBeenCalled()
  expect(await db.prepare('SELECT content FROM note_body WHERE note_id = ?').bind('owner').first()).toEqual({ content: '![image](/api/images/owner/p.png)' })
})

it('purge and maintenance retain image bytes even after references disappear', async () => {
  await create('owner', 'no image')
  await create('reader', '![image](/api/images/owner/p.png)')
  await db.prepare('INSERT INTO image VALUES (?, ?, 1, ?, 1)').bind('owner/p.png', 'owner', 'image/png').run()
  await purgeNotes(env, ['owner'])
  expect(deleted).not.toHaveBeenCalled()
  await db.prepare('INSERT INTO note_history (note_id, time, body) VALUES (?, 1, ?)').bind('reader', '/api/images/owner/p.png').run()
  await db.prepare('UPDATE note_body SET content = ? WHERE note_id = ?').bind('no image', 'reader').run()
  await deleteOrphanImages(env, ORPHAN_IMAGE_GRACE_MS + 100)
  expect(deleted).not.toHaveBeenCalled()
  await db.prepare('DELETE FROM note_history').run()
  await deleteOrphanImages(env, ORPHAN_IMAGE_GRACE_MS + 100)
  expect(await db.prepare('SELECT file_key FROM image').first()).not.toBeNull()
  await deleteOrphanImages(env, ORPHAN_IMAGE_GRACE_MS + 100)
  expect(await db.prepare('SELECT file_key FROM image').first()).not.toBeNull()
  expect(deleted).not.toHaveBeenCalled()
})

it('Node static gzip negotiates correctly and decompresses to the original bytes', async () => {
  const response = await app.request('/assets/large.js', { headers: { 'Accept-Encoding': 'gzip' } }, env)
  expect(response.headers.get('Content-Encoding')).toBe('gzip')
  expect(response.headers.get('Vary')).toContain('Accept-Encoding')
  const bytes = Buffer.from(await response.arrayBuffer())
  expect(bytes.byteLength).toBeLessThan(1000)
  expect(gunzipSync(bytes).toString()).toBe('const example = 1;\n'.repeat(1000))
  const plain = await app.request('/assets/large.js', {}, env)
  expect(plain.headers.get('Content-Encoding')).toBeNull()
  expect(await plain.text()).toBe('const example = 1;\n'.repeat(1000))
})

it('rejects dates outside the JS Date range and UTF-8 bodies outside the sync limit', async () => {
  expect((await create('bad-date', 'text', { create_time: Number.MAX_SAFE_INTEGER })).status).toBe(400)
  expect((await create('oversized', '中'.repeat(350_000))).status).toBe(413)
  expect(await db.prepare('SELECT count(*) AS n FROM note').first()).toEqual({ n: 0 })
})

it('notebook deletion queue retains image objects after references disappear', async () => {
  await create('reader', '![](/api/images/deleted-book/photo.png)')
  await db.prepare('INSERT INTO knowledge_base_deleted_image (file_key, knowledge_base_id) VALUES (?, ?)').bind('deleted-book/photo.png', 'deleted-book').run()
  await cleanupDeletedNotebookImages(env)
  expect(deleted).not.toHaveBeenCalled()
  expect(await db.prepare('SELECT file_key FROM knowledge_base_deleted_image').first()).not.toBeNull()
  await db.prepare('UPDATE note_body SET content = ? WHERE note_id = ?').bind('no image', 'reader').run()
  await cleanupDeletedNotebookImages(env)
  expect(deleted).not.toHaveBeenCalled()
  expect(await db.prepare('SELECT file_key FROM knowledge_base_deleted_image').first()).not.toBeNull()
})
