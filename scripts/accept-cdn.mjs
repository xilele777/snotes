import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const origin = process.env.SNOTES_STAGING_URL
if (!origin) throw new Error('Set SNOTES_STAGING_URL')
const html = await (await fetch(origin)).text()
const main = html.split('src="').map(value => value.split('"')[0]).find(path => path.startsWith('/assets/index-') && path.endsWith('.js'))
assert(main, 'Main script missing')
const results = []
for (const path of [main, '/vendor/vditor/4.0.0/dist/js/lute/lute.min.js', '/', '/sw.js']) {
  const response = await fetch(new URL(path, origin), { headers: { 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(30_000) })
  assert.equal(response.status, 200)
  const bytes = Buffer.from(await response.arrayBuffer())
  const local = readFileSync('dist' + (path === '/' ? '/index.html' : path))
  const hash = value => createHash('sha256').update(value).digest('hex')
  const row = { path, status: response.status, headers: Object.fromEntries(['content-encoding', 'cache-control', 'vary', 'cf-cache-status', 'content-type'].map(key => [key, response.headers.get(key)])), decoded_bytes: bytes.length, hash_equal: hash(bytes) === hash(local) }
  results.push(row)
}
mkdirSync('tmp/acceptance', { recursive: true })
writeFileSync('tmp/acceptance/staging-cdn.json', JSON.stringify({ origin, at: new Date().toISOString(), results }, null, 2))
console.log(JSON.stringify(results, null, 2))
assert(results.every(row => row.hash_equal), 'CDN output differs from the current build')
assert(results.slice(0, 2).every(row => ['gzip', 'br'].includes(row.headers['content-encoding'])), 'Large scripts must be compressed')
assert(results.every(row => row.headers.vary?.toLowerCase().includes('accept-encoding')), 'Compressed responses must vary by encoding')
assert(results.slice(0, 2).every(row => /max-age=31536000/.test(row.headers['cache-control']) && /immutable/.test(row.headers['cache-control'])), 'Versioned scripts must be immutable')
assert(results.slice(2).every(row => /no-cache/.test(row.headers['cache-control'])), 'HTML and service worker must revalidate')
