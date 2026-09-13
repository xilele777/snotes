import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8790',
    trace: 'on-first-retry',
  },
  // E2E 打的是 wrangler dev 起的完整 Worker（静态资源 + API 同源），而不是 vite dev server——
  // 这样测的才是生产形态。
  webServer: {
    // Keep test resets separate from the developer's local notes and credentials.
    command: 'npm run build && npx wrangler d1 migrations apply snotes-e2e --local --config tests/e2e/wrangler.jsonc --persist-to tmp/e2e-state && npx wrangler dev --local --config tests/e2e/wrangler.jsonc --persist-to tmp/e2e-state --port 8790 --inspector-port 0',
    url: 'http://localhost:8790/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
