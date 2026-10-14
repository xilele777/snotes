import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import { createNote } from './db/repo'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import { WORKSPACE_PREFERENCES_KEY, parseWorkspacePreferences, togglePinnedKnowledgeBase, updateWorkspacePreferences, workspacePreferences } from './workspace-preferences'

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  workspacePreferences.value = parseWorkspacePreferences(null)
  await db.delete()
  await db.open()
})

describe('工作区偏好', () => {
  it('损坏或旧设置不会隐藏导航，非法排序回退，固定库 ID 去重', () => {
    expect(parseWorkspacePreferences('{bad')).toEqual(parseWorkspacePreferences(null))
    const result = parseWorkspacePreferences('{"sidebarCollapsed":"false","noteSort":"invalid","pinnedKnowledgeBaseIds":["a",null,"a","b",12]}')
    expect(result.sidebarCollapsed).toBe(false)
    expect(result.noteSort).toBe('updated')
    expect(result.pinnedKnowledgeBaseIds).toEqual(['a', 'b'])
  })

  it('固定和取消固定持久化，存储被禁用时仍可折叠分区', () => {
    togglePinnedKnowledgeBase('a')
    togglePinnedKnowledgeBase('b')
    togglePinnedKnowledgeBase('a')
    expect(parseWorkspacePreferences(localStorage.getItem(WORKSPACE_PREFERENCES_KEY)).pinnedKnowledgeBaseIds).toEqual(['b'])
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => updateWorkspacePreferences({ groupsCollapsed: true })).not.toThrow()
    expect(workspacePreferences.value.groupsCollapsed).toBe(true)
    spy.mockRestore()
  })

  it('三种笔记排序均保持置顶，标题搜索优先于正文命中，不改动笔记时间', async () => {
    const a = await createNote('# Alpha\n\nBeta', { create_time: 100 })
    const b = await createNote('# Beta', { create_time: 200 })
    const pinned = await createNote('# Zulu', { top: 1, create_time: 50 })
    await db.notes.update(a.id, { update_time: 300 })
    await db.notes.update(b.id, { update_time: 400 })
    const notes = useNotesStore()
    await notes.load()
    expect(notes.visible.map(n => n.id)).toEqual([pinned.id, b.id, a.id])
    updateWorkspacePreferences({ noteSort: 'title' })
    expect(notes.visible.map(n => n.id)).toEqual([pinned.id, a.id, b.id])
    updateWorkspacePreferences({ noteSort: 'created' })
    expect(notes.visible.map(n => n.id)).toEqual([pinned.id, b.id, a.id])
    useUiStore().query = 'Beta'
    expect(notes.visible.map(n => n.id)).toEqual([b.id, a.id])
    expect((await db.notes.get(a.id))?.update_time).toBe(300)
  })
})
