import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../api/client'
import { db } from '../db/schema'
import { createNote } from '../db/repo'
import { addKnowledgeBaseNode, createKnowledgeBase, deleteKnowledgeBase, resolveKnowledgeBaseConflict, taskId, updateKnowledgeBase } from '../db/knowledge-base-repo'
import { KNOWLEDGE_BASE_CURSOR, retryKnowledgeBases, syncKnowledgeBases } from './knowledge-bases'
import type { KnowledgeBaseRemote, TocNode } from '../../shared/knowledge-base'
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), apiFetch: vi.fn() }))
const fetchMock = vi.mocked(apiFetch)
const meta = { name: '笔记本', description: '', icon: '📚', ord: 0, invalid: 0 as const }
const folder = (id: string): TocNode => ({ id, parent_id: null, kind: 'folder', ord: 0, note_id: null, title: id })
beforeEach(async () => { await db.delete(); await db.open(); fetchMock.mockReset() })
const emptyPull = { books: [], until: 0, next_after: null }
async function confirmedBook() {
  const book = await createKnowledgeBase(meta)
  fetchMock.mockImplementation(async path => path.endsWith('/sync/pull') ? emptyPull : { meta_version: 1, toc_version: 0, update_time: 1 })
  await syncKnowledgeBases()
  return book
}
function remote(id: string, version = 1): KnowledgeBaseRemote {
  return { book: { id, ...meta, meta_version: 1, toc_version: version, update_time: 2, create_time: 1, change_seq: 2 },
    toc: { knowledge_base_id: id, version, nodes: [folder('remote')], update_time: 2 }, note_states: {} }
}

it('applies permanent remote deletion instead of offering to resurrect an offline edit', async () => {
  const book = await confirmedBook()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '离线修改', note_id: null })
  const current = remote(book.id, 2)
  current.book = { ...current.book, deleted: 1, invalid: 1, meta_version: 2 }
  current.toc.nodes = []
  current.deleted_note_ids = []
  fetchMock.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') throw new ApiError(410, 'permanently_deleted', { current })
    return emptyPull
  })
  const result = await syncKnowledgeBases()
  expect(result.failed).toBe(0)
  expect((await db.knowledgeBases.get(book.id))?.deleted).toBe(1)
  expect(await db.knowledgeBaseOutbox.count()).toBe(0)
  expect(await db.knowledgeBaseTocHistory.count()).toBe(0)
})

it('does not delete locally after network failure, and safely retries the confirmed deletion', async () => {
  const book = await confirmedBook()
  fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  await expect(deleteKnowledgeBase(book.id, book.name)).rejects.toThrow('连接网络')
  expect((await db.knowledgeBases.get(book.id))?.invalid).toBe(0)
  const current = remote(book.id, 1)
  current.book = { ...current.book, deleted: 1, invalid: 1, meta_version: 2 }
  current.toc.nodes = []
  fetchMock.mockResolvedValueOnce(current)
  await deleteKnowledgeBase(book.id, book.name)
  expect((await db.knowledgeBases.get(book.id))?.deleted).toBe(1)
})

it('creates libraries before TOCs and waits until newly referenced notes have been created', async () => {
  const book = await createKnowledgeBase(meta)
  const note = await createNote('# 已有笔记')
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })
  const paths: string[] = []
  fetchMock.mockImplementation(async path => { paths.push(path); return path.endsWith('/sync/pull') ? emptyPull : { meta_version: 1, toc_version: path.endsWith('/toc') ? 1 : 0, update_time: 1 } })
  await syncKnowledgeBases()
  expect(paths).toEqual(['/api/knowledge-bases', '/api/knowledge-bases/sync/pull'])
  expect(await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc'))).toBeDefined()
  await db.outbox.clear()
  paths.length = 0
  await syncKnowledgeBases()
  expect(paths[0]).toBe(`/api/knowledge-bases/${book.id}/toc`)
  expect(await db.knowledgeBaseOutbox.count()).toBe(0)
})

it('does not erase edits made while an old TOC response is in flight', async () => {
  const book = await confirmedBook()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'first', note_id: null })
  const requests: { nodes: TocNode[]; base_toc_version: number }[] = []
  let resolveRequest: ((result: unknown) => void) | undefined
  fetchMock.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      requests.push(JSON.parse(String(init.body)))
      if (requests.length === 1) return new Promise(resolve => { resolveRequest = resolve })
      return { meta_version: 1, toc_version: 2, update_time: 2 }
    }
    return emptyPull
  })
  const sync = syncKnowledgeBases()
  await vi.waitFor(() => expect(resolveRequest).toBeDefined())
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'second', note_id: null })
  resolveRequest!({ meta_version: 1, toc_version: 1, update_time: 1 })
  await sync
  const queued = await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc'))
  expect(queued?.base_version).toBe(1)
  expect(queued?.sent).toBeUndefined()
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes).toHaveLength(2)
  await syncKnowledgeBases()
  expect(requests.map(r => [r.base_toc_version, r.nodes.length])).toEqual([[0, 1], [1, 2]])
  expect(await db.knowledgeBaseOutbox.count()).toBe(0)
})

it('replays the exact durable request after an uncertain response, then sends the newer edit', async () => {
  const book = await confirmedBook()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'first', note_id: null })
  const bodies: string[] = []
  let failed = true
  fetchMock.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') {
      bodies.push(String(init.body))
      if (failed) { failed = false; throw new Error('response lost') }
      return { meta_version: 1, toc_version: bodies.length === 2 ? 1 : 2, update_time: 1 }
    }
    return emptyPull
  })
  await syncKnowledgeBases()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'later', note_id: null })
  await retryKnowledgeBases()
  await syncKnowledgeBases()
  expect(bodies[1]).toBe(bodies[0])
  expect((await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc')))?.base_version).toBe(1)
  await syncKnowledgeBases()
  expect(JSON.parse(bodies[2]).nodes).toHaveLength(2)
})

it('retains both conflicting trees, pauses only this task and accepts the chosen structure', async () => {
  const book = await confirmedBook()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'local', note_id: null })
  const current = remote(book.id)
  fetchMock.mockImplementation(async (_path, init) => {
    if (init?.method === 'PUT') throw new ApiError(409, 'conflict', { current })
    return emptyPull
  })
  await syncKnowledgeBases()
  const task = await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc'))
  expect(task?.blocked).toBe(true)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes[0].title).toBe('local')
  expect((await db.knowledgeBaseTocHistory.toArray()).filter(h => h.source === 'conflict')).toHaveLength(2)
  const count = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').length
  await syncKnowledgeBases()
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(count)
  await resolveKnowledgeBaseConflict(book.id, 'toc', 'local')
  expect((await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc')))?.base_version).toBe(1)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes[0].title).toBe('local')
})

it('protects pending metadata and directories from pull, and advances no cursor on incomplete pull', async () => {
  const book = await confirmedBook()
  await updateKnowledgeBase(book.id, { name: 'local metadata' })
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'local', note_id: null })
  await db.knowledgeBaseOutbox.toCollection().modify({ next_at: Date.now() + 60_000 })
  const current = remote(book.id, 3)
  fetchMock.mockImplementation(async path => path.endsWith('/sync/pull') ? { books: [current.book], until: 3, next_after: null } : current)
  await syncKnowledgeBases()
  expect((await db.knowledgeBases.get(book.id))?.name).toBe('local metadata')
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes[0].title).toBe('local')
  expect((await db.meta.get(KNOWLEDGE_BASE_CURSOR))?.value).toBe(3)
  fetchMock.mockImplementation(async path => { if (path.endsWith('/sync/pull')) return { books: [current.book], until: 4, next_after: null }; throw new Error('offline') })
  await syncKnowledgeBases()
  expect((await db.meta.get(KNOWLEDGE_BASE_CURSOR))?.value).toBe(3)
})
