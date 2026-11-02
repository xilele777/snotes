const { readFileSync } = require('node:fs')
const path = require('node:path')
const { chromium } = require('@playwright/test')

// snotes.svg is shared by the UI and favicon. Generate every raster size from it.
// Run `npx playwright install chromium` once, then `npm run icons:generate`.
const publicDir = path.resolve(__dirname, '../public')
const svg = readFileSync(path.join(publicDir, 'snotes.svg'), 'utf8')
const icons = [
  { name: 'favicon-32.png', size: 32 },
  { name: 'apple-touch-icon.png', size: 180, fullBleed: true },
  { name: 'snotes-192.png', size: 192 },
  { name: 'snotes-512.png', size: 512 },
  { name: 'snotes-maskable-512.png', size: 512, fullBleed: true },
]

async function main() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    for (const { name, size, fullBleed } of icons) {
      await page.setViewportSize({ width: size, height: size })
      // Installed apps need an opaque background. Scale the free-standing mark
      // into the central safe circle without adding a tile to the web logo.
      const artwork = fullBleed
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#F1F4FF"/><g transform="translate(6.4 6.4) scale(.8)">${svg.replace(/<svg[^>]*>|<\/svg>/g, '')}</g></svg>`
        : svg
      await page.setContent(`<!doctype html><html><head><style>
        html, body { margin: 0; width: 100%; height: 100%; }
        svg { display: block; width: 100%; height: 100%; }
      </style></head><body>${artwork}</body></html>`)
      await page.screenshot({ path: path.join(publicDir, name), omitBackground: true })
      console.log(`${name}: ${size} x ${size}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
