import type { Ctx } from '@milkdown/kit/ctx'
import { parserCtx } from '@milkdown/kit/core'
import { Slice } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { escapeRawHtml } from '../../shared/sanitize'

const isMarkdownLanguage = (language: unknown) =>
  typeof language === 'string' && /^(markdown|md)$/i.test(language)

/** 无语言信息时，只识别有主标题、空行和章节标题的整篇 Markdown。 */
function looksLikeMarkdownDocument(text: string): boolean {
  return /^\s{0,3}#\s+\S[^\n]*\n\s*\n/.test(text.trimStart())
    && /^ {0,3}#{2,6}\s+\S/m.test(text)
}

/** 仅接受一个 pre 及其 div 包装，不能丢掉同次复制的其它富文本。 */
function markdownPre(html: string): HTMLPreElement | null {
  const template = document.createElement('template')
  template.innerHTML = html
  let parent: ParentNode = template.content
  for (;;) {
    const children = Array.from(parent.childNodes).filter(node =>
      node.nodeType !== Node.COMMENT_NODE
      && !(node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()))
    if (children.length !== 1) return null
    const child = children[0]
    if (!(child instanceof HTMLElement)) return null
    if (child.tagName === 'PRE') return child as HTMLPreElement
    if (child.tagName !== 'DIV') return null
    parent = child
  }
}

/** 在 Milkdown 的「VS Code 内容一律转代码块」分支之前处理 Markdown。 */
export function handleMarkdownPaste(ctx: Ctx, view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData
  if (!view.editable || !data || view.state.selection.$from.parent.type.spec.code) return false
  let text = data.getData('text/plain').replace(/\r\n?/g, '\n')
  const vscode = data.getData('vscode-editor-data')
  if (vscode) {
    try {
      if (!isMarkdownLanguage(JSON.parse(vscode)?.mode)) return false
    } catch {
      return false
    }
  } else {
    const pre = markdownPre(data.getData('text/html'))
    if (!pre) return false
    const code = pre.querySelector('code')
    const language = `${pre.className} ${code?.className ?? ''}`.match(/\blang(?:uage)?-([\w-]+)/i)?.[1]
    if (language && !isMarkdownLanguage(language)) return false
    if (!text) text = (pre.textContent ?? '').replace(/\r\n?/g, '\n')
    if (!isMarkdownLanguage(language) && !looksLikeMarkdownDocument(text)) return false
  }
  if (!text) return false
  const doc = ctx.get(parserCtx)(escapeRawHtml(text))
  view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView()
    .setMeta('paste', true).setMeta('uiEvent', 'paste'))
  return true
}

/** 退出误粘贴的 Markdown 代码块时重新解析正文，而非只去掉等宽样式。 */
export function unwrapMarkdownCodeBlock(ctx: Ctx, view: EditorView): boolean {
  const { $from, $to } = view.state.selection
  const node = $from.parent
  if (node.type.name !== 'code_block' || !$from.sameParent($to)) return false
  if (node.attrs.language && !isMarkdownLanguage(node.attrs.language)) return false
  if (!isMarkdownLanguage(node.attrs.language) && !looksLikeMarkdownDocument(node.textContent)) return false
  const doc = ctx.get(parserCtx)(escapeRawHtml(node.textContent))
  view.dispatch(view.state.tr.replaceWith($from.before(), $from.after(), doc.content).scrollIntoView())
  return true
}
