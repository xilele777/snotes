import { serve } from '@hono/node-server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServerApp } from '../../server/app'
import { SqliteDatabase } from '../../server/sqlite'
import { DiskImages } from '../../server/images'
import { TEST_TOKEN, testRestore } from './m3-test-control'

const directory = resolve('android/app/build/m3-node-state')
mkdirSync(join(directory, 'assets'), { recursive: true })
writeFileSync(join(directory, 'assets/index.html'), '<!doctype html><title>Android isolated API test</title>')
const db = new SqliteDatabase(join(directory, 'test.sqlite'))
db.migrate(resolve('migrations'))
const env = { DB: db, R2: new DiskImages(join(directory, 'images')), ACCESS_TOKEN: TEST_TOKEN,
  RUNTIME: 'server' as const, SYNC_REQUIRE_EPOCH: 'true', SYNC_INSTANCE_EPOCH: 'android-m3-node' }
const app = createServerApp(join(directory, 'assets'))
const server = serve({ hostname: '127.0.0.1', port: 18787, fetch: (request) => {
  if (new URL(request.url).pathname === '/__android-test/restore') return testRestore(request, db)
  return app.fetch(request, env)
} }, () => console.log('Isolated Android Node API ready on 127.0.0.1:18787'))
process.on('SIGINT', () => server.close(() => { db.close(); process.exit(0) }))
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0) }))
