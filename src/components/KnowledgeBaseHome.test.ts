import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { addKnowledgeBaseNode, createKnowledgeBase } from '../db/knowledge-base-repo'
import { createNote } from '../db/repo'
import { useUiStore } from '../stores/ui'
import { useNotesStore } from '../stores/notes'
import { useKnowledgeBasesStore } from '../stores/knowledge-bases'
import KnowledgeBaseHome from './KnowledgeBaseHome.vue'

vi.mock('../sync/engine', () => ({ syncNow: vi.fn(), retrySyncNow: vi.fn() }))
beforeEach(async () => { setActivePinia(createPinia()); await db.delete(); await db.open() })
async function setup() {
  const book = await createKnowledgeBase({ name: '研究手记', description: '按主题思考', icon: '', ord: 0, invalid: 0 })
  const ui = useUiStore()
  ui.view = 'knowledge-bases'
  ui.activeKnowledgeBaseId = book.id
  return book
}

it('shows recent active notes in this notebook and opens a note inside collapsed chapters', async () => {
  const book = await setup()
  const chapter = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '设计原则', note_id: null })
  const old = await createNote('# 较早记录\n摘要')
  const latest = await createNote('# 最新记录\n摘要')
  const trash = await createNote('# 已删除记录')
  await createNote('# 其他笔记')
  for (const note of [old, latest, trash]) await addKnowledgeBaseNode(book.id, { kind: 'note', title: null, note_id: note.id }, chapter)
  await db.notes.update(old.id, { update_time: 1 })
  await db.notes.update(latest.id, { update_time: 2 })
  await db.notes.update(trash.id, { invalid: 1 })
  useUiStore().collapsedKnowledgeBaseNodes = [chapter]
  const subscription = useKnowledgeBasesStore().subscribe()
  const wrapper = mount(KnowledgeBaseHome)
  try {
    await vi.waitFor(() => expect(wrapper.findAll('.kb-recent-note')).toHaveLength(2))
    const recent = wrapper.findAll('.kb-recent-note')
    expect(recent[0].text()).toContain('最新记录')
    expect(recent[0].text()).toContain('设计原则')
    expect(wrapper.text()).not.toContain('已删除记录')
    expect(wrapper.text()).not.toContain('其他笔记')
    await recent[0].trigger('click')
    await vi.waitFor(() => expect(useNotesStore().currentId).toBe(latest.id))
    expect(useUiStore().activeKnowledgeBaseId).toBe(book.id)
    expect(useUiStore().collapsedKnowledgeBaseNodes).toEqual([])
  } finally { wrapper.unmount(); subscription.unsubscribe() }
})

it('creates the first note in the current notebook from its empty state', async () => {
  const book = await setup()
  const subscription = useKnowledgeBasesStore().subscribe()
  const wrapper = mount(KnowledgeBaseHome)
  try {
    await vi.waitFor(() => expect(wrapper.find('.kb-home-empty button').exists()).toBe(true))
    await wrapper.get('.kb-home-empty button').trigger('click')
    await vi.waitFor(() => expect(useNotesStore().currentId).toBeTruthy())
    const toc = await db.knowledgeBaseTocs.get(book.id)
    expect(toc?.nodes).toEqual([expect.objectContaining({ kind: 'note', note_id: useNotesStore().currentId })])
  } finally { wrapper.unmount(); subscription.unsubscribe() }
})
