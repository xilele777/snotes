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
