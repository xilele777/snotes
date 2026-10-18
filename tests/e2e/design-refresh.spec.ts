import { expect, test } from '@playwright/test'
import { resetServer } from './reset-server'

test.beforeEach(() => resetServer())
const headers = { Authorization: 'Bearer dev-token' }

test('卡片与列表切换记忆偏好，并保留选择、搜索和排序', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const title of ['Alpha idea', 'Beta idea']) {
    await page.request.post('/api/notes', { headers, data: { id: crypto.randomUUID(), title, content: `# ${title}\n\nA short description.`, summary: 'A short description.', create_time: Date.now() } })
  }
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  await expect(page.locator('.note-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '卡片视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '打开笔记：Alpha idea', exact: true }).click()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.locator('.note-list')).not.toHaveClass(/is-cards/)
  await expect(page.locator('.note-select[aria-current="true"]')).toHaveAttribute('aria-label', '打开笔记：Alpha idea')
  await page.reload()
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('searchbox', { name: '搜索笔记', exact: true }).fill('Beta')
  await expect(page.locator('.note-item')).toHaveCount(1)
  await page.getByRole('button', { name: '卡片视图', exact: true }).click()
  await expect(page.locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('searchbox', { name: '搜索笔记', exact: true })).toHaveValue('Beta')
})
