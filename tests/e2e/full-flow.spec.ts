import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

const TOKEN = 'dev-token'

/** 与 src/api/token.ts 的 setToken 保持一致：令牌同时写 localStorage 与限定作用域的 Cookie */
async function signIn(page: Page) {
  await page.goto('/')
  await page.evaluate((t) => {
    localStorage.setItem('snotes_token', t)
    document.cookie = `snotes_token=${t}; Path=/api/images/; SameSite=Strict`
  }, TOKEN)
  await page.reload()
}

test.beforeEach(async ({ page }) => {
  resetServer()
  await signIn(page)
})

test('新建笔记后标题出现在列表中', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).click()

  await page.locator('.milkdown').click()
  await page.keyboard.type('# 我的第一条笔记')

  await expect(page.locator('.note-item').first()).toContainText('我的第一条笔记', {
    timeout: 5_000,
  })
})

test('编辑内容后刷新仍在——数据落在本地', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 持久化测试')

  await expect(page.locator('.note-item').first()).toContainText('持久化测试')

  await page.reload()

  await expect(page.locator('.note-item').first()).toContainText('持久化测试')
})

test('创建分组并按分组筛选', async ({ page }) => {
  await page.getByPlaceholder('新建分组').fill('工作')
  await page.getByPlaceholder('新建分组').press('Enter')

  await expect(page.locator('.groups')).toContainText('工作')

  await page.locator('.groups li').first().click()

  await expect(page.locator('.note-list')).toContainText('还没有笔记')
})

test('搜索按标题过滤', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 苹果')

  await expect(page.locator('.note-item').first()).toContainText('苹果')

  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 香蕉')

  await expect(page.locator('.note-item')).toHaveCount(2)

  await page.getByPlaceholder('搜索笔记').fill('苹果')

  await expect(page.locator('.note-item')).toHaveCount(1)
  await expect(page.locator('.note-item').first()).toContainText('苹果')
})

test('删除后进回收站，可恢复', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 待删除')

  await expect(page.locator('.note-item').first()).toContainText('待删除')

  // 删除按钮在桌面端默认是滑出视口的；hover 笔记条目后露出，再点。
  await page.locator('.note-item').first().hover()
  await page.locator('.note-item').first().getByRole('button', { name: '删除' }).click()

  await expect(page.locator('.note-list')).not.toContainText('待删除')

  await page.locator('[data-view="trash"]').click()
  await expect(page.locator('.note-item').first()).toContainText('待删除')

  await page.locator('.recover').first().click()
  await page.locator('[data-view="all"]').click()

  await expect(page.locator('.note-item').first()).toContainText('待删除')
})

test('粘贴图片后能正常显示——覆盖同源 Cookie 鉴权那条路径', async ({ page }) => {
  await page.getByRole('button', { name: '新建笔记' }).click()
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 带图的笔记')

  // 1×1 的 PNG，够小到可以直接内联
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  // 必须把 paste 派发到 ProseMirror 的 contenteditable（.milkdown 下的 .ProseMirror）。
  // 派发到 .milkdown 外壳没用：ProseMirror 的 paste 监听挂在可编辑元素上，
  // .milkdown 是它的父级，事件不会向下冒泡到子元素的处理函数。
  await page
    .locator('.milkdown .ProseMirror')
    .evaluate((el, base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'a.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    }, PNG_BASE64)

  // ProseMirror 还会插入一个无 src 的 .ProseMirror-separator <img>，按 [src] 过滤掉它。
  const img = page.locator('.milkdown img[src]')
  await expect(img).toHaveAttribute('src', /^\/api\/images\//, { timeout: 15_000 })

  // 这条断言才是重点：src 对不代表图能加载出来。
  // <img> 带不了 Authorization 头，全靠 setToken 写的那份 Cookie 通过鉴权；
  // Cookie 的 Path 写错或没写，这里就会是 0。
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)
})

test('同步：两个上下文之间数据可互通', async ({ browser }) => {
  const a = await browser.newContext()
  const pageA = await a.newPage()
  await signIn(pageA)

  await pageA.getByRole('button', { name: '新建笔记' }).click()
  await pageA.locator('.milkdown').click()
  await pageA.keyboard.type('# 跨端同步验证')
  await expect(pageA.locator('.note-item').first()).toContainText('跨端同步验证')

  // 等待推送完成
  await pageA.waitForTimeout(3_000)

  const b = await browser.newContext()
  const pageB = await b.newPage()
  await signIn(pageB)

  await expect(pageB.locator('.note-item').first()).toContainText('跨端同步验证', {
    timeout: 35_000,
  })

  await a.close()
  await b.close()
})
