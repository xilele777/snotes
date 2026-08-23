import { Hono } from 'hono'
import { auth } from './auth'
import { groupsRoutes } from './routes/groups'
import { notesRoutes } from './routes/notes'
import { trashRoutes } from './routes/trash'
import type { Env } from './types'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  // 注册在 auth 之前，因此保持免鉴权：它不返回任何数据，只供部署后冒烟
  app.get('/api/health', (c) => c.json({ ok: true }))

  app.use('/api/*', auth)

  app.route('/', notesRoutes)
  app.route('/', groupsRoutes)
  app.route('/', trashRoutes)

  return app
}
