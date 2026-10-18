import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

const headers = { Authorization: 'Bearer dev-token' }

async function openSidebar(page: Page) {
  if (page.viewportSize()!.width <= 1020) await page.getByRole('button', { name: '打开侧栏', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  resetServer()
  await page.addInitScript(() => localStorage.setItem('snotes_token', 'dev-token'))
})

for (const width of [1440, 390]) {
  test(`刷新保留视图、当前笔记与设置分页，前进后退仍恢复位置 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const ids = [crypto.randomUUID(), crypto.randomUUID()]
    for (const [index, id] of ids.entries()) {
      expect((await page.request.post('/api/notes', { headers, data: {
        id, title: `路由笔记 ${index}`, summary: '', content: `# 路由笔记 ${index}`, create_time: Date.now(), star: 1,
      } })).ok()).toBe(true)
    }
    await page.goto('/')
    await expect(page.locator('.note-item')).toHaveCount(2)
    await openSidebar(page)
    await page.getByRole('button', { name: '星标笔记', exact: true }).click()
    await page.locator('.note-select').filter({ hasText: '路由笔记 0' }).click()
    await expect(page).toHaveURL(new RegExp(`/star\\?note=${ids[0]}$`))
    await page.reload()
    await expect(page.locator('.layout')).toHaveAttribute('data-view', 'star')
    await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('路由笔记 0')
    if (width <= 720) await expect(page.locator('.layout')).toHaveAttribute('data-mobile-pane', 'editor')

    await page.keyboard.press('Control+,')
    const settings = page.getByRole('region', { name: '设置', exact: true })
    await settings.getByRole('tab', { name: 'Agent 接入', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/agents$/)
    await page.reload()
    await expect(settings.getByRole('tab', { name: 'Agent 接入', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.goBack()
    await expect(settings).toHaveCount(0)
    await expect(page.locator('.layout')).toHaveAttribute('data-view', 'star')
    await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('路由笔记 0')
    await page.goForward()
    await expect(settings.getByRole('tab', { name: 'Agent 接入', exact: true })).toHaveAttribute('aria-selected', 'true')
    await settings.getByRole('button', { name: '返回工作区', exact: true }).click()
    await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('路由笔记 0')
  })
}

test('空缓存直接打开笔记本地址、刷新和旧分享链接均定位到目标笔记', async ({ page }) => {
  const bookId = crypto.randomUUID()
  const noteId = crypto.randomUUID()
  expect((await page.request.post('/api/notes', { headers, data: { id: noteId, title: '地址直达', summary: '', content: '# 地址直达', create_time: Date.now() } })).ok()).toBe(true)
  expect((await page.request.post('/api/knowledge-bases', { headers, data: { id: bookId, operation_id: crypto.randomUUID(), name: '路由手册', description: '', icon: '', ord: 0, invalid: 0 } })).ok()).toBe(true)
  expect((await page.request.put(`/api/knowledge-bases/${bookId}/toc`, { headers, data: {
    nodes: [{ id: 'note-ref', kind: 'note', parent_id: null, ord: 0, title: null, note_id: noteId }],
    base_toc_version: 0, operation_id: crypto.randomUUID(),
  } })).ok()).toBe(true)
  const path = `/notebooks/${bookId}?note=${noteId}&node=note-ref`
  await page.goto(path)
  await expect(page.locator('.kb-header h2')).toHaveText('路由手册')
  await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('地址直达')
  await expect(page).toHaveURL(new RegExp(`/notebooks/${bookId}\\?note=${noteId}&node=note-ref$`))
  await page.reload()
  await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('地址直达')
  await page.goto(`/?notebook=${bookId}&note=${noteId}`)
  await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toHaveText('地址直达')
  await expect(page).toHaveURL(new RegExp(`/notebooks/${bookId}\\?note=${noteId}&node=note-ref$`))
})

test('直接打开设置可返回工作区，新建快捷入口只消费一次', async ({ page }) => {
  await page.goto('/settings/about')
  await expect(page.getByRole('tab', { name: '关于', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '返回工作区', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/?new')
  await expect(page.locator('.note-item')).toHaveCount(1)
  await expect(page).toHaveURL(/\/\?note=/)
  await page.reload()
  await expect(page.locator('.note-item')).toHaveCount(1)
})
