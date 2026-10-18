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

/** Recognize copied Markdown without overriding ordinary rich text or code. */
export function markdownFromClipboard(data: DataTransfer): string | null {
  let text = data.getData('text/plain').replace(/\r\n?/g, '\n')
  const vscode = data.getData('vscode-editor-data')
  if (vscode) {
    try {
      if (!isMarkdownLanguage(JSON.parse(vscode)?.mode)) return null
    } catch {
      return null
    }
  } else {
    const pre = markdownPre(data.getData('text/html'))
    if (!pre) return null
    const code = pre.querySelector('code')
    const language = `${pre.className} ${code?.className ?? ''}`.match(/\blang(?:uage)?-([\w-]+)/i)?.[1]
    if (language && !isMarkdownLanguage(language)) return null
    if (!text) text = (pre.textContent ?? '').replace(/\r\n?/g, '\n')
    if (!isMarkdownLanguage(language) && !looksLikeMarkdownDocument(text)) return null
  }
  if (!text) return null
  return text
}
