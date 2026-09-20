import { describe, expect, it } from 'vitest'
import { composeSharedNote, parseLaunchIntent } from './launch'

describe('parseLaunchIntent', () => {
  it('没有参数时返回 null', () => {
    expect(parseLaunchIntent('')).toBeNull()
    expect(parseLaunchIntent('?foo=1')).toBeNull()
  })

  it('shortcuts 的 new 参数新建空笔记', () => {
    expect(parseLaunchIntent('?new')).toEqual({ kind: 'new', body: '' })
  })

  it('share_target 参数拼成标题、正文、链接三段', () => {
    expect(parseLaunchIntent('?share&title=T&text=hello&url=https%3A%2F%2Fa.b')).toEqual({
      kind: 'new',
      body: '# T\n\nhello\n\nhttps://a.b',
    })
  })
})

describe('composeSharedNote', () => {
  it('text 与 url 相同时只保留一份', () => {
    expect(composeSharedNote('', 'https://a.b', 'https://a.b')).toBe('https://a.b')
  })

  it('全空返回空串', () => {
    expect(composeSharedNote(' ', '', '')).toBe('')
  })
})
