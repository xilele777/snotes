import { expect, test } from '@playwright/test'
import { resetServer } from './reset-server'

test.beforeEach(() => resetServer())
const headers = { Authorization: 'Bearer dev-token' }

test('卡片与列表切换记忆偏好，并保留选择、搜索和排序', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const title of ['Alpha idea', 'Beta idea']) {
    await page.request.post('/api/notes', { headers, data: { id: crypto.randomUUID(), title, content: `# ${title}\n\nA short description.`, summary: 'A short description.', create_time: Date.now() } })
  }
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  await expect(page.locator('.note-item')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '卡片视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '打开笔记：Alpha idea', exact: true }).click()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  await expect(page.locator('.note-list')).not.toHaveClass(/is-cards/)
  await expect(page.locator('.note-select[aria-current="true"]')).toHaveAttribute('aria-label', '打开笔记：Alpha idea')
  await page.reload()
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('searchbox', { name: '搜索笔记', exact: true }).fill('Beta')
  await expect(page.locator('.note-item')).toHaveCount(1)
  await page.getByRole('button', { name: '卡片视图', exact: true }).click()
  await expect(page.locator('.note-item')).toHaveCount(1)
  await expect(page.getByRole('searchbox', { name: '搜索笔记', exact: true })).toHaveValue('Beta')
})

test('大纲读取真实标题、跳过代码块，跳转与关闭不会重建正文', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const content = '# 大纲验收\n\n## 第一节\n\n' + '一段长文字。\n\n'.repeat(30) + '## 第二节\n\n结尾。\n\n```md\n# 代码中的假标题\n```'
  await page.request.post('/api/notes', { headers, data: { id: crypto.randomUUID(), title: '大纲验收', content, summary: '第一节', create_time: Date.now() } })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  await page.getByRole('button', { name: '打开笔记：大纲验收', exact: true }).click()
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible()
  await editor.evaluate(el => el.setAttribute('data-continuity', 'original'))
  await page.getByRole('button', { name: '笔记大纲', exact: true }).click()
  const outline = page.getByRole('complementary', { name: '笔记大纲', exact: true })
  await expect(outline.getByRole('button', { name: '第二节', exact: true })).toBeVisible()
  await expect(outline.getByRole('button', { name: '代码中的假标题', exact: true })).toHaveCount(0)
  await outline.getByRole('button', { name: '第二节', exact: true }).click()
  await expect.poll(() => page.locator('.editor-body').evaluate(el => el.scrollTop)).toBeGreaterThan(500)
  await page.keyboard.press('Escape')
  await expect(outline).toHaveCount(0)
  await expect(page.getByRole('button', { name: '笔记大纲', exact: true })).toBeFocused()
  await expect(editor).toHaveAttribute('data-continuity', 'original')
  await page.getByRole('button', { name: '阅读模式', exact: true }).click()
  await page.getByRole('button', { name: '笔记大纲', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(outline).toHaveCount(0)
  await expect(editor).toHaveAttribute('contenteditable', 'false')
})

for (const width of [1440, 390]) {
  test(`全局搜索跨笔记本跳转，并保留关闭前的编辑器 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const bookId = crypto.randomUUID()
    const noteId = crypto.randomUUID()
    await page.request.post('/api/notes', { headers, data: { id: noteId, title: '跨范围资料', content: '# 跨范围资料\n\n正文里有火星基地。', summary: '火星基地', create_time: Date.now() } })
    await page.request.post('/api/knowledge-bases', { headers, data: { id: bookId, operation_id: crypto.randomUUID(), name: '探索手记', description: '', icon: '', ord: 0, invalid: 0 } })
    const nodes = [{ id: 'chapter', kind: 'folder', parent_id: null, ord: 0, title: '研究', note_id: null }, { id: 'entry', kind: 'note', parent_id: 'chapter', ord: 0, title: null, note_id: noteId }]
    expect((await page.request.put(`/api/knowledge-bases/${bookId}/toc`, { headers, data: { nodes, base_toc_version: 0, operation_id: crypto.randomUUID() } })).ok()).toBe(true)
    let releaseNotebookPull!: () => void
    const notebookPull = new Promise<void>(resolve => { releaseNotebookPull = resolve })
    await page.route('**/api/knowledge-bases/sync/pull', async route => { await notebookPull; await route.continue() })
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
    await page.reload()
    await expect(page.locator('.note-item')).toHaveCount(0)
    if (width <= 720) {
      await page.getByRole('button', { name: '打开侧栏', exact: true }).click()
      await page.getByRole('button', { name: '全局搜索', exact: true }).click()
    } else await page.keyboard.press('Control+k')
    const search = page.getByRole('combobox', { name: '全局搜索笔记', exact: true })
    await expect(search).toBeFocused()
    await search.fill('火星 基地')
    await expect(page.getByRole('option')).toHaveCount(1)
    // Note bodies can arrive before the first notebook pull. Opening must wait
    // for that pull and route to the newly discovered owner.
    await expect(page.getByRole('option')).toContainText('独立笔记')
    await search.press('Enter')
    releaseNotebookPull()
    await expect(page.getByRole('dialog', { name: '全局搜索', exact: true })).toHaveCount(0)
    const editor = page.locator('.ProseMirror')
    await expect(editor).toContainText('跨范围资料')
    await editor.evaluate(el => el.setAttribute('data-continuity', 'search-preserved'))
    await page.keyboard.press('Control+k')
    await expect(search).toBeFocused()
    await search.fill('没有的词')
    await expect(page.getByText('没有找到相关内容', { exact: true })).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveCount(0)
    await expect(editor).toHaveAttribute('data-continuity', 'search-preserved')
    if (width > 720) {
      await expect(page.locator('.kb-header h2')).toBeFocused()
      await expect(page.locator('.kb-tree-row.selected')).toContainText('跨范围资料')
      await expect(page.locator('.kb-header h2')).toHaveText('探索手记')
      await page.getByRole('button', { name: '探索手记', exact: true }).click()
      await expect(page.getByRole('region', { name: '最近编辑', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '研究', exact: true }).click()
      await expect(page.locator('.kb-node-link').filter({ hasText: '跨范围资料' })).toHaveCount(0)
      await page.getByRole('button', { name: '继续编辑：跨范围资料', exact: true }).click()
      await expect(editor).toContainText('火星基地')
      await expect(page.locator('.kb-tree-row.selected')).toContainText('跨范围资料')
    }
  })
}
