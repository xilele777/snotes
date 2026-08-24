import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import { backToList, initNavigation, isMobile, openDrawer, popNav, pushNav } from './navigation'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  // 清掉上一个用例 push 的栈，每个用例从「无导航历史」起步
  window.history.replaceState(null, '')
})

describe('navigation 导航栈', () => {
  it('initNavigation 把根快照写进 history 顶层', () => {
    initNavigation()

    expect(window.history.state).toEqual({
      currentId: null,
      view: 'all',
      activeGroupId: null,
      mobilePane: 'list',
      drawerOpen: false,
    })
  })

  it('openDrawer 先入栈再展开，恢复入栈的那份快照能收回抽屉', () => {
    const ui = useUiStore()
    initNavigation()
    openDrawer()
    expect(ui.drawerOpen).toBe(true)

    // history.state 是 openDrawer 入栈时（展开前）的快照
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))

    expect(ui.drawerOpen).toBe(false)
  })

  it('切视图前入栈，返回能回到旧视图', () => {
    const ui = useUiStore()
    initNavigation()
    pushNav()
    ui.view = 'star'

    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))

    expect(ui.view).toBe('all')
  })

  it('恢复快照时连同 currentId 与 mobilePane 一起还原', () => {
    const notes = useNotesStore()
    const ui = useUiStore()
    notes.currentId = 'n1'
    ui.mobilePane = 'editor'
    initNavigation() // 此刻快照记下 currentId='n1' / mobilePane='editor'

    notes.currentId = 'n2'
    ui.mobilePane = 'list'

    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))

    expect(notes.currentId).toBe('n1')
    expect(ui.mobilePane).toBe('editor')
  })

  it('popNav / backToList 都走 history.back', () => {
    const back = vi.spyOn(window.history, 'back')
    popNav()
    backToList()
    expect(back).toHaveBeenCalledTimes(2)
    back.mockRestore()
  })

  it('jsdom 桌面视口下 isMobile 为 false', () => {
    expect(isMobile()).toBe(false)
  })
})
