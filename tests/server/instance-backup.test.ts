import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteDatabase } from '../../server/sqlite'
import { createApp } from '../../worker/app'
import type { Env } from '../../worker/types'
// @ts-expect-error CLI module is intentionally plain Node JavaScript.
import { backupInstance, restoreInstance } from '../../scripts/instance-backup.mjs'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snotes-restore-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

it('restores complete SQLite history, unreferenced trash and image bytes into a fresh instance', () => {
  const source = join(directory, 'source')
  const db = new SqliteDatabase(join(source, 'snotes.sqlite'))
  db.migrate(resolve('migrations'))
  db.connection.exec("INSERT INTO note (id, invalid, create_time, update_time) VALUES ('trash', 1, 1, 1); INSERT INTO note_body (note_id, content) VALUES ('trash', '回收站正文'); INSERT INTO note_history (note_id, time, body) VALUES ('trash', 1, '历史正文');")
  db.close()
  mkdirSync(join(source, 'images', 'unreferenced'), { recursive: true })
  writeFileSync(join(source, 'images', 'unreferenced', 'image.png'), new Uint8Array([1, 2, 3]))
  const backup = join(directory, 'backup')
  backupInstance(source, backup)
  const target = join(directory, 'restored')
  restoreInstance(backup, target)
  const restored = new DatabaseSync(join(target, 'snotes.sqlite'))
  try {
    expect(restored.prepare('SELECT invalid FROM note').get()?.invalid).toBe(1)
    expect(restored.prepare('SELECT body FROM note_history').get()?.body).toBe('历史正文')
    expect(restored.prepare('SELECT content FROM note_body').get()?.content).toBe('回收站正文')
    expect(restored.prepare('SELECT count(*) AS n FROM sync_checkpoint').get()?.n).toBe(0)
  } finally { restored.close() }
  expect([...readFileSync(join(target, 'images/unreferenced/image.png'))]).toEqual([1, 2, 3])
  expect(readFileSync(join(target, 'sync-epoch'), 'utf8')).toMatch(/^[a-f0-9-]{36}$/)
  expect(() => restoreInstance(backup, target)).toThrow('already exists')
  writeFileSync(join(backup, 'images/unreferenced/image.png'), 'corrupt')
  expect(() => restoreInstance(backup, join(directory, 'corrupt'))).toThrow('Checksum mismatch')
})

it('rejects writes from old epochs and can require upgraded clients after recovery', async () => {
  const db = new SqliteDatabase(join(directory, 'snotes.sqlite'))
  db.migrate(resolve('migrations'))
  const app = createApp()
  const env: Env = { DB: db, R2: {} as Env['R2'], ACCESS_TOKEN: 'test', SYNC_INSTANCE_EPOCH: 'new', SYNC_REQUIRE_EPOCH: 'true' }
  const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' }
  const write = (epoch?: string) => app.request('/api/notes', { method: 'POST', headers: { ...headers, ...(epoch ? { 'X-Snotes-Epoch': epoch } : {}) }, body: JSON.stringify({ id: 'test', content: 'text', title: 'text', summary: '', create_time: 1 }) }, env)
  try {
    const instance = await (await app.request('/api/sync/instance', { headers }, env)).json() as { epoch: string }
    expect((await write()).status).toBe(409)
    expect((await write('old')).status).toBe(409)
    expect((await write(instance.epoch)).status).toBe(200)
    env.SYNC_INSTANCE_EPOCH = 'newer'
    expect((await write(instance.epoch)).status).toBe(409)
  } finally { db.close() }
})
