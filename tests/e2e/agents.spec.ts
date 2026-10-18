import { expect, test } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resetServer } from './reset-server'

test.use({ serviceWorkers: 'block' })

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
  let finishInitialLoad!: () => void
  let failCredentials = false
  const initialLoad = new Promise<void>(resolve => { finishInitialLoad = resolve })
  await page.route(/\/api\/agent-tokens(?:\/activity)?$/, async route => {
    await initialLoad
    if (failCredentials && route.request().url().endsWith('/agent-tokens')) {
      failCredentials = false
      await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } })
      return
    }
    await route.continue()
  })
  await page.getByRole('tab', { name: 'Agent 接入', exact: true }).click()
  const pane = page.locator('.agents-page')
  const refresh = pane.getByRole('button', { name: '刷新', exact: true })
  await expect(refresh).toBeDisabled()
  await expect(refresh).toHaveText('加载中')
  const loadingHeading = await pane.locator('#agent-create-heading').boundingBox()
  const loadingConnection = await pane.locator('#agent-connect-heading').boundingBox()
  const loadingRefresh = await refresh.boundingBox()
  finishInitialLoad()
  await expect(refresh).toBeEnabled()
  expect(await pane.locator('#agent-create-heading').boundingBox()).toEqual(loadingHeading)
  expect(await pane.locator('#agent-connect-heading').boundingBox()).toEqual(loadingConnection)
  expect(await refresh.boundingBox()).toEqual(loadingRefresh)
  failCredentials = true
  await refresh.click()
  const loadFailure = pane.locator('.agent-book-options').getByRole('alert')
  await expect(loadFailure).toContainText('服务暂时不可用，请稍后重试。')
  expect(await pane.locator('#agent-create-heading').boundingBox()).toEqual(loadingHeading)
  expect(await pane.locator('#agent-connect-heading').boundingBox()).toEqual(loadingConnection)
  await page.screenshot({ path: `tmp/agent-review/load-error-${width}.png`, animations: 'disabled' })
  await loadFailure.getByRole('button', { name: '重试', exact: true }).click()
  await expect(refresh).toBeEnabled()
  await expect(loadFailure).toHaveCount(0)
  await expect(pane.getByRole('heading', { name: 'Agent 接入', exact: true })).toHaveCount(0)
  await expect(pane.getByRole('tooltip')).toHaveCount(0)
  const createHint = pane.getByRole('button', { name: '创建凭证说明', exact: true })
  if (width > 720) await createHint.hover()
  else await createHint.click()
  await expect(pane.getByRole('tooltip')).toContainText('所有凭证都能查看授权笔记本的目录和笔记标题')
  const hintBox = (await pane.getByRole('tooltip').boundingBox())!
  expect(hintBox.x).toBeGreaterThanOrEqual(0)
  expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(width)
  await page.keyboard.press('Escape')
  const expiry = pane.getByRole('button', { name: '有效期：30 天', exact: true })
  await expiry.press('ArrowDown')
  const expiryMenu = page.getByRole('menu', { name: '有效期', exact: true })
  await expect(expiryMenu.getByRole('menuitemradio', { name: '30 天', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(pane.getByRole('button', { name: '有效期：长期有效', exact: true })).toBeFocused()
  await pane.getByRole('button', { name: '有效期：长期有效', exact: true }).click()
  await expect(expiryMenu).toBeVisible()
  await expect(expiryMenu).toHaveCSS('opacity', '1')
  const expiryBox = (await expiryMenu.boundingBox())!
  expect(expiryBox.x).toBeGreaterThanOrEqual(0)
  expect(expiryBox.x + expiryBox.width).toBeLessThanOrEqual(width)
  await page.screenshot({ path: `tmp/agent-review/expiry-${width}.png`, animations: 'disabled' })
  await expiryMenu.getByRole('menuitemradio', { name: '30 天', exact: true }).click()
  await expect(expiry).toBeFocused()
  await expect(expiryMenu).toHaveCount(0)
  await expect(pane.getByRole('tooltip')).toHaveCount(0)
  await pane.getByRole('button', { name: '修改说明', exact: true }).focus()
  await expect(pane.getByRole('tooltip')).toHaveText('替换正文或追加内容')
  await expect(pane.getByRole('checkbox', { name: '修改', exact: true })).not.toBeChecked()
  await page.keyboard.press('Escape')
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
  await expect(pane.locator('.agent-token-card .agent-badge')).toHaveText('有效')
  await expect(pane.locator('.agent-activity > li')).toHaveCount(2)
  await pane.getByText('MCP 配置示例', { exact: true }).click()
  await pane.locator('.agent-token-list').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `tmp/agent-review/simple-records-${width}.png`, style: '.toast-host { visibility: hidden; }' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: `tmp/agent-review/simple-records-dark-${width}.png`, animations: 'disabled', style: '.toast-host { visibility: hidden; }' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await pane.getByRole('button', { name: '最近写入说明', exact: true }).click()
  await expect(pane.getByRole('tooltip')).toHaveText('显示最近 50 次成功写入，重复请求只计一次。')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  await page.keyboard.press('Escape')
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
    await expect(target.locator('.snotes-vditor [role="textbox"]:visible')).toContainText('这是 MCP 客户端写入的正文。')
    if (width > 720) await expect(target.locator('.kb-tree-row').filter({ hasText: 'Agent 文档验收' })).toBeVisible()
    expect(await target.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await target.screenshot({ path: `tmp/agent-review/document-${width}.png` })
  } finally { await fresh.close() }
})
