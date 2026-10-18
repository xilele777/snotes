import { beforeEach, expect, it } from 'vitest'
import { db } from './db/schema'
import { createNote } from './db/repo'
import { addKnowledgeBaseNode, createKnowledgeBase } from './db/knowledge-base-repo'
import { searchWorkspace } from './global-search'

beforeEach(async () => { await db.delete(); await db.open() })
async function search(query: string) {
  return searchWorkspace(await db.notes.toArray(), await db.knowledgeBases.toArray(), await db.knowledgeBaseTocs.toArray(), await db.groups.toArray(), query)
}

it('finds notebook contents with the correct owner, excluding removed and missing notebooks', async () => {
  const active = await createKnowledgeBase({ name: '设计研究', description: '', icon: '', ord: 0, invalid: 0 })
  const removed = await createKnowledgeBase({ name: '旧研究', description: '', icon: '', ord: 1, invalid: 0 })
  const note = await createNote('# 布局\n研究材料')
  const old = await createNote('# 旧布局\n研究材料')
  await addKnowledgeBaseNode(active.id, { kind: 'note', title: null, note_id: note.id })
  await addKnowledgeBaseNode(removed.id, { kind: 'note', title: null, note_id: old.id })
  expect(await search('研究 布局')).toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id, context: '设计研究', bookId: active.id }), expect.objectContaining({ id: old.id, bookId: removed.id })]))
  await db.knowledgeBases.update(removed.id, { invalid: 1 })
  expect((await search('研究 布局')).map(result => result.id)).toEqual([note.id])
  await db.knowledgeBases.delete(active.id)
  expect(await search('布局')).toEqual([])
})

it('matches AND terms across title and body and ranks title matches before newer body matches', async () => {
  const title = await createNote('# 界面 布局\n参考')
  const body = await createNote('# 界面\n这里讨论布局')
  await db.notes.update(title.id, { update_time: 1 })
  await db.notes.update(body.id, { update_time: 2 })
  expect((await search('界面 布局')).map(result => result.id)).toEqual([title.id, body.id])
  expect(await search('界面 不存在')).toEqual([])
})

it('searches hidden notes and notebook descriptions but never trash or tombstones', async () => {
  const hidden = await createNote('# 私人随想')
  const trash = await createNote('# 私人回收站')
  const purged = await createNote('# 私人墓碑')
  await db.notes.update(hidden.id, { home_hidden: 1 })
  await db.notes.update(trash.id, { invalid: 1 })
  await db.notes.update(purged.id, { invalid: 2 })
  const book = await createKnowledgeBase({ name: '生活', description: '私人资料', icon: '', ord: 0, invalid: 0 })
  expect((await search('私人')).map(result => result.id)).toEqual([hidden.id, book.id])
  await db.knowledgeBases.update(book.id, { deleted: 1 })
  expect((await search('私人')).map(result => result.id)).toEqual([hidden.id])
})
