import Dexie from 'dexie'
import { beforeEach, expect, it } from 'vitest'
import { db } from './schema'
import { createNote, listNotes, purgeNote, recoverNote, trashNote } from './repo'
import { acknowledgeKnowledgeBaseTask, addKnowledgeBaseNode, applyKnowledgeBaseRemote, createKnowledgeBase, moveKnowledgeBaseNode, removeKnowledgeBaseNode, taskId, trashKnowledgeBaseNode, updateKnowledgeBase } from './knowledge-base-repo'
const meta = { name: '笔记本', description: '', icon: '', ord: 0, invalid: 0 as const }
beforeEach(async () => { await db.delete(); await db.open() })

it('acknowledges and pulls directory changes without recording ordinary snapshots', async () => {
  const book = await createKnowledgeBase(meta)
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '原章节', note_id: null })
  const task = (await db.knowledgeBaseOutbox.get(taskId(book.id, 'toc')))!
  task.sent = { seq: task.seq, base_version: task.base_version, operation_id: task.operation_id, payload: task.payload }
  await db.knowledgeBaseOutbox.put(task)
  await acknowledgeKnowledgeBaseTask(task, { meta_version: 1, toc_version: 1, update_time: Date.now() })
  expect(await db.knowledgeBaseTocHistory.count()).toBe(0)
  await db.knowledgeBaseOutbox.clear()
  const nodes = [{ id: 'new-folder', kind: 'folder' as const, title: '远端章节', parent_id: null, note_id: null, ord: 0 }]
  await applyKnowledgeBaseRemote({ book: { ...book, meta_version: 1, toc_version: 2 }, toc: { knowledge_base_id: book.id, version: 2, nodes, update_time: Date.now() }, note_states: {} })
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes).toEqual(nodes)
  expect(await db.knowledgeBaseTocHistory.count()).toBe(0)
})

it('upgrades an existing v2 database without changing legacy notes or groups', async () => {
  const note = await createNote('# 原笔记', { group_id: 'group' })
  db.close()
  // Recreate the legacy schema as a v2 installation rather than upgrading an
  // already-v3 fixture. There is no production database involved.
  await db.delete()
  const legacy = new Dexie('snotes')
  legacy.version(2).stores({ notes: 'id, update_time, group_id, invalid, star, top, dirty', outbox: '++id, note_id, kind, next_at, failed, [note_id+kind]', groups: 'group_id, ord, invalid', meta: 'key', history: '++id, note_id, time' })
  await legacy.open()
  await legacy.table('notes').put(note)
  await legacy.table('groups').put({ group_id: 'group', name: '原分组', ord: 0, invalid: 0, update_time: 1 })
  legacy.close()
  await db.open()
  expect(await db.notes.get(note.id)).toEqual(note)
  expect((await db.groups.get('group'))?.name).toBe('原分组')
  expect(await db.knowledgeBases.count()).toBe(0)
  await createKnowledgeBase(meta)
  expect(await db.knowledgeBases.count()).toBe(1)
})

it('keeps a shared note, its group and body version when removing chapters and libraries', async () => {
  const note = await createNote('# 共享正文', { group_id: 'group', home_hidden: 1 })
  const a = await createKnowledgeBase(meta)
  const b = await createKnowledgeBase(meta)
  const chapter = await addKnowledgeBaseNode(a.id, { kind: 'folder', title: '章节', note_id: null })
  await addKnowledgeBaseNode(a.id, { kind: 'note', note_id: note.id, title: null }, chapter)
  // A pre-existing shared reference from an older client/backup remains readable.
  await db.knowledgeBaseTocs.update(b.id, { nodes: [{ id: 'legacy-shared', parent_id: null, ord: 0, kind: 'note', note_id: note.id, title: null }] })
  await removeKnowledgeBaseNode(a.id, chapter)
  await updateKnowledgeBase(b.id, { invalid: 1 })
  expect(await db.notes.get(note.id)).toEqual(note)
  expect((await db.knowledgeBaseTocs.get(a.id))?.nodes).toEqual([])
  expect((await db.knowledgeBaseTocs.get(b.id))?.nodes).toHaveLength(1)
  await updateKnowledgeBase(b.id, { invalid: 0 })
  expect((await db.knowledgeBaseTocs.get(b.id))?.nodes[0].note_id).toBe(note.id)
})

it('serializes concurrent joins so only one active notebook owns the note', async () => {
  const note = await createNote('# 独属于一本')
  const a = await createKnowledgeBase(meta)
  const b = await createKnowledgeBase(meta)
  const results = await Promise.allSettled([a, b].map(book => addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })))
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
  expect((await db.knowledgeBaseTocs.toArray()).flatMap(t => t.nodes)).toHaveLength(1)
  const before = await db.knowledgeBases.count()
  await expect(createKnowledgeBase(meta, crypto.randomUUID(), [{ id: 'new-ref', kind: 'note', note_id: note.id, title: null, parent_id: null, ord: 0 }])).rejects.toThrow('已属于')
  expect(await db.knowledgeBases.count()).toBe(before)
})

it('directory trash and recovery preserve the owner, chapter, node id and ordering', async () => {
  const note = await createNote('# 可恢复')
  const book = await createKnowledgeBase(meta)
  const chapter = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '章节', note_id: null })
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null }, chapter)
  const original = (await db.knowledgeBaseTocs.get(book.id))!.nodes
  await trashKnowledgeBaseNode(book.id, chapter, original)
  expect((await db.notes.get(note.id))?.invalid).toBe(1)
  expect((await listNotes({ view: 'trash' })).map(n => n.id)).toContain(note.id)
  expect((await db.knowledgeBaseTocs.get(book.id))!.nodes).toEqual(original)
  await recoverNote(note.id)
  expect((await listNotes({ view: 'all' })).map(n => n.id)).not.toContain(note.id)
  expect((await db.knowledgeBaseTocs.get(book.id))!.nodes).toEqual(original)
})

it('rejects stale directory deletion without trashing notes or altering references', async () => {
  const n1 = await createNote('# 原来在章节内')
  const n2 = await createNote('# 后来移入')
  const book = await createKnowledgeBase(meta)
  const chapter = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '章节', note_id: null })
  const first = await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: n1.id, title: null }, chapter)
  const second = await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: n2.id, title: null })
  const expected = (await db.knowledgeBaseTocs.get(book.id))!.nodes
  await moveKnowledgeBaseNode(book.id, first, null, 1)
  await moveKnowledgeBaseNode(book.id, second, chapter, 0)
  const latest = await db.knowledgeBaseTocs.get(book.id)
  await expect(trashKnowledgeBaseNode(book.id, chapter, expected)).rejects.toThrow('目录已更新')
  expect((await db.notes.get(n1.id))?.invalid).toBe(0)
  expect((await db.notes.get(n2.id))?.invalid).toBe(0)
  expect(await db.knowledgeBaseTocs.get(book.id)).toEqual(latest)
  expect(await db.outbox.where('kind').equals('trash').count()).toBe(0)
})

it('rolls back directory trash when a referenced note has not been downloaded', async () => {
  const note = await createNote('# 不应部分删除')
  const book = await createKnowledgeBase(meta)
  const folder = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '章节', note_id: null })
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null }, folder)
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: 'not-downloaded', title: null }, folder)
  const before = (await db.knowledgeBaseTocs.get(book.id))!.nodes
  await expect(trashKnowledgeBaseNode(book.id, folder, before)).rejects.toThrow('尚未同步')
  expect((await db.notes.get(note.id))?.invalid).toBe(0)
  expect(await db.outbox.where('kind').equals('trash').count()).toBe(0)
})

it('does not commit or enqueue an invalid cyclic move', async () => {
  const book = await createKnowledgeBase(meta)
  const a = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'a', note_id: null })
  const b = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: 'b', note_id: null }, a)
  const before = await db.knowledgeBaseTocs.get(book.id)
  const taskBefore = await db.knowledgeBaseOutbox.toArray()
  await expect(moveKnowledgeBaseNode(book.id, a, b, 0)).rejects.toThrow()
  expect(await db.knowledgeBaseTocs.get(book.id)).toEqual(before)
  expect(await db.knowledgeBaseOutbox.toArray()).toEqual(taskBefore)
})

it('retains a confirmed purge state after the local note row is removed', async () => {
  const note = await createNote('# 正文')
  const book = await createKnowledgeBase(meta)
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })
  await trashNote(note.id)
  await purgeNote(note.id)
  expect(await db.notes.get(note.id)).toBeUndefined()
  expect((await db.knowledgeBaseNoteStates.get(note.id))?.state).toBe('purged')
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes[0].note_id).toBe(note.id)
})

it('removes a stale purged reference when deleting it again and queues the directory change', async () => {
  const note = await createNote('# 已删除')
  const book = await createKnowledgeBase(meta)
  const node = await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })
  await trashNote(note.id)
  await purgeNote(note.id)
  await db.knowledgeBaseOutbox.clear()
  await trashKnowledgeBaseNode(book.id, node, (await db.knowledgeBaseTocs.get(book.id))!.nodes)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes).toEqual([])
  expect(await db.knowledgeBaseOutbox.get(`${book.id}:toc`)).toMatchObject({ payload: [] })
})

it('cleans purged references in a deleted chapter while retaining recoverable note placement', async () => {
  const live = await createNote('# 可恢复')
  const purged = await createNote('# 已删除')
  const book = await createKnowledgeBase(meta)
  const chapter = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '章节', note_id: null })
  const liveNode = await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: live.id, title: null }, chapter)
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: purged.id, title: null }, chapter)
  await trashNote(purged.id)
  await purgeNote(purged.id)
  await trashKnowledgeBaseNode(book.id, chapter, (await db.knowledgeBaseTocs.get(book.id))!.nodes)
  expect((await db.notes.get(live.id))?.invalid).toBe(1)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes.map(n => n.id)).toEqual([chapter, liveNode])
  await recoverNote(live.id)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes.find(n => n.id === liveNode)?.parent_id).toBe(chapter)
})

it('permanent remote deletion overrides pending work, clears histories and resists a delayed old pull', async () => {
  const note = await createNote('# 即将删除')
  const book = await createKnowledgeBase(meta)
  await addKnowledgeBaseNode(book.id, { kind: 'note', note_id: note.id, title: null })
  const old = { book, toc: (await db.knowledgeBaseTocs.get(book.id))!, note_states: {} }
  await db.history.add({ note_id: note.id, body: '旧正文', time: 1 })
  await db.knowledgeBaseTocHistory.add({ id: 'snapshot', book_id: book.id, time: 1, source: 'confirmed', nodes: old.toc.nodes })
  const deletion = { book: { ...book, invalid: 1 as const, deleted: 1 as const, meta_version: 2, toc_version: 2 }, toc: { ...old.toc, nodes: [], version: 2 }, note_states: {}, deleted_note_ids: [note.id] }
  await applyKnowledgeBaseRemote(deletion)
  expect(await db.notes.get(note.id)).toBeUndefined()
  expect(await db.outbox.count()).toBe(0)
  expect(await db.history.count()).toBe(0)
  expect(await db.knowledgeBaseOutbox.count()).toBe(0)
  expect(await db.knowledgeBaseTocHistory.count()).toBe(0)
  await applyKnowledgeBaseRemote(old)
  expect((await db.knowledgeBases.get(book.id))?.deleted).toBe(1)
  expect((await db.knowledgeBaseTocs.get(book.id))?.nodes).toEqual([])
  await expect(updateKnowledgeBase(book.id, { invalid: 0 })).rejects.toThrow('永久删除')
})
