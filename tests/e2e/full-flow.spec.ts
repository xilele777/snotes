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

/** 导航验收需要可滚动的列表和长正文；仅填充当前测试上下文的本地库。 */
async function seedNavigationNotes(page: Page) {
  await createGroup(page, '项目资料')
  const groupId = (await page.locator('.groups li').first().getAttribute('data-group-id'))!
  await page.evaluate(async (groupId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('snotes')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite')
        const now = Date.now()
        for (let i = 0; i < 27; i++) {
          const title = i < 24 ? `项目记录 ${i + 1}` : `已归档 ${i - 23}`
          tx.objectStore('notes').put({
            id: `navigation-${i}`, group_id: groupId, title, summary: '导航与阅读位置验收',
            thumbnail: null, version: 1, prop_version: 1, body_version: 1, star: 0, top: 0,
            skin_color: null, invalid: i < 24 ? 0 : 1, dirty: 'none',
            create_time: now - i * 1000, update_time: now - i * 1000,
            body: `# ${title}\n\n` + Array.from({ length: 70 }, (_, n) => `第 ${n + 1} 段，记录项目的讨论和后续工作。`).join('\n\n'),
          })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally { db.close() }
  }, groupId)
  await page.reload()
  if (page.viewportSize()!.width <= 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
  await page.locator(`.groups [data-group-id="${groupId}"] .group-link`).click()
  await expect(page.locator('.note-item')).toHaveCount(24)
  await page.getByPlaceholder('搜索笔记').fill('项目')
  return groupId
}

async function openStatsDialog(page: Page) {
  if (page.viewportSize()!.width <= 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
  await page.getByRole('button', { name: '记录统计', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '记录统计' }).locator('.stats-grid')).toBeVisible()
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

/** 读当前笔记落在 IndexedDB 里的正文，用来确认 debounce 存盘已经完成 */
function savedBody(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const req = indexedDB.open('snotes')
    const rows = await new Promise<{ body?: string }[]>((resolve) => {
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('notes')) return resolve([])
        const all = db.transaction('notes').objectStore('notes').getAll()
        all.onsuccess = () => resolve(all.result)
      }
      req.onerror = () => resolve([])
    })
    return rows.map((r) => r.body ?? '').join('\n')
  })
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
  await page.locator('.note-item').first().getByRole('button', { name: '删除', exact: true }).click()
  // 删除统一定点到一个确认弹窗（Bug 4），确认后才真正删除
  await expect(page.locator('.confirm-dialog')).toBeVisible()
  await page.locator('[data-op="confirm"]').click()

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
  await page.getByRole('button', { name: '笔记', exact: true }).click()

  await expect(page.locator('.note-item').first()).toContainText('待删除')
})

test('顶栏撤销/重做按钮能撤掉又恢复输入', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('第一段')
  await page.keyboard.press('Enter')
  await page.keyboard.type('第二段')

  await expect(page.locator('.milkdown .ProseMirror')).toContainText('第二段')

  // undo 撤销最近一次输入（第二段），redo 再把它找回来
  await page.locator('[data-op="undo"]').click()
  await expect(page.locator('.milkdown .ProseMirror')).not.toContainText('第二段')

  await page.locator('[data-op="redo"]').click()
  await expect(page.locator('.milkdown .ProseMirror')).toContainText('第二段')
})

test('GFM 表格在编辑器里渲染成 table', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()

  // Milkdown 的表输入规则：`|2x2| `（尾随空格）生成 2 行 × 2 列表格
  await page.keyboard.type('|2x2| ')

  const table = page.locator('.milkdown table')
  await expect(table).toHaveCount(1, { timeout: 5_000 })
  await expect(table.locator('th')).toHaveCount(2)
  await expect(table.locator('td')).toHaveCount(2)

  // 光标落在首个表头格，直接输入标题文字
  await page.keyboard.type('名称')

  // 必须等正文真的落到 IndexedDB 再刷新：编辑器是 800ms debounce 存盘，
  // pagehide 那条兜底 flush 发的是异步 IDB 写，赶不上导航，刷新后就是一篇空笔记。
  await expect
    .poll(() => savedBody(page), { timeout: 5_000 })
    .toContain('名称')

  // 刷新后表格应从 markdown 反解析回格子（Bug 3 回归点：没有 GFM preset，这里就是纯文本管道符）
  await page.reload()
  await expect(table).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator('.milkdown table th').first()).toHaveText('名称')
})

test('刷新后默认选中列表第一条并打开详情', async ({ page }) => {
  await createNote(page)
  await page.locator('.milkdown').click()
  await page.keyboard.type('# 默认选中我')

  await expect(page.locator('.note-item').first()).toContainText('默认选中我')

  await page.reload()

  // 没显式选过任何笔记，加载时应自动选中第一条并展示详情
  await expect(page.locator('.editor-top-bar')).toBeVisible()
  await expect(page.locator('.milkdown .ProseMirror')).toContainText('默认选中我')
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
  await expect(page.locator('.list-pane .note-search input')).toBeVisible()

  await page.locator('.drawer-btn').click()

  await expect(page.locator('.sidebar-pane')).toHaveClass(/is-open/)
  // 抽屉里该有的入口一个都不能少
  await expect(page.locator('.sidebar-pane')).toContainText('全部笔记')
  await expect(page.locator('.sidebar-pane')).toContainText('星标')
  await expect(page.locator('.sidebar-pane')).toContainText('回收站')

  // 打开时立即接住键盘焦点；关闭后回到触发按钮。
  await expect(page.locator('.sidebar-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer-btn')).toBeFocused()
  await page.locator('.drawer-btn').click()
  await expect(page.locator('.sidebar-close')).toBeFocused()

  // 选完视图自动收起
  await page.locator('[data-view="star"]').click()
  await expect(page.locator('.sidebar-pane')).not.toHaveClass(/is-open/)

  // 统计覆盖在当前分组上，关闭后回到原视图和可见的抽屉入口。
  await page.locator('.drawer-btn').click()
  await page.locator('.group-sidebar [data-view="stats"]').click()
  await expect(page.getByRole('dialog', { name: '记录统计' })).toBeVisible()
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'star')
  await expect(page.locator('.drawer-mask')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '关闭统计' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '记录统计' })).toHaveCount(0)
  await expect(page.locator('.drawer-btn')).toBeFocused()

  // 回收站属于笔记导航，保留同样的侧栏和关闭抽屉的入口。
  await page.locator('.drawer-btn').click()
  await page.locator('.group-sidebar [data-view="trash"]').click()
  await expect(page.locator('.sidebar-content')).toHaveCount(1)
  await expect(page.locator('.drawer-mask')).toHaveCount(0)
  await page.locator('.drawer-btn').click()
  await expect(page.locator('.sidebar-close')).toBeFocused()
  await page.locator('.sidebar-close').click()
  await expect(page.locator('.drawer-btn')).toBeFocused()
  await page.locator('.drawer-btn').click()
  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'star')
  await page.locator('.drawer-btn').click()
  await expect(page.getByRole('button', { name: '新建分组', exact: true })).toBeVisible()
})

test('统计弹窗保留编辑器、撤销和滚动位置，支持焦点循环与关闭', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const groupId = await seedNavigationNotes(page)
  await page.locator('[data-note-id="navigation-12"] .note-select').click()
  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('统计前补充的内容')
  await expect.poll(() => savedBody(page)).toContain('统计前补充的内容')
  await editor.evaluate(el => el.setAttribute('data-preserved-editor', 'yes'))
  await page.locator('.note-list').evaluate(el => { el.scrollTop = 610 })
  await page.locator('.editor-body').evaluate(el => { el.scrollTop = 880 })
  const before = await page.locator('.editor-pane').boundingBox()

  await openStatsDialog(page)
  const dialog = page.getByRole('dialog', { name: '记录统计' })
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'group')
  await expect(page.locator('.layout')).toHaveAttribute('inert', '')
  expect(await page.locator('.editor-pane').boundingBox()).toEqual(before)
  await expect(dialog.getByRole('button', { name: '关闭统计' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('button').last()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '关闭统计' })).toBeFocused()
  await page.keyboard.press('Escape')

  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '记录统计', exact: true })).toBeFocused()
  await expect(editor).toHaveAttribute('data-preserved-editor', 'yes')
  await expect(page.locator(`.groups [data-group-id="${groupId}"]`)).toHaveClass(/active/)
  await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('项目')
  expect(await page.locator('.note-list').evaluate(el => el.scrollTop)).toBe(610)
  expect(await page.locator('.editor-body').evaluate(el => el.scrollTop)).toBe(880)
  await page.locator('[data-op="undo"]').click()
  await expect(editor).not.toContainText('统计前补充的内容')

  await openStatsDialog(page)
  await page.mouse.click(8, 8)
  await expect(dialog).toHaveCount(0)
  await openStatsDialog(page)
  await page.getByRole('button', { name: '关闭统计' }).click()
  await expect(dialog).toHaveCount(0)

  await openStatsDialog(page)
  await dialog.locator('.most-opened-title').filter({ hasText: /^项目记录 1$/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'all')
  await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('')
  await expect(page.locator('.ProseMirror h1')).toHaveText('项目记录 1')
  await page.goBack()
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'group')
  await expect(page.locator('[data-note-id="navigation-12"]')).toHaveClass(/is-active/)
  await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('项目')
})

test('回收站预览与正文对齐，返回后恢复分组、搜索和阅读位置', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const groupId = await seedNavigationNotes(page)
  await page.locator('[data-note-id="navigation-12"] .note-select').click()
  await expect(page.locator('.ProseMirror')).toContainText('项目记录 13')
  await page.locator('.note-list').evaluate(el => { el.scrollTop = 610 })
  await page.locator('.editor-body').evaluate(el => { el.scrollTop = 880 })
  const before = await page.locator('.editor-pane').boundingBox()
  const beforeList = await page.locator('.list-pane').boundingBox()

  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.note-item')).toHaveCount(3)
  await expect(page.locator('.sidebar-content')).toHaveCount(1)
  expect(await page.locator('.list-pane').boundingBox()).toEqual(beforeList)
  expect(await page.locator('.editor-pane').boundingBox()).toEqual(before)
  await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('')
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')

  await openStatsDialog(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '记录统计' })).toHaveCount(0)
  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'trash')
  await expect(page.locator('.note-item')).toHaveCount(3)
  await page.getByRole('button', { name: '笔记', exact: true }).click()

  await expect(page.locator('.layout')).toHaveAttribute('data-view', 'group')
  await expect(page.locator(`.groups [data-group-id="${groupId}"]`)).toHaveClass(/active/)
  await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('项目')
  await expect(page.locator('[data-note-id="navigation-12"]')).toHaveClass(/is-active/)
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
  expect(await page.locator('.editor-pane').boundingBox()).toEqual(before)
  await expect.poll(() => page.locator('.note-list').evaluate(el => el.scrollTop)).toBe(610)
  await expect.poll(() => page.locator('.editor-body').evaluate(el => el.scrollTop)).toBe(880)
})

test('编辑工具栏把格式写进正文，且不抢编辑器焦点', async ({ page }) => {
  // 标题：光标所在的段落整段升级成二级标题
  await createNote(page)
  const editor = page.getByRole('textbox', { name: '笔记正文' })
  await expect(editor).toBeFocused()
  await page.keyboard.type('小标题')
  await page.keyboard.press('Shift+Home')
  await page.locator('.format-bar [data-format="heading2"]').click()
  await expect(editor.locator('h2')).toHaveText('小标题')
  await expect.poll(() => savedBody(page)).toMatch(/^## 小标题/)
  // 按钮上的 mousedown 被拦住了，点完还能接着敲字，不用再点一次正文
  await expect(editor).toBeFocused()

  // 加粗：同级按钮再点一次应该取消，而不是叠加
  await page.keyboard.press('Control+a')
  await page.locator('.format-bar [data-format="bold"]').click()
  await expect(editor.locator('strong')).toHaveText('小标题')
  await expect.poll(() => savedBody(page)).toContain('## **小标题**')
  await page.locator('.format-bar [data-format="bold"]').click()
  await expect(editor.locator('strong')).toHaveCount(0)

  // 待办清单：正文段落直接变成可勾选的清单
  await createNote(page)
  await page.keyboard.type('买牛奶')
  await page.keyboard.press('Shift+Home')
  await page.locator('.format-bar [data-format="taskList"]').click()
  await expect(page.locator('.task-checkbox')).toHaveCount(1)
  await expect.poll(() => savedBody(page)).toContain('[ ] 买牛奶')

  // 表格：插入走 Milkdown 的表格预设，行列由预设的默认值决定
  await createNote(page)
  await page.locator('.format-bar [data-format="table"]').click()
  const table = page.locator('.milkdown table')
  await expect(table).toHaveCount(1)
  await expect(page.locator('.milkdown table th')).toHaveCount(3)
  await expect.poll(() => savedBody(page)).toContain('| :')

  // 链接：选中文字后填地址，改成 https 并写进正文
  await createNote(page)
  await page.keyboard.type('参考资料')
  await page.keyboard.press('Shift+Home')
  await page.locator('.format-bar [data-format="link"]').click()
  const dialog = page.locator('.link-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-field="text"]')).toHaveValue('参考资料')
  await dialog.locator('[data-field="href"]').fill('example.com')
  await dialog.locator('[data-op="confirm"]').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.milkdown a[href="https://example.com"]')).toHaveText('参考资料')
  await expect.poll(() => savedBody(page)).toContain('[参考资料](https://example.com)')
  await expect(editor).toBeFocused()
})

for (const width of [390, 320]) {
  test(`${width}px 手机统计返回原列表，回收站保持列表与只读预览切换`, async ({ page }) => {
    // 先用桌面创建样例，再切到手机，避免测试准备依赖抽屉状态。
    const groupId = await seedNavigationNotes(page)
    await page.setViewportSize({ width, height: 844 })
    await page.reload()
    await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.locator(`.groups [data-group-id="${groupId}"] .group-link`).click()
    await page.getByPlaceholder('搜索笔记').fill('项目')
    await page.locator('.note-list').evaluate(el => { el.scrollTop = 420 })

    await openStatsDialog(page)
    const dialog = page.getByRole('dialog', { name: '记录统计' })
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThan(0)
    expect(bounds!.width).toBeLessThan(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.goBack()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.layout')).toHaveAttribute('data-view', 'group')
    await expect(page.locator('.layout')).toHaveAttribute('data-mobile-pane', 'list')
    await expect(page.getByRole('button', { name: '打开侧栏' })).toBeFocused()
    expect(await page.locator('.note-list').evaluate(el => el.scrollTop)).toBe(420)

    await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    await expect(page.locator('.note-item')).toHaveCount(3)
    await expect(page.locator('.list-pane')).toBeVisible()
    await page.locator('.note-select').first().click()
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await page.getByRole('button', { name: '返回列表' }).click()
    await expect(page.locator('.list-pane')).toBeVisible()
    await page.getByRole('button', { name: '打开侧栏' }).click()
    await page.getByRole('button', { name: '笔记', exact: true }).click()
    await expect(page.getByPlaceholder('搜索笔记')).toHaveValue('项目')
    await expect(page.locator('.list-pane')).toBeVisible()
    await expect(page.getByRole('button', { name: '打开侧栏' })).toBeFocused()
    await expect.poll(() => page.locator('.note-list').evaluate(el => el.scrollTop)).toBe(420)
  })
}

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

test('点图片把文本光标放到图片旁边，打字不会吞掉图片', async ({ page }) => {
  // 手机上传的照片在电脑端往往占满整个编辑区，用户能点的只有图片本身。
  // 默认的 NodeSelection 会隐藏光标、打字直接替换掉图片——看起来就是「无法聚焦」。
  await createNote(page)
  await page.locator('.milkdown').click()
  // 1x1 的 PNG 分不出左右半边，在页面里画一张 400x300 再粘贴
  await page.locator('.milkdown .ProseMirror').evaluate(async (el) => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 300
    c.getContext('2d')!.fillRect(0, 0, 400, 300)
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'wide.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  const img = page.locator('.milkdown img[src^="/api/images/"]')
  await expect(img).toHaveCount(1, { timeout: 15_000 })
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBe(400)

  const box = (await img.boundingBox())!
  // 点右半边：光标落在图片后
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2)
  await expect(page.locator('.ProseMirror-hideselection')).toHaveCount(0)
  await page.keyboard.type('后')
  await expect(img).toHaveCount(1)
  await expect(page.locator('.ProseMirror p').first()).toHaveText('后')

  // 点左半边：光标落在图片前
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
  await expect(page.locator('.ProseMirror-hideselection')).toHaveCount(0)
  await page.keyboard.type('前')
  await expect(img).toHaveCount(1)
  await expect(page.locator('.ProseMirror p').first()).toHaveText('前后')
  await expect.poll(() => page.locator('.ProseMirror p').first().evaluate((p) => Array.from(p.childNodes).map((n) => n.nodeName).join(',')))
    .toMatch(/^#text,IMG,#text/)
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

test('新建直接输入，专注模式与快捷搜索保留正文', async ({ page }) => {
  await createNote(page)
  const editor = page.getByRole('textbox', { name: '笔记正文' })
  await expect(editor).toBeFocused()
  await page.keyboard.type('把重要的想法记下来')
  await expect(page.locator('.note-title').first()).toContainText('重要的想法')

  await page.getByRole('button', { name: '专注模式', exact: true }).click()
  await expect(page.locator('.list-pane')).toBeHidden()
  await expect(editor).toContainText('把重要的想法记下来')
  await page.keyboard.press('Escape')
  await expect(page.locator('.list-pane')).toBeVisible()

  await page.keyboard.press('Control+k')
  const search = page.getByRole('searchbox', { name: '搜索笔记' })
  await expect(search).toBeFocused()
  await search.fill('重要的想法')
  await expect(page.locator('.note-item')).toHaveCount(1)
  await createNote(page)
  await expect(search).toHaveValue('')
  await expect(page.locator('.note-item')).toHaveCount(2)
  await expect(editor).toBeFocused()
})

test('清单可勾选、撤销并保存，回收站中保持只读', async ({ page }) => {
  await createNote(page)
  const editor = page.getByRole('textbox', { name: '笔记正文' })
  await expect(editor).toBeFocused()
  await page.keyboard.type('- [ ] 买牛奶')
  const checkbox = page.locator('.task-checkbox')
  await expect(checkbox).toHaveCount(1)
  await expect(checkbox).not.toBeChecked()
  await expect.poll(() => savedBody(page)).toContain('[ ] 买牛奶')

  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await page.locator('[data-op="undo"]').click()
  await expect(checkbox).not.toBeChecked()
  await page.locator('[data-op="redo"]').click()
  await expect(checkbox).toBeChecked()
  await expect.poll(() => savedBody(page)).toContain('[x] 买牛奶')

  await page.reload()
  await expect(checkbox).toBeChecked()
  await page.locator('[data-op="trash"]').click()
  await page.locator('[data-op="confirm"]').click()
  await page.locator('.group-sidebar [data-view="trash"]').click()
  await expect(checkbox).toBeChecked()
  await expect(checkbox).toBeDisabled()
})

test('粘贴编号文本后从 1 开始，刷新后保留编号', async ({ page }) => {
  await createNote(page)
  const editor = page.getByRole('textbox', { name: '笔记正文' })
  await expect(editor).toBeFocused()
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '1. 第一项\n2. 第二项\n   1. 嵌套项')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })

  const starts = () => editor.locator('ol').evaluateAll(lists => lists.map(list => (list as HTMLOListElement).start))
  await expect.poll(starts).toEqual([1, 1])
  await expect.poll(() => savedBody(page)).toMatch(/^1\.\s+第一项/)
  await page.reload()
  await expect.poll(starts).toEqual([1, 1])
  await expect(editor).toContainText('嵌套项')
})

test('富文本列表的空起点默认是 1，嵌套与显式起点保存后不变', async ({ page }) => {
  await createNote(page)
  const editor = page.getByRole('textbox', { name: '笔记正文' })
  await expect(editor).toBeFocused()
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', '1. 第一项\n   4. 嵌套四\n   5. 嵌套五\n2. 第二项\n从零开始的示例\n0. 零号\n1. 一号')
    clipboardData.setData('text/html', '<ol start=""><li><p><strong>第一项</strong></p><ol start="4"><li>嵌套四</li><li>嵌套五</li></ol></li><li>第二项</li></ol><p>从零开始的示例</p><ol start="0"><li>零号</li><li>一号</li></ol>')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })

  const starts = () => editor.locator('ol').evaluateAll(lists => lists.map(list => (list as HTMLOListElement).start))
  await expect.poll(starts).toEqual([1, 4, 0])
  await expect(editor.locator('strong')).toHaveText('第一项')
  await expect.poll(() => savedBody(page)).toMatch(/^1\.\s+\*\*第一项\*\*/)
  await page.reload()
  await expect.poll(starts).toEqual([1, 4, 0])
  await expect(editor.locator('strong')).toHaveText('第一项')
})

test.describe('手机操作', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('启动显示目录，搜索随手可用，320px 下编辑工具栏完整可见', async ({ page }) => {
    await createNote(page)
    const editor = page.getByRole('textbox', { name: '笔记正文' })
    await expect(editor).toBeFocused()
    await page.keyboard.type('手机上随手记')
    await expect.poll(() => savedBody(page)).toContain('手机上随手记')
    await page.reload()

    await expect(page.locator('.list-pane')).toBeVisible()
    await expect(page.locator('.editor-pane')).toBeHidden()
    await expect(page.getByRole('searchbox')).toBeVisible()
    await page.locator('.drawer-btn').click()
    await expect(page.locator('.sidebar-pane')).toHaveClass(/is-open/)
    await page.locator('.group-sidebar [data-view="all"]').click()
    await expect(page.locator('.drawer-mask')).toHaveCount(0)

    await page.locator('.note-select').first().click()
    await expect(editor).toBeVisible()
    await page.setViewportSize({ width: 320, height: 700 })
    const toolbar = await page.locator('.op-bar').boundingBox()
    expect(toolbar!.x).toBeGreaterThanOrEqual(0)
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(320)
    // 格式工具栏是横向滚动的一条，不能把页面撑宽
    const formatBar = await page.locator('.format-bar').boundingBox()
    expect(formatBar!.x).toBeGreaterThanOrEqual(0)
    expect(formatBar!.x + formatBar!.width).toBeLessThanOrEqual(320)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    await expect(page.locator('.format-bar [data-format="bold"]')).toBeVisible()
    await expect(page.locator('[data-op="trash"]')).toBeVisible()
    await page.locator('[data-op="group"]').click()
    const groups = await page.getByRole('group', { name: '选择分组' }).boundingBox()
    expect(groups!.x).toBeGreaterThanOrEqual(0)
    expect(groups!.x + groups!.width).toBeLessThanOrEqual(320)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-op="group"]')).toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('searchbox')).toBeFocused()
    await expect(page.locator('.list-pane')).toBeVisible()
  })

  test('顶栏「插入图片」经文件选择器上传——手机浏览器不把剪贴板图片交给 paste 事件', async ({ page }) => {
    await createNote(page)
    await page.keyboard.type('手机选图')

    // 1x1 PNG。手机端没有键盘粘贴，选图是唯一可靠入口，走的必须是隐藏 input 的 change。
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const chooser = page.waitForEvent('filechooser')
    await page.locator('[data-op="image"]').click()
    const picker = await chooser
    expect(picker.isMultiple()).toBe(true)
    await picker.setFiles({ name: 'phone.png', mimeType: 'image/png', buffer: png })

    const img = page.locator('.milkdown img[src^="/api/images/"]')
    await expect(img).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('.milkdown img[src^="blob:"]')).toHaveCount(0)
    await expect.poll(() => savedBody(page), { timeout: 15_000 }).toContain('](/api/images/')
  })

  test('纵向滚动不触发删除，左滑只展开操作而不打开正文', async ({ page }) => {
    await createNote(page)
    await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeFocused()
    await page.keyboard.type('测试触摸手势')
    await expect.poll(() => savedBody(page)).toContain('测试触摸手势')
    await page.reload()
    const row = page.locator('.note-item').first()
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 220, clientY: 200 })
    await row.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 160, clientY: 350 })
    await expect(row).not.toHaveClass(/swiped/)

    await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 250, clientY: 200 })
    await row.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 150, clientY: 205 })
    await row.dispatchEvent('click')
    await expect(row).toHaveClass(/swiped/)
    await expect(page.locator('.list-pane')).toBeVisible()
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    await expect(row).toBeVisible()
  })
})
