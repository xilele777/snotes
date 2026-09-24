// 行内代码挖走的占位符起始值。放私有区（U+E000 起）是为了跟正文里常见的
// 字形错开；但私有区字符在特殊字体/粘贴场景并非绝对不可能出现（Bug 6），
// 所以不写死单个哨兵——真正使用的哨兵由 pickMask 按行动态选取。
const MASK_START = ''

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/
const INDENTED_CODE_RE = /^(?: {4,}|\t)/
const INLINE_CODE_RE = /`+[^`]*`+/g

// 优先保留 Markdown 的 URI / 邮箱自动链接。Milkdown 会把同名网址序列化成
// <https://example.com>；只转义它的 < 会让 GFM 把剩下的 > 吞进 href。
// URI 按 CommonMark 排除 ASCII 空白与尖括号；协议安全仍由编辑器白名单负责。
// 其余只转义「像标签起始」的小于号，数学写法 `a < b`、`3<5` 不受影响。
const AUTOLINK_OR_TAG_OPEN_RE = /(<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\u0000-\u0020<>]*>|<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?>)|<(?=[!/?a-zA-Z])/g

// 与 milkdown remarkPreserveEmptyLinePlugin 认定的 br 变体保持一致：
// ``<br />`` ``<br>`` ``<br >`` ``<br/>``。旧版编辑器把空段落序列化成这些
// 字面 HTML 写进 markdown，加载时会被 escapeRawHtml 转成 ``&lt;br />`` 字面
// 文本。迁移只把「整行只有 br 变体」的历史行还原成零宽空格空段落，让旧笔记
// 重新打开时空行视觉跟新版一致；行内 br 与代码块内的 br 不动——前者是用户
// 主动写的原始 HTML，后者是要展示的内容。
const BR_VARIANTS = ['<br />', '<br>', '<br >', '<br/>']
const BR_LINE_RE = /^\s*(?:<br \/>|<br>|<br >|<br\/>)\s*$/

/**
 * 为单行正文选一个绝不在该行出现的哨兵字符。
 * 固定哨兵（哪怕放在私有区）有个隐患：用户粘贴的文本可能天然带进来——
 * 若正文恰好含 ``U+E000 数字 U+E000`` 形态的片段，还原时会误命中、把错误的
 * 跨度还原回去。以「输入里没有」为硬约束逐个抬高候选，哨兵不可能与正文撞车。
 */
function pickMask(line: string): string {
  let code = MASK_START.charCodeAt(0)
  let mask = MASK_START
  while (line.includes(mask)) {
    code += 1
    mask = String.fromCharCode(code)
  }
  return mask
}

interface InlineCode {
  /** 行内代码被哨兵占位后的行，可安全做 HTML 转义而不波及代码内容 */
  masked: string
  /** 占位时挖走的原始代码跨度，按下标对应 */
  spans: string[]
  /** 该行选用的哨兵，保证不在原行里出现 */
  mask: string
}

/** 挖走行内代码跨度，返回占位后的行与还原所需信息。 */
function takeInlineCode(line: string): InlineCode {
  const spans: string[] = []
  const mask = pickMask(line)
  const masked = line.replace(INLINE_CODE_RE, (m) => {
    spans.push(m)
    return `${mask}${spans.length - 1}${mask}`
  })
  return { masked, spans, mask }
}

/**
 * 把占位过的行还原回原始行内代码。
 * 哨兵在整行里只出现在占位位置，因此 split 出来的偶数段是正文、奇数段是跨度下标，
 * 按位回填即可——不拼正则，也无需担心下标外的字符被误当跨度。
 */
function restoreInlineCode(masked: string, code: InlineCode): string {
  const parts = masked.split(code.mask)
  return parts.map((part, idx) => (idx % 2 === 1 ? code.spans[Number(part)] : part)).join('')
}

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

      const code = takeInlineCode(line)
      return restoreInlineCode(code.masked.replace(AUTOLINK_OR_TAG_OPEN_RE, (_match, autolink: string | undefined) => autolink ?? '&lt;'), code)
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
      const code = takeInlineCode(line)
      if (BR_LINE_RE.test(restoreInlineCode(code.masked, code))) return '​'

      return line
    })
    .join('\n')
}
