import { afterEach, describe, expect, it } from 'vitest'
import { clearLaunchParams, composeSharedNote, parseLaunchIntent } from './launch'

afterEach(() => history.replaceState(null, '', '/'))

describe('clearLaunchParams', () => {
  it('保留路由使用的笔记与搜索参数', () => {
    history.replaceState(null, '', '/star?note=n1&q=hello')
    clearLaunchParams()
    expect(location.pathname + location.search).toBe('/star?note=n1&q=hello')
  })

  it('只清理已消费的启动参数', () => {
    history.replaceState({ view: 'all' }, '', '/?notebook=book&note=n1&other=1')
    clearLaunchParams()
    expect(location.search).toBe('?other=1')
    expect(history.state).toEqual({ view: 'all' })
    history.replaceState(null, '', '/?share&text=hello&q=keep')
    clearLaunchParams()
    expect(location.search).toBe('?q=keep')
  })
})

describe('parseLaunchIntent', () => {
  it('没有参数时返回 null', () => {
    expect(parseLaunchIntent('')).toBeNull()
    expect(parseLaunchIntent('?foo=1')).toBeNull()
  })

  it('shortcuts 的 new 参数新建空笔记', () => {
    expect(parseLaunchIntent('?new')).toEqual({ kind: 'new', body: '' })
  })

  it('parses notebook links and rejects malformed IDs', () => {
    expect(parseLaunchIntent('?notebook=book-1&note=note_2')).toEqual({ kind: 'open', notebookId: 'book-1', noteId: 'note_2' })
    expect(parseLaunchIntent('?notebook=book-1')).toEqual({ kind: 'open', notebookId: 'book-1', noteId: null })
    expect(parseLaunchIntent('?notebook=../outside&note=note')).toBeNull()
    expect(parseLaunchIntent('?notebook=book&note=')).toBeNull()
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
