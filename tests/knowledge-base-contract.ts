import { expect, it } from 'vitest'
import type { KnowledgeBaseRemote, TocNode } from '../shared/knowledge-base'

export type KnowledgeBaseTestApi = (path: string, method: string, body?: unknown) => Promise<Response>
const folder = (id: string, title = id, parent_id: string | null = null): TocNode => ({ id, title, parent_id, kind: 'folder', note_id: null, ord: 0 })

/** The exact same CAS, replay and pagination contract runs on real D1 and SQLite. */
export function knowledgeBaseContract(api: KnowledgeBaseTestApi) {
  const create = async (id = crypto.randomUUID()) => {
    const request = { id, operation_id: crypto.randomUUID(), name: '读书笔记', description: '摘录与思考', icon: '📚', ord: 0, invalid: 0 }
    const res = await api('/api/knowledge-bases', 'POST', request)
    expect(res.status).toBe(200)
    return { id, request, ack: await res.json() }
  }
  const get = async (id: string): Promise<KnowledgeBaseRemote> => (await api(`/api/knowledge-bases/${id}/toc`, 'GET')).json()
  const toc = (id: string, base: number, nodes: TocNode[], op = crypto.randomUUID()) => api(`/api/knowledge-bases/${id}/toc`, 'PUT', { nodes, base_toc_version: base, operation_id: op })

  it('creates idempotently and replays the original acknowledgement after later changes', async () => {
    const { id, request, ack } = await create()
    expect(await (await api('/api/knowledge-bases', 'POST', request)).json()).toEqual(ack)
    const metadata = { ...request, operation_id: crypto.randomUUID(), name: '改名', base_meta_version: 1 }
    expect((await api(`/api/knowledge-bases/${id}`, 'PATCH', metadata)).status).toBe(200)
    expect(await (await api('/api/knowledge-bases', 'POST', request)).json()).toEqual(ack)
    expect((await api('/api/knowledge-bases', 'POST', { ...request, name: '另一内容' })).status).toBe(400)
    const result = await get(id)
    expect(result.book).toMatchObject({ name: '改名', meta_version: 2, toc_version: 0 })
  })

  it('rejects concurrent tree writes atomically and keeps one winner', async () => {
    const { id } = await create()
    const replies = await Promise.all([toc(id, 0, [folder('a')]), toc(id, 0, [folder('b')])])
    expect(replies.map(r => r.status).sort()).toEqual([200, 409])
    const result = await get(id)
    expect(result.toc.version).toBe(1)
    expect(result.book.toc_version).toBe(1)
    expect(result.toc.nodes).toHaveLength(1)
    expect(['a', 'b']).toContain(result.toc.nodes[0].id)
    expect(await replies.find(r => r.status === 409)!.json()).toMatchObject({ error: 'conflict', current: { toc: { version: 1 } } })
  })

  it('retries a lost tree response without increasing versions, including simultaneous retries', async () => {
    const { id } = await create()
    const op = crypto.randomUUID()
    const replies = await Promise.all([toc(id, 0, [folder('a')], op), toc(id, 0, [folder('a')], op)])
    expect(replies.map(r => r.status)).toEqual([200, 200])
    const acks = await Promise.all(replies.map(r => r.json()))
    expect(acks[0]).toEqual(acks[1])
    expect((await get(id)).toc.version).toBe(1)
    expect((await toc(id, 1, [folder('b')])).status).toBe(200)
    expect(await (await toc(id, 0, [folder('a')], op)).json()).toEqual(acks[0])
    expect((await get(id)).toc.nodes[0].id).toBe('b')
  })

  it('keeps metadata and TOC versions independent; removal never deletes the referenced note', async () => {
    const { id, request } = await create()
    const noteId = crypto.randomUUID()
    expect((await api('/api/notes', 'POST', { id: noteId, title: '正文', summary: '', content: '# 正文', create_time: Date.now() })).status).toBe(200)
    const node: TocNode = { id: 'ref', kind: 'note', parent_id: null, ord: 0, note_id: noteId, title: null }
    const responses = await Promise.all([
      toc(id, 0, [folder('chapter'), node]),
      api(`/api/knowledge-bases/${id}`, 'PATCH', { ...request, operation_id: crypto.randomUUID(), base_meta_version: 1, name: '专题' }),
    ])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    expect((await get(id)).book).toMatchObject({ meta_version: 2, toc_version: 1 })
    expect((await api(`/api/knowledge-bases/${id}`, 'PATCH', { ...request, operation_id: crypto.randomUUID(), base_meta_version: 2, invalid: 1 })).status).toBe(200)
    expect((await toc(id, 1, [])).status).toBe(409)
    expect((await get(id)).toc.nodes).toHaveLength(2)
    const bodies = await (await api('/api/sync/bodies', 'POST', { ids: [noteId] })).json() as { bodies: { content: string }[] }
    expect(bodies.bodies[0].content).toBe('# 正文')
    expect((await api(`/api/knowledge-bases/${id}`, 'PATCH', { ...request, operation_id: crypto.randomUUID(), base_meta_version: 3, invalid: 0 })).status).toBe(200)
    expect((await get(id)).book.invalid).toBe(0)
  })

  it('validates cycles, missing parents, repeated references and unresolved new notes', async () => {
    const { id } = await create()
    expect((await toc(id, 0, [folder('a', 'a', 'a')])).status).toBe(400)
    expect((await toc(id, 0, [folder('a', 'a', 'missing')])).status).toBe(400)
    const ref: TocNode = { id: 'n', parent_id: null, kind: 'note', ord: 0, note_id: 'absent-note', title: null }
    expect((await toc(id, 0, [ref, { ...ref, id: 'n2' }])).status).toBe(400)
    expect((await toc(id, 0, [ref])).status).toBe(422)
    expect((await get(id)).toc.version).toBe(0)
  })

  it('pages on an independent monotonic clock and leaves mid-pull changes for the next cursor', async () => {
    const ids: string[] = []
    for (let i = 0; i < 51; i++) ids.push((await create()).id)
    const first = await (await api('/api/knowledge-bases/sync/pull', 'POST', { since: 0 })).json() as { books: { id: string }[]; next_after: number; until: number }
    expect(first.books).toHaveLength(50)
    expect(first.next_after).toBeGreaterThan(0)
    const lastId = ids.at(-1)!
    expect((await toc(lastId, 0, [folder('changed')])).status).toBe(200)
    const last = await (await api('/api/knowledge-bases/sync/pull', 'POST', { since: 0, after: first.next_after, until: first.until })).json() as { books: { id: string }[]; next_after: number | null }
    expect(last.books).toHaveLength(0)
    expect(last.next_after).toBeNull()
    const next = await (await api('/api/knowledge-bases/sync/pull', 'POST', { since: first.until })).json() as { books: { id: string }[] }
    expect(next.books.map((b: { id: string }) => b.id)).toEqual([lastId])
  })

  it('imports missing references as placeholders and saves archived structures only against the confirmed removal', async () => {
    const { id, request } = await create()
    const node: TocNode = { id: 'missing-ref', parent_id: null, kind: 'note', ord: 0, note_id: 'missing-note', title: null }
    const preserved = { nodes: [node], base_toc_version: 0, operation_id: crypto.randomUUID(), preserve_missing_references: true }
    expect((await api(`/api/knowledge-bases/${id}/toc`, 'PUT', preserved)).status).toBe(200)
    expect((await get(id)).note_states['missing-note']).toBe('purged')
    const bodies = await (await api('/api/sync/bodies', 'POST', { ids: ['missing-note'] })).json() as { bodies: unknown[] }
    expect(bodies.bodies).toEqual([])
    expect((await api(`/api/knowledge-bases/${id}`, 'PATCH', { ...request, operation_id: crypto.randomUUID(), base_meta_version: 1, invalid: 1 })).status).toBe(200)
    expect((await toc(id, 1, [])).status).toBe(409)
    expect((await api(`/api/knowledge-bases/${id}/toc`, 'PUT', { nodes: [node, folder('archived')], base_toc_version: 1, operation_id: crypto.randomUUID(), archived_meta_version: 2 })).status).toBe(200)
    expect((await get(id)).book.invalid).toBe(1)
    expect((await get(id)).toc.nodes).toHaveLength(2)
  })
}
