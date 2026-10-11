import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Editor, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { undo, redo } from '@milkdown/kit/prose/history'
import { DOMParser, Slice } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { replaceAll } from '@milkdown/kit/utils'
import { handleMarkdownPaste, unwrapMarkdownCodeBlock } from './markdown-paste'

const markdown = '# Markflow｜技术讲解\n\n整理日期与 **重点**。\n\n## 实现机制\n\n> 项目介绍\n\n| 名称 | 作用 |\n| --- | --- |\n| Outbox | 投递 |\n\n```mermaid\nflowchart LR\n    A --> B\n```'
const preHtml = (text: string, language = '') => `<div><pre><code class="${language ? `language-${language}` : ''}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre></div>`

describe('Markdown 粘贴与代码块恢复', () => {
  let editor: Editor
  const root = document.createElement('div')

  beforeAll(async () => {
    document.body.append(root)
    editor = await Editor.make()
      .config(ctx => {
        ctx.set(rootCtx, root)
        ctx.update(editorViewOptionsCtx, options => ({
          ...options,
          handlePaste: (view, event) => handleMarkdownPaste(ctx, view, event),
        }))
      })
      .use(commonmark).use(gfm).use(clipboard).use(history).create()
  })
  beforeEach(() => editor.action(replaceAll('', true)))
  afterAll(async () => { await editor?.destroy(); root.remove() })

  function paste(data: Record<string, string>) {
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const event = { clipboardData: { getData: (type: string) => data[type] ?? '' } } as ClipboardEvent
      const template = document.createElement('template')
      template.innerHTML = data['text/html'] ?? ''
      const slice = data['text/html'] ? DOMParser.fromSchema(view.state.schema).parseSlice(template.content) : Slice.empty
      view.someProp('handlePaste', handler => handler(view, event, slice))
    })
  }

  function expectRendered() {
    expect(root.querySelector('h1')?.textContent).toBe('Markflow｜技术讲解')
    expect(root.querySelector('h2')?.textContent).toBe('实现机制')
    expect(root.querySelector('strong')?.textContent).toBe('重点')
    expect(root.querySelectorAll('table')).toHaveLength(1)
    expect(root.querySelectorAll('pre')).toHaveLength(1)
    expect(root.querySelector('pre')?.textContent).toBe('flowchart LR\n    A --> B')
  }

  it('VS Code 的 Markdown 即使带有 pre 富文本也解析为正文，并支持撤销重做', () => {
    paste({ 'text/plain': markdown.replace(/\n/g, '\r\n'), 'text/html': preHtml(markdown), 'vscode-editor-data': JSON.stringify({ mode: 'markdown' }) })
    expectRendered()
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.textContent).toBe('')
      expect(redo(view.state, view.dispatch)).toBe(true)
      const serialized = ctx.get(serializerCtx)(view.state.doc)
      expect(ctx.get(parserCtx)(serialized).firstChild?.type.name).toBe('heading')
    })
    expectRendered()
  })

  it('单一 pre 包装的整篇 Markdown 按正文解析', () => {
    paste({ 'text/plain': markdown, 'text/html': preHtml(markdown) })
    expectRendered()
  })

  it('只有 HTML 的明确 Markdown 代码块也能解析', () => {
    paste({ 'text/html': preHtml(markdown, 'markdown') })
    expectRendered()
  })

  it('VS Code 的真正源码继续保留为代码块', () => {
    paste({ 'text/plain': 'const value = 1', 'vscode-editor-data': JSON.stringify({ mode: 'typescript' }) })
    expect(root.querySelector('pre')?.textContent).toBe('const value = 1')
    expect(root.querySelector('h1')).toBeNull()
  })

  it('明确标注其它语言的代码和包含额外正文的富文本保持原格式', () => {
    paste({ 'text/plain': markdown, 'text/html': preHtml(markdown, 'python') })
    expect(root.querySelector('pre')?.textContent).toBe(markdown)
    editor.action(replaceAll(''))
    paste({ 'text/plain': markdown, 'text/html': `<p>说明</p>${preHtml(markdown)}` })
    expect(root.querySelector('p')?.textContent).toBe('说明')
    expect(root.querySelector('pre')?.textContent).toBe(markdown)
  })

  it('在现有代码块内粘贴 Markdown 时继续保留字面文本', () => {
    editor.action(replaceAll('```js\nconst x = 1\n```'))
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
      const event = { clipboardData: { getData: () => markdown } } as unknown as ClipboardEvent
      expect(handleMarkdownPaste(ctx, view, event)).toBe(false)
    })
  })

  it('退出历史 Markdown 代码块时恢复标题、表格和内层代码块，可撤销', () => {
    editor.action(replaceAll(`\`\`\`\`markdown\n${markdown}\n\`\`\`\``, true))
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
      expect(unwrapMarkdownCodeBlock(ctx, view)).toBe(true)
    })
    expectRendered()
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.firstChild?.type.name).toBe('code_block')
      expect(view.state.doc.firstChild?.textContent).toBe(markdown)
    })
  })

  it('无法识别 VS Code 语言信息时不接管粘贴', () => {
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const data: Record<string, string> = { 'text/plain': markdown, 'vscode-editor-data': '{' }
      const event = { clipboardData: { getData: (type: string) => data[type] ?? '' } } as ClipboardEvent
      expect(handleMarkdownPaste(ctx, view, event)).toBe(false)
    })
  })

  it('退出明确标注为其它语言的代码块时不把代码当 Markdown', () => {
    editor.action(replaceAll(`\`\`\`\`python\n${markdown}\n\`\`\`\``, true))
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
      expect(unwrapMarkdownCodeBlock(ctx, view)).toBe(false)
    })
  })

  it('只替换选区并转义正文原始 HTML，保留前后的内容', () => {
    editor.action(replaceAll('前文\n\n待替换\n\n后文', true))
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 8)))
    })
    paste({ 'text/plain': '# 标题\n\n<script>alert(1)</script>', 'vscode-editor-data': JSON.stringify({ mode: 'markdown' }) })
    expect(root.textContent).toContain('前文')
    expect(root.textContent).toContain('后文')
    expect(root.textContent).toContain('<script>alert(1)</script>')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('h1')?.textContent).toBe('标题')
  })
})
