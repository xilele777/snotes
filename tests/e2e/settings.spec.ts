import { expect, test } from '@playwright/test'
import { resetServer } from './reset-server'

for (const width of [1440, 320]) {
  test(`${width}px 设置：深色主题即时生效、刷新首帧不闪白、字号与宽度落到 <html>`, async ({ page }) => {
    resetServer()
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => {
      localStorage.setItem('snotes_token', 'dev-token')
      document.cookie = 'snotes_token=dev-token; Path=/api/images/; SameSite=Strict'
    })
    await page.request.post('/api/notes', { headers: { Authorization: 'Bearer dev-token' }, data: { id: crypto.randomUUID(), title: '阅读偏好验收', summary: '这是一段笔记摘要', content: '# 阅读偏好验收\n\n调整行距后的正文。', create_time: Date.now() } })
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'light')
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    // 入口在图标栏底部，抽屉里带文字标签
    const entry = page.locator('.sidebar-footer').getByRole('button', { name: '设置', exact: true })
    await entry.click()
    const dialog = page.getByRole('region', { name: '设置', exact: true })
    await expect(dialog.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('radio', { name: '深色', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#27282f')

    await dialog.getByRole('radio', { name: '大', exact: true }).click()
    await dialog.getByRole('radio', { name: '宽', exact: true }).click()
    await dialog.locator('[data-setting="noteDensity"] [data-value="compact"]').click()
    await dialog.getByRole('switch', { name: '显示笔记摘要' }).click()
    await dialog.locator('[data-setting="lineSpacing"] [data-value="relaxed"]').click()
    await expect(html).toHaveAttribute('data-note-density', 'compact')
    await expect(html).toHaveAttribute('data-note-preview', 'hidden')
    await expect(html).toHaveAttribute('data-line-spacing', 'relaxed')
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `tmp/update-review/settings-dark-${width}.png` })

    // 「数据」页：导出全部得到 zip 下载
    await dialog.getByRole('tab', { name: '数据' }).click()
    const download = page.waitForEvent('download')
    await dialog.locator('[data-action="export"]').click()
    expect((await download).suggestedFilename()).toMatch(/^snotes-backup-\d{8}\.zip$/)
    await expect(dialog.locator('.backup-progress')).toContainText('已导出')
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.getByRole('button', { name: '返回工作区' }).click()
    await expect(dialog).toHaveCount(0)
    // 打开设置页面时抽屉已收起：窄屏焦点回到可见的抽屉按钮，桌面回到图标栏入口
    if (width < 1020) await expect(page.getByRole('button', { name: '打开侧栏' })).toBeFocused()
    else await expect(entry).toBeFocused()

    await expect(page.locator('.note-item')).toHaveCount(1)
    expect((await page.locator('.note-item').boundingBox())!.height).toBe(84)
    await expect(page.locator('.note-summary')).toBeHidden()
    // 刷新后由 index.html 的首帧脚本直接落主题，不等应用脚本加载
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-note-density', 'compact')
    await expect(html).toHaveAttribute('data-note-preview', 'hidden')
    await expect(html).toHaveAttribute('data-line-spacing', 'relaxed')
    expect(await page.evaluate(() => document.documentElement.dataset.fontSize)).toBe('large')
    expect(await page.evaluate(() => document.documentElement.dataset.editorWidth)).toBe('wide')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)

    await page.locator('.note-select').click()
    await expect(page.locator('.snotes-vditor [role="textbox"]:visible')).toBeVisible()
    const bodyStyle = await page.locator('.snotes-vditor [role="textbox"]:visible').evaluate(el => {
      const style = getComputedStyle(el)
      return { lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) }
    })
    expect(bodyStyle.lineHeight / bodyStyle.fontSize).toBeCloseTo(2.15, 2)
    if (width <= 720) await page.getByRole('button', { name: '返回列表', exact: true }).click()

    // 深色下热力图 5 级色阶仍然两两不同
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.getByRole('button', { name: '统计', exact: true }).click()
    const stats = page.getByRole('region', { name: '统计', exact: true })
    const legend = stats.locator('.heatmap-legend .heatmap-cell')
    await expect(legend).toHaveCount(5)
    const colors = await legend.evaluateAll((cells) => cells.map((el) => getComputedStyle(el).backgroundColor))
    expect(new Set(colors).size).toBe(5)
    await page.getByRole('button', { name: '返回工作区' }).click()
    await expect(stats).toHaveCount(0)

    // 切回「跟随系统」后按系统偏好走，系统切换时实时跟随
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await entry.click()
    await page.getByRole('region', { name: '设置', exact: true }).getByRole('radio', { name: '跟随系统', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })
}
