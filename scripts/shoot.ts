/**
 * 布局目视检查：造几条形态不同的笔记，在三档视口各截一张图。
 * 不是测试，是给人看的——跑法：npx tsx scripts/shoot.ts（需 8787 上已有 wrangler dev）
 */
import { chromium, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const OUT = 'test-results/shots'

async function signIn(page: Page) {
  await page.goto(BASE)
  await page.evaluate(() => {
    localStorage.setItem('snotes_token', 'dev-token')
    document.cookie = 'snotes_token=dev-token; Path=/api/images/; SameSite=Strict'
  })
  await page.reload()
}

async function note(page: Page, lines: string[]) {
  await page.locator('.header-create').click()
  await page.locator('.milkdown').click()
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
  await page.waitForTimeout(1200)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page)

  // 分组
  await page.locator('.group-add').click()
  await page.locator('.dialog-input').fill('工作')
  await page.screenshot({ path: `${OUT}/dialog-新建分组.png` })
  await page.locator('.dialog-btn.ok').click()

  // 形态各异的三条：正常、只有标题（无摘要）、超长标题
  await note(page, ['# 周会纪要', '讨论了下个季度的排期与人力缺口。'])
  await note(page, ['只有一行标题没有正文'])
  await note(page, [
    '# 这是一个特别长的标题用来验证省略号与行高在截断时是否仍然对齐不会把日期行顶歪',
    '摘要同样很长，需要在一行内截断并显示省略号，不能换行撑高整个列表项。',
  ])

  await page.screenshot({ path: `${OUT}/desktop-1440.png` })

  // 空态：切到星标
  await page.locator('[data-view="star"]').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/empty-星标.png` })
  await page.locator('[data-view="all"]').click()
  await page.waitForTimeout(300)

  // 平板：抽屉展开
  await page.setViewportSize({ width: 900, height: 800 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/tablet-900-抽屉收起.png` })
  await page.locator('.drawer-btn').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/tablet-900-抽屉展开.png` })
  await page.locator('.drawer-mask').click()

  // 手机：列表态
  await page.setViewportSize({ width: 420, height: 780 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/mobile-420-列表.png` })
  await page.locator('.drawer-btn').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/mobile-420-抽屉.png` })

  await browser.close()
  console.log(`截图已输出到 ${OUT}`)
}

main()
