import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const assets = readdirSync('dist/assets')
const vendor = readdirSync('dist/vendor/vditor')
const checks = [
  { name: 'main JS', files: assets.filter(name => /^index-.*\.js$/.test(name)).map(name => join('dist/assets', name)), gzip: 120_000, decoded: 350_000 },
  { name: 'editor JS', files: assets.filter(name => /^VditorEditor-.*\.js$/.test(name)).map(name => join('dist/assets', name)), gzip: 100_000, decoded: 380_000 },
  { name: 'Lute parser', files: vendor.map(version => join('dist/vendor/vditor', version, 'dist/js/lute/lute.min.js')), gzip: 650_000, decoded: 4_000_000 },
]
let failed = false
for (const check of checks) {
  if (check.files.length !== 1) throw new Error(`${check.name}: expected one build resource, found ${check.files.length}`)
  const bytes = readFileSync(check.files[0])
  const zipped = gzipSync(bytes).byteLength
  const ok = zipped <= check.gzip && bytes.byteLength <= check.decoded
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check.name}: gzip ${zipped}/${check.gzip} B; decoded ${bytes.byteLength}/${check.decoded} B`)
  if (!ok) failed = true
}
if (failed) process.exitCode = 1
