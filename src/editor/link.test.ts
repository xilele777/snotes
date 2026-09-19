import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { isExternalHref, linkRangeAt, normalizeHref, setLink, unlink } from './link'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
    link: { attrs: { href: {}, title: { default: null } }, inclusive: false },
  },
})

/** 一段文字，可带链接 mark */
function stateOf(content: { text: string; href?: string }[], from: number, to = from): EditorState {
  // 空文字节点不合法，空段落只能不带 content
  const nodes = content
    .filter((piece) => piece.text !== '')
    .map((piece) => ({
      type: 'text',
      text: piece.text,
      ...(piece.href ? { marks: [{ type: 'link', attrs: { href: piece.href } }] } : {}),
    }))
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] }),
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

function run(state: EditorState, command: ReturnType<typeof setLink> | ReturnType<typeof unlink>): EditorState {
  if (!command) throw new Error('命令为空')
  let next = state
  command(state, (tr) => { next = state.apply(tr) })
  return next
}

const linkHref = (state: EditorState, from: number, to: number): string | null => {
  const mark = state.doc.nodeAt(from)?.marks.find((m) => m.type.name === 'link')
  void to
  return (mark?.attrs.href as string | undefined) ?? null
}

describe('normalizeHref', () => {
  it('没写协议时补 https，站内地址原样保留', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com')
    expect(normalizeHref('  https://a.cn/x?y=1  ')).toBe('https://a.cn/x?y=1')
    expect(normalizeHref('/notes/1')).toBe('/notes/1')
    expect(normalizeHref('#小节')).toBe('#小节')
    expect(normalizeHref('./a.md')).toBe('./a.md')
    expect(normalizeHref('../a.md')).toBe('../a.md')
  })

  it('mailto / tel 放行，可执行的协议与空串拒绝', () => {
    expect(normalizeHref('mailto:a@b.cn')).toBe('mailto:a@b.cn')
    expect(normalizeHref('tel:10086')).toBe('tel:10086')
    expect(normalizeHref('javascript:alert(1)')).toBeNull()
    expect(normalizeHref('data:text/html,<script>')).toBeNull()
    // 伪装的协议同样拦得住：浏览器解析时会忽略制表符
    expect(normalizeHref('java\tscript:alert(1)')).toBeNull()
    expect(normalizeHref('   ')).toBeNull()
  })
})

describe('isExternalHref', () => {
  it('区分外链与站内相对地址', () => {
    expect(isExternalHref('https://a.cn')).toBe(true)
    expect(isExternalHref('http://a.cn')).toBe(true)
    expect(isExternalHref('/notes/1')).toBe(false)
    expect(isExternalHref('mailto:a@b.cn')).toBe(false)
  })
})

describe('linkRangeAt', () => {
  it('点在链接中间也能拿到整段链接', () => {
    const state = stateOf([{ text: '看这里', href: 'https://a.cn' }, { text: '后面' }], 2)
    expect(linkRangeAt(state)).toEqual({ from: 1, to: 4, href: 'https://a.cn', text: '看这里' })
  })

  it('不在链接上返回 null', () => {
    const state = stateOf([{ text: '普通文字' }], 2)
    expect(linkRangeAt(state)).toBeNull()
  })
})

describe('setLink / unlink', () => {
  it('选中文字插入链接，文字内容不变', () => {
    const state = stateOf([{ text: '点我' }], 1, 3)
    const next = run(state, setLink(state, 'a.cn'))
    expect(next.doc.textContent).toBe('点我')
    expect(linkHref(next, 1, 3)).toBe('https://a.cn')
  })

  it('空选区插入链接：文字用地址本身', () => {
    const state = stateOf([{ text: '' }], 1)
    const next = run(state, setLink(state, 'https://a.cn'))
    expect(next.doc.textContent).toBe('https://a.cn')
    expect(next.doc.rangeHasMark(1, 12, schema.marks.link)).toBe(true)
  })

  it('空选区指定文字时按给定文字插入', () => {
    const state = stateOf([{ text: '' }], 1)
    const next = run(state, setLink(state, 'a.cn', '参考资料'))
    expect(next.doc.textContent).toBe('参考资料')
  })

  it('改写已有链接只换地址，文字留着', () => {
    const state = stateOf([{ text: '旧链接', href: 'https://old.cn' }], 2)
    const next = run(state, setLink(state, 'new.cn'))
    expect(next.doc.textContent).toBe('旧链接')
    expect(linkHref(next, 1, 4)).toBe('https://new.cn')
  })

  it('地址不合法时返回空命令，不动文档', () => {
    const state = stateOf([{ text: '文字' }], 1, 3)
    expect(setLink(state, 'javascript:alert(1)')).toBeNull()
  })

  it('去掉链接后文字还在', () => {
    const state = stateOf([{ text: '带链接', href: 'https://a.cn' }], 2)
    const next = run(state, unlink(state))
    expect(next.doc.textContent).toBe('带链接')
    expect(linkHref(next, 1, 4)).toBeNull()
  })

  it('不在链接上时移除没有效果', () => {
    const state = stateOf([{ text: '普通' }], 2)
    expect(run(state, unlink(state)).doc.textContent).toBe('普通')
  })
})
