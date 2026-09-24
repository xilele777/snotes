import { expect, test } from '@playwright/test'
import { resetServer } from './reset-server'

test.beforeEach(async ({ page }) => {
  resetServer()
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  await expect(page.getByRole('button', { name: '刷新笔记' })).toBeEnabled()
})

for (const width of [320, 390]) {
  test.describe(`${width}px 手机列表`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })

    test('不打开侧栏即可刷新远端笔记，离线时显示提示', async ({ page, request, context }) => {
      const refresh = page.getByRole('button', { name: '刷新笔记' })
      await expect(refresh).toBeInViewport()
      await expect(page.locator('.header-create')).toBeInViewport()
      const response = await request.post('/api/notes', {
        headers: { Authorization: 'Bearer dev-token' },
        data: {
          id: crypto.randomUUID(), title: '手机手动刷新', summary: '另一台设备的内容',
          content: '# 手机手动刷新\n\n另一台设备的内容', create_time: Date.now(),
        },
      })
      expect(response.ok()).toBe(true)

      const pulled = page.waitForResponse(res => res.url().endsWith('/api/sync/pull') && res.ok())
      await refresh.tap()
      await pulled
      await expect(page.locator('.note-item')).toContainText('手机手动刷新')
      await expect(page.locator('.toast')).toHaveText('笔记已刷新')
      await expect(refresh).toBeEnabled()
      await expect(page.locator('.layout')).toHaveAttribute('data-mobile-pane', 'list')

      await context.setOffline(true)
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await refresh.tap()
      await expect(page.locator('.toast')).toHaveText('当前离线，联网后可刷新笔记')
      await expect(page.locator('.note-item')).toContainText('手机手动刷新')
    })
  })
}

test('输入网址并保存后，重开与刷新页面都不向链接添加 >', async ({ page }) => {
  await page.locator('.header-create').click()
  const editor = page.locator('.milkdown .ProseMirror')
  await editor.click()
  await page.locator('.format-bar [data-format="link"]').click()
  const dialog = page.locator('.link-dialog')
  await dialog.getByLabel('链接地址').fill('https://anyrouter.top\u00a0')
  await dialog.getByRole('button', { name: '确定' }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://anyrouter.top')

  // 等待 debounce 确实落库，之后验证序列化产生的自动链接能正常加载。
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('snotes')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise<string>((resolve, reject) => {
        const req = db.transaction('notes').objectStore('notes').getAll()
        req.onsuccess = () => resolve(req.result.map(note => note.body).join('\n'))
        req.onerror = () => reject(req.error)
      })
    } finally { db.close() }
  })).toContain('<https://anyrouter.top>')

  await page.locator('.header-create').click()
  await expect(editor.locator('a')).toHaveCount(0)
  await page.locator('.note-select').filter({ hasText: 'anyrouter.top' }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://anyrouter.top')
  await expect(editor).not.toContainText('>')
  await page.reload()
  await page.locator('.note-select').filter({ hasText: 'anyrouter.top' }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://anyrouter.top')
})
