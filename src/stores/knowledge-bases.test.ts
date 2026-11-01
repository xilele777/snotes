import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '../db/schema'
import { addKnowledgeBaseNode, createKnowledgeBase } from '../db/knowledge-base-repo'
import { createNote } from '../db/repo'
import { useKnowledgeBasesStore } from './knowledge-bases'

beforeEach(async () => { setActivePinia(createPinia()); await db.delete(); await db.open() })

it('总览不读取正文；切换笔记本只加载当前范围并清除旧范围缓存', async () => {
  const one = await createKnowledgeBase({ name: '一', description: '', icon: '', ord: 0, invalid: 0 })
  const two = await createKnowledgeBase({ name: '二', description: '', icon: '', ord: 1, invalid: 0 })
  const a = await createNote('第一篇正文')
  const b = await createNote('第二篇正文')
  await addKnowledgeBaseNode(one.id, { kind: 'note', note_id: a.id, title: null })
  await addKnowledgeBaseNode(two.id, { kind: 'note', note_id: b.id, title: null })
  const scope = ref<string | null>(null)
  const bodies = vi.spyOn(db.bodies, 'bulkGet')
  const store = useKnowledgeBasesStore()
  const subscription = store.subscribe(() => scope.value)
  try {
    await vi.waitFor(() => expect(store.notes).toHaveLength(2))
    expect(bodies).not.toHaveBeenCalled()
    expect(store.bodyText.size).toBe(0)
    scope.value = one.id
    await vi.waitFor(() => expect(store.bodyText.get(a.id)).toBe('第一篇正文'))
    expect(store.bodyText.has(b.id)).toBe(false)
    scope.value = two.id
    await vi.waitFor(() => expect(store.bodyText.get(b.id)).toBe('第二篇正文'))
    expect(store.bodyText.has(a.id)).toBe(false)
    expect(bodies.mock.calls.every(([ids]) => ids.length === 1)).toBe(true)
  } finally { subscription.unsubscribe(); bodies.mockRestore() }
})
