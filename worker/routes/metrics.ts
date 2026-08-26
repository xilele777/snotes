import { Hono } from 'hono'
import { collectMetrics } from '../metrics/collect'
import type { Env } from '../types'

/**
 * 监控页数据源（Bug 8）：POST /api/metrics/types。
 * 走现有 auth 中间件（在 app.ts 里 /api/* 统一鉴权），未授权访问不到指标。
 * CF 账号凭证是 Worker secret，只在服务端读，前端拿不到。
 */
export const metricsRoutes = new Hono<{ Bindings: Env }>()

metricsRoutes.post('/api/metrics/types', async (c) => {
  const env = c.env

  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return c.json(
      {
        error: 'not_configured',
        message: '监控未配置：请设置 CF_ACCOUNT_ID 与 CF_API_TOKEN（wrangler secret put）',
      },
      503
    )
  }

  const data = await collectMetrics({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_API_TOKEN,
    d1DatabaseId: env.D1_DATABASE_ID,
    r2BucketName: env.R2_BUCKET_NAME,
  })

  return c.json({ ok: true, data })
})
