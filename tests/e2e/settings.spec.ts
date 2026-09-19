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
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'light')
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    const entry = page.getByRole('button', { name: '设置', exact: true })
    await entry.click()
    const dialog = page.getByRole('dialog', { name: '设置', exact: true })
    await dialog.getByRole('radio', { name: '深色', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#232428')

    await dialog.getByRole('radio', { name: '大', exact: true }).click()
    await dialog.getByRole('radio', { name: '宽', exact: true }).click()
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `tmp/update-review/settings-dark-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(entry).toBeFocused()

    // 刷新后由 index.html 的首帧脚本直接落主题，不等应用脚本加载
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => document.documentElement.dataset.fontSize)).toBe('large')
    expect(await page.evaluate(() => document.documentElement.dataset.editorWidth)).toBe('wide')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)

    // 深色下热力图 5 级色阶仍然两两不同
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.getByRole('button', { name: '记录统计', exact: true }).click()
    const stats = page.getByRole('dialog', { name: '记录统计', exact: true })
    const legend = stats.locator('.heatmap-legend .heatmap-cell')
    await expect(legend).toHaveCount(5)
    const colors = await legend.evaluateAll((cells) => cells.map((el) => getComputedStyle(el).backgroundColor))
    expect(new Set(colors).size).toBe(5)
    await page.keyboard.press('Escape')
    await expect(stats).toHaveCount(0)

    // 切回「跟随系统」后按系统偏好走，系统切换时实时跟随
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await entry.click()
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('radio', { name: '跟随系统', exact: true }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })
}
