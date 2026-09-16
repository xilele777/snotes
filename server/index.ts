import { serve } from '@hono/node-server'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServerApp } from './app'
import { readConfig } from './config'
import { DiskImages } from './images'
import { SqliteDatabase } from './sqlite'

// 构建产物在 dist-server/；静态资源与迁移路径不依赖启动时的工作目录。
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = readConfig()
const assets = join(projectRoot, 'dist')
if (!existsSync(join(assets, 'index.html'))) throw new Error('Frontend build missing: run npm run build:server first')
const db = new SqliteDatabase(join(config.dataDirectory, 'snotes.sqlite'))
try {
  const applied = db.migrate(join(projectRoot, 'migrations'))
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)
} catch (error) {
  db.close()
  throw error
}
const env = { DB: db, R2: new DiskImages(join(config.dataDirectory, 'images')), ACCESS_TOKEN: config.token, RUNTIME: 'server' as const }
const app = createServerApp(assets)
const server = serve({ fetch: (request) => app.fetch(request, env), port: config.port, hostname: config.hostname }, (info) => {
  console.log(`snotes listening on ${config.hostname}:${info.port}`)
})
server.on('error', (error) => { console.error(error.message); db.close(); process.exit(1) })
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  const timer = setTimeout(() => process.exit(1), 10_000).unref()
  server.close(() => { clearTimeout(timer); db.close(); process.exit(0) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
