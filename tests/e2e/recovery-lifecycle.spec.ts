import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function bodies(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('snotes')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = db.transaction('notes').objectStore('notes').getAll()
        request.onsuccess = () => resolve(request.result.map(n => n.body).join('\n'))
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

test('two offline tabs hand off their final Chinese text before update and background reload', async ({ page, context }) => {
  resetServer()
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  await page.locator('.header-create').click()
  const editor = (target: Page) => target.locator('.snotes-vditor [role="textbox"]:visible')
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('第一标签页正文')
  await expect.poll(() => bodies(page)).toContain('第一标签页正文')
  const second = await context.newPage()
  await second.goto('/')
  await second.locator('.header-create').click()
  await expect(editor(second)).toBeFocused()
  await context.setOffline(true)
  await second.keyboard.insertText('第二标签页更新前最后中文')
  await second.evaluate(() => window.dispatchEvent(new Event('snotes-before-update')))
  await page.bringToFront()
  await editor(page).click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('第一标签页后台前最后中文')
  await page.evaluate(() => {
    window.dispatchEvent(new Event('snotes-before-update'))
  })
  await expect.poll(() => bodies(page)).toContain('第二标签页更新前最后中文')
  await expect.poll(() => bodies(page)).toContain('第一标签页后台前最后中文')
  await context.setOffline(false)
  await page.reload()
  await second.reload()
  await expect.poll(() => bodies(page)).toContain('第一标签页后台前最后中文')
  await expect.poll(() => bodies(second)).toContain('第二标签页更新前最后中文')
})

test('a waiting Service Worker claims both tabs only after each page saves its last input', async ({ page, context }) => {
  test.skip(process.env.E2E_BACKEND !== 'server', 'Replaces a local static worker file; remote asset manifests require a separate deployment')
  resetServer()
  const workerPath = resolve('dist/sw.js')
  const original = readFileSync(workerPath)
  try {
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
    await page.reload()
    await page.locator('.header-create').click()
    const editor = (target: Page) => target.locator('.snotes-vditor [role="textbox"]:visible')
    await expect(editor(page)).toBeFocused()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    const second = await context.newPage()
    await second.goto('/')
    await second.locator('.header-create').click()
    await expect(editor(second)).toBeFocused()
    writeFileSync(workerPath, `// acceptance worker ${Date.now()}\nself.addEventListener('message', e => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting() });\nself.addEventListener('activate', e => e.waitUntil(self.clients.claim()));\n`)
    await second.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration!.update() })
    await expect.poll(() => second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
    await page.bringToFront()
    await editor(page).click()
    await page.keyboard.insertText('控制器切换时第一页最后中文')
    await second.bringToFront()
    await editor(second).click()
    await second.keyboard.insertText('控制器切换时第二页最后中文')
    const navigations = Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), second.waitForEvent('framenavigated', frame => frame === second.mainFrame())])
    await second.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({ type: 'SKIP_WAITING' }))
    await navigations
    await expect.poll(() => bodies(page)).toContain('控制器切换时第一页最后中文')
    await expect.poll(() => bodies(second)).toContain('控制器切换时第二页最后中文')
  } finally { writeFileSync(workerPath, original) }
})
