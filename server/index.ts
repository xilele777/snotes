import { serve } from '@hono/node-server'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  TRASH_RETENTION_DAYS: config.trashRetentionDays === null ? 'off' : String(config.trashRetentionDays),
  SYNC_INSTANCE_EPOCH: deploymentEpoch(),
  SYNC_REQUIRE_EPOCH: existsSync(join(config.dataDirectory, 'sync-require-epoch')) ? 'true' : process.env.SYNC_REQUIRE_EPOCH,
}
function deploymentEpoch(): string {
  if (process.env.SYNC_INSTANCE_EPOCH) return process.env.SYNC_INSTANCE_EPOCH
  const path = join(config.dataDirectory, 'sync-epoch')
  try { writeFileSync(path, randomUUID(), { flag: 'wx', mode: 0o600 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const epoch = readFileSync(path, 'utf8').trim()
  if (!epoch) throw new Error('Empty sync-epoch')
  return epoch
}
const app = createServerApp(assets)
const server = serve({
  // 登录限流按来源地址计数，socket 对端地址随请求传入；X-Forwarded-For 的可信判断在 server/rate-limit.ts。
  fetch: (request, bindings) => app.fetch(request, { ...env, REMOTE_ADDRESS: bindings.incoming.socket.remoteAddress }),
  port: config.port, hostname: config.hostname,
}, (info) => {
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
