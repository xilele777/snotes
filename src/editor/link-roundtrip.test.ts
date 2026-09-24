import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Editor, parserCtx, rootCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node } from '@milkdown/kit/prose/model'
import { DOMSerializer } from '@milkdown/kit/prose/model'
import { escapeRawHtml } from '../../shared/sanitize'

describe('链接保存后重新加载', () => {
  let editor: Editor
  const root = document.createElement('div')

  beforeAll(async () => {
    document.body.append(root)
    editor = await Editor.make()
      .config(ctx => ctx.set(rootCtx, root))
      .use(commonmark)
      .use(gfm)
      .create()
  })

  afterAll(async () => {
    await editor?.destroy()
    root.remove()
  })

  function hrefs(doc: Node) {
    const result: string[] = []
    doc.descendants(node => {
      for (const mark of node.marks) {
        if (mark.type.name === 'link') result.push(mark.attrs.href)
      }
    })
    return result
  }

  it.each([
    ['<https://anyrouter.top>', 'https://anyrouter.top'],
    ['[https://anyrouter.top](https://anyrouter.top)', 'https://anyrouter.top'],
    ['[https://anyrouter.top\u00a0](https://anyrouter.top\u00a0)', 'https://anyrouter.top\u00a0'],
    ['<hello@example.com>', 'mailto:hello@example.com'],
    ['<https://example.com/%3E>', 'https://example.com/%3E'],
  ])('多次保存和加载 %s 不改变链接地址', (markdown, href) => {
    editor.action(ctx => {
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      for (let i = 0; i < 3; i++) {
        const doc = parse(escapeRawHtml(markdown))
        expect(hrefs(doc)).toEqual([href])
        const dom = DOMSerializer.fromSchema(ctx.get(schemaCtx)).serializeFragment(doc.content)
        expect(dom.querySelector('a')?.getAttribute('href')).toBe(href.trim())
        markdown = serialize(doc)
      }
    })
  })

  it('自动链接中的危险协议仍不能变成可执行的地址', () => {
    editor.action(ctx => {
      const doc = ctx.get(parserCtx)(escapeRawHtml('<javascript:alert(1)>'))
      const dom = DOMSerializer.fromSchema(ctx.get(schemaCtx)).serializeFragment(doc.content)
      expect(dom.querySelector('a')?.getAttribute('href')).toBe('')
    })
  })

  it('工具栏插入的同名网址经序列化后重开不多出 >', () => {
    editor.action(ctx => {
      const schema = ctx.get(schemaCtx)
      const href = 'https://anyrouter.top'
      const doc = schema.node('doc', null, [
        schema.node('paragraph', null, schema.text(href, [schema.marks.link.create({ href })])),
      ])
      const markdown = ctx.get(serializerCtx)(doc)
      const restored = ctx.get(parserCtx)(escapeRawHtml(markdown))
      expect(hrefs(restored)).toEqual([href])
      expect(restored.textContent).toBe(href)
    })
  })
})
