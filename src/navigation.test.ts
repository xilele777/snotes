import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/schema'
import { backToList, closeOverlay, initNavigation, isMobile, openDrawer, openOverlay, openStatsNote, popNav, pushNav, showNotes, switchListView } from './navigation'
import { useNotesStore } from './stores/notes'
import { useUiStore } from './stores/ui'
import { useGroupsStore } from './stores/groups'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  // 清掉上一个用例 push 的栈，每个用例从「无导航历史」起步
  window.history.replaceState(null, '')
  document.body.innerHTML = ''
})

describe('navigation 导航栈', () => {
  it('initNavigation 把根快照写进 history 顶层', () => {
    initNavigation()

    expect(window.history.state).toEqual({
      currentId: null,
      view: 'all',
      activeGroupId: null,
      query: '',
      mobilePane: 'list',
      drawerOpen: false,
      overlay: null,
      scroll: { list: 0, editor: 0, groups: 0 },
    })
  })

  it('initNavigation 不再额外压 state=null 的哨兵条目', () => {
    initNavigation()
    // 根快照就在栈底：back() 之后已无更早条目，history.length 不应再增大
    // （哨兵方案会让 history 多出一条 null 条目）。
    const lenBefore = window.history.length
    window.history.back()
    expect(window.history.length).toBe(lenBefore)
  })

  it('根界面按返回触发 popstate(null) 时不再 forward 挡回，直接放行退出', () => {
    initNavigation()
    const forward = vi.spyOn(window.history, 'forward')

    // 目录页按系统返回：浏览器已无更早条目，状态落到 null
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

    expect(forward).not.toHaveBeenCalled()
    forward.mockRestore()
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

  it('离开回收站后恢复分组、搜索和非首条笔记，并记录滚动位置', async () => {
    const ui = useUiStore()
    const notes = useNotesStore()
    const group = await useGroupsStore().create('工作')
    ui.view = 'group'
    ui.activeGroupId = group.group_id
    const first = await notes.create()
    await notes.saveBody(first.id, '项目第一条')
    const second = await notes.create()
    await notes.saveBody(second.id, '项目第二条')
    notes.currentId = first.id
    ui.query = '项目'
    ui.mobilePane = 'editor'
    document.body.innerHTML = '<ul class="note-list"></ul><div class="editor-body"></div><ul class="groups"></ul>'
    document.querySelector('.note-list')!.scrollTop = 180
    document.querySelector('.editor-body')!.scrollTop = 420
    document.querySelector('.groups')!.scrollTop = 64

    await switchListView('trash')
    expect(ui.query).toBe('')
    ui.query = '回收站单独搜索'
    await showNotes()

    expect(ui.view).toBe('group')
    expect(ui.activeGroupId).toBe(group.group_id)
    expect(ui.query).toBe('项目')
    expect(notes.currentId).toBe(first.id)
    expect(ui.mobilePane).toBe('editor')
    expect(ui.restorePosition?.scroll).toEqual({ list: 180, editor: 420, groups: 64 })
  })

  it('统计关闭和浏览器返回均保留打开前的笔记与筛选', async () => {
    const notes = useNotesStore()
    const note = await notes.create()
    const ui = useUiStore()
    ui.query = '保留查询'
    initNavigation()
    openOverlay('stats')

    expect(ui.overlay).toBe('stats')
    expect(ui.view).toBe('all')
    expect(notes.currentId).toBe(note.id)
    closeOverlay()
    await vi.waitFor(() => expect(history.state.overlay).toBeNull())
    expect(ui.query).toBe('保留查询')
    expect(notes.currentId).toBe(note.id)

    openOverlay('stats')
    history.back()
    await vi.waitFor(() => expect(ui.overlay).toBeNull())
    expect(notes.currentId).toBe(note.id)
    expect(ui.query).toBe('保留查询')
  })

  it('从统计打开另一条笔记会解除原筛选，返回时恢复原笔记', async () => {
    const notes = useNotesStore()
    const first = await notes.create()
    const second = await notes.create()
    const ui = useUiStore()
    notes.currentId = first.id
    ui.query = '原筛选'
    initNavigation()
    openOverlay('stats')

    await openStatsNote(second.id)
    expect(ui.overlay).toBeNull()
    expect(notes.currentId).toBe(second.id)
    expect(ui.query).toBe('')

    history.back()
    await vi.waitFor(() => expect(notes.currentId).toBe(first.id))
    expect(ui.query).toBe('原筛选')
    expect(ui.overlay).toBeNull()
  })

  it('设置弹窗独占一层历史，可指定分页打开，系统返回关闭并回到原工作区', async () => {
    const ui = useUiStore()
    ui.drawerOpen = true
    initNavigation()
    // jsdom 的 history.length 会被前面用例的 back() 截断，这里数 pushState 的次数
    const push = vi.spyOn(history, 'pushState')
    openOverlay('settings', 'about')

    expect(ui.overlay).toBe('settings')
    expect(ui.settingsTab).toBe('about')
    expect(ui.drawerOpen).toBe(false)
    expect(push).toHaveBeenCalledTimes(1)
    expect(history.state.overlay).toBe('settings')

    // 已经开着时再开只切分页，不多压一层
    openOverlay('settings', 'data')
    expect(ui.settingsTab).toBe('data')
    expect(push).toHaveBeenCalledTimes(1)
    push.mockRestore()

    history.back()
    await vi.waitFor(() => expect(ui.overlay).toBeNull())
    // 打开前抽屉已收起，返回后也不应重新弹出
    expect(ui.drawerOpen).toBe(false)
  })

  it('不带分页打开设置时回到「外观」，不记忆上次停留的分页', () => {
    const ui = useUiStore()
    initNavigation()
    openOverlay('settings', 'shortcuts')
    closeOverlay()
    ui.overlay = null
    openOverlay('settings')
    expect(ui.settingsTab).toBe('appearance')
  })

  it('开着统计时打开设置原地替换，不再多压一层历史', () => {
    const ui = useUiStore()
    initNavigation()
    openOverlay('stats')
    const push = vi.spyOn(history, 'pushState')
    openOverlay('settings')
    expect(ui.overlay).toBe('settings')
    expect(push).not.toHaveBeenCalled()
    expect(history.state.overlay).toBe('settings')
    push.mockRestore()
  })

  it('恢复 v0.13 的旧快照时 statsOpen 仍能映射成统计弹窗', async () => {
    const ui = useUiStore()
    initNavigation()
    window.dispatchEvent(new PopStateEvent('popstate', { state: { ...window.history.state, overlay: undefined, statsOpen: true } }))
    expect(ui.overlay).toBe('stats')
    // popstate 有同一任务内的防重入守卫，第二次派发要等一个微任务
    await Promise.resolve()
    window.dispatchEvent(new PopStateEvent('popstate', { state: { ...window.history.state, overlay: undefined, statsOpen: false } }))
    expect(ui.overlay).toBeNull()
  })
})
