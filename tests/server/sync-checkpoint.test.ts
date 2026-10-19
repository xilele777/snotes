import { afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SqliteDatabase } from '../../server/sqlite'
import { createApp } from '../../worker/app'
import { syncCheckpointContract } from '../sync-checkpoint-contract'
import type { Env } from '../../worker/types'
let directory: string
let db: SqliteDatabase
const app = createApp()
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snotes-checkpoint-')); db = new SqliteDatabase(join(directory, 'notes.sqlite')); db.migrate(resolve('migrations')) })
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
const environment = (): Env => ({ DB: db, R2: {} as Env['R2'], ACCESS_TOKEN: 'test' })
syncCheckpointContract((path, body) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, environment()), environment)
