import { createApp } from './app'
import { runMaintenance } from './maintenance'
import type { Env } from './types'

const app = createApp()
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, { ...env, EDGE_CACHE: caches.default }, ctx)
  },
  // wrangler.jsonc 的 triggers.crons 每日触发一次；`wrangler dev --test-scheduled` 时可用
  // `curl "http://localhost:8787/__scheduled"` 手动触发。
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runMaintenance(env, controller.scheduledTime).then((report) => {
      console.log(`maintenance: ${JSON.stringify(report)}`)
    }))
  },
}
