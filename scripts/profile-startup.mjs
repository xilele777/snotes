import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright'

// Usage: node scripts/profile-startup.mjs [--baseline <built-dist>] [--runs 3]
// With --baseline, also verify in-place service-worker cache cleanup. The API
// below is a synthetic fixture; no production notes or credentials are used.
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const baseline = option('--baseline')
const runs = Number(option('--runs') ?? 3)
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1..10')
const outputPath = option('--output') ?? 'tmp/startup-profile.json'
const current = option('--current') ?? 'dist'
const noteCount = 500
const notes = Array.from({ length: noteCount }, (_, index) => ({
  id: `perf-${String(index).padStart(4, '0')}`, group_id: null,
  title: `性能测试 ${index}`, summary: '用于相同数据下的启动比较', thumbnail: null,
  version: 1, prop_version: 1, star: 0, top: 0, skin_color: null, home_hidden: null,
  invalid: 0, create_time: 1_750_000_000_000 + index, update_time: 1_750_000_000_000 + index,
}))
const body = note => `# ${note.title}\n\n` + '这是一段正常的中文笔记正文，包含一些 English 和 **加粗**。\n\n'.repeat(40)
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' }

async function serve(directory) {
  const files = new Map()
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname.startsWith('/api/')) {
        let raw = ''
        for await (const chunk of request) raw += chunk
        const req = raw ? JSON.parse(raw) : {}
        let result = {}
        if (pathname === '/api/sync/pull') {
          const offset = Number(req.cursor || 0)
          const rows = req.since ? [] : notes.slice(offset, offset + 200)
          result = { notes: rows, groups: [], server_time: 1_750_000_001_000, next_cursor: offset + 200 < noteCount && rows.length ? String(offset + 200) : null }
        } else if (pathname === '/api/sync/bodies') {
          result = { bodies: req.ids.map(id => ({ note_id: id, content: body(notes.find(note => note.id === id)), version: 1 })) }
        } else if (pathname === '/api/notes/opens') result = { opens: (req.want ?? []).map(id => ({ note_id: id, others_count: 0, others_last_open_time: 0 })), server_time: 1 }
        else if (pathname === '/api/knowledge-bases/sync/pull') result = { books: [], until: 1, next_after: null }
        else if (pathname === '/api/health') result = { ok: true }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' })
        response.end(gzipSync(JSON.stringify(result)))
        return
      }
      let file = resolve(directory, `.${pathname}`)
      if (!file.startsWith(resolve(directory))) throw new Error('bad path')
      if (!existsSync(file) || pathname === '/') file = resolve(directory, 'index.html')
      let data = files.get(file)
      if (!data) { data = gzipSync(readFileSync(file)); files.set(file, data) }
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': /(?:assets|vendor)\//.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache' })
      response.end(data)
    } catch (error) { response.writeHead(500); response.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}`, setDirectory(next) { directory = next; files.clear() } }
}

const browser = await chromium.launch()
const results = []
const servers = new Set()
try {
  for (let run = 1; run <= runs; run++) {
   for (const [label, directory] of [...(baseline ? [['baseline', baseline]] : []), ['optimized', current]]) {
    const { server, url, setDirectory } = await serve(directory)
    servers.add(server)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true })
    await context.addInitScript(() => {
      localStorage.setItem('snotes_token', 'performance-fixture')
      localStorage.setItem('snotes_update_check', JSON.stringify({ latest: '0.24.0', url: 'https://github.com/xilele777/snotes/releases', checkedAt: Date.now() }))
      window.__longTasks = []
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__longTasks.push({ start: entry.startTime, duration: entry.duration }) }).observe({ type: 'longtask', buffered: true })
      const open = XMLHttpRequest.prototype.open
      window.__syncXhr = 0
      XMLHttpRequest.prototype.open = function(method, url, async = true, ...args) {
        if (async === false) window.__syncXhr++
        return open.call(this, method, url, async, ...args)
      }
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 4_000_000 / 8, uploadThroughput: 1_000_000 / 8 })
    const output = { label, run, notes: noteCount, cpu: '4x slowdown', network: '4 Mbps / 40 ms' }
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(count => Number(document.querySelector('.header-count')?.textContent) === count, noteCount, { timeout: 90_000 })
    output.coldListMs = Math.round(await page.evaluate(() => performance.now()))
    const first = page.locator('.note-select').first()
    const openAt = await page.evaluate(() => performance.now())
    await first.evaluate(element => element.click())
    await page.waitForFunction(() => [...document.querySelectorAll('.snotes-vditor [role="textbox"]')].some(el => el.getClientRects().length && el.textContent.includes('性能测试')), null, { timeout: 60_000 })
    output.firstEditorMs = Math.round(await page.evaluate(() => performance.now()) - openAt)
    await page.waitForFunction(() => !document.querySelector('.header-refresh')?.disabled, null, { timeout: 90_000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    // All precached resources have been saved by ready; measure actual browser
    // storage, not just downloaded compressed sizes.
    output.storageBytes = await page.evaluate(async () => (await navigator.storage.estimate()).usage)
    output.storageDetails = await page.evaluate(async () => (await navigator.storage.estimate()).usageDetails)
    output.cacheEntries = await page.evaluate(async () => {
      let count = 0
      for (const name of await caches.keys()) count += (await (await caches.open(name)).keys()).length
      return count
    })
    output.coldSyncXhr = await page.evaluate(() => window.__syncXhr)
    output.coldLongTaskMs = Math.round(await page.evaluate(() => window.__longTasks.reduce((sum, task) => sum + task.duration, 0)))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => [...document.querySelectorAll('.snotes-vditor [role="textbox"]')].some(el => el.getClientRects().length && el.textContent.includes('性能测试')), null, { timeout: 60_000 })
    output.warmEditorMs = Math.round(await page.evaluate(() => performance.now()))
    output.warmSyncXhr = await page.evaluate(() => window.__syncXhr)
    output.warmLongTaskMs = Math.round(await page.evaluate(() => window.__longTasks.reduce((sum, task) => sum + task.duration, 0)))
    output.errors = errors
    results.push(output)
    console.log(JSON.stringify(output))
    if (label === 'baseline' && run === 1) {
      setDirectory(current)
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        const controller = navigator.serviceWorker.controller
        const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
        await registration.update()
        if (navigator.serviceWorker.controller === controller) await changed
      })
      // Workbox activation must discard unused old vendor URLs while retaining
      // the local database. Browser storage usage estimates may lag cleanup.
      await page.waitForFunction(async () => {
        const entries = (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat()
        return entries.length < 60 && !entries.some(req => /mermaid|mathjax|graphviz/i.test(req.url))
      }, null, { timeout: 90_000 })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('.header-count')?.textContent === '500')
      await page.waitForFunction(async () => {
        const entries = (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat()
        return entries.length < 60 && !entries.some(req => /mermaid|mathjax|graphviz/i.test(req.url))
      }, null, { timeout: 90_000 })
      const upgrade = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('snotes'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
        })
        const noteCount = await new Promise((resolve, reject) => {
          const request = db.transaction('notes').objectStore('notes').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
        })
        db.close()
        const cacheEntries = (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat().length
        return { noteCount, cacheEntries }
      })
      if (upgrade.noteCount !== noteCount) throw new Error('Upgrade lost notes')
      output.upgrade = upgrade
      console.log(JSON.stringify({ upgrade }))
    }
    await context.close()
    await new Promise(resolve => server.close(resolve))
    servers.delete(server)
   }
  }
} finally {
  await browser.close()
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))))
}
mkdirSync('tmp', { recursive: true })
writeFileSync(outputPath, JSON.stringify(results, null, 2))
