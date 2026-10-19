import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

async function fixture(page: Page, count: number, waitForBodies?: Promise<void>) {
  const notes = Array.from({ length: count }, (_, index) => ({
    id: `startup-${index}`, group_id: null, title: `性能笔记 ${index}`, summary: '', thumbnail: null,
    version: 1, prop_version: 1, star: 0, top: 0, skin_color: null, home_hidden: null,
    invalid: 0, create_time: index + 1, update_time: index + 1,
  }))
  await page.addInitScript(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.route('**/api/sync/pull', route => route.fulfill({ json: {
    notes: route.request().postDataJSON().since ? [] : notes, groups: [], server_time: 1000, next_cursor: null,
  } }))
  await page.route('**/api/sync/bodies', async route => {
    await waitForBodies
    const { ids } = route.request().postDataJSON() as { ids: string[] }
    await route.fulfill({ json: { bodies: ids.map(id => ({
      note_id: id, content: `# ${notes.find(note => note.id === id)!.title}\n\n正文已下载`, version: 1,
    })) } })
  })
}

test.beforeEach(() => resetServer())

for (const width of [1440, 390]) {
 for (const density of ['comfortable', 'compact']) {
  test(`500 条笔记只渲染可视行，末尾可达、搜索和返回恢复正常 ${width}px ${density}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(density => localStorage.setItem('snotes_settings', JSON.stringify({ noteDensity: density })), density)
    await fixture(page, 500)
    await page.goto('/')
    await expect(page.locator('.header-count')).toHaveText('500')
    await expect(page.locator('.header-refresh')).toBeEnabled()
    expect(await page.locator('.note-item').count()).toBeLessThan(40)
    const list = page.locator('.note-list')
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    const last = page.locator('[data-note-id="startup-0"] .note-select')
    await expect(last).toBeInViewport()
    const scrollTop = await list.evaluate(element => element.scrollTop)
    await last.click()
    await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toContainText('性能笔记 0')
    if (width <= 720) await page.goBack()
    else {
      await page.keyboard.press('Control+,')
      await page.getByRole('button', { name: '返回工作区', exact: true }).click()
    }
    await expect(last).toBeInViewport()
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(scrollTop, -1)
    await page.getByRole('searchbox', { name: '搜索笔记' }).fill('性能笔记 321')
    await expect(page.locator('.header-count')).toHaveText('1')
    await expect(page.locator('.note-select')).toContainText('性能笔记 321')
    await page.getByRole('searchbox', { name: '搜索笔记' }).fill('')
    await expect(page.locator('.header-count')).toHaveText('500')
    await expect(page.locator('.note-select').first()).toBeInViewport()
    if (width > 720) {
      await page.locator('.note-select').first().focus()
      for (let index = 0; index < 30; index++) await page.keyboard.press('ArrowDown')
      await expect(page.locator('[data-note-id="startup-469"] .note-select')).toBeFocused()
      await expect(page.locator('[data-note-id="startup-469"] .note-select')).toBeInViewport()
    }
  })
 }
}

test('元数据先可见，正文在途时不出现可编辑空白，下载后显示原文', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await fixture(page, 2, pending)
  try {
    await page.goto('/')
    await expect(page.locator('.header-count')).toHaveText('2')
    await page.locator('.note-select').first().click()
    await expect(page.locator('.editor-loading')).toBeVisible()
    await expect(page.locator('.snotes-vditor [contenteditable="true"]')).toHaveCount(0)
  } finally { release() }
  await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toContainText('正文已下载')
})
