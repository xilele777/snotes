import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { readFormatState, runFormat, type FormatAction } from './format'

/**
 * 手工搭一份与 Milkdown 一致的最小 schema：命令全靠节点名取类型，
 * 不依赖编辑器实例，所以这里能直接对着 EditorState 验行为。
 * 属性形状（heading.level、list_item.checked、code_block.language）必须和预设一致。
 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } }, defining: true },
    blockquote: { content: 'block+', group: 'block', defining: true },
    code_block: { content: 'text*', group: 'block', marks: '', code: true, defining: true, attrs: { language: { default: '' } } },
    bullet_list: { content: 'list_item+', group: 'block', attrs: { spread: { default: false } } },
    ordered_list: { content: 'list_item+', group: 'block', attrs: { order: { default: 1 }, spread: { default: false } } },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      attrs: {
        label: { default: '•' },
        listType: { default: 'bullet' },
        spread: { default: true },
        checked: { default: null },
      },
    },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    emphasis: {},
    strike_through: {},
    inlineCode: { code: true },
    highlight: {},
    link: { attrs: { href: {}, title: { default: null } }, inclusive: false },
  },
})

const paragraph = (text: string, marks: { type: string }[] = []) => ({
  type: 'paragraph',
  // 空文本节点是非法的，空段落只能没有 content
  ...(text ? { content: [{ type: 'text', text, ...(marks.length > 0 ? { marks } : {}) }] } : {}),
})

const item = (text: string) => ({ type: 'list_item', content: [paragraph(text)] })

/** 光标/选区落在指定位置的状态 */
function stateOf(content: unknown[], from: number, to = from): EditorState {
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content }) })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

/** 收集命令派发的事务并依次应用，返回最终状态 */
function run(state: EditorState, action: FormatAction): EditorState {
  const dispatched: ReturnType<EditorState['tr']['setMeta']>[] = []
  runFormat(state, action, (tr) => { dispatched.push(tr) })
  let next = state
  for (const tr of dispatched) next = next.apply(tr)
  return next
}

const shape = (state: EditorState) => state.doc.firstChild!

describe('runFormat 行内标记', () => {
  it('选中文字后加粗，再加一次就取消', () => {
    const state = stateOf([paragraph('加粗这段')], 1, 5)
    const bold = run(state, 'bold')
    expect(bold.doc.rangeHasMark(1, 5, schema.marks.strong)).toBe(true)

    const plain = run(bold, 'bold')
    expect(plain.doc.rangeHasMark(1, 5, schema.marks.strong)).toBe(false)
  })

  it('空选区加粗只记在 storedMarks 上，打字才带上', () => {
    const state = stateOf([paragraph('正文')], 2)
    const bold = run(state, 'bold')
    expect(bold.storedMarks?.some((mark) => mark.type === schema.marks.strong)).toBe(true)
    expect(bold.doc.textContent).toBe('正文')
  })

  it('斜体、删除线、行内代码各自独立', () => {
    const state = stateOf([paragraph('一段话')], 1, 4)
    expect(run(state, 'italic').doc.rangeHasMark(1, 4, schema.marks.emphasis)).toBe(true)
    expect(run(state, 'strike').doc.rangeHasMark(1, 4, schema.marks.strike_through)).toBe(true)
    expect(run(state, 'inlineCode').doc.rangeHasMark(1, 4, schema.marks.inlineCode)).toBe(true)
    expect(run(state, 'highlight').doc.rangeHasMark(1, 4, schema.marks.highlight)).toBe(true)
  })
})

describe('runFormat 块级格式', () => {
  it('标题按级切换，同级再按一次退回正文', () => {
    const state = stateOf([paragraph('标题')], 2)
    const h2 = run(state, 'heading2')
    expect(shape(h2).type).toBe(schema.nodes.heading)
    expect(shape(h2).attrs.level).toBe(2)

    const back = run(h2, 'heading1')
    expect(shape(back).attrs.level).toBe(1)

    const text = run(back, 'heading1')
    expect(shape(text).type).toBe(schema.nodes.paragraph)
  })

  it('无序列表进入与退出', () => {
    const state = stateOf([paragraph('一条')], 2)
    const list = run(state, 'bulletList')
    expect(shape(list).type).toBe(schema.nodes.bullet_list)
    expect(shape(list).firstChild!.type).toBe(schema.nodes.list_item)

    const out = run(list, 'bulletList')
    expect(shape(out).type).toBe(schema.nodes.paragraph)
  })

  it('在无序列表里点有序列表，只换列表种类，条目跟着改属性', () => {
    const state = stateOf([{ type: 'bullet_list', content: [item('甲'), item('乙')] }], 3)
    const ordered = run(state, 'orderedList')
    expect(shape(ordered).type).toBe(schema.nodes.ordered_list)
    const labels: unknown[] = []
    shape(ordered).forEach((node) => labels.push(node.attrs.label))
    expect(labels).toEqual(['1.', '2.'])
  })

  it('待办清单：先变成无序列表，再标成未完成；再点一次退回普通条目', () => {
    const state = stateOf([paragraph('买牛奶')], 2)
    const task = run(state, 'taskList')
    const listItem = shape(task).firstChild!
    expect(shape(task).type).toBe(schema.nodes.bullet_list)
    expect(listItem.attrs.checked).toBe(false)

    const plain = run(task, 'taskList')
    expect(shape(plain).firstChild!.attrs.checked).toBeNull()
  })

  it('引用进入与退出', () => {
    const state = stateOf([paragraph('引用一句')], 2)
    const quoted = run(state, 'quote')
    expect(shape(quoted).type).toBe(schema.nodes.blockquote)

    const out = run(quoted, 'quote')
    expect(shape(out).type).toBe(schema.nodes.paragraph)
  })

  it('代码块进入与退回正文', () => {
    const state = stateOf([paragraph('code')], 2)
    const code = run(state, 'codeBlock')
    expect(shape(code).type).toBe(schema.nodes.code_block)

    const text = run(code, 'codeBlock')
    expect(shape(text).type).toBe(schema.nodes.paragraph)
  })
})

describe('readFormatState 读取光标处的格式', () => {
  it('空文档上是全 false 的空态', () => {
    const state = stateOf([paragraph('')], 1)
    expect(readFormatState(state)).toEqual({
      heading: 0, bold: false, italic: false, strike: false, inlineCode: false, highlight: false, link: false,
      list: null, quote: false, codeBlock: false,
    })
  })

  it('光标在加粗文字里读出 bold，标题读出级别', () => {
    const bold = stateOf([paragraph('加粗', [{ type: 'strong' }])], 2)
    expect(readFormatState(bold).bold).toBe(true)

    const heading = stateOf([{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '小标题' }] }], 2)
    expect(readFormatState(heading).heading).toBe(3)
  })

  it('待办条目读成 task，嵌套列表读最里层的种类', () => {
    const task = stateOf([{ type: 'bullet_list', content: [{ type: 'list_item', attrs: { checked: false }, content: [paragraph('待办')] }] }], 3)
    expect(readFormatState(task).list).toBe('task')

    const nested = stateOf([
      {
        type: 'bullet_list',
        content: [{
          type: 'list_item',
          content: [paragraph('外层'), { type: 'ordered_list', content: [item('内层')] }],
        }],
      },
    ], 9)
    expect(readFormatState(nested).list).toBe('ordered')
  })
})
