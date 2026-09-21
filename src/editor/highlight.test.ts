import { describe, expect, it } from 'vitest'
import { remark } from 'remark'
import { remarkHighlight, HIGHLIGHT_INPUT_RULE } from './highlight'

const processor = remark().use(remarkHighlight)

function parse(md: string) {
  return processor.runSync(processor.parse(md), md)
}

function roundTrip(md: string): string {
  return processor.stringify(parse(md) as never).replace(/\n$/, '')
}

describe('remarkHighlight 解析', () => {
  it('==文字== 解析成 highlight 节点，其余文本原样', () => {
    const tree = parse('前 ==重点== 后') as unknown as { children: { children: { type: string; value?: string; children?: { value: string }[] }[] }[] }
    const inline = tree.children[0].children
    expect(inline.map((n) => n.type)).toEqual(['text', 'highlight', 'text'])
    expect(inline[1].children?.[0].value).toBe('重点')
    expect(inline[0].value).toBe('前 ')
  })

  it('单个 = 或空的 ==== 不当成高亮', () => {
    for (const md of ['a = b', 'a == b', '====', '==  =='] ) {
      const tree = parse(md) as unknown as { children: { children: { type: string }[] }[] }
      expect(tree.children[0].children.every((n) => n.type === 'text')).toBe(true)
    }
  })

  it('一行里多个高亮各自独立', () => {
    const tree = parse('==a== 和 ==b==') as unknown as { children: { children: { type: string }[] }[] }
    expect(tree.children[0].children.filter((n) => n.type === 'highlight')).toHaveLength(2)
  })
})

describe('remarkHighlight 序列化', () => {
  it('高亮节点往返后仍是 ==文字==', () => {
    expect(roundTrip('前 ==重点== 后')).toBe('前 ==重点== 后')
  })

  it('高亮可以嵌在加粗里', () => {
    expect(roundTrip('**==a==**')).toBe('**==a==**')
  })
})

describe('高亮输入规则', () => {
  it('输入 ==文字== 后匹配，单个 = 不匹配', () => {
    expect(HIGHLIGHT_INPUT_RULE.test('前 ==重点==')).toBe(true)
    expect(HIGHLIGHT_INPUT_RULE.test('a == b')).toBe(false)
    expect(HIGHLIGHT_INPUT_RULE.test('====')).toBe(false)
  })
})
