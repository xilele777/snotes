import { createApp } from '../../worker/app'
import type { Env } from '../../worker/types'
import { testRestore } from './m3-test-control'
const app = createApp()
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/__android-test/restore') return testRestore(request, env.DB)
    return app.fetch(request, env, ctx)
  },
}
