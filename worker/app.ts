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
import { instanceEpoch } from './sync-checkpoint'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  // 注册在 auth 之前，因此保持免鉴权：它不返回任何数据，只供部署后冒烟
  app.get('/api/health', (c) => c.json({ ok: true }))

  app.route('/', agentRoutes)
  app.use('/api/*', auth)
  app.use('/api/*', async (c, next) => {
    // Reads used for recovery remain available with a stale epoch. Mutations
    // from an old tab must stop until that tab completes reconciliation.
    const epoch = await instanceEpoch(c.env.DB, c.env.SYNC_INSTANCE_EPOCH)
    c.header('X-Snotes-Epoch', epoch)
    c.header('Cache-Control', 'no-store')
    const mutates = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
      && !c.req.path.includes('/sync/') && !c.req.path.endsWith('/opens')
    const supplied = c.req.header('X-Snotes-Epoch')
    if (mutates && (supplied && supplied !== epoch || !supplied && c.env.SYNC_REQUIRE_EPOCH === 'true')) {
      return c.json({ error: 'sync_reset_required' }, 409)
    }
    await next()
  })

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
