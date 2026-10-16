import { Hono } from 'hono'
import { auth } from './auth'
import { groupsRoutes } from './routes/groups'
import { knowledgeBasesRoutes } from './routes/knowledge-bases'
import { imagesRoutes } from './routes/images'
import { metricsRoutes } from './routes/metrics'
import { notesRoutes } from './routes/notes'
import { opensRoutes } from './routes/opens'
import { syncRoutes } from './routes/sync'
import { trashRoutes } from './routes/trash'
import { agentRoutes } from './routes/agent'
import { agentTokenRoutes } from './routes/agent-tokens'
import type { Env } from './types'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  // 注册在 auth 之前，因此保持免鉴权：它不返回任何数据，只供部署后冒烟
  app.get('/api/health', (c) => c.json({ ok: true }))

  app.route('/', agentRoutes)
  app.use('/api/*', auth)

  app.get('/api/runtime', c => {
    c.header('Cache-Control', 'no-store')
    return c.json({ runtime: c.env.RUNTIME === 'server' ? 'server' : 'cloudflare' })
  })

  app.route('/', notesRoutes)
  app.route('/', agentTokenRoutes)
  app.route('/', opensRoutes)
  app.route('/', groupsRoutes)
  app.route('/', knowledgeBasesRoutes)
  app.route('/', syncRoutes)
  app.route('/', trashRoutes)
  app.route('/', imagesRoutes)
  app.route('/', metricsRoutes)

  return app
}
