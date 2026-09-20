import { describe, expect, it } from 'vitest'
import { highlight, matchesAll, splitTerms } from './SearchBar'

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

describe('多关键词', () => {
  it('空格分隔的多个词各自高亮', () => {
    expect(highlight('foo bar baz', 'baz foo')).toEqual([
      { text: 'foo', hit: true },
      { text: ' bar ', hit: false },
      { text: 'baz', hit: true },
    ])
  })

  it('重叠的命中区间合并成一段', () => {
    expect(highlight('abc', 'ab bc')).toEqual([{ text: 'abc', hit: true }])
  })

  it('splitTerms 去重、小写并忽略多余空白', () => {
    expect(splitTerms('  Foo  bar foo ')).toEqual(['foo', 'bar'])
    expect(splitTerms('   ')).toEqual([])
  })

  it('matchesAll 要求全部词都出现', () => {
    expect(matchesAll('Hello World', ['hello', 'world'])).toBe(true)
    expect(matchesAll('Hello World', ['hello', 'mars'])).toBe(false)
    expect(matchesAll('anything', [])).toBe(true)
  })
})
