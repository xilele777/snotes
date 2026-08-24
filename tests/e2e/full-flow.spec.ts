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

/**
 * 新建笔记。不能用 getByRole('button', { name: '新建笔记' })：
 * 列表空态里那颗引导按钮文案也是「新建笔记」，两个都匹配会触发 strict mode 违例。
 */
const createNote = (page: Page) => page.locator('.header-create').click()

/** 新建分组走弹窗：分组标题行的 + → 填名字 → 确定 */
async function createGroup(page: Page, name: string) {
  await page.locator('.group-add').click()
  await expect(page.locator('.dialog')).toBeVisible()
  await page.locator('.dialog-input').fill(name)
  await page.locator('.dialog-btn.ok').click()
  await expect(page.locator('.dialog')).toHaveCount(0)
}

/** 1×1 的 PNG，够小到可以直接内联 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * 往编辑器里粘一张图。
 * 必须把 paste 派发到 ProseMirror 的 contenteditable（.milkdown 下的 .ProseMirror）。
 * 派发到 .milkdown 外壳没用：ProseMirror 的 paste 监听挂在可编辑元素上，
 * .milkdown 是它的父级，事件不会向下冒泡到子元素的处理函数。
 */
async function pasteImage(page: Page) {
  await page.locator('.milkdown .ProseMirror').evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'a.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, PNG_BASE64)
}

test.beforeEach(async ({ page }) => {
  resetServer()
  await signIn(page)
})

test('新建笔记后标题出现在列表中', async ({ page }) => {
  await createNote(page)

  await page.locator('.milkdown').click()
  await page.keyboard.type('# 我的第一条笔记')

  await expect(page.locator('.note-item').first()).toContainText('我的第一条笔记', {
    timeout: 5_000,
  })
})

test('编辑内容后刷新仍在——数据落在本地', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 持久化测试')

  await expect(page.locator('.note-item').first()).toContainText('持久化测试')

  await page.reload()

  await expect(page.locator('.note-item').first()).toContainText('持久化测试')
})

test('创建分组并按分组筛选', async ({ page }) => {
  await createGroup(page, '工作')

  await expect(page.locator('.groups')).toContainText('工作')

  await page.locator('.groups li').first().click()

  await expect(page.locator('.empty-state')).toContainText('「工作」里还没有笔记')
})

test('分组弹窗可取消，取消后不建分组', async ({ page }) => {
  await page.locator('.group-add').click()
  await page.locator('.dialog-input').fill('不要建')
  await page.locator('.dialog-btn.cancel').click()

  await expect(page.locator('.dialog')).toHaveCount(0)
  await expect(page.locator('.groups li')).toHaveCount(0)
})

test('搜索按标题过滤', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 苹果')

  await expect(page.locator('.note-item').first()).toContainText('苹果')

  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 香蕉')

  await expect(page.locator('.note-item')).toHaveCount(2)

  await page.getByPlaceholder('搜索笔记').fill('苹果')

  await expect(page.locator('.note-item')).toHaveCount(1)
  await expect(page.locator('.note-item').first()).toContainText('苹果')
})

test('删除后进回收站，能看详情，可恢复', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 待删除')

  await expect(page.locator('.note-item').first()).toContainText('待删除')

  // 删除按钮在桌面端默认是滑出视口的；hover 笔记条目后露出，再点。
  await page.locator('.note-item').first().hover()
  await page.locator('.note-item').first().getByRole('button', { name: '删除' }).click()

  // 删掉唯一一条笔记后列表换成空态，<ul class="note-list"> 整个不渲染了，
  // 所以这里断言空态而不是「note-list 里没有它」——后者会因元素不存在而报错。
  await expect(page.locator('.empty-state')).toContainText('还没有笔记')

  await page.locator('[data-view="trash"]').click()
  await expect(page.locator('.note-item').first()).toContainText('待删除')

  // 回收站里点条目也能看详情，且是只读的
  await page.locator('.note-item').first().click()
  await expect(page.locator('.editor-top-bar')).toContainText('此笔记在回收站中')
  await expect(page.locator('.milkdown .ProseMirror')).toContainText('待删除')
  await expect(page.locator('.milkdown .ProseMirror')).toHaveAttribute('contenteditable', 'false')

  await page.locator('[data-op="recover"]').click()
  await page.locator('[data-view="all"]').click()

  await expect(page.locator('.note-item').first()).toContainText('待删除')
})

test('以图片开头的笔记，列表标题不是一串 base64', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()

  // 走真实粘贴路径：先插 blob 占位、上传完再换成 /api/images/。
  // 这两个阶段的正文首行都是图片语法，标题都不该把它当文字用。
  await pasteImage(page)

  const title = page.locator('.note-item').first().locator('.note-title')
  await expect(title).toHaveText('无标题')
  await expect(title).not.toContainText('base64')
  await expect(title).not.toContainText('blob:')

  // 上传落地后仍然不该冒出 base64 / 路径当标题
  await expect(page.locator('.milkdown img[src^="/api/images/"]')).toHaveCount(1, {
    timeout: 15_000,
  })
  await expect(title).toHaveText('无标题')

  // 图后面补一行文字，标题应该取这行文字
  await page.locator('.milkdown .ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('白板照片')

  await expect(title).toHaveText('白板照片', { timeout: 5_000 })
})

test('窄屏下侧栏收进抽屉，点 ☰ 能拿回全部入口', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })

  await expect(page.locator('.sidebar-pane')).not.toHaveClass(/is-open/)
  await expect(page.locator('.drawer-mask')).toHaveCount(0)

  await page.locator('.drawer-btn').click()

  await expect(page.locator('.sidebar-pane')).toHaveClass(/is-open/)
  // 抽屉里该有的入口一个都不能少
  await expect(page.locator('.sidebar-pane')).toContainText('全部笔记')
  await expect(page.locator('.sidebar-pane')).toContainText('星标')
  await expect(page.locator('.sidebar-pane')).toContainText('回收站')
  await expect(page.locator('.sidebar-search input')).toBeVisible()

  // 选完视图自动收起
  await page.locator('[data-view="star"]').click()
  await expect(page.locator('.sidebar-pane')).not.toHaveClass(/is-open/)
})

test('粘贴图片后能正常显示——覆盖同源 Cookie 鉴权那条路径', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 带图的笔记')

  await pasteImage(page)

  // 一次粘贴只能落一张图。DataTransfer 的 items 与 files 是同一批文件的两个视图，
  // 早先把两边拼起来会上传两遍，并在正文里留下一个替换不掉的 blob 死链。
  const img = page.locator('.milkdown img[src^="/api/images/"]')
  await expect(img).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('.milkdown img[src^="blob:"]')).toHaveCount(0)

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

  await pageA.locator('.header-create').click()
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
