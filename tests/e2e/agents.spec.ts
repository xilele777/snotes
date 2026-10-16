import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resetServer } from './reset-server'

for (const width of [1440, 320]) test(`Agent credential, MCP document, deep link and revocation at ${width}px`, async ({ page, browser, baseURL }) => {
  resetServer()
  await page.setViewportSize({ width, height: 900 })
  const book = crypto.randomUUID()
  const created = await page.request.post('/api/knowledge-bases', { headers: { Authorization: 'Bearer dev-token' }, data: {
    id: book, name: 'Agent 项目资料', description: '', icon: '📚', ord: 0, invalid: 0, operation_id: crypto.randomUUID(),
  } })
  expect(created.ok()).toBe(true)
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('snotes_token', 'dev-token'))
  await page.reload()
  if (width < 1020) await page.getByRole('button', { name: '打开侧栏' }).click()
  await page.locator('.sidebar-footer').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: 'Agent 接入', exact: true }).click()
  const pane = page.locator('.agents-page')
  await pane.getByRole('textbox', { name: '凭证名称' }).fill('验收助手')
  await pane.getByRole('checkbox', { name: 'Agent 项目资料' }).check()
  await pane.getByRole('checkbox', { name: '修改', exact: false }).check()
  await pane.getByRole('button', { name: '创建凭证', exact: true }).click()
  const secret = await pane.getByRole('textbox', { name: '新建 Agent 密钥' }).inputValue()
  expect(secret).toMatch(/^snt_/)
  await expect(pane).toContainText('完整密钥仅在本次创建后显示')
  await pane.getByText('MCP 配置示例', { exact: true }).click()
  await expect(pane.locator('pre')).toContainText(secret)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  await page.screenshot({ path: `tmp/agent-review/settings-${width}.png` })
  await pane.getByRole('button', { name: '已保存，关闭显示' }).click()
  await expect(pane.getByRole('textbox', { name: '新建 Agent 密钥' })).toHaveCount(0)
  await expect(pane.locator('pre')).not.toContainText(secret)

  const client = new Client({ name: 'browser-e2e', version: '1' })
  let noteUrl: string
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('/api/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }))
    const folder = await client.callTool({ name: 'create_folder', arguments: { notebook_id: book, title: '接口设计', operation_id: 'e2e-folder' } })
    const saved = await client.callTool({ name: 'create_note', arguments: { notebook_id: book, parent_id: (folder.structuredContent as { node_id: string }).node_id,
      content: '# Agent 文档验收\n\n这是 MCP 客户端写入的正文。', operation_id: 'e2e-note' } })
    expect(saved.isError).not.toBe(true)
    noteUrl = (saved.structuredContent as { url: string }).url
  } finally { await client.close() }
  await pane.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(pane.locator('.agent-activity')).toContainText('新建笔记')
  await pane.getByRole('button', { name: '撤销 验收助手' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '撤销凭证', exact: true }).click()
  await expect(pane.locator('.agent-token-list')).toContainText('已撤销')
  const denied = await page.request.get('/api/agent/v1/notebooks', { headers: { Authorization: `Bearer ${secret}` } })
  expect(denied.status()).toBe(401)

  // Open the result from a fresh signed-out browser state, then sync after login.
  const fresh = await browser.newContext({ baseURL, viewport: { width, height: 900 } })
  try {
    const target = await fresh.newPage()
    await target.goto(noteUrl!)
    await target.getByLabel('访问令牌', { exact: true }).fill('dev-token')
    await target.getByRole('button', { name: '进入我的便签' }).click()
    await expect(target.locator('.milkdown .ProseMirror')).toContainText('这是 MCP 客户端写入的正文。')
    if (width > 720) await expect(target.locator('.kb-tree-row').filter({ hasText: 'Agent 文档验收' })).toBeVisible()
    expect(await target.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await target.screenshot({ path: `tmp/agent-review/document-${width}.png` })
  } finally { await fresh.close() }
})
