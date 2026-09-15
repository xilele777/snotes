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
      await page.setContent(`<!doctype html><html><head><style>
        html, body { margin: 0; width: 100%; height: 100%; }
        svg { display: block; width: 100%; height: 100%; }
      </style></head><body>${svg}</body></html>`)
      if (fullBleed) {
        // iOS and Android apply their own masks. Keep the background opaque;
        // the note artwork fits inside the central 80% diameter safe circle.
        await page.locator('svg > rect').evaluate(rect => rect.setAttribute('rx', '0'))
      }
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
