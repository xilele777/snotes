import Dexie from 'dexie'
import { beforeEach, expect, it } from 'vitest'
import { db } from './schema'
import { createNote, purgeNote, trashNote } from './repo'
import { addKnowledgeBaseNode, applyKnowledgeBaseRemote, createKnowledgeBase, moveKnowledgeBaseNode, removeKnowledgeBaseNode, updateKnowledgeBase } from './knowledge-base-repo'
const meta = { name: '笔记本', description: '', icon: '', ord: 0, invalid: 0 as const }
beforeEach(async () => { await db.delete(); await db.open() })

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
  await addKnowledgeBaseNode(b.id, { kind: 'note', note_id: note.id, title: null })
  await removeKnowledgeBaseNode(a.id, chapter)
  await updateKnowledgeBase(b.id, { invalid: 1 })
  expect(await db.notes.get(note.id)).toEqual(note)
  expect((await db.knowledgeBaseTocs.get(a.id))?.nodes).toEqual([])
  expect((await db.knowledgeBaseTocs.get(b.id))?.nodes).toHaveLength(1)
  await updateKnowledgeBase(b.id, { invalid: 0 })
  expect((await db.knowledgeBaseTocs.get(b.id))?.nodes[0].note_id).toBe(note.id)
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
