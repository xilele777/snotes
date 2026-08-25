// 行内代码挖走时用的占位符。
// 理想是 U+0000（NUL），它不会出现在正常的笔记正文里；即便出现，最坏结果也只是
// 那一处占位还原失败，不会造成 HTML 逃逸。但源码里混入字面 NUL 字节既不可见
// 也容易被编辑器/工具链误处理，因此用等价的转义序列 ''（私有区，同样不会
// 出现在正常笔记里），语义与可读性兼顾。
const MASK = ''

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const INDENTED_CODE_RE = /^(?: {4,}|\t)/
const INLINE_CODE_RE = /`+[^`]*`+/g

// 只转义「像标签起始」的小于号：后面紧跟字母、/、!、? 才算。
// 这样 `a < b`、`3<5` 这类数学写法不受影响。
const TAG_OPEN_RE = /<(?=[!/?a-zA-Z])/g

// 与 milkdown remarkPreserveEmptyLinePlugin 认定的 br 变体保持一致：
// ``<br />`` ``<br>`` ``<br >`` ``<br/>``。旧版编辑器把空段落序列化成这些
// 字面 HTML 写进 markdown，加载时会被 escapeRawHtml 转成 ``&lt;br />`` 字面
// 文本。迁移只把「整行只有 br 变体」的历史行还原成零宽空格空段落，让旧笔记
// 重新打开时空行视觉跟新版一致；行内 br 与代码块内的 br 不动——前者是用户
// 主动写的原始 HTML，后者是要展示的内容。
const BR_VARIANTS = ['<br />', '<br>', '<br >', '<br/>']
const BR_LINE_RE = /^\s*(?:<br \/>|<br>|<br >|<br\/>)\s*$/

/**
 * 把 Markdown 里的原始 HTML 降级为纯文本（规格 §11.2）。
 * 只动 `<`——没有 `<` 就构不成标签，`>` 留着可读性更好。
 * 围栏代码块、缩进代码块、行内代码一律跳过：那里的 HTML 是用户想展示的内容。
 */
export function escapeRawHtml(md: string): string {
  if (!md) return md

  let inFence = false
  let fenceChar = ''

  return md
    .split('\n')
    .map((line) => {
      const fence = line.match(FENCE_RE)

      if (fence) {
        const char = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceChar = char
        } else if (char === fenceChar) {
          inFence = false
          fenceChar = ''
        }
        return line
      }

      if (inFence || INDENTED_CODE_RE.test(line)) return line

      const spans: string[] = []
      const masked = line.replace(INLINE_CODE_RE, (m) => {
        spans.push(m)
        return `${MASK}${spans.length - 1}${MASK}`
      })

      return masked
        .replace(TAG_OPEN_RE, '&lt;')
        .replace(new RegExp(`${MASK}(\\d+)${MASK}`, 'g'), (_, i: string) => spans[Number(i)])
    })
    .join('\n')
}

/**
 * 把历史版本用 ``<br />`` 占位的空行迁移成零宽空格空段落。
 * 必须在 escapeRawHtml 之前调用——后者会把 ``<`` 转成 ``&lt;``，转完就抓不回 br 了。
 * 围栏代码块、缩进代码块、行内代码内的 br 一律跳过：那是用户要展示的内容。
 */
export function migrateLegacyBr(md: string): string {
  if (!md || !BR_VARIANTS.some((v) => md.includes(v))) return md

  let inFence = false
  let fenceChar = ''

  return md
    .split('\n')
    .map((line) => {
      const fence = line.match(FENCE_RE)

      if (fence) {
        const char = fence[1][0]
        if (!inFence) {
          inFence = true
          fenceChar = char
        } else if (char === fenceChar) {
          inFence = false
          fenceChar = ''
        }
        return line
      }

      if (inFence || INDENTED_CODE_RE.test(line)) return line

      // 行内代码挖走再判，避免 ``<br>`` 被误当空行占位
      const spans: string[] = []
      const masked = line.replace(INLINE_CODE_RE, (m) => {
        spans.push(m)
        return `${MASK}${spans.length - 1}${MASK}`
      })

      const restored = masked.replace(new RegExp(`${MASK}(\d+)${MASK}`, "g"), (_, i: string) => spans[Number(i)])
      if (BR_LINE_RE.test(restored)) return '\u200B'

      return line
    })
    .join('\n')
}
