import { afterEach, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SqliteDatabase } from '../../server/sqlite'
import { DiskImages } from '../../server/images'
import { createServerApp } from '../../server/app'
import { agentContract } from '../agent-contract'

let directory: string
let db: SqliteDatabase
let app: ReturnType<typeof createServerApp>
const environment = () => ({ DB: db, R2: new DiskImages(join(directory, 'images')), ACCESS_TOKEN: 'test-token', RUNTIME: 'server' as const })
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'snotes-agent-test-')); db = new SqliteDatabase(join(directory, 'db.sqlite')); db.migrate(resolve('migrations')); app = createServerApp(resolve('dist')) })
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
agentContract(async (path, method = 'GET', body, token, extraHeaders) => {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, environment())
}, environment)
