import { describe, expect, it } from 'vitest'
import { escapeRawHtml, migrateLegacyBr } from './sanitize'

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

  it('空行用零宽空格承载时 escapeRawHtml 原样保留——不再依赖会被转义的 <br />', () => {
    const md = '第一段\u200B' + '\n\n' + '\u200B' + '\n\n' + '第二段'
    // 零宽空格没有 <，escapeRawHtml 不触碰；空段落靠它保留，不靠 <br />
    expect(escapeRawHtml(md)).toBe(md)
    // 确认旧载体 <br /> 仍会被这道防线转义——我们换的是载体，不是开防线口子
    expect(escapeRawHtml('第一段\n\n<br />\n\n第二段')).toBe('第一段\n\n&lt;br />\n\n第二段')
  })
})

describe('migrateLegacyBr', () => {
  it('把整行 <br /> 占位的历史空行还原成零宽空格空段落', () => {
    expect(migrateLegacyBr('第一段\n\n<br />\n\n第二段')).toBe('第一段\n\n\u200B\n\n第二段')
  })

  it('识别全部 br 变体', () => {
    for (const br of ['<br />', '<br>', '<br >', '<br/>']) {
      expect(migrateLegacyBr('a\n\n' + br + '\n\nb')).toBe('a\n\n\u200B\n\nb')
    }
  })

  it('行内 br 不动——那是用户主动写的原始 HTML', () => {
    expect(migrateLegacyBr('行内<br>换行')).toBe('行内<br>换行')
    expect(migrateLegacyBr('前 <br /> 后')).toBe('前 <br /> 后')
  })

  it('围栏代码块内的 br 不动', () => {
    const md = '```html\n<div><br /></div>\n```\n<br />\n尾'
    expect(migrateLegacyBr(md)).toBe('```html\n<div><br /></div>\n```\n\u200B\n尾')
  })

  it('缩进代码块内的 br 不动', () => {
    const md = '    <br />\n\n<br />\n尾'
    expect(migrateLegacyBr(md)).toBe('    <br />\n\n\u200B\n尾')
  })

  it('行内代码内的 br 不动——那是要展示的内容', () => {
    expect(migrateLegacyBr('看 ``<br>`` 这段')).toBe('看 ``<br>`` 这段')
    expect(migrateLegacyBr('看 `<br>` 这段')).toBe('看 `<br>` 这段')
  })

  it('不含 br 时原样返回', () => {
    expect(migrateLegacyBr('普通笔记\n\n空行')).toBe('普通笔记\n\n空行')
    expect(migrateLegacyBr('')).toBe('')
  })

  it('与 escapeRawHtml 串联：旧数据加载时空行被还原而非留下 &lt;br />', () => {
    const legacy = '第一段\n\n<br />\n\n第二段'
    expect(escapeRawHtml(migrateLegacyBr(legacy))).toBe('第一段\n\n\u200B\n\n第二段')
  })
})
