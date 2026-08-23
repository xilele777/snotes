import { Hono } from 'hono'
import { purgeNotes } from '../db'
import type { Env } from '../types'

// SQLite 默认最多 999 个绑定参数，purgeNotes 一次要为同一批 id 展开三条 IN 语句，
// 分批切到 200 留足余量。
const PURGE_BATCH = 200

export const trashRoutes = new Hono<{ Bindings: Env }>()

trashRoutes.post('/api/trash/clean', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id FROM note WHERE invalid = 1').all<{
    id: string
  }>()

  const ids = results.map((r) => r.id)

  for (let i = 0; i < ids.length; i += PURGE_BATCH) {
    await purgeNotes(c.env, ids.slice(i, i + PURGE_BATCH))
  }

  return c.json({ purged: ids })
})
