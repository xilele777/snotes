import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from '@playwright/test'

let browser, server, origin
const directory = resolve('../app/build/generated/editorAssets')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname.replace(/^\/assets\//, '')
    const target = resolve(directory, '.' + '/' + path)
    if (!target.startsWith(directory + '/') && !target.startsWith(directory + '\\')) { response.writeHead(403).end(); return }
    try { response.setHeader('Content-Type', types[extname(target)] || 'text/plain'); response.end(await readFile(target)) }
    catch { response.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
})
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)) })

const documentLoad = (markdown, sessionId = 'web-a', extra = {}) => ({
  bridgeVersion: 1, type: 'load', profileId: 'editor-prototype', noteId: 'sample-a',
  sessionId, markdown, readOnly: false, dark: false, fontSize: 16, ...extra,
})

async function pageWith(markdown, extra = {}) {
  const page = await browser.newPage({ viewport: { width: 412, height: 720 } })
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()) })
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { value: null })
    window.received = []; window.snotesNative = { postMessage: data => window.received.push(JSON.parse(data)) }
  })
  await page.goto(origin + '/assets/editor/index.html')
  await page.waitForFunction(() => window.received.some(m => m.type === 'ready'))
  await send(page, documentLoad(markdown, 'web-a', extra))
  await page.waitForFunction(() => window.received.some(m => m.type === 'loaded'))
  return { page, errors, external }
}

async function send(page, message) {
  await page.evaluate(message => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message), origin: location.origin })), message)
}
async function messages(page, type) {
  return page.evaluate(type => window.received.filter(m => m.type === type), type)
}

test('opens directly in Vditor IR with top toolbar and without legacy mode/format bars', async () => {
  const { page, errors, external } = await pageWith('# 标题\n\n==高亮文本==')
  try {
    assert.equal(await page.locator('#modes').count(), 0)
    assert.equal(await page.locator('#format').count(), 0)
    await page.locator('#rich .vditor-ir [contenteditable="true"]').waitFor()
    await page.locator('#rich .vditor-toolbar').waitFor()
    assert.equal((await messages(page, 'change')).length, 0)
    for (const width of [360, 412, 960]) {
      await page.setViewportSize({ width, height: 640 })
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      assert.equal(scrollWidth, width)
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
  } finally { await page.close() }
})

test('readOnly mode renders sanitized preview without editable controls or toolbar', async () => {
  const markdown = '# 中文\n\n<br />\n\n==高亮==\n\n- [ ] 待办\n\n| 甲 | 乙 |\n|---|---|\n| 一 | 二 |\n\n```html\n<script>代码示例</script>\n```\n\n![图片](/assets/editor/sample.svg)\n\n<img src=x onerror="window.pwned=1">\n\n[危险](javascript:alert(1))'
  const { page, errors, external } = await pageWith(markdown, { readOnly: true })
  try {
    await page.locator('#preview mark').waitFor()
    assert.equal(await page.locator('#preview mark').textContent(), '高亮')
    assert.equal(await page.locator('#preview table').count(), 1)
    assert.equal(await page.locator('#preview input:disabled').count(), 1)
    assert.equal(await page.locator('#preview script, #preview [onerror], #preview a[href^="javascript:"]').count(), 0)
    await page.waitForFunction(() => { const image = document.querySelector('#preview img'); return image?.complete && image.naturalWidth > 0 })
    assert.equal((await messages(page, 'change')).length, 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(external, [])
  } finally { await page.close() }
})

test('IR editing emits change and live flush captures final keystroke', async () => {
  const { page, errors } = await pageWith('初始')
  try {
    const editable = page.locator('#rich .vditor-ir [contenteditable="true"]')
    await editable.waitFor()
    await editable.fill('最后一次中文输入')
    await send(page, { ...documentLoad(''), type: 'flush', requestId: 'request-a', lock: true })
    await page.waitForFunction(() => window.received.some(m => m.type === 'flushed'))
    const [flushed] = await messages(page, 'flushed')
    assert.match(flushed.markdown, /最后一次中文输入/)
    assert.equal(flushed.sessionId, 'web-a')
    await send(page, { ...documentLoad(''), type: 'resume' })
    await send(page, { ...documentLoad(''), type: 'saved', revision: flushed.revision })
    assert.equal(await page.getByRole('status').textContent(), '已保存到本机')
    await send(page, { ...documentLoad(''), type: 'saveError' })
    assert.ok((await page.getByRole('status').textContent()).includes('保存失败'))
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test('76K long document stays in clean source mode without blue focus bar or IR DOM', async () => {
  const markdown = '# 长文\n\n' + '中文段落、光标与输入。'.repeat(7000)
  assert.ok(markdown.length > 76_000)
  const { page, errors } = await pageWith(markdown)
  try {
    assert.equal(await page.locator('#rich [contenteditable]').count(), 0)
    await page.locator('#source').focus()
    assert.equal(await page.locator('#source').evaluate(el => getComputedStyle(el).boxShadow), 'none')
    await page.locator('#source').fill(markdown + '\n最后一行')
    await send(page, { ...documentLoad(''), type: 'flush', requestId: 'long' })
    await page.waitForFunction(() => window.received.some(m => m.type === 'flushed'))
    assert.equal((await messages(page, 'flushed'))[0].markdown, markdown + '\n最后一行')
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
