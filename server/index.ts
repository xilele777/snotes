import { serve } from '@hono/node-server'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServerApp } from './app'
import { readConfig } from './config'
import { runMaintenance } from '../worker/maintenance'
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
const env = {
  DB: db, R2: new DiskImages(join(config.dataDirectory, 'images')), ACCESS_TOKEN: config.token, RUNTIME: 'server' as const,
  TRASH_RETENTION_DAYS: config.trashRetentionDays === null ? undefined : String(config.trashRetentionDays),
}
const app = createServerApp(assets)
const server = serve({ fetch: (request) => app.fetch(request, env), port: config.port, hostname: config.hostname }, (info) => {
  console.log(`snotes listening on ${config.hostname}:${info.port}`)
})
// 与 Worker 的 cron 对应：启动后先跑一次，之后每日一次。任务失败只记日志，不影响服务。
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
async function maintain() {
  try {
    const report = await runMaintenance(env)
    console.log(`maintenance: ${JSON.stringify(report)}`)
  } catch (error) {
    console.error(`maintenance failed: ${(error as Error).message}`)
  }
}
const maintenanceTimer = setInterval(maintain, MAINTENANCE_INTERVAL_MS)
maintenanceTimer.unref()
setTimeout(maintain, 5_000).unref()
server.on('error', (error) => { console.error(error.message); db.close(); process.exit(1) })
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  const timer = setTimeout(() => process.exit(1), 10_000).unref()
  clearInterval(maintenanceTimer)
  server.close(() => { clearTimeout(timer); db.close(); process.exit(0) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
