import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import base from './playwright.config'

// 复用全部浏览器用例，服务与数据都独立于 Cloudflare E2E。
process.env.E2E_BACKEND = 'server'
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:8791' },
  webServer: {
    command: 'npm run build:server && node dist-server/index.mjs',
    url: 'http://127.0.0.1:8791/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { HOST: '127.0.0.1', PORT: '8791', ACCESS_TOKEN: 'dev-token', SNOTES_DATA_DIR: resolve('tmp/e2e-server-state') },
  },
})
