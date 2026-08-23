import { Hono } from 'hono'
import type { Env } from './types'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/api/health', (c) => c.json({ ok: true }))

  return app
}
