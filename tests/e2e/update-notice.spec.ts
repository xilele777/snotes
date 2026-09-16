import { expect, test } from '@playwright/test'
import { resetServer } from './reset-server'

for (const width of [1440, 390, 320]) {
  test(`${width}px 更新提醒、缓存、键盘导航和统计色阶`, async ({ page }) => {
    resetServer()
    await page.setViewportSize({ width, height: 900 })
    let checks = 0
    await page.route('https://api.github.com/repos/xilele777/snotes/releases/latest', async (route) => {
      checks += 1
      await route.fulfill({ json: { tag_name: 'v9.9.9', html_url: 'https://github.com/xilele777/snotes/releases/tag/v9.9.9' } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('snotes_token', 'dev-token')
      document.cookie = 'snotes_token=dev-token; Path=/api/images/; SameSite=Strict'
    })
    await page.goto('/')
    await expect(page.locator('.version-button')).toHaveClass(/has-update/)
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.locator('.version-button').click()
    const dialog = page.getByRole('dialog', { name: '版本信息', exact: true })
    await expect(dialog).toContainText('v9.9.9')
    await expect(dialog).toContainText('git pull --ff-only')
    if (process.env.E2E_BACKEND === 'server') {
      await expect(dialog).toContainText('docker compose up -d --build')
      await expect(dialog).not.toContainText('wrangler')
    }
    const close = dialog.getByRole('button', { name: '关闭' })
    const release = dialog.getByRole('link', { name: '查看发布说明' })
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(release).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(release).toBeFocused()
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `tmp/update-review/version-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.version-button')).toBeFocused()

    // 只填充本测试浏览器的 IndexedDB，构造四档更新量，不修改服务端笔记。
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('snotes')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('notes', 'readwrite')
          for (let week = 0; week < 52; week++) {
            for (let i = 0; i < (week % 4) + 1; i++) {
              const date = new Date()
              date.setDate(date.getDate() - week * 7)
              const time = date.getTime()
              tx.objectStore('notes').put({
                id: `heat-${week}-${i}`, group_id: null, title: '热力图验收', summary: '',
                thumbnail: null, version: 1, prop_version: 1, body_version: 1, star: 0, top: 0,
                skin_color: null, invalid: 0, dirty: 'none', create_time: time, update_time: time, body: '',
              })
            }
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally { db.close() }
    })
    await page.reload()
    await expect(page.locator('.version-button')).toHaveClass(/has-update/)
    expect(checks).toBe(1)
    if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.getByRole('button', { name: '记录统计', exact: true }).click()
    const stats = page.getByRole('dialog', { name: '记录统计', exact: true })
    await expect(stats.locator('.heatmap-grid .heatmap-cell')).toHaveCount(371)
    const colors: string[] = []
    for (let level = 0; level <= 4; level++) {
      const cell = stats.locator(`.heatmap-grid [data-level="${level}"]`).first()
      await expect(cell).toBeVisible()
      colors.push(await cell.evaluate((el) => getComputedStyle(el).backgroundColor))
    }
    expect(new Set(colors).size).toBe(5)
    expect(await stats.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: `tmp/update-review/heatmap-${width}.png` })
  })
}
