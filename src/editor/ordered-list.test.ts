import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Editor, editorViewCtx, parserCtx, rootCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { DOMParser } from '@milkdown/kit/prose/model'
import { configureListSerialization, orderedList } from './ordered-list'

describe('有序列表的 HTML 与 Markdown 往返', () => {
  let editor: Editor
  const root = document.createElement('div')

  beforeAll(async () => {
    document.body.append(root)
    editor = await Editor.make()
      .config(configureListSerialization)
      .config(ctx => ctx.set(rootCtx, root))
      .use(commonmark)
      .use(orderedList)
      .create()
  })

  afterAll(async () => {
    await editor?.destroy()
    root.remove()
  })

  it.each([
    ['', 1],
    [' start=""', 1],
    [' start="   "', 1],
    [' start="invalid"', 1],
    [' start="7"', 7],
    [' start="0"', 0],
  ])('解析 <ol%s> 后从 %i 开始，保存后保持编号', (attribute, start) => {
    const content = document.createElement('div')
    content.innerHTML = `<ol${attribute}><li>第一项</li><li>第二项</li></ol>`

    editor.action(ctx => {
      const doc = DOMParser.fromSchema(ctx.get(schemaCtx)).parse(content)
      expect(doc.firstChild?.attrs.order).toBe(start)
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
      const markdown = ctx.get(serializerCtx)(view.state.doc)
      expect(markdown).toMatch(new RegExp(`^${start}\\.\\s+第一项`))
      expect(ctx.get(parserCtx)(markdown).firstChild?.attrs.order).toBe(start)
    })
  })

  it('独立解析嵌套列表的起点，并保留项目内的格式', () => {
    const content = document.createElement('div')
    content.innerHTML = '<ol start=""><li><p><strong>主项</strong></p><ol start="4"><li>子项</li></ol></li><li>第二项</li></ol>'

    editor.action(ctx => {
      const doc = DOMParser.fromSchema(ctx.get(schemaCtx)).parse(content)
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
      const markdown = ctx.get(serializerCtx)(view.state.doc)
      expect(markdown).toMatch(/^1\.\s+\*\*主项\*\*/)
      const restored = ctx.get(parserCtx)(markdown)
      const starts: number[] = []
      restored.descendants(node => {
        if (node.type.name === 'ordered_list') starts.push(node.attrs.order)
      })
      expect(starts, markdown).toEqual([1, 4])
    })
  })
})
