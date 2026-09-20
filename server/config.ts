import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseTrashRetentionDays } from '../worker/maintenance'

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = (env.ACCESS_TOKEN ?? (env.ACCESS_TOKEN_FILE ? readFileSync(env.ACCESS_TOKEN_FILE, 'utf8').trim() : '')).trim()
  if (!token) throw new Error('Set ACCESS_TOKEN or ACCESS_TOKEN_FILE before starting the server')
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535')
  // 启动时就校验，非法值直接拒绝启动，而不是等到第一次定时任务才报错。
  const trashRetentionDays = parseTrashRetentionDays(env.TRASH_RETENTION_DAYS)
  return {
    token, port, hostname: env.HOST ?? '127.0.0.1',
    dataDirectory: resolve(env.SNOTES_DATA_DIR ?? 'data'),
    trashRetentionDays,
  }
}
