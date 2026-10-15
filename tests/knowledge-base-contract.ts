import { expect, it } from 'vitest'
import type { KnowledgeBaseRemote, TocNode } from '../shared/knowledge-base'
import type { Env } from '../worker/types'

export type KnowledgeBaseTestApi = (path: string, method: string, body?: unknown) => Promise<Response>
const folder = (id: string, title = id, parent_id: string | null = null): TocNode => ({ id, title, parent_id, kind: 'folder', note_id: null, ord: 0 })

/** The exact same CAS, replay and pagination contract runs on real D1 and SQLite. */
export function knowledgeBaseContract(api: KnowledgeBaseTestApi, environment: () => Env) {
  const create = async (id = crypto.randomUUID()) => {
    const request = { id, operation_id: crypto.randomUUID(), name: '读书笔记', description: '摘录与思考', icon: '📚', ord: 0, invalid: 0 }
    const res = await api('/api/knowledge-bases', 'POST', request)
    expect(res.status).toBe(200)
    return { id, request, ack: await res.json() }
  }
  const get = async (id: string): Promise<KnowledgeBaseRemote> => (await api(`/api/knowledge-bases/${id}/toc`, 'GET')).json()
  const toc = (id: string, base: number, nodes: TocNode[], op = crypto.randomUUID()) => api(`/api/knowledge-bases/${id}/toc`, 'PUT', { nodes, base_toc_version: base, operation_id: op })

  it('requires the exact name and current versions before permanently deleting notebook content', async () => {
    const { id, request } = await create()
    const noteId = crypto.randomUUID()
    const note = { id: noteId, title: '正文', summary: '摘要', content: '# 正文', create_time: Date.now() }
    expect((await api('/api/notes', 'POST', note)).status).toBe(200)
    const node: TocNode = { id: 'ref', kind: 'note', parent_id: null, ord: 0, note_id: noteId, title: null }
    expect((await toc(id, 0, [node])).status).toBe(200)
    const shared = await create()
    // Restore an old shared reference to retain legacy-data deletion coverage.
    expect((await api(`/api/knowledge-bases/${shared.id}/toc`, 'PUT', { nodes: [{ ...node, id: 'shared' }], base_toc_version: 0, operation_id: crypto.randomUUID(), preserve_missing_references: true })).status).toBe(200)
    const env = environment()
    const key = `${noteId}/image.png`
    await env.R2.put(key, new Uint8Array([1, 2, 3]).buffer)
    await env.DB.prepare('INSERT INTO image (file_key, note_id, size, mime, create_time) VALUES (?, ?, 3, ?, 1)').bind(key, noteId, 'image/png').run()
    expect((await api(`/api/notes/${noteId}/history`, 'POST', { body: '旧正文', time: 1 })).status).toBe(200)
    const deletion = { name: request.name, base_meta_version: 1, base_toc_version: 1 }
    expect((await api(`/api/knowledge-bases/${id}/delete`, 'POST', { ...deletion, name: '读书' })).status).toBe(400)
    expect((await api(`/api/knowledge-bases/${id}/delete`, 'POST', { ...deletion, base_toc_version: 0 })).status).toBe(409)
    expect(await env.R2.get(key)).not.toBeNull()
    expect((await get(id)).book.deleted).toBe(0)
    const deleted = await api(`/api/knowledge-bases/${id}/delete`, 'POST', deletion)
    expect(deleted.status).toBe(200)
    const result = await deleted.json() as KnowledgeBaseRemote
    expect(result.book).toMatchObject({ invalid: 1, deleted: 1, meta_version: 2, toc_version: 2 })
    expect(result.toc.nodes).toEqual([])
    expect(result.deleted_note_ids).toEqual([noteId])
    for (const table of ['note_body', 'image', 'note_open', 'note_history']) {
      expect(await env.DB.prepare(`SELECT note_id FROM ${table} WHERE note_id = ?`).bind(noteId).first()).toBeNull()
    }
    expect(await env.DB.prepare('SELECT knowledge_base_id FROM knowledge_base_toc_history WHERE knowledge_base_id = ?').bind(id).first()).toBeNull()
    expect(await env.R2.get(key)).toBeNull()
    expect((await get(shared.id)).note_states[noteId]).toBe('purged')
    expect((await api(`/api/images/${key}`, 'GET')).status).toBe(404)
    expect((await api(`/api/knowledge-bases/${id}`, 'PATCH', { ...request, invalid: 0, base_meta_version: 2, operation_id: crypto.randomUUID() })).status).toBe(410)
    expect((await api(`/api/knowledge-bases/${id}/toc`, 'PUT', { nodes: [node], base_toc_version: 2, operation_id: crypto.randomUUID(), archived_meta_version: 2 })).status).toBe(410)
    // The original create acknowledgement cannot bypass permanent removal either.
    expect((await api('/api/knowledge-bases', 'POST', request)).status).toBe(410)
    expect((await api('/api/notes', 'POST', note)).status).toBe(410)
    expect((await api('/api/notes/opens', 'POST', { device_id: 'late-device', since: 0, items: [{ note_id: noteId, count: 4, last_open_time: 1 }] })).status).toBe(200)
    expect(await env.DB.prepare('SELECT note_id FROM note_open WHERE note_id = ?').bind(noteId).first()).toBeNull()
    expect((await api(`/api/knowledge-bases/${id}/delete`, 'POST', deletion)).status).toBe(200)
    expect((await get(id)).book.change_seq).toBe(result.book.change_seq)
    // Protection remains after the ordinary 30-day note tombstone is reaped.
    await env.DB.prepare('DELETE FROM note WHERE id = ?').bind(noteId).run()
    expect((await api('/api/notes', 'POST', note)).status).toBe(410)
  })

  it('leaves every note intact when a newer tree wins the deletion CAS', async () => {
    const { id, request } = await create()
    await toc(id, 0, [folder('new')])
    const res = await api(`/api/knowledge-bases/${id}/delete`, 'POST', { name: request.name, base_meta_version: 1, base_toc_version: 0 })
    expect(res.status).toBe(409)
    expect((await get(id)).toc.nodes).toEqual([folder('new')])
    expect((await get(id)).book.deleted).toBe(0)
    expect((await environment().DB.prepare('SELECT note_id FROM knowledge_base_deleted_note').all()).results).toEqual([])
  })

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

  it('allows only one concurrent notebook to claim a previously unowned note', async () => {
    const a = await create()
    const b = await create()
    const noteId = crypto.randomUUID()
    expect((await api('/api/notes', 'POST', { id: noteId, title: '唯一归属', summary: '', content: '# 唯一归属', create_time: Date.now() })).status).toBe(200)
    const node: TocNode = { id: 'ref', kind: 'note', parent_id: null, ord: 0, note_id: noteId, title: null }
    const responses = await Promise.all([toc(a.id, 0, [node]), toc(b.id, 0, [node])])
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    expect((await get(a.id)).toc.nodes.length + (await get(b.id)).toc.nodes.length).toBe(1)
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
