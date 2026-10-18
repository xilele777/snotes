import type { Ctx } from '@milkdown/kit/ctx'
import { parserCtx } from '@milkdown/kit/core'
import { Slice } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { escapeRawHtml } from '../../shared/sanitize'

import { markdownFromClipboard } from './markdown-clipboard'

const isMarkdownLanguage = (language: unknown) =>
  typeof language === 'string' && /^(markdown|md)$/i.test(language)

function looksLikeMarkdownDocument(text: string): boolean {
  return /^\s{0,3}#\s+\S[^\n]*\n\s*\n/.test(text.trimStart())
    && /^ {0,3}#{2,6}\s+\S/m.test(text)
}

/** 在 Milkdown 的「VS Code 内容一律转代码块」分支之前处理 Markdown。 */
export function handleMarkdownPaste(ctx: Ctx, view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData
  if (!view.editable || !data || view.state.selection.$from.parent.type.spec.code) return false
  const text = markdownFromClipboard(data)
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
