import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/kit/prose/commands'
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state'
import type { MarkType, Node, NodeType } from '@milkdown/kit/prose/model'
import { liftListItem, wrapInList } from '@milkdown/kit/prose/schema-list'

/**
 * 编辑工具栏的动作。每一项都能「按一下切换」——已经在目标格式上就退回上一态，
 * 与顶栏的星标/置顶是同一套心智，用户不需要先想「怎么取消」。
 */
export type FormatAction =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'highlight'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock'

/** 光标处所在的清单种类，用来点亮工具栏按钮 */
export type ListKind = 'bullet' | 'ordered' | 'task'

export interface FormatState {
  /** 0 = 正文 */
  heading: 0 | 1 | 2 | 3
  bold: boolean
  italic: boolean
  strike: boolean
  inlineCode: boolean
  highlight: boolean
  link: boolean
  list: ListKind | null
  quote: boolean
  codeBlock: boolean
}

export const EMPTY_FORMAT_STATE: FormatState = {
  heading: 0,
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  highlight: false,
  link: false,
  list: null,
  quote: false,
  codeBlock: false,
}

/** Mark 名与工具栏按钮的对应关系。按名字取，测试里换一套 schema 也能跑。 */
const MARK_NAMES = {
  bold: 'strong',
  italic: 'emphasis',
  strike: 'strike_through',
  inlineCode: 'inlineCode',
  highlight: 'highlight',
  link: 'link',
} as const

export const HEADING_LEVELS: Record<'heading1' | 'heading2' | 'heading3', 1 | 2 | 3> = {
  heading1: 1,
  heading2: 2,
  heading3: 3,
}

/** 光标是否落在给定 mark 上。空选区还要看 storedMarks——刚点完加粗还没打字时也该亮着。 */
function markActive(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false
  const { selection, storedMarks } = state
  if (!selection.empty) return state.doc.rangeHasMark(selection.from, selection.to, type)
  return Boolean(type.isInSet(storedMarks ?? selection.$from.marks()))
}

/** 从光标所在深度往上找第一个满足条件的祖先，找不到返回 null。 */
function findAncestor(state: EditorState, match: (node: Node) => boolean): { node: Node; pos: number } | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (match(node)) return { node, pos: $from.before(depth) }
  }
  return null
}

/** 读取光标处的格式，供工具栏点亮按钮。 */
export function readFormatState(state: EditorState): FormatState {
  const { schema } = state
  let heading: 0 | 1 | 2 | 3 = 0
  let list: ListKind | null = null
  let quote = false
  let codeBlock = false

  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    const name = node.type.name
    // 清单种类看所属的列表节点本身，而不是条目上的 listType 属性：
    // 新建的条目带的是默认属性，跟外面那层的列表可能不一致。
    // 嵌套清单由最里层决定，所以第一层 list_item 就定案。
    if (name === 'list_item') {
      const parent = $from.node(depth - 1)
      list = node.attrs.checked == null
        ? (parent.type.name === 'ordered_list' ? 'ordered' : 'bullet')
        : 'task'
      break
    }
    if (name === 'heading' && heading === 0) {
      const level = Number(node.attrs.level)
      heading = level === 1 || level === 2 || level === 3 ? level : 0
    } else if (name === 'blockquote') {
      quote = true
    } else if (name === 'code_block') {
      codeBlock = true
    }
  }

  return {
    heading,
    bold: markActive(state, schema.marks[MARK_NAMES.bold]),
    italic: markActive(state, schema.marks[MARK_NAMES.italic]),
    strike: markActive(state, schema.marks[MARK_NAMES.strike]),
    inlineCode: markActive(state, schema.marks[MARK_NAMES.inlineCode]),
    highlight: markActive(state, schema.marks[MARK_NAMES.highlight]),
    link: markActive(state, schema.marks[MARK_NAMES.link]),
    list,
    quote,
    codeBlock,
  }
}

/** 已经在同级标题上就退回正文，否则切到该级标题。 */
function headingCommand(level: 1 | 2 | 3): Command {
  return (state, dispatch, view) => {
    const heading = state.schema.nodes.heading
    const paragraph = state.schema.nodes.paragraph
    if (!heading || !paragraph) return false
    const parent = state.selection.$from.parent
    if (parent.type === heading && Number(parent.attrs.level) === level) {
      return setBlockType(paragraph)(state, dispatch, view)
    }
    return setBlockType(heading, { level })(state, dispatch, view)
  }
}

function markCommand(type: MarkType | undefined): Command | null {
  return type ? toggleMark(type) : null
}

/** 换列表种类时同步条目的 label / listType，DOM 上的 data-list-type 才不会和实际列表对不上。 */
function restyleItems(tr: Transaction, listPos: number, list: Node, kind: 'bullet' | 'ordered'): Transaction {
  let next = tr
  // 第二个参数是内容偏移而不是序号，序号在第三个参数上
  list.forEach((item, offset, index) => {
    next = next.setNodeMarkup(listPos + 1 + offset, undefined, {
      ...item.attrs,
      label: kind === 'ordered' ? `${index + 1}.` : '•',
      listType: kind,
    })
  })
  return next
}

/** 已在同类清单里就退出清单，在另一种清单里就换种类，否则把当前块包进清单。 */
function listCommand(kind: 'bullet' | 'ordered'): Command {
  return (state, dispatch, view) => {
    const bullet = state.schema.nodes.bullet_list
    const ordered = state.schema.nodes.ordered_list
    const item = state.schema.nodes.list_item
    const listType = kind === 'bullet' ? bullet : ordered
    if (!listType || !item) return false

    const found = findAncestor(state, (node) => node.type === bullet || node.type === ordered)
    if (!found) return wrapInList(listType)(state, dispatch, view)
    if (found.node.type === listType) return liftListItem(item)(state, dispatch, view)
    if (!dispatch) return true

    dispatch(restyleItems(state.tr.setNodeMarkup(found.pos, listType), found.pos, found.node, kind))
    return true
  }
}

/** 选区覆盖到的清单条目位置；光标折叠时就是所在的那一个。 */
function coveredItems(state: EditorState, item: NodeType): number[] {
  const { from, to, empty } = state.selection
  if (empty) {
    const found = findAncestor(state, (node) => node.type === item)
    return found ? [found.pos] : []
  }
  const positions: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== item) return true
    positions.push(pos)
    // 不再往里钻：嵌套清单的子条目不能跟着一起被标记
    return false
  })
  return positions
}

/** 在给定状态上翻转条目的清单属性：普通条目 → 待办，待办 → 普通。 */
function toggleTaskItems(state: EditorState, item: NodeType): Transaction | null {
  const positions = coveredItems(state, item)
  if (positions.length === 0) return null
  const first = state.doc.nodeAt(positions[0])
  if (!first) return null
  const checked = first.attrs.checked == null ? false : null

  let tr = state.tr
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
  }
  return tr
}

function taskListCommand(): Command {
  return (state, dispatch, view) => {
    const bullet = state.schema.nodes.bullet_list
    const item = state.schema.nodes.list_item
    // 没有 GFM 扩展时 list_item 没有 checked 属性，这时不能假装能标待办
    if (!bullet || !item || !item.spec.attrs?.['checked']) return false

    if (findAncestor(state, (node) => node.type === item)) {
      if (!dispatch) return true
      const tr = toggleTaskItems(state, item)
      if (!tr) return false
      dispatch(tr)
      return true
    }

    // 不在清单里：先包成无序清单，再在新的状态上标成待办——
    // 包完之后条目的位置才定得下来，所以要分两次派发
    let wrapped: Transaction | null = null
    if (!wrapInList(bullet)(state, (tr) => { wrapped = tr }, view)) return false
    if (!dispatch || !wrapped) return true

    const wrappedTransaction = wrapped
    const next = state.apply(wrappedTransaction)
    const tr = toggleTaskItems(next, item)
    if (!tr) return false
    dispatch(wrappedTransaction)
    dispatch(tr)
    return true
  }
}

function quoteCommand(): Command {
  return (state, dispatch, view) => {
    const quote = state.schema.nodes.blockquote
    if (!quote) return false
    if (findAncestor(state, (node) => node.type === quote)) return lift(state, dispatch, view)
    return wrapIn(quote)(state, dispatch, view)
  }
}

function codeBlockCommand(): Command {
  return (state, dispatch, view) => {
    const code = state.schema.nodes.code_block
    const paragraph = state.schema.nodes.paragraph
    if (!code || !paragraph) return false
    if (state.selection.$from.parent.type === code) return setBlockType(paragraph)(state, dispatch, view)
    return setBlockType(code)(state, dispatch, view)
  }
}

/** 把动作翻译成 ProseMirror 命令；schema 里没有对应节点时返回 null。 */
export function formatCommand(state: EditorState, action: FormatAction): Command | null {
  const marks = state.schema.marks
  switch (action) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return headingCommand(HEADING_LEVELS[action])
    case 'bold':
      return markCommand(marks[MARK_NAMES.bold])
    case 'italic':
      return markCommand(marks[MARK_NAMES.italic])
    case 'strike':
      return markCommand(marks[MARK_NAMES.strike])
    case 'inlineCode':
      return markCommand(marks[MARK_NAMES.inlineCode])
    case 'highlight':
      return markCommand(marks[MARK_NAMES.highlight])
    case 'bulletList':
      return listCommand('bullet')
    case 'orderedList':
      return listCommand('ordered')
    case 'taskList':
      return taskListCommand()
    case 'quote':
      return quoteCommand()
    case 'codeBlock':
      return codeBlockCommand()
  }
}

/**
 * 执行一个格式动作。表格不在其中：插入表格的命令由 Milkdown 的表格预设提供，
 * 依赖编辑器上下文与表格 schema，由 MilkdownEditor 直接走命令总线。
 */
export function runFormat(state: EditorState, action: FormatAction, dispatch: (tr: Transaction) => void): boolean {
  const command = formatCommand(state, action)
  if (!command) return false
  return command(state, dispatch)
}
