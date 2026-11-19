const elements = ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'del', 's', 'mark', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'input', 'sup', 'sub']
const attributes = ['class', 'href', 'src', 'alt', 'title', 'start', 'type', 'checked', 'disabled', 'align']
let sanitizer: Promise<typeof import('dompurify').default> | undefined
export async function renderSafePreview(element: HTMLElement, html: string) {
  if ('setHTML' in Element.prototype) {
    const target = element as HTMLElement & { setHTML(html: string, options: object): void }
    target.setHTML(html, { sanitizer: { elements, attributes } })
  } else {
    sanitizer ??= import('dompurify').then(m => m.default)
    const purify = await sanitizer
    // Insert sanitized nodes, avoiding a second string parse and mutation XSS.
    element.replaceChildren(purify.sanitize(html, {
      ALLOWED_TAGS: [...elements, '#text'], ALLOWED_ATTR: attributes,
      ALLOW_ARIA_ATTR: false, ALLOW_DATA_ATTR: false, KEEP_CONTENT: false,
      RETURN_DOM_FRAGMENT: true,
    }))
  }
  for (const input of element.querySelectorAll('input')) input.disabled = true
  for (const image of element.querySelectorAll('img')) {
    image.loading = 'lazy'
    image.alt ||= '笔记图片'
  }
}
