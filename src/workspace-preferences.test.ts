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
  it('旧版布局使用默认宽度，异常宽度限制在可用范围，隐藏状态必须是布尔值', () => {
    const defaults = parseWorkspacePreferences(null)
    expect(defaults.sidebarWidth).toBe(200)
    expect(defaults.listWidth).toBe(336)
    expect(defaults.listCollapsed).toBe(false)
    const invalid = parseWorkspacePreferences('{"sidebarWidth":9000,"listWidth":-10,"listCollapsed":"true"}')
    expect(invalid.sidebarWidth).toBe(340)
    expect(invalid.listWidth).toBe(260)
    expect(invalid.listCollapsed).toBe(false)
    expect(parseWorkspacePreferences('{"sidebarWidth":"280","listWidth":1e999}')).toMatchObject({ sidebarWidth: 200, listWidth: 336 })
    updateWorkspacePreferences({ sidebarWidth: 280, listWidth: 400, listCollapsed: true })
    expect(parseWorkspacePreferences(localStorage.getItem(WORKSPACE_PREFERENCES_KEY))).toMatchObject({ sidebarWidth: 280, listWidth: 400, listCollapsed: true })
  })

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
    // 标题命中即时上屏；正文命中由后台扫描补齐
    useUiStore().query = 'Beta'
    expect(notes.visible.map(n => n.id)).toEqual([b.id])
    await vi.waitFor(() => expect(notes.visible.map(n => n.id)).toEqual([b.id, a.id]))
    expect((await db.notes.get(a.id))?.update_time).toBe(300)
  })
})
