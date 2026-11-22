import { build, transform } from 'esbuild'
import { mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

const directory = fileURLToPath(new URL('.', import.meta.url))
const output = resolve(directory, '../app/build/generated/editorAssets/editor')
// Only remove the owned generated directory, never an environment-supplied path.
if (!relative(resolve(directory, '../app/build'), output).startsWith(`generated${sep}`)) throw Error('Invalid output path')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const rootPackage = JSON.parse(await readFile(resolve(directory, '../../package.json'), 'utf8'))
const vditorPackage = JSON.parse(await readFile(resolve(directory, 'node_modules/vditor/package.json'), 'utf8'))
if (rootPackage.dependencies.vditor !== vditorPackage.version) throw Error('Android and Web must pin the same Vditor version')
await build({
  entryPoints: [resolve(directory, 'src/main.ts')],
  bundle: true, outdir: output, entryNames: 'editor', chunkNames: 'chunk-[hash]',
  splitting: true, format: 'esm', target: 'chrome100', minify: true, legalComments: 'none',
  plugins: [{
    name: 'vditor-disabled-storage-guard',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]vditor[\\/]dist[\\/]index\.js$/ }, async ({ path }) => {
        const original = await readFile(path, 'utf8')
        const guard = 'return typeof localStorage !== "undefined";'
        if (original.split(guard).length !== 2) throw Error('Pinned Vditor storage guard changed; review the compatibility patch')
        // Android with DOM storage disabled exposes null, not undefined. Patch
        // only this capability check; cache.enable remains false throughout.
        return { contents: original.replace(guard, 'return typeof localStorage !== "undefined" && localStorage !== null;'), loader: 'js' }
      })
    },
  }],
})
await cp(resolve(directory, 'index.html'), resolve(output, 'index.html'))
const rawEditorCss = await readFile(resolve(directory, 'src/editor.css'), 'utf8')
const minEditorCss = await transform(rawEditorCss, { loader: 'css', minify: true })
await writeFile(resolve(output, 'editor.css'), minEditorCss.code)
await cp(resolve(directory, 'sample.svg'), resolve(output, 'sample.svg'))
const vendor = resolve(output, 'vendor/vditor')
await mkdir(resolve(vendor, 'dist/js/lute'), { recursive: true })
await mkdir(resolve(vendor, 'dist/js/i18n'), { recursive: true })
await mkdir(resolve(vendor, 'dist/js/icons'), { recursive: true })
await mkdir(resolve(vendor, 'dist/css/content-theme'), { recursive: true })
await cp(resolve(directory, 'node_modules/vditor/dist/js/lute/lute.min.js'), resolve(vendor, 'dist/js/lute/lute.min.js'))
for (const cssPath of ['index.css', 'css/content-theme/light.css', 'css/content-theme/dark.css']) {
  const raw = await readFile(resolve(directory, 'node_modules/vditor/dist', cssPath), 'utf8')
  const minified = await transform(raw, { loader: 'css', minify: true })
  await writeFile(resolve(vendor, 'dist', cssPath), minified.code)
}
for (const jsPath of ['js/i18n/zh_CN.js', 'js/icons/ant.js']) {
  const raw = await readFile(resolve(directory, 'node_modules/vditor/dist', jsPath), 'utf8')
  const minified = await transform(raw, { loader: 'js', minify: true, legalComments: 'none' })
  await writeFile(resolve(vendor, 'dist', jsPath), minified.code)
}
for (const [name, license] of [['vditor', 'LICENSE'], ['dompurify', 'LICENSE']]) {
  await cp(resolve(directory, 'node_modules', name, license), resolve(output, `${name}-LICENSE`))
}
const lute = await readFile(resolve(vendor, 'dist/js/lute/lute.min.js'))
await writeFile(resolve(output, 'assets.json'), JSON.stringify({ bridgeVersion: 1, vditor: vditorPackage.version, vditorPatch: 'disabled-storage-null-guard', luteSha256: createHash('sha256').update(lute).digest('hex') }, null, 2))
console.log('Built local editor assets:', output)
