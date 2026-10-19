import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

const content = '# 兼容性笔记\n\n旧空行\n\n\u200b\n\n==重点== 与 **加粗**。\n\n- [ ] 买牛奶\n\n3. 第三项\n4. 第四项\n\n| 名称 | 内容 |\n| --- | --- |\n| 表格 | 保留 |\n\n[参考](https://example.com)\n\n```ts\nconst a = 1\n```\n\n$$\nx^2 + y^2 = z^2\n$$\n\n```mermaid\nflowchart LR\n  A --> B\n```'
const body = (page: Page) => page.locator('.snotes-vditor [role="textbox"]:visible')
const tool = (page: Page, name: string) => page.locator(`.vditor-toolbar [data-type="${name}"]`).first()

async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('snotes')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise<string>((resolve, reject) => {
        const req = db.transaction('notes').objectStore('notes').getAll()
        req.onsuccess = () => resolve(req.result.map(note => note.body).join('\n'))
        req.onerror = () => reject(req.error)
      })
    } finally { db.close() }
  })
}

async function switchMode(page: Page, mode: string) {
  await tool(page, 'edit-mode').click()
  await page.locator(`.vditor-toolbar button[data-mode="${mode}"]`).click()
  await expect(page.locator('.snotes-vditor')).toHaveAttribute('data-mode', mode)
}

test.beforeEach(async ({ page }) => {
  resetServer()
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('snotes_token', 'dev-token')
    document.cookie = 'snotes_token=dev-token; Path=/api/images/; SameSite=Strict'
  })
  await page.reload()
  await page.locator('.header-create').click()
  await expect(body(page)).toBeFocused()
})

test('原生三种编辑模式、Markdown 往返与本设备模式记忆', async ({ page }) => {
  await switchMode(page, 'sv')
  await body(page).fill(content)
  await expect.poll(() => saved(page)).toContain('兼容性笔记')
  await switchMode(page, 'wysiwyg')
  const outline = page.locator('.vditor-outline')
  await expect(outline).toBeVisible()
  await expect(outline).toContainText('兼容性笔记')
  expect((await outline.boundingBox())!.width).toBe(200)
  const editor = body(page)
  await expect(editor.locator('mark')).toHaveText('重点')
  await expect(editor.locator('table')).toContainText('保留')
  await expect(editor.locator('ol')).toHaveAttribute('start', '3')
  await expect(editor.locator('a[href="https://example.com"]')).toHaveText('参考')
  await switchMode(page, 'ir')
  await expect(outline).toBeVisible()
  await expect(editor).toContainText('兼容性笔记')
  await switchMode(page, 'sv')
  await expect(body(page)).toHaveValue(/==重点==/)
  await page.reload()
  await expect(page.locator('.snotes-vditor')).toHaveAttribute('data-mode', 'sv')
  await expect(body(page)).toHaveValue(/兼容性笔记/)
})

test('快速切换笔记保留最后按键，撤销不跨文档', async ({ page }) => {
  await page.keyboard.insertText('第一篇最后按键')
  await page.locator('.header-create').click()
  await expect(body(page)).not.toContainText('第一篇')
  await expect(body(page)).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(body(page)).not.toContainText('第一篇')
  await page.locator('.note-select').filter({ hasText: '第一篇最后按键' }).click()
  await expect(body(page)).toContainText('第一篇最后按键')
})

test('表格按钮先收行数与列数，再按指定尺寸插入', async ({ page }) => {
  await switchMode(page, 'wysiwyg')
  await tool(page, 'table').click()
  const dialog = page.locator('.table-dialog')
  await expect(dialog).toBeVisible()
  await page.getByLabel('行数').fill('4')
  await page.getByLabel('列数').fill('2')
  await dialog.getByRole('button', { name: '插入' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(body(page).locator('table tr')).toHaveCount(4)
  await expect(body(page).locator('table th')).toHaveCount(2)
  await expect.poll(() => saved(page)).toContain('| - | - |')
})

test('原生格式工具和撤销重做', async ({ page }) => {
  await switchMode(page, 'wysiwyg')
  await body(page).click()
  await page.keyboard.insertText('需要加粗')
  await page.keyboard.press('Control+a')
  await tool(page, 'bold').click()
  await expect(body(page).locator('b, strong')).toHaveText('需要加粗')
  await expect.poll(() => saved(page)).toContain('**需要加粗**')
  await tool(page, 'undo').click()
  await expect(body(page).locator('b, strong')).toHaveCount(0)
  await tool(page, 'redo').click()
  await expect(body(page).locator('b, strong')).toHaveText('需要加粗')
})

for (const mode of ['ir', 'wysiwyg', 'sv']) {
  test(`${mode} 刚输入就能撤销和重做，连续撤销不会丢掉尚未入栈的文字`, async ({ page }) => {
    await switchMode(page, mode)
    await body(page).click()
    await page.keyboard.insertText('即时输入')
    await tool(page, 'undo').click()
    if (mode === 'sv') await expect(body(page)).not.toHaveValue(/即时输入/)
    else await expect(body(page)).not.toContainText('即时输入')
    await tool(page, 'redo').click()
    if (mode === 'sv') await expect(body(page)).toHaveValue(/即时输入/)
    else await expect(body(page)).toContainText('即时输入')
    await page.keyboard.insertText('追加文字')
    await page.keyboard.press('Control+z')
    if (mode === 'sv') await expect(body(page)).toHaveValue(/^\s*即时输入\s*$/)
    else await expect(body(page)).toHaveText('即时输入')
    await page.keyboard.press('Control+z')
    if (mode === 'sv') await expect(body(page)).not.toHaveValue(/即时输入/)
    else await expect(body(page)).not.toContainText('即时输入')
    await page.keyboard.press('Control+y')
    if (mode === 'sv') await expect(body(page)).toHaveValue(/即时输入/)
    else await expect(body(page)).toContainText('即时输入')
    await expect.poll(() => saved(page)).toContain('即时输入')
    expect(await saved(page)).not.toContain('追加文字')
  })
}

for (const mode of ['ir', 'wysiwyg', 'sv']) {
  test(`${mode} 格式与插入按钮逐项可用`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    async function seed(markdown = '检查文字') {
      if (await page.locator('.snotes-vditor').getAttribute('data-mode') !== 'sv') await switchMode(page, 'sv')
      await body(page).fill(markdown)
      if (mode !== 'sv') await switchMode(page, mode)
      await body(page).click()
      await page.keyboard.press('Control+a')
      if (mode !== 'sv' && markdown === '检查文字') {
        // Select text, excluding the trailing empty paragraph in rich modes.
        await body(page).evaluate(root => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const index = node.textContent?.indexOf('检查文字') ?? -1
            if (index < 0) continue
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + 4)
            window.getSelection()!.removeAllRanges()
            window.getSelection()!.addRange(range)
            break
          }
        })
      }
    }
    const inline: [string, RegExp][] = [
      ['bold', /\*\*检查文字\*\*/], ['italic', /\*检查文字\*/],
      ['strike', /~~检查文字~~/], ['highlight', /==检查文字==/],
      ['inline-code', /`检查文字`/],
    ]
    for (const [name, markdown] of inline) {
      await seed()
      await tool(page, name).click()
      await expect.poll(() => saved(page), { message: `${mode}: ${name}` }).toMatch(markdown)
    }
    for (const [name, markdown] of [
      ['list', /\* 检查文字/], ['ordered-list', /1\. 检查文字/],
      ['check', /\* \[ \] +检查文字/], ['quote', /> 检查文字/],
      ['code', /```[\s\S]*检查文字[\s\S]*```/], ['line', /(?:---|\*\*\*)/],
    ] as [string, RegExp][]) {
      await seed()
      await tool(page, name).click()
      await expect.poll(() => saved(page), { message: `${mode}: ${name}` }).toMatch(markdown)
    }
    await seed()
    await tool(page, 'headings').click()
    await page.locator('.vditor-toolbar [data-tag="h2"]').click()
    await expect.poll(() => saved(page)).toContain('## 检查文字')
    await seed()
    await tool(page, 'emoji').click()
    const emoji = page.locator('.vditor-emojis button[data-value]').first()
    const value = (await emoji.getAttribute('data-value'))!.trim()
    await emoji.click()
    await expect.poll(() => saved(page)).toContain(value)
    if (mode !== 'sv') {
      await seed('- 第一项\n- 第二项')
      await body(page).locator('li').last().click()
      await expect(tool(page, 'indent')).not.toHaveClass(/vditor-menu--disabled/)
      await tool(page, 'indent').click()
      await expect(body(page).locator('li li')).toHaveCount(1)
      await tool(page, 'outdent').click()
      await expect(body(page).locator('li li')).toHaveCount(0)
      await seed()
      await page.keyboard.press('ArrowRight')
      await tool(page, 'insert-before').click()
      await page.keyboard.insertText('前插入')
      await expect.poll(() => saved(page)).toMatch(/前插入[\s\S]*检查文字/)
      await tool(page, 'insert-after').click()
      await page.keyboard.insertText('后插入')
      await expect.poll(() => saved(page)).toContain('后插入')
    }
    expect(errors).toEqual([])
  })
}

test('预览切换与主题二级菜单可以实际点击', async ({ page }) => {
  await switchMode(page, 'sv')
  await body(page).fill('# 预览检查\n\n```js\nconst n = 1\n```')
  await tool(page, 'more').click()
  await tool(page, 'both').click()
  await expect(page.locator('.vditor-preview')).toBeHidden()
  await tool(page, 'more').click()
  await tool(page, 'both').click()
  await expect(page.locator('.vditor-preview')).toBeVisible()
  await tool(page, 'more').click()
  await tool(page, 'preview').click()
  await expect(body(page)).toHaveCount(0)
  await expect(page.locator('.vditor-preview')).toContainText('预览检查')
  await tool(page, 'more').click()
  await tool(page, 'preview').click()
  await expect(body(page)).toBeVisible()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await tool(page, 'more').click()
    await tool(page, 'content-theme').click()
    await page.locator('.vditor-toolbar [data-type="wechat"]').click()
    await expect(page.locator('#vditorContentTheme')).toHaveAttribute('href', /wechat\.css/)
    await tool(page, 'more').click()
    await tool(page, 'code-theme').click()
    await page.locator('.vditor-toolbar .vditor-hint button').filter({ hasText: /^github$/ }).click()
    await expect(page.locator('#vditorHljsStyle')).toHaveAttribute('href', /github\.min\.css/)
  }
})

test('原生链接和高亮快捷键可用，搜索使用更新后的键位', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.format-bar, .link-dialog, .table-dialog')).toHaveCount(0)
  await expect(page.locator('.vditor-toolbar [data-type="info"], .vditor-toolbar [data-type="help"], .vditor-toolbar [data-type="devtools"], .vditor-toolbar [data-type="export"]')).toHaveCount(0)
  await switchMode(page, 'wysiwyg')
  await page.keyboard.insertText('参考资料')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+k')
  const href = page.locator('.vditor-wysiwyg .vditor-panel input[placeholder="链接"]')
  await expect(href).toBeFocused()
  await href.fill('example.com\u00a0')
  await body(page).click()
  await expect(body(page).locator('a')).toHaveAttribute('href', 'https://example.com')
  await expect.poll(() => saved(page)).toContain('https://example.com')
  await page.keyboard.press('Control+Alt+9')
  await expect(page.locator('.snotes-vditor')).toHaveAttribute('data-mode', 'sv')
  await body(page).fill('重点')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+Alt+h')
  await expect(body(page)).toHaveValue('==重点==')
  await page.keyboard.press('Control+Alt+e')
  await expect(page.locator('.reading-banner')).toHaveCount(0)
  await expect.poll(() => saved(page)).toContain('==重点==')
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('searchbox', { name: '搜索笔记' })).toBeFocused()
  expect(errors).toEqual([])
})

test('移除阅读和专注入口，保留原生全屏，回收站仍禁止修改清单', async ({ page }) => {
  await switchMode(page, 'sv')
  await body(page).fill('- [ ] 买牛奶\n')
  await switchMode(page, 'wysiwyg')
  const checkbox = page.locator('.vditor-wysiwyg input[type="checkbox"]')
  await checkbox.check()
  await expect.poll(() => saved(page)).toMatch(/\[[xX]\] 买牛奶/)
  await expect(page.locator('[data-op="reading"]')).toHaveCount(0)
  await expect(page.locator('[data-action="reading"]')).toHaveCount(0)
  await expect(page.locator('[data-op="focus"]')).toHaveCount(0)
  await tool(page, 'fullscreen').click()
  await expect(page.locator('.snotes-vditor')).toHaveClass(/vditor--fullscreen/)
  const fullscreenBounds = (await page.locator('.snotes-vditor').boundingBox())!
  expect(fullscreenBounds.x).toBe(0)
  expect(fullscreenBounds.y).toBe(0)
  expect(fullscreenBounds.width).toBe(page.viewportSize()!.width)
  await tool(page, 'fullscreen').click()
  await expect(page.locator('.snotes-vditor')).not.toHaveClass(/vditor--fullscreen/)
  await body(page).click()
  await page.keyboard.press("Control+'")
  await expect(page.locator('.snotes-vditor')).toHaveClass(/vditor--fullscreen/)
  await page.keyboard.press("Control+'")
  await expect(page.locator('.snotes-vditor')).not.toHaveClass(/vditor--fullscreen/)
  await expect.poll(() => saved(page)).toMatch(/\[[xX]\] 买牛奶/)
  await page.locator('[data-op="more"]').click()
  await page.locator('[data-action="trash"]').click()
  await page.locator('.group-sidebar [data-view="trash"]').click()
  await expect(checkbox).toBeDisabled()
})

test('原生图片选择器沿用上传鉴权，双击使用项目灯箱', async ({ page }) => {
  await switchMode(page, 'wysiwyg')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.locator('.vditor-toolbar input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png })
  const image = body(page).locator('img[src^="/api/images/"]')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect.poll(() => saved(page)).toContain('/api/images/')
  await image.dblclick()
  await expect(page.locator('.lightbox-mask')).toBeVisible()
  const actions = await page.locator('.lightbox-bar').evaluate(el => {
    const buttons = el.querySelectorAll('button')
    const first = buttons[0]!.getBoundingClientRect()
    const last = buttons[buttons.length - 1]!.getBoundingClientRect()
    return { center: (first.left + last.right) / 2, viewport: innerWidth / 2 }
  })
  expect(Math.abs(actions.center - actions.viewport)).toBeLessThan(2)
})

test('公式、流程图与编辑器资源离线可用，未加载可选渲染器也能首次使用', async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    await new Promise<void>(resolve => {
      if (navigator.serviceWorker.controller) resolve()
      else navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    })
  })
  await context.setOffline(true)
  await page.reload()
  await expect(body(page)).toBeVisible()
  await switchMode(page, 'sv')
  await body(page).fill(content)
  await expect(page.locator('.vditor-preview .katex')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.vditor-preview svg[id^="mermaid"]')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => saved(page)).toContain('兼容性笔记')
})

for (const width of [320, 390]) {
  test(`${width}px 原生工具栏可用且页面不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await tool(page, 'edit-mode').scrollIntoViewIfNeeded()
    await expect(tool(page, 'edit-mode')).toBeInViewport()
    await tool(page, 'upload').scrollIntoViewIfNeeded()
    await expect(tool(page, 'upload')).toBeInViewport()
    await tool(page, 'headings').click()
    const headingsMenu = tool(page, 'headings').locator('..').locator('.vditor-hint')
    await expect(headingsMenu).toBeVisible()
    const menuBounds = (await headingsMenu.boundingBox())!
    expect(menuBounds.x).toBeGreaterThanOrEqual(0)
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width)
    await tool(page, 'headings').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.locator('[data-op="more"]').click()
    await page.locator('[data-action="notebooks"]').click()
    const notebook = await page.locator('.notebook-pop').boundingBox()
    expect(notebook!.x).toBeGreaterThanOrEqual(0)
    expect(notebook!.x + notebook!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await switchMode(page, 'sv')
    await body(page).fill('# 手机笔记\n\n正文')
    await expect.poll(() => saved(page)).toContain('手机笔记')
    await page.screenshot({ path: `tmp/vditor-${width}.png`, fullPage: true })
  })
}


test('大纲定位滚动工作区，收起栏目后正文居中，工具栏保持单行', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await switchMode(page, 'sv')
  await body(page).fill('# 定位笔记\n\n' + '正文段落\n\n'.repeat(50) + '## 目标章节\n\n' + '后续段落\n\n'.repeat(30))
  for (const mode of ['ir', 'wysiwyg']) {
    await switchMode(page, mode)
    await page.locator('.editor-body').evaluate(el => { el.scrollTop = 0 })
    await page.locator('.vditor-outline [data-target-id]').filter({ hasText: '目标章节' }).click()
    await expect.poll(() => page.locator('.editor-body').evaluate(el => el.scrollTop)).toBeGreaterThan(500)
    const host = (await page.locator('.editor-body').boundingBox())!
    const heading = (await body(page).locator('h2').boundingBox())!
    expect(heading.y).toBeGreaterThan(host.y + 40)
    expect(heading.y).toBeLessThan(host.y + 120)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  }
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await page.getByRole('button', { name: '收起笔记列表', exact: true }).click()
  const margins = await body(page).evaluate(el => {
    const parent = el.parentElement!.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    return [rect.left - parent.left, parent.right - rect.right]
  })
  expect(Math.abs(margins[0]! - margins[1]!)).toBeLessThan(2)
  const toolbar = page.locator('.vditor-toolbar')
  const tops = await toolbar.locator(':scope > .vditor-toolbar__item').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)
  await expect(tool(page, 'strike')).toBeVisible()
  await expect(tool(page, 'check')).toBeVisible()
  await expect(tool(page, 'outline')).toBeVisible()
})


