import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { addKnowledgeBaseNode, createKnowledgeBase } from '../db/knowledge-base-repo'
import { createNote, purgeNote, recoverNote, trashNote } from '../db/repo'
import { useUiStore } from '../stores/ui'
import KnowledgeBaseWorkspace from './KnowledgeBaseWorkspace.vue'

vi.mock('../sync/engine', () => ({ syncNow: vi.fn(), retrySyncNow: vi.fn() }))

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

async function notebook() {
  const book = await createKnowledgeBase({ name: '测试笔记本', description: '', icon: '', ord: 0, invalid: 0 })
  const ui = useUiStore()
  ui.view = 'knowledge-bases'
  ui.activeKnowledgeBaseId = book.id
  return book
}

it('hides trashed and purged notes and their chapters, restores the original placement on recovery', async () => {
  const book = await notebook()
  const note = await createNote('# 可恢复的笔记')
  const chapter = await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '原章节', note_id: null })
  await addKnowledgeBaseNode(book.id, { kind: 'note', title: null, note_id: note.id }, chapter)
  const wrapper = mount(KnowledgeBaseWorkspace)
  try {
    await vi.waitFor(() => expect(wrapper.findAll('.kb-tree-row')).toHaveLength(2))
    await trashNote(note.id)
    await vi.waitFor(() => expect(wrapper.findAll('.kb-tree-row')).toHaveLength(0))
    expect(wrapper.get('.kb-directory-footer').text()).toBe('0 篇笔记')
    await recoverNote(note.id)
    await vi.waitFor(() => expect(wrapper.findAll('.kb-tree-row')).toHaveLength(2))
    expect(wrapper.text()).toContain('原章节')
    await trashNote(note.id)
    await purgeNote(note.id)
    await vi.waitFor(() => expect(wrapper.findAll('.kb-tree-row')).toHaveLength(0))
    expect(wrapper.text()).not.toContain('笔记已彻底删除')
    expect(wrapper.get('.kb-directory-footer').text()).toBe('0 篇笔记')
  } finally { wrapper.unmount() }
})

it('hides confirmed remote deletions but keeps notes that have not synced and empty chapters visible', async () => {
  const book = await notebook()
  await addKnowledgeBaseNode(book.id, { kind: 'folder', title: '空章节', note_id: null })
  for (const id of ['purged', 'trash', 'not-downloaded']) {
    await addKnowledgeBaseNode(book.id, { kind: 'note', title: null, note_id: id })
  }
  await db.knowledgeBaseNoteStates.bulkPut([{ id: 'purged', state: 'purged' }, { id: 'trash', state: 'trash' }])
  const wrapper = mount(KnowledgeBaseWorkspace)
  try {
    await vi.waitFor(() => expect(wrapper.findAll('.kb-tree-row')).toHaveLength(2))
    expect(wrapper.text()).toContain('空章节')
    expect(wrapper.text()).toContain('笔记尚未同步到本机')
    expect(wrapper.text()).not.toContain('笔记已彻底删除')
  } finally { wrapper.unmount() }
})
