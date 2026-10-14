import { describe, expect, it } from 'vitest'
import { childrenOf, descendantsOf, flattenToc, moveTocNode, validateToc } from './knowledge-base'
import type { TocNode } from './knowledge-base'
const folder = (id: string, parent_id: string | null = null, ord = 0): TocNode => ({ id, parent_id, ord, kind: 'folder', note_id: null, title: id })
const ref = (id: string, note_id: string, parent_id: string | null = null, ord = 0): TocNode => ({ id, parent_id, ord, kind: 'note', note_id, title: null })
describe('knowledge-base structure', () => {
  it('moves subtrees and keeps the sibling order deterministic', () => {
    const nodes = [folder('a'), folder('b', null, 1), folder('child', 'a'), ref('n', 'note', 'child')]
    const moved = moveTocNode(nodes, 'a', 'b', 0)
    expect(flattenToc(moved).map(r => [r.node.id, r.depth])).toEqual([['b', 0], ['a', 1], ['child', 2], ['n', 3]])
    expect(descendantsOf(moved, 'a')).toEqual(new Set(['a', 'child', 'n']))
    expect(nodes[0].parent_id).toBeNull()
  })
  it('reorders siblings in both directions without mutating the input', () => {
    const nodes = [folder('a'), folder('b', null, 1), folder('c', null, 2)]
    expect(childrenOf(moveTocNode(nodes, 'a', null, 2), null).map(n => n.id)).toEqual(['b', 'c', 'a'])
    expect(childrenOf(moveTocNode(nodes, 'c', null, 0), null).map(n => n.id)).toEqual(['c', 'a', 'b'])
  })
  it('rejects cycles, note parents, duplicate references, excess depth and unsupported kinds', () => {
    expect(() => validateToc([folder('a', 'b'), folder('b', 'a')])).toThrow()
    expect(() => validateToc([ref('a', 'note'), folder('b', 'a')])).toThrow()
    expect(() => validateToc([ref('a', 'note'), ref('b', 'note')])).toThrow()
    expect(() => validateToc(Array.from({ length: 9 }, (_, i) => folder(String(i), i ? String(i - 1) : null)))).toThrow()
    expect(() => moveTocNode([folder('a'), folder('b', 'a')], 'a', 'b', 0)).toThrow()
    expect(() => validateToc([{ ...folder('a'), kind: 'link' }])).toThrow()
  })
})
