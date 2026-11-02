import { expect, test, type Page } from '@playwright/test'
import { resetServer } from './reset-server'

const headers = { Authorization: 'Bearer dev-token' }
test.beforeEach(() => resetServer())

async function signIn(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
}

test('归属展示不会删除笔记，移出后正文仍可打开', async ({ page }) => {
  const id = crypto.randomUUID()
  const book = crypto.randomUUID()
  await page.request.post('/api/notes', { headers, data: { id, title: '归属验证', content: '# 归属验证\n\n保留正文', summary: '', create_time: Date.now() } })
  await page.request.post('/api/knowledge-bases', { headers, data: { id: book, operation_id: crypto.randomUUID(), name: '项目资料', description: '', icon: '', ord: 0, invalid: 0 } })
  await page.request.put(`/api/knowledge-bases/${book}/toc`, { headers, data: { base_toc_version: 0, operation_id: crypto.randomUUID(), nodes: [{ id: 'entry', kind: 'note', note_id: id, title: null, parent_id: null, ord: 0 }] } })
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.locator('.note-select').click()
  await page.locator('[data-op=notebooks]').click()
  const member = page.locator('.notebook-pop-members .member')
  await expect(member).toContainText('当前归属')
  await member.click()
  await expect(page.locator('.snotes-vditor [role=textbox]:visible')).toContainText('保留正文')
  await page.getByRole('button', { name: '移出笔记本，转为独立笔记', exact: true }).click()
  await expect(page.locator('.notebook-location')).toHaveCount(0)
  await page.getByRole('button', { name: '全部笔记', exact: true }).click()
  await page.locator('.note-select').click()
  await expect(page.locator('.snotes-vditor [role=textbox]:visible')).toContainText('保留正文')
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.note-item')).toHaveCount(0)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`手机格式展开保留选区、正文和撤销，动态效果设置 ${reducedMotion}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion })
    await signIn(page)
    await page.getByRole('button', { name: '开始记录', exact: true }).click()
    const editor = page.locator('.snotes-vditor [role=textbox]:visible')
    await expect(editor).toBeVisible()
    await editor.fill('保留这段正文')
    await editor.press('Control+End')
    const selection = () => editor.evaluate(el => {
      const range = window.getSelection()?.getRangeAt(0)
      return range && el.contains(range.startContainer) ? { offset: range.startOffset, text: range.startContainer.textContent } : null
    })
    const before = await selection()
    expect(before).not.toBeNull()
    const more = page.locator('[data-type=mobile-format]')
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(await selection()).toEqual(before)
    await expect(page.locator('[data-type=outline]')).toBeHidden()
    if (reducedMotion === 'reduce') {
      expect(await page.locator('.vditor-toolbar').evaluate(el => el.getAnimations().length)).toBe(0)
      await expect(page.locator('.editor-pane')).toHaveCSS('animation-name', 'none')
    }
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(await selection()).toEqual(before)
    await page.keyboard.type(' END')
    await expect(editor).toContainText('保留这段正文 END')
    await page.locator('[data-type=undo]').click()
    await expect(editor).not.toContainText('END')
    await page.locator('[data-type=redo]').click()
    await expect(editor).toContainText('END')
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索笔记' }).fill('保留')
    await expect(page.locator('.search-scope')).toHaveCount(0)
    await expect(page.locator('.note-item')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('mobile-search-scope.png'), animations: 'disabled' })
  })
}

test('当前笔记状态位于底部，顶栏在桌面与手机保持单行对齐', async ({ page, context }, testInfo) => {
  const id = crypto.randomUUID()
  await page.request.post('/api/notes', { headers, data: { id, title: '状态栏布局', content: '# 状态栏布局\n\n正文', summary: '', create_time: Date.now() } })
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.locator('.note-select').click()
  const status = page.locator('.editor-status-bar')
  await expect(status).toContainText('已保存并同步')
  await expect(page.locator('.editor-top-bar .note-save-status')).toHaveCount(0)

  for (const width of [1440, 1024, 721, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = () => page.locator('.editor-pane').evaluate(el => {
      const header = el.querySelector('.editor-top-bar')!.getBoundingClientRect()
      const location = el.querySelector('.editor-location')!.getBoundingClientRect()
      const actions = el.querySelector('.op-bar')!.getBoundingClientRect()
      const body = el.querySelector('.editor-body')!.getBoundingClientRect()
      const footer = el.querySelector('.editor-status-bar')!.getBoundingClientRect()
      return { header: header.height, bodyBottom: body.bottom, footerTop: footer.top, footerBottom: footer.bottom, footerHeight: footer.height, aligned: Math.abs(location.top + location.height / 2 - actions.top - actions.height / 2), overflow: document.documentElement.scrollWidth > innerWidth }
    })
    await expect.poll(async () => (await layout()).aligned).toBeLessThan(1)
    const before = await layout()
    expect(before.header).toBe(width <= 720 ? 60 : 64)
    expect(before.footerHeight).toBe(width <= 720 ? 44 : 32)
    expect(before.footerBottom).toBeLessThanOrEqual(844)
    expect(Math.abs(before.bodyBottom - before.footerTop)).toBeLessThan(1)
    expect(before.overflow).toBe(false)
    await context.setOffline(true)
    await expect(status).toContainText('已保存到本机 · 离线')
    expect(await layout()).toEqual(before)
    await context.setOffline(false)
    await expect(status).toContainText('已保存并同步')
    if (width === 1440 || width === 390) await page.screenshot({ path: testInfo.outputPath(`bottom-status-${width}.png`), animations: 'disabled' })
  }
})
