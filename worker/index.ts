import { createApp } from './app'
import type { Env } from './types'

const app = createApp()
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, { ...env, EDGE_CACHE: caches.default }, ctx)
  },
}
