import { describe, expect, it } from 'vitest'
import { escapeRawHtml } from './sanitize'

describe('escapeRawHtml', () => {
  it('转义脚本标签', () => {
    expect(escapeRawHtml('<script>alert(1)</script>')).toBe('&lt;script>alert(1)&lt;/script>')
  })

  it('转义带事件处理器的 img', () => {
    expect(escapeRawHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)>')
  })

  it('转义 HTML 注释与 doctype', () => {
    expect(escapeRawHtml('<!-- x -->')).toBe('&lt;!-- x -->')
  })

  it('小于号后面不是标签起始字符时原样保留', () => {
    expect(escapeRawHtml('a < b 且 3<5')).toBe('a < b 且 3<5')
  })

  it('围栏代码块内不动——那是用户在展示代码', () => {
    const md = '正文\n```html\n<div>示例</div>\n```\n结尾'
    expect(escapeRawHtml(md)).toBe(md)
  })

  it('波浪线围栏同样识别', () => {
    const md = '~~~\n<b>x</b>\n~~~'
    expect(escapeRawHtml(md)).toBe(md)
  })

  it('缩进代码块内不动', () => {
    const md = '正文\n\n    <div>示例</div>'
    expect(escapeRawHtml(md)).toBe(md)
  })

  it('行内代码内不动', () => {
    expect(escapeRawHtml('用 `<br>` 换行')).toBe('用 `<br>` 换行')
  })

  it('同一行里代码外的标签仍被转义', () => {
    expect(escapeRawHtml('`<br>` 与 <script>')).toBe('`<br>` 与 &lt;script>')
  })

  it('幂等：重复调用不会二次转义', () => {
    const once = escapeRawHtml('<b>粗</b>')
    expect(escapeRawHtml(once)).toBe(once)
  })

  it('Markdown 语法不受影响', () => {
    const md = '# 标题\n\n- [链接](/x)\n- ![图](/api/images/k.png)\n\n> 引用'
    expect(escapeRawHtml(md)).toBe(md)
  })

  it('空串返回空串', () => {
    expect(escapeRawHtml('')).toBe('')
  })
})
