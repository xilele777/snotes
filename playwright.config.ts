import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },
  // E2E 打的是 wrangler dev 起的完整 Worker（静态资源 + API 同源），而不是 vite dev server——
  // 这样测的才是生产形态。
  webServer: {
    command: 'npm run build && npx wrangler dev --port 8787',
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
