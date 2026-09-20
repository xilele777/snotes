import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { extname, join, resolve } from 'node:path'
import { createApp } from '../worker/app'
import type { Env } from '../worker/types'
import { LoginLimiter, clientAddress } from './rate-limit'

export function createServerApp(assetDirectory: string, limiter = new LoginLimiter()) {
  const app = new Hono<{ Bindings: Env }>()
  const root = resolve(assetDirectory)
  // 登录限流：同一来源连续 401 达到阈值后返回 429，封锁期逐次翻倍。health 不计入。
  // 来源地址由 server/index.ts 从 socket 取出放进 REMOTE_ADDRESS；X-Forwarded-For 只信任本机或内网代理。
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()
    const key = clientAddress(c.env.REMOTE_ADDRESS, c.req.header('X-Forwarded-For'))
    const wait = limiter.blockedFor(key)
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000)
      c.header('Retry-After', String(seconds))
      return c.json({ error: 'too_many_attempts', retry_after: seconds }, 429)
    }
    await next()
    if (c.res.status === 401) limiter.fail(key)
    else limiter.succeed(key)
  })
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
