import { afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SqliteDatabase } from '../../server/sqlite'
import { DiskImages } from '../../server/images'
import { createApp } from '../../worker/app'
import { knowledgeBaseContract } from '../knowledge-base-contract'

let directory: string
let db: SqliteDatabase
const app = createApp()
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snotes-kb-test-')); db = new SqliteDatabase(join(directory, 'db.sqlite')); db.migrate(resolve('migrations')) })
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
knowledgeBaseContract(async (path, method, body) => app.request(path, { method, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, { DB: db, R2: new DiskImages(join(directory, 'images')), ACCESS_TOKEN: 'test-token' }))
