import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteDatabase } from '../../server/sqlite'
import { DiskImages } from '../../server/images'
import { readConfig } from '../../server/config'

let directory: string
let db: SqliteDatabase
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'snotes-server-test-'))
  db = new SqliteDatabase(join(directory, 'snotes.sqlite'))
})
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })

describe('SQLite persistence and migrations', () => {
  it('applies migrations once and preserves data after reopening', async () => {
    expect(db.migrate(resolve('migrations'))).toHaveLength(4)
    await db.prepare('INSERT INTO note (id, create_time, update_time) VALUES (?, ?, ?)').bind('n1', 1, 1).run()
    db.close()
    db = new SqliteDatabase(join(directory, 'snotes.sqlite'))
    expect(db.migrate(resolve('migrations'))).toEqual([])
    expect(await db.prepare('SELECT id FROM note').first()).toEqual({ id: 'n1' })
    expect((await db.prepare('SELECT * FROM note').all()).results).toHaveLength(1)
  })

  it('rolls back every statement in a failed batch', async () => {
    db.migrate(resolve('migrations'))
    await expect(db.batch([
      db.prepare('INSERT INTO note (id, create_time, update_time) VALUES (?, ?, ?)').bind('n1', 1, 1),
      db.prepare('INSERT INTO note_body (note_id, content) VALUES (?, ?)').bind('missing', 'body'),
    ])).rejects.toThrow()
    expect(await db.prepare('SELECT * FROM note').first()).toBeNull()
  })

  it('failed migrations leave neither partial schema nor a success record', () => {
    const migrations = join(directory, 'migrations')
    mkdirSync(migrations)
    writeFileSync(join(migrations, '0001_bad.sql'), 'CREATE TABLE example (id INTEGER); invalid sql;')
    expect(() => db.migrate(migrations)).toThrow()
    expect(db.connection.prepare("SELECT name FROM sqlite_master WHERE name = 'example'").get()).toBeUndefined()
    expect(db.connection.prepare('SELECT * FROM snotes_migrations').all()).toEqual([])
    writeFileSync(join(migrations, '0001_bad.sql'), 'CREATE TABLE example (id INTEGER);')
    expect(db.migrate(migrations)).toEqual(['0001_bad.sql'])
    writeFileSync(join(migrations, '0001_bad.sql'), 'CREATE TABLE example (id TEXT);')
    expect(() => db.migrate(migrations)).toThrow('Applied migration changed')
  })
})

describe('disk images', () => {
  it('persists image bytes and ETag, then removes the file', async () => {
    const images = new DiskImages(join(directory, 'images'))
    await images.put('note/image.png', new Uint8Array([1, 2, 3]).buffer)
    const reopened = new DiskImages(join(directory, 'images'))
    const first = (await reopened.get('note/image.png'))!
    expect(new Uint8Array(first.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
    expect(first.httpMetadata?.contentType).toBe('image/png')
    expect((await images.get('note/image.png'))?.httpEtag).toBe(first.httpEtag)
    await reopened.delete('note/image.png')
    expect(await images.get('note/image.png')).toBeNull()
  })

  it.each(['../outside.png', 'a/../../outside.png', '/outside.png', 'a\\outside.png', 'C:/outside.png', 'a/%2e%2e/outside.png'])('rejects path traversal: %s', async (key) => {
    const images = new DiskImages(join(directory, 'images'))
    await expect(images.put(key, new ArrayBuffer(1))).rejects.toThrow()
    expect(await images.get(key)).toBeNull()
    await expect(images.delete(key)).rejects.toThrow()
  })
})

it('requires a token and accepts a secret file without logging it', () => {
  expect(() => readConfig({})).toThrow('ACCESS_TOKEN')
  expect(() => readConfig({ ACCESS_TOKEN: 'dev-token', PORT: 'bad' })).toThrow('PORT')
  const secret = join(directory, 'token')
  writeFileSync(secret, 'file-token\n')
  expect(readConfig({ ACCESS_TOKEN_FILE: secret }).token).toBe('file-token')
})

it('reads the trash retention period and rejects invalid values at startup', () => {
  expect(readConfig({ ACCESS_TOKEN: 't' }).trashRetentionDays).toBeNull()
  expect(readConfig({ ACCESS_TOKEN: 't', TRASH_RETENTION_DAYS: '' }).trashRetentionDays).toBeNull()
  expect(readConfig({ ACCESS_TOKEN: 't', TRASH_RETENTION_DAYS: '30' }).trashRetentionDays).toBe(30)
  expect(() => readConfig({ ACCESS_TOKEN: 't', TRASH_RETENTION_DAYS: 'abc' })).toThrow('TRASH_RETENTION_DAYS')
})
