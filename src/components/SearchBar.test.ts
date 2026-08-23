import { describe, expect, it } from 'vitest'
import { highlight } from './SearchBar'

describe('highlight', () => {
  it('切分出命中片段', () => {
    expect(highlight('abcXYZdef', 'xyz')).toEqual([
      { text: 'abc', hit: false },
      { text: 'XYZ', hit: true },
      { text: 'def', hit: false },
    ])
  })

  it('大小写不敏感且保留原文大小写', () => {
    expect(highlight('Hello', 'hello')).toEqual([{ text: 'Hello', hit: true }])
  })

  it('多处命中全部标出', () => {
    expect(highlight('aXaXa', 'x')).toEqual([
      { text: 'a', hit: false },
      { text: 'X', hit: true },
      { text: 'a', hit: false },
      { text: 'X', hit: true },
      { text: 'a', hit: false },
    ])
  })

  it('空查询返回整段未命中', () => {
    expect(highlight('abc', '')).toEqual([{ text: 'abc', hit: false }])
  })

  it('无命中返回整段未命中', () => {
    expect(highlight('abc', 'zzz')).toEqual([{ text: 'abc', hit: false }])
  })

  it('正则元字符按字面处理，不当作模式', () => {
    expect(highlight('a.c', '.')).toEqual([
      { text: 'a', hit: false },
      { text: '.', hit: true },
      { text: 'c', hit: false },
    ])
  })
})
