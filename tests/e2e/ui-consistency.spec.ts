import { expect, test, type Locator, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

const headers = { Authorization: 'Bearer dev-token' }
test.beforeEach(() => resetServer())

async function signIn(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
}

async function withinViewport(panel: Locator) {
  await expect(panel).toBeVisible()
  await expect(panel).toHaveCSS('opacity', '1')
  await expect.poll(() => panel.evaluate(el => {
    const r = el.getBoundingClientRect()
    return r.left >= 7 && r.top >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7
  })).toBe(true)
}

test('顶部中心线一致，手机控件保留点击区域，选择浮层在短窗口内可用', async ({ page }, testInfo) => {
  for (let i = 0; i < 18; i++) {
    await page.request.post('/api/groups', { headers, data: { group_id: crypto.randomUUID(), name: `审阅分组 ${i}`, ord: i } })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await expect(page.locator('.snotes-vditor [role=textbox]:visible')).toBeVisible()
  const geometry = await page.locator('.sidebar-brand, .list-header, .editor-top-bar').evaluateAll(es => es.map(el => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top, height: rect.height }
  }))
  expect(geometry).toEqual(Array(3).fill({ top: 0, height: 64 }))
  const centers = await page.locator('.brand-home, .header-create, .editor-location').evaluateAll(es => es.map(el => {
    const rect = el.getBoundingClientRect()
    return rect.top + rect.height / 2
  }))
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1)
  await page.screenshot({ path: testInfo.outputPath('headers-desktop.png') })
  const notebookTrigger = page.locator('[data-op=notebooks]')
  await notebookTrigger.click()
  await withinViewport(page.locator('.notebook-pop'))
  await expect(page.locator('.notebook-pop button').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(notebookTrigger).toBeFocused()

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.editor-top-bar')).toHaveCSS('min-height', '60px')
    const targets = await page.locator('.editor-top-bar button:visible').evaluateAll(es => es.map(el => {
      const rect = el.getBoundingClientRect()
      return { name: el.getAttribute('aria-label'), width: rect.width, height: rect.height }
    }))
    for (const target of targets) {
      expect(target.width, target.name ?? '').toBeGreaterThanOrEqual(44)
      expect(target.height, target.name ?? '').toBeGreaterThanOrEqual(44)
    }
    expect(await page.locator('.editor-top-bar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`headers-${width}.png`) })
  }

  await page.setViewportSize({ width: 320, height: 240 })
  const groupTrigger = page.getByRole('button', { name: '移至分组', exact: true })
  await groupTrigger.click()
  const groups = page.getByRole('group', { name: '选择分组', exact: true })
  await withinViewport(groups)
  expect(await groups.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press('End')
  await expect(groups.getByRole('button').last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(groups).toBeHidden()
  await expect(groupTrigger).toBeFocused()

  const more = page.getByRole('button', { name: '更多操作', exact: true })
  for (const [action, panel] of [['color', '.op-popover.colors'], ['notebooks', '.notebook-pop']]) {
    await more.click()
    await page.locator(`[data-action=${action}]`).click()
    await withinViewport(page.locator(panel))
    expect(await page.locator(panel).evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`short-viewport-${action}.png`) })
    await page.keyboard.press('Escape')
    await expect(more).toBeFocused()
  }
})

test('设置单选组键盘操作、持久化与手机开关点击区域', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const theme = page.locator('[data-setting=theme]')
  await theme.getByRole('radio', { name: '浅色', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await expect(theme.getByRole('radio', { name: '深色', exact: true })).toBeFocused()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  for (const group of await page.getByRole('radiogroup').all()) {
    await expect(group.locator('[tabindex="0"]')).toHaveCount(1)
  }
  await page.reload()
  await expect(theme.getByRole('radio', { name: '深色', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.setViewportSize({ width: 320, height: 844 })
  const toggle = page.getByRole('switch', { name: '显示笔记摘要', exact: true })
  const box = await toggle.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('settings-mobile-dark.png') })
})
