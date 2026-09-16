import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { extname, join, resolve } from 'node:path'
import { createApp } from '../worker/app'
import type { Env } from '../worker/types'

export function createServerApp(assetDirectory: string) {
  const app = new Hono<{ Bindings: Env }>()
  const root = resolve(assetDirectory)
  app.use('/api/*', bodyLimit({ maxSize: 12 * 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }))
  app.route('/', createApp())
  // 未知 API 不能被 SPA 的 index.html 吞掉。
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))
  app.all('/api', (c) => c.json({ error: 'not_found' }, 404))
  app.use('*', async (c, next) => {
    if (c.req.path.split('/').some((part) => part.startsWith('.'))) return c.notFound()
    await next()
    c.header('Cache-Control', c.res.status === 200 && c.req.path.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable' : 'no-cache')
  })
  app.use('*', serveStatic({ root }))
  app.get('*', async (c, next) => {
    if (extname(c.req.path) || c.req.path.startsWith('/assets/')) return c.notFound()
    c.header('Cache-Control', 'no-cache')
    return (await serveStatic({ path: join(root, 'index.html') })(c, next)) ?? c.notFound()
  })
  return app
}
