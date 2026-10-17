import { describe, expect, it } from 'vitest'
import { parseRoute, routeUrl } from './routes'

describe('workspace routes', () => {
  it.each([
    ['/', 'all', null], ['/star', 'star', null], ['/hidden', 'hidden', null],
    ['/trash', 'trash', null], ['/metrics', 'metrics', null],
    ['/groups/work', 'group', null], ['/notebooks', 'knowledge-bases', null],
    ['/notebooks/book', 'knowledge-bases', null], ['/stats', 'all', 'stats'],
    ['/settings/agents', 'all', 'settings'],
  ])('%s 可解析并还原地址', (path, view, workspacePage) => {
    const route = parseRoute(new URL(path, 'https://snotes.test'))!
    expect(route).toMatchObject({ view, workspacePage })
    expect(routeUrl(route)).toBe(path)
  })

  it('保留编码后的分组、搜索词、当前笔记与目录节点', () => {
    const route = parseRoute(new URL('https://snotes.test/groups/%E5%B7%A5%E4%BD%9C?note=n%2F1&q=%E6%B5%8B%E8%AF%95'))!
    expect(route).toMatchObject({ activeGroupId: '工作', currentId: 'n/1', query: '测试' })
    expect(parseRoute(new URL(routeUrl(route), 'https://snotes.test'))).toEqual(route)
    const book = parseRoute(new URL('https://snotes.test/notebooks/book?note=n1&node=chapter&q=find'))!
    expect(book).toMatchObject({ activeKnowledgeBaseId: 'book', currentId: 'n1', activeTocNodeId: 'chapter', query: 'find' })
    expect(routeUrl(book)).toBe('/notebooks/book?note=n1&node=chapter&q=find')
  })

  it('设置分页默认为外观，错误路径安全回退', () => {
    expect(routeUrl(parseRoute(new URL('https://snotes.test/settings'))!)).toBe('/settings/appearance')
    for (const path of ['/settings/unknown', '/settings/about/extra', '/unknown', '/groups', '/groups/%E0%A4%A']) {
      expect(parseRoute(new URL(path, 'https://snotes.test'))).toBeNull()
    }
  })
})
