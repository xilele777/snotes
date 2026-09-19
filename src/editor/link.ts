import { sanitizeLinkHref } from '@milkdown/kit/preset/commonmark'
import type { MarkType } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state'

/** 光标所在的整段链接 */
export interface LinkRange {
  from: number
  to: number
  href: string
  /** 链接显示的文字 */
  text: string
}

/**
 * 把用户输入变成一个可用的地址。
 * - 有协议的走 Milkdown 的白名单（javascript:、data: 会被清成空串，这里就此拒绝）
 * - `/x`、`#x`、`./x`、`../x` 视为站内地址，原样保留
 * - 只打了域名就补 https://，否则浏览器会把 `example.com` 当相对路径
 */
export function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const safe = sanitizeLinkHref(trimmed)
  if (!safe) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(safe)) return safe
  if (/^(?:\/|#|\.{1,2}\/)/.test(safe)) return safe
  return `https://${safe}`
}

/** 外链：真要打开时另开一个标签，站内相对地址则原地跳。 */
export function isExternalHref(href: string): boolean {
  return /^(?:https?|ftp):\/\//i.test(href)
}

/**
 * 找出光标所在的整段链接。相邻的链接文字节点会合并成一段，
 * 所以点链接里的任意位置都能拿到完整范围。算法与 prosemirror-utils 的
 * getMarkRange 一致：先看光标落点的文字节点有没有链接 mark，再向两侧扩张。
 */
export function linkRangeAt(state: EditorState, type: MarkType | undefined = state.schema.marks.link): LinkRange | null {
  if (!type) return null
  const $pos = state.doc.resolve(state.selection.from)
  const start = $pos.parent.childAfter($pos.parentOffset)
  if (!start.node) return null

  const mark = type.isInSet(start.node.marks)
  if (!mark) return null

  let startIndex = $pos.index()
  let from = $pos.start() + start.offset
  while (startIndex > 0 && type.isInSet($pos.parent.child(startIndex - 1).marks)) {
    startIndex -= 1
    from -= $pos.parent.child(startIndex).nodeSize
  }

  let endIndex = $pos.indexAfter()
  let to = from + start.node.nodeSize
  while (endIndex < $pos.parent.childCount && type.isInSet($pos.parent.child(endIndex).marks)) {
    to += $pos.parent.child(endIndex).nodeSize
    endIndex += 1
  }

  return { from, to, href: String(mark.attrs.href ?? ''), text: state.doc.textBetween(from, to, ' ') }
}

/** 写入或改写链接。选区为空且光标不在链接上时，插入文字本身就是链接。 */
export function setLink(state: EditorState, rawHref: string, text = ''): Command | null {
  const href = normalizeHref(rawHref)
  if (!href) return null
  const type = state.schema.marks.link
  if (!type) return null

  return (target, dispatch) => {
    if (!dispatch) return false
    const { from, to, empty } = target.selection
    const existing = empty ? linkRangeAt(target, type) : null
    const range = empty ? (existing ?? { from, to: from }) : { from, to }
    const label = text.trim() || (empty ? (existing?.text ?? href) : target.doc.textBetween(from, to, ' '))
    const mark = type.create({ href })

    // 跨段落替换成单个文字节点是非法的，那种情况只改属性不动文字
    const sameBlock = target.doc.resolve(range.from).parent === target.doc.resolve(range.to).parent
    const tr = target.tr
    if (sameBlock) {
      tr.replaceWith(range.from, range.to, target.schema.text(label, [mark]))
      tr.setSelection(TextSelection.create(tr.doc, range.from + label.length))
    } else {
      tr.removeMark(range.from, range.to, type)
      tr.addMark(range.from, range.to, mark)
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** 去掉链接标记，文字留着。 */
export function unlink(state: EditorState): Command | null {
  const type = state.schema.marks.link
  if (!type) return null

  return (target, dispatch) => {
    if (!dispatch) return false
    const { from, to, empty } = target.selection
    const range = empty ? linkRangeAt(target, type) : { from, to }
    if (!range) return false
    if (range.from === range.to) return false
    if (!target.doc.rangeHasMark(range.from, range.to, type)) return false
    const tr: Transaction = target.tr.removeMark(range.from, range.to, type)
    dispatch(tr.scrollIntoView())
    return true
  }
}

/** 区分站内与站外地址，供「打开」按钮决定怎么开 */
export function openHref(href: string): void {
  if (isExternalHref(href)) window.open(href, '_blank', 'noopener,noreferrer')
  else window.location.href = href
}
